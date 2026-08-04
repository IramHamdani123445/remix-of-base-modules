-- =====================================================================
-- BN LIFE CERTIFICATES — command + query boundary
-- =====================================================================

-- ------------------------- helpers -----------------------------------
CREATE OR REPLACE FUNCTION public._bn_lc_actor()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;
  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION public._bn_lc_assert_enabled()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ok boolean;
BEGIN
  SELECT (is_enabled AND actions_enabled) INTO ok FROM public.app_modules WHERE name='bn_life_certificate';
  IF NOT COALESCE(ok,false) THEN RAISE EXCEPTION 'E_FEATURE_DISABLED' USING ERRCODE='P0001'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public._bn_lc_require(p_actor uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (public.has_permission(p_actor,'bn_life_certificate',p_action) OR public.is_admin(p_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._bn_lc_audit(
  p_actor uuid, p_event_code text, p_action text, p_entity_id text,
  p_before jsonb, p_after jsonb, p_correlation text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.core_audit_log
    (event_code, event_name, event_category, severity, actor_user_id, module_code, domain_code,
     entity_type, entity_id, action, outcome, before_value, after_value, reason,
     correlation_id, source, is_system_generated)
  VALUES
    (p_event_code, p_event_code, 'BENEFITS','INFO', p_actor,'bn_life_certificate','benefits',
     'bn_life_certificate', p_entity_id, p_action,'SUCCESS', p_before, p_after, p_reason,
     p_correlation,'RPC', true);
END $$;

CREATE OR REPLACE FUNCTION public._bn_lc_event(
  p_cert uuid, p_type text, p_from text, p_to text, p_actor uuid,
  p_reason text, p_narrative text, p_correlation text, p_key text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.bn_life_certificate_event
    (life_certificate_id, event_type, from_state, to_state, actor_user_id, actor_user_code,
     reason_code, narrative, correlation_id, idempotency_key, payload)
  VALUES (p_cert, p_type, p_from, p_to, p_actor, public._bn_susp_user_code(p_actor),
          p_reason, p_narrative, p_correlation, p_key, COALESCE(p_payload,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Communication INTENT only. Benefits never dispatches email/SMS/letters.
CREATE OR REPLACE FUNCTION public._bn_lc_comm(
  p_cert uuid, p_award uuid, p_event_code text, p_context jsonb, p_correlation text, p_idem text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_claim uuid;
BEGIN
  SELECT bn_claim_id INTO v_claim FROM public.bn_award WHERE id = p_award;
  INSERT INTO public.bn_life_certificate_communication_intent
    (life_certificate_id, bn_award_id, event_code, recipient_reference, context,
     idempotency_key, correlation_id)
  VALUES (p_cert, p_award, p_event_code, v_claim::text,
          COALESCE(p_context,'{}'::jsonb) || jsonb_build_object('dispatch_owner','shared_communication_facade'),
          p_idem, p_correlation)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.bn_life_certificate_communication_intent WHERE idempotency_key = p_idem;
  ELSE
    UPDATE public.bn_life_certificate SET communication_status='INTENT_RECORDED' WHERE id = p_cert;
  END IF;
  RETURN v_id;
END $$;

-- ------------------- 1. Obligation generation -------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_generate_obligations_v1(
  p_policy_code text DEFAULT 'BN_LIFE_CERT_DEFAULT',
  p_as_of date DEFAULT current_date,
  p_limit integer DEFAULT 200,
  p_preview boolean DEFAULT true,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_policy public.bn_life_certificate_policy%ROWTYPE;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,200),1), 1000);
  v_period_start date; v_period_end date; v_period text;
  v_issue date; v_due date; v_grace date; v_esc date;
  v_created integer := 0; v_skipped integer := 0; v_eligible integer := 0;
  v_award record; v_cert uuid; v_snapshot jsonb; v_corr text := COALESCE(p_correlation_id, gen_random_uuid()::text);
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'generate');

  v_hash := encode(digest(coalesce(p_policy_code,'')||'|'||coalesce(p_as_of::text,'')||'|'||
                          v_limit::text||'|'||coalesce(p_preview::text,''), 'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_generate_obligations_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_policy FROM public.bn_life_certificate_policy
   WHERE policy_code = p_policy_code AND is_active
     AND effective_from <= p_as_of AND (effective_to IS NULL OR effective_to >= p_as_of)
   ORDER BY policy_version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_POLICY_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  v_period_start := CASE v_policy.obligation_period_kind
    WHEN 'ANNUAL' THEN date_trunc('year', p_as_of)::date
    WHEN 'SEMI_ANNUAL' THEN (date_trunc('year', p_as_of) + (((extract(month from p_as_of)::int - 1)/6) * interval '6 month'))::date
    WHEN 'QUARTERLY' THEN date_trunc('quarter', p_as_of)::date
    ELSE date_trunc('year', p_as_of)::date END;
  v_period_end := (v_period_start + (v_policy.frequency_months || ' month')::interval - interval '1 day')::date;
  v_period := to_char(v_period_start,'YYYY-MM') || '/' || v_policy.frequency_months::text || 'M';
  v_issue := v_period_start + v_policy.issue_offset_days;
  v_due := v_issue + v_policy.due_offset_days;
  v_grace := v_due + v_policy.grace_days;
  v_esc := v_grace + v_policy.escalation_offset_days;

  v_snapshot := jsonb_build_object(
    'policy_id', v_policy.id, 'policy_code', v_policy.policy_code, 'policy_version', v_policy.policy_version,
    'frequency_months', v_policy.frequency_months, 'due_offset_days', v_policy.due_offset_days,
    'grace_days', v_policy.grace_days, 'escalation_offset_days', v_policy.escalation_offset_days,
    'reminder_offset_days', to_jsonb(v_policy.reminder_offset_days),
    'accepted_evidence_types', to_jsonb(v_policy.accepted_evidence_types),
    'certificate_validity_days', v_policy.certificate_validity_days,
    'requires_maker_checker', v_policy.requires_maker_checker,
    'suspension_reason_code', v_policy.suspension_reason_code,
    'reinstatement_reason_code', v_policy.reinstatement_reason_code,
    'timezone', v_policy.timezone);

  FOR v_award IN
    SELECT a.id, a.bn_award_id_dummy FROM (SELECT id, NULL::uuid AS bn_award_id_dummy FROM public.bn_award WHERE false) a WHERE false
  LOOP END LOOP;

  FOR v_award IN
    SELECT w.id, NULL::uuid AS bn_award_id_dummy
      FROM public.bn_award w
     WHERE w.status = ANY (v_policy.applicable_award_statuses)
       AND (cardinality(v_policy.applicable_benefit_codes) = 0 OR w.benefit_code = ANY (v_policy.applicable_benefit_codes))
       AND (cardinality(v_policy.applicable_award_types) = 0 OR w.award_type = ANY (v_policy.applicable_award_types))
       AND w.start_date <= v_period_end
       AND (w.end_date IS NULL OR w.end_date >= v_period_start)
     ORDER BY w.entered_at
     LIMIT v_limit
  LOOP
    v_eligible := v_eligible + 1;
    IF EXISTS (SELECT 1 FROM public.bn_life_certificate
                WHERE bn_award_id = v_award.id AND obligation_period = v_period) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF p_preview THEN CONTINUE; END IF;

    INSERT INTO public.bn_life_certificate
      (bn_award_id, required_for_period, due_date, status, obligation_period,
       obligation_period_start, obligation_period_end, policy_id, policy_version, policy_snapshot,
       generation_inputs, issue_date, grace_end_date, escalation_date,
       obligation_status, entered_by, correlation_id)
    VALUES
      (v_award.id, v_period, v_due, 'PENDING', v_period,
       v_period_start, v_period_end, v_policy.id, v_policy.policy_version, v_snapshot,
       jsonb_build_object('as_of', p_as_of, 'command','bn_life_certificate_generate_obligations_v1'),
       v_issue, v_grace, v_esc,
       CASE WHEN v_due <= p_as_of THEN 'DUE' ELSE 'NOT_DUE' END,
       public._bn_susp_user_code(v_actor), v_corr)
    RETURNING id INTO v_cert;

    PERFORM public._bn_lc_event(v_cert,'OBLIGATION_CREATED', NULL,
      CASE WHEN v_due <= p_as_of THEN 'DUE' ELSE 'NOT_DUE' END, v_actor, NULL, NULL, v_corr,
      p_idempotency_key, jsonb_build_object('period', v_period, 'policy_version', v_policy.policy_version));
    PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.OBLIGATION_CREATED','create', v_cert::text,
      '{}'::jsonb, jsonb_build_object('award_id', v_award.id,'period', v_period), v_corr, NULL);
    PERFORM public._bn_lc_comm(v_cert, v_award.id,'BN_LIFE_CERT_OBLIGATION_CREATED',
      jsonb_build_object('period', v_period,'due_date', v_due), v_corr,
      'lc-obl-created:'||v_cert::text);
    v_created := v_created + 1;
  END LOOP;

  DECLARE v_result jsonb;
  BEGIN
    v_result := jsonb_build_object(
      'status', CASE WHEN p_preview THEN 'PREVIEW' ELSE 'APPLIED' END,
      'policy_code', v_policy.policy_code,'policy_version', v_policy.policy_version,
      'obligation_period', v_period,'due_date', v_due,'grace_end_date', v_grace,
      'escalation_date', v_esc,'eligible', v_eligible,'created', v_created,
      'skipped_existing', v_skipped,'batch_limit', v_limit,'correlation_id', v_corr);
    IF NOT p_preview THEN
      PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_generate_obligations_v1',
                                            p_idempotency_key, v_hash, v_result, v_corr);
    END IF;
    RETURN v_result;
  END;
END $$;

-- ------------------- 2. Receipt --------------------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_receive_v1(
  p_life_certificate_id uuid,
  p_received_date date,
  p_document_id uuid,
  p_evidence_type text,
  p_issuing_authority text,
  p_certificate_date date,
  p_received_channel text,
  p_narrative text DEFAULT NULL,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_cert public.bn_life_certificate%ROWTYPE;
  v_award public.bn_award%ROWTYPE; v_doc public.bn_claim_document%ROWTYPE;
  v_corr text; v_result jsonb; v_accepted text[];
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'receive');

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||coalesce(p_received_date::text,'')||'|'||
    coalesce(p_document_id::text,'')||'|'||coalesce(p_evidence_type,'')||'|'||
    coalesce(p_certificate_date::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_receive_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id = p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;
  IF v_cert.obligation_status NOT IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE','OVERDUE','RESUBMISSION_REQUIRED','REJECTED') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001';
  END IF;
  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);

  SELECT * INTO v_award FROM public.bn_award WHERE id = v_cert.bn_award_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  IF p_document_id IS NULL THEN RAISE EXCEPTION 'E_EVIDENCE_REQUIRED' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_doc FROM public.bn_claim_document WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_EVIDENCE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_award.bn_claim_id IS NULL OR v_doc.claim_id <> v_award.bn_claim_id THEN
    RAISE EXCEPTION 'E_EVIDENCE_WRONG_CLAIMANT' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_life_certificate lc
              JOIN public.bn_award a2 ON a2.id = lc.bn_award_id
             WHERE lc.document_id = p_document_id AND lc.id <> v_cert.id) THEN
    RAISE EXCEPTION 'E_EVIDENCE_ALREADY_USED' USING ERRCODE='P0001';
  END IF;

  v_accepted := COALESCE((SELECT array_agg(x::text) FROM jsonb_array_elements_text(
    COALESCE(v_cert.policy_snapshot->'accepted_evidence_types','[]'::jsonb)) x), '{}'::text[]);
  IF cardinality(v_accepted) > 0 AND NOT (p_evidence_type = ANY (v_accepted)) THEN
    RAISE EXCEPTION 'E_EVIDENCE_TYPE_NOT_ACCEPTED' USING ERRCODE='P0001';
  END IF;
  IF p_certificate_date IS NULL OR p_certificate_date > COALESCE(p_received_date, current_date) THEN
    RAISE EXCEPTION 'E_INVALID_CERTIFICATE_DATE' USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_life_certificate SET
    submitted_date = COALESCE(p_received_date, current_date),
    document_ref = v_doc.file_name,
    document_id = p_document_id,
    evidence_type = p_evidence_type,
    evidence_checksum = md5(coalesce(v_doc.file_path,'')||coalesce(v_doc.file_size::text,'')),
    evidence_version = COALESCE(evidence_version,0) + 1,
    issuing_authority = p_issuing_authority,
    certificate_date = p_certificate_date,
    received_channel = p_received_channel,
    received_by_user_id = v_actor,
    received_at = now(),
    remarks = COALESCE(p_narrative, remarks),
    obligation_status = 'RECEIVED',
    evidence_status = 'LINKED',
    verification_status = 'NOT_STARTED',
    status = 'RECEIVED',
    row_version = row_version + 1,
    correlation_id = v_corr,
    modified_by = public._bn_susp_user_code(v_actor),
    modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'RECEIPT_RECORDED', v_cert.obligation_status,'RECEIVED',
    v_actor, NULL, p_narrative, v_corr, p_idempotency_key,
    jsonb_build_object('channel', p_received_channel,'evidence_type', p_evidence_type));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.RECEIVED','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status','RECEIVED'), v_corr, NULL);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_RECEIVED',
    jsonb_build_object('period', v_cert.obligation_period), v_corr,
    'lc-received:'||v_cert.id::text||':'||(v_cert.row_version+1)::text);

  v_result := jsonb_build_object('status','RECEIVED','life_certificate_id', v_cert.id,
    'row_version', v_cert.row_version + 1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_receive_v1',
                                        p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------- 3. Verify ----------------------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_verify_v1(
  p_life_certificate_id uuid,
  p_narrative text DEFAULT NULL,
  p_checklist jsonb DEFAULT '{}'::jsonb,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_cert public.bn_life_certificate%ROWTYPE;
  v_corr text; v_result jsonb; v_validity integer; v_mc boolean; v_authorities text[];
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'verify');

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||coalesce(p_narrative,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_verify_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id = p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;
  IF v_cert.obligation_status NOT IN ('RECEIVED','UNDER_REVIEW') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001';
  END IF;
  IF v_cert.document_id IS NULL OR v_cert.evidence_status <> 'LINKED' THEN
    RAISE EXCEPTION 'E_EVIDENCE_REQUIRED' USING ERRCODE='P0001';
  END IF;

  v_mc := COALESCE((v_cert.policy_snapshot->>'requires_maker_checker')::boolean, true);
  IF v_mc AND v_cert.received_by_user_id IS NOT NULL AND v_cert.received_by_user_id = v_actor THEN
    RAISE EXCEPTION 'E_SELF_APPROVAL_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_validity := COALESCE((v_cert.policy_snapshot->>'certificate_validity_days')::integer, 90);
  IF v_cert.certificate_date IS NULL
     OR v_cert.certificate_date < (COALESCE(v_cert.submitted_date, current_date) - v_validity) THEN
    RAISE EXCEPTION 'E_CERTIFICATE_EXPIRED' USING ERRCODE='P0001';
  END IF;

  v_authorities := COALESCE((SELECT array_agg(x::text) FROM jsonb_array_elements_text(
    COALESCE(v_cert.policy_snapshot->'accepted_issuing_authorities','[]'::jsonb)) x), '{}'::text[]);
  IF cardinality(v_authorities) > 0
     AND (v_cert.issuing_authority IS NULL OR NOT (v_cert.issuing_authority = ANY (v_authorities))) THEN
    RAISE EXCEPTION 'E_ISSUING_AUTHORITY_NOT_ACCEPTED' USING ERRCODE='P0001';
  END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);

  UPDATE public.bn_life_certificate SET
    obligation_status = 'VERIFIED', verification_status = 'VERIFIED', status = 'VERIFIED',
    verified_date = current_date, verified_by = public._bn_susp_user_code(v_actor),
    verified_by_user_id = v_actor, verification_method = COALESCE(verification_method,'MANUAL_REVIEW'),
    row_version = row_version + 1, correlation_id = v_corr,
    modified_by = public._bn_susp_user_code(v_actor), modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'VERIFIED', v_cert.obligation_status,'VERIFIED', v_actor,
    NULL, p_narrative, v_corr, p_idempotency_key, jsonb_build_object('checklist', COALESCE(p_checklist,'{}'::jsonb)));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.VERIFIED','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status','VERIFIED'), v_corr, NULL);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_VERIFIED',
    jsonb_build_object('period', v_cert.obligation_period), v_corr,
    'lc-verified:'||v_cert.id::text||':'||(v_cert.row_version+1)::text);

  v_result := jsonb_build_object('status','VERIFIED','life_certificate_id', v_cert.id,
    'row_version', v_cert.row_version + 1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_verify_v1',
                                        p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------- 4. Reject / resubmission -------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_reject_v1(
  p_life_certificate_id uuid, p_reason_code text, p_narrative text,
  p_resubmission_due_date date DEFAULT NULL,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_hash text; v_cached jsonb; v_cert public.bn_life_certificate%ROWTYPE;
        v_corr text; v_result jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'reject');
  IF p_reason_code IS NULL OR btrim(p_reason_code)='' THEN RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF p_narrative IS NULL OR btrim(p_narrative)='' THEN RAISE EXCEPTION 'E_NARRATIVE_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_reason_code WHERE reason_code = p_reason_code AND is_active) THEN
    RAISE EXCEPTION 'E_INVALID_REASON_CODE' USING ERRCODE='P0001';
  END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_reason_code||'|'||p_narrative,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_reject_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id = p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status NOT IN ('RECEIVED','UNDER_REVIEW') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001'; END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);

  UPDATE public.bn_life_certificate SET
    obligation_status='REJECTED', verification_status='REJECTED', evidence_status='REJECTED',
    status='REJECTED', rejection_reason_code=p_reason_code, rejection_narrative=p_narrative,
    resubmission_due_date=p_resubmission_due_date, row_version=row_version+1, correlation_id=v_corr,
    modified_by=public._bn_susp_user_code(v_actor), modified_at=now()
  WHERE id=v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'REJECTED', v_cert.obligation_status,'REJECTED', v_actor,
    p_reason_code, p_narrative, v_corr, p_idempotency_key,'{}'::jsonb);
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.REJECTED','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status','REJECTED'), v_corr, p_reason_code);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_REJECTED',
    jsonb_build_object('reason_code', p_reason_code), v_corr,
    'lc-rejected:'||v_cert.id::text||':'||(v_cert.row_version+1)::text);

  v_result := jsonb_build_object('status','REJECTED','life_certificate_id', v_cert.id,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_reject_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_request_resubmission_v1(
  p_life_certificate_id uuid, p_narrative text, p_resubmission_due_date date,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_hash text; v_cached jsonb; v_cert public.bn_life_certificate%ROWTYPE;
        v_corr text; v_result jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'request_resubmission');
  IF p_narrative IS NULL OR btrim(p_narrative)='' THEN RAISE EXCEPTION 'E_NARRATIVE_REQUIRED' USING ERRCODE='P0001'; END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_narrative||'|'||coalesce(p_resubmission_due_date::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_request_resubmission_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status NOT IN ('REJECTED','RECEIVED','UNDER_REVIEW') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001'; END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  UPDATE public.bn_life_certificate SET
    obligation_status='RESUBMISSION_REQUIRED', evidence_status='SUPERSEDED',
    resubmission_due_date=p_resubmission_due_date, document_id=NULL,
    row_version=row_version+1, correlation_id=v_corr,
    modified_by=public._bn_susp_user_code(v_actor), modified_at=now()
  WHERE id=v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'RESUBMISSION_REQUESTED', v_cert.obligation_status,
    'RESUBMISSION_REQUIRED', v_actor, NULL, p_narrative, v_corr, p_idempotency_key,'{}'::jsonb);
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.RESUBMISSION_REQUIRED','update', v_cert.id::text,
    '{}'::jsonb, jsonb_build_object('obligation_status','RESUBMISSION_REQUIRED'), v_corr, NULL);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_RESUBMISSION_REQUIRED',
    jsonb_build_object('due_date', p_resubmission_due_date), v_corr,
    'lc-resub:'||v_cert.id::text||':'||(v_cert.row_version+1)::text);

  v_result := jsonb_build_object('status','RESUBMISSION_REQUIRED','life_certificate_id', v_cert.id,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_request_resubmission_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------- 5. Waive / defer ---------------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_waive_v1(
  p_life_certificate_id uuid, p_reason_code text, p_narrative text,
  p_effective_from date, p_expires_on date,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_hash text; v_cached jsonb; v_cert public.bn_life_certificate%ROWTYPE;
        v_corr text; v_result jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'waive');
  IF p_reason_code IS NULL THEN RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF p_narrative IS NULL OR btrim(p_narrative)='' THEN RAISE EXCEPTION 'E_NARRATIVE_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_reason_code WHERE reason_code=p_reason_code AND is_active) THEN
    RAISE EXCEPTION 'E_INVALID_REASON_CODE' USING ERRCODE='P0001'; END IF;
  IF p_effective_from IS NULL OR p_expires_on IS NULL OR p_expires_on < p_effective_from THEN
    RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATE' USING ERRCODE='P0001'; END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_reason_code||'|'||p_narrative||'|'||p_effective_from::text||'|'||p_expires_on::text,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_waive_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status NOT IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001'; END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  UPDATE public.bn_life_certificate SET
    obligation_status='WAIVED', verification_status='WAIVED', status='WAIVED',
    waiver_reason_code=p_reason_code, waiver_narrative=p_narrative,
    waiver_effective_from=p_effective_from, waiver_expires_on=p_expires_on,
    waived_by_user_id=v_actor, row_version=row_version+1, correlation_id=v_corr,
    modified_by=public._bn_susp_user_code(v_actor), modified_at=now()
  WHERE id=v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'WAIVED', v_cert.obligation_status,'WAIVED', v_actor,
    p_reason_code, p_narrative, v_corr, p_idempotency_key,
    jsonb_build_object('effective_from', p_effective_from,'expires_on', p_expires_on));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.WAIVED','update', v_cert.id::text,'{}'::jsonb,
    jsonb_build_object('obligation_status','WAIVED'), v_corr, p_reason_code);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_WAIVER_GRANTED',
    jsonb_build_object('expires_on', p_expires_on), v_corr,
    'lc-waived:'||v_cert.id::text||':'||(v_cert.row_version+1)::text);

  v_result := jsonb_build_object('status','WAIVED','life_certificate_id', v_cert.id,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_waive_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_defer_v1(
  p_life_certificate_id uuid, p_reason_code text, p_narrative text, p_deferred_to date,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_hash text; v_cached jsonb; v_cert public.bn_life_certificate%ROWTYPE;
        v_corr text; v_result jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'defer');
  IF p_reason_code IS NULL THEN RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF p_narrative IS NULL OR btrim(p_narrative)='' THEN RAISE EXCEPTION 'E_NARRATIVE_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF p_deferred_to IS NULL OR p_deferred_to <= current_date THEN
    RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATE' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_reason_code WHERE reason_code=p_reason_code AND is_active) THEN
    RAISE EXCEPTION 'E_INVALID_REASON_CODE' USING ERRCODE='P0001'; END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_reason_code||'|'||p_deferred_to::text,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_defer_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status NOT IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001'; END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  UPDATE public.bn_life_certificate SET
    obligation_status='DEFERRED', verification_status='DEFERRED', status='PENDING',
    deferred_to_date=p_deferred_to, due_date=p_deferred_to,
    grace_end_date=p_deferred_to + COALESCE((policy_snapshot->>'grace_days')::int,30),
    escalation_date=p_deferred_to + COALESCE((policy_snapshot->>'grace_days')::int,30)
                     + COALESCE((policy_snapshot->>'escalation_offset_days')::int,15),
    row_version=row_version+1, correlation_id=v_corr,
    modified_by=public._bn_susp_user_code(v_actor), modified_at=now()
  WHERE id=v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'DEFERRED', v_cert.obligation_status,'DEFERRED', v_actor,
    p_reason_code, p_narrative, v_corr, p_idempotency_key, jsonb_build_object('deferred_to', p_deferred_to));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.DEFERRED','update', v_cert.id::text,'{}'::jsonb,
    jsonb_build_object('obligation_status','DEFERRED'), v_corr, p_reason_code);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_DEFERRAL_GRANTED',
    jsonb_build_object('deferred_to', p_deferred_to), v_corr,
    'lc-deferred:'||v_cert.id::text||':'||(v_cert.row_version+1)::text);

  v_result := jsonb_build_object('status','DEFERRED','life_certificate_id', v_cert.id,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_defer_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------- 6. Scheduler milestones --------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_due_for_milestone_v1(
  p_as_of date DEFAULT current_date, p_limit integer DEFAULT 200)
RETURNS TABLE (life_certificate_id uuid, bn_award_id uuid, obligation_status text,
               due_date date, grace_end_date date, escalation_date date, milestone text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT lc.id, lc.bn_award_id, lc.obligation_status, lc.due_date, lc.grace_end_date, lc.escalation_date,
         CASE
           WHEN lc.obligation_status IN ('DUE','REMINDER_SENT') AND lc.grace_end_date IS NOT NULL
                AND p_as_of > lc.due_date AND p_as_of <= lc.grace_end_date THEN 'GRACE'
           WHEN lc.obligation_status IN ('DUE','REMINDER_SENT','GRACE') AND lc.grace_end_date IS NOT NULL
                AND p_as_of > lc.grace_end_date THEN 'OVERDUE'
           WHEN lc.obligation_status = 'NOT_DUE' AND p_as_of >= lc.due_date THEN 'DUE'
           ELSE 'REMINDER'
         END AS milestone
    FROM public.bn_life_certificate lc
   WHERE lc.obligation_status IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE')
     AND lc.due_date IS NOT NULL
     AND (p_as_of >= lc.due_date - 14)
   ORDER BY lc.due_date
   LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),1000);
$$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_mark_milestone_v1(
  p_life_certificate_id uuid, p_milestone text,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL,
  p_as_of date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_cert public.bn_life_certificate%ROWTYPE;
        v_to text; v_corr text; v_hash text; v_cached jsonb; v_result jsonb; v_event text;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  -- Callable by the authorised scheduler identity (service_role, no auth.uid())
  -- or by a user holding the send_reminder / escalate permission.
  IF v_actor IS NOT NULL THEN
    IF p_milestone = 'REMINDER' THEN PERFORM public._bn_lc_require(v_actor,'send_reminder');
    ELSE PERFORM public._bn_lc_require(v_actor,'escalate'); END IF;
  ELSIF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  IF p_milestone NOT IN ('DUE','REMINDER','GRACE','OVERDUE') THEN
    RAISE EXCEPTION 'E_INVALID_MILESTONE' USING ERRCODE='P0001'; END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_milestone||'|'||p_as_of::text,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_mark_milestone_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status NOT IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE') THEN
    RETURN jsonb_build_object('status','NO_OP','reason','TERMINAL_STATE',
                              'obligation_status', v_cert.obligation_status);
  END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  v_to := CASE p_milestone WHEN 'DUE' THEN 'DUE' WHEN 'REMINDER' THEN 'REMINDER_SENT'
                           WHEN 'GRACE' THEN 'GRACE' ELSE 'OVERDUE' END;
  v_event := CASE p_milestone
    WHEN 'DUE' THEN 'BN_LIFE_CERT_DUE'
    WHEN 'REMINDER' THEN CASE WHEN v_cert.reminder_count >= 1 THEN 'BN_LIFE_CERT_FINAL_REMINDER'
                              ELSE 'BN_LIFE_CERT_FIRST_REMINDER' END
    WHEN 'GRACE' THEN 'BN_LIFE_CERT_GRACE_STARTED'
    ELSE 'BN_LIFE_CERT_OVERDUE' END;

  UPDATE public.bn_life_certificate SET
    obligation_status = v_to,
    status = CASE WHEN v_to='OVERDUE' THEN 'OVERDUE' ELSE status END,
    escalation_status = CASE WHEN v_to='OVERDUE' THEN 'PENDING' ELSE escalation_status END,
    reminder_count = CASE WHEN p_milestone='REMINDER' THEN reminder_count+1 ELSE reminder_count END,
    last_reminder_at = CASE WHEN p_milestone='REMINDER' THEN now() ELSE last_reminder_at END,
    row_version = row_version + 1, correlation_id = v_corr, modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'MILESTONE_'||p_milestone, v_cert.obligation_status, v_to,
    v_actor, NULL, NULL, v_corr, p_idempotency_key, jsonb_build_object('as_of', p_as_of));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.MILESTONE','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status', v_to), v_corr, p_milestone);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id, v_event,
    jsonb_build_object('milestone', p_milestone,'as_of', p_as_of), v_corr,
    'lc-milestone:'||v_cert.id::text||':'||p_milestone||':'||p_as_of::text);

  v_result := jsonb_build_object('status','APPLIED','life_certificate_id', v_cert.id,
    'obligation_status', v_to,'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_mark_milestone_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------- 7. Escalate to suspension ------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_escalate_to_suspension_v1(
  p_life_certificate_id uuid, p_narrative text,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_cert public.bn_life_certificate%ROWTYPE; v_award public.bn_award%ROWTYPE;
        v_corr text; v_hash text; v_cached jsonb; v_susp jsonb; v_susp_id uuid; v_reason text; v_result jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'propose_suspension');
  IF p_narrative IS NULL OR btrim(p_narrative)='' THEN RAISE EXCEPTION 'E_NARRATIVE_REQUIRED' USING ERRCODE='P0001'; END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_narrative,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_escalate_to_suspension_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status <> 'OVERDUE' THEN RAISE EXCEPTION 'E_NOT_OVERDUE' USING ERRCODE='P0001'; END IF;
  IF v_cert.verification_status IN ('VERIFIED','WAIVED','DEFERRED') THEN
    RAISE EXCEPTION 'E_NOT_ESCALATABLE' USING ERRCODE='P0001'; END IF;
  IF v_cert.escalation_date IS NOT NULL AND current_date < v_cert.escalation_date THEN
    RAISE EXCEPTION 'E_NOT_DUE' USING ERRCODE='P0001'; END IF;
  IF v_cert.suspension_event_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','ALREADY_ESCALATED','suspension_id', v_cert.suspension_event_id,
                              'life_certificate_id', v_cert.id);
  END IF;

  SELECT * INTO v_award FROM public.bn_award WHERE id = v_cert.bn_award_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_award.status <> 'ACTIVE' THEN RAISE EXCEPTION 'E_AWARD_NOT_ELIGIBLE' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.bn_award_suspension_event
              WHERE bn_award_id = v_award.id AND case_kind='SUSPENSION'
                AND status IN ('PROPOSED','APPROVED','EXECUTION_FAILED','ACTIVE')) THEN
    RAISE EXCEPTION 'E_CONFLICTING_OPEN_CASE' USING ERRCODE='P0001'; END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  v_reason := COALESCE(v_cert.policy_snapshot->>'suspension_reason_code','LIFE_CERT_OVERDUE');

  -- Delegates to the authoritative Award Suspension boundary. Maker-checker,
  -- workflow and execution remain owned by Award Suspension.
  v_susp := public.bn_award_suspension_propose_v1(
    v_award.id, v_reason, GREATEST(current_date, v_cert.escalation_date), p_narrative,
    'lc-escalate:'||v_cert.id::text, v_corr);
  v_susp_id := NULLIF(v_susp->>'suspension_id','')::uuid;

  UPDATE public.bn_life_certificate SET
    suspension_event_id = v_susp_id, escalation_status='SUSPENSION_PROPOSED',
    row_version = row_version + 1, correlation_id = v_corr, modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'SUSPENSION_PROPOSAL_CREATED','OVERDUE','OVERDUE', v_actor,
    v_reason, p_narrative, v_corr, p_idempotency_key, jsonb_build_object('suspension_id', v_susp_id));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.SUSPENSION_PROPOSED','create', v_cert.id::text,
    '{}'::jsonb, jsonb_build_object('suspension_id', v_susp_id,'reason_code', v_reason), v_corr, v_reason);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_SUSPENSION_PROPOSED',
    jsonb_build_object('suspension_id', v_susp_id), v_corr,'lc-susp-proposed:'||v_cert.id::text);

  v_result := jsonb_build_object('status','SUSPENSION_PROPOSED','life_certificate_id', v_cert.id,
    'suspension_id', v_susp_id,'suspension_result', v_susp,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_escalate_to_suspension_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------- 8. Propose reinstatement -------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_propose_reinstatement_v1(
  p_life_certificate_id uuid, p_narrative text, p_effective_from date DEFAULT NULL,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_cert public.bn_life_certificate%ROWTYPE; v_award public.bn_award%ROWTYPE;
        v_susp public.bn_award_suspension_event%ROWTYPE; v_corr text; v_hash text; v_cached jsonb;
        v_res jsonb; v_reinst_id uuid; v_reason text; v_result jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'propose_reinstatement');
  IF p_narrative IS NULL OR btrim(p_narrative)='' THEN RAISE EXCEPTION 'E_NARRATIVE_REQUIRED' USING ERRCODE='P0001'; END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_narrative,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_propose_reinstatement_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001'; END IF;
  IF v_cert.verification_status <> 'VERIFIED' THEN RAISE EXCEPTION 'E_NOT_VERIFIED' USING ERRCODE='P0001'; END IF;
  IF v_cert.reinstatement_event_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','ALREADY_PROPOSED','reinstatement_id', v_cert.reinstatement_event_id,
                              'life_certificate_id', v_cert.id);
  END IF;

  SELECT * INTO v_award FROM public.bn_award WHERE id = v_cert.bn_award_id;
  IF v_award.status <> 'SUSPENDED' THEN RAISE EXCEPTION 'E_AWARD_NOT_SUSPENDED' USING ERRCODE='P0001'; END IF;

  IF v_cert.suspension_event_id IS NOT NULL THEN
    SELECT * INTO v_susp FROM public.bn_award_suspension_event WHERE id = v_cert.suspension_event_id;
  ELSE
    SELECT * INTO v_susp FROM public.bn_award_suspension_event
     WHERE bn_award_id = v_award.id AND case_kind='SUSPENSION' AND status='ACTIVE'
     ORDER BY entered_at DESC LIMIT 1;
  END IF;
  IF v_susp.id IS NULL THEN RAISE EXCEPTION 'E_NO_ACTIVE_SUSPENSION' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.bn_award_suspension_event
              WHERE bn_award_id = v_award.id AND case_kind='REINSTATEMENT'
                AND status IN ('REINSTATEMENT_PROPOSED','REINSTATEMENT_APPROVED','EXECUTION_FAILED')) THEN
    RAISE EXCEPTION 'E_CONFLICTING_OPEN_CASE' USING ERRCODE='P0001'; END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  v_reason := COALESCE(v_cert.policy_snapshot->>'reinstatement_reason_code','LIFE_CERT_EVIDENCE_RECEIVED');

  v_res := public.bn_award_reinstatement_propose_v1(
    v_susp.id, v_reason, COALESCE(p_effective_from, current_date), p_narrative,
    'lc-reinstate:'||v_cert.id::text, v_corr);
  v_reinst_id := COALESCE(NULLIF(v_res->>'reinstatement_id',''), NULLIF(v_res->>'suspension_id',''))::uuid;

  UPDATE public.bn_life_certificate SET
    reinstatement_event_id = v_reinst_id, escalation_status='REINSTATEMENT_PROPOSED',
    row_version = row_version + 1, correlation_id = v_corr, modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'REINSTATEMENT_PROPOSAL_CREATED','VERIFIED','VERIFIED', v_actor,
    v_reason, p_narrative, v_corr, p_idempotency_key,
    jsonb_build_object('reinstatement_id', v_reinst_id,'evidence_document_id', v_cert.document_id));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.REINSTATEMENT_PROPOSED','create', v_cert.id::text,
    '{}'::jsonb, jsonb_build_object('reinstatement_id', v_reinst_id), v_corr, v_reason);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_REINSTATEMENT_PROPOSED',
    jsonb_build_object('reinstatement_id', v_reinst_id), v_corr,'lc-reinst-proposed:'||v_cert.id::text);

  v_result := jsonb_build_object('status','REINSTATEMENT_PROPOSED','life_certificate_id', v_cert.id,
    'reinstatement_id', v_reinst_id,'reinstatement_result', v_res,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_propose_reinstatement_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------- 9. Query boundary --------------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_worklist_v1(
  p_bucket text DEFAULT 'ALL', p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_limit integer := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
        v_rows jsonb; v_total bigint; v_search text := NULLIF(btrim(COALESCE(p_search,'')),'');
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');

  WITH base AS (
    SELECT lc.*, a.award_number, a.ssn, a.benefit_code, a.status AS award_status
      FROM public.bn_life_certificate lc
      JOIN public.bn_award a ON a.id = lc.bn_award_id
     WHERE (p_bucket = 'ALL'
        OR (p_bucket='DUE' AND lc.obligation_status IN ('DUE','REMINDER_SENT'))
        OR (p_bucket='GRACE' AND lc.obligation_status='GRACE')
        OR (p_bucket='OVERDUE' AND lc.obligation_status='OVERDUE')
        OR (p_bucket='AWAITING_REVIEW' AND lc.obligation_status IN ('RECEIVED','UNDER_REVIEW'))
        OR (p_bucket='REJECTED' AND lc.obligation_status IN ('REJECTED','RESUBMISSION_REQUIRED'))
        OR (p_bucket='VERIFIED' AND lc.obligation_status='VERIFIED')
        OR (p_bucket='WAIVED_DEFERRED' AND lc.obligation_status IN ('WAIVED','DEFERRED'))
        OR (p_bucket='SUSPENSIONS' AND lc.suspension_event_id IS NOT NULL)
        OR (p_bucket='REINSTATEMENTS' AND lc.reinstatement_event_id IS NOT NULL))
       AND (v_search IS NULL OR a.ssn ILIKE '%'||v_search||'%'
            OR COALESCE(a.award_number,'') ILIKE '%'||v_search||'%')
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb), (SELECT count(*) FROM base)
    INTO v_rows, v_total
  FROM (
    SELECT b.id, b.bn_award_id, b.award_number, b.ssn, b.benefit_code, b.award_status,
           b.obligation_period, b.due_date, b.grace_end_date, b.escalation_date,
           b.obligation_status, b.evidence_status, b.verification_status,
           b.escalation_status, b.communication_status, b.reminder_count,
           b.suspension_event_id, b.reinstatement_event_id, b.row_version
      FROM base b
     ORDER BY b.due_date
     LIMIT v_limit OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) t;

  RETURN jsonb_build_object('rows', v_rows,'total', v_total,'limit', v_limit,'offset', COALESCE(p_offset,0));
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_detail_v1(p_life_certificate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_can_evidence boolean; v_can_conf boolean; v_out jsonb;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  v_can_evidence := public.has_permission(v_actor,'bn_life_certificate','view_evidence') OR public.is_admin(v_actor);
  v_can_conf := public.has_permission(v_actor,'bn_life_certificate','view_confidential_evidence') OR public.is_admin(v_actor);

  SELECT jsonb_build_object(
    'obligation', to_jsonb(lc) - 'document_ref' - 'evidence_checksum' - 'remarks'
      || jsonb_build_object(
           'evidence', CASE WHEN NOT v_can_evidence THEN NULL
             WHEN lc.evidence_is_confidential AND NOT v_can_conf THEN
               jsonb_build_object('masked', true,'evidence_type', lc.evidence_type)
             ELSE jsonb_build_object('masked', false,'document_id', lc.document_id,
                    'document_name', lc.document_ref,'evidence_type', lc.evidence_type,
                    'evidence_version', lc.evidence_version,'checksum', lc.evidence_checksum,
                    'issuing_authority', lc.issuing_authority,'certificate_date', lc.certificate_date)
           END),
    'award', jsonb_build_object('id', a.id,'award_number', a.award_number,'ssn', a.ssn,
             'benefit_code', a.benefit_code,'status', a.status,'start_date', a.start_date),
    'suspension', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', s.id,'status', s.status,'execution_status', s.execution_status,
        'suspended_from', s.suspended_from,'reason_code', s.reason_code) END,
    'reinstatement', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', r.id,'status', r.status,'execution_status', r.execution_status,
        'suspended_from', r.suspended_from,'reason_code', r.reason_code) END
  ) INTO v_out
  FROM public.bn_life_certificate lc
  JOIN public.bn_award a ON a.id = lc.bn_award_id
  LEFT JOIN public.bn_award_suspension_event s ON s.id = lc.suspension_event_id
  LEFT JOIN public.bn_award_suspension_event r ON r.id = lc.reinstatement_event_id
  WHERE lc.id = p_life_certificate_id;

  IF v_out IS NULL THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_timeline_v1(
  p_life_certificate_id uuid, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_events jsonb; v_comms jsonb;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id,'event_type', e.event_type,'from_state', e.from_state,'to_state', e.to_state,
      'actor_user_code', e.actor_user_code,'reason_code', e.reason_code,'narrative', e.narrative,
      'correlation_id', e.correlation_id,'created_at', e.created_at) ORDER BY e.created_at DESC),'[]'::jsonb)
    INTO v_events
  FROM (SELECT * FROM public.bn_life_certificate_event
         WHERE life_certificate_id = p_life_certificate_id
         ORDER BY created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),500)) e;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,'event_code', c.event_code,'delivery_status', c.delivery_status,
      'attempts', c.attempts,'last_error_code', c.last_error_code,
      'created_at', c.created_at) ORDER BY c.created_at DESC),'[]'::jsonb)
    INTO v_comms
  FROM public.bn_life_certificate_communication_intent c
  WHERE c.life_certificate_id = p_life_certificate_id;

  RETURN jsonb_build_object('events', v_events,'communications', v_comms);
END $$;

-- ------------------- 10. Grants ---------------------------------------
REVOKE ALL ON FUNCTION public._bn_lc_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_assert_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_require(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_audit(uuid,text,text,text,jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_event(uuid,text,text,text,uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_comm(uuid,uuid,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'bn_life_certificate_generate_obligations_v1(text,date,integer,boolean,text,text)',
    'bn_life_certificate_receive_v1(uuid,date,uuid,text,text,date,text,text,integer,text,text)',
    'bn_life_certificate_verify_v1(uuid,text,jsonb,integer,text,text)',
    'bn_life_certificate_reject_v1(uuid,text,text,date,integer,text,text)',
    'bn_life_certificate_request_resubmission_v1(uuid,text,date,integer,text,text)',
    'bn_life_certificate_waive_v1(uuid,text,text,date,date,integer,text,text)',
    'bn_life_certificate_defer_v1(uuid,text,text,date,integer,text,text)',
    'bn_life_certificate_mark_milestone_v1(uuid,text,text,text,date)',
    'bn_life_certificate_escalate_to_suspension_v1(uuid,text,integer,text,text)',
    'bn_life_certificate_propose_reinstatement_v1(uuid,text,date,integer,text,text)',
    'bn_life_certificate_worklist_v1(text,text,integer,integer)',
    'bn_life_certificate_detail_v1(uuid)',
    'bn_life_certificate_timeline_v1(uuid,integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;

  EXECUTE 'REVOKE ALL ON FUNCTION public.bn_life_certificate_due_for_milestone_v1(date,integer) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.bn_life_certificate_due_for_milestone_v1(date,integer) TO service_role';
END $$;
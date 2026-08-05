-- =====================================================================
-- BN Medical Reviews — corrections + secured read boundary
-- =====================================================================

-- ---------------------------------------------------------------------
-- Corrections: claimant identity comes from bn_claim (no person_id column)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._bn_mr_conflict_check(uuid, uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public._bn_mr_conflict_check(
  p_provider uuid, p_claim uuid, p_award uuid, p_person_ref text, p_employer_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; r record;
BEGIN
  SELECT COALESCE(conflict_restrictions, '{}'::jsonb) INTO v
    FROM public.bn_medical_provider WHERE id = p_provider;
  IF v IS NULL THEN RETURN jsonb_build_object('conflict', false, 'checked_at', now()); END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('excluded_claim_ids',      'EXCLUDED_CLAIM',        p_claim::text),
      ('excluded_award_ids',      'EXCLUDED_AWARD',        p_award::text),
      ('excluded_person_ids',     'EXCLUDED_PERSON',       p_person_ref),
      ('excluded_employer_ids',   'EXCLUDED_EMPLOYER',     p_employer_ref),
      ('excluded_relationships',  'EXCLUDED_RELATIONSHIP', p_person_ref)
    ) AS t(key, rule, val)
  LOOP
    IF r.val IS NOT NULL AND jsonb_typeof(v -> r.key) = 'array' AND (v -> r.key) ? r.val THEN
      RETURN jsonb_build_object('conflict', true, 'rule', r.rule,
                                'matched_value', r.val, 'checked_at', now());
    END IF;
  END LOOP;

  RETURN jsonb_build_object('conflict', false, 'checked_at', now());
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_mask_ssn(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_value IS NULL OR length(btrim(p_value)) = 0 THEN NULL
              WHEN length(btrim(p_value)) <= 4 THEN '****'
              ELSE '****' || right(btrim(p_value), 4) END
$$;

CREATE OR REPLACE FUNCTION public._bn_mr_search_term(p_term text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text := btrim(COALESCE(p_term, ''));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF length(v) < 3 THEN RAISE EXCEPTION 'E_SEARCH_TERM_TOO_SHORT' USING ERRCODE='P0001'; END IF;
  v := replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_');
  RETURN '%' || v || '%';
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_page(p_limit integer, p_max integer DEFAULT 100)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(GREATEST(COALESCE(p_limit, 25), 1), COALESCE(p_max, 100))
$$;

-- Rebuild referral creation against real claim columns.
CREATE OR REPLACE FUNCTION public._bn_mr_create_referral(
  p_actor uuid, p_obligation uuid, p_provider uuid, p_purpose text,
  p_parent uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ob record; snap jsonb; v_id uuid; v_ref text; v_conflict jsonb; v_acct uuid;
  v_tz text; v_today date; v_person_ref text; v_employer_ref text; v_group text;
BEGIN
  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation FOR UPDATE;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  IF public._bn_mr_terminal('OBLIGATION', ob.status) THEN
    RAISE EXCEPTION 'E_STATE_TERMINAL:OBLIGATION:%', ob.status USING ERRCODE='P0001';
  END IF;

  snap := COALESCE(ob.policy_snapshot, '{}'::jsonb);
  v_tz := COALESCE(snap ->> 'timezone_code', 'UTC');
  v_today := public._bn_mr_today(v_tz);
  v_group := CASE WHEN p_purpose = 'SECOND_OPINION' THEN 'SECOND_OPINION' ELSE 'PRIMARY' END;

  IF p_purpose = 'SECOND_OPINION'
     AND COALESCE(snap ->> 'second_opinion_mode','NOT_PERMITTED') = 'NOT_PERMITTED' THEN
    RAISE EXCEPTION 'E_SECOND_OPINION_NOT_PERMITTED' USING ERRCODE='P0001';
  END IF;

  SELECT c.ssn, c.employer_regno INTO v_person_ref, v_employer_ref
    FROM public.bn_claim c WHERE c.id = ob.bn_claim_id;

  IF p_provider IS NOT NULL THEN
    PERFORM public._bn_mr_assert_provider_eligible(
      p_provider, ob.bn_product_id, ob.review_type,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(snap -> 'required_specialties','[]'::jsonb))),
      v_today, ob.bn_claim_id);
    v_conflict := public._bn_mr_conflict_check(p_provider, ob.bn_claim_id, ob.bn_award_id,
                                               v_person_ref, v_employer_ref);
    IF COALESCE((v_conflict ->> 'conflict')::boolean, false) THEN
      RAISE EXCEPTION 'E_PROVIDER_CONFLICT_RESTRICTED:%', COALESCE(v_conflict ->> 'rule','UNKNOWN')
        USING ERRCODE='P0001';
    END IF;
    v_acct := public._bn_mr_accountable_practitioner(p_provider);
  ELSE
    v_conflict := jsonb_build_object('conflict', false, 'checked_at', now());
  END IF;

  v_ref := public._bn_mr_reference('MRR');

  INSERT INTO public.bn_medical_review_referral
    (obligation_id, referral_reference, provider_id, provider_snapshot, bn_claim_id, bn_award_id,
     referring_officer, evidence_release_scope, appointment_responsibility,
     acceptance_deadline, report_deadline, consent_status, status, referral_purpose,
     concurrency_group, parent_referral_id, conflict_check, accountable_practitioner_id,
     correlation_id, created_by, updated_by)
  VALUES
    (p_obligation, v_ref, p_provider,
     CASE WHEN p_provider IS NULL THEN NULL ELSE public._bn_mr_provider_snapshot(p_provider) END,
     ob.bn_claim_id, ob.bn_award_id, p_actor,
     CASE WHEN COALESCE(snap ->> 'assessment_model','') = 'DOCUMENT_ONLY'
          THEN 'CASE_EVIDENCE' ELSE 'FUNCTIONAL_SUMMARY_ONLY' END,
     COALESCE(snap ->> 'appointment_responsibility','NOT_APPLICABLE'),
     public._bn_mr_add_days(v_today, COALESCE((snap ->> 'referral_acceptance_deadline_days')::int, 7),
                            COALESCE((snap ->> 'business_days_only')::boolean, false)),
     public._bn_mr_add_days(v_today, COALESCE((snap ->> 'report_deadline_days')::int, 30),
                            COALESCE((snap ->> 'business_days_only')::boolean, false)),
     'NOT_REQUIRED',
     CASE WHEN p_provider IS NULL THEN 'PROVIDER_SELECTION_REQUIRED' ELSE 'PROVIDER_ASSIGNED' END,
     p_purpose, v_group, p_parent, v_conflict, v_acct, ob.correlation_id, p_actor, p_actor)
  RETURNING id INTO v_id;

  IF ob.status IN ('NOT_DUE','NOTICE_READY','NOTICE_SENT','DUE') THEN
    UPDATE public.bn_medical_review_obligation
       SET status = 'IN_PROGRESS', row_version = row_version + 1, updated_at = now(), updated_by = p_actor
     WHERE id = p_obligation AND public._bn_mr_transition_allowed('OBLIGATION', status, 'IN_PROGRESS');
  END IF;

  PERFORM public._bn_mr_event(p_obligation,'REFERRAL',v_id,'BN_MR_REFERRAL_CREATED',
    NULL, CASE WHEN p_provider IS NULL THEN 'PROVIDER_SELECTION_REQUIRED' ELSE 'PROVIDER_ASSIGNED' END,
    p_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('referral_reference', v_ref, 'provider_id', p_provider)),
    ob.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_REFERRAL_CREATED', p_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('referral_reference', v_ref, 'provider_id', p_provider,
                       'purpose', p_purpose, 'conflict_check', v_conflict),
    p_reason, ob.correlation_id, 'USER_RPC');

  RETURN jsonb_build_object('status','OK','referral_id',v_id,'referral_reference',v_ref,
                            'referral_status', CASE WHEN p_provider IS NULL
                              THEN 'PROVIDER_SELECTION_REQUIRED' ELSE 'PROVIDER_ASSIGNED' END,
                            'conflict_check', v_conflict);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_verify_nominated_provider_v1(
  p_referral_id uuid, p_expected_row_version integer, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('verify_credentials');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id);
  v_cached jsonb; rf record; ob record; snap jsonb; v_conflict jsonb; v_resp jsonb; v_acct uuid;
  v_person_ref text; v_employer_ref text;
BEGIN
  v_cached := public._bn_mr_cmd_begin('VERIFY_NOMINATED_PROVIDER', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(v_actor, rf.obligation_id);
  PERFORM public._bn_mr_check_version(rf.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('REFERRAL', rf.status, 'PROVIDER_ASSIGNED');
  IF rf.provider_id IS NULL THEN RAISE EXCEPTION 'E_NOT_FOUND:provider' USING ERRCODE='P0001'; END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = rf.obligation_id;
  snap := COALESCE(ob.policy_snapshot, '{}'::jsonb);
  SELECT c.ssn, c.employer_regno INTO v_person_ref, v_employer_ref
    FROM public.bn_claim c WHERE c.id = ob.bn_claim_id;

  PERFORM public._bn_mr_assert_provider_eligible(
    rf.provider_id, ob.bn_product_id, ob.review_type,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(snap -> 'required_specialties','[]'::jsonb))),
    public._bn_mr_today(COALESCE(snap ->> 'timezone_code','UTC')), ob.bn_claim_id);

  v_conflict := public._bn_mr_conflict_check(rf.provider_id, ob.bn_claim_id, ob.bn_award_id,
                                             v_person_ref, v_employer_ref);
  IF COALESCE((v_conflict ->> 'conflict')::boolean, false) THEN
    RAISE EXCEPTION 'E_PROVIDER_CONFLICT_RESTRICTED:%', v_conflict ->> 'rule' USING ERRCODE='P0001';
  END IF;
  v_acct := public._bn_mr_accountable_practitioner(rf.provider_id);

  UPDATE public.bn_medical_review_referral
     SET status='PROVIDER_ASSIGNED', provider_snapshot = public._bn_mr_provider_snapshot(rf.provider_id),
         conflict_check = v_conflict, accountable_practitioner_id = v_acct,
         row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE id = p_referral_id;

  PERFORM public._bn_mr_event(rf.obligation_id,'REFERRAL',p_referral_id,'BN_MR_PROVIDER_VERIFIED',
    rf.status,'PROVIDER_ASSIGNED',v_actor,'BENEFITS_OFFICER','{}'::jsonb, rf.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_PROVIDER_VERIFIED', v_actor, p_referral_id, 'VERIFY',
    jsonb_build_object('status', rf.status),
    jsonb_build_object('status','PROVIDER_ASSIGNED','conflict_check', v_conflict),
    p_reason, rf.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','referral_id',p_referral_id,
                               'referral_status','PROVIDER_ASSIGNED','row_version', rf.row_version+1);
  RETURN public._bn_mr_cmd_finish('VERIFY_NOMINATED_PROVIDER', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_reassign_provider_v1(
  p_referral_id uuid, p_provider_id uuid, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('assign_provider');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id, 'provider', p_provider_id);
  v_cached jsonb; rf record; ob record; snap jsonb; v_conflict jsonb; v_resp jsonb; v_acct uuid;
  v_person_ref text; v_employer_ref text;
BEGIN
  v_cached := public._bn_mr_cmd_begin('REASSIGN_PROVIDER', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(v_actor, rf.obligation_id);
  PERFORM public._bn_mr_check_version(rf.row_version, p_expected_row_version);

  IF rf.status IN ('DECLINED','EXPIRED') THEN
    UPDATE public.bn_medical_review_referral SET status='REASSIGNMENT_REQUIRED',
           row_version = row_version + 1, updated_at = now(), updated_by = v_actor
     WHERE id = p_referral_id;
    rf.status := 'REASSIGNMENT_REQUIRED'; rf.row_version := rf.row_version + 1;
  END IF;
  PERFORM public._bn_mr_assert_transition('REFERRAL', rf.status, 'PROVIDER_ASSIGNED');

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = rf.obligation_id;
  snap := COALESCE(ob.policy_snapshot, '{}'::jsonb);
  SELECT c.ssn, c.employer_regno INTO v_person_ref, v_employer_ref
    FROM public.bn_claim c WHERE c.id = ob.bn_claim_id;

  PERFORM public._bn_mr_assert_provider_eligible(
    p_provider_id, ob.bn_product_id, ob.review_type,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(snap -> 'required_specialties','[]'::jsonb))),
    public._bn_mr_today(COALESCE(snap ->> 'timezone_code','UTC')), ob.bn_claim_id);
  v_conflict := public._bn_mr_conflict_check(p_provider_id, ob.bn_claim_id, ob.bn_award_id,
                                             v_person_ref, v_employer_ref);
  IF COALESCE((v_conflict ->> 'conflict')::boolean, false) THEN
    RAISE EXCEPTION 'E_PROVIDER_CONFLICT_RESTRICTED:%', v_conflict ->> 'rule' USING ERRCODE='P0001';
  END IF;
  v_acct := public._bn_mr_accountable_practitioner(p_provider_id);

  UPDATE public.bn_medical_review_referral
     SET provider_id = p_provider_id, provider_snapshot = public._bn_mr_provider_snapshot(p_provider_id),
         conflict_check = v_conflict, accountable_practitioner_id = v_acct,
         status = 'PROVIDER_ASSIGNED', responded_at = NULL, decline_reason = NULL,
         row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE id = p_referral_id;

  PERFORM public._bn_mr_event(rf.obligation_id,'REFERRAL',p_referral_id,'BN_MR_PROVIDER_REASSIGNED',
    rf.status,'PROVIDER_ASSIGNED',v_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('provider_id', p_provider_id)), rf.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_PROVIDER_REASSIGNED', v_actor, p_referral_id, 'REASSIGN',
    jsonb_build_object('status', rf.status, 'provider_id', rf.provider_id),
    jsonb_build_object('status','PROVIDER_ASSIGNED','provider_id', p_provider_id),
    p_reason, rf.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','referral_id',p_referral_id,
                               'referral_status','PROVIDER_ASSIGNED','row_version', rf.row_version + 1);
  RETURN public._bn_mr_cmd_finish('REASSIGN_PROVIDER', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- =====================================================================
-- SECURED READS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bn_medical_review_worklist_v1(
  p_award_id uuid DEFAULT NULL, p_status text DEFAULT NULL, p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_term text := public._bn_mr_search_term(p_search);
  v_rows jsonb; v_total bigint;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');

  IF p_award_id IS NOT NULL AND NOT public._bn_mr_can_access_award(v_actor, p_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  WITH scoped AS (
    SELECT o.* FROM public.bn_medical_review_obligation o
     WHERE (p_award_id IS NULL OR o.bn_award_id = p_award_id)
       AND (p_status IS NULL OR o.status = p_status)
       AND (v_term IS NULL OR o.obligation_reference ILIKE v_term)
       AND public._bn_mr_can_access(v_actor, o.id)
  )
  SELECT count(*), COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (
      SELECT s.id AS obligation_id, s.obligation_reference, s.bn_award_id, s.bn_claim_id,
             s.review_type, s.review_reason, s.status, s.due_date, s.grace_end_date,
             s.deferred_until, s.risk_classification, s.communication_status, s.row_version,
             a.award_number, c.claim_number, public._bn_mr_mask_ssn(c.ssn) AS masked_ssn
        FROM scoped s
        LEFT JOIN public.bn_award a ON a.id = s.bn_award_id
        LEFT JOIN public.bn_claim c ON c.id = s.bn_claim_id
       ORDER BY s.due_date
       LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_award_context_v1(p_award_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); aw record; c record;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  IF p_award_id IS NULL THEN RAISE EXCEPTION 'E_AWARD_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF NOT public._bn_mr_can_access_award(v_actor, p_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO aw FROM public.bn_award WHERE id = p_award_id;
  PERFORM public._bn_mr_require_record(aw.id, 'award');
  SELECT * INTO c FROM public.bn_claim WHERE id = aw.bn_claim_id;

  RETURN jsonb_build_object('status','OK',
    'bn_award_id', aw.id, 'award_number', aw.award_number, 'award_status', aw.status,
    'benefit_code', aw.benefit_code, 'start_date', aw.start_date, 'end_date', aw.end_date,
    'next_review_date', aw.next_review_date,
    'bn_claim_id', aw.bn_claim_id, 'claim_number', c.claim_number,
    'masked_ssn', public._bn_mr_mask_ssn(aw.ssn),
    'open_reviews', (SELECT count(*) FROM public.bn_medical_review_obligation o
                      WHERE o.bn_award_id = p_award_id AND o.status NOT IN ('COMPLETED','CLOSED')));
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_detail_v1(p_obligation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); ob record; v_summary boolean;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);
  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');

  v_summary := public._bn_mr_require_ok(v_actor, 'view_medical_summary');

  RETURN jsonb_build_object('status','OK',
    'obligation_id', ob.id, 'obligation_reference', ob.obligation_reference,
    'bn_award_id', ob.bn_award_id, 'bn_claim_id', ob.bn_claim_id,
    'review_type', ob.review_type, 'review_reason', ob.review_reason,
    'obligation_status', ob.status, 'due_date', ob.due_date,
    'notice_due_date', ob.notice_due_date, 'grace_end_date', ob.grace_end_date,
    'deferred_until', ob.deferred_until, 'risk_classification', ob.risk_classification,
    'communication_status', ob.communication_status, 'row_version', ob.row_version,
    'policy', jsonb_build_object(
        'policy_id', ob.policy_id, 'version_no', ob.policy_version_no,
        'assessment_model', ob.policy_snapshot ->> 'assessment_model',
        'board_mode', ob.policy_snapshot ->> 'board_mode',
        'medical_determination_authority', ob.policy_snapshot ->> 'medical_determination_authority',
        'administrative_decision_authority', ob.policy_snapshot ->> 'administrative_decision_authority',
        'maker_checker_required', ob.policy_snapshot ->> 'maker_checker_required',
        'timezone_code', ob.policy_snapshot ->> 'timezone_code'),
    'referrals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'referral_id', r.id, 'referral_reference', r.referral_reference,
          'referral_purpose', r.referral_purpose, 'referral_status', r.status,
          'provider_id', r.provider_id, 'report_deadline', r.report_deadline,
          'row_version', r.row_version) ORDER BY r.created_at)
        FROM public.bn_medical_review_referral r WHERE r.obligation_id = ob.id), '[]'::jsonb),
    'assessment_summary', CASE WHEN NOT v_summary THEN NULL ELSE
        (SELECT jsonb_build_object('assessment_id', a.id, 'assessment_status', a.status,
                  'medical_outcome', a.medical_outcome, 'incapacity_nature', a.incapacity_nature,
                  'work_capacity_opinion', a.work_capacity_opinion,
                  'recommended_next_review_date', a.recommended_next_review_date)
           FROM public.bn_medical_review_assessment a
          WHERE a.obligation_id = ob.id ORDER BY a.created_at DESC LIMIT 1) END,
    'board_case', (SELECT jsonb_build_object('board_case_id', b.id, 'case_reference', b.case_reference,
                            'board_case_status', b.status, 'required_quorum', b.required_quorum,
                            'determination_binding', b.determination_binding, 'row_version', b.row_version)
                     FROM public.bn_medical_board_case b
                    WHERE b.obligation_id = ob.id ORDER BY b.referred_at DESC LIMIT 1),
    'decision', (SELECT jsonb_build_object('decision_id', d.id, 'decision_reference', d.decision_reference,
                          'decision_status', d.status, 'outcome_code', d.outcome_code,
                          'decision_authority', d.decision_authority, 'row_version', d.row_version)
                   FROM public.bn_medical_review_administrative_decision d
                  WHERE d.obligation_id = ob.id ORDER BY d.created_at DESC LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_referral_detail_v1(p_referral_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); rf record;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(v_actor, rf.obligation_id);

  RETURN jsonb_build_object('status','OK',
    'referral_id', rf.id, 'referral_reference', rf.referral_reference,
    'obligation_id', rf.obligation_id, 'referral_status', rf.status,
    'referral_purpose', rf.referral_purpose, 'parent_referral_id', rf.parent_referral_id,
    'provider_id', rf.provider_id, 'accountable_practitioner_id', rf.accountable_practitioner_id,
    'provider_snapshot', rf.provider_snapshot, 'conflict_check', rf.conflict_check,
    'evidence_release_scope', rf.evidence_release_scope,
    'appointment_responsibility', rf.appointment_responsibility,
    'acceptance_deadline', rf.acceptance_deadline, 'report_deadline', rf.report_deadline,
    'consent_status', rf.consent_status, 'issued_at', rf.issued_at,
    'responded_at', rf.responded_at, 'row_version', rf.row_version);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_appointment_history_v1(
  p_obligation_id uuid, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 100);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT COALESCE(jsonb_agg(t ORDER BY t.sequence_no), '[]'::jsonb) INTO v_rows FROM (
    SELECT ap.id AS appointment_id, ap.referral_id, ap.status AS appointment_status,
           ap.responsibility, ap.scheduled_at, ap.location_reference, ap.sequence_no,
           ap.reschedule_count, ap.non_attendance_category, ap.reasonable_cause_reviewed,
           ap.reasonable_cause_outcome, ap.row_version
      FROM public.bn_medical_review_appointment ap
     WHERE ap.obligation_id = p_obligation_id
     ORDER BY ap.sequence_no LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_assessment_summary_v1(p_obligation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor(); v_full boolean; v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);
  IF NOT public._bn_mr_require_ok(v_actor, 'view_medical_summary') THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  v_full := public._bn_mr_can_view_confidential(v_actor, p_obligation_id);

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at), '[]'::jsonb) INTO v_rows FROM (
    SELECT a.id AS assessment_id, a.referral_id, a.status AS assessment_status,
           a.submission_channel, a.examination_date, a.attendance_result, a.medical_outcome,
           a.functional_conclusion, a.work_capacity_opinion, a.expected_duration_months,
           a.incapacity_nature, a.prognosis_category, a.impairment_percentage,
           a.specialist_required, a.further_evidence_required, a.recommended_next_review_date,
           a.receipt_revision, a.row_version, a.created_at,
           CASE WHEN v_full THEN a.clinical_narrative ELSE NULL END AS clinical_narrative,
           v_full AS confidential_included
      FROM public.bn_medical_review_assessment a
     WHERE a.obligation_id = p_obligation_id) t;

  RETURN jsonb_build_object('status','OK','confidential_included', v_full, 'rows', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_confidential_evidence_v1(
  p_obligation_id uuid, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 100);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view_confidential_medical_evidence');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);
  IF NOT public._bn_mr_can_view_confidential(v_actor, p_obligation_id) THEN
    RAISE EXCEPTION 'E_CONFIDENTIAL_ACCESS_DENIED' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at), '[]'::jsonb) INTO v_rows FROM (
    SELECT e.id AS evidence_link_id, e.evidence_class, e.evidence_type, e.document_title,
           e.document_id, e.referral_id, e.assessment_id, e.board_case_id,
           e.released_to_board, e.released_to_provider, e.created_at
      FROM public.bn_medical_review_evidence_link e
     WHERE e.obligation_id = p_obligation_id
     ORDER BY e.created_at LIMIT v_limit OFFSET v_offset) t;

  INSERT INTO public.bn_medical_review_evidence_access_log
    (obligation_id, actor_user_id, access_kind)
  VALUES (p_obligation_id, v_actor, 'CONFIDENTIAL_METADATA_LIST');

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_provider_worklist_v1(
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor(); v_provider uuid;
  v_limit integer := public._bn_mr_page(p_limit, 100);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0); v_rows jsonb;
BEGIN
  v_provider := public._bn_mr_provider_for_user(v_actor);
  IF v_provider IS NULL THEN RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001'; END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.report_deadline), '[]'::jsonb) INTO v_rows FROM (
    SELECT r.id AS referral_id, r.referral_reference, r.status AS referral_status,
           r.referral_purpose, r.acceptance_deadline, r.report_deadline, r.row_version,
           o.obligation_reference, o.review_type,
           (SELECT ap.scheduled_at FROM public.bn_medical_review_appointment ap
             WHERE ap.referral_id = r.id ORDER BY ap.sequence_no DESC LIMIT 1) AS appointment_at
      FROM public.bn_medical_review_referral r
      JOIN public.bn_medical_review_obligation o ON o.id = r.obligation_id
     WHERE r.provider_id = v_provider
       AND r.status IN ('ISSUED','ACCEPTED','ASSESSMENT_IN_PROGRESS','REPORT_SUBMITTED')
     ORDER BY r.report_deadline LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','provider_id',v_provider,
                            'limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_provider_referral_detail_v1(p_referral_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); v_provider uuid; rf record;
BEGIN
  v_provider := public._bn_mr_provider_for_user(v_actor);
  IF v_provider IS NULL THEN RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  IF rf.provider_id IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object('status','OK',
    'referral_id', rf.id, 'referral_reference', rf.referral_reference,
    'referral_status', rf.status, 'referral_purpose', rf.referral_purpose,
    'review_questions', rf.review_questions, 'evidence_release_scope', rf.evidence_release_scope,
    'appointment_responsibility', rf.appointment_responsibility,
    'acceptance_deadline', rf.acceptance_deadline, 'report_deadline', rf.report_deadline,
    'row_version', rf.row_version,
    'assessment', (SELECT jsonb_build_object('assessment_id', a.id, 'assessment_status', a.status,
                            'row_version', a.row_version)
                     FROM public.bn_medical_review_assessment a
                    WHERE a.referral_id = rf.id ORDER BY a.created_at DESC LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_board_worklist_v1(
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 100);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');

  SELECT COALESCE(jsonb_agg(t ORDER BY t.required_completion_date), '[]'::jsonb) INTO v_rows FROM (
    SELECT DISTINCT b.id AS board_case_id, b.case_reference, b.status AS board_case_status,
           b.board_id, b.required_quorum, b.determination_binding,
           b.required_completion_date, b.row_version, o.obligation_reference
      FROM public.bn_medical_board_case b
      JOIN public.bn_medical_review_obligation o ON o.id = b.obligation_id
     WHERE public._bn_mr_can_access(v_actor, b.obligation_id)
       AND (EXISTS (SELECT 1 FROM public.bn_medical_board_case_participant p
                     WHERE p.board_case_id = b.id AND p.member_user_id = v_actor)
            OR b.board_id IN (SELECT public._bn_mr_secretary_boards(v_actor))
            OR public._bn_mr_require_ok(v_actor, 'manage_board_case'))
     ORDER BY b.required_completion_date LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_board_case_detail_v1(p_board_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); bc record;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);

  RETURN jsonb_build_object('status','OK',
    'board_case_id', bc.id, 'case_reference', bc.case_reference, 'obligation_id', bc.obligation_id,
    'board_id', bc.board_id, 'board_type', bc.board_type, 'board_case_status', bc.status,
    'required_specialties', to_jsonb(bc.required_specialties), 'required_quorum', bc.required_quorum,
    'determination_binding', bc.determination_binding,
    'required_completion_date', bc.required_completion_date, 'row_version', bc.row_version,
    'participants', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'participant_id', p.id, 'member_id', p.member_id, 'member_role', p.member_role,
        'member_specialty', p.member_specialty, 'conflict_declared', p.conflict_declared,
        'recused', p.recused, 'participated', p.participated) ORDER BY p.assigned_at)
      FROM public.bn_medical_board_case_participant p WHERE p.board_case_id = bc.id), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'session_id', s.id, 'session_reference', s.session_reference, 'session_status', s.status,
        'scheduled_at', s.scheduled_at, 'meeting_mode', s.meeting_mode, 'quorum_met', s.quorum_met)
        ORDER BY s.scheduled_at)
      FROM public.bn_medical_board_session s WHERE s.board_case_id = bc.id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_board_session_v1(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); s record; bc record;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  SELECT * INTO s FROM public.bn_medical_board_session WHERE id = p_session_id;
  PERFORM public._bn_mr_require_record(s.id, 'board_session');
  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = s.board_case_id;
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);

  RETURN jsonb_build_object('status','OK',
    'session_id', s.id, 'session_reference', s.session_reference, 'board_case_id', s.board_case_id,
    'session_status', s.status, 'scheduled_at', s.scheduled_at,
    'location_reference', s.location_reference, 'meeting_mode', s.meeting_mode,
    'quorum_met', s.quorum_met, 'required_quorum', bc.required_quorum,
    'participation', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'participation_id', sp.id, 'member_id', sp.member_id,
        'attendance_status', sp.attendance_status, 'conflict_declared', sp.conflict_declared,
        'recused', sp.recused, 'vote', sp.vote, 'voted_at', sp.voted_at,
        'row_version', sp.row_version) ORDER BY sp.created_at)
      FROM public.bn_medical_board_session_participation sp
     WHERE sp.session_id = s.id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_board_determination_v1(p_board_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); bc record; v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'determination_id', d.id, 'revision_no', d.revision_no, 'outcome_code', d.outcome_code,
      'impairment_percentage', d.impairment_percentage, 'is_binding', d.is_binding,
      'quorum_at_determination', d.quorum_at_determination, 'votes_for', d.votes_for,
      'votes_against', d.votes_against, 'votes_abstain', d.votes_abstain,
      'decided_at', d.decided_at, 'finalised', d.finalised,
      'determination_summary', CASE WHEN public._bn_mr_require_ok(v_actor,'view_medical_summary')
                                    THEN d.determination_summary ELSE NULL END)
      ORDER BY d.revision_no), '[]'::jsonb) INTO v_rows
    FROM public.bn_medical_board_determination d WHERE d.board_case_id = p_board_case_id;

  RETURN jsonb_build_object('status','OK','board_case_id',p_board_case_id,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_decision_detail_v1(p_obligation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'decision_id', d.id, 'decision_reference', d.decision_reference,
      'decision_status', d.status, 'outcome_code', d.outcome_code,
      'decision_authority', d.decision_authority,
      'medical_recommendation_accepted', d.medical_recommendation_accepted,
      'departure_reason', d.departure_reason, 'made_by', d.made_by, 'made_at', d.made_at,
      'approved_by', d.approved_by, 'approved_at', d.approved_at,
      'returned_reason', d.returned_reason, 'effective_date', d.effective_date,
      'next_review_date', d.next_review_date, 'row_version', d.row_version)
      ORDER BY d.created_at), '[]'::jsonb) INTO v_rows
    FROM public.bn_medical_review_administrative_decision d WHERE d.obligation_id = p_obligation_id;

  RETURN jsonb_build_object('status','OK','rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_communication_history_v1(
  p_obligation_id uuid, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 100);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT ci.id AS intent_id, ci.event_code, ci.recipient_category, ci.delivery_status,
           ci.created_at, ci.updated_at, public._bn_mr_safe_comm_context(ci.context) AS context
      FROM public.bn_medical_review_communication_intent ci
     WHERE ci.obligation_id = p_obligation_id
     ORDER BY ci.created_at DESC LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_proposal_links_v1(p_obligation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor(); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'proposal_id', l.id, 'decision_id', l.decision_id, 'proposal_kind', l.proposal_kind,
      'proposal_status', l.proposal_status, 'suspension_event_id', l.suspension_event_id,
      'proposed_at', l.proposed_at, 'executor', 'bn_award_suspension')
      ORDER BY l.proposed_at), '[]'::jsonb) INTO v_rows
    FROM public.bn_medical_review_suspension_link l WHERE l.obligation_id = p_obligation_id;

  RETURN jsonb_build_object('status','OK','rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_audit_timeline_v1(
  p_obligation_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 200);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view_audit');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT COALESCE(jsonb_agg(t ORDER BY t.occurred_at DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT e.id AS event_id, e.entity_type, e.entity_id, e.event_code,
           e.from_status, e.to_status, e.actor_category, e.occurred_at,
           public._bn_mr_safe_detail(e.detail) AS detail
      FROM public.bn_medical_review_event e
     WHERE e.obligation_id = p_obligation_id
     ORDER BY e.occurred_at DESC LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_policy_config_v1(
  p_product_id uuid DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 100);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'configure_policy');

  SELECT COALESCE(jsonb_agg(t ORDER BY t.policy_code, t.version_no), '[]'::jsonb) INTO v_rows FROM (
    SELECT p.id AS policy_id, p.policy_code, p.policy_name, p.bn_product_id, p.review_type,
           p.version_no, p.lifecycle_state, p.effective_from, p.effective_to,
           p.assessment_model, p.provider_selection_model, p.board_mode, p.board_id,
           p.board_determination_binding, p.medical_determination_authority,
           p.administrative_decision_authority, p.maker_checker_required,
           p.second_opinion_mode, p.timezone_code, p.business_days_only,
           p.provider_fee_responsibility, p.concurrent_referrals_permitted,
           (SELECT count(*) FROM public.bn_medical_review_board_trigger_rule r
             WHERE r.policy_id = p.id AND r.is_active) AS active_trigger_rules
      FROM public.bn_medical_review_policy p
     WHERE (p_product_id IS NULL OR p.bn_product_id = p_product_id)
     ORDER BY p.policy_code, p.version_no LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_provider_search_v1(
  p_term text, p_product_id uuid DEFAULT NULL, p_review_type text DEFAULT NULL,
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 50);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0);
  v_term text := public._bn_mr_search_term(p_term); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'assign_provider');

  SELECT COALESCE(jsonb_agg(t ORDER BY t.practitioner_name), '[]'::jsonb) INTO v_rows FROM (
    SELECT pr.id AS provider_id, pr.provider_code, pr.practitioner_name, pr.classification,
           pr.provider_type, pr.is_individual_practitioner, pr.accountable_practitioner_id,
           to_jsonb(pr.specialties) AS specialties, pr.provider_status, pr.verification_status,
           pr.contract_status, pr.licence_expiry_date
      FROM public.bn_medical_provider pr
     WHERE pr.provider_status = 'ACTIVE' AND pr.verification_status = 'VERIFIED'
       AND (v_term IS NULL OR pr.practitioner_name ILIKE v_term OR pr.provider_code ILIKE v_term)
       AND EXISTS (SELECT 1 FROM public.bn_medical_provider_approval a
                    WHERE a.provider_id = pr.id AND a.is_active
                      AND (p_product_id IS NULL OR a.bn_product_id IS NULL OR a.bn_product_id = p_product_id)
                      AND (p_review_type IS NULL OR a.review_type IS NULL OR a.review_type = p_review_type))
     ORDER BY pr.practitioner_name LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_board_search_v1(
  p_term text DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  v_limit integer := public._bn_mr_page(p_limit, 50);
  v_offset integer := GREATEST(COALESCE(p_offset,0),0);
  v_term text := public._bn_mr_search_term(p_term); v_rows jsonb;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'manage_board_case');

  SELECT COALESCE(jsonb_agg(t ORDER BY t.board_name), '[]'::jsonb) INTO v_rows FROM (
    SELECT b.id AS board_id, b.board_code, b.board_name, b.review_mode, b.meeting_mode,
           b.minimum_quorum, b.voting_rule, b.determination_binding,
           to_jsonb(b.required_specialties) AS required_specialties, b.is_active,
           (SELECT count(*) FROM public.bn_medical_board_member m
             WHERE m.board_id = b.id AND COALESCE(m.is_active,true)) AS active_members
      FROM public.bn_medical_board b
     WHERE COALESCE(b.is_active, false)
       AND (v_term IS NULL OR b.board_name ILIKE v_term OR b.board_code ILIKE v_term)
     ORDER BY b.board_name LIMIT v_limit OFFSET v_offset) t;

  RETURN jsonb_build_object('status','OK','limit',v_limit,'offset',v_offset,'rows',v_rows);
END $$;

-- =====================================================================
-- Grants
-- =====================================================================
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND (p.proname LIKE '\_bn\_mr\_%' OR p.proname LIKE 'bn\_medical\_review\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF r.proname NOT LIKE '\_%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END
$g$;
-- =====================================================================
-- BN LIFE CERTIFICATES — defect-correction and validation pass
-- =====================================================================

-- ---------------------------------------------------------------- 1. schema
ALTER TABLE public.bn_life_certificate
  ADD COLUMN IF NOT EXISTS evidence_integrity_status text NOT NULL DEFAULT 'UNAVAILABLE';

CREATE TABLE IF NOT EXISTS public.bn_life_certificate_scheduler_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  life_certificate_id uuid NOT NULL REFERENCES public.bn_life_certificate(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  milestone_date date NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_attempt_at timestamptz,
  manual_intervention_required boolean NOT NULL DEFAULT false,
  cleared_by_user_id uuid,
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (life_certificate_id, milestone, milestone_date)
);

GRANT ALL ON public.bn_life_certificate_scheduler_attempt TO service_role;
ALTER TABLE public.bn_life_certificate_scheduler_attempt ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_life_certificate_case_evidence_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suspension_event_id uuid NOT NULL,
  life_certificate_id uuid NOT NULL REFERENCES public.bn_life_certificate(id) ON DELETE CASCADE,
  case_kind text NOT NULL,
  document_id uuid,
  evidence_version integer,
  evidence_integrity_status text,
  verification_decision text,
  verified_by_user_id uuid,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suspension_event_id, life_certificate_id, case_kind)
);

GRANT ALL ON public.bn_life_certificate_case_evidence_link TO service_role;
ALTER TABLE public.bn_life_certificate_case_evidence_link ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------- 2. calendar helpers
CREATE OR REPLACE FUNCTION public._bn_lc_today(p_tz text)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF(p_tz,''),'UTC'))::date;
$$;

CREATE OR REPLACE FUNCTION public._bn_lc_business_day(p_date date, p_enabled boolean)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d date := p_date; guard integer := 0;
BEGIN
  IF p_date IS NULL OR NOT COALESCE(p_enabled,false) THEN RETURN p_date; END IF;
  LOOP
    guard := guard + 1;
    EXIT WHEN guard > 21;
    IF extract(isodow from d) >= 6 THEN d := d + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.core_calendar_holidays h
                WHERE h.holiday_date = d AND COALESCE(h.is_active,true)
                  AND COALESCE(h.affects_workflow_deadlines,true)) THEN
      d := d + 1; CONTINUE;
    END IF;
    EXIT;
  END LOOP;
  RETURN d;
END $$;

-- reminder identities from the obligation snapshot
CREATE OR REPLACE FUNCTION public._bn_lc_reminder_schedule(p_cert uuid)
RETURNS TABLE (reminder_index integer, milestone text, reminder_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT o.ord::integer,
         'REMINDER_'||o.ord::text,
         public._bn_lc_business_day(
           lc.due_date + (o.val)::integer,
           COALESCE((lc.policy_snapshot->>'business_days_only')::boolean,false))
    FROM public.bn_life_certificate lc
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(lc.policy_snapshot->'reminder_offset_days','[]'::jsonb)
    ) WITH ORDINALITY AS o(val, ord)
   WHERE lc.id = p_cert AND lc.due_date IS NOT NULL;
$$;

-- --------------------------------------------------- 3. record-level access
CREATE OR REPLACE FUNCTION public._bn_lc_can_access(p_actor uuid, p_cert uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_claim uuid; v_code text;
BEGIN
  IF public.is_admin(p_actor)
     OR public.has_permission(p_actor,'bn_life_certificate','view_all_records') THEN
    RETURN true;
  END IF;
  SELECT c.bn_claim_id INTO v_claim
    FROM public.bn_life_certificate lc JOIN public.bn_award c ON c.id = lc.bn_award_id
   WHERE lc.id = p_cert;
  IF v_claim IS NULL THEN RETURN false; END IF;
  v_code := public._bn_susp_user_code(p_actor);

  IF EXISTS (SELECT 1 FROM public.bn_claim WHERE id = v_claim AND assigned_to = v_code) THEN
    RETURN true;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_claim_queue_assignment q
              WHERE q.claim_id = v_claim AND COALESCE(q.is_active,true)
                AND (q.assigned_to = v_code
                     OR q.workbasket_id IN (SELECT workbasket_id FROM public.bn_workbaskets_for_user(p_actor)))) THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._bn_lc_require_record(p_actor uuid, p_cert uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._bn_lc_can_access(p_actor, p_cert) THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._bn_lc_mask_ssn(p_ssn text, p_reveal boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_ssn IS NULL THEN NULL
    WHEN COALESCE(p_reveal,false) THEN p_ssn
    WHEN length(p_ssn) <= 4 THEN repeat('*', length(p_ssn))
    ELSE repeat('*', length(p_ssn)-4) || right(p_ssn,4) END;
$$;

-- ------------------------------------------------ 4. canonical due feed
DROP FUNCTION IF EXISTS public.bn_life_certificate_due_for_milestone_v1(date, integer);
DROP FUNCTION IF EXISTS public.bn_life_certificate_due_milestones_v1(date, integer);

CREATE FUNCTION public.bn_life_certificate_due_milestones_v1(
  p_as_of date DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (life_certificate_id uuid, bn_award_id uuid, milestone text,
               milestone_date date, attempts integer, row_version integer,
               obligation_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cand AS (
    SELECT lc.id, lc.bn_award_id, lc.obligation_status, lc.row_version,
           lc.due_date, lc.grace_end_date, lc.reminder_count,
           COALESCE(p_as_of, public._bn_lc_today(lc.policy_snapshot->>'timezone')) AS as_of
      FROM public.bn_life_certificate lc
     WHERE lc.obligation_status IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE')
       AND lc.due_date IS NOT NULL
  ), resolved AS (
    SELECT c.*,
      CASE
        WHEN c.grace_end_date IS NOT NULL AND c.as_of > c.grace_end_date THEN 'OVERDUE'
        WHEN c.grace_end_date IS NOT NULL AND c.as_of > c.due_date
             AND c.obligation_status <> 'GRACE' THEN 'GRACE'
        WHEN c.obligation_status = 'NOT_DUE' AND c.as_of >= c.due_date THEN 'DUE'
        ELSE (SELECT r.milestone FROM public._bn_lc_reminder_schedule(c.id) r
               WHERE r.reminder_date <= c.as_of AND r.reminder_index > c.reminder_count
               ORDER BY r.reminder_index LIMIT 1)
      END AS milestone
    FROM cand c
  )
  SELECT r.id, r.bn_award_id, r.milestone,
         CASE r.milestone
           WHEN 'OVERDUE' THEN r.grace_end_date
           WHEN 'GRACE' THEN r.due_date
           WHEN 'DUE' THEN r.due_date
           ELSE (SELECT s.reminder_date FROM public._bn_lc_reminder_schedule(r.id) s
                  WHERE s.milestone = r.milestone LIMIT 1)
         END AS milestone_date,
         COALESCE(a.failed_attempts,0)::integer AS attempts,
         r.row_version, r.obligation_status
    FROM resolved r
    LEFT JOIN public.bn_life_certificate_scheduler_attempt a
      ON a.life_certificate_id = r.id AND a.milestone = r.milestone
     AND a.milestone_date = CASE r.milestone
           WHEN 'OVERDUE' THEN r.grace_end_date
           WHEN 'GRACE' THEN r.due_date
           WHEN 'DUE' THEN r.due_date
           ELSE (SELECT s.reminder_date FROM public._bn_lc_reminder_schedule(r.id) s
                  WHERE s.milestone = r.milestone LIMIT 1) END
   WHERE r.milestone IS NOT NULL
   ORDER BY r.due_date
   LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),200);
$$;

-- --------------------------------------- 5. milestone command (date authority)
DROP FUNCTION IF EXISTS public.bn_life_certificate_mark_milestone_v1(uuid, text, text, text, date);

CREATE FUNCTION public.bn_life_certificate_mark_milestone_v1(
  p_life_certificate_id uuid, p_milestone text,
  p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_cert public.bn_life_certificate%ROWTYPE;
        v_to text; v_corr text; v_hash text; v_cached jsonb; v_result jsonb; v_event text;
        v_today date; v_idx integer; v_rdate date; v_mdate date; v_kind text;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  IF v_actor IS NOT NULL THEN
    IF p_milestone LIKE 'REMINDER%' THEN PERFORM public._bn_lc_require(v_actor,'send_reminder');
    ELSE PERFORM public._bn_lc_require(v_actor,'escalate'); END IF;
    PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);
  ELSIF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  v_kind := CASE WHEN p_milestone ~ '^REMINDER_[0-9]+$' THEN 'REMINDER' ELSE p_milestone END;
  IF v_kind NOT IN ('DUE','REMINDER','GRACE','OVERDUE') THEN
    RAISE EXCEPTION 'E_INVALID_MILESTONE' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status NOT IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE') THEN
    RETURN jsonb_build_object('status','NO_OP','reason','TERMINAL_STATE',
                              'obligation_status', v_cert.obligation_status);
  END IF;

  -- Server-side date authority in the policy timezone. p_as_of is not accepted.
  v_today := public._bn_lc_today(v_cert.policy_snapshot->>'timezone');

  IF v_kind = 'DUE' THEN
    IF v_cert.obligation_status <> 'NOT_DUE' OR v_cert.due_date IS NULL OR v_today < v_cert.due_date THEN
      RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    v_mdate := v_cert.due_date;
  ELSIF v_kind = 'REMINDER' THEN
    v_idx := split_part(p_milestone,'_',2)::integer;
    SELECT r.reminder_date INTO v_rdate FROM public._bn_lc_reminder_schedule(v_cert.id) r
     WHERE r.reminder_index = v_idx;
    IF v_rdate IS NULL THEN RAISE EXCEPTION 'E_INVALID_MILESTONE' USING ERRCODE='P0001'; END IF;
    IF v_today < v_rdate THEN RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    IF v_cert.reminder_count >= v_idx THEN
      RETURN jsonb_build_object('status','NO_OP','reason','REMINDER_ALREADY_SENT',
                                'milestone', p_milestone); END IF;
    v_mdate := v_rdate;
  ELSIF v_kind = 'GRACE' THEN
    IF v_cert.due_date IS NULL OR v_today <= v_cert.due_date
       OR v_cert.grace_end_date IS NULL OR v_today > v_cert.grace_end_date
       OR v_cert.obligation_status = 'GRACE' THEN
      RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    v_mdate := v_cert.due_date;
  ELSE
    IF v_cert.grace_end_date IS NULL OR v_today <= v_cert.grace_end_date THEN
      RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    v_mdate := v_cert.grace_end_date;
  END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_milestone||'|'||v_mdate::text,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_mark_milestone_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('status','REPLAYED'); END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  v_to := CASE v_kind WHEN 'DUE' THEN 'DUE' WHEN 'REMINDER' THEN 'REMINDER_SENT'
                      WHEN 'GRACE' THEN 'GRACE' ELSE 'OVERDUE' END;
  v_event := CASE v_kind
    WHEN 'DUE' THEN 'BN_LIFE_CERT_DUE'
    WHEN 'REMINDER' THEN 'BN_LIFE_CERT_REMINDER_'||v_idx::text
    WHEN 'GRACE' THEN 'BN_LIFE_CERT_GRACE_STARTED'
    ELSE 'BN_LIFE_CERT_OVERDUE' END;

  UPDATE public.bn_life_certificate SET
    obligation_status = v_to,
    status = CASE WHEN v_to='OVERDUE' THEN 'OVERDUE' ELSE status END,
    escalation_status = CASE WHEN v_to='OVERDUE' THEN 'PENDING' ELSE escalation_status END,
    reminder_count = CASE WHEN v_kind='REMINDER' THEN v_idx ELSE reminder_count END,
    last_reminder_at = CASE WHEN v_kind='REMINDER' THEN now() ELSE last_reminder_at END,
    row_version = row_version + 1, correlation_id = v_corr, modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'MILESTONE_'||p_milestone, v_cert.obligation_status, v_to,
    v_actor, NULL, NULL, v_corr, p_idempotency_key,
    jsonb_build_object('milestone', p_milestone,'milestone_date', v_mdate,'server_date', v_today));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.MILESTONE','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status', v_to), v_corr, p_milestone);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id, v_event,
    jsonb_build_object('milestone', p_milestone,'milestone_date', v_mdate), v_corr,
    'lc-milestone:'||v_cert.id::text||':'||p_milestone||':'||v_mdate::text);

  UPDATE public.bn_life_certificate_scheduler_attempt
     SET failed_attempts = 0, manual_intervention_required = false,
         last_error_code = NULL, updated_at = now()
   WHERE life_certificate_id = v_cert.id AND milestone = p_milestone AND milestone_date = v_mdate;

  v_result := jsonb_build_object('status','APPLIED','life_certificate_id', v_cert.id,
    'milestone', p_milestone,'milestone_date', v_mdate,'obligation_status', v_to,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_mark_milestone_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------------------------------------- 6. attempt tracking RPCs
CREATE OR REPLACE FUNCTION public.bn_life_certificate_record_milestone_failure_v1(
  p_life_certificate_id uuid, p_milestone text, p_milestone_date date,
  p_error_code text, p_error_detail text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row public.bn_life_certificate_scheduler_attempt%ROWTYPE;
        v_safe text := COALESCE(substring(COALESCE(p_error_code,'') from 'E_[A-Z_]+'),'E_UNKNOWN');
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.bn_life_certificate_scheduler_attempt
    (life_certificate_id, milestone, milestone_date, failed_attempts, last_error_code, last_attempt_at)
  VALUES (p_life_certificate_id, p_milestone, p_milestone_date, 1, v_safe, now())
  ON CONFLICT (life_certificate_id, milestone, milestone_date) DO UPDATE
    SET failed_attempts = public.bn_life_certificate_scheduler_attempt.failed_attempts + 1,
        last_error_code = v_safe, last_attempt_at = now(), updated_at = now()
  RETURNING * INTO v_row;

  IF v_row.failed_attempts >= 5 AND NOT v_row.manual_intervention_required THEN
    UPDATE public.bn_life_certificate_scheduler_attempt
       SET manual_intervention_required = true, updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;

  PERFORM public._bn_susp_log_operational_error(
    'bn_life_certificate_mark_milestone_v1', p_milestone, p_life_certificate_id,
    p_correlation_id, v_safe, 'P0001', p_error_detail);

  RETURN jsonb_build_object('failed_attempts', v_row.failed_attempts,
                            'manual_intervention_required', v_row.manual_intervention_required,
                            'error_code', v_safe);
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_clear_milestone_attempts_v1(
  p_life_certificate_id uuid, p_milestone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_count integer;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'escalate');
  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);

  UPDATE public.bn_life_certificate_scheduler_attempt
     SET failed_attempts = 0, manual_intervention_required = false, last_error_code = NULL,
         cleared_by_user_id = v_actor, cleared_at = now(), updated_at = now()
   WHERE life_certificate_id = p_life_certificate_id
     AND (p_milestone IS NULL OR milestone = p_milestone);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.SCHEDULER_ATTEMPTS_CLEARED','update',
    p_life_certificate_id::text,'{}'::jsonb,
    jsonb_build_object('milestone', p_milestone,'cleared', v_count), NULL, NULL);

  RETURN jsonb_build_object('status','CLEARED','cleared', v_count);
END $$;

-- --------------------------------------- 7. generation: policy + batch cap
CREATE OR REPLACE FUNCTION public.bn_life_certificate_generate_obligations_v1(
  p_policy_code text DEFAULT 'BN_LIFE_CERT_DEFAULT',
  p_as_of date DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_preview boolean DEFAULT true,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_policy public.bn_life_certificate_policy%ROWTYPE;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,200),1), 200);
  v_period_start date; v_period_end date; v_period text;
  v_issue date; v_due date; v_grace date; v_esc date; v_as_of date;
  v_created integer := 0; v_skipped integer := 0; v_eligible integer := 0; v_review integer := 0;
  v_excluded_age integer := 0; v_award record; v_cert uuid; v_snapshot jsonb;
  v_corr text := COALESCE(p_correlation_id, gen_random_uuid()::text);
  v_dob date; v_age integer; v_status text; v_result jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'generate');

  SELECT * INTO v_policy FROM public.bn_life_certificate_policy
   WHERE policy_code = p_policy_code AND is_active
     AND effective_from <= COALESCE(p_as_of, current_date)
     AND (effective_to IS NULL OR effective_to >= COALESCE(p_as_of, current_date))
   ORDER BY policy_version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_POLICY_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  v_as_of := COALESCE(p_as_of, public._bn_lc_today(v_policy.timezone));

  v_hash := encode(digest(coalesce(p_policy_code,'')||'|'||v_as_of::text||'|'||
                          v_limit::text||'|'||coalesce(p_preview::text,''), 'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_generate_obligations_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  v_period_start := CASE v_policy.obligation_period_kind
    WHEN 'ANNUAL' THEN date_trunc('year', v_as_of)::date
    WHEN 'SEMI_ANNUAL' THEN (date_trunc('year', v_as_of) + (((extract(month from v_as_of)::int - 1)/6) * interval '6 month'))::date
    WHEN 'QUARTERLY' THEN date_trunc('quarter', v_as_of)::date
    ELSE date_trunc('year', v_as_of)::date END;
  v_period_end := (v_period_start + (v_policy.frequency_months || ' month')::interval - interval '1 day')::date;
  v_period := to_char(v_period_start,'YYYY-MM') || '/' || v_policy.frequency_months::text || 'M';

  v_issue := public._bn_lc_business_day(v_period_start + v_policy.issue_offset_days, v_policy.business_days_only);
  v_due   := public._bn_lc_business_day(v_issue + v_policy.due_offset_days, v_policy.business_days_only);
  v_grace := public._bn_lc_business_day(v_due + v_policy.grace_days, v_policy.business_days_only);
  v_esc   := public._bn_lc_business_day(v_grace + v_policy.escalation_offset_days, v_policy.business_days_only);

  v_snapshot := jsonb_build_object(
    'policy_id', v_policy.id, 'policy_code', v_policy.policy_code, 'policy_version', v_policy.policy_version,
    'frequency_months', v_policy.frequency_months, 'obligation_period_kind', v_policy.obligation_period_kind,
    'issue_offset_days', v_policy.issue_offset_days,
    'due_offset_days', v_policy.due_offset_days,
    'grace_days', v_policy.grace_days, 'escalation_offset_days', v_policy.escalation_offset_days,
    'reminder_offset_days', to_jsonb(v_policy.reminder_offset_days),
    'accepted_evidence_types', to_jsonb(v_policy.accepted_evidence_types),
    'accepted_issuing_authorities', to_jsonb(v_policy.accepted_issuing_authorities),
    'applicable_benefit_codes', to_jsonb(v_policy.applicable_benefit_codes),
    'applicable_award_types', to_jsonb(v_policy.applicable_award_types),
    'applicable_award_statuses', to_jsonb(v_policy.applicable_award_statuses),
    'payment_jurisdictions', to_jsonb(v_policy.payment_jurisdictions),
    'min_claimant_age', v_policy.min_claimant_age,
    'country_code', v_policy.country_code,
    'business_days_only', COALESCE(v_policy.business_days_only,false),
    'waiver_conditions', COALESCE(v_policy.waiver_conditions,'{}'::jsonb),
    'certificate_validity_days', v_policy.certificate_validity_days,
    'requires_maker_checker', v_policy.requires_maker_checker,
    'suspension_reason_code', v_policy.suspension_reason_code,
    'reinstatement_reason_code', v_policy.reinstatement_reason_code,
    'effective_from', v_policy.effective_from, 'effective_to', v_policy.effective_to,
    'timezone', COALESCE(v_policy.timezone,'UTC'));

  FOR v_award IN
    SELECT w.id, w.bn_claim_id
      FROM public.bn_award w
     WHERE w.status = ANY (v_policy.applicable_award_statuses)
       AND (cardinality(v_policy.applicable_benefit_codes) = 0 OR w.benefit_code = ANY (v_policy.applicable_benefit_codes))
       AND (cardinality(v_policy.applicable_award_types) = 0 OR w.award_type = ANY (v_policy.applicable_award_types))
       AND w.start_date <= v_period_end
       AND (w.end_date IS NULL OR w.end_date >= v_period_start)
     ORDER BY w.entered_at
     LIMIT v_limit
  LOOP
    v_status := 'ELIGIBLE';

    -- age rule
    IF COALESCE(v_policy.min_claimant_age,0) > 0 THEN
      SELECT s.date_of_birth INTO v_dob FROM public.bn_claim_person_snapshot s
       WHERE s.claim_id = v_award.bn_claim_id ORDER BY s.captured_at DESC NULLS LAST LIMIT 1;
      IF v_dob IS NULL THEN
        v_status := 'REVIEW_AGE_UNKNOWN';
      ELSE
        v_age := extract(year from age(v_period_end, v_dob))::integer;
        IF v_age < v_policy.min_claimant_age THEN v_status := 'EXCLUDED_AGE'; END IF;
      END IF;
    END IF;

    -- jurisdiction rule: explicit review when the data is not available
    IF v_status = 'ELIGIBLE' AND cardinality(COALESCE(v_policy.payment_jurisdictions,'{}'::text[])) > 0 THEN
      v_status := 'REVIEW_JURISDICTION_UNKNOWN';
    END IF;

    IF v_status = 'EXCLUDED_AGE' THEN v_excluded_age := v_excluded_age + 1; CONTINUE; END IF;
    IF v_status LIKE 'REVIEW_%' THEN v_review := v_review + 1; CONTINUE; END IF;

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
       jsonb_build_object('as_of', v_as_of,'command','bn_life_certificate_generate_obligations_v1',
                          'batch_limit', v_limit),
       v_issue, v_grace, v_esc,
       CASE WHEN v_due <= v_as_of THEN 'DUE' ELSE 'NOT_DUE' END,
       public._bn_susp_user_code(v_actor), v_corr)
    RETURNING id INTO v_cert;

    PERFORM public._bn_lc_event(v_cert,'OBLIGATION_CREATED', NULL,
      CASE WHEN v_due <= v_as_of THEN 'DUE' ELSE 'NOT_DUE' END, v_actor, NULL, NULL, v_corr,
      p_idempotency_key, jsonb_build_object('period', v_period,'policy_version', v_policy.policy_version));
    PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.OBLIGATION_CREATED','create', v_cert::text,
      '{}'::jsonb, jsonb_build_object('award_id', v_award.id,'period', v_period), v_corr, NULL);
    PERFORM public._bn_lc_comm(v_cert, v_award.id,'BN_LIFE_CERT_OBLIGATION_CREATED',
      jsonb_build_object('period', v_period,'due_date', v_due), v_corr,
      'lc-obl-created:'||v_cert::text);
    v_created := v_created + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'status', CASE WHEN p_preview THEN 'PREVIEW' ELSE 'APPLIED' END,
    'policy_code', v_policy.policy_code,'policy_version', v_policy.policy_version,
    'obligation_period', v_period,'issue_date', v_issue,'due_date', v_due,
    'grace_end_date', v_grace,'escalation_date', v_esc,'eligible', v_eligible,
    'created', v_created,'skipped_existing', v_skipped,'excluded_age', v_excluded_age,
    'review_required', v_review,'batch_limit', v_limit,'as_of', v_as_of,'correlation_id', v_corr);
  IF NOT p_preview THEN
    PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_generate_obligations_v1',
                                          p_idempotency_key, v_hash, v_result, v_corr);
  END IF;
  RETURN v_result;
END $$;

-- ------------------------------------------ 8. receipt: real DMS integrity
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
  v_corr text; v_result jsonb; v_accepted text[]; v_integrity text;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'receive');
  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);

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
  IF COALESCE(v_doc.verification_status,'') = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'E_EVIDENCE_SUPERSEDED' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_life_certificate lc
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

  -- The document boundary exposes no trustworthy content checksum. Integrity
  -- evidence is recorded as unavailable instead of manufacturing a hash.
  v_integrity := 'UNAVAILABLE';

  UPDATE public.bn_life_certificate SET
    submitted_date = COALESCE(p_received_date, current_date),
    document_ref = v_doc.file_name,
    document_id = p_document_id,
    evidence_type = p_evidence_type,
    evidence_checksum = NULL,
    evidence_integrity_status = v_integrity,
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
    jsonb_build_object('channel', p_received_channel,'evidence_type', p_evidence_type,
                       'evidence_integrity_status', v_integrity));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.RECEIVED','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status','RECEIVED'), v_corr, NULL);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_RECEIVED',
    jsonb_build_object('period', v_cert.obligation_period), v_corr,
    'lc-received:'||v_cert.id::text||':'||(v_cert.row_version+1)::text);

  v_result := jsonb_build_object('status','RECEIVED','life_certificate_id', v_cert.id,
    'evidence_integrity_status', v_integrity,
    'row_version', v_cert.row_version + 1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_receive_v1',
                                        p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

-- ------------------------------------- 9. reinstatement evidence linkage
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
  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);
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

  INSERT INTO public.bn_life_certificate_case_evidence_link
    (suspension_event_id, life_certificate_id, case_kind, document_id, evidence_version,
     evidence_integrity_status, verification_decision, verified_by_user_id, correlation_id)
  VALUES (COALESCE(v_reinst_id, v_susp.id), v_cert.id,'REINSTATEMENT', v_cert.document_id,
          v_cert.evidence_version, v_cert.evidence_integrity_status,'VERIFIED',
          v_cert.verified_by_user_id, v_corr)
  ON CONFLICT (suspension_event_id, life_certificate_id, case_kind) DO NOTHING;

  UPDATE public.bn_life_certificate SET
    reinstatement_event_id = v_reinst_id, escalation_status='REINSTATEMENT_PROPOSED',
    row_version = row_version + 1, correlation_id = v_corr, modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'REINSTATEMENT_PROPOSAL_CREATED','VERIFIED','VERIFIED', v_actor,
    v_reason, p_narrative, v_corr, p_idempotency_key,
    jsonb_build_object('reinstatement_id', v_reinst_id,'evidence_document_id', v_cert.document_id,
                       'evidence_version', v_cert.evidence_version));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.REINSTATEMENT_PROPOSED','create', v_cert.id::text,
    '{}'::jsonb, jsonb_build_object('reinstatement_id', v_reinst_id), v_corr, v_reason);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_REINSTATEMENT_PROPOSED',
    jsonb_build_object('reinstatement_id', v_reinst_id), v_corr,'lc-reinst-proposed:'||v_cert.id::text);

  v_result := jsonb_build_object('status','REINSTATEMENT_PROPOSED','life_certificate_id', v_cert.id,
    'reinstatement_id', v_reinst_id,'reinstatement_result', v_res,
    'evidence_document_id', v_cert.document_id,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_propose_reinstatement_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_case_evidence_v1(p_suspension_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_out jsonb;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'life_certificate_id', l.life_certificate_id,'case_kind', l.case_kind,
    'document_id', l.document_id,'evidence_version', l.evidence_version,
    'evidence_integrity_status', l.evidence_integrity_status,
    'verification_decision', l.verification_decision,
    'verified_by_user_id', l.verified_by_user_id,
    'correlation_id', l.correlation_id,'created_at', l.created_at)),'[]'::jsonb)
    INTO v_out
  FROM public.bn_life_certificate_case_evidence_link l
  WHERE l.suspension_event_id = p_suspension_event_id
    AND public._bn_lc_can_access(v_actor, l.life_certificate_id);
  RETURN jsonb_build_object('links', v_out);
END $$;

-- ------------------------------- 10. scoped + masked query boundary
CREATE OR REPLACE FUNCTION public.bn_life_certificate_worklist_v1(
  p_bucket text DEFAULT 'ALL', p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_limit integer := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
        v_rows jsonb; v_total bigint; v_search text := NULLIF(btrim(COALESCE(p_search,'')),'');
        v_reveal boolean; v_pattern text;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  v_reveal := public.has_permission(v_actor,'bn_life_certificate','view_sensitive_identity')
              OR public.is_admin(v_actor);

  IF v_search IS NOT NULL AND length(v_search) < 4 THEN
    RAISE EXCEPTION 'E_SEARCH_TOO_SHORT' USING ERRCODE='P0001';
  END IF;
  v_pattern := CASE WHEN v_search IS NULL THEN NULL
                    ELSE '%'||replace(replace(replace(v_search,'\','\\'),'%','\%'),'_','\_')||'%' END;

  WITH base AS (
    SELECT lc.*, a.award_number, a.ssn, a.benefit_code, a.status AS award_status,
           att.manual_intervention_required, att.failed_attempts, att.last_error_code
      FROM public.bn_life_certificate lc
      JOIN public.bn_award a ON a.id = lc.bn_award_id
      LEFT JOIN LATERAL (
        SELECT s.manual_intervention_required, s.failed_attempts, s.last_error_code
          FROM public.bn_life_certificate_scheduler_attempt s
         WHERE s.life_certificate_id = lc.id
         ORDER BY s.manual_intervention_required DESC, s.updated_at DESC LIMIT 1) att ON true
     WHERE public._bn_lc_can_access(v_actor, lc.id)
       AND (p_bucket = 'ALL'
        OR (p_bucket='DUE' AND lc.obligation_status IN ('DUE','REMINDER_SENT'))
        OR (p_bucket='GRACE' AND lc.obligation_status='GRACE')
        OR (p_bucket='OVERDUE' AND lc.obligation_status='OVERDUE')
        OR (p_bucket='AWAITING_REVIEW' AND lc.obligation_status IN ('RECEIVED','UNDER_REVIEW'))
        OR (p_bucket='REJECTED' AND lc.obligation_status IN ('REJECTED','RESUBMISSION_REQUIRED'))
        OR (p_bucket='VERIFIED' AND lc.obligation_status='VERIFIED')
        OR (p_bucket='WAIVED_DEFERRED' AND lc.obligation_status IN ('WAIVED','DEFERRED'))
        OR (p_bucket='SUSPENSIONS' AND lc.suspension_event_id IS NOT NULL)
        OR (p_bucket='REINSTATEMENTS' AND lc.reinstatement_event_id IS NOT NULL)
        OR (p_bucket='MANUAL_INTERVENTION' AND COALESCE(att.manual_intervention_required,false)))
       AND (v_pattern IS NULL
            OR COALESCE(a.award_number,'') ILIKE v_pattern ESCAPE '\'
            OR (v_reveal AND a.ssn ILIKE v_pattern ESCAPE '\')
            OR (NOT v_reveal AND a.ssn = v_search))
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb), (SELECT count(*) FROM base)
    INTO v_rows, v_total
  FROM (
    SELECT b.id, b.bn_award_id, b.award_number,
           public._bn_lc_mask_ssn(b.ssn, v_reveal) AS ssn,
           b.benefit_code, b.award_status,
           b.obligation_period, b.due_date, b.grace_end_date, b.escalation_date,
           b.obligation_status, b.evidence_status, b.verification_status,
           b.escalation_status, b.communication_status, b.reminder_count,
           b.suspension_event_id, b.reinstatement_event_id, b.row_version,
           COALESCE(b.manual_intervention_required,false) AS manual_intervention_required,
           COALESCE(b.failed_attempts,0) AS scheduler_failed_attempts,
           b.last_error_code AS scheduler_last_error_code
      FROM base b
     ORDER BY b.due_date
     LIMIT v_limit OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) t;

  RETURN jsonb_build_object('rows', v_rows,'total', v_total,'limit', v_limit,
                            'offset', COALESCE(p_offset,0),'identity_masked', NOT v_reveal);
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_detail_v1(p_life_certificate_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_can_evidence boolean; v_can_conf boolean; v_reveal boolean; v_out jsonb;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);
  v_can_evidence := public.has_permission(v_actor,'bn_life_certificate','view_evidence') OR public.is_admin(v_actor);
  v_can_conf := public.has_permission(v_actor,'bn_life_certificate','view_confidential_evidence') OR public.is_admin(v_actor);
  v_reveal := public.has_permission(v_actor,'bn_life_certificate','view_sensitive_identity') OR public.is_admin(v_actor);

  SELECT jsonb_build_object(
    'obligation', to_jsonb(lc) - 'document_ref' - 'evidence_checksum' - 'remarks'
      || jsonb_build_object(
           'evidence', CASE WHEN NOT v_can_evidence THEN NULL
             WHEN lc.evidence_is_confidential AND NOT v_can_conf THEN
               jsonb_build_object('masked', true,'evidence_type', lc.evidence_type)
             ELSE jsonb_build_object('masked', false,'document_id', lc.document_id,
                    'document_name', lc.document_ref,'evidence_type', lc.evidence_type,
                    'evidence_version', lc.evidence_version,
                    'evidence_integrity_status', lc.evidence_integrity_status,
                    'issuing_authority', lc.issuing_authority,'certificate_date', lc.certificate_date)
           END),
    'award', jsonb_build_object('id', a.id,'award_number', a.award_number,
             'ssn', public._bn_lc_mask_ssn(a.ssn, v_reveal),
             'benefit_code', a.benefit_code,'status', a.status,'start_date', a.start_date),
    'scheduler', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'milestone', s.milestone,'milestone_date', s.milestone_date,
        'failed_attempts', s.failed_attempts,'last_error_code', s.last_error_code,
        'manual_intervention_required', s.manual_intervention_required)),'[]'::jsonb)
      FROM public.bn_life_certificate_scheduler_attempt s WHERE s.life_certificate_id = lc.id),
    'suspension', CASE WHEN s2.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', s2.id,'status', s2.status,'execution_status', s2.execution_status,
        'suspended_from', s2.suspended_from,'reason_code', s2.reason_code) END,
    'reinstatement', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', r.id,'status', r.status,'execution_status', r.execution_status,
        'suspended_from', r.suspended_from,'reason_code', r.reason_code) END,
    'identity_masked', NOT v_reveal
  ) INTO v_out
  FROM public.bn_life_certificate lc
  JOIN public.bn_award a ON a.id = lc.bn_award_id
  LEFT JOIN public.bn_award_suspension_event s2 ON s2.id = lc.suspension_event_id
  LEFT JOIN public.bn_award_suspension_event r ON r.id = lc.reinstatement_event_id
  WHERE lc.id = p_life_certificate_id;

  IF v_out IS NULL THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_timeline_v1(
  p_life_certificate_id uuid, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_events jsonb; v_comms jsonb;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);

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

-- ------------------------------------------------------ 11. grants
REVOKE ALL ON public.bn_life_certificate FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bn_life_certificate_policy FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bn_life_certificate_event FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bn_life_certificate_communication_intent FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bn_life_certificate_scheduler_attempt FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bn_life_certificate_case_evidence_link FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._bn_lc_today(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_business_day(date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_reminder_schedule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_can_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_require_record(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_lc_mask_ssn(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_life_certificate_due_milestones_v1(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_life_certificate_record_milestone_failure_v1(uuid, text, date, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_life_certificate_mark_milestone_v1(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._bn_lc_today(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_lc_business_day(date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_lc_reminder_schedule(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_lc_can_access(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_lc_require_record(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_lc_mask_ssn(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_due_milestones_v1(date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_record_milestone_failure_v1(uuid, text, date, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_mark_milestone_v1(uuid, text, text, text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_clear_milestone_attempts_v1(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_case_evidence_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_generate_obligations_v1(text, date, integer, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_receive_v1(uuid, date, uuid, text, text, date, text, text, integer, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_propose_reinstatement_v1(uuid, text, date, integer, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_worklist_v1(text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_detail_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_timeline_v1(uuid, integer) TO authenticated, service_role;
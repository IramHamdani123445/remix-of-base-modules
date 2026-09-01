-- ============================================================
-- CHECKPOINT E — Compliance Risk Scoring, Bands, Governance
-- ============================================================

-- ---------- 1. SCHEMA ----------
ALTER TABLE public.ce_risk_config
  ADD COLUMN IF NOT EXISTS canonical_factor varchar(30),
  ADD COLUMN IF NOT EXISTS measurement_code varchar(60),
  ADD COLUMN IF NOT EXISTS measurement_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS lifecycle_status varchar(20) NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE public.ce_risk_policies
  ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS weights_confirmation varchar(40) NOT NULL DEFAULT 'PROVISIONAL',
  ADD COLUMN IF NOT EXISTS source_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ce_risk_profiles
  ADD COLUMN IF NOT EXISTS policy_id uuid,
  ADD COLUMN IF NOT EXISTS policy_version integer,
  ADD COLUMN IF NOT EXISTS factor_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS engine_version varchar(40),
  ADD COLUMN IF NOT EXISTS calculation_status varchar(30),
  ADD COLUMN IF NOT EXISTS score_hash text;

ALTER TABLE public.ce_risk_score_history
  ADD COLUMN IF NOT EXISTS policy_id uuid,
  ADD COLUMN IF NOT EXISTS policy_version integer,
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS factor_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS source_period_from date,
  ADD COLUMN IF NOT EXISTS source_period_to date,
  ADD COLUMN IF NOT EXISTS engine_version varchar(40),
  ADD COLUMN IF NOT EXISTS score_hash text,
  ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE INDEX IF NOT EXISTS idx_ce_risk_score_history_profile_time
  ON public.ce_risk_score_history (risk_profile_id, calculated_at DESC);

-- history immutability (effective-dated evidence)
CREATE OR REPLACE FUNCTION public.ce_risk_history_immutable_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RAISE EXCEPTION 'CE-RISK-IMMUTABLE: ce_risk_score_history rows are immutable (attempted %)', TG_OP
    USING ERRCODE = '42501';
END $fn$;

DROP TRIGGER IF EXISTS zz_ce_risk_history_immutable ON public.ce_risk_score_history;
CREATE TRIGGER zz_ce_risk_history_immutable
  BEFORE UPDATE OR DELETE ON public.ce_risk_score_history
  FOR EACH ROW EXECUTE FUNCTION public.ce_risk_history_immutable_trg();

-- ---------- 2. THRESHOLD EVALUATOR ----------
CREATE OR REPLACE FUNCTION public.ce_risk_eval_threshold(
  p_raw numeric, p_method text, p_thresholds jsonb, p_max_score numeric DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $fn$
DECLARE
  v_t jsonb := p_thresholds;
  v_tier jsonb;
  v_matched jsonb := NULL;
  v_sorted jsonb;
  v_highest numeric;
  v_score numeric;
BEGIN
  IF v_t IS NULL THEN RETURN jsonb_build_object('score',0,'tier',NULL,'explanation','No thresholds configured','ok',false); END IF;
  IF jsonb_typeof(v_t) = 'string' THEN v_t := (v_t #>> '{}')::jsonb; END IF;
  IF jsonb_typeof(v_t) = 'object' AND v_t ? 'tiers' THEN v_t := v_t->'tiers'; END IF;
  IF jsonb_typeof(v_t) <> 'array' OR jsonb_array_length(v_t) = 0 THEN
    RETURN jsonb_build_object('score',0,'tier',NULL,'explanation','No thresholds configured','ok',false);
  END IF;

  SELECT jsonb_agg(e ORDER BY COALESCE((e->>'min')::numeric,0)) INTO v_sorted
  FROM jsonb_array_elements(v_t) e;

  IF p_method = 'linear' THEN
    SELECT max(COALESCE((e->>'max')::numeric,0)) INTO v_highest FROM jsonb_array_elements(v_sorted) e;
    v_score := CASE WHEN COALESCE(v_highest,0) > 0
                    THEN LEAST(p_raw / v_highest * COALESCE(p_max_score,100), COALESCE(p_max_score,100))
                    ELSE 0 END;
    RETURN jsonb_build_object('score', round(v_score,2), 'tier', NULL, 'ok', true,
      'explanation', format('Linear: %s / %s x %s = %s', p_raw, v_highest, p_max_score, round(v_score,2)));
  END IF;

  FOR v_tier IN SELECT e FROM jsonb_array_elements(v_sorted) e LOOP
    IF p_raw >= COALESCE((v_tier->>'min')::numeric, 0)
       AND p_raw <= COALESCE((v_tier->>'max')::numeric, 'infinity'::numeric) THEN
      v_matched := v_tier; EXIT;
    END IF;
  END LOOP;

  IF v_matched IS NULL THEN
    SELECT e INTO v_matched FROM jsonb_array_elements(v_sorted) e
    WHERE p_raw >= COALESCE((e->>'min')::numeric,0)
    ORDER BY COALESCE((e->>'min')::numeric,0) DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'score', COALESCE((v_matched->>'score')::numeric, 0),
    'tier', v_matched, 'ok', true,
    'explanation', format('%s: measurement %s matched tier %s (points %s)',
       COALESCE(p_method,'tiered'), p_raw,
       COALESCE(v_matched->>'label', COALESCE(v_matched->>'min','?')||'-'||COALESCE(v_matched->>'max','?')),
       COALESCE(v_matched->>'score','0')));
END $fn$;

-- ---------- 3. MEASUREMENTS ----------
CREATE OR REPLACE FUNCTION public.ce_risk_measure_v1(
  p_employer_id varchar,
  p_measurement_code varchar,
  p_params jsonb DEFAULT '{}'::jsonb,
  p_as_of date DEFAULT CURRENT_DATE,
  p_source_policy jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_months int := COALESCE((p_params->>'lookback_months')::int, 12);
  v_from date := (p_as_of - (COALESCE((p_params->>'lookback_months')::int,12) || ' months')::interval)::date;
  v_statuses text[];
  v_raw numeric := 0;
  v_detail text := '';
  v_evidence jsonb := '{}'::jsonb;
  v_due numeric; v_out numeric; v_ratio numeric;
  v_n int; v_m int; v_level int := 0;
BEGIN
  -- confirmed-violation statuses come from policy configuration, not code
  SELECT COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(p_source_policy->'confirmed_violation_statuses')),
    ARRAY['OPEN','IN_PROGRESS','ESCALATED','RESOLVED','CLOSED']
  ) INTO v_statuses;
  IF COALESCE((p_source_policy->>'include_unconfirmed_review_flags')::boolean, false) THEN
    v_statuses := v_statuses || ARRAY['UNDER_REVIEW'];
  END IF;

  IF p_measurement_code = 'PAYMENT_OVERDUE_PRINCIPAL_RATIO' THEN
    SELECT COALESCE(sum(principal_due),0), COALESCE(sum(principal_outstanding),0)
      INTO v_due, v_out
    FROM public.ce_v_employer_outstanding WHERE employer_id = p_employer_id;
    v_ratio := CASE WHEN COALESCE(v_due,0) > 0 THEN round(v_out / v_due * 100, 2) ELSE 0 END;
    v_raw := v_ratio;
    v_detail := format('Overdue principal %s of %s due = %s%% (canonical C-L1 view; penalties/interest and unapproved retrospective interest excluded)',
      round(COALESCE(v_out,0),2), round(COALESCE(v_due,0),2), v_ratio);
    v_evidence := jsonb_build_object('principal_due',COALESCE(v_due,0),'principal_outstanding',COALESCE(v_out,0),
                                     'source','ce_v_employer_outstanding','excludes','penalty,interest,INTEREST_POLICY_REVIEW_REQUIRED');

  ELSIF p_measurement_code = 'PAYMENT_NONPAYMENT_EVENT_COUNT' THEN
    SELECT count(*) INTO v_n FROM public.ce_violations v
      JOIN public.ce_violation_types t ON t.id = v.violation_type_id
     WHERE v.employer_id = p_employer_id AND v.discovered_date >= v_from
       AND t.code IN ('NON_PAYMENT','PARTIAL_PAYMENT') AND v.status = ANY(v_statuses);
    v_raw := v_n;
    v_detail := format('%s confirmed DR-003/DR-004 payment events in last %s months', v_n, v_months);
    v_evidence := jsonb_build_object('rules',jsonb_build_array('DR-003','DR-004'),'window_from',v_from,'statuses',to_jsonb(v_statuses));

  ELSIF p_measurement_code = 'FILING_LATE_OR_MISSING_COUNT' THEN
    SELECT count(DISTINCT COALESCE(v.period_from, v.id::text)) INTO v_n
    FROM public.ce_violations v JOIN public.ce_violation_types t ON t.id = v.violation_type_id
     WHERE v.employer_id = p_employer_id AND v.discovered_date >= v_from
       AND t.code IN ('LATE_FILING','NON_FILING') AND v.status = ANY(v_statuses);
    v_raw := v_n;
    v_detail := format('%s late/unreported C3 periods (DR-001/DR-002) in last %s months; validly submitted NIL returns count as filed',
                        v_n, v_months);
    v_evidence := jsonb_build_object('rules',jsonb_build_array('DR-001','DR-002'),'window_from',v_from,'nil_returns','counted_as_filed');

  ELSIF p_measurement_code = 'VIOLATION_CONFIRMED_COUNT' THEN
    SELECT count(*) INTO v_n FROM public.ce_violations v
      JOIN public.ce_violation_types t ON t.id = v.violation_type_id
     WHERE v.employer_id = p_employer_id AND v.discovered_date >= v_from
       AND v.status = ANY(v_statuses)
       AND t.code <> ALL (COALESCE(
             ARRAY(SELECT jsonb_array_elements_text(p_params->'exclude_type_codes')),
             ARRAY['NON_FILING','LATE_FILING','NON_PAYMENT','PARTIAL_PAYMENT','ARRANGEMENT_DEFAULT','REPEAT_DEFAULT']));
    SELECT count(*) INTO v_m FROM public.ce_violations v
      JOIN public.ce_violation_types t ON t.id = v.violation_type_id
     WHERE v.employer_id = p_employer_id AND v.discovered_date >= v_from
       AND t.code = 'REPEAT_DEFAULT' AND v.status = ANY(v_statuses);
    v_raw := v_n + (v_m * COALESCE((p_params->>'repeat_offender_weight')::numeric, 2));
    v_detail := format('%s confirmed non-duplicated violations + %s confirmed DR-005 repeat-offender findings (weight %s) in last %s months',
      v_n, v_m, COALESCE((p_params->>'repeat_offender_weight')::numeric,2), v_months);
    v_evidence := jsonb_build_object('confirmed_other',v_n,'repeat_offender_confirmed',v_m,
      'double_count_guard','filing/payment/arrangement rule types excluded — scored by their own factors',
      'statuses',to_jsonb(v_statuses));

  ELSIF p_measurement_code = 'ARRANGEMENT_BREACH_COUNT' THEN
    SELECT count(*) INTO v_n FROM public.ce_arrangement_breaches b
      JOIN public.ce_payment_arrangements a ON a.id = b.arrangement_id
     WHERE a.employer_id = p_employer_id AND b.detected_at >= v_from;
    SELECT count(*) INTO v_m FROM public.ce_violations v
      JOIN public.ce_violation_types t ON t.id = v.violation_type_id
     WHERE v.employer_id = p_employer_id AND v.discovered_date >= v_from
       AND t.code = 'ARRANGEMENT_DEFAULT' AND v.status = ANY(v_statuses);
    v_raw := GREATEST(v_n, v_m);
    v_detail := format('%s recorded arrangement breaches / %s confirmed DR-006 breach violations in last %s months (healthy arrangements score zero)',
                       v_n, v_m, v_months);
    v_evidence := jsonb_build_object('breach_records',v_n,'dr006_violations',v_m,
      'healthy_arrangement_scores','0 unless policy configures otherwise');

  ELSIF p_measurement_code = 'LEGAL_STAGE_LEVEL' THEN
    IF EXISTS (SELECT 1 FROM public.ce_notices n WHERE n.employer_id = p_employer_id
               AND upper(COALESCE(n.notice_type,'')) LIKE '%DEMAND%') THEN v_level := 1; END IF;
    IF EXISTS (SELECT 1 FROM public.ce_legal_referrals r WHERE r.employer_id = p_employer_id
               AND r.status IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL')) THEN v_level := GREATEST(v_level,2); END IF;
    IF EXISTS (SELECT 1 FROM public.ce_legal_referrals r WHERE r.employer_id = p_employer_id
               AND r.legal_case_id IS NOT NULL) THEN v_level := GREATEST(v_level,3); END IF;
    IF COALESCE((p_params->>'count_pending_recommendation')::boolean,false)
       AND EXISTS (SELECT 1 FROM public.ce_legal_referrals r WHERE r.employer_id = p_employer_id
                   AND r.status IN ('DRAFT','PENDING_APPROVAL')) THEN v_level := GREATEST(v_level,1); END IF;
    v_raw := v_level;
    v_detail := format('Legal/enforcement stage level %s (0=none, 1=demand issued, 2=approved referral with Legal, 3=legal case/proceeding); pending recommendations counted: %s',
      v_level, COALESCE((p_params->>'count_pending_recommendation')::boolean,false));
    v_evidence := jsonb_build_object('level',v_level,'recommendation_counts_as_case',
      COALESCE((p_params->>'count_pending_recommendation')::boolean,false));

  ELSE
    RETURN jsonb_build_object('ok',false,'raw_value',0,
      'detail',format('Unknown measurement code %s', p_measurement_code),'evidence','{}'::jsonb);
  END IF;

  RETURN jsonb_build_object('ok',true,'raw_value',v_raw,'detail',v_detail,'evidence',v_evidence,
                            'measurement_code',p_measurement_code,'window_from',v_from,'as_of',p_as_of);
END $fn$;

-- ---------- 4. POLICY VALIDATION ----------
CREATE OR REPLACE FUNCTION public.ce_validate_risk_policy_v1(p_policy_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_pol record; v_f record;
  v_factors jsonb := '[]'::jsonb;
  v_errors text[] := ARRAY[]::text[];
  v_total numeric := 0;
  v_status text; v_reason text;
  v_prev numeric := NULL; v_first boolean := true; v_last numeric := NULL;
  v_b record; v_bands jsonb := '[]'::jsonb; v_bandcount int := 0;
  v_eval jsonb;
BEGIN
  SELECT * INTO v_pol FROM public.ce_risk_policies WHERE id = p_policy_id;
  IF v_pol IS NULL THEN RETURN jsonb_build_object('valid',false,'errors',jsonb_build_array('Policy not found')); END IF;

  FOR v_f IN
    SELECT c.factor_code, c.factor_name, c.canonical_factor, c.measurement_code, c.scoring_method,
           c.thresholds, c.max_score, c.lifecycle_status,
           COALESCE(pf.weight_override, c.weight, 0) AS weight
    FROM public.ce_risk_policy_factors pf
    JOIN public.ce_risk_config c ON c.id = pf.factor_id
    WHERE pf.policy_id = p_policy_id AND pf.is_active = true
    ORDER BY c.factor_code
  LOOP
    v_total := v_total + v_f.weight;
    v_eval := public.ce_risk_eval_threshold(0, v_f.scoring_method, v_f.thresholds, v_f.max_score);
    v_status := 'operational'; v_reason := 'Factor has weight, measurement and scoring thresholds';

    IF v_f.lifecycle_status <> 'ACTIVE' THEN
      v_status := 'configuration_error'; v_reason := 'Factor is retired but still active in policy';
    ELSIF v_f.measurement_code IS NULL THEN
      v_status := 'configuration_error'; v_reason := 'No runtime measurement source configured';
    ELSIF NOT COALESCE((v_eval->>'ok')::boolean,false) THEN
      v_status := 'configuration_error'; v_reason := 'Weight configured but no scoring thresholds — factor cannot score';
    ELSIF v_f.weight IS NULL OR v_f.weight <= 0 THEN
      v_status := 'configured'; v_reason := 'Factor defined but carries no weight';
    END IF;

    IF v_status = 'configuration_error' THEN
      v_errors := v_errors || format('Factor %s: %s', v_f.factor_code, v_reason);
    END IF;

    v_factors := v_factors || jsonb_build_object(
      'factor_code', v_f.factor_code, 'factor_name', v_f.factor_name,
      'canonical_factor', v_f.canonical_factor, 'measurement_code', v_f.measurement_code,
      'weight', v_f.weight, 'status', v_status, 'reason', v_reason);
  END LOOP;

  IF jsonb_array_length(v_factors) = 0 THEN
    v_errors := v_errors || 'Policy has no active factors';
  END IF;

  IF round(v_total,2) <> 100 THEN
    v_errors := v_errors || format('Active factor weights total %s%% — must equal exactly 100%%', round(v_total,2));
  END IF;

  FOR v_b IN SELECT band_name, score_range_min, score_range_max FROM public.ce_risk_bands
             WHERE policy_id = p_policy_id ORDER BY score_range_min LOOP
    v_bandcount := v_bandcount + 1;
    IF v_first THEN
      IF v_b.score_range_min <> 0 THEN v_errors := v_errors || format('Lowest band %s must start at 0', v_b.band_name); END IF;
      v_first := false;
    ELSE
      IF v_b.score_range_min > v_prev THEN
        v_errors := v_errors || format('Gap in risk bands between %s and %s', v_prev, v_b.score_range_min);
      ELSIF v_b.score_range_min < v_prev THEN
        v_errors := v_errors || format('Overlapping risk bands at %s', v_b.score_range_min);
      END IF;
    END IF;
    IF v_b.score_range_max <= v_b.score_range_min THEN
      v_errors := v_errors || format('Band %s has an invalid range', v_b.band_name);
    END IF;
    v_prev := v_b.score_range_max; v_last := v_b.score_range_max;
    v_bands := v_bands || jsonb_build_object('band_name',v_b.band_name,'min',v_b.score_range_min,'max',v_b.score_range_max);
  END LOOP;

  IF v_bandcount = 0 THEN v_errors := v_errors || 'Policy has no risk bands';
  ELSIF COALESCE(v_last,0) < 100 THEN v_errors := v_errors || format('Risk bands stop at %s — must cover the full score range to 100', v_last);
  END IF;

  RETURN jsonb_build_object(
    'valid', array_length(v_errors,1) IS NULL,
    'policy_id', p_policy_id, 'policy_code', v_pol.policy_code,
    'version_no', v_pol.version_no, 'weights_confirmation', v_pol.weights_confirmation,
    'weight_total', round(v_total,2), 'factors', v_factors, 'bands', v_bands,
    'errors', COALESCE(to_jsonb(v_errors), '[]'::jsonb));
END $fn$;

-- activation guard
CREATE OR REPLACE FUNCTION public.ce_risk_policy_activation_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_res jsonb;
BEGIN
  IF NEW.status = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ACTIVE'
      OR OLD.version_no IS DISTINCT FROM NEW.version_no) THEN
    v_res := public.ce_validate_risk_policy_v1(NEW.id);
    IF NOT COALESCE((v_res->>'valid')::boolean,false) THEN
      RAISE EXCEPTION 'CE-RISK-POLICY-INVALID: %', v_res->>'errors' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS zz_ce_risk_policy_activation ON public.ce_risk_policies;
CREATE CONSTRAINT TRIGGER zz_ce_risk_policy_activation
  AFTER INSERT OR UPDATE ON public.ce_risk_policies
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ce_risk_policy_activation_trg();

GRANT EXECUTE ON FUNCTION public.ce_risk_eval_threshold(numeric,text,jsonb,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_risk_measure_v1(varchar,varchar,jsonb,date,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_validate_risk_policy_v1(uuid) TO authenticated, service_role;

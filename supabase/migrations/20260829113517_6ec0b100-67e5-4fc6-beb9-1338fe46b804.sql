-- ============ CANONICAL SCORING ENGINE ============
CREATE OR REPLACE FUNCTION public.ce_score_employer_risk_v1(
  p_employer_id varchar,
  p_policy_id uuid DEFAULT NULL,
  p_as_of date DEFAULT CURRENT_DATE,
  p_persist boolean DEFAULT false,
  p_triggered_by varchar DEFAULT 'SYSTEM',
  p_run_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_pol record; v_f record; v_prof record;
  v_meas jsonb; v_eval jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_weight_total numeric := 0;
  v_band text := NULL; v_band_color text := NULL;
  v_status text; v_calc_status text := 'OPERATIONAL';
  v_errors text[] := ARRAY[]::text[];
  v_hash text; v_snapshot jsonb; v_col text; v_val jsonb := '{}'::jsonb;
  v_engine constant text := 'ce-risk-engine-v3';
  v_from date;
BEGIN
  IF p_policy_id IS NULL THEN
    SELECT * INTO v_pol FROM public.ce_risk_policies
     WHERE status = 'ACTIVE' AND effective_from <= p_as_of
       AND (effective_to IS NULL OR effective_to > p_as_of)
     ORDER BY effective_from DESC LIMIT 1;
  ELSE
    SELECT * INTO v_pol FROM public.ce_risk_policies WHERE id = p_policy_id;
  END IF;

  IF v_pol IS NULL THEN
    RETURN jsonb_build_object('ok',false,'employer_id',p_employer_id,'error','No effective risk policy');
  END IF;

  FOR v_f IN
    SELECT c.id, c.factor_code, c.factor_name, c.canonical_factor, c.measurement_code,
           c.measurement_params, c.scoring_method, c.thresholds, c.max_score, c.lifecycle_status,
           COALESCE(pf.weight_override, c.weight, 0) AS weight
    FROM public.ce_risk_policy_factors pf
    JOIN public.ce_risk_config c ON c.id = pf.factor_id
    WHERE pf.policy_id = v_pol.id AND pf.is_active = true
    ORDER BY c.canonical_factor NULLS LAST, c.factor_code
  LOOP
    v_weight_total := v_weight_total + v_f.weight;
    v_status := 'operational';

    IF v_f.measurement_code IS NULL OR v_f.lifecycle_status <> 'ACTIVE' THEN
      v_meas := jsonb_build_object('ok',false,'raw_value',0,
        'detail','No runtime measurement source configured','evidence','{}'::jsonb);
    ELSE
      v_meas := public.ce_risk_measure_v1(p_employer_id, v_f.measurement_code,
                  COALESCE(v_f.measurement_params,'{}'::jsonb), p_as_of,
                  COALESCE(v_pol.source_policy,'{}'::jsonb));
    END IF;

    v_eval := public.ce_risk_eval_threshold(
      COALESCE((v_meas->>'raw_value')::numeric,0), v_f.scoring_method, v_f.thresholds, v_f.max_score);

    IF NOT COALESCE((v_meas->>'ok')::boolean,false) OR NOT COALESCE((v_eval->>'ok')::boolean,false) THEN
      v_status := 'configuration_error';
      v_calc_status := 'CONFIGURATION_ERROR';
      v_errors := v_errors || format('%s: %s', v_f.factor_code,
        CASE WHEN COALESCE((v_meas->>'ok')::boolean,false) THEN 'no scoring thresholds' ELSE v_meas->>'detail' END);
    ELSIF v_f.weight <= 0 THEN
      v_status := 'configured';
    END IF;

    v_from := (v_meas->>'window_from')::date;

    v_breakdown := v_breakdown || jsonb_build_object(
      'factor_code', v_f.factor_code,
      'factor_name', v_f.factor_name,
      'canonical_factor', v_f.canonical_factor,
      'status', v_status,
      'measurement_code', v_f.measurement_code,
      'raw_measurement', COALESCE((v_meas->>'raw_value')::numeric,0),
      'raw_detail', v_meas->>'detail',
      'evidence', COALESCE(v_meas->'evidence','{}'::jsonb),
      'scoring_method', v_f.scoring_method,
      'threshold_used', v_eval->'tier',
      'factor_score', COALESCE((v_eval->>'score')::numeric,0),
      'weight_pct', v_f.weight,
      'weighted_contribution', round(COALESCE((v_eval->>'score')::numeric,0) * v_f.weight / 100.0, 2),
      'explanation', CASE WHEN v_status = 'configuration_error'
                          THEN 'CONFIGURATION ERROR — factor carries weight but cannot score: '
                               || COALESCE(v_eval->>'explanation', v_meas->>'detail')
                          ELSE COALESCE(v_meas->>'detail','') || ' → ' || COALESCE(v_eval->>'explanation','') END
    );

    IF v_status <> 'configuration_error' THEN
      v_total := v_total + round(COALESCE((v_eval->>'score')::numeric,0) * v_f.weight / 100.0, 2);
    END IF;
  END LOOP;

  v_total := round(v_total, 2);

  SELECT band_name, color INTO v_band, v_band_color FROM public.ce_risk_bands
   WHERE policy_id = v_pol.id AND v_total >= score_range_min
     AND (v_total < score_range_max OR score_range_max >= 100)
   ORDER BY score_range_min DESC LIMIT 1;

  IF v_band IS NULL THEN
    SELECT band_name, color INTO v_band, v_band_color FROM public.ce_risk_bands
     WHERE policy_id = v_pol.id ORDER BY score_range_min LIMIT 1;
  END IF;

  v_snapshot := jsonb_build_object(
    'policy_id', v_pol.id, 'policy_code', v_pol.policy_code, 'version_no', v_pol.version_no,
    'weights_confirmation', v_pol.weights_confirmation,
    'effective_from', v_pol.effective_from, 'source_policy', v_pol.source_policy,
    'weight_total', v_weight_total,
    'factors', (SELECT jsonb_agg(jsonb_build_object(
                  'factor_code', c.factor_code, 'canonical_factor', c.canonical_factor,
                  'weight', COALESCE(pf.weight_override, c.weight, 0),
                  'measurement_code', c.measurement_code,
                  'scoring_method', c.scoring_method, 'thresholds', c.thresholds))
                FROM public.ce_risk_policy_factors pf
                JOIN public.ce_risk_config c ON c.id = pf.factor_id
                WHERE pf.policy_id = v_pol.id AND pf.is_active = true),
    'bands', (SELECT jsonb_agg(jsonb_build_object('band_name',band_name,'min',score_range_min,'max',score_range_max)
                     ORDER BY score_range_min) FROM public.ce_risk_bands WHERE policy_id = v_pol.id));

  v_hash := md5(v_pol.id::text || COALESCE(v_pol.version_no,1)::text || v_total::text || COALESCE(v_band,'') || v_breakdown::text);

  IF p_persist THEN
    SELECT * INTO v_prof FROM public.ce_risk_profiles WHERE employer_id = p_employer_id;

    IF v_prof IS NULL THEN
      INSERT INTO public.ce_risk_profiles (employer_id, employer_name, territory, created_by, updated_by)
      SELECT p_employer_id, COALESCE(e.name,'Employer '||p_employer_id),
             CASE e.office_code WHEN 'STK' THEN 'St. Kitts' WHEN 'NEV' THEN 'Nevis' ELSE COALESCE(e.office_code,'Unknown') END,
             p_triggered_by, p_triggered_by
      FROM public.er_master e WHERE e.regno = p_employer_id
      ON CONFLICT (employer_id) DO NOTHING;
      IF NOT FOUND THEN
        INSERT INTO public.ce_risk_profiles (employer_id, employer_name, created_by, updated_by)
        VALUES (p_employer_id, 'Employer '||p_employer_id, p_triggered_by, p_triggered_by)
        ON CONFLICT (employer_id) DO NOTHING;
      END IF;
      SELECT * INTO v_prof FROM public.ce_risk_profiles WHERE employer_id = p_employer_id;
    END IF;

    -- per-canonical-factor legacy score columns
    SELECT jsonb_object_agg(b->>'canonical_factor', (b->>'weighted_contribution')::numeric) INTO v_val
    FROM jsonb_array_elements(v_breakdown) b WHERE b->>'canonical_factor' IS NOT NULL;
    v_val := COALESCE(v_val,'{}'::jsonb);

    UPDATE public.ce_risk_profiles SET
      total_score = v_total,
      risk_band = CASE WHEN override_band IS NOT NULL THEN risk_band ELSE v_band END,
      payment_behavior_score = COALESCE((v_val->>'PAYMENT')::numeric,0),
      filing_score = COALESCE((v_val->>'FILING')::numeric,0),
      violation_score = COALESCE((v_val->>'VIOLATION')::numeric,0),
      legal_history_score = COALESCE((v_val->>'LEGAL')::numeric,0),
      enforcement_risk_score = COALESCE((v_val->>'ARRANGEMENT')::numeric,0),
      arrears_score = 0,
      policy_id = v_pol.id, policy_version = v_pol.version_no,
      factor_breakdown = v_breakdown, engine_version = v_engine,
      calculation_status = v_calc_status, score_hash = v_hash,
      scoring_version = v_engine, last_recalc_policy_id = v_pol.id,
      last_calculated_at = now(), updated_by = p_triggered_by, updated_at = now()
    WHERE id = v_prof.id;

    IF v_prof.score_hash IS DISTINCT FROM v_hash THEN
      INSERT INTO public.ce_risk_score_history (
        risk_profile_id, previous_score, new_score, previous_band, new_band,
        calculation_details, calculated_by, policy_id, policy_version, policy_snapshot,
        factor_breakdown, source_period_from, source_period_to, engine_version, score_hash, run_id)
      VALUES (
        v_prof.id, COALESCE(v_prof.total_score,0), v_total,
        COALESCE(v_prof.risk_band,'UNSCORED'), v_band,
        jsonb_build_object('policy_code', v_pol.policy_code, 'engine', v_engine,
          'weight_total', v_weight_total, 'calculation_status', v_calc_status,
          'factor_breakdown', v_breakdown, 'errors', to_jsonb(v_errors)),
        p_triggered_by, v_pol.id, v_pol.version_no, v_snapshot, v_breakdown,
        v_from, p_as_of, v_engine, v_hash, p_run_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', v_calc_status = 'OPERATIONAL',
    'employer_id', p_employer_id, 'as_of', p_as_of,
    'policy_id', v_pol.id, 'policy_code', v_pol.policy_code, 'policy_version', v_pol.version_no,
    'weights_confirmation', v_pol.weights_confirmation,
    'weight_total', v_weight_total, 'total_score', v_total,
    'risk_band', v_band, 'band_color', v_band_color,
    'calculation_status', v_calc_status, 'errors', to_jsonb(v_errors),
    'engine_version', v_engine, 'persisted', p_persist,
    'score_hash', v_hash, 'factors', v_breakdown);
END $fn$;

-- ============ BATCH RECALCULATION ============
CREATE OR REPLACE FUNCTION public.ce_run_risk_recalculation_v1(
  p_employer_id varchar DEFAULT NULL,
  p_limit integer DEFAULT 1000,
  p_dry_run boolean DEFAULT false,
  p_triggered_by varchar DEFAULT 'SYSTEM',
  p_as_of date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_pol record; v_valid jsonb; v_run_id uuid; v_job uuid;
  v_e record; v_res jsonb;
  v_processed int := 0; v_changed int := 0; v_errors int := 0;
BEGIN
  SELECT * INTO v_pol FROM public.ce_risk_policies
   WHERE status = 'ACTIVE' AND effective_from <= p_as_of
     AND (effective_to IS NULL OR effective_to > p_as_of)
   ORDER BY effective_from DESC LIMIT 1;
  IF v_pol IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','No effective ACTIVE risk policy');
  END IF;

  v_valid := public.ce_validate_risk_policy_v1(v_pol.id);
  IF NOT COALESCE((v_valid->>'valid')::boolean,false) THEN
    RETURN jsonb_build_object('ok',false,'error','Active risk policy is invalid — recalculation refused',
                              'validation', v_valid);
  END IF;

  SELECT id INTO v_job FROM public.ce_automation_jobs WHERE job_code = 'RISK_RECALC' LIMIT 1;

  IF NOT p_dry_run THEN
    INSERT INTO public.ce_automation_runs (job_id, started_at, status, triggered_by, idempotency_key)
    VALUES (v_job, now(), 'Running', p_triggered_by,
            'risk-recalc-'||to_char(now(),'YYYYMMDDHH24MISSMS')||COALESCE('-'||p_employer_id,''))
    RETURNING id INTO v_run_id;
  END IF;

  FOR v_e IN
    SELECT regno AS employer_id FROM public.er_master
     WHERE status = 'A' AND (p_employer_id IS NULL OR regno = p_employer_id)
     ORDER BY regno LIMIT p_limit
  LOOP
    BEGIN
      v_res := public.ce_score_employer_risk_v1(v_e.employer_id, v_pol.id, p_as_of,
                                                NOT p_dry_run, p_triggered_by, v_run_id);
      v_processed := v_processed + 1;
      IF COALESCE((v_res->>'ok')::boolean,false) THEN v_changed := v_changed + 1; ELSE v_errors := v_errors + 1; END IF;
    EXCEPTION WHEN OTHERS THEN v_errors := v_errors + 1;
    END;
  END LOOP;

  IF NOT p_dry_run THEN
    UPDATE public.ce_automation_runs SET
      completed_at = now(),
      status = CASE WHEN v_errors > 0 THEN 'CompletedWithErrors' ELSE 'Completed' END,
      records_processed = v_processed, records_affected = v_changed,
      execution_log = jsonb_build_object('policy', v_pol.policy_code, 'policy_version', v_pol.version_no,
        'engine','ce-risk-engine-v3','errors', v_errors, 'as_of', p_as_of)
    WHERE id = v_run_id;
    IF v_job IS NOT NULL THEN
      UPDATE public.ce_automation_jobs SET last_run_at = now(),
        last_run_status = CASE WHEN v_errors > 0 THEN 'CompletedWithErrors' ELSE 'Completed' END
      WHERE id = v_job;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok',true,'run_id',v_run_id,'policy_code',v_pol.policy_code,
    'policy_version',v_pol.version_no,'processed',v_processed,'scored',v_changed,
    'errors',v_errors,'dry_run',p_dry_run,'engine','ce-risk-engine-v3');
END $fn$;

-- ============ LEGACY ROUTINES NOW DELEGATE ============
CREATE OR REPLACE FUNCTION public.ce_recompute_employer_risk(
  p_employer_id character varying, p_triggered_by character varying DEFAULT 'SYSTEM')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN public.ce_score_employer_risk_v1(p_employer_id, NULL, CURRENT_DATE, true, p_triggered_by, NULL);
END $fn$;

CREATE OR REPLACE FUNCTION public.ce_run_employer_risk_refresh(
  p_dry_run boolean DEFAULT false, p_batch_size integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_res jsonb;
BEGIN
  v_res := public.ce_run_risk_recalculation_v1(NULL, p_batch_size, p_dry_run, 'UI_MANUAL', CURRENT_DATE);
  RETURN v_res || jsonb_build_object('affected', v_res->'scored');
END $fn$;

GRANT EXECUTE ON FUNCTION public.ce_score_employer_risk_v1(varchar,uuid,date,boolean,varchar,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_run_risk_recalculation_v1(varchar,integer,boolean,varchar,date) TO authenticated, service_role;

-- ============ FIVE-FACTOR CONFIGURATION ============
UPDATE public.ce_risk_config
   SET thresholds = (thresholds #>> '{}')::jsonb
 WHERE thresholds IS NOT NULL AND jsonb_typeof(thresholds) = 'string';

UPDATE public.ce_risk_config SET
  factor_name = 'Payment / Contribution Compliance',
  description = 'Overdue contribution principal measured from the canonical Checkpoint C-L1 ledger views (cached balances and unapproved retrospective interest excluded).',
  canonical_factor = 'PAYMENT', measurement_code = 'PAYMENT_OVERDUE_PRINCIPAL_RATIO',
  measurement_params = '{"lookback_months":12}'::jsonb,
  scoring_method = 'tiered', category = 'COMPLIANCE', data_source = 'CE_LEDGER_CANONICAL',
  max_score = 100, lifecycle_status = 'ACTIVE',
  thresholds = '[{"min":0,"max":5,"score":0,"label":"Compliant (≤5% overdue)"},
                 {"min":5.01,"max":15,"score":25,"label":"Minor (5–15%)"},
                 {"min":15.01,"max":30,"score":50,"label":"Moderate (15–30%)"},
                 {"min":30.01,"max":60,"score":80,"label":"Serious (30–60%)"},
                 {"min":60.01,"max":100,"score":100,"label":"Severe (>60%)"}]'::jsonb
 WHERE factor_code = 'payment';

UPDATE public.ce_risk_config SET
  factor_name = 'C3 Filing / Reporting Compliance',
  description = 'Late (DR-001) and unreported (DR-002) C3 periods against the authoritative Checkpoint A obligation timeline. Validly submitted NIL returns count as filings.',
  canonical_factor = 'FILING', measurement_code = 'FILING_LATE_OR_MISSING_COUNT',
  measurement_params = '{"lookback_months":12}'::jsonb,
  scoring_method = 'tiered', category = 'COMPLIANCE', data_source = 'CE_OBLIGATION_TIMELINE',
  max_score = 100, lifecycle_status = 'ACTIVE',
  thresholds = '[{"min":0,"max":0,"score":0,"label":"All periods filed on time"},
                 {"min":1,"max":2,"score":25,"label":"1–2 late/missing periods"},
                 {"min":3,"max":5,"score":50,"label":"3–5 late/missing periods"},
                 {"min":6,"max":11,"score":80,"label":"6–11 late/missing periods"},
                 {"min":12,"max":9999,"score":100,"label":"12+ late/missing periods"}]'::jsonb
 WHERE factor_code = 'filings';

UPDATE public.ce_risk_config SET
  factor_name = 'Violation / Repeat-Offender History',
  description = 'Confirmed violations excluding filing, payment and arrangement rule types (scored by their own factors), plus confirmed DR-005 repeat-offender findings.',
  canonical_factor = 'VIOLATION', measurement_code = 'VIOLATION_CONFIRMED_COUNT',
  measurement_params = '{"lookback_months":24,"repeat_offender_weight":2}'::jsonb,
  scoring_method = 'tiered', category = 'COMPLIANCE', data_source = 'CE_VIOLATIONS',
  max_score = 100, lifecycle_status = 'ACTIVE'
 WHERE factor_code = 'violations';

UPDATE public.ce_risk_config SET
  factor_code = 'arrangement',
  factor_name = 'Payment Arrangement / Breach History',
  description = 'Arrangement breaches (DR-006 and recorded breach events). A healthy arrangement scores zero.',
  canonical_factor = 'ARRANGEMENT', measurement_code = 'ARRANGEMENT_BREACH_COUNT',
  measurement_params = '{"lookback_months":24}'::jsonb,
  scoring_method = 'tiered', category = 'COMPLIANCE', data_source = 'CE_ARRANGEMENTS',
  weight = 10, max_score = 100, lifecycle_status = 'ACTIVE', is_enabled = true,
  thresholds = '[{"min":0,"max":0,"score":0,"label":"No breaches / healthy arrangement"},
                 {"min":1,"max":1,"score":50,"label":"1 breach"},
                 {"min":2,"max":3,"score":80,"label":"2–3 breaches"},
                 {"min":4,"max":999,"score":100,"label":"4+ breaches"}]'::jsonb
 WHERE factor_code = 'arrangement_breach';

UPDATE public.ce_risk_config SET
  factor_name = 'Legal / Enforcement History',
  description = 'Highest legal/enforcement stage reached: demand issued, approved referral with Legal, or an active legal case. Pending recommendations do not score unless policy enables it.',
  canonical_factor = 'LEGAL', measurement_code = 'LEGAL_STAGE_LEVEL',
  measurement_params = '{"count_pending_recommendation":false}'::jsonb,
  scoring_method = 'tiered', category = 'LEGAL', data_source = 'CE_LEGAL_ENFORCEMENT',
  max_score = 100, lifecycle_status = 'ACTIVE',
  thresholds = '[{"min":0,"max":0,"score":0,"label":"No enforcement history"},
                 {"min":1,"max":1,"score":40,"label":"Demand notice issued"},
                 {"min":2,"max":2,"score":75,"label":"Approved legal referral"},
                 {"min":3,"max":9,"score":100,"label":"Legal case / proceeding"}]'::jsonb
 WHERE factor_code = 'legal';

UPDATE public.ce_risk_config SET
  lifecycle_status = 'RETIRED', is_enabled = false,
  description = 'RETIRED at Checkpoint E — arrears are now measured inside the Payment / Contribution Compliance factor from canonical C-L1 views. Retained for historical score interpretation.'
 WHERE factor_code = 'arrears';

DELETE FROM public.ce_risk_policy_factors pf
 USING public.ce_risk_config c
 WHERE pf.factor_id = c.id AND c.factor_code = 'arrears';

INSERT INTO public.ce_risk_policy_factors (policy_id, factor_id, weight_override, is_active, created_by)
SELECT p.id, c.id, 10, true, 'checkpoint-e'
FROM public.ce_risk_policies p, public.ce_risk_config c
WHERE p.policy_code = 'RP-2026-001' AND c.factor_code = 'arrangement'
ON CONFLICT (policy_id, factor_id) DO UPDATE SET weight_override = 10, is_active = true;

UPDATE public.ce_risk_policy_factors pf SET weight_override = v.w, is_active = true
FROM public.ce_risk_config c, (VALUES ('payment',30),('filings',20),('violations',20),('legal',20)) AS v(code,w)
WHERE pf.factor_id = c.id AND c.factor_code = v.code
  AND pf.policy_id = (SELECT id FROM public.ce_risk_policies WHERE policy_code = 'RP-2026-001');

-- bands: continuous, no gaps, configurable
UPDATE public.ce_risk_bands SET score_range_min = 0,  score_range_max = 25  WHERE band_name = 'LOW';
UPDATE public.ce_risk_bands SET score_range_min = 25, score_range_max = 50  WHERE band_name = 'MEDIUM';
UPDATE public.ce_risk_bands SET score_range_min = 50, score_range_max = 75  WHERE band_name = 'HIGH';
UPDATE public.ce_risk_bands SET score_range_min = 75, score_range_max = 100 WHERE band_name = 'CRITICAL';

UPDATE public.ce_risk_policies SET
  version_no = version_no + 1,
  weights_confirmation = 'PROVISIONAL_AWAITING_CLIENT_CONFIRMATION',
  source_policy = '{
    "include_unconfirmed_review_flags": false,
    "confirmed_violation_statuses": ["OPEN","IN_PROGRESS","ESCALATED","RESOLVED","CLOSED"],
    "unconfirmed_review_flag_examples": ["headcount anomaly (EMPLOYEE_DISCREPANCY under review)","wage anomaly","unregistered-employer lead","DR-005 repeat-offender review flag"],
    "waived_violation_treatment": "EXCLUDE",
    "healthy_arrangement_counts": false,
    "financial_basis": "ce_v_employer_outstanding (C-L1 derived); cached ce_ledger_periods.balance excluded",
    "exclude_unapproved_retrospective_interest": true,
    "high_risk_auto_legal_referral": false
  }'::jsonb,
  updated_by = 'checkpoint-e', updated_at = now()
WHERE policy_code = 'RP-2026-001';

INSERT INTO public.ce_open_business_decision
  (decision_code, title, rule_code, status, confirmed_basis, unconfirmed_items, runtime_guard, raised_by)
VALUES (
  'E-RISK-FACTOR-WEIGHTS',
  'Compliance risk factor weights for the approved five-factor model',
  'CE-RISK-001', 'OPEN',
  'Five factors agreed 17/20/24 August 2026: Payment/Contribution Compliance, C3 Filing Compliance, Violation/Repeat-Offender History, Arrangement Breach History, Legal/Enforcement History. Weights must total 100%.',
  '["exact percentage weight per factor","measurement window lengths per factor","threshold point values per band of each factor","risk band cut-offs"]'::jsonb,
  'Active policy weights are stored as PROVISIONAL_AWAITING_CLIENT_CONFIRMATION and surfaced as provisional in the Risk Rule Policy page and in every score explanation.',
  'checkpoint-e')
ON CONFLICT (decision_code) DO UPDATE SET status = 'OPEN', updated_at = now();

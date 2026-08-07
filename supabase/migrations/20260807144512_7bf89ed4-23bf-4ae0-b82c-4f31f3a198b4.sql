-- =====================================================================
-- MEANS-TEST EPIC 9 — Calculation and Explanation
-- Extends the MT6 engine. No second engine, no duplicate tables.
-- =====================================================================

-- ---------- 1. Calculation record: business summary + currency -------
ALTER TABLE public.bn_means_calculation
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_calculation_id uuid,
  ADD COLUMN IF NOT EXISTS sequence_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trigger_reason text NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN IF NOT EXISTS verification_revision_hash text,
  ADD COLUMN IF NOT EXISTS verification_revision_no integer,
  ADD COLUMN IF NOT EXISTS policy_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS gross_income numeric(18,2),
  ADD COLUMN IF NOT EXISTS income_disregard_total numeric(18,2),
  ADD COLUMN IF NOT EXISTS gross_assets numeric(18,2),
  ADD COLUMN IF NOT EXISTS asset_disregard_total numeric(18,2),
  ADD COLUMN IF NOT EXISTS claimed_deductions numeric(18,2),
  ADD COLUMN IF NOT EXISTS asset_threshold_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS shortfall_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS excluded_fact_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS bn_means_calculation_current_idx
  ON public.bn_means_calculation(assessment_id) WHERE is_current;

ALTER TABLE public.bn_means_calculation_line
  ADD COLUMN IF NOT EXISTS group_code text,
  ADD COLUMN IF NOT EXISTS display_order integer,
  ADD COLUMN IF NOT EXISTS business_label text,
  ADD COLUMN IF NOT EXISTS treatment_code text,
  ADD COLUMN IF NOT EXISTS member_label text,
  ADD COLUMN IF NOT EXISTS explanation text,
  ADD COLUMN IF NOT EXISTS policy_rule_code text,
  ADD COLUMN IF NOT EXISTS claimed_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS disregard_amount numeric(18,2);

-- ---------- 2. Verification revision (Epic 8 authoritative) ----------
CREATE OR REPLACE FUNCTION public._bn_means_verification_revision(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_av public.bn_means_assessment_version%ROWTYPE;
  v_rows jsonb;
  v_no   integer := 0;
BEGIN
  SELECT * INTO v_av FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('assessment_version_id', NULL, 'revision_no', 0,
                              'revision_hash', NULL, 'outcomes', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'work_id', w.work_id, 'fact_kind', w.fact_kind, 'fact_id', w.fact_ref_id,
           'status', w.status, 'outcome', w.outcome, 'review_round', w.review_round)
           ORDER BY w.fact_kind, w.work_id), '[]'::jsonb),
         COALESCE(sum(COALESCE(w.review_round,1)),0)
    INTO v_rows, v_no
    FROM public.bn_means_verification_work w
   WHERE w.assessment_version_id = v_av.assessment_version_id;

  RETURN jsonb_build_object(
    'assessment_version_id', v_av.assessment_version_id,
    'snapshot_hash', v_av.snapshot_hash,
    'revision_no', v_no,
    'revision_hash', encode(digest(v_av.snapshot_hash || '|' || v_rows::text, 'sha256'), 'hex'),
    'outcomes', v_rows);
END;
$function$;

-- ---------- 3. Policy parameter resolution (alias tolerant) ----------
CREATE OR REPLACE FUNCTION public._bn_means_calc_parameters(p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
DECLARE
  p        jsonb := COALESCE(p_params, '{}'::jsonb);
  v_basis  text  := upper(COALESCE(p->>'threshold_basis', 'ANNUAL'));
  v_mult   numeric := CASE upper(COALESCE(p->>'threshold_basis','ANNUAL'))
                        WHEN 'MONTHLY' THEN 12 WHEN 'WEEKLY' THEN 52 ELSE 1 END;
  v_thr    numeric;
  v_src    text;
  v_per    numeric;
  v_dis    numeric;
  v_asset  numeric;
  v_missing jsonb := '[]'::jsonb;
BEGIN
  v_thr := COALESCE(NULLIF(p->>'base_threshold_annual','')::numeric,
                    NULLIF(p->>'income_threshold','')::numeric);
  v_src := CASE WHEN NULLIF(p->>'base_threshold_annual','') IS NOT NULL THEN 'base_threshold_annual'
                WHEN NULLIF(p->>'income_threshold','') IS NOT NULL THEN 'income_threshold' END;
  v_per := COALESCE(NULLIF(p->>'per_additional_member_annual','')::numeric,
                    NULLIF(p->>'per_member_increment','')::numeric, 0);
  v_dis := COALESCE(NULLIF(p->>'income_disregard_annual','')::numeric,
                    NULLIF(p->>'disregard','')::numeric, 0);
  v_asset := COALESCE(NULLIF(p->>'asset_threshold_amount','')::numeric,
                      NULLIF(p->>'asset_threshold','')::numeric);

  IF v_thr IS NULL THEN
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'code','POLICY_PARAMETER_MISSING','parameter','income_threshold',
      'message','The policy version does not define an income threshold.'));
  END IF;

  RETURN jsonb_build_object(
    'threshold_basis', v_basis,
    'basis_multiplier', v_mult,
    'income_threshold_annual', v_thr * v_mult,
    'income_threshold_source', v_src,
    'per_additional_member_annual', v_per * v_mult,
    'income_disregard_annual', v_dis * v_mult,
    'asset_threshold_amount', v_asset,
    'missing', v_missing);
END;
$function$;

-- ---------- 4. Calculation readiness (Epic 8 driven) -----------------
CREATE OR REPLACE FUNCTION public._bn_means_calculation_readiness(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a      public.bn_means_assessment%ROWTYPE;
  v_av     public.bn_means_assessment_version%ROWTYPE;
  v_pv     public.bn_means_policy_version%ROWTYPE;
  v_vr     jsonb;
  v_rev    jsonb;
  v_params jsonb := '{}'::jsonb;
  v_block  jsonb := '[]'::jsonb;
  v_codes  jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_reject  jsonb := '[]'::jsonb;
  v_clar    jsonb := '[]'::jsonb;
  v_curr    jsonb := '[]'::jsonb;
  v_calc   public.bn_means_calculation%ROWTYPE;
  v_current boolean := false;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('assessment_id', p_assessment_id, 'ready_for_calculation', false,
      'reason_codes', jsonb_build_array('ASSESSMENT_NOT_FOUND'),
      'blockers', jsonb_build_array(jsonb_build_object('code','ASSESSMENT_NOT_FOUND',
        'message','This assessment could not be found.')),
      'missing_verifications','[]'::jsonb,'rejected_facts','[]'::jsonb,
      'clarification_required','[]'::jsonb,'policy_configuration_issues','[]'::jsonb,
      'currency_issues','[]'::jsonb);
  END IF;

  SELECT * INTO v_av FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;

  v_vr  := public._bn_means_verification_readiness(p_assessment_id);
  v_rev := public._bn_means_verification_revision(p_assessment_id);

  IF v_av.assessment_version_id IS NULL THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','FROZEN_VERSION_MISSING',
      'message','This assessment has not been submitted, so there is nothing to calculate.'));
    v_codes := v_codes || '"FROZEN_VERSION_MISSING"'::jsonb;
  ELSIF NOT COALESCE((v_vr->>'snapshot_hash_valid')::boolean,false) THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','FROZEN_VERSION_TAMPERED',
      'message','The submitted declaration no longer matches its recorded fingerprint.'));
    v_codes := v_codes || '"FROZEN_VERSION_TAMPERED"'::jsonb;
  END IF;

  -- Epic 8 is authoritative for verification completeness.
  IF v_av.assessment_version_id IS NOT NULL THEN
    IF NOT COALESCE((v_vr->>'verification_complete')::boolean,false) THEN
      v_block := v_block || COALESCE(v_vr->'blockers','[]'::jsonb);
      v_codes := v_codes || COALESCE(v_vr->'reason_codes','[]'::jsonb);
    ELSIF NOT COALESCE((v_vr->>'verification_marked_complete')::boolean,false) THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','VERIFICATION_NOT_COMPLETED',
        'message','Verification has not been marked complete.'));
      v_codes := v_codes || '"VERIFICATION_NOT_COMPLETED"'::jsonb;
    END IF;

    SELECT
      COALESCE(jsonb_agg(jsonb_build_object('fact_kind', w.fact_kind, 'fact_id', w.fact_ref_id)
               ORDER BY w.fact_kind) FILTER (WHERE w.status IN ('PENDING','IN_PROGRESS')), '[]'::jsonb),
      COALESCE(jsonb_agg(jsonb_build_object('fact_kind', w.fact_kind, 'fact_id', w.fact_ref_id)
               ORDER BY w.fact_kind) FILTER (WHERE w.status = 'COMPLETED' AND w.outcome = 'REJECTED'), '[]'::jsonb),
      COALESCE(jsonb_agg(jsonb_build_object('fact_kind', w.fact_kind, 'fact_id', w.fact_ref_id)
               ORDER BY w.fact_kind) FILTER (WHERE w.status = 'CLARIFICATION_PENDING'), '[]'::jsonb)
      INTO v_missing, v_reject, v_clar
      FROM public.bn_means_verification_work w
     WHERE w.assessment_version_id = v_av.assessment_version_id;
  END IF;

  -- Policy configuration.
  SELECT * INTO v_pv FROM public.bn_means_policy_version
   WHERE policy_version_id = v_a.policy_version_id;
  IF NOT FOUND THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','POLICY_VERSION_MISSING',
      'message','No policy version is bound to this assessment.'));
    v_codes := v_codes || '"POLICY_VERSION_MISSING"'::jsonb;
  ELSE
    v_params := public._bn_means_calc_parameters(v_pv.threshold_parameters);
    IF jsonb_array_length(COALESCE(v_params->'missing','[]'::jsonb)) > 0 THEN
      v_block := v_block || (v_params->'missing');
      v_codes := v_codes || '"POLICY_PARAMETER_MISSING"'::jsonb;
    END IF;
    IF v_pv.currency_code IS NOT NULL AND v_a.currency_code IS NOT NULL
       AND v_pv.currency_code <> v_a.currency_code THEN
      v_curr := v_curr || jsonb_build_array(jsonb_build_object('scope','POLICY',
        'expected', v_a.currency_code, 'found', v_pv.currency_code));
    END IF;
    IF v_pv.effective_from IS NOT NULL AND v_a.effective_from IS NOT NULL
       AND v_a.effective_from < v_pv.effective_from THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','POLICY_NOT_EFFECTIVE',
        'message','The bound policy version is not effective on the assessment date.'));
      v_codes := v_codes || '"POLICY_NOT_EFFECTIVE"'::jsonb;
    END IF;
  END IF;

  -- Currency consistency of the frozen facts.
  IF v_av.assessment_version_id IS NOT NULL THEN
    v_curr := v_curr || COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope', s.scope, 'fact_id', s.fact_id,
                                          'expected', v_a.currency_code, 'found', s.cur))
        FROM (
          SELECT 'INCOME' scope, x.income_fact_id fact_id, x.currency_code cur
            FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'income','[]'::jsonb))
                 AS x(income_fact_id uuid, currency_code text)
          UNION ALL
          SELECT 'ASSET', y.asset_fact_id, y.currency_code
            FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'assets','[]'::jsonb))
                 AS y(asset_fact_id uuid, currency_code text)
          UNION ALL
          SELECT 'DEDUCTION', z.deduction_fact_id, z.currency_code
            FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'deductions','[]'::jsonb))
                 AS z(deduction_fact_id uuid, currency_code text)
        ) s
       WHERE s.cur IS NOT NULL AND s.cur <> COALESCE(v_a.currency_code, s.cur)), '[]'::jsonb);
  END IF;

  IF jsonb_array_length(v_curr) > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','CURRENCY_MISMATCH',
      'message', jsonb_array_length(v_curr) || ' item(s) are recorded in a different currency to the assessment.'));
    v_codes := v_codes || '"CURRENCY_MISMATCH"'::jsonb;
  END IF;

  IF v_av.assessment_version_id IS NOT NULL
     AND jsonb_array_length(COALESCE(v_av.snapshot->'income','[]'::jsonb))
       + jsonb_array_length(COALESCE(v_av.snapshot->'assets','[]'::jsonb)) = 0
     AND jsonb_array_length(COALESCE(v_av.snapshot->'household','[]'::jsonb)) = 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','NO_ASSESSABLE_FACTS',
      'message','The submitted declaration contains no household, income or asset information.'));
    v_codes := v_codes || '"NO_ASSESSABLE_FACTS"'::jsonb;
  END IF;

  SELECT * INTO v_calc FROM public.bn_means_calculation
   WHERE assessment_id = p_assessment_id AND is_current ORDER BY sequence_no DESC LIMIT 1;
  IF FOUND THEN
    v_current := (v_calc.verification_revision_hash IS NOT DISTINCT FROM (v_rev->>'revision_hash'));
  END IF;

  RETURN jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_version_id', v_av.assessment_version_id,
    'status', v_a.status,
    'currency_code', v_a.currency_code,
    'ready_for_calculation', (jsonb_array_length(v_block) = 0),
    'blockers', v_block,
    'reason_codes', v_codes,
    'missing_verifications', v_missing,
    'rejected_facts', v_reject,
    'clarification_required', v_clar,
    'policy_configuration_issues', COALESCE(v_params->'missing','[]'::jsonb),
    'policy_parameters', v_params,
    'currency_issues', v_curr,
    'verification_complete', COALESCE((v_vr->>'verification_complete')::boolean,false),
    'verification_marked_complete', COALESCE((v_vr->>'verification_marked_complete')::boolean,false),
    'verification_outcome', v_vr->>'verification_outcome',
    'verification_revision_hash', v_rev->>'revision_hash',
    'verification_revision_no', (v_rev->>'revision_no')::int,
    'has_calculation', (v_calc.calculation_id IS NOT NULL),
    'current_calculation_id', v_calc.calculation_id,
    'calculation_current', v_current,
    'calculation_stale', (v_calc.calculation_id IS NOT NULL AND NOT v_current));
END;
$function$;

-- MT6 entry point preserved: delegates to the Epic 9 authority.
CREATE OR REPLACE FUNCTION public._bn_means_readiness(p_assessment_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT public._bn_means_calculation_readiness(p_assessment_id);
$function$;

-- ---------- 5. The engine -------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_calculate_v1(
  p_assessment_id uuid, p_actor_user_id uuid, p_correlation_id uuid, p_trigger text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_a       public.bn_means_assessment%ROWTYPE;
  v_av      public.bn_means_assessment_version%ROWTYPE;
  v_pv      public.bn_means_policy_version%ROWTYPE;
  v_prev    public.bn_means_calculation%ROWTYPE;
  v_calc    public.bn_means_calculation%ROWTYPE;
  v_ready   jsonb;
  v_rev     jsonb;
  v_params  jsonb;
  v_inputs  jsonb;
  v_hash    text;
  v_method  text;
  v_scale   int;
  v_hh      int := 0;
  v_income  numeric := 0;
  v_gross_i numeric := 0;
  v_dis     numeric := 0;
  v_ded_cl  numeric := 0;
  v_ded     numeric := 0;
  v_assets  numeric := 0;
  v_gross_a numeric := 0;
  v_adis    numeric := 0;
  v_thr     numeric;
  v_athr    numeric;
  v_assess  numeric;
  v_excess  numeric;
  v_short   numeric;
  v_res     text;
  v_warn    jsonb := '[]'::jsonb;
  v_excl    int := 0;
  v_seq     int;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment
   WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:assessment'; END IF;
  IF v_a.status NOT IN ('VERIFICATION_PENDING','CALCULATED') THEN
    RAISE EXCEPTION 'E_INVALID_STATE:% -> CALCULATED', v_a.status;
  END IF;

  v_ready := public._bn_means_calculation_readiness(p_assessment_id);
  IF NOT COALESCE((v_ready->>'ready_for_calculation')::boolean,false) THEN
    RAISE EXCEPTION 'E_NOT_READY_FOR_CALCULATION:%',
      COALESCE(v_ready->'blockers'->0->>'code','NOT_READY');
  END IF;

  SELECT * INTO v_av FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;
  IF encode(digest(v_av.snapshot::text,'sha256'),'hex') <> v_av.snapshot_hash THEN
    RAISE EXCEPTION 'E_FROZEN_VERSION_TAMPERED:%', v_av.assessment_version_id;
  END IF;

  SELECT * INTO v_pv FROM public.bn_means_policy_version
   WHERE policy_version_id = v_a.policy_version_id;
  v_params := public._bn_means_calc_parameters(v_pv.threshold_parameters);
  v_method := COALESCE(v_pv.rounding_method,'HALF_UP');
  v_scale  := COALESCE(v_pv.rounding_scale, 2);
  v_rev    := public._bn_means_verification_revision(p_assessment_id);

  v_inputs := jsonb_build_object(
    'assessment_version_id', v_av.assessment_version_id,
    'snapshot_hash', v_av.snapshot_hash,
    'policy_version_id', v_pv.policy_version_id,
    'engine_version', 'bn-means-engine-1.1.0',
    'effective_date', v_a.effective_from,
    'currency_code', v_a.currency_code,
    'policy_parameters', v_params,
    'rounding', jsonb_build_object('method', v_method, 'scale', v_scale),
    'verification_revision', v_rev);
  v_hash := encode(digest(v_inputs::text,'sha256'),'hex');

  SELECT * INTO v_prev FROM public.bn_means_calculation
   WHERE assessment_id = p_assessment_id AND is_current
   ORDER BY sequence_no DESC LIMIT 1;

  IF FOUND AND v_prev.input_hash = v_hash THEN
    RETURN jsonb_build_object('assessment_id', p_assessment_id,
      'calculation_id', v_prev.calculation_id, 'input_hash', v_prev.input_hash,
      'result', v_prev.result, 'deduplicated', true, 'event_code','CALCULATED');
  END IF;

  -- Effective facts: verified only. Rejected / not-applicable are excluded.
  CREATE TEMP TABLE IF NOT EXISTS _mt_out(fact_kind text, fact_id uuid, outcome text) ON COMMIT DROP;
  DELETE FROM _mt_out;
  INSERT INTO _mt_out(fact_kind, fact_id, outcome)
  SELECT w.fact_kind, w.fact_ref_id, w.outcome
    FROM public.bn_means_verification_work w
   WHERE w.assessment_version_id = v_av.assessment_version_id
     AND w.fact_ref_id IS NOT NULL AND w.status = 'COMPLETED';

  SELECT count(*) INTO v_hh
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'household','[]'::jsonb)) AS x(member_id uuid)
    LEFT JOIN _mt_out o ON o.fact_kind='HOUSEHOLD' AND o.fact_id = x.member_id
   WHERE COALESCE(o.outcome,'VERIFIED') = 'VERIFIED';

  SELECT COALESCE(sum(public._bn_means_round(
           COALESCE(x.normalised_annual_amount,
                    public._bn_means_annualise(x.declared_amount, x.declared_frequency)),
           v_method, v_scale)), 0),
         COALESCE(sum(public._bn_means_round(
           COALESCE(x.normalised_annual_amount,
                    public._bn_means_annualise(x.declared_amount, x.declared_frequency)),
           v_method, v_scale)) FILTER (WHERE COALESCE(o.outcome,'VERIFIED') = 'VERIFIED'
                                         AND NOT COALESCE(x.disregard_candidate,false)), 0)
    INTO v_gross_i, v_income
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'income','[]'::jsonb))
         AS x(income_fact_id uuid, declared_amount numeric, declared_frequency text,
              normalised_annual_amount numeric, disregard_candidate boolean)
    LEFT JOIN _mt_out o ON o.fact_kind='INCOME' AND o.fact_id = x.income_fact_id;

  SELECT COALESCE(sum(public._bn_means_round(
           x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale)),0),
         COALESCE(sum(public._bn_means_round(
           x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale))
           FILTER (WHERE COALESCE(o.outcome,'VERIFIED') = 'VERIFIED'
                     AND NOT COALESCE(x.disregard_candidate,false)),0)
    INTO v_gross_a, v_assets
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'assets','[]'::jsonb))
         AS x(asset_fact_id uuid, valuation_amount numeric, ownership_share numeric,
              disregard_candidate boolean)
    LEFT JOIN _mt_out o ON o.fact_kind='ASSET' AND o.fact_id = x.asset_fact_id;
  v_adis := public._bn_means_round(GREATEST(v_gross_a - v_assets, 0), v_method, v_scale);

  SELECT COALESCE(sum(public._bn_means_round(
           COALESCE(x.normalised_annual_amount,
                    public._bn_means_annualise(x.claimed_amount, x.declared_frequency)),
           v_method, v_scale)),0),
         COALESCE(sum(public._bn_means_round(
           COALESCE(x.normalised_annual_amount,
                    public._bn_means_annualise(x.claimed_amount, x.declared_frequency)),
           v_method, v_scale))
           FILTER (WHERE COALESCE(o.outcome,'VERIFIED') = 'VERIFIED'
                     AND COALESCE(x.approval_status,'CLAIMED') <> 'REJECTED'
                     AND COALESCE(x.treatment_status,'ALLOWED') <> 'DISALLOWED'),0)
    INTO v_ded_cl, v_ded
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'deductions','[]'::jsonb))
         AS x(deduction_fact_id uuid, claimed_amount numeric, declared_frequency text,
              normalised_annual_amount numeric, approval_status text, treatment_status text)
    LEFT JOIN _mt_out o ON o.fact_kind='DEDUCTION' AND o.fact_id = x.deduction_fact_id;

  SELECT count(*) INTO v_excl FROM _mt_out WHERE outcome IN ('REJECTED','NOT_APPLICABLE');

  v_dis    := public._bn_means_round(
                LEAST(COALESCE((v_params->>'income_disregard_annual')::numeric,0), v_income),
                v_method, v_scale);
  v_thr    := public._bn_means_round(
                (v_params->>'income_threshold_annual')::numeric
                + COALESCE((v_params->>'per_additional_member_annual')::numeric,0)
                  * GREATEST(v_hh - 1, 0), v_method, v_scale);
  v_athr   := NULLIF(v_params->>'asset_threshold_amount','')::numeric;
  v_assess := public._bn_means_round(GREATEST(v_income - v_dis - v_ded, 0), v_method, v_scale);
  v_excess := public._bn_means_round(GREATEST(v_assess - v_thr, 0), v_method, v_scale);
  v_short  := public._bn_means_round(GREATEST(v_thr - v_assess, 0), v_method, v_scale);
  v_res    := CASE WHEN v_assess > v_thr THEN 'FAIL' ELSE 'PASS' END;

  IF v_athr IS NOT NULL AND v_assets > v_athr THEN
    v_res  := 'FAIL';
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','ASSET_THRESHOLD_EXCEEDED',
      'message','Assessed assets exceed the policy asset limit.',
      'threshold', v_athr, 'assets', v_assets));
  END IF;
  IF v_hh = 0 THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','NO_VERIFIED_HOUSEHOLD_MEMBER',
      'message','No verified household member was found; the single-person threshold was used.'));
  END IF;
  IF v_excl > 0 THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','FACTS_EXCLUDED',
      'message', v_excl || ' declared item(s) were excluded following verification.'));
  END IF;

  SELECT COALESCE(max(sequence_no),0) + 1 INTO v_seq
    FROM public.bn_means_calculation WHERE assessment_id = p_assessment_id;

  INSERT INTO public.bn_means_calculation(
    assessment_id, assessment_version_id, policy_version_id, calculation_version,
    engine_version, input_snapshot, input_hash, currency_code, rounding_method,
    rounding_scale, assessable_income, assessable_assets, approved_deductions,
    household_size, threshold_amount, excess_amount, result, warnings, result_hash,
    effective_date, valid_from, valid_until, reassessment_due, calculated_by,
    correlation_id, supersedes_calculation_id, recalculation_reason,
    is_current, sequence_no, trigger_reason, verification_revision_hash,
    verification_revision_no, policy_parameters, gross_income, income_disregard_total,
    gross_assets, asset_disregard_total, claimed_deductions, asset_threshold_amount,
    shortfall_amount, excluded_fact_count)
  VALUES (p_assessment_id, v_av.assessment_version_id, v_pv.policy_version_id, 'v1',
    'bn-means-engine-1.1.0', v_inputs, v_hash, v_a.currency_code, v_method, v_scale,
    v_assess, v_assets, v_ded, v_hh, v_thr, v_excess, v_res, v_warn,
    encode(digest(jsonb_build_object('input_hash', v_hash,
      'engine_version','bn-means-engine-1.1.0','assessable_income', v_assess,
      'assessable_assets', v_assets,'approved_deductions', v_ded,'household_size', v_hh,
      'threshold_amount', v_thr,'excess_amount', v_excess,'result', v_res,
      'currency_code', v_a.currency_code)::text,'sha256'),'hex'),
    v_a.effective_from, v_a.effective_from,
    CASE WHEN v_pv.validity_months IS NOT NULL
         THEN (v_a.effective_from + (v_pv.validity_months || ' months')::interval)::date - 1 END,
    CASE WHEN v_pv.reassessment_months IS NOT NULL
         THEN (v_a.effective_from + (v_pv.reassessment_months || ' months')::interval)::date END,
    p_actor_user_id, p_correlation_id, v_prev.calculation_id,
    COALESCE(NULLIF(p_trigger,''),'INITIAL'), true, v_seq,
    COALESCE(NULLIF(p_trigger,''),'INITIAL'), v_rev->>'revision_hash',
    (v_rev->>'revision_no')::int, v_params, v_gross_i, v_dis, v_gross_a, v_adis,
    v_ded_cl, v_athr, v_short, v_excl)
  RETURNING * INTO v_calc;

  IF v_prev.calculation_id IS NOT NULL THEN
    UPDATE public.bn_means_calculation
       SET is_current = false, superseded_at = now(),
           superseded_by_calculation_id = v_calc.calculation_id
     WHERE calculation_id = v_prev.calculation_id;
  END IF;

  -- ---- explanation lines ----
  INSERT INTO public.bn_means_calculation_line(
    calculation_id, line_no, line_kind, fact_kind, fact_id, category_code, included,
    exclusion_reason, raw_amount, normalised_amount, applied_amount, narrative,
    group_code, display_order, business_label, treatment_code, member_label,
    explanation, policy_rule_code, claimed_amount, disregard_amount)
  SELECT v_calc.calculation_id, 1000 + row_number() OVER (ORDER BY x.member_id),
    'HOUSEHOLD','HOUSEHOLD', x.member_id, x.relationship_code,
    COALESCE(o.outcome,'VERIFIED') = 'VERIFIED',
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN o.outcome END,
    NULL, NULL, NULL, 'Household member ' || COALESCE(x.relationship_code,''),
    'HOUSEHOLD', 100 + row_number() OVER (ORDER BY x.member_id),
    'Household member', CASE WHEN COALESCE(o.outcome,'VERIFIED')='VERIFIED' THEN 'COUNTED'
                             WHEN o.outcome='REJECTED' THEN 'EXCLUDED_REJECTED'
                             ELSE 'EXCLUDED_NOT_APPLICABLE' END,
    COALESCE(x.declared_person->>'full_name', x.relationship_code),
    CASE WHEN COALESCE(o.outcome,'VERIFIED')='VERIFIED'
         THEN 'Counted towards the household threshold.'
         ELSE 'Not counted following verification.' END,
    'HOUSEHOLD_SIZE', NULL, NULL
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'household','[]'::jsonb))
         AS x(member_id uuid, relationship_code text, declared_person jsonb)
    LEFT JOIN _mt_out o ON o.fact_kind='HOUSEHOLD' AND o.fact_id = x.member_id;

  INSERT INTO public.bn_means_calculation_line(
    calculation_id, line_no, line_kind, fact_kind, fact_id, category_code, included,
    exclusion_reason, raw_amount, normalised_amount, applied_amount, narrative,
    group_code, display_order, business_label, treatment_code, member_label,
    explanation, policy_rule_code, claimed_amount, disregard_amount)
  SELECT v_calc.calculation_id, 2000 + row_number() OVER (ORDER BY x.income_fact_id),
    'INCOME','INCOME', x.income_fact_id, x.category_code,
    (COALESCE(o.outcome,'VERIFIED') = 'VERIFIED' AND NOT COALESCE(x.disregard_candidate,false)),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN o.outcome
         WHEN COALESCE(x.disregard_candidate,false) THEN 'DISREGARDED' END,
    x.declared_amount,
    COALESCE(x.normalised_annual_amount, public._bn_means_annualise(x.declared_amount, x.declared_frequency)),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') = 'VERIFIED' AND NOT COALESCE(x.disregard_candidate,false)
         THEN public._bn_means_round(COALESCE(x.normalised_annual_amount,
              public._bn_means_annualise(x.declared_amount, x.declared_frequency)), v_method, v_scale)
         ELSE 0 END,
    'Income ' || COALESCE(x.category_code,'') || ' (' || COALESCE(x.declared_frequency,'') || ')',
    'INCOME', 200 + row_number() OVER (ORDER BY x.income_fact_id),
    COALESCE(NULLIF(x.source_name,''), x.category_code),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN
           CASE WHEN o.outcome='REJECTED' THEN 'EXCLUDED_REJECTED' ELSE 'EXCLUDED_NOT_APPLICABLE' END
         WHEN COALESCE(x.disregard_candidate,false) THEN 'DISREGARD_APPLIED'
         ELSE 'INCLUDED' END,
    NULL,
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED'
           THEN 'Excluded following verification.'
         WHEN COALESCE(x.disregard_candidate,false)
           THEN 'Disregarded under policy: ' || COALESCE(x.disregard_reason_code,'policy disregard') || '.'
         ELSE 'Counted in full at its annual value.' END,
    'INCOME_ANNUALISATION', x.declared_amount,
    CASE WHEN COALESCE(x.disregard_candidate,false)
         THEN COALESCE(x.normalised_annual_amount,
              public._bn_means_annualise(x.declared_amount, x.declared_frequency)) ELSE 0 END
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'income','[]'::jsonb))
         AS x(income_fact_id uuid, category_code text, source_name text, declared_amount numeric,
              declared_frequency text, normalised_annual_amount numeric,
              disregard_candidate boolean, disregard_reason_code text)
    LEFT JOIN _mt_out o ON o.fact_kind='INCOME' AND o.fact_id = x.income_fact_id;

  INSERT INTO public.bn_means_calculation_line(
    calculation_id, line_no, line_kind, fact_kind, fact_id, category_code, included,
    exclusion_reason, raw_amount, normalised_amount, applied_amount, narrative,
    group_code, display_order, business_label, treatment_code, explanation,
    policy_rule_code, claimed_amount, disregard_amount)
  SELECT v_calc.calculation_id, 3000 + row_number() OVER (ORDER BY x.deduction_fact_id),
    'DEDUCTION','DEDUCTION', x.deduction_fact_id, x.category_code,
    (COALESCE(o.outcome,'VERIFIED') = 'VERIFIED'
      AND COALESCE(x.approval_status,'CLAIMED') <> 'REJECTED'
      AND COALESCE(x.treatment_status,'ALLOWED') <> 'DISALLOWED'),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN o.outcome
         WHEN COALESCE(x.approval_status,'CLAIMED') = 'REJECTED' THEN 'DEDUCTION_REJECTED'
         WHEN COALESCE(x.treatment_status,'ALLOWED') = 'DISALLOWED' THEN 'DEDUCTION_DISALLOWED' END,
    x.claimed_amount,
    COALESCE(x.normalised_annual_amount, public._bn_means_annualise(x.claimed_amount, x.declared_frequency)),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') = 'VERIFIED'
           AND COALESCE(x.approval_status,'CLAIMED') <> 'REJECTED'
           AND COALESCE(x.treatment_status,'ALLOWED') <> 'DISALLOWED'
         THEN public._bn_means_round(COALESCE(x.normalised_annual_amount,
              public._bn_means_annualise(x.claimed_amount, x.declared_frequency)), v_method, v_scale)
         ELSE 0 END,
    'Deduction ' || COALESCE(x.category_code,''),
    'DEDUCTION', 300 + row_number() OVER (ORDER BY x.deduction_fact_id),
    x.category_code,
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN 'EXCLUDED_REJECTED'
         WHEN COALESCE(x.approval_status,'CLAIMED') = 'REJECTED' THEN 'NOT_ALLOWED'
         WHEN COALESCE(x.treatment_status,'ALLOWED') = 'DISALLOWED' THEN 'NOT_ALLOWED'
         ELSE 'ALLOWED' END,
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN 'Excluded following verification.'
         WHEN COALESCE(x.approval_status,'CLAIMED') = 'REJECTED' THEN 'Claimed deduction was not allowed.'
         WHEN COALESCE(x.treatment_status,'ALLOWED') = 'DISALLOWED' THEN 'Disallowed under policy.'
         ELSE 'Allowed and deducted from assessed income.' END,
    'DEDUCTION_RULE', x.claimed_amount, 0
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'deductions','[]'::jsonb))
         AS x(deduction_fact_id uuid, category_code text, claimed_amount numeric,
              declared_frequency text, normalised_annual_amount numeric,
              approval_status text, treatment_status text)
    LEFT JOIN _mt_out o ON o.fact_kind='DEDUCTION' AND o.fact_id = x.deduction_fact_id;

  INSERT INTO public.bn_means_calculation_line(
    calculation_id, line_no, line_kind, fact_kind, fact_id, category_code, included,
    exclusion_reason, raw_amount, normalised_amount, applied_amount, narrative,
    group_code, display_order, business_label, treatment_code, explanation,
    policy_rule_code, claimed_amount, disregard_amount)
  SELECT v_calc.calculation_id, 4000 + row_number() OVER (ORDER BY x.asset_fact_id),
    'ASSET','ASSET', x.asset_fact_id, x.category_code,
    (COALESCE(o.outcome,'VERIFIED') = 'VERIFIED' AND NOT COALESCE(x.disregard_candidate,false)),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN o.outcome
         WHEN COALESCE(x.disregard_candidate,false) THEN 'DISREGARDED' END,
    x.valuation_amount,
    public._bn_means_round(x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') = 'VERIFIED' AND NOT COALESCE(x.disregard_candidate,false)
         THEN public._bn_means_round(x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale)
         ELSE 0 END,
    'Asset ' || COALESCE(x.category_code,''),
    'ASSET', 400 + row_number() OVER (ORDER BY x.asset_fact_id),
    COALESCE(NULLIF(x.description,''), x.category_code),
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN 'EXCLUDED_REJECTED'
         WHEN COALESCE(x.disregard_candidate,false) THEN 'DISREGARD_APPLIED'
         ELSE 'INCLUDED' END,
    CASE WHEN COALESCE(o.outcome,'VERIFIED') <> 'VERIFIED' THEN 'Excluded following verification.'
         WHEN COALESCE(x.disregard_candidate,false)
           THEN 'Disregarded under policy: ' || COALESCE(x.disregard_reason_code,'policy disregard') || '.'
         ELSE 'Counted at the owned share of its value.' END,
    'ASSET_VALUATION', x.valuation_amount,
    CASE WHEN COALESCE(x.disregard_candidate,false)
         THEN public._bn_means_round(x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale)
         ELSE 0 END
    FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'assets','[]'::jsonb))
         AS x(asset_fact_id uuid, category_code text, description text, valuation_amount numeric,
              ownership_share numeric, disregard_candidate boolean, disregard_reason_code text)
    LEFT JOIN _mt_out o ON o.fact_kind='ASSET' AND o.fact_id = x.asset_fact_id;

  INSERT INTO public.bn_means_calculation_line(
    calculation_id, line_no, line_kind, included, applied_amount, narrative,
    group_code, display_order, business_label, treatment_code, explanation, policy_rule_code)
  VALUES
    (v_calc.calculation_id, 5000, 'TOTAL', true, v_gross_i, 'Gross assessable income',
     'SUMMARY', 500, 'Gross income', 'TOTAL',
     'Total annual income declared and verified.', 'INCOME_TOTAL'),
    (v_calc.calculation_id, 5010, 'DISREGARD', true, v_dis, 'Income disregard applied',
     'SUMMARY', 510, 'Income disregard', 'DISREGARD_APPLIED',
     'Policy income disregard applied once to assessed income.', 'INCOME_DISREGARD'),
    (v_calc.calculation_id, 5020, 'TOTAL', true, v_ded, 'Allowed deductions',
     'SUMMARY', 520, 'Allowed deductions', 'TOTAL',
     'Deductions allowed after verification and policy treatment.', 'DEDUCTION_TOTAL'),
    (v_calc.calculation_id, 5030, 'TOTAL', true, v_assess, 'Assessed means',
     'SUMMARY', 530, 'Assessed means', 'TOTAL',
     'Income less disregard and allowed deductions.', 'ASSESSED_MEANS'),
    (v_calc.calculation_id, 5040, 'THRESHOLD', true, v_thr, 'Applicable threshold',
     'THRESHOLD', 540, 'Applicable threshold', 'THRESHOLD',
     'Policy threshold for a household of ' || v_hh || '.', 'THRESHOLD_RULE'),
    (v_calc.calculation_id, 5050, 'RESULT', true,
     CASE WHEN v_res = 'FAIL' THEN v_excess ELSE v_short END,
     CASE WHEN v_res = 'FAIL' THEN 'Amount above threshold' ELSE 'Amount below threshold' END,
     'RESULT', 550, 'Outcome', v_res,
     CASE WHEN v_res = 'FAIL' THEN 'Assessed means exceed the applicable threshold.'
          ELSE 'Assessed means are within the applicable threshold.' END, 'RESULT_RULE');

  UPDATE public.bn_means_assessment
     SET status = 'CALCULATED', result = v_res,
         row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
   WHERE assessment_id = p_assessment_id;

  RETURN jsonb_build_object('assessment_id', p_assessment_id,
    'calculation_id', v_calc.calculation_id, 'input_hash', v_hash,
    'calculation_hash', v_calc.result_hash, 'result', v_res,
    'sequence_no', v_seq, 'supersedes_calculation_id', v_prev.calculation_id,
    'assessed_means_amount', v_assess, 'threshold_amount', v_thr,
    'excess_amount', v_excess, 'shortfall_amount', v_short,
    'warnings', v_warn, 'deduplicated', false, 'event_code','CALCULATED');
END;
$function$;

-- ---------- 6. Calculation workspace read ----------------------------
CREATE OR REPLACE FUNCTION public.bn_means_calculation_workspace_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_calc public.bn_means_calculation%ROWTYPE;
  v_ready jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;

  v_ready := public._bn_means_calculation_readiness(p_assessment_id);
  SELECT * INTO v_calc FROM public.bn_means_calculation
   WHERE assessment_id = p_assessment_id AND is_current ORDER BY sequence_no DESC LIMIT 1;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'readiness', v_ready,
    'calculation', CASE WHEN v_calc.calculation_id IS NULL THEN NULL ELSE to_jsonb(v_calc) END,
    'calculation_current', COALESCE((v_ready->>'calculation_current')::boolean,false),
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.display_order, l.line_no)
                         FROM public.bn_means_calculation_line l
                        WHERE l.calculation_id = v_calc.calculation_id),'[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'calculation_id', c.calculation_id, 'sequence_no', c.sequence_no,
                             'result', c.result, 'assessable_income', c.assessable_income,
                             'threshold_amount', c.threshold_amount, 'excess_amount', c.excess_amount,
                             'calculated_at', c.calculated_at, 'calculated_by', c.calculated_by,
                             'trigger_reason', c.trigger_reason, 'is_current', c.is_current,
                             'superseded_at', c.superseded_at)
                             ORDER BY c.sequence_no DESC)
                          FROM public.bn_means_calculation c
                         WHERE c.assessment_id = p_assessment_id),'[]'::jsonb)));
END;
$function$;

-- ---------- 7. Delegate the governed CALCULATE command ---------------
DO $do$
DECLARE
  v_def   text;
  v_start int;
  v_end   int;
  v_new   text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'bn_means_execute_command_v1'
   LIMIT 1;
  IF v_def IS NULL THEN RAISE EXCEPTION 'bn_means_execute_command_v1 not found'; END IF;

  v_start := position('ELSIF p_command_name = ''BN_MEANS_CALCULATE'' THEN' in v_def);
  IF v_start = 0 THEN RAISE EXCEPTION 'CALCULATE branch not found'; END IF;
  v_end := position(chr(10) || '  ELSE' || chr(10) || '    RAISE EXCEPTION ''E_COMMAND_NOT_IMPLEMENTED' in v_def);
  IF v_end = 0 OR v_end < v_start THEN RAISE EXCEPTION 'CALCULATE branch end not found'; END IF;

  v_new := left(v_def, v_start - 1)
    || 'ELSIF p_command_name = ''BN_MEANS_CALCULATE'' THEN' || chr(10)
    || '    v_result := public._bn_means_calculate_v1(v_id, p_actor_user_id, p_correlation_id,'
    || ' COALESCE(NULLIF(p_reason_code,''''), ''INITIAL''));' || chr(10)
    || '    SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = v_id;' || chr(10)
    || '    v_result := v_result || jsonb_build_object(''entity_version'', v_a.row_version,'
    || ' ''to_status'', v_a.status);' || chr(10)
    || substr(v_def, v_end);

  EXECUTE v_new;
END
$do$;

-- ---------- 8. Grants ------------------------------------------------
REVOKE ALL ON FUNCTION public.bn_means_calculation_workspace_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_calculation_workspace_v1(uuid,uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._bn_means_calculation_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_calculation_readiness(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_revision(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_calc_parameters(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_calc_parameters(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_calculate_v1(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_means_calculate_v1(uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public._bn_means_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_readiness(uuid) TO authenticated, service_role;

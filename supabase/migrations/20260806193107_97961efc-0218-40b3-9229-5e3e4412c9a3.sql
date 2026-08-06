-- =====================================================================
-- BN Means-Test MT6 — per-fact verification + deterministic calculation
-- =====================================================================

-- 1. Schema extensions --------------------------------------------------
ALTER TABLE public.bn_means_verification
  ADD COLUMN IF NOT EXISTS assessment_version_id uuid REFERENCES public.bn_means_assessment_version(assessment_version_id);
ALTER TABLE public.bn_means_verification DROP CONSTRAINT IF EXISTS bn_means_verification_outcome_ck;
ALTER TABLE public.bn_means_verification
  ADD CONSTRAINT bn_means_verification_outcome_ck
  CHECK (outcome IN ('VERIFIED','REJECTED','CLARIFICATION_REQUIRED','NOT_APPLICABLE'));
ALTER TABLE public.bn_means_verification DROP CONSTRAINT IF EXISTS bn_means_verification_kind_ck;
ALTER TABLE public.bn_means_verification
  ADD CONSTRAINT bn_means_verification_kind_ck
  CHECK (fact_kind IN ('HOUSEHOLD','INCOME','ASSET','DEDUCTION','EVIDENCE','CONTEXT'));
CREATE INDEX IF NOT EXISTS ix_bn_means_verification_lookup
  ON public.bn_means_verification (assessment_id, assessment_version_id, fact_kind, fact_id, verified_at DESC);

ALTER TABLE public.bn_means_household_member
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'DECLARED';
ALTER TABLE public.bn_means_evidence
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'DECLARED';

ALTER TABLE public.bn_means_calculation
  ADD COLUMN IF NOT EXISTS engine_version text NOT NULL DEFAULT 'bn-means-engine-1.0.0',
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS reassessment_due date,
  ADD COLUMN IF NOT EXISTS rounding_scale integer NOT NULL DEFAULT 2;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_means_calculation_input
  ON public.bn_means_calculation (assessment_id, input_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_means_calculation_line_no
  ON public.bn_means_calculation_line (calculation_id, line_no);

-- 2. Deterministic decimal rounding ------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_round(p_amount numeric, p_method text, p_scale integer)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $fn$
DECLARE
  s integer := COALESCE(p_scale, 2);
  f numeric; m numeric; fl numeric; d numeric; sign numeric;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  f := power(10::numeric, s);
  CASE COALESCE(p_method,'HALF_UP')
    WHEN 'HALF_UP'   THEN RETURN round(p_amount, s);
    WHEN 'DOWN'      THEN RETURN trunc(p_amount * f) / f;
    WHEN 'UP'        THEN RETURN sign(p_amount) * ceil(abs(p_amount) * f) / f;
    WHEN 'FLOOR'     THEN RETURN floor(p_amount * f) / f;
    WHEN 'CEILING'   THEN RETURN ceil(p_amount * f) / f;
    WHEN 'HALF_EVEN' THEN
      sign := CASE WHEN p_amount < 0 THEN -1 ELSE 1 END;
      m  := abs(p_amount) * f;
      fl := floor(m);
      d  := m - fl;
      IF d > 0.5 THEN fl := fl + 1;
      ELSIF d = 0.5 THEN IF (fl::bigint % 2) <> 0 THEN fl := fl + 1; END IF;
      END IF;
      RETURN sign * fl / f;
    ELSE RETURN round(p_amount, s);
  END CASE;
END;
$fn$;
REVOKE ALL ON FUNCTION public._bn_means_round(numeric, text, integer) FROM PUBLIC, anon, authenticated;

-- 3. Internal calculation-readiness evaluator ---------------------------
CREATE OR REPLACE FUNCTION public._bn_means_readiness(p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a  public.bn_means_assessment%ROWTYPE;
  v_av public.bn_means_assessment_version%ROWTYPE;
  v_pv public.bn_means_policy_version%ROWTYPE;
  v_missing jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_clarify jsonb := '[]'::jsonb;
  v_policy jsonb := '[]'::jsonb;
  v_currency jsonb := '[]'::jsonb;
  v_codes text[] := ARRAY[]::text[];
  v_ready boolean;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready_for_calculation', false, 'reason_codes',
      to_jsonb(ARRAY['ASSESSMENT_NOT_FOUND']), 'missing_verifications','[]'::jsonb,
      'rejected_facts','[]'::jsonb,'clarification_required','[]'::jsonb,
      'policy_configuration_issues','[]'::jsonb,'currency_issues','[]'::jsonb);
  END IF;

  SELECT * INTO v_av FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;
  IF NOT FOUND THEN
    v_codes := v_codes || 'FROZEN_VERSION_MISSING';
  END IF;

  IF v_a.status NOT IN ('SUBMITTED','VERIFICATION_PENDING') THEN
    v_codes := v_codes || ('INVALID_STATE:' || v_a.status);
  END IF;

  IF v_a.policy_version_id IS NULL THEN
    v_policy := v_policy || jsonb_build_array(jsonb_build_object('issue','POLICY_VERSION_MISSING'));
  ELSE
    SELECT * INTO v_pv FROM public.bn_means_policy_version WHERE policy_version_id = v_a.policy_version_id;
    IF NOT FOUND THEN
      v_policy := v_policy || jsonb_build_array(jsonb_build_object('issue','POLICY_VERSION_NOT_FOUND'));
    ELSE
      IF v_pv.status <> 'ACTIVE' THEN
        v_policy := v_policy || jsonb_build_array(jsonb_build_object('issue','POLICY_NOT_ACTIVE','status',v_pv.status));
      END IF;
      IF v_pv.effective_from > v_a.effective_from
         OR (v_pv.effective_to IS NOT NULL AND v_pv.effective_to < v_a.effective_from) THEN
        v_policy := v_policy || jsonb_build_array(jsonb_build_object('issue','POLICY_NOT_EFFECTIVE'));
      END IF;
      IF (v_pv.threshold_parameters->>'base_threshold_annual') IS NULL THEN
        v_policy := v_policy || jsonb_build_array(jsonb_build_object('issue','POLICY_PARAMETER_MISSING','parameter','base_threshold_annual'));
      END IF;
      IF COALESCE(v_pv.rounding_scale, -1) < 0 THEN
        v_policy := v_policy || jsonb_build_array(jsonb_build_object('issue','POLICY_ROUNDING_INVALID'));
      END IF;
      IF v_pv.currency_code <> v_a.currency_code THEN
        v_currency := v_currency || jsonb_build_array(jsonb_build_object('issue','POLICY_CURRENCY_MISMATCH','policy',v_pv.currency_code,'assessment',v_a.currency_code));
      END IF;
    END IF;
  END IF;

  -- currency issues on facts
  SELECT COALESCE(v_currency || jsonb_agg(jsonb_build_object('fact_kind',k,'fact_id',fid,'currency',cc)), v_currency)
    INTO v_currency
  FROM (
    SELECT 'INCOME' AS k, income_fact_id AS fid, currency_code AS cc FROM public.bn_means_income_fact
      WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND currency_code <> v_a.currency_code
    UNION ALL
    SELECT 'ASSET', asset_fact_id, currency_code FROM public.bn_means_asset_fact
      WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND currency_code <> v_a.currency_code
    UNION ALL
    SELECT 'DEDUCTION', deduction_fact_id, currency_code FROM public.bn_means_deduction_fact
      WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND currency_code <> v_a.currency_code
  ) q;

  IF v_av.assessment_version_id IS NOT NULL THEN
    WITH facts AS (
      SELECT 'HOUSEHOLD'::text AS fact_kind, (e->>'member_id')::uuid AS fact_id
        FROM jsonb_array_elements(COALESCE(v_av.snapshot->'household','[]'::jsonb)) e
      UNION ALL
      SELECT 'INCOME', (e->>'income_fact_id')::uuid
        FROM jsonb_array_elements(COALESCE(v_av.snapshot->'income','[]'::jsonb)) e
      UNION ALL
      SELECT 'ASSET', (e->>'asset_fact_id')::uuid
        FROM jsonb_array_elements(COALESCE(v_av.snapshot->'assets','[]'::jsonb)) e
      UNION ALL
      SELECT 'DEDUCTION', (e->>'deduction_fact_id')::uuid
        FROM jsonb_array_elements(COALESCE(v_av.snapshot->'deductions','[]'::jsonb)) e
    ), latest AS (
      SELECT f.fact_kind, f.fact_id, v.outcome
        FROM facts f
        LEFT JOIN LATERAL (
          SELECT vv.outcome FROM public.bn_means_verification vv
           WHERE vv.assessment_id = p_assessment_id
             AND vv.assessment_version_id = v_av.assessment_version_id
             AND vv.fact_kind = f.fact_kind AND vv.fact_id = f.fact_id
           ORDER BY vv.verified_at DESC LIMIT 1) v ON true
    )
    SELECT
      COALESCE((SELECT jsonb_agg(jsonb_build_object('fact_kind',fact_kind,'fact_id',fact_id)) FROM latest WHERE outcome IS NULL),'[]'::jsonb),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('fact_kind',fact_kind,'fact_id',fact_id)) FROM latest WHERE outcome = 'REJECTED'),'[]'::jsonb),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('fact_kind',fact_kind,'fact_id',fact_id)) FROM latest WHERE outcome = 'CLARIFICATION_REQUIRED'),'[]'::jsonb)
    INTO v_missing, v_rejected, v_clarify;
  END IF;

  IF jsonb_array_length(v_missing) > 0 THEN v_codes := v_codes || 'MISSING_VERIFICATIONS'; END IF;
  IF jsonb_array_length(v_clarify) > 0 THEN v_codes := v_codes || 'CLARIFICATION_OUTSTANDING'; END IF;
  IF jsonb_array_length(v_policy) > 0 THEN v_codes := v_codes || 'POLICY_CONFIGURATION_ISSUE'; END IF;
  IF jsonb_array_length(v_currency) > 0 THEN v_codes := v_codes || 'CURRENCY_ISSUE'; END IF;

  v_ready := (array_length(v_codes,1) IS NULL);

  RETURN jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_version_id', v_av.assessment_version_id,
    'status', v_a.status,
    'ready_for_calculation', v_ready,
    'missing_verifications', v_missing,
    'rejected_facts', v_rejected,
    'clarification_required', v_clarify,
    'policy_configuration_issues', v_policy,
    'currency_issues', v_currency,
    'reason_codes', to_jsonb(COALESCE(v_codes, ARRAY[]::text[]))
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public._bn_means_readiness(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Public read boundary: readiness + calculation trace ----------------
CREATE OR REPLACE FUNCTION public.bn_means_calculation_readiness_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', public._bn_means_readiness(p_assessment_id));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.bn_means_calculation_readiness_v1(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bn_means_calculation_trace_v1(p_actor_user_id uuid, p_calculation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_perm jsonb; v_c public.bn_means_calculation%ROWTYPE;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_c FROM public.bn_means_calculation WHERE calculation_id = p_calculation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'calculation', to_jsonb(v_c),
    'policy_version', (SELECT to_jsonb(pv) FROM public.bn_means_policy_version pv
                        WHERE pv.policy_version_id = v_c.policy_version_id),
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no)
                         FROM public.bn_means_calculation_line l
                        WHERE l.calculation_id = p_calculation_id),'[]'::jsonb)
  ));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.bn_means_calculation_trace_v1(uuid, uuid) TO authenticated;

-- 5. Extend the governed command entry point with MT6 handlers ----------
DO $mig$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'bn_means_execute_command_v1';
  IF src IS NULL THEN
    RAISE EXCEPTION 'bn_means_execute_command_v1 not found';
  END IF;
  IF position('BN_MEANS_VERIFY_INFORMATION' in src) > 0 THEN
    RAISE NOTICE 'MT6 handlers already present';
    RETURN;
  END IF;

  -- extra declarations
  src := replace(src, '  v_version_no int;', $decl$  v_version_no int;
  v_av         public.bn_means_assessment_version%ROWTYPE;
  v_kind       text;
  v_outcome    text;
  v_fact       uuid;
  v_reason     text;
  v_ready      jsonb;
  v_calc       public.bn_means_calculation%ROWTYPE;
  v_calc_id    uuid;
  v_params     jsonb;
  v_method     text;
  v_scale      int;
  v_income     numeric(18,2);
  v_assets     numeric(18,2);
  v_deduct     numeric(18,2);
  v_disregard  numeric(18,2);
  v_hh         int;
  v_thr        numeric(18,2);
  v_asset_thr  numeric(18,2);
  v_assessable numeric(18,2);
  v_excess     numeric(18,2);
  v_res        text;
  v_inputs     jsonb;
  v_hash       text;
  v_warn       jsonb;
  v_valid_from date;
  v_valid_until date;
  v_reassess   date;$decl$);

  -- MT6 command handlers, inserted before the not-implemented fallback
  src := replace(src, '  ELSE
    RAISE EXCEPTION ''E_COMMAND_NOT_IMPLEMENTED:%'', p_command_name;', $body$  ELSIF p_command_name = 'BN_MEANS_VERIFY_INFORMATION' THEN
    IF v_from NOT IN ('SUBMITTED','VERIFICATION_PENDING') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot be verified', v_from;
    END IF;
    v_kind    := upper(COALESCE(p_payload->>'fact_kind',''));
    v_outcome := upper(COALESCE(p_payload->>'outcome',''));
    v_reason  := COALESCE(NULLIF(p_reason_code,''), NULLIF(p_payload->>'reason_code',''));
    IF v_kind NOT IN ('HOUSEHOLD','INCOME','ASSET','DEDUCTION','EVIDENCE','CONTEXT') THEN
      RAISE EXCEPTION 'E_FACT_KIND_INVALID:%', v_kind;
    END IF;
    IF v_outcome NOT IN ('VERIFIED','REJECTED','CLARIFICATION_REQUIRED','NOT_APPLICABLE') THEN
      RAISE EXCEPTION 'E_VERIFICATION_OUTCOME_INVALID:%', v_outcome;
    END IF;
    IF v_outcome IN ('REJECTED','CLARIFICATION_REQUIRED') AND v_reason IS NULL THEN
      RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:%', v_outcome;
    END IF;

    SELECT * INTO v_av FROM public.bn_means_assessment_version
     WHERE assessment_id = v_id AND frozen_reason = 'SUBMITTED'
     ORDER BY version_no DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_FROZEN_VERSION_MISSING:%', v_id;
    END IF;
    IF (p_payload->>'assessment_version_id') IS NOT NULL
       AND (p_payload->>'assessment_version_id')::uuid <> v_av.assessment_version_id THEN
      RAISE EXCEPTION 'E_VERSION_OWNERSHIP_MISMATCH:%', p_payload->>'assessment_version_id';
    END IF;
    IF encode(digest(v_av.snapshot::text,'sha256'),'hex') <> v_av.snapshot_hash THEN
      RAISE EXCEPTION 'E_FROZEN_VERSION_TAMPERED:%', v_av.assessment_version_id;
    END IF;

    v_fact := NULLIF(p_payload->>'fact_id','')::uuid;
    IF v_kind = 'CONTEXT' THEN
      v_fact := COALESCE(v_fact, v_id);
    ELSE
      IF v_fact IS NULL THEN
        RAISE EXCEPTION 'E_FACT_REFERENCE_REQUIRED:%', v_kind;
      END IF;
      SELECT count(*) INTO v_count
        FROM jsonb_array_elements(COALESCE(v_av.snapshot->(CASE v_kind
               WHEN 'HOUSEHOLD' THEN 'household' WHEN 'INCOME' THEN 'income'
               WHEN 'ASSET' THEN 'assets' WHEN 'DEDUCTION' THEN 'deductions'
               ELSE 'evidence' END),'[]'::jsonb)) el
       WHERE el->>(CASE v_kind
               WHEN 'HOUSEHOLD' THEN 'member_id' WHEN 'INCOME' THEN 'income_fact_id'
               WHEN 'ASSET' THEN 'asset_fact_id' WHEN 'DEDUCTION' THEN 'deduction_fact_id'
               ELSE 'evidence_id' END) = v_fact::text;
      IF v_count = 0 THEN
        RAISE EXCEPTION 'E_FACT_NOT_IN_FROZEN_VERSION:% %', v_kind, v_fact;
      END IF;
    END IF;

    INSERT INTO public.bn_means_verification(
      assessment_id, assessment_version_id, fact_kind, fact_id, outcome,
      evidence_checked, evidence_id, reason_code, notes, verified_by, correlation_id)
    VALUES (v_id, v_av.assessment_version_id, v_kind, v_fact, v_outcome,
      COALESCE((p_payload->>'evidence_checked')::boolean, false),
      NULLIF(p_payload->>'evidence_id','')::uuid, v_reason,
      COALESCE(NULLIF(p_payload->>'note',''), NULLIF(p_justification,'')),
      p_actor_user_id, p_correlation_id)
    RETURNING verification_id INTO v_new_id;

    IF v_kind = 'INCOME' THEN
      UPDATE public.bn_means_income_fact SET verification_status = v_outcome
       WHERE income_fact_id = v_fact AND assessment_id = v_id;
    ELSIF v_kind = 'ASSET' THEN
      UPDATE public.bn_means_asset_fact SET verification_status = v_outcome
       WHERE asset_fact_id = v_fact AND assessment_id = v_id;
    ELSIF v_kind = 'DEDUCTION' THEN
      UPDATE public.bn_means_deduction_fact SET verification_status = v_outcome
       WHERE deduction_fact_id = v_fact AND assessment_id = v_id;
    ELSIF v_kind = 'HOUSEHOLD' THEN
      UPDATE public.bn_means_household_member SET verification_status = v_outcome
       WHERE member_id = v_fact AND assessment_id = v_id;
    ELSIF v_kind = 'EVIDENCE' THEN
      UPDATE public.bn_means_evidence SET verification_status = v_outcome
       WHERE evidence_id = v_fact AND assessment_id = v_id;
    END IF;

    UPDATE public.bn_means_assessment
       SET status = CASE WHEN status = 'SUBMITTED' THEN 'VERIFICATION_PENDING' ELSE status END,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = v_id
     RETURNING * INTO v_a;

    v_result := jsonb_build_object('verification_id', v_new_id, 'assessment_id', v_id,
      'assessment_version_id', v_av.assessment_version_id, 'fact_kind', v_kind,
      'fact_id', v_fact, 'outcome', v_outcome,
      'entity_version', v_a.row_version, 'to_status', v_a.status);

  ELSIF p_command_name = 'BN_MEANS_CALCULATE' THEN
    IF v_from <> 'VERIFICATION_PENDING' THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% -> CALCULATED', v_from;
    END IF;
    v_ready := public._bn_means_readiness(v_id);
    IF NOT COALESCE((v_ready->>'ready_for_calculation')::boolean, false) THEN
      RAISE EXCEPTION 'E_NOT_READY_FOR_CALCULATION:%', v_ready->>'reason_codes';
    END IF;

    SELECT * INTO v_av FROM public.bn_means_assessment_version
     WHERE assessment_id = v_id AND frozen_reason = 'SUBMITTED'
     ORDER BY version_no DESC LIMIT 1;
    IF encode(digest(v_av.snapshot::text,'sha256'),'hex') <> v_av.snapshot_hash THEN
      RAISE EXCEPTION 'E_FROZEN_VERSION_TAMPERED:%', v_av.assessment_version_id;
    END IF;
    SELECT * INTO v_pv FROM public.bn_means_policy_version
     WHERE policy_version_id = v_a.policy_version_id;

    v_params := COALESCE(v_pv.threshold_parameters,'{}'::jsonb);
    v_method := COALESCE(v_pv.rounding_method,'HALF_UP');
    v_scale  := COALESCE(v_pv.rounding_scale, 2);
    IF (v_params->>'base_threshold_annual') IS NULL THEN
      RAISE EXCEPTION 'E_POLICY_PARAMETER_MISSING:base_threshold_annual';
    END IF;

    v_inputs := jsonb_build_object(
      'assessment_version_id', v_av.assessment_version_id,
      'snapshot_hash', v_av.snapshot_hash,
      'policy_version_id', v_pv.policy_version_id,
      'engine_version', 'bn-means-engine-1.0.0',
      'effective_date', v_a.effective_from,
      'currency_code', v_a.currency_code,
      'threshold_parameters', v_params,
      'rounding', jsonb_build_object('method', v_method, 'scale', v_scale),
      'verifications', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('fact_kind', q.fact_kind, 'fact_id', q.fact_id, 'outcome', q.outcome)
                         ORDER BY q.fact_kind, q.fact_id)
          FROM (SELECT DISTINCT ON (vv.fact_kind, vv.fact_id)
                       vv.fact_kind, vv.fact_id, vv.outcome
                  FROM public.bn_means_verification vv
                 WHERE vv.assessment_id = v_id
                   AND vv.assessment_version_id = v_av.assessment_version_id
                 ORDER BY vv.fact_kind, vv.fact_id, vv.verified_at DESC) q),'[]'::jsonb));
    v_hash := encode(digest(v_inputs::text,'sha256'),'hex');

    SELECT * INTO v_calc FROM public.bn_means_calculation
     WHERE assessment_id = v_id AND input_hash = v_hash;

    IF FOUND THEN
      v_result := jsonb_build_object('assessment_id', v_id, 'calculation_id', v_calc.calculation_id,
        'input_hash', v_calc.input_hash, 'calculation_hash', v_calc.result_hash,
        'result', v_calc.result, 'entity_version', v_a.row_version,
        'to_status', v_a.status, 'deduplicated', true);
    ELSE
      SELECT COALESCE(sum(public._bn_means_round(x.normalised_annual_amount, v_method, v_scale)),0)
        INTO v_income
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'income','[]'::jsonb))
             AS x(income_fact_id uuid, normalised_annual_amount numeric)
        JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                       WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                         AND vv.fact_kind = 'INCOME' AND vv.fact_id = x.income_fact_id
                       ORDER BY vv.verified_at DESC LIMIT 1) o ON true
       WHERE o.outcome = 'VERIFIED';

      SELECT COALESCE(sum(public._bn_means_round(x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale)),0)
        INTO v_assets
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'assets','[]'::jsonb))
             AS x(asset_fact_id uuid, valuation_amount numeric, ownership_share numeric)
        JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                       WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                         AND vv.fact_kind = 'ASSET' AND vv.fact_id = x.asset_fact_id
                       ORDER BY vv.verified_at DESC LIMIT 1) o ON true
       WHERE o.outcome = 'VERIFIED';

      SELECT COALESCE(sum(public._bn_means_round(x.normalised_annual_amount, v_method, v_scale)),0)
        INTO v_deduct
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'deductions','[]'::jsonb))
             AS x(deduction_fact_id uuid, normalised_annual_amount numeric, approval_status text)
        JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                       WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                         AND vv.fact_kind = 'DEDUCTION' AND vv.fact_id = x.deduction_fact_id
                       ORDER BY vv.verified_at DESC LIMIT 1) o ON true
       WHERE o.outcome = 'VERIFIED' AND COALESCE(x.approval_status,'CLAIMED') <> 'REJECTED';

      SELECT count(*) INTO v_hh
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'household','[]'::jsonb)) AS x(member_id uuid)
        JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                       WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                         AND vv.fact_kind = 'HOUSEHOLD' AND vv.fact_id = x.member_id
                       ORDER BY vv.verified_at DESC LIMIT 1) o ON true
       WHERE o.outcome = 'VERIFIED';

      v_disregard := public._bn_means_round(COALESCE((v_params->>'income_disregard_annual')::numeric, 0), v_method, v_scale);
      v_asset_thr := NULLIF(v_params->>'asset_threshold','')::numeric;
      v_thr := public._bn_means_round(
                 (v_params->>'base_threshold_annual')::numeric
                 + COALESCE((v_params->>'per_additional_member_annual')::numeric,0) * GREATEST(v_hh - 1, 0),
                 v_method, v_scale);
      v_assessable := public._bn_means_round(GREATEST(v_income - v_disregard - v_deduct, 0), v_method, v_scale);
      v_excess := public._bn_means_round(v_assessable - v_thr, v_method, v_scale);
      v_warn := '[]'::jsonb;
      v_res := CASE WHEN v_excess > 0 THEN 'FAIL' ELSE 'PASS' END;
      IF v_asset_thr IS NOT NULL AND v_assets > v_asset_thr THEN
        v_res := 'FAIL';
        v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','ASSET_THRESHOLD_EXCEEDED','threshold',v_asset_thr,'assets',v_assets));
      END IF;
      IF v_hh = 0 THEN
        v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','NO_VERIFIED_HOUSEHOLD_MEMBER'));
      END IF;

      v_valid_from  := v_a.effective_from;
      v_valid_until := CASE WHEN v_pv.validity_months IS NOT NULL
                            THEN (v_a.effective_from + (v_pv.validity_months || ' months')::interval)::date - 1 END;
      v_reassess    := CASE WHEN v_pv.reassessment_months IS NOT NULL
                            THEN (v_a.effective_from + (v_pv.reassessment_months || ' months')::interval)::date END;

      INSERT INTO public.bn_means_calculation(
        assessment_id, assessment_version_id, policy_version_id, calculation_version,
        engine_version, input_snapshot, input_hash, currency_code, rounding_method,
        rounding_scale, assessable_income, assessable_assets, approved_deductions,
        household_size, threshold_amount, excess_amount, result, warnings,
        result_hash, effective_date, valid_from, valid_until, reassessment_due,
        calculated_by, correlation_id)
      VALUES (v_id, v_av.assessment_version_id, v_pv.policy_version_id, 'v1',
        'bn-means-engine-1.0.0', v_inputs, v_hash, v_a.currency_code, v_method,
        v_scale, v_assessable, v_assets, v_deduct, v_hh, v_thr, v_excess, v_res, v_warn,
        encode(digest(jsonb_build_object(
          'input_hash', v_hash, 'engine_version','bn-means-engine-1.0.0',
          'assessable_income', v_assessable, 'assessable_assets', v_assets,
          'approved_deductions', v_deduct, 'household_size', v_hh,
          'threshold_amount', v_thr, 'excess_amount', v_excess,
          'result', v_res, 'currency_code', v_a.currency_code)::text,'sha256'),'hex'),
        v_a.effective_from, v_valid_from, v_valid_until, v_reassess,
        p_actor_user_id, p_correlation_id)
      RETURNING * INTO v_calc;
      v_calc_id := v_calc.calculation_id;

      INSERT INTO public.bn_means_calculation_line(
        calculation_id, line_no, line_kind, fact_kind, fact_id, category_code,
        included, exclusion_reason, raw_amount, normalised_amount, applied_amount, narrative)
      SELECT v_calc_id, 1000 + row_number() OVER (ORDER BY x.income_fact_id), 'INCOME', 'INCOME',
             x.income_fact_id, x.category_code, (o.outcome = 'VERIFIED'),
             CASE WHEN o.outcome = 'VERIFIED' THEN NULL ELSE 'NOT_VERIFIED:' || COALESCE(o.outcome,'MISSING') END,
             x.declared_amount, x.normalised_annual_amount,
             CASE WHEN o.outcome = 'VERIFIED' THEN public._bn_means_round(x.normalised_annual_amount, v_method, v_scale) ELSE 0 END,
             'Income ' || x.category_code || ' (' || x.declared_frequency || ')'
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'income','[]'::jsonb))
             AS x(income_fact_id uuid, category_code text, declared_amount numeric,
                  declared_frequency text, normalised_annual_amount numeric)
        LEFT JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                            WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                              AND vv.fact_kind = 'INCOME' AND vv.fact_id = x.income_fact_id
                            ORDER BY vv.verified_at DESC LIMIT 1) o ON true;

      INSERT INTO public.bn_means_calculation_line(
        calculation_id, line_no, line_kind, fact_kind, fact_id, category_code,
        included, exclusion_reason, raw_amount, normalised_amount, applied_amount, narrative)
      SELECT v_calc_id, 2000 + row_number() OVER (ORDER BY x.asset_fact_id), 'ASSET', 'ASSET',
             x.asset_fact_id, x.category_code, (o.outcome = 'VERIFIED'),
             CASE WHEN o.outcome = 'VERIFIED' THEN NULL ELSE 'NOT_VERIFIED:' || COALESCE(o.outcome,'MISSING') END,
             x.valuation_amount, public._bn_means_round(x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale),
             CASE WHEN o.outcome = 'VERIFIED' THEN public._bn_means_round(x.valuation_amount * COALESCE(x.ownership_share,1), v_method, v_scale) ELSE 0 END,
             'Asset ' || x.category_code
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'assets','[]'::jsonb))
             AS x(asset_fact_id uuid, category_code text, valuation_amount numeric, ownership_share numeric)
        LEFT JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                            WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                              AND vv.fact_kind = 'ASSET' AND vv.fact_id = x.asset_fact_id
                            ORDER BY vv.verified_at DESC LIMIT 1) o ON true;

      INSERT INTO public.bn_means_calculation_line(
        calculation_id, line_no, line_kind, fact_kind, fact_id, category_code,
        included, exclusion_reason, raw_amount, normalised_amount, applied_amount, narrative)
      SELECT v_calc_id, 3000 + row_number() OVER (ORDER BY x.deduction_fact_id), 'DEDUCTION', 'DEDUCTION',
             x.deduction_fact_id, x.category_code,
             (o.outcome = 'VERIFIED' AND COALESCE(x.approval_status,'CLAIMED') <> 'REJECTED'),
             CASE WHEN o.outcome <> 'VERIFIED' OR o.outcome IS NULL THEN 'NOT_VERIFIED:' || COALESCE(o.outcome,'MISSING')
                  WHEN COALESCE(x.approval_status,'CLAIMED') = 'REJECTED' THEN 'DEDUCTION_REJECTED' END,
             x.claimed_amount, x.normalised_annual_amount,
             CASE WHEN o.outcome = 'VERIFIED' AND COALESCE(x.approval_status,'CLAIMED') <> 'REJECTED'
                  THEN public._bn_means_round(x.normalised_annual_amount, v_method, v_scale) ELSE 0 END,
             'Deduction ' || x.category_code || ' (' || COALESCE(x.approval_status,'CLAIMED') || ')'
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'deductions','[]'::jsonb))
             AS x(deduction_fact_id uuid, category_code text, claimed_amount numeric,
                  normalised_annual_amount numeric, approval_status text)
        LEFT JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                            WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                              AND vv.fact_kind = 'DEDUCTION' AND vv.fact_id = x.deduction_fact_id
                            ORDER BY vv.verified_at DESC LIMIT 1) o ON true;

      INSERT INTO public.bn_means_calculation_line(
        calculation_id, line_no, line_kind, fact_kind, fact_id, included, applied_amount, narrative)
      SELECT v_calc_id, 4000 + row_number() OVER (ORDER BY x.member_id), 'HOUSEHOLD', 'HOUSEHOLD',
             x.member_id, (o.outcome = 'VERIFIED'), NULL,
             'Household member ' || COALESCE(x.relationship_code,'') || ' — ' || COALESCE(o.outcome,'MISSING')
        FROM jsonb_to_recordset(COALESCE(v_av.snapshot->'household','[]'::jsonb))
             AS x(member_id uuid, relationship_code text)
        LEFT JOIN LATERAL (SELECT vv.outcome FROM public.bn_means_verification vv
                            WHERE vv.assessment_id = v_id AND vv.assessment_version_id = v_av.assessment_version_id
                              AND vv.fact_kind = 'HOUSEHOLD' AND vv.fact_id = x.member_id
                            ORDER BY vv.verified_at DESC LIMIT 1) o ON true;

      INSERT INTO public.bn_means_calculation_line(
        calculation_id, line_no, line_kind, parameter_id, included, applied_amount, narrative)
      SELECT v_calc_id, 9000 + row_number() OVER (ORDER BY k.key), 'PARAMETER', k.key, true,
             NULLIF(k.value #>> '{}','')::numeric,
             'Policy parameter ' || k.key
        FROM jsonb_each(v_params) k
       WHERE jsonb_typeof(k.value) = 'number';

      INSERT INTO public.bn_means_calculation_line(
        calculation_id, line_no, line_kind, included, applied_amount, narrative)
      VALUES
        (v_calc_id, 9500, 'TOTAL_INCOME', true, v_income, 'Verified normalised annual income'),
        (v_calc_id, 9510, 'TOTAL_DISREGARD', true, v_disregard, 'Policy income disregard'),
        (v_calc_id, 9520, 'TOTAL_DEDUCTIONS', true, v_deduct, 'Allowed deductions'),
        (v_calc_id, 9530, 'TOTAL_ASSETS', true, v_assets, 'Verified assessable assets'),
        (v_calc_id, 9540, 'ASSESSABLE_INCOME', true, v_assessable, 'Income less disregard and deductions'),
        (v_calc_id, 9550, 'THRESHOLD', true, v_thr, 'Applicable threshold for household size ' || v_hh),
        (v_calc_id, 9560, 'EXCESS', true, v_excess, 'Assessable income less threshold'),
        (v_calc_id, 9570, 'RESULT', true, NULL, 'Provisional result: ' || v_res || ' — pending approval');

      UPDATE public.bn_means_assessment
         SET status = 'CALCULATED', row_version = row_version + 1,
             valid_from = v_valid_from, valid_until = v_valid_until,
             reassessment_due = v_reassess,
             updated_at = now(), updated_by = p_actor_user_id
       WHERE assessment_id = v_id
       RETURNING * INTO v_a;

      v_result := jsonb_build_object('assessment_id', v_id, 'calculation_id', v_calc_id,
        'input_hash', v_hash, 'calculation_hash', v_calc.result_hash, 'result', v_res,
        'assessable_income', v_assessable, 'assessable_assets', v_assets,
        'approved_deductions', v_deduct, 'household_size', v_hh,
        'threshold_amount', v_thr, 'excess_amount', v_excess,
        'valid_from', v_valid_from, 'valid_until', v_valid_until,
        'reassessment_due', v_reassess, 'warnings', v_warn,
        'entity_version', v_a.row_version, 'to_status', 'CALCULATED');
    END IF;

  ELSE
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED:%', p_command_name;$body$);

  -- event codes for the new commands
  src := replace(src, '        WHEN ''BN_MEANS_ATTACH_EVIDENCE'' THEN ''EVIDENCE_ATTACHED''',
    '        WHEN ''BN_MEANS_ATTACH_EVIDENCE'' THEN ''EVIDENCE_ATTACHED''
        WHEN ''BN_MEANS_VERIFY_INFORMATION'' THEN ''VERIFICATION_RECORDED''
        WHEN ''BN_MEANS_CALCULATE'' THEN ''CALCULATED''');

  EXECUTE src;
END
$mig$;

REVOKE ALL ON FUNCTION public.bn_means_execute_command_v1(text, uuid, uuid, text, uuid, bigint, text, text, jsonb, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bn_means_execute_command_v1(text, uuid, uuid, text, uuid, bigint, text, text, jsonb, text, uuid) TO authenticated;
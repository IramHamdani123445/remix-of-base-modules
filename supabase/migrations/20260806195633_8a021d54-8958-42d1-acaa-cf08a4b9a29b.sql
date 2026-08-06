-- ===================================================================
-- MT7 — adjustments, independent decision, deterministic recalculation,
--        final approval / rejection.
-- ===================================================================

CREATE OR REPLACE FUNCTION public._bn_means_latest_calculation(p_assessment_id uuid)
RETURNS public.bn_means_calculation
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT * FROM public.bn_means_calculation
   WHERE assessment_id = p_assessment_id
   ORDER BY calculated_at DESC, calculation_id DESC
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public._bn_means_frozen_version(p_assessment_id uuid)
RETURNS public.bn_means_assessment_version
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT * FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public._bn_means_open_adjustments(p_assessment_id uuid)
RETURNS TABLE(requested int, pending_application int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT
    count(*) FILTER (WHERE status = 'REQUESTED')::int,
    count(*) FILTER (WHERE status = 'APPROVED_PENDING_APPLICATION')::int
  FROM public.bn_means_adjustment WHERE assessment_id = p_assessment_id;
$fn$;

-- -------------------------------------------------------------------
-- Deterministic recalculation from an independently approved overlay.
-- Never mutates the previous calculation or its lines.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_recalculate(
  p_assessment_id uuid, p_adjustment_id uuid, p_actor uuid, p_correlation uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a     public.bn_means_assessment%ROWTYPE;
  v_adj   public.bn_means_adjustment%ROWTYPE;
  v_prev  public.bn_means_calculation%ROWTYPE;
  v_new   public.bn_means_calculation%ROWTYPE;
  v_exist public.bn_means_calculation%ROWTYPE;
  v_inputs jsonb;
  v_hash  text;
  v_method text; v_scale int;
  v_income numeric(18,2); v_assets numeric(18,2); v_deduct numeric(18,2);
  v_disregard numeric(18,2); v_base numeric(18,2); v_per numeric(18,2);
  v_asset_thr numeric(18,2);
  v_hh int; v_thr numeric(18,2); v_assessable numeric(18,2); v_excess numeric(18,2);
  v_res text; v_warn jsonb := '[]'::jsonb;
  v_num numeric; v_txt text;
  v_valid_until date; v_reassess date;
BEGIN
  SELECT * INTO v_a   FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  SELECT * INTO v_adj FROM public.bn_means_adjustment WHERE adjustment_id = p_adjustment_id;
  v_prev := public._bn_means_latest_calculation(p_assessment_id);
  IF v_prev.calculation_id IS NULL THEN
    RAISE EXCEPTION 'E_NO_CURRENT_CALCULATION:%', p_assessment_id;
  END IF;

  v_method := COALESCE(v_prev.rounding_method,'HALF_UP');
  v_scale  := COALESCE(v_prev.rounding_scale, 2);
  v_txt    := NULLIF(v_adj.proposed_value #>> '{}','');
  BEGIN v_num := v_txt::numeric; EXCEPTION WHEN others THEN v_num := NULL; END;

  v_inputs := COALESCE(v_prev.input_snapshot,'{}'::jsonb) || jsonb_build_object(
    'adjustment', jsonb_build_object(
      'adjustment_id', v_adj.adjustment_id,
      'adjustment_reference', v_adj.adjustment_reference,
      'target_kind', v_adj.target_kind,
      'target_id', v_adj.target_id,
      'field_or_line_code', v_adj.field_or_line_code,
      'original_value', v_adj.original_value,
      'proposed_value', v_adj.proposed_value,
      'approved_by', v_adj.decided_by),
    'supersedes_calculation_id', v_prev.calculation_id);
  v_hash := encode(digest(v_inputs::text,'sha256'),'hex');

  -- Idempotent replay: identical inputs never create a second calculation.
  SELECT * INTO v_exist FROM public.bn_means_calculation
   WHERE assessment_id = p_assessment_id AND input_hash = v_hash;
  IF FOUND THEN
    RETURN v_exist.calculation_id;
  END IF;

  INSERT INTO public.bn_means_calculation(
    assessment_id, assessment_version_id, policy_version_id, calculation_version,
    engine_version, input_snapshot, input_hash, currency_code, rounding_method,
    rounding_scale, assessable_income, assessable_assets, approved_deductions,
    household_size, threshold_amount, excess_amount, result, warnings,
    result_hash, effective_date, valid_from, valid_until, reassessment_due,
    calculated_by, correlation_id, supersedes_calculation_id,
    triggering_adjustment_id, recalculation_reason)
  VALUES (
    p_assessment_id, v_prev.assessment_version_id, v_prev.policy_version_id,
    v_prev.calculation_version, v_prev.engine_version, v_inputs, v_hash,
    v_prev.currency_code, v_method, v_scale, 0,0,0,0,0,0,'PROVISIONAL','[]'::jsonb,
    'pending', v_prev.effective_date, v_prev.valid_from, v_prev.valid_until,
    v_prev.reassessment_due, p_actor, p_correlation, v_prev.calculation_id,
    p_adjustment_id, COALESCE(v_adj.reason_code,'ADJUSTMENT_APPROVED'))
  RETURNING * INTO v_new;

  -- Full copy of the previous explanation lines (previous calculation untouched).
  INSERT INTO public.bn_means_calculation_line(
    calculation_id, line_no, line_kind, fact_kind, fact_id, category_code,
    parameter_id, included, exclusion_reason, raw_amount, normalised_amount,
    applied_amount, narrative)
  SELECT v_new.calculation_id, line_no, line_kind, fact_kind, fact_id, category_code,
         parameter_id, included, exclusion_reason, raw_amount, normalised_amount,
         applied_amount, narrative
    FROM public.bn_means_calculation_line WHERE calculation_id = v_prev.calculation_id;

  -- Apply the approved overlay to the NEW lines only.
  IF v_adj.target_kind = 'CALCULATION_LINE' THEN
    UPDATE public.bn_means_calculation_line l
       SET applied_amount = COALESCE(v_num, l.applied_amount),
           included = CASE WHEN upper(COALESCE(v_txt,'')) = 'EXCLUDE' THEN false ELSE l.included END,
           narrative = COALESCE(l.narrative,'') || ' — adjusted by ' || COALESCE(v_adj.adjustment_reference,'adjustment')
     WHERE l.calculation_id = v_new.calculation_id
       AND EXISTS (SELECT 1 FROM public.bn_means_calculation_line p
                    WHERE p.calculation_id = v_prev.calculation_id
                      AND p.line_id = v_adj.target_id
                      AND p.line_no = l.line_no);
  ELSIF v_adj.target_kind IN ('INCOME_TREATMENT','ASSET_TREATMENT','DEDUCTION_TREATMENT') THEN
    UPDATE public.bn_means_calculation_line l
       SET included = CASE WHEN upper(COALESCE(v_txt,'')) = 'EXCLUDE' THEN false ELSE true END,
           applied_amount = CASE WHEN upper(COALESCE(v_txt,'')) = 'EXCLUDE' THEN 0
                                 ELSE COALESCE(public._bn_means_round(v_num, v_method, v_scale), l.applied_amount) END,
           exclusion_reason = CASE WHEN upper(COALESCE(v_txt,'')) = 'EXCLUDE'
                                   THEN 'ADJUSTMENT:' || COALESCE(v_adj.reason_code,'APPROVED') ELSE NULL END,
           narrative = COALESCE(l.narrative,'') || ' — adjusted by ' || COALESCE(v_adj.adjustment_reference,'adjustment')
     WHERE l.calculation_id = v_new.calculation_id
       AND l.fact_id = v_adj.target_id
       AND l.line_kind = replace(v_adj.target_kind,'_TREATMENT','');
  ELSIF v_adj.target_kind = 'POLICY_PARAMETER_APPLICATION' THEN
    UPDATE public.bn_means_calculation_line l
       SET applied_amount = COALESCE(v_num, l.applied_amount),
           narrative = COALESCE(l.narrative,'') || ' — adjusted by ' || COALESCE(v_adj.adjustment_reference,'adjustment')
     WHERE l.calculation_id = v_new.calculation_id
       AND l.line_kind = 'PARAMETER'
       AND l.parameter_id = v_adj.field_or_line_code;
  ELSIF v_adj.target_kind = 'VALIDITY_PERIOD' THEN
    BEGIN v_valid_until := v_txt::date; EXCEPTION WHEN others THEN v_valid_until := v_prev.valid_until; END;
  ELSIF v_adj.target_kind = 'REASSESSMENT_DATE' THEN
    BEGIN v_reassess := v_txt::date; EXCEPTION WHEN others THEN v_reassess := v_prev.reassessment_due; END;
  END IF;

  -- Re-run the deterministic engine over the new line set.
  SELECT COALESCE(sum(applied_amount) FILTER (WHERE line_kind='INCOME' AND included),0),
         COALESCE(sum(applied_amount) FILTER (WHERE line_kind='ASSET' AND included),0),
         COALESCE(sum(applied_amount) FILTER (WHERE line_kind='DEDUCTION' AND included),0),
         count(*) FILTER (WHERE line_kind='HOUSEHOLD' AND included)
    INTO v_income, v_assets, v_deduct, v_hh
    FROM public.bn_means_calculation_line WHERE calculation_id = v_new.calculation_id;

  SELECT COALESCE(max(applied_amount) FILTER (WHERE parameter_id='income_disregard_annual'),0),
         COALESCE(max(applied_amount) FILTER (WHERE parameter_id='base_threshold_annual'),0),
         COALESCE(max(applied_amount) FILTER (WHERE parameter_id='per_additional_member_annual'),0),
         max(applied_amount) FILTER (WHERE parameter_id='asset_threshold')
    INTO v_disregard, v_base, v_per, v_asset_thr
    FROM public.bn_means_calculation_line
   WHERE calculation_id = v_new.calculation_id AND line_kind = 'PARAMETER';

  v_thr        := public._bn_means_round(v_base + v_per * GREATEST(v_hh - 1, 0), v_method, v_scale);
  v_assessable := public._bn_means_round(GREATEST(v_income - v_disregard - v_deduct, 0), v_method, v_scale);
  v_excess     := public._bn_means_round(v_assessable - v_thr, v_method, v_scale);
  v_res        := CASE WHEN v_excess > 0 THEN 'FAIL' ELSE 'PASS' END;
  IF v_asset_thr IS NOT NULL AND v_assets > v_asset_thr THEN
    v_res := 'FAIL';
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','ASSET_THRESHOLD_EXCEEDED','threshold',v_asset_thr,'assets',v_assets));
  END IF;
  IF v_hh = 0 THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','NO_VERIFIED_HOUSEHOLD_MEMBER'));
  END IF;
  v_warn := v_warn || jsonb_build_array(jsonb_build_object(
    'code','RECALCULATED_AFTER_ADJUSTMENT',
    'adjustment_reference', v_adj.adjustment_reference,
    'previous_calculation_id', v_prev.calculation_id,
    'previous_excess_amount', v_prev.excess_amount,
    'previous_result', v_prev.result));

  UPDATE public.bn_means_calculation_line
     SET applied_amount = CASE line_kind
           WHEN 'TOTAL_INCOME' THEN v_income
           WHEN 'TOTAL_DISREGARD' THEN v_disregard
           WHEN 'TOTAL_DEDUCTIONS' THEN v_deduct
           WHEN 'TOTAL_ASSETS' THEN v_assets
           WHEN 'ASSESSABLE_INCOME' THEN v_assessable
           WHEN 'THRESHOLD' THEN v_thr
           WHEN 'EXCESS' THEN v_excess
           ELSE applied_amount END,
         narrative = CASE WHEN line_kind = 'RESULT'
           THEN 'Provisional result: ' || v_res || ' — pending approval' ELSE narrative END
   WHERE calculation_id = v_new.calculation_id
     AND line_kind IN ('TOTAL_INCOME','TOTAL_DISREGARD','TOTAL_DEDUCTIONS','TOTAL_ASSETS',
                       'ASSESSABLE_INCOME','THRESHOLD','EXCESS','RESULT');

  UPDATE public.bn_means_calculation
     SET assessable_income = v_assessable, assessable_assets = v_assets,
         approved_deductions = v_deduct, household_size = v_hh,
         threshold_amount = v_thr, excess_amount = v_excess, result = v_res,
         warnings = v_warn,
         valid_until = COALESCE(v_valid_until, valid_until),
         reassessment_due = COALESCE(v_reassess, reassessment_due),
         result_hash = encode(digest(jsonb_build_object(
           'input_hash', v_hash, 'engine_version', v_new.engine_version,
           'assessable_income', v_assessable, 'assessable_assets', v_assets,
           'approved_deductions', v_deduct, 'household_size', v_hh,
           'threshold_amount', v_thr, 'excess_amount', v_excess,
           'result', v_res, 'currency_code', v_new.currency_code)::text,'sha256'),'hex')
   WHERE calculation_id = v_new.calculation_id
   RETURNING * INTO v_new;

  UPDATE public.bn_means_calculation SET calculation_hash = result_hash
   WHERE calculation_id = v_new.calculation_id;

  RETURN v_new.calculation_id;
END;
$fn$;

-- -------------------------------------------------------------------
-- MT7 command handlers.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_mt7_execute(
  p_command_name text, p_assessment_id uuid, p_actor uuid, p_actor_code text,
  p_correlation uuid, p_reason_code text, p_justification text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a     public.bn_means_assessment%ROWTYPE;
  v_av    public.bn_means_assessment_version%ROWTYPE;
  v_calc  public.bn_means_calculation%ROWTYPE;
  v_pv    public.bn_means_policy_version%ROWTYPE;
  v_adj   public.bn_means_adjustment%ROWTYPE;
  v_from  text;
  v_kind  text;
  v_decision text;
  v_reason text;
  v_ref   text;
  v_new_id uuid;
  v_calc_id uuid;
  v_count int;
  v_num   numeric;
  v_effect numeric(18,2);
  v_result jsonb;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  v_from  := v_a.status;
  v_av    := public._bn_means_frozen_version(p_assessment_id);
  v_calc  := public._bn_means_latest_calculation(p_assessment_id);
  v_reason := COALESCE(NULLIF(p_reason_code,''), NULLIF(p_payload->>'reason_code',''));

  -- ============ REQUEST ADJUSTMENT =================================
  IF p_command_name = 'BN_MEANS_REQUEST_ADJUSTMENT' THEN
    IF v_from NOT IN ('CALCULATED','REVIEW_PENDING') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot accept an adjustment request', v_from;
    END IF;
    IF v_calc.calculation_id IS NULL THEN
      RAISE EXCEPTION 'E_NO_CURRENT_CALCULATION:%', p_assessment_id;
    END IF;

    v_kind := upper(COALESCE(p_payload->>'target_kind',''));
    IF v_kind NOT IN ('CALCULATION_LINE','INCOME_TREATMENT','ASSET_TREATMENT',
                      'DEDUCTION_TREATMENT','POLICY_PARAMETER_APPLICATION',
                      'VALIDITY_PERIOD','REASSESSMENT_DATE') THEN
      RAISE EXCEPTION 'E_TARGET_KIND_INVALID:%', v_kind;
    END IF;
    IF COALESCE(p_payload->>'field_or_line_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:field_or_line_code';
    END IF;
    IF (p_payload->'proposed_value') IS NULL OR p_payload->>'proposed_value' IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:proposed_value';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:%', p_command_name;
    END IF;
    IF length(COALESCE(NULLIF(p_justification,''), NULLIF(p_payload->>'structured_justification',''),'')) < 10 THEN
      RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED:%', p_command_name;
    END IF;
    IF lower(COALESCE(p_payload->>'field_or_line_code','')) = 'policy_version_id'
       OR (p_payload->>'policy_version_id') IS NOT NULL THEN
      RAISE EXCEPTION 'E_POLICY_VERSION_CHANGE_DENIED:use a controlled recalculation or successor assessment';
    END IF;

    IF (p_payload->>'calculation_id') IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:calculation_id';
    END IF;
    IF (p_payload->>'calculation_id')::uuid <> v_calc.calculation_id THEN
      RAISE EXCEPTION 'E_CALCULATION_NOT_LATEST:%', p_payload->>'calculation_id';
    END IF;
    IF v_calc.assessment_id <> p_assessment_id
       OR v_av.assessment_version_id IS NULL
       OR v_calc.assessment_version_id <> v_av.assessment_version_id THEN
      RAISE EXCEPTION 'E_VERSION_OWNERSHIP_MISMATCH:%', v_calc.calculation_id;
    END IF;
    IF (p_payload->>'assessment_version_id') IS NOT NULL
       AND (p_payload->>'assessment_version_id')::uuid <> v_av.assessment_version_id THEN
      RAISE EXCEPTION 'E_VERSION_OWNERSHIP_MISMATCH:%', p_payload->>'assessment_version_id';
    END IF;

    BEGIN v_num := NULLIF(p_payload->>'proposed_value','')::numeric; EXCEPTION WHEN others THEN v_num := NULL; END;
    IF v_num IS NOT NULL AND v_kind NOT IN ('VALIDITY_PERIOD','REASSESSMENT_DATE') THEN
      IF COALESCE(p_payload->>'currency_code','') = '' THEN
        RAISE EXCEPTION 'E_CURRENCY_REQUIRED:monetary adjustment';
      END IF;
      IF (p_payload->>'currency_code') <> v_a.currency_code THEN
        RAISE EXCEPTION 'E_CURRENCY_MISMATCH:assessment=% payload=%', v_a.currency_code, p_payload->>'currency_code';
      END IF;
    END IF;

    IF v_kind IN ('INCOME_TREATMENT','ASSET_TREATMENT','DEDUCTION_TREATMENT')
       AND COALESCE(p_payload->>'evidence_reference','') = ''
       AND (p_payload->>'evidence_id') IS NULL THEN
      RAISE EXCEPTION 'E_EVIDENCE_REFERENCE_REQUIRED:%', v_kind;
    END IF;

    SELECT count(*) INTO v_count FROM public.bn_means_adjustment
     WHERE assessment_id = p_assessment_id
       AND status IN ('REQUESTED','APPROVED_PENDING_APPLICATION')
       AND COALESCE(target_kind,'') = v_kind
       AND COALESCE(target_id::text,'') = COALESCE(p_payload->>'target_id','')
       AND COALESCE(field_or_line_code,'') = COALESCE(p_payload->>'field_or_line_code','');
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_DUPLICATE_OPEN_ADJUSTMENT:% %', v_kind, p_payload->>'field_or_line_code';
    END IF;

    BEGIN
      v_effect := v_num - NULLIF(p_payload->>'original_value','')::numeric;
    EXCEPTION WHEN others THEN v_effect := NULL; END;

    v_ref := 'ADJ-' || to_char(now(),'YYYY') || '-' ||
             lpad(nextval('public.bn_means_adjustment_ref_seq')::text, 6, '0');

    INSERT INTO public.bn_means_adjustment(
      assessment_id, assessment_version_id, calculation_id, adjustment_reference,
      target_kind, target_id, field_or_line_code, fact_kind, fact_id, field_name,
      original_value, proposed_value, currency_code, evidence_id, evidence_reference,
      financial_effect, original_calculation_hash, reason_code, justification,
      status, requested_by, correlation_id)
    VALUES (
      p_assessment_id, v_av.assessment_version_id, v_calc.calculation_id, v_ref,
      v_kind, NULLIF(p_payload->>'target_id','')::uuid, p_payload->>'field_or_line_code',
      NULLIF(p_payload->>'fact_kind',''), NULLIF(p_payload->>'fact_id','')::uuid,
      p_payload->>'field_or_line_code',
      COALESCE(p_payload->'original_value','null'::jsonb),
      p_payload->'proposed_value',
      NULLIF(p_payload->>'currency_code',''),
      NULLIF(p_payload->>'evidence_id','')::uuid,
      NULLIF(p_payload->>'evidence_reference',''),
      v_effect,
      COALESCE(v_calc.calculation_hash, v_calc.result_hash),
      v_reason,
      COALESCE(NULLIF(p_justification,''), p_payload->>'structured_justification'),
      'REQUESTED', p_actor, p_correlation)
    RETURNING adjustment_id INTO v_new_id;

    UPDATE public.bn_means_assessment
       SET status = 'REVIEW_PENDING', row_version = row_version + 1,
           updated_at = now(), updated_by = p_actor
     WHERE assessment_id = p_assessment_id
     RETURNING * INTO v_a;

    RETURN jsonb_build_object(
      'assessment_id', p_assessment_id, 'adjustment_id', v_new_id,
      'adjustment_reference', v_ref, 'adjustment_status','REQUESTED',
      'calculation_id', v_calc.calculation_id,
      'original_calculation_hash', COALESCE(v_calc.calculation_hash, v_calc.result_hash),
      'event_code','ADJUSTMENT_REQUESTED',
      'entity_version', v_a.row_version, 'to_status', v_a.status);

  -- ============ ADJUSTMENT DECISION ================================
  ELSIF p_command_name = 'BN_MEANS_APPROVE_ADJUSTMENT' THEN
    IF (p_payload->>'adjustment_id') IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:adjustment_id';
    END IF;
    SELECT * INTO v_adj FROM public.bn_means_adjustment
     WHERE adjustment_id = (p_payload->>'adjustment_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_NOT_FOUND:%', p_payload->>'adjustment_id';
    END IF;
    IF v_adj.assessment_id <> p_assessment_id THEN
      RAISE EXCEPTION 'E_VERSION_OWNERSHIP_MISMATCH:adjustment does not belong to the assessment';
    END IF;
    IF (p_payload->>'expected_adjustment_row_version') IS NOT NULL
       AND (p_payload->>'expected_adjustment_row_version')::bigint <> v_adj.row_version THEN
      RAISE EXCEPTION 'E_STALE_ADJUSTMENT_VERSION:expected=% actual=%',
        p_payload->>'expected_adjustment_row_version', v_adj.row_version;
    END IF;
    IF v_adj.requested_by = p_actor THEN
      RAISE EXCEPTION 'E_SELF_APPROVAL_DENIED:%', p_command_name;
    END IF;

    v_decision := upper(COALESCE(p_payload->>'decision',''));
    IF v_decision NOT IN ('APPROVE','REJECT') THEN
      RAISE EXCEPTION 'E_DECISION_INVALID:%', v_decision;
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:%', p_command_name;
    END IF;

    -- Already-decided adjustments are terminal; a pending application may retry.
    IF v_adj.status = 'APPROVED_PENDING_APPLICATION' AND v_decision = 'APPROVE' THEN
      NULL;
    ELSIF v_adj.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'E_ADJUSTMENT_ALREADY_DECIDED:%', v_adj.status;
    END IF;

    IF v_calc.calculation_id IS NULL OR v_adj.calculation_id <> v_calc.calculation_id THEN
      RAISE EXCEPTION 'E_CALCULATION_NOT_LATEST:%', v_adj.calculation_id;
    END IF;

    IF v_decision = 'REJECT' THEN
      UPDATE public.bn_means_adjustment
         SET status = 'REJECTED', decided_by = p_actor, decided_at = now(),
             decision_reason_code = v_reason,
             decision_note = COALESCE(NULLIF(p_justification,''), p_payload->>'decision_note'),
             row_version = row_version + 1, updated_at = now()
       WHERE adjustment_id = v_adj.adjustment_id;

      UPDATE public.bn_means_assessment
         SET status = 'CALCULATED', row_version = row_version + 1,
             updated_at = now(), updated_by = p_actor
       WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;

      RETURN jsonb_build_object('assessment_id', p_assessment_id,
        'adjustment_id', v_adj.adjustment_id, 'adjustment_status','REJECTED',
        'decision','REJECT', 'calculation_id', v_calc.calculation_id,
        'event_code','ADJUSTMENT_REJECTED',
        'entity_version', v_a.row_version, 'to_status', v_a.status);
    END IF;

    -- APPROVE: record the decision first, then apply deterministically.
    UPDATE public.bn_means_adjustment
       SET status = 'APPROVED_PENDING_APPLICATION',
           decided_by = COALESCE(decided_by, p_actor),
           decided_at = COALESCE(decided_at, now()),
           decision_reason_code = v_reason,
           decision_note = COALESCE(NULLIF(p_justification,''), p_payload->>'decision_note'),
           row_version = row_version + 1, updated_at = now()
     WHERE adjustment_id = v_adj.adjustment_id
     RETURNING * INTO v_adj;

    UPDATE public.bn_means_assessment
       SET status = 'REVIEW_PENDING', row_version = row_version + 1,
           updated_at = now(), updated_by = p_actor
     WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;

    BEGIN
      v_calc_id := public._bn_means_recalculate(p_assessment_id, v_adj.adjustment_id, p_actor, p_correlation);
    EXCEPTION WHEN others THEN
      UPDATE public.bn_means_adjustment
         SET application_error = SQLERRM, updated_at = now()
       WHERE adjustment_id = v_adj.adjustment_id;
      RETURN jsonb_build_object('assessment_id', p_assessment_id,
        'adjustment_id', v_adj.adjustment_id,
        'adjustment_status','APPROVED_PENDING_APPLICATION',
        'decision','APPROVE', 'application_error', SQLERRM,
        'event_code','ADJUSTMENT_APPROVED',
        'entity_version', v_a.row_version, 'to_status', v_a.status);
    END;

    SELECT * INTO v_calc FROM public.bn_means_calculation WHERE calculation_id = v_calc_id;

    UPDATE public.bn_means_adjustment
       SET status = 'APPROVED', applied_calculation_id = v_calc_id,
           applied_at = now(), application_error = NULL,
           row_version = row_version + 1, updated_at = now()
     WHERE adjustment_id = v_adj.adjustment_id;

    UPDATE public.bn_means_assessment
       SET status = 'CALCULATED', result = v_calc.result,
           valid_until = v_calc.valid_until, reassessment_due = v_calc.reassessment_due,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor
     WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;

    RETURN jsonb_build_object('assessment_id', p_assessment_id,
      'adjustment_id', v_adj.adjustment_id, 'adjustment_status','APPROVED',
      'decision','APPROVE', 'calculation_id', v_calc_id,
      'supersedes_calculation_id', v_calc.supersedes_calculation_id,
      'calculation_hash', v_calc.calculation_hash, 'result', v_calc.result,
      'event_code','ADJUSTMENT_APPROVED',
      'entity_version', v_a.row_version, 'to_status', v_a.status);

  -- ============ FINAL APPROVAL / REJECTION =========================
  ELSIF p_command_name IN ('BN_MEANS_APPROVE','BN_MEANS_REJECT') THEN
    IF p_command_name = 'BN_MEANS_APPROVE' AND v_from NOT IN ('CALCULATED','APPROVAL_PENDING') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% -> APPROVED', v_from;
    END IF;
    IF p_command_name = 'BN_MEANS_REJECT' AND v_from NOT IN ('CALCULATED','APPROVAL_PENDING','REVIEW_PENDING') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% -> REJECTED', v_from;
    END IF;
    IF v_a.status = 'APPROVED' THEN
      RAISE EXCEPTION 'E_APPROVAL_ALREADY_RECORDED:%', p_assessment_id;
    END IF;
    IF v_a.status = 'REJECTED' THEN
      RAISE EXCEPTION 'E_REJECTION_ALREADY_RECORDED:%', p_assessment_id;
    END IF;
    IF v_calc.calculation_id IS NULL THEN
      RAISE EXCEPTION 'E_NO_CURRENT_CALCULATION:%', p_assessment_id;
    END IF;
    IF v_av.assessment_version_id IS NULL
       OR v_calc.assessment_version_id <> v_av.assessment_version_id THEN
      RAISE EXCEPTION 'E_VERSION_OWNERSHIP_MISMATCH:%', v_calc.calculation_id;
    END IF;
    IF (p_payload->>'calculation_id') IS NOT NULL
       AND (p_payload->>'calculation_id')::uuid <> v_calc.calculation_id THEN
      RAISE EXCEPTION 'E_CALCULATION_NOT_LATEST:%', p_payload->>'calculation_id';
    END IF;
    IF COALESCE(p_payload->>'expected_calculation_hash','') <> ''
       AND p_payload->>'expected_calculation_hash' <> COALESCE(v_calc.calculation_hash, v_calc.result_hash) THEN
      RAISE EXCEPTION 'E_CALCULATION_HASH_MISMATCH:%', p_payload->>'expected_calculation_hash';
    END IF;

    SELECT count(*) INTO v_count FROM public.bn_means_adjustment
     WHERE assessment_id = p_assessment_id AND status = 'REQUESTED';
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_OPEN_ADJUSTMENT_EXISTS:% open request(s)', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM public.bn_means_adjustment
     WHERE assessment_id = p_assessment_id AND status = 'APPROVED_PENDING_APPLICATION';
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_ADJUSTMENT_APPLICATION_PENDING:% adjustment(s)', v_count;
    END IF;

    IF p_command_name = 'BN_MEANS_APPROVE' THEN
      -- Verification must be complete for the frozen version.
      IF NOT COALESCE((public._bn_means_readiness(p_assessment_id)->>'ready_for_calculation')::boolean, false)
         AND jsonb_array_length(COALESCE(public._bn_means_readiness(p_assessment_id)->'missing_verifications','[]'::jsonb)) > 0 THEN
        RAISE EXCEPTION 'E_VERIFICATION_INCOMPLETE:%', p_assessment_id;
      END IF;

      SELECT * INTO v_pv FROM public.bn_means_policy_version
       WHERE policy_version_id = v_a.policy_version_id;
      IF NOT FOUND OR v_pv.status <> 'ACTIVE'
         OR v_pv.effective_from > v_a.effective_from
         OR (v_pv.effective_to IS NOT NULL AND v_pv.effective_to < v_a.effective_from) THEN
        RAISE EXCEPTION 'E_POLICY_NO_LONGER_EFFECTIVE:%', v_a.policy_version_id;
      END IF;

      SELECT count(*) INTO v_count FROM public.bn_means_adjustment
       WHERE assessment_id = p_assessment_id AND requested_by = p_actor;
      IF v_count > 0 THEN
        RAISE EXCEPTION 'E_SELF_APPROVAL_DENIED:approver requested an adjustment on this assessment';
      END IF;
    ELSE
      IF v_reason IS NULL THEN
        RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:%', p_command_name;
      END IF;
      IF length(COALESCE(NULLIF(p_justification,''), NULLIF(p_payload->>'structured_justification',''),'')) < 10 THEN
        RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED:%', p_command_name;
      END IF;
    END IF;

    INSERT INTO public.bn_means_approval(
      assessment_id, decision, decision_reason, justification, calculation_id,
      maker_user_id, decided_by, correlation_id)
    VALUES (p_assessment_id,
      CASE WHEN p_command_name = 'BN_MEANS_APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
      v_reason, COALESCE(NULLIF(p_justification,''), p_payload->>'structured_justification'),
      v_calc.calculation_id, v_a.maker_user_id, p_actor, p_correlation)
    RETURNING approval_id INTO v_new_id;

    IF p_command_name = 'BN_MEANS_APPROVE' THEN
      UPDATE public.bn_means_assessment
         SET status = 'APPROVED', checker_user_id = p_actor, approved_at = now(),
             decided_at = now(), approved_calculation_id = v_calc.calculation_id,
             decision_reason_code = v_reason,
             result = v_calc.result,
             row_version = row_version + 1, updated_at = now(), updated_by = p_actor
       WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;
    ELSE
      UPDATE public.bn_means_assessment
         SET status = 'REJECTED', checker_user_id = p_actor, decided_at = now(),
             decision_reason_code = v_reason,
             decision_justification = COALESCE(NULLIF(p_justification,''), p_payload->>'structured_justification'),
             row_version = row_version + 1, updated_at = now(), updated_by = p_actor
       WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;
    END IF;

    INSERT INTO public.bn_means_communication_intent(
      assessment_id, event_code, recipient_ref, context_data, idempotency_key,
      correlation_id, created_by)
    VALUES (p_assessment_id,
      CASE WHEN p_command_name = 'BN_MEANS_APPROVE'
           THEN 'MEANS_ASSESSMENT_APPROVED' ELSE 'MEANS_ASSESSMENT_REJECTED' END,
      jsonb_build_object('person_id', v_a.person_id, 'claim_id', v_a.claim_id),
      jsonb_build_object('assessment_reference', v_a.assessment_reference,
                         'benefit_programme', v_a.benefit_programme,
                         'decision_reason_code', v_reason),
      'MEANS_DECISION:' || p_assessment_id::text || ':' || v_new_id::text,
      p_correlation, p_actor)
    ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object('assessment_id', p_assessment_id,
      'approval_id', v_new_id,
      'decision', CASE WHEN p_command_name = 'BN_MEANS_APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
      'calculation_id', v_calc.calculation_id,
      'calculation_hash', COALESCE(v_calc.calculation_hash, v_calc.result_hash),
      'event_code', CASE WHEN p_command_name = 'BN_MEANS_APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
      'entity_version', v_a.row_version, 'to_status', v_a.status);
  END IF;

  RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED:%', p_command_name;
END;
$fn$;

REVOKE ALL ON FUNCTION public._bn_means_mt7_execute(text,uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_means_recalculate(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_means_latest_calculation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_means_frozen_version(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_means_open_adjustments(uuid) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------
-- Wire MT7 into the single governed command boundary without rewriting
-- the delivered MT0–MT6 handler bodies.
-- -------------------------------------------------------------------
DO $mig$
DECLARE d text; v_marker text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'bn_means_execute_command_v1';

  v_marker := '  ELSE' || chr(10) ||
              '    RAISE EXCEPTION ''E_COMMAND_NOT_IMPLEMENTED:%'', p_command_name;' || chr(10) ||
              '  END IF;';
  IF position(v_marker in d) = 0 THEN
    RAISE EXCEPTION 'MT7 wiring marker not found in bn_means_execute_command_v1';
  END IF;

  v_new := '  ELSIF p_command_name IN (''BN_MEANS_REQUEST_ADJUSTMENT'',''BN_MEANS_APPROVE_ADJUSTMENT'',''BN_MEANS_APPROVE'',''BN_MEANS_REJECT'') THEN' || chr(10) ||
           '    v_result := public._bn_means_mt7_execute(p_command_name, v_id, p_actor_user_id, p_actor_user_code, p_correlation_id, p_reason_code, p_justification, p_payload);' || chr(10) ||
           '    SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = v_id;' || chr(10) ||
           v_marker;

  d := replace(d, v_marker, v_new);
  d := replace(d, 'ELSE ''FACT_RECORDED'' END,', 'ELSE COALESCE(v_result->>''event_code'',''FACT_RECORDED'') END,');
  EXECUTE d;
END
$mig$;

-- -------------------------------------------------------------------
-- Canonical action availability — the single source of truth.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_available_actions_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a public.bn_means_assessment%ROWTYPE;
  v_calc public.bn_means_calculation%ROWTYPE;
  v_av public.bn_means_assessment_version%ROWTYPE;
  v_pv public.bn_means_policy_version%ROWTYPE;
  v_out jsonb := '[]'::jsonb;
  v_cmd text;
  v_perm jsonb;
  v_allowed boolean;
  v_reason text;
  v_maker_src text;
  v_maker uuid;
  v_count int;
  v_open int; v_pending int;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  v_calc := public._bn_means_latest_calculation(p_assessment_id);
  v_av   := public._bn_means_frozen_version(p_assessment_id);
  SELECT o.requested, o.pending_application INTO v_open, v_pending
    FROM public._bn_means_open_adjustments(p_assessment_id) o;

  FOREACH v_cmd IN ARRAY ARRAY[
    'BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_ADD_INCOME','BN_MEANS_ADD_ASSET',
    'BN_MEANS_ADD_DEDUCTION','BN_MEANS_ATTACH_EVIDENCE','BN_MEANS_SUBMIT',
    'BN_MEANS_VERIFY_INFORMATION','BN_MEANS_CALCULATE','BN_MEANS_REQUEST_ADJUSTMENT',
    'BN_MEANS_APPROVE_ADJUSTMENT','BN_MEANS_APPROVE','BN_MEANS_REJECT','BN_MEANS_ACTIVATE',
    'BN_MEANS_SCHEDULE_REASSESSMENT','BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE',
    'BN_MEANS_SUPERSEDE','BN_MEANS_CLOSE']
  LOOP
    v_allowed := true; v_reason := NULL;

    v_perm := public.bn_means_check_actor_permission(
      p_actor_user_id, public._bn_means_action_for_command(v_cmd), true);
    IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
      v_allowed := false;
      v_reason := CASE v_perm->>'code'
        WHEN 'ACTIONS_DISABLED' THEN 'ACTIONS_DISABLED'
        ELSE 'PERMISSION_DENIED' END;
    END IF;

    IF v_allowed THEN
      IF v_cmd IN ('BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_ADD_INCOME',
                   'BN_MEANS_ADD_ASSET','BN_MEANS_ADD_DEDUCTION')
         AND NOT public._bn_means_is_editable(v_a.status) THEN
        v_allowed := false;
        v_reason := CASE WHEN v_a.status = 'SUBMITTED' THEN 'ALREADY_SUBMITTED' ELSE 'INVALID_STATE' END;
      ELSIF v_cmd = 'BN_MEANS_SUBMIT' THEN
        IF NOT public._bn_means_can_transition(v_a.status, 'SUBMITTED') THEN
          v_allowed := false;
          v_reason := CASE WHEN v_a.status = 'SUBMITTED' THEN 'ALREADY_SUBMITTED' ELSE 'INVALID_STATE' END;
        ELSIF v_a.policy_version_id IS NULL THEN
          v_allowed := false; v_reason := 'MISSING_REQUIRED_INFORMATION';
        ELSE
          SELECT count(*) INTO v_count FROM public.bn_means_household_member
           WHERE assessment_id = p_assessment_id AND voided_at IS NULL;
          IF v_count = 0 THEN
            v_allowed := false; v_reason := 'MISSING_REQUIRED_INFORMATION';
          ELSE
            SELECT count(*) INTO v_count
              FROM public.bn_means_policy_version pv,
                   LATERAL jsonb_array_elements_text(COALESCE(pv.required_evidence,'[]'::jsonb)) req(code)
             WHERE pv.policy_version_id = v_a.policy_version_id
               AND NOT EXISTS (SELECT 1 FROM public.bn_means_evidence e
                                WHERE e.assessment_id = p_assessment_id
                                  AND e.evidence_type = req.code
                                  AND e.status IN ('ATTACHED','RECEIVED'));
            IF v_count > 0 THEN v_allowed := false; v_reason := 'MISSING_EVIDENCE'; END IF;
          END IF;
        END IF;
      ELSIF v_cmd = 'BN_MEANS_VERIFY_INFORMATION' AND v_a.status NOT IN ('SUBMITTED','VERIFICATION_PENDING') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd = 'BN_MEANS_CALCULATE' THEN
        IF v_a.status <> 'VERIFICATION_PENDING' THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSIF NOT COALESCE((public._bn_means_readiness(p_assessment_id)->>'ready_for_calculation')::boolean,false) THEN
          v_allowed := false; v_reason := 'NOT_READY_FOR_CALCULATION';
        END IF;

      -- ---------------- MT7 ----------------
      ELSIF v_cmd = 'BN_MEANS_REQUEST_ADJUSTMENT' THEN
        IF v_a.status NOT IN ('CALCULATED','REVIEW_PENDING') THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSIF v_calc.calculation_id IS NULL THEN
          v_allowed := false; v_reason := 'NO_CURRENT_CALCULATION';
        ELSIF v_av.assessment_version_id IS NULL
              OR v_calc.assessment_version_id <> v_av.assessment_version_id THEN
          v_allowed := false; v_reason := 'CALCULATION_NOT_LATEST';
        ELSIF COALESCE(v_pending,0) > 0 THEN
          v_allowed := false; v_reason := 'ADJUSTMENT_APPLICATION_PENDING';
        END IF;

      ELSIF v_cmd = 'BN_MEANS_APPROVE_ADJUSTMENT' THEN
        IF COALESCE(v_open,0) + COALESCE(v_pending,0) = 0 THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSIF v_calc.calculation_id IS NULL THEN
          v_allowed := false; v_reason := 'NO_CURRENT_CALCULATION';
        ELSE
          SELECT count(*) INTO v_count FROM public.bn_means_adjustment
           WHERE assessment_id = p_assessment_id
             AND status IN ('REQUESTED','APPROVED_PENDING_APPLICATION')
             AND requested_by <> p_actor_user_id;
          IF v_count = 0 THEN
            v_allowed := false; v_reason := 'SELF_APPROVAL_DENIED';
          END IF;
        END IF;

      ELSIF v_cmd IN ('BN_MEANS_APPROVE','BN_MEANS_REJECT') THEN
        IF v_a.status = 'APPROVED' THEN
          v_allowed := false; v_reason := 'APPROVAL_ALREADY_RECORDED';
        ELSIF v_a.status = 'REJECTED' THEN
          v_allowed := false; v_reason := 'REJECTION_ALREADY_RECORDED';
        ELSIF (v_cmd = 'BN_MEANS_APPROVE' AND v_a.status NOT IN ('CALCULATED','APPROVAL_PENDING'))
           OR (v_cmd = 'BN_MEANS_REJECT'  AND v_a.status NOT IN ('CALCULATED','APPROVAL_PENDING','REVIEW_PENDING')) THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSIF v_calc.calculation_id IS NULL THEN
          v_allowed := false; v_reason := 'NO_CURRENT_CALCULATION';
        ELSIF v_av.assessment_version_id IS NULL
              OR v_calc.assessment_version_id <> v_av.assessment_version_id THEN
          v_allowed := false; v_reason := 'CALCULATION_NOT_LATEST';
        ELSIF COALESCE(v_open,0) > 0 THEN
          v_allowed := false; v_reason := 'OPEN_ADJUSTMENT_EXISTS';
        ELSIF COALESCE(v_pending,0) > 0 THEN
          v_allowed := false; v_reason := 'ADJUSTMENT_APPLICATION_PENDING';
        ELSIF v_cmd = 'BN_MEANS_APPROVE' THEN
          SELECT * INTO v_pv FROM public.bn_means_policy_version
           WHERE policy_version_id = v_a.policy_version_id;
          IF NOT FOUND OR v_pv.status <> 'ACTIVE'
             OR v_pv.effective_from > v_a.effective_from
             OR (v_pv.effective_to IS NOT NULL AND v_pv.effective_to < v_a.effective_from) THEN
            v_allowed := false; v_reason := 'POLICY_NO_LONGER_EFFECTIVE';
          ELSE
            SELECT count(*) INTO v_count FROM public.bn_means_adjustment
             WHERE assessment_id = p_assessment_id AND requested_by = p_actor_user_id;
            IF v_count > 0 THEN
              v_allowed := false; v_reason := 'SELF_APPROVAL_DENIED';
            END IF;
          END IF;
        END IF;

      ELSIF v_cmd = 'BN_MEANS_ACTIVATE' THEN
        IF v_a.status <> 'APPROVED' THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSE
          v_allowed := false; v_reason := 'NOT_IMPLEMENTED';
        END IF;
      ELSIF v_cmd IN ('BN_MEANS_SUPERSEDE','BN_MEANS_SCHEDULE_REASSESSMENT')
            AND v_a.status NOT IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd = 'BN_MEANS_CLOSE' AND v_a.status IN ('CLOSED','CANCELLED') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      END IF;
    END IF;

    IF v_allowed THEN
      v_maker_src := public._bn_means_maker_source(v_cmd);
      IF v_maker_src IS NOT NULL THEN
        SELECT maker_user_id INTO v_maker FROM public.bn_means_command_maker
         WHERE assessment_id = p_assessment_id AND maker_role = v_maker_src;
        IF v_maker IS NULL THEN
          v_allowed := false; v_reason := 'MAKER_CHECKER_REQUIRED';
        ELSIF v_maker = p_actor_user_id THEN
          v_allowed := false; v_reason := 'SELF_APPROVAL_DENIED';
        END IF;
      END IF;
    END IF;

    -- Commands with no server handler must never appear actionable.
    IF v_allowed AND v_cmd IN ('BN_MEANS_SCHEDULE_REASSESSMENT',
        'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE','BN_MEANS_SUPERSEDE','BN_MEANS_CLOSE') THEN
      v_allowed := false; v_reason := 'NOT_IMPLEMENTED';
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'command', v_cmd, 'allowed', v_allowed, 'reason', v_reason,
      'row_version', v_a.row_version));
  END LOOP;

  RETURN jsonb_build_object('status','OK','data', v_out,
    'assessment_status', v_a.status, 'row_version', v_a.row_version,
    'current_calculation_id', v_calc.calculation_id,
    'current_calculation_hash', COALESCE(v_calc.calculation_hash, v_calc.result_hash),
    'open_adjustments', COALESCE(v_open,0),
    'adjustments_pending_application', COALESCE(v_pending,0));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.bn_means_available_actions_v1(uuid,uuid) TO authenticated;
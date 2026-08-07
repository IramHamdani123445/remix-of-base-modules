-- MEANS-TEST EPIC 10 — Adjustments and Independent Approval

CREATE TABLE IF NOT EXISTS public.bn_means_adjustment_reason (
  reason_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason_scope   text NOT NULL CHECK (reason_scope IN ('ADJUSTMENT','ADJUSTMENT_DECISION','ASSESSMENT_DECISION')),
  decision       text CHECK (decision IN ('APPROVE','REJECT')),
  reason_code    text NOT NULL,
  label          text NOT NULL,
  description    text,
  target_kinds   text[],
  policy_version_id uuid,
  benefit_programme text,
  requires_justification boolean NOT NULL DEFAULT true,
  requires_evidence      boolean NOT NULL DEFAULT false,
  display_order  integer NOT NULL DEFAULT 100,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bn_means_adjustment_reason_uk
  ON public.bn_means_adjustment_reason(
    reason_scope, COALESCE(decision,'-'), reason_code,
    COALESCE(policy_version_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(benefit_programme,'-'));

GRANT SELECT ON public.bn_means_adjustment_reason TO authenticated;
GRANT ALL    ON public.bn_means_adjustment_reason TO service_role;
ALTER TABLE public.bn_means_adjustment_reason ENABLE ROW LEVEL SECURITY;

DO $pol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='bn_means_adjustment_reason'
                    AND policyname='bn_means_adjustment_reason_read') THEN
    CREATE POLICY bn_means_adjustment_reason_read
      ON public.bn_means_adjustment_reason FOR SELECT TO authenticated USING (true);
  END IF;
END
$pol$;

INSERT INTO public.bn_means_adjustment_reason
  (reason_scope, decision, reason_code, label, description, target_kinds, requires_evidence, display_order)
VALUES
  ('ADJUSTMENT', NULL, 'INCORRECT_TREATMENT', 'Incorrect treatment',
   'The policy treatment applied to this item is not correct.',
   ARRAY['INCOME_TREATMENT','ASSET_TREATMENT','DEDUCTION_TREATMENT','CALCULATION_LINE'], true, 10),
  ('ADJUSTMENT', NULL, 'EVIDENCE_SUPPORTS_DIFFERENT_AMOUNT', 'Evidence supports a different amount',
   'Verified evidence supports an amount other than the one applied.',
   ARRAY['INCOME_TREATMENT','ASSET_TREATMENT','DEDUCTION_TREATMENT','CALCULATION_LINE'], true, 20),
  ('ADJUSTMENT', NULL, 'POLICY_RULE_APPLICATION', 'Policy rule application',
   'The policy rule was applied incorrectly to this item.',
   ARRAY['CALCULATION_LINE','POLICY_PARAMETER_APPLICATION'], false, 30),
  ('ADJUSTMENT', NULL, 'CLERICAL_CORRECTION', 'Clerical correction',
   'A recording error must be corrected.', NULL, false, 40),
  ('ADJUSTMENT', NULL, 'VALUATION_CORRECTION', 'Valuation correction',
   'The valuation applied to an asset is incorrect.',
   ARRAY['ASSET_TREATMENT'], true, 50),
  ('ADJUSTMENT', NULL, 'ALLOWED_DEDUCTION_CORRECTION', 'Allowed deduction correction',
   'The allowed deduction requires correction.',
   ARRAY['DEDUCTION_TREATMENT'], true, 60),
  ('ADJUSTMENT', NULL, 'VALIDITY_CORRECTION', 'Validity correction',
   'The validity period of the assessment requires correction.',
   ARRAY['VALIDITY_PERIOD'], false, 70),
  ('ADJUSTMENT', NULL, 'REASSESSMENT_DATE_CORRECTION', 'Reassessment-date correction',
   'The reassessment date requires correction.',
   ARRAY['REASSESSMENT_DATE'], false, 80),
  ('ADJUSTMENT_DECISION', 'APPROVE', 'CORRECTION_SUPPORTED', 'Correction is supported',
   'The proposed correction is supported by evidence and policy.', NULL, false, 10),
  ('ADJUSTMENT_DECISION', 'APPROVE', 'POLICY_APPLICATION_CONFIRMED', 'Policy application confirmed',
   'The corrected policy application is confirmed.', NULL, false, 20),
  ('ADJUSTMENT_DECISION', 'REJECT', 'CORRECTION_NOT_SUPPORTED', 'Correction is not supported',
   'The proposed correction is not supported by the evidence held.', NULL, false, 10),
  ('ADJUSTMENT_DECISION', 'REJECT', 'ORIGINAL_TREATMENT_CORRECT', 'Original treatment is correct',
   'The original calculation treatment is correct.', NULL, false, 20),
  ('ASSESSMENT_DECISION', 'APPROVE', 'CALCULATION_CONFIRMED', 'Calculation confirmed',
   'The calculation and its explanation have been independently reviewed.', NULL, false, 10),
  ('ASSESSMENT_DECISION', 'REJECT', 'CALCULATION_NOT_SUPPORTED', 'Calculation not supported',
   'The assessment cannot be approved on the information held.', NULL, false, 10),
  ('ASSESSMENT_DECISION', 'REJECT', 'INFORMATION_INSUFFICIENT', 'Information insufficient',
   'The declared and verified information is insufficient to decide.', NULL, false, 20)
ON CONFLICT DO NOTHING;

ALTER TABLE public.bn_means_policy_version
  ADD COLUMN IF NOT EXISTS decision_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public._bn_means_latest_calculation(p_assessment_id uuid)
RETURNS public.bn_means_calculation
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT * FROM public.bn_means_calculation
   WHERE assessment_id = p_assessment_id
   ORDER BY is_current DESC, sequence_no DESC, calculated_at DESC
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public._bn_means_adjustment_target_catalogue()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_array(
    jsonb_build_object('target_kind','INCOME_TREATMENT','label','Income treatment',
      'control','MONEY_OR_EXCLUDE','evidence_required',true,'group_code','INCOME'),
    jsonb_build_object('target_kind','ASSET_TREATMENT','label','Asset treatment',
      'control','MONEY_OR_EXCLUDE','evidence_required',true,'group_code','ASSET'),
    jsonb_build_object('target_kind','DEDUCTION_TREATMENT','label','Deduction treatment',
      'control','MONEY_OR_EXCLUDE','evidence_required',true,'group_code','DEDUCTION'),
    jsonb_build_object('target_kind','CALCULATION_LINE','label','Calculation item',
      'control','MONEY','evidence_required',false,'group_code',NULL),
    jsonb_build_object('target_kind','POLICY_PARAMETER_APPLICATION','label','Policy parameter application',
      'control','MONEY','evidence_required',false,'group_code','THRESHOLD'),
    jsonb_build_object('target_kind','VALIDITY_PERIOD','label','Validity date',
      'control','DATE','evidence_required',false,'group_code',NULL),
    jsonb_build_object('target_kind','REASSESSMENT_DATE','label','Reassessment date',
      'control','DATE','evidence_required',false,'group_code',NULL));
$fn$;

CREATE OR REPLACE FUNCTION public._bn_means_adjustment_reference(
  p_policy_version_id uuid DEFAULT NULL, p_programme text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object(
    'target_kinds', public._bn_means_adjustment_target_catalogue(),
    'adjustment_reasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'reason_code', r.reason_code, 'label', r.label, 'description', r.description,
        'target_kinds', to_jsonb(r.target_kinds),
        'requires_justification', r.requires_justification,
        'requires_evidence', r.requires_evidence) ORDER BY r.display_order, r.label)
        FROM public.bn_means_adjustment_reason r
       WHERE r.is_active AND r.reason_scope = 'ADJUSTMENT'
         AND (r.policy_version_id IS NULL OR r.policy_version_id = p_policy_version_id)
         AND (r.benefit_programme IS NULL OR r.benefit_programme = p_programme)),'[]'::jsonb),
    'adjustment_decision_reasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'decision', r.decision, 'reason_code', r.reason_code, 'label', r.label,
        'description', r.description, 'requires_justification', r.requires_justification)
        ORDER BY r.decision, r.display_order)
        FROM public.bn_means_adjustment_reason r
       WHERE r.is_active AND r.reason_scope = 'ADJUSTMENT_DECISION'
         AND (r.policy_version_id IS NULL OR r.policy_version_id = p_policy_version_id)
         AND (r.benefit_programme IS NULL OR r.benefit_programme = p_programme)),'[]'::jsonb),
    'assessment_decision_reasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'decision', r.decision, 'reason_code', r.reason_code, 'label', r.label,
        'description', r.description, 'requires_justification', r.requires_justification)
        ORDER BY r.decision, r.display_order)
        FROM public.bn_means_adjustment_reason r
       WHERE r.is_active AND r.reason_scope = 'ASSESSMENT_DECISION'
         AND (r.policy_version_id IS NULL OR r.policy_version_id = p_policy_version_id)
         AND (r.benefit_programme IS NULL OR r.benefit_programme = p_programme)),'[]'::jsonb));
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_adjustment_reference_v1(
  p_actor_user_id uuid, p_assessment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;
  IF p_assessment_id IS NOT NULL THEN
    SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  END IF;
  RETURN jsonb_build_object('status','OK','data',
    public._bn_means_adjustment_reference(v_a.policy_version_id, v_a.benefit_programme));
END;
$fn$;

CREATE OR REPLACE FUNCTION public._bn_means_recalculate(
  p_assessment_id uuid, p_adjustment_id uuid, p_actor uuid, p_correlation uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a      public.bn_means_assessment%ROWTYPE;
  v_adj    public.bn_means_adjustment%ROWTYPE;
  v_prev   public.bn_means_calculation%ROWTYPE;
  v_new    public.bn_means_calculation%ROWTYPE;
  v_exist  public.bn_means_calculation%ROWTYPE;
  v_params jsonb;
  v_inputs jsonb;
  v_hash   text;
  v_method text;  v_scale int;
  v_txt    text;  v_num numeric;
  v_date   date;
  v_gross_i numeric := 0; v_income numeric := 0; v_dis numeric := 0;
  v_gross_a numeric := 0; v_assets numeric := 0; v_adis numeric := 0;
  v_ded_cl numeric := 0;  v_ded numeric := 0;
  v_hh int := 0;
  v_thr numeric; v_athr numeric; v_assess numeric; v_excess numeric; v_short numeric;
  v_res text; v_warn jsonb := '[]'::jsonb;
  v_valid_until date; v_reassess date;
  v_seq int;
BEGIN
  SELECT * INTO v_a   FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  SELECT * INTO v_adj FROM public.bn_means_adjustment WHERE adjustment_id = p_adjustment_id;
  v_prev := public._bn_means_latest_calculation(p_assessment_id);
  IF v_prev.calculation_id IS NULL THEN
    RAISE EXCEPTION 'E_NO_CURRENT_CALCULATION:%', p_assessment_id;
  END IF;

  v_method := COALESCE(v_prev.rounding_method,'HALF_UP');
  v_scale  := COALESCE(v_prev.rounding_scale, 2);
  v_params := COALESCE(v_prev.policy_parameters, '{}'::jsonb);
  v_txt    := NULLIF(v_adj.proposed_value #>> '{}','');
  BEGIN v_num := v_txt::numeric; EXCEPTION WHEN others THEN v_num := NULL; END;

  v_valid_until := v_prev.valid_until;
  v_reassess    := v_prev.reassessment_due;

  IF v_adj.target_kind = 'POLICY_PARAMETER_APPLICATION' AND v_num IS NOT NULL
     AND COALESCE(v_adj.field_or_line_code,'') <> '' THEN
    v_params := v_params || jsonb_build_object(v_adj.field_or_line_code, v_num);
  ELSIF v_adj.target_kind = 'VALIDITY_PERIOD' THEN
    BEGIN v_date := v_txt::date; v_valid_until := v_date; EXCEPTION WHEN others THEN NULL; END;
  ELSIF v_adj.target_kind = 'REASSESSMENT_DATE' THEN
    BEGIN v_date := v_txt::date; v_reassess := v_date; EXCEPTION WHEN others THEN NULL; END;
  END IF;

  v_inputs := COALESCE(v_prev.input_snapshot,'{}'::jsonb)
    || jsonb_build_object('policy_parameters', v_params)
    || jsonb_build_object(
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

  SELECT * INTO v_exist FROM public.bn_means_calculation
   WHERE assessment_id = p_assessment_id AND input_hash = v_hash;
  IF FOUND THEN
    RETURN v_exist.calculation_id;
  END IF;

  SELECT COALESCE(max(sequence_no),0) + 1 INTO v_seq
    FROM public.bn_means_calculation WHERE assessment_id = p_assessment_id;

  INSERT INTO public.bn_means_calculation(
    assessment_id, assessment_version_id, policy_version_id, calculation_version,
    engine_version, input_snapshot, input_hash, currency_code, rounding_method,
    rounding_scale, assessable_income, assessable_assets, approved_deductions,
    household_size, threshold_amount, excess_amount, result, warnings,
    result_hash, effective_date, valid_from, valid_until, reassessment_due,
    calculated_by, correlation_id, supersedes_calculation_id,
    triggering_adjustment_id, recalculation_reason, is_current, sequence_no,
    trigger_reason, verification_revision_hash, verification_revision_no,
    policy_parameters)
  VALUES (
    p_assessment_id, v_prev.assessment_version_id, v_prev.policy_version_id,
    v_prev.calculation_version, v_prev.engine_version, v_inputs, v_hash,
    v_prev.currency_code, v_method, v_scale, 0,0,0,0,0,0,'PROVISIONAL','[]'::jsonb,
    'pending', v_prev.effective_date, v_prev.valid_from, v_valid_until,
    v_reassess, p_actor, p_correlation, v_prev.calculation_id,
    p_adjustment_id, COALESCE(v_adj.reason_code,'ADJUSTMENT_APPROVED'), true, v_seq,
    'ADJUSTMENT', v_prev.verification_revision_hash, v_prev.verification_revision_no,
    v_params)
  RETURNING * INTO v_new;

  INSERT INTO public.bn_means_calculation_line(
    calculation_id, line_no, line_kind, fact_kind, fact_id, category_code,
    parameter_id, included, exclusion_reason, raw_amount, normalised_amount,
    applied_amount, narrative, group_code, display_order, business_label,
    treatment_code, member_label, explanation, policy_rule_code,
    claimed_amount, disregard_amount)
  SELECT v_new.calculation_id, line_no, line_kind, fact_kind, fact_id, category_code,
         parameter_id, included, exclusion_reason, raw_amount, normalised_amount,
         applied_amount, narrative, group_code, display_order, business_label,
         treatment_code, member_label, explanation, policy_rule_code,
         claimed_amount, disregard_amount
    FROM public.bn_means_calculation_line WHERE calculation_id = v_prev.calculation_id;

  IF v_adj.target_kind = 'CALCULATION_LINE' THEN
    UPDATE public.bn_means_calculation_line l
       SET applied_amount = COALESCE(v_num, l.applied_amount),
           included = CASE WHEN upper(COALESCE(v_txt,'')) = 'EXCLUDE' THEN false ELSE l.included END,
           explanation = COALESCE(l.explanation,'')
             || ' Adjusted by ' || COALESCE(v_adj.adjustment_reference,'an approved adjustment') || '.'
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
           treatment_code = CASE WHEN upper(COALESCE(v_txt,'')) = 'EXCLUDE'
                                 THEN 'EXCLUDED_NOT_APPLICABLE' ELSE 'INCLUDED' END,
           exclusion_reason = CASE WHEN upper(COALESCE(v_txt,'')) = 'EXCLUDE'
                                   THEN 'ADJUSTMENT:' || COALESCE(v_adj.reason_code,'APPROVED') END,
           explanation = COALESCE(l.explanation,'')
             || ' Adjusted by ' || COALESCE(v_adj.adjustment_reference,'an approved adjustment') || '.'
     WHERE l.calculation_id = v_new.calculation_id
       AND l.fact_id = v_adj.target_id
       AND l.line_kind = replace(v_adj.target_kind,'_TREATMENT','');
  END IF;

  SELECT COALESCE(sum(COALESCE(normalised_amount, applied_amount)) FILTER (WHERE group_code='INCOME'),0),
         COALESCE(sum(applied_amount) FILTER (WHERE group_code='INCOME' AND included),0),
         COALESCE(sum(COALESCE(normalised_amount, applied_amount)) FILTER (WHERE group_code='ASSET'),0),
         COALESCE(sum(applied_amount) FILTER (WHERE group_code='ASSET' AND included),0),
         COALESCE(sum(COALESCE(normalised_amount, applied_amount)) FILTER (WHERE group_code='DEDUCTION'),0),
         COALESCE(sum(applied_amount) FILTER (WHERE group_code='DEDUCTION' AND included),0),
         count(*) FILTER (WHERE group_code='HOUSEHOLD' AND included)
    INTO v_gross_i, v_income, v_gross_a, v_assets, v_ded_cl, v_ded, v_hh
    FROM public.bn_means_calculation_line WHERE calculation_id = v_new.calculation_id;

  v_adis   := public._bn_means_round(GREATEST(v_gross_a - v_assets, 0), v_method, v_scale);
  v_dis    := public._bn_means_round(
                LEAST(COALESCE((v_params->>'income_disregard_annual')::numeric,0), v_income),
                v_method, v_scale);
  v_thr    := public._bn_means_round(
                COALESCE((v_params->>'income_threshold_annual')::numeric,0)
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
  v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','RECALCULATED_AFTER_ADJUSTMENT',
    'message','This calculation was produced by approved adjustment '
      || COALESCE(v_adj.adjustment_reference,'') || '.'));

  UPDATE public.bn_means_calculation_line
     SET applied_amount = CASE policy_rule_code
           WHEN 'INCOME_TOTAL'      THEN v_gross_i
           WHEN 'INCOME_DISREGARD'  THEN v_dis
           WHEN 'DEDUCTION_TOTAL'   THEN v_ded
           WHEN 'ASSESSED_MEANS'    THEN v_assess
           WHEN 'THRESHOLD_RULE'    THEN v_thr
           WHEN 'RESULT_RULE'       THEN CASE WHEN v_res='FAIL' THEN v_excess ELSE v_short END
           ELSE applied_amount END,
         treatment_code = CASE WHEN policy_rule_code = 'RESULT_RULE' THEN v_res ELSE treatment_code END,
         explanation = CASE WHEN policy_rule_code = 'RESULT_RULE'
           THEN CASE WHEN v_res='FAIL' THEN 'Assessed means exceed the applicable threshold.'
                     ELSE 'Assessed means are within the applicable threshold.' END
           ELSE explanation END
   WHERE calculation_id = v_new.calculation_id
     AND policy_rule_code IN ('INCOME_TOTAL','INCOME_DISREGARD','DEDUCTION_TOTAL',
                              'ASSESSED_MEANS','THRESHOLD_RULE','RESULT_RULE');

  UPDATE public.bn_means_calculation
     SET assessable_income = v_assess, assessable_assets = v_assets,
         approved_deductions = v_ded, household_size = v_hh,
         threshold_amount = v_thr, excess_amount = v_excess, result = v_res,
         warnings = v_warn, gross_income = v_gross_i, income_disregard_total = v_dis,
         gross_assets = v_gross_a, asset_disregard_total = v_adis,
         claimed_deductions = v_ded_cl, asset_threshold_amount = v_athr,
         shortfall_amount = v_short,
         result_hash = encode(digest(jsonb_build_object(
           'input_hash', v_hash, 'engine_version', v_new.engine_version,
           'assessable_income', v_assess, 'assessable_assets', v_assets,
           'approved_deductions', v_ded, 'household_size', v_hh,
           'threshold_amount', v_thr, 'excess_amount', v_excess,
           'result', v_res, 'currency_code', v_new.currency_code)::text,'sha256'),'hex')
   WHERE calculation_id = v_new.calculation_id
   RETURNING * INTO v_new;

  UPDATE public.bn_means_calculation SET calculation_hash = result_hash
   WHERE calculation_id = v_new.calculation_id;

  UPDATE public.bn_means_calculation
     SET is_current = false, superseded_at = now(),
         superseded_by_calculation_id = v_new.calculation_id
   WHERE calculation_id = v_prev.calculation_id;

  RETURN v_new.calculation_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._bn_means_approval_readiness(
  p_assessment_id uuid, p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE
  v_a    public.bn_means_assessment%ROWTYPE;
  v_av   public.bn_means_assessment_version%ROWTYPE;
  v_c    public.bn_means_calculation%ROWTYPE;
  v_pv   public.bn_means_policy_version%ROWTYPE;
  v_ready jsonb;
  v_block jsonb := '[]'::jsonb;
  v_codes jsonb := '[]'::jsonb;
  v_open int := 0; v_pending int := 0; v_requested_by_actor int := 0;
  v_maker uuid;
  v_rules jsonb := '{}'::jsonb;
  v_state text;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'state','FAILED',
      'blockers', jsonb_build_array(jsonb_build_object('code','NOT_FOUND',
        'message','This assessment could not be found.')),
      'reason_codes', jsonb_build_array('NOT_FOUND'));
  END IF;

  v_av    := public._bn_means_frozen_version(p_assessment_id);
  v_c     := public._bn_means_latest_calculation(p_assessment_id);
  v_ready := public._bn_means_calculation_readiness(p_assessment_id);
  SELECT o.requested, o.pending_application INTO v_open, v_pending
    FROM public._bn_means_open_adjustments(p_assessment_id) o;
  SELECT maker_user_id INTO v_maker FROM public.bn_means_command_maker
   WHERE assessment_id = p_assessment_id AND maker_role = 'BN_MEANS_SUBMIT';
  v_maker := COALESCE(v_maker, v_a.maker_user_id);
  SELECT * INTO v_pv FROM public.bn_means_policy_version
   WHERE policy_version_id = v_a.policy_version_id;
  v_rules := COALESCE(v_pv.decision_rules, '{}'::jsonb);
  SELECT count(*) INTO v_requested_by_actor FROM public.bn_means_adjustment
   WHERE assessment_id = p_assessment_id AND requested_by = p_actor_user_id;

  IF v_a.status = 'APPROVED' THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','APPROVAL_ALREADY_RECORDED',
      'message','An approval decision has already been recorded.'));
    v_codes := v_codes || '"APPROVAL_ALREADY_RECORDED"'::jsonb;
  ELSIF v_a.status = 'REJECTED' THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','REJECTION_ALREADY_RECORDED',
      'message','A rejection decision has already been recorded.'));
    v_codes := v_codes || '"REJECTION_ALREADY_RECORDED"'::jsonb;
  ELSIF v_a.status NOT IN ('CALCULATED','APPROVAL_PENDING','REVIEW_PENDING') THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','INVALID_STATE',
      'message','The assessment lifecycle does not permit a decision yet.'));
    v_codes := v_codes || '"INVALID_STATE"'::jsonb;
  END IF;

  IF NOT COALESCE((v_ready->>'verification_complete')::boolean,false) THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','VERIFICATION_INCOMPLETE',
      'message','Verification is not complete for the submitted declaration.'));
    v_codes := v_codes || '"VERIFICATION_INCOMPLETE"'::jsonb;
  END IF;

  IF v_c.calculation_id IS NULL THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','NO_CURRENT_CALCULATION',
      'message','No current calculation exists for this assessment.'));
    v_codes := v_codes || '"NO_CURRENT_CALCULATION"'::jsonb;
  ELSE
    IF NOT COALESCE(v_c.is_current, true) THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','CALCULATION_NOT_LATEST',
        'message','The calculation is not the current one for this assessment.'));
      v_codes := v_codes || '"CALCULATION_NOT_LATEST"'::jsonb;
    END IF;
    IF COALESCE((v_ready->>'calculation_stale')::boolean,false) THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','CALCULATION_STALE',
        'message','Verification changed after this calculation. Recalculate before deciding.'));
      v_codes := v_codes || '"CALCULATION_STALE"'::jsonb;
    END IF;
    IF v_av.assessment_version_id IS NULL
       OR v_c.assessment_version_id IS DISTINCT FROM v_av.assessment_version_id THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','VERSION_OWNERSHIP_MISMATCH',
        'message','The calculation does not belong to the current frozen version.'));
      v_codes := v_codes || '"VERSION_OWNERSHIP_MISMATCH"'::jsonb;
    END IF;
  END IF;

  IF COALESCE(v_open,0) > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','OPEN_ADJUSTMENT_EXISTS',
      'message', v_open || ' adjustment request(s) await an independent decision.'));
    v_codes := v_codes || '"OPEN_ADJUSTMENT_EXISTS"'::jsonb;
  END IF;
  IF COALESCE(v_pending,0) > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','ADJUSTMENT_APPLICATION_PENDING',
      'message', v_pending || ' approved adjustment(s) have not produced a calculation yet.'));
    v_codes := v_codes || '"ADJUSTMENT_APPLICATION_PENDING"'::jsonb;
  END IF;

  IF v_pv.policy_version_id IS NULL OR v_pv.status <> 'ACTIVE'
     OR v_pv.effective_from > v_a.effective_from
     OR (v_pv.effective_to IS NOT NULL AND v_pv.effective_to < v_a.effective_from) THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','POLICY_NO_LONGER_EFFECTIVE',
      'message','The policy version is no longer effective for this assessment.'));
    v_codes := v_codes || '"POLICY_NO_LONGER_EFFECTIVE"'::jsonb;
  END IF;

  IF v_maker IS NOT NULL AND v_maker = p_actor_user_id THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','SELF_APPROVAL_DENIED',
      'message','You submitted this assessment, so an independent officer must decide it.'));
    v_codes := v_codes || '"SELF_APPROVAL_DENIED"'::jsonb;
  END IF;
  IF v_requested_by_actor > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','SELF_APPROVAL_DENIED',
      'message','You requested an adjustment on this assessment, so you cannot decide it.'));
    v_codes := v_codes || '"SELF_APPROVAL_DENIED"'::jsonb;
  END IF;
  IF COALESCE((v_rules->>'calculator_independence')::boolean,false)
     AND v_c.calculated_by IS NOT NULL AND v_c.calculated_by = p_actor_user_id THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','MAKER_CHECKER_REQUIRED',
      'message','You produced this calculation, so an independent officer must decide it.'));
    v_codes := v_codes || '"MAKER_CHECKER_REQUIRED"'::jsonb;
  END IF;

  v_state := CASE
    WHEN v_a.status IN ('APPROVED','REJECTED') THEN 'ALREADY_DECIDED'
    WHEN COALESCE(v_pending,0) > 0 THEN 'RECALCULATION_PENDING'
    WHEN COALESCE((v_ready->>'calculation_stale')::boolean,false) THEN 'STALE'
    WHEN v_codes @> '["SELF_APPROVAL_DENIED"]'::jsonb
      OR v_codes @> '["MAKER_CHECKER_REQUIRED"]'::jsonb THEN 'DENIED'
    WHEN jsonb_array_length(v_block) > 0 THEN 'BLOCKED'
    ELSE 'READY' END;

  RETURN jsonb_build_object(
    'ready', (jsonb_array_length(v_block) = 0),
    'state', v_state,
    'blockers', v_block,
    'reason_codes', v_codes,
    'assessment_status', v_a.status,
    'row_version', v_a.row_version,
    'calculation_id', v_c.calculation_id,
    'calculation_hash', COALESCE(v_c.calculation_hash, v_c.result_hash),
    'calculation_current', COALESCE(v_c.is_current,false),
    'calculation_stale', COALESCE((v_ready->>'calculation_stale')::boolean,false),
    'verification_complete', COALESCE((v_ready->>'verification_complete')::boolean,false),
    'open_adjustments', COALESCE(v_open,0),
    'adjustments_pending_application', COALESCE(v_pending,0),
    'maker_user_id', v_maker,
    'actor_is_maker', (v_maker = p_actor_user_id),
    'actor_requested_adjustment', (v_requested_by_actor > 0),
    'decision_rules', v_rules);
END;
$fn$;

CREATE OR REPLACE FUNCTION public._bn_means_person_label(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(NULLIF(p.full_name,''), NULLIF(p.user_code,''), 'Officer')
    FROM public.profiles p WHERE p.id = p_user_id LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_decision_context_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_a    public.bn_means_assessment%ROWTYPE;
  v_c    public.bn_means_calculation%ROWTYPE;
  v_prev public.bn_means_calculation%ROWTYPE;
  v_ready jsonb;
  v_appr  jsonb;
  v_open  int := 0; v_pending int := 0;
  v_journey jsonb;
  v_calc_stage text;
  v_appr_stage text;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  v_c := public._bn_means_latest_calculation(p_assessment_id);
  IF v_c.supersedes_calculation_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.bn_means_calculation
     WHERE calculation_id = v_c.supersedes_calculation_id;
  END IF;
  v_ready := public._bn_means_calculation_readiness(p_assessment_id);
  v_appr  := public._bn_means_approval_readiness(p_assessment_id, p_actor_user_id);
  SELECT o.requested, o.pending_application INTO v_open, v_pending
    FROM public._bn_means_open_adjustments(p_assessment_id) o;

  v_calc_stage := CASE
    WHEN COALESCE(v_pending,0) > 0 THEN 'RECALCULATION_REQUIRED'
    WHEN v_c.calculation_id IS NULL THEN 'PENDING'
    WHEN COALESCE((v_ready->>'calculation_stale')::boolean,false) THEN 'RECALCULATION_REQUIRED'
    ELSE 'COMPLETE' END;
  v_appr_stage := CASE
    WHEN v_a.status IN ('APPROVED','REJECTED') THEN 'COMPLETE'
    WHEN COALESCE(v_open,0) > 0 OR COALESCE(v_pending,0) > 0 THEN 'BLOCKED'
    WHEN v_calc_stage <> 'COMPLETE' THEN 'BLOCKED'
    ELSE 'CURRENT' END;

  v_journey := jsonb_build_array(
    jsonb_build_object('code','SUBMITTED','label','Submitted','state','COMPLETE'),
    jsonb_build_object('code','VERIFICATION','label','Verification','state',
      CASE WHEN COALESCE((v_ready->>'verification_complete')::boolean,false)
           THEN 'COMPLETE' ELSE 'CURRENT' END),
    jsonb_build_object('code','CALCULATION','label','Calculation','state', v_calc_stage),
    jsonb_build_object('code','ADJUSTMENT_REVIEW','label','Adjustment review','state',
      CASE WHEN COALESCE(v_open,0) > 0 THEN 'CURRENT'
           WHEN COALESCE(v_pending,0) > 0 THEN 'RECALCULATION_REQUIRED'
           WHEN EXISTS (SELECT 1 FROM public.bn_means_adjustment
                         WHERE assessment_id = p_assessment_id) THEN 'COMPLETE'
           ELSE 'NOT_REQUIRED' END),
    jsonb_build_object('code','APPROVAL','label','Independent approval','state', v_appr_stage),
    jsonb_build_object('code','ACTIVATION','label','Activation','state','PENDING'));

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', v_a.assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'benefit_programme', v_a.benefit_programme,
    'status', v_a.status,
    'row_version', v_a.row_version,
    'currency_code', v_a.currency_code,
    'journey', v_journey,
    'approval_readiness', v_appr,
    'calculation_readiness', v_ready,
    'calculation', CASE WHEN v_c.calculation_id IS NULL THEN NULL ELSE to_jsonb(v_c) END,
    'previous_calculation', CASE WHEN v_prev.calculation_id IS NULL THEN NULL ELSE to_jsonb(v_prev) END,
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.display_order, l.line_no)
                         FROM public.bn_means_calculation_line l
                        WHERE l.calculation_id = v_c.calculation_id),'[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'calculation_id', c.calculation_id, 'sequence_no', c.sequence_no,
                             'result', c.result, 'assessable_income', c.assessable_income,
                             'threshold_amount', c.threshold_amount, 'excess_amount', c.excess_amount,
                             'calculated_at', c.calculated_at,
                             'calculated_by_label', public._bn_means_person_label(c.calculated_by),
                             'trigger_reason', c.trigger_reason, 'is_current', c.is_current,
                             'superseded_at', c.superseded_at,
                             'triggering_adjustment_id', c.triggering_adjustment_id)
                             ORDER BY c.sequence_no DESC)
                          FROM public.bn_means_calculation c
                         WHERE c.assessment_id = p_assessment_id),'[]'::jsonb),
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'adjustment_id', a.adjustment_id,
        'adjustment_reference', a.adjustment_reference,
        'target_kind', a.target_kind,
        'target_id', a.target_id,
        'field_or_line_code', a.field_or_line_code,
        'target_label', COALESCE(l.business_label, a.field_or_line_code),
        'original_value', a.original_value,
        'proposed_value', a.proposed_value,
        'currency_code', a.currency_code,
        'financial_effect', a.financial_effect,
        'reason_code', a.reason_code,
        'reason_label', COALESCE((SELECT r.label FROM public.bn_means_adjustment_reason r
                                   WHERE r.reason_scope='ADJUSTMENT' AND r.reason_code = a.reason_code
                                   LIMIT 1), a.reason_code),
        'justification', a.justification,
        'evidence_id', a.evidence_id,
        'evidence_reference', a.evidence_reference,
        'status', a.status,
        'requested_by', a.requested_by,
        'requested_by_label', public._bn_means_person_label(a.requested_by),
        'requested_at', a.requested_at,
        'decided_by', a.decided_by,
        'decided_by_label', public._bn_means_person_label(a.decided_by),
        'decided_at', a.decided_at,
        'decision_reason_code', a.decision_reason_code,
        'decision_reason_label', COALESCE((SELECT r.label FROM public.bn_means_adjustment_reason r
                                   WHERE r.reason_scope='ADJUSTMENT_DECISION'
                                     AND r.reason_code = a.decision_reason_code LIMIT 1),
                                   a.decision_reason_code),
        'decision_note', a.decision_note,
        'applied_calculation_id', a.applied_calculation_id,
        'applied_at', a.applied_at,
        'application_error', a.application_error,
        'row_version', a.row_version,
        'resulting_result', rc.result,
        'resulting_sequence_no', rc.sequence_no,
        'is_requester', (a.requested_by = p_actor_user_id))
        ORDER BY a.requested_at DESC)
      FROM public.bn_means_adjustment a
      LEFT JOIN public.bn_means_calculation rc ON rc.calculation_id = a.applied_calculation_id
      LEFT JOIN public.bn_means_calculation_line l ON l.line_id = a.target_id
     WHERE a.assessment_id = p_assessment_id),'[]'::jsonb),
    'decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'approval_id', ap.approval_id, 'decision', ap.decision,
        'decision_reason', ap.decision_reason, 'justification', ap.justification,
        'calculation_id', ap.calculation_id, 'decided_by', ap.decided_by,
        'decided_by_label', public._bn_means_person_label(ap.decided_by),
        'decided_at', ap.decided_at) ORDER BY ap.decided_at DESC)
      FROM public.bn_means_approval ap WHERE ap.assessment_id = p_assessment_id),'[]'::jsonb),
    'maker_label', public._bn_means_person_label(COALESCE(
       (SELECT maker_user_id FROM public.bn_means_command_maker
         WHERE assessment_id = p_assessment_id AND maker_role='BN_MEANS_SUBMIT'), v_a.maker_user_id)),
    'checker_label', public._bn_means_person_label(v_a.checker_user_id),
    'actor_label', public._bn_means_person_label(p_actor_user_id),
    'valid_from', v_a.valid_from,
    'valid_until', v_a.valid_until,
    'reassessment_due', v_a.reassessment_due,
    'decided_at', v_a.decided_at,
    'decision_reason_code', v_a.decision_reason_code,
    'decision_justification', v_a.decision_justification,
    'reference', public._bn_means_adjustment_reference(v_a.policy_version_id, v_a.benefit_programme)));
END;
$fn$;

DO $do$
DECLARE v_def text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname='public' AND p.proname='_bn_means_mt7_execute_core') THEN
    RETURN;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='_bn_means_mt7_execute' LIMIT 1;
  IF v_def IS NULL THEN RAISE EXCEPTION '_bn_means_mt7_execute not found'; END IF;
  v_def := replace(v_def, 'public._bn_means_mt7_execute(', 'public._bn_means_mt7_execute_core(');
  EXECUTE v_def;
END
$do$;

CREATE OR REPLACE FUNCTION public._bn_means_mt7_execute(
  p_command_name text, p_assessment_id uuid, p_actor uuid, p_actor_code text,
  p_correlation uuid, p_reason_code text, p_justification text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_adj    public.bn_means_adjustment%ROWTYPE;
  v_a      public.bn_means_assessment%ROWTYPE;
  v_reason text;
  v_decision text;
  v_scope  text;
  v_count  int;
  v_ready  jsonb;
  v_code   text;
  v_msg    text;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  v_reason := COALESCE(NULLIF(p_reason_code,''), NULLIF(p_payload->>'reason_code',''));

  IF p_command_name = 'BN_MEANS_REQUEST_ADJUSTMENT' THEN
    SELECT count(*) INTO v_count FROM public.bn_means_adjustment_reason
     WHERE is_active AND reason_scope = 'ADJUSTMENT';
    IF v_count > 0 AND NOT EXISTS (
      SELECT 1 FROM public.bn_means_adjustment_reason r
       WHERE r.is_active AND r.reason_scope='ADJUSTMENT' AND r.reason_code = v_reason
         AND (r.target_kinds IS NULL OR upper(COALESCE(p_payload->>'target_kind','')) = ANY(r.target_kinds))
    ) THEN
      RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:a governed adjustment reason is required';
    END IF;

  ELSIF p_command_name = 'BN_MEANS_APPROVE_ADJUSTMENT' THEN
    SELECT * INTO v_adj FROM public.bn_means_adjustment
     WHERE adjustment_id = NULLIF(p_payload->>'adjustment_id','')::uuid;
    IF FOUND AND v_adj.requested_by IS NOT NULL AND v_adj.requested_by = p_actor THEN
      RAISE EXCEPTION 'E_SELF_APPROVAL_DENIED:the requester cannot decide their own adjustment';
    END IF;
    v_decision := upper(COALESCE(p_payload->>'decision',''));
    SELECT count(*) INTO v_count FROM public.bn_means_adjustment_reason
     WHERE is_active AND reason_scope = 'ADJUSTMENT_DECISION' AND decision = v_decision;
    IF v_count > 0 AND NOT EXISTS (
      SELECT 1 FROM public.bn_means_adjustment_reason r
       WHERE r.is_active AND r.reason_scope='ADJUSTMENT_DECISION'
         AND r.decision = v_decision AND r.reason_code = v_reason) THEN
      RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:a governed decision reason is required';
    END IF;

  ELSIF p_command_name IN ('BN_MEANS_APPROVE','BN_MEANS_REJECT') THEN
    v_decision := CASE WHEN p_command_name = 'BN_MEANS_APPROVE' THEN 'APPROVE' ELSE 'REJECT' END;
    v_scope := 'ASSESSMENT_DECISION';
    SELECT count(*) INTO v_count FROM public.bn_means_adjustment_reason
     WHERE is_active AND reason_scope = v_scope AND decision = v_decision;
    IF v_count > 0 AND NOT EXISTS (
      SELECT 1 FROM public.bn_means_adjustment_reason r
       WHERE r.is_active AND r.reason_scope = v_scope
         AND r.decision = v_decision AND r.reason_code = v_reason) THEN
      RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:a governed decision reason is required';
    END IF;

    IF p_command_name = 'BN_MEANS_APPROVE' THEN
      v_ready := public._bn_means_approval_readiness(p_assessment_id, p_actor);
      IF NOT COALESCE((v_ready->>'ready')::boolean,false) THEN
        v_code := COALESCE(v_ready->'blockers'->0->>'code','INVALID_STATE');
        v_msg  := COALESCE(v_ready->'blockers'->0->>'message','Approval is not available.');
        RAISE EXCEPTION 'E_%:%', v_code, v_msg;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.bn_means_command_maker m
                  WHERE m.assessment_id = p_assessment_id
                    AND m.maker_role = 'BN_MEANS_SUBMIT' AND m.maker_user_id = p_actor)
         OR (v_a.maker_user_id IS NOT NULL AND v_a.maker_user_id = p_actor) THEN
        RAISE EXCEPTION 'E_SELF_APPROVAL_DENIED:the submitting officer cannot decide this assessment';
      END IF;
    END IF;
  END IF;

  RETURN public._bn_means_mt7_execute_core(
    p_command_name, p_assessment_id, p_actor, p_actor_code, p_correlation,
    p_reason_code, p_justification, p_payload);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_queues_v1(
  p_actor_user_id uuid, p_queue_code text, p_filters jsonb,
  p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
  v_total int := 0;
  v_f jsonb := COALESCE(p_filters,'{}'::jsonb);
  v_mine boolean := COALESCE((v_f->>'my_work')::boolean,false);
  v_prog text := NULLIF(v_f->>'benefit_programme','');
  v_from timestamptz := NULLIF(v_f->>'requested_from','')::timestamptz;
  v_to   timestamptz := NULLIF(v_f->>'requested_to','')::timestamptz;
  v_kind text := NULLIF(v_f->>'target_kind','');
  v_status text := NULLIF(v_f->>'status','');
  v_search text := NULLIF(v_f->>'search','');
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;
  IF p_queue_code NOT IN ('ADJUSTMENTS_AWAITING_DECISION','ADJUSTMENTS_AWAITING_RECALCULATION',
                          'ASSESSMENTS_AWAITING_APPROVAL','ASSESSMENTS_RETURNED_TO_REVIEW',
                          'ASSESSMENTS_REJECTED') THEN
    RETURN jsonb_build_object('status','INVALID','code','QUEUE_UNKNOWN','data', NULL);
  END IF;

  IF p_queue_code IN ('ADJUSTMENTS_AWAITING_DECISION','ADJUSTMENTS_AWAITING_RECALCULATION') THEN
    SELECT count(*) INTO v_total
      FROM public.bn_means_adjustment adj
      JOIN public.bn_means_assessment a ON a.assessment_id = adj.assessment_id
     WHERE adj.status = CASE WHEN p_queue_code = 'ADJUSTMENTS_AWAITING_DECISION'
                             THEN 'REQUESTED' ELSE 'APPROVED_PENDING_APPLICATION' END
       AND (NOT v_mine OR adj.requested_by <> p_actor_user_id)
       AND (v_prog IS NULL OR a.benefit_programme = v_prog)
       AND (v_kind IS NULL OR adj.target_kind = v_kind)
       AND (v_from IS NULL OR adj.requested_at >= v_from)
       AND (v_to   IS NULL OR adj.requested_at <= v_to)
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
            OR adj.adjustment_reference ILIKE '%'||v_search||'%');

    SELECT COALESCE(jsonb_agg(r ORDER BY r->>'requested_at' DESC),'[]'::jsonb) INTO v_rows
      FROM (
        SELECT jsonb_build_object(
          'queue_code', p_queue_code,
          'adjustment_id', adj.adjustment_id,
          'adjustment_reference', adj.adjustment_reference,
          'assessment_id', a.assessment_id,
          'assessment_reference', a.assessment_reference,
          'assessment_status', a.status,
          'benefit_programme', a.benefit_programme,
          'target_kind', adj.target_kind,
          'field_or_line_code', adj.field_or_line_code,
          'status', adj.status,
          'requested_by_label', public._bn_means_person_label(adj.requested_by),
          'requested_at', adj.requested_at,
          'age_days', GREATEST(0, (EXTRACT(EPOCH FROM (now() - adj.requested_at))/86400)::int),
          'is_requester', (adj.requested_by = p_actor_user_id),
          'application_error', adj.application_error,
          'row_version', adj.row_version) AS r
          FROM public.bn_means_adjustment adj
          JOIN public.bn_means_assessment a ON a.assessment_id = adj.assessment_id
         WHERE adj.status = CASE WHEN p_queue_code = 'ADJUSTMENTS_AWAITING_DECISION'
                                 THEN 'REQUESTED' ELSE 'APPROVED_PENDING_APPLICATION' END
           AND (NOT v_mine OR adj.requested_by <> p_actor_user_id)
           AND (v_prog IS NULL OR a.benefit_programme = v_prog)
           AND (v_kind IS NULL OR adj.target_kind = v_kind)
           AND (v_from IS NULL OR adj.requested_at >= v_from)
           AND (v_to   IS NULL OR adj.requested_at <= v_to)
           AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
                OR adj.adjustment_reference ILIKE '%'||v_search||'%')
         ORDER BY adj.requested_at DESC
         LIMIT p_limit OFFSET p_offset) q;
  ELSE
    SELECT count(*) INTO v_total FROM public.bn_means_assessment a
     WHERE a.status = CASE p_queue_code
             WHEN 'ASSESSMENTS_AWAITING_APPROVAL' THEN 'CALCULATED'
             WHEN 'ASSESSMENTS_RETURNED_TO_REVIEW' THEN 'REVIEW_PENDING'
             ELSE 'REJECTED' END
       AND (v_prog IS NULL OR a.benefit_programme = v_prog)
       AND (v_status IS NULL OR a.status = v_status)
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%');

    SELECT COALESCE(jsonb_agg(r ORDER BY r->>'updated_at' DESC),'[]'::jsonb) INTO v_rows
      FROM (
        SELECT jsonb_build_object(
          'queue_code', p_queue_code,
          'assessment_id', a.assessment_id,
          'assessment_reference', a.assessment_reference,
          'assessment_status', a.status,
          'benefit_programme', a.benefit_programme,
          'assessment_reason', a.assessment_reason,
          'person_id', a.person_id,
          'person_label', COALESCE(a.declared_person->>'full_name', 'Claimant'),
          'result', a.result,
          'updated_at', a.updated_at,
          'age_days', GREATEST(0, (EXTRACT(EPOCH FROM (now() - a.updated_at))/86400)::int),
          'calculated_at', c.calculated_at,
          'calculation_result', c.result,
          'submitted_by_label', public._bn_means_person_label(a.maker_user_id),
          'verification_complete',
            COALESCE((public._bn_means_calculation_readiness(a.assessment_id)->>'verification_complete')::boolean,false),
          'open_adjustments', (SELECT count(*) FROM public.bn_means_adjustment adj
                                WHERE adj.assessment_id = a.assessment_id
                                  AND adj.status IN ('REQUESTED','APPROVED_PENDING_APPLICATION')),
          'row_version', a.row_version) AS r
          FROM public.bn_means_assessment a
          LEFT JOIN public.bn_means_calculation c
                 ON c.assessment_id = a.assessment_id AND c.is_current
         WHERE a.status = CASE p_queue_code
                 WHEN 'ASSESSMENTS_AWAITING_APPROVAL' THEN 'CALCULATED'
                 WHEN 'ASSESSMENTS_RETURNED_TO_REVIEW' THEN 'REVIEW_PENDING'
                 ELSE 'REJECTED' END
           AND (v_prog IS NULL OR a.benefit_programme = v_prog)
           AND (v_status IS NULL OR a.status = v_status)
           AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%')
         ORDER BY a.updated_at DESC
         LIMIT p_limit OFFSET p_offset) q;
  END IF;

  RETURN jsonb_build_object('status','OK','data', v_rows, 'total_count', v_total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.bn_means_decision_context_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_decision_context_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_adjustment_reference_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_adjustment_reference_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_queues_v1(uuid,text,jsonb,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_queues_v1(uuid,text,jsonb,int,int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_approval_readiness(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_approval_readiness(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_person_label(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_person_label(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_adjustment_reference(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_adjustment_reference(uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_adjustment_target_catalogue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_adjustment_target_catalogue() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_mt7_execute(text,uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_means_mt7_execute(text,uuid,uuid,text,uuid,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public._bn_means_recalculate(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_means_recalculate(uuid,uuid,uuid,uuid) TO service_role;
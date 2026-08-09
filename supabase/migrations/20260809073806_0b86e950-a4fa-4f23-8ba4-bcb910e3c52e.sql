CREATE OR REPLACE FUNCTION public._bn_means_evidence_requirements(p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a     public.bn_means_assessment%ROWTYPE;
  v_rules jsonb;
  v_out   jsonb := '[]'::jsonb;
  r       record;
  v_thr   numeric;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_rules := public._bn_means_evidence_rules(v_a.policy_version_id);
  v_thr := COALESCE((v_rules->>'asset_evidence_threshold')::numeric, 5000);

  IF COALESCE((v_rules->>'require_identity_evidence')::boolean, true) THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'IDENTITY_EVIDENCE','ASSESSMENT',NULL),
      'requirement_code','IDENTITY_EVIDENCE',
      'requirement_label','Identity of the claimant',
      'requirement_group','ASSESSMENT',
      'obligation','MANDATORY','minimum_count',1,
      'subject_kind','ASSESSMENT','subject_ref_id',NULL,
      'subject_label', COALESCE(v_a.assessment_reference,'This assessment'),
      'reason','Policy requires the identity of the claimant to be evidenced.',
      'policy_basis','require_identity_evidence'));
  END IF;

  IF COALESCE((v_rules->>'require_residence_evidence')::boolean, false) THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'RESIDENCE_EVIDENCE','ASSESSMENT',NULL),
      'requirement_code','RESIDENCE_EVIDENCE',
      'requirement_label','Residence of the household',
      'requirement_group','ASSESSMENT',
      'obligation','MANDATORY','minimum_count',1,
      'subject_kind','ASSESSMENT','subject_ref_id',NULL,
      'subject_label', COALESCE(v_a.assessment_reference,'This assessment'),
      'reason','Policy requires proof of where the household resides.',
      'policy_basis','require_residence_evidence'));
  END IF;

  FOR r IN
    SELECT m.member_id, m.relationship_code, m.is_dependant
      FROM public.bn_means_household_member m
     WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
       AND COALESCE(m.is_self,false) = false
     ORDER BY m.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'HOUSEHOLD_RELATIONSHIP_EVIDENCE','HOUSEHOLD_MEMBER',r.member_id),
      'requirement_code','HOUSEHOLD_RELATIONSHIP_EVIDENCE',
      'requirement_label','Household relationship',
      'requirement_group','HOUSEHOLD',
      'obligation', CASE WHEN COALESCE(r.is_dependant,false) THEN 'MANDATORY'
                         ELSE COALESCE(v_rules->>'household_relationship_obligation','CONDITIONAL') END,
      'minimum_count',1,
      'subject_kind','HOUSEHOLD_MEMBER','subject_ref_id', r.member_id,
      'subject_label', COALESCE(public._bn_means_household_label('RELATIONSHIP_TYPE', r.relationship_code),'Household member'),
      'reason', CASE WHEN COALESCE(r.is_dependant,false)
                     THEN 'Dependency must be evidenced before it can be verified.'
                     ELSE 'Relationship to the claimant should be evidenced.' END,
      'policy_basis','household_relationship_obligation'));
  END LOOP;

  FOR r IN
    SELECT f.income_fact_id, f.category_code, f.declared_amount, f.effective_from, f.effective_to
      FROM public.bn_means_income_fact f
     WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
     ORDER BY f.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'INCOME_EVIDENCE','INCOME_FACT',r.income_fact_id),
      'requirement_code','INCOME_EVIDENCE',
      'requirement_label','Declared income',
      'requirement_group','INCOME',
      'obligation', COALESCE(v_rules->>'income_evidence_obligation','MANDATORY'),
      'minimum_count', COALESCE((v_rules->>'minimum_documents_per_requirement')::int,1),
      'subject_kind','INCOME_FACT','subject_ref_id', r.income_fact_id,
      'subject_label', COALESCE(public._bn_means_income_label('INCOME_CATEGORY', r.category_code), 'Declared income'),
      'period_from', r.effective_from, 'period_to', r.effective_to,
      'reason','Declared income must be supported before it can be verified.',
      'policy_basis','income_evidence_obligation'));
  END LOOP;

  FOR r IN
    SELECT a.asset_fact_id, a.valuation_amount, a.category_code
      FROM public.bn_means_asset_fact a
     WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL
     ORDER BY a.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'ASSET_EVIDENCE','ASSET_FACT',r.asset_fact_id),
      'requirement_code','ASSET_EVIDENCE',
      'requirement_label','Declared asset value',
      'requirement_group','ASSETS',
      'obligation', CASE WHEN COALESCE(r.valuation_amount,0) >= v_thr THEN 'MANDATORY'
                         ELSE COALESCE(v_rules->>'asset_evidence_obligation','CONDITIONAL') END,
      'minimum_count',1,
      'subject_kind','ASSET_FACT','subject_ref_id', r.asset_fact_id,
      'subject_label', COALESCE(public._bn_means_asset_label('ASSET_CATEGORY', r.category_code), 'Declared asset'),
      'reason', CASE WHEN COALESCE(r.valuation_amount,0) >= v_thr
                     THEN 'Valuation is at or above the policy evidence threshold.'
                     ELSE 'Supporting valuation evidence is expected where available.' END,
      'policy_basis','asset_evidence_threshold'));
  END LOOP;

  FOR r IN
    SELECT d.deduction_fact_id, d.evidence_requirement, d.category_code
      FROM public.bn_means_deduction_fact d
     WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
     ORDER BY d.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'DEDUCTION_EVIDENCE','DEDUCTION_FACT',r.deduction_fact_id),
      'requirement_code','DEDUCTION_EVIDENCE',
      'requirement_label','Deduction or disregard claimed',
      'requirement_group','DEDUCTIONS',
      'obligation', CASE WHEN COALESCE(r.evidence_requirement,'OPTIONAL') = 'REQUIRED'
                         THEN 'MANDATORY' ELSE 'OPTIONAL' END,
      'minimum_count',1,
      'subject_kind','DEDUCTION_FACT','subject_ref_id', r.deduction_fact_id,
      'subject_label', COALESCE(public._bn_means_deduction_label('DEDUCTION_CATEGORY', r.category_code), 'Claimed deduction'),
      'reason','The claimed basis must be evidenced before any allowance can be considered.',
      'policy_basis','deduction_evidence_requirement'));
  END LOOP;

  RETURN v_out;
END;
$function$;
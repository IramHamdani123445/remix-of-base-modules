-- Calculate availability must mirror the command guard + readiness
DO $mig$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bn_means_available_actions_v1';
  src := replace(src,
    $old$      ELSIF v_cmd = 'BN_MEANS_CALCULATE' AND v_a.status NOT IN ('SUBMITTED','VERIFICATION_PENDING','REVIEW_PENDING') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';$old$,
    $new$      ELSIF v_cmd = 'BN_MEANS_CALCULATE' THEN
        IF v_a.status <> 'VERIFICATION_PENDING' THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSIF NOT COALESCE((public._bn_means_readiness(p_assessment_id)->>'ready_for_calculation')::boolean,false) THEN
          v_allowed := false; v_reason := 'NOT_READY_FOR_CALCULATION';
        END IF;$new$);
  EXECUTE src;
END
$mig$;

CREATE OR REPLACE FUNCTION public.bn_means_benefit360_summary_v1(p_actor_user_id uuid, p_award_id uuid DEFAULT NULL::uuid, p_person_id bigint DEFAULT NULL::bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
  v_c public.bn_means_calculation%ROWTYPE;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code', 'data', NULL);
  END IF;
  IF p_award_id IS NULL AND p_person_id IS NULL THEN
    RETURN jsonb_build_object('status','INVALID','code','SUBJECT_REQUIRED','data', NULL);
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment a
   WHERE (p_award_id IS NOT NULL AND a.award_id = p_award_id)
      OR (p_award_id IS NULL AND a.person_id = p_person_id)
   ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'REASSESSMENT_DUE' THEN 1 ELSE 2 END,
            a.updated_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','OK','data', NULL);
  END IF;

  SELECT * INTO v_c FROM public.bn_means_calculation c
   WHERE c.assessment_id = v_a.assessment_id
   ORDER BY c.calculated_at DESC LIMIT 1;

  -- Deliberately no household, income, asset, deduction, verification-note
  -- or calculation-line detail on the general 360 card.
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', v_a.assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'status', v_a.status,
    'assessment_reason', v_a.assessment_reason,
    'policy_version_id', v_a.policy_version_id,
    'effective_from', v_a.effective_from,
    'effective_to', v_a.effective_to,
    'result', CASE WHEN v_a.status IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED','SUPERSEDED','CLOSED','REJECTED')
                   THEN v_a.result ELSE NULL END,
    'valid_until', v_a.valid_until,
    'reassessment_due', v_a.reassessment_due,
    'missing_information', (SELECT count(*) > 0 FROM public.bn_means_information_request ir
                             WHERE ir.assessment_id = v_a.assessment_id AND ir.status = 'OPEN'),
    'pending_verification', v_a.status IN ('SUBMITTED','VERIFICATION_PENDING'),
    'verification_status', CASE
        WHEN v_a.status = 'SUBMITTED' THEN 'NOT_STARTED'
        WHEN v_a.status = 'VERIFICATION_PENDING' THEN 'IN_PROGRESS'
        WHEN v_a.status IN ('DRAFT','INFORMATION_PENDING','INCOMPLETE') THEN 'NOT_APPLICABLE'
        ELSE 'COMPLETE' END,
    'calculation_status', CASE WHEN v_c.calculation_id IS NULL THEN 'NOT_CALCULATED' ELSE 'CALCULATED' END,
    'provisional_result', v_c.result,
    'calculated_at', v_c.calculated_at,
    'calculation_policy_version_id', v_c.policy_version_id,
    'pending_approval', (v_c.calculation_id IS NOT NULL AND v_a.status IN ('CALCULATED','REVIEW_PENDING','APPROVAL_PENDING'))
  ));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.bn_means_benefit360_summary_v1(uuid, uuid, bigint) TO authenticated;
-- ---------------------------------------------------------------
-- 4. Consolidated activation workspace read
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_activation_context_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_a   public.bn_means_assessment%ROWTYPE;
  v_c   public.bn_means_calculation%ROWTYPE;
  v_pv  public.bn_means_policy_version%ROWTYPE;
  v_ap  public.bn_means_approval%ROWTYPE;
  v_pub public.bn_means_fact_publication%ROWTYPE;
  v_h   public.bn_cross_module_handoff%ROWTYPE;
  v_ar  public.bn_cross_module_handoff%ROWTYPE;
  v_fact jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code',COALESCE(v_perm->>'code','FORBIDDEN'),'data',NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data',NULL);
  END IF;

  v_c := public._bn_means_latest_calculation(p_assessment_id);
  SELECT * INTO v_pv FROM public.bn_means_policy_version WHERE policy_version_id = v_a.policy_version_id;
  SELECT * INTO v_ap FROM public.bn_means_approval
   WHERE assessment_id = p_assessment_id AND decision = 'APPROVED'
   ORDER BY decided_at DESC LIMIT 1;
  SELECT * INTO v_pub FROM public.bn_means_fact_publication
   WHERE assessment_id = p_assessment_id
   ORDER BY (status='PUBLISHED') DESC, created_at DESC LIMIT 1;
  SELECT * INTO v_h  FROM public.bn_cross_module_handoff WHERE handoff_id = v_pub.eligibility_request_id;
  SELECT * INTO v_ar FROM public.bn_cross_module_handoff WHERE handoff_id = v_pub.award_review_handoff_id;
  v_fact := public._bn_means_fact_bundle(p_assessment_id);

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment', jsonb_build_object(
      'assessment_id', v_a.assessment_id,
      'assessment_reference', v_a.assessment_reference,
      'person_id', v_a.person_id,
      'person_label', COALESCE(NULLIF(v_a.declared_person->>'full_name',''),'Assessed person'),
      'benefit_programme', v_a.benefit_programme,
      'effective_from', v_a.effective_from,
      'currency_code', v_a.currency_code,
      'status', v_a.status,
      'result', v_a.result,
      'row_version', v_a.row_version,
      'claim_id', v_a.claim_id,
      'award_id', v_a.award_id,
      'activated_at', v_a.activated_at,
      'policy_version_id', v_a.policy_version_id,
      'policy_version_label', v_pv.version_label),
    'approval', CASE WHEN v_ap.approval_id IS NULL THEN NULL ELSE jsonb_build_object(
      'approval_id', v_ap.approval_id,
      'decision', v_ap.decision,
      'decision_reason', v_ap.decision_reason,
      'justification', v_ap.justification,
      'calculation_id', v_ap.calculation_id,
      'decided_at', v_ap.decided_at,
      'decided_by_label', public._bn_means_person_label(v_ap.decided_by)) END,
    'approved_calculation', CASE WHEN v_c.calculation_id IS NULL THEN NULL ELSE jsonb_build_object(
      'calculation_id', v_c.calculation_id,
      'sequence_no', v_c.sequence_no,
      'currency_code', v_c.currency_code,
      'household_size', v_c.household_size,
      'assessable_income', v_c.assessable_income,
      'assessable_assets', v_c.assessable_assets,
      'approved_deductions', v_c.approved_deductions,
      'threshold_amount', v_c.threshold_amount,
      'excess_amount', v_c.excess_amount,
      'shortfall_amount', v_c.shortfall_amount,
      'result', v_c.result,
      'valid_from', COALESCE(v_a.valid_from, v_c.valid_from),
      'valid_until', COALESCE(v_a.valid_until, v_c.valid_until),
      'reassessment_due', COALESCE(v_a.reassessment_due, v_c.reassessment_due),
      'calculation_hash', v_c.result_hash,
      'assessment_version_id', v_c.assessment_version_id) END,
    'readiness', public._bn_means_activation_readiness(p_assessment_id, p_actor_user_id),
    'fact_preview', CASE WHEN COALESCE((v_fact->>'ready')::boolean,false)
                         THEN v_fact->'bundle' ELSE NULL END,
    'publication', CASE WHEN v_pub.publication_id IS NULL THEN NULL ELSE jsonb_build_object(
      'publication_id', v_pub.publication_id,
      'publication_reference', v_pub.publication_reference,
      'publication_version', v_pub.publication_version,
      'status', v_pub.status,
      'bundle_hash', v_pub.bundle_hash,
      'fact_bundle', v_pub.fact_bundle,
      'published_at', v_pub.published_at,
      'published_by_label', public._bn_means_person_label(v_pub.published_by),
      'retry_count', v_pub.retry_count,
      'failure_code', v_pub.failure_code,
      'failure_detail', v_pub.failure_detail,
      'correlation_id', v_pub.correlation_id) END,
    'eligibility', jsonb_build_object(
      'status', COALESCE(v_pub.eligibility_status,'NOT_REQUESTED'),
      'request_id', v_pub.eligibility_request_id,
      'request_status', v_h.status,
      'requested_at', v_pub.eligibility_requested_at,
      'completed_at', v_pub.eligibility_completed_at,
      'result_reference', v_pub.eligibility_result_reference,
      'determination_status', v_pub.determination_status,
      'failure_code', v_pub.failure_code,
      'failure_detail', v_pub.failure_detail,
      'retry_available', (v_pub.publication_id IS NOT NULL AND v_pub.status='PUBLISHED'
                          AND COALESCE(v_pub.eligibility_status,'NOT_REQUESTED') IN ('FAILED','UNAVAILABLE','NOT_REQUESTED'))),
    'award_review', CASE WHEN v_ar.handoff_id IS NULL THEN NULL ELSE jsonb_build_object(
      'handoff_id', v_ar.handoff_id,
      'status', v_ar.status,
      'reason_code', v_ar.reason_code,
      'target_reference', v_ar.target_reference,
      'created_at', v_ar.created_at) END,
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_code', e.event_code, 'command_name', e.command_name,
        'from_status', e.from_status, 'to_status', e.to_status,
        'occurred_at', e.created_at,
        'actor_label', public._bn_means_person_label(e.actor_user_id))
        ORDER BY e.created_at DESC)
        FROM public.bn_means_event e
       WHERE e.assessment_id = p_assessment_id
         AND e.event_code IN ('MEANS_ASSESSMENT_APPROVED','APPROVAL_RECORDED','DECISION_RECORDED',
             'MEANS_FACTS_PUBLISHED','MEANS_ASSESSMENT_ACTIVATED','ELIGIBILITY_RERUN_REQUESTED',
             'ELIGIBILITY_RERUN_COMPLETED','ELIGIBILITY_RERUN_FAILED','ELIGIBILITY_RERUN_UPDATED',
             'AWARD_REVIEW_HANDOFF_CREATED')),'[]'::jsonb)
  ));
END;
$fn$;

-- ---------------------------------------------------------------
-- 5. Privacy-safe 360 summary — activation and eligibility posture only
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_benefit360_summary_v1(
  p_actor_user_id uuid, p_award_id uuid DEFAULT NULL, p_person_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
  v_pub public.bn_means_fact_publication%ROWTYPE;
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

  SELECT * INTO v_pub FROM public.bn_means_fact_publication
   WHERE assessment_id = v_a.assessment_id
   ORDER BY (status='PUBLISHED') DESC, created_at DESC LIMIT 1;

  -- Deliberately no household finances on the general 360 card.
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
    'valid_from', v_a.valid_from,
    'valid_until', v_a.valid_until,
    'reassessment_due', v_a.reassessment_due,
    'activated_at', v_a.activated_at,
    'fact_publication_status', COALESCE(v_pub.status,'NOT_PUBLISHED'),
    'eligibility_status', COALESCE(v_pub.eligibility_status,'NOT_REQUESTED'),
    'determination_status', v_pub.determination_status,
    'award_review_required', (v_pub.award_review_handoff_id IS NOT NULL),
    'missing_information', (SELECT count(*) > 0 FROM public.bn_means_information_request ir
                             WHERE ir.assessment_id = v_a.assessment_id AND ir.status = 'OPEN'),
    'pending_verification', v_a.status IN ('SUBMITTED','VERIFICATION_PENDING')
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.bn_means_activation_context_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_benefit360_summary_v1(uuid,uuid,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_benefit360_summary_v1(uuid,uuid,bigint) TO authenticated, service_role;
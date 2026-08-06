-- MT7 secured query boundaries -------------------------------------

CREATE OR REPLACE FUNCTION public.bn_means_adjustments_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id) THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'adjustment_id', a.adjustment_id,
      'adjustment_reference', a.adjustment_reference,
      'assessment_id', a.assessment_id,
      'assessment_version_id', a.assessment_version_id,
      'calculation_id', a.calculation_id,
      'original_calculation_hash', a.original_calculation_hash,
      'target_kind', a.target_kind,
      'target_id', a.target_id,
      'field_or_line_code', a.field_or_line_code,
      'original_value', a.original_value,
      'proposed_value', a.proposed_value,
      'currency_code', a.currency_code,
      'financial_effect', a.financial_effect,
      'reason_code', a.reason_code,
      'justification', a.justification,
      'evidence_id', a.evidence_id,
      'evidence_reference', a.evidence_reference,
      'status', a.status,
      'requested_by', a.requested_by,
      'requested_at', a.requested_at,
      'decided_by', a.decided_by,
      'decided_at', a.decided_at,
      'decision_reason_code', a.decision_reason_code,
      'decision_note', a.decision_note,
      'applied_calculation_id', a.applied_calculation_id,
      'applied_at', a.applied_at,
      'application_error', a.application_error,
      'row_version', a.row_version,
      'resulting_result', c.result,
      'resulting_calculation_hash', COALESCE(c.calculation_hash, c.result_hash),
      'resulting_excess_amount', c.excess_amount,
      'is_requester', (a.requested_by = p_actor_user_id))
      ORDER BY a.requested_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.bn_means_adjustment a
    LEFT JOIN public.bn_means_calculation c ON c.calculation_id = a.applied_calculation_id
   WHERE a.assessment_id = p_assessment_id;

  RETURN jsonb_build_object('status','OK','data', v_rows);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_approval_context_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
  v_av public.bn_means_assessment_version%ROWTYPE;
  v_c public.bn_means_calculation%ROWTYPE;
  v_prev public.bn_means_calculation%ROWTYPE;
  v_ready jsonb;
  v_open int; v_pending int;
  v_maker uuid;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  v_av := public._bn_means_frozen_version(p_assessment_id);
  v_c  := public._bn_means_latest_calculation(p_assessment_id);
  IF v_c.supersedes_calculation_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.bn_means_calculation
     WHERE calculation_id = v_c.supersedes_calculation_id;
  END IF;
  v_ready := public._bn_means_readiness(p_assessment_id);
  SELECT o.requested, o.pending_application INTO v_open, v_pending
    FROM public._bn_means_open_adjustments(p_assessment_id) o;
  SELECT maker_user_id INTO v_maker FROM public.bn_means_command_maker
   WHERE assessment_id = p_assessment_id AND maker_role = 'BN_MEANS_SUBMIT';

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', v_a.assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'status', v_a.status,
    'row_version', v_a.row_version,
    'currency_code', v_a.currency_code,
    'assessment_version_id', v_av.assessment_version_id,
    'assessment_version_no', v_av.version_no,
    'policy_version_id', v_a.policy_version_id,
    'verification_missing', COALESCE(jsonb_array_length(v_ready->'missing_verifications'),0),
    'verification_clarification', COALESCE(jsonb_array_length(v_ready->'clarification_required'),0),
    'verification_complete', COALESCE(jsonb_array_length(v_ready->'missing_verifications'),0) = 0,
    'calculation_id', v_c.calculation_id,
    'calculation_hash', COALESCE(v_c.calculation_hash, v_c.result_hash),
    'input_hash', v_c.input_hash,
    'calculated_at', v_c.calculated_at,
    'result', v_c.result,
    'assessable_income', v_c.assessable_income,
    'assessable_assets', v_c.assessable_assets,
    'approved_deductions', v_c.approved_deductions,
    'threshold_amount', v_c.threshold_amount,
    'excess_amount', v_c.excess_amount,
    'household_size', v_c.household_size,
    'warnings', COALESCE(v_c.warnings,'[]'::jsonb),
    'supersedes_calculation_id', v_c.supersedes_calculation_id,
    'triggering_adjustment_id', v_c.triggering_adjustment_id,
    'previous_result', v_prev.result,
    'previous_excess_amount', v_prev.excess_amount,
    'previous_assessable_income', v_prev.assessable_income,
    'previous_calculation_hash', COALESCE(v_prev.calculation_hash, v_prev.result_hash),
    'open_adjustments', COALESCE(v_open,0),
    'adjustments_pending_application', COALESCE(v_pending,0),
    'maker_user_id', COALESCE(v_maker, v_a.maker_user_id),
    'proposed_checker_user_id', p_actor_user_id,
    'actor_is_maker', (COALESCE(v_maker, v_a.maker_user_id) = p_actor_user_id),
    'valid_from', v_a.valid_from,
    'valid_until', v_a.valid_until,
    'reassessment_due', v_a.reassessment_due,
    'approved_calculation_id', v_a.approved_calculation_id,
    'approved_at', v_a.approved_at,
    'decided_at', v_a.decided_at,
    'decision_reason_code', v_a.decision_reason_code,
    'checker_user_id', v_a.checker_user_id,
    'decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'approval_id', ap.approval_id, 'decision', ap.decision,
        'decision_reason', ap.decision_reason, 'justification', ap.justification,
        'calculation_id', ap.calculation_id, 'decided_by', ap.decided_by,
        'decided_at', ap.decided_at) ORDER BY ap.decided_at DESC)
      FROM public.bn_means_approval ap WHERE ap.assessment_id = p_assessment_id),'[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_queues_v1(
  p_actor_user_id uuid, p_queue_code text, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
  v_total int := 0;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  IF p_queue_code NOT IN ('ADJUSTMENTS_AWAITING_DECISION','ADJUSTMENTS_AWAITING_RECALCULATION',
                          'ASSESSMENTS_AWAITING_APPROVAL','ASSESSMENTS_RETURNED_TO_REVIEW',
                          'ASSESSMENTS_REJECTED') THEN
    RETURN jsonb_build_object('status','INVALID','code','QUEUE_UNKNOWN','data', NULL);
  END IF;

  IF p_queue_code IN ('ADJUSTMENTS_AWAITING_DECISION','ADJUSTMENTS_AWAITING_RECALCULATION') THEN
    SELECT count(*) INTO v_total FROM public.bn_means_adjustment adj
     WHERE adj.status = CASE WHEN p_queue_code = 'ADJUSTMENTS_AWAITING_DECISION'
                             THEN 'REQUESTED' ELSE 'APPROVED_PENDING_APPLICATION' END;
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
          'requested_by', adj.requested_by,
          'requested_at', adj.requested_at,
          'is_requester', (adj.requested_by = p_actor_user_id),
          'application_error', adj.application_error,
          'row_version', adj.row_version) AS r
          FROM public.bn_means_adjustment adj
          JOIN public.bn_means_assessment a ON a.assessment_id = adj.assessment_id
         WHERE adj.status = CASE WHEN p_queue_code = 'ADJUSTMENTS_AWAITING_DECISION'
                                 THEN 'REQUESTED' ELSE 'APPROVED_PENDING_APPLICATION' END
         ORDER BY adj.requested_at DESC
         LIMIT p_limit OFFSET p_offset) q;
  ELSE
    SELECT count(*) INTO v_total FROM public.bn_means_assessment a
     WHERE a.status = CASE p_queue_code
       WHEN 'ASSESSMENTS_AWAITING_APPROVAL' THEN 'CALCULATED'
       WHEN 'ASSESSMENTS_RETURNED_TO_REVIEW' THEN 'REVIEW_PENDING'
       ELSE 'REJECTED' END;
    SELECT COALESCE(jsonb_agg(r ORDER BY r->>'updated_at' DESC),'[]'::jsonb) INTO v_rows
      FROM (
        SELECT jsonb_build_object(
          'queue_code', p_queue_code,
          'assessment_id', a.assessment_id,
          'assessment_reference', a.assessment_reference,
          'assessment_status', a.status,
          'benefit_programme', a.benefit_programme,
          'assessment_reason', a.assessment_reason,
          'result', a.result,
          'updated_at', a.updated_at,
          'decided_at', a.decided_at,
          'maker_user_id', a.maker_user_id,
          'checker_user_id', a.checker_user_id,
          'row_version', a.row_version,
          'open_adjustments', (SELECT count(*) FROM public.bn_means_adjustment ad
                                WHERE ad.assessment_id = a.assessment_id AND ad.status = 'REQUESTED')
          ) AS r
          FROM public.bn_means_assessment a
         WHERE a.status = CASE p_queue_code
           WHEN 'ASSESSMENTS_AWAITING_APPROVAL' THEN 'CALCULATED'
           WHEN 'ASSESSMENTS_RETURNED_TO_REVIEW' THEN 'REVIEW_PENDING'
           ELSE 'REJECTED' END
         ORDER BY a.updated_at DESC
         LIMIT p_limit OFFSET p_offset) q;
  END IF;

  RETURN jsonb_build_object('status','OK','data', v_rows, 'total_count', v_total);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.bn_means_adjustments_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_means_approval_context_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_means_queues_v1(uuid,text,int,int) TO authenticated;

-- Benefit 360 — privacy-safe MT7 indicators only.
CREATE OR REPLACE FUNCTION public.bn_means_benefit360_summary_v1(
  p_actor_user_id uuid, p_award_id uuid DEFAULT NULL::uuid, p_person_id bigint DEFAULT NULL::bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
  v_c public.bn_means_calculation%ROWTYPE;
  v_open int; v_pending int;
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

  SELECT o.requested, o.pending_application INTO v_open, v_pending
    FROM public._bn_means_open_adjustments(v_a.assessment_id) o;

  -- Deliberately no household, income, asset, deduction, verification-note,
  -- checker-note, calculation-line, proposed-adjustment-value or rejection
  -- narrative detail on the general 360 card.
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
    'pending_approval', (v_c.calculation_id IS NOT NULL AND v_a.status IN ('CALCULATED','REVIEW_PENDING','APPROVAL_PENDING')),
    'adjustment_pending', COALESCE(v_open,0) > 0,
    'adjustment_application_pending', COALESCE(v_pending,0) > 0,
    'approved_not_active', (v_a.status = 'APPROVED'),
    'rejected', (v_a.status = 'REJECTED'),
    'decision_date', v_a.decided_at
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bn_means_benefit360_summary_v1(uuid,uuid,bigint) TO authenticated;
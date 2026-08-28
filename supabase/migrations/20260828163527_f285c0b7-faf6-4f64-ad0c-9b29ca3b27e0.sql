-- DEF-S1B-21: ia_close_action updated status/action_status but left lifecycle_status
-- at 'Verified'. Engagement closure counts open actions on lifecycle_status, so a fully
-- verified and closed action still read as open and the engagement could never close
-- cleanly (it was forced to 'Closed - Actions Pending'). Keep lifecycle in step.

CREATE OR REPLACE FUNCTION public.ia_close_action(p_action_id uuid, p_closure_notes text, p_evidence_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_ev uuid[];
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Action not found'); END IF;
  IF NOT public.ia_cmd_guard_elevated('action_tracking', 'approve', v_a.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to close this action');
  END IF;

  v_ev := COALESCE(p_evidence_ids, v_a.evidence_ids);
  IF v_ev IS NULL OR array_length(v_ev, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_EVIDENCE_REQUIRED',
      'error', 'Verification evidence must be linked before an action can be closed');
  END IF;
  IF COALESCE(trim(p_closure_notes), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOTES_REQUIRED', 'error', 'Closure notes are required');
  END IF;
  IF v_a.lifecycle_status IS DISTINCT FROM 'Verified' AND v_a.lifecycle_status IS DISTINCT FROM 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_STATE',
      'error', 'Only actions that have passed Internal Audit verification can be closed');
  END IF;

  UPDATE public.ia_action_tracking
     SET action_status = 'Closed', status = 'Closed', lifecycle_status = 'Closed',
         evidence_ids = v_ev, closure_notes = p_closure_notes,
         closure_verified_by = v_actor, closure_verified_at = now(),
         verified_by = v_actor, verified_date = now(), verification_date = now(),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.CLOSED', 'action', p_action_id, v_a.engagement_id, NULL,
    jsonb_build_object('status', v_a.status, 'lifecycle_status', v_a.lifecycle_status),
    jsonb_build_object('status', 'Closed', 'lifecycle_status', 'Closed', 'evidence_count', array_length(v_ev, 1)),
    p_closure_notes, NULL, 'ia_close_action');

  RETURN jsonb_build_object('success', true, 'action_id', p_action_id, 'lifecycle_status', 'Closed');
END;
$function$;

-- Backfill actions already closed under the defective command
UPDATE public.ia_action_tracking
   SET lifecycle_status = 'Closed', updated_at = now()
 WHERE status = 'Closed' AND action_status = 'Closed' AND lifecycle_status = 'Verified';
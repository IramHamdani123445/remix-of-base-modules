
CREATE OR REPLACE FUNCTION public.ia_close_engagement(p_engagement_id uuid, p_disposition text DEFAULT 'Closed'::text, p_final_rating text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gate jsonb;
  v_actor text := public.ia_actor_label();
  v_eng record;
  v_open_actions int;
  v_open_followups int;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Audit not found');
  END IF;

  IF NOT ( public.ia_actor_can('audit_engagements','close')
        OR public.ia_cmd_guard_elevated('audit_engagements','approve', p_engagement_id) ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to close audits');
  END IF;

  IF p_disposition NOT IN ('Closed','Closed – Actions Pending') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_DISPOSITION', 'error', 'Invalid disposition: ' || COALESCE(p_disposition,'NULL'));
  END IF;

  IF COALESCE(v_eng.execution_status,'') IN ('Closed','Closed – Actions Pending')
     OR COALESCE(v_eng.status,'') = 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ALREADY_CLOSED', 'error', 'Audit is already closed');
  END IF;

  -- Single source of truth: the same readiness evaluation the Closure screen renders.
  v_gate := public.ia_evaluate_engagement_closure_v2(p_engagement_id);
  IF NOT COALESCE((v_gate->>'can_close')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_READY',
      'error', 'Closure requirements are not met', 'reasons', v_gate->'reasons', 'blockers', v_gate->'reasons');
  END IF;

  SELECT count(*) INTO v_open_actions FROM public.ia_action_tracking
   WHERE engagement_id = p_engagement_id
     AND COALESCE(lifecycle_status, status, 'Open') NOT IN ('Closed','Cancelled');

  SELECT count(*) INTO v_open_followups FROM public.ia_follow_ups
   WHERE engagement_id = p_engagement_id
     AND COALESCE(lifecycle_status, status, 'Scheduled') NOT IN ('Implemented','Resolved','Closed','Cancelled');

  IF p_disposition = 'Closed' AND (v_open_actions > 0 OR v_open_followups > 0) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ACTIONS_PENDING',
      'error', 'Corrective actions or follow-ups are still open — close as "Closed – Actions Pending"',
      'open_actions', v_open_actions, 'open_follow_ups', v_open_followups,
      'suggested_disposition', 'Closed – Actions Pending');
  END IF;

  UPDATE public.ia_audit_engagements SET
    execution_status = p_disposition,
    status = 'Closed',
    closure_date = now()::date,
    closed_by = v_actor,
    closure_notes = p_notes,
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_engagement_id;

  UPDATE public.ia_department_audits SET
    is_closed = true,
    status = 'Closed',
    closed_by = v_actor,
    closed_date = now(),
    closure_notes = p_notes,
    final_rating = COALESCE(p_final_rating, final_rating),
    closure_approved_by = v_actor,
    closure_approval_date = now()::date,
    updated_at = now(),
    updated_by = v_actor
  WHERE id = v_eng.department_audit_id;

  INSERT INTO public.ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_CLOSED',
    COALESCE(p_notes, 'Audit closed'), COALESCE(v_eng.execution_status,'Unknown'), p_disposition, v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.CLOSED', 'engagement', p_engagement_id, p_engagement_id, v_eng.annual_plan_id,
    jsonb_build_object('status', v_eng.status, 'execution_status', v_eng.execution_status),
    jsonb_build_object('status','Closed','execution_status', p_disposition, 'final_rating', p_final_rating),
    p_notes, NULL, 'ia_close_engagement');

  RETURN jsonb_build_object('success', true, 'disposition', p_disposition, 'closed_by', v_actor,
    'open_actions', v_open_actions, 'open_follow_ups', v_open_followups);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_evaluate_engagement_closure(p_engagement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exec_status text;
  v_status text;
  v_v2 jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_reason text;
  v_open_actions int;
  v_open_followups int;
BEGIN
  SELECT execution_status, status INTO v_exec_status, v_status
  FROM ia_audit_engagements WHERE id = p_engagement_id;

  IF v_exec_status IS NULL AND v_status IS NULL THEN
    RETURN jsonb_build_object('found', false, 'can_close', false,
      'blockers', jsonb_build_array(jsonb_build_object('code','not_found','message','Audit not found')));
  END IF;

  IF v_exec_status IN ('Closed','Closed – Actions Pending') OR COALESCE(v_status,'') = 'Closed' THEN
    v_blockers := v_blockers || jsonb_build_object('code','already_closed','message','Audit is already closed');
  END IF;

  v_v2 := public.ia_evaluate_engagement_closure_v2(p_engagement_id);
  FOR v_reason IN SELECT jsonb_array_elements_text(COALESCE(v_v2->'reasons','[]'::jsonb)) LOOP
    v_blockers := v_blockers || jsonb_build_object('code','lifecycle','message', v_reason);
  END LOOP;

  SELECT count(*) INTO v_open_actions FROM ia_action_tracking
   WHERE engagement_id = p_engagement_id
     AND COALESCE(lifecycle_status, status, 'Open') NOT IN ('Closed','Cancelled');

  SELECT count(*) INTO v_open_followups FROM ia_follow_ups
   WHERE engagement_id = p_engagement_id
     AND COALESCE(lifecycle_status, status, 'Scheduled') NOT IN ('Implemented','Resolved','Closed','Cancelled');

  RETURN jsonb_build_object(
    'found', true,
    'execution_status', v_exec_status,
    'can_close', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'open_actions', v_open_actions,
    'open_follow_ups', v_open_followups,
    'suggested_disposition',
      CASE WHEN v_open_actions > 0 OR v_open_followups > 0 THEN 'Closed – Actions Pending' ELSE 'Closed' END
  );
END;
$function$;

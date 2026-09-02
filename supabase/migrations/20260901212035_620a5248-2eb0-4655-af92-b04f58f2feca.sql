-- DEF-E0-01: soft-deleted (is_active = false) audits could never reach a terminal
-- execution_status through any governed command, leaving permanently "open" estate.
-- Cancellation is a terminal disposition and must remain reachable for them.
CREATE OR REPLACE FUNCTION public.ia_cancel_engagement(p_engagement_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_eng record;
  v_actor text := public.ia_actor_label();
  v_auditee jsonb;
  v_dept_name text;
  v_version integer;
  v_notified boolean;
BEGIN
  -- NOTE: intentionally not filtered on is_active — see DEF-E0-01.
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'delete', p_engagement_id)
     AND NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to cancel this engagement');
  END IF;

  IF coalesce(v_eng.execution_status,'') IN ('Cancelled','Closed','Closed – Actions Pending') THEN
    RETURN jsonb_build_object('success', true, 'code', 'IA_ALREADY_TERMINAL', 'deduped', true,
      'message', 'Engagement is already in a terminal state');
  END IF;

  IF coalesce(btrim(coalesce(p_reason,'')),'') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED',
      'error', 'A reason is required to cancel an audit');
  END IF;

  v_notified := v_eng.intimation_issued_at IS NOT NULL;
  v_version := coalesce(v_eng.schedule_version, 0) + 1;

  IF v_notified THEN
    v_auditee := public.ia_comms_auditee_fact(p_engagement_id);
    IF v_auditee = '{}'::jsonb THEN
      RETURN jsonb_build_object('success', false, 'code', 'INTIMATION_RECIPIENT_REQUIRED',
        'error', 'The auditee was formally notified but no recipient can be resolved for the cancellation notice');
    END IF;
  END IF;

  SELECT name INTO v_dept_name FROM public.ia_departments WHERE id = v_eng.department_id;

  UPDATE public.ia_audit_engagements SET
    execution_status = 'Cancelled', schedule_version = v_version,
    updated_at = now(), updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_schedule_history
    (engagement_id, schedule_version, operation, previous_start_date, previous_end_date, reason, performed_by)
  VALUES (p_engagement_id, v_version, 'CANCELLED', v_eng.planned_start_date, v_eng.planned_end_date, p_reason, v_actor);

  INSERT INTO public.ia_engagement_execution_log
    (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_CANCELLED', 'Audit cancelled: ' || p_reason,
    coalesce(v_eng.execution_status,'Planned'), 'Cancelled', v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.CANCELLED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('execution_status', coalesce(v_eng.execution_status,'Planned'),
                       'is_active', coalesce(v_eng.is_active, true)),
    jsonb_build_object('execution_status','Cancelled','reason',p_reason,'previously_notified',v_notified),
    v_actor, NULL, 'ia_cancel_engagement');

  IF v_notified THEN
    PERFORM public.ia_comms_emit_mandatory(
      'INTERNAL_AUDIT.ENGAGEMENT.CANCELLED', 'ia_audit_engagement', p_engagement_id::text,
      'cancel:' || v_version, v_auditee,
      jsonb_build_object(
        'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
        'reference', coalesce(v_eng.engagement_code, p_engagement_id::text),
        'engagementTitle', v_eng.engagement_name,
        'auditeeUnit', coalesce(v_dept_name,'Audited department'),
        'cancelledOn', to_char(now(),'DD Mon YYYY'),
        'cancellationReason', p_reason),
      'internal_audit:cancel:' || p_engagement_id::text || ':' || v_version,
      v_eng.department_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'code', 'IA_CANCELLED',
    'auditee_notified', v_notified,
    'message', CASE WHEN v_notified THEN 'Audit cancelled and the notified auditee informed'
                    ELSE 'Audit cancelled (no formal intimation had been issued)' END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ia_cancel_engagement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_cancel_engagement(uuid, text) TO authenticated;
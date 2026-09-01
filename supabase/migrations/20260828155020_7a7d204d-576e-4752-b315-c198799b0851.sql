-- DEF-S1B-11 / DEF-S1B-12 / DEF-S1B-13: govern legacy execution-lifecycle commands

CREATE OR REPLACE FUNCTION public.ia_launch_engagement(p_engagement_id uuid, p_launched_by text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_plan_status text;
  v_actor text := public.ia_actor_label();
  v_errors text[] := '{}';
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id AND is_active = true;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to launch this engagement');
  END IF;

  IF COALESCE(v_eng.execution_status, 'Planned') NOT IN ('Planned', 'Ready for Launch') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ALREADY_LAUNCHED',
      'error', 'Engagement already launched (current: ' || COALESCE(v_eng.execution_status, 'NULL') || ')');
  END IF;

  IF v_eng.annual_plan_id IS NOT NULL THEN
    SELECT status INTO v_plan_status FROM public.ia_annual_plans WHERE id = v_eng.annual_plan_id;
    IF v_plan_status IS NULL OR v_plan_status <> 'Approved' THEN
      v_errors := array_append(v_errors, 'Parent plan not approved (status: ' || COALESCE(v_plan_status, 'N/A') || ')');
    END IF;
    IF v_eng.approved_plan_version IS NULL THEN
      v_errors := array_append(v_errors, 'Engagement is not stamped with an approved plan version');
    END IF;
  END IF;

  IF COALESCE(v_eng.engagement_name, '') = '' THEN v_errors := array_append(v_errors, 'Title missing'); END IF;
  IF v_eng.department_id IS NULL THEN v_errors := array_append(v_errors, 'Department not assigned'); END IF;
  IF v_eng.function_id IS NULL THEN v_errors := array_append(v_errors, 'Function not assigned'); END IF;
  IF v_eng.lead_auditor_id IS NULL THEN v_errors := array_append(v_errors, 'Lead auditor not assigned'); END IF;
  IF v_eng.planned_start_date IS NULL OR v_eng.planned_end_date IS NULL THEN v_errors := array_append(v_errors, 'Planned dates missing'); END IF;
  IF COALESCE(v_eng.objectives, '') = '' THEN v_errors := array_append(v_errors, 'Objectives missing'); END IF;
  IF COALESCE(v_eng.scope, '') = '' THEN v_errors := array_append(v_errors, 'Scope missing'); END IF;
  IF v_eng.primary_auditee_contact_id IS NULL AND COALESCE(v_eng.auditee_contact, '') = '' THEN
    v_errors := array_append(v_errors, 'Auditee contact missing');
  END IF;
  IF v_eng.reviewer_id IS NOT NULL AND v_eng.reviewer_id = v_eng.lead_auditor_id THEN
    v_errors := array_append(v_errors, 'Independent reviewer must differ from the lead auditor');
  END IF;

  IF array_length(v_errors, 1) > 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_READY', 'errors', to_jsonb(v_errors),
      'error', 'Launch readiness failed: ' || array_to_string(v_errors, '; '));
  END IF;

  UPDATE public.ia_audit_engagements SET
    execution_status = 'Notification Sent',
    status = CASE WHEN status IN ('Planned', 'Approved') THEN 'In Progress' ELSE status END,
    preparation_status = CASE WHEN COALESCE(preparation_status, 'Not Started') = 'Not Started' THEN 'In Progress' ELSE preparation_status END,
    launched_at = now(),
    launched_by = v_actor,
    actual_start_date = COALESCE(actual_start_date, now()::date),
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_LAUNCHED', 'Engagement launched for execution',
    COALESCE(v_eng.execution_status, 'Planned'), 'Notification Sent', v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.LAUNCHED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('execution_status', COALESCE(v_eng.execution_status, 'Planned'), 'status', v_eng.status,
                       'preparation_status', v_eng.preparation_status),
    jsonb_build_object('execution_status', 'Notification Sent', 'status', 'In Progress',
                       'preparation_status', 'In Progress', 'approved_plan_version', v_eng.approved_plan_version),
    p_launched_by, NULL, 'ia_launch_engagement');

  RETURN jsonb_build_object('success', true, 'message', 'Engagement launched successfully',
    'new_execution_status', 'Notification Sent', 'launched_by', v_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_transition_execution_status(p_engagement_id uuid, p_new_status text, p_performed_by text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_actor text := public.ia_actor_label();
  v_valid_statuses text[] := ARRAY[
    'Planned', 'Ready for Launch', 'Notification Sent', 'Opening Meeting Scheduled',
    'Fieldwork In Progress', 'Findings Drafting', 'Management Response Pending',
    'Final Report Issued', 'Follow-up Monitoring', 'Deferred', 'Cancelled'
  ];
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id AND is_active = true;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to change the execution status of this engagement');
  END IF;

  IF p_new_status IN ('Closed', 'Closed – Actions Pending') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_USE_CLOSURE_COMMAND',
      'error', 'Closure must be performed through the governed closure command');
  END IF;

  IF NOT (p_new_status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_STATUS',
      'error', 'Invalid execution status: ' || COALESCE(p_new_status, 'NULL'));
  END IF;

  IF COALESCE(v_eng.status, '') = 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ALREADY_CLOSED', 'error', 'Audit is already closed');
  END IF;

  IF p_new_status = 'Fieldwork In Progress' AND COALESCE(v_eng.preparation_status, 'Not Started') <> 'Complete' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PREP_INCOMPLETE',
      'error', 'Preparation must be complete before fieldwork can start');
  END IF;

  UPDATE public.ia_audit_engagements SET
    execution_status = p_new_status,
    execution_notes = COALESCE(p_notes, execution_notes),
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by, metadata)
  VALUES (
    p_engagement_id, 'STATUS_TRANSITION',
    'Execution status changed from ' || COALESCE(v_eng.execution_status, 'Planned') || ' to ' || p_new_status,
    COALESCE(v_eng.execution_status, 'Planned'), p_new_status, v_actor,
    CASE WHEN p_notes IS NOT NULL THEN jsonb_build_object('notes', p_notes) ELSE NULL END
  );

  PERFORM public.ia_log_event('IA.ENGAGEMENT.EXECUTION_STATUS_CHANGED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('execution_status', COALESCE(v_eng.execution_status, 'Planned')),
    jsonb_build_object('execution_status', p_new_status),
    p_notes, NULL, 'ia_transition_execution_status');

  RETURN jsonb_build_object('success', true, 'message', 'Status transitioned to ' || p_new_status,
    'performed_by', v_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_record_communication_stage(p_engagement_id uuid, p_stage_code text, p_template_id uuid DEFAULT NULL::uuid, p_recipient_name text DEFAULT NULL::text, p_recipient_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_created_by text DEFAULT NULL::text, p_acknowledgment_required boolean DEFAULT false, p_mode text DEFAULT 'send'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stage_order INT;
  v_template_name TEXT;
  v_policy RECORD;
  v_stage_id UUID;
  v_actor text := public.ia_actor_label();
BEGIN
  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to record communications for this engagement');
  END IF;

  v_stage_order := CASE p_stage_code
    WHEN 'PLAN_INTIMATION' THEN 1 WHEN 'ENGAGEMENT_NOTIFICATION' THEN 1 WHEN 'AUDIT_NOTIFICATION' THEN 1
    WHEN 'TEAM_AND_SCOPE_NOTICE' THEN 2
    WHEN 'DOC_REQUEST' THEN 3 WHEN 'ENTRANCE_MEETING' THEN 4
    WHEN 'QUERY_CYCLE' THEN 5 WHEN 'DRAFT_FINDING_DISCUSSION' THEN 6
    WHEN 'EXIT_MEETING' THEN 7 WHEN 'FINAL_REPORT_ISSUE' THEN 8
    WHEN 'ACTION_PLAN_REMINDER' THEN 9 ELSE 99
  END;

  IF p_template_id IS NOT NULL THEN
    SELECT name INTO v_template_name FROM public.ia_document_templates WHERE id = p_template_id;
    SELECT * INTO v_policy FROM public.ia_template_policy_matrix WHERE stage_code = p_stage_code AND is_active = true LIMIT 1;
    IF v_policy IS NOT NULL AND v_policy.is_mandatory THEN
      IF NOT EXISTS (SELECT 1 FROM public.ia_document_templates WHERE id = p_template_id AND category = v_policy.required_template_category AND is_active = true) THEN
        RETURN jsonb_build_object('success', false, 'error', format('Template must be of category "%s" for stage %s', v_policy.required_template_category, p_stage_code));
      END IF;
    END IF;
  END IF;

  IF p_stage_code <> 'QUERY_CYCLE' THEN
    IF EXISTS (SELECT 1 FROM public.ia_communication_stages WHERE engagement_id = p_engagement_id AND stage_code = p_stage_code AND delivery_status IN ('Sent','Delivered','Acknowledged')) THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_STAGE_ALREADY_DONE',
        'error', format('Stage %s already completed for this engagement', p_stage_code));
    END IF;
  END IF;

  INSERT INTO public.ia_communication_stages (engagement_id, stage_code, stage_order, template_id, template_name, recipient_name, recipient_email, sent_at, acknowledgment_required, delivery_status, notes, created_by)
  VALUES (p_engagement_id, p_stage_code, v_stage_order, p_template_id, v_template_name, p_recipient_name, p_recipient_email, now(), p_acknowledgment_required, 'Sent', COALESCE(p_notes, p_created_by), v_actor)
  RETURNING id INTO v_stage_id;

  PERFORM public.ia_log_event('IA.COMMUNICATION.STAGE_RECORDED', 'communication_stage', v_stage_id, p_engagement_id, NULL,
    NULL,
    jsonb_build_object('stage_code', p_stage_code, 'recipient_email', p_recipient_email, 'delivery_status', 'Sent'),
    p_notes, NULL, 'ia_record_communication_stage');

  RETURN jsonb_build_object('success', true, 'stage_id', v_stage_id, 'stage_code', p_stage_code, 'stage_order', v_stage_order);
END;
$function$;
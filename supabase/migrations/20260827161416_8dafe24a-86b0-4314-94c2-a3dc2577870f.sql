
CREATE OR REPLACE FUNCTION public.ia_record_management_response(p_finding_id uuid, p_management_position text, p_response_text text, p_action_plan text DEFAULT NULL::text, p_responsible_person text DEFAULT NULL::text, p_target_date date DEFAULT NULL::date, p_rejection_rationale text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_f record; v_actor text := public.ia_actor_label(); v_id uuid;
BEGIN
  SELECT * INTO v_f FROM public.ia_findings WHERE id = p_finding_id;
  IF v_f IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Finding not found'); END IF;

  IF NOT (public.ia_cmd_guard('audit_findings', 'edit', v_f.engagement_id)
          OR public.ia_can_access_engagement(v_f.engagement_id)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to respond to this finding');
  END IF;

  IF v_f.lifecycle_status <> 'Released' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FINDING_NOT_RELEASED',
      'error', 'A management response can only be recorded once the finding has been released to management');
  END IF;

  IF p_management_position NOT IN ('Accepted','Partially Accepted','Rejected') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_POSITION',
      'error', 'Management position must be Accepted, Partially Accepted or Rejected');
  END IF;

  IF p_management_position IN ('Partially Accepted','Rejected')
     AND COALESCE(trim(p_rejection_rationale), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_RATIONALE_REQUIRED',
      'error', 'A written rationale is required when a finding is rejected or only partially accepted');
  END IF;

  IF p_management_position IN ('Accepted','Partially Accepted')
     AND (COALESCE(trim(p_action_plan), '') = '' OR p_target_date IS NULL OR COALESCE(trim(p_responsible_person), '') = '') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ACTION_PLAN_REQUIRED',
      'error', 'An action plan, responsible person and target date are required when the finding is accepted');
  END IF;

  INSERT INTO public.ia_management_responses(
    finding_id, engagement_id, response_text, action_plan, responsible_person,
    target_date, management_position, rejection_rationale, status,
    submitted_by, submitted_date, created_by, updated_by)
  VALUES (p_finding_id, v_f.engagement_id, p_response_text, p_action_plan, p_responsible_person,
    p_target_date, p_management_position, p_rejection_rationale, 'Submitted',
    v_actor, now(), v_actor, v_actor)
  RETURNING id INTO v_id;

  -- The finding moves to Responded as a system consequence of the response being
  -- recorded. This must not depend on the responder holding internal-audit edit
  -- rights: the responder is, by definition, the auditee.
  UPDATE public.ia_findings
     SET lifecycle_status = 'Responded', status = 'Responded',
         updated_at = now(), updated_by = v_actor
   WHERE id = p_finding_id;

  PERFORM public.ia_log_event('IA.FINDING.RESPONDED', 'finding', p_finding_id, v_f.engagement_id, v_f.annual_plan_id,
    jsonb_build_object('lifecycle_status', v_f.lifecycle_status),
    jsonb_build_object('lifecycle_status', 'Responded'), 'Management response recorded', NULL, 'ia_record_management_response');

  PERFORM public.ia_log_event('IA.RESPONSE.RECORDED', 'management_response', v_id, v_f.engagement_id, v_f.annual_plan_id,
    NULL, jsonb_build_object('management_position', p_management_position, 'finding_id', p_finding_id),
    p_rejection_rationale, NULL, 'ia_record_management_response');

  RETURN jsonb_build_object('success', true, 'response_id', v_id, 'management_position', p_management_position);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_create_action_from_recommendation(p_recommendation_id uuid, p_responsible_person text DEFAULT NULL::text, p_target_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec  public.ia_recommendations%ROWTYPE;
  v_f    record;
  v_e    record;
  v_id   uuid;
  v_resp uuid;
BEGIN
  IF NOT public.ia_actor_can('InternalAudit', 'create_audit_actions')
     AND NOT public.ia_actor_can('InternalAudit', 'progress_audit_actions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not permitted to raise audit actions.');
  END IF;

  SELECT * INTO v_rec FROM public.ia_recommendations WHERE id = p_recommendation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recommendation not found.');
  END IF;

  SELECT * INTO v_f FROM public.ia_findings WHERE id = v_rec.finding_id;
  IF v_f IS NULL OR v_f.engagement_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recommendation is not linked to an engagement finding.');
  END IF;

  SELECT * INTO v_e FROM public.ia_audit_engagements WHERE id = v_f.engagement_id;

  IF EXISTS (SELECT 1 FROM public.ia_action_tracking WHERE recommendation_id = p_recommendation_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'An action already exists for this recommendation.');
  END IF;

  SELECT id INTO v_resp FROM public.ia_management_responses
   WHERE finding_id = v_rec.finding_id ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.ia_action_tracking (
    finding_id, engagement_id, recommendation_id, response_id, action_description,
    annual_plan_id, department_id, function_id,
    responsible_person, target_date, original_target_date, current_target_date,
    status, action_status, lifecycle_status, created_by
  ) VALUES (
    v_rec.finding_id, v_f.engagement_id, p_recommendation_id, v_resp, v_rec.recommendation_text,
    COALESCE(v_f.annual_plan_id, v_e.annual_plan_id), COALESCE(v_f.department_id, v_e.department_id), v_e.function_id,
    COALESCE(NULLIF(p_responsible_person,''), v_rec.responsible_party),
    COALESCE(p_target_date, v_rec.official_target_date, v_rec.suggested_target_date),
    COALESCE(p_target_date, v_rec.official_target_date, v_rec.suggested_target_date),
    COALESCE(p_target_date, v_rec.official_target_date, v_rec.suggested_target_date),
    'Open', 'Open', 'Open', public.ia_actor_label()
  ) RETURNING id INTO v_id;

  UPDATE public.ia_recommendations
     SET status = COALESCE(NULLIF(status,''), 'Open'),
         updated_at = now(),
         updated_by = public.ia_actor_label()
   WHERE id = p_recommendation_id;

  PERFORM public.ia_log_event('IA.ACTION.RAISED', 'action', v_id, v_f.engagement_id,
    COALESCE(v_f.annual_plan_id, v_e.annual_plan_id), NULL,
    jsonb_build_object('recommendation_id', p_recommendation_id), NULL, NULL, 'ia_create_action_from_recommendation');

  RETURN jsonb_build_object('success', true, 'action_id', v_id, 'engagement_id', v_f.engagement_id);
END;
$function$;

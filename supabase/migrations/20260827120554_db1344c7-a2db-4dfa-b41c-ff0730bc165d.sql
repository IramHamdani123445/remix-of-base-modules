-- =====================================================================
-- INTERNAL AUDIT WAVE 2 — MIGRATION 2/3 : GOVERNED LIFECYCLE COMMANDS
-- =====================================================================

-- ---------------------------------------------------------------
-- 0. COMMAND GUARD HELPERS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_cmd_guard(_module text, _action text, _engagement uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ia_is_ia_user()
     AND (_engagement IS NULL OR public.ia_can_access_engagement(_engagement))
     AND (
          public.ia_can_read_all()
       OR public.ia_actor_can(_module, _action)
       OR public.ia_actor_can('internal_audit', _action)
       OR (_engagement IS NOT NULL AND public.ia_can_access_engagement_internal(_engagement))
     );
$$;

-- Elevated (approval-class) guard: assignment alone is not enough.
CREATE OR REPLACE FUNCTION public.ia_cmd_guard_elevated(_module text, _action text, _engagement uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ia_is_ia_user()
     AND (_engagement IS NULL OR public.ia_can_access_engagement(_engagement))
     AND (
          public.ia_can_read_all()
       OR public.ia_actor_can(_module, _action)
       OR public.ia_actor_can('internal_audit', _action)
       OR EXISTS (SELECT 1 FROM public.ia_audit_engagements e
                   WHERE e.id = _engagement
                     AND (e.lead_auditor_id = public.ia_current_auditor_id()
                       OR e.reviewer_id = public.ia_current_auditor_id()))
     );
$$;

CREATE OR REPLACE FUNCTION public.ia_auditor_profile(_auditor_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT COALESCE(a.profile_id, a.user_id) FROM public.ia_auditors a WHERE a.id = _auditor_id $$;

REVOKE ALL ON FUNCTION public.ia_cmd_guard(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_cmd_guard_elevated(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_auditor_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_cmd_guard(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_cmd_guard_elevated(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_auditor_profile(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------
-- 1. PREPARATION
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_complete_preparation(p_engagement_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng record; v_actor text := public.ia_actor_label();
  v_open int; v_notified boolean; v_reasons text[] := '{}';
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found'); END IF;
  IF NOT public.ia_cmd_guard('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to complete preparation for this engagement');
  END IF;

  SELECT count(*) INTO v_open FROM public.ia_preparation_checklists c
   WHERE c.engagement_id = p_engagement_id AND COALESCE(c.is_completed, false) = false;
  IF v_open > 0 THEN
    v_reasons := v_reasons || (v_open || ' preparation checklist item(s) still open');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.ia_communication_stages cs
                  WHERE cs.engagement_id = p_engagement_id
                    AND cs.stage_code IN ('ENGAGEMENT_NOTIFICATION','AUDIT_NOTIFICATION')
                    AND cs.delivery_status IN ('Sent','Delivered','Acknowledged'))
    INTO v_notified;
  IF NOT v_notified THEN
    v_reasons := v_reasons || 'Engagement notification must be issued to the auditee before preparation is complete';
  END IF;

  IF array_length(v_reasons, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PREP_INCOMPLETE', 'error', array_to_string(v_reasons, '; '), 'reasons', to_jsonb(v_reasons));
  END IF;

  UPDATE public.ia_audit_engagements
     SET preparation_status = 'Complete',
         preparation_completed_at = now(),
         preparation_completed_by = v_actor,
         preparation_notes = COALESCE(p_notes, preparation_notes),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_engagement_id;

  PERFORM public.ia_log_event('IA.PREPARATION.COMPLETED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id, jsonb_build_object('preparation_status', v_eng.preparation_status),
    jsonb_build_object('preparation_status', 'Complete'), p_notes, NULL, 'ia_complete_preparation');

  RETURN jsonb_build_object('success', true, 'engagement_id', p_engagement_id, 'preparation_status', 'Complete');
END;
$$;

-- ---------------------------------------------------------------
-- 2. FIELDWORK ACTIVITIES
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_assign_activity(
  p_activity_id uuid, p_owner_auditor_id uuid, p_reviewer_auditor_id uuid DEFAULT NULL, p_planned_hours numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_act record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_act FROM public.ia_activities WHERE id = p_activity_id;
  IF v_act IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Activity not found'); END IF;
  IF NOT public.ia_cmd_guard('audit_activities', 'edit', v_act.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to assign this activity');
  END IF;
  IF p_owner_auditor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.ia_auditors WHERE id = p_owner_auditor_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_OWNER', 'error', 'A registered auditor must be assigned as owner');
  END IF;
  IF p_reviewer_auditor_id IS NOT NULL AND p_reviewer_auditor_id = p_owner_auditor_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'Reviewer must be different from the activity owner');
  END IF;

  UPDATE public.ia_activities
     SET owner_auditor_id = p_owner_auditor_id,
         reviewer_auditor_id = p_reviewer_auditor_id,
         planned_hours = COALESCE(p_planned_hours, planned_hours),
         status = CASE WHEN status IN ('Planned', 'Not Started') THEN 'Assigned' ELSE status END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_activity_id;

  PERFORM public.ia_log_event('IA.ACTIVITY.ASSIGNED', 'activity', p_activity_id, v_act.engagement_id, v_act.annual_plan_id,
    jsonb_build_object('owner', v_act.owner_auditor_id), jsonb_build_object('owner', p_owner_auditor_id, 'reviewer', p_reviewer_auditor_id),
    NULL, NULL, 'ia_assign_activity');

  RETURN jsonb_build_object('success', true, 'activity_id', p_activity_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_complete_activity(
  p_activity_id uuid, p_actual_hours numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_act record; v_actor text := public.ia_actor_label(); v_ev int; v_wp int;
BEGIN
  SELECT * INTO v_act FROM public.ia_activities WHERE id = p_activity_id;
  IF v_act IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Activity not found'); END IF;
  IF NOT public.ia_cmd_guard('audit_activities', 'edit', v_act.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to complete this activity');
  END IF;
  IF v_act.owner_auditor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NO_OWNER', 'error', 'Assign an activity owner before completing the activity');
  END IF;

  SELECT count(*) INTO v_ev FROM public.ia_evidence WHERE activity_id = p_activity_id;
  SELECT count(*) INTO v_wp FROM public.ia_working_papers WHERE activity_id = p_activity_id;
  IF v_ev = 0 AND v_wp = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NO_ARTEFACT',
      'error', 'At least one evidence item or working paper must be linked before the activity can be completed');
  END IF;

  UPDATE public.ia_activities
     SET status = 'Completed', actual_hours = COALESCE(p_actual_hours, actual_hours),
         completed_at = now(), completed_by = v_actor, completion_notes = p_notes,
         review_status = CASE WHEN review_status = 'Not Reviewed' THEN 'Pending Review' ELSE review_status END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_activity_id;

  PERFORM public.ia_log_event('IA.ACTIVITY.COMPLETED', 'activity', p_activity_id, v_act.engagement_id, v_act.annual_plan_id,
    jsonb_build_object('status', v_act.status), jsonb_build_object('status', 'Completed', 'evidence', v_ev, 'working_papers', v_wp),
    p_notes, NULL, 'ia_complete_activity');

  RETURN jsonb_build_object('success', true, 'activity_id', p_activity_id, 'evidence_count', v_ev, 'working_paper_count', v_wp);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_review_activity(
  p_activity_id uuid, p_outcome text, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_act record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_act FROM public.ia_activities WHERE id = p_activity_id;
  IF v_act IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Activity not found'); END IF;
  IF p_outcome NOT IN ('Reviewed', 'Rework Required') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_OUTCOME', 'error', 'Outcome must be Reviewed or Rework Required');
  END IF;
  IF NOT public.ia_cmd_guard_elevated('audit_activities', 'review', v_act.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to review this activity');
  END IF;
  IF v_act.status <> 'Completed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_COMPLETED', 'error', 'Only completed activities can be reviewed');
  END IF;
  IF v_act.owner_auditor_id IS NOT NULL
     AND public.ia_auditor_profile(v_act.owner_auditor_id) IS NOT DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'The activity owner cannot review their own work');
  END IF;

  UPDATE public.ia_activities
     SET review_status = p_outcome,
         status = CASE WHEN p_outcome = 'Rework Required' THEN 'In Progress' ELSE status END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_activity_id;

  PERFORM public.ia_log_event('IA.ACTIVITY.REVIEWED', 'activity', p_activity_id, v_act.engagement_id, v_act.annual_plan_id,
    jsonb_build_object('review_status', v_act.review_status), jsonb_build_object('review_status', p_outcome), p_notes, NULL, 'ia_review_activity');

  RETURN jsonb_build_object('success', true, 'activity_id', p_activity_id, 'review_status', p_outcome);
END;
$$;

-- ---------------------------------------------------------------
-- 3. CONTROL TESTING
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_conclude_control_test(
  p_test_id uuid, p_result text, p_conclusion text,
  p_no_finding_rationale text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_t record; v_actor text := public.ia_actor_label(); v_findings int;
BEGIN
  SELECT * INTO v_t FROM public.ia_control_tests WHERE id = p_test_id;
  IF v_t IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Control test not found'); END IF;
  IF NOT public.ia_cmd_guard('control_testing', 'edit', v_t.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to conclude this control test');
  END IF;
  IF COALESCE(trim(p_conclusion), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_CONCLUSION_REQUIRED', 'error', 'A test conclusion is required');
  END IF;

  SELECT count(*) INTO v_findings FROM public.ia_findings WHERE control_test_id = p_test_id;

  IF COALESCE(v_t.exceptions_found, 0) > 0 AND v_findings = 0
     AND COALESCE(trim(p_no_finding_rationale), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_RATIONALE_REQUIRED',
      'error', 'Exceptions were recorded but no finding was raised — a documented rationale is required');
  END IF;

  UPDATE public.ia_control_tests
     SET result = COALESCE(p_result, result), conclusion = p_conclusion,
         no_finding_rationale = p_no_finding_rationale, status = 'Concluded',
         concluded_at = now(), concluded_by = v_actor,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_test_id;

  PERFORM public.ia_log_event('IA.CONTROL_TEST.CONCLUDED', 'control_test', p_test_id, v_t.engagement_id, NULL,
    jsonb_build_object('status', v_t.status, 'result', v_t.result),
    jsonb_build_object('status', 'Concluded', 'result', p_result, 'linked_findings', v_findings),
    p_no_finding_rationale, NULL, 'ia_conclude_control_test');

  RETURN jsonb_build_object('success', true, 'test_id', p_test_id, 'linked_findings', v_findings);
END;
$$;

-- ---------------------------------------------------------------
-- 4. FINDINGS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_change_finding_severity(
  p_finding_id uuid, p_new_severity text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_f record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_f FROM public.ia_findings WHERE id = p_finding_id;
  IF v_f IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Finding not found'); END IF;
  IF NOT public.ia_cmd_guard('audit_findings', 'edit', v_f.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to change this finding');
  END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REASON_REQUIRED', 'error', 'A reason is required to change finding severity');
  END IF;
  IF p_new_severity IS NULL OR p_new_severity NOT IN ('Low','Medium','High','Critical') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_SEVERITY', 'error', 'Severity must be Low, Medium, High or Critical');
  END IF;
  IF v_f.lifecycle_status IN ('Closed','Withdrawn') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FINDING_FINAL', 'error', 'Severity cannot be changed on a closed or withdrawn finding');
  END IF;

  INSERT INTO public.ia_finding_severity_history(finding_id, engagement_id, old_severity, new_severity, reason, changed_by)
  VALUES (p_finding_id, v_f.engagement_id, v_f.severity, p_new_severity, p_reason, v_actor);

  UPDATE public.ia_findings
     SET severity = p_new_severity, risk_rating = p_new_severity,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_finding_id;

  PERFORM public.ia_log_event('IA.FINDING.SEVERITY_CHANGED', 'finding', p_finding_id, v_f.engagement_id, v_f.annual_plan_id,
    jsonb_build_object('severity', v_f.severity), jsonb_build_object('severity', p_new_severity), p_reason, NULL, 'ia_change_finding_severity');

  RETURN jsonb_build_object('success', true, 'finding_id', p_finding_id, 'severity', p_new_severity);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_transition_finding(
  p_finding_id uuid, p_target_status text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_f record; v_actor text := public.ia_actor_label(); v_recs int; v_allowed boolean;
BEGIN
  SELECT * INTO v_f FROM public.ia_findings WHERE id = p_finding_id;
  IF v_f IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Finding not found'); END IF;

  IF p_target_status NOT IN ('Under Review','Confirmed','Released','Responded','Closed','Withdrawn') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_STATUS', 'error', 'Unsupported finding status: ' || p_target_status);
  END IF;

  v_allowed := CASE
    WHEN v_f.lifecycle_status = 'Draft'        AND p_target_status IN ('Under Review','Withdrawn') THEN true
    WHEN v_f.lifecycle_status = 'Under Review' AND p_target_status IN ('Confirmed','Draft','Withdrawn') THEN true
    WHEN v_f.lifecycle_status = 'Confirmed'    AND p_target_status IN ('Released','Withdrawn') THEN true
    WHEN v_f.lifecycle_status = 'Released'     AND p_target_status IN ('Responded','Withdrawn') THEN true
    WHEN v_f.lifecycle_status = 'Responded'    AND p_target_status = 'Closed' THEN true
    ELSE false END;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_TRANSITION',
      'error', format('Finding cannot move from %s to %s', v_f.lifecycle_status, p_target_status));
  END IF;

  IF p_target_status IN ('Confirmed','Released','Closed') THEN
    IF NOT public.ia_cmd_guard_elevated('audit_findings', 'approve', v_f.engagement_id) THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to ' || lower(p_target_status) || ' this finding');
    END IF;
  ELSE
    IF NOT public.ia_cmd_guard('audit_findings', 'edit', v_f.engagement_id) THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to change this finding');
    END IF;
  END IF;

  -- Segregation of duties: the author cannot confirm their own finding.
  IF p_target_status = 'Confirmed' AND v_f.created_by IS NOT NULL AND v_f.created_by = v_actor THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'The finding author cannot confirm their own finding');
  END IF;

  IF p_target_status = 'Released' THEN
    SELECT count(*) INTO v_recs FROM public.ia_recommendations WHERE finding_id = p_finding_id;
    IF v_recs = 0 AND COALESCE(trim(v_f.recommendation), '') = '' THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_NO_RECOMMENDATION',
        'error', 'A recommendation must be recorded before the finding is released to management');
    END IF;
  END IF;

  IF p_target_status = 'Withdrawn' AND COALESCE(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REASON_REQUIRED', 'error', 'A reason is required to withdraw a finding');
  END IF;

  UPDATE public.ia_findings
     SET lifecycle_status = p_target_status,
         status = p_target_status,
         reviewed_by  = CASE WHEN p_target_status = 'Under Review' THEN v_actor ELSE reviewed_by END,
         reviewed_at  = CASE WHEN p_target_status = 'Under Review' THEN now() ELSE reviewed_at END,
         confirmed_by = CASE WHEN p_target_status = 'Confirmed' THEN v_actor ELSE confirmed_by END,
         confirmed_at = CASE WHEN p_target_status = 'Confirmed' THEN now() ELSE confirmed_at END,
         released_by  = CASE WHEN p_target_status = 'Released' THEN v_actor ELSE released_by END,
         released_at  = CASE WHEN p_target_status = 'Released' THEN now() ELSE released_at END,
         withdrawn_by = CASE WHEN p_target_status = 'Withdrawn' THEN v_actor ELSE withdrawn_by END,
         withdrawn_at = CASE WHEN p_target_status = 'Withdrawn' THEN now() ELSE withdrawn_at END,
         withdrawn_reason = CASE WHEN p_target_status = 'Withdrawn' THEN p_reason ELSE withdrawn_reason END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_finding_id;

  PERFORM public.ia_log_event('IA.FINDING.' || upper(replace(p_target_status, ' ', '_')), 'finding', p_finding_id,
    v_f.engagement_id, v_f.annual_plan_id,
    jsonb_build_object('lifecycle_status', v_f.lifecycle_status),
    jsonb_build_object('lifecycle_status', p_target_status), p_reason, NULL, 'ia_transition_finding');

  RETURN jsonb_build_object('success', true, 'finding_id', p_finding_id, 'lifecycle_status', p_target_status);
END;
$$;

-- ---------------------------------------------------------------
-- 5. MANAGEMENT RESPONSES
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_record_management_response(
  p_finding_id uuid, p_management_position text, p_response_text text,
  p_action_plan text DEFAULT NULL, p_responsible_person text DEFAULT NULL,
  p_target_date date DEFAULT NULL, p_rejection_rationale text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  PERFORM public.ia_transition_finding(p_finding_id, 'Responded', 'Management response recorded');

  PERFORM public.ia_log_event('IA.RESPONSE.RECORDED', 'management_response', v_id, v_f.engagement_id, v_f.annual_plan_id,
    NULL, jsonb_build_object('management_position', p_management_position, 'finding_id', p_finding_id),
    p_rejection_rationale, NULL, 'ia_record_management_response');

  RETURN jsonb_build_object('success', true, 'response_id', v_id, 'management_position', p_management_position);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_review_management_response(
  p_response_id uuid, p_outcome text, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_r record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_r FROM public.ia_management_responses WHERE id = p_response_id;
  IF v_r IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Response not found'); END IF;
  IF p_outcome NOT IN ('Accepted','Escalated','Revision Requested') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_OUTCOME', 'error', 'Outcome must be Accepted, Escalated or Revision Requested');
  END IF;
  IF NOT public.ia_cmd_guard_elevated('audit_findings', 'approve', v_r.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to review management responses');
  END IF;
  IF v_r.submitted_by IS NOT NULL AND v_r.submitted_by = v_actor THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'The author of a management response cannot review it');
  END IF;

  UPDATE public.ia_management_responses
     SET review_outcome = p_outcome, reviewed_by = v_actor, reviewed_at = now(),
         accepted_at = CASE WHEN p_outcome = 'Accepted' THEN now() ELSE accepted_at END,
         status = CASE WHEN p_outcome = 'Accepted' THEN 'Accepted'
                       WHEN p_outcome = 'Escalated' THEN 'Escalated' ELSE 'Revision Requested' END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_response_id;

  PERFORM public.ia_log_event('IA.RESPONSE.REVIEWED', 'management_response', p_response_id, v_r.engagement_id, NULL,
    jsonb_build_object('status', v_r.status), jsonb_build_object('review_outcome', p_outcome), p_notes, NULL, 'ia_review_management_response');

  RETURN jsonb_build_object('success', true, 'response_id', p_response_id, 'review_outcome', p_outcome);
END;
$$;

-- ---------------------------------------------------------------
-- 6. ACTION TRACKING
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_extend_action_target(
  p_action_id uuid, p_new_target_date date, p_reason text, p_approved_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Action not found'); END IF;
  IF NOT public.ia_cmd_guard_elevated('action_tracking', 'approve', v_a.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to approve a target date extension');
  END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REASON_REQUIRED', 'error', 'A reason is required to extend a target date');
  END IF;
  IF p_new_target_date IS NULL OR (v_a.current_target_date IS NOT NULL AND p_new_target_date <= v_a.current_target_date) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_DATE', 'error', 'The new target date must be later than the current target date');
  END IF;
  IF v_a.action_status = 'Closed' OR v_a.status = 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ACTION_CLOSED', 'error', 'A closed action cannot be extended');
  END IF;

  INSERT INTO public.ia_action_extensions(action_id, engagement_id, previous_target_date, new_target_date, reason, requested_by, approved_by)
  VALUES (p_action_id, v_a.engagement_id, v_a.current_target_date, p_new_target_date, p_reason, v_a.responsible_person, COALESCE(p_approved_by, v_actor));

  UPDATE public.ia_action_tracking
     SET original_target_date = COALESCE(original_target_date, target_date, current_target_date),
         current_target_date = p_new_target_date,
         target_date = p_new_target_date,
         extension_count = extension_count + 1,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.EXTENDED', 'action', p_action_id, v_a.engagement_id, NULL,
    jsonb_build_object('target_date', v_a.current_target_date), jsonb_build_object('target_date', p_new_target_date),
    p_reason, NULL, 'ia_extend_action_target');

  RETURN jsonb_build_object('success', true, 'action_id', p_action_id, 'new_target_date', p_new_target_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_close_action(
  p_action_id uuid, p_closure_notes text, p_evidence_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  UPDATE public.ia_action_tracking
     SET action_status = 'Closed', status = 'Closed',
         evidence_ids = v_ev, closure_notes = p_closure_notes,
         closure_verified_by = v_actor, closure_verified_at = now(),
         verified_by = v_actor, verified_date = now(), verification_date = now(),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.CLOSED', 'action', p_action_id, v_a.engagement_id, NULL,
    jsonb_build_object('status', v_a.status), jsonb_build_object('status', 'Closed', 'evidence_count', array_length(v_ev, 1)),
    p_closure_notes, NULL, 'ia_close_action');

  RETURN jsonb_build_object('success', true, 'action_id', p_action_id);
END;
$$;

-- ---------------------------------------------------------------
-- 7. QUALITY ASSURANCE
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_start_quality_review(
  p_engagement_id uuid, p_review_type text DEFAULT 'Engagement QA')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_actor text := public.ia_actor_label(); v_id uuid; v_open int;
BEGIN
  IF NOT public.ia_cmd_guard_elevated('quality_review', 'create', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to start a quality review');
  END IF;

  SELECT count(*) INTO v_open FROM public.ia_quality_reviews
   WHERE engagement_id = p_engagement_id AND status IN ('Draft','In Progress','Rework Required');
  IF v_open > 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_QA_IN_PROGRESS', 'error', 'A quality review is already in progress for this engagement');
  END IF;

  INSERT INTO public.ia_quality_reviews(engagement_id, reviewer_id, review_date, review_type, status, created_by, updated_by)
  VALUES (p_engagement_id, public.ia_current_auditor_id(), now(), p_review_type, 'In Progress', v_actor, v_actor)
  RETURNING id INTO v_id;

  PERFORM public.ia_log_event('IA.QA.STARTED', 'quality_review', v_id, p_engagement_id, NULL, NULL,
    jsonb_build_object('review_type', p_review_type), NULL, NULL, 'ia_start_quality_review');

  RETURN jsonb_build_object('success', true, 'quality_review_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_conclude_quality_review(
  p_review_id uuid, p_outcome text, p_quality_rating text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_q record; v_eng record; v_actor text := public.ia_actor_label(); v_open int;
BEGIN
  SELECT * INTO v_q FROM public.ia_quality_reviews WHERE id = p_review_id;
  IF v_q IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Quality review not found'); END IF;
  IF p_outcome NOT IN ('Cleared','Rework Required') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_OUTCOME', 'error', 'Outcome must be Cleared or Rework Required');
  END IF;
  IF NOT public.ia_cmd_guard_elevated('quality_review', 'approve', v_q.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to conclude a quality review');
  END IF;

  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = v_q.engagement_id;
  IF v_eng.lead_auditor_id IS NOT NULL
     AND public.ia_auditor_profile(v_eng.lead_auditor_id) IS NOT DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'The engagement lead auditor cannot clear quality assurance on their own engagement');
  END IF;

  IF p_outcome = 'Cleared' THEN
    SELECT count(*) INTO v_open FROM public.ia_findings
     WHERE engagement_id = v_q.engagement_id AND lifecycle_status IN ('Draft','Under Review');
    IF v_open > 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_FINDINGS_OPEN',
        'error', v_open || ' finding(s) are still in draft or under review — quality assurance cannot be cleared');
    END IF;
    IF COALESCE(trim(p_quality_rating), '') = '' THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_RATING_REQUIRED', 'error', 'A quality rating is required to clear a review');
    END IF;
  ELSIF COALESCE(trim(p_notes), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOTES_REQUIRED', 'error', 'Rework notes are required');
  END IF;

  UPDATE public.ia_quality_reviews
     SET status = p_outcome,
         final_disposition = p_outcome,
         quality_rating = COALESCE(p_quality_rating, quality_rating),
         required_rework = (p_outcome = 'Rework Required'),
         rework_notes = CASE WHEN p_outcome = 'Rework Required' THEN p_notes ELSE rework_notes END,
         observations = COALESCE(p_notes, observations),
         cleared_at = CASE WHEN p_outcome = 'Cleared' THEN now() ELSE NULL END,
         cleared_by = CASE WHEN p_outcome = 'Cleared' THEN v_actor ELSE NULL END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_review_id;

  PERFORM public.ia_log_event('IA.QA.' || CASE WHEN p_outcome = 'Cleared' THEN 'CLEARED' ELSE 'REWORK_REQUIRED' END,
    'quality_review', p_review_id, v_q.engagement_id, NULL,
    jsonb_build_object('status', v_q.status), jsonb_build_object('status', p_outcome), p_notes, NULL, 'ia_conclude_quality_review');

  RETURN jsonb_build_object('success', true, 'quality_review_id', p_review_id, 'status', p_outcome);
END;
$$;

-- ---------------------------------------------------------------
-- 8. REPORTING
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_create_report_version(
  p_report_id uuid, p_content jsonb DEFAULT '{}'::jsonb,
  p_change_summary text DEFAULT NULL, p_version_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_rep record; v_actor text := public.ia_actor_label(); v_next int; v_id uuid;
BEGIN
  SELECT * INTO v_rep FROM public.ia_audit_reports WHERE id = p_report_id;
  IF v_rep IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Report not found'); END IF;
  IF NOT public.ia_cmd_guard('audit_reports', 'edit', v_rep.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to edit this report');
  END IF;
  IF v_rep.issued_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REPORT_ISSUED', 'error', 'An issued report cannot be re-versioned; raise a new report instead');
  END IF;

  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next FROM public.ia_report_versions WHERE report_id = p_report_id;

  INSERT INTO public.ia_report_versions(report_id, engagement_id, version_number, version_label, status, content, content_hash, change_summary, created_by, updated_by)
  VALUES (p_report_id, v_rep.engagement_id, v_next, COALESCE(p_version_label, 'v' || v_next), 'Draft',
          COALESCE(p_content, '{}'::jsonb), md5(COALESCE(p_content, '{}'::jsonb)::text), p_change_summary, v_actor, v_actor)
  RETURNING id INTO v_id;

  UPDATE public.ia_audit_reports SET current_version_number = v_next, updated_at = now(), updated_by = v_actor WHERE id = p_report_id;

  PERFORM public.ia_log_event('IA.REPORT.VERSION_CREATED', 'audit_report', p_report_id, v_rep.engagement_id, v_rep.plan_id,
    NULL, jsonb_build_object('version_number', v_next), p_change_summary, NULL, 'ia_create_report_version');

  RETURN jsonb_build_object('success', true, 'report_id', p_report_id, 'version_id', v_id, 'version_number', v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_issue_report(p_report_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rep record; v_actor text := public.ia_actor_label(); v_gate jsonb;
  v_qa record; v_version record;
BEGIN
  SELECT * INTO v_rep FROM public.ia_audit_reports WHERE id = p_report_id;
  IF v_rep IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Report not found'); END IF;
  IF NOT public.ia_cmd_guard_elevated('audit_reports', 'approve', v_rep.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to issue audit reports');
  END IF;
  IF v_rep.issued_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ALREADY_ISSUED', 'error', 'This report has already been issued');
  END IF;

  SELECT * INTO v_version FROM public.ia_report_versions
   WHERE report_id = p_report_id ORDER BY version_number DESC LIMIT 1;
  IF v_version IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NO_VERSION', 'error', 'Create a report version before issuing the report');
  END IF;

  SELECT * INTO v_qa FROM public.ia_quality_reviews
   WHERE engagement_id = v_rep.engagement_id AND status = 'Cleared'
   ORDER BY cleared_at DESC NULLS LAST LIMIT 1;
  IF v_qa IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_QA_NOT_CLEARED',
      'error', 'Quality assurance must be cleared before the report can be issued');
  END IF;

  v_gate := public.ia_can_issue_report(p_report_id);
  IF NOT COALESCE((v_gate->>'can_issue')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_GATE_BLOCKED', 'error', 'Report issuance gate not satisfied', 'gate', v_gate);
  END IF;

  UPDATE public.ia_report_versions
     SET status = 'Issued', is_issued = true, issued_at = now(), issued_by = v_actor, updated_by = v_actor
   WHERE id = v_version.id;

  UPDATE public.ia_audit_reports
     SET status = 'Issued', issued_at = now(), issued_by = v_actor,
         qa_review_id = v_qa.id, approved_by = COALESCE(approved_by, v_actor), approved_on = now(),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_report_id;

  PERFORM public.ia_log_event('IA.REPORT.ISSUED', 'audit_report', p_report_id, v_rep.engagement_id, v_rep.plan_id,
    jsonb_build_object('status', v_rep.status),
    jsonb_build_object('status', 'Issued', 'version_number', v_version.version_number, 'qa_review_id', v_qa.id),
    p_notes, NULL, 'ia_issue_report');

  RETURN jsonb_build_object('success', true, 'report_id', p_report_id, 'version_number', v_version.version_number);
END;
$$;

-- ---------------------------------------------------------------
-- 9. CLOSURE READINESS (extends Wave 1 evaluation)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_evaluate_engagement_closure_v2(p_engagement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reasons text[] := '{}';
  v_n int;
BEGIN
  IF NOT public.ia_can_access_engagement(p_engagement_id) THEN
    RETURN jsonb_build_object('can_close', false, 'reasons', to_jsonb(ARRAY['You do not have access to this engagement']));
  END IF;

  SELECT count(*) INTO v_n FROM public.ia_audit_reports
   WHERE engagement_id = p_engagement_id AND issued_at IS NOT NULL;
  IF v_n = 0 THEN v_reasons := v_reasons || 'A final audit report must be issued'; END IF;

  SELECT count(*) INTO v_n FROM public.ia_quality_reviews
   WHERE engagement_id = p_engagement_id AND status = 'Cleared';
  IF v_n = 0 THEN v_reasons := v_reasons || 'Quality assurance must be cleared'; END IF;

  SELECT count(*) INTO v_n FROM public.ia_findings
   WHERE engagement_id = p_engagement_id AND lifecycle_status NOT IN ('Responded','Closed','Withdrawn');
  IF v_n > 0 THEN v_reasons := v_reasons || (v_n || ' finding(s) are not yet responded to, closed or withdrawn'); END IF;

  SELECT count(*) INTO v_n FROM public.ia_action_tracking
   WHERE engagement_id = p_engagement_id
     AND COALESCE(status, action_status) <> 'Closed'
     AND (COALESCE(trim(responsible_person), '') = '' OR COALESCE(current_target_date, target_date) IS NULL);
  IF v_n > 0 THEN v_reasons := v_reasons || (v_n || ' open action(s) are missing an owner or a target date'); END IF;

  SELECT count(*) INTO v_n FROM public.ia_activities
   WHERE engagement_id = p_engagement_id AND status NOT IN ('Completed','Cancelled');
  IF v_n > 0 THEN v_reasons := v_reasons || (v_n || ' fieldwork activity(ies) are not complete'); END IF;

  RETURN jsonb_build_object(
    'can_close', array_length(v_reasons, 1) IS NULL,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now()
  );
END;
$$;

-- ---------------------------------------------------------------
-- 10. GRANTS — authenticated only, never anon
-- ---------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'ia_complete_preparation','ia_assign_activity','ia_complete_activity','ia_review_activity',
         'ia_conclude_control_test','ia_change_finding_severity','ia_transition_finding',
         'ia_record_management_response','ia_review_management_response','ia_extend_action_target',
         'ia_close_action','ia_start_quality_review','ia_conclude_quality_review',
         'ia_create_report_version','ia_issue_report','ia_evaluate_engagement_closure_v2',
         'ia_guard_engagement_auditor_refs','ia_report_version_immutable')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END;
$$;

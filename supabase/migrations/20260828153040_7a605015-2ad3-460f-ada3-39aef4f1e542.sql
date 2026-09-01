-- DEF-S1B-10: Annual audit plan submission and approval were performed by direct client-side
-- table updates, with no permission enforcement, no readiness gate, no segregation of duties and
-- no immutable audit event. Replace with governed SECURITY DEFINER commands.

CREATE OR REPLACE FUNCTION public.ia_annual_plan_readiness(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan record;
  v_blockers jsonb := '[]'::jsonb;
  v_count int;
BEGIN
  SELECT * INTO v_plan FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'blockers', jsonb_build_array('Annual plan not found'));
  END IF;

  IF NULLIF(trim(COALESCE(v_plan.fiscal_year::text, '')), '') IS NULL THEN
    v_blockers := v_blockers || to_jsonb('Fiscal year is not set'::text);
  END IF;
  IF NULLIF(trim(COALESCE(v_plan.title, '')), '') IS NULL THEN
    v_blockers := v_blockers || to_jsonb('Plan title is not set'::text);
  END IF;
  IF COALESCE(NULLIF(trim(COALESCE(v_plan.executive_summary, '')), ''),
              NULLIF(trim(COALESCE(v_plan.objective, '')), ''),
              NULLIF(trim(COALESCE(v_plan.methodology, '')), ''),
              NULLIF(trim(COALESCE(v_plan.planning_assumptions, '')), '')) IS NULL THEN
    v_blockers := v_blockers || to_jsonb('Planning narrative is incomplete (executive summary, objective, methodology or assumptions)'::text);
  END IF;

  SELECT count(*) INTO v_count FROM ia_audit_engagements
   WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true);
  IF v_count = 0 THEN
    v_blockers := v_blockers || to_jsonb('The plan has no active audits'::text);
  END IF;

  SELECT count(*) INTO v_count FROM ia_audit_engagements
   WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true) AND department_id IS NULL;
  IF v_count > 0 THEN
    v_blockers := v_blockers || to_jsonb(v_count || ' audit(s) have no department'::text);
  END IF;

  SELECT count(*) INTO v_count FROM ia_audit_engagements
   WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true) AND function_id IS NULL;
  IF v_count > 0 THEN
    v_blockers := v_blockers || to_jsonb(v_count || ' audit(s) have no business function'::text);
  END IF;

  SELECT count(*) INTO v_count FROM ia_audit_engagements
   WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true) AND lead_auditor_id IS NULL;
  IF v_count > 0 THEN
    v_blockers := v_blockers || to_jsonb(v_count || ' audit(s) have no lead auditor'::text);
  END IF;

  SELECT count(*) INTO v_count FROM ia_audit_engagements
   WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true)
     AND planned_start_date IS NULL AND quarter IS NULL;
  IF v_count > 0 THEN
    v_blockers := v_blockers || to_jsonb(v_count || ' audit(s) have no schedule'::text);
  END IF;

  SELECT count(*) INTO v_count FROM ia_audit_engagements
   WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true)
     AND COALESCE(estimated_days, 0) = 0 AND COALESCE(estimated_hours, 0) = 0;
  IF v_count > 0 THEN
    v_blockers := v_blockers || to_jsonb(v_count || ' audit(s) have no estimated effort'::text);
  END IF;

  SELECT count(*) INTO v_count FROM ia_audit_engagements
   WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true)
     AND reviewer_id IS NOT NULL AND reviewer_id = lead_auditor_id;
  IF v_count > 0 THEN
    v_blockers := v_blockers || to_jsonb(v_count || ' audit(s) have the same auditor as lead and reviewer (segregation of duties)'::text);
  END IF;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'status', v_plan.status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_submit_annual_plan(p_plan_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor text := public.ia_actor_label();
  v_plan record;
  v_readiness jsonb;
  v_version int;
  v_version_id uuid;
BEGIN
  IF NOT public.ia_actor_can('audit_plans', 'submit') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to submit annual audit plans');
  END IF;

  SELECT * INTO v_plan FROM ia_annual_plans WHERE id = p_plan_id FOR UPDATE;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Annual plan not found');
  END IF;
  IF COALESCE(v_plan.status, 'Draft') NOT IN ('Draft', 'Rejected', 'Changes Requested', 'Amendment Pending') THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Plan must be in Draft, Rejected, Changes Requested or Amendment Pending status to submit (currently ' || v_plan.status || ')');
  END IF;

  v_readiness := public.ia_annual_plan_readiness(p_plan_id);
  IF NOT (v_readiness->>'ready')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan readiness checks failed', 'blockers', v_readiness->'blockers');
  END IF;

  v_version := COALESCE(v_plan.current_version_number, 0) + 1;

  INSERT INTO ia_plan_versions (plan_id, version_number, snapshot_data, status_at_snapshot, change_summary, created_by)
  VALUES (p_plan_id, v_version, to_jsonb(v_plan), v_plan.status,
          COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), 'Submitted for approval'), v_actor)
  RETURNING id INTO v_version_id;

  INSERT INTO ia_plan_version_engagements (plan_version_id, engagement_id, engagement_snapshot, change_type)
  SELECT v_version_id, e.id, to_jsonb(e), CASE WHEN v_version = 1 THEN 'added' ELSE 'inherited' END
    FROM ia_audit_engagements e
   WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true);

  UPDATE ia_annual_plans
     SET status = 'Submitted',
         submitted_by = v_actor,
         submitted_date = now(),
         current_workflow_step = 'submitted',
         current_version_number = v_version,
         is_locked = true,
         approval_comments = NULL,
         updated_at = now(),
         updated_by = v_actor
   WHERE id = p_plan_id;

  UPDATE ia_audit_engagements
     SET approved_by = NULL, approved_at = NULL, approved_plan_version = NULL,
         updated_at = now(), updated_by = v_actor
   WHERE annual_plan_id = p_plan_id;

  INSERT INTO ia_approval_actions (entity_type, entity_id, action, performed_by, comments)
  VALUES ('annual_plan', p_plan_id, 'Submitted', v_actor, p_notes);

  PERFORM public.ia_log_event('PLAN_SUBMITTED', 'ia_annual_plan', p_plan_id, NULL, p_plan_id,
    jsonb_build_object('status', v_plan.status),
    jsonb_build_object('status', 'Submitted', 'version_number', v_version),
    p_notes, NULL, 'ia_submit_annual_plan');

  RETURN jsonb_build_object('success', true, 'status', 'Submitted', 'version_number', v_version,
    'plan_version_id', v_version_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_decide_annual_plan(
  p_plan_id uuid,
  p_decision text,
  p_comments text DEFAULT NULL,
  p_committee_name text DEFAULT NULL,
  p_minutes_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor text := public.ia_actor_label();
  v_uid uuid := auth.uid();
  v_plan record;
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_new_status text;
  v_is_admin boolean := false;
  v_self_review boolean := false;
  v_superseded int := 0;
  v_old record;
BEGIN
  IF v_decision NOT IN ('approve', 'reject', 'changes_requested') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Decision must be approve, reject or changes_requested');
  END IF;

  IF v_decision = 'approve' THEN
    IF NOT public.ia_actor_can('plan_approval', 'approve') THEN
      RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to approve annual audit plans');
    END IF;
  ELSE
    IF NOT public.ia_actor_can('plan_approval', 'reject') THEN
      RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to return or reject annual audit plans');
    END IF;
  END IF;

  IF v_decision <> 'approve' AND NULLIF(trim(COALESCE(p_comments, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comments are required when rejecting or returning a plan');
  END IF;

  SELECT * INTO v_plan FROM ia_annual_plans WHERE id = p_plan_id FOR UPDATE;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Annual plan not found');
  END IF;
  IF COALESCE(v_plan.status, 'Draft') NOT IN ('Submitted', 'Under Review', 'Pending Revision Approval') THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Only a submitted plan can be decided (currently ' || COALESCE(v_plan.status, 'Draft') || ')');
  END IF;

  -- Segregation of duties: the submitter/preparer may not decide their own plan.
  v_is_admin := v_uid IS NOT NULL AND public.has_role(v_uid, 'Admin'::app_role);
  v_self_review := v_actor IS NOT NULL
    AND (v_actor = COALESCE(v_plan.submitted_by, '') OR v_actor = COALESCE(v_plan.created_by, ''));

  IF v_self_review AND NOT v_is_admin THEN
    PERFORM public.ia_log_event('PLAN_DECISION_BLOCKED_SOD', 'ia_annual_plan', p_plan_id, NULL, p_plan_id,
      NULL, jsonb_build_object('decision', v_decision, 'actor', v_actor),
      'Segregation of duties: preparer cannot decide their own plan', NULL, 'ia_decide_annual_plan');
    RETURN jsonb_build_object('success', false, 'error',
      'Segregation of duties: the person who prepared or submitted this plan cannot approve or reject it');
  END IF;

  v_new_status := CASE v_decision
    WHEN 'approve' THEN 'Approved'
    WHEN 'reject' THEN 'Rejected'
    ELSE 'Changes Requested' END;

  IF v_decision = 'approve' THEN
    FOR v_old IN
      SELECT id FROM ia_annual_plans
       WHERE fiscal_year = v_plan.fiscal_year AND status = 'Approved' AND id <> p_plan_id
    LOOP
      UPDATE ia_annual_plans SET status = 'Superseded', updated_at = now(), updated_by = v_actor
       WHERE id = v_old.id;
      INSERT INTO ia_approval_actions (entity_type, entity_id, action, performed_by, comments)
      VALUES ('annual_plan', v_old.id, 'Superseded', v_actor, 'Superseded by approval of plan ' || p_plan_id);
      PERFORM public.ia_log_event('PLAN_SUPERSEDED', 'ia_annual_plan', v_old.id, NULL, v_old.id,
        NULL, jsonb_build_object('superseded_by', p_plan_id), NULL, NULL, 'ia_decide_annual_plan');
      v_superseded := v_superseded + 1;
    END LOOP;

    UPDATE ia_annual_plans
       SET status = 'Approved',
           approved_by = v_actor,
           approved_date = now(),
           approval_comments = p_comments,
           internally_approved = true,
           internally_approved_by = v_actor,
           internally_approved_date = now(),
           board_committee_name = COALESCE(NULLIF(trim(COALESCE(p_committee_name, '')), ''), board_committee_name),
           minutes_reference = COALESCE(NULLIF(trim(COALESCE(p_minutes_reference, '')), ''), minutes_reference),
           current_workflow_step = 'approved',
           is_locked = true,
           reviewed_by = v_actor,
           reviewed_date = now(),
           updated_at = now(),
           updated_by = v_actor
     WHERE id = p_plan_id;

    UPDATE ia_audit_engagements
       SET approved_by = v_actor,
           approved_at = now(),
           approved_plan_version = v_plan.current_version_number,
           updated_at = now(),
           updated_by = v_actor
     WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true);
  ELSE
    UPDATE ia_annual_plans
       SET status = v_new_status,
           rejected_by = CASE WHEN v_decision = 'reject' THEN v_actor ELSE rejected_by END,
           rejected_at = CASE WHEN v_decision = 'reject' THEN now() ELSE rejected_at END,
           approval_comments = p_comments,
           current_workflow_step = CASE WHEN v_decision = 'reject' THEN 'rejected' ELSE 'changes_requested' END,
           is_locked = false,
           reviewed_by = v_actor,
           reviewed_date = now(),
           updated_at = now(),
           updated_by = v_actor
     WHERE id = p_plan_id;

    UPDATE ia_audit_engagements
       SET approved_by = NULL, approved_at = NULL, approved_plan_version = NULL,
           updated_at = now(), updated_by = v_actor
     WHERE annual_plan_id = p_plan_id;
  END IF;

  INSERT INTO ia_approval_actions (entity_type, entity_id, action, performed_by, comments)
  VALUES ('annual_plan', p_plan_id, v_new_status, v_actor, p_comments);

  PERFORM public.ia_log_event(
    CASE v_decision WHEN 'approve' THEN 'PLAN_APPROVED' WHEN 'reject' THEN 'PLAN_REJECTED' ELSE 'PLAN_CHANGES_REQUESTED' END,
    'ia_annual_plan', p_plan_id, NULL, p_plan_id,
    jsonb_build_object('status', v_plan.status),
    jsonb_build_object('status', v_new_status, 'version_number', v_plan.current_version_number,
                       'sod_admin_override', v_self_review AND v_is_admin),
    p_comments, NULL, 'ia_decide_annual_plan');

  RETURN jsonb_build_object('success', true, 'status', v_new_status,
    'version_number', v_plan.current_version_number,
    'superseded_plans', v_superseded,
    'sod_admin_override', v_self_review AND v_is_admin);
END;
$function$;

REVOKE ALL ON FUNCTION public.ia_annual_plan_readiness(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_submit_annual_plan(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_decide_annual_plan(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_annual_plan_readiness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_submit_annual_plan(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_decide_annual_plan(uuid, text, text, text, text) TO authenticated;
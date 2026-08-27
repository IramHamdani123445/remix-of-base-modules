-- Actor helpers -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_actor_can(_module text, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.get_user_permissions(auth.uid()) p
        WHERE p.module_name = _module
          AND p.action_name = _action
          AND COALESCE(p.is_granted, true)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.ia_actor_label()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), 'SYSTEM');
$$;

GRANT EXECUTE ON FUNCTION public.ia_actor_can(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_actor_label() TO authenticated;

ALTER TABLE public.ia_annual_plans ADD COLUMN IF NOT EXISTS closure_summary jsonb;

-- Engagement (department audit) closure gate ---------------------------------
CREATE OR REPLACE FUNCTION public.ia_evaluate_engagement_closure(p_engagement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exec_status text;
  v_status text;
  v_blockers jsonb := '[]'::jsonb;
  v_open_activities int;
  v_draft_findings int;
  v_findings_wo_response int;
  v_report_issued int;
  v_qa_ok int;
  v_open_actions int;
  v_open_followups int;
BEGIN
  SELECT execution_status, status INTO v_exec_status, v_status
  FROM ia_audit_engagements WHERE id = p_engagement_id;

  IF v_exec_status IS NULL AND v_status IS NULL THEN
    RETURN jsonb_build_object('found', false, 'can_close', false,
      'blockers', jsonb_build_array(jsonb_build_object('code','not_found','message','Audit not found')));
  END IF;

  SELECT count(*) INTO v_open_activities FROM ia_activities
   WHERE engagement_id = p_engagement_id
     AND COALESCE(status,'Planned') NOT IN ('Completed','Cancelled','Not Applicable');

  SELECT count(*) INTO v_draft_findings FROM ia_findings
   WHERE engagement_id = p_engagement_id
     AND COALESCE(status,'Draft') IN ('Draft','Under Review');

  SELECT count(*) INTO v_findings_wo_response FROM ia_findings f
   WHERE f.engagement_id = p_engagement_id
     AND NOT EXISTS (SELECT 1 FROM ia_management_responses r WHERE r.finding_id = f.id);

  SELECT count(*) INTO v_report_issued FROM ia_audit_reports
   WHERE engagement_id = p_engagement_id
     AND (status = 'Issued' OR issued_at IS NOT NULL);

  SELECT count(*) INTO v_qa_ok FROM ia_quality_reviews
   WHERE engagement_id = p_engagement_id
     AND COALESCE(is_active, true)
     AND COALESCE(required_rework, false) = false
     AND COALESCE(final_disposition,'') IN ('Approved','Accepted','Passed','Signed Off','Cleared');

  SELECT count(*) INTO v_open_actions FROM ia_action_tracking
   WHERE engagement_id = p_engagement_id
     AND COALESCE(status,'Open') NOT IN ('Closed','Cancelled');

  SELECT count(*) INTO v_open_followups FROM ia_follow_ups
   WHERE engagement_id = p_engagement_id
     AND COALESCE(status,'Open') NOT IN ('Resolved','Closed','Cancelled');

  IF v_exec_status IN ('Closed','Closed – Actions Pending') THEN
    v_blockers := v_blockers || jsonb_build_object('code','already_closed','message','Audit is already closed');
  END IF;
  IF v_open_activities > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','activities_open',
      'message', v_open_activities || ' audit activity(ies) are not completed', 'count', v_open_activities);
  END IF;
  IF v_draft_findings > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','findings_draft',
      'message', v_draft_findings || ' finding(s) still in Draft or Under Review', 'count', v_draft_findings);
  END IF;
  IF v_findings_wo_response > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','findings_without_response',
      'message', v_findings_wo_response || ' finding(s) have no management response', 'count', v_findings_wo_response);
  END IF;
  IF v_report_issued = 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','report_not_issued',
      'message','The audit report has not been issued');
  END IF;
  IF v_qa_ok = 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','quality_review_pending',
      'message','Quality review has not been signed off');
  END IF;

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
$$;

GRANT EXECUTE ON FUNCTION public.ia_evaluate_engagement_closure(uuid) TO authenticated;

-- Engagement closure command -------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_close_engagement(
  p_engagement_id uuid,
  p_disposition text DEFAULT 'Closed',
  p_final_rating text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate jsonb;
  v_actor text := public.ia_actor_label();
  v_old text;
BEGIN
  IF NOT public.ia_actor_can('audit_engagements','close') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to close audits');
  END IF;

  IF p_disposition NOT IN ('Closed','Closed – Actions Pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid disposition: ' || COALESCE(p_disposition,'NULL'));
  END IF;

  v_gate := public.ia_evaluate_engagement_closure(p_engagement_id);

  IF NOT (v_gate->>'found')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'Audit not found');
  END IF;

  IF NOT (v_gate->>'can_close')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'Closure requirements are not met',
      'blockers', v_gate->'blockers');
  END IF;

  IF p_disposition = 'Closed'
     AND ((v_gate->>'open_actions')::int > 0 OR (v_gate->>'open_follow_ups')::int > 0) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Corrective actions or follow-ups are still open — close as "Closed – Actions Pending"',
      'suggested_disposition', 'Closed – Actions Pending');
  END IF;

  v_old := v_gate->>'execution_status';

  UPDATE ia_audit_engagements SET
    execution_status = p_disposition,
    status = 'Closed',
    closure_date = now()::date,
    closed_by = v_actor,
    closure_notes = p_notes,
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_engagement_id;

  UPDATE ia_department_audits SET
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
  WHERE id = (SELECT department_audit_id FROM ia_audit_engagements WHERE id = p_engagement_id);

  INSERT INTO ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_CLOSED',
    COALESCE(p_notes, 'Audit closed'), COALESCE(v_old,'Unknown'), p_disposition, v_actor);

  RETURN jsonb_build_object('success', true, 'disposition', p_disposition, 'closed_by', v_actor);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ia_close_engagement(uuid, text, text, text) TO authenticated;

-- Annual plan closure gate ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_evaluate_plan_closure(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_items jsonb;
  v_pending int;
BEGIN
  SELECT status INTO v_status FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('found', false, 'can_close', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'engagement_id', e.id,
           'engagement_code', e.engagement_code,
           'engagement_name', e.engagement_name,
           'execution_status', COALESCE(e.execution_status,'Planned'),
           'status', e.status,
           'disposition_required',
             COALESCE(e.execution_status,'Planned') NOT IN ('Closed','Closed – Actions Pending','Cancelled'),
           'untouched', COALESCE(e.execution_status,'Planned') IN ('Planned','Ready for Launch')
         ) ORDER BY e.engagement_code), '[]'::jsonb)
    INTO v_items
    FROM ia_audit_engagements e
   WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true);

  SELECT count(*) INTO v_pending
    FROM jsonb_array_elements(v_items) x
   WHERE (x->>'disposition_required')::boolean;

  RETURN jsonb_build_object(
    'found', true,
    'plan_status', v_status,
    'already_closed', v_status = 'Closed',
    'can_close', v_status <> 'Closed' AND v_pending = 0,
    'pending_count', v_pending,
    'engagements', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ia_evaluate_plan_closure(uuid) TO authenticated;

-- Annual plan closure command ------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_close_annual_plan(
  p_plan_id uuid,
  p_dispositions jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor text := public.ia_actor_label();
  v_plan_status text;
  v_fiscal_year text;
  v_item jsonb;
  v_eng record;
  v_disposition text;
  v_reason text;
  v_errors jsonb := '[]'::jsonb;
  v_planned int := 0;
  v_completed int := 0;
  v_carried int := 0;
  v_cancelled int := 0;
  v_gate jsonb;
BEGIN
  IF NOT public.ia_actor_can('plan_closeout','close') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to close annual plans');
  END IF;

  SELECT status, fiscal_year INTO v_plan_status, v_fiscal_year FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Annual plan not found');
  END IF;
  IF v_plan_status = 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Annual plan is already closed');
  END IF;

  -- Apply supplied dispositions to in-flight audits
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_dispositions,'[]'::jsonb))
  LOOP
    v_disposition := v_item->>'disposition';
    v_reason := NULLIF(trim(COALESCE(v_item->>'reason','')), '');

    SELECT * INTO v_eng FROM ia_audit_engagements
     WHERE id = (v_item->>'engagement_id')::uuid AND annual_plan_id = p_plan_id;

    IF v_eng.id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('engagement_id', v_item->>'engagement_id',
        'message','Audit does not belong to this plan');
      CONTINUE;
    END IF;

    IF COALESCE(v_eng.execution_status,'Planned') IN ('Closed','Closed – Actions Pending','Cancelled') THEN
      CONTINUE;
    END IF;

    IF v_disposition = 'Cancelled' THEN
      IF v_reason IS NULL THEN
        v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
          'message','Cancellation reason is required for ' || COALESCE(v_eng.engagement_code, v_eng.engagement_name));
        CONTINUE;
      END IF;
      UPDATE ia_audit_engagements SET execution_status = 'Cancelled', status = 'Cancelled',
             execution_notes = v_reason, updated_at = now(), updated_by = v_actor
       WHERE id = v_eng.id;
      INSERT INTO ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
      VALUES (v_eng.id, 'ENGAGEMENT_CANCELLED', v_reason, COALESCE(v_eng.execution_status,'Planned'), 'Cancelled', v_actor);

    ELSIF v_disposition = 'Carried Forward' THEN
      IF v_reason IS NULL THEN
        v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
          'message','Carry-forward reason is required for ' || COALESCE(v_eng.engagement_code, v_eng.engagement_name));
        CONTINUE;
      END IF;
      INSERT INTO ia_plan_carry_forward (annual_plan_id, source_type, source_id, source_reference,
        description, priority, status, carried_by, original_engagement_id)
      VALUES (p_plan_id, 'ENGAGEMENT', v_eng.id, COALESCE(v_eng.engagement_code, v_eng.engagement_name),
        v_reason, COALESCE(v_eng.engagement_risk_rating,'Medium'), 'Open', v_actor, v_eng.id);
      UPDATE ia_audit_engagements SET execution_status = 'Carried Forward', status = 'Carried Forward',
             execution_notes = v_reason, updated_at = now(), updated_by = v_actor
       WHERE id = v_eng.id;
      INSERT INTO ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
      VALUES (v_eng.id, 'ENGAGEMENT_CARRIED_FORWARD', v_reason, COALESCE(v_eng.execution_status,'Planned'), 'Carried Forward', v_actor);

    ELSE
      v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
        'message','Unsupported disposition "' || COALESCE(v_disposition,'NULL') || '" — close the audit from its own workspace');
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Some dispositions could not be applied', 'issues', v_errors);
  END IF;

  -- Re-evaluate remaining audits
  FOR v_eng IN
    SELECT id, engagement_code, engagement_name, execution_status
      FROM ia_audit_engagements
     WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true)
  LOOP
    v_planned := v_planned + 1;
    IF COALESCE(v_eng.execution_status,'Planned') IN ('Closed','Closed – Actions Pending') THEN
      v_completed := v_completed + 1;
    ELSIF v_eng.execution_status = 'Carried Forward' THEN
      v_carried := v_carried + 1;
    ELSIF v_eng.execution_status = 'Cancelled' THEN
      v_cancelled := v_cancelled + 1;
    ELSE
      v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
        'message', COALESCE(v_eng.engagement_code, v_eng.engagement_name) || ' has no disposition (current: '
                   || COALESCE(v_eng.execution_status,'Planned') || ')');
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Every audit in the plan needs a disposition before closure',
      'issues', v_errors);
  END IF;

  v_gate := jsonb_build_object(
    'planned', v_planned,
    'completed', v_completed,
    'carried_forward', v_carried,
    'cancelled', v_cancelled,
    'completion_rate', CASE WHEN v_planned = 0 THEN 0
                            ELSE round((v_completed::numeric / v_planned) * 100, 1) END,
    'closed_by', v_actor,
    'closed_at', now(),
    'notes', p_notes
  );

  UPDATE ia_annual_plans SET
    status = 'Closed',
    closed_by = v_actor,
    closed_date = now()::date,
    closure_summary = v_gate,
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_plan_id;

  RETURN jsonb_build_object('success', true, 'summary', v_gate);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ia_close_annual_plan(uuid, jsonb, text) TO authenticated;
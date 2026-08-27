
-- 1) Seed genuinely-used business transitions into the configured baseline workflow
DO $seed$
DECLARE
  v_wf   uuid;
  v_step uuid;
  v_num  int;
  r      record;
BEGIN
  SELECT id INTO v_wf FROM public.workflow_definitions
   WHERE name = 'CE Status — Trivial Transitions' LIMIT 1;
  IF v_wf IS NULL THEN
    RAISE EXCEPTION 'Baseline CE status workflow not found';
  END IF;

  SELECT COALESCE(max(step_number), 0) INTO v_num FROM public.workflow_steps WHERE workflow_id = v_wf;

  FOR r IN
    SELECT * FROM (VALUES
      ('UNDER_REVIEW','CONFIRM','Confirm Violation','OPEN'),
      ('UNDER_REVIEW','SEND_BACK','Send Back for Correction','DRAFT'),
      ('DRAFT','RESUBMIT','Resubmit for Verification','UNDER_REVIEW'),
      ('DRAFT','CONFIRM','Confirm Violation','OPEN'),
      ('DRAFT','CANCEL','Cancel','CANCELLED')
    ) AS t(from_status, action_code, action_name, result_status)
    UNION ALL
    SELECT DISTINCT er.from_status,
           'ESCALATION_' || er.to_status,
           'Escalation: ' || er.from_status || ' → ' || er.to_status,
           er.to_status
      FROM public.ce_escalation_rules er
     WHERE er.is_enabled
       AND er.from_status IS NOT NULL AND er.to_status IS NOT NULL
       AND er.from_status <> er.to_status
  LOOP
    -- skip pairs already representable by configuration
    IF EXISTS (
      SELECT 1 FROM public.workflow_steps ws
        JOIN public.workflow_step_actions wsa ON wsa.step_id = ws.id
       WHERE ws.workflow_id = v_wf
         AND split_part(ws.step_name, ':', 1) = 'violation'
         AND upper(ws.from_status) = upper(r.from_status)
         AND upper(wsa.result_status) = upper(r.result_status)
    ) THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_step FROM public.workflow_steps
     WHERE workflow_id = v_wf AND step_name = 'violation:' || r.from_status LIMIT 1;

    IF v_step IS NULL THEN
      v_num := v_num + 1;
      INSERT INTO public.workflow_steps
        (workflow_id, step_number, step_name, from_status, action_type, approver_type, is_final_step, description, created_by)
      VALUES
        (v_wf, v_num, 'violation:' || r.from_status, r.from_status, 'Custom', 'role', false,
         'Configured violation transitions from ' || r.from_status, 'MIGRATION-CONFIG-GUARD')
      RETURNING id INTO v_step;
    END IF;

    INSERT INTO public.workflow_step_actions
      (step_id, action_name, action_type, action_code, result_status, next_step_type, display_order)
    SELECT v_step, r.action_name, 'Custom', r.action_code, r.result_status, 'end_workflow',
           COALESCE((SELECT max(display_order) FROM public.workflow_step_actions WHERE step_id = v_step), 0) + 10
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workflow_step_actions x WHERE x.step_id = v_step AND x.action_code = r.action_code
    );
  END LOOP;
END
$seed$;

-- 2) Configuration-driven integrity guard (no hardcoded status names or transition arrays)
CREATE OR REPLACE FUNCTION public.fn_ce_violation_status_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old text := upper(coalesce(OLD.status, ''));
  v_new text := upper(coalesce(NEW.status, ''));
  v_ok  boolean;
BEGIN
  -- no-op writes always allowed
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;

  -- Resolve the same workflow scope as ce_apply_status_transition():
  -- enabled violation.status.* mappings, plus the baseline CE status workflow.
  WITH scopes AS (
    SELECT DISTINCT m.workflow_definition_id AS wf
      FROM public.ce_workflow_mappings m
     WHERE m.enabled
       AND m.workflow_definition_id IS NOT NULL
       AND m.event_key LIKE 'violation.status.%'
    UNION
    SELECT wd.id
      FROM public.workflow_definitions wd
     WHERE wd.name = 'CE Status — Trivial Transitions'
  )
  SELECT EXISTS (
    SELECT 1
      FROM public.workflow_steps ws
      JOIN public.workflow_step_actions wsa ON wsa.step_id = ws.id
      JOIN public.workflow_definitions wd ON wd.id = ws.workflow_id
      JOIN scopes s ON s.wf = ws.workflow_id
     WHERE wd.is_active
       AND split_part(ws.step_name, ':', 1) = 'violation'
       AND upper(ws.from_status) = v_old
       AND upper(wsa.result_status) = v_new
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION
      'Transition % → % is not allowed by the configured violation workflow.', v_old, v_new
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_ce_violation_status_transition_guard() IS
  'Transition-integrity only. Validates OLD.status → NEW.status against configured violation workflow (workflow_steps / workflow_step_actions scoped via ce_workflow_mappings + baseline definition). No hardcoded transition policy; role/action authorization stays in the service layer.';

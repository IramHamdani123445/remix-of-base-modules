-- FINAL-E2E-DEF-06: ia_check_overdue_actions referenced columns that do not
-- exist on ia_action_tracking (description, due_date), so the overdue sweep
-- failed at runtime with 42703 and no overdue escalation could ever be raised.
-- Repointed to the canonical columns (action_description, current_target_date
-- falling back to target_date) and to lifecycle_status where present.
CREATE OR REPLACE FUNCTION public.ia_check_overdue_actions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_overdue_count INT := 0; v_action RECORD;
BEGIN
  FOR v_action IN
    SELECT id,
           action_description AS description,
           COALESCE(current_target_date, target_date) AS due_date
      FROM ia_action_tracking
     WHERE COALESCE(lifecycle_status, status) NOT IN ('Completed','Closed','Verified','Cancelled')
       AND COALESCE(current_target_date, target_date) < CURRENT_DATE
  LOOP
    INSERT INTO system_business_events (action, module, entity_type, entity_id, description)
    VALUES ('ia_action_overdue', 'internal_audit', 'audit_action', v_action.id,
            format('Action overdue: %s (due %s)', COALESCE(v_action.description, v_action.id::text), v_action.due_date));
    v_overdue_count := v_overdue_count + 1;
  END LOOP;

  FOR v_action IN
    SELECT id, target_resolution_date
      FROM ia_plan_carry_forward
     WHERE status NOT IN ('Resolved','Closed')
       AND target_resolution_date IS NOT NULL
       AND target_resolution_date < CURRENT_DATE
  LOOP
    UPDATE ia_plan_carry_forward
       SET escalation_count = COALESCE(escalation_count, 0) + 1, last_escalated_at = now()
     WHERE id = v_action.id;
    v_overdue_count := v_overdue_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'overdue_count', v_overdue_count);
END;
$function$;
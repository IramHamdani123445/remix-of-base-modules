
DROP FUNCTION IF EXISTS public.ce_violation_return_to_queue_v1(uuid,text,text);

CREATE OR REPLACE FUNCTION public.ce_violation_return_to_queue_v1(
  p_violation_id uuid, p_reason text, p_notes text DEFAULT NULL, p_queue_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid;
  v_actor text;
  v_now timestamptz := now();
  v_prev_id uuid;
  v_prev_inspector uuid;
  v_prev_name text;
  v_queue_id uuid;
  v_new_id uuid;
BEGIN
  v_uid := public.ce_assignment_require_authz('return_to_queue');
  IF COALESCE(TRIM(p_reason), '') = '' THEN
    RAISE EXCEPTION 'CE-ASSIGN-004: a reason is required' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('ce.assignment_command', 'on', true);
  v_actor := COALESCE(public.ce_actor_user_code(v_uid), 'SYSTEM');

  SELECT COALESCE(p_queue_id, v.assigned_queue_id), v.assigned_to_name
    INTO v_queue_id, v_prev_name
  FROM public.ce_violations v
  WHERE v.id = p_violation_id AND COALESCE(v.is_deleted,false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CE-ASSIGN-001: violation % not found', p_violation_id USING ERRCODE = '22023';
  END IF;

  IF p_queue_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ce_assignment_queues q WHERE q.id = p_queue_id) THEN
    RAISE EXCEPTION 'CE-ASSIGN-005: queue % not found', p_queue_id USING ERRCODE = '22023';
  END IF;

  SELECT a.id, a.assigned_to_inspector_id INTO v_prev_id, v_prev_inspector
  FROM public.ce_violation_assignments a
  WHERE a.violation_id = p_violation_id AND a.is_current
  ORDER BY a.assigned_at DESC LIMIT 1;

  UPDATE public.ce_violation_assignments
  SET is_current = false, superseded_at = v_now
  WHERE violation_id = p_violation_id AND is_current;

  INSERT INTO public.ce_violation_assignments (
    violation_id, assigned_to_inspector_id, assigned_to_queue_id, assignment_type,
    assigned_by, resolution_method, reassignment_reason, reassigned_from_inspector_id,
    is_current, assigned_at, notes
  ) VALUES (
    p_violation_id, NULL, v_queue_id, 'REASSIGN', v_actor, 'RETURNED_TO_QUEUE',
    TRIM(p_reason), v_prev_inspector, true, v_now, NULLIF(TRIM(COALESCE(p_notes,'')), '')
  ) RETURNING id INTO v_new_id;

  UPDATE public.ce_violations
  SET assigned_to_user_id = NULL, assigned_to_name = NULL, assigned_queue_id = v_queue_id,
      assigned_at = NULL, assignment_method = 'RETURNED_TO_QUEUE', updated_at = v_now
  WHERE id = p_violation_id;

  INSERT INTO public.ce_violation_history
    (violation_id, action, from_value, to_value, notes, performed_by, performed_at)
  VALUES (p_violation_id, 'REASSIGNED', LEFT(COALESCE(v_prev_name,''),255), 'QUEUE',
          COALESCE(p_notes, p_reason), v_actor, v_now);

  INSERT INTO public.ce_audit_log
    (entity_type, entity_id, action, description, old_values, new_values, performed_by, reason, performed_at)
  VALUES ('VIOLATION', p_violation_id, 'REASSIGN', 'Violation returned to queue',
          jsonb_build_object('assignment_id', v_prev_id, 'inspector_id', v_prev_inspector),
          jsonb_build_object('assignment_id', v_new_id, 'queue_id', v_queue_id),
          v_actor, COALESCE(p_reason, p_notes), v_now);

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.violation_assignment.return_to_queue','Compliance','ce_violation_assignments',
          v_new_id::text,'info',
          jsonb_build_object('violation_id', p_violation_id, 'assignment_source','MANUAL',
                             'actor_kind','HUMAN', 'from_inspector_id', v_prev_inspector,
                             'queue_id', v_queue_id, 'reason', p_reason),
          v_uid, v_actor, v_now);

  RETURN v_new_id;
END $$;

REVOKE ALL ON FUNCTION public.ce_violation_return_to_queue_v1(uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_violation_return_to_queue_v1(uuid,text,text,uuid) TO authenticated, service_role;

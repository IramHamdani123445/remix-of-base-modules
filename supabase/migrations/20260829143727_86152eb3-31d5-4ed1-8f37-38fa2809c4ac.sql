CREATE OR REPLACE FUNCTION public.ce_violation_assignment_apply(p_violation_id uuid, p_target_inspector_id uuid, p_assignment_type text, p_reason text, p_notes text, p_actor_uid uuid, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_actor text;
  v_actor_name text;
  v_viol_status text;
  v_prev_key text;
  v_prev_name text;
  v_prev_inspector uuid;
  v_prev_id uuid;
  v_insp_id uuid;
  v_insp_profile uuid;
  v_insp_label text;
  v_key text;
  v_new_id uuid;
BEGIN
  PERFORM set_config('ce.assignment_command', 'on', true);

  v_actor := COALESCE(public.ce_actor_user_code(p_actor_uid), 'SYSTEM');
  SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), v_actor) INTO v_actor_name
  FROM public.profiles p WHERE p.id = p_actor_uid;
  v_actor_name := COALESCE(v_actor_name, v_actor);

  SELECT v.status, v.assigned_to_user_id, v.assigned_to_name
    INTO v_viol_status, v_prev_key, v_prev_name
  FROM public.ce_violations v
  WHERE v.id = p_violation_id AND COALESCE(v.is_deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CE-ASSIGN-001: violation % not found', p_violation_id USING ERRCODE = '22023';
  END IF;

  SELECT ci.id, ci.profile_id,
         COALESCE(NULLIF(TRIM(p.full_name), ''), ci.inspector_code, ci.id::text)
    INTO v_insp_id, v_insp_profile, v_insp_label
  FROM public.ce_inspectors ci
  LEFT JOIN public.profiles p ON p.id = ci.profile_id
  WHERE ci.id = p_target_inspector_id
    AND COALESCE(ci.is_active, false) = true
    AND ci.status = 'ACTIVE';
  IF v_insp_id IS NULL THEN
    RAISE EXCEPTION 'CE-ASSIGN-002: target officer % is not a valid active inspector', p_target_inspector_id
      USING ERRCODE = '22023';
  END IF;

  SELECT a.id, a.assigned_to_inspector_id INTO v_prev_id, v_prev_inspector
  FROM public.ce_violation_assignments a
  WHERE a.violation_id = p_violation_id AND a.is_current
  ORDER BY a.assigned_at DESC LIMIT 1;

  IF p_assignment_type = 'REASSIGN' THEN
    IF v_prev_id IS NULL THEN
      RAISE EXCEPTION 'CE-ASSIGN-003: violation % has no active assignment to reassign', p_violation_id
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(TRIM(p_reason), '') = '' THEN
      RAISE EXCEPTION 'CE-ASSIGN-004: a reassignment reason is required' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(TRIM(p_notes), '') = '' THEN
      RAISE EXCEPTION 'CE-ASSIGN-005: reassignment notes are required' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Duplicate-assignment prevention: a no-op (re)assignment to the officer who
  -- already holds the current assignment must not create a second live record.
  IF v_prev_id IS NOT NULL AND v_prev_inspector IS NOT NULL AND v_prev_inspector = v_insp_id THEN
    RAISE EXCEPTION 'CE-ASSIGN-006: violation is already assigned to %; select a different officer',
      v_insp_label USING ERRCODE = '22023';
  END IF;

  UPDATE public.ce_violation_assignments
  SET is_current = false, superseded_at = v_now
  WHERE violation_id = p_violation_id AND is_current;

  INSERT INTO public.ce_violation_assignments (
    violation_id, assigned_to_inspector_id, assignment_type, assigned_by,
    resolution_method, reassignment_reason, reassigned_from_inspector_id,
    is_current, assigned_at, notes
  ) VALUES (
    p_violation_id, v_insp_id, p_assignment_type, v_actor,
    p_source, NULLIF(TRIM(COALESCE(p_reason, '')), ''), v_prev_inspector,
    true, v_now, NULLIF(TRIM(COALESCE(p_notes, '')), '')
  ) RETURNING id INTO v_new_id;

  v_key := COALESCE(v_insp_profile::text, v_insp_id::text);

  UPDATE public.ce_violations
  SET assigned_to_user_id = v_key,
      assigned_to_name = v_insp_label,
      assigned_at = v_now,
      assignment_method = p_source,
      updated_at = v_now
  WHERE id = p_violation_id;

  INSERT INTO public.ce_violation_history
    (violation_id, action, from_value, to_value, notes, performed_by, performed_at)
  VALUES (p_violation_id,
          CASE WHEN p_assignment_type = 'REASSIGN' THEN 'REASSIGNED' ELSE 'ASSIGNED' END,
          LEFT(COALESCE(v_prev_name, ''), 255), LEFT(v_insp_label, 255),
          COALESCE(p_notes, p_reason), v_actor, v_now);

  INSERT INTO public.ce_audit_log
    (entity_type, entity_id, action, description, old_values, new_values, performed_by, reason, performed_at)
  VALUES ('VIOLATION', p_violation_id,
          CASE WHEN p_assignment_type = 'REASSIGN' THEN 'REASSIGN' ELSE 'ASSIGN' END,
          format('Violation %s to %s', lower(p_assignment_type), v_insp_label),
          jsonb_build_object('assignment_id', v_prev_id, 'inspector_id', v_prev_inspector,
                             'assignee', v_prev_name),
          jsonb_build_object('assignment_id', v_new_id, 'inspector_id', v_insp_id,
                             'assignee', v_insp_label, 'source', p_source),
          v_actor, COALESCE(p_reason, p_notes), v_now);

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.violation_assignment.' || lower(p_assignment_type), 'Compliance',
          'ce_violation_assignments', v_new_id::text, 'info',
          jsonb_build_object('violation_id', p_violation_id,
                             'assignment_source', p_source,
                             'actor_kind', CASE WHEN p_actor_uid IS NULL THEN 'SYSTEM' ELSE 'HUMAN' END,
                             'from_inspector_id', v_prev_inspector,
                             'to_inspector_id', v_insp_id,
                             'reason', p_reason),
          p_actor_uid, v_actor_name, v_now);

  RETURN v_new_id;
END $function$;

-- Clean up the duplicate no-op assignment created while reproducing the defect.
UPDATE public.ce_violation_assignments a
   SET is_current = false, superseded_at = now()
 WHERE a.violation_id = '758e2be6-f259-4d4e-be0d-b6135149f9e9'
   AND a.assignment_type = 'REASSIGN'
   AND a.reassigned_from_inspector_id = a.assigned_to_inspector_id;
UPDATE public.ce_violation_assignments a
   SET is_current = true, superseded_at = NULL
 WHERE a.violation_id = '758e2be6-f259-4d4e-be0d-b6135149f9e9'
   AND a.assignment_type = 'MANUAL';
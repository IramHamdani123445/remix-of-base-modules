
-- =========================================================
-- Checkpoint F-S1 : governed violation assignment commands
-- =========================================================

-- 0. Data repair: collapse multiple "current" assignments to the newest one.
UPDATE public.ce_violation_assignments a
SET is_current = false,
    superseded_at = COALESCE(a.superseded_at, now())
WHERE a.is_current
  AND EXISTS (
    SELECT 1 FROM public.ce_violation_assignments b
    WHERE b.violation_id = a.violation_id
      AND b.is_current
      AND (b.assigned_at, b.id) > (a.assigned_at, a.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS ce_violation_assignments_one_current_idx
  ON public.ce_violation_assignments (violation_id)
  WHERE is_current;

-- 1. Transaction-local marker set only by trusted commands.
CREATE OR REPLACE FUNCTION public.ce_assignment_command_active()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(current_setting('ce.assignment_command', true), '') = 'on'
$$;

-- 2. Server-side authorisation for assignment commands.
CREATE OR REPLACE FUNCTION public.ce_assignment_require_authz(p_operation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid;
BEGIN
  BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-AUTHZ-010: authentication required for violation %', p_operation
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.violations.manage') THEN
    INSERT INTO public.system_audit_trail
      (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
    VALUES ('ce.violation_assignment.denied','Compliance','ce_violation_assignments','-','warning',
            jsonb_build_object('operation', p_operation,
                               'required_capability','compliance.violations.manage'),
            v_uid, public.ce_actor_user_code(v_uid), now());
    RAISE EXCEPTION 'CE-AUTHZ-011: compliance.violations.manage is required for violation %', p_operation
      USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END $$;

-- 3. Atomic assignment core (internal; never client callable).
CREATE OR REPLACE FUNCTION public.ce_violation_assignment_apply(
  p_violation_id uuid,
  p_target_inspector_id uuid,
  p_assignment_type text,
  p_reason text,
  p_notes text,
  p_actor_uid uuid,
  p_source text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

-- 4. Client-callable trusted commands.
CREATE OR REPLACE FUNCTION public.ce_violation_assign_v1(
  p_violation_id uuid, p_target_inspector_id uuid, p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.ce_assignment_require_authz('assign');
  RETURN public.ce_violation_assignment_apply(
    p_violation_id, p_target_inspector_id, 'MANUAL', NULL, p_notes, v_uid, 'MANUAL');
END $$;

CREATE OR REPLACE FUNCTION public.ce_violation_reassign_v1(
  p_violation_id uuid, p_target_inspector_id uuid, p_reason text, p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.ce_assignment_require_authz('reassign');
  RETURN public.ce_violation_assignment_apply(
    p_violation_id, p_target_inspector_id, 'REASSIGN', p_reason, p_notes, v_uid, 'MANUAL');
END $$;

CREATE OR REPLACE FUNCTION public.ce_violation_bulk_reassign_v1(
  p_from_assignment_key text, p_target_inspector_id uuid,
  p_reason text, p_notes text, p_limit integer DEFAULT 0
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_id uuid; v_n integer := 0; v_cap integer := LEAST(GREATEST(COALESCE(p_limit,0),0), 500);
BEGIN
  v_uid := public.ce_assignment_require_authz('bulk_reassign');
  IF COALESCE(TRIM(p_from_assignment_key), '') = '' THEN
    RAISE EXCEPTION 'CE-ASSIGN-006: source officer is required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(TRIM(p_reason), '') = '' OR COALESCE(TRIM(p_notes), '') = '' THEN
    RAISE EXCEPTION 'CE-ASSIGN-004: a reassignment reason and notes are required' USING ERRCODE = '22023';
  END IF;
  IF v_cap = 0 THEN v_cap := 500; END IF;

  FOR v_id IN
    SELECT v.id FROM public.ce_violations v
    WHERE v.assigned_to_user_id = p_from_assignment_key
      AND v.status IN ('OPEN','UNDER_REVIEW','ESCALATED')
      AND COALESCE(v.is_deleted,false) = false
    ORDER BY v.id
    LIMIT v_cap
  LOOP
    PERFORM public.ce_violation_assignment_apply(
      v_id, p_target_inspector_id,
      CASE WHEN EXISTS (SELECT 1 FROM public.ce_violation_assignments a
                        WHERE a.violation_id = v_id AND a.is_current)
           THEN 'REASSIGN' ELSE 'MANUAL' END,
      p_reason, p_notes, v_uid, 'MANUAL');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.ce_violation_bulk_assign_unassigned_v1(
  p_target_inspector_id uuid, p_notes text, p_limit integer DEFAULT 50
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_id uuid; v_n integer := 0; v_cap integer := LEAST(GREATEST(COALESCE(p_limit,0),1), 500);
BEGIN
  v_uid := public.ce_assignment_require_authz('bulk_assign');
  IF COALESCE(TRIM(p_notes), '') = '' THEN
    RAISE EXCEPTION 'CE-ASSIGN-005: notes are required' USING ERRCODE = '22023';
  END IF;
  FOR v_id IN
    SELECT v.id FROM public.ce_violations v
    WHERE v.assigned_to_user_id IS NULL
      AND v.status IN ('OPEN','UNDER_REVIEW','ESCALATED')
      AND COALESCE(v.is_deleted,false) = false
    ORDER BY v.id
    LIMIT v_cap
  LOOP
    PERFORM public.ce_violation_assignment_apply(
      v_id, p_target_inspector_id, 'MANUAL', NULL, p_notes, v_uid, 'MANUAL_BULK');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 5. Direct-write guard (defence in depth behind privilege revocation).
CREATE OR REPLACE FUNCTION public.ce_violation_assignment_guard_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_row jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  IF public.ce_assignment_command_active() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF public.ce_is_trusted_session() THEN RETURN COALESCE(NEW, OLD); END IF;

  BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;
  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.violation_assignment.direct_write_denied','Compliance','ce_violation_assignments',
          COALESCE(v_row->>'id','-'),'warning',
          jsonb_build_object('operation', TG_OP), v_uid,
          COALESCE(public.ce_actor_user_code(v_uid), 'anonymous'), now());
  RAISE EXCEPTION 'CE-AUTHZ-012: direct % on ce_violation_assignments is not permitted; use the governed assignment commands', TG_OP
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS zz_ce_violation_assignment_guard ON public.ce_violation_assignments;
CREATE TRIGGER zz_ce_violation_assignment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.ce_violation_assignments
  FOR EACH ROW EXECUTE FUNCTION public.ce_violation_assignment_guard_trg();

-- 6. Automatic routing keeps working and is marked as a system command.
CREATE OR REPLACE FUNCTION public.fn_ce_route_violation(p_violation_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_zone_id UUID;
  v_zone_code VARCHAR;
  v_resolution_method VARCHAR;
  v_queue_type VARCHAR;
  v_queue_id UUID;
  v_queue_code VARCHAR;
  v_inspector_id UUID;
  v_inspector_name TEXT;
  v_village_code VARCHAR;
  v_office_code VARCHAR;
BEGIN
  PERFORM set_config('ce.assignment_command', 'on', true);

  SELECT v.id, v.status, v.employer_id, v.territory,
         e.village_code, e.office_code
  INTO v_rec
  FROM ce_violations v
  LEFT JOIN er_master e ON e.regno = v.employer_id
  WHERE v.id = p_violation_id AND coalesce(v.is_deleted,false) = false;

  IF v_rec IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Violation not found');
  END IF;

  v_village_code := v_rec.village_code;
  v_office_code := v_rec.office_code;

  SELECT rz.zone_id, rz.zone_code, rz.resolution_method
  INTO v_zone_id, v_zone_code, v_resolution_method
  FROM fn_ce_resolve_zone(v_village_code, v_office_code) rz
  LIMIT 1;

  IF v_zone_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No zone resolved');
  END IF;

  v_queue_type := CASE
    WHEN v_rec.status = 'OPEN' THEN 'OPS'
    WHEN v_rec.status = 'UNDER_REVIEW' THEN 'REV'
    WHEN v_rec.status IN ('ESCALATED', 'LEGAL') THEN 'LEG'
    ELSE 'FLB'
  END;

  SELECT q.id, q.queue_code INTO v_queue_id, v_queue_code
  FROM ce_assignment_queues q
  WHERE q.zone_id = v_zone_id AND q.queue_type = v_queue_type AND q.is_active = true
  LIMIT 1;

  IF v_queue_id IS NULL THEN
    SELECT q.id, q.queue_code INTO v_queue_id, v_queue_code
    FROM ce_assignment_queues q
    WHERE q.zone_id = v_zone_id AND q.queue_type = 'FLB' AND q.is_active = true
    LIMIT 1;
    v_queue_type := 'FLB';
  END IF;

  IF v_queue_id IS NOT NULL
     AND (SELECT COUNT(*) FROM ce_queue_members WHERE queue_id = v_queue_id AND role = 'LEAD' AND is_active = true) = 1 THEN
    SELECT qm.inspector_id INTO v_inspector_id
    FROM ce_queue_members qm
    WHERE qm.queue_id = v_queue_id AND qm.role = 'LEAD' AND qm.is_active = true;

    SELECT COALESCE(NULLIF(TRIM(COALESCE(p.full_name, CONCAT_WS(' ', p.first_name, p.last_name))), ''), ci.inspector_code)
      INTO v_inspector_name
    FROM ce_inspectors ci
    LEFT JOIN profiles p ON p.id = ci.profile_id
    WHERE ci.id = v_inspector_id;
  END IF;

  UPDATE ce_violation_assignments
  SET is_current = false, superseded_at = now()
  WHERE violation_id = p_violation_id AND is_current = true;

  INSERT INTO ce_violation_assignments (
    violation_id, assigned_to_inspector_id, assigned_to_queue_id,
    assignment_type, assigned_by, zone_resolved_from, resolution_method, notes
  ) VALUES (
    p_violation_id, v_inspector_id, v_queue_id,
    'AUTO', 'SYSTEM-ROUTER', v_zone_code, v_resolution_method,
    'Auto-routed: ' || COALESCE(v_resolution_method, 'UNKNOWN') || ' → ' || COALESCE(v_queue_code, 'NONE')
  );

  UPDATE ce_violations SET
    zone_id = v_zone_id,
    assigned_queue_id = v_queue_id,
    assigned_to_user_id = CASE WHEN v_inspector_id IS NOT NULL THEN v_inspector_id::TEXT ELSE NULL END,
    assigned_to_name = v_inspector_name,
    assigned_at = now(),
    assignment_method = v_resolution_method,
    updated_at = now(),
    updated_by = 'SYSTEM-ROUTER'
  WHERE id = p_violation_id;

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.violation_assignment.auto_routed','Compliance','ce_violation_assignments',
          p_violation_id::text,'info',
          jsonb_build_object('assignment_source','AUTO_ROUTER',
                             'actor_kind','SYSTEM',
                             'routing_zone', v_zone_code,
                             'queue_code', v_queue_code,
                             'resolution_method', v_resolution_method,
                             'to_inspector_id', v_inspector_id),
          NULL, 'SYSTEM-ROUTER', now());

  RETURN jsonb_build_object(
    'ok', true,
    'violation_id', p_violation_id,
    'zone_code', v_zone_code,
    'queue_code', v_queue_code,
    'queue_type', v_queue_type,
    'resolution_method', v_resolution_method,
    'inspector_id', v_inspector_id,
    'inspector_name', v_inspector_name
  );
END;
$function$;

-- 7. Privileges: no direct table mutation for browser clients.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ce_violation_assignments FROM anon, authenticated;
GRANT SELECT ON public.ce_violation_assignments TO anon, authenticated;
GRANT ALL ON public.ce_violation_assignments TO service_role;

REVOKE ALL ON FUNCTION public.ce_violation_assignment_apply(uuid,uuid,text,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_assignment_require_authz(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_violation_assignment_guard_trg() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ce_violation_assign_v1(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_violation_reassign_v1(uuid,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_violation_bulk_reassign_v1(text,uuid,text,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_violation_bulk_assign_unassigned_v1(uuid,text,integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ce_violation_assign_v1(uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_violation_reassign_v1(uuid,uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_violation_bulk_reassign_v1(text,uuid,text,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_violation_bulk_assign_unassigned_v1(uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_violation_assignment_apply(uuid,uuid,text,text,text,uuid,text) TO service_role;

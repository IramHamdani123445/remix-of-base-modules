CREATE OR REPLACE FUNCTION public.fn_ce_route_violation(p_violation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- Direct officer only when the queue has exactly one active LEAD
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

-- Batch backfill helper so unrouted violations can be brought into queues safely
CREATE OR REPLACE FUNCTION public.fn_ce_route_unassigned_violations(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid; v_res jsonb; v_ok int := 0; v_fail int := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM ce_violations
    WHERE coalesce(is_deleted,false)=false
      AND assigned_queue_id IS NULL AND assigned_to_user_id IS NULL
      AND status NOT IN ('RESOLVED','CLOSED','CANCELLED')
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(p_limit, 20000))
  LOOP
    BEGIN
      v_res := public.fn_ce_route_violation(v_id);
      IF coalesce((v_res->>'ok')::boolean,false) THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('routed', v_ok, 'failed', v_fail);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ce_route_unassigned_violations(integer) TO authenticated, service_role;
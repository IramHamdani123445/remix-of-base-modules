-- 1. Prevent duplicate active departments (same name within same office)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ia_departments_active_name_office
ON public.ia_departments (lower(name), coalesce(office_code, ''))
WHERE coalesce(is_active, true);

-- 2. Block reparenting an auditable function that already has audit history
CREATE OR REPLACE FUNCTION public.ia_department_function_guard_reparent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_refs int := 0;
BEGIN
  IF NEW.department_id IS NOT DISTINCT FROM OLD.department_id THEN
    RETURN NEW;
  END IF;

  SELECT
    (SELECT count(*) FROM ia_risk_assessments WHERE function_id = OLD.id)
  + (SELECT count(*) FROM ia_audit_engagements WHERE function_id = OLD.id)
  + (SELECT count(*) FROM ia_risk_register WHERE function_id = OLD.id)
  INTO v_refs;

  IF v_refs > 0 THEN
    RAISE EXCEPTION 'This function already has audit history and cannot be moved to another department. Deactivate it and create it under the new department instead.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ia_department_function_guard_reparent ON public.ia_department_functions;
CREATE TRIGGER trg_ia_department_function_guard_reparent
BEFORE UPDATE ON public.ia_department_functions
FOR EACH ROW EXECUTE FUNCTION public.ia_department_function_guard_reparent();

-- 3. Plan revision: read current values via jsonb instead of dynamic record field access
CREATE OR REPLACE FUNCTION public.ia_apply_plan_revision(
  p_plan_id uuid, p_changes jsonb, p_requested_by text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan record;
  v_plan_json jsonb;
  v_key text;
  v_old_value text;
  v_new_value text;
  v_has_material_change boolean := false;
  v_actor text;
  v_material_fields text[] := ARRAY['objective','scope','methodology','fiscal_year','title',
                                    'planned_start_date','planned_end_date','planned_hours','total_available_hours'];
BEGIN
  IF NOT (public.ia_actor_can('audit_plans', 'edit') OR public.ia_can_edit_plan_portfolio(false)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
      'error', 'You do not have permission to revise this annual plan.');
  END IF;

  v_actor := COALESCE(NULLIF(trim(COALESCE(public.ia_actor_label(), '')), ''), p_requested_by, auth.uid()::text);

  SELECT * INTO v_plan FROM ia_annual_plans WHERE id = p_plan_id FOR UPDATE;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found');
  END IF;
  IF COALESCE(v_plan.status, 'Draft') NOT IN ('Approved', 'In Progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Can only revise an Approved or In Progress plan');
  END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reason is required for a plan revision');
  END IF;

  v_plan_json := to_jsonb(v_plan);

  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_changes, '{}'::jsonb))
  LOOP
    IF NOT (v_plan_json ? v_key) THEN
      CONTINUE;
    END IF;

    v_old_value := v_plan_json->>v_key;
    v_new_value := p_changes->>v_key;

    IF v_new_value IS DISTINCT FROM v_old_value THEN
      IF v_key = ANY (v_material_fields) THEN
        v_has_material_change := true;
      END IF;

      EXECUTE format('UPDATE ia_annual_plans SET %I = $1, updated_at = now(), updated_by = $2 WHERE id = $3', v_key)
        USING v_new_value, v_actor, p_plan_id;

      INSERT INTO ia_plan_amendments (plan_id, plan_type, amendment_type, field_changed,
                                      old_value, new_value, reason, requested_by, status)
      VALUES (p_plan_id, 'annual_plan',
              CASE WHEN v_key = ANY (v_material_fields) THEN 'Material' ELSE 'Administrative' END,
              v_key, v_old_value, v_new_value, p_reason, v_actor,
              CASE WHEN v_key = ANY (v_material_fields) THEN 'Pending' ELSE 'Applied' END);
    END IF;
  END LOOP;

  PERFORM public.ia_log_event('PLAN_REVISION_APPLIED', 'ia_annual_plan', p_plan_id, NULL, p_plan_id,
    NULL, jsonb_build_object('changes', p_changes, 'material', v_has_material_change),
    p_reason, NULL, 'ia_apply_plan_revision');

  IF v_has_material_change THEN
    RETURN public.ia_start_plan_approval_workflow(p_plan_id, v_actor, true);
  END IF;

  RETURN jsonb_build_object('success', true, 'requires_reapproval', false);
END;
$function$;
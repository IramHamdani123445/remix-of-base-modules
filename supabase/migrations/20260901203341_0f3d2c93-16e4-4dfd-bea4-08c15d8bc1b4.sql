-- 1. Annual plan header creation: authorization + server-derived actor
CREATE OR REPLACE FUNCTION public.ia_create_plan_header(
  p_fiscal_year text, p_title text, p_objective text DEFAULT NULL::text,
  p_scope text DEFAULT NULL::text, p_methodology text DEFAULT NULL::text,
  p_created_by text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan_id uuid;
  v_existing uuid;
  v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
      'error', 'You do not have permission to create annual audit plans');
  END IF;

  IF NOT (public.ia_actor_can('audit_plans', 'create')
          OR public.ia_actor_can('audit_plans', 'edit')
          OR public.ia_can_edit_plan_portfolio(true)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
      'error', 'You do not have permission to create annual audit plans');
  END IF;

  IF NULLIF(trim(COALESCE(p_fiscal_year, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_title, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_VALIDATION',
      'error', 'Fiscal year and plan title are required');
  END IF;

  -- Server-derived actor. p_created_by is accepted for wire compatibility only.
  v_actor := COALESCE(NULLIF(trim(COALESCE(public.ia_actor_label(), '')), ''), auth.uid()::text);

  SELECT id INTO v_existing FROM ia_annual_plans WHERE fiscal_year = p_fiscal_year LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      'An annual plan already exists for fiscal year ' || p_fiscal_year, 'existing_plan_id', v_existing);
  END IF;

  INSERT INTO ia_annual_plans (fiscal_year, title, objective, scope, methodology, status, created_by, created_date)
  VALUES (p_fiscal_year, p_title, p_objective, p_scope, p_methodology, 'Draft', v_actor, now())
  RETURNING id INTO v_plan_id;

  PERFORM public.ia_log_event('PLAN_HEADER_CREATED', 'ia_annual_plan', v_plan_id, NULL, v_plan_id,
    NULL, jsonb_build_object('fiscal_year', p_fiscal_year, 'title', p_title),
    NULL, NULL, 'ia_create_plan_header');

  RETURN jsonb_build_object('success', true, 'plan_id', v_plan_id);
END;
$function$;

-- 2. Plan revision: correct amendment history column names
CREATE OR REPLACE FUNCTION public.ia_apply_plan_revision(
  p_plan_id uuid, p_changes jsonb, p_requested_by text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan record;
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

  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_changes, '{}'::jsonb))
  LOOP
    EXECUTE format('SELECT ($1).%I::text', v_key) INTO v_old_value USING v_plan;
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

-- 3. Risk recalculation: do not write generated score columns
CREATE OR REPLACE FUNCTION public.ia_recalculate_all_risks(
  p_reason text DEFAULT 'config_changed'::text, p_triggered_by text DEFAULT 'SYSTEM'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_risk RECORD;
  v_new_inherent_level TEXT;
  v_new_residual_level TEXT;
  v_band RECORD;
BEGIN
  FOR v_risk IN
    SELECT id, inherent_risk_score, inherent_risk_level, residual_risk_score, residual_risk_level,
           is_score_overridden
    FROM ia_risk_register
    WHERE COALESCE(is_active, true)
  LOOP
    IF COALESCE(v_risk.is_score_overridden, false) THEN
      INSERT INTO ia_risk_recalc_log (risk_id, trigger_reason,
        old_inherent_score, new_inherent_score, old_inherent_level, new_inherent_level,
        old_residual_score, new_residual_score, old_residual_level, new_residual_level, recalculated_by)
      VALUES (v_risk.id, 'skipped_override: ' || p_reason,
        v_risk.inherent_risk_score, v_risk.inherent_risk_score, v_risk.inherent_risk_level, v_risk.inherent_risk_level,
        v_risk.residual_risk_score, v_risk.residual_risk_score, v_risk.residual_risk_level, v_risk.residual_risk_level,
        p_triggered_by);
      CONTINUE;
    END IF;

    v_new_inherent_level := 'Unknown';
    FOR v_band IN SELECT label, min_score, max_score FROM ia_risk_classification_thresholds
                   WHERE is_active = true ORDER BY sort_order
    LOOP
      IF COALESCE(v_risk.inherent_risk_score, 0) >= v_band.min_score
         AND COALESCE(v_risk.inherent_risk_score, 0) <= v_band.max_score THEN
        v_new_inherent_level := v_band.label; EXIT;
      END IF;
    END LOOP;

    v_new_residual_level := 'Unknown';
    FOR v_band IN SELECT label, min_score, max_score FROM ia_risk_classification_thresholds
                   WHERE is_active = true ORDER BY sort_order
    LOOP
      IF COALESCE(v_risk.residual_risk_score, 0) >= v_band.min_score
         AND COALESCE(v_risk.residual_risk_score, 0) <= v_band.max_score THEN
        v_new_residual_level := v_band.label; EXIT;
      END IF;
    END LOOP;

    IF v_new_inherent_level IS DISTINCT FROM v_risk.inherent_risk_level
       OR v_new_residual_level IS DISTINCT FROM v_risk.residual_risk_level THEN
      INSERT INTO ia_risk_recalc_log (risk_id, trigger_reason,
        old_inherent_score, new_inherent_score, old_inherent_level, new_inherent_level,
        old_residual_score, new_residual_score, old_residual_level, new_residual_level, recalculated_by)
      VALUES (v_risk.id, p_reason,
        v_risk.inherent_risk_score, v_risk.inherent_risk_score, v_risk.inherent_risk_level, v_new_inherent_level,
        v_risk.residual_risk_score, v_risk.residual_risk_score, v_risk.residual_risk_level, v_new_residual_level,
        p_triggered_by);

      UPDATE ia_risk_register
         SET inherent_risk_level = v_new_inherent_level,
             residual_risk_level = v_new_residual_level,
             updated_at = now(), updated_by = p_triggered_by
       WHERE id = v_risk.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Keep risk register levels aligned on write
CREATE OR REPLACE FUNCTION public.ia_risk_register_derive_levels()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_band RECORD;
BEGIN
  IF COALESCE(NEW.is_score_overridden, false) THEN
    RETURN NEW;
  END IF;

  NEW.inherent_risk_level := 'Unknown';
  FOR v_band IN SELECT label, min_score, max_score FROM ia_risk_classification_thresholds
                 WHERE is_active = true ORDER BY sort_order
  LOOP
    IF COALESCE(NEW.inherent_risk_score, 0) >= v_band.min_score
       AND COALESCE(NEW.inherent_risk_score, 0) <= v_band.max_score THEN
      NEW.inherent_risk_level := v_band.label; EXIT;
    END IF;
  END LOOP;

  NEW.residual_risk_level := 'Unknown';
  FOR v_band IN SELECT label, min_score, max_score FROM ia_risk_classification_thresholds
                 WHERE is_active = true ORDER BY sort_order
  LOOP
    IF COALESCE(NEW.residual_risk_score, 0) >= v_band.min_score
       AND COALESCE(NEW.residual_risk_score, 0) <= v_band.max_score THEN
      NEW.residual_risk_level := v_band.label; EXIT;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ia_risk_register_derive_levels ON public.ia_risk_register;
CREATE TRIGGER trg_ia_risk_register_derive_levels
BEFORE INSERT OR UPDATE ON public.ia_risk_register
FOR EACH ROW EXECUTE FUNCTION public.ia_risk_register_derive_levels();

-- 4. Risk assessment: derive overall score and level from entered factor scores
CREATE OR REPLACE FUNCTION public.ia_risk_assessment_derive_score()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_score numeric;
  v_band RECORD;
BEGIN
  v_score := ROUND(
    (COALESCE(NEW.likelihood_score, 0) * COALESCE(NEW.impact_score, 0)) * 0.60
    + COALESCE(NEW.control_effectiveness_score, 0) * 1.00
    + COALESCE(NEW.velocity_score, 0) * 0.60
    + COALESCE(NEW.regulatory_score, 0) * 0.60
    + COALESCE(NEW.reputational_score, 0) * 0.60
  , 2);
  -- normalise onto the same 1-25 band scale used by the risk classification thresholds
  v_score := LEAST(v_score, 25);
  NEW.overall_risk_score := v_score;

  NEW.risk_level := 'Unknown';
  FOR v_band IN SELECT label, min_score, max_score FROM ia_risk_classification_thresholds
                 WHERE is_active = true ORDER BY sort_order
  LOOP
    IF v_score >= v_band.min_score AND v_score <= v_band.max_score THEN
      NEW.risk_level := v_band.label; EXIT;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ia_risk_assessment_derive_score ON public.ia_risk_assessments;
CREATE TRIGGER trg_ia_risk_assessment_derive_score
BEFORE INSERT OR UPDATE ON public.ia_risk_assessments
FOR EACH ROW EXECUTE FUNCTION public.ia_risk_assessment_derive_score();
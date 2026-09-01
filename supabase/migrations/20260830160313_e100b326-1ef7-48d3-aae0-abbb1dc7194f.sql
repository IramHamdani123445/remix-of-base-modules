CREATE OR REPLACE FUNCTION public.ia_plan_carry_forward_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoa jsonb;
  v_from text;
  v_dept uuid;
BEGIN
  v_hoa := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
  IF v_hoa = '{}'::jsonb THEN RETURN NEW; END IF;

  SELECT p.fiscal_year, p.department_id INTO v_from, v_dept
    FROM public.ia_annual_plans p WHERE p.id = NEW.annual_plan_id;

  IF v_dept IS NULL AND NEW.original_engagement_id IS NOT NULL THEN
    SELECT e.department_id INTO v_dept FROM public.ia_audit_engagements e WHERE e.id = NEW.original_engagement_id;
  END IF;

  PERFORM public.ia_comms_emit(
    'INTERNAL_AUDIT.FOLLOWUP.CARRIED_FORWARD', 'ia_followup', NEW.id::text, 'carried_forward', v_hoa,
    jsonb_build_object(
      'subjectName', coalesce(v_hoa->'head_of_audit'->>'display_name','Head of Internal Audit'),
      'reference', coalesce(NEW.source_reference, NEW.id::text),
      'followupSubject', coalesce(nullif(btrim(coalesce(NEW.description,'')),''), 'Carried-forward audit item'),
      'fromPlanYear', coalesce(v_from, 'Not stated'),
      'toPlanYear', coalesce(NEW.target_fiscal_year, 'Next plan year')),
    'internal_audit:followup_carried_forward:' || NEW.id::text,
    v_dept);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ia_plan_carry_forward_comms_trg() FROM PUBLIC, anon, authenticated;
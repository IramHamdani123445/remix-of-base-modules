CREATE OR REPLACE FUNCTION public.ia_plan_accept_carry_forward(
  p_carry_forward_id uuid,
  p_target_plan_id uuid,
  p_notes text DEFAULT NULL,
  p_quarter text DEFAULT 'Q1'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_actor text := public.ia_actor_label();
  v_cf record; v_src record; v_target record;
  v_seq int; v_code text; v_new_id uuid;
BEGIN
  IF NOT (public.ia_actor_can('plan_closeout','close') OR public.ia_actor_can('audit_plans','create')) THEN
    RETURN jsonb_build_object('success', false, 'code','IA_FORBIDDEN',
      'error','You do not have permission to accept carried-forward audits into a plan');
  END IF;

  SELECT * INTO v_cf FROM public.ia_plan_carry_forward WHERE id = p_carry_forward_id;
  IF v_cf.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_NOT_FOUND','error','Carry-forward record not found');
  END IF;
  IF v_cf.target_engagement_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_ALREADY_ACCEPTED',
      'error','This carry-forward has already been accepted into a plan',
      'target_engagement_id', v_cf.target_engagement_id);
  END IF;
  IF NULLIF(trim(COALESCE(v_cf.description,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_REASON_REQUIRED',
      'error','The carry-forward has no recorded reason and cannot be promoted');
  END IF;

  SELECT * INTO v_target FROM public.ia_annual_plans WHERE id = p_target_plan_id;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_NOT_FOUND','error','Target annual plan not found');
  END IF;
  IF v_target.status = 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'code','IA_PLAN_CLOSED','error','The target annual plan is closed');
  END IF;
  IF p_target_plan_id = v_cf.annual_plan_id THEN
    RETURN jsonb_build_object('success', false, 'code','IA_SAME_PLAN',
      'error','A carry-forward cannot be accepted back into its own source plan');
  END IF;

  SELECT * INTO v_src FROM public.ia_audit_engagements
   WHERE id = COALESCE(v_cf.original_engagement_id, v_cf.source_id);
  IF v_src.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_NOT_FOUND','error','Source audit not found for this carry-forward');
  END IF;

  SELECT COALESCE(count(*),0) + 1 INTO v_seq
    FROM public.ia_audit_engagements WHERE annual_plan_id = p_target_plan_id;
  v_code := 'ENG-' || regexp_replace(COALESCE(v_target.fiscal_year,'0000'),'[^0-9]','','g')
            || '-' || lpad(v_seq::text, 3, '0');
  IF length(v_code) > 16 THEN
    v_code := 'ENG-' || left(regexp_replace(COALESCE(v_target.fiscal_year,'0000'),'[^0-9]','','g'),4)
              || '-' || lpad(v_seq::text, 3, '0');
  END IF;

  INSERT INTO public.ia_audit_engagements (
    annual_plan_id, engagement_name, engagement_code, department_id, function_id,
    scope, objectives, methodology, engagement_risk_rating, estimated_hours, estimated_days,
    quarter, sequence_no, status, execution_status, engagement_type, is_active,
    lead_auditor_id, inclusion_rationale, created_by, created_at, updated_by, updated_at)
  VALUES (
    p_target_plan_id, v_src.engagement_name, v_code, v_src.department_id, v_src.function_id,
    v_src.scope, v_src.objectives, v_src.methodology, v_src.engagement_risk_rating,
    v_src.estimated_hours, v_src.estimated_days,
    COALESCE(p_quarter,'Q1'), v_seq, 'Planned', 'Planned',
    COALESCE(v_src.engagement_type,'Assurance'), true,
    v_src.lead_auditor_id,
    'Carried forward from ' || COALESCE(v_src.engagement_code, v_src.engagement_name)
      || ' (' || COALESCE(v_cf.description,'') || ')',
    v_actor, now(), v_actor, now())
  RETURNING id INTO v_new_id;

  UPDATE public.ia_plan_carry_forward
     SET target_plan_id = p_target_plan_id,
         target_engagement_id = v_new_id,
         target_fiscal_year = v_target.fiscal_year,
         status = 'Accepted',
         accepted_by = v_actor,
         accepted_by_profile = auth.uid(),
         accepted_at = now(),
         acceptance_notes = p_notes
   WHERE id = p_carry_forward_id;

  PERFORM public.ia_log_event('IA.PLAN.CARRY_FORWARD_ACCEPTED','carry_forward', p_carry_forward_id,
    v_new_id, p_target_plan_id,
    jsonb_build_object('source_plan_id', v_cf.annual_plan_id, 'source_engagement_id', v_src.id,
                       'source_engagement_code', v_src.engagement_code),
    jsonb_build_object('target_plan_id', p_target_plan_id, 'target_engagement_id', v_new_id,
                       'target_engagement_code', v_code, 'target_fiscal_year', v_target.fiscal_year),
    COALESCE(p_notes, v_cf.description), NULL, 'ia_plan_accept_carry_forward');

  RETURN jsonb_build_object('success', true, 'carry_forward_id', p_carry_forward_id,
    'target_plan_id', p_target_plan_id, 'target_engagement_id', v_new_id,
    'target_engagement_code', v_code, 'source_engagement_code', v_src.engagement_code,
    'source_plan_id', v_cf.annual_plan_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_plan_accept_carry_forward(uuid,uuid,text,text) TO authenticated;

UPDATE public.ia_audit_engagements t
   SET lead_auditor_id = s.lead_auditor_id, updated_at = now()
  FROM public.ia_plan_carry_forward cf
  JOIN public.ia_audit_engagements s ON s.id = COALESCE(cf.original_engagement_id, cf.source_id)
 WHERE cf.target_engagement_id = t.id
   AND t.lead_auditor_id IS NULL
   AND s.lead_auditor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ce_generate_stage_notice_core(
  p_violation_id uuid,
  p_stage_code text,
  p_delivery_method text,
  p_actor text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_elig jsonb;
  v_stage record;
  v_viol record;
  v_tmpl record;
  v_fin jsonb;
  v_key text;
  v_id uuid;
  v_no text;
BEGIN
  v_elig := public.ce_evaluate_stage_eligibility_v1(p_violation_id, p_stage_code);
  IF NOT (v_elig->>'eligible')::boolean THEN
    RETURN jsonb_build_object('status', v_elig->>'status', 'generated', false, 'evaluation', v_elig);
  END IF;

  SELECT * INTO v_stage FROM public.ce_escalation_stage_config WHERE stage_code = p_stage_code;
  SELECT id, violation_number, employer_id, employer_name, case_id
    INTO v_viol FROM public.ce_violations WHERE id = p_violation_id;

  SELECT * INTO v_tmpl FROM public.ce_notice_templates
   WHERE template_code = v_stage.notice_template_code AND is_active LIMIT 1;
  IF v_tmpl IS NULL THEN
    RETURN jsonb_build_object('status','template_missing','generated',false,
      'template_code', v_stage.notice_template_code);
  END IF;

  v_key := 'ESC-'||p_stage_code||'-'||p_violation_id::text;
  IF EXISTS (SELECT 1 FROM public.ce_notices WHERE generation_idempotency_key = v_key) THEN
    RETURN jsonb_build_object('status','already_generated','generated',false,'idempotency_key',v_key);
  END IF;

  v_fin := public.ce_canonical_financial_snapshot(v_viol.employer_id);
  v_no := 'NTC-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.ce_notices
    (notice_number, employer_id, employer_name, case_id, violation_id, notice_type, status,
     subject, body, template_id, delivery_method, stage_code, stage_config_snapshot,
     financial_snapshot, effective_date, generation_idempotency_key, created_by)
  VALUES
    (v_no, v_viol.employer_id, v_viol.employer_name, v_viol.case_id, p_violation_id,
     p_stage_code, 'GENERATED', v_tmpl.subject, v_tmpl.body, v_tmpl.id,
     COALESCE(p_delivery_method,'EMAIL'), p_stage_code, to_jsonb(v_stage), v_fin,
     CURRENT_DATE, v_key, p_actor)
  RETURNING id INTO v_id;

  UPDATE public.ce_violations SET status='ESCALATED', updated_at=now()
   WHERE id = p_violation_id AND status IN ('OPEN','UNDER_REVIEW')
     AND v_stage.target_state IS NOT NULL;

  INSERT INTO public.system_audit_trail (module, action, entity_type, entity_id, severity, user_name, payload_json)
  VALUES ('COMPLIANCE_ESCALATION','STAGE_NOTICE_GENERATED','ce_notice', v_id::text,'info', p_actor,
          jsonb_build_object('stage', p_stage_code, 'violation_id', p_violation_id,
                             'financial_snapshot', v_fin, 'evaluation', v_elig));

  RETURN jsonb_build_object('status','generated','generated',true,'notice_id',v_id,
    'notice_number', v_no,'stage_code',p_stage_code,'financial_snapshot',v_fin);
END;
$$;
REVOKE ALL ON FUNCTION public.ce_generate_stage_notice_core(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_generate_stage_notice_core(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ce_generate_stage_notice_v1(
  p_violation_id uuid,
  p_stage_code text,
  p_delivery_method text DEFAULT 'EMAIL'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-ESC-401: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.notices') THEN
    RAISE EXCEPTION 'CE-ESC-403: compliance.enforcement.notices required' USING ERRCODE='42501';
  END IF;
  RETURN public.ce_generate_stage_notice_core(
    p_violation_id, p_stage_code, p_delivery_method, public.ce_actor_user_code(v_uid));
END;
$$;
REVOKE ALL ON FUNCTION public.ce_generate_stage_notice_v1(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_generate_stage_notice_v1(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ce_generate_stage_notice_system_v1(
  p_violation_id uuid,
  p_stage_code text,
  p_delivery_method text DEFAULT 'EMAIL'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_user <> 'service_role' AND NOT pg_has_role(current_user,'service_role','MEMBER') THEN
    RAISE EXCEPTION 'CE-ESC-403: system notice generation is restricted to backend jobs' USING ERRCODE='42501';
  END IF;
  RETURN public.ce_generate_stage_notice_core(
    p_violation_id, p_stage_code, p_delivery_method, 'SYSTEM/JOB-NOTICE-GENERATION');
END;
$$;
REVOKE ALL ON FUNCTION public.ce_generate_stage_notice_system_v1(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_generate_stage_notice_system_v1(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ia_comms_emit(
  p_event_code text,
  p_entity_type text,
  p_entity_id text,
  p_occurrence text,
  p_recipient_facts jsonb,
  p_payload jsonb,
  p_correlation_id text DEFAULT NULL::text,
  p_department_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_owner_dept uuid;
  v_audited_dept uuid;
  v_audited_name text;
  v_domain text;
  v_proj jsonb;
  v_payload jsonb;
BEGIN
  IF coalesce(jsonb_typeof(p_recipient_facts), 'null') <> 'object'
     OR p_recipient_facts = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'reason','recipient_resolution_failed',
      'code','IA_COMMS_RECIPIENT_REQUIRED',
      'event_code', upper(btrim(p_event_code)));
  END IF;

  -- Communication routing owner: never the audited department.
  v_owner_dept := public.ia_comms_owner_department_id();

  -- Audited department business context (ia_departments): retained, not routed.
  v_domain := public.ia_comms_department_domain(p_department_id);
  IF v_domain = 'ia_department' THEN
    v_audited_dept := p_department_id;
    SELECT d.name INTO v_audited_name FROM public.ia_departments d WHERE d.id = v_audited_dept;
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);
  IF v_audited_dept IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object(
      'auditedDepartmentId', v_audited_dept::text,
      'auditedDepartmentName', coalesce(v_audited_name, 'Audited department'));
    IF NOT (v_payload ? 'auditeeUnit') AND v_audited_name IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('auditeeUnit', v_audited_name);
    END IF;
  END IF;

  -- Contract projection runs LAST so any field the published contract does not
  -- support is trimmed rather than poisoning the request.
  v_proj := public.ia_comms_contract_project(p_event_code, v_payload);

  IF NOT coalesce((v_proj->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'reason','contract_required_field_missing',
      'code','IA_COMMS_CONTRACT_REQUIRED_FIELD_MISSING',
      'event_code', v_proj->>'event_code',
      'missing_fields', v_proj->'missing_fields',
      'unsupported_fields', v_proj->'unsupported_fields');
  END IF;

  v_result := public.omni_comms_priv_enqueue_business_event(
    NULL,
    'INTERNAL_AUDIT',
    upper(btrim(p_event_code)),
    p_entity_type,
    p_entity_id,
    coalesce(nullif(btrim(p_occurrence), ''), 'default'),
    NULL,
    v_owner_dept,
    p_recipient_facts,
    coalesce(v_proj->'payload', '{}'::jsonb),
    p_correlation_id
  );

  RETURN v_result
    || jsonb_build_object(
         'status', coalesce(v_result->>'status','queued'),
         'routing_department_id', v_owner_dept,
         'audited_department_id', v_audited_dept);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status','failed',
    'code','IA_COMMS_OBLIGATION_CREATION_FAILED',
    'event_code', upper(btrim(p_event_code)),
    'reason', SQLERRM);
END;
$function$;

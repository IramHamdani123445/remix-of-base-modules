CREATE OR REPLACE FUNCTION public.ia_comms_emit(
  p_event_code text,
  p_entity_type text,
  p_entity_id text,
  p_occurrence text,
  p_recipient_facts jsonb,
  p_payload jsonb,
  p_correlation_id text DEFAULT NULL::text,
  p_department_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_dept uuid;
BEGIN
  IF coalesce(jsonb_typeof(p_recipient_facts), 'null') <> 'object'
     OR p_recipient_facts = '{}'::jsonb THEN
    RETURN jsonb_build_object('status','blocked','reason','recipient_resolution_failed');
  END IF;

  -- DEF-S1B-43: Omni-Comms event routes are department-scoped. Internal Audit is the
  -- owning department for every IA notice, so bind the emission to it when the caller
  -- has not supplied an explicit department context.
  v_dept := p_department_id;
  IF v_dept IS NULL THEN
    SELECT d.id INTO v_dept
    FROM public.core_department d
    WHERE d.code = 'INTERNAL_AUDIT'
    LIMIT 1;
  END IF;

  v_result := public.omni_comms_priv_enqueue_business_event(
    NULL,
    'INTERNAL_AUDIT',
    upper(btrim(p_event_code)),
    p_entity_type,
    p_entity_id,
    coalesce(nullif(btrim(p_occurrence), ''), 'default'),
    NULL,
    v_dept,
    p_recipient_facts,
    coalesce(p_payload, '{}'::jsonb),
    p_correlation_id
  );

  RETURN v_result || jsonb_build_object('status', coalesce(v_result->>'status','queued'));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','failed','reason', SQLERRM);
END;
$function$;
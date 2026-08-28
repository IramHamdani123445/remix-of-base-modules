-- Project an IA payload onto the published Omni-Comms contract for the event.
CREATE OR REPLACE FUNCTION public.ia_comms_contract_payload(p_event_code text, p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH schema AS (
    SELECT c.json_schema
    FROM public.omni_comms_event_contract c
    JOIN public.omni_comms_event_definition d ON d.id = c.event_definition_id
    WHERE d.code = upper(btrim(p_event_code))
      AND c.status = 'published'
    ORDER BY c.version_number DESC
    LIMIT 1
  )
  SELECT CASE
    WHEN (SELECT json_schema FROM schema) IS NULL THEN coalesce(p_payload, '{}'::jsonb)
    WHEN coalesce(((SELECT json_schema FROM schema)->>'additionalProperties')::boolean, true) THEN coalesce(p_payload, '{}'::jsonb)
    ELSE coalesce(
      (SELECT jsonb_object_agg(k, v)
       FROM jsonb_each(coalesce(p_payload, '{}'::jsonb)) AS e(k, v)
       WHERE (SELECT json_schema->'properties' FROM schema) ? k),
      '{}'::jsonb)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ia_comms_contract_payload(text, jsonb) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.ia_comms_contract_payload(text, jsonb) TO service_role;

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
    public.ia_comms_contract_payload(p_event_code, coalesce(p_payload, '{}'::jsonb)),
    p_correlation_id
  );

  RETURN v_result || jsonb_build_object('status', coalesce(v_result->>'status','queued'));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','failed','reason', SQLERRM);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ia_comms_emit(text, text, text, text, jsonb, jsonb, text, uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.ia_comms_emit(text, text, text, text, jsonb, jsonb, text, uuid) TO service_role;
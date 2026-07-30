CREATE OR REPLACE FUNCTION public.omni_comms_ops_request_list(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_event_code text DEFAULT NULL,
  p_caller_module_code text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_has_blockers boolean DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE
  v_limit integer; v_offset integer; v_q text; v_uuid uuid; v_rows jsonb; v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit,25),1),100);
  v_offset := GREATEST(COALESCE(p_offset,0),0);
  v_q := NULLIF(btrim(COALESCE(p_search,'')),'');
  IF v_q IS NOT NULL AND length(v_q) > 200 THEN
    RAISE EXCEPTION 'OC422 search_too_long' USING ERRCODE='P0001', DETAIL='search';
  END IF;
  BEGIN
    v_uuid := v_q::uuid;
  EXCEPTION WHEN others THEN v_uuid := NULL;
  END;
  IF v_q IS NOT NULL THEN v_q := '%' || public.omni_comms_priv_escape_ilike(v_q) || '%'; END IF;

  WITH base AS (
    SELECT r.id
      FROM public.omni_comms_request r
      LEFT JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
     WHERE r.organization_id = p_organization_id
       AND (p_department_id IS NULL OR r.department_id = p_department_id)
       AND (p_mode IS NULL OR r.mode = p_mode)
       AND (p_status IS NULL OR r.status = p_status)
       AND (p_event_code IS NULL OR d.code = p_event_code)
       AND (p_caller_module_code IS NULL OR r.caller_module_code = p_caller_module_code)
       AND (p_date_from IS NULL OR r.created_at >= p_date_from)
       AND (p_date_to IS NULL OR r.created_at <= p_date_to)
       AND (p_has_blockers IS NULL
            OR (p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) > 0)
            OR (NOT p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) = 0))
       AND (v_q IS NULL
            OR d.code ILIKE v_q
            OR r.caller_module_code ILIKE v_q
            OR r.correlation_id ILIKE v_q
            OR r.idempotency_key ILIKE v_q
            OR r.caller_entity_id ILIKE v_q
            OR (v_uuid IS NOT NULL AND r.id = v_uuid))
  )
  SELECT count(*) INTO v_total FROM base;

  WITH base AS (
    SELECT r.*, d.code AS event_code
      FROM public.omni_comms_request r
      LEFT JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
     WHERE r.organization_id = p_organization_id
       AND (p_department_id IS NULL OR r.department_id = p_department_id)
       AND (p_mode IS NULL OR r.mode = p_mode)
       AND (p_status IS NULL OR r.status = p_status)
       AND (p_event_code IS NULL OR d.code = p_event_code)
       AND (p_caller_module_code IS NULL OR r.caller_module_code = p_caller_module_code)
       AND (p_date_from IS NULL OR r.created_at >= p_date_from)
       AND (p_date_to IS NULL OR r.created_at <= p_date_to)
       AND (p_has_blockers IS NULL
            OR (p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) > 0)
            OR (NOT p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) = 0))
       AND (v_q IS NULL
            OR d.code ILIKE v_q
            OR r.caller_module_code ILIKE v_q
            OR r.correlation_id ILIKE v_q
            OR r.idempotency_key ILIKE v_q
            OR r.caller_entity_id ILIKE v_q
            OR (v_uuid IS NOT NULL AND r.id = v_uuid))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'created_at', b.created_at,
      'event_code', b.event_code,
      'mode', b.mode,
      'status', b.status,
      'caller_module_code', b.caller_module_code,
      'caller_entity_type', b.caller_entity_type,
      'department_id', b.department_id,
      'correlation_id', b.correlation_id,
      'recipient_count', (SELECT count(*) FROM public.omni_comms_recipient c WHERE c.request_id = b.id),
      'message_count', (SELECT count(*) FROM public.omni_comms_message m WHERE m.request_id = b.id),
      'held_job_count', (SELECT count(*) FROM public.omni_comms_dispatch_job j
                          WHERE j.request_id = b.id AND j.is_runnable = false),
      'blocker_count', COALESCE(jsonb_array_length(b.blockers),0)
    ) ORDER BY b.created_at DESC, b.id DESC), '[]'::jsonb)
    INTO v_rows FROM base b;

  RETURN jsonb_build_object(
    'items', v_rows,
    'total', COALESCE(v_total,0),
    'limit', v_limit,
    'offset', v_offset,
    'generated_at', now());
END; $function$;
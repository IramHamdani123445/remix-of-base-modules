CREATE OR REPLACE FUNCTION public.omni_comms_print_queue_list(p_organization_id uuid, p_statuses text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_production_account_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_full boolean;
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  v_full := public.has_permission(v_uid, 'omni_comms', 'operate');

  SELECT count(*) INTO v_total
  FROM public.omni_comms_print_item i
  WHERE i.organization_id = p_organization_id
    AND (p_department_id IS NULL OR i.department_id = p_department_id)
    AND (p_statuses IS NULL OR i.physical_status = ANY (p_statuses))
    AND (p_production_account_id IS NULL OR i.production_account_id = p_production_account_id)
    AND (coalesce(btrim(p_search), '') = ''
         OR i.letter_reference ILIKE '%' || p_search || '%'
         OR coalesce(i.recipient_reference,'') ILIKE '%' || p_search || '%');

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'created_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', i.id,
      'created_at', i.created_at,
      'updated_at', i.updated_at,
      'letter_reference', i.letter_reference,
      'request_id', i.request_id,
      'message_id', i.message_id,
      'module_code', e.module_code,
      'event_code', e.code,
      'recipient_reference', i.recipient_reference,
      'recipient_display', CASE WHEN v_full THEN i.recipient_display
                                ELSE left(coalesce(i.recipient_display,'—'), 1) || '•••' END,
      'postal_summary', public.omni_comms_priv_print_mask_address(i.postal_destination_snapshot),
      'issuing_authority', i.issuing_authority,
      'page_count', i.page_count,
      'production_profile', i.production_profile,
      'production_account_id', i.production_account_id,
      'production_account_name', pa.display_name,
      'physical_status', i.physical_status,
      'attempt_count', i.attempt_count,
      'version', i.version,
      'hold_reason', i.hold_reason,
      'last_failure_reason', i.last_failure_reason,
      'last_equipment_reference', att.equipment_reference,
      'last_equipment_name', eq.display_name,
      'last_attempt_outcome', att.outcome,
      'last_printed_at', att.completed_at,
      'age_hours', round(extract(epoch FROM (now() - i.created_at)) / 3600.0, 1)
    ) AS r
    FROM public.omni_comms_print_item i
    LEFT JOIN public.omni_comms_provider_account pa ON pa.id = i.production_account_id
    LEFT JOIN public.omni_comms_request req ON req.id = i.request_id
    LEFT JOIN public.omni_comms_event_definition e ON e.id = req.event_definition_id
    LEFT JOIN LATERAL (
      SELECT a.equipment_reference, a.outcome, a.completed_at
      FROM public.omni_comms_print_attempt a
      WHERE a.print_item_id = i.id AND a.equipment_reference IS NOT NULL
      ORDER BY a.attempt_number DESC
      LIMIT 1
    ) att ON true
    LEFT JOIN public.omni_comms_print_equipment eq
      ON eq.organization_id = i.organization_id AND eq.code = att.equipment_reference
    WHERE i.organization_id = p_organization_id
      AND (p_department_id IS NULL OR i.department_id = p_department_id)
      AND (p_statuses IS NULL OR i.physical_status = ANY (p_statuses))
      AND (p_production_account_id IS NULL OR i.production_account_id = p_production_account_id)
      AND (coalesce(btrim(p_search), '') = ''
           OR i.letter_reference ILIKE '%' || p_search || '%'
           OR coalesce(i.recipient_reference,'') ILIKE '%' || p_search || '%')
    ORDER BY i.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    OFFSET greatest(0, coalesce(p_offset, 0))
  ) s;

  RETURN jsonb_build_object(
    'items', v_rows,
    'total', v_total,
    'full_detail_permitted', v_full,
    'generated_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_equipment_status(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_rows jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'display_name'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', eq.id,
      'code', eq.code,
      'display_name', eq.display_name,
      'location', eq.location,
      'device_type', eq.device_type,
      'register_status', eq.status,
      'is_default', eq.is_default,
      'discovery_source', eq.discovery_source,
      'last_seen_at', eq.last_seen_at,
      'health', CASE
        WHEN eq.status = 'retired' THEN 'retired'
        WHEN eq.status = 'maintenance' THEN 'maintenance'
        WHEN coalesce(recent.failed_count, 0) > 0 AND coalesce(recent.last_outcome,'') IN ('failed','spoiled') THEN 'error'
        WHEN eq.discovery_source = 'ipp_sync'
             AND (eq.last_seen_at IS NULL OR eq.last_seen_at < now() - interval '30 minutes')
          THEN 'offline'
        ELSE 'online'
      END,
      'printed_7d', coalesce(recent.printed_count, 0),
      'failed_7d', coalesce(recent.failed_count, 0),
      'last_job', CASE WHEN last_job.print_item_id IS NULL THEN NULL ELSE jsonb_build_object(
        'print_item_id', last_job.print_item_id,
        'letter_reference', last_job.letter_reference,
        'outcome', last_job.outcome,
        'completed_at', last_job.completed_at,
        'page_count', last_job.page_count,
        'failure_reason', last_job.failure_reason
      ) END
    ) AS r
    FROM public.omni_comms_print_equipment eq
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE a.outcome = 'printed') AS printed_count,
        count(*) FILTER (WHERE a.outcome IN ('failed','spoiled')) AS failed_count,
        (SELECT a2.outcome FROM public.omni_comms_print_attempt a2
          WHERE a2.organization_id = eq.organization_id
            AND a2.equipment_reference = eq.code
            AND a2.completed_at IS NOT NULL
          ORDER BY a2.completed_at DESC LIMIT 1) AS last_outcome
      FROM public.omni_comms_print_attempt a
      WHERE a.organization_id = eq.organization_id
        AND a.equipment_reference = eq.code
        AND a.started_at > now() - interval '7 days'
    ) recent ON true
    LEFT JOIN LATERAL (
      SELECT a.print_item_id, a.outcome, a.completed_at, a.page_count, a.failure_reason,
             i.letter_reference
      FROM public.omni_comms_print_attempt a
      JOIN public.omni_comms_print_item i ON i.id = a.print_item_id
      WHERE a.organization_id = eq.organization_id
        AND a.equipment_reference = eq.code
      ORDER BY coalesce(a.completed_at, a.started_at) DESC
      LIMIT 1
    ) last_job ON true
    WHERE eq.organization_id = p_organization_id
      AND (p_department_id IS NULL OR eq.department_id IS NULL OR eq.department_id = p_department_id)
  ) s;

  RETURN jsonb_build_object('items', v_rows, 'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_print_equipment_status(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_equipment_status(uuid, uuid) TO authenticated;
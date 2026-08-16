-- Fix: omni_comms_event_definition exposes `code`, not `event_code`.
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
      'age_hours', round(extract(epoch FROM (now() - i.created_at)) / 3600.0, 1)
    ) AS r
    FROM public.omni_comms_print_item i
    LEFT JOIN public.omni_comms_provider_account pa ON pa.id = i.production_account_id
    LEFT JOIN public.omni_comms_request req ON req.id = i.request_id
    LEFT JOIN public.omni_comms_event_definition e ON e.id = req.event_definition_id
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
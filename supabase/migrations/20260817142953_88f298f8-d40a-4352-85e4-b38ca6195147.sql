CREATE OR REPLACE FUNCTION public.omni_comms_print_queue_list(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_production_account_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
      'letter_generated_at', coalesce(m.rendered_at, i.created_at),
      'artefact_produced_at', i.created_at,
      'queued_for_print_at', i.queued_for_print_at,
      'waiting_hours', round(extract(epoch FROM (now() - coalesce(i.queued_for_print_at, i.created_at))) / 3600.0, 1),
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
    LEFT JOIN public.omni_comms_message m ON m.id = i.message_id
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
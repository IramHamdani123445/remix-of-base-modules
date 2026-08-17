CREATE OR REPLACE FUNCTION public.omni_comms_print_audit_list(
  p_organization_id uuid,
  p_search text DEFAULT NULL,
  p_outcome text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
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
    AND (coalesce(btrim(p_outcome),'') = '' OR i.physical_status = p_outcome)
    AND (coalesce(btrim(p_search),'') = ''
         OR i.letter_reference ILIKE '%' || p_search || '%'
         OR coalesce(i.artefact_checksum_sha256,'') ILIKE '%' || p_search || '%');

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'created_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', i.id,
      'created_at', i.created_at,
      'letter_reference', i.letter_reference,
      'module_code', e.module_code,
      'event_code', e.code,
      'physical_status', i.physical_status,
      'page_count', i.page_count,
      'attempt_count', i.attempt_count,
      'checksum_sha256', i.artefact_checksum_sha256,
      'recipient_display', CASE WHEN v_full THEN i.recipient_display
                                ELSE left(coalesce(i.recipient_display,'-'),1) || '***' END,
      'queued_for_print_at', i.queued_for_print_at,
      'last_equipment_reference', att.equipment_reference,
      'last_equipment_name', eq.display_name,
      'last_outcome', att.outcome,
      'last_printed_at', att.completed_at,
      'last_operator', att.operator_id
    ) AS r
    FROM public.omni_comms_print_item i
    LEFT JOIN public.omni_comms_request req ON req.id = i.request_id
    LEFT JOIN public.omni_comms_event_definition e ON e.id = req.event_definition_id
    LEFT JOIN LATERAL (
      SELECT a.equipment_reference, a.outcome, a.completed_at, a.operator_id
      FROM public.omni_comms_print_attempt a
      WHERE a.print_item_id = i.id
      ORDER BY a.attempt_number DESC LIMIT 1
    ) att ON true
    LEFT JOIN public.omni_comms_print_equipment eq
      ON eq.organization_id = i.organization_id AND eq.code = att.equipment_reference
    WHERE i.organization_id = p_organization_id
      AND (p_department_id IS NULL OR i.department_id = p_department_id)
      AND (coalesce(btrim(p_outcome),'') = '' OR i.physical_status = p_outcome)
      AND (coalesce(btrim(p_search),'') = ''
           OR i.letter_reference ILIKE '%' || p_search || '%'
           OR coalesce(i.artefact_checksum_sha256,'') ILIKE '%' || p_search || '%')
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

REVOKE ALL ON FUNCTION public.omni_comms_print_audit_list(uuid,text,text,uuid,integer,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_audit_list(uuid,text,text,uuid,integer,integer) TO authenticated, service_role;
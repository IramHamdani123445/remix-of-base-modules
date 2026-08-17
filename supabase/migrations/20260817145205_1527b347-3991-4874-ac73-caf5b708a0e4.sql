CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_stationery_effective(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org public.core_organization;
  v_prof public.core_department_profile;
  v_lh_id uuid;
  v_pf_id uuid;
  v_lh_source text := 'organization';
  v_pf_source text := 'organization';
  v_lh public.comm_letterhead;
  v_pf public.comm_print_footer;
  v_logo text;
  v_logo_bucket text;
  v_logo_path text;
BEGIN
  SELECT * INTO v_org FROM public.core_organization
   WHERE p_organization_id IS NULL OR id = p_organization_id
   ORDER BY (id = p_organization_id) DESC LIMIT 1;

  v_lh_id := v_org.default_letterhead_id;
  v_pf_id := v_org.default_print_footer_id;

  IF p_department_id IS NOT NULL THEN
    SELECT * INTO v_prof FROM public.core_department_profile
     WHERE department_id = p_department_id LIMIT 1;
    IF FOUND THEN
      IF coalesce(v_prof.inherit_letterhead_from_org, true) = false
         AND v_prof.default_letterhead_id IS NOT NULL THEN
        v_lh_id := v_prof.default_letterhead_id;
        v_lh_source := 'department';
      END IF;
      IF coalesce(v_prof.inherit_print_footer_from_org, true) = false
         AND v_prof.default_print_footer_id IS NOT NULL THEN
        v_pf_id := v_prof.default_print_footer_id;
        v_pf_source := 'department';
      END IF;
    END IF;
  END IF;

  IF v_lh_id IS NOT NULL THEN
    SELECT * INTO v_lh FROM public.comm_letterhead WHERE id = v_lh_id AND coalesce(is_active, true) LIMIT 1;
  END IF;
  IF v_pf_id IS NOT NULL THEN
    SELECT * INTO v_pf FROM public.comm_print_footer WHERE id = v_pf_id AND coalesce(is_active, true) LIMIT 1;
  END IF;

  -- Letterhead logo: prefer the letterhead-specific mark, fall back to the
  -- main organisation logo. Storage-relative paths resolve in `comm-assets`.
  v_logo := nullif(btrim(coalesce(v_lh.secondary_logo_url, v_lh.logo_url, '')), '');
  IF v_logo IS NOT NULL THEN
    IF v_logo ~* '^https?://' THEN
      v_logo_bucket := NULL;
      v_logo_path := v_logo;
    ELSE
      v_logo_bucket := 'comm-assets';
      v_logo_path := regexp_replace(v_logo, '^/+', '');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'letterhead_id', v_lh.id,
    'letterhead_name', v_lh.name,
    'letterhead_source', CASE WHEN v_lh.id IS NULL THEN NULL ELSE v_lh_source END,
    'header_lines', public.omni_comms_priv_print_html_to_lines(v_lh.header_html),
    'letterhead_footer_lines', public.omni_comms_priv_print_html_to_lines(v_lh.footer_html),
    'logo_bucket', v_logo_bucket,
    'logo_path', v_logo_path,
    'logo_name', v_logo,
    'print_footer_id', v_pf.id,
    'print_footer_name', v_pf.name,
    'print_footer_source', CASE WHEN v_pf.id IS NULL THEN NULL ELSE v_pf_source END,
    'footer_lines', public.omni_comms_priv_print_html_to_lines(v_pf.footer_html),
    'page_footer', nullif(btrim(coalesce(v_pf.page_footer, '')), '')
  );
END;
$function$;

-- Print audit evidence: every produced artefact with outcome, device and checksum.
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
      'last_operator', att.performed_by
    ) AS r
    FROM public.omni_comms_print_item i
    LEFT JOIN public.omni_comms_request req ON req.id = i.request_id
    LEFT JOIN public.omni_comms_event_definition e ON e.id = req.event_definition_id
    LEFT JOIN LATERAL (
      SELECT a.equipment_reference, a.outcome, a.completed_at, a.performed_by
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
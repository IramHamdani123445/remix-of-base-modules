-- Resolve a media library asset by asset_code into bucket + path (or absolute URL).
CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_media_asset(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.comm_media_asset;
  v_ref text;
BEGIN
  IF nullif(btrim(coalesce(p_code, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v FROM public.comm_media_asset
   WHERE asset_code = p_code
   ORDER BY coalesce(is_active, false) DESC, updated_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', p_code, 'found', false);
  END IF;

  v_ref := nullif(btrim(coalesce(v.external_url, '')), '');

  RETURN jsonb_build_object(
    'code', p_code,
    'found', true,
    'is_active', coalesce(v.is_active, false),
    'name', v.name,
    'mime_type', v.mime_type,
    'bucket', CASE WHEN v_ref IS NOT NULL THEN NULL
                   WHEN nullif(btrim(coalesce(v.storage_path, '')), '') IS NOT NULL THEN 'comm-assets'
                   ELSE NULL END,
    'path', CASE WHEN v_ref IS NOT NULL THEN v_ref
                 WHEN nullif(btrim(coalesce(v.storage_path, '')), '') IS NOT NULL
                   THEN regexp_replace(v.storage_path, '^/+', '')
                 ELSE NULL END
  );
END;
$function$;

-- Render one office location into display lines, honouring the letterhead field flags.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_office_lines(p_loc public.office_locations, p_design jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_lines text[] := ARRAY[]::text[];
  v_city text;
  v_contact text[] := ARRAY[]::text[];
BEGIN
  IF p_loc.id IS NULL THEN RETURN v_lines; END IF;

  IF coalesce((p_design->>'show_address')::boolean, true) THEN
    IF nullif(btrim(coalesce(p_loc.address, '')), '') IS NOT NULL THEN
      v_lines := v_lines || p_loc.address;
    END IF;
    v_city := array_to_string(
      ARRAY(SELECT x FROM unnest(ARRAY[
        nullif(btrim(coalesce(p_loc.parish_city, p_loc.city, '')), ''),
        nullif(btrim(coalesce(p_loc.state, p_loc.island_or_region, '')), '')
      ]) AS x WHERE x IS NOT NULL), ', ');
    IF nullif(v_city, '') IS NOT NULL THEN v_lines := v_lines || v_city; END IF;
    IF nullif(btrim(coalesce(p_loc.country, '')), '') IS NOT NULL THEN
      v_lines := v_lines || p_loc.country;
    END IF;
  END IF;

  IF coalesce((p_design->>'show_phone')::boolean, true)
     AND nullif(btrim(coalesce(p_loc.phone, '')), '') IS NOT NULL THEN
    v_contact := v_contact || ('Tel: ' || p_loc.phone);
  END IF;
  IF coalesce((p_design->>'show_fax')::boolean, true)
     AND nullif(btrim(coalesce(p_loc.fax, '')), '') IS NOT NULL THEN
    v_contact := v_contact || ('Fax: ' || p_loc.fax);
  END IF;
  IF array_length(v_contact, 1) IS NOT NULL THEN
    v_lines := v_lines || array_to_string(v_contact, '   ');
  END IF;

  IF coalesce((p_design->>'show_email')::boolean, true)
     AND nullif(btrim(coalesce(p_loc.email, '')), '') IS NOT NULL THEN
    v_lines := v_lines || p_loc.email;
  END IF;

  RETURN v_lines;
END;
$function$;

-- Pick a location for a letterhead office block role.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_pick_location(
  p_role text, p_specific_id uuid, p_org_id uuid
) RETURNS public.office_locations
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.office_locations;
BEGIN
  IF p_role = 'SPECIFIC' AND p_specific_id IS NOT NULL THEN
    SELECT * INTO v FROM public.office_locations
     WHERE id = p_specific_id AND coalesce(is_active, true) LIMIT 1;
    RETURN v;
  ELSIF p_role = 'HEAD_OFFICE' THEN
    SELECT * INTO v FROM public.office_locations
     WHERE coalesce(is_active, true) AND location_type = 'HEAD_OFFICE'
       AND (p_org_id IS NULL OR organization_id = p_org_id)
     ORDER BY created_at LIMIT 1;
    RETURN v;
  ELSIF p_role = 'PRIMARY' THEN
    SELECT * INTO v FROM public.office_locations
     WHERE coalesce(is_active, true) AND coalesce(is_primary, false)
       AND (p_org_id IS NULL OR organization_id = p_org_id)
     ORDER BY created_at LIMIT 1;
    RETURN v;
  ELSIF p_role = 'FIRST_BRANCH' THEN
    SELECT * INTO v FROM public.office_locations
     WHERE coalesce(is_active, true) AND coalesce(is_primary, false) = false
       AND (p_org_id IS NULL OR organization_id = p_org_id)
     ORDER BY branch_name LIMIT 1;
    RETURN v;
  END IF;
  RETURN v;
END;
$function$;

-- Full effective letterhead for print: layout + live content + media assets.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_letterhead_effective(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_base jsonb;
  v_org public.core_organization;
  v_prof public.core_department_profile;
  v_lh_id uuid;
  v_lh public.comm_letterhead;
  v_lh_source text := 'organization';
  v_design jsonb := '{}'::jsonb;
  v_variant text;
  v_block_layout text;
  v_show_head boolean;
  v_show_branch boolean;
  v_head public.office_locations;
  v_branch public.office_locations;
  v_head_lines text[] := ARRAY[]::text[];
  v_branch_lines text[] := ARRAY[]::text[];
  v_footer_note text;
  v_footer_source text := 'empty';
  v_branch_role text;
BEGIN
  -- Legacy/compat stationery (header_lines, print footer, page footer, logo).
  v_base := public.omni_comms_priv_print_stationery_effective(p_organization_id, p_department_id);

  SELECT * INTO v_org FROM public.core_organization
   WHERE p_organization_id IS NULL OR id = p_organization_id
   ORDER BY (id = p_organization_id) DESC LIMIT 1;

  v_lh_id := v_org.default_letterhead_id;

  IF p_department_id IS NOT NULL THEN
    SELECT * INTO v_prof FROM public.core_department_profile
     WHERE department_id = p_department_id LIMIT 1;
    IF FOUND AND coalesce(v_prof.inherit_letterhead_from_org, true) = false
       AND v_prof.default_letterhead_id IS NOT NULL THEN
      v_lh_id := v_prof.default_letterhead_id;
      v_lh_source := 'department';
    END IF;
  END IF;

  IF v_lh_id IS NOT NULL THEN
    SELECT * INTO v_lh FROM public.comm_letterhead
     WHERE id = v_lh_id AND coalesce(is_active, true) LIMIT 1;
  END IF;

  IF v_lh.id IS NULL THEN
    RETURN v_base || jsonb_build_object('letterhead_design', NULL);
  END IF;

  v_design := coalesce(v_lh.design_config, '{}'::jsonb);
  v_variant := coalesce(
    nullif(v_design->>'layout_variant', ''),
    CASE WHEN nullif(v_design->>'header_asset_code', '') IS NOT NULL
         THEN 'image_bands' ELSE 'ssb_standard' END);
  v_block_layout := coalesce(nullif(v_design->>'office_block_layout', ''), 'left_right');
  v_branch_role := coalesce(nullif(v_design->>'branch_office_location_role', ''), 'FIRST_BRANCH');

  v_show_head := coalesce((v_design->>'show_head_office_block')::boolean, true)
                 AND v_block_layout NOT IN ('none', 'header_only');
  v_show_branch := coalesce((v_design->>'show_branch_office_block')::boolean, true)
                 AND v_block_layout NOT IN ('none', 'header_only')
                 AND v_branch_role <> 'NONE';

  IF v_show_head THEN
    v_head := public.omni_comms_priv_print_pick_location(
      coalesce(nullif(v_design->>'head_office_location_role', ''), 'PRIMARY'),
      nullif(v_design->>'head_office_location_id', '')::uuid, v_org.id);
    v_head_lines := public.omni_comms_priv_print_office_lines(v_head, v_design);
    IF array_length(v_head_lines, 1) IS NULL THEN
      SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_head_lines
        FROM jsonb_array_elements_text(coalesce(v_design#>'{head_office,lines}', '[]'::jsonb)) AS x;
    END IF;
  END IF;

  IF v_show_branch THEN
    v_branch := public.omni_comms_priv_print_pick_location(
      v_branch_role, nullif(v_design->>'branch_office_location_id', '')::uuid, v_org.id);
    v_branch_lines := public.omni_comms_priv_print_office_lines(v_branch, v_design);
    IF array_length(v_branch_lines, 1) IS NULL THEN
      SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_branch_lines
        FROM jsonb_array_elements_text(coalesce(v_design#>'{branch_office,lines}', '[]'::jsonb)) AS x;
    END IF;
  END IF;

  IF nullif(v_design->>'footer_note_text_block_code', '') IS NOT NULL THEN
    SELECT nullif(btrim(coalesce(tb.content_text, '')), '')
      INTO v_footer_note
      FROM public.core_text_block tb
     WHERE tb.text_block_code = v_design->>'footer_note_text_block_code'
       AND coalesce(tb.is_active, true)
     ORDER BY tb.version_no DESC NULLS LAST
     LIMIT 1;
    IF v_footer_note IS NOT NULL THEN v_footer_source := 'text_block'; END IF;
  END IF;
  IF v_footer_note IS NULL AND nullif(btrim(coalesce(v_design->>'footer_note', '')), '') IS NOT NULL THEN
    v_footer_note := v_design->>'footer_note';
    v_footer_source := 'fallback';
  END IF;

  RETURN v_base || jsonb_build_object(
    'letterhead_design', jsonb_build_object(
      'letterhead_id', v_lh.id,
      'letterhead_code', v_lh.code,
      'letterhead_name', v_lh.name,
      'letterhead_source', v_lh_source,
      'layout_variant', v_variant,
      'page_size', coalesce(nullif(v_design->>'page_size', ''), 'A4'),
      'orientation', coalesce(nullif(v_design->>'orientation', ''), 'portrait'),
      'margins', coalesce(v_design->'margins', '{}'::jsonb),
      'divider_color', coalesce(nullif(v_design->>'divider_color', ''), '#2E7D32'),
      'office_block_layout', v_block_layout,
      'organization_name', CASE WHEN coalesce((v_design->>'show_organization_name')::boolean, true)
                                THEN coalesce(v_org.legal_name, nullif(v_design->>'organization_name', ''))
                                ELSE NULL END,
      'tagline', CASE WHEN coalesce((v_design->>'show_tagline')::boolean, true)
                      THEN nullif(v_design->>'tagline', '') ELSE NULL END,
      'head_office', jsonb_build_object(
        'label', coalesce(nullif(v_design->>'head_office_label', ''), 'Head Office:'),
        'lines', to_jsonb(coalesce(v_head_lines, ARRAY[]::text[]))),
      'branch_office', jsonb_build_object(
        'label', coalesce(nullif(v_design->>'branch_office_label', ''), 'Branch Office:'),
        'lines', to_jsonb(coalesce(v_branch_lines, ARRAY[]::text[]))),
      'footer_note', v_footer_note,
      'footer_note_source', v_footer_source,
      'assets', jsonb_strip_nulls(jsonb_build_object(
        'logo', public.omni_comms_priv_print_media_asset(v_design->>'logo_asset_code'),
        'watermark', public.omni_comms_priv_print_media_asset(v_design->>'watermark_asset_code'),
        'seal', public.omni_comms_priv_print_media_asset(v_design->>'seal_asset_code'),
        'header_band', public.omni_comms_priv_print_media_asset(v_design->>'header_asset_code'),
        'footer_band', public.omni_comms_priv_print_media_asset(v_design->>'footer_asset_code')
      ))
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_letterhead_effective(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_media_asset(text) TO service_role;
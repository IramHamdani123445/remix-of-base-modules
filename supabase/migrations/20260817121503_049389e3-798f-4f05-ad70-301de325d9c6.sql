CREATE OR REPLACE FUNCTION public.omni_comms_print_discovery_source_list(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_items jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'code', s.code,
           'display_name', s.display_name,
           'mode', s.mode,
           'endpoint_url', s.endpoint_url,
           'status', s.status,
           'department_id', s.department_id,
           'production_account_id', s.production_account_id,
           'last_sync_at', s.last_sync_at,
           'last_sync_status', s.last_sync_status,
           'last_sync_detail', s.last_sync_detail,
           'last_discovered_count', s.last_discovered_count,
           'updated_at', s.updated_at
         ) ORDER BY s.status, s.display_name), '[]'::jsonb)
    INTO v_items
  FROM public.omni_comms_print_discovery_source s
  WHERE s.organization_id = p_organization_id
    AND (p_department_id IS NULL OR s.department_id IS NULL OR s.department_id = p_department_id)
    AND s.status <> 'retired';

  RETURN jsonb_build_object(
    'items', v_items,
    'manage_permitted', public.has_permission(v_uid, 'omni_comms', 'configure'),
    'generated_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_discovery_source_upsert(p_organization_id uuid, p_code text, p_display_name text, p_endpoint_url text, p_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT 'print_agent'::text, p_production_account_id uuid DEFAULT NULL::uuid, p_auth_secret_ref text DEFAULT NULL::text, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('configure');
  v_row public.omni_comms_print_discovery_source%ROWTYPE;
  v_code text := upper(btrim(coalesce(p_code,'')));
  v_url text := btrim(coalesce(p_endpoint_url,''));
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  IF v_code = '' OR coalesce(btrim(p_display_name),'') = '' OR v_url = '' THEN
    RAISE EXCEPTION 'OC422 print_discovery_details_required' USING ERRCODE='P0001', DETAIL='code_name_endpoint_required';
  END IF;
  IF v_url !~* '^https://' THEN
    RAISE EXCEPTION 'OC422 print_discovery_endpoint_insecure' USING ERRCODE='P0001', DETAIL='https_endpoint_required';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_print_discovery_source (
      organization_id, department_id, production_account_id, code, display_name,
      mode, endpoint_url, auth_secret_ref, status, created_by, updated_by)
    VALUES (p_organization_id, p_department_id, p_production_account_id, v_code,
            btrim(p_display_name), coalesce(p_mode,'print_agent'), v_url,
            nullif(btrim(coalesce(p_auth_secret_ref,'')),''), coalesce(p_status,'active'), v_uid, v_uid)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.omni_comms_print_discovery_source
       SET code = v_code, display_name = btrim(p_display_name),
           department_id = p_department_id,
           production_account_id = p_production_account_id,
           mode = coalesce(p_mode, mode), endpoint_url = v_url,
           auth_secret_ref = nullif(btrim(coalesce(p_auth_secret_ref,'')),''),
           status = coalesce(p_status, status), updated_at = now(), updated_by = v_uid
     WHERE id = p_id AND organization_id = p_organization_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'OC404 print_discovery_source_not_found' USING ERRCODE='P0001', DETAIL='print_discovery_source_not_found';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, new_value, metadata)
  VALUES (v_uid, CASE WHEN p_id IS NULL THEN 'omni_comms.print_discovery_source.created'
                      ELSE 'omni_comms.print_discovery_source.updated' END,
          'omni_comms', 'omni_comms_print_discovery_source', v_row.id::text, v_row.code,
          jsonb_build_object('mode', v_row.mode, 'status', v_row.status));

  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_equipment_sync(p_source_id uuid, p_printers jsonb, p_sync_status text DEFAULT 'ok'::text, p_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_src public.omni_comms_print_discovery_source%ROWTYPE;
  v_item jsonb;
  v_code text;
  v_queue text;
  v_seen text[] := ARRAY[]::text[];
  v_created int := 0;
  v_updated int := 0;
  v_retired int := 0;
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.omni_comms_priv_require_capability('configure');
  END IF;

  SELECT * INTO v_src FROM public.omni_comms_print_discovery_source WHERE id = p_source_id;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_discovery_source_not_found' USING ERRCODE='P0001', DETAIL='print_discovery_source_not_found';
  END IF;

  IF coalesce(p_sync_status,'ok') = 'ok' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_printers,'[]'::jsonb))
    LOOP
      v_queue := btrim(coalesce(v_item->>'queue_name',''));
      CONTINUE WHEN v_queue = '';
      v_code := left(v_src.code || '-' || upper(regexp_replace(v_queue, '[^A-Za-z0-9]+', '-', 'g')), 60);
      v_seen := v_seen || v_code;

      INSERT INTO public.omni_comms_print_equipment (
        organization_id, department_id, code, display_name, location, device_type,
        production_account_id, paper_sizes, duplex_capable, colour_capable, status,
        discovery_source, discovery_source_id, queue_name, device_uri, last_seen_at,
        discovery_metadata, created_by, updated_by)
      VALUES (
        v_src.organization_id, v_src.department_id, v_code,
        coalesce(nullif(btrim(coalesce(v_item->>'display_name','')),''), v_queue),
        nullif(btrim(coalesce(v_item->>'location','')),''),
        coalesce(nullif(v_item->>'device_type',''),'printer'),
        v_src.production_account_id,
        coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(v_item->'paper_sizes','[]'::jsonb)) t(x)), ARRAY['A4']::text[]),
        coalesce((v_item->>'duplex_capable')::boolean, true),
        coalesce((v_item->>'colour_capable')::boolean, false),
        'active', 'ipp_sync', v_src.id, v_queue,
        nullif(btrim(coalesce(v_item->>'device_uri','')),''), now(),
        coalesce(v_item->'metadata','{}'::jsonb), NULL, NULL)
      ON CONFLICT (organization_id, code) DO UPDATE
        SET display_name = excluded.display_name,
            location = coalesce(excluded.location, public.omni_comms_print_equipment.location),
            queue_name = excluded.queue_name,
            device_uri = coalesce(excluded.device_uri, public.omni_comms_print_equipment.device_uri),
            duplex_capable = excluded.duplex_capable,
            colour_capable = excluded.colour_capable,
            paper_sizes = excluded.paper_sizes,
            discovery_source = 'ipp_sync',
            discovery_source_id = excluded.discovery_source_id,
            production_account_id = coalesce(excluded.production_account_id, public.omni_comms_print_equipment.production_account_id),
            status = CASE WHEN public.omni_comms_print_equipment.status = 'retired' THEN 'active'
                          ELSE public.omni_comms_print_equipment.status END,
            last_seen_at = now(),
            discovery_metadata = excluded.discovery_metadata,
            updated_at = now();

      IF FOUND THEN v_updated := v_updated + 1; ELSE v_created := v_created + 1; END IF;
    END LOOP;

    UPDATE public.omni_comms_print_equipment
       SET status = 'retired', is_default = false, updated_at = now()
     WHERE discovery_source_id = v_src.id
       AND status <> 'retired'
       AND NOT (code = ANY (v_seen));
    GET DIAGNOSTICS v_retired = ROW_COUNT;

    IF NOT EXISTS (
      SELECT 1 FROM public.omni_comms_print_equipment d
       WHERE d.organization_id = v_src.organization_id
         AND coalesce(d.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(v_src.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
         AND d.is_default AND d.status = 'active')
    THEN
      UPDATE public.omni_comms_print_equipment
         SET is_default = true, updated_at = now()
       WHERE id = (
         SELECT e.id FROM public.omni_comms_print_equipment e
          WHERE e.organization_id = v_src.organization_id
            AND coalesce(e.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
                = coalesce(v_src.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
            AND e.status = 'active'
          ORDER BY e.display_name LIMIT 1);
    END IF;
  END IF;

  UPDATE public.omni_comms_print_discovery_source
     SET last_sync_at = now(),
         last_sync_status = coalesce(p_sync_status,'ok'),
         last_sync_detail = left(coalesce(p_detail,''), 500),
         last_discovered_count = CASE WHEN coalesce(p_sync_status,'ok') = 'ok'
                                      THEN jsonb_array_length(coalesce(p_printers,'[]'::jsonb))
                                      ELSE last_discovered_count END,
         updated_at = now()
   WHERE id = v_src.id;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, new_value, metadata)
  VALUES (v_uid, 'omni_comms.print_equipment.synced', 'omni_comms',
          'omni_comms_print_discovery_source', v_src.id::text, coalesce(p_sync_status,'ok'),
          jsonb_build_object('created', v_created, 'updated', v_updated, 'retired', v_retired));

  RETURN jsonb_build_object('source_id', v_src.id, 'status', coalesce(p_sync_status,'ok'),
                            'created', v_created, 'updated', v_updated, 'retired', v_retired);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_print_equipment_sync(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_equipment_sync(uuid, jsonb, text, text) TO service_role, authenticated;
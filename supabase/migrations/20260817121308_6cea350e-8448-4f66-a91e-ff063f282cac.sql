CREATE OR REPLACE FUNCTION public.omni_comms_print_equipment_list(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_include_inactive boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_items jsonb;
  v_default text;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'code', e.code,
           'display_name', e.display_name,
           'location', e.location,
           'device_type', e.device_type,
           'status', e.status,
           'department_id', e.department_id,
           'production_account_id', e.production_account_id,
           'production_account_name', pa.display_name,
           'paper_sizes', to_jsonb(e.paper_sizes),
           'duplex_capable', e.duplex_capable,
           'colour_capable', e.colour_capable,
           'notes', e.notes,
           'is_default', e.is_default,
           'discovery_source', e.discovery_source,
           'queue_name', e.queue_name,
           'device_uri', e.device_uri,
           'last_seen_at', e.last_seen_at,
           'updated_at', e.updated_at
         ) ORDER BY e.is_default DESC, e.status, e.display_name), '[]'::jsonb)
    INTO v_items
  FROM public.omni_comms_print_equipment e
  LEFT JOIN public.omni_comms_provider_account pa ON pa.id = e.production_account_id
  WHERE e.organization_id = p_organization_id
    AND (p_department_id IS NULL OR e.department_id IS NULL OR e.department_id = p_department_id)
    AND (coalesce(p_include_inactive,false) OR e.status = 'active');

  SELECT e.code INTO v_default
  FROM public.omni_comms_print_equipment e
  WHERE e.organization_id = p_organization_id
    AND e.status = 'active' AND e.is_default
    AND (p_department_id IS NULL OR e.department_id IS NULL OR e.department_id = p_department_id)
  ORDER BY (e.department_id IS NOT NULL) DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'items', v_items,
    'default_code', v_default,
    'manage_permitted', public.has_permission(v_uid, 'omni_comms', 'configure'),
    'generated_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_equipment_set_default(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('configure');
  v_row public.omni_comms_print_equipment%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.omni_comms_print_equipment WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_equipment_not_found' USING ERRCODE='P0001', DETAIL='print_equipment_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_row.organization_id, v_row.department_id);
  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'OC422 print_equipment_inactive' USING ERRCODE='P0001', DETAIL='only_active_device_can_be_default';
  END IF;

  UPDATE public.omni_comms_print_equipment
     SET is_default = false, updated_at = now(), updated_by = v_uid
   WHERE organization_id = v_row.organization_id
     AND coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_row.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND is_default AND id <> v_row.id;

  UPDATE public.omni_comms_print_equipment
     SET is_default = true, updated_at = now(), updated_by = v_uid
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, new_value)
  VALUES (v_uid, 'omni_comms.print_equipment.default_set', 'omni_comms',
          'omni_comms_print_equipment', v_row.id::text, v_row.code);

  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'is_default', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_equipment_upsert(p_organization_id uuid, p_code text, p_display_name text, p_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid, p_location text DEFAULT NULL::text, p_device_type text DEFAULT 'printer'::text, p_production_account_id uuid DEFAULT NULL::uuid, p_paper_sizes text[] DEFAULT NULL::text[], p_duplex_capable boolean DEFAULT true, p_colour_capable boolean DEFAULT false, p_status text DEFAULT 'active'::text, p_notes text DEFAULT NULL::text, p_is_default boolean DEFAULT NULL::boolean, p_queue_name text DEFAULT NULL::text, p_device_uri text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('configure');
  v_row public.omni_comms_print_equipment%ROWTYPE;
  v_code text := upper(btrim(coalesce(p_code,'')));
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  IF v_code = '' OR coalesce(btrim(p_display_name),'') = '' THEN
    RAISE EXCEPTION 'OC422 print_equipment_details_required'
      USING ERRCODE='P0001', DETAIL='code_and_name_required';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_print_equipment (
      organization_id, department_id, code, display_name, location, device_type,
      production_account_id, paper_sizes, duplex_capable, colour_capable, status,
      notes, queue_name, device_uri, created_by, updated_by)
    VALUES (
      p_organization_id, p_department_id, v_code, btrim(p_display_name),
      nullif(btrim(coalesce(p_location,'')),''), coalesce(p_device_type,'printer'),
      p_production_account_id, coalesce(p_paper_sizes, ARRAY['A4']::text[]),
      coalesce(p_duplex_capable,true), coalesce(p_colour_capable,false),
      coalesce(p_status,'active'), nullif(btrim(coalesce(p_notes,'')),''),
      nullif(btrim(coalesce(p_queue_name,'')),''), nullif(btrim(coalesce(p_device_uri,'')),''),
      v_uid, v_uid)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.omni_comms_print_equipment
       SET code = v_code,
           display_name = btrim(p_display_name),
           department_id = p_department_id,
           location = nullif(btrim(coalesce(p_location,'')),''),
           device_type = coalesce(p_device_type, device_type),
           production_account_id = p_production_account_id,
           paper_sizes = coalesce(p_paper_sizes, paper_sizes),
           duplex_capable = coalesce(p_duplex_capable, duplex_capable),
           colour_capable = coalesce(p_colour_capable, colour_capable),
           status = coalesce(p_status, status),
           notes = nullif(btrim(coalesce(p_notes,'')),''),
           queue_name = coalesce(nullif(btrim(coalesce(p_queue_name,'')),''), queue_name),
           device_uri = coalesce(nullif(btrim(coalesce(p_device_uri,'')),''), device_uri),
           updated_at = now(),
           updated_by = v_uid
     WHERE id = p_id AND organization_id = p_organization_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'OC404 print_equipment_not_found' USING ERRCODE='P0001', DETAIL='print_equipment_not_found';
    END IF;
  END IF;

  IF coalesce(p_is_default,false) AND v_row.status = 'active' THEN
    PERFORM public.omni_comms_print_equipment_set_default(v_row.id);
    v_row.is_default := true;
  ELSIF NOT EXISTS (
      SELECT 1 FROM public.omni_comms_print_equipment d
       WHERE d.organization_id = v_row.organization_id
         AND coalesce(d.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(v_row.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
         AND d.is_default AND d.status = 'active')
    AND v_row.status = 'active' THEN
    PERFORM public.omni_comms_print_equipment_set_default(v_row.id);
    v_row.is_default := true;
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id,
                                 old_value, new_value, metadata)
  VALUES (v_uid, CASE WHEN p_id IS NULL THEN 'omni_comms.print_equipment.created'
                      ELSE 'omni_comms.print_equipment.updated' END,
          'omni_comms', 'omni_comms_print_equipment', v_row.id::text, NULL, v_row.code,
          jsonb_strip_nulls(jsonb_build_object(
            'display_name', v_row.display_name,
            'status', v_row.status,
            'device_type', v_row.device_type,
            'location', v_row.location,
            'queue_name', v_row.queue_name)));

  RETURN jsonb_build_object(
    'id', v_row.id, 'code', v_row.code, 'display_name', v_row.display_name,
    'status', v_row.status, 'is_default', coalesce(v_row.is_default,false),
    'updated_at', v_row.updated_at);
END;
$function$;
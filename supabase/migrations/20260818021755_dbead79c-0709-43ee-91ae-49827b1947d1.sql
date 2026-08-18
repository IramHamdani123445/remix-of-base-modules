CREATE OR REPLACE FUNCTION public.omni_comms_template_business_catalogue(
  p_organization_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_modules jsonb;
  v_shared jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');

  WITH fam AS (
    SELECT f.id, f.code, f.name, f.status, f.scope_type, f.department_id,
           f.event_definition_id, f.organization_id
      FROM public.omni_comms_template_family f
     WHERE (p_organization_id IS NULL OR f.organization_id = p_organization_id)
  ), chan AS (
    SELECT v.template_family_id, v.channel,
           (ARRAY_AGG(v.id ORDER BY
              CASE v.status WHEN 'published' THEN 1 WHEN 'approved' THEN 2
                            WHEN 'draft' THEN 3 ELSE 4 END,
              v.version_number DESC))[1] AS version_id,
           (ARRAY_AGG(v.status ORDER BY
              CASE v.status WHEN 'published' THEN 1 WHEN 'approved' THEN 2
                            WHEN 'draft' THEN 3 ELSE 4 END,
              v.version_number DESC))[1] AS status,
           (ARRAY_AGG(v.version_number ORDER BY
              CASE v.status WHEN 'published' THEN 1 WHEN 'approved' THEN 2
                            WHEN 'draft' THEN 3 ELSE 4 END,
              v.version_number DESC))[1] AS version_number,
           count(*) AS version_count
      FROM public.omni_comms_template_version v
     GROUP BY v.template_family_id, v.channel
  ), fam_json AS (
    SELECT f.*, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'channel', c.channel, 'version_id', c.version_id,
               'status', c.status, 'version_number', c.version_number,
               'version_count', c.version_count) ORDER BY c.channel)
        FROM chan c WHERE c.template_family_id = f.id), '[]'::jsonb) AS channels
      FROM fam f
  ), ev AS (
    SELECT e.id, e.code, e.name, e.module_code,
           COALESCE(e.business_object_code, e.entity_type) AS business_object_code,
           e.display_order, e.communication_class, e.status
      FROM public.omni_comms_event_definition e
  ), ev_json AS (
    SELECT ev.*, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'code', f.code, 'name', f.name, 'status', f.status,
               'scope_type', f.scope_type, 'department_id', f.department_id,
               'channels', f.channels) ORDER BY f.name)
        FROM fam_json f WHERE f.event_definition_id = ev.id), '[]'::jsonb) AS actions
      FROM ev
  ), bo AS (
    SELECT ev_json.module_code, ev_json.business_object_code AS code,
           COALESCE(b.name, initcap(replace(lower(ev_json.business_object_code), '_', ' '))) AS name,
           COALESCE(b.display_order, 1000) AS display_order,
           jsonb_agg(jsonb_build_object(
             'id', ev_json.id, 'code', ev_json.code, 'name', ev_json.name,
             'status', ev_json.status,
             'communication_class', ev_json.communication_class,
             'display_order', ev_json.display_order,
             'actions', ev_json.actions)
             ORDER BY ev_json.display_order, ev_json.name) AS events
      FROM ev_json
      LEFT JOIN public.omni_comms_business_object b
             ON b.module_code = ev_json.module_code
            AND b.code = ev_json.business_object_code
     GROUP BY 1,2,3,4
  )
  SELECT COALESCE(jsonb_agg(m ORDER BY m->>'module_code'), '[]'::jsonb)
    INTO v_modules
    FROM (
      SELECT jsonb_build_object(
               'module_code', bo.module_code,
               'module_name', initcap(replace(lower(bo.module_code), '_', ' ')),
               'business_objects', jsonb_agg(jsonb_build_object(
                  'code', bo.code, 'name', bo.name,
                  'display_order', bo.display_order,
                  'events', bo.events) ORDER BY bo.display_order, bo.name)
             ) AS m
        FROM bo GROUP BY bo.module_code
    ) s;

  WITH fam AS (
    SELECT f.id, f.code, f.name, f.status, f.scope_type, f.department_id, f.event_definition_id
      FROM public.omni_comms_template_family f
     WHERE (p_organization_id IS NULL OR f.organization_id = p_organization_id)
       AND f.event_definition_id IS NULL
  ), chan AS (
    SELECT v.template_family_id, v.channel,
           (ARRAY_AGG(v.id ORDER BY
              CASE v.status WHEN 'published' THEN 1 WHEN 'approved' THEN 2
                            WHEN 'draft' THEN 3 ELSE 4 END,
              v.version_number DESC))[1] AS version_id,
           (ARRAY_AGG(v.status ORDER BY
              CASE v.status WHEN 'published' THEN 1 WHEN 'approved' THEN 2
                            WHEN 'draft' THEN 3 ELSE 4 END,
              v.version_number DESC))[1] AS status,
           (ARRAY_AGG(v.version_number ORDER BY
              CASE v.status WHEN 'published' THEN 1 WHEN 'approved' THEN 2
                            WHEN 'draft' THEN 3 ELSE 4 END,
              v.version_number DESC))[1] AS version_number,
           count(*) AS version_count
      FROM public.omni_comms_template_version v
     GROUP BY v.template_family_id, v.channel
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', f.id, 'code', f.code, 'name', f.name, 'status', f.status,
           'scope_type', f.scope_type, 'department_id', f.department_id,
           'channels', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'channel', c.channel, 'version_id', c.version_id,
                       'status', c.status, 'version_number', c.version_number,
                       'version_count', c.version_count) ORDER BY c.channel)
                FROM chan c WHERE c.template_family_id = f.id), '[]'::jsonb)
         ) ORDER BY f.name), '[]'::jsonb)
    INTO v_shared
    FROM fam f;

  RETURN jsonb_build_object('modules', v_modules, 'shared', v_shared);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_template_business_catalogue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_business_catalogue(uuid) TO authenticated, service_role;
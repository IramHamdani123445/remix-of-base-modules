-- Omni-Comms — Phase 3 Live Health Diagnostics read surface.
-- Four bounded, read-only SECURITY DEFINER RPCs. No mutation, no provider
-- contact, no secret material.

CREATE OR REPLACE FUNCTION public.omni_comms_health_permissions(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_caps jsonb := '{}'::jsonb;
  v_action text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  FOREACH v_action IN ARRAY ARRAY[
    'view','operate','configure','author_templates','approve_templates','view_sensitive_content'
  ] LOOP
    v_caps := v_caps || jsonb_build_object(
      'omni_comms.' || v_action,
      CASE WHEN public.has_permission(v_uid, 'omni_comms', v_action)
           THEN 'granted' ELSE 'not_granted' END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'department_scope', CASE WHEN p_department_id IS NULL THEN 'organization_wide' ELSE 'department' END,
    'tenant_lookup_available', true,
    'capabilities', v_caps,
    'generated_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_health_catalogue(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_events jsonb;
  v_templates jsonb;
  v_assembly jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  SELECT jsonb_build_object(
    'event_definitions', (SELECT count(*) FROM public.omni_comms_event_definition),
    'event_definitions_active', (SELECT count(*) FROM public.omni_comms_event_definition WHERE status = 'active'),
    'published_contracts', (SELECT count(*) FROM public.omni_comms_event_contract WHERE status = 'published'),
    'events_without_published_contract', (
      SELECT count(*) FROM public.omni_comms_event_definition d
       WHERE d.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract c
                          WHERE c.event_definition_id = d.id AND c.status = 'published')),
    'active_event_routes', (
      SELECT count(*) FROM public.omni_comms_event_route r
       WHERE r.organization_id = p_organization_id
         AND r.lifecycle_state = 'active' AND r.is_enabled IS TRUE
         AND (p_department_id IS NULL OR r.department_id IS NOT DISTINCT FROM p_department_id)),
    'events_without_active_route', (
      SELECT count(*) FROM public.omni_comms_event_definition d
       WHERE d.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route r
                          WHERE r.event_definition_id = d.id
                            AND r.organization_id = p_organization_id
                            AND r.lifecycle_state = 'active' AND r.is_enabled IS TRUE)),
    'department_route_overrides', (
      SELECT count(*) FROM public.omni_comms_event_route r
       WHERE r.organization_id = p_organization_id AND r.department_id IS NOT NULL),
    'routes_with_unavailable_template', (
      SELECT count(*) FROM public.omni_comms_event_route r
       LEFT JOIN public.omni_comms_template_family f ON f.id = r.template_family_id
       WHERE r.organization_id = p_organization_id
         AND r.lifecycle_state = 'active'
         AND (r.template_family_id IS NULL OR f.id IS NULL OR f.status <> 'active'))
  ) INTO v_events;

  SELECT jsonb_build_object(
    'template_families', (
      SELECT count(*) FROM public.omni_comms_template_family f
       WHERE f.organization_id IS NOT DISTINCT FROM p_organization_id
          OR f.organization_id IS NULL),
    'template_families_active', (
      SELECT count(*) FROM public.omni_comms_template_family f
       WHERE f.status = 'active'
         AND (f.organization_id IS NOT DISTINCT FROM p_organization_id OR f.organization_id IS NULL)),
    'published_template_versions', (
      SELECT count(*) FROM public.omni_comms_template_version v
       JOIN public.omni_comms_template_family f ON f.id = v.template_family_id
       WHERE v.status = 'published'
         AND (f.organization_id IS NOT DISTINCT FROM p_organization_id OR f.organization_id IS NULL)),
    'families_without_published_version', (
      SELECT count(*) FROM public.omni_comms_template_family f
       WHERE f.status = 'active'
         AND (f.organization_id IS NOT DISTINCT FROM p_organization_id OR f.organization_id IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version v
                          WHERE v.template_family_id = f.id AND v.status = 'published')),
    'templates_without_layout_selection', (
      SELECT count(*) FROM public.omni_comms_template_version v
       JOIN public.omni_comms_template_family f ON f.id = v.template_family_id
       WHERE v.status = 'published'
         AND (f.organization_id IS NOT DISTINCT FROM p_organization_id OR f.organization_id IS NULL)
         AND v.layout_id IS NULL
         AND coalesce(v.layout_selection_mode, 'none') <> 'inherit')
  ) INTO v_templates;

  SELECT jsonb_build_object(
    'layouts', (SELECT count(*) FROM public.core_template_layout WHERE is_active IS TRUE),
    'published_layout_versions', (
      SELECT count(*) FROM public.core_template_layout_version WHERE status = 'published'),
    'required_slots', (
      SELECT count(*) FROM public.core_comm_assignment a
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR a.department_id IS NOT DISTINCT FROM p_department_id)),
    'resolved_assets', (
      SELECT count(*) FROM public.core_comm_assignment a
       JOIN public.core_comm_asset s ON s.id = a.asset_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR a.department_id IS NOT DISTINCT FROM p_department_id)
         AND s.status = 'active' AND s.active_version_id IS NOT NULL),
    'unresolved_required_assets', (
      SELECT count(*) FROM public.core_comm_assignment a
       LEFT JOIN public.core_comm_asset s ON s.id = a.asset_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR a.department_id IS NOT DISTINCT FROM p_department_id)
         AND (a.asset_id IS NULL OR s.id IS NULL OR s.status <> 'active' OR s.active_version_id IS NULL))
  ) INTO v_assembly;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'events', v_events,
    'templates', v_templates,
    'assembly', v_assembly,
    'generated_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_health_runtime(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_since_hours integer DEFAULT 720
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_tables jsonb := '{}'::jsonb;
  v_functions jsonb := '{}'::jsonb;
  v_name text;
  v_counters jsonb;
  v_live boolean;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  FOREACH v_name IN ARRAY ARRAY[
    'omni_comms_request','omni_comms_recipient','omni_comms_message',
    'omni_comms_dispatch_job','omni_comms_delivery_attempt','omni_comms_message_event'
  ] LOOP
    v_tables := v_tables || jsonb_build_object(
      v_name, to_regclass('public.' || v_name) IS NOT NULL);
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY[
    'omni_comms_priv_send_communication',
    'omni_comms_priv_runtime_resolution_snapshot',
    'omni_comms_priv_finalize_resolution',
    'omni_comms_priv_load_render_context',
    'omni_comms_priv_persist_rendered_messages',
    'omni_comms_ops_summary'
  ] LOOP
    v_functions := v_functions || jsonb_build_object(
      v_name,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = v_name));
  END LOOP;

  v_counters := public.omni_comms_ops_summary(p_organization_id, p_department_id, p_since_hours);

  SELECT bool_or(coalesce(live_delivery_enabled, false)) INTO v_live
    FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'runtime_tables', v_tables,
    'runtime_functions', v_functions,
    'counters', v_counters,
    'live_delivery_enabled', coalesce(v_live, false),
    'runnable_queue_enabled', false,
    'certification', jsonb_build_object(
      'resolution', 'not_certified',
      'rendering', 'not_certified',
      'overall', 'not_certified'
    ),
    'generated_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_health_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_since_hours integer DEFAULT 720
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_email jsonb;
  v_channels jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  v_email := public.omni_comms_email_config_summary(p_organization_id);

  -- Safe projection: counts and status only. secret_ref is never returned.
  v_channels := jsonb_build_object(
    'email_provider_registered', (v_email->'provider') IS NOT NULL AND (v_email->'provider') <> 'null'::jsonb,
    'email_provider_active', coalesce(v_email#>>'{provider,status}', '') = 'active',
    'provider_accounts', jsonb_array_length(coalesce(v_email->'provider_accounts', '[]'::jsonb)),
    'provider_accounts_active', (
      SELECT count(*) FROM jsonb_array_elements(coalesce(v_email->'provider_accounts','[]'::jsonb)) e
       WHERE e->>'status' = 'active'),
    'provider_accounts_credentials_configured', (
      SELECT count(*) FROM jsonb_array_elements(coalesce(v_email->'provider_accounts','[]'::jsonb)) e
       WHERE coalesce(e->>'secret_ref','') <> ''),
    'provider_accounts_healthy', (
      SELECT count(*) FROM jsonb_array_elements(coalesce(v_email->'provider_accounts','[]'::jsonb)) e
       WHERE e->>'health_state' = 'healthy'),
    'sender_identities', jsonb_array_length(coalesce(v_email->'sender_identities','[]'::jsonb)),
    'sender_identities_active', (
      SELECT count(*) FROM jsonb_array_elements(coalesce(v_email->'sender_identities','[]'::jsonb)) e
       WHERE e->>'status' = 'active'),
    'bindings', jsonb_array_length(coalesce(v_email->'bindings','[]'::jsonb)),
    'bindings_active', (
      SELECT count(*) FROM jsonb_array_elements(coalesce(v_email->'bindings','[]'::jsonb)) e
       WHERE e->>'status' = 'active'),
    'bindings_verified', (
      SELECT count(*) FROM jsonb_array_elements(coalesce(v_email->'bindings','[]'::jsonb)) e
       WHERE e->>'verification_status' = 'verified'),
    'email_channel_setting_present', (v_email->'channel_setting') IS NOT NULL
                                     AND (v_email->'channel_setting') <> 'null'::jsonb,
    'email_channel_enabled', coalesce((v_email#>>'{channel_setting,enabled}')::boolean, false),
    'email_send_ready', coalesce((v_email->>'email_send_ready')::boolean, false)
  );

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'permissions', public.omni_comms_health_permissions(p_organization_id, p_department_id),
    'catalogue', public.omni_comms_health_catalogue(p_organization_id, p_department_id),
    'runtime', public.omni_comms_health_runtime(p_organization_id, p_department_id, p_since_hours),
    'channels', v_channels,
    'generated_at', now()
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_health_permissions(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.omni_comms_health_catalogue(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.omni_comms_health_runtime(uuid, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.omni_comms_health_summary(uuid, uuid, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.omni_comms_health_permissions(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_health_permissions(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_health_catalogue(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_health_catalogue(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_health_runtime(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_health_runtime(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_health_summary(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_health_summary(uuid, uuid, integer) FROM anon;

GRANT EXECUTE ON FUNCTION public.omni_comms_health_permissions(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_health_catalogue(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_health_runtime(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_health_summary(uuid, uuid, integer) TO authenticated;
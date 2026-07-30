CREATE OR REPLACE FUNCTION public.omni_comms_setup_readiness(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_event_definition_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_locale text DEFAULT 'en'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_sensitive boolean := false;
  v_channel text;
  v_locale text;
  v_ed public.omni_comms_event_definition;
  v_ct public.omni_comms_event_contract;
  v_rt public.omni_comms_event_route;
  v_route_source text := 'unresolved';
  v_fam public.omni_comms_template_family;
  v_tv public.omni_comms_template_version;
  v_manifest jsonb;
  v_layout_version public.core_template_layout_version;
  v_layout_code text;
  v_prov public.omni_comms_provider;
  v_acct public.omni_comms_provider_account;
  v_sender public.omni_comms_sender_identity;
  v_bind public.omni_comms_sender_provider_binding;
  v_cs public.omni_comms_channel_setting;
  v_required_fields text[] := ARRAY[]::text[];
  v_slots jsonb := '[]'::jsonb;
  v_unresolved_required int := 0;
  v_assets jsonb := '[]'::jsonb;
  v_caps jsonb := '{}'::jsonb;
  v_action text;
  v_blockers jsonb := '[]'::jsonb;
  v_runtime_tables jsonb := '{}'::jsonb;
  v_runtime_functions jsonb := '{}'::jsonb;
  v_name text;
  v_runtime_ready boolean;
  v_dry_run_ready boolean;
  v_from_masked text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  v_channel := lower(coalesce(nullif(btrim(p_channel), ''), 'email'));
  IF v_channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'unsupported_channel';
  END IF;

  v_locale := coalesce(nullif(btrim(p_locale), ''), 'en');
  IF length(v_locale) > 10 OR v_locale !~ '^[A-Za-z]{2}([-_][A-Za-z]{2})?$' THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'invalid_locale';
  END IF;

  v_sensitive := public.has_permission(v_uid, 'omni_comms', 'view_sensitive_content');

  FOREACH v_action IN ARRAY ARRAY[
    'view','operate','configure','author_templates','approve_templates','view_sensitive_content'
  ] LOOP
    v_caps := v_caps || jsonb_build_object(
      'omni_comms.' || v_action,
      CASE WHEN public.has_permission(v_uid, 'omni_comms', v_action)
           THEN 'granted' ELSE 'not_granted' END);
  END LOOP;

  IF p_event_definition_id IS NOT NULL THEN
    SELECT * INTO v_ed FROM public.omni_comms_event_definition
     WHERE id = p_event_definition_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OC404 not_found'
        USING ERRCODE = 'P0001', DETAIL = 'event_definition_not_found';
    END IF;

    SELECT * INTO v_ct FROM public.omni_comms_event_contract
     WHERE event_definition_id = v_ed.id AND status = 'published'
     ORDER BY version_number DESC LIMIT 1;

    IF v_ct.id IS NOT NULL AND jsonb_typeof(v_ct.json_schema -> 'required') = 'array' THEN
      SELECT coalesce(array_agg(s.x ORDER BY s.x), ARRAY[]::text[]) INTO v_required_fields
        FROM (SELECT jsonb_array_elements_text(v_ct.json_schema -> 'required') AS x
               LIMIT 50) s;
    END IF;

    IF p_department_id IS NOT NULL THEN
      SELECT * INTO v_rt FROM public.omni_comms_event_route
       WHERE organization_id = p_organization_id
         AND department_id = p_department_id
         AND event_definition_id = v_ed.id
         AND channel = v_channel
       ORDER BY priority ASC, updated_at DESC LIMIT 1;
      IF v_rt.id IS NOT NULL THEN v_route_source := 'department'; END IF;
    END IF;
    IF v_rt.id IS NULL THEN
      SELECT * INTO v_rt FROM public.omni_comms_event_route
       WHERE organization_id = p_organization_id
         AND department_id IS NULL
         AND event_definition_id = v_ed.id
         AND channel = v_channel
       ORDER BY priority ASC, updated_at DESC LIMIT 1;
      IF v_rt.id IS NOT NULL THEN v_route_source := 'organization'; END IF;
    END IF;

    IF v_rt.template_family_id IS NOT NULL THEN
      SELECT * INTO v_fam FROM public.omni_comms_template_family
       WHERE id = v_rt.template_family_id;
    END IF;

    IF v_fam.id IS NOT NULL THEN
      SELECT * INTO v_tv FROM public.omni_comms_template_version
       WHERE template_family_id = v_fam.id
         AND status = 'published'
         AND channel = v_channel
         AND lower(locale) = lower(v_locale)
       ORDER BY version_number DESC LIMIT 1;
    END IF;
  END IF;

  IF v_tv.id IS NOT NULL THEN
    v_manifest := public.omni_comms_resolve_render_manifest(
      v_tv.id, p_organization_id, p_department_id);

    v_slots := coalesce(v_manifest -> 'layout_slots', '[]'::jsonb);

    IF (v_manifest ->> 'layout_version_id') IS NOT NULL THEN
      SELECT * INTO v_layout_version FROM public.core_template_layout_version
       WHERE id = (v_manifest ->> 'layout_version_id')::uuid;
      SELECT code INTO v_layout_code FROM public.core_template_layout
       WHERE id = (v_manifest ->> 'layout_id')::uuid;
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'slot_code', e ->> 'slot',
             'asset_id', e -> 'asset_id',
             'asset_version_id', e -> 'asset_version_id',
             'asset_type', e -> 'asset_type',
             'checksum', e -> 'checksum',
             'inheritance_source', e ->> 'inheritance_source',
             'state', CASE WHEN (e ->> 'asset_version_id') IS NULL
                           THEN 'unresolved' ELSE 'resolved' END
           ) ORDER BY e ->> 'slot'), '[]'::jsonb)
      INTO v_assets
      FROM jsonb_array_elements(coalesce(v_manifest -> 'resolved_assets', '[]'::jsonb)) e;

    SELECT count(*) INTO v_unresolved_required
      FROM jsonb_array_elements(v_assets) a
      JOIN jsonb_array_elements(v_slots) s
        ON s ->> 'code' = a ->> 'slot_code'
     WHERE a ->> 'state' = 'unresolved'
       AND coalesce((s ->> 'required')::boolean, false) IS TRUE;
  END IF;

  SELECT * INTO v_prov FROM public.omni_comms_provider
   WHERE channel = v_channel AND status = 'active'
   ORDER BY updated_at DESC LIMIT 1;
  IF v_prov.id IS NULL THEN
    SELECT * INTO v_prov FROM public.omni_comms_provider
     WHERE channel = v_channel ORDER BY updated_at DESC LIMIT 1;
  END IF;

  IF v_prov.id IS NOT NULL THEN
    SELECT * INTO v_acct FROM public.omni_comms_provider_account
     WHERE organization_id = p_organization_id
       AND provider_id = v_prov.id
       AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1;
    IF v_acct.id IS NULL THEN
      SELECT * INTO v_acct FROM public.omni_comms_provider_account
       WHERE organization_id = p_organization_id AND provider_id = v_prov.id
       ORDER BY updated_at DESC LIMIT 1;
    END IF;
  END IF;

  IF v_rt.sender_identity_id IS NOT NULL THEN
    SELECT * INTO v_sender FROM public.omni_comms_sender_identity
     WHERE id = v_rt.sender_identity_id;
  END IF;
  IF v_sender.id IS NULL AND v_ed.id IS NOT NULL THEN
    SELECT * INTO v_sender FROM public.omni_comms_sender_identity
     WHERE organization_id = p_organization_id AND channel = v_channel
       AND event_definition_id = v_ed.id AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF v_sender.id IS NULL AND p_department_id IS NOT NULL THEN
    SELECT * INTO v_sender FROM public.omni_comms_sender_identity
     WHERE organization_id = p_organization_id AND channel = v_channel
       AND department_id = p_department_id AND event_definition_id IS NULL
       AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF v_sender.id IS NULL THEN
    SELECT * INTO v_sender FROM public.omni_comms_sender_identity
     WHERE organization_id = p_organization_id AND channel = v_channel
       AND department_id IS NULL AND event_definition_id IS NULL
       AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1;
  END IF;

  IF v_sender.id IS NOT NULL THEN
    SELECT * INTO v_bind FROM public.omni_comms_sender_provider_binding
     WHERE sender_identity_id = v_sender.id
       AND (v_acct.id IS NULL OR provider_account_id = v_acct.id)
     ORDER BY (status = 'active') DESC, priority ASC, updated_at DESC LIMIT 1;
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT * INTO v_cs FROM public.omni_comms_channel_setting
     WHERE organization_id = p_organization_id
       AND department_id = p_department_id AND channel = v_channel LIMIT 1;
  END IF;
  IF v_cs.id IS NULL THEN
    SELECT * INTO v_cs FROM public.omni_comms_channel_setting
     WHERE organization_id = p_organization_id
       AND department_id IS NULL AND channel = v_channel LIMIT 1;
  END IF;

  IF v_sender.from_address IS NOT NULL THEN
    v_from_masked := CASE
      WHEN v_sensitive THEN v_sender.from_address
      WHEN position('@' IN v_sender.from_address) > 1 THEN
        left(v_sender.from_address, 1) || '***' ||
        substring(v_sender.from_address FROM position('@' IN v_sender.from_address))
      ELSE '***'
    END;
  END IF;

  FOREACH v_name IN ARRAY ARRAY[
    'omni_comms_request','omni_comms_recipient','omni_comms_message',
    'omni_comms_dispatch_job','omni_comms_delivery_attempt','omni_comms_message_event'
  ] LOOP
    v_runtime_tables := v_runtime_tables || jsonb_build_object(
      v_name, to_regclass('public.' || v_name) IS NOT NULL);
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY[
    'omni_comms_priv_send_communication',
    'omni_comms_priv_runtime_resolution_snapshot',
    'omni_comms_priv_finalize_resolution',
    'omni_comms_priv_load_render_context',
    'omni_comms_priv_persist_rendered_messages'
  ] LOOP
    v_runtime_functions := v_runtime_functions || jsonb_build_object(
      v_name,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = v_name));
  END LOOP;

  SELECT bool_and(value::boolean) INTO v_runtime_ready
    FROM jsonb_each_text(v_runtime_tables || v_runtime_functions);

  IF p_event_definition_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','event_not_selected','step','event','severity','blocker',
      'message','Select a pilot event definition.');
  ELSIF v_ed.status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','event_not_active','step','event','severity','blocker',
      'message','The selected event definition is not active.');
  END IF;

  IF p_event_definition_id IS NOT NULL AND v_ct.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','contract_not_published','step','contract','severity','blocker',
      'message','Publish an event contract version for this event.');
  END IF;

  IF p_event_definition_id IS NOT NULL AND v_rt.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','route_missing','step','route','severity','blocker',
      'message','Create an email event route for this event.');
  ELSIF v_rt.id IS NOT NULL AND (v_rt.lifecycle_state <> 'active' OR v_rt.is_enabled IS NOT TRUE) THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','route_not_active','step','route','severity','blocker',
      'message','Activate and enable the email event route.');
  END IF;

  IF v_rt.id IS NOT NULL AND v_fam.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','template_family_missing','step','template_family','severity','blocker',
      'message','Attach an active template family to the route.');
  ELSIF v_fam.id IS NOT NULL AND v_fam.status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','template_family_not_active','step','template_family','severity','blocker',
      'message','Activate the template family bound to the route.');
  END IF;

  IF v_fam.id IS NOT NULL AND v_tv.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','template_version_not_published','step','template_version','severity','blocker',
      'message','Publish an email template version for the selected locale.');
  END IF;

  IF v_tv.id IS NOT NULL AND (v_manifest ->> 'layout_version_id') IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','layout_unresolved','step','layout','severity','blocker',
      'message','No published layout version resolves for this template.');
  END IF;

  IF v_unresolved_required > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','required_assets_unresolved','step','assets','severity','blocker',
      'message','Required layout slots have no resolved active asset.');
  END IF;

  IF v_prov.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','provider_not_registered','step','provider','severity','blocker',
      'message','No email provider is registered.');
  ELSIF v_prov.status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','provider_not_active','step','provider','severity','blocker',
      'message','The email provider is registered but not active.');
  END IF;

  IF v_acct.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','provider_account_missing','step','provider_account','severity','blocker',
      'message','Create a provider account for this organisation.');
  ELSE
    IF v_acct.status <> 'active' THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','provider_account_not_active','step','provider_account','severity','blocker',
        'message','Activate the provider account.');
    END IF;
    IF v_acct.health_checked_at IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','provider_account_health_unknown','step','provider_account','severity','warning',
        'message','No credential health check has been recorded for this account.');
    ELSIF v_acct.health_state <> 'healthy' THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','provider_account_unhealthy','step','provider_account','severity','warning',
        'message','The last recorded credential health check was not healthy.');
    END IF;
  END IF;

  IF v_sender.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','sender_missing','step','sender','severity','blocker',
      'message','Create an email sender identity in scope.');
  ELSIF v_sender.status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','sender_not_active','step','sender','severity','blocker',
      'message','Activate the resolved sender identity.');
  END IF;

  IF v_sender.id IS NOT NULL AND v_bind.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','binding_missing','step','binding','severity','blocker',
      'message','Bind the sender identity to the provider account.');
  ELSIF v_bind.id IS NOT NULL THEN
    IF v_bind.status <> 'active' THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','binding_not_active','step','binding','severity','blocker',
        'message','Activate the sender-to-provider binding.');
    END IF;
    IF v_bind.verification_status <> 'verified' THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','binding_not_verified','step','binding','severity','warning',
        'message','The sender binding is not verified. Live delivery stays blocked.');
    END IF;
  END IF;

  IF v_cs.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','channel_setting_missing','step','channel_setting','severity','blocker',
      'message','Create an email channel setting for this scope.');
  ELSE
    IF v_cs.enabled IS NOT TRUE THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','channel_disabled','step','channel_setting','severity','blocker',
        'message','Enable the email channel for this scope.');
    END IF;
    IF v_cs.live_delivery_enabled IS TRUE AND v_cs.enabled IS NOT TRUE THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','live_without_channel_enabled','step','channel_setting','severity','blocker',
        'message','Live delivery is enabled while the channel itself is disabled.');
    END IF;
  END IF;

  IF coalesce(v_runtime_ready, false) IS NOT TRUE THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','runtime_incomplete','step','runtime','severity','blocker',
      'message','Runtime implementation objects are not fully present.');
  END IF;

  v_blockers := v_blockers || jsonb_build_object(
    'code','live_dispatch_not_implemented','step','runtime','severity','warning',
    'message','Live provider dispatch is not implemented yet. Configuration only.');

  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blockers) b
     WHERE b ->> 'severity' = 'blocker'
  ) INTO v_dry_run_ready;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', v_channel,
    'locale', v_locale,
    'generated_at', now(),
    'tenant', jsonb_build_object(
      'organization_id', p_organization_id,
      'department_id', p_department_id,
      'scope', CASE WHEN p_department_id IS NULL THEN 'organization_wide' ELSE 'department' END,
      'capabilities', v_caps,
      'sensitive_content_visible', v_sensitive),
    'event', CASE WHEN v_ed.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_ed.id, 'code', v_ed.code, 'name', v_ed.name,
        'module_code', v_ed.module_code, 'entity_type', v_ed.entity_type,
        'communication_class', v_ed.communication_class,
        'default_priority', v_ed.default_priority, 'status', v_ed.status) END,
    'contract', CASE WHEN v_ct.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_ct.id, 'version_number', v_ct.version_number,
        'status', v_ct.status, 'checksum', v_ct.checksum,
        'published_at', v_ct.published_at,
        'sample_payload_present', v_ct.sample_payload IS NOT NULL,
        'required_fields', to_jsonb(v_required_fields)) END,
    'route', CASE WHEN v_rt.id IS NULL THEN jsonb_build_object('present', false, 'source', 'unresolved')
      ELSE jsonb_build_object(
        'present', true, 'id', v_rt.id, 'source', v_route_source,
        'lifecycle_state', v_rt.lifecycle_state, 'is_enabled', v_rt.is_enabled,
        'is_required', v_rt.is_required, 'priority', v_rt.priority,
        'preference_policy', v_rt.preference_policy,
        'sender_resolution_policy', v_rt.sender_resolution_policy,
        'template_family_id', v_rt.template_family_id,
        'sender_identity_id', v_rt.sender_identity_id) END,
    'template_family', CASE WHEN v_fam.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_fam.id, 'code', v_fam.code, 'name', v_fam.name,
        'scope_type', v_fam.scope_type, 'status', v_fam.status) END,
    'template_version', CASE WHEN v_tv.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_tv.id, 'version_number', v_tv.version_number,
        'status', v_tv.status, 'channel', v_tv.channel, 'locale', v_tv.locale,
        'checksum', v_tv.checksum, 'published_at', v_tv.published_at,
        'layout_selection_mode', v_tv.layout_selection_mode) END,
    'layout', CASE WHEN v_tv.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', (v_manifest ->> 'layout_version_id') IS NOT NULL,
        'layout_id', v_manifest -> 'layout_id',
        'layout_code', v_layout_code,
        'layout_version_id', v_manifest -> 'layout_version_id',
        'layout_version_number', v_layout_version.version_number,
        'layout_checksum', v_layout_version.checksum,
        'inheritance_source', v_manifest ->> 'layout_inheritance_source',
        'slot_count', jsonb_array_length(v_slots)) END,
    'assets', jsonb_build_object(
      'slots', v_assets,
      'unresolved_required', v_unresolved_required),
    'provider', CASE WHEN v_prov.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_prov.id, 'code', v_prov.code,
        'display_name', v_prov.display_name, 'adapter_key', v_prov.adapter_key,
        'status', v_prov.status) END,
    'provider_account', CASE WHEN v_acct.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_acct.id, 'code', v_acct.code,
        'display_name', v_acct.display_name, 'status', v_acct.status,
        'region', v_acct.region, 'sandbox_mode', v_acct.sandbox_mode,
        'health_state', v_acct.health_state,
        'health_checked_at', v_acct.health_checked_at,
        'credential_check_recorded', v_acct.health_checked_at IS NOT NULL) END,
    'sender', CASE WHEN v_sender.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_sender.id, 'code', v_sender.code,
        'display_name', v_sender.display_name, 'status', v_sender.status,
        'from_address_display', v_from_masked,
        'from_address_masked', NOT v_sensitive,
        'scope', CASE
          WHEN v_sender.event_definition_id IS NOT NULL THEN 'event'
          WHEN v_sender.department_id IS NOT NULL THEN 'department'
          ELSE 'organization' END) END,
    'binding', CASE WHEN v_bind.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_bind.id, 'status', v_bind.status,
        'verification_status', v_bind.verification_status,
        'verified_at', v_bind.verified_at, 'priority', v_bind.priority,
        'provider_account_id', v_bind.provider_account_id) END,
    'channel_setting', CASE WHEN v_cs.id IS NULL THEN jsonb_build_object('present', false)
      ELSE jsonb_build_object(
        'present', true, 'id', v_cs.id,
        'scope', CASE WHEN v_cs.department_id IS NULL THEN 'organization' ELSE 'department' END,
        'enabled', v_cs.enabled,
        'live_delivery_enabled', v_cs.live_delivery_enabled,
        'quiet_hours_start', v_cs.quiet_hours_start,
        'quiet_hours_end', v_cs.quiet_hours_end,
        'quiet_hours_timezone', v_cs.quiet_hours_timezone,
        'per_minute_limit', v_cs.per_minute_limit) END,
    'runtime', jsonb_build_object(
      'tables', v_runtime_tables,
      'functions', v_runtime_functions,
      'implementation_complete', coalesce(v_runtime_ready, false),
      'live_dispatch_implemented', false,
      'certification', jsonb_build_object(
        'resolution', 'not_certified',
        'rendering', 'not_certified',
        'overall', 'not_certified')),
    'blockers', v_blockers,
    'dry_run_ready', coalesce(v_dry_run_ready, false),
    'live_send_ready', false
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) IS
  'Omni-Comms Phase 4: bounded read-only setup readiness aggregate for the guided Setup Wizard. No mutation, no provider contact, no secret material.';
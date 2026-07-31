CREATE OR REPLACE FUNCTION public.omni_comms_reference_seed_status(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c                jsonb := public.omni_comms_priv_reference_seed_catalogue_v2();
  v_uid            uuid;
  v_dry            jsonb;
  v_codes          text[];
  v_family_codes   text[];
  v_sender_codes   text[];
  v_account_codes  text[];
  v_provider_codes text[];
  v_exp_events     integer;
  v_exp_channels   integer;
  v_providers      integer;
  v_accounts       integer;
  v_senders        integer;
  v_bindings       integer;
  v_chan_settings  integer;
  v_events         integer;
  v_contracts      integer;
  v_families       integer;
  v_versions       integer;
  v_layouts_ok     integer;
  v_routes         integer;
  v_unresolved     integer;
  v_conflicts      integer;
  v_live_channels  integer;
  v_live_requests  integer;
  v_ref_requests   integer;
  v_ref_completed  integer;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');

  IF NOT EXISTS (SELECT 1 FROM public.core_organization WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE = 'P0001', DETAIL = 'organization_not_found';
  END IF;

  SELECT array_agg(e ->> 'code'), count(*)::int
    INTO v_codes, v_exp_events
    FROM jsonb_array_elements(c -> 'events') e;

  SELECT count(*)::int INTO v_exp_channels
    FROM jsonb_array_elements(c -> 'events') e,
         jsonb_array_elements(e -> 'channels') ch;

  SELECT array_agg(e ->> 'family_code') INTO v_family_codes FROM jsonb_array_elements(c -> 'events') e;
  SELECT array_agg(s ->> 'code')        INTO v_sender_codes FROM jsonb_array_elements(c -> 'senders') s;
  SELECT array_agg(a ->> 'code')        INTO v_account_codes FROM jsonb_array_elements(c -> 'accounts') a;
  SELECT array_agg(p ->> 'code')        INTO v_provider_codes FROM jsonb_array_elements(c -> 'providers') p;

  SELECT count(*)::int INTO v_providers
    FROM public.omni_comms_provider WHERE code = ANY(v_provider_codes) AND status = 'active';

  SELECT count(*)::int INTO v_accounts
    FROM public.omni_comms_provider_account
   WHERE organization_id = p_organization_id AND code = ANY(v_account_codes)
     AND status = 'active' AND sandbox_mode = true;

  SELECT count(*)::int INTO v_senders
    FROM public.omni_comms_sender_identity
   WHERE organization_id = p_organization_id AND code = ANY(v_sender_codes) AND status = 'active';

  SELECT count(*)::int INTO v_bindings
    FROM public.omni_comms_sender_provider_binding b
    JOIN public.omni_comms_sender_identity s ON s.id = b.sender_identity_id
   WHERE s.organization_id = p_organization_id AND s.code = ANY(v_sender_codes) AND b.status = 'active';

  SELECT count(*)::int INTO v_chan_settings
    FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND department_id IS NULL;

  SELECT count(*)::int INTO v_events
    FROM public.omni_comms_event_definition WHERE code = ANY(v_codes) AND status = 'active';

  SELECT count(*)::int INTO v_contracts
    FROM public.omni_comms_event_contract ct
    JOIN public.omni_comms_event_definition d ON d.id = ct.event_definition_id
   WHERE d.code = ANY(v_codes) AND ct.status = 'published';

  SELECT count(*)::int INTO v_families
    FROM public.omni_comms_template_family
   WHERE code = ANY(v_family_codes) AND organization_id = p_organization_id AND status = 'active';

  SELECT count(*)::int INTO v_versions
    FROM public.omni_comms_template_version tv
    JOIN public.omni_comms_template_family f ON f.id = tv.template_family_id
   WHERE f.code = ANY(v_family_codes) AND f.organization_id = p_organization_id
     AND tv.status = 'published';

  SELECT count(*)::int INTO v_layouts_ok
    FROM public.omni_comms_template_version tv
    JOIN public.omni_comms_template_family f ON f.id = tv.template_family_id
   WHERE f.code = ANY(v_family_codes) AND f.organization_id = p_organization_id
     AND tv.status = 'published'
     AND public.omni_comms_priv_layout_selection_valid(
           tv.layout_selection_mode, tv.layout_id, tv.pinned_layout_version_id, tv.channel);

  SELECT COALESCE(count(*), 0)::int INTO v_unresolved
    FROM public.omni_comms_template_version tv
    JOIN public.omni_comms_template_family f ON f.id = tv.template_family_id
    JOIN public.core_template_layout_version lv ON lv.id = tv.pinned_layout_version_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(lv.slots, '[]'::jsonb)) slot
   WHERE f.code = ANY(v_family_codes) AND f.organization_id = p_organization_id
     AND tv.status = 'published'
     AND COALESCE((slot ->> 'required')::boolean, false) = true
     AND (slot ->> 'code') !~ '^content(_|$)';

  SELECT count(*)::int INTO v_routes
    FROM public.omni_comms_event_route r
    JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
   WHERE r.organization_id = p_organization_id AND d.code = ANY(v_codes)
     AND r.lifecycle_state = 'active' AND r.is_enabled = true;

  SELECT count(*)::int INTO v_live_channels
    FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND live_delivery_enabled;

  SELECT count(*)::int INTO v_live_requests
    FROM public.omni_comms_request
   WHERE organization_id = p_organization_id AND mode IS DISTINCT FROM 'dry_run';

  SELECT count(*)::int,
         count(*) FILTER (WHERE rq.status = 'completed')::int
    INTO v_ref_requests, v_ref_completed
    FROM public.omni_comms_request rq
    JOIN public.omni_comms_event_definition d ON d.id = rq.event_definition_id
   WHERE rq.organization_id = p_organization_id
     AND rq.mode = 'dry_run'
     AND d.code = ANY(v_codes);

  SELECT COALESCE(sum(x), 0)::int INTO v_conflicts FROM (
    SELECT count(*)::int AS x FROM public.omni_comms_template_family
      WHERE code = ANY(v_family_codes) AND organization_id IS DISTINCT FROM p_organization_id
    UNION ALL
    SELECT count(*)::int FROM public.omni_comms_channel_setting
      WHERE organization_id = p_organization_id AND live_delivery_enabled
    UNION ALL
    SELECT count(*)::int FROM public.omni_comms_provider_account
      WHERE organization_id = p_organization_id AND code = ANY(v_account_codes)
        AND COALESCE(sandbox_mode, false) = false
    UNION ALL
    SELECT count(*)::int FROM public.omni_comms_event_contract ct
      JOIN public.omni_comms_event_definition d ON d.id = ct.event_definition_id
      WHERE d.code = ANY(v_codes) AND ct.version_number = 1 AND ct.status <> 'published'
  ) q;

  v_dry := jsonb_build_object(
    'reference_dry_run_requests', v_ref_requests,
    'completed_reference_dry_runs', v_ref_completed
  );

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'catalogue_version', (c ->> 'catalogue_version')::int,
    'expected_events', v_exp_events,
    'present_events', v_events,
    'expected_channel_bindings', v_exp_channels,
    'present_routes', v_routes,
    'present_published_versions', v_versions,
    'expected_senders', (SELECT count(*)::int FROM jsonb_array_elements(c -> 'senders')),
    'present_senders', v_senders,
    'expected_accounts', (SELECT count(*)::int FROM jsonb_array_elements(c -> 'accounts')),
    'present_accounts', v_accounts,
    'expected_providers', (SELECT count(*)::int FROM jsonb_array_elements(c -> 'providers')),
    'present_providers', v_providers,
    'expected_bindings', (SELECT count(*)::int FROM jsonb_array_elements(c -> 'senders')),
    'present_bindings', v_bindings,
    'expected_channel_settings', (SELECT count(*)::int FROM jsonb_array_elements(c -> 'channel_settings')),
    'present_channel_settings', v_chan_settings,
    'expected_contracts', v_exp_events,
    'present_published_contracts', v_contracts,
    'expected_families', v_exp_events,
    'present_families', v_families,
    'valid_layout_selections', v_layouts_ok,
    'unresolved_required_assets', v_unresolved,
    'conflicts', v_conflicts,
    'seeded', (v_events >= v_exp_events AND v_routes >= v_exp_channels),
    'catalogue_complete', (
      v_events >= v_exp_events
      AND v_contracts >= v_exp_events
      AND v_families >= v_exp_events
      AND v_versions >= v_exp_channels
      AND v_layouts_ok >= v_exp_channels
      AND v_routes >= v_exp_channels
      AND v_senders >= (SELECT count(*)::int FROM jsonb_array_elements(c -> 'senders'))
      AND v_bindings >= (SELECT count(*)::int FROM jsonb_array_elements(c -> 'senders'))
      AND v_accounts >= (SELECT count(*)::int FROM jsonb_array_elements(c -> 'accounts'))
      AND v_providers >= (SELECT count(*)::int FROM jsonb_array_elements(c -> 'providers'))
      AND v_chan_settings >= (SELECT count(*)::int FROM jsonb_array_elements(c -> 'channel_settings'))
      AND v_unresolved = 0
      AND v_conflicts = 0
      AND v_live_channels = 0
    ),
    'live_delivery_enabled_channels', v_live_channels,
    'live_requests', v_live_requests,
    'reference_dry_run_requests', v_ref_requests,
    'completed_reference_dry_runs', v_ref_completed,
    'reference_configuration_ready', (
      v_events >= v_exp_events AND v_contracts >= v_exp_events
      AND v_routes >= v_exp_channels AND v_conflicts = 0 AND v_unresolved = 0),
    'controlled_dry_run_ready', (
      v_routes >= 1 AND v_versions >= 1 AND v_layouts_ok >= 1 AND v_live_channels = 0),
    'controlled_dry_run_verified', (v_ref_completed > 0),
    'live_send_ready', false,
    'safe_to_seed', (v_live_channels = 0 AND v_live_requests = 0),
    'checked_at', now()
  ) || v_dry;
END;
$function$;
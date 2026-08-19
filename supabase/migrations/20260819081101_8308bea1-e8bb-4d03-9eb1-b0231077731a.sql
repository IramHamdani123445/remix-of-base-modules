-- Omni-Comms — generalise Release Control for all eight canonical channels.
-- Channel-kind-specific prerequisites; truthful passed/failed/not_applicable.

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_channel_kind(p_channel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE lower(coalesce(p_channel,''))
    WHEN 'email' THEN 'addressed'
    WHEN 'sms' THEN 'addressed'
    WHEN 'whatsapp' THEN 'addressed'
    WHEN 'voice' THEN 'addressed'
    WHEN 'push' THEN 'device'
    WHEN 'in_app' THEN 'internal'
    WHEN 'webhook' THEN 'endpoint'
    WHEN 'print' THEN 'physical'
    ELSE 'unsupported'
  END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_recipient_rules(p_channel text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_keys text[];
  v_norm jsonb;
  v_hash text;
  v_masked text;
  v_type text;
  v_default_type text;
  v_seen text[] := '{}';
BEGIN
  IF p_input IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(p_input) <> 'array' THEN
    RAISE EXCEPTION 'release_recipient_rules_invalid' USING ERRCODE = '22023';
  END IF;
  IF length(p_input::text) > 12000 THEN
    RAISE EXCEPTION 'release_recipient_rules_oversized' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_input) > 20 THEN
    RAISE EXCEPTION 'release_recipient_rules_limit_exceeded' USING ERRCODE = '22023';
  END IF;

  v_default_type := CASE lower(coalesce(p_channel,''))
    WHEN 'email' THEN 'email_address'
    WHEN 'sms' THEN 'phone_number'
    WHEN 'whatsapp' THEN 'whatsapp_number'
    WHEN 'voice' THEN 'voice_number'
    WHEN 'push' THEN 'recipient_reference'
    WHEN 'in_app' THEN 'user_reference'
    WHEN 'webhook' THEN 'endpoint_url'
    WHEN 'print' THEN 'recipient_reference'
    ELSE NULL END;
  IF v_default_type IS NULL THEN
    RAISE EXCEPTION 'release_channel_not_supported' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_input) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'release_recipient_rule_malformed' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(v_item) k;
    IF EXISTS (
      SELECT 1 FROM unnest(v_keys) k
      WHERE k NOT IN ('target_type','target','target_masked','target_hash')
    ) THEN
      RAISE EXCEPTION 'release_recipient_rule_unknown_key' USING ERRCODE = '22023';
    END IF;

    v_type := v_default_type;

    IF v_item ? 'target' AND nullif(trim(v_item->>'target'),'') IS NOT NULL THEN
      -- Push never stores a device token as an allowlist rule: the governed
      -- device register resolves installations from the recipient reference.
      v_norm := public.omni_comms_priv_channel_test_normalize_target(
                  CASE WHEN lower(coalesce(p_channel,'')) = 'push' THEN 'in_app' ELSE p_channel END,
                  v_item->>'target');
      IF coalesce((v_norm->>'valid')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'release_recipient_rule_malformed' USING ERRCODE = '22023';
      END IF;
      v_hash := v_norm->>'target_hash';
      v_masked := v_norm->>'target_masked';
      IF lower(coalesce(p_channel,'')) <> 'push' THEN
        v_type := coalesce(v_norm->>'target_type', v_default_type);
      END IF;
    ELSE
      v_hash := lower(coalesce(v_item->>'target_hash',''));
      v_masked := coalesce(v_item->>'target_masked','');
      IF v_hash !~ '^[0-9a-f]{64}$' OR v_masked = '' THEN
        RAISE EXCEPTION 'release_recipient_rule_malformed' USING ERRCODE = '22023';
      END IF;
      IF v_masked ~ '^[^@]+@' AND v_masked !~ '\*' THEN
        RAISE EXCEPTION 'release_recipient_rule_raw_value_rejected' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_hash = ANY (v_seen) THEN
      RAISE EXCEPTION 'release_recipient_rule_duplicate' USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_hash;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'target_type', v_type,
      'target_masked', v_masked,
      'target_hash', v_hash
    ));
  END LOOP;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_prerequisites(p_organization_id uuid, p_department_id uuid, p_channel text, p_release_control_id uuid, p_deployed_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_policy public.omni_comms_channel_setting;
  v_cert jsonb;
  v_env text;
  v_provider_account uuid;
  v_run public.omni_comms_channel_test_run;
  v_delivery public.omni_comms_channel_test_delivery;
  v_delivered boolean := false;
  v_bad boolean := false;
  v_dep_ok boolean;
  v_events text[];
  v_callers text[];
  v_live boolean := false;
  v_ch text := lower(coalesce(nullif(btrim(p_channel), ''), 'email'));
  v_kind text;
  v_supported boolean;
  v_uses_domain boolean;
  v_uses_provider_callback boolean;
  v_needs_external_credentials boolean;
  v_needs_sender_identity boolean;
  v_needs_binding boolean;
  v_uses_test_centre boolean;
  v_creds_ok boolean := false;
  v_push_registrations boolean := false;
  v_webhook_subscription boolean := false;
  v_webhook_signing boolean := false;
  v_voice_ivr_used boolean := false;
  v_voice_ivr_endpoint boolean := false;
  v_print_ready boolean := false;
BEGIN
  v_kind := public.omni_comms_priv_channel_release_channel_kind(v_ch);
  v_supported := v_kind <> 'unsupported';

  -- Channel-kind-specific applicability. A prerequisite is NEVER satisfied
  -- because an unrelated channel happens to have that resource.
  v_uses_domain := v_ch = 'email';
  v_uses_provider_callback := v_ch IN ('email','sms','whatsapp','voice');
  v_needs_external_credentials := v_ch IN ('email','sms','whatsapp','voice','push');
  v_needs_sender_identity := v_ch IN ('email','sms','whatsapp','voice','in_app','print');
  v_needs_binding := v_ch IN ('email','sms','whatsapp','voice','push');
  v_uses_test_centre := v_ch IN ('email','sms','whatsapp','voice','webhook','push');

  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_release_control_id;
  v_policy := public.omni_comms_priv_channel_test_effective_policy(p_organization_id, p_department_id, v_ch);
  v_cert := public.omni_comms_priv_runtime_certification();
  v_env := public.omni_comms_priv_runtime_environment();
  v_dep_ok := p_department_id IS NULL
    OR public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  v_events := coalesce(v_rel.permitted_event_codes, '{}');
  v_callers := coalesce(v_rel.permitted_caller_modules, '{}');
  v_live := coalesce(v_rel.release_state,'') = 'live'
            OR coalesce(v_rel.proposed_state,'') = 'live';

  SELECT pa.id INTO v_provider_account
  FROM public.omni_comms_provider_account pa
  JOIN public.omni_comms_provider p ON p.id = pa.provider_id
  WHERE pa.organization_id = p_organization_id
    AND pa.status = 'active' AND pa.data_origin <> 'reference_seed'
    AND p.channel = v_ch
  ORDER BY (pa.verification_status = 'verified') DESC
  LIMIT 1;

  IF NOT v_needs_external_credentials THEN
    v_creds_ok := true; -- reported as not_applicable below
  ELSIF v_provider_account IS NOT NULL THEN
    IF v_ch IN ('sms','whatsapp','voice') THEN
      SELECT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                     WHERE s.provider_account_id = v_provider_account AND s.purpose = 'account_sid')
         AND EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                     WHERE s.provider_account_id = v_provider_account AND s.purpose = 'auth_token')
        INTO v_creds_ok;
    ELSIF v_ch = 'push' THEN
      SELECT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                     WHERE s.provider_account_id = v_provider_account
                       AND s.purpose IN ('service_account','service_account_json'))
        INTO v_creds_ok;
    ELSE
      SELECT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                     WHERE s.provider_account_id = v_provider_account AND s.purpose = 'api_key')
        INTO v_creds_ok;
    END IF;
  END IF;

  IF v_ch = 'push' THEN
    SELECT EXISTS (SELECT 1 FROM public.omni_comms_push_device d
                   WHERE d.organization_id = p_organization_id AND d.state = 'active')
      INTO v_push_registrations;
  END IF;

  IF v_ch = 'webhook' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.omni_comms_webhook_subscription s
      JOIN public.omni_comms_channel_endpoint e ON e.id = s.endpoint_id
      WHERE s.organization_id = p_organization_id AND s.status = 'active'
        AND s.data_origin <> 'reference_seed' AND e.status = 'active'
    ) INTO v_webhook_subscription;
    SELECT EXISTS (
      SELECT 1 FROM public.omni_comms_webhook_subscription s
      WHERE s.organization_id = p_organization_id AND s.status = 'active'
        AND coalesce(btrim(s.signing_secret_ref),'') <> ''
    ) INTO v_webhook_signing;
  END IF;

  IF v_ch = 'voice' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.omni_comms_template_version tv
      WHERE tv.channel = 'voice' AND tv.status = 'published'
        AND coalesce(btrim(tv.content->>'gather_map'),'') <> ''
    ) INTO v_voice_ivr_used;
    SELECT EXISTS (
      SELECT 1 FROM public.omni_comms_channel_endpoint e
      WHERE e.organization_id = p_organization_id AND e.channel = 'voice'
        AND e.endpoint_type IN ('inbound_callback','event_callback','delivery_callback')
        AND e.status = 'active'
    ) INTO v_voice_ivr_endpoint;
  END IF;

  IF v_ch = 'print' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.omni_comms_sender_identity i
      WHERE i.organization_id = p_organization_id AND i.channel = 'print'
        AND i.status = 'active' AND i.data_origin <> 'reference_seed'
    ) INTO v_print_ready;
  END IF;

  SELECT * INTO v_run FROM public.omni_comms_channel_test_run r
  WHERE r.organization_id = p_organization_id AND r.channel = v_ch AND r.status = 'passed'
  ORDER BY r.created_at DESC LIMIT 1;

  SELECT * INTO v_delivery FROM public.omni_comms_channel_test_delivery d
  WHERE d.organization_id = p_organization_id AND d.channel = v_ch AND d.status = 'accepted'
  ORDER BY d.created_at DESC LIMIT 1;

  IF v_delivery.id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.omni_comms_channel_test_delivery_event e
      WHERE e.delivery_id = v_delivery.id AND e.signature_verified AND e.event_type = 'delivered')
      INTO v_delivered;
    SELECT EXISTS (SELECT 1 FROM public.omni_comms_channel_test_delivery_event e
      WHERE e.delivery_id = v_delivery.id AND e.signature_verified
        AND e.event_type IN ('bounced','complained'))
      INTO v_bad;
  END IF;

  RETURN jsonb_build_array(
    jsonb_build_object('sequence',1,'code','tenant_access','state',CASE WHEN p_organization_id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Organisation scope resolved.'),
    jsonb_build_object('sequence',2,'code','department_access','state',CASE WHEN v_dep_ok THEN 'passed' ELSE 'failed' END,'detail','Department belongs to the organisation.'),
    jsonb_build_object('sequence',3,'code','channel_supported','state',CASE WHEN v_supported THEN 'passed' ELSE 'failed' END,'detail','Release Control governs every canonical channel with a deployed delivery adapter (channel kind: '||v_kind||').'),
    jsonb_build_object('sequence',4,'code','release_not_reference','state',CASE WHEN v_rel.id IS NOT NULL AND v_rel.data_origin <> 'reference_seed' THEN 'passed' ELSE 'failed' END,'detail','Genuine (non-reference) release record required.'),
    jsonb_build_object('sequence',5,'code','effective_policy_present','state',CASE WHEN v_policy.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Effective genuine channel policy resolved.'),
    jsonb_build_object('sequence',6,'code','policy_test_or_pilot_state','state',CASE WHEN v_policy.operational_state IN ('test_only','pilot_ready') THEN 'passed' ELSE 'failed' END,'detail','Policy operational state must be test_only or pilot_ready.'),
    jsonb_build_object('sequence',7,'code','provider_present','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider p WHERE p.channel=v_ch AND p.status='active') THEN 'passed' ELSE 'failed' END,'detail','Active provider adapter present for this channel.'),
    jsonb_build_object('sequence',8,'code','provider_account_active','state',CASE WHEN v_provider_account IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Active genuine provider account present for this channel.'),
    jsonb_build_object('sequence',9,'code','provider_credentials_complete','state',
      CASE WHEN NOT v_needs_external_credentials THEN 'not_applicable' WHEN v_creds_ok THEN 'passed' ELSE 'failed' END,
      'detail', CASE
        WHEN v_ch = 'print' THEN 'Print artefacts are produced internally without provider credentials.'
        WHEN v_ch = 'in_app' THEN 'In-App is delivered by the internal adapter; there are no external credentials.'
        WHEN v_ch = 'webhook' THEN 'Webhook signing material is governed on the subscription, not on a provider account.'
        WHEN v_ch = 'push' THEN 'Firebase service-account credential reference present.'
        WHEN v_ch IN ('sms','whatsapp','voice') THEN 'Twilio account SID and auth token references present.'
        ELSE 'Canonical credential secret references present for this channel.' END),
    jsonb_build_object('sequence',10,'code','provider_credentials_verified','state',
      CASE WHEN NOT v_needs_external_credentials THEN 'not_applicable'
           WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account pa WHERE pa.id=v_provider_account AND public.omni_comms_provider_credential_send_ready(pa.verification_status, pa.verification_result_code)) THEN 'passed'
           ELSE 'failed' END,
      'detail', CASE WHEN v_needs_external_credentials THEN 'Provider credentials are sending-ready.' ELSE 'No external credential is used by this channel.' END),
    jsonb_build_object('sequence',11,'code','sender_identity_active','state',
      CASE WHEN NOT v_needs_sender_identity THEN 'not_applicable'
           WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_identity i WHERE i.organization_id=p_organization_id AND i.channel=v_ch AND i.status='active' AND i.data_origin <> 'reference_seed') THEN 'passed'
           ELSE 'failed' END,
      'detail', CASE
        WHEN v_ch = 'push' THEN 'Push targets governed device registrations; no sender identity exists.'
        WHEN v_ch = 'webhook' THEN 'Webhook addresses a subscriber endpoint; no sender identity exists.'
        WHEN v_ch = 'voice' THEN 'Active originating caller-number identity present.'
        WHEN v_ch = 'print' THEN 'Active issuing-authority identity present.'
        ELSE 'Active genuine sender identity present.' END),
    jsonb_build_object('sequence',12,'code','sending_domain_active','state',CASE WHEN NOT v_uses_domain THEN 'not_applicable' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type='sending_domain' AND e.status='active' AND e.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_domain THEN 'Active sending domain configured.' ELSE 'This channel does not use sending domains.' END),
    jsonb_build_object('sequence',13,'code','sending_domain_verified','state',CASE WHEN NOT v_uses_domain THEN 'not_applicable' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type='sending_domain' AND e.status='active' AND e.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_domain THEN 'Sending domain verified with the provider.' ELSE 'This channel does not use sending domains.' END),
    jsonb_build_object('sequence',14,'code','callback_endpoint_active','state',CASE WHEN NOT v_uses_provider_callback THEN 'not_applicable' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type IN ('event_callback','delivery_callback') AND e.status='active') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='voice' THEN 'Signed Voice status callback endpoint configured.' WHEN v_uses_provider_callback THEN 'Delivery/event callback endpoint configured for this channel.' ELSE 'This channel has no external provider callback.' END),
    jsonb_build_object('sequence',15,'code','binding_active','state',CASE WHEN NOT v_needs_binding THEN 'not_applicable' WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel=v_ch AND b.status='active' AND b.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_needs_binding THEN 'Active identity-to-provider binding present.' ELSE 'This channel resolves its destination without a provider binding.' END),
    jsonb_build_object('sequence',16,'code','binding_provider_verified','state',CASE WHEN NOT v_needs_binding THEN 'not_applicable' WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel=v_ch AND b.status='active' AND b.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_needs_binding THEN 'Binding verified by the provider.' ELSE 'No provider binding is verified for this channel.' END),
    jsonb_build_object('sequence',17,'code','current_preflight_passed','state',CASE WHEN v_run.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Current configuration preflight passed.'),
    jsonb_build_object('sequence',18,'code','technical_provider_delivery_accepted','state',CASE WHEN NOT v_uses_test_centre THEN 'not_applicable' WHEN v_delivery.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='print' THEN 'Print production is proved by the archived PDF artefact.' WHEN v_ch='in_app' THEN 'In-App delivery is proved by the recipient inbox notification.' ELSE 'Technical provider delivery accepted.' END),
    jsonb_build_object('sequence',19,'code','signed_delivery_callback_received','state',CASE WHEN NOT v_uses_provider_callback THEN 'not_applicable' WHEN v_delivered THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_provider_callback THEN 'Signature-verified delivered callback received.' ELSE 'This channel produces its own delivery evidence.' END),
    jsonb_build_object('sequence',20,'code','no_bounce_or_complaint_evidence','state',CASE WHEN v_bad THEN 'failed' ELSE 'passed' END,'detail','No bounced or complained outcome on the current technical delivery.'),
    jsonb_build_object('sequence',21,'code','producer_binding_active','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec CROSS JOIN unnest(v_callers) cm
        WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_producer_event_binding pb
          JOIN public.omni_comms_event_definition ed ON ed.id = pb.event_definition_id
          WHERE pb.organization_id = p_organization_id AND pb.status='active'
            AND 'queued' = ANY (pb.allowed_modes)
            AND ed.code = ec AND ed.status = 'active'
            AND pb.caller_module_code = cm)
      ) THEN 'passed' ELSE 'failed' END,'detail','Active producer-event binding permitting queued mode for every permitted event/caller pair.'),
    jsonb_build_object('sequence',22,'code','event_route_active','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_event_route r
          JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
          WHERE r.organization_id = p_organization_id AND r.channel=v_ch
            AND r.is_enabled AND r.lifecycle_state='active' AND ed.code = ec)
      ) THEN 'passed' ELSE 'failed' END,'detail','Enabled active event route present for every permitted event.'),
    jsonb_build_object('sequence',23,'code','template_family_active','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_event_route r
          JOIN public.omni_comms_template_family tf ON tf.id = r.template_family_id
          JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
          WHERE r.organization_id = p_organization_id AND r.channel=v_ch
            AND tf.status='active' AND ed.code = ec)
      ) THEN 'passed' ELSE 'failed' END,'detail','Route resolves an active template family.'),
    jsonb_build_object('sequence',24,'code','published_template_version_present','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_event_route r
          JOIN public.omni_comms_template_version tv ON tv.template_family_id = r.template_family_id
          JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
          WHERE r.organization_id = p_organization_id AND r.channel=v_ch
            AND tv.channel=v_ch AND tv.status='published' AND ed.code = ec)
      ) THEN 'passed' ELSE 'failed' END,'detail','Published template version present for this channel.'),
    jsonb_build_object('sequence',25,'code','runtime_environment_known','state',CASE WHEN coalesce(v_env,'unknown') IN ('production','non_production') THEN 'passed' ELSE 'failed' END,'detail','Runtime environment is authoritative.'),
    jsonb_build_object('sequence',26,'code','runtime_certification_effective','state',CASE WHEN v_cert->>'certification_state' = 'certified' AND coalesce(v_cert->>'certified_commit','') ~ '^[0-9a-f]{40}$' AND coalesce(v_cert->>'workflow_run_id','') <> '' AND (v_cert->>'certified_at') IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Protected runtime certification record is effective.'),
    jsonb_build_object('sequence',27,'code','deployed_revision_matches_certification','state',CASE WHEN lower(coalesce(p_deployed_revision, public.omni_comms_priv_observed_deployed_revision(), '')) ~ '^[0-9a-f]{40}$' AND lower(coalesce(p_deployed_revision, public.omni_comms_priv_observed_deployed_revision(), '')) = lower(coalesce(v_cert->>'certified_commit','x')) THEN 'passed' ELSE 'failed' END,'detail','Deployed Edge revision equals the certified commit (full 40-character SHA).'),
    jsonb_build_object('sequence',28,'code','release_time_window_valid','state',CASE
        WHEN v_live THEN CASE WHEN v_rel.release_expires_at IS NULL OR v_rel.release_expires_at > now() THEN 'passed' ELSE 'failed' END
        WHEN v_rel.release_expires_at IS NOT NULL AND v_rel.release_expires_at > now() AND v_rel.release_expires_at <= coalesce(v_rel.release_starts_at, now()) + interval '7 days' THEN 'passed'
        ELSE 'failed' END,'detail',CASE WHEN v_live THEN 'A live release runs continuously; an optional expiry must be in the future.' ELSE 'Expiry is in the future and the pilot window does not exceed seven days.' END),
    jsonb_build_object('sequence',29,'code','release_volume_limits_valid','state',CASE WHEN v_rel.id IS NOT NULL AND v_rel.max_recipients_per_request BETWEEN 1 AND 10 AND v_rel.max_messages_per_hour <= v_rel.max_messages_per_day AND (v_rel.max_messages_total IS NULL OR v_rel.max_messages_per_day <= v_rel.max_messages_total) THEN 'passed' ELSE 'failed' END,'detail','Volume limits are within bounds and correctly laddered.'),
    jsonb_build_object('sequence',30,'code','pilot_recipient_rules_present','state',CASE
        WHEN v_live THEN 'passed'
        WHEN v_rel.id IS NOT NULL AND jsonb_array_length(v_rel.pilot_recipient_rules) BETWEEN 1 AND 20 THEN 'passed'
        ELSE 'failed' END,'detail',CASE WHEN v_live THEN 'Live operation takes the recipient from the business request; no allowlist is maintained.' ELSE 'Masked/hashed pilot recipient rules present.' END),
    jsonb_build_object('sequence',31,'code','live_delivery_legacy_flag_false','state',CASE WHEN coalesce(v_policy.live_delivery_enabled,false) = false THEN 'passed' ELSE 'failed' END,'detail','Legacy live_delivery_enabled flag remains false; scoped Release Control governs sending.'),
    jsonb_build_object('sequence',32,'code','business_dispatch_dispatcher_installed','state',CASE WHEN public.omni_comms_priv_business_dispatch_installed() THEN 'passed' ELSE 'failed' END,'detail','Controlled business dispatch RPCs are installed; without them dispatch fails closed.'),
    -- Channel-kind-specific prerequisites.
    jsonb_build_object('sequence',33,'code','push_registrations_available','state',CASE WHEN v_ch <> 'push' THEN 'not_applicable' WHEN v_push_registrations THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='push' THEN 'At least one active governed Push installation is registered.' ELSE 'Only the Push channel resolves device registrations.' END),
    jsonb_build_object('sequence',34,'code','webhook_subscription_governed','state',CASE WHEN v_ch <> 'webhook' THEN 'not_applicable' WHEN v_webhook_subscription THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='webhook' THEN 'Active Webhook subscription binds a Communication Action to an exact active endpoint.' ELSE 'Only the Webhook channel uses subscriptions.' END),
    jsonb_build_object('sequence',35,'code','webhook_signing_secret_present','state',CASE WHEN v_ch <> 'webhook' THEN 'not_applicable' WHEN v_webhook_signing THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='webhook' THEN 'HMAC signing secret reference configured on the subscription.' ELSE 'Only the Webhook channel signs outbound payloads with a subscription secret.' END),
    jsonb_build_object('sequence',36,'code','voice_ivr_endpoint_active','state',CASE WHEN v_ch <> 'voice' THEN 'not_applicable' WHEN NOT v_voice_ivr_used THEN 'not_applicable' WHEN v_voice_ivr_endpoint THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch <> 'voice' THEN 'Only the Voice channel uses a basic IVR action endpoint.' WHEN NOT v_voice_ivr_used THEN 'No published Voice template uses a keypad question (Basic IVR).' ELSE 'Signed Basic IVR action endpoint configured.' END),
    jsonb_build_object('sequence',37,'code','print_production_configured','state',CASE WHEN v_ch <> 'print' THEN 'not_applicable' WHEN v_print_ready THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='print' THEN 'Print production configuration (issuing authority) present.' ELSE 'Only the Print channel requires print production configuration.' END)
  );
END;
$function$;

-- Generalise the remaining Email/SMS-only channel guards in place.
DO $do$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_channel_release_control_summary';
  v_def := replace(v_def,
    'IF v_ch NOT IN (''email'',''sms'') THEN',
    'IF public.omni_comms_priv_channel_release_channel_kind(v_ch) = ''unsupported'' THEN');
  EXECUTE v_def;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_channel_release_control_upsert_configuration';
  v_def := replace(v_def,
    'IF p_channel <> ''email'' THEN',
    'IF public.omni_comms_priv_channel_release_channel_kind(p_channel) = ''unsupported'' THEN');
  EXECUTE v_def;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_priv_release_controlled_send_preflight';
  v_def := replace(v_def,
    'v_rel.data_origin = ''reference_seed'' OR v_rel.channel <> ''email''',
    'v_rel.data_origin = ''reference_seed'' OR public.omni_comms_priv_channel_release_channel_kind(v_rel.channel) = ''unsupported''');
  EXECUTE v_def;
END
$do$;
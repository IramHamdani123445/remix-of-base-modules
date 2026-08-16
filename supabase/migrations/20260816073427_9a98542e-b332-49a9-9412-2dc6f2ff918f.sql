CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_prerequisites(
  p_organization_id uuid, p_department_id uuid, p_channel text,
  p_release_control_id uuid, p_deployed_revision text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  v_supported boolean;
  v_uses_domain boolean;
  v_creds_ok boolean := false;
BEGIN
  v_supported := v_ch IN ('email','sms');
  v_uses_domain := v_ch = 'email';

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

  IF v_provider_account IS NOT NULL THEN
    IF v_ch = 'sms' THEN
      SELECT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                     WHERE s.provider_account_id = v_provider_account AND s.purpose = 'account_sid')
         AND EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                     WHERE s.provider_account_id = v_provider_account AND s.purpose = 'auth_token')
        INTO v_creds_ok;
    ELSE
      SELECT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                     WHERE s.provider_account_id = v_provider_account AND s.purpose = 'api_key')
        INTO v_creds_ok;
    END IF;
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
    jsonb_build_object('sequence',3,'code','channel_supported','state',CASE WHEN v_supported THEN 'passed' ELSE 'failed' END,'detail','Release Control supports channels with a deployed delivery adapter (Email, SMS).'),
    jsonb_build_object('sequence',4,'code','release_not_reference','state',CASE WHEN v_rel.id IS NOT NULL AND v_rel.data_origin <> 'reference_seed' THEN 'passed' ELSE 'failed' END,'detail','Genuine (non-reference) release record required.'),
    jsonb_build_object('sequence',5,'code','effective_policy_present','state',CASE WHEN v_policy.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Effective genuine channel policy resolved.'),
    jsonb_build_object('sequence',6,'code','policy_test_or_pilot_state','state',CASE WHEN v_policy.operational_state IN ('test_only','pilot_ready') THEN 'passed' ELSE 'failed' END,'detail','Policy operational state must be test_only or pilot_ready.'),
    jsonb_build_object('sequence',7,'code','provider_present','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider p WHERE p.channel=v_ch AND p.status='active') THEN 'passed' ELSE 'failed' END,'detail','Active provider adapter present for this channel.'),
    jsonb_build_object('sequence',8,'code','provider_account_active','state',CASE WHEN v_provider_account IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Active genuine provider account present for this channel.'),
    jsonb_build_object('sequence',9,'code','provider_credentials_complete','state',CASE WHEN v_creds_ok THEN 'passed' ELSE 'failed' END,'detail','Canonical credential secret references present for this channel.'),
    jsonb_build_object('sequence',10,'code','provider_credentials_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account pa WHERE pa.id=v_provider_account AND public.omni_comms_provider_credential_send_ready(pa.verification_status, pa.verification_result_code)) THEN 'passed' ELSE 'failed' END,'detail','Provider credentials are sending-ready.'),
    jsonb_build_object('sequence',11,'code','sender_identity_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_identity i WHERE i.organization_id=p_organization_id AND i.channel=v_ch AND i.status='active' AND i.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail','Active genuine sender identity present.'),
    jsonb_build_object('sequence',12,'code','sending_domain_active','state',CASE WHEN NOT v_uses_domain THEN 'passed' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type='sending_domain' AND e.status='active' AND e.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_domain THEN 'Active sending domain configured.' ELSE 'Not applicable: this channel does not use sending domains.' END),
    jsonb_build_object('sequence',13,'code','sending_domain_verified','state',CASE WHEN NOT v_uses_domain THEN 'passed' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type='sending_domain' AND e.status='active' AND e.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_domain THEN 'Sending domain verified with the provider.' ELSE 'Not applicable: this channel does not use sending domains.' END),
    jsonb_build_object('sequence',14,'code','callback_endpoint_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type IN ('event_callback','delivery_callback') AND e.status='active') THEN 'passed' ELSE 'failed' END,'detail','Delivery/event callback endpoint configured for this channel.'),
    jsonb_build_object('sequence',15,'code','binding_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel=v_ch AND b.status='active' AND b.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail','Active identity-to-provider binding present.'),
    jsonb_build_object('sequence',16,'code','binding_provider_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel=v_ch AND b.status='active' AND b.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail','Binding verified by the provider.'),
    jsonb_build_object('sequence',17,'code','current_preflight_passed','state',CASE WHEN v_run.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Current configuration preflight passed.'),
    jsonb_build_object('sequence',18,'code','technical_provider_delivery_accepted','state',CASE WHEN v_delivery.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Technical provider delivery accepted.'),
    jsonb_build_object('sequence',19,'code','signed_delivery_callback_received','state',CASE WHEN v_delivered THEN 'passed' ELSE 'failed' END,'detail','Signature-verified delivered callback received.'),
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
      ) THEN 'passed' ELSE 'failed' END,'detail','Enabled active event route present for this channel for every permitted event.'),
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
    jsonb_build_object('sequence',32,'code','business_dispatch_dispatcher_installed','state',CASE WHEN public.omni_comms_priv_business_dispatch_installed() THEN 'passed' ELSE 'failed' END,'detail','Controlled business dispatch RPCs are installed; without them dispatch fails closed.')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_summary(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'email'::text, p_history_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_can_configure boolean := false;
  v_can_operate boolean := false;
  v_cert jsonb;
  v_policy public.omni_comms_channel_setting;
  v_ch text := lower(coalesce(nullif(btrim(p_channel), ''), 'email'));
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);
  IF v_ch NOT IN ('email','sms') THEN RAISE EXCEPTION 'release_channel_not_supported' USING ERRCODE='22023'; END IF;

  BEGIN PERFORM public.omni_comms_priv_require_capability('configure'); v_can_configure := true;
  EXCEPTION WHEN OTHERS THEN v_can_configure := false; END;
  BEGIN PERFORM public.omni_comms_priv_require_capability('operate'); v_can_operate := true;
  EXCEPTION WHEN OTHERS THEN v_can_operate := false; END;

  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, v_ch);
  v_cert := public.omni_comms_priv_runtime_certification();
  v_policy := public.omni_comms_priv_channel_test_effective_policy(p_organization_id, p_department_id, v_ch);

  RETURN jsonb_build_object(
    'release', CASE WHEN v_rel.id IS NULL THEN NULL
                    ELSE public.omni_comms_priv_channel_release_json(v_rel) END,
    'scope', jsonb_build_object('organization_id', p_organization_id,
                                'department_id', p_department_id,
                                'channel', v_ch),
    'certification', v_cert,
    'runtime_environment', public.omni_comms_priv_runtime_environment(),
    'live_delivery_enabled', coalesce(v_policy.live_delivery_enabled, false),
    'prerequisites', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb
      ELSE public.omni_comms_priv_channel_release_prerequisites(
        p_organization_id, p_department_id, v_ch, v_rel.id, NULL) END,
    'usage', CASE WHEN v_rel.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
        'hourly', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 hour'),
        'daily', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 day'),
        'total', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id)) END,
    'history', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'from_state', e.from_state,
        'to_state', e.to_state, 'reason', e.reason, 'actor_id', e.actor_id,
        'release_version', e.release_version,
        'release_fingerprint', left(e.release_fingerprint, 12),
        'certified_commit', e.certified_commit,
        'occurred_at', e.occurred_at) ORDER BY e.occurred_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.omni_comms_channel_release_event
            WHERE release_control_id = v_rel.id
            ORDER BY occurred_at DESC
            LIMIT greatest(1, least(coalesce(p_history_limit,25), 200))) e) END,
    'capabilities', jsonb_build_object(
      'can_configure', v_can_configure,
      'can_operate', v_can_operate,
      'can_approve', v_can_operate AND v_rel.id IS NOT NULL
                     AND v_rel.proposed_state = 'controlled_pilot'
                     AND v_rel.proposed_by IS DISTINCT FROM v_actor,
      'can_suspend', v_can_operate AND v_rel.release_state = 'controlled_pilot'),
    'actor_id', v_actor,
    'business_dispatch_implemented', public.omni_comms_priv_business_dispatch_installed(),
    'generated_at', now()
  );
END;
$function$;
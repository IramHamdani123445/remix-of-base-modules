-- 1. Built-in Print provider ------------------------------------------------
INSERT INTO public.omni_comms_provider (code, display_name, channel, adapter_key, status, data_origin)
SELECT 'print_spool', 'Print spool / letter production', 'print', 'print_spool', 'draft', 'system_seed'
WHERE NOT EXISTS (SELECT 1 FROM public.omni_comms_provider WHERE code = 'print_spool');

UPDATE public.omni_comms_provider
   SET status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
 WHERE code = 'print_spool' AND status = 'draft';

-- 2. Technical test delivery: support the Print channel ----------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_prepare(p_test_run_id uuid, p_target text, p_idempotency_key text, p_subject text, p_body_text text, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_run public.omni_comms_channel_test_run%ROWTYPE;
  v_binding public.omni_comms_sender_provider_binding%ROWTYPE;
  v_account public.omni_comms_provider_account%ROWTYPE;
  v_identity public.omni_comms_sender_identity%ROWTYPE;
  v_policy public.omni_comms_channel_setting%ROWTYPE;
  v_provider_code text;
  v_channel text;
  v_target text := lower(btrim(coalesce(p_target,'')));
  v_tnorm jsonb;
  v_pnorm jsonb;
  v_target_hash text;
  v_cfg_fp text;
  v_fp text;
  v_secret text;
  v_secret_token text;
  v_secret_service text;
  v_sender text;
  v_prov_subject text;
  v_prov_body text;
  v_prov_hash text;
  v_row public.omni_comms_channel_test_delivery%ROWTYPE;
  v_delivery_id uuid;
  v_storage_mode text;
  v_claim uuid;
  v_attempt integer;
  v_recent integer;
  v_last timestamptz;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('operate');
  IF p_test_run_id IS NULL OR coalesce(btrim(p_idempotency_key),'') = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_input'; END IF;

  SELECT * INTO v_run FROM public.omni_comms_channel_test_run WHERE id = p_test_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='test_run_not_found'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_run.organization_id, v_run.department_id);

  v_channel := v_run.channel;
  IF v_channel NOT IN ('email','sms','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='controlled_delivery_channel_unsupported'; END IF;
  IF v_run.status <> 'passed' THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='preflight_not_passed'; END IF;

  v_cfg_fp := public.omni_comms_priv_channel_test_config_fingerprint(
    v_run.organization_id, v_run.department_id, v_run.channel, v_run.binding_id);
  IF v_cfg_fp IS DISTINCT FROM v_run.configuration_fingerprint THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='preflight_stale'; END IF;

  v_tnorm := public.omni_comms_priv_channel_test_normalize_target(v_channel, v_target);
  IF (v_tnorm->>'valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_target'; END IF;
  v_target_hash := v_tnorm->>'target_hash';
  IF v_target_hash IS DISTINCT FROM v_run.target_hash THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='target_differs_from_preflight'; END IF;

  IF v_channel = 'email' THEN
    v_pnorm := public.omni_comms_priv_channel_test_normalize_payload(
      'email', jsonb_build_object('subject', coalesce(p_subject,''), 'body', coalesce(p_body_text,'')));
  ELSIF v_channel = 'print' THEN
    v_pnorm := public.omni_comms_priv_channel_test_normalize_payload(
      'print', jsonb_build_object('document_title', coalesce(p_subject,''), 'sample_text', coalesce(p_body_text,'')));
  ELSE
    v_pnorm := public.omni_comms_priv_channel_test_normalize_payload(
      'sms', jsonb_build_object('text', coalesce(p_body_text,'')));
  END IF;
  IF (v_pnorm->>'valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=coalesce(v_pnorm->>'code','payload_invalid'); END IF;
  IF (v_pnorm->>'payload_hash') IS DISTINCT FROM v_run.payload_hash THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='payload_differs_from_preflight'; END IF;

  IF v_channel = 'email' THEN
    v_prov_subject := '[TEST] ' || btrim(coalesce(p_subject,''));
    v_prov_body := coalesce(p_body_text,'')
      || E'\n\n--\nThis is a technical Omni-Comms channel test message. '
      || 'It contains no personal or case information and was not produced by the live sending path.';
    v_prov_hash := public.omni_comms_priv_channel_test_sha256(
      'email|' || jsonb_build_object('subject', v_prov_subject, 'body', v_prov_body)::text);
  ELSIF v_channel = 'print' THEN
    v_prov_subject := '[TEST] ' || btrim(coalesce(p_subject,''));
    v_prov_body := coalesce(p_body_text,'')
      || E'\n\n--\nThis is a technical Omni-Comms print artefact produced for configuration testing only.';
    v_prov_hash := public.omni_comms_priv_channel_test_sha256(
      'print|' || jsonb_build_object('document_title', v_prov_subject, 'sample_text', v_prov_body)::text);
  ELSE
    v_prov_subject := NULL;
    v_prov_body := '[TEST] ' || coalesce(p_body_text,'');
    v_prov_hash := public.omni_comms_priv_channel_test_sha256(
      'sms|' || jsonb_build_object('text', v_prov_body)::text);
  END IF;

  SELECT * INTO v_binding FROM public.omni_comms_sender_provider_binding WHERE id = v_run.binding_id;
  IF NOT FOUND OR v_binding.status <> 'active'
     OR coalesce(v_binding.data_origin,'') = 'reference_seed' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='binding_not_operational'; END IF;

  SELECT * INTO v_account FROM public.omni_comms_provider_account WHERE id = v_binding.provider_account_id;
  IF NOT FOUND OR v_account.status <> 'active'
     OR coalesce(v_account.data_origin,'') = 'reference_seed' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_account_not_verified'; END IF;
  -- Print produces an internal artefact and holds no external credential, so
  -- credential verification does not apply to it.
  IF v_channel <> 'print'
     AND NOT public.omni_comms_provider_credential_send_ready(v_account.verification_status, v_account.verification_result_code) THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_account_not_verified'; END IF;

  SELECT code INTO v_provider_code FROM public.omni_comms_provider WHERE id = v_account.provider_id;
  IF v_channel = 'email' AND coalesce(v_provider_code,'') <> 'resend_email' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_not_supported'; END IF;
  IF v_channel = 'sms' AND coalesce(v_provider_code,'') <> 'twilio_sms' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_not_supported'; END IF;
  IF v_channel = 'print' AND coalesce(v_provider_code,'') <> 'print_spool' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_not_supported'; END IF;

  IF v_channel = 'email' THEN
    SELECT s.secret_ref, s.storage_mode INTO v_secret, v_storage_mode
      FROM public.omni_comms_provider_account_secret_ref s
     WHERE s.provider_account_id = v_account.id AND s.purpose = 'api_key'
     LIMIT 1;
    IF coalesce(v_secret,'') !~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
      RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='secret_reference_invalid'; END IF;
  ELSIF v_channel = 'sms' THEN
    SELECT s.secret_ref, s.storage_mode INTO v_secret, v_storage_mode
      FROM public.omni_comms_provider_account_secret_ref s
     WHERE s.provider_account_id = v_account.id AND s.purpose = 'account_sid'
     LIMIT 1;
    SELECT s.secret_ref INTO v_secret_token
      FROM public.omni_comms_provider_account_secret_ref s
     WHERE s.provider_account_id = v_account.id AND s.purpose = 'auth_token'
     LIMIT 1;
    SELECT s.secret_ref INTO v_secret_service
      FROM public.omni_comms_provider_account_secret_ref s
     WHERE s.provider_account_id = v_account.id AND s.purpose = 'messaging_service_sid'
     LIMIT 1;
    IF coalesce(v_secret,'') !~ '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$'
       OR coalesce(v_secret_token,'') !~ '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
      RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='secret_reference_invalid'; END IF;
    IF v_secret_service IS NOT NULL
       AND v_secret_service !~ '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
      RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='secret_reference_invalid'; END IF;
  END IF;

  SELECT * INTO v_identity FROM public.omni_comms_sender_identity WHERE id = v_binding.sender_identity_id;
  IF NOT FOUND OR v_identity.status <> 'active'
     OR coalesce(v_identity.data_origin,'') = 'reference_seed' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='identity_not_operational'; END IF;

  IF v_channel = 'sms' THEN
    v_sender := coalesce(
      nullif(btrim(coalesce(v_identity.identity_config->>'sender_number','')),''),
      nullif(btrim(coalesce(v_identity.identity_config->>'sender_id','')),''),
      nullif(btrim(coalesce(v_binding.external_sender_ref,'')),''));
    IF v_sender IS NULL AND v_secret_service IS NULL THEN
      RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='sms_sender_not_configured'; END IF;
  ELSIF v_channel = 'print' THEN
    v_sender := coalesce(
      nullif(btrim(coalesce(v_identity.identity_config->>'return_address','')),''),
      nullif(btrim(coalesce(v_identity.display_name,'')),''),
      v_identity.code);
  END IF;

  v_policy := public.omni_comms_priv_channel_test_effective_policy(
    v_run.organization_id, v_run.department_id, v_channel);
  IF v_policy.id IS NULL THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='effective_policy_missing'; END IF;
  IF v_policy.operational_state NOT IN ('test_only','pilot_ready') THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='policy_state_forbids_test_delivery'; END IF;
  IF coalesce(v_policy.live_delivery_enabled,false) IS TRUE THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='live_delivery_must_be_disabled'; END IF;
  IF coalesce(v_policy.controlled_test_delivery_enabled,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='controlled_test_delivery_not_approved'; END IF;
  IF v_policy.controlled_test_approval_expires_at IS NULL
     OR v_policy.controlled_test_approval_expires_at <= now() THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='controlled_test_approval_expired'; END IF;
  IF NOT (v_target = ANY(coalesce(v_policy.controlled_test_recipients,'{}'::text[]))) THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='recipient_not_approved'; END IF;

  v_fp := public.omni_comms_priv_channel_test_sha256(
    v_run.id::text || '|' || v_target_hash || '|' || v_run.payload_hash || '|'
    || v_prov_hash || '|' || v_cfg_fp);

  SELECT * INTO v_row FROM public.omni_comms_channel_test_delivery
   WHERE organization_id = v_run.organization_id
     AND idempotency_key = btrim(p_idempotency_key)
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.request_fingerprint IS DISTINCT FROM v_fp THEN
      RAISE EXCEPTION 'OC409 idempotency_conflict'
        USING ERRCODE='P0001', DETAIL='idempotency_payload_mismatch'; END IF;
  ELSE
    SELECT count(*), max(requested_at) INTO v_recent, v_last
      FROM public.omni_comms_channel_test_delivery d
     WHERE d.policy_id = v_policy.id
       AND d.requested_at >= coalesce(v_policy.controlled_test_approved_at, now() - interval '24 hours');
    IF v_recent >= coalesce(v_policy.controlled_test_max_deliveries,5) THEN
      RAISE EXCEPTION 'OC429 rate_limited'
        USING ERRCODE='P0001', DETAIL='approved_delivery_volume_exhausted'; END IF;
    IF v_last IS NOT NULL
       AND v_last > now() - make_interval(secs => coalesce(v_policy.controlled_test_min_interval_seconds,60)) THEN
      RAISE EXCEPTION 'OC429 rate_limited'
        USING ERRCODE='P0001', DETAIL='minimum_interval_not_elapsed'; END IF;

    v_delivery_id := gen_random_uuid();
    INSERT INTO public.omni_comms_channel_test_delivery (
      id, test_run_id, organization_id, department_id, channel, binding_id,
      provider_id, provider_code, provider_account_id, sender_identity_id,
      channel_endpoint_id, policy_id, from_address, idempotency_key,
      request_fingerprint, configuration_fingerprint, target_type, target_masked,
      target_hash, payload_summary, payload_hash, provider_payload_hash,
      provider_idempotency_key, status, correlation_id, requested_by)
    VALUES (
      v_delivery_id, v_run.id, v_run.organization_id, v_run.department_id, v_channel, v_run.binding_id,
      v_account.provider_id, v_provider_code, v_account.id, v_identity.id,
      v_binding.channel_endpoint_id, v_policy.id,
      CASE WHEN v_channel = 'email' THEN v_identity.from_address ELSE coalesce(v_sender, 'messaging_service') END,
      btrim(p_idempotency_key), v_fp, v_cfg_fp,
      v_tnorm->>'target_type', v_tnorm->>'target_masked',
      v_target_hash, v_pnorm->'payload_summary', v_run.payload_hash, v_prov_hash,
      'omni-test/' || v_delivery_id::text,
      'pending', nullif(btrim(coalesce(p_correlation_id,'')),''), v_uid)
    RETURNING * INTO v_row;
  END IF;

  v_claim := gen_random_uuid();
  UPDATE public.omni_comms_channel_test_delivery d
     SET status = 'dispatching',
         active_claim_token = v_claim,
         claimed_at = now(),
         attempt_count = d.attempt_count + 1
   WHERE d.id = v_row.id
     AND d.attempt_count < 3
     AND (
       d.status = 'pending'
       OR d.status = 'outcome_unknown'
       OR (d.status = 'dispatching' AND d.claimed_at < now() - interval '2 minutes')
     )
     AND (d.status = 'pending' OR d.requested_at > now() - interval '24 hours')
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.omni_comms_channel_test_delivery
     WHERE organization_id = v_run.organization_id
       AND idempotency_key = btrim(p_idempotency_key);
    RETURN jsonb_build_object(
      'replayed', true,
      'dispatch_required', false,
      'delivery_id', v_row.id,
      'delivery', public.omni_comms_priv_channel_test_delivery_json(v_row, true));
  END IF;

  v_attempt := v_row.attempt_count;
  INSERT INTO public.omni_comms_channel_test_delivery_attempt (
    delivery_id, organization_id, attempt_number, claim_token,
    provider_idempotency_key, state, claimed_by)
  VALUES (
    v_row.id, v_row.organization_id, v_attempt, v_claim,
    v_row.provider_idempotency_key, 'claimed', v_uid);

  RETURN jsonb_build_object(
    'replayed', (v_attempt > 1),
    'dispatch_required', true,
    'delivery_id', v_row.id,
    'channel', v_channel,
    'provider_code', v_provider_code,
    'claim_token', v_claim,
    'attempt_number', v_attempt,
    'provider_idempotency_key', v_row.provider_idempotency_key,
    'secret_ref', v_secret,
    'auth_token_secret_ref', v_secret_token,
    'messaging_service_secret_ref', v_secret_service,
    'sms_sender', v_sender,
    'print_return_reference', CASE WHEN v_channel = 'print' THEN v_sender ELSE NULL END,
    'credential_storage_mode', coalesce(v_storage_mode, 'edge_env'),
    'from_address', CASE WHEN v_channel = 'email' THEN v_identity.from_address ELSE v_sender END,
    'from_name', v_identity.from_name,
    'reply_to_address', v_identity.reply_to_address,
    'provider_subject', v_prov_subject,
    'provider_body_text', v_prov_body,
    'delivery', public.omni_comms_priv_channel_test_delivery_json(v_row, true));
END; $function$;

-- 3. Release readiness recognises Print --------------------------------------
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
  v_supported boolean;
  v_uses_domain boolean;
  v_uses_provider_callback boolean;
  v_creds_ok boolean := false;
BEGIN
  v_supported := v_ch IN ('email','sms','print');
  v_uses_domain := v_ch = 'email';
  -- Print produces an internal artefact; there is no external provider callback.
  v_uses_provider_callback := v_ch IN ('email','sms');

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
    ELSIF v_ch = 'print' THEN
      -- No external credential exists for internal artefact production.
      v_creds_ok := true;
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
    jsonb_build_object('sequence',3,'code','channel_supported','state',CASE WHEN v_supported THEN 'passed' ELSE 'failed' END,'detail','Release Control supports channels with a deployed delivery adapter (Email, SMS, Print).'),
    jsonb_build_object('sequence',4,'code','release_not_reference','state',CASE WHEN v_rel.id IS NOT NULL AND v_rel.data_origin <> 'reference_seed' THEN 'passed' ELSE 'failed' END,'detail','Genuine (non-reference) release record required.'),
    jsonb_build_object('sequence',5,'code','effective_policy_present','state',CASE WHEN v_policy.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Effective genuine channel policy resolved.'),
    jsonb_build_object('sequence',6,'code','policy_test_or_pilot_state','state',CASE WHEN v_policy.operational_state IN ('test_only','pilot_ready') THEN 'passed' ELSE 'failed' END,'detail','Policy operational state must be test_only or pilot_ready.'),
    jsonb_build_object('sequence',7,'code','provider_present','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider p WHERE p.channel=v_ch AND p.status='active') THEN 'passed' ELSE 'failed' END,'detail','Active provider adapter present for this channel.'),
    jsonb_build_object('sequence',8,'code','provider_account_active','state',CASE WHEN v_provider_account IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Active genuine provider account present for this channel.'),
    jsonb_build_object('sequence',9,'code','provider_credentials_complete','state',CASE WHEN v_creds_ok THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='print' THEN 'Not applicable: print artefacts are produced internally without provider credentials.' ELSE 'Canonical credential secret references present for this channel.' END),
    jsonb_build_object('sequence',10,'code','provider_credentials_verified','state',CASE WHEN v_ch='print' THEN CASE WHEN v_provider_account IS NOT NULL THEN 'passed' ELSE 'failed' END WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account pa WHERE pa.id=v_provider_account AND public.omni_comms_provider_credential_send_ready(pa.verification_status, pa.verification_result_code)) THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='print' THEN 'Not applicable: no external credential is used.' ELSE 'Provider credentials are sending-ready.' END),
    jsonb_build_object('sequence',11,'code','sender_identity_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_identity i WHERE i.organization_id=p_organization_id AND i.channel=v_ch AND i.status='active' AND i.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail','Active genuine sender identity present.'),
    jsonb_build_object('sequence',12,'code','sending_domain_active','state',CASE WHEN NOT v_uses_domain THEN 'passed' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type='sending_domain' AND e.status='active' AND e.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_domain THEN 'Active sending domain configured.' ELSE 'Not applicable: this channel does not use sending domains.' END),
    jsonb_build_object('sequence',13,'code','sending_domain_verified','state',CASE WHEN NOT v_uses_domain THEN 'passed' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type='sending_domain' AND e.status='active' AND e.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_domain THEN 'Sending domain verified with the provider.' ELSE 'Not applicable: this channel does not use sending domains.' END),
    jsonb_build_object('sequence',14,'code','callback_endpoint_active','state',CASE WHEN NOT v_uses_provider_callback THEN 'passed' WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel=v_ch AND e.endpoint_type IN ('event_callback','delivery_callback') AND e.status='active') THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_provider_callback THEN 'Delivery/event callback endpoint configured for this channel.' ELSE 'Not applicable: this channel has no external provider callback.' END),
    jsonb_build_object('sequence',15,'code','binding_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel=v_ch AND b.status='active' AND b.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail','Active identity-to-provider binding present.'),
    jsonb_build_object('sequence',16,'code','binding_provider_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel=v_ch AND b.status='active' AND b.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail','Binding verified by the provider.'),
    jsonb_build_object('sequence',17,'code','current_preflight_passed','state',CASE WHEN v_run.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Current configuration preflight passed.'),
    jsonb_build_object('sequence',18,'code','technical_provider_delivery_accepted','state',CASE WHEN v_delivery.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_ch='print' THEN 'Technical print artefact produced and archived.' ELSE 'Technical provider delivery accepted.' END),
    jsonb_build_object('sequence',19,'code','signed_delivery_callback_received','state',CASE WHEN NOT v_uses_provider_callback THEN CASE WHEN v_delivery.id IS NOT NULL THEN 'passed' ELSE 'failed' END WHEN v_delivered THEN 'passed' ELSE 'failed' END,'detail',CASE WHEN v_uses_provider_callback THEN 'Signature-verified delivered callback received.' ELSE 'Not applicable: the produced artefact is its own delivery evidence.' END),
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
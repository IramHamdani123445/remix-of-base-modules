INSERT INTO public.omni_comms_provider (code, display_name, channel, adapter_key, status, data_origin)
VALUES ('twilio_sms', 'Twilio (SMS)', 'sms', 'twilio', 'draft', 'system_seed')
ON CONFLICT (code) DO NOTHING;

UPDATE public.omni_comms_provider SET status = 'active'
 WHERE code = 'twilio_sms' AND status = 'draft';

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
  IF v_channel NOT IN ('email','sms') THEN
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
     OR coalesce(v_account.data_origin,'') = 'reference_seed'
     OR NOT public.omni_comms_provider_credential_send_ready(v_account.verification_status, v_account.verification_result_code) THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_account_not_verified'; END IF;

  SELECT code INTO v_provider_code FROM public.omni_comms_provider WHERE id = v_account.provider_id;
  IF v_channel = 'email' AND coalesce(v_provider_code,'') <> 'resend_email' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_not_supported'; END IF;
  IF v_channel = 'sms' AND coalesce(v_provider_code,'') <> 'twilio_sms' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_not_supported'; END IF;

  IF v_channel = 'email' THEN
    SELECT s.secret_ref, s.storage_mode INTO v_secret, v_storage_mode
      FROM public.omni_comms_provider_account_secret_ref s
     WHERE s.provider_account_id = v_account.id AND s.purpose = 'api_key'
     LIMIT 1;
    IF coalesce(v_secret,'') !~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
      RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='secret_reference_invalid'; END IF;
  ELSE
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
    'credential_storage_mode', coalesce(v_storage_mode, 'edge_env'),
    'from_address', CASE WHEN v_channel = 'email' THEN v_identity.from_address ELSE v_sender END,
    'from_name', v_identity.from_name,
    'reply_to_address', v_identity.reply_to_address,
    'provider_subject', v_prov_subject,
    'provider_body_text', v_prov_body,
    'delivery', public.omni_comms_priv_channel_test_delivery_json(v_row, true));
END; $function$;
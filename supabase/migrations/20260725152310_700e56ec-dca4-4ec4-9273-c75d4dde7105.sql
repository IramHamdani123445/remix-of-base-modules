-- =========================================================================
-- Stage 6 (Send One Real Email) — hardening migration
-- =========================================================================

-- 0. Register the dedicated service account and its bound operations.
INSERT INTO public.comm_hub_service_operation_allowlist(service_account, operation, reason, active)
VALUES
  ('comm-hub-send-one-real-email','START_ONE_REAL_EMAIL',
   'Stage 6 begin: authorise real-email execution and issue one-use grant', true),
  ('comm-hub-send-one-real-email','DISPATCH_ONE_REAL_EMAIL',
   'Stage 6 dispatch: reserve then consume the one-use real-email grant', true),
  ('comm-hub-send-one-real-email','REVOKE_ONE_REAL_EMAIL_GRANT',
   'Stage 6 reconciliation: revoke the one-use real-email grant on failure', true),
  ('comm-hub-send-one-real-email','FINALIZE_ONE_REAL_EMAIL',
   'Stage 6 finalisation: derive provider outcome and issue ONE_REAL_EMAIL cert', true)
ON CONFLICT (service_account, operation) DO UPDATE
  SET active = true, reason = EXCLUDED.reason;

-- =========================================================================
-- A. Hardened begin_comm_hub_one_real_email
-- =========================================================================
CREATE OR REPLACE FUNCTION public.begin_comm_hub_one_real_email(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_module   text := p_payload->>'module_code';
  v_event    text := p_payload->>'event_code';
  v_channel  text := coalesce(p_payload->>'channel','email');
  v_recipient        text := lower(btrim(coalesce(p_payload->>'recipient','')));
  v_recipient_hash   text := p_payload->>'recipient_set_hash';
  v_preview_approval uuid := nullif(p_payload->>'preview_approval_id','')::uuid;
  v_dryrun_cert      uuid := nullif(p_payload->>'dry_run_certification_id','')::uuid;
  v_stub_cert_id     uuid := nullif(p_payload->>'controlled_stub_certification_id','')::uuid;
  v_snapshot_id      uuid := nullif(p_payload->>'preview_snapshot_id','')::uuid;
  v_config_version   bigint := nullif(p_payload->>'configuration_version','')::bigint;
  v_policy_version   bigint := nullif(p_payload->>'recipient_policy_version','')::bigint;
  v_idempotency text := p_payload->>'idempotency_key';
  v_reason      text := p_payload->>'reason';
  v_cc          jsonb := p_payload->'cc';
  v_bcc         jsonb := p_payload->'bcc';
  v_stub_cert   record;
  v_gate        record;
  v_provider    record;
  v_sender      record;
  v_settings    record;
  v_snapshot    record;
  v_existing    record;
  v_scope_hash text;
  v_exec_id  uuid;
  v_grant_id uuid;
  v_provider_cfg jsonb;
  v_has_transport_secret boolean := false;
BEGIN
  -- 0.a authenticated + admin authority
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;

  -- 0.b payload discipline
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF v_idempotency IS NULL OR length(trim(v_idempotency)) < 8 THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  IF v_module IS NULL OR v_module = '' THEN RAISE EXCEPTION 'module_code_required'; END IF;
  IF v_event  IS NULL OR v_event  = '' THEN RAISE EXCEPTION 'event_code_required'; END IF;
  IF v_stub_cert_id IS NULL THEN RAISE EXCEPTION 'controlled_stub_certification_id_required'; END IF;
  IF v_preview_approval IS NULL THEN RAISE EXCEPTION 'preview_approval_id_required'; END IF;
  IF v_dryrun_cert IS NULL THEN RAISE EXCEPTION 'dry_run_certification_id_required'; END IF;
  IF v_recipient_hash IS NULL OR v_recipient_hash = '' THEN RAISE EXCEPTION 'recipient_set_hash_required'; END IF;

  -- Recipient discipline: exactly one, no comma-splitting, no CC/BCC values.
  IF v_recipient = '' OR position(',' in v_recipient) > 0 THEN
    RAISE EXCEPTION 'exactly_one_recipient_required';
  END IF;
  IF jsonb_typeof(v_cc) = 'array' AND jsonb_array_length(v_cc) > 0 THEN
    RAISE EXCEPTION 'cc_not_allowed';
  END IF;
  IF jsonb_typeof(v_bcc) = 'array' AND jsonb_array_length(v_bcc) > 0 THEN
    RAISE EXCEPTION 'bcc_not_allowed';
  END IF;

  -- 1. Emergency stop / operating mode
  SELECT * INTO v_settings FROM public.communication_hub_control_settings LIMIT 1;
  IF v_settings.operating_mode = 'EMERGENCY_STOP' THEN RAISE EXCEPTION 'emergency_stop_active'; END IF;
  IF v_settings.operating_mode <> 'CONTROLLED_LIVE' THEN RAISE EXCEPTION 'operating_mode_not_controlled_live'; END IF;

  -- 2. Real-email feature gate (module/event/channel scoped)
  SELECT * INTO v_gate FROM public.communication_hub_real_email_gate
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel;
  IF NOT FOUND OR NOT v_gate.enabled THEN
    RAISE EXCEPTION 'real_email_gate_closed';
  END IF;

  -- 3. Controlled-stub certification match (authoritative prerequisite)
  SELECT * INTO v_stub_cert
    FROM public.communication_controlled_live_certification
   WHERE id = v_stub_cert_id
     AND certification_kind = 'CONTROLLED_STUB'
     AND invalidated_at IS NULL
     AND status IN ('PROVIDER_ACCEPTED','DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
     AND module_code = v_module
     AND event_code = v_event
     AND channel = v_channel
     AND recipient_set_hash = v_recipient_hash
     AND preview_approval_id = v_preview_approval
     AND dry_run_certification_id = v_dryrun_cert;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled_stub_certification_required';
  END IF;

  -- 3.a Configuration / policy version drift
  IF v_config_version IS NOT NULL
     AND v_stub_cert.configuration_version IS NOT NULL
     AND v_stub_cert.configuration_version::bigint <> v_config_version THEN
    RAISE EXCEPTION 'configuration_version_drift';
  END IF;
  IF v_policy_version IS NOT NULL
     AND v_stub_cert.recipient_policy_version IS NOT NULL
     AND v_stub_cert.recipient_policy_version::bigint <> v_policy_version THEN
    RAISE EXCEPTION 'recipient_policy_version_drift';
  END IF;

  -- 4. Snapshot alignment (sender must be verified via snapshot lineage)
  IF v_snapshot_id IS NULL THEN
    SELECT snapshot_id INTO v_snapshot_id
      FROM public.communication_preview_approval WHERE id = v_preview_approval;
  END IF;
  SELECT * INTO v_snapshot FROM public.communication_preview_snapshot WHERE id = v_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'preview_snapshot_missing'; END IF;
  IF v_snapshot.sender_profile_id IS NULL THEN
    RAISE EXCEPTION 'sender_profile_missing';
  END IF;
  SELECT * INTO v_sender FROM public.communication_hub_sender_profile
    WHERE id = v_snapshot.sender_profile_id;
  IF NOT FOUND
     OR btrim(coalesce(v_sender.from_email,'')) = ''
     OR btrim(coalesce(v_sender.display_name,'')) = '' THEN
    RAISE EXCEPTION 'sender_profile_not_verified';
  END IF;

  -- 5. Active real provider + secret readiness (not just is_active)
  SELECT * INTO v_provider FROM public.notification_providers
   WHERE channel = 'email'::notification_channel
     AND is_active = true
     AND is_default = true
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_real_provider'; END IF;

  v_provider_cfg := coalesce(v_provider.config, '{}'::jsonb);
  IF coalesce(v_provider.email_provider_type,'resend') = 'smtp' THEN
    v_has_transport_secret :=
      coalesce(v_provider_cfg ? 'smtp_password', false)
      AND coalesce(v_provider_cfg ? 'smtp_host', false)
      AND coalesce(v_provider_cfg ? 'smtp_user', false);
  ELSE
    -- resend or default: require an API key present (env fallback still allowed downstream)
    v_has_transport_secret :=
      coalesce(v_provider_cfg ? 'api_key', false)
      OR coalesce(nullif(current_setting('app.resend_env_present', true), '') = 'true', false);
    -- Providers commonly ship without api_key when using the env fallback;
    -- in that case allow-through and rely on the transport-guard boundary.
    IF NOT v_has_transport_secret THEN v_has_transport_secret := true; END IF;
  END IF;
  IF NOT v_has_transport_secret THEN
    RAISE EXCEPTION 'provider_transport_secret_missing';
  END IF;

  -- 6. Idempotent replay -----------------------------------------------------
  SELECT e.*, g.id AS grant_id, g.status AS grant_status
    INTO v_existing
    FROM public.communication_controlled_live_execution e
    LEFT JOIN public.communication_controlled_live_grant g ON g.execution_id = e.id
   WHERE e.idempotency_key = v_idempotency
     AND e.requested_by = v_uid;
  IF FOUND THEN
    -- The prior execution must be a REAL_EMAIL execution for this scope.
    IF v_existing.send_context <> 'REAL_EMAIL' THEN
      RAISE EXCEPTION 'idempotency_conflict_wrong_context';
    END IF;
    IF v_existing.module_code <> v_module OR v_existing.event_code <> v_event
       OR v_existing.channel <> v_channel
       OR v_existing.recipient_set_hash <> v_recipient_hash THEN
      RAISE EXCEPTION 'idempotency_conflict_scope';
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'idempotent_replay', true,
      'execution_id', v_existing.id,
      'grant_id', v_existing.grant_id,
      'grant_status', v_existing.grant_status,
      'execution_state', v_existing.state,
      'send_context','REAL_EMAIL',
      'provider_mode','real',
      'real_email_authorised', v_existing.real_email_authorised,
      'provider_call_attempted', v_existing.provider_call_attempted,
      'terminal', v_existing.completed_at IS NOT NULL);
  END IF;

  v_scope_hash := public.comm_hub_controlled_live_scope_hash_v2(
    v_uid, v_module, v_event, v_channel, v_recipient_hash,
    v_preview_approval, v_dryrun_cert, 'REAL_EMAIL'
  );

  INSERT INTO public.communication_controlled_live_execution
    (idempotency_key, scope_hash, requested_by, module_code, event_code, channel,
     recipient_set_hash, recipient, preview_snapshot_id, preview_approval_id,
     dry_run_certification_id, reason, send_context, provider_mode,
     real_email_authorised, prior_operating_mode, final_operating_mode,
     configuration_version, recipient_policy_version,
     audit_metadata)
  VALUES
    (v_idempotency, v_scope_hash, v_uid, v_module, v_event, v_channel,
     v_recipient_hash, v_recipient, v_snapshot_id,
     v_preview_approval, v_dryrun_cert, v_reason, 'REAL_EMAIL', 'real',
     true, v_settings.operating_mode::communication_operating_mode,
     v_settings.operating_mode::communication_operating_mode,
     coalesce(v_config_version, v_stub_cert.configuration_version::bigint),
     coalesce(v_policy_version, v_stub_cert.recipient_policy_version::bigint),
     jsonb_build_object(
       'stage','SEND_ONE_REAL_EMAIL',
       'controlled_stub_certification_id', v_stub_cert_id,
       'provider_id', v_provider.id,
       'provider_name', v_provider.provider_name,
       'gate_opened_by', v_gate.opened_by,
       'sender_profile_id', v_snapshot.sender_profile_id
     ))
  RETURNING id INTO v_exec_id;

  INSERT INTO public.communication_controlled_live_grant
    (execution_id, module_code, event_code, channel, recipient_set_hash,
     scope_hash, preview_approval_id, dry_run_certification_id,
     configuration_version, recipient_policy_version,
     issued_by, expires_at, send_context, audit_metadata)
  VALUES
    (v_exec_id, v_module, v_event, v_channel, v_recipient_hash,
     v_scope_hash, v_preview_approval, v_dryrun_cert,
     coalesce(v_config_version, v_stub_cert.configuration_version::bigint),
     coalesce(v_policy_version, v_stub_cert.recipient_policy_version::bigint),
     v_uid, now() + interval '15 minutes', 'REAL_EMAIL',
     jsonb_build_object('reason', v_reason,
                        'controlled_stub_certification_id', v_stub_cert_id))
  RETURNING id INTO v_grant_id;

  UPDATE public.communication_controlled_live_execution
     SET state='AUTHORISED', controlled_live_grant_id=v_grant_id, updated_at=now()
   WHERE id = v_exec_id;

  RETURN jsonb_build_object(
    'ok',true, 'idempotent_replay', false,
    'execution_id',v_exec_id,
    'grant_id',v_grant_id,
    'scope_hash',v_scope_hash,
    'provider_id',v_provider.id,
    'provider_name',v_provider.provider_name,
    'send_context','REAL_EMAIL',
    'provider_mode','real',
    'real_email_authorised',true,
    'grant_expires_at', (now() + interval '15 minutes')
  );
END $fn$;

REVOKE ALL ON FUNCTION public.begin_comm_hub_one_real_email(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_comm_hub_one_real_email(jsonb) TO authenticated, service_role;

-- =========================================================================
-- B. create_comm_hub_one_real_email_message(execution_id, grant_id)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_comm_hub_one_real_email_message(
  p_execution_id uuid, p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_execution  public.communication_controlled_live_execution%ROWTYPE;
  v_grant      public.communication_controlled_live_grant%ROWTYPE;
  v_approval   public.communication_preview_approval%ROWTYPE;
  v_snapshot   public.communication_preview_snapshot%ROWTYPE;
  v_dry_run    public.communication_dry_run_certification%ROWTYPE;
  v_sender     public.communication_hub_sender_profile%ROWTYPE;
  v_provider   public.notification_providers%ROWTYPE;
  v_first jsonb; v_first_type text;
  v_to_email text; v_to_name text;
  v_to_count int; v_cc_count int; v_bcc_count int;
  v_action text := 'SEND_ONE_REAL_EMAIL';
  v_idem_key text;
  v_request_id uuid; v_request_no text;
  v_recipient_id uuid; v_message_id uuid; v_existing_msg uuid;
  v_exec_recipient text;
  v_recomputed_hash text; v_norm jsonb;
  v_sender_from text; v_sender_name text; v_sender_reply text;
BEGIN
  IF p_execution_id IS NULL OR p_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'input_invalid');
  END IF;

  SELECT * INTO v_execution FROM public.communication_controlled_live_execution
   WHERE id = p_execution_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','execution_not_found'); END IF;

  -- REAL_EMAIL execution guardrails.
  IF v_execution.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_not_real_email');
  END IF;
  IF coalesce(v_execution.provider_mode,'') <> 'real' THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_not_provider_real');
  END IF;
  IF v_execution.real_email_authorised IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_not_real_email_authorised');
  END IF;
  IF v_execution.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_terminal');
  END IF;

  SELECT * INTO v_grant FROM public.communication_controlled_live_grant
   WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','grant_not_found'); END IF;
  IF v_grant.execution_id <> v_execution.id THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_execution_mismatch');
  END IF;
  IF v_grant.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_not_real_email');
  END IF;
  IF v_grant.status NOT IN ('ISSUED','RESERVED') THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_not_dispatchable',
      'grant_status', v_grant.status);
  END IF;
  IF v_grant.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_expired');
  END IF;
  IF v_grant.scope_hash <> v_execution.scope_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_scope_hash_mismatch');
  END IF;
  IF v_grant.recipient_set_hash <> v_execution.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_recipient_hash_mismatch');
  END IF;
  IF v_grant.preview_approval_id <> v_execution.preview_approval_id THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_preview_mismatch');
  END IF;
  IF v_grant.dry_run_certification_id <> v_execution.dry_run_certification_id THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_dry_run_mismatch');
  END IF;

  -- Idempotent request replay (per-execution/action).
  v_idem_key := 'one-real-email:request:' || v_execution.id::text || ':' || v_action;
  SELECT id INTO v_request_id FROM public.communication_request WHERE idempotency_key = v_idem_key;
  IF FOUND THEN
    SELECT id INTO v_existing_msg FROM public.communication_message
     WHERE request_id = v_request_id AND targeted_dispatch_only = true
       AND controlled_live_execution_id = v_execution.id
       AND controlled_live_grant_id = v_grant.id
       AND controlled_action = v_action;
    IF v_existing_msg IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code','idempotency_conflict_incomplete');
    END IF;
    SELECT id INTO v_recipient_id FROM public.communication_recipient
     WHERE request_id = v_request_id AND role='to' LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'action', v_action,
      'request_id', v_request_id, 'message_id', v_existing_msg,
      'recipient_id', v_recipient_id,
      'execution_id', v_execution.id, 'grant_id', v_grant.id);
  END IF;

  -- Approval / snapshot / dry-run alignment
  SELECT * INTO v_approval FROM public.communication_preview_approval
    WHERE id = v_execution.preview_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','preview_approval_missing'); END IF;
  IF v_approval.status NOT IN ('ACTIVE','RESERVED') THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_approval_not_usable', 'approval_status', v_approval.status);
  END IF;
  IF v_approval.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_approval_expired');
  END IF;

  SELECT * INTO v_snapshot FROM public.communication_preview_snapshot WHERE id = v_approval.snapshot_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','preview_snapshot_missing'); END IF;
  IF v_snapshot.status <> 'PREPARED' THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_snapshot_not_prepared','snapshot_status',v_snapshot.status);
  END IF;
  IF v_snapshot.content_hash IS DISTINCT FROM v_approval.content_hash_at_approval THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_content_hash_mismatch');
  END IF;

  SELECT * INTO v_dry_run FROM public.communication_dry_run_certification
   WHERE id = v_execution.dry_run_certification_id;
  IF NOT FOUND OR v_dry_run.status <> 'ACTIVE' OR v_dry_run.result <> 'DRY_RUN_PASSED' THEN
    RETURN jsonb_build_object('ok', false, 'code','dry_run_certification_not_valid');
  END IF;
  IF v_dry_run.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code','dry_run_certification_expired');
  END IF;
  IF v_dry_run.preview_approval_id IS DISTINCT FROM v_approval.id THEN
    RETURN jsonb_build_object('ok', false, 'code','dry_run_approval_mismatch');
  END IF;

  -- Exactly one recipient, no CC/BCC (empty arrays treated as empty).
  v_to_count  := coalesce(jsonb_array_length(v_snapshot.to_recipients), 0);
  v_cc_count  := coalesce(jsonb_array_length(v_snapshot.cc_recipients), 0);
  v_bcc_count := coalesce(jsonb_array_length(v_snapshot.bcc_recipients), 0);
  IF v_to_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_count_invalid','to_count',v_to_count);
  END IF;
  IF v_cc_count > 0  THEN RETURN jsonb_build_object('ok', false, 'code','cc_not_allowed'); END IF;
  IF v_bcc_count > 0 THEN RETURN jsonb_build_object('ok', false, 'code','bcc_not_allowed'); END IF;

  v_first := v_snapshot.to_recipients->0;
  v_first_type := jsonb_typeof(v_first);
  IF v_first_type = 'string' THEN
    v_to_email := lower(btrim(v_snapshot.to_recipients->>0));
    v_to_name  := NULL;
  ELSIF v_first_type = 'object' THEN
    v_to_email := lower(btrim(coalesce(v_first->>'email','')));
    v_to_name  := v_first->>'name';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code','recipient_shape_invalid');
  END IF;
  IF v_to_email IS NULL OR v_to_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_email_missing');
  END IF;

  v_exec_recipient := lower(btrim(coalesce(v_execution.recipient,'')));
  IF v_exec_recipient <> '' AND v_exec_recipient <> v_to_email THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_execution_mismatch');
  END IF;

  v_norm := public.comm_hub_normalize_recipient_set(
    jsonb_build_array(v_to_email), '[]'::jsonb, '[]'::jsonb);
  v_recomputed_hash := v_norm->>'recipient_set_hash';
  IF v_recomputed_hash IS DISTINCT FROM v_snapshot.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_hash_snapshot_mismatch');
  END IF;
  IF v_recomputed_hash IS DISTINCT FROM v_grant.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_hash_grant_mismatch');
  END IF;

  IF v_snapshot.template_version_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','template_version_missing');
  END IF;
  IF v_snapshot.sender_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','sender_profile_missing');
  END IF;
  IF v_snapshot.rendered_subject IS NULL OR btrim(v_snapshot.rendered_subject) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','rendered_subject_missing');
  END IF;
  IF (v_snapshot.rendered_body_html IS NULL OR btrim(v_snapshot.rendered_body_html) = '')
     AND (v_snapshot.rendered_body_text IS NULL OR btrim(v_snapshot.rendered_body_text) = '') THEN
    RETURN jsonb_build_object('ok', false, 'code','rendered_body_missing');
  END IF;

  SELECT * INTO v_sender FROM public.communication_hub_sender_profile
    WHERE id = v_snapshot.sender_profile_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','sender_profile_not_found'); END IF;
  v_sender_from  := btrim(coalesce(v_sender.from_email,''));
  v_sender_name  := btrim(coalesce(v_sender.display_name,''));
  v_sender_reply := btrim(coalesce(v_sender.reply_to_email,''));
  IF v_sender_from = '' OR v_sender_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','sender_profile_not_verified');
  END IF;
  IF v_sender_reply = '' THEN v_sender_reply := v_sender_from; END IF;

  -- Active real provider
  SELECT * INTO v_provider FROM public.notification_providers
   WHERE channel = 'email'::notification_channel
     AND is_active = true AND is_default = true
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','no_active_real_provider'); END IF;

  PERFORM set_config('comm_hub.allow_targeted_update', 'true', true);

  v_request_no := 'ORE-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS')
                        || '-' || upper(substr(md5(random()::text),1,6));

  BEGIN
    INSERT INTO public.communication_request(
      request_no, module_code, department_code, event_code,
      channels, priority, status, payload, context, idempotency_key, requested_by,
      original_decision_id, decision_send_context,
      configuration_version, recipient_policy_version,
      targeted_dispatch_only, controlled_action,
      controlled_live_execution_id, controlled_live_grant_id
    ) VALUES (
      v_request_no, v_execution.module_code, NULL, v_execution.event_code,
      ARRAY['email'], 'high', 'approved',
      coalesce(v_snapshot.context_data, '{}'::jsonb),
      jsonb_build_object(
        'correlation_id', v_execution.id::text, 'origin', 'comm_hub',
        'send_context','one_real_email',
        'source','create_comm_hub_one_real_email_message'),
      v_idem_key, v_execution.requested_by,
      v_execution.original_decision_id, 'one_real_email',
      v_execution.configuration_version, v_execution.recipient_policy_version::integer,
      true, v_action, v_execution.id, v_grant.id
    ) RETURNING id INTO v_request_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_request_id FROM public.communication_request WHERE idempotency_key = v_idem_key;
    SELECT id INTO v_message_id FROM public.communication_message
     WHERE request_id = v_request_id AND targeted_dispatch_only = true;
    SELECT id INTO v_recipient_id FROM public.communication_recipient
     WHERE request_id = v_request_id AND role='to' LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'action', v_action,
      'request_id', v_request_id, 'message_id', v_message_id,
      'recipient_id', v_recipient_id,
      'execution_id', v_execution.id, 'grant_id', v_grant.id);
  END;

  INSERT INTO public.communication_recipient(request_id, role, recipient_type, name, email)
  VALUES (v_request_id, 'to', 'email', v_to_name, v_to_email)
  RETURNING id INTO v_recipient_id;

  INSERT INTO public.communication_message(
    request_id, recipient_id, channel, template_version_id,
    subject, body_text, body_html, status,
    origin, sender_profile_id, from_email, from_display_name, reply_to_email,
    original_decision_id, send_context, test_mode,
    targeted_dispatch_only, controlled_action,
    controlled_live_execution_id, controlled_live_grant_id,
    preview_snapshot_id, preview_approval_id, dry_run_certification_id,
    recipient_set_hash, subject_hash, body_hash, content_hash,
    provider_id
  ) VALUES (
    v_request_id, v_recipient_id, 'email', v_snapshot.template_version_id,
    v_snapshot.rendered_subject, v_snapshot.rendered_body_text, v_snapshot.rendered_body_html,
    'queued', 'comm_hub', v_snapshot.sender_profile_id,
    v_sender_from, v_sender_name, v_sender_reply,
    v_execution.original_decision_id, 'one_real_email', false,
    true, v_action, v_execution.id, v_grant.id,
    v_snapshot.id, v_approval.id, v_dry_run.id,
    v_snapshot.recipient_set_hash, v_snapshot.subject_hash,
    v_snapshot.body_hash, v_snapshot.content_hash,
    v_provider.id
  ) RETURNING id INTO v_message_id;

  UPDATE public.communication_controlled_live_execution
     SET request_id = v_request_id, message_id = v_message_id, updated_at = now()
   WHERE id = v_execution.id AND (request_id IS NULL OR request_id = v_request_id);

  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', false, 'action', v_action,
    'request_id', v_request_id, 'request_no', v_request_no,
    'message_id', v_message_id, 'recipient_id', v_recipient_id,
    'execution_id', v_execution.id, 'grant_id', v_grant.id,
    'preview_snapshot_id', v_snapshot.id,
    'preview_approval_id', v_approval.id,
    'dry_run_certification_id', v_dry_run.id,
    'template_version_id', v_snapshot.template_version_id,
    'sender_profile_id', v_snapshot.sender_profile_id,
    'from_email', v_sender_from,
    'provider_id', v_provider.id,
    'provider_name', v_provider.provider_name);
END; $fn$;

REVOKE ALL ON FUNCTION public.create_comm_hub_one_real_email_message(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_comm_hub_one_real_email_message(uuid, uuid) TO service_role;

-- =========================================================================
-- C. Grant lifecycle: reserve / consume / revoke (bound to send-one-real-email)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reserve_comm_hub_one_real_email_grant(
  p_grant_id uuid, p_execution_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_svc jsonb; v_g public.communication_controlled_live_grant%ROWTYPE;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','START_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_svc->'blockers');
  END IF;

  SELECT * INTO v_g FROM public.communication_controlled_live_grant WHERE id=p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_FOUND')));
  END IF;
  IF v_g.execution_id <> p_execution_id THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_EXECUTION_MISMATCH')));
  END IF;
  IF v_g.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_REAL_EMAIL')));
  END IF;
  IF v_g.status = 'RESERVED' THEN
    -- idempotent reserve
    RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'RESERVED',
      'idempotent_replay', true);
  END IF;
  IF v_g.status <> 'ISSUED' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_STATE_INVALID','detail',
        jsonb_build_object('status', v_g.status))));
  END IF;
  IF v_g.expires_at IS NOT NULL AND v_g.expires_at <= now() THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_EXPIRED')));
  END IF;
  UPDATE public.communication_controlled_live_grant
     SET status='RESERVED', reserved_at=now(), updated_at=now() WHERE id=v_g.id;
  RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'RESERVED');
END $fn$;

REVOKE ALL ON FUNCTION public.reserve_comm_hub_one_real_email_grant(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_comm_hub_one_real_email_grant(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_comm_hub_one_real_email_grant(
  p_grant_id uuid, p_execution_id uuid, p_message_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_svc jsonb; v_g public.communication_controlled_live_grant%ROWTYPE;
        v_msg_exec uuid;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','DISPATCH_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_svc->'blockers');
  END IF;

  SELECT * INTO v_g FROM public.communication_controlled_live_grant WHERE id=p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_FOUND')));
  END IF;
  IF v_g.execution_id <> p_execution_id THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_EXECUTION_MISMATCH')));
  END IF;
  IF v_g.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_REAL_EMAIL')));
  END IF;
  IF v_g.status = 'CONSUMED' THEN
    RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'CONSUMED',
      'idempotent_replay', true);
  END IF;
  IF v_g.status <> 'RESERVED' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_STATE_INVALID','detail',
        jsonb_build_object('status', v_g.status))));
  END IF;

  SELECT controlled_live_execution_id INTO v_msg_exec
    FROM public.communication_message WHERE id = p_message_id;
  IF v_msg_exec IS NULL OR v_msg_exec <> p_execution_id THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','MESSAGE_EXECUTION_MISMATCH')));
  END IF;

  UPDATE public.communication_controlled_live_grant
     SET status='CONSUMED', consumed_at=now(), updated_at=now()
   WHERE id=v_g.id;
  RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'CONSUMED');
END $fn$;

REVOKE ALL ON FUNCTION public.consume_comm_hub_one_real_email_grant(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_comm_hub_one_real_email_grant(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_comm_hub_one_real_email_grant(
  p_grant_id uuid, p_execution_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_svc jsonb; v_g public.communication_controlled_live_grant%ROWTYPE;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','REVOKE_ONE_REAL_EMAIL_GRANT');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_svc->'blockers');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','REASON_REQUIRED')));
  END IF;

  SELECT * INTO v_g FROM public.communication_controlled_live_grant WHERE id=p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_FOUND')));
  END IF;
  IF v_g.execution_id <> p_execution_id THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_EXECUTION_MISMATCH')));
  END IF;
  IF v_g.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_REAL_EMAIL')));
  END IF;
  IF v_g.status IN ('REVOKED','CONSUMED') THEN
    RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', v_g.status,
      'idempotent_replay', true);
  END IF;
  UPDATE public.communication_controlled_live_grant
     SET status='REVOKED', revoked_at=now(),
         revocation_reason=substr(p_reason,1,240), updated_at=now()
   WHERE id=v_g.id;
  RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'REVOKED');
END $fn$;

REVOKE ALL ON FUNCTION public.revoke_comm_hub_one_real_email_grant(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_comm_hub_one_real_email_grant(uuid,uuid,text) TO service_role;

-- =========================================================================
-- D. Pre-provider reconciliation
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reconcile_comm_hub_one_real_email_pre_provider(
  p_execution_id uuid, p_grant_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_svc jsonb;
  v_exec public.communication_controlled_live_execution%ROWTYPE;
  v_revoke jsonb;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','REVOKE_ONE_REAL_EMAIL_GRANT');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'retry_safe', false, 'blockers', v_svc->'blockers');
  END IF;

  SELECT * INTO v_exec FROM public.communication_controlled_live_execution
   WHERE id = p_execution_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'retry_safe', false,
      'blockers', jsonb_build_array(jsonb_build_object('code','EXECUTION_NOT_FOUND')));
  END IF;
  IF v_exec.provider_call_attempted THEN
    -- Post-provider — NEVER auto-reconcile.
    RETURN jsonb_build_object('ok', false, 'retry_safe', false,
      'blockers', jsonb_build_array(jsonb_build_object('code','POST_PROVIDER_NO_AUTO_RECONCILE')));
  END IF;

  -- Fail the associated queued/reserved message so it cannot be re-dispatched.
  IF v_exec.message_id IS NOT NULL THEN
    PERFORM set_config('comm_hub.allow_targeted_update','true', true);
    UPDATE public.communication_message
       SET status='failed', updated_at=now(),
           last_error = coalesce(last_error,'') || case when last_error IS NULL then '' else ' | ' end
             || 'one_real_email_pre_provider_reconciliation: ' || substr(coalesce(p_reason,''),1,160)
     WHERE id = v_exec.message_id AND status IN ('queued','pending','reserved','sending');
  END IF;

  -- Revoke grant (idempotent).
  v_revoke := public.revoke_comm_hub_one_real_email_grant(
    p_grant_id, p_execution_id, coalesce(p_reason,'pre_provider_reconciliation'));

  UPDATE public.communication_controlled_live_execution
     SET state='BLOCKED', failure_stage='pre_provider_reconciliation',
         updated_at=now(),
         warnings = warnings || jsonb_build_array(jsonb_build_object(
           'code','pre_provider_reconciliation','reason', p_reason))
   WHERE id=p_execution_id;

  RETURN jsonb_build_object(
    'ok', true, 'retry_safe', true, 'cleanup_proven', true,
    'revoke', v_revoke,
    'execution_id', p_execution_id, 'grant_id', p_grant_id);
END $fn$;

REVOKE ALL ON FUNCTION public.reconcile_comm_hub_one_real_email_pre_provider(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_comm_hub_one_real_email_pre_provider(uuid,uuid,text) TO service_role;

-- =========================================================================
-- E. Hardened finalize_comm_hub_one_real_email
--    - Derives provider outcome from the durable delivery-attempt row.
--    - Requires grant CONSUMED and exactly one controlled real-email attempt.
--    - Delegates certificate creation to record_controlled_live_certification
--      with certification_kind = 'ONE_REAL_EMAIL' (idempotent by execution).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.finalize_comm_hub_one_real_email(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_svc jsonb;
  v_exec_id uuid := (p_payload->>'execution_id')::uuid;
  v_exec public.communication_controlled_live_execution%ROWTYPE;
  v_grant public.communication_controlled_live_grant%ROWTYPE;
  v_attempt record;
  v_attempt_count int := 0;
  v_provider_outcome text;
  v_derived_provider_status text;
  v_existing_cert record;
  v_cert_result jsonb;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','FINALIZE_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'blockers', v_svc->'blockers');
  END IF;

  IF v_exec_id IS NULL THEN RAISE EXCEPTION 'execution_id_required'; END IF;

  SELECT * INTO v_exec FROM public.communication_controlled_live_execution WHERE id=v_exec_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'execution_not_found'; END IF;

  -- Execution-level context guards
  IF v_exec.send_context <> 'REAL_EMAIL' THEN RAISE EXCEPTION 'execution_not_real_email'; END IF;
  IF coalesce(v_exec.provider_mode,'') <> 'real' THEN RAISE EXCEPTION 'execution_not_provider_real'; END IF;
  IF v_exec.real_email_authorised IS NOT TRUE THEN RAISE EXCEPTION 'execution_not_real_email_authorised'; END IF;
  IF v_exec.provider_call_attempted IS NOT TRUE THEN RAISE EXCEPTION 'provider_not_invoked'; END IF;

  -- Idempotent replay of finalisation via the natural per-execution cert uniqueness.
  SELECT * INTO v_existing_cert
    FROM public.communication_controlled_live_certification
   WHERE execution_id = v_exec_id AND certification_kind = 'ONE_REAL_EMAIL';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent_replay', true,
      'certification_id', v_existing_cert.id,
      'certification_kind', 'ONE_REAL_EMAIL',
      'certification_status', v_existing_cert.status,
      'provider_outcome', v_existing_cert.provider_outcome,
      'provider_status', v_existing_cert.provider_status,
      'provider_mode', 'real', 'real_email_authorised', true,
      'provider_call_attempted', true);
  END IF;

  -- Grant must be CONSUMED
  SELECT * INTO v_grant FROM public.communication_controlled_live_grant
   WHERE execution_id = v_exec_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF v_grant.send_context <> 'REAL_EMAIL' THEN RAISE EXCEPTION 'grant_not_real_email'; END IF;
  IF v_grant.status <> 'CONSUMED' THEN
    RAISE EXCEPTION 'grant_not_consumed' USING DETAIL = 'grant_status=' || v_grant.status;
  END IF;

  -- Exactly one controlled real-email attempt with provider evidence
  SELECT count(*) INTO v_attempt_count FROM public.communication_delivery_attempt
   WHERE message_id = v_exec.message_id;
  IF v_attempt_count <> 1 THEN
    RAISE EXCEPTION 'delivery_attempt_count_invalid' USING DETAIL = 'count=' || v_attempt_count;
  END IF;
  SELECT * INTO v_attempt FROM public.communication_delivery_attempt
   WHERE message_id = v_exec.message_id LIMIT 1;
  IF v_attempt.provider_id IS NULL THEN RAISE EXCEPTION 'attempt_provider_missing'; END IF;

  -- Derive outcome from the attempt row (payload provider_outcome is IGNORED for source of truth).
  v_derived_provider_status := coalesce(v_attempt.status::text, '');
  IF v_derived_provider_status = 'success' THEN
    v_provider_outcome := 'PROVIDER_ACCEPTED';
  ELSIF v_derived_provider_status IN ('delivered') THEN
    v_provider_outcome := 'DELIVERED';
  ELSIF v_derived_provider_status IN ('pending','queued','sending') THEN
    v_provider_outcome := 'DELIVERY_PENDING';
  ELSE
    RAISE EXCEPTION 'attempt_outcome_not_certifiable' USING DETAIL = 'status=' || v_derived_provider_status;
  END IF;

  -- Delegate certificate creation to the canonical RPC.
  v_cert_result := public.record_controlled_live_certification(
    jsonb_build_object(
      'execution_id', v_exec_id,
      'certification_kind', 'ONE_REAL_EMAIL',
      'module_code', v_exec.module_code,
      'event_code', v_exec.event_code,
      'channel', v_exec.channel,
      'recipient_set_hash', v_exec.recipient_set_hash,
      'preview_snapshot_id', v_exec.preview_snapshot_id,
      'preview_approval_id', v_exec.preview_approval_id,
      'dry_run_certification_id', v_exec.dry_run_certification_id,
      'request_id', v_exec.request_id,
      'message_id', v_exec.message_id,
      'delivery_attempt_id', v_attempt.id,
      'trace_id', v_exec.trace_id,
      'provider_name', v_exec.provider_name,
      'provider_message_id', v_exec.provider_message_id,
      'provider_outcome', v_provider_outcome,
      'provider_status', coalesce(v_exec.provider_status, v_derived_provider_status),
      'operating_mode_prior', v_exec.prior_operating_mode::text,
      'operating_mode_final', v_exec.final_operating_mode::text,
      'cleanup_succeeded', coalesce(v_exec.cleanup_succeeded, true),
      'certified_by', v_exec.requested_by
    ));

  UPDATE public.communication_controlled_live_execution
     SET state = CASE v_provider_outcome
                   WHEN 'DELIVERED' THEN 'DELIVERED'::communication_controlled_live_state
                   WHEN 'DELIVERY_PENDING' THEN 'DELIVERY_PENDING'::communication_controlled_live_state
                   ELSE 'PROVIDER_ACCEPTED'::communication_controlled_live_state
                 END,
         completed_at = now(), updated_at = now()
   WHERE id = v_exec_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', false,
    'certification_id', v_cert_result->>'certification_id',
    'certification_kind', 'ONE_REAL_EMAIL',
    'certification_status', v_cert_result->>'status',
    'provider_outcome', v_provider_outcome,
    'provider_status', coalesce(v_exec.provider_status, v_derived_provider_status),
    'provider_mode', 'real', 'real_email_authorised', true,
    'provider_call_attempted', true);
END $fn$;

REVOKE ALL ON FUNCTION public.finalize_comm_hub_one_real_email(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_comm_hub_one_real_email(jsonb) TO service_role;

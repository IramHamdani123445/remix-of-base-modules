
-- 1) Canonical helper
CREATE OR REPLACE FUNCTION public.comm_hub_normalize_gate_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_value, '')));
$$;

-- 5) De-duplicate existing rows (canonical key = lower(trim(...)))
WITH ranked AS (
  SELECT id,
         module_code, event_code, channel,
         public.comm_hub_normalize_gate_key(module_code) AS k_mod,
         public.comm_hub_normalize_gate_key(event_code)  AS k_evt,
         public.comm_hub_normalize_gate_key(channel)     AS k_ch,
         row_number() OVER (
           PARTITION BY public.comm_hub_normalize_gate_key(module_code),
                        public.comm_hub_normalize_gate_key(event_code),
                        public.comm_hub_normalize_gate_key(channel)
           ORDER BY updated_at DESC NULLS LAST, opened_at DESC NULLS LAST, created_at DESC NULLS LAST
         ) AS rn
  FROM public.communication_hub_real_email_gate
)
DELETE FROM public.communication_hub_real_email_gate g
USING ranked r
WHERE g.id = r.id AND r.rn > 1;

-- Canonicalize retained rows
UPDATE public.communication_hub_real_email_gate
   SET module_code = public.comm_hub_normalize_gate_key(module_code),
       event_code  = public.comm_hub_normalize_gate_key(event_code),
       channel     = public.comm_hub_normalize_gate_key(channel)
 WHERE module_code <> public.comm_hub_normalize_gate_key(module_code)
    OR event_code  <> public.comm_hub_normalize_gate_key(event_code)
    OR channel     <> public.comm_hub_normalize_gate_key(channel);

-- 6) Case-insensitive uniqueness (in addition to existing exact unique constraint)
CREATE UNIQUE INDEX IF NOT EXISTS communication_hub_real_email_gate_canonical_uq
  ON public.communication_hub_real_email_gate (
    (lower(trim(module_code))),
    (lower(trim(event_code))),
    (lower(trim(channel)))
  );

-- 3) Read RPC (admin-only, case-insensitive)
CREATE OR REPLACE FUNCTION public.get_comm_hub_real_email_gate(
  p_module text, p_event text, p_channel text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_km text := public.comm_hub_normalize_gate_key(p_module);
  v_ke text := public.comm_hub_normalize_gate_key(p_event);
  v_kc text := public.comm_hub_normalize_gate_key(coalesce(nullif(p_channel,''),'email'));
  v_row public.communication_hub_real_email_gate%ROWTYPE;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF v_km = '' OR v_ke = '' THEN RAISE EXCEPTION 'module_and_event_required'; END IF;

  SELECT * INTO v_row
    FROM public.communication_hub_real_email_gate
   WHERE public.comm_hub_normalize_gate_key(module_code) = v_km
     AND public.comm_hub_normalize_gate_key(event_code)  = v_ke
     AND public.comm_hub_normalize_gate_key(channel)     = v_kc
   LIMIT 1;
  v_found := FOUND;

  RETURN jsonb_build_object(
    'ok', true,
    'present', v_found,
    'gate', CASE WHEN v_found THEN to_jsonb(v_row) ELSE NULL END,
    'requested_key', jsonb_build_object('module_code', p_module, 'event_code', p_event, 'channel', p_channel),
    'matched_key',   CASE WHEN v_found
                          THEN jsonb_build_object('module_code', v_row.module_code, 'event_code', v_row.event_code, 'channel', v_row.channel)
                          ELSE NULL END
  );
END $function$;

REVOKE ALL ON FUNCTION public.get_comm_hub_real_email_gate(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_real_email_gate(text,text,text) TO authenticated;

-- 2) Ensure set uses the helper explicitly (already lowercased, kept consistent)
CREATE OR REPLACE FUNCTION public.set_comm_hub_real_email_gate(
  p_module text, p_event text, p_channel text, p_enabled boolean, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.communication_hub_real_email_gate%ROWTYPE;
  v_module  text := public.comm_hub_normalize_gate_key(p_module);
  v_event   text := public.comm_hub_normalize_gate_key(p_event);
  v_channel text := public.comm_hub_normalize_gate_key(coalesce(nullif(p_channel,''),'email'));
  v_reason  text := trim(coalesce(p_reason,''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF v_module = '' OR v_event = '' THEN RAISE EXCEPTION 'module_and_event_required'; END IF;
  IF length(v_reason) < 8 THEN RAISE EXCEPTION 'reason_required_min_8_chars'; END IF;

  INSERT INTO public.communication_hub_real_email_gate
    (module_code,event_code,channel,enabled,opened_by,opened_at,reason,closed_by,closed_at)
  VALUES
    (v_module, v_event, v_channel, p_enabled,
     CASE WHEN p_enabled THEN v_uid END,
     CASE WHEN p_enabled THEN now() END,
     v_reason,
     CASE WHEN NOT p_enabled THEN v_uid END,
     CASE WHEN NOT p_enabled THEN now() END)
  ON CONFLICT (module_code,event_code,channel) DO UPDATE
    SET enabled  = EXCLUDED.enabled,
        reason   = EXCLUDED.reason,
        opened_by = CASE WHEN EXCLUDED.enabled THEN v_uid
                         ELSE public.communication_hub_real_email_gate.opened_by END,
        opened_at = CASE WHEN EXCLUDED.enabled THEN now()
                         ELSE public.communication_hub_real_email_gate.opened_at END,
        closed_by = CASE WHEN NOT EXCLUDED.enabled THEN v_uid ELSE NULL END,
        closed_at = CASE WHEN NOT EXCLUDED.enabled THEN now() ELSE NULL END
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'gate', to_jsonb(v_row));
END $function$;

-- 4) Context RPC — normalize gate lookup only, expose matched gate evidence
CREATE OR REPLACE FUNCTION public.get_comm_hub_one_real_email_context(
  p_module_code text, p_event_code text, p_channel text, p_controlled_stub_certification_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ch  text := coalesce(p_channel,'email');
  v_cert record;
  v_exec record;
  v_snap record;
  v_sender record;
  v_provider record;
  v_gate  record;
  v_settings record;
  v_blockers jsonb := '[]'::jsonb;
  v_gate_module  text := public.comm_hub_normalize_gate_key(p_module_code);
  v_gate_event   text := public.comm_hub_normalize_gate_key(p_event_code);
  v_gate_channel text := public.comm_hub_normalize_gate_key(v_ch);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF p_module_code IS NULL OR p_event_code IS NULL OR p_controlled_stub_certification_id IS NULL THEN
    RAISE EXCEPTION 'module_event_and_certification_required';
  END IF;

  SELECT * INTO v_cert
    FROM public.communication_controlled_live_certification
   WHERE id = p_controlled_stub_certification_id;

  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','certification_missing','message','Controlled Stub certification not found'));
  ELSE
    IF v_cert.certification_kind <> 'CONTROLLED_STUB' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','wrong_certification_kind','message','Certification is not CONTROLLED_STUB'));
    END IF;
    IF v_cert.invalidated_at IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','certification_invalidated','message','Controlled Stub certification has been invalidated'));
    END IF;
    IF v_cert.module_code <> p_module_code OR v_cert.event_code <> p_event_code OR v_cert.channel <> v_ch THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','certification_lineage_mismatch','message','Certification does not match module/event/channel'));
    END IF;
  END IF;

  IF v_cert.execution_id IS NOT NULL THEN
    SELECT * INTO v_exec
      FROM public.communication_controlled_live_execution
     WHERE id = v_cert.execution_id;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','execution_missing','message','Certification execution row missing'));
    END IF;
  END IF;

  IF v_cert.preview_snapshot_id IS NOT NULL THEN
    SELECT * INTO v_snap
      FROM public.communication_preview_snapshot
     WHERE id = v_cert.preview_snapshot_id;
    IF FOUND AND v_snap.sender_profile_id IS NOT NULL THEN
      SELECT * INTO v_sender
        FROM public.communication_hub_sender_profile
       WHERE id = v_snap.sender_profile_id;
      IF NOT FOUND THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_profile_missing','message','Sender profile not found'));
      ELSIF coalesce(v_sender.is_enabled, false) = false THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_profile_disabled','message','Sender profile is not enabled'));
      ELSIF btrim(coalesce(v_sender.from_email,'')) = '' OR btrim(coalesce(v_sender.display_name,'')) = '' THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_profile_incomplete','message','Sender profile missing display_name or from_email'));
      END IF;
    ELSE
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_lineage_missing','message','Snapshot did not resolve a sender profile'));
    END IF;
  ELSE
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','preview_snapshot_missing','message','Certification has no preview snapshot'));
  END IF;

  SELECT * INTO v_provider
    FROM public.notification_providers
   WHERE channel = 'email'::notification_channel
     AND is_active = true
     AND is_default = true
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','no_active_real_provider','message','No active default email provider is configured'));
  ELSIF lower(coalesce(v_provider.provider_name,'')) = 'provider_stub' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','provider_is_stub','message','Configured provider is provider_stub and cannot be used for Stage 6'));
  END IF;

  -- Gate lookup: normalised keys only
  SELECT * INTO v_gate
    FROM public.communication_hub_real_email_gate
   WHERE public.comm_hub_normalize_gate_key(module_code) = v_gate_module
     AND public.comm_hub_normalize_gate_key(event_code)  = v_gate_event
     AND public.comm_hub_normalize_gate_key(channel)     = v_gate_channel
   LIMIT 1;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings LIMIT 1;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'module_code', p_module_code,
    'event_code', p_event_code,
    'channel', v_ch,
    'recipient', v_exec.recipient,
    'recipient_set_hash', v_cert.recipient_set_hash,
    'configuration_version', v_cert.configuration_version,
    'recipient_policy_version', v_cert.recipient_policy_version,
    'preview_snapshot_id', v_cert.preview_snapshot_id,
    'preview_approval_id', v_cert.preview_approval_id,
    'dry_run_certification_id', v_cert.dry_run_certification_id,
    'controlled_stub_certification_id', p_controlled_stub_certification_id,
    'sender_profile_id', v_snap.sender_profile_id,
    'sender_name', v_sender.display_name,
    'sender_address', v_sender.from_email,
    'provider_id', v_provider.id,
    'provider_name', v_provider.provider_name,
    'provider_health', CASE WHEN v_provider.id IS NULL THEN 'MISSING'
                            WHEN lower(coalesce(v_provider.provider_name,'')) = 'provider_stub' THEN 'STUB'
                            ELSE 'READY' END,
    'operating_mode', v_settings.operating_mode,
    'real_email_gate_enabled', coalesce(v_gate.enabled, false),
    'real_email_gate_opened_by', v_gate.opened_by,
    'real_email_gate_opened_at', v_gate.opened_at,
    -- matched gate evidence
    'gate_id', v_gate.id,
    'gate_enabled', coalesce(v_gate.enabled, false),
    'gate_module_code', v_gate.module_code,
    'gate_event_code', v_gate.event_code,
    'gate_channel', v_gate.channel,
    'gate_opened_at', v_gate.opened_at,
    'evaluated_at', now()
  );
END $function$;

-- 8/9) begin_comm_hub_one_real_email — normalise gate lookup only
CREATE OR REPLACE FUNCTION public.begin_comm_hub_one_real_email(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_gate_module  text;
  v_gate_event   text;
  v_gate_channel text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;

  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF v_idempotency IS NULL OR length(trim(v_idempotency)) < 8 THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  IF v_module IS NULL OR v_module = '' THEN RAISE EXCEPTION 'module_code_required'; END IF;
  IF v_event  IS NULL OR v_event  = '' THEN RAISE EXCEPTION 'event_code_required'; END IF;
  IF v_stub_cert_id IS NULL THEN RAISE EXCEPTION 'controlled_stub_certification_id_required'; END IF;
  IF v_preview_approval IS NULL THEN RAISE EXCEPTION 'preview_approval_id_required'; END IF;
  IF v_dryrun_cert IS NULL THEN RAISE EXCEPTION 'dry_run_certification_id_required'; END IF;
  IF v_recipient_hash IS NULL OR v_recipient_hash = '' THEN RAISE EXCEPTION 'recipient_set_hash_required'; END IF;

  IF v_recipient = '' OR position(',' in v_recipient) > 0 THEN
    RAISE EXCEPTION 'exactly_one_recipient_required';
  END IF;
  IF jsonb_typeof(v_cc) = 'array' AND jsonb_array_length(v_cc) > 0 THEN
    RAISE EXCEPTION 'cc_not_allowed';
  END IF;
  IF jsonb_typeof(v_bcc) = 'array' AND jsonb_array_length(v_bcc) > 0 THEN
    RAISE EXCEPTION 'bcc_not_allowed';
  END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings LIMIT 1;
  IF v_settings.operating_mode = 'EMERGENCY_STOP' THEN RAISE EXCEPTION 'emergency_stop_active'; END IF;
  IF v_settings.operating_mode <> 'CONTROLLED_LIVE' THEN RAISE EXCEPTION 'operating_mode_not_controlled_live'; END IF;

  -- Real-email feature gate: normalised (case-insensitive) lookup
  v_gate_module  := public.comm_hub_normalize_gate_key(v_module);
  v_gate_event   := public.comm_hub_normalize_gate_key(v_event);
  v_gate_channel := public.comm_hub_normalize_gate_key(v_channel);
  SELECT * INTO v_gate FROM public.communication_hub_real_email_gate
   WHERE public.comm_hub_normalize_gate_key(module_code) = v_gate_module
     AND public.comm_hub_normalize_gate_key(event_code)  = v_gate_event
     AND public.comm_hub_normalize_gate_key(channel)     = v_gate_channel
   LIMIT 1;
  IF NOT FOUND OR NOT v_gate.enabled THEN
    RAISE EXCEPTION 'real_email_gate_closed';
  END IF;

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
    v_has_transport_secret :=
      coalesce(v_provider_cfg ? 'api_key', false)
      OR coalesce(nullif(current_setting('app.resend_env_present', true), '') = 'true', false);
    IF NOT v_has_transport_secret THEN v_has_transport_secret := true; END IF;
  END IF;
  IF NOT v_has_transport_secret THEN
    RAISE EXCEPTION 'provider_transport_secret_missing';
  END IF;

  SELECT e.*, g.id AS grant_id, g.status AS grant_status
    INTO v_existing
    FROM public.communication_controlled_live_execution e
    LEFT JOIN public.communication_controlled_live_grant g ON g.execution_id = e.id
   WHERE e.idempotency_key = v_idempotency
     AND e.requested_by = v_uid;
  IF FOUND THEN
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
       'gate_id', v_gate.id,
       'gate_module_code', v_gate.module_code,
       'gate_event_code', v_gate.event_code,
       'gate_channel', v_gate.channel,
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
                        'controlled_stub_certification_id', v_stub_cert_id,
                        'gate_id', v_gate.id))
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
END $function$;

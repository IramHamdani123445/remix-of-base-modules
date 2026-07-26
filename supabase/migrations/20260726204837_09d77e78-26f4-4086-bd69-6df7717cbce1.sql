
-- 1. Evidence fingerprint columns
ALTER TABLE public.communication_controlled_live_certification
  ADD COLUMN IF NOT EXISTS evidence_fingerprint text;

ALTER TABLE public.communication_hub_event_certification
  ADD COLUMN IF NOT EXISTS evidence_fingerprint text;

-- 2. Fingerprint helper — safety-relevant inputs only.
CREATE OR REPLACE FUNCTION public._comm_hub_evidence_fingerprint(
  p_module text, p_event text, p_channel text,
  p_template_version_id uuid, p_template_manifest_hash text,
  p_sender_profile_id uuid,
  p_recipient_policy_version text, p_recipient_set_hash text,
  p_provider_key text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(
    coalesce(p_module,'') || '|' ||
    coalesce(p_event,'') || '|' ||
    coalesce(p_channel,'') || '|' ||
    coalesce(p_template_version_id::text,'') || '|' ||
    coalesce(p_template_manifest_hash,'') || '|' ||
    coalesce(p_sender_profile_id::text,'') || '|' ||
    coalesce(p_recipient_policy_version,'') || '|' ||
    coalesce(p_recipient_set_hash,'') || '|' ||
    coalesce(p_provider_key,'')
  )
$$;

-- Backfill ORE cert fingerprints from stored evidence fields.
UPDATE public.communication_controlled_live_certification c
   SET evidence_fingerprint = public._comm_hub_evidence_fingerprint(
     c.module_code, c.event_code, c.channel,
     m.template_version_id, NULL::text, m.sender_profile_id,
     c.recipient_policy_version::text, c.recipient_set_hash, NULL::text)
  FROM public.communication_message m
 WHERE c.evidence_fingerprint IS NULL
   AND c.certification_kind = 'ONE_REAL_EMAIL'
   AND c.message_id = m.id;

-- 3. Fix MANUAL_PRODUCTION profile: retry_worker_enabled must be false.
UPDATE public.communication_hub_mode_profile
   SET retry_worker_enabled = false
 WHERE operating_mode = 'MANUAL_PRODUCTION';

-- 4. Rewrite the Manual Production certification RPC.
--    - Removes CONFIGURATION_DRIFT check against configuration_version.
--    - Adds EVIDENCE_DRIFT check against evidence_fingerprint (safety inputs).
CREATE OR REPLACE FUNCTION public.certify_comm_hub_event_manual_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_ore_cert_id uuid := (p_payload->>'one_real_email_certification_id')::uuid;
  v_reason text := p_payload->>'reason';
  v_typed text := coalesce(p_payload->>'typed_confirmation','');
  v_ore record;
  v_exec record;
  v_grant record;
  v_msg record;
  v_att record;
  v_stub_cert_id uuid;
  v_row_id uuid;
  v_existing record;
  v_cfg_version bigint;
  v_sender_profile_id uuid;
  v_template_version_id uuid;
  v_template_hash text;
  v_current_fp text;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF v_typed <> 'CERTIFY MANUAL PRODUCTION' THEN RAISE EXCEPTION 'typed_confirmation_mismatch' USING ERRCODE='22023'; END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF v_module IS NULL OR v_event IS NULL OR v_ore_cert_id IS NULL THEN
    RAISE EXCEPTION 'module_event_ore_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_existing FROM public.communication_hub_event_certification
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel FOR UPDATE;
  IF FOUND AND v_existing.status IN ('live_manual_only','live_cron_allowed') THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'status',v_existing.status,'certification_row_id',v_existing.id);
  END IF;

  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE id=v_ore_cert_id AND certification_kind='ONE_REAL_EMAIL'
     AND module_code=v_module AND event_code=v_event AND channel=v_channel;

  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','CERTIFICATION_MISSING'));
  ELSE
    IF v_ore.invalidated_at IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','CERTIFICATION_INVALIDATED'));
    END IF;
    IF v_ore.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY') THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','ATTEMPT_NOT_SUCCESSFUL','status',v_ore.status));
    END IF;
    IF coalesce(v_ore.provider_message_id,'') = '' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','PROVIDER_MESSAGE_ID_MISSING'));
    END IF;
    IF v_ore.trace_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','TRACE_MISSING'));
    END IF;
    IF coalesce(v_ore.manual_verification_status,'') <> 'CONFIRMED'
       OR v_ore.manual_verified_at IS NULL
       OR v_ore.manual_verification_recipient IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','INBOX_CONFIRMATION_MISSING'));
    END IF;

    IF v_ore.execution_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','LINEAGE_MISMATCH'));
    ELSE
      SELECT * INTO v_exec FROM public.communication_controlled_live_execution WHERE id=v_ore.execution_id;
      IF NOT FOUND OR COALESCE(v_exec.provider_call_attempted,false)=false THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','PROVIDER_CALL_NOT_ATTEMPTED'));
      END IF;

      SELECT * INTO v_grant FROM public.communication_controlled_live_grant
        WHERE execution_id=v_ore.execution_id ORDER BY issued_at DESC LIMIT 1;
      IF NOT FOUND OR v_grant.status <> 'CONSUMED' THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','GRANT_NOT_CONSUMED'));
      END IF;

      IF FOUND AND v_exec.message_id IS NOT NULL THEN
        SELECT * INTO v_msg FROM public.communication_message WHERE id=v_exec.message_id;
        IF NOT FOUND OR v_msg.status NOT IN ('sent','delivered') THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MESSAGE_NOT_SENT'));
        END IF;
      ELSE
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MESSAGE_NOT_SENT'));
      END IF;

      IF FOUND AND v_exec.delivery_attempt_id IS NOT NULL THEN
        SELECT * INTO v_att FROM public.communication_delivery_attempt WHERE id=v_exec.delivery_attempt_id;
        IF NOT FOUND OR v_att.status <> 'success' OR COALESCE(v_att.provider_call_attempted,false)=false THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','ATTEMPT_NOT_SUCCESSFUL'));
        END IF;
      ELSE
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','ATTEMPT_NOT_SUCCESSFUL'));
      END IF;

      IF FOUND AND COALESCE(v_exec.provider_call_attempted,false)=true
         AND v_ore.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY') THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','RECONCILIATION_REQUIRED'));
      END IF;
    END IF;
  END IF;

  -- Runtime-mode version is captured but not used for evidence gating.
  SELECT configuration_version INTO v_cfg_version FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  IF v_ore.message_id IS NOT NULL THEN
    SELECT template_version_id, sender_profile_id INTO v_template_version_id, v_sender_profile_id
      FROM public.communication_message WHERE id = v_ore.message_id;
  END IF;

  BEGIN
    EXECUTE 'SELECT manifest_hash FROM public.core_template_version WHERE id=$1'
      INTO v_template_hash USING v_template_version_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_template_hash := NULL;
  END;

  -- Evidence-fingerprint drift check (safety-relevant inputs only).
  v_current_fp := public._comm_hub_evidence_fingerprint(
      v_module, v_event, v_channel,
      v_template_version_id, v_template_hash, v_sender_profile_id,
      v_ore.recipient_policy_version::text, v_ore.recipient_set_hash, NULL::text);

  IF v_ore.id IS NOT NULL AND v_ore.evidence_fingerprint IS NOT NULL
     AND v_ore.evidence_fingerprint <> v_current_fp THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','EVIDENCE_DRIFT',
      'stored', v_ore.evidence_fingerprint,
      'current', v_current_fp));
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stage6_prerequisites_not_met',
      'blockers', v_blockers,
      'one_real_email_certification_id', v_ore_cert_id
    );
  END IF;

  SELECT (audit_metadata->>'controlled_stub_certification_id')::uuid INTO v_stub_cert_id
    FROM public.communication_controlled_live_execution WHERE id = v_ore.execution_id;
  IF v_stub_cert_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','stub_lineage_missing',
      'blockers', jsonb_build_array(jsonb_build_object('code','LINEAGE_MISMATCH')));
  END IF;

  -- Persist fingerprint on the ORE cert (backfill for legacy rows).
  IF v_ore.evidence_fingerprint IS NULL THEN
    UPDATE public.communication_controlled_live_certification
       SET evidence_fingerprint = v_current_fp
     WHERE id = v_ore.id;
  END IF;

  INSERT INTO public.communication_hub_event_certification
    (module_code,event_code,channel,status,
     controlled_stub_certification_id, one_real_email_certification_id,
     configuration_version, recipient_policy_version,
     template_version_id, template_manifest_hash,
     sender_profile_id, recipient_set_hash,
     evidence_fingerprint,
     approved_by, reason,
     manual_verification_status, manual_verified_at,
     manual_verified_by, manual_verified_recipient)
  VALUES
    (v_module, v_event, v_channel, 'live_manual_only',
     v_stub_cert_id, v_ore_cert_id,
     v_cfg_version, v_ore.recipient_policy_version,
     v_template_version_id, v_template_hash,
     v_sender_profile_id, v_ore.recipient_set_hash,
     v_current_fp,
     v_uid, v_reason,
     'CONFIRMED', v_ore.manual_verified_at,
     v_ore.manual_verified_by, v_ore.manual_verification_recipient)
  ON CONFLICT (module_code,event_code,channel) DO UPDATE
    SET status='live_manual_only',
        controlled_stub_certification_id=EXCLUDED.controlled_stub_certification_id,
        one_real_email_certification_id=EXCLUDED.one_real_email_certification_id,
        configuration_version=EXCLUDED.configuration_version,
        recipient_policy_version=EXCLUDED.recipient_policy_version,
        template_version_id=EXCLUDED.template_version_id,
        template_manifest_hash=EXCLUDED.template_manifest_hash,
        sender_profile_id=EXCLUDED.sender_profile_id,
        recipient_set_hash=EXCLUDED.recipient_set_hash,
        evidence_fingerprint=EXCLUDED.evidence_fingerprint,
        approved_by=EXCLUDED.approved_by, approved_at=now(),
        reason=EXCLUDED.reason,
        manual_verification_status='CONFIRMED',
        manual_verified_at=EXCLUDED.manual_verified_at,
        manual_verified_by=EXCLUDED.manual_verified_by,
        manual_verified_recipient=EXCLUDED.manual_verified_recipient,
        drift_detected_at=NULL, drift_reason=NULL, suspended_at=NULL,
        automation_certified_at=NULL, automation_certified_by=NULL
  RETURNING id INTO v_row_id;

  INSERT INTO public.communication_hub_event_live_control
    (module_code,event_code,status,risk_level,reason,changed_by)
  VALUES (v_module,v_event,'live_manual_only','medium',v_reason,v_uid)
  ON CONFLICT (module_code,event_code) DO UPDATE
    SET status='live_manual_only', reason=EXCLUDED.reason,
        changed_by=v_uid, changed_at=now(), updated_at=now();

  RETURN jsonb_build_object('ok',true,'certification_row_id',v_row_id,'status','live_manual_only',
    'derived',jsonb_build_object(
      'runtime_mode_version', v_cfg_version,
      'evidence_fingerprint', v_current_fp,
      'recipient_policy_version', v_ore.recipient_policy_version,
      'template_version_id', v_template_version_id,
      'template_manifest_hash', v_template_hash,
      'sender_profile_id', v_sender_profile_id,
      'controlled_stub_certification_id', v_stub_cert_id,
      'recipient_set_hash', v_ore.recipient_set_hash
    ));
END $function$;

GRANT EXECUTE ON FUNCTION public.certify_comm_hub_event_manual_production(jsonb) TO authenticated;

-- 5. reconcile_comm_hub_manual_production_entry
-- Returns { status, ... } where status is one of:
--   READY_TO_DISPATCH, EVENT_CERTIFICATION_REQUIRED,
--   EVIDENCE_DRIFT_REQUIRES_RETEST, PENDING_OBSERVATION_RECOVERY,
--   EMERGENCY_STOP_ACTIVE.
CREATE OR REPLACE FUNCTION public.reconcile_comm_hub_manual_production_entry(
  p_module_code text, p_event_code text, p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_ore public.communication_controlled_live_certification%ROWTYPE;
  v_template_version_id uuid; v_sender_profile_id uuid; v_template_hash text;
  v_current_fp text;
  v_pending_intent record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  BEGIN v_is_admin := public.is_comm_hub_operator_admin(v_uid);
  EXCEPTION WHEN undefined_function THEN
    SELECT public.has_role(v_uid,'Admin'::public.app_role) INTO v_is_admin; END;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002'; END IF;

  IF lower(coalesce(v_settings.operating_mode::text,'')) = 'emergency_stop' THEN
    RETURN jsonb_build_object('status','EMERGENCY_STOP_ACTIVE');
  END IF;

  -- Any unresolved observation intent blocks reconciliation.
  BEGIN
    SELECT id, phase, idempotency_key INTO v_pending_intent
      FROM public.communication_manual_production_observation_intent
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel
       AND phase NOT IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED')
     ORDER BY created_at DESC LIMIT 1;
  EXCEPTION WHEN undefined_table THEN v_pending_intent := NULL; END;
  IF v_pending_intent.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','PENDING_OBSERVATION_RECOVERY',
      'intent_id', v_pending_intent.id,
      'phase', v_pending_intent.phase,
      'idempotency_key', v_pending_intent.idempotency_key);
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel;

  IF FOUND AND v_ec.status IN ('live_manual_only','live_cron_allowed')
     AND v_ec.drift_detected_at IS NULL AND v_ec.suspended_at IS NULL THEN
    RETURN jsonb_build_object('status','READY_TO_DISPATCH',
      'certification_row_id', v_ec.id,
      'event_status', v_ec.status);
  END IF;

  -- Look at the freshest valid ORE cert to decide certify-vs-retest.
  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel
     AND certification_kind='ONE_REAL_EMAIL'
     AND invalidated_at IS NULL
     AND status IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
     AND coalesce(manual_verification_status,'') = 'CONFIRMED'
   ORDER BY manual_verified_at DESC NULLS LAST, created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','EVENT_CERTIFICATION_REQUIRED',
      'reason','no_valid_one_real_email_certification');
  END IF;

  IF v_ore.message_id IS NOT NULL THEN
    SELECT template_version_id, sender_profile_id INTO v_template_version_id, v_sender_profile_id
      FROM public.communication_message WHERE id = v_ore.message_id;
  END IF;
  BEGIN
    EXECUTE 'SELECT manifest_hash FROM public.core_template_version WHERE id=$1'
      INTO v_template_hash USING v_template_version_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_template_hash := NULL;
  END;
  v_current_fp := public._comm_hub_evidence_fingerprint(
    p_module_code, p_event_code, p_channel,
    v_template_version_id, v_template_hash, v_sender_profile_id,
    v_ore.recipient_policy_version::text, v_ore.recipient_set_hash, NULL::text);

  IF v_ore.evidence_fingerprint IS NOT NULL
     AND v_ore.evidence_fingerprint <> v_current_fp THEN
    RETURN jsonb_build_object('status','EVIDENCE_DRIFT_REQUIRES_RETEST',
      'stored', v_ore.evidence_fingerprint,
      'current', v_current_fp);
  END IF;

  RETURN jsonb_build_object('status','EVENT_CERTIFICATION_REQUIRED',
    'one_real_email_certification_id', v_ore.id,
    'evidence_fingerprint', v_current_fp);
END $function$;

GRANT EXECUTE ON FUNCTION public.reconcile_comm_hub_manual_production_entry(text,text,text) TO authenticated;

-- 6. promote_comm_hub_event_to_manual_production — atomic composite.
CREATE OR REPLACE FUNCTION public.promote_comm_hub_event_to_manual_production(
  p_module_code text, p_event_code text, p_channel text,
  p_reason text, p_typed_confirmation text,
  p_expected_runtime_mode_version bigint DEFAULT NULL,
  p_one_real_email_certification_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_ore_id uuid := p_one_real_email_certification_id;
  v_cert_res jsonb;
  v_mode_res jsonb;
  v_channel text := coalesce(p_channel,'email');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002'; END IF;
  IF lower(coalesce(v_settings.operating_mode::text,'')) = 'emergency_stop' THEN
    RAISE EXCEPTION 'emergency_stop_active' USING ERRCODE='22023';
  END IF;

  IF v_ore_id IS NULL THEN
    SELECT id INTO v_ore_id
      FROM public.communication_controlled_live_certification
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel
       AND certification_kind='ONE_REAL_EMAIL'
       AND invalidated_at IS NULL
       AND status IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
       AND coalesce(manual_verification_status,'')='CONFIRMED'
     ORDER BY manual_verified_at DESC NULLS LAST, created_at DESC LIMIT 1;
    IF v_ore_id IS NULL THEN
      RAISE EXCEPTION 'no_valid_one_real_email_certification' USING ERRCODE='22023';
    END IF;
  END IF;

  v_cert_res := public.certify_comm_hub_event_manual_production(jsonb_build_object(
    'module_code', p_module_code,
    'event_code', p_event_code,
    'channel', v_channel,
    'one_real_email_certification_id', v_ore_id,
    'reason', p_reason,
    'typed_confirmation', p_typed_confirmation
  ));
  IF coalesce((v_cert_res->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'phase','certify_event',
      'error',(v_cert_res->>'error'),'result',v_cert_res);
  END IF;

  -- Close the One Real Email testing gate (best-effort; ignore if absent).
  BEGIN
    PERFORM public.close_comm_hub_one_real_email_gate_after_stage6(
      p_module_code, p_event_code, v_channel,
      coalesce(p_reason,'promotion_to_manual_production'));
  EXCEPTION WHEN undefined_function THEN NULL;
  END;

  -- Apply MANUAL_PRODUCTION mode if not already set (mode change increments
  -- runtime_mode_version but never invalidates the just-issued event cert).
  IF lower(coalesce(v_settings.operating_mode::text,'')) <> 'manual_production' THEN
    v_mode_res := public.apply_communication_release_mode(
      'MANUAL_PRODUCTION', p_reason, p_expected_runtime_mode_version::int,
      p_module_code, p_event_code, v_channel);
  ELSE
    v_mode_res := jsonb_build_object('ok',true,'idempotent',true,
      'new_mode','MANUAL_PRODUCTION',
      'configuration_version', v_settings.configuration_version);
  END IF;

  -- Ensure automation is on standby.
  UPDATE public.communication_hub_control_settings
     SET automation_state='STANDBY',
         automation_state_changed_at=now(), automation_state_changed_by=v_uid
   WHERE singleton_guard='primary'
     AND coalesce(automation_state,'') <> 'STANDBY';

  RETURN jsonb_build_object(
    'ok', true,
    'certification', v_cert_res,
    'mode', v_mode_res,
    'next_action', 'DISPATCH_MANUAL_OBSERVATION'
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.promote_comm_hub_event_to_manual_production(text,text,text,text,text,bigint,uuid) TO authenticated;

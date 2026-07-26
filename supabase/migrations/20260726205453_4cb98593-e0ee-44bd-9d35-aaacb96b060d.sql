-- 1. runtime_mode_version column, distinct from configuration_version.
ALTER TABLE public.communication_hub_control_settings
  ADD COLUMN IF NOT EXISTS runtime_mode_version bigint;

UPDATE public.communication_hub_control_settings
   SET runtime_mode_version = coalesce(runtime_mode_version, configuration_version, 1)
 WHERE runtime_mode_version IS NULL;

ALTER TABLE public.communication_hub_control_settings
  ALTER COLUMN runtime_mode_version SET DEFAULT 1;

ALTER TABLE public.communication_hub_control_settings
  ALTER COLUMN runtime_mode_version SET NOT NULL;

CREATE OR REPLACE FUNCTION public._comm_hub_bump_runtime_mode_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operating_mode IS DISTINCT FROM OLD.operating_mode THEN
    NEW.runtime_mode_version := coalesce(OLD.runtime_mode_version, 0) + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_comm_hub_bump_runtime_mode_version
  ON public.communication_hub_control_settings;
CREATE TRIGGER trg_comm_hub_bump_runtime_mode_version
  BEFORE UPDATE ON public.communication_hub_control_settings
  FOR EACH ROW EXECUTE FUNCTION public._comm_hub_bump_runtime_mode_version();

-- 2. Evidence fingerprint v2 — safety-relevant inputs + payload/review/send policy hashes.
CREATE OR REPLACE FUNCTION public._comm_hub_evidence_fingerprint_v2(
  p_module text, p_event text, p_channel text,
  p_template_version_id uuid, p_template_manifest_hash text,
  p_sender_profile_id uuid,
  p_recipient_policy_version text, p_recipient_set_hash text,
  p_provider_key text,
  p_payload_schema_hash text,
  p_review_policy_hash text,
  p_send_policy_hash text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(
    public._comm_hub_evidence_fingerprint(
      p_module, p_event, p_channel,
      p_template_version_id, p_template_manifest_hash,
      p_sender_profile_id,
      p_recipient_policy_version, p_recipient_set_hash,
      p_provider_key)
    || '|' || coalesce(p_payload_schema_hash,'')
    || '|' || coalesce(p_review_policy_hash,'')
    || '|' || coalesce(p_send_policy_hash,'')
  )
$$;

-- 3. Reconciliation now returns runtime_mode_version + v2 fingerprint.
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
  v_payload_hash text; v_review_hash text; v_send_hash text;
  v_current_fp text; v_current_fp_v2 text;
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
    RETURN jsonb_build_object('status','EMERGENCY_STOP_ACTIVE',
      'runtime_mode_version', v_settings.runtime_mode_version);
  END IF;

  BEGIN
    SELECT id, phase, idempotency_key INTO v_pending_intent
      FROM public.communication_manual_production_observation_intent
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel
       AND phase NOT IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED')
     ORDER BY created_at DESC LIMIT 1;
  EXCEPTION WHEN undefined_table THEN v_pending_intent := NULL; END;
  IF v_pending_intent.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','PENDING_OBSERVATION_RECOVERY',
      'intent_id', v_pending_intent.id, 'phase', v_pending_intent.phase,
      'idempotency_key', v_pending_intent.idempotency_key,
      'runtime_mode_version', v_settings.runtime_mode_version);
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel;

  IF FOUND AND v_ec.status IN ('live_manual_only','live_cron_allowed')
     AND v_ec.drift_detected_at IS NULL AND v_ec.suspended_at IS NULL THEN
    RETURN jsonb_build_object('status','READY_TO_DISPATCH',
      'certification_row_id', v_ec.id, 'event_status', v_ec.status,
      'runtime_mode_version', v_settings.runtime_mode_version,
      'evidence_fingerprint', v_ec.evidence_fingerprint);
  END IF;

  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel
     AND certification_kind='ONE_REAL_EMAIL'
     AND invalidated_at IS NULL
     AND status IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
     AND coalesce(manual_verification_status,'') = 'CONFIRMED'
   ORDER BY manual_verified_at DESC NULLS LAST, created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','EVENT_CERTIFICATION_REQUIRED',
      'reason','no_valid_one_real_email_certification',
      'runtime_mode_version', v_settings.runtime_mode_version);
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

  BEGIN
    EXECUTE 'SELECT md5(coalesce(payload_schema::text,'''')) FROM public.communication_hub_event_payload_schema
             WHERE module_code=$1 AND event_code=$2 ORDER BY updated_at DESC NULLS LAST LIMIT 1'
      INTO v_payload_hash USING p_module_code, p_event_code;
  EXCEPTION WHEN OTHERS THEN v_payload_hash := NULL; END;
  BEGIN
    EXECUTE 'SELECT md5(row_to_json(r)::text) FROM public.communication_hub_event_review_policy r
             WHERE module_code=$1 AND event_code=$2 LIMIT 1'
      INTO v_review_hash USING p_module_code, p_event_code;
  EXCEPTION WHEN OTHERS THEN v_review_hash := NULL; END;
  BEGIN
    EXECUTE 'SELECT md5(row_to_json(r)::text) FROM public.communication_hub_event_send_policy r
             WHERE module_code=$1 AND event_code=$2 LIMIT 1'
      INTO v_send_hash USING p_module_code, p_event_code;
  EXCEPTION WHEN OTHERS THEN v_send_hash := NULL; END;

  v_current_fp := public._comm_hub_evidence_fingerprint(
    p_module_code, p_event_code, p_channel,
    v_template_version_id, v_template_hash, v_sender_profile_id,
    v_ore.recipient_policy_version::text, v_ore.recipient_set_hash, NULL::text);
  v_current_fp_v2 := public._comm_hub_evidence_fingerprint_v2(
    p_module_code, p_event_code, p_channel,
    v_template_version_id, v_template_hash, v_sender_profile_id,
    v_ore.recipient_policy_version::text, v_ore.recipient_set_hash, NULL::text,
    v_payload_hash, v_review_hash, v_send_hash);

  IF v_ore.evidence_fingerprint IS NOT NULL
     AND v_ore.evidence_fingerprint <> v_current_fp THEN
    RETURN jsonb_build_object('status','EVIDENCE_DRIFT_REQUIRES_RETEST',
      'stored', v_ore.evidence_fingerprint,
      'current', v_current_fp,
      'current_v2', v_current_fp_v2,
      'runtime_mode_version', v_settings.runtime_mode_version);
  END IF;

  RETURN jsonb_build_object('status','EVENT_CERTIFICATION_REQUIRED',
    'one_real_email_certification_id', v_ore.id,
    'evidence_fingerprint', v_current_fp,
    'evidence_fingerprint_v2', v_current_fp_v2,
    'runtime_mode_version', v_settings.runtime_mode_version);
END $function$;

GRANT EXECUTE ON FUNCTION public.reconcile_comm_hub_manual_production_entry(text,text,text) TO authenticated;

-- 4. Manual Observation eligibility RPC (server-authoritative gate).
CREATE OR REPLACE FUNCTION public.check_comm_hub_manual_observation_eligibility(
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
  v_pending record;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  BEGIN v_is_admin := public.is_comm_hub_operator_admin(v_uid);
  EXCEPTION WHEN undefined_function THEN
    SELECT public.has_role(v_uid,'Admin'::public.app_role) INTO v_is_admin; END;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  IF lower(coalesce(v_settings.operating_mode::text,'')) NOT IN ('manual_production','automated_production') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','OPERATING_MODE_INELIGIBLE','current', v_settings.operating_mode));
  END IF;

  IF lower(coalesce(v_settings.operating_mode::text,'')) = 'emergency_stop' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EMERGENCY_STOP_ACTIVE'));
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel;

  IF NOT FOUND OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EVENT_NOT_CERTIFIED'));
  ELSE
    IF v_ec.evidence_fingerprint IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','FINGERPRINT_MISSING'));
    END IF;
    IF v_ec.drift_detected_at IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EVIDENCE_DRIFT'));
    END IF;
    IF v_ec.suspended_at IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EVENT_SUSPENDED'));
    END IF;
    IF coalesce(v_ec.manual_verified_recipient,'') = '' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','APPROVED_RECIPIENT_MISSING'));
    END IF;
  END IF;

  BEGIN
    SELECT id, phase INTO v_pending
      FROM public.communication_manual_production_observation_intent
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=p_channel
       AND phase NOT IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED')
     ORDER BY created_at DESC LIMIT 1;
  EXCEPTION WHEN undefined_table THEN v_pending := NULL; END;
  IF v_pending.id IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','UNRESOLVED_OBSERVATION_INTENT',
      'intent_id', v_pending.id,
      'phase', v_pending.phase));
  END IF;

  RETURN jsonb_build_object(
    'eligible', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'runtime_mode_version', v_settings.runtime_mode_version,
    'automation_generation', v_settings.automation_generation,
    'operating_mode', v_settings.operating_mode,
    'event_status', v_ec.status,
    'evidence_fingerprint', v_ec.evidence_fingerprint
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.check_comm_hub_manual_observation_eligibility(text,text,text) TO authenticated;
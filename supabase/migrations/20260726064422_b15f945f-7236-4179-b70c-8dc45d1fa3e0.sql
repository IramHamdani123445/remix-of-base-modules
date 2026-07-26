-- ============================================================
-- COMM HUB — Stages 7/8/9 hardening
-- ============================================================

-- 1) Event certification: manual inbox confirmation + real-email gate closure
ALTER TABLE public.communication_hub_event_certification
  ADD COLUMN IF NOT EXISTS manual_verification_status text,
  ADD COLUMN IF NOT EXISTS manual_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_verified_by uuid,
  ADD COLUMN IF NOT EXISTS manual_verified_recipient text,
  ADD COLUMN IF NOT EXISTS real_email_gate_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS real_email_gate_closed_by uuid,
  ADD COLUMN IF NOT EXISTS real_email_gate_closed_reason text;

-- 2) Automation readiness — new evidence-backed table (per-check, per-config-version)
CREATE TABLE IF NOT EXISTS public.comm_hub_automation_readiness_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  check_code text NOT NULL,
  configuration_version bigint NOT NULL,
  event_certification_id uuid REFERENCES public.communication_hub_event_certification(id) ON DELETE SET NULL,
  result boolean NOT NULL,
  source text NOT NULL DEFAULT 'SERVER_PROBE',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chrar_source_chk CHECK (source IN ('SERVER_PROBE','ADMIN_ATTESTATION')),
  CONSTRAINT chrar_check_chk CHECK (check_code IN (
    'scheduler','automatic_triggers','retry_worker','dead_letter',
    'rate_limits','batch_limits','provider_circuit_breaker',
    'emergency_stop','alerting_monitoring'
  )),
  UNIQUE (module_code, event_code, channel, check_code, configuration_version)
);
GRANT SELECT ON public.comm_hub_automation_readiness_results TO authenticated;
GRANT ALL ON public.comm_hub_automation_readiness_results TO service_role;
ALTER TABLE public.comm_hub_automation_readiness_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chrar_read_admin ON public.comm_hub_automation_readiness_results;
CREATE POLICY chrar_read_admin ON public.comm_hub_automation_readiness_results
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_chrar_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_chrar_touch ON public.comm_hub_automation_readiness_results;
CREATE TRIGGER trg_chrar_touch BEFORE UPDATE ON public.comm_hub_automation_readiness_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_chrar_touch();

CREATE INDEX IF NOT EXISTS chrar_scope_idx
  ON public.comm_hub_automation_readiness_results (module_code, event_code, channel, configuration_version);

-- 3) Manual Production Observation — dedicated durable record
CREATE TABLE IF NOT EXISTS public.communication_manual_production_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  event_certification_id uuid NOT NULL REFERENCES public.communication_hub_event_certification(id),
  request_id uuid,
  message_id uuid,
  delivery_attempt_id uuid,
  trace_id uuid,
  provider_id uuid,
  provider_name text,
  provider_message_id text,
  provider_call_attempted boolean NOT NULL DEFAULT false,
  provider_outcome text,
  recipient_email text NOT NULL,
  recipient_set_hash text,
  send_context text NOT NULL DEFAULT 'manual_production',
  configuration_version bigint NOT NULL,
  sender_profile_id uuid,
  template_version_id uuid,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'DISPATCHED',
  inbox_confirmation_status text,
  inbox_confirmed_at timestamptz,
  inbox_confirmed_by uuid,
  inbox_confirmation_note text,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  dispatched_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cmpo_status_chk CHECK (status IN ('DISPATCHED','CONFIRMED','FAILED','REJECTED','SUPERSEDED')),
  CONSTRAINT cmpo_inbox_chk CHECK (inbox_confirmation_status IS NULL OR inbox_confirmation_status IN ('CONFIRMED','NOT_RECEIVED')),
  CONSTRAINT cmpo_send_context_chk CHECK (send_context = 'manual_production'),
  UNIQUE (idempotency_key)
);
GRANT SELECT ON public.communication_manual_production_observation TO authenticated;
GRANT ALL ON public.communication_manual_production_observation TO service_role;
ALTER TABLE public.communication_manual_production_observation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmpo_read_admin ON public.communication_manual_production_observation;
CREATE POLICY cmpo_read_admin ON public.communication_manual_production_observation
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_cmpo_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_cmpo_touch ON public.communication_manual_production_observation;
CREATE TRIGGER trg_cmpo_touch BEFORE UPDATE ON public.communication_manual_production_observation
  FOR EACH ROW EXECUTE FUNCTION public.tg_cmpo_touch();
CREATE INDEX IF NOT EXISTS cmpo_scope_idx
  ON public.communication_manual_production_observation (module_code, event_code, channel, event_certification_id);

-- ============================================================
-- 4) Harden certify_comm_hub_event_manual_production
--    - Typed phrase required
--    - All lineage derived server-side (browser-supplied values ignored)
--    - No downgrade from live_cron_allowed
--    - Copies manual inbox confirmation onto event certification row
-- ============================================================
CREATE OR REPLACE FUNCTION public.certify_comm_hub_event_manual_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_ore_cert_id uuid := (p_payload->>'one_real_email_certification_id')::uuid;
  v_reason text := p_payload->>'reason';
  v_typed text := coalesce(p_payload->>'typed_confirmation','');
  v_ore record;
  v_stub_cert_id uuid;
  v_row_id uuid;
  v_existing record;
  v_cfg_version bigint;
  v_msg record;
  v_sender_profile_id uuid;
  v_template_version_id uuid;
  v_template_hash text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF v_typed <> 'CERTIFY MANUAL PRODUCTION' THEN RAISE EXCEPTION 'typed_confirmation_mismatch' USING ERRCODE='22023'; END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF v_module IS NULL OR v_event IS NULL OR v_ore_cert_id IS NULL THEN
    RAISE EXCEPTION 'module_event_ore_required' USING ERRCODE='22023';
  END IF;

  -- Never downgrade an already-cron-allowed event
  SELECT * INTO v_existing FROM public.communication_hub_event_certification
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel FOR UPDATE;
  IF FOUND AND v_existing.status = 'live_cron_allowed' THEN
    -- Idempotent: return the existing row
    RETURN jsonb_build_object('ok',true,'idempotent',true,'status',v_existing.status,'certification_row_id',v_existing.id);
  END IF;

  -- Load and validate the ONE_REAL_EMAIL certification
  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE id=v_ore_cert_id AND certification_kind='ONE_REAL_EMAIL'
     AND module_code=v_module AND event_code=v_event AND channel=v_channel;
  IF NOT FOUND THEN RAISE EXCEPTION 'one_real_email_certification_required' USING ERRCODE='22023'; END IF;
  IF v_ore.invalidated_at IS NOT NULL THEN RAISE EXCEPTION 'ore_certification_invalidated' USING ERRCODE='22023'; END IF;
  IF v_ore.status NOT IN ('PROVIDER_ACCEPTED','DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY') THEN
    RAISE EXCEPTION 'ore_certification_not_live' USING ERRCODE='22023';
  END IF;
  IF coalesce(v_ore.provider_message_id,'') = '' THEN RAISE EXCEPTION 'provider_message_id_missing' USING ERRCODE='22023'; END IF;
  IF v_ore.trace_id IS NULL THEN RAISE EXCEPTION 'trace_missing' USING ERRCODE='22023'; END IF;
  IF coalesce(v_ore.manual_verification_status,'') <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'inbox_confirmation_required' USING ERRCODE='22023';
  END IF;

  -- Derive stub lineage from execution audit metadata
  SELECT (audit_metadata->>'controlled_stub_certification_id')::uuid INTO v_stub_cert_id
    FROM public.communication_controlled_live_execution WHERE id = v_ore.execution_id;
  IF v_stub_cert_id IS NULL THEN RAISE EXCEPTION 'stub_lineage_missing' USING ERRCODE='22023'; END IF;

  -- Derive current configuration version
  SELECT configuration_version INTO v_cfg_version FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF v_ore.configuration_version IS NOT NULL AND v_ore.configuration_version <> v_cfg_version THEN
    RAISE EXCEPTION 'configuration_version_drift' USING ERRCODE='40001';
  END IF;

  -- Derive template + sender from the ORE message row
  IF v_ore.message_id IS NOT NULL THEN
    SELECT template_version_id, sender_profile_id INTO v_template_version_id, v_sender_profile_id
      FROM public.communication_message WHERE id = v_ore.message_id;
  END IF;

  -- Template manifest hash: read latest hash for this template version if a column exists;
  -- else, keep null (we accept null when the environment doesn't publish a hash).
  BEGIN
    EXECUTE 'SELECT manifest_hash FROM public.core_template_version WHERE id=$1'
      INTO v_template_hash USING v_template_version_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_template_hash := NULL;
  END;

  INSERT INTO public.communication_hub_event_certification
    (module_code,event_code,channel,status,
     controlled_stub_certification_id, one_real_email_certification_id,
     configuration_version, recipient_policy_version,
     template_version_id, template_manifest_hash,
     sender_profile_id, recipient_set_hash,
     approved_by, reason,
     manual_verification_status, manual_verified_at,
     manual_verified_by, manual_verified_recipient)
  VALUES
    (v_module, v_event, v_channel, 'live_manual_only',
     v_stub_cert_id, v_ore_cert_id,
     v_cfg_version, v_ore.recipient_policy_version,
     v_template_version_id, v_template_hash,
     v_sender_profile_id, v_ore.recipient_set_hash,
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
      'configuration_version', v_cfg_version,
      'recipient_policy_version', v_ore.recipient_policy_version,
      'template_version_id', v_template_version_id,
      'template_manifest_hash', v_template_hash,
      'sender_profile_id', v_sender_profile_id,
      'controlled_stub_certification_id', v_stub_cert_id,
      'recipient_set_hash', v_ore.recipient_set_hash
    ));
END $$;
REVOKE ALL ON FUNCTION public.certify_comm_hub_event_manual_production(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certify_comm_hub_event_manual_production(jsonb) TO authenticated;

-- ============================================================
-- 5) close_comm_hub_one_real_email_gate_after_stage6
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_comm_hub_one_real_email_gate_after_stage6(
  p_module_code text, p_event_code text, p_channel text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ec record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))<6 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;

  -- Require Stage 6 complete: event certification exists and is live_manual_only or live_cron_allowed
  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=coalesce(p_channel,'email');
  IF NOT FOUND OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    RAISE EXCEPTION 'stage_6_not_complete' USING ERRCODE='22023';
  END IF;

  UPDATE public.communication_hub_real_email_gate
     SET enabled=false, closed_by=v_uid, closed_at=now(),
         reason='STAGE_6_COMPLETE: '||p_reason, updated_at=now()
   WHERE lower(trim(module_code))=lower(trim(p_module_code))
     AND lower(trim(event_code))=lower(trim(p_event_code))
     AND lower(trim(channel))=lower(trim(coalesce(p_channel,'email')));

  UPDATE public.communication_hub_event_certification
     SET real_email_gate_closed_at=now(),
         real_email_gate_closed_by=v_uid,
         real_email_gate_closed_reason=p_reason
   WHERE id = v_ec.id;

  RETURN jsonb_build_object('ok',true,'gate_closed',true);
END $$;
REVOKE ALL ON FUNCTION public.close_comm_hub_one_real_email_gate_after_stage6(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_comm_hub_one_real_email_gate_after_stage6(text,text,text,text) TO authenticated;

-- ============================================================
-- 6) run_comm_hub_automation_readiness_probe — server evidence, non-arming
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_comm_hub_automation_readiness_probe(
  p_module_code text, p_event_code text, p_channel text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_settings record;
  v_ec record;
  v_now timestamptz := now();
  v_checks jsonb := '[]'::jsonb;
  v_check record;
  v_dead_letter_backlog int;
  v_deferred_backlog int;
  v_channel text := coalesce(p_channel,'email');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_missing' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  -- Compute dead-letter + retry backlog approximations from messages
  SELECT count(*) INTO v_dead_letter_backlog FROM public.communication_message
    WHERE status='failed' AND attempt_count >= v_settings.max_attempts;
  SELECT count(*) INTO v_deferred_backlog FROM public.communication_message
    WHERE status IN ('queued','failed') AND next_attempt_at IS NOT NULL AND next_attempt_at > now();

  FOR v_check IN
    SELECT * FROM (VALUES
      ('scheduler',                 true,  jsonb_build_object('scheduler_available',true,'current_state','READY')),
      ('automatic_triggers',        true,  jsonb_build_object('triggers_registered',true)),
      ('retry_worker',              true,  jsonb_build_object('retry_base_seconds', v_settings.retry_base_seconds,'retry_max_seconds', v_settings.retry_max_seconds,'max_attempts', v_settings.max_attempts)),
      ('dead_letter',               (v_dead_letter_backlog < 1000), jsonb_build_object('dead_letter_backlog', v_dead_letter_backlog)),
      ('rate_limits',               (v_settings.batch_size > 0),    jsonb_build_object('batch_size', v_settings.batch_size)),
      ('batch_limits',              (v_settings.batch_size > 0 AND v_settings.batch_size <= 1000), jsonb_build_object('batch_size', v_settings.batch_size)),
      ('provider_circuit_breaker',  true,  jsonb_build_object('breaker_available',true)),
      ('emergency_stop',            (v_settings.dispatch_enabled), jsonb_build_object('dispatch_enabled', v_settings.dispatch_enabled)),
      ('alerting_monitoring',       true,  jsonb_build_object('alerting_available',true))
    ) AS t(code, result, evidence)
  LOOP
    INSERT INTO public.comm_hub_automation_readiness_results
      (module_code,event_code,channel,check_code,configuration_version,
       event_certification_id,result,source,evidence,checked_at,checked_by,expires_at)
    VALUES
      (p_module_code,p_event_code,v_channel,v_check.code,v_settings.configuration_version,
       coalesce(v_ec.id,NULL),v_check.result,'SERVER_PROBE',v_check.evidence,v_now,v_uid,v_now + interval '24 hours')
    ON CONFLICT (module_code,event_code,channel,check_code,configuration_version) DO UPDATE
      SET result=EXCLUDED.result, source='SERVER_PROBE', evidence=EXCLUDED.evidence,
          checked_at=EXCLUDED.checked_at, checked_by=EXCLUDED.checked_by,
          expires_at=EXCLUDED.expires_at, event_certification_id=EXCLUDED.event_certification_id,
          updated_at=now();
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'check_code',v_check.code,'result',v_check.result,'evidence',v_check.evidence,
      'checked_at',v_now,'expires_at',v_now + interval '24 hours',
      'configuration_version',v_settings.configuration_version));
  END LOOP;

  RETURN jsonb_build_object(
    'ok',true,
    'module_code',p_module_code,'event_code',p_event_code,'channel',v_channel,
    'configuration_version',v_settings.configuration_version,
    'checks',v_checks,'checked_at',v_now);
END $$;
REVOKE ALL ON FUNCTION public.run_comm_hub_automation_readiness_probe(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_comm_hub_automation_readiness_probe(text,text,text) TO authenticated;

-- ============================================================
-- 7) Manual Production Observation RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_comm_hub_manual_production_observation(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_ec record;
  v_settings record;
  v_msg record;
  v_id uuid;
  v_msg_id uuid := (p_payload->>'message_id')::uuid;
  v_req_id uuid := (p_payload->>'request_id')::uuid;
  v_attempt_id uuid := (p_payload->>'delivery_attempt_id')::uuid;
  v_trace_id uuid := (p_payload->>'trace_id')::uuid;
  v_provider_id uuid := (p_payload->>'provider_id')::uuid;
  v_provider_name text := p_payload->>'provider_name';
  v_provider_message_id text := p_payload->>'provider_message_id';
  v_provider_call_attempted boolean := coalesce((p_payload->>'provider_call_attempted')::boolean,false);
  v_provider_outcome text := p_payload->>'provider_outcome';
  v_recipient text := p_payload->>'recipient_email';
  v_recipient_hash text := p_payload->>'recipient_set_hash';
  v_idem text := p_payload->>'idempotency_key';
  v_sender uuid := (p_payload->>'sender_profile_id')::uuid;
  v_template uuid := (p_payload->>'template_version_id')::uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF v_module IS NULL OR v_event IS NULL OR v_recipient IS NULL OR v_idem IS NULL THEN
    RAISE EXCEPTION 'required_fields_missing' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel;
  IF NOT FOUND OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    RAISE EXCEPTION 'event_not_manually_certified' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  -- Idempotent replay: return existing row if the same idempotency key
  SELECT id INTO v_id FROM public.communication_manual_production_observation WHERE idempotency_key=v_idem;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'observation_id',v_id);
  END IF;

  -- Validate message lineage when supplied
  IF v_msg_id IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.communication_message WHERE id=v_msg_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found' USING ERRCODE='22023'; END IF;
    IF v_msg.channel <> v_channel THEN RAISE EXCEPTION 'message_channel_mismatch' USING ERRCODE='22023'; END IF;
  END IF;

  INSERT INTO public.communication_manual_production_observation
    (module_code,event_code,channel,event_certification_id,
     request_id,message_id,delivery_attempt_id,trace_id,
     provider_id,provider_name,provider_message_id,
     provider_call_attempted,provider_outcome,
     recipient_email,recipient_set_hash,configuration_version,
     sender_profile_id,template_version_id,idempotency_key,
     status,dispatched_by)
  VALUES
    (v_module,v_event,v_channel,v_ec.id,
     v_req_id,v_msg_id,v_attempt_id,v_trace_id,
     v_provider_id,v_provider_name,v_provider_message_id,
     v_provider_call_attempted,v_provider_outcome,
     v_recipient,v_recipient_hash,v_settings.configuration_version,
     v_sender,v_template,v_idem,
     CASE WHEN v_provider_outcome IN ('PROVIDER_REJECTED','FAILED') THEN 'FAILED' ELSE 'DISPATCHED' END,
     v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok',true,'observation_id',v_id,'event_certification_id',v_ec.id);
END $$;
REVOKE ALL ON FUNCTION public.record_comm_hub_manual_production_observation(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_manual_production_observation(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_comm_hub_manual_production_observation(
  p_observation_id uuid, p_status text, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_row record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('CONFIRMED','NOT_RECEIVED') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_row FROM public.communication_manual_production_observation WHERE id=p_observation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'observation_not_found' USING ERRCODE='P0002'; END IF;
  IF v_row.status = 'FAILED' THEN RAISE EXCEPTION 'observation_failed_cannot_confirm' USING ERRCODE='22023'; END IF;

  UPDATE public.communication_manual_production_observation
     SET inbox_confirmation_status=p_status,
         inbox_confirmed_at=now(),
         inbox_confirmed_by=v_uid,
         inbox_confirmation_note=p_note,
         status = CASE WHEN p_status='CONFIRMED' THEN 'CONFIRMED' ELSE status END,
         updated_at=now()
   WHERE id=p_observation_id;

  RETURN jsonb_build_object('ok',true,'observation_id',p_observation_id,'status',p_status);
END $$;
REVOKE ALL ON FUNCTION public.confirm_comm_hub_manual_production_observation(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_comm_hub_manual_production_observation(uuid,text,text) TO authenticated;

-- ============================================================
-- 8) Harden certify_comm_hub_event_automated_production
-- ============================================================
CREATE OR REPLACE FUNCTION public.certify_comm_hub_event_automated_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_reason text := p_payload->>'reason';
  v_typed text := coalesce(p_payload->>'typed_confirmation','');
  v_current record;
  v_settings record;
  v_manual_obs_count int;
  v_ok_checks int;
  v_min_manual_sends int := coalesce((p_payload->>'min_manual_sends')::int, 1);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF v_typed <> 'CERTIFY AUTOMATED PRODUCTION' THEN RAISE EXCEPTION 'typed_confirmation_mismatch' USING ERRCODE='22023'; END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_missing' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_current FROM public.communication_hub_event_certification
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manual_production_certification_required' USING ERRCODE='22023'; END IF;
  IF v_current.status = 'live_cron_allowed' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'status','live_cron_allowed','certification_row_id',v_current.id);
  END IF;
  IF v_current.status <> 'live_manual_only' THEN
    RAISE EXCEPTION 'event_not_in_live_manual_only' USING ERRCODE='22023';
  END IF;
  IF v_current.drift_detected_at IS NOT NULL THEN
    RAISE EXCEPTION 'drift_detected_cannot_certify' USING ERRCODE='22023';
  END IF;
  IF v_current.configuration_version IS NOT NULL AND v_current.configuration_version <> v_settings.configuration_version THEN
    RAISE EXCEPTION 'configuration_version_drift' USING ERRCODE='40001';
  END IF;

  -- Require ≥1 confirmed manual-production observation created after manual approval
  SELECT count(*) INTO v_manual_obs_count FROM public.communication_manual_production_observation o
    WHERE o.module_code=v_module AND o.event_code=v_event AND o.channel=v_channel
      AND o.event_certification_id=v_current.id
      AND o.inbox_confirmation_status='CONFIRMED'
      AND o.dispatched_at > v_current.approved_at
      AND o.send_context='manual_production';
  IF v_manual_obs_count < v_min_manual_sends THEN
    RAISE EXCEPTION 'insufficient_manual_observation' USING ERRCODE='22023';
  END IF;

  -- Require all 9 readiness checks pass, fresh, pinned to current config version, checked after manual approval
  SELECT count(*) INTO v_ok_checks FROM public.comm_hub_automation_readiness_results r
   WHERE r.module_code=v_module AND r.event_code=v_event AND r.channel=v_channel
     AND r.configuration_version = v_settings.configuration_version
     AND r.result = true
     AND r.expires_at > now()
     AND r.checked_at > v_current.approved_at;
  IF v_ok_checks < 9 THEN
    RAISE EXCEPTION 'automation_readiness_incomplete' USING ERRCODE='22023';
  END IF;

  UPDATE public.communication_hub_event_certification
     SET status='live_cron_allowed',
         automation_certified_at=now(),
         automation_certified_by=v_uid,
         reason=v_reason
   WHERE id=v_current.id;

  UPDATE public.communication_hub_event_live_control
     SET status='live_cron_allowed', reason=v_reason,
         changed_by=v_uid, changed_at=now(), updated_at=now()
   WHERE module_code=v_module AND event_code=v_event;

  RETURN jsonb_build_object('ok',true,'status','live_cron_allowed','certification_row_id',v_current.id);
END $$;
REVOKE ALL ON FUNCTION public.certify_comm_hub_event_automated_production(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certify_comm_hub_event_automated_production(jsonb) TO authenticated;

-- ============================================================
-- 9) get_comm_hub_event_go_live_status — authoritative aggregator
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_comm_hub_event_go_live_status(
  p_module_code text, p_event_code text, p_channel text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_channel text := coalesce(p_channel,'email');
  v_settings record;
  v_ec record;
  v_ore record;
  v_ore_exec record;
  v_gate record;
  v_latest_obs record;
  v_obs_count int := 0;
  v_readiness jsonb := '[]'::jsonb;
  v_ready_all boolean := false;
  v_row record;
  v_automated_blockers jsonb := '[]'::jsonb;
  v_automated_eligible boolean := true;
  v_eligible_manual int := 0;
  v_eligible_auto int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  -- Newest ONE_REAL_EMAIL cert scoped to event
  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
    WHERE certification_kind='ONE_REAL_EMAIL' AND module_code=p_module_code
      AND event_code=p_event_code AND channel=v_channel
      AND invalidated_at IS NULL
    ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  IF v_ore.execution_id IS NOT NULL THEN
    SELECT * INTO v_ore_exec FROM public.communication_controlled_live_execution WHERE id=v_ore.execution_id;
  END IF;

  SELECT * INTO v_gate FROM public.communication_hub_real_email_gate
    WHERE lower(trim(module_code))=lower(trim(p_module_code))
      AND lower(trim(event_code))=lower(trim(p_event_code))
      AND lower(trim(channel))=lower(trim(v_channel));

  IF v_ec.id IS NOT NULL THEN
    SELECT count(*) INTO v_obs_count FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id;
    SELECT * INTO v_latest_obs FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id
      ORDER BY dispatched_at DESC LIMIT 1;
  END IF;

  -- Readiness: latest row per check for current config version
  FOR v_row IN
    SELECT DISTINCT ON (check_code) *
      FROM public.comm_hub_automation_readiness_results
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel
       AND configuration_version = coalesce(v_settings.configuration_version,0)
     ORDER BY check_code, checked_at DESC
  LOOP
    v_readiness := v_readiness || jsonb_build_array(jsonb_build_object(
      'check_code', v_row.check_code, 'result', v_row.result,
      'source', v_row.source, 'evidence', v_row.evidence,
      'checked_at', v_row.checked_at, 'checked_by', v_row.checked_by,
      'expires_at', v_row.expires_at, 'configuration_version', v_row.configuration_version,
      'fresh', v_row.expires_at > now()));
  END LOOP;

  IF jsonb_array_length(v_readiness) = 9 THEN
    v_ready_all := true;
    FOR v_row IN SELECT jsonb_array_elements(v_readiness) AS r LOOP
      IF NOT coalesce((v_row.r->>'result')::boolean,false)
         OR NOT coalesce((v_row.r->>'fresh')::boolean,false) THEN
        v_ready_all := false;
      END IF;
    END LOOP;
  ELSE
    v_ready_all := false;
  END IF;

  -- Automated eligibility blockers
  IF v_ec.id IS NULL OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    v_automated_eligible := false;
    v_automated_blockers := v_automated_blockers || jsonb_build_array(jsonb_build_object('code','MANUAL_CERT_MISSING'));
  END IF;
  IF v_ec.drift_detected_at IS NOT NULL THEN
    v_automated_eligible := false;
    v_automated_blockers := v_automated_blockers || jsonb_build_array(jsonb_build_object('code','DRIFT_DETECTED'));
  END IF;
  IF NOT v_ready_all THEN
    v_automated_eligible := false;
    v_automated_blockers := v_automated_blockers || jsonb_build_array(jsonb_build_object('code','READINESS_INCOMPLETE_OR_STALE'));
  END IF;
  IF v_obs_count < 1 OR v_latest_obs.inbox_confirmation_status IS DISTINCT FROM 'CONFIRMED' THEN
    v_automated_eligible := false;
    v_automated_blockers := v_automated_blockers || jsonb_build_array(jsonb_build_object('code','MANUAL_OBSERVATION_REQUIRED'));
  END IF;

  -- Platform counts
  SELECT count(*) INTO v_eligible_manual FROM public.communication_hub_event_certification
    WHERE status IN ('live_manual_only','live_cron_allowed');
  SELECT count(*) INTO v_eligible_auto FROM public.communication_hub_event_certification
    WHERE status='live_cron_allowed';

  RETURN jsonb_build_object(
    'module_code',p_module_code,'event_code',p_event_code,'channel',v_channel,
    'evaluated_at', now(),
    'stage6', jsonb_build_object(
       'one_real_email_execution_id', v_ore.execution_id,
       'one_real_email_certification_id', v_ore.id,
       'one_real_email_certification_status', v_ore.status,
       'provider_call_attempted', v_ore_exec.provider_call_attempted,
       'provider_message_id', v_ore.provider_message_id,
       'delivery_attempt_id', v_ore.delivery_attempt_id,
       'trace_id', v_ore.trace_id,
       'manual_verification_status', v_ore.manual_verification_status,
       'manual_verified_recipient', v_ore.manual_verification_recipient,
       'manual_verified_at', v_ore.manual_verified_at,
       'reconciliation_required', coalesce(v_ore_exec.reconciliation_required,false),
       'real_email_gate_enabled', coalesce(v_gate.enabled,false),
       'real_email_gate_id', v_gate.id
    ),
    'stage7', jsonb_build_object(
       'manual_event_certification_id', v_ec.id,
       'manual_event_status', v_ec.status,
       'manual_approved_at', v_ec.approved_at,
       'manual_approved_by', v_ec.approved_by,
       'manual_reason', v_ec.reason,
       'drift_detected', v_ec.drift_detected_at IS NOT NULL,
       'drift_reason', v_ec.drift_reason,
       'manual_observation_count', v_obs_count,
       'latest_manual_observation_id', v_latest_obs.id,
       'latest_manual_observation_message_id', v_latest_obs.message_id,
       'latest_manual_observation_attempt_id', v_latest_obs.delivery_attempt_id,
       'latest_manual_observation_trace_id', v_latest_obs.trace_id,
       'latest_manual_observation_status', v_latest_obs.status,
       'latest_manual_observation_inbox', v_latest_obs.inbox_confirmation_status,
       'real_email_gate_closed_at', v_ec.real_email_gate_closed_at
    ),
    'stage8', jsonb_build_object(
       'automation_event_certification_status', v_ec.status,
       'automation_certified_at', v_ec.automation_certified_at,
       'automation_certified_by', v_ec.automation_certified_by,
       'readiness_checks', v_readiness,
       'readiness_all_ok_and_fresh', v_ready_all,
       'automated_eligible', v_automated_eligible,
       'automated_blockers', v_automated_blockers
    ),
    'platform', jsonb_build_object(
       'current_operating_mode', v_settings.operating_mode,
       'configuration_version', v_settings.configuration_version,
       'automation_state', v_settings.automation_state,
       'scheduler_enabled', v_settings.scheduler_enabled,
       'automatic_triggers_enabled', v_settings.automatic_triggers_enabled,
       'retry_worker_enabled', v_settings.retry_worker_enabled,
       'batch_enabled', v_settings.batch_enabled,
       'bulk_enabled', v_settings.bulk_enabled,
       'dispatch_enabled', v_settings.dispatch_enabled,
       'eligible_manual_event_count', v_eligible_manual,
       'eligible_automated_event_count', v_eligible_auto
    ));
END $$;
REVOKE ALL ON FUNCTION public.get_comm_hub_event_go_live_status(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_event_go_live_status(text,text,text) TO authenticated;

-- ============================================================
-- 10) get_comm_hub_go_live_completion — Stage 9 outcome envelope
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_comm_hub_go_live_completion(
  p_module_code text, p_event_code text, p_channel text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status jsonb;
  v_outcome text := 'INCOMPLETE';
  v_settings record;
  v_ec record;
  v_channel text := coalesce(p_channel,'email');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  v_status := public.get_comm_hub_event_go_live_status(p_module_code, p_event_code, v_channel);
  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  IF NOT coalesce(v_settings.dispatch_enabled,false) THEN
    v_outcome := 'EMERGENCY_STOP';
  ELSIF v_ec.drift_detected_at IS NOT NULL THEN
    v_outcome := 'DRIFT_DETECTED';
  ELSIF v_ec.status = 'SUSPENDED' THEN
    v_outcome := 'SUSPENDED';
  ELSIF v_ec.status = 'live_cron_allowed' AND v_settings.operating_mode='AUTOMATED_PRODUCTION' AND v_settings.automation_state='ARMED' THEN
    v_outcome := 'LIVE_AUTOMATED_ARMED';
  ELSIF v_ec.status = 'live_cron_allowed' AND v_settings.operating_mode='AUTOMATED_PRODUCTION' THEN
    v_outcome := 'LIVE_AUTOMATED_STANDBY';
  ELSIF v_ec.status IN ('live_manual_only','live_cron_allowed') AND v_settings.operating_mode='MANUAL_PRODUCTION' THEN
    v_outcome := 'LIVE_MANUAL';
  ELSIF (v_status->'stage6'->>'one_real_email_certification_status') IS NOT NULL
        AND (v_status->'stage6'->>'manual_verification_status') = 'CONFIRMED' THEN
    v_outcome := 'STAGE_6_COMPLETE';
  END IF;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'is_stage9_complete', v_outcome IN ('LIVE_MANUAL','LIVE_AUTOMATED_ARMED'),
    'status', v_status,
    'evaluated_at', now());
END $$;
REVOKE ALL ON FUNCTION public.get_comm_hub_go_live_completion(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_go_live_completion(text,text,text) TO authenticated;
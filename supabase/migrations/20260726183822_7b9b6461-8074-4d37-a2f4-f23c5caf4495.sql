
-- =====================================================================
-- Communication Hub — Final Automated Production safety patch
-- =====================================================================

-- 1) Control settings additions
ALTER TABLE public.communication_hub_control_settings
  ADD COLUMN IF NOT EXISTS automation_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_arm_audit_id uuid,
  ADD COLUMN IF NOT EXISTS heartbeat_arm_audit_id uuid,
  ADD COLUMN IF NOT EXISTS heartbeat_readiness_snapshot_id uuid;

-- 2) Arm audit additions (readiness pinning)
ALTER TABLE public.communication_hub_arm_audit
  ADD COLUMN IF NOT EXISTS readiness_result_ids uuid[],
  ADD COLUMN IF NOT EXISTS pinned_configuration_version bigint;

-- 3) Event certification pinning
ALTER TABLE public.communication_hub_event_certification
  ADD COLUMN IF NOT EXISTS pinned_readiness_result_ids uuid[],
  ADD COLUMN IF NOT EXISTS pinned_configuration_version bigint;

-- 4) Observation intent (persist idempotency key BEFORE enqueue)
CREATE TABLE IF NOT EXISTS public.communication_manual_production_observation_intent (
  idempotency_key text PRIMARY KEY,
  operator_id uuid NOT NULL,
  module_code text NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  recipient_email text NOT NULL,
  event_certification_id uuid,
  request_id uuid,
  message_id uuid,
  phase text NOT NULL DEFAULT 'ENQUEUED'
     CHECK (phase IN ('ENQUEUED','AWAITING_PROVIDER','AWAITING_INBOX_CONFIRMATION','CONFIRMED','NOT_RECEIVED','FAILED')),
  finalized_observation_id uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.communication_manual_production_observation_intent TO authenticated;
GRANT ALL ON public.communication_manual_production_observation_intent TO service_role;
ALTER TABLE public.communication_manual_production_observation_intent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmpoi_read_admin ON public.communication_manual_production_observation_intent;
CREATE POLICY cmpoi_read_admin ON public.communication_manual_production_observation_intent
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'::app_role));
CREATE INDEX IF NOT EXISTS cmpoi_scope_idx
  ON public.communication_manual_production_observation_intent(module_code,event_code,channel,phase);

CREATE OR REPLACE FUNCTION public.tg_cmpoi_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_cmpoi_touch ON public.communication_manual_production_observation_intent;
CREATE TRIGGER trg_cmpoi_touch BEFORE UPDATE ON public.communication_manual_production_observation_intent
  FOR EACH ROW EXECUTE FUNCTION public.tg_cmpoi_touch();

-- 5) Intent recording (admin only)
DROP FUNCTION IF EXISTS public.record_comm_hub_observation_intent(text,text,text,text,text);
CREATE OR REPLACE FUNCTION public.record_comm_hub_observation_intent(
  p_idempotency_key text,
  p_module_code text,
  p_event_code text,
  p_channel text,
  p_recipient_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.communication_manual_production_observation_intent%ROWTYPE;
  v_ec  public.communication_hub_event_certification%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF coalesce(p_idempotency_key,'')='' THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
  IF coalesce(p_recipient_email,'')='' THEN RAISE EXCEPTION 'recipient_required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=coalesce(p_channel,'email');

  INSERT INTO public.communication_manual_production_observation_intent
    (idempotency_key, operator_id, module_code, event_code, channel, recipient_email, event_certification_id, phase)
  VALUES
    (p_idempotency_key, v_uid, p_module_code, p_event_code, coalesce(p_channel,'email'),
     lower(p_recipient_email), v_ec.id, 'ENQUEUED')
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_row FROM public.communication_manual_production_observation_intent
    WHERE idempotency_key=p_idempotency_key;

  RETURN jsonb_build_object('ok',true,
    'idempotency_key',v_row.idempotency_key,
    'phase',v_row.phase,
    'message_id',v_row.message_id,
    'request_id',v_row.request_id,
    'finalized_observation_id',v_row.finalized_observation_id);
END $$;
REVOKE ALL ON FUNCTION public.record_comm_hub_observation_intent(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_observation_intent(text,text,text,text,text) TO authenticated;

-- Service-role updater for the edge function
DROP FUNCTION IF EXISTS public.update_comm_hub_observation_intent(text,uuid,uuid,text,uuid,text);
CREATE OR REPLACE FUNCTION public.update_comm_hub_observation_intent(
  p_idempotency_key text,
  p_message_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_phase text DEFAULT NULL,
  p_finalized_observation_id uuid DEFAULT NULL,
  p_last_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.communication_manual_production_observation_intent
     SET message_id = coalesce(p_message_id, message_id),
         request_id = coalesce(p_request_id, request_id),
         phase = coalesce(p_phase, phase),
         finalized_observation_id = coalesce(p_finalized_observation_id, finalized_observation_id),
         last_error = coalesce(p_last_error, last_error),
         updated_at = now()
   WHERE idempotency_key = p_idempotency_key;
  RETURN jsonb_build_object('ok', FOUND);
END $$;
REVOKE ALL ON FUNCTION public.update_comm_hub_observation_intent(text,uuid,uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_comm_hub_observation_intent(text,uuid,uuid,text,uuid,text) TO service_role;

-- Recovery lookup for browser refresh
DROP FUNCTION IF EXISTS public.get_comm_hub_observation_recovery(text,text,text);
CREATE OR REPLACE FUNCTION public.get_comm_hub_observation_recovery(
  p_module_code text, p_event_code text, p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_intent public.communication_manual_production_observation_intent%ROWTYPE;
  v_obs public.communication_manual_production_observation%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_intent FROM public.communication_manual_production_observation_intent
   WHERE module_code=p_module_code AND event_code=p_event_code
     AND channel=coalesce(p_channel,'email')
     AND phase IN ('ENQUEUED','AWAITING_PROVIDER','AWAITING_INBOX_CONFIRMATION')
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',true,'has_pending',false);
  END IF;

  IF v_intent.finalized_observation_id IS NOT NULL THEN
    SELECT * INTO v_obs FROM public.communication_manual_production_observation
      WHERE id = v_intent.finalized_observation_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'has_pending',true,
    'idempotency_key', v_intent.idempotency_key,
    'phase', v_intent.phase,
    'message_id', v_intent.message_id,
    'request_id', v_intent.request_id,
    'observation_id', v_obs.id,
    'inbox_confirmation_status', v_obs.inbox_confirmation_status,
    'recipient_email', v_intent.recipient_email,
    'created_at', v_intent.created_at);
END $$;
REVOKE ALL ON FUNCTION public.get_comm_hub_observation_recovery(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_observation_recovery(text,text,text) TO authenticated;

-- 6) Redefine heartbeat with arm audit + readiness snapshot linkage
DROP FUNCTION IF EXISTS public.record_comm_hub_scheduler_heartbeat(text,bigint,text);
DROP FUNCTION IF EXISTS public.record_comm_hub_scheduler_heartbeat(text,uuid,uuid,bigint,text);
CREATE OR REPLACE FUNCTION public.record_comm_hub_scheduler_heartbeat(
  p_worker_version text,
  p_arm_audit_id uuid,
  p_readiness_snapshot_id uuid,
  p_processed_count bigint DEFAULT 0,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.communication_hub_control_settings
     SET last_scheduler_heartbeat_at = now(),
         scheduler_worker_version    = p_worker_version,
         last_processed_count        = p_processed_count,
         last_scheduler_error        = p_error,
         heartbeat_arm_audit_id      = p_arm_audit_id,
         heartbeat_readiness_snapshot_id = p_readiness_snapshot_id,
         updated_at                  = now()
   WHERE singleton_guard='primary';
  RETURN jsonb_build_object('ok',true,'at',now());
END $$;
REVOKE ALL ON FUNCTION public.record_comm_hub_scheduler_heartbeat(text,uuid,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_scheduler_heartbeat(text,uuid,uuid,bigint,text) TO service_role;

-- 7) Certify: remove IS NULL from readiness clause; pin readiness ids.
CREATE OR REPLACE FUNCTION public.certify_comm_hub_event_automated_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event  text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_reason text := p_payload->>'reason';
  v_typed  text := coalesce(p_payload->>'typed_confirmation','');
  v_current public.communication_hub_event_certification%ROWTYPE;
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_obs public.communication_manual_production_observation%ROWTYPE;
  v_att public.communication_delivery_attempt%ROWTYPE;
  v_msg public.communication_message%ROWTYPE;
  v_provider public.notification_providers%ROWTYPE;
  v_distinct_ok int;
  v_pinned uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF v_typed <> 'CERTIFY AUTOMATED PRODUCTION' THEN RAISE EXCEPTION 'typed_confirmation_mismatch' USING ERRCODE='22023'; END IF;
  IF coalesce(length(trim(v_reason)),0) < 6 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_missing' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_current FROM public.communication_hub_event_certification
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manual_production_certification_required' USING ERRCODE='22023'; END IF;

  IF v_current.status='live_cron_allowed' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'status','live_cron_allowed','certification_row_id',v_current.id);
  END IF;
  IF v_current.status<>'live_manual_only' THEN RAISE EXCEPTION 'event_not_in_live_manual_only' USING ERRCODE='22023'; END IF;
  IF v_current.drift_detected_at IS NOT NULL THEN RAISE EXCEPTION 'drift_detected_cannot_certify' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel
      AND event_certification_id=v_current.id
      AND send_context='manual_production'
      AND status='CONFIRMED' AND inbox_confirmation_status='CONFIRMED'
      AND provider_call_attempted=true AND provider_message_id IS NOT NULL
      AND delivery_attempt_id IS NOT NULL AND trace_id IS NOT NULL
      AND dispatched_at > v_current.approved_at
    ORDER BY dispatched_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_manual_observation' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_msg FROM public.communication_message WHERE id=v_obs.message_id;
  IF NOT FOUND OR v_msg.status NOT IN ('sent','delivered') OR v_msg.test_mode=true THEN
    RAISE EXCEPTION 'observation_message_not_valid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_att FROM public.communication_delivery_attempt WHERE id=v_obs.delivery_attempt_id;
  IF NOT FOUND OR v_att.status NOT IN ('success','delivered','sent') THEN
    RAISE EXCEPTION 'observation_attempt_not_successful' USING ERRCODE='22023'; END IF;
  IF v_att.provider_id IS NOT NULL THEN
    SELECT * INTO v_provider FROM public.notification_providers WHERE id=v_att.provider_id;
    IF FOUND AND lower(coalesce(v_provider.mode,'')) IN ('stub','dry_run','dryrun','test') THEN
      RAISE EXCEPTION 'observation_provider_is_stub_or_dry_run' USING ERRCODE='22023';
    END IF;
  END IF;

  -- Nine DISTINCT check codes, strictly tied to THIS event certification.
  SELECT array_agg(id), count(DISTINCT check_code)
    INTO v_pinned, v_distinct_ok
   FROM public.comm_hub_automation_readiness_results
  WHERE module_code=v_module AND event_code=v_event AND channel=v_channel
    AND event_certification_id = v_current.id
    AND result=true AND expires_at > now()
    AND checked_at > v_current.approved_at
    AND check_code IN ('scheduler','automatic_triggers','retry_worker','dead_letter',
                       'rate_limits','batch_limits','provider_circuit_breaker',
                       'emergency_stop','alerting_monitoring');
  IF v_distinct_ok < 9 THEN
    RAISE EXCEPTION 'automation_readiness_incomplete' USING ERRCODE='22023',
      DETAIL=format('distinct_ok=%s', v_distinct_ok);
  END IF;

  UPDATE public.communication_hub_event_certification
     SET status='live_cron_allowed',
         automation_certified_at=now(),
         automation_certified_by=v_uid,
         reason=v_reason,
         pinned_readiness_result_ids=v_pinned,
         pinned_configuration_version=v_settings.configuration_version
   WHERE id=v_current.id;

  UPDATE public.communication_hub_event_live_control
     SET status='live_cron_allowed', reason=v_reason,
         changed_by=v_uid, changed_at=now(), updated_at=now()
   WHERE module_code=v_module AND event_code=v_event;

  RETURN jsonb_build_object('ok',true,'status','live_cron_allowed',
    'certification_row_id',v_current.id,
    'pinned_readiness_count', array_length(v_pinned,1),
    'pinned_configuration_version', v_settings.configuration_version);
END $$;
REVOKE ALL ON FUNCTION public.certify_comm_hub_event_automated_production(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certify_comm_hub_event_automated_production(jsonb) TO authenticated;

-- 8) Apply release mode — AUTOMATED_PRODUCTION uses pinned readiness.
CREATE OR REPLACE FUNCTION public.apply_communication_release_mode(
  p_new_mode text, p_reason text DEFAULT NULL, p_expected_version integer DEFAULT NULL,
  p_module_code text DEFAULT NULL, p_event_code text DEFAULT NULL, p_channel text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_new_mode public.communication_operating_mode;
  v_channel text := coalesce(p_channel,'email');
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_obs_ok int; v_ready_ok int; v_eligible_auto int;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  BEGIN v_is_admin := public.is_comm_hub_operator_admin(v_uid);
  EXCEPTION WHEN undefined_function THEN
    SELECT public.has_role(v_uid,'Admin'::public.app_role) INTO v_is_admin; END;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  BEGIN v_new_mode := p_new_mode::public.communication_operating_mode;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'unknown_operating_mode' USING ERRCODE='22023'; END;

  IF v_new_mode='AUTOMATED_PRODUCTION'::public.communication_operating_mode THEN
    IF p_module_code IS NULL OR p_event_code IS NULL THEN RAISE EXCEPTION 'automated_scope_required' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
    IF NOT FOUND THEN RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002'; END IF;
    IF lower(coalesce(v_settings.operating_mode::text,''))='emergency_stop' THEN
      RAISE EXCEPTION 'emergency_stop_active' USING ERRCODE='22023'; END IF;

    SELECT * INTO v_ec FROM public.communication_hub_event_certification
      WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;
    IF NOT FOUND OR v_ec.status<>'live_cron_allowed' THEN
      RAISE EXCEPTION 'automated_event_not_certified' USING ERRCODE='22023'; END IF;
    IF v_ec.drift_detected_at IS NOT NULL THEN RAISE EXCEPTION 'drift_detected' USING ERRCODE='22023'; END IF;

    SELECT count(*) INTO v_obs_ok FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id
        AND status='CONFIRMED' AND inbox_confirmation_status='CONFIRMED'
        AND send_context='manual_production'
        AND provider_call_attempted=true AND provider_message_id IS NOT NULL
        AND dispatched_at > v_ec.approved_at;
    IF v_obs_ok<1 THEN RAISE EXCEPTION 'confirmed_manual_observation_required' USING ERRCODE='22023'; END IF;

    -- Pinned readiness only (config/arm version bumps don't invalidate)
    SELECT count(DISTINCT check_code) INTO v_ready_ok
      FROM public.comm_hub_automation_readiness_results
     WHERE id = ANY(coalesce(v_ec.pinned_readiness_result_ids,'{}'::uuid[]))
       AND result=true AND expires_at > now();
    IF v_ready_ok<9 THEN RAISE EXCEPTION 'automation_readiness_incomplete' USING ERRCODE='22023'; END IF;

    SELECT count(*) INTO v_eligible_auto FROM public.communication_hub_event_certification WHERE status='live_cron_allowed';
    IF v_eligible_auto<1 THEN RAISE EXCEPTION 'no_eligible_automated_events' USING ERRCODE='22023'; END IF;
  END IF;

  v_result := public._apply_comm_hub_mode_transition_core(
                v_new_mode, p_reason, p_expected_version::bigint,
                v_uid, 'apply_communication_release_mode');
  RETURN v_result || jsonb_build_object('scope',
    jsonb_build_object('module_code',p_module_code,'event_code',p_event_code,'channel',v_channel));
END $$;

-- 9) Arm: don't bump configuration_version; bump automation_generation;
--    clear all previous heartbeat fields; return an immutable arm audit id;
--    keep batch/bulk disabled; use pinned readiness ids.
CREATE OR REPLACE FUNCTION public.arm_comm_hub_automation(
  p_reason text, p_confirmation text, p_expected_version bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_row public.communication_hub_control_settings%ROWTYPE;
  v_now timestamptz := now();
  v_eligible_cnt int;
  v_evt public.communication_hub_event_certification%ROWTYPE;
  v_obs_ok int; v_ready_ok int;
  v_snapshot jsonb;
  v_all_pinned uuid[] := '{}'::uuid[];
  v_arm_audit_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  BEGIN v_is_admin := public.is_comm_hub_operator_admin(v_uid);
  EXCEPTION WHEN undefined_function THEN
    SELECT public.has_role(v_uid,'Admin'::public.app_role) INTO v_is_admin; END;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  IF coalesce(p_reason,'')='' THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF coalesce(p_confirmation,'')<>'ARM AUTOMATED PRODUCTION' THEN RAISE EXCEPTION 'typed_confirmation_mismatch' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_row FROM public.communication_hub_control_settings WHERE singleton_guard='primary' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002'; END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version<>v_row.configuration_version THEN
    RAISE EXCEPTION 'configuration_version_conflict' USING ERRCODE='40001'; END IF;

  -- Idempotent replay
  IF v_row.automation_state='ARMED' THEN
    INSERT INTO public.communication_hub_arm_audit(action,actor,reason,configuration_version,
      automation_state_before,automation_state_after,snapshot)
    VALUES ('IDEMPOTENT_ARM',v_uid,p_reason,v_row.configuration_version,'ARMED','ARMED',
      jsonb_build_object('idempotent',true,'current_arm_audit_id',v_row.current_arm_audit_id))
    RETURNING id INTO v_arm_audit_id;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'automation_state','ARMED',
      'configuration_version',v_row.configuration_version,
      'arm_audit_id',v_row.current_arm_audit_id,
      'idempotent_audit_id',v_arm_audit_id);
  END IF;

  IF v_row.operating_mode<>'AUTOMATED_PRODUCTION'::public.communication_operating_mode THEN
    RAISE EXCEPTION 'automation_not_in_automated_production' USING ERRCODE='22023'; END IF;
  IF v_row.automation_state<>'STANDBY' THEN RAISE EXCEPTION 'automation_state_not_standby' USING ERRCODE='22023'; END IF;
  IF NOT coalesce(v_row.dispatch_enabled,false) THEN RAISE EXCEPTION 'dispatch_not_enabled' USING ERRCODE='22023'; END IF;

  SELECT count(*) INTO v_eligible_cnt FROM public.communication_hub_event_certification WHERE status='live_cron_allowed';
  IF v_eligible_cnt<1 THEN RAISE EXCEPTION 'no_eligible_automated_events' USING ERRCODE='22023'; END IF;

  FOR v_evt IN SELECT * FROM public.communication_hub_event_certification WHERE status='live_cron_allowed' LOOP
    IF v_evt.drift_detected_at IS NOT NULL THEN
      RAISE EXCEPTION 'drift_detected' USING ERRCODE='22023',
        DETAIL=format('event=%s/%s',v_evt.module_code,v_evt.event_code); END IF;

    SELECT count(*) INTO v_obs_ok FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_evt.id
        AND status='CONFIRMED' AND inbox_confirmation_status='CONFIRMED'
        AND send_context='manual_production'
        AND provider_call_attempted=true AND provider_message_id IS NOT NULL
        AND dispatched_at > v_evt.approved_at;
    IF v_obs_ok<1 THEN RAISE EXCEPTION 'confirmed_manual_observation_required' USING ERRCODE='22023',
      DETAIL=format('event=%s/%s',v_evt.module_code,v_evt.event_code); END IF;

    SELECT count(DISTINCT check_code) INTO v_ready_ok
      FROM public.comm_hub_automation_readiness_results
     WHERE id = ANY(coalesce(v_evt.pinned_readiness_result_ids,'{}'::uuid[]))
       AND result=true AND expires_at > now();
    IF v_ready_ok<9 THEN RAISE EXCEPTION 'automation_readiness_incomplete' USING ERRCODE='22023',
      DETAIL=format('event=%s/%s distinct_ok=%s',v_evt.module_code,v_evt.event_code,v_ready_ok); END IF;

    v_all_pinned := v_all_pinned || coalesce(v_evt.pinned_readiness_result_ids,'{}'::uuid[]);
  END LOOP;

  v_snapshot := jsonb_build_object(
    'eligible_events',v_eligible_cnt,
    'configuration_version',v_row.configuration_version,
    'automation_generation_before',v_row.automation_generation,
    'automation_generation_after',v_row.automation_generation+1,
    'reason',p_reason);

  INSERT INTO public.communication_hub_arm_audit(action,actor,reason,configuration_version,
    automation_state_before,automation_state_after,eligible_event_count,snapshot,
    readiness_result_ids, pinned_configuration_version)
  VALUES ('ARMED',v_uid,p_reason,v_row.configuration_version,'STANDBY','ARMED',v_eligible_cnt,v_snapshot,
    v_all_pinned, v_row.configuration_version)
  RETURNING id INTO v_arm_audit_id;

  PERFORM set_config('comm_hub.automation_op','on',true);
  UPDATE public.communication_hub_control_settings
     SET automation_state='ARMED',
         automation_armed_at=v_now,
         automation_armed_by=v_uid,
         automation_arm_reason=p_reason,
         automation_state_changed_at=v_now,
         automation_state_changed_by=v_uid,
         automation_suspended_at=NULL,
         automation_suspension_reason=NULL,
         scheduler_enabled=true,
         automatic_triggers_enabled=true,
         retry_worker_enabled=true,
         batch_enabled=false,
         bulk_enabled=false,
         automation_generation = v_row.automation_generation + 1,
         current_arm_audit_id  = v_arm_audit_id,
         last_scheduler_heartbeat_at = NULL,
         scheduler_worker_version    = NULL,
         last_processed_count        = NULL,
         last_scheduler_error        = NULL,
         heartbeat_arm_audit_id      = NULL,
         heartbeat_readiness_snapshot_id = NULL,
         updated_at=v_now, updated_by=v_uid
   WHERE singleton_guard='primary';

  RETURN jsonb_build_object('ok',true,'automation_state','ARMED',
    'configuration_version',v_row.configuration_version,
    'automation_generation',v_row.automation_generation+1,
    'arm_audit_id',v_arm_audit_id);
END $$;
REVOKE ALL ON FUNCTION public.arm_comm_hub_automation(text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arm_comm_hub_automation(text,text,bigint) TO authenticated, service_role;

-- 10) Stage 9 with %ROWTYPE + missing cert → INCOMPLETE (no raise).
CREATE OR REPLACE FUNCTION public.get_comm_hub_event_go_live_stage9(
  p_module_code text, p_event_code text, p_channel text DEFAULT 'email'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_obs public.communication_manual_production_observation%ROWTYPE;
  v_channel text := coalesce(p_channel,'email');
  v_hb_fresh boolean := false;
  v_hb_age_sec int;
  v_ready_ok int;
  v_status text;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  IF v_settings.operating_mode='EMERGENCY_STOP'::public.communication_operating_mode THEN
    RETURN jsonb_build_object('live_status','EMERGENCY_STOP',
      'blockers',jsonb_build_array(jsonb_build_object('code','EMERGENCY_STOP')),
      'heartbeat_fresh',false,
      'last_scheduler_heartbeat_at',v_settings.last_scheduler_heartbeat_at,
      'automation_state',v_settings.automation_state,
      'operating_mode',v_settings.operating_mode);
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EVENT_CERTIFICATION_MISSING'));
    RETURN jsonb_build_object('live_status','INCOMPLETE','blockers',v_blockers,
      'heartbeat_fresh',false,
      'automation_state',v_settings.automation_state,
      'operating_mode',v_settings.operating_mode,
      'configuration_version',v_settings.configuration_version);
  END IF;

  IF v_ec.drift_detected_at IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','DRIFT_DETECTED'));
  END IF;

  v_hb_age_sec := CASE WHEN v_settings.last_scheduler_heartbeat_at IS NULL THEN NULL
                       ELSE EXTRACT(EPOCH FROM (now()-v_settings.last_scheduler_heartbeat_at))::int END;
  v_hb_fresh := v_hb_age_sec IS NOT NULL AND v_hb_age_sec <= 120;

  IF v_ec.status<>'live_cron_allowed' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EVENT_NOT_LIVE_CRON_ALLOWED'));
  END IF;
  IF v_settings.operating_mode<>'AUTOMATED_PRODUCTION'::public.communication_operating_mode THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MODE_NOT_AUTOMATED_PRODUCTION'));
  END IF;
  IF v_settings.automation_state<>'ARMED' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','AUTOMATION_NOT_ARMED'));
  END IF;
  IF NOT coalesce(v_settings.scheduler_enabled,false)
     OR NOT coalesce(v_settings.automatic_triggers_enabled,false)
     OR NOT coalesce(v_settings.retry_worker_enabled,false) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','AUTOMATION_CONTROLS_OFF'));
  END IF;
  IF v_settings.last_scheduler_error IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','SCHEDULER_ERROR','detail',v_settings.last_scheduler_error));
  END IF;
  IF v_settings.last_scheduler_heartbeat_at IS NULL
     OR v_settings.automation_armed_at IS NULL
     OR v_settings.last_scheduler_heartbeat_at <= v_settings.automation_armed_at THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','HEARTBEAT_PREDATES_ARM'));
  END IF;
  IF v_settings.heartbeat_arm_audit_id IS NULL
     OR v_settings.current_arm_audit_id IS NULL
     OR v_settings.heartbeat_arm_audit_id <> v_settings.current_arm_audit_id THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','HEARTBEAT_OLD_ARM_GENERATION'));
  END IF;
  IF NOT v_hb_fresh THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','SCHEDULER_HEARTBEAT_STALE','detail',v_hb_age_sec));
  END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
   WHERE event_certification_id=v_ec.id
     AND status='CONFIRMED' AND inbox_confirmation_status='CONFIRMED'
   ORDER BY dispatched_at DESC LIMIT 1;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MANUAL_OBSERVATION_MISSING'));
  END IF;

  SELECT count(DISTINCT check_code) INTO v_ready_ok
    FROM public.comm_hub_automation_readiness_results
   WHERE id = ANY(coalesce(v_ec.pinned_readiness_result_ids,'{}'::uuid[]))
     AND result=true AND expires_at > now();
  IF v_ready_ok<9 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','READINESS_INCOMPLETE_OR_STALE'));
  END IF;

  IF jsonb_array_length(v_blockers)=0 THEN
    v_status := 'LIVE_AUTOMATED_ARMED';
  ELSIF v_settings.operating_mode='AUTOMATED_PRODUCTION'::public.communication_operating_mode
     AND v_settings.automation_state='STANDBY' THEN
    v_status := 'LIVE_AUTOMATED_STANDBY';
  ELSE
    v_status := 'INCOMPLETE';
  END IF;

  RETURN jsonb_build_object(
    'live_status',v_status,'blockers',v_blockers,
    'heartbeat_fresh',v_hb_fresh,'heartbeat_age_seconds',v_hb_age_sec,
    'last_scheduler_heartbeat_at',v_settings.last_scheduler_heartbeat_at,
    'scheduler_worker_version',v_settings.scheduler_worker_version,
    'last_processed_count',v_settings.last_processed_count,
    'last_scheduler_error',v_settings.last_scheduler_error,
    'current_arm_audit_id',v_settings.current_arm_audit_id,
    'heartbeat_arm_audit_id',v_settings.heartbeat_arm_audit_id,
    'automation_generation',v_settings.automation_generation,
    'automation_state',v_settings.automation_state,
    'operating_mode',v_settings.operating_mode,
    'configuration_version',v_settings.configuration_version);
END $$;
REVOKE ALL ON FUNCTION public.get_comm_hub_event_go_live_stage9(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_event_go_live_stage9(text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

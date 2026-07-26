
-- =====================================================================
-- Communication Hub — Final Automated Production activation hardening
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Heartbeat state on control settings
-- ---------------------------------------------------------------------
ALTER TABLE public.communication_hub_control_settings
  ADD COLUMN IF NOT EXISTS last_scheduler_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduler_worker_version    text,
  ADD COLUMN IF NOT EXISTS last_processed_count        bigint,
  ADD COLUMN IF NOT EXISTS last_scheduler_error        text;

-- Heartbeat RPC (service role only). Schedulers call this each tick.
CREATE OR REPLACE FUNCTION public.record_comm_hub_scheduler_heartbeat(
  p_worker_version text,
  p_processed_count bigint DEFAULT 0,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.communication_hub_control_settings
     SET last_scheduler_heartbeat_at = now(),
         scheduler_worker_version    = p_worker_version,
         last_processed_count        = p_processed_count,
         last_scheduler_error        = p_error,
         updated_at                  = now()
   WHERE singleton_guard = 'primary';
  RETURN jsonb_build_object('ok', true, 'at', now());
END $$;
REVOKE ALL ON FUNCTION public.record_comm_hub_scheduler_heartbeat(text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_scheduler_heartbeat(text,bigint,text) TO service_role;

-- ---------------------------------------------------------------------
-- 2) Immutable arm audit
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communication_hub_arm_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('ARMED','DISARMED','SUSPENDED','IDEMPOTENT_ARM')),
  actor uuid,
  reason text,
  configuration_version bigint,
  automation_state_before text,
  automation_state_after text,
  eligible_event_count int,
  scope_module_code text,
  scope_event_code text,
  scope_channel text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.communication_hub_arm_audit TO authenticated;
GRANT ALL ON public.communication_hub_arm_audit TO service_role;
ALTER TABLE public.communication_hub_arm_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chaa_read_admin ON public.communication_hub_arm_audit;
CREATE POLICY chaa_read_admin ON public.communication_hub_arm_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'::app_role));

-- Enforce immutability
CREATE OR REPLACE FUNCTION public.tg_communication_hub_arm_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'communication_hub_arm_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_chaa_no_update ON public.communication_hub_arm_audit;
CREATE TRIGGER trg_chaa_no_update BEFORE UPDATE OR DELETE ON public.communication_hub_arm_audit
  FOR EACH ROW EXECUTE FUNCTION public.tg_communication_hub_arm_audit_immutable();

-- ---------------------------------------------------------------------
-- 3) Explicit inbox confirmation RPC
--    Server-authorised. Never called from finalize path.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.confirm_comm_hub_manual_production_observation(uuid,text,text);
CREATE OR REPLACE FUNCTION public.confirm_comm_hub_manual_production_observation(
  p_observation_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_obs record;
  v_msg record;
  v_att record;
  v_provider record;
  v_ec  record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('CONFIRMED','NOT_RECEIVED') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
    WHERE id = p_observation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'observation_not_found' USING ERRCODE='P0002'; END IF;

  -- Idempotent replay
  IF v_obs.inbox_confirmation_status = p_decision THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,
      'observation_id',v_obs.id,'inbox_confirmation_status',v_obs.inbox_confirmation_status,
      'status',v_obs.status);
  END IF;
  IF v_obs.inbox_confirmation_status IS NOT NULL THEN
    RAISE EXCEPTION 'inbox_already_decided' USING ERRCODE='22023';
  END IF;

  IF p_decision = 'NOT_RECEIVED' THEN
    UPDATE public.communication_manual_production_observation
       SET inbox_confirmation_status = 'NOT_RECEIVED',
           inbox_confirmed_at        = now(),
           inbox_confirmed_by        = v_uid,
           inbox_confirmation_note   = p_note,
           status                    = 'FAILED',
           updated_at                = now()
     WHERE id = p_observation_id;
    RETURN jsonb_build_object('ok',true,'observation_id',p_observation_id,
      'inbox_confirmation_status','NOT_RECEIVED','status','FAILED');
  END IF;

  -- CONFIRMED — require full durable provider evidence
  IF v_obs.send_context <> 'manual_production' THEN
    RAISE EXCEPTION 'send_context_not_manual_production' USING ERRCODE='22023';
  END IF;
  IF NOT v_obs.provider_call_attempted THEN
    RAISE EXCEPTION 'provider_call_not_attempted' USING ERRCODE='22023';
  END IF;
  IF v_obs.provider_message_id IS NULL OR length(v_obs.provider_message_id)=0 THEN
    RAISE EXCEPTION 'provider_message_id_missing' USING ERRCODE='22023';
  END IF;
  IF v_obs.delivery_attempt_id IS NULL THEN RAISE EXCEPTION 'delivery_attempt_missing' USING ERRCODE='22023'; END IF;
  IF v_obs.trace_id IS NULL THEN RAISE EXCEPTION 'trace_missing' USING ERRCODE='22023'; END IF;
  IF v_obs.message_id IS NULL THEN RAISE EXCEPTION 'message_missing' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_msg FROM public.communication_message WHERE id = v_obs.message_id;
  IF NOT FOUND OR v_msg.status NOT IN ('sent','delivered') THEN
    RAISE EXCEPTION 'message_not_sent_or_delivered' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_att FROM public.communication_delivery_attempt WHERE id = v_obs.delivery_attempt_id;
  IF NOT FOUND OR v_att.status NOT IN ('success','delivered','sent') THEN
    RAISE EXCEPTION 'attempt_not_successful' USING ERRCODE='22023';
  END IF;
  IF v_att.provider_id IS NOT NULL THEN
    SELECT * INTO v_provider FROM public.notification_providers WHERE id = v_att.provider_id;
    IF FOUND AND lower(coalesce(v_provider.mode,'')) IN ('stub','dry_run','dryrun','test') THEN
      RAISE EXCEPTION 'provider_is_stub_or_dry_run' USING ERRCODE='22023';
    END IF;
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification WHERE id = v_obs.event_certification_id;
  IF NOT FOUND OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    RAISE EXCEPTION 'event_not_manually_certified' USING ERRCODE='22023';
  END IF;
  IF v_obs.dispatched_at <= v_ec.approved_at THEN
    RAISE EXCEPTION 'observation_predates_manual_approval' USING ERRCODE='22023';
  END IF;

  UPDATE public.communication_manual_production_observation
     SET inbox_confirmation_status = 'CONFIRMED',
         inbox_confirmed_at        = now(),
         inbox_confirmed_by        = v_uid,
         inbox_confirmation_note   = p_note,
         status                    = 'CONFIRMED',
         updated_at                = now()
   WHERE id = p_observation_id;

  RETURN jsonb_build_object('ok',true,'observation_id',p_observation_id,
    'inbox_confirmation_status','CONFIRMED','status','CONFIRMED');
END $$;
REVOKE ALL ON FUNCTION public.confirm_comm_hub_manual_production_observation(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_comm_hub_manual_production_observation(uuid,text,text) TO authenticated;

-- ---------------------------------------------------------------------
-- 4) Finalizer NEVER sets inbox_confirmation_status.
--    Contract: sets status=DISPATCHED, leaves inbox_confirmation_status null,
--    returns phase=AWAITING_INBOX_CONFIRMATION when evidence is complete.
--    Existing code already inserts with status='DISPATCHED' and null inbox
--    status; we redefine to be explicit and include phase in the response.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_comm_hub_manual_production_observation(
  p_message_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg record; v_req record; v_att record; v_ec record;
  v_settings record; v_provider record;
  v_trace_id uuid; v_recipient text;
  v_existing_row record; v_id uuid;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF p_message_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'phase','FAILED','blockers',
      jsonb_build_array(jsonb_build_object('code','message_id_required')));
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key)=0 THEN
    RETURN jsonb_build_object('ok',false,'phase','FAILED','blockers',
      jsonb_build_array(jsonb_build_object('code','idempotency_key_required')));
  END IF;

  SELECT * INTO v_existing_row FROM public.communication_manual_production_observation
    WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true,
      'observation_id', v_existing_row.id,
      'message_id', v_existing_row.message_id,
      'phase', CASE
        WHEN v_existing_row.inbox_confirmation_status = 'CONFIRMED' THEN 'CONFIRMED'
        WHEN v_existing_row.inbox_confirmation_status = 'NOT_RECEIVED' THEN 'NOT_RECEIVED'
        WHEN v_existing_row.status IN ('DISPATCHED','CONFIRMED') THEN 'AWAITING_INBOX_CONFIRMATION'
        ELSE v_existing_row.status
      END,
      'status', v_existing_row.status,
      'inbox_confirmation_status', v_existing_row.inbox_confirmation_status);
  END IF;

  SELECT * INTO v_msg FROM public.communication_message WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'phase','FAILED','blockers',
      jsonb_build_array(jsonb_build_object('code','message_not_found')));
  END IF;

  IF coalesce(v_msg.send_context,'') <> 'manual_production' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','send_context_not_manual_production','detail',v_msg.send_context));
  END IF;
  IF v_msg.test_mode = true THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','message_is_test_mode'));
  END IF;
  IF v_msg.status NOT IN ('sent','delivered') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','message_status_not_sent_or_delivered','detail',v_msg.status));
  END IF;

  SELECT * INTO v_req FROM public.communication_request WHERE id = v_msg.request_id;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','request_not_found'));
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code = coalesce(v_req.module_code, v_msg.module_code)
      AND event_code  = coalesce(v_req.event_code,  v_msg.event_code)
      AND channel     = v_msg.channel;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','event_certification_missing'));
  ELSIF v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','event_not_manually_certified','detail',v_ec.status));
  ELSIF v_msg.created_at < v_ec.approved_at THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','message_predates_certification'));
  END IF;

  SELECT * INTO v_att FROM public.communication_delivery_attempt
    WHERE message_id = v_msg.id AND status IN ('success','delivered','sent')
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','no_successful_delivery_attempt'));
  ELSE
    IF v_att.provider_message_id IS NULL OR length(v_att.provider_message_id)=0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','provider_message_id_missing'));
    END IF;
    IF v_att.provider_id IS NOT NULL THEN
      SELECT * INTO v_provider FROM public.notification_providers WHERE id = v_att.provider_id;
      IF FOUND AND lower(coalesce(v_provider.mode,'')) IN ('stub','dry_run','dryrun','test') THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','provider_is_stub_or_dry_run','detail',v_provider.mode));
      END IF;
    END IF;
  END IF;

  SELECT trace_id INTO v_trace_id FROM public.communication_hub_trace_link
    WHERE message_id = v_msg.id LIMIT 1;
  IF v_trace_id IS NULL THEN v_trace_id := v_msg.trace_id; END IF;
  IF v_trace_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','trace_missing'));
  END IF;

  SELECT lower(email) INTO v_recipient FROM public.communication_message_recipient
    WHERE message_id = v_msg.id AND lower(coalesce(role,'to'))='to' LIMIT 1;
  IF v_recipient IS NULL THEN v_recipient := lower(coalesce(v_msg.recipient_email,'')); END IF;
  IF v_recipient IS NULL OR length(v_recipient)=0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','recipient_missing'));
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok',false,'phase','AWAITING_PROVIDER','blockers',v_blockers);
  END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  INSERT INTO public.communication_manual_production_observation
    (module_code,event_code,channel,event_certification_id,
     request_id,message_id,delivery_attempt_id,trace_id,
     provider_id,provider_name,provider_message_id,
     provider_call_attempted,provider_outcome,
     recipient_email,recipient_set_hash,configuration_version,
     sender_profile_id,template_version_id,idempotency_key,
     status,inbox_confirmation_status,dispatched_by)
  VALUES
    (v_ec.module_code, v_ec.event_code, v_ec.channel, v_ec.id,
     v_req.id, v_msg.id, v_att.id, v_trace_id,
     v_att.provider_id, coalesce(v_provider.name, v_att.provider_name), v_att.provider_message_id,
     true, v_att.status,
     v_recipient, v_msg.recipient_set_hash, v_settings.configuration_version,
     v_msg.sender_profile_id, v_msg.template_version_id, p_idempotency_key,
     'DISPATCHED', NULL, v_msg.created_by)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'phase','AWAITING_INBOX_CONFIRMATION',
    'observation_id', v_id,
    'status','DISPATCHED',
    'inbox_confirmation_status', NULL,
    'request_id', v_req.id, 'message_id', v_msg.id,
    'delivery_attempt_id', v_att.id, 'trace_id', v_trace_id,
    'provider_id', v_att.provider_id,
    'provider_name', coalesce(v_provider.name, v_att.provider_name),
    'provider_message_id', v_att.provider_message_id,
    'provider_call_attempted', true, 'provider_outcome', v_att.status,
    'message_status', v_msg.status, 'attempt_status', v_att.status,
    'recipient', v_recipient, 'event_certification_id', v_ec.id
  );
END $$;
REVOKE ALL ON FUNCTION public.finalize_comm_hub_manual_production_observation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_comm_hub_manual_production_observation(uuid,text) TO service_role;

-- ---------------------------------------------------------------------
-- 5) Harden certify_comm_hub_event_automated_production
--    - Require exactly 9 distinct fresh readiness checks tied to current
--      configuration version and current event certification, checked
--      after manual approval.
--    - Require a confirmed manual-production observation with complete
--      durable evidence (attempt success/delivered, real provider,
--      provider_message_id, trace_id).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.certify_comm_hub_event_automated_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event  text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_reason text := p_payload->>'reason';
  v_typed  text := coalesce(p_payload->>'typed_confirmation','');
  v_current record; v_settings record;
  v_obs record; v_att record; v_msg record; v_provider record;
  v_distinct_ok int;
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
  IF v_current.configuration_version IS NOT NULL
     AND v_current.configuration_version <> v_settings.configuration_version THEN
    RAISE EXCEPTION 'configuration_version_drift' USING ERRCODE='40001';
  END IF;

  -- Confirmed observation with complete durable evidence
  SELECT * INTO v_obs FROM public.communication_manual_production_observation
   WHERE module_code=v_module AND event_code=v_event AND channel=v_channel
     AND event_certification_id=v_current.id
     AND send_context='manual_production'
     AND status='CONFIRMED'
     AND inbox_confirmation_status='CONFIRMED'
     AND provider_call_attempted=true
     AND provider_message_id IS NOT NULL
     AND delivery_attempt_id IS NOT NULL
     AND trace_id IS NOT NULL
     AND dispatched_at > v_current.approved_at
   ORDER BY dispatched_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_manual_observation' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_msg FROM public.communication_message WHERE id = v_obs.message_id;
  IF NOT FOUND OR v_msg.status NOT IN ('sent','delivered') OR v_msg.test_mode = true THEN
    RAISE EXCEPTION 'observation_message_not_valid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_att FROM public.communication_delivery_attempt WHERE id = v_obs.delivery_attempt_id;
  IF NOT FOUND OR v_att.status NOT IN ('success','delivered','sent') THEN
    RAISE EXCEPTION 'observation_attempt_not_successful' USING ERRCODE='22023';
  END IF;
  IF v_att.provider_id IS NOT NULL THEN
    SELECT * INTO v_provider FROM public.notification_providers WHERE id = v_att.provider_id;
    IF FOUND AND lower(coalesce(v_provider.mode,'')) IN ('stub','dry_run','dryrun','test') THEN
      RAISE EXCEPTION 'observation_provider_is_stub_or_dry_run' USING ERRCODE='22023';
    END IF;
  END IF;

  -- Nine DISTINCT check codes, all true, unexpired, tied to current config,
  -- checked after manual approval, scoped to this event+channel+cert.
  SELECT count(DISTINCT check_code) INTO v_distinct_ok
    FROM public.comm_hub_automation_readiness_results
   WHERE module_code=v_module AND event_code=v_event AND channel=v_channel
     AND configuration_version = v_settings.configuration_version
     AND (event_certification_id = v_current.id OR event_certification_id IS NULL)
     AND result = true
     AND expires_at > now()
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

-- ---------------------------------------------------------------------
-- 6) Server-gate AUTOMATED_PRODUCTION in apply_communication_release_mode
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_communication_release_mode(
  p_new_mode text,
  p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL,
  p_module_code text DEFAULT NULL,
  p_event_code text DEFAULT NULL,
  p_channel text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_new_mode public.communication_operating_mode;
  v_channel text := coalesce(p_channel,'email');
  v_ec record; v_settings record; v_obs_ok int; v_ready_ok int;
  v_estop_active boolean := false;
  v_eligible_auto int;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  BEGIN
    v_is_admin := public.is_comm_hub_operator_admin(v_uid);
  EXCEPTION WHEN undefined_function THEN
    SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role='Admin'::public.app_role) INTO v_is_admin;
  END;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  BEGIN v_new_mode := p_new_mode::public.communication_operating_mode;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'unknown_operating_mode' USING ERRCODE='22023'; END;

  -- Scoped AUTOMATED_PRODUCTION gate
  IF v_new_mode = 'AUTOMATED_PRODUCTION'::public.communication_operating_mode THEN
    IF p_module_code IS NULL OR p_event_code IS NULL THEN
      RAISE EXCEPTION 'automated_scope_required' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
    IF NOT FOUND THEN RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002'; END IF;

    -- Emergency Stop not currently active
    v_estop_active := lower(coalesce(v_settings.operating_mode::text,'')) = 'emergency_stop';
    IF v_estop_active THEN RAISE EXCEPTION 'emergency_stop_active' USING ERRCODE='22023'; END IF;

    SELECT * INTO v_ec FROM public.communication_hub_event_certification
      WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;
    IF NOT FOUND OR v_ec.status <> 'live_cron_allowed' THEN
      RAISE EXCEPTION 'automated_event_not_certified' USING ERRCODE='22023';
    END IF;
    IF v_ec.drift_detected_at IS NOT NULL THEN
      RAISE EXCEPTION 'drift_detected' USING ERRCODE='22023';
    END IF;

    SELECT count(*) INTO v_obs_ok FROM public.communication_manual_production_observation
     WHERE event_certification_id = v_ec.id
       AND status='CONFIRMED' AND inbox_confirmation_status='CONFIRMED'
       AND send_context='manual_production'
       AND provider_call_attempted=true
       AND provider_message_id IS NOT NULL
       AND dispatched_at > v_ec.approved_at;
    IF v_obs_ok < 1 THEN RAISE EXCEPTION 'confirmed_manual_observation_required' USING ERRCODE='22023'; END IF;

    SELECT count(DISTINCT check_code) INTO v_ready_ok
      FROM public.comm_hub_automation_readiness_results
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel
       AND configuration_version = v_settings.configuration_version
       AND result=true AND expires_at > now()
       AND checked_at > v_ec.approved_at;
    IF v_ready_ok < 9 THEN RAISE EXCEPTION 'automation_readiness_incomplete' USING ERRCODE='22023'; END IF;

    SELECT count(*) INTO v_eligible_auto FROM public.communication_hub_event_certification
     WHERE status='live_cron_allowed';
    IF v_eligible_auto < 1 THEN RAISE EXCEPTION 'no_eligible_automated_events' USING ERRCODE='22023'; END IF;
  END IF;

  v_result := public._apply_comm_hub_mode_transition_core(
                v_new_mode, p_reason, p_expected_version::bigint,
                v_uid, 'apply_communication_release_mode');

  RETURN v_result || jsonb_build_object(
    'scope', jsonb_build_object(
      'module_code', p_module_code, 'event_code', p_event_code, 'channel', v_channel));
END $$;

-- ---------------------------------------------------------------------
-- 7) Replace arm_comm_hub_automation — evidence-based, idempotent.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arm_comm_hub_automation(
  p_reason text,
  p_confirmation text,
  p_expected_version bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_row public.communication_hub_control_settings%ROWTYPE;
  v_now timestamptz := now();
  v_new_ver bigint;
  v_eligible_cnt int;
  v_evt record;
  v_obs_ok int; v_ready_ok int;
  v_snapshot jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  BEGIN v_is_admin := public.is_comm_hub_operator_admin(v_uid);
  EXCEPTION WHEN undefined_function THEN
    SELECT public.has_role(v_uid,'Admin'::public.app_role) INTO v_is_admin; END;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  IF coalesce(p_reason,'')='' THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF coalesce(p_confirmation,'')<>'ARM AUTOMATED PRODUCTION' THEN
    RAISE EXCEPTION 'typed_confirmation_mismatch' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.communication_hub_control_settings
    WHERE singleton_guard='primary' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002'; END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_row.configuration_version THEN
    RAISE EXCEPTION 'configuration_version_conflict' USING ERRCODE='40001';
  END IF;

  -- Idempotent replay
  IF v_row.automation_state = 'ARMED' THEN
    INSERT INTO public.communication_hub_arm_audit(action,actor,reason,configuration_version,
      automation_state_before,automation_state_after,snapshot)
    VALUES ('IDEMPOTENT_ARM',v_uid,p_reason,v_row.configuration_version,
      'ARMED','ARMED', jsonb_build_object('idempotent',true));
    RETURN jsonb_build_object('ok',true,'idempotent',true,
      'automation_state','ARMED','configuration_version',v_row.configuration_version);
  END IF;

  IF v_row.operating_mode <> 'AUTOMATED_PRODUCTION'::public.communication_operating_mode THEN
    RAISE EXCEPTION 'automation_not_in_automated_production' USING ERRCODE='22023';
  END IF;
  IF v_row.automation_state <> 'STANDBY' THEN
    RAISE EXCEPTION 'automation_state_not_standby' USING ERRCODE='22023';
  END IF;
  IF NOT coalesce(v_row.dispatch_enabled,false) THEN
    RAISE EXCEPTION 'dispatch_not_enabled' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_eligible_cnt FROM public.communication_hub_event_certification
   WHERE status='live_cron_allowed';
  IF v_eligible_cnt < 1 THEN RAISE EXCEPTION 'no_eligible_automated_events' USING ERRCODE='22023'; END IF;

  -- Every live_cron_allowed event must have complete evidence
  FOR v_evt IN SELECT * FROM public.communication_hub_event_certification WHERE status='live_cron_allowed' LOOP
    IF v_evt.drift_detected_at IS NOT NULL THEN
      RAISE EXCEPTION 'drift_detected' USING ERRCODE='22023',
        DETAIL=format('event=%s/%s', v_evt.module_code, v_evt.event_code);
    END IF;

    SELECT count(*) INTO v_obs_ok FROM public.communication_manual_production_observation
     WHERE event_certification_id = v_evt.id
       AND status='CONFIRMED' AND inbox_confirmation_status='CONFIRMED'
       AND send_context='manual_production'
       AND provider_call_attempted=true AND provider_message_id IS NOT NULL
       AND dispatched_at > v_evt.approved_at;
    IF v_obs_ok < 1 THEN
      RAISE EXCEPTION 'confirmed_manual_observation_required' USING ERRCODE='22023',
        DETAIL=format('event=%s/%s', v_evt.module_code, v_evt.event_code);
    END IF;

    SELECT count(DISTINCT check_code) INTO v_ready_ok
     FROM public.comm_hub_automation_readiness_results
    WHERE module_code=v_evt.module_code AND event_code=v_evt.event_code AND channel=v_evt.channel
      AND configuration_version = v_row.configuration_version
      AND result=true AND expires_at > now()
      AND checked_at > v_evt.approved_at;
    IF v_ready_ok < 9 THEN
      RAISE EXCEPTION 'automation_readiness_incomplete' USING ERRCODE='22023',
        DETAIL=format('event=%s/%s distinct_ok=%s', v_evt.module_code, v_evt.event_code, v_ready_ok);
    END IF;
  END LOOP;

  v_new_ver := v_row.configuration_version + 1;

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
         configuration_version=v_new_ver,
         updated_at=v_now,
         updated_by=v_uid
   WHERE singleton_guard='primary';

  v_snapshot := jsonb_build_object(
    'eligible_events', v_eligible_cnt,
    'previous_configuration_version', v_row.configuration_version,
    'new_configuration_version', v_new_ver,
    'reason', p_reason);
  INSERT INTO public.communication_hub_arm_audit(action,actor,reason,configuration_version,
    automation_state_before,automation_state_after,eligible_event_count,snapshot)
  VALUES ('ARMED',v_uid,p_reason,v_new_ver,'STANDBY','ARMED',v_eligible_cnt,v_snapshot);

  RETURN jsonb_build_object('ok',true,'automation_state','ARMED','configuration_version',v_new_ver);
END $$;
REVOKE ALL ON FUNCTION public.arm_comm_hub_automation(text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arm_comm_hub_automation(text,text,bigint) TO authenticated, service_role;

-- Disarm: keep behaviour; add audit row.
CREATE OR REPLACE FUNCTION public.disarm_comm_hub_automation(
  p_reason text, p_suspend boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_row public.communication_hub_control_settings%ROWTYPE;
  v_now timestamptz := now();
  v_new_ver bigint;
  v_target text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  BEGIN v_is_admin := public.is_comm_hub_operator_admin(v_uid);
  EXCEPTION WHEN undefined_function THEN
    SELECT public.has_role(v_uid,'Admin'::public.app_role) INTO v_is_admin; END;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF coalesce(p_reason,'')='' THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_row FROM public.communication_hub_control_settings
    WHERE singleton_guard='primary' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002'; END IF;

  v_target := CASE WHEN p_suspend THEN 'SUSPENDED' ELSE 'STANDBY' END;
  v_new_ver := v_row.configuration_version + 1;

  PERFORM set_config('comm_hub.automation_op','on',true);
  UPDATE public.communication_hub_control_settings
     SET automation_state=v_target,
         automation_state_changed_at=v_now,
         automation_state_changed_by=v_uid,
         automation_armed_at=NULL, automation_armed_by=NULL, automation_arm_reason=NULL,
         automation_suspended_at=CASE WHEN v_target='SUSPENDED' THEN v_now ELSE NULL END,
         automation_suspension_reason=CASE WHEN v_target='SUSPENDED' THEN p_reason ELSE NULL END,
         scheduler_enabled=false, automatic_triggers_enabled=false, retry_worker_enabled=false,
         batch_enabled=false, bulk_enabled=false,
         configuration_version=v_new_ver, updated_at=v_now, updated_by=v_uid
   WHERE singleton_guard='primary';

  INSERT INTO public.communication_hub_arm_audit(action,actor,reason,configuration_version,
    automation_state_before,automation_state_after,snapshot)
  VALUES (CASE WHEN p_suspend THEN 'SUSPENDED' ELSE 'DISARMED' END,
          v_uid, p_reason, v_new_ver, v_row.automation_state, v_target,
          jsonb_build_object('reason',p_reason));

  RETURN jsonb_build_object('ok',true,'automation_state',v_target,'configuration_version',v_new_ver);
END $$;
REVOKE ALL ON FUNCTION public.disarm_comm_hub_automation(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disarm_comm_hub_automation(text,boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8) Stage 9 — extend get_comm_hub_event_go_live_status with authoritative
--    live_status derived from armed state, heartbeat freshness and drift.
--    We add a wrapper that calls the existing aggregator and layers stage9.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_comm_hub_event_go_live_stage9(
  p_module_code text, p_event_code text, p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_settings record;
  v_ec record;
  v_channel text := coalesce(p_channel,'email');
  v_hb_fresh boolean := false;
  v_hb_age_sec int;
  v_obs record;
  v_ready_ok int;
  v_status text;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  IF v_settings.operating_mode = 'EMERGENCY_STOP'::public.communication_operating_mode THEN
    v_status := 'EMERGENCY_STOP';
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EMERGENCY_STOP'));
    RETURN jsonb_build_object('live_status',v_status,'blockers',v_blockers,
      'heartbeat_fresh',false,
      'last_scheduler_heartbeat_at',v_settings.last_scheduler_heartbeat_at,
      'automation_state',v_settings.automation_state,
      'operating_mode',v_settings.operating_mode);
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  IF v_ec.drift_detected_at IS NOT NULL THEN
    v_status := 'DRIFT_DETECTED';
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','DRIFT_DETECTED'));
  END IF;

  v_hb_age_sec := CASE WHEN v_settings.last_scheduler_heartbeat_at IS NULL THEN NULL
                       ELSE EXTRACT(EPOCH FROM (now() - v_settings.last_scheduler_heartbeat_at))::int END;
  v_hb_fresh := v_hb_age_sec IS NOT NULL AND v_hb_age_sec <= 120;

  IF v_ec.id IS NULL OR v_ec.status <> 'live_cron_allowed' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','EVENT_NOT_LIVE_CRON_ALLOWED'));
  END IF;
  IF v_settings.operating_mode <> 'AUTOMATED_PRODUCTION'::public.communication_operating_mode THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MODE_NOT_AUTOMATED_PRODUCTION'));
  END IF;
  IF v_settings.automation_state <> 'ARMED' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','AUTOMATION_NOT_ARMED'));
  END IF;
  IF NOT coalesce(v_settings.scheduler_enabled,false)
     OR NOT coalesce(v_settings.automatic_triggers_enabled,false)
     OR NOT coalesce(v_settings.retry_worker_enabled,false) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','AUTOMATION_CONTROLS_OFF'));
  END IF;
  IF NOT v_hb_fresh THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','SCHEDULER_HEARTBEAT_STALE','detail',v_hb_age_sec));
  END IF;

  IF v_ec.id IS NOT NULL THEN
    SELECT * INTO v_obs FROM public.communication_manual_production_observation
     WHERE event_certification_id = v_ec.id
       AND status='CONFIRMED' AND inbox_confirmation_status='CONFIRMED'
     ORDER BY dispatched_at DESC LIMIT 1;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MANUAL_OBSERVATION_MISSING'));
    END IF;

    SELECT count(DISTINCT check_code) INTO v_ready_ok
     FROM public.comm_hub_automation_readiness_results
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel
      AND configuration_version = v_settings.configuration_version
      AND result=true AND expires_at > now();
    IF v_ready_ok < 9 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','READINESS_INCOMPLETE_OR_STALE'));
    END IF;
  END IF;

  IF v_status IS NULL THEN
    IF jsonb_array_length(v_blockers) = 0 THEN
      v_status := 'LIVE_AUTOMATED_ARMED';
    ELSIF v_settings.operating_mode = 'AUTOMATED_PRODUCTION'::public.communication_operating_mode
       AND v_settings.automation_state = 'STANDBY' THEN
      v_status := 'LIVE_AUTOMATED_STANDBY';
    ELSE
      v_status := 'INCOMPLETE';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'live_status', v_status,
    'blockers', v_blockers,
    'heartbeat_fresh', v_hb_fresh,
    'heartbeat_age_seconds', v_hb_age_sec,
    'last_scheduler_heartbeat_at', v_settings.last_scheduler_heartbeat_at,
    'scheduler_worker_version', v_settings.scheduler_worker_version,
    'last_processed_count', v_settings.last_processed_count,
    'last_scheduler_error', v_settings.last_scheduler_error,
    'automation_state', v_settings.automation_state,
    'operating_mode', v_settings.operating_mode,
    'configuration_version', v_settings.configuration_version
  );
END $$;
REVOKE ALL ON FUNCTION public.get_comm_hub_event_go_live_stage9(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_event_go_live_stage9(text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

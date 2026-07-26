
-- Helper (schema-private) for building blocker arrays inline
CREATE OR REPLACE FUNCTION public._comm_hub_append_blocker(p_arr jsonb, p_code text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_arr, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('code', p_code))
$$;
REVOKE ALL ON FUNCTION public._comm_hub_append_blocker(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._comm_hub_append_blocker(jsonb, text) TO authenticated, service_role;

-- =========================================================================
-- SLICE A — Manual Production finalize + evidence contract
-- =========================================================================

CREATE OR REPLACE VIEW public.v_comm_hub_manual_production_evidence AS
SELECT
  o.id                              AS observation_id,
  o.request_id                      AS request_id,
  o.message_id                      AS message_id,
  o.delivery_attempt_id             AS delivery_attempt_id,
  o.trace_id                        AS trace_id,
  o.provider_id                     AS provider_id,
  o.provider_message_id             AS provider_message_id,
  m.status                          AS message_status,
  a.status                          AS attempt_status,
  a.send_context                    AS send_context,
  m.test_mode                       AS test_mode,
  o.recipient_email                 AS recipient_email,
  o.inbox_confirmation_status       AS inbox_confirmation_status,
  o.dispatched_at                   AS dispatched_at,
  o.event_certification_id          AS event_certification_id,
  ec.approved_at                    AS manual_prod_approved_at,
  ec.status                         AS event_status,
  p.email_provider_type             AS provider_mode,
  p.provider_name                   AS provider_display_name,
  o.status                          AS observation_status,
  o.module_code                     AS module_code,
  o.event_code                      AS event_code,
  o.channel                         AS channel,
  o.configuration_version           AS configuration_version
FROM public.communication_manual_production_observation o
LEFT JOIN public.communication_message           m  ON m.id  = o.message_id
LEFT JOIN public.communication_delivery_attempt  a  ON a.id  = o.delivery_attempt_id
LEFT JOIN public.notification_providers          p  ON p.id  = o.provider_id
LEFT JOIN public.communication_hub_event_certification ec ON ec.id = o.event_certification_id;

GRANT SELECT ON public.v_comm_hub_manual_production_evidence TO authenticated;
GRANT SELECT ON public.v_comm_hub_manual_production_evidence TO service_role;

CREATE OR REPLACE FUNCTION public.get_comm_hub_manual_production_evidence(p_observation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.v_comm_hub_manual_production_evidence%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
  END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_comm_hub_admin');
  END IF;
  SELECT * INTO v_row FROM public.v_comm_hub_manual_production_evidence
    WHERE observation_id = p_observation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'observation_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'evidence', to_jsonb(v_row));
END $$;

REVOKE ALL ON FUNCTION public.get_comm_hub_manual_production_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_manual_production_evidence(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_comm_hub_manual_production_observation(
  p_observation_id uuid,
  p_decision text,
  p_note text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_obs       record;
  v_msg       record;
  v_att       record;
  v_provider  record;
  v_ec        record;
  v_trace_ok  boolean := false;
  v_blockers  jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'authentication_required'));
  END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'not_comm_hub_admin'));
  END IF;
  IF p_decision NOT IN ('CONFIRMED','NOT_RECEIVED') THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'invalid_decision'));
  END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
    WHERE id = p_observation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'observation_not_found'));
  END IF;

  IF v_obs.inbox_confirmation_status = p_decision THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'observation_id', v_obs.id,
      'inbox_confirmation_status', v_obs.inbox_confirmation_status,
      'status', v_obs.status);
  END IF;

  IF v_obs.inbox_confirmation_status IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'inbox_already_decided'));
  END IF;

  IF p_decision = 'NOT_RECEIVED' THEN
    UPDATE public.communication_manual_production_observation
       SET inbox_confirmation_status = 'NOT_RECEIVED',
           inbox_confirmed_at = now(), inbox_confirmed_by = v_uid,
           inbox_confirmation_note = p_note, status = 'FAILED', updated_at = now()
     WHERE id = p_observation_id;
    RETURN jsonb_build_object('ok', true, 'observation_id', p_observation_id,
      'inbox_confirmation_status', 'NOT_RECEIVED', 'status', 'FAILED');
  END IF;

  IF v_obs.send_context IS DISTINCT FROM 'manual_production' THEN
    v_blockers := public._comm_hub_append_blocker(v_blockers, 'send_context_not_manual_production');
  END IF;
  IF NOT COALESCE(v_obs.provider_call_attempted, false) THEN
    v_blockers := public._comm_hub_append_blocker(v_blockers, 'provider_call_not_attempted');
  END IF;
  IF v_obs.provider_message_id IS NULL OR length(v_obs.provider_message_id) = 0 THEN
    v_blockers := public._comm_hub_append_blocker(v_blockers, 'provider_message_id_missing');
  END IF;
  IF v_obs.delivery_attempt_id IS NULL THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'delivery_attempt_missing'); END IF;
  IF v_obs.trace_id            IS NULL THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'trace_missing'); END IF;
  IF v_obs.message_id          IS NULL THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'message_missing'); END IF;

  IF v_obs.message_id IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.communication_message WHERE id = v_obs.message_id;
    IF NOT FOUND THEN
      v_blockers := public._comm_hub_append_blocker(v_blockers,'message_row_missing');
    ELSE
      IF v_msg.status NOT IN ('sent','delivered') THEN
        v_blockers := public._comm_hub_append_blocker(v_blockers,'message_not_sent_or_delivered');
      END IF;
      IF COALESCE(v_msg.test_mode, false) THEN
        v_blockers := public._comm_hub_append_blocker(v_blockers,'message_test_mode_true');
      END IF;
    END IF;
  END IF;

  IF v_obs.delivery_attempt_id IS NOT NULL THEN
    SELECT * INTO v_att FROM public.communication_delivery_attempt WHERE id = v_obs.delivery_attempt_id;
    IF NOT FOUND THEN
      v_blockers := public._comm_hub_append_blocker(v_blockers,'attempt_row_missing');
    ELSE
      IF v_att.status NOT IN ('success','delivered','sent') THEN
        v_blockers := public._comm_hub_append_blocker(v_blockers,'attempt_not_successful');
      END IF;
      IF v_att.send_context IS DISTINCT FROM 'manual_production' THEN
        v_blockers := public._comm_hub_append_blocker(v_blockers,'attempt_send_context_not_manual_production');
      END IF;
      IF v_att.provider_id IS NOT NULL THEN
        SELECT * INTO v_provider FROM public.notification_providers WHERE id = v_att.provider_id;
        IF FOUND AND lower(coalesce(v_provider.email_provider_type,'')) IN ('stub','dry_run','dryrun','test') THEN
          v_blockers := public._comm_hub_append_blocker(v_blockers,'provider_is_stub_or_dry_run');
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_obs.trace_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.communication_hub_trace WHERE id = v_obs.trace_id) INTO v_trace_ok;
    IF NOT v_trace_ok THEN
      v_blockers := public._comm_hub_append_blocker(v_blockers,'trace_row_missing');
    END IF;
  END IF;

  IF v_obs.event_certification_id IS NOT NULL THEN
    SELECT * INTO v_ec FROM public.communication_hub_event_certification WHERE id = v_obs.event_certification_id;
    IF NOT FOUND THEN
      v_blockers := public._comm_hub_append_blocker(v_blockers,'event_certification_missing');
    ELSE
      IF v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
        v_blockers := public._comm_hub_append_blocker(v_blockers,'event_not_manually_certified');
      END IF;
      IF v_obs.dispatched_at <= v_ec.approved_at THEN
        v_blockers := public._comm_hub_append_blocker(v_blockers,'observation_predates_manual_approval');
      END IF;
    END IF;
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'blockers', v_blockers);
  END IF;

  UPDATE public.communication_manual_production_observation
     SET inbox_confirmation_status = 'CONFIRMED',
         inbox_confirmed_at = now(), inbox_confirmed_by = v_uid,
         inbox_confirmation_note = p_note, status = 'CONFIRMED', updated_at = now()
   WHERE id = p_observation_id;

  RETURN jsonb_build_object('ok', true, 'observation_id', p_observation_id,
    'inbox_confirmation_status', 'CONFIRMED', 'status', 'CONFIRMED');
END $$;

-- =========================================================================
-- SLICE B — Real scheduler worker
-- =========================================================================

ALTER TABLE public.communication_hub_control_settings
  ADD COLUMN IF NOT EXISTS heartbeat_automation_generation bigint,
  ADD COLUMN IF NOT EXISTS heartbeat_readiness_hash        text;

CREATE TABLE IF NOT EXISTS public.comm_hub_scheduler_tick_leases (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  finished_at             timestamptz,
  arm_audit_id            uuid,
  automation_generation   bigint,
  configuration_version   bigint,
  pinned_readiness_ids    uuid[],
  readiness_hash          text,
  operating_mode          text,
  automation_state        text,
  status                  text NOT NULL DEFAULT 'RUNNING'
                            CHECK (status IN ('RUNNING','COMPLETED','FAILED','ABANDONED')),
  worker_version          text,
  processed_count         integer NOT NULL DEFAULT 0,
  sent_count              integer NOT NULL DEFAULT 0,
  retried_count           integer NOT NULL DEFAULT 0,
  failed_count            integer NOT NULL DEFAULT 0,
  skipped_count           integer NOT NULL DEFAULT 0,
  error                   jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.comm_hub_scheduler_tick_leases TO authenticated;
GRANT ALL    ON public.comm_hub_scheduler_tick_leases TO service_role;
ALTER TABLE public.comm_hub_scheduler_tick_leases ENABLE ROW LEVEL SECURITY;

DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='comm_hub_scheduler_tick_leases' AND policyname='chstl_read_admin') THEN
    CREATE POLICY chstl_read_admin ON public.comm_hub_scheduler_tick_leases
      FOR SELECT TO authenticated USING (public.is_comm_hub_admin(auth.uid()));
  END IF;
END $pol$;

CREATE INDEX IF NOT EXISTS chstl_status_started_idx
  ON public.comm_hub_scheduler_tick_leases (status, started_at DESC);

CREATE OR REPLACE FUNCTION public.is_service_role_caller()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role',
    false
  );
$$;
REVOKE ALL ON FUNCTION public.is_service_role_caller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_service_role_caller() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_comm_hub_scheduler_tick(p_worker_version text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cs        record;
  v_arm       record;
  v_lease_id  uuid;
  v_blockers  jsonb := '[]'::jsonb;
  v_readiness_hash text;
  v_pinned    uuid[];
BEGIN
  IF NOT public.is_service_role_caller() THEN
    RETURN jsonb_build_object('allowed', false,
      'blockers', public._comm_hub_append_blocker('[]'::jsonb,'not_service_role'));
  END IF;

  SELECT * INTO v_cs FROM public.communication_hub_control_settings
    WHERE singleton_guard = 'primary' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false,
      'blockers', public._comm_hub_append_blocker('[]'::jsonb,'control_settings_missing'));
  END IF;

  IF v_cs.operating_mode <> 'AUTOMATED_PRODUCTION' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'not_automated_production'); END IF;
  IF v_cs.automation_state <> 'ARMED' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'not_armed'); END IF;
  IF NOT COALESCE(v_cs.dispatch_enabled, false) THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'dispatch_disabled'); END IF;
  IF NOT COALESCE(v_cs.scheduler_enabled, false) THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'scheduler_disabled'); END IF;
  IF NOT COALESCE(v_cs.automatic_triggers_enabled, false) THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'automatic_triggers_disabled'); END IF;
  IF NOT COALESCE(v_cs.retry_worker_enabled, false) THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'retry_worker_disabled'); END IF;
  IF v_cs.operating_mode = 'EMERGENCY_STOP' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'emergency_stop_engaged'); END IF;
  IF v_cs.current_arm_audit_id IS NULL THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'no_current_arm_audit'); END IF;
  IF v_cs.automation_generation IS NULL OR v_cs.automation_generation = 0 THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'no_automation_generation'); END IF;

  IF v_cs.current_arm_audit_id IS NOT NULL THEN
    SELECT * INTO v_arm FROM public.communication_hub_arm_audit WHERE id = v_cs.current_arm_audit_id;
    IF NOT FOUND OR v_arm.action <> 'ARMED' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'current_arm_audit_invalid'); END IF;
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_blockers);
  END IF;

  v_pinned := COALESCE(v_arm.readiness_result_ids, '{}'::uuid[]);
  v_readiness_hash := md5(coalesce(array_to_string(v_pinned, ','), ''));

  INSERT INTO public.comm_hub_scheduler_tick_leases (
    arm_audit_id, automation_generation, configuration_version,
    pinned_readiness_ids, readiness_hash, operating_mode, automation_state, worker_version
  ) VALUES (
    v_cs.current_arm_audit_id, v_cs.automation_generation, v_cs.configuration_version,
    v_pinned, v_readiness_hash, v_cs.operating_mode, v_cs.automation_state, p_worker_version
  ) RETURNING id INTO v_lease_id;

  RETURN jsonb_build_object(
    'allowed', true, 'blockers', '[]'::jsonb, 'lease_id', v_lease_id,
    'current_arm_audit_id', v_cs.current_arm_audit_id,
    'automation_generation', v_cs.automation_generation,
    'configuration_version', v_cs.configuration_version,
    'pinned_readiness_ids', v_pinned,
    'readiness_hash', v_readiness_hash,
    'operating_mode', v_cs.operating_mode,
    'automation_state', v_cs.automation_state
  );
END $$;

REVOKE ALL ON FUNCTION public.begin_comm_hub_scheduler_tick(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_comm_hub_scheduler_tick(text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_comm_hub_scheduler_tick(
  p_lease_id uuid, p_arm_audit_id uuid, p_automation_generation bigint,
  p_readiness_hash text, p_counts jsonb, p_error jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lease record;
  v_cs    record;
  v_arm   record;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_service_role_caller() THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'not_service_role'));
  END IF;

  SELECT * INTO v_lease FROM public.comm_hub_scheduler_tick_leases WHERE id = p_lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'lease_not_found'));
  END IF;
  IF v_lease.status <> 'RUNNING' THEN
    RETURN jsonb_build_object('ok', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'lease_not_running'));
  END IF;

  SELECT * INTO v_cs FROM public.communication_hub_control_settings
    WHERE singleton_guard = 'primary' FOR UPDATE;

  IF v_cs.operating_mode <> 'AUTOMATED_PRODUCTION' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'not_automated_production'); END IF;
  IF v_cs.automation_state <> 'ARMED' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'not_armed'); END IF;
  IF v_cs.current_arm_audit_id IS DISTINCT FROM p_arm_audit_id THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'arm_audit_mismatch'); END IF;
  IF v_cs.current_arm_audit_id IS DISTINCT FROM v_lease.arm_audit_id THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'lease_arm_audit_mismatch'); END IF;
  IF v_cs.automation_generation IS DISTINCT FROM p_automation_generation THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'automation_generation_mismatch'); END IF;
  IF v_cs.automation_generation IS DISTINCT FROM v_lease.automation_generation THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'lease_generation_mismatch'); END IF;

  SELECT * INTO v_arm FROM public.communication_hub_arm_audit WHERE id = p_arm_audit_id;
  IF NOT FOUND OR v_arm.action <> 'ARMED' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'arm_audit_not_armed'); END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    UPDATE public.comm_hub_scheduler_tick_leases
       SET status = 'ABANDONED', finished_at = now(), error = COALESCE(p_error, error)
     WHERE id = p_lease_id;
    RETURN jsonb_build_object('ok', false, 'blockers', v_blockers);
  END IF;

  UPDATE public.comm_hub_scheduler_tick_leases
     SET status          = CASE WHEN p_error IS NULL THEN 'COMPLETED' ELSE 'FAILED' END,
         finished_at     = now(),
         processed_count = COALESCE((p_counts->>'processed')::int, 0),
         sent_count      = COALESCE((p_counts->>'sent')::int, 0),
         retried_count   = COALESCE((p_counts->>'retried')::int, 0),
         failed_count    = COALESCE((p_counts->>'failed')::int, 0),
         skipped_count   = COALESCE((p_counts->>'skipped')::int, 0),
         error           = p_error
   WHERE id = p_lease_id;

  IF p_error IS NULL THEN
    UPDATE public.communication_hub_control_settings
       SET last_scheduler_heartbeat_at     = now(),
           scheduler_worker_version        = COALESCE(v_lease.worker_version, scheduler_worker_version),
           last_processed_count            = COALESCE((p_counts->>'processed')::bigint, 0),
           last_scheduler_error            = NULL,
           heartbeat_arm_audit_id          = p_arm_audit_id,
           heartbeat_automation_generation = p_automation_generation,
           heartbeat_readiness_hash        = p_readiness_hash
     WHERE singleton_guard = 'primary';
  ELSE
    UPDATE public.communication_hub_control_settings
       SET last_scheduler_error = p_error::text
     WHERE singleton_guard = 'primary';
  END IF;

  RETURN jsonb_build_object('ok', true, 'lease_id', p_lease_id,
    'heartbeat_recorded', (p_error IS NULL));
END $$;

REVOKE ALL ON FUNCTION public.complete_comm_hub_scheduler_tick(uuid,uuid,bigint,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_comm_hub_scheduler_tick(uuid,uuid,bigint,text,jsonb,jsonb) TO service_role;

-- =========================================================================
-- SLICE C — Bind generic queue dispatcher to Arm context
-- =========================================================================

CREATE OR REPLACE FUNCTION public.assert_comm_hub_queue_run_context(
  p_lease_id uuid, p_module_code text, p_event_code text, p_channel text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lease record;
  v_cs    record;
  v_ec    record;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_service_role_caller() THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', public._comm_hub_append_blocker('[]'::jsonb,'not_service_role'));
  END IF;

  SELECT * INTO v_lease FROM public.comm_hub_scheduler_tick_leases WHERE id = p_lease_id;
  IF NOT FOUND THEN
    v_blockers := public._comm_hub_append_blocker(v_blockers,'lease_not_found');
  ELSIF v_lease.status <> 'RUNNING' THEN
    v_blockers := public._comm_hub_append_blocker(v_blockers,'lease_not_running');
  END IF;

  SELECT * INTO v_cs FROM public.communication_hub_control_settings WHERE singleton_guard = 'primary';
  IF NOT FOUND THEN
    v_blockers := public._comm_hub_append_blocker(v_blockers,'control_settings_missing');
  ELSE
    IF v_cs.operating_mode <> 'AUTOMATED_PRODUCTION' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'not_automated_production'); END IF;
    IF v_cs.automation_state <> 'ARMED' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'not_armed'); END IF;
    IF NOT COALESCE(v_cs.scheduler_enabled, false) THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'scheduler_disabled'); END IF;
    IF NOT COALESCE(v_cs.dispatch_enabled, false) THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'dispatch_disabled'); END IF;
    IF v_cs.operating_mode = 'EMERGENCY_STOP' THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'emergency_stop_engaged'); END IF;
    IF v_lease.id IS NOT NULL THEN
      IF v_lease.arm_audit_id IS DISTINCT FROM v_cs.current_arm_audit_id THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'lease_arm_audit_stale'); END IF;
      IF v_lease.automation_generation IS DISTINCT FROM v_cs.automation_generation THEN v_blockers := public._comm_hub_append_blocker(v_blockers,'lease_generation_stale'); END IF;
    END IF;
  END IF;

  IF p_module_code IS NOT NULL AND p_event_code IS NOT NULL THEN
    SELECT * INTO v_ec FROM public.communication_hub_event_certification
      WHERE module_code = p_module_code AND event_code = p_event_code
        AND channel = COALESCE(p_channel, 'email');
    IF NOT FOUND THEN
      v_blockers := public._comm_hub_append_blocker(v_blockers,'event_certification_missing');
    ELSIF v_ec.status <> 'live_cron_allowed' THEN
      v_blockers := public._comm_hub_append_blocker(v_blockers,'event_not_live_cron_allowed');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'lease_id', p_lease_id
  );
END $$;

REVOKE ALL ON FUNCTION public.assert_comm_hub_queue_run_context(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_comm_hub_queue_run_context(uuid,text,text,text) TO service_role;

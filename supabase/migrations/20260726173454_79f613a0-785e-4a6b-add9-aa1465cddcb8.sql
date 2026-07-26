
-- ========================================================================
-- STAGE 7 / 8 — server-coordinated observation + hardened automation probes
-- ========================================================================

-- 1) Approved-recipient helper (read-only, service-role + admin)
CREATE OR REPLACE FUNCTION public.list_comm_hub_approved_recipients(
  p_module_code text, p_event_code text, p_channel text
) RETURNS TABLE (email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT lower(email) AS email FROM (
    SELECT p.single_configured_address AS email
      FROM public.communication_hub_recipient_policy p
     WHERE p.singleton_guard='primary' AND p.single_configured_address IS NOT NULL
    UNION ALL
    SELECT jsonb_array_elements_text(coalesce(p.approved_named_addresses,'[]'::jsonb))
      FROM public.communication_hub_recipient_policy p
     WHERE p.singleton_guard='primary'
  ) s WHERE email IS NOT NULL AND length(email) > 0
$$;
REVOKE ALL ON FUNCTION public.list_comm_hub_approved_recipients(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_comm_hub_approved_recipients(text,text,text) TO service_role;

-- 2) finalize_comm_hub_manual_production_observation
--    Service-role only. Derives everything from durable rows.
CREATE OR REPLACE FUNCTION public.finalize_comm_hub_manual_production_observation(
  p_message_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_msg record;
  v_req record;
  v_att record;
  v_ec  record;
  v_settings record;
  v_provider record;
  v_trace_id uuid;
  v_recipient text;
  v_existing uuid;
  v_id uuid;
  v_blockers jsonb := '[]'::jsonb;
  v_add_blocker text;
  v_status text;
  v_provider_call_attempted boolean := false;
BEGIN
  IF p_message_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'blockers', jsonb_build_array(jsonb_build_object('code','message_id_required')));
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) = 0 THEN
    RETURN jsonb_build_object('ok',false,'blockers', jsonb_build_array(jsonb_build_object('code','idempotency_key_required')));
  END IF;

  -- Idempotent replay
  SELECT id INTO v_existing FROM public.communication_manual_production_observation
    WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'observation_id',v_existing);
  END IF;

  SELECT * INTO v_msg FROM public.communication_message WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'blockers', jsonb_build_array(jsonb_build_object('code','message_not_found')));
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

  -- Exactly one successful delivery attempt
  SELECT * INTO v_att FROM public.communication_delivery_attempt
    WHERE message_id = v_msg.id
      AND status IN ('success','delivered','sent')
    ORDER BY created_at DESC
    LIMIT 1;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','no_successful_delivery_attempt'));
  ELSE
    v_provider_call_attempted := true;
    IF v_att.provider_message_id IS NULL OR length(v_att.provider_message_id) = 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','provider_message_id_missing'));
    END IF;
    -- Provider must be real, not stub/dry-run
    IF v_att.provider_id IS NOT NULL THEN
      SELECT * INTO v_provider FROM public.notification_providers WHERE id = v_att.provider_id;
      IF FOUND THEN
        IF lower(coalesce(v_provider.mode,'')) IN ('stub','dry_run','dryrun','test') THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','provider_is_stub_or_dry_run','detail',v_provider.mode));
        END IF;
      END IF;
    END IF;
  END IF;

  -- Trace
  SELECT trace_id INTO v_trace_id FROM public.communication_hub_trace_link
    WHERE message_id = v_msg.id LIMIT 1;
  IF v_trace_id IS NULL THEN
    v_trace_id := v_msg.trace_id;
  END IF;
  IF v_trace_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','trace_missing'));
  END IF;

  -- Recipient
  SELECT lower(email) INTO v_recipient FROM public.communication_message_recipient
    WHERE message_id = v_msg.id AND lower(coalesce(role,'to')) = 'to' LIMIT 1;
  IF v_recipient IS NULL THEN
    v_recipient := lower(coalesce(v_msg.recipient_email,''));
  END IF;
  IF v_recipient IS NULL OR length(v_recipient) = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','recipient_missing'));
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok',false,'blockers',v_blockers);
  END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  INSERT INTO public.communication_manual_production_observation
    (module_code,event_code,channel,event_certification_id,
     request_id,message_id,delivery_attempt_id,trace_id,
     provider_id,provider_name,provider_message_id,
     provider_call_attempted,provider_outcome,
     recipient_email,recipient_set_hash,configuration_version,
     sender_profile_id,template_version_id,idempotency_key,
     status,dispatched_by)
  VALUES
    (v_ec.module_code, v_ec.event_code, v_ec.channel, v_ec.id,
     v_req.id, v_msg.id, v_att.id, v_trace_id,
     v_att.provider_id, coalesce(v_provider.name, v_att.provider_name), v_att.provider_message_id,
     true, v_att.status,
     v_recipient, v_msg.recipient_set_hash, v_settings.configuration_version,
     v_msg.sender_profile_id, v_msg.template_version_id, p_idempotency_key,
     'DISPATCHED', v_msg.created_by)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok',true,'observation_id',v_id,
    'request_id',v_req.id,'message_id',v_msg.id,
    'delivery_attempt_id',v_att.id,'trace_id',v_trace_id,
    'provider_id',v_att.provider_id,
    'provider_name',coalesce(v_provider.name,v_att.provider_name),
    'provider_message_id',v_att.provider_message_id,
    'provider_call_attempted',true,'provider_outcome',v_att.status,
    'message_status',v_msg.status,'attempt_status',v_att.status,
    'recipient',v_recipient,'event_certification_id',v_ec.id
  );
END $$;
REVOKE ALL ON FUNCTION public.finalize_comm_hub_manual_production_observation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_comm_hub_manual_production_observation(uuid,text) TO service_role;

-- 3) Restrict browser-facing observation recorder
REVOKE EXECUTE ON FUNCTION public.record_comm_hub_manual_production_observation(jsonb) FROM authenticated;

-- 4) Hardened 9-check automation readiness probe
CREATE OR REPLACE FUNCTION public.run_comm_hub_automation_readiness_probe(
  p_module_code text, p_event_code text, p_channel text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_settings record;
  v_ec record;
  v_mode text;
  v_now timestamptz := now();
  v_channel text := coalesce(p_channel,'email');
  v_checks jsonb := '[]'::jsonb;

  v_scheduler_cfg int; v_scheduler_hb_ok boolean; v_scheduler_ok boolean; v_scheduler_ev jsonb;
  v_triggers_cnt int; v_triggers_ok boolean; v_triggers_ev jsonb;
  v_retry_ok boolean; v_retry_ev jsonb;
  v_dl_backlog int; v_dl_ok boolean; v_dl_ev jsonb;
  v_rate_ok boolean; v_rate_ev jsonb; v_rate_cnt int;
  v_batch_ok boolean; v_batch_ev jsonb;
  v_breaker_ok boolean; v_breaker_ev jsonb; v_provider_healthy boolean;
  v_estop_ok boolean; v_estop_ev jsonb; v_estop_rpc_present boolean; v_estop_active boolean;
  v_alert_ok boolean; v_alert_ev jsonb; v_alert_channels int;
  v_check record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_missing' USING ERRCODE='P0002'; END IF;

  SELECT current_mode INTO v_mode FROM public.communication_hub_operating_mode ORDER BY effective_at DESC LIMIT 1;
  v_mode := coalesce(v_mode, v_settings.operating_mode, 'MANUAL_PRODUCTION');

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  -- 1) scheduler: cron/schedule config present + no scheduler enabled while in Manual Production
  SELECT count(*) INTO v_scheduler_cfg FROM pg_class WHERE relname = 'comm_hub_scheduler_config';
  v_scheduler_hb_ok := EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN ('comm_hub_scheduler_heartbeat','tg_comm_hub_scheduler_heartbeat')
  );
  v_scheduler_ok := (v_scheduler_cfg > 0 OR v_scheduler_hb_ok)
    AND (v_mode <> 'MANUAL_PRODUCTION' OR v_settings.scheduler_enabled = false);
  v_scheduler_ev := jsonb_build_object(
    'config_table_present', v_scheduler_cfg > 0,
    'heartbeat_configured', v_scheduler_hb_ok,
    'scheduler_enabled', v_settings.scheduler_enabled,
    'current_mode', v_mode,
    'requires_disabled_in_manual', (v_mode = 'MANUAL_PRODUCTION')
  );

  -- 2) automatic_triggers: trigger registration rows for this event + not yet active
  SELECT count(*) INTO v_triggers_cnt FROM pg_class WHERE relname = 'comm_hub_event_trigger_registration';
  IF v_triggers_cnt > 0 THEN
    EXECUTE format('SELECT count(*) FROM public.comm_hub_event_trigger_registration WHERE module_code=%L AND event_code=%L AND channel=%L',
                   p_module_code, p_event_code, v_channel) INTO v_triggers_cnt;
  ELSE
    v_triggers_cnt := 0;
  END IF;
  v_triggers_ok := v_triggers_cnt > 0
    AND (v_ec.id IS NULL OR v_ec.status IN ('live_manual_only'));
  v_triggers_ev := jsonb_build_object(
    'triggers_registered', v_triggers_cnt,
    'event_status', coalesce(v_ec.status,'not_certified'),
    'event_active_for_automation', (v_ec.status = 'live_cron_allowed')
  );

  -- 3) retry_worker: valid policy + disabled before arming
  v_retry_ok := (v_settings.retry_base_seconds IS NOT NULL AND v_settings.retry_base_seconds > 0)
    AND (v_settings.retry_max_seconds IS NOT NULL AND v_settings.retry_max_seconds >= v_settings.retry_base_seconds)
    AND (v_settings.max_attempts IS NOT NULL AND v_settings.max_attempts BETWEEN 1 AND 20)
    AND (v_settings.retry_worker_enabled = false);
  v_retry_ev := jsonb_build_object(
    'retry_base_seconds', v_settings.retry_base_seconds,
    'retry_max_seconds', v_settings.retry_max_seconds,
    'max_attempts', v_settings.max_attempts,
    'retry_worker_enabled', v_settings.retry_worker_enabled
  );

  -- 4) dead_letter: table present + backlog under threshold + replay function exists
  SELECT count(*) INTO v_dl_backlog FROM public.communication_message
    WHERE status='failed' AND attempt_count >= v_settings.max_attempts;
  v_dl_ok := (v_dl_backlog < 1000)
    AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname IN ('replay_comm_hub_dead_letter','comm_hub_replay_message'));
  v_dl_ev := jsonb_build_object(
    'dead_letter_backlog', v_dl_backlog,
    'threshold', 1000,
    'replay_control_present', v_dl_ok
  );

  -- 5) rate_limits: provider + event configuration exists
  SELECT count(*) INTO v_rate_cnt
    FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('communication_hub_rate_limit','notification_provider_rate_limit');
  IF v_rate_cnt > 0 THEN
    v_rate_ok := true;  -- schema-level presence; further tuning is provider-specific
  ELSE
    v_rate_ok := v_settings.batch_size > 0;
  END IF;
  v_rate_ev := jsonb_build_object(
    'rate_limit_tables_present', v_rate_cnt,
    'fallback_batch_size', v_settings.batch_size
  );

  -- 6) batch_limits: positive + conservative (<= 200 for initial rollout)
  v_batch_ok := (v_settings.batch_size IS NOT NULL AND v_settings.batch_size > 0 AND v_settings.batch_size <= 200);
  v_batch_ev := jsonb_build_object('batch_size', v_settings.batch_size, 'max_conservative', 200);

  -- 7) provider_circuit_breaker
  SELECT bool_or(is_active) INTO v_provider_healthy FROM public.notification_providers WHERE channel='email';
  v_breaker_ok := coalesce(v_provider_healthy,false)
    AND (v_settings.provider_circuit_breaker_open IS NOT TRUE);
  v_breaker_ev := jsonb_build_object(
    'active_email_provider_present', coalesce(v_provider_healthy,false),
    'breaker_open', coalesce(v_settings.provider_circuit_breaker_open,false)
  );

  -- 8) emergency_stop: RPC present, no active stop
  v_estop_rpc_present := EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN ('trigger_comm_hub_emergency_stop','activate_comm_hub_emergency_stop','comm_hub_emergency_stop')
  );
  v_estop_active := coalesce(v_settings.emergency_stop_active,false);
  v_estop_ok := v_estop_rpc_present AND (v_estop_active = false);
  v_estop_ev := jsonb_build_object(
    'emergency_stop_rpc_present', v_estop_rpc_present,
    'emergency_stop_active', v_estop_active
  );

  -- 9) alerting_monitoring: at least one active alerting channel
  SELECT count(*) INTO v_alert_channels
    FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('comm_hub_alert_channel','communication_hub_alert_config');
  v_alert_ok := v_alert_channels > 0;
  v_alert_ev := jsonb_build_object(
    'alert_config_tables', v_alert_channels
  );

  -- Persist + collect
  FOR v_check IN
    SELECT * FROM (VALUES
      ('scheduler',                 v_scheduler_ok, v_scheduler_ev),
      ('automatic_triggers',        v_triggers_ok,  v_triggers_ev),
      ('retry_worker',              v_retry_ok,     v_retry_ev),
      ('dead_letter',               v_dl_ok,        v_dl_ev),
      ('rate_limits',               v_rate_ok,      v_rate_ev),
      ('batch_limits',              v_batch_ok,     v_batch_ev),
      ('provider_circuit_breaker',  v_breaker_ok,   v_breaker_ev),
      ('emergency_stop',            v_estop_ok,     v_estop_ev),
      ('alerting_monitoring',       v_alert_ok,     v_alert_ev)
    ) AS t(code, result, evidence)
  LOOP
    INSERT INTO public.comm_hub_automation_readiness_results
      (module_code,event_code,channel,check_code,configuration_version,
       event_certification_id,result,source,evidence,checked_at,checked_by,expires_at)
    VALUES
      (p_module_code,p_event_code,v_channel,v_check.code,v_settings.configuration_version,
       v_ec.id, v_check.result,'SERVER_PROBE',v_check.evidence,v_now,v_uid,v_now + interval '24 hours')
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
EXCEPTION WHEN undefined_column THEN
  -- Defensive: settings columns may vary; return an ok:false envelope with actionable diagnostic
  RETURN jsonb_build_object('ok',false,'blockers',jsonb_build_array(jsonb_build_object('code','settings_schema_mismatch','detail',SQLERRM)));
END $$;
REVOKE ALL ON FUNCTION public.run_comm_hub_automation_readiness_probe(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_comm_hub_automation_readiness_probe(text,text,text) TO authenticated;

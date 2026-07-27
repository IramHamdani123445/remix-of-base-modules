CREATE OR REPLACE FUNCTION public.run_comm_hub_automation_readiness_probe(p_module_code text, p_event_code text, p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Canonical current operating mode is the singleton control-settings row.
  -- The stale relation `communication_hub_operating_mode` (non-audit) has never
  -- existed in this deployment; do not query it. The audit table
  -- `communication_hub_operating_mode_audit` is historical evidence only and
  -- must not be used as current state.
  v_mode := coalesce(v_settings.operating_mode, 'MANUAL_PRODUCTION');

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  -- 1) scheduler
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

  -- 2) automatic_triggers
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

  -- 3) retry_worker
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

  -- 4) dead_letter
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

  -- 5) rate_limits
  SELECT count(*) INTO v_rate_cnt
    FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('communication_hub_rate_limit','notification_provider_rate_limit');
  IF v_rate_cnt > 0 THEN
    v_rate_ok := true;
  ELSE
    v_rate_ok := v_settings.batch_size > 0;
  END IF;
  v_rate_ev := jsonb_build_object(
    'rate_limit_tables_present', v_rate_cnt,
    'fallback_batch_size', v_settings.batch_size
  );

  -- 6) batch_limits
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

  -- 8) emergency_stop
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

  -- 9) alerting_monitoring
  SELECT count(*) INTO v_alert_channels
    FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('comm_hub_alert_channel','communication_hub_alert_config');
  v_alert_ok := v_alert_channels > 0;
  v_alert_ev := jsonb_build_object('alert_config_tables', v_alert_channels);

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

EXCEPTION
  WHEN undefined_table OR undefined_column OR undefined_function OR undefined_object OR invalid_schema_name THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blocker', jsonb_build_object(
        'code', 'READINESS_SCHEMA_MISMATCH',
        'object_name', COALESCE(NULLIF(regexp_replace(SQLERRM, '^.*"([^"]+)".*$', '\1'), SQLERRM), ''),
        'detail', SQLERRM,
        'sqlstate', SQLSTATE,
        'fix_action', 'Redeploy run_comm_hub_automation_readiness_probe against the current schema; do not create compatibility shims for missing relations.'
      ),
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','READINESS_SCHEMA_MISMATCH','detail',SQLERRM,'sqlstate',SQLSTATE))
    );
END $function$;
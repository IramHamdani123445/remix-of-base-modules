
CREATE OR REPLACE FUNCTION public._pre_arm_check_json(
  p_check_code text, p_result boolean, p_status text, p_evidence jsonb,
  p_blocker text, p_fix text, p_cfg_version bigint,
  p_event_certification_id uuid, p_production_lineage_id uuid, p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_core jsonb;
BEGIN
  v_core := jsonb_build_object(
    'check_code', p_check_code,
    'result', p_result,
    'status', p_status,
    'evidence', p_evidence,
    'blocker', p_blocker,
    'fix_action', p_fix,
    'configuration_version', p_cfg_version,
    'event_certification_id', p_event_certification_id,
    'production_lineage_id', p_production_lineage_id
  );
  RETURN jsonb_build_array(jsonb_build_object(
    'check_code', p_check_code,
    'result', p_result,
    'status', p_status,
    'evidence', p_evidence,
    'blocker', p_blocker,
    'fix_action', p_fix,
    'checked_at', p_now,
    'expires_at', p_now + interval '24 hours',
    'configuration_version', p_cfg_version,
    'event_certification_id', p_event_certification_id,
    'production_lineage_id', p_production_lineage_id,
    'evidence_fingerprint_v2', public._comm_hub_fingerprint_evidence_core_v2(v_core)
  ));
END $$;

CREATE OR REPLACE FUNCTION public._persist_pre_arm_readiness_row(
  p_module_code text, p_event_code text, p_channel text, p_check_code text,
  p_cfg_version bigint, p_event_certification_id uuid, p_production_lineage_id uuid,
  p_result boolean, p_status text, p_evidence jsonb, p_blocker text, p_fix text,
  p_uid uuid, p_now timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_core jsonb;
  v_fingerprint text;
  v_full jsonb;
BEGIN
  v_core := jsonb_build_object(
    'check_code', p_check_code,
    'result', p_result,
    'status', p_status,
    'evidence', p_evidence,
    'blocker', p_blocker,
    'fix_action', p_fix,
    'configuration_version', p_cfg_version,
    'event_certification_id', p_event_certification_id,
    'production_lineage_id', p_production_lineage_id
  );
  v_fingerprint := public._comm_hub_fingerprint_evidence_core_v2(v_core);
  v_full := p_evidence || jsonb_build_object(
    'status', p_status,
    'blocker', p_blocker,
    'fix_action', p_fix,
    'production_lineage_id', p_production_lineage_id,
    'evidence_fingerprint_v2', v_fingerprint,
    'readiness_phase', 'PRE_ARM_READINESS'
  );

  INSERT INTO public.comm_hub_automation_readiness_results
    (module_code,event_code,channel,check_code,configuration_version,
     event_certification_id,result,source,evidence,checked_at,checked_by,expires_at)
  VALUES
    (p_module_code,p_event_code,p_channel,p_check_code,p_cfg_version,
     p_event_certification_id,p_result,'PRE_ARM_READINESS',v_full,
     p_now,p_uid,p_now + interval '24 hours')
  ON CONFLICT (module_code,event_code,channel,check_code,configuration_version) DO UPDATE
    SET result=EXCLUDED.result,
        source='PRE_ARM_READINESS',
        evidence=EXCLUDED.evidence,
        checked_at=EXCLUDED.checked_at,
        checked_by=EXCLUDED.checked_by,
        expires_at=EXCLUDED.expires_at,
        event_certification_id=EXCLUDED.event_certification_id,
        updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.run_comm_hub_automation_readiness_probe(
  p_module_code text,
  p_event_code text,
  p_channel text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_settings record;
  v_ec record;
  v_mode text;
  v_automation_state text;
  v_safe_mode boolean;
  v_now timestamptz := now();
  v_channel text := coalesce(p_channel,'email');
  v_lineage_id uuid;
  v_cfg_version bigint;

  v_provider record;
  v_scheduler_tick_rpc boolean;
  v_scheduler_leases_present boolean;
  v_estop_mode boolean;

  v_checks jsonb := '[]'::jsonb;

  v_code text; v_result boolean; v_status text; v_evidence jsonb;
  v_blocker text; v_fix text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_missing' USING ERRCODE='P0002'; END IF;

  v_mode := coalesce(v_settings.operating_mode, 'MANUAL_PRODUCTION');
  v_automation_state := coalesce(v_settings.automation_state, 'STANDBY');
  v_cfg_version := coalesce(v_settings.configuration_version, 0);
  v_estop_mode := (v_mode = 'EMERGENCY_STOP');

  IF v_estop_mode THEN
    RAISE EXCEPTION 'READINESS_BLOCKED_EMERGENCY_STOP' USING ERRCODE='P0001';
  END IF;
  IF v_mode = 'AUTOMATED_PRODUCTION' AND v_automation_state <> 'STANDBY' THEN
    RAISE EXCEPTION 'READINESS_BLOCKED_AUTOMATION_ARMED' USING ERRCODE='P0001';
  END IF;

  v_safe_mode := v_mode IN ('DRY_RUN','CONTROLLED_LIVE','MANUAL_PRODUCTION')
                 OR (v_mode = 'AUTOMATED_PRODUCTION' AND v_automation_state = 'STANDBY');

  SELECT id, status, production_lineage_id INTO v_ec
    FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;
  v_lineage_id := v_ec.production_lineage_id;

  SELECT id, provider_name, email_provider_type, is_active, is_default, config
    INTO v_provider
    FROM public.notification_providers
   WHERE channel='email' AND is_default=true AND is_active=true
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  v_scheduler_tick_rpc := EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='begin_comm_hub_scheduler_tick'
  ) AND EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='complete_comm_hub_scheduler_tick'
  );
  v_scheduler_leases_present := EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='comm_hub_scheduler_tick_leases'
  );

  -- 1) scheduler
  v_code := 'scheduler';
  v_evidence := jsonb_build_object(
    'scheduler_tick_rpcs_present', v_scheduler_tick_rpc,
    'scheduler_leases_table_present', v_scheduler_leases_present,
    'scheduler_enabled', v_settings.scheduler_enabled,
    'automation_state', v_automation_state,
    'edge_function', 'comm-hub-automation-tick',
    'edge_action_probe_supported', true,
    'safe_mode', v_safe_mode
  );
  IF NOT v_scheduler_tick_rpc OR NOT v_scheduler_leases_present THEN
    v_result := false; v_status := 'NOT_IMPLEMENTED';
    v_blocker := 'SCHEDULER_NOT_IMPLEMENTED';
    v_fix := 'Deploy scheduler tick RPCs and lease table before Automated Production.';
  ELSIF v_safe_mode AND coalesce(v_settings.scheduler_enabled,false) = true THEN
    v_result := false; v_status := 'DRIFTED';
    v_blocker := 'SCHEDULER_ENABLED_IN_SAFE_MODE';
    v_fix := 'Disable the scheduler while the platform is in a safe mode.';
  ELSE
    v_result := true; v_status := 'PASS'; v_blocker := NULL; v_fix := NULL;
  END IF;
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 2) automatic_triggers
  v_code := 'automatic_triggers';
  v_evidence := jsonb_build_object(
    'trigger_registry_present', false,
    'event_certification_status', coalesce(v_ec.status,'not_certified'),
    'event_certified_for_automation', (v_ec.status = 'live_cron_allowed'),
    'automatic_triggers_enabled', v_settings.automatic_triggers_enabled,
    'safe_mode', v_safe_mode
  );
  IF v_safe_mode AND coalesce(v_settings.automatic_triggers_enabled,false) = true THEN
    v_result := false; v_status := 'DRIFTED';
    v_blocker := 'AUTOMATIC_TRIGGERS_ENABLED_IN_SAFE_MODE';
    v_fix := 'Disable automatic triggers while the platform is in a safe mode.';
  ELSE
    v_result := false; v_status := 'NOT_IMPLEMENTED';
    v_blocker := 'AUTOMATIC_TRIGGER_NOT_IMPLEMENTED';
    v_fix := 'Register a business-event trigger that enqueues through send_communication_v1 for this event before Automated Production.';
  END IF;
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 3) retry_worker
  v_code := 'retry_worker';
  v_evidence := jsonb_build_object(
    'retry_base_seconds', v_settings.retry_base_seconds,
    'retry_max_seconds', v_settings.retry_max_seconds,
    'max_attempts', v_settings.max_attempts,
    'retry_worker_enabled', v_settings.retry_worker_enabled,
    'safe_mode', v_safe_mode
  );
  IF v_settings.retry_base_seconds IS NULL
     OR v_settings.retry_max_seconds IS NULL
     OR v_settings.max_attempts IS NULL THEN
    v_result := false; v_status := 'NOT_CONFIGURED';
    v_blocker := 'RETRY_POLICY_NOT_CONFIGURED';
    v_fix := 'Configure retry_base_seconds, retry_max_seconds and max_attempts.';
  ELSIF v_safe_mode AND coalesce(v_settings.retry_worker_enabled,false) = true THEN
    v_result := false; v_status := 'DRIFTED';
    v_blocker := 'RETRY_WORKER_ENABLED_IN_SAFE_MODE';
    v_fix := 'Disable the retry worker while the platform is in a safe mode.';
  ELSE
    v_result := true; v_status := 'PASS'; v_blocker := NULL; v_fix := NULL;
  END IF;
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 4) dead_letter
  v_code := 'dead_letter';
  v_evidence := jsonb_build_object(
    'terminal_failed_state_present', true,
    'replay_rpc_present', false,
    'note', 'No canonical replay action found.'
  );
  v_result := false; v_status := 'NOT_IMPLEMENTED';
  v_blocker := 'DEAD_LETTER_REPLAY_NOT_IMPLEMENTED';
  v_fix := 'Implement an authorised dead-letter replay action that preserves idempotency and cannot bypass certification/Arm.';
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 5) rate_limits
  v_code := 'rate_limits';
  v_evidence := jsonb_build_object(
    'rate_limit_policy_table_present', false,
    'enforcement_point_present', false,
    'fallback_batch_size', v_settings.batch_size,
    'note', 'batch_size > 0 is not treated as rate-limit enforcement.'
  );
  v_result := false; v_status := 'NOT_IMPLEMENTED';
  v_blocker := 'RATE_LIMIT_POLICY_NOT_IMPLEMENTED';
  v_fix := 'Add a rate-limit policy table and enforcement in the dispatch path before Automated Production.';
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 6) batch_limits
  v_code := 'batch_limits';
  v_evidence := jsonb_build_object(
    'batch_enabled', coalesce(v_settings.batch_enabled,false),
    'bulk_enabled', coalesce(v_settings.bulk_enabled,false),
    'effective_canary_batch_size', 1,
    'note', 'Pilot canary constrained to a single send; batch/bulk capabilities are NOT operational.'
  );
  IF coalesce(v_settings.batch_enabled,false) = false
     AND coalesce(v_settings.bulk_enabled,false) = false THEN
    v_result := true; v_status := 'PASS'; v_blocker := NULL; v_fix := NULL;
  ELSE
    v_result := false; v_status := 'DRIFTED';
    v_blocker := 'BATCH_OR_BULK_ENABLED_IN_PILOT';
    v_fix := 'Disable batch_enabled and bulk_enabled for the pilot event.';
  END IF;
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 7) provider_circuit_breaker
  v_code := 'provider_circuit_breaker';
  IF v_provider.id IS NULL THEN
    v_evidence := jsonb_build_object(
      'selected_provider_id', NULL,
      'note', 'No default active email provider resolved.'
    );
    v_result := false; v_status := 'NOT_CONFIGURED';
    v_blocker := 'PROVIDER_NOT_CONFIGURED';
    v_fix := 'Set a default active email provider in notification_providers.';
  ELSE
    v_evidence := jsonb_build_object(
      'selected_provider_id', v_provider.id,
      'provider_key', v_provider.provider_name,
      'email_provider_type', v_provider.email_provider_type,
      'is_active', v_provider.is_active,
      'is_default', v_provider.is_default,
      'has_config', (v_provider.config IS NOT NULL AND v_provider.config <> '{}'::jsonb),
      'circuit_breaker_capability', false,
      'note', 'No provider circuit-breaker implementation exists in this deployment.'
    );
    v_result := false; v_status := 'NOT_IMPLEMENTED';
    v_blocker := 'PROVIDER_CIRCUIT_BREAKER_NOT_IMPLEMENTED';
    v_fix := 'Implement a real provider circuit breaker (open/half-open/closed) with atomic guard on dispatch before Automated Production.';
  END IF;
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 8) emergency_stop
  v_code := 'emergency_stop';
  v_evidence := jsonb_build_object(
    'operating_mode', v_mode,
    'emergency_stop_active_from_mode', v_estop_mode,
    'canonical_estop_rpc_present', false,
    'note', 'Emergency Stop state is derived from operating_mode. A canonical atomic Emergency Stop RPC is not implemented.'
  );
  v_result := false; v_status := 'NOT_IMPLEMENTED';
  v_blocker := 'EMERGENCY_STOP_NOT_IMPLEMENTED';
  v_fix := 'Implement a canonical Emergency Stop action that atomically disables dispatch/scheduler/triggers/retry/batch/bulk, invalidates current Arm authority and writes an immutable audit record.';
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  -- 9) alerting_monitoring
  v_code := 'alerting_monitoring';
  v_evidence := jsonb_build_object(
    'dispatcher_failure_visibility', false,
    'scheduler_failure_visibility', false,
    'stale_heartbeat_detection', false,
    'provider_failure_alert', false,
    'dead_letter_backlog_alert', false,
    'operator_diagnostics', true,
    'note', 'Operator diagnostics are visible in the console, but no alerting/monitoring channel is proven.'
  );
  v_result := false; v_status := 'NOT_IMPLEMENTED';
  v_blocker := 'ALERTING_MONITORING_NOT_IMPLEMENTED';
  v_fix := 'Wire dispatcher/scheduler/heartbeat/provider/dead-letter alerts to an operator-visible channel before Automated Production.';
  PERFORM public._persist_pre_arm_readiness_row(p_module_code,p_event_code,v_channel,v_code,
    v_cfg_version,v_ec.id,v_lineage_id,v_result,v_status,v_evidence,v_blocker,v_fix,v_uid,v_now);
  v_checks := v_checks || public._pre_arm_check_json(v_code,v_result,v_status,v_evidence,v_blocker,v_fix,v_cfg_version,v_ec.id,v_lineage_id,v_now);

  RETURN jsonb_build_object(
    'ok', true,
    'readiness_phase', 'PRE_ARM_READINESS',
    'current_operating_mode', v_mode,
    'automation_state', v_automation_state,
    'safe_mode', v_safe_mode,
    'module_code', p_module_code,
    'event_code', p_event_code,
    'channel', v_channel,
    'configuration_version', v_cfg_version,
    'event_certification_id', v_ec.id,
    'production_lineage_id', v_lineage_id,
    'checks', v_checks,
    'checked_at', v_now
  );

EXCEPTION
  WHEN undefined_table OR undefined_column OR undefined_function OR undefined_object OR invalid_schema_name THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blocker', jsonb_build_object(
        'code', 'READINESS_SCHEMA_MISMATCH',
        'object_name', COALESCE(NULLIF(regexp_replace(SQLERRM, '^.*"([^"]+)".*$', '\1'), SQLERRM), ''),
        'detail', SQLERRM,
        'sqlstate', SQLSTATE,
        'fix_action', 'Redeploy run_comm_hub_automation_readiness_probe against the current schema; do not add compatibility columns for absent capabilities.'
      )
    );
END $function$;

REVOKE ALL ON FUNCTION public.run_comm_hub_automation_readiness_probe(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_comm_hub_automation_readiness_probe(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public._persist_pre_arm_readiness_row(text,text,text,text,bigint,uuid,uuid,boolean,text,jsonb,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pre_arm_check_json(text,boolean,text,jsonb,text,text,bigint,uuid,uuid,timestamptz) FROM PUBLIC;

-- =========================================================================
-- Slice 1 (A + J): Manual Production runtime-mode concurrency (isolated to
-- promote), and server-owned Manual Production control normalization core.
--
-- Preserves configuration_version semantics of the canonical mode transition
-- core. Never sends email. Never contacts a provider. Never queues.
-- =========================================================================

-- -------------------------------------------------------------------------
-- J. Server-owned Manual Production normalization core.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._normalize_comm_hub_manual_production_controls(
  p_actor uuid,
  p_reason text,
  p_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current public.communication_hub_control_settings%ROWTYPE;
  v_now timestamptz := now();
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb;
  v_after  jsonb;
  v_new_config_version bigint;
  v_will_change boolean := false;
BEGIN
  SELECT * INTO v_current
    FROM public.communication_hub_control_settings
   WHERE singleton_guard = 'primary'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='MODE_SETTINGS_SINGLETON_MISSING';
  END IF;

  IF v_current.operating_mode = 'EMERGENCY_STOP'::public.communication_operating_mode THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', 'EMERGENCY_STOP_ACTIVE',
      'operating_mode', v_current.operating_mode::text,
      'runtime_mode_version', v_current.runtime_mode_version,
      'configuration_version', v_current.configuration_version
    );
  END IF;

  IF v_current.operating_mode = 'AUTOMATED_PRODUCTION'::public.communication_operating_mode THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', 'AUTOMATED_PRODUCTION_ACTIVE_REQUIRES_EXPLICIT_TRANSITION',
      'operating_mode', v_current.operating_mode::text,
      'runtime_mode_version', v_current.runtime_mode_version,
      'configuration_version', v_current.configuration_version
    );
  END IF;

  IF v_current.operating_mode IS DISTINCT FROM 'MANUAL_PRODUCTION'::public.communication_operating_mode THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', 'NOT_MANUAL_PRODUCTION',
      'operating_mode', v_current.operating_mode::text,
      'runtime_mode_version', v_current.runtime_mode_version,
      'configuration_version', v_current.configuration_version
    );
  END IF;

  -- Detect which fields would change.
  IF v_current.dispatch_enabled IS DISTINCT FROM true THEN
    v_changed := v_changed || jsonb_build_array('dispatch_enabled'); v_will_change := true;
  END IF;
  IF v_current.dry_run_only IS DISTINCT FROM false THEN
    v_changed := v_changed || jsonb_build_array('dry_run_only'); v_will_change := true;
  END IF;
  IF v_current.email_live_enabled IS DISTINCT FROM true THEN
    v_changed := v_changed || jsonb_build_array('email_live_enabled'); v_will_change := true;
  END IF;
  IF coalesce(v_current.automation_state,'') <> 'STANDBY' THEN
    v_changed := v_changed || jsonb_build_array('automation_state'); v_will_change := true;
  END IF;
  IF v_current.scheduler_enabled IS DISTINCT FROM false THEN
    v_changed := v_changed || jsonb_build_array('scheduler_enabled'); v_will_change := true;
  END IF;
  IF v_current.automatic_triggers_enabled IS DISTINCT FROM false THEN
    v_changed := v_changed || jsonb_build_array('automatic_triggers_enabled'); v_will_change := true;
  END IF;
  IF v_current.retry_worker_enabled IS DISTINCT FROM false THEN
    v_changed := v_changed || jsonb_build_array('retry_worker_enabled'); v_will_change := true;
  END IF;
  IF v_current.batch_enabled IS DISTINCT FROM false THEN
    v_changed := v_changed || jsonb_build_array('batch_enabled'); v_will_change := true;
  END IF;
  IF v_current.bulk_enabled IS DISTINCT FROM false THEN
    v_changed := v_changed || jsonb_build_array('bulk_enabled'); v_will_change := true;
  END IF;
  IF v_current.current_arm_audit_id IS NOT NULL THEN
    v_changed := v_changed || jsonb_build_array('current_arm_audit_id'); v_will_change := true;
  END IF;
  IF v_current.automation_armed_at IS NOT NULL THEN
    v_changed := v_changed || jsonb_build_array('automation_armed_at'); v_will_change := true;
  END IF;
  IF v_current.automation_armed_by IS NOT NULL THEN
    v_changed := v_changed || jsonb_build_array('automation_armed_by'); v_will_change := true;
  END IF;
  IF v_current.automation_arm_reason IS NOT NULL THEN
    v_changed := v_changed || jsonb_build_array('automation_arm_reason'); v_will_change := true;
  END IF;

  IF NOT v_will_change THEN
    RETURN jsonb_build_object(
      'ok', true,
      'controls_normalized', true,
      'no_change', true,
      'changed_fields', '[]'::jsonb,
      'runtime_mode_version', v_current.runtime_mode_version,
      'configuration_version', v_current.configuration_version,
      'automation_generation', v_current.automation_generation,
      'operating_mode', v_current.operating_mode::text,
      'automation_state', v_current.automation_state
    );
  END IF;

  v_before := jsonb_build_object(
    'dispatch_enabled', v_current.dispatch_enabled,
    'dry_run_only', v_current.dry_run_only,
    'email_live_enabled', v_current.email_live_enabled,
    'automation_state', v_current.automation_state,
    'scheduler_enabled', v_current.scheduler_enabled,
    'automatic_triggers_enabled', v_current.automatic_triggers_enabled,
    'retry_worker_enabled', v_current.retry_worker_enabled,
    'batch_enabled', v_current.batch_enabled,
    'bulk_enabled', v_current.bulk_enabled,
    'current_arm_audit_id', v_current.current_arm_audit_id,
    'automation_armed_at', v_current.automation_armed_at,
    'automation_armed_by', v_current.automation_armed_by,
    'automation_arm_reason', v_current.automation_arm_reason
  );

  v_new_config_version := coalesce(v_current.configuration_version,0) + 1;

  -- Bypass the mode-derived-controls enforcement trigger for this
  -- server-owned normalization write.
  PERFORM set_config('comm_hub.mode_transition', 'on', true);

  UPDATE public.communication_hub_control_settings
     SET dispatch_enabled = true,
         dry_run_only = false,
         email_live_enabled = true,
         automation_state = 'STANDBY',
         automation_state_changed_at = CASE WHEN coalesce(automation_state,'') <> 'STANDBY'
                                            THEN v_now ELSE automation_state_changed_at END,
         automation_state_changed_by = CASE WHEN coalesce(automation_state,'') <> 'STANDBY'
                                            THEN p_actor ELSE automation_state_changed_by END,
         scheduler_enabled = false,
         automatic_triggers_enabled = false,
         retry_worker_enabled = false,
         batch_enabled = false,
         bulk_enabled = false,
         current_arm_audit_id = NULL,
         automation_armed_at = NULL,
         automation_armed_by = NULL,
         automation_arm_reason = NULL,
         configuration_version = v_new_config_version,
         updated_at = v_now,
         updated_by = p_actor
   WHERE singleton_guard = 'primary';

  v_after := jsonb_build_object(
    'dispatch_enabled', true,
    'dry_run_only', false,
    'email_live_enabled', true,
    'automation_state', 'STANDBY',
    'scheduler_enabled', false,
    'automatic_triggers_enabled', false,
    'retry_worker_enabled', false,
    'batch_enabled', false,
    'bulk_enabled', false,
    'current_arm_audit_id', NULL,
    'automation_armed_at', NULL,
    'automation_armed_by', NULL,
    'automation_arm_reason', NULL
  );

  -- Immutable audit only when technical controls actually change.
  INSERT INTO public.communication_hub_control_audit
    (setting_key, old_value, new_value, reason, changed_by, source)
  VALUES (
    'manual_production_normalize',
    jsonb_build_object(
      'operating_mode','MANUAL_PRODUCTION',
      'changed_fields', v_changed,
      'before', v_before,
      'runtime_mode_version', v_current.runtime_mode_version,
      'configuration_version', v_current.configuration_version
    ),
    jsonb_build_object(
      'operating_mode','MANUAL_PRODUCTION',
      'changed_fields', v_changed,
      'after', v_after,
      'runtime_mode_version', v_current.runtime_mode_version,
      'configuration_version', v_new_config_version
    ),
    coalesce(p_reason,'manual_production_normalize'),
    p_actor,
    coalesce(p_source,'promote_comm_hub_event_to_manual_production')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'controls_normalized', true,
    'no_change', false,
    'changed_fields', v_changed,
    'runtime_mode_version', v_current.runtime_mode_version,
    'configuration_version', v_new_config_version,
    'automation_generation', v_current.automation_generation,
    'operating_mode', 'MANUAL_PRODUCTION',
    'automation_state', 'STANDBY'
  );
END $function$;

-- Lock this helper down: only trusted server-owned functions call it.
REVOKE ALL ON FUNCTION public._normalize_comm_hub_manual_production_controls(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._normalize_comm_hub_manual_production_controls(uuid, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public._normalize_comm_hub_manual_production_controls(uuid, text, text) FROM anon;

-- -------------------------------------------------------------------------
-- A. Promote event to Manual Production — runtime-mode-version concurrency
--    scoped inside promote only.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_comm_hub_event_to_manual_production(
  p_module_code text,
  p_event_code text,
  p_channel text,
  p_reason text,
  p_typed_confirmation text,
  p_expected_runtime_mode_version bigint DEFAULT NULL::bigint,
  p_one_real_email_certification_id uuid DEFAULT NULL::uuid
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
  v_norm_res jsonb;
  v_channel text := coalesce(p_channel,'email');
  v_did_mode_transition boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
  END IF;

  -- 1. Lock the singleton settings row.
  SELECT * INTO v_settings
    FROM public.communication_hub_control_settings
   WHERE singleton_guard = 'primary'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settings_singleton_missing' USING ERRCODE='P0002';
  END IF;

  -- 2. runtime_mode_version concurrency — compared ONLY against
  --    runtime_mode_version. Structured non-mutating return on mismatch.
  IF p_expected_runtime_mode_version IS NOT NULL
     AND p_expected_runtime_mode_version <> coalesce(v_settings.runtime_mode_version,0) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', 'RUNTIME_MODE_VERSION_CONFLICT',
      'expected_runtime_mode_version', p_expected_runtime_mode_version,
      'current_runtime_mode_version', v_settings.runtime_mode_version,
      'configuration_version', v_settings.configuration_version,
      'current_operating_mode', v_settings.operating_mode::text,
      'next_action', 'REFRESH_AND_RECONCILE'
    );
  END IF;

  -- 3. Refuse Emergency Stop.
  IF lower(coalesce(v_settings.operating_mode::text,'')) = 'emergency_stop' THEN
    RAISE EXCEPTION 'emergency_stop_active' USING ERRCODE='22023';
  END IF;

  -- 4. Resolve One Real Email evidence if not supplied.
  IF v_ore_id IS NULL THEN
    SELECT id INTO v_ore_id
      FROM public.communication_controlled_live_certification
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel
       AND certification_kind='ONE_REAL_EMAIL'
       AND invalidated_at IS NULL
       AND status IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
       AND coalesce(manual_verification_status,'')='CONFIRMED'
     ORDER BY manual_verified_at DESC NULLS LAST, created_at DESC
     LIMIT 1;
    IF v_ore_id IS NULL THEN
      RAISE EXCEPTION 'no_valid_one_real_email_certification' USING ERRCODE='22023';
    END IF;
  END IF;

  -- 5. Certify / retain the event as live_manual_only using existing contract.
  v_cert_res := public.certify_comm_hub_event_manual_production(jsonb_build_object(
    'module_code', p_module_code,
    'event_code', p_event_code,
    'channel', v_channel,
    'one_real_email_certification_id', v_ore_id,
    'reason', p_reason,
    'typed_confirmation', p_typed_confirmation
  ));
  IF coalesce((v_cert_res->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', 'certify_event',
      'error', (v_cert_res->>'error'),
      'result', v_cert_res,
      'runtime_mode_version', v_settings.runtime_mode_version,
      'configuration_version', v_settings.configuration_version
    );
  END IF;

  -- 6. Close the scoped One Real Email testing gate (best-effort).
  BEGIN
    PERFORM public.close_comm_hub_one_real_email_gate_after_stage6(
      p_module_code, p_event_code, v_channel,
      coalesce(p_reason,'promotion_to_manual_production'));
  EXCEPTION WHEN undefined_function THEN NULL;
  END;

  -- 7. Mode transition via canonical mode core using CURRENT
  --    configuration_version (never runtime_mode_version).
  IF lower(coalesce(v_settings.operating_mode::text,'')) <> 'manual_production' THEN
    v_mode_res := public.apply_communication_release_mode(
      'MANUAL_PRODUCTION',
      p_reason,
      v_settings.configuration_version::int,
      p_module_code, p_event_code, v_channel);
    v_did_mode_transition := true;
    -- Refresh locked row snapshot after mode transition.
    SELECT * INTO v_settings
      FROM public.communication_hub_control_settings
     WHERE singleton_guard='primary';
  ELSE
    v_mode_res := jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'new_mode', 'MANUAL_PRODUCTION',
      'configuration_version', v_settings.configuration_version,
      'runtime_mode_version', v_settings.runtime_mode_version
    );
  END IF;

  -- 8. Run Manual Production normalization core (also when mode was
  --    already MANUAL_PRODUCTION).
  v_norm_res := public._normalize_comm_hub_manual_production_controls(
                  v_uid,
                  coalesce(p_reason,'promotion_to_manual_production'),
                  'promote_comm_hub_event_to_manual_production');
  IF coalesce((v_norm_res->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', coalesce(v_norm_res->>'phase','normalize_failed'),
      'certification', v_cert_res,
      'mode', v_mode_res,
      'normalize', v_norm_res
    );
  END IF;

  -- Refresh again to report authoritative values.
  SELECT * INTO v_settings
    FROM public.communication_hub_control_settings
   WHERE singleton_guard='primary';

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', (NOT v_did_mode_transition)
                  AND coalesce((v_norm_res->>'no_change')::boolean,false)
                  AND coalesce((v_cert_res->>'idempotent')::boolean, false),
    'no_change', (NOT v_did_mode_transition)
                 AND coalesce((v_norm_res->>'no_change')::boolean,false),
    'next_action', 'DISPATCH_MANUAL_OBSERVATION',
    'event_certification_id', v_cert_res->>'event_certification_id',
    'event_status', 'live_manual_only',
    'controls_normalized', coalesce((v_norm_res->>'controls_normalized')::boolean,false),
    'changed_fields', coalesce(v_norm_res->'changed_fields','[]'::jsonb),
    'runtime_mode_version', v_settings.runtime_mode_version,
    'configuration_version', v_settings.configuration_version,
    'automation_generation', v_settings.automation_generation,
    'operating_mode', v_settings.operating_mode::text,
    'automation_state', v_settings.automation_state,
    'certification', v_cert_res,
    'mode', v_mode_res,
    'normalize', v_norm_res
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.promote_comm_hub_event_to_manual_production(
  text, text, text, text, text, bigint, uuid
) TO authenticated;
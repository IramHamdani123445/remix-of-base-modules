
CREATE OR REPLACE FUNCTION public.check_comm_hub_readiness(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_module   text := NULLIF(p_payload->>'module_code','');
  v_event    text := NULLIF(p_payload->>'event_code','');
  v_channel  text := COALESCE(NULLIF(p_payload->>'channel',''),'email');
  v_target   text := COALESCE(NULLIF(p_payload->>'target_stage',''),'SAFE_TESTING');
  v_stub_id  uuid := NULLIF(p_payload->>'controlled_stub_certification_id','')::uuid;
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_profile  public.communication_hub_mode_profile%ROWTYPE;
  v_send_ctx text;
  v_decision jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_actions  jsonb := '[]'::jsonb;
  v_ready    boolean := true;
  v_to       jsonb := '[]'::jsonb;
  v_dry_id   uuid;
  v_stub     public.communication_controlled_live_certification%ROWTYPE;
  v_exec     public.communication_controlled_live_execution%ROWTYPE;
  v_dry      public.communication_dry_run_certification%ROWTYPE;
BEGIN
  SELECT * INTO v_settings FROM public.communication_hub_control_settings
  ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  SELECT * INTO v_profile
  FROM public.communication_hub_mode_profile
  WHERE operating_mode = v_settings.operating_mode::text;

  IF v_settings.operating_mode::text = 'EMERGENCY_STOP' THEN
    v_ready := false;
    v_blockers := v_blockers || jsonb_build_object(
      'code','emergency_stop_active','stage','platform','severity','critical',
      'title','Emergency Stop is engaged',
      'message','New dispatch is blocked while Emergency Stop is engaged.',
      'fixAction','emergency_stop','fixRoute','/admin/communication-hub/go-live');
  END IF;

  v_send_ctx := CASE v_target
    WHEN 'SAFE_TESTING'         THEN 'dry_run'
    WHEN 'CONTROLLED_STUB'      THEN 'controlled_live'
    WHEN 'ONE_REAL_EMAIL'       THEN 'controlled_live'
    WHEN 'MANUAL_PRODUCTION'    THEN 'manual_production'
    WHEN 'AUTOMATED_PRODUCTION' THEN 'cron'
    ELSE 'dry_run'
  END;

  -- Stage 6 authoritative lineage derivation. Ignore browser-supplied
  -- recipient / dry_run values; derive from durable server rows.
  IF v_target = 'ONE_REAL_EMAIL' AND v_module IS NOT NULL AND v_event IS NOT NULL THEN
    IF v_stub_id IS NULL THEN
      v_ready := false;
      v_blockers := v_blockers || jsonb_build_object(
        'code','controlled_stub_certification_missing','stage','stage5','severity','critical',
        'title','Controlled Stub certification not provided',
        'message','Stage 6 readiness requires an authoritative Controlled Stub certification id.');
    ELSE
      SELECT * INTO v_stub
      FROM public.communication_controlled_live_certification
      WHERE id = v_stub_id;

      IF NOT FOUND
         OR v_stub.certification_kind <> 'CONTROLLED_STUB'
         OR v_stub.invalidated_at IS NOT NULL
         OR v_stub.module_code <> v_module
         OR v_stub.event_code <> v_event
         OR v_stub.channel <> v_channel THEN
        v_ready := false;
        v_blockers := v_blockers || jsonb_build_object(
          'code','controlled_stub_certification_invalid','stage','stage5','severity','critical',
          'title','Controlled Stub certification invalid',
          'message','The referenced Controlled Stub certification is missing, invalidated, or lineage-mismatched.');
      ELSE
        SELECT * INTO v_exec
        FROM public.communication_controlled_live_execution
        WHERE id = v_stub.execution_id;

        IF NOT FOUND OR COALESCE(v_exec.recipient,'') = '' THEN
          v_ready := false;
          v_blockers := v_blockers || jsonb_build_object(
            'code','controlled_live_execution_missing','stage','stage5','severity','critical',
            'title','Controlled Stub execution has no recipient',
            'message','The controlled-live execution linked to the certification could not be loaded.');
        ELSE
          v_to := jsonb_build_array(v_exec.recipient);
          v_dry_id := v_stub.dry_run_certification_id;

          SELECT * INTO v_dry
          FROM public.communication_dry_run_certification
          WHERE id = v_dry_id;

          IF NOT FOUND THEN
            v_ready := false;
            v_blockers := v_blockers || jsonb_build_object(
              'code','dry_run_certification_missing','stage','stage3','severity','critical',
              'title','Dry Run certification missing',
              'message','The Dry Run certification bound to the Controlled Stub could not be found.');
          ELSIF v_dry.status <> 'ACTIVE'
             OR v_dry.result <> 'DRY_RUN_PASSED'
             OR v_dry.invalidated_at IS NOT NULL
             OR (v_dry.expires_at IS NOT NULL AND v_dry.expires_at < now()) THEN
            v_ready := false;
            v_blockers := v_blockers || jsonb_build_object(
              'code','dry_run_certification_not_active','stage','stage3','severity','critical',
              'title','Dry Run certification not active',
              'message','Dry Run certification is expired, invalidated, or not in the ACTIVE/DRY_RUN_PASSED state.');
          ELSIF v_dry.module_code <> v_module
             OR v_dry.event_code <> v_event
             OR v_dry.channel <> v_channel THEN
            v_ready := false;
            v_blockers := v_blockers || jsonb_build_object(
              'code','dry_run_certification_lineage_mismatch','stage','stage3','severity','critical',
              'title','Dry Run certification lineage mismatch',
              'message','Dry Run certification does not match the current module/event/channel.');
          ELSIF v_stub.preview_approval_id IS NOT NULL
                AND v_dry.preview_approval_id IS NOT NULL
                AND v_stub.preview_approval_id <> v_dry.preview_approval_id THEN
            v_ready := false;
            v_blockers := v_blockers || jsonb_build_object(
              'code','preview_approval_lineage_mismatch','stage','stage4','severity','critical',
              'title','Preview approval lineage mismatch',
              'message','Controlled Stub and Dry Run certifications reference different preview approvals.');
          ELSIF (v_stub.configuration_version IS NOT NULL
                 AND v_settings.configuration_version IS NOT NULL
                 AND v_stub.configuration_version <> v_settings.configuration_version) THEN
            v_ready := false;
            v_blockers := v_blockers || jsonb_build_object(
              'code','configuration_version_stale','stage','platform','severity','critical',
              'title','Configuration version changed since certification',
              'message','Rerun Controlled Stub after the configuration change.');
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_module IS NOT NULL AND v_event IS NOT NULL THEN
    v_decision := public._evaluate_comm_hub_send_rules(jsonb_build_object(
      'module_code', v_module,
      'event_code', v_event,
      'channel', v_channel,
      'send_context', v_send_ctx,
      'to_recipients', v_to,
      'cc_recipients', '[]'::jsonb,
      'bcc_recipients', '[]'::jsonb,
      'preview_confirmed', (v_target = 'ONE_REAL_EMAIL'),
      'dry_run_certification_id', to_jsonb(v_dry_id)
    ));
    IF v_decision IS NOT NULL THEN
      IF NOT COALESCE((v_decision->>'allowed')::boolean, false) THEN
        v_ready := false;
      END IF;
      v_blockers := v_blockers || COALESCE(v_decision->'blockers','[]'::jsonb);
      v_warnings := v_warnings || COALESCE(v_decision->'warnings','[]'::jsonb);
    END IF;
  END IF;

  IF v_target = 'MANUAL_PRODUCTION' AND v_module IS NOT NULL AND v_event IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.communication_hub_event_live_control
      WHERE module_code = v_module AND event_code = v_event
        AND status IN ('live_manual_only','live_cron_allowed')
    ) THEN
      v_ready := false;
      v_blockers := v_blockers || jsonb_build_object(
        'code','event_not_certified_for_manual_production','stage','event','severity','critical',
        'title','Event not certified for Manual Production',
        'message','This event has no live_manual_only or live_cron_allowed certification.',
        'fixAction','event_configuration');
    END IF;
  END IF;

  IF v_target = 'AUTOMATED_PRODUCTION' AND v_module IS NOT NULL AND v_event IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.communication_hub_event_live_control
      WHERE module_code = v_module AND event_code = v_event
        AND status = 'live_cron_allowed'
    ) THEN
      v_ready := false;
      v_blockers := v_blockers || jsonb_build_object(
        'code','event_not_certified_for_automated_production','stage','event','severity','critical',
        'title','Event not certified for Automated Production',
        'message','This event has no live_cron_allowed certification.',
        'fixAction','event_configuration');
    END IF;
  END IF;

  IF v_target IN ('ONE_REAL_EMAIL','CONTROLLED_STUB') AND v_settings.operating_mode::text = 'DRY_RUN' THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','operating_mode_dry_run_only','stage','mode',
      'message','Current mode is Safe Testing; switch to Controlled Testing to run this stage.');
  END IF;
  IF v_target = 'MANUAL_PRODUCTION' AND v_settings.operating_mode::text NOT IN ('MANUAL_PRODUCTION','AUTOMATED_PRODUCTION') THEN
    v_ready := false;
    v_blockers := v_blockers || jsonb_build_object(
      'code','operating_mode_not_production','stage','mode','severity','high',
      'title','Operating mode is not Production',
      'message','Activate Manual Production from the mode cards to enable this stage.');
  END IF;
  IF v_target = 'AUTOMATED_PRODUCTION' AND v_settings.operating_mode::text <> 'AUTOMATED_PRODUCTION' THEN
    v_ready := false;
    v_blockers := v_blockers || jsonb_build_object(
      'code','operating_mode_not_automated','stage','mode','severity','high',
      'title','Operating mode is not Automated Production',
      'message','Activate Automated Production from the mode cards to enable this stage.');
  END IF;

  RETURN jsonb_build_object(
    'ready', v_ready,
    'currentMode', v_settings.operating_mode::text,
    'targetStage', v_target,
    'configurationVersion', v_settings.configuration_version,
    'profile', to_jsonb(v_profile),
    'blockers', v_blockers,
    'warnings', v_warnings,
    'availableActions', v_actions,
    'evaluatedAt', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.check_comm_hub_readiness(jsonb) IS
'Go Live readiness aggregator. Read-only. For ONE_REAL_EMAIL derives recipient and dry_run_certification_id from the referenced Controlled Stub certification; browser-supplied recipient/dry-run values are ignored.';

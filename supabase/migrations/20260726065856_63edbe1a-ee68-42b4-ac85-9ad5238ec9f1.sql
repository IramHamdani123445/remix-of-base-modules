
-- Fix Stage 7 Manual Production eligibility: distinguish latest vs eligible ORE cert,
-- return authoritative Stage 6 readiness envelope + blockers, and independently
-- revalidate all prerequisites inside certify_comm_hub_event_manual_production.

-- ============================================================
-- 1) Aggregator: latest vs eligible ONE_REAL_EMAIL certification
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
  v_latest record;
  v_eligible record;
  v_eligible_exec record;
  v_eligible_grant record;
  v_eligible_msg record;
  v_eligible_att record;
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
  v_s6_blockers jsonb := '[]'::jsonb;
  v_s6_ready boolean := false;
  v_reconciliation_required boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  -- Latest ORE cert (diagnostics only)
  SELECT * INTO v_latest FROM public.communication_controlled_live_certification
    WHERE certification_kind='ONE_REAL_EMAIL' AND module_code=p_module_code
      AND event_code=p_event_code AND channel=v_channel
    ORDER BY COALESCE(certified_at, created_at) DESC NULLS LAST LIMIT 1;

  -- Eligible ORE cert: newest that passes every Stage 7 prerequisite.
  -- We iterate candidates newest-first and pick the first one satisfying all checks.
  FOR v_row IN
    SELECT c.*
      FROM public.communication_controlled_live_certification c
     WHERE c.certification_kind='ONE_REAL_EMAIL'
       AND c.module_code=p_module_code
       AND c.event_code=p_event_code
       AND c.channel=v_channel
       AND c.invalidated_at IS NULL
       AND c.status IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
       AND c.manual_verification_status = 'CONFIRMED'
       AND c.manual_verified_at IS NOT NULL
       AND c.manual_verification_recipient IS NOT NULL
       AND c.trace_id IS NOT NULL
       AND COALESCE(c.provider_message_id,'') <> ''
       AND c.execution_id IS NOT NULL
     ORDER BY COALESCE(c.manual_verified_at, c.certified_at, c.created_at) DESC NULLS LAST
  LOOP
    -- Execution checks
    SELECT * INTO v_eligible_exec FROM public.communication_controlled_live_execution
      WHERE id = v_row.execution_id;
    IF NOT FOUND OR COALESCE(v_eligible_exec.provider_call_attempted,false) = false THEN
      CONTINUE;
    END IF;

    -- Grant CONSUMED
    SELECT * INTO v_eligible_grant FROM public.communication_controlled_live_grant
      WHERE execution_id = v_row.execution_id
      ORDER BY issued_at DESC LIMIT 1;
    IF NOT FOUND OR v_eligible_grant.status <> 'CONSUMED' THEN CONTINUE; END IF;

    -- Message sent/delivered
    IF v_eligible_exec.message_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_eligible_msg FROM public.communication_message WHERE id=v_eligible_exec.message_id;
    IF NOT FOUND OR v_eligible_msg.status NOT IN ('sent','delivered') THEN CONTINUE; END IF;

    -- Delivery attempt success + provider_call_attempted
    SELECT * INTO v_eligible_att FROM public.communication_delivery_attempt
      WHERE id = v_eligible_exec.delivery_attempt_id;
    IF NOT FOUND
       OR v_eligible_att.status NOT IN ('success')
       OR COALESCE(v_eligible_att.provider_call_attempted,false) = false THEN
      CONTINUE;
    END IF;

    v_eligible := v_row;
    EXIT;
  END LOOP;

  -- Real-email gate row
  SELECT * INTO v_gate FROM public.communication_hub_real_email_gate
    WHERE lower(trim(module_code))=lower(trim(p_module_code))
      AND lower(trim(event_code))=lower(trim(p_event_code))
      AND lower(trim(channel))=lower(trim(v_channel));

  -- Observations
  IF v_ec.id IS NOT NULL THEN
    SELECT count(*) INTO v_obs_count FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id;
    SELECT * INTO v_latest_obs FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id
      ORDER BY dispatched_at DESC LIMIT 1;
  END IF;

  -- Readiness rows
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

  SELECT count(*) INTO v_eligible_manual FROM public.communication_hub_event_certification
    WHERE status IN ('live_manual_only','live_cron_allowed');
  SELECT count(*) INTO v_eligible_auto FROM public.communication_hub_event_certification
    WHERE status='live_cron_allowed';

  -- Compute Stage 6 blockers (against the eligible cert if any, else latest)
  IF v_eligible.id IS NOT NULL THEN
    v_s6_ready := true;
    v_reconciliation_required := false;
  ELSE
    v_s6_ready := false;
    IF v_latest.id IS NULL THEN
      v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
        'code','CERTIFICATION_MISSING',
        'message','No ONE_REAL_EMAIL certification exists for this event/channel.'));
    ELSE
      IF v_latest.invalidated_at IS NOT NULL THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','CERTIFICATION_INVALIDATED',
          'message','The most recent ONE_REAL_EMAIL certification has been invalidated.'));
      END IF;
      IF v_latest.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY') THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','ATTEMPT_NOT_SUCCESSFUL',
          'message','Latest certification status is '||coalesce(v_latest.status,'unknown')||'.'));
      END IF;
      IF v_latest.trace_id IS NULL THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','TRACE_MISSING','message','Trace not bound to the certification.'));
      END IF;
      IF coalesce(v_latest.provider_message_id,'') = '' THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','PROVIDER_MESSAGE_ID_MISSING','message','Provider message id is missing.'));
      END IF;
      IF coalesce(v_latest.manual_verification_status,'') <> 'CONFIRMED' THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','INBOX_CONFIRMATION_MISSING','message','Manual inbox confirmation is not recorded.'));
      END IF;
      IF v_latest.execution_id IS NULL THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','LINEAGE_MISMATCH','message','Certification has no linked execution.'));
      ELSE
        SELECT * INTO v_eligible_exec FROM public.communication_controlled_live_execution
          WHERE id = v_latest.execution_id;
        IF FOUND AND COALESCE(v_eligible_exec.provider_call_attempted,false) = false THEN
          v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
            'code','PROVIDER_CALL_NOT_ATTEMPTED','message','Provider call was not attempted for this execution.'));
        END IF;
        -- Grant check
        SELECT * INTO v_eligible_grant FROM public.communication_controlled_live_grant
          WHERE execution_id = v_latest.execution_id
          ORDER BY issued_at DESC LIMIT 1;
        IF NOT FOUND OR v_eligible_grant.status <> 'CONSUMED' THEN
          v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
            'code','GRANT_NOT_CONSUMED','message','Controlled-live grant is not CONSUMED.'));
        END IF;
        -- Message check
        IF FOUND AND v_eligible_exec.message_id IS NOT NULL THEN
          SELECT * INTO v_eligible_msg FROM public.communication_message WHERE id=v_eligible_exec.message_id;
          IF FOUND AND v_eligible_msg.status NOT IN ('sent','delivered') THEN
            v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
              'code','MESSAGE_NOT_SENT','message','Message status is '||v_eligible_msg.status||'.'));
          END IF;
        END IF;
        -- Attempt check
        IF FOUND AND v_eligible_exec.delivery_attempt_id IS NOT NULL THEN
          SELECT * INTO v_eligible_att FROM public.communication_delivery_attempt
            WHERE id = v_eligible_exec.delivery_attempt_id;
          IF FOUND AND (v_eligible_att.status <> 'success' OR COALESCE(v_eligible_att.provider_call_attempted,false)=false) THEN
            v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
              'code','ATTEMPT_NOT_SUCCESSFUL','message','Delivery attempt did not succeed at the provider.'));
          END IF;
        END IF;
        -- Reconciliation flag: post-provider without confirmed cert
        v_reconciliation_required :=
          COALESCE(v_eligible_exec.provider_call_attempted,false)=true
          AND v_latest.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY');
        IF v_reconciliation_required THEN
          v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
            'code','RECONCILIATION_REQUIRED','message','Provider was called but certification is not yet reconciled.'));
        END IF;
      END IF;
      IF v_latest.configuration_version IS NOT NULL
         AND v_latest.configuration_version <> coalesce(v_settings.configuration_version,0) THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','CONFIGURATION_DRIFT',
          'message','Certification was captured on a prior configuration version.'));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'module_code',p_module_code,'event_code',p_event_code,'channel',v_channel,
    'evaluated_at', now(),
    'stage6', jsonb_build_object(
       -- Legacy fields (kept for backward compatibility; reflect the ELIGIBLE cert
       -- when available, otherwise the latest cert)
       'one_real_email_execution_id', COALESCE(v_eligible.execution_id, v_latest.execution_id),
       'one_real_email_certification_id', COALESCE(v_eligible.id, v_latest.id),
       'one_real_email_certification_status', COALESCE(v_eligible.status, v_latest.status),
       'provider_call_attempted', (SELECT provider_call_attempted FROM public.communication_controlled_live_execution
                                    WHERE id = COALESCE(v_eligible.execution_id, v_latest.execution_id)),
       'provider_message_id', COALESCE(v_eligible.provider_message_id, v_latest.provider_message_id),
       'delivery_attempt_id', COALESCE(v_eligible.delivery_attempt_id, v_latest.delivery_attempt_id),
       'trace_id', COALESCE(v_eligible.trace_id, v_latest.trace_id),
       'manual_verification_status', COALESCE(v_eligible.manual_verification_status, v_latest.manual_verification_status),
       'manual_verified_recipient', COALESCE(v_eligible.manual_verification_recipient, v_latest.manual_verification_recipient),
       'manual_verified_at', COALESCE(v_eligible.manual_verified_at, v_latest.manual_verified_at),
       'reconciliation_required', v_reconciliation_required,
       'real_email_gate_enabled', coalesce(v_gate.enabled,false),
       'real_email_gate_id', v_gate.id,
       -- New authoritative fields
       'latest_one_real_email_certification_id', v_latest.id,
       'latest_one_real_email_certification_status', v_latest.status,
       'eligible_one_real_email_certification_id', v_eligible.id,
       'eligible_one_real_email_certification_status', v_eligible.status,
       'stage6_ready_for_manual_production', v_s6_ready,
       'stage6_manual_production_blockers', v_s6_blockers
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
-- 2) Independent revalidation inside certify_comm_hub_event_manual_production.
--    Ignores browser-supplied booleans; server rechecks execution/grant/message/
--    attempt and returns a structured blocker envelope instead of a raw exception
--    for authoritative shape.
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
  v_exec record;
  v_grant record;
  v_msg record;
  v_att record;
  v_stub_cert_id uuid;
  v_row_id uuid;
  v_existing record;
  v_cfg_version bigint;
  v_sender_profile_id uuid;
  v_template_version_id uuid;
  v_template_hash text;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF v_typed <> 'CERTIFY MANUAL PRODUCTION' THEN RAISE EXCEPTION 'typed_confirmation_mismatch' USING ERRCODE='22023'; END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF v_module IS NULL OR v_event IS NULL OR v_ore_cert_id IS NULL THEN
    RAISE EXCEPTION 'module_event_ore_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_existing FROM public.communication_hub_event_certification
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel FOR UPDATE;
  IF FOUND AND v_existing.status = 'live_cron_allowed' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'status',v_existing.status,'certification_row_id',v_existing.id);
  END IF;

  -- Independent revalidation of the supplied certification.
  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE id=v_ore_cert_id AND certification_kind='ONE_REAL_EMAIL'
     AND module_code=v_module AND event_code=v_event AND channel=v_channel;

  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','CERTIFICATION_MISSING'));
  ELSE
    IF v_ore.invalidated_at IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','CERTIFICATION_INVALIDATED'));
    END IF;
    IF v_ore.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY') THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','ATTEMPT_NOT_SUCCESSFUL','status',v_ore.status));
    END IF;
    IF coalesce(v_ore.provider_message_id,'') = '' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','PROVIDER_MESSAGE_ID_MISSING'));
    END IF;
    IF v_ore.trace_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','TRACE_MISSING'));
    END IF;
    IF coalesce(v_ore.manual_verification_status,'') <> 'CONFIRMED'
       OR v_ore.manual_verified_at IS NULL
       OR v_ore.manual_verification_recipient IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','INBOX_CONFIRMATION_MISSING'));
    END IF;

    IF v_ore.execution_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','LINEAGE_MISMATCH'));
    ELSE
      SELECT * INTO v_exec FROM public.communication_controlled_live_execution WHERE id=v_ore.execution_id;
      IF NOT FOUND OR COALESCE(v_exec.provider_call_attempted,false)=false THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','PROVIDER_CALL_NOT_ATTEMPTED'));
      END IF;

      SELECT * INTO v_grant FROM public.communication_controlled_live_grant
        WHERE execution_id=v_ore.execution_id ORDER BY issued_at DESC LIMIT 1;
      IF NOT FOUND OR v_grant.status <> 'CONSUMED' THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','GRANT_NOT_CONSUMED'));
      END IF;

      IF FOUND AND v_exec.message_id IS NOT NULL THEN
        SELECT * INTO v_msg FROM public.communication_message WHERE id=v_exec.message_id;
        IF NOT FOUND OR v_msg.status NOT IN ('sent','delivered') THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MESSAGE_NOT_SENT'));
        END IF;
      ELSE
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','MESSAGE_NOT_SENT'));
      END IF;

      IF FOUND AND v_exec.delivery_attempt_id IS NOT NULL THEN
        SELECT * INTO v_att FROM public.communication_delivery_attempt WHERE id=v_exec.delivery_attempt_id;
        IF NOT FOUND OR v_att.status <> 'success' OR COALESCE(v_att.provider_call_attempted,false)=false THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','ATTEMPT_NOT_SUCCESSFUL'));
        END IF;
      ELSE
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','ATTEMPT_NOT_SUCCESSFUL'));
      END IF;

      -- Reconciliation gate
      IF FOUND AND COALESCE(v_exec.provider_call_attempted,false)=true
         AND v_ore.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY') THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','RECONCILIATION_REQUIRED'));
      END IF;
    END IF;
  END IF;

  -- Derive current configuration version
  SELECT configuration_version INTO v_cfg_version FROM public.communication_hub_control_settings WHERE singleton_guard='primary';
  IF v_ore.id IS NOT NULL AND v_ore.configuration_version IS NOT NULL
     AND v_ore.configuration_version <> v_cfg_version THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','CONFIGURATION_DRIFT'));
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stage6_prerequisites_not_met',
      'blockers', v_blockers,
      'one_real_email_certification_id', v_ore_cert_id
    );
  END IF;

  -- Derive stub lineage
  SELECT (audit_metadata->>'controlled_stub_certification_id')::uuid INTO v_stub_cert_id
    FROM public.communication_controlled_live_execution WHERE id = v_ore.execution_id;
  IF v_stub_cert_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','stub_lineage_missing',
      'blockers', jsonb_build_array(jsonb_build_object('code','LINEAGE_MISMATCH')));
  END IF;

  -- Derive template + sender from the ORE message row
  IF v_ore.message_id IS NOT NULL THEN
    SELECT template_version_id, sender_profile_id INTO v_template_version_id, v_sender_profile_id
      FROM public.communication_message WHERE id = v_ore.message_id;
  END IF;

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


-- ============================================================
-- Stage 6 manual inbox verification: accept `decision`, be idempotent
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_controlled_live_manual_verification(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cert_id UUID := (p_payload->>'certification_id')::uuid;
  v_decision TEXT := upper(trim(coalesce(p_payload->>'decision','')));
  v_received BOOLEAN;
  v_recipient TEXT := lower(trim(coalesce(p_payload->>'verified_recipient','')));
  v_note TEXT := p_payload->>'note';
  v_received_at TIMESTAMPTZ := COALESCE(NULLIF(p_payload->>'received_at','')::timestamptz, now());
  v_uid UUID := auth.uid();
  v_row public.communication_controlled_live_certification%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN
    RAISE EXCEPTION 'admin_role_required' USING ERRCODE='42501';
  END IF;
  IF v_cert_id IS NULL THEN
    RAISE EXCEPTION 'certification_id_required' USING ERRCODE='22023';
  END IF;

  -- Explicit decision wins; otherwise fall back to legacy `received` boolean;
  -- otherwise refuse — never interpret absence as NOT_RECEIVED.
  IF v_decision = 'CONFIRMED' THEN
    v_received := true;
  ELSIF v_decision = 'NOT_RECEIVED' THEN
    v_received := false;
  ELSIF p_payload ? 'received' THEN
    v_received := (p_payload->>'received')::boolean;
  ELSE
    RAISE EXCEPTION 'manual_verification_decision_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.communication_controlled_live_certification
    WHERE id = v_cert_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'certification_not_found' USING ERRCODE='P0002';
  END IF;

  -- Idempotent replay: already manually confirmed -> return existing row unchanged
  IF v_row.status = 'DELIVERY_CONFIRMED_MANUALLY'
     AND coalesce(v_row.manual_verification_status,'') = 'CONFIRMED' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'certification_id', v_row.id,
      'status', v_row.status,
      'manual_verification_status', v_row.manual_verification_status,
      'manual_verification_recipient', v_row.manual_verification_recipient,
      'manual_verified_at', v_row.manual_verified_at
    );
  END IF;

  IF v_row.provider_name IS NULL OR v_row.provider_name = 'stub' THEN
    RAISE EXCEPTION 'manual_verification_not_applicable_to_stub' USING ERRCODE='22023';
  END IF;

  IF v_received IS TRUE AND (v_recipient IS NULL OR length(v_recipient) = 0) THEN
    RAISE EXCEPTION 'verified_recipient_required' USING ERRCODE='22023';
  END IF;

  UPDATE public.communication_controlled_live_certification
     SET manual_verification_status  = CASE WHEN v_received THEN 'CONFIRMED' ELSE 'NOT_RECEIVED' END,
         manual_verification_received_at = CASE WHEN v_received THEN v_received_at ELSE NULL END,
         manual_verification_recipient   = CASE WHEN v_received THEN v_recipient ELSE NULL END,
         manual_verification_note = v_note,
         manual_verified_by = v_uid,
         manual_verified_at = now(),
         status = CASE WHEN v_received THEN 'DELIVERY_CONFIRMED_MANUALLY' ELSE status END
   WHERE id = v_cert_id
   RETURNING * INTO v_row;

  BEGIN
    INSERT INTO public.communication_hub_control_audit (action, actor_id, reason, payload)
    VALUES (
      'controlled_live_manual_verification', v_uid,
      COALESCE(v_note,'manual inbox verification'),
      jsonb_build_object(
        'certification_id', v_row.id,
        'execution_id', v_row.execution_id,
        'decision', CASE WHEN v_received THEN 'CONFIRMED' ELSE 'NOT_RECEIVED' END,
        'received', v_received,
        'verified_recipient', v_recipient,
        'received_at', v_received_at)
    );
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'certification_id', v_row.id,
    'status', v_row.status,
    'manual_verification_status', v_row.manual_verification_status,
    'manual_verification_recipient', v_row.manual_verification_recipient,
    'manual_verified_at', v_row.manual_verified_at
  );
END; $function$;

REVOKE ALL ON FUNCTION public.record_controlled_live_manual_verification(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_controlled_live_manual_verification(jsonb) TO authenticated;

-- ============================================================
-- Go Live status aggregator: explicit row types, no created_at,
-- accept success+delivered, never raise on missing rows
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_comm_hub_event_go_live_status(
  p_module_code text, p_event_code text, p_channel text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_channel text := coalesce(p_channel,'email');
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_latest public.communication_controlled_live_certification%ROWTYPE;
  v_eligible public.communication_controlled_live_certification%ROWTYPE;
  v_cand public.communication_controlled_live_certification%ROWTYPE;
  v_eligible_exec public.communication_controlled_live_execution%ROWTYPE;
  v_eligible_grant public.communication_controlled_live_grant%ROWTYPE;
  v_eligible_msg public.communication_message%ROWTYPE;
  v_eligible_att public.communication_delivery_attempt%ROWTYPE;
  v_gate public.communication_hub_real_email_gate%ROWTYPE;
  v_latest_obs public.communication_manual_production_observation%ROWTYPE;
  v_obs_count int := 0;
  v_readiness jsonb := '[]'::jsonb;
  v_ready_all boolean := false;
  v_readiness_row public.comm_hub_automation_readiness_results%ROWTYPE;
  v_r jsonb;
  v_automated_blockers jsonb := '[]'::jsonb;
  v_automated_eligible boolean := true;
  v_eligible_manual int := 0;
  v_eligible_auto int := 0;
  v_s6_blockers jsonb := '[]'::jsonb;
  v_s6_ready boolean := false;
  v_reconciliation_required boolean := false;
  v_latest_provider_call_attempted boolean;
  v_final_exec_id uuid;
  v_final_provider_call_attempted boolean;
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
    ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  -- Eligible ORE cert: newest that passes every Stage 7 prerequisite,
  -- deriving lineage from the certification row itself (immutable).
  FOR v_cand IN
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
       AND c.message_id IS NOT NULL
       AND c.delivery_attempt_id IS NOT NULL
     ORDER BY COALESCE(c.manual_verified_at, c.certified_at) DESC NULLS LAST
  LOOP
    SELECT * INTO v_eligible_exec FROM public.communication_controlled_live_execution
      WHERE id = v_cand.execution_id;
    IF NOT FOUND OR COALESCE(v_eligible_exec.provider_call_attempted,false) = false THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_eligible_grant FROM public.communication_controlled_live_grant
      WHERE execution_id = v_cand.execution_id
      ORDER BY issued_at DESC LIMIT 1;
    IF NOT FOUND OR v_eligible_grant.status <> 'CONSUMED' THEN CONTINUE; END IF;

    SELECT * INTO v_eligible_msg FROM public.communication_message WHERE id = v_cand.message_id;
    IF NOT FOUND OR lower(v_eligible_msg.status) NOT IN ('sent','delivered') THEN CONTINUE; END IF;

    SELECT * INTO v_eligible_att FROM public.communication_delivery_attempt
      WHERE id = v_cand.delivery_attempt_id;
    IF NOT FOUND
       OR lower(v_eligible_att.status) NOT IN ('success','delivered')
       OR COALESCE(v_eligible_att.provider_call_attempted,false) = false THEN
      CONTINUE;
    END IF;

    v_eligible := v_cand;
    EXIT;
  END LOOP;

  -- Real-email gate row (may not exist)
  SELECT * INTO v_gate FROM public.communication_hub_real_email_gate
    WHERE lower(trim(module_code))=lower(trim(p_module_code))
      AND lower(trim(event_code))=lower(trim(p_event_code))
      AND lower(trim(channel))=lower(trim(v_channel));

  -- Observations (only when we have an event certification)
  IF v_ec.id IS NOT NULL THEN
    SELECT count(*) INTO v_obs_count FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id;
    SELECT * INTO v_latest_obs FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id
      ORDER BY dispatched_at DESC LIMIT 1;
  END IF;

  -- Readiness rows
  FOR v_readiness_row IN
    SELECT DISTINCT ON (check_code) *
      FROM public.comm_hub_automation_readiness_results
     WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel
       AND configuration_version = coalesce(v_settings.configuration_version,0)
     ORDER BY check_code, checked_at DESC
  LOOP
    v_readiness := v_readiness || jsonb_build_array(jsonb_build_object(
      'check_code', v_readiness_row.check_code, 'result', v_readiness_row.result,
      'source', v_readiness_row.source, 'evidence', v_readiness_row.evidence,
      'checked_at', v_readiness_row.checked_at, 'checked_by', v_readiness_row.checked_by,
      'expires_at', v_readiness_row.expires_at,
      'configuration_version', v_readiness_row.configuration_version,
      'fresh', v_readiness_row.expires_at > now()));
  END LOOP;

  IF jsonb_array_length(v_readiness) = 9 THEN
    v_ready_all := true;
    FOR v_r IN SELECT jsonb_array_elements(v_readiness) LOOP
      IF NOT coalesce((v_r->>'result')::boolean,false)
         OR NOT coalesce((v_r->>'fresh')::boolean,false) THEN
        v_ready_all := false;
      END IF;
    END LOOP;
  END IF;

  -- Automated eligibility blockers
  IF v_ec.id IS NULL OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    v_automated_eligible := false;
    v_automated_blockers := v_automated_blockers || jsonb_build_array(jsonb_build_object('code','MANUAL_CERT_MISSING'));
  END IF;
  IF v_ec.id IS NOT NULL AND v_ec.drift_detected_at IS NOT NULL THEN
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

  -- Compute Stage 6 readiness / blockers
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
        IF v_eligible_exec.id IS NULL THEN
          v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
            'code','EXECUTION_MISSING','message','Execution row for the certification was not found.'));
        ELSE
          IF COALESCE(v_eligible_exec.provider_call_attempted,false) = false THEN
            v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
              'code','PROVIDER_CALL_NOT_ATTEMPTED','message','Provider call was not attempted for this execution.'));
          END IF;
          SELECT * INTO v_eligible_grant FROM public.communication_controlled_live_grant
            WHERE execution_id = v_latest.execution_id
            ORDER BY issued_at DESC LIMIT 1;
          IF v_eligible_grant.id IS NULL OR v_eligible_grant.status <> 'CONSUMED' THEN
            v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
              'code','GRANT_NOT_CONSUMED','message','Controlled-live grant is not CONSUMED.'));
          END IF;
          IF v_latest.message_id IS NOT NULL THEN
            SELECT * INTO v_eligible_msg FROM public.communication_message WHERE id = v_latest.message_id;
            IF v_eligible_msg.id IS NOT NULL AND lower(v_eligible_msg.status) NOT IN ('sent','delivered') THEN
              v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
                'code','MESSAGE_NOT_SENT','message','Message status is '||v_eligible_msg.status||'.'));
            END IF;
          END IF;
          IF v_latest.delivery_attempt_id IS NOT NULL THEN
            SELECT * INTO v_eligible_att FROM public.communication_delivery_attempt
              WHERE id = v_latest.delivery_attempt_id;
            IF v_eligible_att.id IS NOT NULL AND (
                 lower(v_eligible_att.status) NOT IN ('success','delivered')
                 OR COALESCE(v_eligible_att.provider_call_attempted,false)=false) THEN
              v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
                'code','ATTEMPT_NOT_SUCCESSFUL','message','Delivery attempt did not succeed at the provider.'));
            END IF;
          END IF;
          v_reconciliation_required :=
            COALESCE(v_eligible_exec.provider_call_attempted,false)=true
            AND v_latest.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY');
          IF v_reconciliation_required THEN
            v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
              'code','RECONCILIATION_REQUIRED','message','Provider was called but certification is not yet reconciled.'));
          END IF;
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

  v_final_exec_id := COALESCE(v_eligible.execution_id, v_latest.execution_id);
  IF v_final_exec_id IS NOT NULL THEN
    SELECT provider_call_attempted INTO v_final_provider_call_attempted
      FROM public.communication_controlled_live_execution WHERE id = v_final_exec_id;
  END IF;

  RETURN jsonb_build_object(
    'module_code',p_module_code,'event_code',p_event_code,'channel',v_channel,
    'evaluated_at', now(),
    'stage6', jsonb_build_object(
       'one_real_email_execution_id', v_final_exec_id,
       'one_real_email_certification_id', COALESCE(v_eligible.id, v_latest.id),
       'one_real_email_certification_status', COALESCE(v_eligible.status, v_latest.status),
       'provider_call_attempted', v_final_provider_call_attempted,
       'provider_message_id', COALESCE(v_eligible.provider_message_id, v_latest.provider_message_id),
       'delivery_attempt_id', COALESCE(v_eligible.delivery_attempt_id, v_latest.delivery_attempt_id),
       'trace_id', COALESCE(v_eligible.trace_id, v_latest.trace_id),
       'manual_verification_status', COALESCE(v_eligible.manual_verification_status, v_latest.manual_verification_status),
       'manual_verified_recipient', COALESCE(v_eligible.manual_verification_recipient, v_latest.manual_verification_recipient),
       'manual_verified_at', COALESCE(v_eligible.manual_verified_at, v_latest.manual_verified_at),
       'reconciliation_required', v_reconciliation_required,
       'real_email_gate_enabled', coalesce(v_gate.enabled,false),
       'real_email_gate_id', v_gate.id,
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

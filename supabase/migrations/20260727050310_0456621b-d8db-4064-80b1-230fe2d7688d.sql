-- =====================================================================
-- Extend get_comm_hub_event_go_live_status: separate stage6.production_anchor
-- from stage6.latest_confirmed_candidate. Non-mutating; no sends; safe.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_comm_hub_event_go_live_status(p_module_code text, p_event_code text, p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_channel text := coalesce(p_channel,'email');
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_latest public.communication_controlled_live_certification%ROWTYPE;
  v_eligible public.communication_controlled_live_certification%ROWTYPE;
  v_latest_confirmed public.communication_controlled_live_certification%ROWTYPE;
  v_anchor_ore public.communication_controlled_live_certification%ROWTYPE;
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
  v_event_is_live boolean := false;
  v_production_anchor jsonb := NULL;
  v_latest_candidate jsonb := NULL;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings WHERE singleton_guard='primary';

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
    WHERE module_code=p_module_code AND event_code=p_event_code AND channel=v_channel;

  v_event_is_live := (v_ec.id IS NOT NULL AND v_ec.status IN ('live_manual_only','live_cron_allowed'));

  SELECT * INTO v_latest FROM public.communication_controlled_live_certification
    WHERE certification_kind='ONE_REAL_EMAIL' AND module_code=p_module_code
      AND event_code=p_event_code AND channel=v_channel
    ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  -- Latest CONFIRMED candidate ORE (independent of whether event is pinned to it).
  SELECT * INTO v_latest_confirmed FROM public.communication_controlled_live_certification
    WHERE certification_kind='ONE_REAL_EMAIL' AND module_code=p_module_code
      AND event_code=p_event_code AND channel=v_channel
      AND invalidated_at IS NULL
      AND manual_verification_status='CONFIRMED'
      AND manual_verified_at IS NOT NULL
    ORDER BY coalesce(manual_verified_at, certified_at) DESC NULLS LAST LIMIT 1;

  -- Eligible ORE (unchanged legacy semantic).
  FOR v_cand IN
    SELECT c.*
      FROM public.communication_controlled_live_certification c
     WHERE c.certification_kind='ONE_REAL_EMAIL'
       AND c.module_code=p_module_code AND c.event_code=p_event_code AND c.channel=v_channel
       AND c.invalidated_at IS NULL
       AND c.status IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
       AND c.manual_verification_status='CONFIRMED'
       AND c.manual_verified_at IS NOT NULL
       AND c.manual_verification_recipient IS NOT NULL
       AND c.trace_id IS NOT NULL
       AND coalesce(c.provider_message_id,'') <> ''
       AND c.execution_id IS NOT NULL
       AND c.message_id IS NOT NULL
       AND c.delivery_attempt_id IS NOT NULL
     ORDER BY coalesce(c.manual_verified_at, c.certified_at) DESC NULLS LAST
  LOOP
    SELECT * INTO v_eligible_exec FROM public.communication_controlled_live_execution
      WHERE id = v_cand.execution_id;
    IF NOT FOUND OR coalesce(v_eligible_exec.provider_call_attempted,false)=false THEN CONTINUE; END IF;
    SELECT * INTO v_eligible_grant FROM public.communication_controlled_live_grant
      WHERE execution_id = v_cand.execution_id ORDER BY issued_at DESC LIMIT 1;
    IF NOT FOUND OR v_eligible_grant.status <> 'CONSUMED' THEN CONTINUE; END IF;
    SELECT * INTO v_eligible_msg FROM public.communication_message WHERE id = v_cand.message_id;
    IF NOT FOUND OR lower(v_eligible_msg.status) NOT IN ('sent','delivered') THEN CONTINUE; END IF;
    SELECT * INTO v_eligible_att FROM public.communication_delivery_attempt
      WHERE id = v_cand.delivery_attempt_id;
    IF NOT FOUND
       OR lower(v_eligible_att.status) NOT IN ('success','delivered')
       OR coalesce(v_eligible_att.provider_call_attempted,false)=false THEN CONTINUE; END IF;
    v_eligible := v_cand;
    EXIT;
  END LOOP;

  -- Real-email gate
  SELECT * INTO v_gate FROM public.communication_hub_real_email_gate
    WHERE lower(trim(module_code))=lower(trim(p_module_code))
      AND lower(trim(event_code))=lower(trim(p_event_code))
      AND lower(trim(channel))=lower(trim(v_channel));

  -- Observations
  IF v_ec.id IS NOT NULL THEN
    SELECT count(*) INTO v_obs_count FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id;
    SELECT * INTO v_latest_obs FROM public.communication_manual_production_observation
      WHERE event_certification_id=v_ec.id ORDER BY dispatched_at DESC LIMIT 1;
  END IF;

  -- Production-anchor ORE — resolved from the event certification, not from ordering.
  IF v_event_is_live AND v_ec.one_real_email_certification_id IS NOT NULL THEN
    SELECT * INTO v_anchor_ore FROM public.communication_controlled_live_certification
      WHERE id = v_ec.one_real_email_certification_id;
    IF FOUND THEN
      v_production_anchor := jsonb_build_object(
        'certification_id',            v_anchor_ore.id,
        'production_lineage_id',       v_anchor_ore.production_lineage_id,
        'status',                      v_anchor_ore.status,
        'manual_verification_status',  v_anchor_ore.manual_verification_status,
        'verified_at',                 v_anchor_ore.manual_verified_at,
        'provider_message_id',         v_anchor_ore.provider_message_id,
        'delivery_attempt_id',         v_anchor_ore.delivery_attempt_id,
        'trace_id',                    v_anchor_ore.trace_id,
        'execution_id',                v_anchor_ore.execution_id,
        'evidence_authority',          v_ec.evidence_authority
      );
    END IF;
  END IF;

  IF v_latest_confirmed.id IS NOT NULL THEN
    v_latest_candidate := jsonb_build_object(
      'certification_id',            v_latest_confirmed.id,
      'status',                      v_latest_confirmed.status,
      'manual_verification_status',  v_latest_confirmed.manual_verification_status,
      'verified_at',                 v_latest_confirmed.manual_verified_at,
      'production_lineage_id',       v_latest_confirmed.production_lineage_id,
      'bound_to_current_event_certification',
        (v_ec.one_real_email_certification_id IS NOT NULL
          AND v_ec.one_real_email_certification_id = v_latest_confirmed.id)
    );
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

  -- Stage 6 readiness & blockers (legacy path retained for pre-live behaviour)
  IF v_eligible.id IS NOT NULL THEN
    v_s6_ready := true;
    v_reconciliation_required := false;
  ELSE
    v_s6_ready := false;
    IF v_latest.id IS NULL THEN
      v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
        'code','CERTIFICATION_MISSING','message','No ONE_REAL_EMAIL certification exists for this event/channel.'));
    ELSE
      IF v_latest.invalidated_at IS NOT NULL THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','CERTIFICATION_INVALIDATED','message','The most recent ONE_REAL_EMAIL certification has been invalidated.'));
      END IF;
      IF v_latest.status NOT IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY') THEN
        v_s6_blockers := v_s6_blockers || jsonb_build_array(jsonb_build_object(
          'code','ATTEMPT_NOT_SUCCESSFUL','message','Latest certification status is '||coalesce(v_latest.status,'unknown')||'.'));
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
    END IF;
  END IF;

  -- ***** KEY RULE *****
  -- Once the event is certified live, Stage 6 is COMPLETE via the pinned
  -- production anchor. The "latest eligible" concept collapses to
  -- informational; a newer confirmed ORE never silently supersedes the
  -- production anchor and never resurfaces a Stage 6 blocker.
  IF v_event_is_live AND v_anchor_ore.id IS NOT NULL
     AND v_anchor_ore.manual_verification_status = 'CONFIRMED'
     AND v_anchor_ore.invalidated_at IS NULL
     AND v_anchor_ore.execution_id IS NOT NULL
     AND v_anchor_ore.message_id IS NOT NULL
     AND v_anchor_ore.delivery_attempt_id IS NOT NULL
     AND v_anchor_ore.trace_id IS NOT NULL
     AND coalesce(v_anchor_ore.provider_message_id,'') <> '' THEN
    v_s6_ready := true;
    v_reconciliation_required := false;
    v_s6_blockers := '[]'::jsonb;
  END IF;

  v_final_exec_id := COALESCE(v_anchor_ore.execution_id, v_eligible.execution_id, v_latest.execution_id);
  IF v_final_exec_id IS NOT NULL THEN
    SELECT provider_call_attempted INTO v_final_provider_call_attempted
      FROM public.communication_controlled_live_execution WHERE id = v_final_exec_id;
  END IF;

  RETURN jsonb_build_object(
    'module_code',p_module_code,'event_code',p_event_code,'channel',v_channel,
    'evaluated_at', now(),
    'stage6', jsonb_build_object(
       -- Legacy compatibility fields: when the event is live, these reflect
       -- the pinned production anchor, not the newest confirmed row.
       'one_real_email_execution_id', v_final_exec_id,
       'one_real_email_certification_id',
          COALESCE(v_anchor_ore.id, v_eligible.id, v_latest.id),
       'one_real_email_certification_status',
          COALESCE(v_anchor_ore.status, v_eligible.status, v_latest.status),
       'provider_call_attempted', v_final_provider_call_attempted,
       'provider_message_id',
          COALESCE(v_anchor_ore.provider_message_id, v_eligible.provider_message_id, v_latest.provider_message_id),
       'delivery_attempt_id',
          COALESCE(v_anchor_ore.delivery_attempt_id, v_eligible.delivery_attempt_id, v_latest.delivery_attempt_id),
       'trace_id',
          COALESCE(v_anchor_ore.trace_id, v_eligible.trace_id, v_latest.trace_id),
       'manual_verification_status',
          COALESCE(v_anchor_ore.manual_verification_status, v_eligible.manual_verification_status, v_latest.manual_verification_status),
       'manual_verified_recipient',
          COALESCE(v_anchor_ore.manual_verification_recipient, v_eligible.manual_verification_recipient, v_latest.manual_verification_recipient),
       'manual_verified_at',
          COALESCE(v_anchor_ore.manual_verified_at, v_eligible.manual_verified_at, v_latest.manual_verified_at),
       'reconciliation_required', v_reconciliation_required,
       'real_email_gate_enabled', coalesce(v_gate.enabled,false),
       'real_email_gate_id', v_gate.id,
       'latest_one_real_email_certification_id', v_latest.id,
       'latest_one_real_email_certification_status', v_latest.status,
       'eligible_one_real_email_certification_id', v_eligible.id,
       'eligible_one_real_email_certification_status', v_eligible.status,
       'stage6_ready_for_manual_production', v_s6_ready,
       'stage6_manual_production_blockers', v_s6_blockers,
       -- New authoritative split
       'event_is_live', v_event_is_live,
       'production_anchor', v_production_anchor,
       'latest_confirmed_candidate', v_latest_candidate
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
END $function$;
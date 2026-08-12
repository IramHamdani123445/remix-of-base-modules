-- The live guard becomes a PATH guard: live may only be reached from inside the
-- trusted, audited approval/proposal functions, which set a transaction-local
-- marker. Every other write path is still refused.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_control_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_sanctioned boolean := coalesce(
    nullif(current_setting('omni_comms.live_transition', true), ''), 'off') = 'on';
  v_cert jsonb;
BEGIN
  IF (NEW.release_state = 'live' OR NEW.proposed_state = 'live') THEN
    IF NOT v_sanctioned THEN
      RAISE EXCEPTION 'live_activation_requires_trusted_release_path'
        USING ERRCODE = '22023';
    END IF;
    v_cert := public.omni_comms_priv_runtime_certification();
    IF coalesce(v_cert->>'certification_state','') <> 'certified'
       OR coalesce(v_cert->>'certified_commit','') !~ '^[0-9a-f]{40}$' THEN
      RAISE EXCEPTION 'live_activation_requires_certified_runtime'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.release_state = 'live'
       AND NEW.release_expires_at IS NOT NULL
       AND NEW.release_expires_at <= now() THEN
      RAISE EXCEPTION 'release_window_expired' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.data_origin = 'reference_seed'
     AND NEW.release_state NOT IN ('disabled','configuration') THEN
    RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE = '42501';
  END IF;

  IF NEW.release_state = 'controlled_pilot' THEN
    IF NEW.release_expires_at IS NULL THEN
      RAISE EXCEPTION 'release_expiry_required_for_controlled_pilot' USING ERRCODE = '22023';
    END IF;
    IF NEW.release_expires_at
       > coalesce(NEW.release_starts_at, NEW.activated_at, now()) + interval '7 days' THEN
      RAISE EXCEPTION 'release_window_exceeds_seven_days' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(NEW.pilot_recipient_rules) = 0 THEN
      RAISE EXCEPTION 'release_recipient_rules_required' USING ERRCODE = '22023';
    END IF;
    IF coalesce(array_length(NEW.permitted_event_codes,1),0) = 0
       OR coalesce(array_length(NEW.permitted_caller_modules,1),0) = 0
       OR coalesce(array_length(NEW.permitted_modes,1),0) = 0 THEN
      RAISE EXCEPTION 'release_restrictions_required' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(coalesce(NEW.permitted_modes,'{}')) m WHERE m <> 'queued') THEN
    RAISE EXCEPTION 'release_mode_not_permitted' USING ERRCODE = '22023';
  END IF;
  IF 'OMNI_COMMS_ADMIN_DRY_RUN' = ANY (coalesce(NEW.permitted_caller_modules,'{}')) THEN
    RAISE EXCEPTION 'release_caller_not_permitted' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.pilot_recipient_rules) LOOP
    IF (v_item->>'target_hash') !~ '^[0-9a-f]{64}$'
       OR coalesce(v_item->>'target_masked','') = ''
       OR (v_item ? 'target') THEN
      RAISE EXCEPTION 'release_recipient_rule_malformed' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  NEW.updated_at := now();
  NEW.release_fingerprint := public.omni_comms_priv_channel_release_fingerprint(NEW);
  RETURN NEW;
END;
$function$;

-- Trusted approval path marks itself. Every existing control (segregation of
-- duties, fingerprint, proposal expiry, prerequisites) is unchanged.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_approve_live(
  p_actor_id uuid, p_release_control_id uuid, p_expected_updated_at timestamp with time zone,
  p_expected_fingerprint text, p_deployed_revision text, p_approval_note text, p_correlation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_checks jsonb;
  v_blockers integer;
  v_cert jsonb;
  v_from text;
  v_attached integer := 0;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
   WHERE id = p_release_control_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF NOT public.has_permission(p_actor_id, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'release_approval_permission_required' USING ERRCODE='42501';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(
    p_actor_id, v_rel.organization_id, v_rel.department_id);
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
  IF v_rel.proposed_state IS DISTINCT FROM 'live' THEN RAISE EXCEPTION 'release_proposal_missing' USING ERRCODE='22023'; END IF;
  IF v_rel.release_fingerprint <> coalesce(p_expected_fingerprint,'') THEN RAISE EXCEPTION 'release_proposal_fingerprint_changed' USING ERRCODE='22023'; END IF;
  IF v_rel.proposal_expires_at IS NULL OR v_rel.proposal_expires_at <= now() THEN RAISE EXCEPTION 'release_proposal_expired' USING ERRCODE='22023'; END IF;
  IF v_rel.proposed_by = p_actor_id THEN RAISE EXCEPTION 'segregation_of_duties_violation' USING ERRCODE='42501'; END IF;
  IF v_rel.release_state NOT IN ('test_only','controlled_pilot','suspended') THEN
    RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023';
  END IF;

  v_checks := public.omni_comms_priv_channel_release_prerequisites(
    v_rel.organization_id, v_rel.department_id, v_rel.channel, v_rel.id, p_deployed_revision);
  SELECT count(*) INTO v_blockers FROM jsonb_array_elements(v_checks) c
   WHERE c->>'state' <> 'passed';
  IF v_blockers > 0 THEN
    PERFORM public.omni_comms_priv_channel_release_record_event(
      v_rel, 'release_gate_denied', v_rel.release_state, 'live',
      'prerequisites_failed', p_actor_id, p_correlation_id, p_deployed_revision,
      jsonb_build_object('blocker_count', v_blockers));
    RAISE EXCEPTION 'release_prerequisites_failed' USING ERRCODE='22023';
  END IF;

  v_cert := public.omni_comms_priv_runtime_certification();
  v_from := v_rel.release_state;

  PERFORM set_config('omni_comms.live_transition', 'on', true);

  UPDATE public.omni_comms_channel_release_control SET
    release_state = 'live',
    release_version = release_version + 1,
    proposed_state = NULL,
    approved_by = p_actor_id,
    approved_at = now(),
    approval_note = left(coalesce(p_approval_note,''), 500),
    activated_by = p_actor_id,
    activated_at = now(),
    suspended_by = NULL, suspended_at = NULL, suspension_reason = NULL,
    approved_commit = v_cert->>'certified_commit',
    certification_workflow_run_id = v_cert->>'workflow_run_id',
    certification_recorded_at = (v_cert->>'certified_at')::timestamptz,
    updated_by = p_actor_id
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  WITH safe AS (
    SELECT j.id
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
    JOIN public.omni_comms_request r ON r.id = j.request_id
    JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
    WHERE j.organization_id = v_rel.organization_id
      AND (v_rel.department_id IS NULL OR m.department_id = v_rel.department_id)
      AND j.channel = 'email' AND j.mode = 'queued' AND j.status = 'held'
      AND j.attempt_count = 0
      AND j.release_control_id IS NULL
      AND j.release_decision_at IS NULL
      AND m.status IN ('held','queued')
      AND m.sender_identity_id IS NOT NULL
      AND m.provider_account_id IS NOT NULL
      AND coalesce(m.rendered_checksum,'') <> ''
      AND ed.code = ANY (coalesce(v_rel.permitted_event_codes,'{}'))
      AND r.caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules,'{}'))
      AND r.mode = ANY (coalesce(v_rel.permitted_modes,'{}'))
      AND NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a
                      WHERE a.dispatch_job_id = j.id)
  )
  UPDATE public.omni_comms_dispatch_job j SET
    release_control_id = v_rel.id,
    release_version_at_decision = v_rel.release_version,
    release_state_at_decision = v_rel.release_state,
    release_fingerprint_at_decision = v_rel.release_fingerprint,
    release_expires_at_decision = v_rel.release_expires_at,
    release_decision_at = now(),
    hold_reason = NULL,
    release_decision_snapshot = jsonb_build_object(
      'event_matched', true, 'caller_matched', true, 'mode_matched', true,
      'recipient_source', 'business_request',
      'max_recipients_per_request', v_rel.max_recipients_per_request,
      'max_messages_per_hour', v_rel.max_messages_per_hour,
      'max_messages_per_day', v_rel.max_messages_per_day,
      'max_messages_total', v_rel.max_messages_total,
      'certification_state', v_cert->>'certification_state',
      'certified_commit', v_cert->>'certified_commit',
      'authorized_at', now()),
    updated_at = now()
  FROM safe WHERE j.id = safe.id;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_approved', v_from, 'live',
    p_approval_note, p_actor_id, p_correlation_id, p_deployed_revision, '{}'::jsonb);
  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_activated', v_from, 'live',
    NULL, p_actor_id, p_correlation_id, p_deployed_revision,
    jsonb_build_object('authorized_job_count', v_attached, 'automatic_dispatch', true));

  RETURN public.omni_comms_priv_channel_release_json(v_rel)
         || jsonb_build_object('attached_dispatch_job_count', v_attached);
END;
$function$;
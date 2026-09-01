-- Wave 4 DEF-4 — defect corrections in the governed channel-release activation.
--
-- DEF-5: the held-job authorisation block used min(uuid), which has no
--        Postgres aggregate. ANY activation raised 42883 and no channel could
--        ever be activated. Replaced with a deterministic ordered pick.
-- DEF-6: the block hard-coded channel = 'email' and demanded EXACTLY ONE
--        matching held job. That is a first-pilot artefact: it mis-scopes
--        non-email releases and makes activation impossible for a release with
--        zero or many queued obligations. Now scoped to the release's own
--        channel, and every matching held job receives the post-activation
--        release identity. Zero matches is a legitimate outcome.
--
-- Safety is unchanged: this block only STAMPS release identity onto jobs that
-- are already held. It creates no delivery attempt, releases no hold and makes
-- no job runnable. Recipient-allowlist matching is still mandatory.

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_approve_activate(
  p_actor_id uuid, p_release_control_id uuid, p_expected_updated_at timestamp with time zone,
  p_expected_fingerprint text, p_deployed_revision text, p_approval_note text, p_correlation_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_checks jsonb;
  v_blockers integer;
  v_cert jsonb;
  v_job_ids uuid[] := '{}';
  v_match_count integer := 0;
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
  IF v_rel.proposed_state IS DISTINCT FROM 'controlled_pilot' THEN RAISE EXCEPTION 'release_proposal_missing' USING ERRCODE='22023'; END IF;
  IF v_rel.release_fingerprint <> coalesce(p_expected_fingerprint,'') THEN RAISE EXCEPTION 'release_proposal_fingerprint_changed' USING ERRCODE='22023'; END IF;
  IF v_rel.proposal_expires_at IS NULL OR v_rel.proposal_expires_at <= now() THEN RAISE EXCEPTION 'release_proposal_expired' USING ERRCODE='22023'; END IF;
  IF v_rel.proposed_by = p_actor_id THEN RAISE EXCEPTION 'segregation_of_duties_violation' USING ERRCODE='42501'; END IF;
  IF v_rel.release_state NOT IN ('configuration','test_only','suspended') THEN RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023'; END IF;

  v_checks := public.omni_comms_priv_channel_release_prerequisites(
    v_rel.organization_id, v_rel.department_id, v_rel.channel, v_rel.id, p_deployed_revision);
  SELECT count(*) INTO v_blockers FROM jsonb_array_elements(v_checks) c
   WHERE (c->>'sequence')::int <= 31 AND c->>'state' <> 'passed';
  IF v_blockers > 0 THEN
    PERFORM public.omni_comms_priv_channel_release_record_event(
      v_rel, 'release_gate_denied', v_rel.release_state, 'controlled_pilot',
      'prerequisites_failed', p_actor_id, p_correlation_id, p_deployed_revision,
      jsonb_build_object('blocker_count', v_blockers));
    RAISE EXCEPTION 'release_prerequisites_failed' USING ERRCODE='22023';
  END IF;

  v_cert := public.omni_comms_priv_runtime_certification();

  UPDATE public.omni_comms_channel_release_control SET
    release_state = 'controlled_pilot',
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

  -- ── Held business job authorization (atomic with activation) ───────
  -- The FINAL post-activation release identity is stamped onto every matching
  -- held job on THIS release's channel. Nothing is sent, no attempt is
  -- created, no job is made runnable and no hold is released.
  SELECT coalesce(array_agg(j.id ORDER BY j.created_at, j.id), '{}')
    INTO v_job_ids
  FROM public.omni_comms_dispatch_job j
  JOIN public.omni_comms_message m ON m.id = j.message_id
  JOIN public.omni_comms_request r ON r.id = j.request_id
  JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
  WHERE j.organization_id = v_rel.organization_id
    AND (v_rel.department_id IS NULL OR m.department_id = v_rel.department_id)
    AND j.channel = v_rel.channel
    AND j.mode = 'queued'
    AND j.status = 'held'
    AND j.attempt_count = 0
    AND j.release_control_id IS NULL
    AND j.release_decision_at IS NULL
    AND m.status IN ('held','queued')
    AND coalesce(m.rendered_checksum,'') <> ''
    AND (v_rel.channel <> 'email'
         OR (m.sender_identity_id IS NOT NULL AND m.provider_account_id IS NOT NULL))
    AND ed.code = ANY (coalesce(v_rel.permitted_event_codes,'{}'))
    AND r.caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules,'{}'))
    AND r.mode = ANY (coalesce(v_rel.permitted_modes,'{}'))
    AND NOT EXISTS (
      SELECT 1 FROM public.omni_comms_delivery_attempt a WHERE a.dispatch_job_id = j.id)
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rel.pilot_recipient_rules) rr
      WHERE rr->>'target_hash' = (
        public.omni_comms_priv_channel_test_normalize_target(
          v_rel.channel,
          coalesce(m.destination_snapshot->>'email',
                   m.destination_snapshot->>'user_id',
                   m.destination_snapshot->>'recipient_reference')) ->> 'target_hash'));

  v_match_count := coalesce(array_length(v_job_ids, 1), 0);

  IF v_match_count > 0 THEN
    UPDATE public.omni_comms_dispatch_job SET
      release_control_id = v_rel.id,
      release_version_at_decision = v_rel.release_version,
      release_state_at_decision = v_rel.release_state,
      release_fingerprint_at_decision = v_rel.release_fingerprint,
      release_expires_at_decision = v_rel.release_expires_at,
      release_decision_at = now(),
      release_decision_snapshot = jsonb_build_object(
        'event_matched', true,
        'caller_matched', true,
        'mode_matched', true,
        'recipient_rule_matched', true,
        'max_recipients_per_request', v_rel.max_recipients_per_request,
        'max_messages_per_hour', v_rel.max_messages_per_hour,
        'max_messages_per_day', v_rel.max_messages_per_day,
        'max_messages_total', v_rel.max_messages_total,
        'certification_state', v_cert->>'certification_state',
        'certified_commit', v_cert->>'certified_commit',
        'deployed_revision_match',
          (lower(coalesce(p_deployed_revision,'')) = lower(coalesce(v_cert->>'certified_commit','x'))),
        'authorized_at', now()),
      updated_at = now()
    WHERE id = ANY (v_job_ids);
  END IF;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_approved', 'test_only', 'controlled_pilot',
    p_approval_note, p_actor_id, p_correlation_id, p_deployed_revision, '{}'::jsonb);
  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_activated', 'test_only', 'controlled_pilot',
    NULL, p_actor_id, p_correlation_id, p_deployed_revision,
    jsonb_build_object('authorized_job_count', v_match_count));

  RETURN public.omni_comms_priv_channel_release_json(v_rel)
         || jsonb_build_object(
              'authorized_dispatch_job_count', v_match_count,
              'authorized_dispatch_job_ids', to_jsonb(v_job_ids));
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_approve_activate(uuid,uuid,timestamptz,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_approve_activate(uuid,uuid,timestamptz,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_approve_activate(uuid,uuid,timestamptz,text,text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_release_approve_activate(uuid,uuid,timestamptz,text,text,text,text) TO service_role;
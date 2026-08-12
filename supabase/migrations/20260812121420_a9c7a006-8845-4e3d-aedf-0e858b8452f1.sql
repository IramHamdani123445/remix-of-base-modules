-- ===================================================================
-- Omni-Comms — production release control closure.
-- ===================================================================

-- 1. Protected environment-confirmation audit record -----------------
CREATE TABLE IF NOT EXISTS public.omni_comms_runtime_environment_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  from_environment text,
  to_environment text NOT NULL,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.omni_comms_runtime_environment_event FROM PUBLIC;
REVOKE ALL ON public.omni_comms_runtime_environment_event FROM anon, authenticated;
GRANT ALL ON public.omni_comms_runtime_environment_event TO service_role;
ALTER TABLE public.omni_comms_runtime_environment_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_runtime_environment_event FORCE ROW LEVEL SECURITY;

-- 2. Trusted environment confirmation --------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_confirm_runtime_environment(
  p_actor_id uuid,
  p_environment text,
  p_reason text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_env text;
  v_from text;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'omni_comms: environment confirmation requires an actor'
      USING ERRCODE = '42501';
  END IF;

  -- Privileged capability. The browser cannot classify the environment: this
  -- function is service_role-only and re-checks the operator's capability.
  IF NOT (public.has_permission(p_actor_id, 'omni_comms', 'operate')
          AND public.has_permission(p_actor_id, 'omni_comms', 'configure')) THEN
    RAISE EXCEPTION 'omni_comms: environment confirmation requires privileged capability'
      USING ERRCODE = '42501';
  END IF;

  v_env := lower(btrim(coalesce(p_environment, '')));
  IF v_env NOT IN ('production', 'non_production') THEN
    RAISE EXCEPTION 'omni_comms: invalid runtime environment confirmation'
      USING ERRCODE = '22023';
  END IF;

  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object'
     OR length(p_evidence::text) > 2000 THEN
    RAISE EXCEPTION 'omni_comms: environment evidence must be a bounded object'
      USING ERRCODE = '22023';
  END IF;

  v_from := public.omni_comms_priv_runtime_environment();

  PERFORM public.omni_comms_priv_set_runtime_environment(v_env);

  INSERT INTO public.omni_comms_runtime_environment_event
    (actor_id, from_environment, to_environment, reason, evidence, correlation_id)
  VALUES (p_actor_id, v_from, v_env, left(coalesce(p_reason, ''), 500),
          p_evidence, left(coalesce(p_correlation_id, ''), 120));

  -- This function never certifies, never enables delivery and never contacts
  -- a provider. It resolves the environment classification only.
  RETURN jsonb_build_object(
    'environment', public.omni_comms_priv_runtime_environment(),
    'previous_environment', v_from,
    'confirmed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_confirm_runtime_environment(uuid, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_confirm_runtime_environment(uuid, text, text, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_confirm_runtime_environment(uuid, text, text, jsonb, text) TO service_role;

-- 3. Certification is valid for production OR non_production ---------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_runtime_certification(
  p_certification_state text,
  p_certified_commit text DEFAULT NULL::text,
  p_workflow_run_id text DEFAULT NULL::text,
  p_certified_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_deployed_revision text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_state text;
  v_commit text;
  v_deployed text;
  v_run text;
  v_at timestamptz;
  v_env text;
BEGIN
  v_state := lower(btrim(coalesce(p_certification_state, '')));
  v_commit := lower(btrim(coalesce(p_certified_commit, '')));
  v_deployed := lower(btrim(coalesce(p_deployed_revision, '')));
  v_run := nullif(btrim(coalesce(p_workflow_run_id, '')), '');
  v_at := p_certified_at;

  IF v_state NOT IN ('pending', 'certified', 'failed') THEN
    RAISE EXCEPTION 'omni_comms: invalid certification state' USING ERRCODE = '22023';
  END IF;

  IF v_run IS NOT NULL AND length(v_run) > 200 THEN
    RAISE EXCEPTION 'omni_comms: workflow run id exceeds bounded length' USING ERRCODE = '22023';
  END IF;

  IF v_state = 'pending' THEN
    IF v_commit <> '' OR v_at IS NOT NULL THEN
      RAISE EXCEPTION 'omni_comms: pending certification must not carry a commit or timestamp'
        USING ERRCODE = '22023';
    END IF;
    v_commit := NULL;
  ELSIF v_state = 'failed' THEN
    IF v_commit <> '' AND v_commit !~ '^[0-9a-f]{40}$' THEN
      RAISE EXCEPTION 'omni_comms: attempted commit must be a full 40-character sha'
        USING ERRCODE = '22023';
    END IF;
    v_commit := nullif(v_commit, '');
  ELSE
    IF v_commit !~ '^[0-9a-f]{40}$' THEN
      RAISE EXCEPTION 'omni_comms: certified commit must be a full 40-character sha'
        USING ERRCODE = '22023';
    END IF;
    IF v_run IS NULL THEN
      RAISE EXCEPTION 'omni_comms: certified record requires a workflow run id'
        USING ERRCODE = '22023';
    END IF;
    IF v_at IS NULL THEN
      RAISE EXCEPTION 'omni_comms: certified record requires a certification timestamp'
        USING ERRCODE = '22023';
    END IF;
    IF v_deployed !~ '^[0-9a-f]{40}$' OR v_deployed <> v_commit THEN
      RAISE EXCEPTION 'omni_comms: certified commit must equal the deployed revision'
        USING ERRCODE = '22023';
    END IF;
    -- DEPLOYMENT certification is valid for a genuine production OR
    -- non_production runtime. It is NOT valid while the environment is
    -- unknown, because the deployment identity would be unverifiable.
    -- Safe Test availability is a SEPARATE concept and remains restricted to
    -- non_production by omni_comms_priv_runtime_health_posture().
    v_env := public.omni_comms_priv_runtime_environment();
    IF v_env NOT IN ('production', 'non_production') THEN
      RAISE EXCEPTION 'omni_comms: runtime environment must be resolved before certification'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.omni_comms_runtime_certification
    (singleton, certification_state, certified_commit, workflow_run_id, certified_at, updated_at)
  VALUES (true, v_state, v_commit, v_run, CASE WHEN v_state = 'certified' THEN v_at ELSE NULL END, now())
  ON CONFLICT (singleton) DO UPDATE
    SET certification_state = EXCLUDED.certification_state,
        certified_commit = EXCLUDED.certified_commit,
        workflow_run_id = EXCLUDED.workflow_run_id,
        certified_at = EXCLUDED.certified_at,
        updated_at = now();

  DELETE FROM public.omni_comms_runtime_certification WHERE singleton IS DISTINCT FROM true;

  RETURN public.omni_comms_priv_runtime_certification();
END;
$function$;

-- 4. Prerequisite 25 must fail on an unknown environment -------------
DO $do$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_channel_release_prerequisites';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'omni_comms: prerequisites function missing';
  END IF;
  v_def := replace(
    v_def,
    $old$'code','runtime_environment_known','state',CASE WHEN coalesce(v_env,'') <> '' THEN 'passed' ELSE 'failed' END$old$,
    $new$'code','runtime_environment_known','state',CASE WHEN coalesce(v_env,'unknown') IN ('production','non_production') THEN 'passed' ELSE 'failed' END$new$);
  IF v_def NOT LIKE '%IN (''production'',''non_production'')%' THEN
    RAISE EXCEPTION 'omni_comms: prerequisite 25 patch did not apply';
  END IF;
  EXECUTE v_def;
END
$do$;

-- 5. Release decision snapshot is WRITE-ONCE -------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_job_release_snapshot_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.release_decision_at IS NOT NULL THEN
    IF NEW.release_control_id IS DISTINCT FROM OLD.release_control_id
       OR NEW.release_version_at_decision IS DISTINCT FROM OLD.release_version_at_decision
       OR NEW.release_state_at_decision IS DISTINCT FROM OLD.release_state_at_decision
       OR NEW.release_fingerprint_at_decision IS DISTINCT FROM OLD.release_fingerprint_at_decision
       OR NEW.release_expires_at_decision IS DISTINCT FROM OLD.release_expires_at_decision
       OR NEW.release_decision_snapshot IS DISTINCT FROM OLD.release_decision_snapshot
       OR NEW.release_decision_at IS DISTINCT FROM OLD.release_decision_at THEN
      RAISE EXCEPTION 'release_snapshot_immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS omni_comms_dispatch_job_release_snapshot_write_once
  ON public.omni_comms_dispatch_job;
CREATE TRIGGER omni_comms_dispatch_job_release_snapshot_write_once
  BEFORE UPDATE ON public.omni_comms_dispatch_job
  FOR EACH ROW EXECUTE FUNCTION
  public.omni_comms_priv_dispatch_job_release_snapshot_write_once();

-- 6. Atomic approval + held-job authorization ------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_approve_activate(
  p_actor_id uuid,
  p_release_control_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_expected_fingerprint text,
  p_deployed_revision text,
  p_approval_note text,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_checks jsonb;
  v_blockers integer;
  v_cert jsonb;
  v_job_id uuid;
  v_match_count integer := 0;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
   WHERE id = p_release_control_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
  IF v_rel.proposed_state IS DISTINCT FROM 'controlled_pilot' THEN RAISE EXCEPTION 'release_proposal_missing' USING ERRCODE='22023'; END IF;
  IF v_rel.release_fingerprint <> coalesce(p_expected_fingerprint,'') THEN RAISE EXCEPTION 'release_proposal_fingerprint_changed' USING ERRCODE='22023'; END IF;
  IF v_rel.proposal_expires_at IS NULL OR v_rel.proposal_expires_at <= now() THEN RAISE EXCEPTION 'release_proposal_expired' USING ERRCODE='22023'; END IF;
  IF v_rel.proposed_by = p_actor_id THEN RAISE EXCEPTION 'segregation_of_duties_violation' USING ERRCODE='42501'; END IF;
  IF v_rel.release_state NOT IN ('test_only','suspended') THEN RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023'; END IF;

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
  -- The FINAL post-activation release identity is stamped onto EXACTLY ONE
  -- matching held job. Nothing is sent, no attempt is created, the job is
  -- neither made runnable nor released from hold.
  SELECT count(*), min(j.id) INTO v_match_count, v_job_id
  FROM public.omni_comms_dispatch_job j
  JOIN public.omni_comms_message m ON m.id = j.message_id
  JOIN public.omni_comms_request r ON r.id = j.request_id
  JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
  WHERE j.organization_id = v_rel.organization_id
    AND (v_rel.department_id IS NULL OR m.department_id = v_rel.department_id)
    AND j.channel = 'email'
    AND j.mode = 'queued'
    AND j.status = 'held'
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
    AND NOT EXISTS (
      SELECT 1 FROM public.omni_comms_delivery_attempt a WHERE a.dispatch_job_id = j.id)
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rel.pilot_recipient_rules) rr
      WHERE rr->>'target_hash' = (
        public.omni_comms_priv_channel_test_normalize_target(
          'email', m.destination_snapshot->>'email') ->> 'target_hash'));

  IF v_match_count = 0 THEN
    RAISE EXCEPTION 'controlled_pilot_job_missing' USING ERRCODE='22023';
  ELSIF v_match_count > 1 THEN
    RAISE EXCEPTION 'controlled_pilot_job_ambiguous' USING ERRCODE='22023';
  END IF;

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
  WHERE id = v_job_id;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_approved', 'test_only', 'controlled_pilot',
    p_approval_note, p_actor_id, p_correlation_id, p_deployed_revision, '{}'::jsonb);
  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_activated', 'test_only', 'controlled_pilot',
    NULL, p_actor_id, p_correlation_id, p_deployed_revision,
    jsonb_build_object('authorized_job_count', 1));

  RETURN public.omni_comms_priv_channel_release_json(v_rel)
         || jsonb_build_object('authorized_dispatch_job_id', v_job_id);
END;
$function$;
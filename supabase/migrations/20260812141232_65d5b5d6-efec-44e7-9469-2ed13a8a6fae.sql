-- Omni-Comms — FINAL PRE-SEND HARDENING.
-- Sends nothing. Contacts no provider. Creates no delivery attempt.

CREATE OR REPLACE FUNCTION public.omni_comms_priv_scope_permitted(
  p_actor uuid, p_organization_id uuid, p_department_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_scopes jsonb;
  v_priv boolean;
BEGIN
  IF p_actor IS NULL OR p_organization_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'held_candidate_scope_not_permitted');
  END IF;
  v_scopes := public.omni_comms_priv_dispatch_operator_scopes(p_actor);
  IF coalesce((v_scopes->>'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'code', coalesce(v_scopes->>'code','permission_denied'));
  END IF;
  v_priv := coalesce((v_scopes->>'privileged')::boolean, false);

  IF v_priv THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_scopes->'scopes') s
       WHERE (s->>'organization_id')::uuid = p_organization_id
         AND s->>'department_id' IS NULL
    ) THEN
      RETURN jsonb_build_object('allowed', true, 'code', 'authorized',
                                'privileged', true, 'scopes', v_scopes->'scopes');
    END IF;
    RETURN jsonb_build_object('allowed', false, 'code', 'held_candidate_scope_not_permitted');
  END IF;

  IF p_department_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'held_candidate_scope_not_permitted');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_scopes->'scopes') s
     WHERE (s->>'organization_id')::uuid = p_organization_id
       AND (s->>'department_id')::uuid = p_department_id
  ) THEN
    RETURN jsonb_build_object('allowed', true, 'code', 'authorized',
                              'privileged', false, 'scopes', v_scopes->'scopes');
  END IF;
  RETURN jsonb_build_object('allowed', false, 'code', 'held_candidate_scope_not_permitted');
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_certification_authority(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
  IF p_actor IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'authentication_required');
  END IF;
  IF public.is_admin(p_actor) OR public.has_permission(p_actor, 'omni_comms', 'administer') THEN
    RETURN jsonb_build_object('allowed', true, 'code', 'authorized');
  END IF;
  RETURN jsonb_build_object('allowed', false, 'code', 'certification_authority_required');
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_held_pilot_candidate(
  p_actor uuid, p_organization_id uuid, p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_scope jsonb;
  v_priv boolean;
  v_count integer := 0;
  v_job record;
  v_norm jsonb;
BEGIN
  v_scope := public.omni_comms_priv_scope_permitted(p_actor, p_organization_id, p_department_id);
  IF coalesce((v_scope->>'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false,
                              'code', coalesce(v_scope->>'code','held_candidate_scope_not_permitted'));
  END IF;
  v_priv := coalesce((v_scope->>'privileged')::boolean, false);

  SELECT count(*) INTO v_count
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
   WHERE j.organization_id = p_organization_id
     AND j.channel = 'email' AND j.mode = 'queued'
     AND j.status = 'held' AND j.attempt_count = 0
     AND ((p_department_id IS NULL AND v_priv) OR m.department_id = p_department_id);

  IF v_count <> 1 THEN
    RETURN jsonb_build_object('allowed', true, 'held_job_count', v_count, 'candidate', NULL);
  END IF;

  SELECT j.id AS job_id, j.hold_reason, j.mode, j.attempt_count, j.is_runnable,
         m.department_id, m.destination_snapshot->>'email' AS dest,
         r.caller_module_code, ed.code AS event_code
    INTO v_job
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
    JOIN public.omni_comms_request r ON r.id = j.request_id
    JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
   WHERE j.organization_id = p_organization_id
     AND j.channel = 'email' AND j.mode = 'queued'
     AND j.status = 'held' AND j.attempt_count = 0
     AND ((p_department_id IS NULL AND v_priv) OR m.department_id = p_department_id)
   LIMIT 1;

  v_norm := public.omni_comms_priv_channel_test_normalize_target('email', coalesce(v_job.dest,''));

  RETURN jsonb_build_object(
    'allowed', true,
    'held_job_count', 1,
    'candidate', jsonb_build_object(
      'job_id', v_job.job_id,
      'hold_reason', v_job.hold_reason,
      'mode', v_job.mode,
      'attempt_count', v_job.attempt_count,
      'is_runnable', coalesce(v_job.is_runnable, false),
      'event_code', v_job.event_code,
      'caller_module_code', v_job.caller_module_code,
      'department_id', v_job.department_id,
      'recipient_masked', v_norm->>'target_masked',
      'recipient_hash', v_norm->>'target_hash'
    ));
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_release_controlled_send_preflight(
  p_actor uuid, p_release_control_id uuid, p_deployed_revision text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_rel   public.omni_comms_channel_release_control;
  v_scope jsonb;
  v_cert  jsonb;
  v_rev   text := lower(btrim(coalesce(p_deployed_revision,'')));
  v_count integer := 0;
  v_job   record;
  v_fail  text := NULL;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
   WHERE id = p_release_control_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'release_control_not_found');
  END IF;

  v_scope := public.omni_comms_priv_scope_permitted(p_actor, v_rel.organization_id, v_rel.department_id);
  IF coalesce((v_scope->>'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'controlled_send_scope_not_permitted');
  END IF;

  v_cert := public.omni_comms_priv_certification_posture();

  IF v_rel.data_origin = 'reference_seed' OR v_rel.channel <> 'email' THEN
    v_fail := 'release_control_not_operational';
  ELSIF v_rel.release_state <> 'controlled_pilot' THEN
    v_fail := 'release_not_controlled_pilot';
  ELSIF v_rel.suspended_at IS NOT NULL THEN
    v_fail := 'release_suspended';
  ELSIF v_rel.release_expires_at IS NULL OR v_rel.release_expires_at <= now() THEN
    v_fail := 'release_expired';
  ELSIF v_rel.release_starts_at IS NOT NULL AND v_rel.release_starts_at > now() THEN
    v_fail := 'release_not_started';
  ELSIF v_rel.release_fingerprint IS DISTINCT FROM
        public.omni_comms_priv_channel_release_fingerprint(v_rel) THEN
    v_fail := 'release_fingerprint_stale';
  ELSIF coalesce((v_cert->>'effective_certified')::boolean, false) IS NOT TRUE THEN
    v_fail := 'runtime_certification_not_effective';
  ELSIF (v_cert->>'environment') NOT IN ('production','non_production') THEN
    v_fail := 'runtime_environment_unknown';
  ELSIF lower(coalesce(v_rel.approved_commit,'')) !~ '^[0-9a-f]{40}$'
        OR lower(v_rel.approved_commit) <> lower(coalesce(v_cert->>'certified_commit','')) THEN
    v_fail := 'approved_commit_not_certified';
  ELSIF v_rev <> '' AND v_rev <> lower(coalesce(v_rel.approved_commit,'')) THEN
    v_fail := 'deployment_revision_mismatch';
  ELSIF coalesce(array_length(v_rel.permitted_event_codes,1),0) <> 1
        OR upper(v_rel.permitted_event_codes[1]) <> 'BENEFITS.CLAIM.SUBMITTED' THEN
    v_fail := 'pilot_event_not_exact';
  ELSIF coalesce(array_length(v_rel.permitted_caller_modules,1),0) <> 1
        OR upper(v_rel.permitted_caller_modules[1]) <> 'BENEFITS' THEN
    v_fail := 'pilot_caller_not_exact';
  ELSIF coalesce(array_length(v_rel.permitted_modes,1),0) <> 1
        OR lower(v_rel.permitted_modes[1]) <> 'queued' THEN
    v_fail := 'pilot_mode_not_exact';
  ELSIF jsonb_array_length(coalesce(v_rel.pilot_recipient_rules,'[]'::jsonb)) <> 1 THEN
    v_fail := 'pilot_recipient_rule_not_exact';
  ELSIF v_rel.max_recipients_per_request <> 1 OR v_rel.max_messages_per_hour <> 1
        OR v_rel.max_messages_per_day <> 1 OR v_rel.max_messages_total <> 1 THEN
    v_fail := 'pilot_limits_not_single_message';
  END IF;

  IF v_fail IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', v_fail,
      'release_control_id', v_rel.id, 'live_delivery_enabled', false);
  END IF;

  SELECT count(*) INTO v_count
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
    JOIN public.omni_comms_request r ON r.id = j.request_id
    JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
   WHERE j.organization_id = v_rel.organization_id
     AND (v_rel.department_id IS NULL OR m.department_id = v_rel.department_id)
     AND j.channel = 'email' AND j.mode = 'queued'
     AND j.status = 'held' AND m.status IN ('held','queued')
     AND j.attempt_count = 0
     AND upper(ed.code) = upper(v_rel.permitted_event_codes[1])
     AND upper(r.caller_module_code) = upper(v_rel.permitted_caller_modules[1])
     AND m.sender_identity_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a
                      WHERE a.dispatch_job_id = j.id)
     AND (j.release_control_id IS NULL OR (
            j.release_control_id = v_rel.id
        AND j.release_version_at_decision IS NOT DISTINCT FROM v_rel.release_version
        AND j.release_state_at_decision IS NOT DISTINCT FROM v_rel.release_state
        AND j.release_fingerprint_at_decision IS NOT DISTINCT FROM v_rel.release_fingerprint
        AND j.release_expires_at_decision IS NOT DISTINCT FROM v_rel.release_expires_at))
     AND (public.omni_comms_priv_channel_test_normalize_target(
            'email', coalesce(m.destination_snapshot->>'email',''))->>'target_hash')
         = (v_rel.pilot_recipient_rules->0->>'target_hash');

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'controlled_release_job_missing',
      'release_control_id', v_rel.id, 'live_delivery_enabled', false);
  ELSIF v_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'controlled_release_job_ambiguous',
      'release_control_id', v_rel.id, 'held_job_count', v_count,
      'live_delivery_enabled', false);
  END IF;

  SELECT j.id AS job_id, j.attempt_count AS attempts, ed.code AS event_code,
         r.caller_module_code AS module_code, m.department_id AS department_id,
         public.omni_comms_priv_channel_test_normalize_target(
           'email', coalesce(m.destination_snapshot->>'email',''))->>'target_masked' AS masked
    INTO v_job
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
    JOIN public.omni_comms_request r ON r.id = j.request_id
    JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
   WHERE j.organization_id = v_rel.organization_id
     AND (v_rel.department_id IS NULL OR m.department_id = v_rel.department_id)
     AND j.channel = 'email' AND j.mode = 'queued'
     AND j.status = 'held' AND m.status IN ('held','queued')
     AND j.attempt_count = 0
     AND upper(ed.code) = upper(v_rel.permitted_event_codes[1])
     AND upper(r.caller_module_code) = upper(v_rel.permitted_caller_modules[1])
     AND NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a
                      WHERE a.dispatch_job_id = j.id)
   LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'controlled_release_authorized',
    'release_control_id', v_rel.id,
    'organization_id', v_rel.organization_id,
    'department_id', v_rel.department_id,
    'job_id', v_job.job_id,
    'confirmation', jsonb_build_object(
      'module', v_job.module_code,
      'event_code', v_job.event_code,
      'release_state', v_rel.release_state,
      'held_authorized_messages', 1,
      'recipient_masked', v_job.masked,
      'attempts', v_job.attempts,
      'provider_calls', 0,
      'remaining_total_allowance', 1,
      'certification', 'current',
      'release_snapshot', 'current',
      'pilot_safety', CASE WHEN v_rel.suspended_at IS NULL THEN 'healthy' ELSE 'suspended' END,
      'live_delivery_enabled', false
    ),
    'live_delivery_enabled', false);
END; $function$;

-- Exact release/job filter on the claim transaction. The existing body is
-- preserved verbatim and only the signature and the eligibility predicate are
-- extended, so no dispatch behaviour is silently rewritten.
DO $mig$
DECLARE
  v_src text;
  v_new text;
  v_sig text := 'p_execution_context text DEFAULT ''operator''::text)';
  v_anchor text := E'WHERE j.channel = ''email''\n       AND j.mode = ''queued''\n';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_dispatch_claim_email'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_worker text, p_batch_limit integer, p_correlation_id text, p_deployed_revision text, p_scopes jsonb, p_execution_context text';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'omni_comms_priv_dispatch_claim_email base signature not found';
  END IF;

  v_new := replace(v_src, v_sig,
    'p_execution_context text DEFAULT ''operator''::text, p_release_control_id uuid DEFAULT NULL::uuid, p_expected_job_id uuid DEFAULT NULL::uuid)');
  IF v_new = v_src THEN RAISE EXCEPTION 'claim signature anchor not found'; END IF;

  v_src := v_new;
  v_new := replace(v_src, v_anchor, v_anchor
    || E'       AND (p_release_control_id IS NULL\n'
    || E'            OR j.release_control_id = p_release_control_id\n'
    || E'            OR (j.release_control_id IS NULL AND p_expected_job_id IS NOT NULL\n'
    || E'                AND j.id = p_expected_job_id))\n'
    || E'       AND (p_expected_job_id IS NULL OR j.id = p_expected_job_id)\n');
  IF v_new = v_src THEN RAISE EXCEPTION 'claim predicate anchor not found'; END IF;

  EXECUTE 'DROP FUNCTION public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)';
  EXECUTE v_new;
END $mig$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scope_permitted(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_scope_permitted(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.omni_comms_priv_certification_authority(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_certification_authority(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.omni_comms_priv_held_pilot_candidate(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_held_pilot_candidate(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.omni_comms_priv_release_controlled_send_preflight(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_release_controlled_send_preflight(uuid, uuid, text) TO service_role;
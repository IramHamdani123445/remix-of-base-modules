CREATE OR REPLACE FUNCTION public.omni_comms_priv_held_job_review(
  p_actor uuid,
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_scope jsonb;
  v_priv boolean;
  v_jobs jsonb;
BEGIN
  v_scope := public.omni_comms_priv_scope_permitted(p_actor, p_organization_id, p_department_id);
  IF coalesce((v_scope->>'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false,
      'code', coalesce(v_scope->>'code','held_review_scope_not_permitted'));
  END IF;
  v_priv := coalesce((v_scope->>'privileged')::boolean, false);

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at'), '[]'::jsonb) INTO v_jobs
  FROM (
    SELECT jsonb_build_object(
      'job_id', j.id,
      'message_id', j.message_id,
      'request_id', j.request_id,
      'created_at', j.created_at,
      'status', j.status,
      'hold_reason', j.hold_reason,
      'attempt_count', j.attempt_count,
      'event_code', ed.code,
      'caller_module_code', r.caller_module_code,
      'mode', j.mode,
      'entity_type', r.caller_entity_type,
      'entity_id', r.caller_entity_id,
      'claim_reference', r.payload_snapshot->>'reference',
      'release_state_at_decision', j.release_state_at_decision,
      'recipient_masked',
        (public.omni_comms_priv_channel_test_normalize_target(
           'email', coalesce(m.destination_snapshot->>'email',''))) ->> 'target_masked',
      'provider_contacted', EXISTS (
        SELECT 1 FROM public.omni_comms_delivery_attempt a WHERE a.dispatch_job_id = j.id),
      'retirable', (
        j.status = 'held'
        AND j.attempt_count = 0
        AND NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a WHERE a.dispatch_job_id = j.id)
      )
    ) AS x
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
    JOIN public.omni_comms_request r ON r.id = j.request_id
    JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
    WHERE j.organization_id = p_organization_id
      AND j.channel = 'email' AND j.mode = 'queued'
      AND j.status = 'held'
      AND ((p_department_id IS NULL AND v_priv) OR m.department_id = p_department_id)
  ) s;

  RETURN jsonb_build_object(
    'allowed', true,
    'held_job_count', jsonb_array_length(v_jobs),
    'jobs', v_jobs);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_retire_held_job(
  p_actor uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_job_id uuid,
  p_reason text DEFAULT 'superseded_pre_production_pilot_job'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_scope jsonb;
  v_priv boolean;
  v_job record;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'superseded_pre_production_pilot_job');
  v_seq integer;
BEGIN
  IF v_reason !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'retire_reason_invalid');
  END IF;

  v_scope := public.omni_comms_priv_scope_permitted(p_actor, p_organization_id, p_department_id);
  IF coalesce((v_scope->>'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false,
      'code', coalesce(v_scope->>'code','held_retire_scope_not_permitted'));
  END IF;
  v_priv := coalesce((v_scope->>'privileged')::boolean, false);

  SELECT j.id, j.message_id, j.request_id, j.status, j.attempt_count, m.status AS message_status,
         m.department_id
    INTO v_job
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
   WHERE j.id = p_job_id
     AND j.organization_id = p_organization_id
     AND j.channel = 'email' AND j.mode = 'queued'
     AND ((p_department_id IS NULL AND v_priv) OR m.department_id = p_department_id)
   FOR UPDATE OF j;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'held_job_not_found');
  END IF;
  IF v_job.status <> 'held' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'job_not_held');
  END IF;
  IF coalesce(v_job.attempt_count, 0) <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'job_already_attempted');
  END IF;
  IF EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a WHERE a.dispatch_job_id = v_job.id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'provider_already_contacted');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.omni_comms_delivery_attempt a
     WHERE a.message_id = v_job.message_id AND a.provider_message_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'provider_already_contacted');
  END IF;

  UPDATE public.omni_comms_dispatch_job
     SET status = 'cancelled',
         is_runnable = false,
         cancelled_at = now(),
         hold_reason = v_reason
   WHERE id = v_job.id;

  IF v_job.message_status IN ('held','queued','rendered','pending') THEN
    UPDATE public.omni_comms_message SET status = 'cancelled' WHERE id = v_job.message_id;
  END IF;

  SELECT coalesce(max(event_sequence), 0) + 1 INTO v_seq
    FROM public.omni_comms_message_event WHERE request_id = v_job.request_id;

  INSERT INTO public.omni_comms_message_event(
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, summary, safe_metadata, actor_type, actor_id)
  VALUES (
    v_job.request_id, v_job.message_id, p_organization_id, 'dispatch_cancelled', v_seq,
    'held', 'cancelled',
    'Unsent held dispatch job retired before any provider contact.',
    jsonb_build_object('reason', v_reason, 'source', 'release_control_held_review',
                       'attempt_count', 0, 'provider_contacted', false),
    'user', p_actor);

  RETURN jsonb_build_object('ok', true, 'code', 'held_job_retired',
    'job_id', v_job.id, 'message_id', v_job.message_id, 'reason', v_reason);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_held_job_review(uuid, uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_retire_held_job(uuid, uuid, uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_held_job_review(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_retire_held_job(uuid, uuid, uuid, uuid, text) TO service_role;
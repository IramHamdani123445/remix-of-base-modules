-- Blockers are stored as JSON, not as a text array. Correct both routines.

CREATE OR REPLACE FUNCTION public.omni_comms_priv_abandon_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_organization_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.omni_comms_request%ROWTYPE;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'runtime_persistence_failed'), 64);
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO r FROM public.omni_comms_request WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001';
  END IF;
  IF r.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001';
  END IF;

  IF r.status NOT IN ('accepted','processing')
     OR EXISTS (SELECT 1 FROM public.omni_comms_recipient x WHERE x.request_id = r.id)
     OR EXISTS (SELECT 1 FROM public.omni_comms_message   x WHERE x.request_id = r.id)
  THEN
    RETURN jsonb_build_object('request_id', r.id, 'abandoned', false, 'status', r.status);
  END IF;

  UPDATE public.omni_comms_request
     SET status = 'failed',
         failed_at = now(),
         updated_at = now(),
         blockers = jsonb_build_array(v_reason)
   WHERE id = r.id;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata,
    correlation_id, actor_type, actor_id
  ) VALUES (
    r.id, NULL, r.organization_id, 'request_failed',
    public.omni_comms_priv_next_event_sequence(r.id),
    r.status, 'failed',
    jsonb_build_object('reason', v_reason, 'recoverable', true),
    r.correlation_id, 'system', p_actor_id::text
  );

  RETURN jsonb_build_object('request_id', r.id, 'abandoned', true, 'status', 'failed');
END
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_abandon_request(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_abandon_request(uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_send_communication(
  p_actor_id uuid, p_organization_id uuid, p_department_id uuid, p_event_code text,
  p_mode text, p_idempotency_key text, p_caller_module_code text,
  p_caller_entity_type text, p_caller_entity_id text, p_correlation_id text,
  p_request_fingerprint text, p_payload jsonb, p_requested_channels text[],
  p_producer_event_binding_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id  uuid;
  v_caller    text := coalesce(nullif(btrim(p_caller_module_code), ''), 'OMNI_COMMS_DIRECT');
  v_existing  record;
  v_chan      text;
  v_reusable  boolean;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organization_required' USING ERRCODE='P0001';
  END IF;
  IF p_event_code IS NULL OR btrim(p_event_code) = '' OR length(p_event_code) > 128 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('dry_run','shadow','queued') THEN
    RAISE EXCEPTION 'OC422 mode_invalid' USING ERRCODE='P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'OC422 idempotency_key_required' USING ERRCODE='P0001';
  END IF;
  IF length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'OC422 idempotency_key_too_long' USING ERRCODE='P0001';
  END IF;
  IF p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'OC422 payload_invalid' USING ERRCODE='P0001';
  END IF;
  IF octet_length(p_payload::text) > 262144 THEN
    RAISE EXCEPTION 'OC422 payload_too_large' USING ERRCODE='P0001';
  END IF;
  IF length(v_caller) > 64 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF p_requested_channels IS NOT NULL THEN
    IF array_length(p_requested_channels, 1) > 8 THEN
      RAISE EXCEPTION 'OC422 channel_invalid' USING ERRCODE='P0001';
    END IF;
    FOREACH v_chan IN ARRAY p_requested_channels LOOP
      IF v_chan IS NULL
         OR v_chan NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
        RAISE EXCEPTION 'OC422 channel_invalid' USING ERRCODE='P0001';
      END IF;
    END LOOP;
  END IF;

  IF p_producer_event_binding_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.omni_comms_producer_event_binding b
      WHERE b.id = p_producer_event_binding_id
        AND b.organization_id = p_organization_id
        AND b.caller_module_code = upper(v_caller)
        AND b.status = 'active'
    ) THEN
      RAISE EXCEPTION 'OC403 producer_event_not_authorized' USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT id INTO v_event_id
  FROM public.omni_comms_event_definition
  WHERE code = btrim(p_event_code);
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'OC404 event_code_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at,
         r.idempotency_key, r.producer_event_binding_id
    INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id    = p_organization_id
    AND r.caller_module_code = v_caller
    AND r.idempotency_key    = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      v_reusable := v_existing.status = 'failed'
        AND NOT EXISTS (SELECT 1 FROM public.omni_comms_recipient x WHERE x.request_id = v_existing.id)
        AND NOT EXISTS (SELECT 1 FROM public.omni_comms_message   x WHERE x.request_id = v_existing.id);

      IF NOT v_reusable THEN
        RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE='P0001';
      END IF;

      UPDATE public.omni_comms_request
         SET status = 'accepted',
             mode = p_mode,
             department_id = p_department_id,
             event_definition_id = v_event_id,
             request_fingerprint = p_request_fingerprint,
             correlation_id = nullif(btrim(coalesce(p_correlation_id, '')), ''),
             caller_entity_type = nullif(btrim(coalesce(p_caller_entity_type, '')), ''),
             caller_entity_id = nullif(btrim(coalesce(p_caller_entity_id, '')), ''),
             payload_snapshot = p_payload,
             requested_channels = coalesce(p_requested_channels, ARRAY[]::text[]),
             producer_event_binding_id = p_producer_event_binding_id,
             blockers = '[]'::jsonb,
             failed_at = NULL,
             accepted_at = now(),
             updated_at = now()
       WHERE id = v_existing.id;

      INSERT INTO public.omni_comms_message_event (
        request_id, message_id, organization_id, event_type, event_sequence,
        status_before, status_after, safe_metadata,
        correlation_id, actor_type, actor_id
      ) VALUES (
        v_existing.id, NULL, p_organization_id, 'request_accepted',
        public.omni_comms_priv_next_event_sequence(v_existing.id),
        'failed', 'accepted',
        jsonb_build_object('mode', p_mode, 'retry_after_abandoned_attempt', true),
        nullif(btrim(coalesce(p_correlation_id, '')), ''), 'user', p_actor_id::text
      );

      RETURN jsonb_build_object(
        'request_id',      v_existing.id,
        'idempotency_key', p_idempotency_key,
        'mode',            p_mode,
        'status',          'accepted',
        'created_at',      v_existing.created_at,
        'producer_event_binding_id', p_producer_event_binding_id,
        'replayed',        false
      );
    END IF;

    RETURN jsonb_build_object(
      'request_id',      v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'mode',            v_existing.mode,
      'status',          v_existing.status,
      'created_at',      v_existing.created_at,
      'producer_event_binding_id', v_existing.producer_event_binding_id,
      'replayed',        true
    );
  END IF;

  BEGIN
    INSERT INTO public.omni_comms_request (
      organization_id, department_id, event_definition_id, mode, status,
      idempotency_key, idempotency_scope, request_fingerprint, correlation_id,
      caller_module_code, caller_entity_type, caller_entity_id,
      payload_snapshot, requested_channels, requested_by, accepted_at,
      producer_event_binding_id
    ) VALUES (
      p_organization_id, p_department_id, v_event_id, p_mode, 'accepted',
      p_idempotency_key,
      'caller_module',
      p_request_fingerprint,
      nullif(btrim(coalesce(p_correlation_id, '')), ''),
      v_caller,
      nullif(btrim(coalesce(p_caller_entity_type, '')), ''),
      nullif(btrim(coalesce(p_caller_entity_id, '')), ''),
      p_payload,
      coalesce(p_requested_channels, ARRAY[]::text[]),
      p_actor_id,
      now(),
      p_producer_event_binding_id
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at,
           r.idempotency_key, r.producer_event_binding_id
      INTO v_existing
    FROM public.omni_comms_request r
    WHERE r.organization_id    = p_organization_id
      AND r.caller_module_code = v_caller
      AND r.idempotency_key    = p_idempotency_key;
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE='P0001';
    END IF;
    RETURN jsonb_build_object(
      'request_id',      v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'mode',            v_existing.mode,
      'status',          v_existing.status,
      'created_at',      v_existing.created_at,
      'producer_event_binding_id', v_existing.producer_event_binding_id,
      'replayed',        true
    );
  END;

  SELECT r.id, r.created_at, r.mode, r.status, r.idempotency_key,
         r.correlation_id, r.producer_event_binding_id
    INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id    = p_organization_id
    AND r.caller_module_code = v_caller
    AND r.idempotency_key    = p_idempotency_key;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata,
    correlation_id, actor_type, actor_id
  ) VALUES (
    v_existing.id, NULL, p_organization_id, 'request_accepted',
    public.omni_comms_priv_next_event_sequence(v_existing.id),
    NULL, 'accepted',
    jsonb_build_object('mode', v_existing.mode),
    v_existing.correlation_id, 'user', p_actor_id::text
  );

  RETURN jsonb_build_object(
    'request_id',      v_existing.id,
    'idempotency_key', v_existing.idempotency_key,
    'mode',            v_existing.mode,
    'status',          v_existing.status,
    'created_at',      v_existing.created_at,
    'producer_event_binding_id', v_existing.producer_event_binding_id,
    'replayed',        false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[], uuid) TO service_role;
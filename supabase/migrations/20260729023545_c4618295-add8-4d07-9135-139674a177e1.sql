-- Slice 2c-i: harden persistence RPC — add explicit actor param and
-- restrict EXECUTE to service_role only. The trusted Edge Function
-- boundary (omni-comms-runtime) authenticates the caller, verifies the
-- capability, canonicalizes + fingerprints server-side, then invokes
-- this RPC via service_role.

-- Drop the old 12-arg version.
DROP FUNCTION IF EXISTS public.omni_comms_priv_send_communication(
  uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]
);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_send_communication(
  p_actor_id           uuid,
  p_organization_id    uuid,
  p_department_id      uuid,
  p_event_code         text,
  p_mode               text,
  p_idempotency_key    text,
  p_caller_module_code text,
  p_caller_entity_type text,
  p_caller_entity_id   text,
  p_correlation_id     text,
  p_request_fingerprint text,
  p_payload            jsonb,
  p_requested_channels text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_event_id  uuid;
  v_caller    text := coalesce(nullif(btrim(p_caller_module_code), ''), 'OMNI_COMMS_DIRECT');
  v_existing  record;
  v_chan      text;
BEGIN
  -- Auth: the trusted boundary must pass the authenticated user id.
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE = 'P0001';
  END IF;

  -- Argument shape.
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organization_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_code IS NULL OR btrim(p_event_code) = '' OR length(p_event_code) > 128 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE = 'P0001';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('dry_run','shadow','queued') THEN
    RAISE EXCEPTION 'OC422 mode_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'OC422 idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'OC422 idempotency_key_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'OC422 payload_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF octet_length(p_payload::text) > 262144 THEN
    RAISE EXCEPTION 'OC422 payload_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_caller) > 64 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE = 'P0001';
  END IF;

  IF p_requested_channels IS NOT NULL THEN
    IF array_length(p_requested_channels, 1) > 8 THEN
      RAISE EXCEPTION 'OC422 channel_invalid' USING ERRCODE = 'P0001';
    END IF;
    FOREACH v_chan IN ARRAY p_requested_channels LOOP
      IF v_chan IS NULL
         OR v_chan NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
        RAISE EXCEPTION 'OC422 channel_invalid' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- Resolve event definition.
  SELECT id INTO v_event_id
  FROM public.omni_comms_event_definition
  WHERE code = btrim(p_event_code);
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'OC404 event_code_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: lock any existing request for this scope.
  SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at, r.idempotency_key
    INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id     = p_organization_id
    AND r.caller_module_code  = v_caller
    AND r.idempotency_key     = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'request_id',      v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'mode',            v_existing.mode,
      'status',          v_existing.status,
      'created_at',      v_existing.created_at,
      'replayed',        true
    );
  END IF;

  -- Insert; a concurrent inserter may win, in which case we replay.
  BEGIN
    INSERT INTO public.omni_comms_request (
      organization_id, department_id, event_definition_id, mode, status,
      idempotency_key, idempotency_scope, request_fingerprint, correlation_id,
      caller_module_code, caller_entity_type, caller_entity_id,
      payload_snapshot, requested_channels, requested_by, accepted_at
    ) VALUES (
      p_organization_id, p_department_id, v_event_id, p_mode, 'accepted',
      p_idempotency_key,
      p_organization_id::text || '|' || v_caller || '|' || p_idempotency_key,
      p_request_fingerprint,
      nullif(btrim(coalesce(p_correlation_id, '')), ''),
      v_caller,
      nullif(btrim(coalesce(p_caller_entity_type, '')), ''),
      nullif(btrim(coalesce(p_caller_entity_id, '')), ''),
      p_payload,
      coalesce(p_requested_channels, ARRAY[]::text[]),
      p_actor_id,
      now()
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at, r.idempotency_key
      INTO v_existing
    FROM public.omni_comms_request r
    WHERE r.organization_id     = p_organization_id
      AND r.caller_module_code  = v_caller
      AND r.idempotency_key     = p_idempotency_key;
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'request_id',      v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'mode',            v_existing.mode,
      'status',          v_existing.status,
      'created_at',      v_existing.created_at,
      'replayed',        true
    );
  END;

  SELECT r.id, r.created_at, r.mode, r.status, r.idempotency_key INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id     = p_organization_id
    AND r.caller_module_code  = v_caller
    AND r.idempotency_key     = p_idempotency_key;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, event_sequence,
    event_code, status_before, status_after, event_payload
  ) VALUES (
    v_existing.id, NULL, 1,
    'request_accepted', NULL, 'accepted',
    jsonb_build_object('mode', v_existing.mode)
  );

  RETURN jsonb_build_object(
    'request_id',      v_existing.id,
    'idempotency_key', v_existing.idempotency_key,
    'mode',            v_existing.mode,
    'status',          v_existing.status,
    'created_at',      v_existing.created_at,
    'replayed',        false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]
) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_send_communication(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]
) TO service_role;

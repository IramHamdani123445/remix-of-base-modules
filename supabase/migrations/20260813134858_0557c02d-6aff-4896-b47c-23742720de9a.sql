CREATE OR REPLACE FUNCTION public.omni_comms_priv_effective_channels(
  p_organization_id uuid,
  p_department_id   uuid,
  p_event_code      text,
  p_product_id      uuid DEFAULT NULL
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT id FROM public.omni_comms_event_definition
    WHERE code = btrim(coalesce(p_event_code, ''))
  ),
  routes AS (
    SELECT DISTINCT lower(btrim(r.channel)) AS channel
    FROM public.omni_comms_event_route r
    JOIN ev ON ev.id = r.event_definition_id
    WHERE r.organization_id = p_organization_id
      AND r.is_enabled IS TRUE
      AND coalesce(r.lifecycle_state, 'active') = 'active'
      AND (
        p_department_id IS NULL
        OR r.department_id IS NULL
        OR r.department_id = p_department_id
      )
  ),
  product_off AS (
    SELECT DISTINCT lower(btrim(c.channel)) AS channel
    FROM public.omni_comms_product_communication_config c
    WHERE p_product_id IS NOT NULL
      AND c.organization_id = p_organization_id
      AND c.product_id = p_product_id
      AND upper(btrim(coalesce(c.event_code, ''))) = upper(btrim(coalesce(p_event_code, '')))
      AND c.is_enabled IS NOT TRUE
  ),
  channel_on AS (
    SELECT DISTINCT lower(btrim(s.channel)) AS channel
    FROM public.omni_comms_channel_setting s
    WHERE s.organization_id = p_organization_id
      AND s.enabled IS TRUE
      AND (
        p_department_id IS NULL
        OR s.department_id IS NULL
        OR s.department_id = p_department_id
      )
  )
  SELECT coalesce(array_agg(c.channel ORDER BY c.channel), ARRAY[]::text[])
  FROM routes c
  WHERE c.channel IN (SELECT channel FROM channel_on)
    AND c.channel NOT IN (SELECT channel FROM product_off)
    AND c.channel = 'email';
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_effective_channels(uuid, uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_effective_channels(uuid, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_send_communication(
  p_actor_id uuid, p_organization_id uuid, p_department_id uuid, p_event_code text,
  p_mode text, p_idempotency_key text, p_caller_module_code text,
  p_caller_entity_type text, p_caller_entity_id text, p_correlation_id text,
  p_request_fingerprint text, p_payload jsonb, p_requested_channels text[],
  p_producer_event_binding_id uuid DEFAULT NULL::uuid,
  p_business_context_snapshot jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id  uuid;
  v_caller    text := coalesce(nullif(btrim(p_caller_module_code), ''), 'OMNI_COMMS_DIRECT');
  v_existing  record;
  v_full      public.omni_comms_request;
  v_chan      text;
  v_ctx       jsonb := coalesce(p_business_context_snapshot, '{}'::jsonb);
  v_explicit  boolean := p_requested_channels IS NOT NULL
                         AND coalesce(array_length(p_requested_channels, 1), 0) > 0;
  v_channels  text[] := coalesce(p_requested_channels, ARRAY[]::text[]);
  v_product   uuid;
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
  IF jsonb_typeof(v_ctx) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'OC422 business_context_invalid' USING ERRCODE='P0001';
  END IF;
  IF octet_length(v_ctx::text) > 8192 THEN
    RAISE EXCEPTION 'OC422 business_context_too_large' USING ERRCODE='P0001';
  END IF;
  IF v_ctx ?| ARRAY[
      'secret','api_key','apiKey','password','token','access_token',
      'release_ticket','releaseTicket','scheduler_nonce','schedulerNonce',
      'session','provider_credentials'
  ] THEN
    RAISE EXCEPTION 'OC422 business_context_forbidden_key' USING ERRCODE='P0001';
  END IF;
  IF length(v_caller) > 64 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF v_explicit THEN
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

  IF NOT v_explicit THEN
    BEGIN
      v_product := nullif(btrim(coalesce(v_ctx->>'product_id', v_ctx->>'productId', '')), '')::uuid;
    EXCEPTION WHEN others THEN
      v_product := NULL;
    END;
    v_channels := public.omni_comms_priv_effective_channels(
      p_organization_id, p_department_id, btrim(p_event_code), v_product);
    IF coalesce(array_length(v_channels, 1), 0) = 0 THEN
      RAISE EXCEPTION 'OC422 no_channel_configured' USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT * INTO v_full
  FROM public.omni_comms_request r
  WHERE r.organization_id    = p_organization_id
    AND r.caller_module_code = v_caller
    AND r.idempotency_key    = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_full.status IN ('failed','blocked')
       AND public.omni_comms_priv_request_never_dispatched(v_full.id) THEN
      IF v_full.department_id IS DISTINCT FROM p_department_id
         OR v_full.event_definition_id IS DISTINCT FROM v_event_id
         OR v_full.mode IS DISTINCT FROM p_mode
         OR v_full.caller_entity_type IS DISTINCT FROM nullif(btrim(coalesce(p_caller_entity_type, '')), '')
         OR v_full.caller_entity_id IS DISTINCT FROM nullif(btrim(coalesce(p_caller_entity_id, '')), '')
         OR v_full.payload_snapshot IS DISTINCT FROM p_payload
         OR (v_explicit AND v_full.requested_channels IS DISTINCT FROM v_channels)
         OR v_full.producer_event_binding_id IS DISTINCT FROM p_producer_event_binding_id THEN
        RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE='P0001';
      END IF;

      PERFORM public.omni_comms_priv_recover_request(v_full.id, p_request_fingerprint);

      RETURN jsonb_build_object(
        'request_id',      v_full.id,
        'idempotency_key', v_full.idempotency_key,
        'mode',            v_full.mode,
        'status',          'accepted',
        'created_at',      v_full.created_at,
        'producer_event_binding_id', v_full.producer_event_binding_id,
        'business_context_snapshot', v_full.business_context_snapshot,
        'resolved_channels', to_jsonb(v_full.requested_channels),
        'recovered',       true,
        'replayed',        false
      );
    END IF;

    IF v_full.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE='P0001';
    END IF;

    RETURN jsonb_build_object(
      'request_id',      v_full.id,
      'idempotency_key', v_full.idempotency_key,
      'mode',            v_full.mode,
      'status',          v_full.status,
      'created_at',      v_full.created_at,
      'producer_event_binding_id', v_full.producer_event_binding_id,
      'business_context_snapshot', v_full.business_context_snapshot,
      'resolved_channels', to_jsonb(v_full.requested_channels),
      'replayed',        true
    );
  END IF;

  BEGIN
    INSERT INTO public.omni_comms_request (
      organization_id, department_id, event_definition_id, mode, status,
      idempotency_key, idempotency_scope, request_fingerprint, correlation_id,
      caller_module_code, caller_entity_type, caller_entity_id,
      payload_snapshot, requested_channels, requested_by, accepted_at,
      producer_event_binding_id, business_context_snapshot
    ) VALUES (
      p_organization_id, p_department_id, v_event_id, p_mode, 'accepted',
      p_idempotency_key, 'caller_module', p_request_fingerprint,
      nullif(btrim(coalesce(p_correlation_id, '')), ''),
      v_caller,
      nullif(btrim(coalesce(p_caller_entity_type, '')), ''),
      nullif(btrim(coalesce(p_caller_entity_id, '')), ''),
      p_payload, v_channels,
      p_actor_id, now(), p_producer_event_binding_id, v_ctx
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at,
           r.idempotency_key, r.producer_event_binding_id, r.business_context_snapshot,
           r.requested_channels
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
      'business_context_snapshot', v_existing.business_context_snapshot,
      'resolved_channels', to_jsonb(v_existing.requested_channels),
      'replayed',        true
    );
  END;

  SELECT r.id, r.created_at, r.mode, r.status, r.idempotency_key,
         r.correlation_id, r.producer_event_binding_id, r.business_context_snapshot,
         r.requested_channels
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
    jsonb_build_object('mode', v_existing.mode,
                       'channel_resolution', CASE WHEN v_explicit THEN 'caller' ELSE 'server' END),
    v_existing.correlation_id, 'user', p_actor_id::text
  );

  RETURN jsonb_build_object(
    'request_id',      v_existing.id,
    'idempotency_key', v_existing.idempotency_key,
    'mode',            v_existing.mode,
    'status',          v_existing.status,
    'created_at',      v_existing.created_at,
    'producer_event_binding_id', v_existing.producer_event_binding_id,
    'business_context_snapshot', v_existing.business_context_snapshot,
    'resolved_channels', to_jsonb(v_existing.requested_channels),
    'replayed',        false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_requeue_business_event(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.omni_comms_business_event_outbox;
BEGIN
  SELECT * INTO v_row FROM public.omni_comms_business_event_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 business_event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status NOT IN ('blocked', 'needs_review') THEN
    RAISE EXCEPTION 'OC422 business_event_not_requeueable' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.request_id IS NOT NULL THEN
    RAISE EXCEPTION 'OC409 business_event_already_materialised' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.omni_comms_business_event_outbox
     SET status = 'pending', blocker_code = NULL, result_code = NULL,
         claimed_at = NULL, processed_at = NULL,
         next_attempt_at = now(), updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('status', 'pending', 'id', p_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_requeue_business_event(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_requeue_business_event(uuid) TO service_role;
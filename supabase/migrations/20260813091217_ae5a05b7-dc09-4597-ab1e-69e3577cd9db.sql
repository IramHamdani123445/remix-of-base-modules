-- A/B/C/D: first-class recipient role + immutable business context snapshot.

ALTER TABLE public.omni_comms_recipient
  ADD COLUMN IF NOT EXISTS recipient_role text NULL;

ALTER TABLE public.omni_comms_recipient
  DROP CONSTRAINT IF EXISTS omni_comms_recipient_recipient_role_check;
ALTER TABLE public.omni_comms_recipient
  ADD CONSTRAINT omni_comms_recipient_recipient_role_check
  CHECK (recipient_role IS NULL OR recipient_role ~ '^[a-z][a-z0-9_]{0,63}$');

CREATE OR REPLACE FUNCTION public.omni_comms_priv_recipient_role_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NEW.recipient_role IS DISTINCT FROM OLD.recipient_role THEN
    RAISE EXCEPTION 'OC409 recipient_role_immutable' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS omni_comms_recipient_role_immutable ON public.omni_comms_recipient;
CREATE TRIGGER omni_comms_recipient_role_immutable
  BEFORE UPDATE ON public.omni_comms_recipient
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_recipient_role_immutable();

ALTER TABLE public.omni_comms_request
  ADD COLUMN IF NOT EXISTS business_context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.omni_comms_request
  DROP CONSTRAINT IF EXISTS omni_comms_request_business_context_snapshot_check;
ALTER TABLE public.omni_comms_request
  ADD CONSTRAINT omni_comms_request_business_context_snapshot_check
  CHECK (
    jsonb_typeof(business_context_snapshot) = 'object'
    AND octet_length(business_context_snapshot::text) <= 8192
    AND NOT (business_context_snapshot ?| ARRAY[
      'secret','api_key','apiKey','password','token','access_token',
      'release_ticket','releaseTicket','scheduler_nonce','schedulerNonce',
      'session','provider_credentials'
    ])
  );

CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_context_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NEW.business_context_snapshot IS DISTINCT FROM OLD.business_context_snapshot THEN
    RAISE EXCEPTION 'OC409 business_context_immutable' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS omni_comms_request_business_context_immutable ON public.omni_comms_request;
CREATE TRIGGER omni_comms_request_business_context_immutable
  BEFORE UPDATE ON public.omni_comms_request
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_business_context_immutable();

-- ---------------------------------------------------------------------------
-- send_communication: accept + persist the immutable business context snapshot.
-- ---------------------------------------------------------------------------
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
         OR v_full.requested_channels IS DISTINCT FROM coalesce(p_requested_channels, ARRAY[]::text[])
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
      p_payload, coalesce(p_requested_channels, ARRAY[]::text[]),
      p_actor_id, now(), p_producer_event_binding_id, v_ctx
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at,
           r.idempotency_key, r.producer_event_binding_id, r.business_context_snapshot
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
      'replayed',        true
    );
  END;

  SELECT r.id, r.created_at, r.mode, r.status, r.idempotency_key,
         r.correlation_id, r.producer_event_binding_id, r.business_context_snapshot
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
    'business_context_snapshot', v_existing.business_context_snapshot,
    'replayed',        false
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- finalize_resolution: persist the first-class recipient_role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_finalize_resolution(
  p_actor_id uuid, p_request_id uuid, p_organization_id uuid,
  p_resolution_snapshot jsonb, p_recipients jsonb, p_request_blockers text[],
  p_final_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_req                record;
  v_recipient          jsonb;
  v_recipient_id       uuid;
  v_existing_count     int;
  v_persisted          jsonb := '[]'::jsonb;
  v_event_type         text;
  v_role               text;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF p_final_status NOT IN ('processing','blocked') THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(p_resolution_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF octet_length(p_resolution_snapshot::text) > 524288 THEN
    RAISE EXCEPTION 'OC422 payload_too_large' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_req
  FROM public.omni_comms_request
  WHERE id = p_request_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT count(*) INTO v_existing_count
  FROM public.omni_comms_recipient WHERE request_id = p_request_id;

  IF v_existing_count > 0 THEN
    SELECT jsonb_agg(to_jsonb(rc.*) ORDER BY rc.created_at, rc.id)
      INTO v_persisted
    FROM public.omni_comms_recipient rc WHERE rc.request_id = p_request_id;
    RETURN jsonb_build_object(
      'request_id', v_req.id,
      'status',     v_req.status,
      'replayed',   true,
      'recipients', coalesce(v_persisted,'[]'::jsonb),
      'blockers',   v_req.blockers
    );
  END IF;

  IF v_req.status <> 'accepted' THEN
    RAISE EXCEPTION 'OC409 request_already_resolved' USING ERRCODE='P0001';
  END IF;

  UPDATE public.omni_comms_request
     SET status = 'processing', updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata,
    correlation_id, actor_type, actor_id
  ) VALUES (
    p_request_id, NULL, p_organization_id, 'request_processing',
    public.omni_comms_priv_next_event_sequence(p_request_id),
    'accepted', 'processing',
    jsonb_build_object(
      'snapshot_at',       p_resolution_snapshot->>'snapshot_at',
      'recipient_count',   jsonb_array_length(p_recipients)
    ),
    v_req.correlation_id, 'system', p_actor_id::text
  );

  FOR v_recipient IN SELECT * FROM jsonb_array_elements(p_recipients) LOOP
    v_role := nullif(btrim(coalesce(v_recipient->>'recipient_role','')), '');
    IF v_role IS NOT NULL AND v_role !~ '^[a-z][a-z0-9_]{0,63}$' THEN
      RAISE EXCEPTION 'OC422 recipient_role_invalid' USING ERRCODE='P0001';
    END IF;

    INSERT INTO public.omni_comms_recipient (
      request_id, organization_id, recipient_type, recipient_role,
      recipient_reference, display_name, locale, email_destination,
      phone_destination, push_destination, destination_snapshot,
      eligibility_status, resolved_channels, blockers, resolution_snapshot
    ) VALUES (
      p_request_id, p_organization_id,
      coalesce(v_recipient->>'recipient_type','person'),
      v_role,
      v_recipient->>'recipient_reference',
      v_recipient->>'display_name',
      v_recipient->>'locale',
      v_recipient->>'email_destination',
      v_recipient->>'phone_destination',
      v_recipient->>'push_destination',
      coalesce(v_recipient->'destination_snapshot','{}'::jsonb),
      coalesce(v_recipient->>'eligibility_status','pending'),
      COALESCE(
        (SELECT array_agg(x)::text[]
           FROM jsonb_array_elements_text(v_recipient->'resolved_channels') AS t(x)),
        ARRAY[]::text[]
      ),
      coalesce(v_recipient->'blockers','[]'::jsonb),
      coalesce(v_recipient->'per_recipient_snapshot','{}'::jsonb)
    ) RETURNING id INTO v_recipient_id;

    v_event_type := CASE
      WHEN (v_recipient->>'eligibility_status') IN ('eligible','partially_eligible')
        THEN 'recipient_resolved'
      ELSE 'recipient_blocked'
    END;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata,
      correlation_id, actor_type, actor_id
    ) VALUES (
      p_request_id, NULL, p_organization_id, v_event_type,
      public.omni_comms_priv_next_event_sequence(p_request_id),
      NULL, NULL,
      jsonb_build_object(
        'recipient_id',       v_recipient_id,
        'recipient_role',     v_role,
        'eligibility_status', v_recipient->>'eligibility_status',
        'resolved_channels',  coalesce(v_recipient->'resolved_channels','[]'::jsonb),
        'blocker_count',      coalesce(jsonb_array_length(v_recipient->'blockers'),0)
      ),
      v_req.correlation_id, 'system', p_actor_id::text
    );
  END LOOP;

  UPDATE public.omni_comms_request
     SET blockers = coalesce(
           (SELECT jsonb_agg(to_jsonb(b))
              FROM unnest(coalesce(p_request_blockers, ARRAY[]::text[])) AS b),
           '[]'::jsonb),
         updated_at = now()
   WHERE id = p_request_id;

  IF p_final_status = 'blocked' THEN
    UPDATE public.omni_comms_request
       SET status = 'blocked', failed_at = now(), updated_at = now()
     WHERE id = p_request_id;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata,
      correlation_id, actor_type, actor_id
    ) VALUES (
      p_request_id, NULL, p_organization_id, 'request_failed',
      public.omni_comms_priv_next_event_sequence(p_request_id),
      'processing', 'blocked',
      jsonb_build_object(
        'blockers',
        coalesce(to_jsonb(p_request_blockers), '[]'::jsonb)
      ),
      v_req.correlation_id, 'system', p_actor_id::text
    );
  END IF;

  SELECT jsonb_agg(to_jsonb(rc.*) ORDER BY rc.created_at, rc.id)
    INTO v_persisted
  FROM public.omni_comms_recipient rc WHERE rc.request_id = p_request_id;

  SELECT * INTO v_req FROM public.omni_comms_request WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'status',     v_req.status,
    'replayed',   false,
    'recipients', coalesce(v_persisted,'[]'::jsonb),
    'blockers',   v_req.blockers
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- load_persisted_recipients: project the first-class role + business context.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_load_persisted_recipients(
  p_actor_id uuid, p_request_id uuid, p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_req record;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  SELECT id, status, mode, business_context_snapshot INTO v_req
  FROM public.omni_comms_request
  WHERE id = p_request_id AND organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'status',     v_req.status,
    'mode',       v_req.mode,
    'business_context_snapshot', coalesce(v_req.business_context_snapshot, '{}'::jsonb),
    'recipients', coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'recipient_id',        rc.id,
                 'input_index',         nullif(
                                          coalesce(
                                            rc.resolution_snapshot->>'input_index',
                                            rc.resolution_snapshot->'per_recipient_snapshot'->>'input_index'
                                          ), '')::int,
                 'recipient_reference', rc.recipient_reference,
                 'recipient_role',      rc.recipient_role,
                 'resolved_channels',   to_jsonb(coalesce(rc.resolved_channels, ARRAY[]::text[])),
                 'eligibility_status',  rc.eligibility_status,
                 'blockers',            coalesce(rc.blockers, '[]'::jsonb)
               )
               ORDER BY nullif(
                          coalesce(
                            rc.resolution_snapshot->>'input_index',
                            rc.resolution_snapshot->'per_recipient_snapshot'->>'input_index'
                          ), '')::int NULLS LAST,
                        rc.created_at, rc.id
             )
      FROM public.omni_comms_recipient rc
      WHERE rc.request_id = p_request_id
        AND rc.organization_id = p_organization_id
    ), '[]'::jsonb)
  );
END;
$function$;
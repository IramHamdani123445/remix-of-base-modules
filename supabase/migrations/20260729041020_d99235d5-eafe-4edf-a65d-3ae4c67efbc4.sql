
-- ============================================================================
-- Omni-Comms — Accelerated Build 3, Slice 2c-ii, Batch A
-- Server-side runtime resolution + persistence foundation.
-- All new/updated functions: SECURITY DEFINER, owner=postgres,
-- SET search_path=pg_catalog,public, EXECUTE granted only to service_role.
-- No new tables. No data mutations to existing rows. Read-only aggregate
-- snapshot; controlled write path via finalize_resolution.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Private helper: per-request message_event sequence allocator.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_next_event_sequence(
  p_request_id uuid
) RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $function$
  SELECT coalesce(max(event_sequence), 0) + 1
  FROM public.omni_comms_message_event
  WHERE request_id = p_request_id;
$function$;
ALTER FUNCTION public.omni_comms_priv_next_event_sequence(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_next_event_sequence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_next_event_sequence(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_next_event_sequence(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.omni_comms_priv_next_event_sequence(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 2) Repair existing send-communication so request_accepted event uses the
--    actual deployed message_event columns. Signature unchanged.
-- ---------------------------------------------------------------------------
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
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $function$
DECLARE
  v_event_id  uuid;
  v_caller    text := coalesce(nullif(btrim(p_caller_module_code), ''), 'OMNI_COMMS_DIRECT');
  v_existing  record;
  v_chan      text;
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

  SELECT id INTO v_event_id
  FROM public.omni_comms_event_definition
  WHERE code = btrim(p_event_code);
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'OC404 event_code_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at, r.idempotency_key
    INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id    = p_organization_id
    AND r.caller_module_code = v_caller
    AND r.idempotency_key    = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE='P0001';
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
      'replayed',        true
    );
  END;

  SELECT r.id, r.created_at, r.mode, r.status, r.idempotency_key, r.correlation_id
    INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id    = p_organization_id
    AND r.caller_module_code = v_caller
    AND r.idempotency_key    = p_idempotency_key;

  -- Correct message_event insert (actual deployed columns).
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
    'replayed',        false
  );
END
$function$;
ALTER FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]) TO service_role;


-- ---------------------------------------------------------------------------
-- 3) Aggregate resolution snapshot. Read-only; one MVCC snapshot via a
--    single statement of CTE-heavy jsonb aggregation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_runtime_resolution_snapshot(
  p_actor_id           uuid,
  p_organization_id    uuid,
  p_department_id      uuid,
  p_event_code         text,
  p_requested_channels text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $function$
DECLARE
  v_result jsonb;
  v_normalized_code text := btrim(coalesce(p_event_code,''));
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organization_required' USING ERRCODE='P0001';
  END IF;
  IF v_normalized_code = '' OR length(v_normalized_code) > 128 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  WITH
    ev AS (
      SELECT id, code, status, module_code, entity_type, communication_class,
             default_priority
      FROM public.omni_comms_event_definition
      WHERE code = v_normalized_code
    ),
    contracts AS (
      SELECT c.id, c.event_definition_id, c.version_number, c.checksum,
             c.status, c.json_schema, c.published_at
      FROM public.omni_comms_event_contract c
      WHERE c.event_definition_id IN (SELECT id FROM ev)
        AND c.status = 'published'
    ),
    routes AS (
      SELECT r.id, r.organization_id, r.department_id, r.event_definition_id,
             r.channel, r.is_required, r.is_enabled, r.priority,
             r.template_family_id, r.sender_identity_id,
             r.sender_resolution_policy, r.preference_policy,
             r.lifecycle_state, r.created_at
      FROM public.omni_comms_event_route r
      WHERE r.event_definition_id IN (SELECT id FROM ev)
        AND r.organization_id = p_organization_id
        AND r.is_enabled = true
        AND r.lifecycle_state = 'active'
        AND (r.department_id IS NULL OR r.department_id = p_department_id)
    ),
    routes_ranked AS (
      SELECT r.*,
        ROW_NUMBER() OVER (
          PARTITION BY channel
          ORDER BY
            CASE WHEN r.department_id IS NOT NULL AND r.department_id = p_department_id
                 THEN 0 ELSE 1 END,
            r.priority ASC,
            r.created_at DESC,
            r.id
        ) AS rk
      FROM routes r
    ),
    winning_routes AS (
      SELECT * FROM routes_ranked WHERE rk = 1
    ),
    filtered_routes AS (
      SELECT wr.*
      FROM winning_routes wr
      WHERE coalesce(array_length(p_requested_channels,1),0) = 0
         OR wr.channel = ANY(p_requested_channels)
    ),
    channel_settings AS (
      SELECT cs.id, cs.organization_id, cs.department_id, cs.channel,
             cs.enabled, cs.live_delivery_enabled
      FROM public.omni_comms_channel_setting cs
      WHERE cs.organization_id = p_organization_id
        AND (cs.department_id IS NULL OR cs.department_id = p_department_id)
    ),
    template_families AS (
      SELECT tf.id, tf.code, tf.scope_type, tf.organization_id,
             tf.department_id, tf.event_definition_id, tf.status
      FROM public.omni_comms_template_family tf
      WHERE tf.organization_id = p_organization_id
        AND tf.status = 'active'
        AND (tf.department_id IS NULL OR tf.department_id = p_department_id)
        AND (tf.event_definition_id IS NULL
             OR tf.event_definition_id IN (SELECT id FROM ev))
    ),
    template_versions AS (
      SELECT tv.id, tv.template_family_id, tv.version_number, tv.channel,
             tv.locale, tv.content, tv.checksum, tv.status,
             tv.layout_selection_mode, tv.layout_id, tv.pinned_layout_version_id
      FROM public.omni_comms_template_version tv
      WHERE tv.status = 'published'
        AND tv.template_family_id IN (SELECT id FROM template_families)
    ),
    layouts AS (
      SELECT l.id, l.code, l.name, l.is_active, l.layout_kind
      FROM public.core_template_layout l
      WHERE l.is_active = true
    ),
    layout_versions AS (
      SELECT lv.id, lv.layout_id, lv.version_number, lv.slots,
             lv.wrapper_html, lv.checksum, lv.status
      FROM public.core_template_layout_version lv
      WHERE lv.status = 'published'
    ),
    layout_assignments AS (
      SELECT ca.id, ca.organization_id, ca.department_id, ca.output_channel,
             ca.layout_id
      FROM public.core_comm_assignment ca
      WHERE ca.assignment_kind = 'layout_default'
        AND ca.organization_id = p_organization_id
        AND (ca.department_id IS NULL OR ca.department_id = p_department_id)
    ),
    asset_assignments AS (
      SELECT ca.id, ca.organization_id, ca.department_id, ca.output_channel,
             ca.slot_code, ca.asset_id
      FROM public.core_comm_assignment ca
      WHERE ca.assignment_kind = 'asset_slot'
        AND ca.organization_id = p_organization_id
        AND (ca.department_id IS NULL OR ca.department_id = p_department_id)
    ),
    assets AS (
      SELECT a.id, a.organization_id, a.department_id, a.asset_type,
             a.code, a.status, a.active_version_id
      FROM public.core_comm_asset a
      WHERE a.organization_id = p_organization_id
        AND a.status = 'active'
    ),
    asset_versions AS (
      SELECT av.id, av.asset_id, av.version_number, av.checksum, av.status,
             av.content_html, av.content_text, av.content_json,
             av.storage_bucket, av.storage_object_path
      FROM public.core_comm_asset_version av
      WHERE av.status = 'published'
        AND av.asset_id IN (SELECT id FROM assets)
    ),
    senders AS (
      SELECT s.id, s.organization_id, s.department_id, s.event_definition_id,
             s.code, s.channel, s.from_address, s.from_name,
             s.reply_to_address, s.status
      FROM public.omni_comms_sender_identity s
      WHERE s.organization_id = p_organization_id
        AND s.status = 'active'
        AND (s.department_id IS NULL OR s.department_id = p_department_id)
        AND (s.event_definition_id IS NULL
             OR s.event_definition_id IN (SELECT id FROM ev))
    ),
    bindings AS (
      SELECT b.id, b.sender_identity_id, b.provider_account_id, b.priority,
             b.verification_status, b.status
      FROM public.omni_comms_sender_provider_binding b
      WHERE b.status = 'active'
        AND b.sender_identity_id IN (SELECT id FROM senders)
    ),
    provider_accounts AS (
      SELECT pa.id, pa.organization_id, pa.provider_id, pa.code, pa.status,
             pa.health_state, pa.sandbox_mode,
             (pa.secret_ref IS NOT NULL AND length(pa.secret_ref) > 0)
               AS secret_reference_configured
      FROM public.omni_comms_provider_account pa
      WHERE pa.organization_id = p_organization_id
        AND pa.status = 'active'
        AND pa.id IN (SELECT provider_account_id FROM bindings)
    ),
    providers AS (
      SELECT p.id, p.code, p.display_name, p.channel, p.adapter_key, p.status
      FROM public.omni_comms_provider p
      WHERE p.status = 'active'
        AND p.id IN (SELECT provider_id FROM provider_accounts)
    )
  SELECT jsonb_build_object(
    'snapshot_at',        now(),
    'organization_id',    p_organization_id,
    'department_id',      p_department_id,
    'requested_channels', coalesce(to_jsonb(p_requested_channels), '[]'::jsonb),
    'event',              (SELECT to_jsonb(ev.*) FROM ev),
    'event_contracts',
      coalesce((SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.version_number DESC)
                  FROM contracts c), '[]'::jsonb),
    'routes',
      coalesce((SELECT jsonb_agg(to_jsonb(fr.*) ORDER BY fr.channel)
                  FROM filtered_routes fr), '[]'::jsonb),
    'channel_settings',
      coalesce((SELECT jsonb_agg(to_jsonb(cs.*)) FROM channel_settings cs), '[]'::jsonb),
    'template_families',
      coalesce((SELECT jsonb_agg(to_jsonb(tf.*)) FROM template_families tf), '[]'::jsonb),
    'template_versions',
      coalesce((SELECT jsonb_agg(to_jsonb(tv.*)) FROM template_versions tv), '[]'::jsonb),
    'layouts',
      coalesce((SELECT jsonb_agg(to_jsonb(l.*)) FROM layouts l), '[]'::jsonb),
    'layout_versions',
      coalesce((SELECT jsonb_agg(to_jsonb(lv.*)) FROM layout_versions lv), '[]'::jsonb),
    'layout_assignments',
      coalesce((SELECT jsonb_agg(to_jsonb(la.*)) FROM layout_assignments la), '[]'::jsonb),
    'asset_assignments',
      coalesce((SELECT jsonb_agg(to_jsonb(aa.*)) FROM asset_assignments aa), '[]'::jsonb),
    'assets',
      coalesce((SELECT jsonb_agg(to_jsonb(a.*)) FROM assets a), '[]'::jsonb),
    'asset_versions',
      coalesce((SELECT jsonb_agg(to_jsonb(av.*)) FROM asset_versions av), '[]'::jsonb),
    'senders',
      coalesce((SELECT jsonb_agg(to_jsonb(s.*)) FROM senders s), '[]'::jsonb),
    'bindings',
      coalesce((SELECT jsonb_agg(to_jsonb(b.*)) FROM bindings b), '[]'::jsonb),
    'providers',
      coalesce((SELECT jsonb_agg(to_jsonb(p.*)) FROM providers p), '[]'::jsonb),
    'provider_accounts',
      coalesce((SELECT jsonb_agg(to_jsonb(pa.*)) FROM provider_accounts pa), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END
$function$;
ALTER FUNCTION public.omni_comms_priv_runtime_resolution_snapshot(uuid, uuid, uuid, text, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_resolution_snapshot(uuid, uuid, uuid, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_resolution_snapshot(uuid, uuid, uuid, text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_resolution_snapshot(uuid, uuid, uuid, text, text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.omni_comms_priv_runtime_resolution_snapshot(uuid, uuid, uuid, text, text[]) TO service_role;


-- ---------------------------------------------------------------------------
-- 4) Finalize resolution: atomic recipient persistence + status transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_finalize_resolution(
  p_actor_id             uuid,
  p_request_id           uuid,
  p_organization_id      uuid,
  p_resolution_snapshot  jsonb,
  p_recipients           jsonb,
  p_request_blockers     text[],
  p_final_status         text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $function$
DECLARE
  v_req                record;
  v_recipient          jsonb;
  v_recipient_id       uuid;
  v_existing_count     int;
  v_persisted          jsonb := '[]'::jsonb;
  v_event_type         text;
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

  -- Replay guard: if recipients already exist, return them without new writes.
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

  -- Transition accepted -> processing.
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

  -- Insert recipients + per-recipient events.
  FOR v_recipient IN SELECT * FROM jsonb_array_elements(p_recipients) LOOP
    INSERT INTO public.omni_comms_recipient (
      request_id, organization_id, recipient_type, recipient_reference,
      display_name, locale, email_destination, phone_destination,
      push_destination, destination_snapshot, eligibility_status,
      resolved_channels, blockers, resolution_snapshot
    ) VALUES (
      p_request_id, p_organization_id,
      coalesce(v_recipient->>'recipient_type','person'),
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
        'eligibility_status', v_recipient->>'eligibility_status',
        'resolved_channels',  coalesce(v_recipient->'resolved_channels','[]'::jsonb),
        'blocker_count',      coalesce(jsonb_array_length(v_recipient->'blockers'),0)
      ),
      v_req.correlation_id, 'system', p_actor_id::text
    );
  END LOOP;

  -- Persist request-level blockers.
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
ALTER FUNCTION public.omni_comms_priv_finalize_resolution(uuid, uuid, uuid, jsonb, jsonb, text[], text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_finalize_resolution(uuid, uuid, uuid, jsonb, jsonb, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_finalize_resolution(uuid, uuid, uuid, jsonb, jsonb, text[], text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_finalize_resolution(uuid, uuid, uuid, jsonb, jsonb, text[], text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.omni_comms_priv_finalize_resolution(uuid, uuid, uuid, jsonb, jsonb, text[], text) TO service_role;


-- ---------------------------------------------------------------------------
-- 5) Load persisted resolution for idempotent replay.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_load_persisted_resolution(
  p_actor_id        uuid,
  p_request_id      uuid,
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $function$
DECLARE
  v_req        record;
  v_recipients jsonb;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_req
  FROM public.omni_comms_request
  WHERE id = p_request_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT jsonb_agg(to_jsonb(rc.*) ORDER BY rc.created_at, rc.id)
    INTO v_recipients
  FROM public.omni_comms_recipient rc WHERE rc.request_id = p_request_id;

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'status',     v_req.status,
    'replayed',   true,
    'recipients', coalesce(v_recipients,'[]'::jsonb),
    'blockers',   v_req.blockers
  );
END
$function$;
ALTER FUNCTION public.omni_comms_priv_load_persisted_resolution(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_resolution(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_resolution(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_resolution(uuid, uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.omni_comms_priv_load_persisted_resolution(uuid, uuid, uuid) TO service_role;

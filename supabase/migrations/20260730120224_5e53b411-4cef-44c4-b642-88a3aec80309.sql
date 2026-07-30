-- ============================================================================
-- Omni-Comms Accelerated Build 3 — Slice 2c-iii (Batch B)
-- Rendering context loading + atomic message / event / held-job persistence.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.omni_comms_priv_load_render_context(
  p_actor_id        uuid,
  p_request_id      uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_req            record;
  v_template_ids   uuid[];
  v_layout_ids     uuid[];
  v_asset_ids      uuid[];
  v_sender_ids     uuid[];
  v_result         jsonb;
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

  WITH res AS (
    SELECT jsonb_array_elements(
             coalesce(rc.resolution_snapshot->'channel_resolutions','[]'::jsonb)
           ) AS r
    FROM public.omni_comms_recipient rc
    WHERE rc.request_id = p_request_id
  )
  SELECT
    coalesce(array_agg(DISTINCT (r->>'template_version_id')::uuid)
             FILTER (WHERE r->>'template_version_id' IS NOT NULL), '{}'),
    coalesce(array_agg(DISTINCT (r->>'layout_version_id')::uuid)
             FILTER (WHERE r->>'layout_version_id' IS NOT NULL), '{}'),
    coalesce(array_agg(DISTINCT (r->>'sender_identity_id')::uuid)
             FILTER (WHERE r->>'sender_identity_id' IS NOT NULL), '{}')
  INTO v_template_ids, v_layout_ids, v_sender_ids
  FROM res;

  WITH res AS (
    SELECT jsonb_array_elements(
             coalesce(rc.resolution_snapshot->'channel_resolutions','[]'::jsonb)
           ) AS r
    FROM public.omni_comms_recipient rc
    WHERE rc.request_id = p_request_id
  ), av AS (
    SELECT jsonb_array_elements(coalesce(r->'assets','[]'::jsonb)) AS a FROM res
  )
  SELECT coalesce(array_agg(DISTINCT (a->>'asset_version_id')::uuid)
                  FILTER (WHERE a->>'asset_version_id' IS NOT NULL), '{}')
  INTO v_asset_ids
  FROM av;

  SELECT jsonb_build_object(
    'request', jsonb_build_object(
      'id',                  v_req.id,
      'organization_id',     v_req.organization_id,
      'department_id',       v_req.department_id,
      'event_definition_id', v_req.event_definition_id,
      'mode',                v_req.mode,
      'status',              v_req.status,
      'payload_snapshot',    v_req.payload_snapshot,
      'correlation_id',      v_req.correlation_id
    ),
    'recipients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id',                   rc.id,
               'recipient_type',       rc.recipient_type,
               'recipient_reference',  rc.recipient_reference,
               'display_name',         rc.display_name,
               'locale',               rc.locale,
               'destination_snapshot', rc.destination_snapshot,
               'eligibility_status',   rc.eligibility_status,
               'resolved_channels',    to_jsonb(rc.resolved_channels),
               'blockers',             rc.blockers,
               'resolution_snapshot',  rc.resolution_snapshot
             ) ORDER BY rc.created_at, rc.id)
      FROM public.omni_comms_recipient rc
      WHERE rc.request_id = p_request_id
    ), '[]'::jsonb),
    'template_versions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', tv.id, 'template_family_id', tv.template_family_id,
               'version_number', tv.version_number, 'channel', tv.channel,
               'locale', tv.locale, 'checksum', tv.checksum,
               'status', tv.status, 'content', tv.content
             ) ORDER BY tv.id)
      FROM public.omni_comms_template_version tv
      WHERE tv.id = ANY(v_template_ids)
    ), '[]'::jsonb),
    'layout_versions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', lv.id, 'layout_id', lv.layout_id,
               'version_number', lv.version_number, 'checksum', lv.checksum,
               'status', lv.status, 'wrapper_html', lv.wrapper_html,
               'slots', lv.slots
             ) ORDER BY lv.id)
      FROM public.core_template_layout_version lv
      WHERE lv.id = ANY(v_layout_ids)
    ), '[]'::jsonb),
    'asset_versions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', av.id, 'asset_id', av.asset_id,
               'version_number', av.version_number, 'checksum', av.checksum,
               'status', av.status
             ) ORDER BY av.id)
      FROM public.core_comm_asset_version av
      WHERE av.id = ANY(v_asset_ids)
    ), '[]'::jsonb),
    'senders', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'code', s.code, 'channel', s.channel,
               'from_address', s.from_address, 'from_name', s.from_name,
               'reply_to_address', s.reply_to_address, 'status', s.status,
               'organization_id', s.organization_id,
               'department_id', s.department_id
             ) ORDER BY s.id)
      FROM public.omni_comms_sender_identity s
      WHERE s.id = ANY(v_sender_ids)
    ), '[]'::jsonb),
    'channel_settings', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', cs.id, 'channel', cs.channel, 'enabled', cs.enabled,
               'live_delivery_enabled', cs.live_delivery_enabled,
               'organization_id', cs.organization_id,
               'department_id', cs.department_id
             ) ORDER BY cs.channel, cs.id)
      FROM public.omni_comms_channel_setting cs
      WHERE cs.organization_id = p_organization_id
        AND (cs.department_id IS NULL OR cs.department_id = v_req.department_id)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_load_render_context(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_render_context(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_render_context(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_load_render_context(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_persist_rendered_messages(
  p_actor_id         uuid,
  p_request_id       uuid,
  p_organization_id  uuid,
  p_messages         jsonb,
  p_jobs             jsonb,
  p_success_status   text,
  p_request_blockers text[],
  p_final_status     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_req           record;
  v_existing      int;
  v_msg           jsonb;
  v_job           jsonb;
  v_message_id    uuid;
  v_message_ids   uuid[] := '{}';
  v_idx           int;
  v_status        text;
  v_event_type    text;
  v_rendered      int := 0;
  v_blocked       int := 0;
  v_jobs_created  int := 0;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(p_messages) <> 'array' OR jsonb_typeof(p_jobs) <> 'array' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF p_success_status NOT IN ('dry_run_completed','shadow_completed','held') THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF p_final_status NOT IN ('completed','completed_with_blockers','blocked') THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_req
  FROM public.omni_comms_request
  WHERE id = p_request_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;

  IF v_req.mode = 'dry_run' AND jsonb_array_length(p_jobs) > 0 THEN
    RAISE EXCEPTION 'OC422 dry_run_jobs_forbidden' USING ERRCODE='P0001';
  END IF;
  IF v_req.mode = 'dry_run' AND p_success_status <> 'dry_run_completed' THEN
    RAISE EXCEPTION 'OC422 mode_status_mismatch' USING ERRCODE='P0001';
  END IF;
  IF v_req.mode = 'shadow' AND p_success_status <> 'shadow_completed' THEN
    RAISE EXCEPTION 'OC422 mode_status_mismatch' USING ERRCODE='P0001';
  END IF;
  IF v_req.mode = 'queued' AND p_success_status <> 'held' THEN
    RAISE EXCEPTION 'OC422 mode_status_mismatch' USING ERRCODE='P0001';
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.omni_comms_message WHERE request_id = p_request_id;

  IF v_existing > 0 THEN
    RETURN jsonb_build_object(
      'request_id', v_req.id,
      'status',     v_req.status,
      'replayed',   true,
      'messages',   coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'recipient_id', m.recipient_id,
                 'channel', m.channel, 'status', m.status,
                 'rendered_checksum', m.rendered_checksum,
                 'blockers', m.blockers)
               ORDER BY m.created_at, m.id)
        FROM public.omni_comms_message m WHERE m.request_id = p_request_id
      ), '[]'::jsonb)
    );
  END IF;

  IF v_req.status <> 'processing' THEN
    RAISE EXCEPTION 'OC409 request_not_processing' USING ERRCODE='P0001';
  END IF;

  FOR v_msg IN SELECT * FROM jsonb_array_elements(p_messages) LOOP
    v_status := coalesce(v_msg->>'status','blocked');
    IF v_status NOT IN ('rendered','blocked') THEN
      RAISE EXCEPTION 'OC422 invalid_message_status' USING ERRCODE='P0001';
    END IF;

    INSERT INTO public.omni_comms_message (
      request_id, recipient_id, organization_id, department_id,
      event_definition_id, event_route_id, channel,
      template_family_id, template_version_id, layout_id, layout_version_id,
      resolved_asset_manifest, sender_identity_id, provider_id,
      provider_account_id, channel_setting_snapshot, destination_snapshot,
      rendered_subject, rendered_html, rendered_text,
      unresolved_tokens, unresolved_required_slots, rendered_checksum,
      status, blockers, rendered_at
    ) VALUES (
      p_request_id,
      (v_msg->>'recipient_id')::uuid,
      p_organization_id,
      v_req.department_id,
      v_req.event_definition_id,
      nullif(v_msg->>'event_route_id','')::uuid,
      v_msg->>'channel',
      nullif(v_msg->>'template_family_id','')::uuid,
      nullif(v_msg->>'template_version_id','')::uuid,
      nullif(v_msg->>'layout_id','')::uuid,
      nullif(v_msg->>'layout_version_id','')::uuid,
      coalesce(v_msg->'resolved_asset_manifest','{}'::jsonb),
      nullif(v_msg->>'sender_identity_id','')::uuid,
      nullif(v_msg->>'provider_id','')::uuid,
      nullif(v_msg->>'provider_account_id','')::uuid,
      coalesce(v_msg->'channel_setting_snapshot','{}'::jsonb),
      coalesce(v_msg->'destination_snapshot','{}'::jsonb),
      v_msg->>'rendered_subject',
      v_msg->>'rendered_html',
      v_msg->>'rendered_text',
      coalesce(v_msg->'unresolved_tokens','[]'::jsonb),
      coalesce(v_msg->'unresolved_required_slots','[]'::jsonb),
      nullif(v_msg->>'rendered_checksum',''),
      v_status,
      coalesce(v_msg->'blockers','[]'::jsonb),
      CASE WHEN v_status = 'rendered' THEN now() ELSE NULL END
    ) RETURNING id INTO v_message_id;

    v_message_ids := v_message_ids || v_message_id;

    IF v_status = 'rendered' THEN
      v_rendered := v_rendered + 1;
      v_event_type := 'message_rendered';
    ELSE
      v_blocked := v_blocked + 1;
      v_event_type := 'message_blocked';
    END IF;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id,
      actor_type, actor_id
    ) VALUES (
      p_request_id, v_message_id, p_organization_id, v_event_type,
      public.omni_comms_priv_next_event_sequence(p_request_id),
      NULL, v_status,
      jsonb_build_object(
        'channel',                    v_msg->>'channel',
        'template_version_id',        v_msg->>'template_version_id',
        'layout_version_id',          v_msg->>'layout_version_id',
        'rendered_checksum',          v_msg->>'rendered_checksum',
        'unresolved_token_count',     coalesce(jsonb_array_length(v_msg->'unresolved_tokens'),0),
        'unresolved_slot_count',      coalesce(jsonb_array_length(v_msg->'unresolved_required_slots'),0),
        'blockers',                   coalesce(v_msg->'blockers','[]'::jsonb)
      ),
      v_req.correlation_id, 'system', p_actor_id::text
    );
  END LOOP;

  IF v_rendered > 0 THEN
    UPDATE public.omni_comms_message
       SET status = p_success_status,
           queued_at = CASE WHEN p_success_status = 'held' THEN now() ELSE queued_at END,
           completed_at = CASE
             WHEN p_success_status IN ('dry_run_completed','shadow_completed')
             THEN now() ELSE completed_at END,
           updated_at = now()
     WHERE request_id = p_request_id AND status = 'rendered';

    IF p_success_status IN ('dry_run_completed','shadow_completed') THEN
      INSERT INTO public.omni_comms_message_event (
        request_id, message_id, organization_id, event_type, event_sequence,
        status_before, status_after, safe_metadata, correlation_id,
        actor_type, actor_id
      )
      SELECT p_request_id, m.id, p_organization_id,
             CASE WHEN p_success_status = 'dry_run_completed'
                  THEN 'dry_run_completed' ELSE 'shadow_completed' END,
             public.omni_comms_priv_next_event_sequence(p_request_id),
             'rendered', p_success_status,
             jsonb_build_object('channel', m.channel, 'mode', v_req.mode),
             v_req.correlation_id, 'system', p_actor_id::text
        FROM public.omni_comms_message m
       WHERE m.request_id = p_request_id AND m.status = p_success_status
       ORDER BY m.created_at, m.id;
    END IF;
  END IF;

  FOR v_job IN SELECT * FROM jsonb_array_elements(p_jobs) LOOP
    IF coalesce(v_job->>'status','') <> 'held'
       OR coalesce((v_job->>'is_runnable')::boolean, true) <> false THEN
      RAISE EXCEPTION 'OC422 runnable_job_forbidden' USING ERRCODE='P0001';
    END IF;

    v_idx := (v_job->>'message_index')::int;
    IF v_idx IS NULL OR v_idx < 0 OR v_idx >= coalesce(array_length(v_message_ids,1),0) THEN
      RAISE EXCEPTION 'OC422 invalid_job_message_index' USING ERRCODE='P0001';
    END IF;
    v_message_id := v_message_ids[v_idx + 1];

    INSERT INTO public.omni_comms_dispatch_job (
      request_id, message_id, organization_id, channel, mode, status,
      priority, scheduled_at, next_attempt_at, attempt_count, max_attempts,
      correlation_id, is_runnable, hold_reason
    ) VALUES (
      p_request_id, v_message_id, p_organization_id,
      v_job->>'channel', v_req.mode, 'held',
      100, NULL, NULL, 0, 5,
      v_req.correlation_id, false,
      left(coalesce(v_job->>'hold_reason','runtime_hold'), 200)
    );
    v_jobs_created := v_jobs_created + 1;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id,
      actor_type, actor_id
    ) VALUES (
      p_request_id, v_message_id, p_organization_id, 'dispatch_held',
      public.omni_comms_priv_next_event_sequence(p_request_id),
      'rendered', 'held',
      jsonb_build_object(
        'channel',     v_job->>'channel',
        'mode',        v_req.mode,
        'hold_reason', v_job->>'hold_reason',
        'is_runnable', false
      ),
      v_req.correlation_id, 'system', p_actor_id::text
    );
  END LOOP;

  UPDATE public.omni_comms_request
     SET status = p_final_status,
         blockers = coalesce(
           (SELECT jsonb_agg(to_jsonb(b))
              FROM unnest(coalesce(p_request_blockers, ARRAY[]::text[])) AS b),
           '[]'::jsonb),
         completed_at = CASE WHEN p_final_status <> 'blocked' THEN now() ELSE completed_at END,
         failed_at    = CASE WHEN p_final_status = 'blocked' THEN now() ELSE failed_at END,
         updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata, correlation_id,
    actor_type, actor_id
  ) VALUES (
    p_request_id, NULL, p_organization_id, 'request_completed',
    public.omni_comms_priv_next_event_sequence(p_request_id),
    'processing', p_final_status,
    jsonb_build_object(
      'mode',            v_req.mode,
      'message_count',   coalesce(array_length(v_message_ids,1),0),
      'rendered_count',  v_rendered,
      'blocked_count',   v_blocked,
      'held_job_count',  v_jobs_created,
      'runnable_jobs',   0
    ),
    v_req.correlation_id, 'system', p_actor_id::text
  );

  RETURN jsonb_build_object(
    'request_id',     p_request_id,
    'status',         p_final_status,
    'replayed',       false,
    'message_count',  coalesce(array_length(v_message_ids,1),0),
    'rendered_count', v_rendered,
    'blocked_count',  v_blocked,
    'held_job_count', v_jobs_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_persist_rendered_messages(uuid, uuid, uuid, jsonb, jsonb, text, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_persist_rendered_messages(uuid, uuid, uuid, jsonb, jsonb, text, text[], text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_persist_rendered_messages(uuid, uuid, uuid, jsonb, jsonb, text, text[], text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_persist_rendered_messages(uuid, uuid, uuid, jsonb, jsonb, text, text[], text) TO service_role;
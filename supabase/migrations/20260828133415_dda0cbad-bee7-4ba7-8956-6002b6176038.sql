CREATE OR REPLACE FUNCTION public.omni_comms_priv_persist_rendered_messages(p_actor_id uuid, p_request_id uuid, p_organization_id uuid, p_messages jsonb, p_jobs jsonb, p_success_status text, p_request_blockers text[], p_final_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_recip_hash text;
  v_adapter text;
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
  v_runnable_jobs int := 0;
  v_proposed      boolean;
  v_authz         text;
  v_effective     boolean;
  v_reason        text;
  v_job_status    text;
  v_msg_dept      uuid;
  v_module        text;
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
      action_id, action_channel_option_id, delivery_policy_id,
      delivery_leg_key, resolution_reason,
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
      nullif(v_msg->>'action_id','')::uuid,
      nullif(v_msg->>'action_channel_option_id','')::uuid,
      nullif(v_msg->>'delivery_policy_id','')::uuid,
      nullif(v_msg->>'delivery_leg_key',''),
      CASE WHEN v_msg->'resolution_reason' IS NULL
             OR jsonb_typeof(v_msg->'resolution_reason') = 'null'
           THEN NULL ELSE v_msg->'resolution_reason' END,
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
        'delivery_leg_key',           v_msg->>'delivery_leg_key',
        'action_id',                  v_msg->>'action_id',
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
    IF coalesce(v_job->>'status','') NOT IN ('held','queued') THEN
      RAISE EXCEPTION 'OC422 invalid_job_status' USING ERRCODE='P0001';
    END IF;
    -- The Edge Function only ever PROPOSES a runnable job.
    v_proposed := coalesce((v_job->>'is_runnable')::boolean, false)
                  AND coalesce(v_job->>'status','') = 'queued'
                  AND v_req.mode = 'queued';

    v_idx := (v_job->>'message_index')::int;
    IF v_idx IS NULL OR v_idx < 0 OR v_idx >= coalesce(array_length(v_message_ids,1),0) THEN
      RAISE EXCEPTION 'OC422 invalid_job_message_index' USING ERRCODE='P0001';
    END IF;
    v_message_id := v_message_ids[v_idx + 1];

    SELECT m.department_id INTO v_msg_dept
      FROM public.omni_comms_message m WHERE m.id = v_message_id;
    SELECT r.caller_module_code INTO v_module
      FROM public.omni_comms_request r WHERE r.id = p_request_id;

    -- DEF-19: supply the recipient hash and resolved adapter so the database
    -- gate evaluates the governed allowlist and adapter posture itself.
    v_recip_hash := NULL;
    v_adapter := NULL;
    BEGIN
      SELECT public.omni_comms_priv_channel_test_normalize_target(
               CASE WHEN lower(m.channel) IN ('email','sms','whatsapp','voice')
                    THEN lower(m.channel) ELSE 'in_app' END,
               CASE lower(m.channel)
                 WHEN 'email'    THEN rc.email_destination
                 WHEN 'sms'      THEN rc.phone_destination
                 WHEN 'whatsapp' THEN rc.phone_destination
                 WHEN 'voice'    THEN rc.phone_destination
                 ELSE rc.recipient_reference
               END)->>'target_hash'
        INTO v_recip_hash
        FROM public.omni_comms_message m
        JOIN public.omni_comms_recipient rc ON rc.id = m.recipient_id
       WHERE m.id = v_message_id;
    EXCEPTION WHEN OTHERS THEN
      v_recip_hash := NULL;
    END;

    SELECT p.adapter_key INTO v_adapter
      FROM public.omni_comms_message m
      JOIN public.omni_comms_provider_account pa ON pa.id = m.provider_account_id
      JOIN public.omni_comms_provider p ON p.id = pa.provider_id
     WHERE m.id = v_message_id;
    IF v_adapter IS NULL AND lower(coalesce(v_job->>'channel','')) = 'in_app' THEN
      v_adapter := 'internal_in_app';
    END IF;

    v_authz := NULL;
    IF v_proposed THEN
      v_authz := public.omni_comms_priv_evaluate_dispatch_authorization(
        p_organization_id, v_msg_dept, v_job->>'channel',
        v_module, v_req.mode, v_recip_hash, v_adapter, v_req.created_at, NULL);
    END IF;

    v_effective  := v_proposed AND v_authz IS NULL;
    v_job_status := CASE WHEN v_effective THEN 'ready' ELSE 'held' END;
    v_reason     := CASE
                      WHEN v_effective THEN NULL
                      WHEN v_authz IS NOT NULL THEN left(v_authz, 200)
                      ELSE left(coalesce(v_job->>'hold_reason','runtime_hold'), 200)
                    END;
    IF v_effective THEN
      v_runnable_jobs := v_runnable_jobs + 1;
    END IF;

    INSERT INTO public.omni_comms_dispatch_job (
      request_id, message_id, organization_id, channel, mode, status,
      priority, scheduled_at, next_attempt_at, attempt_count, max_attempts,
      correlation_id, is_runnable, hold_reason
    ) VALUES (
      p_request_id, v_message_id, p_organization_id,
      v_job->>'channel', v_req.mode, v_job_status,
      100, NULL, NULL, 0, 5,
      v_req.correlation_id, v_effective,
      v_reason
    );
    v_jobs_created := v_jobs_created + 1;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id,
      actor_type, actor_id
    ) VALUES (
      p_request_id, v_message_id, p_organization_id,
      CASE WHEN v_effective THEN 'dispatch_ready' ELSE 'dispatch_held' END,
      public.omni_comms_priv_next_event_sequence(p_request_id),
      'rendered', v_job_status,
      jsonb_build_object(
        'channel',            v_job->>'channel',
        'mode',               v_req.mode,
        'hold_reason',        v_reason,
        'is_runnable',        v_effective,
        'proposed_runnable',  v_proposed,
        'database_decision',  coalesce(v_authz, 'authorized')
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
      'runnable_jobs',   v_runnable_jobs
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
    'held_job_count', v_jobs_created,
    'runnable_job_count', v_runnable_jobs
  );
END;
$function$;
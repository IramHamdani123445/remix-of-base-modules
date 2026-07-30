CREATE OR REPLACE FUNCTION public.omni_comms_event_route_list(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_event_definition_id uuid DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_lifecycle_state text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_rows jsonb; v_limit integer; v_offset integer;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required';
  END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit,100),1),500);
  v_offset := GREATEST(COALESCE(p_offset,0),0);

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'organization_id', r.organization_id,
      'department_id', r.department_id,
      'event_definition_id', r.event_definition_id,
      'event_code', d.code,
      'event_name', d.name,
      'channel', r.channel,
      'is_required', r.is_required,
      'is_enabled', r.is_enabled,
      'priority', r.priority,
      'template_family_id', r.template_family_id,
      'template_family_code', tf.code,
      'sender_identity_id', r.sender_identity_id,
      'sender_identity_code', si.code,
      'sender_resolution_policy', r.sender_resolution_policy,
      'preference_policy', r.preference_policy,
      'lifecycle_state', r.lifecycle_state,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    ) AS x
    FROM public.omni_comms_event_route r
    JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
    LEFT JOIN public.omni_comms_template_family tf ON tf.id = r.template_family_id
    LEFT JOIN public.omni_comms_sender_identity si ON si.id = r.sender_identity_id
    WHERE r.organization_id = p_organization_id
      AND (p_department_id IS NULL OR r.department_id IS NOT DISTINCT FROM p_department_id)
      AND (p_event_definition_id IS NULL OR r.event_definition_id = p_event_definition_id)
      AND (p_channel IS NULL OR r.channel = p_channel)
      AND (p_lifecycle_state IS NULL OR r.lifecycle_state = p_lifecycle_state)
    ORDER BY r.created_at
    LIMIT v_limit OFFSET v_offset
  ) s;

  RETURN v_rows;
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_event_route_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT to_jsonb(r) INTO v FROM public.omni_comms_event_route r WHERE r.id = p_id;
  IF v IS NULL THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_route'; END IF;
  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_event_route_upsert_draft(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_event_definition_id uuid,
  p_channel text,
  p_is_required boolean,
  p_is_enabled boolean,
  p_priority integer,
  p_template_family_id uuid,
  p_sender_identity_id uuid,
  p_sender_resolution_policy text,
  p_preference_policy text,
  p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid;
  v_before public.omni_comms_event_route%ROWTYPE;
  v_after  public.omni_comms_event_route%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');

  IF p_id IS NULL THEN
    IF p_organization_id IS NULL OR p_event_definition_id IS NULL OR p_channel IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_event_channel_required';
    END IF;
    BEGIN
      INSERT INTO public.omni_comms_event_route(
        organization_id, department_id, event_definition_id, channel,
        is_required, is_enabled, priority, template_family_id, sender_identity_id,
        sender_resolution_policy, preference_policy, lifecycle_state,
        created_by, updated_by)
      VALUES (p_organization_id, p_department_id, p_event_definition_id, p_channel,
        COALESCE(p_is_required,false), COALESCE(p_is_enabled,false),
        COALESCE(p_priority,100), p_template_family_id, p_sender_identity_id,
        COALESCE(p_sender_resolution_policy,'organisation_default'),
        COALESCE(p_preference_policy,'honour'), 'draft', v_uid, v_uid)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 duplicate_event_route' USING ERRCODE='P0001', DETAIL='org_dept_event_channel_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','event_route',v_after.id,v_after.channel,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_event_route WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_route'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.lifecycle_state = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='retired_route_immutable';
  END IF;

  BEGIN
    UPDATE public.omni_comms_event_route
       SET is_required = COALESCE(p_is_required, is_required),
           is_enabled = COALESCE(p_is_enabled, is_enabled),
           priority = COALESCE(p_priority, priority),
           template_family_id = p_template_family_id,
           sender_identity_id = p_sender_identity_id,
           sender_resolution_policy = COALESCE(p_sender_resolution_policy, sender_resolution_policy),
           preference_policy = COALESCE(p_preference_policy, preference_policy),
           updated_by = v_uid, updated_at = now()
     WHERE id = p_id RETURNING * INTO v_after;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update','event_route',p_id,v_after.channel,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_event_route_set_lifecycle(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_target_state text,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid;
  v_before public.omni_comms_event_route%ROWTYPE;
  v_after  public.omni_comms_event_route%ROWTYPE;
  v_reason text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_target_state NOT IN ('active','suspended','retired') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_target_state';
  END IF;
  v_reason := NULLIF(btrim(COALESCE(p_reason,'')),'');
  IF p_target_state IN ('suspended','retired') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reason_too_long';
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_event_route WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_route'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.lifecycle_state = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_retired';
  END IF;
  IF p_target_state = 'active' AND v_before.lifecycle_state NOT IN ('draft','suspended') THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='not_activatable';
  END IF;
  IF p_target_state = 'suspended' AND v_before.lifecycle_state <> 'active' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='not_suspendable';
  END IF;

  UPDATE public.omni_comms_event_route
     SET lifecycle_state = p_target_state,
         is_enabled = CASE WHEN p_target_state = 'active' THEN true
                           WHEN p_target_state IN ('suspended','retired') THEN false
                           ELSE is_enabled END,
         activated_at = CASE WHEN p_target_state='active' THEN now() ELSE activated_at END,
         activated_by = CASE WHEN p_target_state='active' THEN v_uid ELSE activated_by END,
         retired_at = CASE WHEN p_target_state='retired' THEN now() ELSE retired_at END,
         retired_by = CASE WHEN p_target_state='retired' THEN v_uid ELSE retired_by END,
         updated_by = v_uid, updated_at = now()
   WHERE id = p_id RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, p_target_state, 'event_route', p_id, v_after.channel,
    to_jsonb(v_before), to_jsonb(v_after) || jsonb_build_object('reason', v_reason), p_correlation_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_ops_summary(
  p_organization_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_since_hours integer DEFAULT 168
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_since timestamptz; v_requests jsonb; v_messages jsonb; v_jobs jsonb; v_attempts jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_since := now() - make_interval(hours => LEAST(GREATEST(COALESCE(p_since_hours,168),1), 8760));

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_requests
  FROM (SELECT status, count(*) n FROM public.omni_comms_request
         WHERE created_at >= v_since
           AND (p_organization_id IS NULL OR organization_id = p_organization_id)
           AND (p_department_id IS NULL OR department_id IS NOT DISTINCT FROM p_department_id)
         GROUP BY status) s;

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_messages
  FROM (SELECT m.status, count(*) n FROM public.omni_comms_message m
         WHERE m.created_at >= v_since
           AND (p_organization_id IS NULL OR m.organization_id = p_organization_id)
           AND (p_department_id IS NULL OR m.department_id IS NOT DISTINCT FROM p_department_id)
         GROUP BY m.status) s;

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_jobs
  FROM (SELECT j.status, count(*) n FROM public.omni_comms_dispatch_job j
         WHERE j.created_at >= v_since
           AND (p_organization_id IS NULL OR j.organization_id = p_organization_id)
         GROUP BY j.status) s;

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_attempts
  FROM (SELECT a.status, count(*) n FROM public.omni_comms_delivery_attempt a
         WHERE a.created_at >= v_since
           AND (p_organization_id IS NULL OR a.organization_id = p_organization_id)
         GROUP BY a.status) s;

  RETURN jsonb_build_object(
    'since', v_since,
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'requests_by_status', v_requests,
    'messages_by_status', v_messages,
    'dispatch_jobs_by_status', v_jobs,
    'delivery_attempts_by_status', v_attempts,
    'generated_at', now());
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_ops_request_list(
  p_organization_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_rows jsonb; v_limit integer; v_offset integer; v_q text;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_limit := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
  v_offset := GREATEST(COALESCE(p_offset,0),0);
  v_q := NULLIF(btrim(COALESCE(p_search,'')),'');
  IF v_q IS NOT NULL THEN v_q := '%' || public.omni_comms_priv_escape_ilike(v_q) || '%'; END IF;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'created_at', r.created_at,
      'status', r.status,
      'mode', r.mode,
      'event_code', d.code,
      'caller_module_code', r.caller_module_code,
      'caller_entity_type', r.caller_entity_type,
      'caller_entity_id', r.caller_entity_id,
      'correlation_id', r.correlation_id,
      'requested_channels', r.requested_channels,
      'blocker_count', COALESCE(jsonb_array_length(r.blockers), 0),
      'message_count', (SELECT count(*) FROM public.omni_comms_message m WHERE m.request_id = r.id)
    ) AS x
    FROM public.omni_comms_request r
    LEFT JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
    WHERE (p_organization_id IS NULL OR r.organization_id = p_organization_id)
      AND (p_department_id IS NULL OR r.department_id IS NOT DISTINCT FROM p_department_id)
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_mode IS NULL OR r.mode = p_mode)
      AND (v_q IS NULL OR d.code ILIKE v_q OR r.caller_module_code ILIKE v_q
           OR r.correlation_id ILIKE v_q OR r.caller_entity_id ILIKE v_q)
    ORDER BY r.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) s;

  RETURN v_rows;
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_ops_request_detail(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid; v_sensitive boolean; v_req record;
        v_recipients jsonb; v_messages jsonb; v_jobs jsonb; v_timeline jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_sensitive := public.has_permission(v_uid, 'omni_comms', 'view_sensitive_content');

  SELECT * INTO v_req FROM public.omni_comms_request WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='request'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'recipient_type', c.recipient_type,
      'display_name', CASE WHEN v_sensitive THEN c.display_name ELSE NULL END,
      'email_destination', CASE WHEN v_sensitive THEN c.email_destination ELSE NULL END,
      'phone_destination', CASE WHEN v_sensitive THEN c.phone_destination ELSE NULL END,
      'locale', c.locale,
      'eligibility_status', c.eligibility_status,
      'resolved_channels', c.resolved_channels,
      'blockers', c.blockers
    ) ORDER BY c.created_at), '[]'::jsonb) INTO v_recipients
  FROM public.omni_comms_recipient c WHERE c.request_id = p_request_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'recipient_id', m.recipient_id,
      'channel', m.channel,
      'status', m.status,
      'template_version_id', m.template_version_id,
      'rendered_checksum', m.rendered_checksum,
      'rendered_subject', CASE WHEN v_sensitive THEN m.rendered_subject ELSE NULL END,
      'rendered_html', CASE WHEN v_sensitive THEN m.rendered_html ELSE NULL END,
      'rendered_text', CASE WHEN v_sensitive THEN m.rendered_text ELSE NULL END,
      'content_redacted', NOT v_sensitive,
      'unresolved_tokens', m.unresolved_tokens,
      'unresolved_required_slots', m.unresolved_required_slots,
      'blockers', m.blockers,
      'created_at', m.created_at
    ) ORDER BY m.created_at), '[]'::jsonb) INTO v_messages
  FROM public.omni_comms_message m WHERE m.request_id = p_request_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', j.id, 'message_id', j.message_id, 'channel', j.channel,
      'mode', j.mode, 'status', j.status, 'priority', j.priority,
      'attempt_count', j.attempt_count, 'max_attempts', j.max_attempts,
      'is_runnable', j.is_runnable, 'hold_reason', j.hold_reason,
      'scheduled_at', j.scheduled_at, 'next_attempt_at', j.next_attempt_at,
      'created_at', j.created_at
    ) ORDER BY j.created_at), '[]'::jsonb) INTO v_jobs
  FROM public.omni_comms_dispatch_job j WHERE j.request_id = p_request_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'message_id', e.message_id, 'event_type', e.event_type,
      'event_sequence', e.event_sequence, 'status_before', e.status_before,
      'status_after', e.status_after, 'summary', e.summary,
      'safe_metadata', e.safe_metadata, 'actor_type', e.actor_type,
      'created_at', e.created_at
    ) ORDER BY e.event_sequence), '[]'::jsonb) INTO v_timeline
  FROM public.omni_comms_message_event e WHERE e.request_id = p_request_id;

  RETURN jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_req.id, 'organization_id', v_req.organization_id,
      'department_id', v_req.department_id, 'status', v_req.status, 'mode', v_req.mode,
      'event_definition_id', v_req.event_definition_id,
      'event_code', (SELECT code FROM public.omni_comms_event_definition WHERE id = v_req.event_definition_id),
      'caller_module_code', v_req.caller_module_code,
      'caller_entity_type', v_req.caller_entity_type,
      'caller_entity_id', v_req.caller_entity_id,
      'correlation_id', v_req.correlation_id,
      'idempotency_key', v_req.idempotency_key,
      'requested_channels', v_req.requested_channels,
      'blockers', v_req.blockers,
      'payload_snapshot', CASE WHEN v_sensitive THEN v_req.payload_snapshot ELSE NULL END,
      'payload_redacted', NOT v_sensitive,
      'created_at', v_req.created_at, 'completed_at', v_req.completed_at),
    'recipients', v_recipients,
    'messages', v_messages,
    'dispatch_jobs', v_jobs,
    'timeline', v_timeline,
    'sensitive_visible', v_sensitive,
    'generated_at', now());
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_diagnostics(p_organization_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_catalogue jsonb; v_content jsonb; v_channels jsonb; v_runtime jsonb; v_checks jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');

  SELECT jsonb_build_object(
    'event_definitions_total', (SELECT count(*) FROM public.omni_comms_event_definition),
    'event_definitions_active', (SELECT count(*) FROM public.omni_comms_event_definition WHERE status='active'),
    'event_contracts_total', (SELECT count(*) FROM public.omni_comms_event_contract),
    'event_contracts_published', (SELECT count(*) FROM public.omni_comms_event_contract WHERE status='published')
  ) INTO v_catalogue;

  SELECT jsonb_build_object(
    'template_families', (SELECT count(*) FROM public.omni_comms_template_family
                           WHERE p_organization_id IS NULL OR organization_id = p_organization_id),
    'template_versions', (SELECT count(*) FROM public.omni_comms_template_version v
                           JOIN public.omni_comms_template_family f ON f.id = v.template_family_id
                          WHERE p_organization_id IS NULL OR f.organization_id = p_organization_id),
    'template_versions_published', (SELECT count(*) FROM public.omni_comms_template_version v
                           JOIN public.omni_comms_template_family f ON f.id = v.template_family_id
                          WHERE v.status='published'
                            AND (p_organization_id IS NULL OR f.organization_id = p_organization_id))
  ) INTO v_content;

  SELECT jsonb_build_object(
    'providers_active', (SELECT count(*) FROM public.omni_comms_provider WHERE status='active'),
    'provider_accounts_active', (SELECT count(*) FROM public.omni_comms_provider_account
                                  WHERE status='active' AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'sender_identities_active', (SELECT count(*) FROM public.omni_comms_sender_identity
                                  WHERE status='active' AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'bindings_verified', (SELECT count(*) FROM public.omni_comms_sender_provider_binding b
                            JOIN public.omni_comms_sender_identity s ON s.id = b.sender_identity_id
                           WHERE b.status='active' AND b.verification_status='verified'
                             AND (p_organization_id IS NULL OR s.organization_id = p_organization_id)),
    'channel_settings_enabled', (SELECT count(*) FROM public.omni_comms_channel_setting
                                  WHERE enabled = true AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'event_routes_active', (SELECT count(*) FROM public.omni_comms_event_route
                             WHERE lifecycle_state='active'
                               AND (p_organization_id IS NULL OR organization_id = p_organization_id))
  ) INTO v_channels;

  SELECT jsonb_build_object(
    'requests_24h', (SELECT count(*) FROM public.omni_comms_request WHERE created_at >= now() - interval '24 hours'
                      AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'requests_blocked_24h', (SELECT count(*) FROM public.omni_comms_request WHERE created_at >= now() - interval '24 hours'
                      AND status IN ('blocked','failed')
                      AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'messages_24h', (SELECT count(*) FROM public.omni_comms_message WHERE created_at >= now() - interval '24 hours'
                      AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'jobs_held', (SELECT count(*) FROM public.omni_comms_dispatch_job WHERE status='held'
                      AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'jobs_pending', (SELECT count(*) FROM public.omni_comms_dispatch_job WHERE status IN ('pending','ready','retry_wait')
                      AND (p_organization_id IS NULL OR organization_id = p_organization_id)),
    'last_request_at', (SELECT max(created_at) FROM public.omni_comms_request
                      WHERE p_organization_id IS NULL OR organization_id = p_organization_id)
  ) INTO v_runtime;

  v_checks := jsonb_build_array(
    jsonb_build_object('id','event_catalogue','label','At least one active event definition',
      'ok', (v_catalogue->>'event_definitions_active')::int > 0),
    jsonb_build_object('id','published_contract','label','At least one published event contract',
      'ok', (v_catalogue->>'event_contracts_published')::int > 0),
    jsonb_build_object('id','published_template','label','At least one published template version',
      'ok', (v_content->>'template_versions_published')::int > 0),
    jsonb_build_object('id','active_sender','label','At least one verified sender binding',
      'ok', (v_channels->>'bindings_verified')::int > 0),
    jsonb_build_object('id','channel_enabled','label','At least one enabled channel setting',
      'ok', (v_channels->>'channel_settings_enabled')::int > 0),
    jsonb_build_object('id','active_route','label','At least one active event route',
      'ok', (v_channels->>'event_routes_active')::int > 0)
  );

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'catalogue', v_catalogue,
    'content', v_content,
    'channels', v_channels,
    'runtime', v_runtime,
    'checks', v_checks,
    'generated_at', now());
END; $function$;

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'omni_comms_event_route_list','omni_comms_event_route_get',
         'omni_comms_event_route_upsert_draft','omni_comms_event_route_set_lifecycle',
         'omni_comms_ops_summary','omni_comms_ops_request_list','omni_comms_ops_request_detail',
         'omni_comms_diagnostics')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $do$;
-- ─────────────────────────────────────────────────────────────────────────
-- Omni-Comms Operations read console (Phase 2) — read-only RPC surface.
-- No writes, no provider calls, no Legacy table references.
-- ─────────────────────────────────────────────────────────────────────────

-- Masking helpers ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_mask_email(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR btrim(p_value) = '' THEN NULL
    WHEN position('@' in p_value) < 2 THEN 'masked'
    ELSE left(p_value, 1) || '***@' || split_part(p_value, '@', 2)
  END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_mask_phone(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR btrim(p_value) = '' THEN NULL
    WHEN length(regexp_replace(p_value, '\D', '', 'g')) < 4 THEN '******'
    ELSE '******' || right(regexp_replace(p_value, '\D', '', 'g'), 4)
  END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_mask_reference(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR btrim(p_value) = '' THEN NULL
    WHEN length(p_value) <= 4 THEN '****'
    ELSE left(p_value, 2) || repeat('*', 4) || right(p_value, 2)
  END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_mask_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_mask_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_mask_reference(text) FROM PUBLIC, anon, authenticated;

-- Summary -----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_ops_summary(uuid, uuid, integer);

CREATE FUNCTION public.omni_comms_ops_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_since_hours integer DEFAULT 720
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE
  v_since timestamptz;
  v_requests bigint; v_recipients bigint; v_messages bigint;
  v_held bigint; v_runnable bigint; v_attempts bigint;
  v_blocked bigint; v_dry bigint; v_processing bigint; v_failed bigint;
  v_by_status jsonb; v_by_mode jsonb; v_last timestamptz;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;
  v_since := now() - make_interval(hours => LEAST(GREATEST(COALESCE(p_since_hours,720),1), 8760));

  SELECT count(*),
         count(*) FILTER (WHERE r.status IN ('blocked','completed_with_blockers')),
         count(*) FILTER (WHERE r.mode = 'dry_run' AND r.status IN ('completed','completed_with_blockers')),
         count(*) FILTER (WHERE r.status IN ('accepted','processing')),
         count(*) FILTER (WHERE r.status = 'failed'),
         max(r.created_at)
    INTO v_requests, v_blocked, v_dry, v_processing, v_failed, v_last
    FROM public.omni_comms_request r
   WHERE r.organization_id = p_organization_id
     AND r.created_at >= v_since
     AND (p_department_id IS NULL OR r.department_id = p_department_id);

  SELECT count(*) INTO v_recipients
    FROM public.omni_comms_recipient c
    JOIN public.omni_comms_request r ON r.id = c.request_id
   WHERE r.organization_id = p_organization_id
     AND r.created_at >= v_since
     AND (p_department_id IS NULL OR r.department_id = p_department_id);

  SELECT count(*) INTO v_messages
    FROM public.omni_comms_message m
   WHERE m.organization_id = p_organization_id
     AND m.created_at >= v_since
     AND (p_department_id IS NULL OR m.department_id = p_department_id);

  SELECT count(*) FILTER (WHERE j.is_runnable = false),
         count(*) FILTER (WHERE j.is_runnable = true)
    INTO v_held, v_runnable
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_request r ON r.id = j.request_id
   WHERE j.organization_id = p_organization_id
     AND j.created_at >= v_since
     AND (p_department_id IS NULL OR r.department_id = p_department_id);

  SELECT count(*) INTO v_attempts
    FROM public.omni_comms_delivery_attempt a
   WHERE a.organization_id = p_organization_id
     AND a.created_at >= v_since;

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_by_status
    FROM (SELECT r.status, count(*) n FROM public.omni_comms_request r
           WHERE r.organization_id = p_organization_id AND r.created_at >= v_since
             AND (p_department_id IS NULL OR r.department_id = p_department_id)
           GROUP BY r.status) s;

  SELECT COALESCE(jsonb_object_agg(mode, n), '{}'::jsonb) INTO v_by_mode
    FROM (SELECT r.mode, count(*) n FROM public.omni_comms_request r
           WHERE r.organization_id = p_organization_id AND r.created_at >= v_since
             AND (p_department_id IS NULL OR r.department_id = p_department_id)
           GROUP BY r.mode) s;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'since', v_since,
    'requests', COALESCE(v_requests,0),
    'recipients', COALESCE(v_recipients,0),
    'messages', COALESCE(v_messages,0),
    'held_jobs', COALESCE(v_held,0),
    'runnable_jobs', COALESCE(v_runnable,0),
    'delivery_attempts', COALESCE(v_attempts,0),
    'blocked_requests', COALESCE(v_blocked,0),
    'completed_dry_runs', COALESCE(v_dry,0),
    'processing_requests', COALESCE(v_processing,0),
    'failed_requests', COALESCE(v_failed,0),
    'requests_by_status', v_by_status,
    'requests_by_mode', v_by_mode,
    'last_request_at', v_last,
    'generated_at', now());
END; $function$;

-- Request register --------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_ops_request_list(uuid, uuid, text, text, text, integer, integer);

CREATE FUNCTION public.omni_comms_ops_request_list(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_event_code text DEFAULT NULL,
  p_caller_module_code text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_has_blockers boolean DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE
  v_limit integer; v_offset integer; v_q text; v_uuid uuid; v_rows jsonb; v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit,25),1),100);
  v_offset := GREATEST(COALESCE(p_offset,0),0);
  v_q := NULLIF(btrim(COALESCE(p_search,'')),'');
  IF v_q IS NOT NULL AND length(v_q) > 200 THEN
    RAISE EXCEPTION 'OC422 search_too_long' USING ERRCODE='P0001', DETAIL='search';
  END IF;
  BEGIN
    v_uuid := v_q::uuid;
  EXCEPTION WHEN others THEN v_uuid := NULL;
  END;
  IF v_q IS NOT NULL THEN v_q := '%' || public.omni_comms_priv_escape_ilike(v_q) || '%'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _oc_noop_never_used (x int) ON COMMIT DROP;

  WITH base AS (
    SELECT r.*, d.code AS event_code
      FROM public.omni_comms_request r
      LEFT JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
     WHERE r.organization_id = p_organization_id
       AND (p_department_id IS NULL OR r.department_id = p_department_id)
       AND (p_mode IS NULL OR r.mode = p_mode)
       AND (p_status IS NULL OR r.status = p_status)
       AND (p_event_code IS NULL OR d.code = p_event_code)
       AND (p_caller_module_code IS NULL OR r.caller_module_code = p_caller_module_code)
       AND (p_date_from IS NULL OR r.created_at >= p_date_from)
       AND (p_date_to IS NULL OR r.created_at <= p_date_to)
       AND (p_has_blockers IS NULL
            OR (p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) > 0)
            OR (NOT p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) = 0))
       AND (v_q IS NULL
            OR d.code ILIKE v_q
            OR r.caller_module_code ILIKE v_q
            OR r.correlation_id ILIKE v_q
            OR r.idempotency_key ILIKE v_q
            OR r.caller_entity_id ILIKE v_q
            OR (v_uuid IS NOT NULL AND r.id = v_uuid))
  )
  SELECT count(*) INTO v_total FROM base;

  WITH base AS (
    SELECT r.*, d.code AS event_code
      FROM public.omni_comms_request r
      LEFT JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
     WHERE r.organization_id = p_organization_id
       AND (p_department_id IS NULL OR r.department_id = p_department_id)
       AND (p_mode IS NULL OR r.mode = p_mode)
       AND (p_status IS NULL OR r.status = p_status)
       AND (p_event_code IS NULL OR d.code = p_event_code)
       AND (p_caller_module_code IS NULL OR r.caller_module_code = p_caller_module_code)
       AND (p_date_from IS NULL OR r.created_at >= p_date_from)
       AND (p_date_to IS NULL OR r.created_at <= p_date_to)
       AND (p_has_blockers IS NULL
            OR (p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) > 0)
            OR (NOT p_has_blockers AND COALESCE(jsonb_array_length(r.blockers),0) = 0))
       AND (v_q IS NULL
            OR d.code ILIKE v_q
            OR r.caller_module_code ILIKE v_q
            OR r.correlation_id ILIKE v_q
            OR r.idempotency_key ILIKE v_q
            OR r.caller_entity_id ILIKE v_q
            OR (v_uuid IS NOT NULL AND r.id = v_uuid))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'created_at', b.created_at,
      'event_code', b.event_code,
      'mode', b.mode,
      'status', b.status,
      'caller_module_code', b.caller_module_code,
      'caller_entity_type', b.caller_entity_type,
      'department_id', b.department_id,
      'correlation_id', b.correlation_id,
      'recipient_count', (SELECT count(*) FROM public.omni_comms_recipient c WHERE c.request_id = b.id),
      'message_count', (SELECT count(*) FROM public.omni_comms_message m WHERE m.request_id = b.id),
      'held_job_count', (SELECT count(*) FROM public.omni_comms_dispatch_job j
                          WHERE j.request_id = b.id AND j.is_runnable = false),
      'blocker_count', COALESCE(jsonb_array_length(b.blockers),0)
    ) ORDER BY b.created_at DESC, b.id DESC), '[]'::jsonb)
    INTO v_rows FROM base b;

  RETURN jsonb_build_object(
    'items', v_rows,
    'total', COALESCE(v_total,0),
    'limit', v_limit,
    'offset', v_offset,
    'generated_at', now());
END; $function$;

-- Request detail ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_ops_request_detail(uuid);

CREATE FUNCTION public.omni_comms_ops_request_detail(
  p_request_id uuid,
  p_organization_id uuid,
  p_reveal_sensitive boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE
  v_uid uuid; v_can_sensitive boolean; v_reveal boolean; v_req record;
  v_recipients jsonb; v_messages jsonb; v_jobs jsonb; v_attempts jsonb;
  v_timeline jsonb; v_warnings jsonb := '[]'::jsonb;
  v_seq_count bigint; v_seq_distinct bigint; v_seq_min bigint; v_seq_max bigint;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;
  v_can_sensitive := public.has_permission(v_uid, 'omni_comms', 'view_sensitive_content');
  v_reveal := v_can_sensitive AND COALESCE(p_reveal_sensitive,false);

  SELECT * INTO v_req FROM public.omni_comms_request
   WHERE id = p_request_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='request';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'recipient_type', c.recipient_type,
      'recipient_reference', CASE WHEN v_reveal THEN c.recipient_reference
                                  ELSE public.omni_comms_priv_mask_reference(c.recipient_reference) END,
      'display_name', CASE WHEN v_reveal THEN c.display_name
                           ELSE public.omni_comms_priv_mask_reference(c.display_name) END,
      'email_destination', CASE WHEN v_reveal THEN c.email_destination
                                ELSE public.omni_comms_priv_mask_email(c.email_destination) END,
      'phone_destination', CASE WHEN v_reveal THEN c.phone_destination
                                ELSE public.omni_comms_priv_mask_phone(c.phone_destination) END,
      'push_destination', CASE WHEN v_reveal THEN c.push_destination
                               WHEN c.push_destination IS NULL THEN NULL ELSE 'masked' END,
      'locale', c.locale,
      'eligibility_status', c.eligibility_status,
      'resolved_channels', c.resolved_channels,
      'blockers', c.blockers,
      'resolution_snapshot', CASE WHEN v_reveal THEN c.resolution_snapshot ELSE NULL END,
      'destinations_masked', NOT v_reveal,
      'created_at', c.created_at
    ) ORDER BY c.created_at, c.id), '[]'::jsonb) INTO v_recipients
    FROM public.omni_comms_recipient c WHERE c.request_id = p_request_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'recipient_id', m.recipient_id, 'channel', m.channel, 'status', m.status,
      'event_route_id', m.event_route_id,
      'template_family_id', m.template_family_id,
      'template_version_id', m.template_version_id,
      'template_family_code', tf.code,
      'template_version_number', tv.version_number,
      'layout_id', m.layout_id, 'layout_version_id', m.layout_version_id,
      'sender_identity_id', m.sender_identity_id,
      'sender_identity_code', si.code,
      'provider_id', m.provider_id, 'provider_account_id', m.provider_account_id,
      'resolved_asset_manifest', m.resolved_asset_manifest,
      'channel_setting_snapshot', m.channel_setting_snapshot,
      'destination_snapshot', CASE WHEN v_reveal THEN m.destination_snapshot ELSE NULL END,
      'rendered_checksum', m.rendered_checksum,
      'unresolved_tokens', m.unresolved_tokens,
      'unresolved_required_slots', m.unresolved_required_slots,
      'blockers', m.blockers,
      'dispatch_job_id', (SELECT j.id FROM public.omni_comms_dispatch_job j
                           WHERE j.message_id = m.id ORDER BY j.created_at LIMIT 1),
      'content_available', v_can_sensitive,
      'rendered_at', m.rendered_at,
      'created_at', m.created_at
    ) ORDER BY m.created_at, m.id), '[]'::jsonb) INTO v_messages
    FROM public.omni_comms_message m
    LEFT JOIN public.omni_comms_template_family tf ON tf.id = m.template_family_id
    LEFT JOIN public.omni_comms_template_version tv ON tv.id = m.template_version_id
    LEFT JOIN public.omni_comms_sender_identity si ON si.id = m.sender_identity_id
   WHERE m.request_id = p_request_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', j.id, 'message_id', j.message_id, 'channel', j.channel, 'mode', j.mode,
      'status', j.status, 'priority', j.priority, 'is_runnable', j.is_runnable,
      'hold_reason', j.hold_reason, 'scheduled_at', j.scheduled_at,
      'next_attempt_at', j.next_attempt_at, 'attempt_count', j.attempt_count,
      'max_attempts', j.max_attempts,
      'lease_state', CASE WHEN j.lease_expires_at IS NULL THEN 'unleased'
                          WHEN j.lease_expires_at > now() THEN 'leased'
                          ELSE 'lease_expired' END,
      'locked_at', j.locked_at,
      'created_at', j.created_at, 'updated_at', j.updated_at,
      'completed_at', j.completed_at, 'cancelled_at', j.cancelled_at
    ) ORDER BY j.created_at, j.id), '[]'::jsonb) INTO v_jobs
    FROM public.omni_comms_dispatch_job j WHERE j.request_id = p_request_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id, 'dispatch_job_id', a.dispatch_job_id, 'message_id', a.message_id,
      'attempt_number', a.attempt_number, 'status', a.status,
      'provider_id', a.provider_id, 'provider_code', pr.code,
      'started_at', a.started_at, 'completed_at', a.completed_at,
      'latency_ms', a.latency_ms, 'response_code', a.response_code,
      'response_category', a.response_category, 'failure_category', a.failure_category,
      'is_retriable', a.is_retriable
    ) ORDER BY a.attempt_number, a.id), '[]'::jsonb) INTO v_attempts
    FROM public.omni_comms_delivery_attempt a
    LEFT JOIN public.omni_comms_provider pr ON pr.id = a.provider_id
   WHERE a.message_id IN (SELECT m.id FROM public.omni_comms_message m WHERE m.request_id = p_request_id)
      OR a.dispatch_job_id IN (SELECT j.id FROM public.omni_comms_dispatch_job j WHERE j.request_id = p_request_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'event_sequence', e.event_sequence, 'event_type', e.event_type,
      'message_id', e.message_id, 'status_before', e.status_before,
      'status_after', e.status_after, 'summary', e.summary,
      'safe_metadata', e.safe_metadata, 'actor_type', e.actor_type,
      'actor_id', CASE WHEN v_reveal THEN e.actor_id
                       ELSE public.omni_comms_priv_mask_reference(e.actor_id) END,
      'correlation_id', e.correlation_id,
      'created_at', e.created_at
    ) ORDER BY e.event_sequence, e.created_at), '[]'::jsonb) INTO v_timeline
    FROM public.omni_comms_message_event e WHERE e.request_id = p_request_id;

  SELECT count(*), count(DISTINCT e.event_sequence), min(e.event_sequence), max(e.event_sequence)
    INTO v_seq_count, v_seq_distinct, v_seq_min, v_seq_max
    FROM public.omni_comms_message_event e WHERE e.request_id = p_request_id;

  IF COALESCE(v_seq_count,0) > 0 THEN
    IF v_seq_distinct < v_seq_count THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code','duplicate_sequence','message','Duplicate timeline sequence values were recorded.'));
    END IF;
    IF (v_seq_max - v_seq_min + 1) <> v_seq_distinct THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code','sequence_gap','message','The timeline sequence contains gaps.'));
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.omni_comms_message_event e
              WHERE e.request_id = p_request_id AND e.message_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.omni_comms_message m WHERE m.id = e.message_id)) THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','missing_reference','message','Timeline entries reference messages that no longer exist.'));
  END IF;

  IF EXISTS (SELECT 1 FROM public.omni_comms_dispatch_job j
              WHERE j.request_id = p_request_id AND j.is_runnable = true) THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','runnable_job_present',
      'message','A runnable dispatch job exists while runtime certification is pending.'));
  END IF;

  RETURN jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_req.id, 'organization_id', v_req.organization_id,
      'department_id', v_req.department_id, 'status', v_req.status, 'mode', v_req.mode,
      'event_definition_id', v_req.event_definition_id,
      'event_code', (SELECT code FROM public.omni_comms_event_definition WHERE id = v_req.event_definition_id),
      'event_name', (SELECT name FROM public.omni_comms_event_definition WHERE id = v_req.event_definition_id),
      'caller_module_code', v_req.caller_module_code,
      'caller_entity_type', v_req.caller_entity_type,
      'caller_entity_id', CASE WHEN v_reveal THEN v_req.caller_entity_id
                               ELSE public.omni_comms_priv_mask_reference(v_req.caller_entity_id) END,
      'correlation_id', v_req.correlation_id,
      'idempotency_key', v_req.idempotency_key,
      'idempotency_scope', v_req.idempotency_scope,
      'request_fingerprint', v_req.request_fingerprint,
      'requested_channels', v_req.requested_channels,
      'blockers', v_req.blockers,
      'payload_snapshot', CASE WHEN v_reveal THEN v_req.payload_snapshot ELSE NULL END,
      'payload_redacted', NOT v_reveal,
      'created_at', v_req.created_at, 'accepted_at', v_req.accepted_at,
      'completed_at', v_req.completed_at, 'failed_at', v_req.failed_at),
    'recipients', v_recipients,
    'messages', v_messages,
    'dispatch_jobs', v_jobs,
    'delivery_attempts', v_attempts,
    'timeline', v_timeline,
    'timeline_warnings', v_warnings,
    'can_view_sensitive', v_can_sensitive,
    'sensitive_visible', v_reveal,
    'generated_at', now());
END; $function$;

-- Message content (sensitive) --------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_ops_message_content(
  p_message_id uuid,
  p_organization_id uuid,
  p_reveal_sensitive boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid; v_can boolean; v_reveal boolean; v_m record;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;
  v_can := public.has_permission(v_uid, 'omni_comms', 'view_sensitive_content');
  v_reveal := v_can AND COALESCE(p_reveal_sensitive,false);

  SELECT * INTO v_m FROM public.omni_comms_message
   WHERE id = p_message_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='message';
  END IF;

  IF NOT v_reveal THEN
    IF NOT v_can THEN
      RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='view_sensitive_content';
    END IF;
    RAISE EXCEPTION 'OC412 reveal_not_requested' USING ERRCODE='P0001', DETAIL='reveal_sensitive';
  END IF;

  RETURN jsonb_build_object(
    'id', v_m.id,
    'channel', v_m.channel,
    'rendered_subject', v_m.rendered_subject,
    'rendered_text', v_m.rendered_text,
    'rendered_html', v_m.rendered_html,
    'rendered_checksum', v_m.rendered_checksum,
    'resolved_asset_manifest', v_m.resolved_asset_manifest,
    'channel_setting_snapshot', v_m.channel_setting_snapshot,
    'destination_snapshot', v_m.destination_snapshot,
    'blockers', v_m.blockers,
    'generated_at', now());
END; $function$;

-- Grants ------------------------------------------------------------------
ALTER FUNCTION public.omni_comms_ops_summary(uuid, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.omni_comms_ops_request_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.omni_comms_ops_request_detail(uuid, uuid, boolean) OWNER TO postgres;
ALTER FUNCTION public.omni_comms_ops_message_content(uuid, uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.omni_comms_ops_summary(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_ops_request_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_ops_request_detail(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_ops_message_content(uuid, uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.omni_comms_ops_summary(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_ops_request_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_ops_request_detail(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_ops_message_content(uuid, uuid, boolean) TO authenticated;
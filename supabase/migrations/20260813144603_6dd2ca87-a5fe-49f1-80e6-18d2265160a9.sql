CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_event_status(
  p_outbox_status  text,
  p_result_code    text,
  p_request_id     uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_request_status text;
  v_blockers       integer := 0;
  v_delivered      integer := 0;
  v_accepted       integer := 0;
  v_failed_attempt integer := 0;
  v_runnable       integer := 0;
  v_held           integer := 0;
  v_messages       integer := 0;
BEGIN
  IF p_outbox_status = 'no_communication_configured'
     OR p_result_code = 'no_communication_configured' THEN
    RETURN 'no_communication_configured';
  END IF;

  IF p_request_id IS NULL THEN
    RETURN CASE p_outbox_status
      WHEN 'pending'    THEN 'event_recorded'
      WHEN 'processing' THEN 'preparing_communication'
      WHEN 'retry'      THEN 'retrying'
      WHEN 'blocked'    THEN 'needs_configuration'
      WHEN 'failed'     THEN 'failed'
      ELSE 'event_recorded'
    END;
  END IF;

  SELECT r.status, COALESCE(jsonb_array_length(r.blockers), 0)
    INTO v_request_status, v_blockers
    FROM public.omni_comms_request r
   WHERE r.id = p_request_id;

  IF v_request_status IS NULL THEN
    RETURN 'preparing_communication';
  END IF;

  IF v_request_status = 'blocked' THEN RETURN 'needs_configuration'; END IF;
  IF v_request_status = 'failed'  THEN RETURN 'failed'; END IF;

  SELECT count(*) INTO v_messages
    FROM public.omni_comms_message m WHERE m.request_id = p_request_id;

  SELECT
      count(*) FILTER (WHERE e.event_type = 'delivered'),
      count(*) FILTER (WHERE e.event_type IN ('bounced', 'complained', 'failed'))
    INTO v_delivered, v_failed_attempt
    FROM public.omni_comms_message_event e
   WHERE e.request_id = p_request_id;

  IF v_delivered > 0 THEN RETURN 'delivered'; END IF;

  SELECT count(*) INTO v_accepted
    FROM public.omni_comms_delivery_attempt a
    JOIN public.omni_comms_message m ON m.id = a.message_id
   WHERE m.request_id = p_request_id
     AND a.response_category = 'accepted';

  IF v_accepted > 0 THEN RETURN 'provider_accepted'; END IF;
  IF v_failed_attempt > 0 THEN RETURN 'failed'; END IF;

  SELECT
      count(*) FILTER (WHERE j.is_runnable),
      count(*) FILTER (WHERE NOT j.is_runnable)
    INTO v_runnable, v_held
    FROM public.omni_comms_dispatch_job j
   WHERE j.request_id = p_request_id
     AND j.cancelled_at IS NULL;

  IF v_runnable > 0 THEN RETURN 'sending'; END IF;
  IF v_held > 0     THEN RETURN 'waiting_to_send'; END IF;

  IF v_request_status = 'completed_with_blockers' OR v_blockers > 0 THEN
    RETURN 'needs_review';
  END IF;

  IF v_messages > 0 THEN RETURN 'waiting_to_send'; END IF;

  RETURN 'preparing_communication';
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_business_event_status(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_business_event_status(text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_business_event_activity_list(
  p_organization_id uuid,
  p_status          text DEFAULT NULL,
  p_module_code     text DEFAULT NULL,
  p_event_code      text DEFAULT NULL,
  p_search          text DEFAULT NULL,
  p_limit           integer DEFAULT 25,
  p_offset          integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit  integer;
  v_offset integer;
  v_q      text;
  v_uuid   uuid;
  v_rows   jsonb;
  v_total  bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;

  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_q      := NULLIF(btrim(COALESCE(p_search, '')), '');
  IF v_q IS NOT NULL AND length(v_q) > 200 THEN
    RAISE EXCEPTION 'OC422 search_too_long' USING ERRCODE='P0001', DETAIL='search';
  END IF;
  BEGIN
    v_uuid := v_q::uuid;
  EXCEPTION WHEN others THEN v_uuid := NULL;
  END;
  IF v_q IS NOT NULL THEN
    v_q := '%' || public.omni_comms_priv_escape_ilike(v_q) || '%';
  END IF;

  WITH roots AS (
    SELECT o.*,
           public.omni_comms_priv_business_event_status(o.status, o.result_code, o.request_id)
             AS normal_status
      FROM public.omni_comms_business_event_outbox o
     WHERE o.organization_id = p_organization_id
       AND (p_module_code IS NULL OR o.module_code = p_module_code)
       AND (p_event_code  IS NULL OR o.event_code  = p_event_code)
       AND (v_q IS NULL
            OR o.event_code ILIKE v_q
            OR o.module_code ILIKE v_q
            OR o.entity_id ILIKE v_q
            OR (v_uuid IS NOT NULL AND (o.id = v_uuid OR o.request_id = v_uuid)))
  ), filtered AS (
    SELECT * FROM roots
     WHERE p_status IS NULL OR normal_status = p_status
  )
  SELECT count(*) INTO v_total FROM filtered;

  WITH roots AS (
    SELECT o.*,
           public.omni_comms_priv_business_event_status(o.status, o.result_code, o.request_id)
             AS normal_status
      FROM public.omni_comms_business_event_outbox o
     WHERE o.organization_id = p_organization_id
       AND (p_module_code IS NULL OR o.module_code = p_module_code)
       AND (p_event_code  IS NULL OR o.event_code  = p_event_code)
       AND (v_q IS NULL
            OR o.event_code ILIKE v_q
            OR o.module_code ILIKE v_q
            OR o.entity_id ILIKE v_q
            OR (v_uuid IS NOT NULL AND (o.id = v_uuid OR o.request_id = v_uuid)))
  ), filtered AS (
    SELECT * FROM roots
     WHERE p_status IS NULL OR normal_status = p_status
     ORDER BY created_at DESC, id DESC
     LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',              f.id,
      'occurred_at',     f.created_at,
      'updated_at',      f.updated_at,
      'module_code',     f.module_code,
      'event_code',      f.event_code,
      'entity_type',     f.entity_type,
      'entity_id',       f.entity_id,
      'status',          f.normal_status,
      'has_communication', (f.request_id IS NOT NULL),
      'message_count',   COALESCE((SELECT count(*) FROM public.omni_comms_message m
                                    WHERE m.request_id = f.request_id), 0),
      'recipient_count', COALESCE((SELECT count(*) FROM public.omni_comms_recipient c
                                    WHERE c.request_id = f.request_id), 0),
      'channels',        COALESCE((SELECT jsonb_agg(DISTINCT m.channel)
                                     FROM public.omni_comms_message m
                                    WHERE m.request_id = f.request_id), '[]'::jsonb)
    ) ORDER BY f.created_at DESC, f.id DESC), '[]'::jsonb)
    INTO v_rows FROM filtered f;

  RETURN jsonb_build_object(
    'items',        v_rows,
    'total',        COALESCE(v_total, 0),
    'limit',        v_limit,
    'offset',       v_offset,
    'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_business_event_activity_list(uuid, text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_business_event_activity_list(uuid, text, text, text, text, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_business_event_activity_detail(
  p_organization_id uuid,
  p_event_id        uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_o        public.omni_comms_business_event_outbox%ROWTYPE;
  v_status   text;
  v_timeline jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'OC422 event_required' USING ERRCODE='P0001', DETAIL='event_id';
  END IF;

  SELECT * INTO v_o
    FROM public.omni_comms_business_event_outbox
   WHERE id = p_event_id AND organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 business_event_not_found' USING ERRCODE='P0001', DETAIL='event_id';
  END IF;

  v_status := public.omni_comms_priv_business_event_status(v_o.status, v_o.result_code, v_o.request_id);

  WITH steps AS (
    SELECT 1 AS ord, v_o.created_at AS at,
           'Business event recorded' AS label,
           'The originating module recorded this business fact.' AS detail
    UNION ALL
    SELECT 2, v_o.claimed_at,
           'Communication decided',
           'Omni-Comms resolved the communication policy for this event.'
     WHERE v_o.claimed_at IS NOT NULL
    UNION ALL
    SELECT 3, m.created_at,
           'Message prepared',
           'A ' || m.channel || ' message was prepared for a resolved recipient.'
      FROM public.omni_comms_message m
     WHERE v_o.request_id IS NOT NULL AND m.request_id = v_o.request_id
    UNION ALL
    SELECT 4, a.started_at,
           CASE WHEN a.response_category = 'accepted'
                THEN 'Provider accepted the message'
                ELSE 'Provider attempt did not succeed' END,
           'Transport attempt ' || a.attempt_number || '.'
      FROM public.omni_comms_delivery_attempt a
      JOIN public.omni_comms_message m ON m.id = a.message_id
     WHERE v_o.request_id IS NOT NULL AND m.request_id = v_o.request_id
    UNION ALL
    SELECT 5, e.created_at,
           initcap(replace(e.event_type, '_', ' ')),
           COALESCE(e.summary, 'Delivery evidence received.')
      FROM public.omni_comms_message_event e
     WHERE v_o.request_id IS NOT NULL AND e.request_id = v_o.request_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', s.at, 'label', s.label, 'detail', s.detail)
           ORDER BY s.at, s.ord), '[]'::jsonb)
    INTO v_timeline
    FROM steps s
   WHERE s.at IS NOT NULL;

  IF v_o.request_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', m.id,
             'channel', m.channel,
             'status', m.status,
             'prepared_at', m.created_at,
             'recipient_role', c.recipient_role,
             'recipient', CASE
               WHEN m.channel = 'email'
                 THEN public.omni_comms_priv_mask_email(c.email_destination)
               WHEN m.channel = 'sms'
                 THEN public.omni_comms_priv_mask_phone(c.phone_destination)
               ELSE NULL END)
             ORDER BY m.created_at), '[]'::jsonb)
      INTO v_messages
      FROM public.omni_comms_message m
      LEFT JOIN public.omni_comms_recipient c ON c.id = m.recipient_id
     WHERE m.request_id = v_o.request_id;
  END IF;

  RETURN jsonb_build_object(
    'id',           v_o.id,
    'occurred_at',  v_o.created_at,
    'module_code',  v_o.module_code,
    'event_code',   v_o.event_code,
    'entity_type',  v_o.entity_type,
    'entity_id',    v_o.entity_id,
    'status',       v_status,
    'has_communication', (v_o.request_id IS NOT NULL),
    'timeline',     v_timeline,
    'messages',     v_messages,
    'technical', jsonb_build_object(
      'outbox_status',  v_o.status,
      'result_code',    v_o.result_code,
      'blocker_code',   v_o.blocker_code,
      'attempt_count',  v_o.attempt_count,
      'next_attempt_at', v_o.next_attempt_at,
      'request_id',     v_o.request_id,
      'idempotency_key', v_o.idempotency_key,
      'correlation_id', v_o.correlation_id,
      'request_status', (SELECT r.status FROM public.omni_comms_request r
                          WHERE r.id = v_o.request_id),
      'request_blockers', (SELECT r.blockers FROM public.omni_comms_request r
                            WHERE r.id = v_o.request_id)),
    'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_business_event_activity_detail(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_business_event_activity_detail(uuid, uuid) TO authenticated, service_role;
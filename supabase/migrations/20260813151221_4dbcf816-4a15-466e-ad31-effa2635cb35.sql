-- =====================================================================
-- Omni-Comms — Email journey read model (read-only projection).
-- Derives visibility from canonical evidence only. No new lifecycle table.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.omni_comms_priv_email_journey_rows(
  p_organization_id uuid,
  p_module_code     text DEFAULT NULL,
  p_event_code      text DEFAULT NULL,
  p_stage           text DEFAULT NULL,
  p_product_id      uuid DEFAULT NULL,
  p_from            timestamptz DEFAULT NULL,
  p_to              timestamptz DEFAULT NULL,
  p_search          text DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid,
  business_event_id uuid,
  request_id uuid,
  organization_id uuid,
  module_code text,
  event_code text,
  entity_type text,
  entity_id text,
  business_reference text,
  product_id uuid,
  masked_recipient text,
  recipient_role text,
  template_name text,
  template_version integer,
  sender_display text,
  provider_name text,
  current_stage text,
  last_action text,
  attempt_count integer,
  event_recorded_at timestamptz,
  message_prepared_at timestamptz,
  queued_at timestamptz,
  picked_up_at timestamptz,
  provider_accepted_at timestamptz,
  callback_at timestamptz,
  delivered_at timestamptz,
  last_failure_at timestamptz,
  next_attempt_at timestamptz,
  end_to_end_duration_ms bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH q AS (
    SELECT NULLIF(btrim(COALESCE(p_search, '')), '') AS raw
  ), qq AS (
    SELECT raw,
           CASE WHEN raw IS NULL THEN NULL
                ELSE '%' || public.omni_comms_priv_escape_ilike(raw) || '%' END AS pat
      FROM q
  ), msg AS (
    SELECT m.id, m.request_id, m.organization_id, m.status AS message_status,
           m.created_at, m.rendered_at, m.queued_at, m.failed_at, m.blockers,
           m.recipient_id, m.template_family_id, m.template_version_id,
           m.sender_identity_id, m.provider_id
      FROM public.omni_comms_message m
     WHERE m.organization_id = p_organization_id
       AND m.channel = 'email'
  ), job AS (
    SELECT DISTINCT ON (j.message_id)
           j.message_id, j.created_at AS job_created_at, j.locked_at, j.is_runnable,
           j.cancelled_at, j.completed_at, j.next_attempt_at, j.hold_reason,
           j.attempt_count AS job_attempts
      FROM public.omni_comms_dispatch_job j
     WHERE j.organization_id = p_organization_id
       AND j.message_id IS NOT NULL
     ORDER BY j.message_id, j.created_at DESC
  ), att AS (
    SELECT a.message_id,
           count(*)::integer AS attempts,
           min(a.started_at) AS first_started_at,
           min(a.completed_at) FILTER (WHERE a.response_category = 'accepted') AS accepted_at,
           max(a.completed_at) FILTER (WHERE a.response_category IS DISTINCT FROM 'accepted') AS failed_at,
           bool_or(a.response_category = 'accepted') AS has_accepted,
           bool_or(COALESCE(a.response_category, '') = 'outcome_unknown'
                   OR COALESCE(a.reconciliation_state, '') = 'outcome_unknown') AS has_unknown
      FROM public.omni_comms_delivery_attempt a
     WHERE a.organization_id = p_organization_id
       AND a.message_id IS NOT NULL
     GROUP BY a.message_id
  ), ev AS (
    SELECT e.message_id,
           min(e.created_at) FILTER (WHERE e.event_type = 'delivered')  AS delivered_at,
           min(e.created_at) FILTER (WHERE e.event_type = 'bounced')    AS bounced_at,
           min(e.created_at) FILTER (WHERE e.event_type = 'complained') AS complained_at,
           min(e.created_at) FILTER (WHERE e.event_type IN
             ('delivered','bounced','complained','failed','deferred')) AS callback_at
      FROM public.omni_comms_message_event e
     WHERE e.organization_id = p_organization_id
       AND e.message_id IS NOT NULL
     GROUP BY e.message_id
  ), base AS (
    SELECT
      m.id AS message_id,
      o.id AS business_event_id,
      m.request_id,
      m.organization_id,
      COALESCE(o.module_code, r.caller_module_code) AS module_code,
      COALESCE(o.event_code, '') AS event_code,
      COALESCE(o.entity_type, r.caller_entity_type) AS entity_type,
      COALESCE(o.entity_id, r.caller_entity_id) AS entity_id,
      COALESCE(
        NULLIF(r.business_context_snapshot ->> 'business_reference', ''),
        NULLIF(o.payload_snapshot ->> 'business_reference', ''),
        NULLIF(o.payload_snapshot ->> 'reference', ''),
        COALESCE(o.entity_id, r.caller_entity_id)
      ) AS business_reference,
      o.product_id,
      public.omni_comms_priv_mask_email(c.email_destination) AS masked_recipient,
      c.recipient_role,
      tf.name AS template_name,
      tv.version_number AS template_version,
      COALESCE(si.display_name, si.from_address) AS sender_display,
      pv.display_name AS provider_name,
      COALESCE(a.attempts, 0) AS attempt_count,
      COALESCE(o.created_at, r.created_at, m.created_at) AS event_recorded_at,
      COALESCE(m.rendered_at, m.created_at) AS message_prepared_at,
      COALESCE(m.queued_at, j.job_created_at) AS queued_at,
      COALESCE(j.locked_at, a.first_started_at) AS picked_up_at,
      a.accepted_at AS provider_accepted_at,
      ev.callback_at,
      ev.delivered_at,
      ev.bounced_at,
      ev.complained_at,
      COALESCE(a.failed_at, m.failed_at) AS last_failure_at,
      j.next_attempt_at,
      m.message_status,
      m.blockers,
      j.is_runnable,
      j.cancelled_at,
      j.hold_reason,
      COALESCE(a.has_accepted, false) AS has_accepted,
      COALESCE(a.has_unknown, false)  AS has_unknown,
      r.status AS request_status
    FROM msg m
    LEFT JOIN public.omni_comms_request r ON r.id = m.request_id
    LEFT JOIN public.omni_comms_business_event_outbox o
           ON o.request_id = m.request_id AND o.organization_id = m.organization_id
    LEFT JOIN public.omni_comms_recipient c ON c.id = m.recipient_id
    LEFT JOIN public.omni_comms_template_family tf ON tf.id = m.template_family_id
    LEFT JOIN public.omni_comms_template_version tv ON tv.id = m.template_version_id
    LEFT JOIN public.omni_comms_sender_identity si ON si.id = m.sender_identity_id
    LEFT JOIN public.omni_comms_provider pv ON pv.id = m.provider_id
    LEFT JOIN job j ON j.message_id = m.id
    LEFT JOIN att a ON a.message_id = m.id
    LEFT JOIN ev     ON ev.message_id = m.id
  ), staged AS (
    SELECT b.*,
      CASE
        WHEN b.complained_at IS NOT NULL THEN 'complained'
        WHEN b.bounced_at    IS NOT NULL THEN 'bounced'
        WHEN b.delivered_at  IS NOT NULL THEN 'delivered'
        WHEN b.has_accepted             THEN 'provider_accepted'
        WHEN b.cancelled_at  IS NOT NULL THEN 'cancelled'
        WHEN b.has_unknown              THEN 'needs_review'
        WHEN b.message_status = 'failed' OR b.request_status = 'failed' THEN 'failed'
        WHEN b.message_status = 'blocked' OR b.request_status = 'blocked'
             OR COALESCE(jsonb_array_length(b.blockers), 0) > 0 THEN 'needs_configuration'
        WHEN b.picked_up_at IS NOT NULL AND b.last_failure_at IS NOT NULL
             AND b.next_attempt_at IS NOT NULL THEN 'retrying'
        WHEN b.picked_up_at IS NOT NULL THEN 'sending'
        WHEN b.queued_at IS NOT NULL AND COALESCE(b.is_runnable, true) THEN 'waiting_to_send'
        WHEN b.queued_at IS NOT NULL THEN 'waiting_to_send'
        WHEN b.message_prepared_at IS NOT NULL THEN 'prepared'
        WHEN b.request_id IS NOT NULL THEN 'preparing'
        ELSE 'event_recorded'
      END AS current_stage
      FROM base b
  ), acted AS (
    SELECT s.*,
      CASE s.current_stage
        WHEN 'complained'        THEN 'Complaint received'
        WHEN 'bounced'           THEN 'Hard bounce received'
        WHEN 'delivered'         THEN 'Delivery callback received'
        WHEN 'provider_accepted' THEN 'Provider accepted'
        WHEN 'cancelled'         THEN 'Delivery cancelled'
        WHEN 'needs_review'      THEN 'Outcome unknown — needs review'
        WHEN 'failed'            THEN 'Delivery failed'
        WHEN 'needs_configuration' THEN 'Needs sender configuration'
        WHEN 'retrying'          THEN 'Retry scheduled'
        WHEN 'sending'           THEN 'Delivery worker picked it up'
        WHEN 'waiting_to_send'   THEN 'Email queued'
        WHEN 'prepared'          THEN 'Email rendered'
        WHEN 'preparing'         THEN 'Policy resolved'
        ELSE 'Business event recorded'
      END AS last_action,
      CASE
        WHEN s.delivered_at IS NOT NULL OR s.bounced_at IS NOT NULL
             OR s.complained_at IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (
               COALESCE(s.delivered_at, s.bounced_at, s.complained_at)
               - s.event_recorded_at)) * 1000)::bigint
        ELSE NULL
      END AS end_to_end_duration_ms
      FROM staged s
  )
  SELECT
    a.message_id, a.business_event_id, a.request_id, a.organization_id,
    a.module_code, a.event_code, a.entity_type, a.entity_id, a.business_reference,
    a.product_id, a.masked_recipient, a.recipient_role, a.template_name,
    a.template_version, a.sender_display, a.provider_name,
    a.current_stage, a.last_action, a.attempt_count,
    a.event_recorded_at, a.message_prepared_at, a.queued_at, a.picked_up_at,
    a.provider_accepted_at, a.callback_at, a.delivered_at, a.last_failure_at,
    a.next_attempt_at, a.end_to_end_duration_ms
  FROM acted a, qq
  WHERE (p_module_code IS NULL OR a.module_code = p_module_code)
    AND (p_event_code  IS NULL OR a.event_code  = p_event_code)
    AND (p_stage       IS NULL OR a.current_stage = p_stage)
    AND (p_product_id  IS NULL OR a.product_id = p_product_id)
    AND (p_from IS NULL OR a.event_recorded_at >= p_from)
    AND (p_to   IS NULL OR a.event_recorded_at <= p_to)
    AND (qq.pat IS NULL
         OR a.business_reference ILIKE qq.pat
         OR a.event_code  ILIKE qq.pat
         OR a.module_code ILIKE qq.pat
         OR a.entity_id   ILIKE qq.pat
         OR a.masked_recipient ILIKE qq.pat);
$function$;

-- ---------------------------------------------------------------- list
CREATE OR REPLACE FUNCTION public.omni_comms_email_journey_list(
  p_organization_id uuid,
  p_module_code text DEFAULT NULL,
  p_event_code  text DEFAULT NULL,
  p_stage       text DEFAULT NULL,
  p_product_id  uuid DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL,
  p_search      text DEFAULT NULL,
  p_limit       integer DEFAULT 25,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit integer; v_offset integer; v_rows jsonb; v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_organization_id);
  IF p_search IS NOT NULL AND length(p_search) > 200 THEN
    RAISE EXCEPTION 'OC422 search_too_long' USING ERRCODE='P0001', DETAIL='search';
  END IF;

  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT count(*) INTO v_total
    FROM public.omni_comms_priv_email_journey_rows(
      p_organization_id, p_module_code, p_event_code, p_stage,
      p_product_id, p_from, p_to, p_search);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.event_recorded_at DESC, t.message_id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT * FROM public.omni_comms_priv_email_journey_rows(
        p_organization_id, p_module_code, p_event_code, p_stage,
        p_product_id, p_from, p_to, p_search)
      ORDER BY event_recorded_at DESC, message_id DESC
      LIMIT v_limit OFFSET v_offset
    ) t;

  RETURN jsonb_build_object(
    'items', v_rows, 'total', COALESCE(v_total, 0),
    'limit', v_limit, 'offset', v_offset, 'generated_at', now());
END;
$function$;

-- ------------------------------------------------------------- summary
CREATE OR REPLACE FUNCTION public.omni_comms_email_journey_summary(
  p_organization_id uuid,
  p_module_code text DEFAULT NULL,
  p_event_code  text DEFAULT NULL,
  p_stage       text DEFAULT NULL,
  p_product_id  uuid DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL,
  p_search      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v jsonb; v_modules jsonb; v_stages jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_organization_id);

  WITH r AS (
    SELECT * FROM public.omni_comms_priv_email_journey_rows(
      p_organization_id, p_module_code, p_event_code, p_stage,
      p_product_id, p_from, p_to, p_search)
  )
  SELECT jsonb_build_object(
    'initiated',         count(*),
    'prepared',          count(*) FILTER (WHERE message_prepared_at IS NOT NULL),
    'queued',            count(*) FILTER (WHERE queued_at IS NOT NULL),
    'picked_up',         count(*) FILTER (WHERE picked_up_at IS NOT NULL),
    'provider_accepted', count(*) FILTER (WHERE provider_accepted_at IS NOT NULL),
    'delivered',         count(*) FILTER (WHERE delivered_at IS NOT NULL),
    'avg_event_to_prepared_ms', (avg(EXTRACT(EPOCH FROM (message_prepared_at - event_recorded_at)) * 1000)
                                  FILTER (WHERE message_prepared_at IS NOT NULL))::bigint,
    'avg_queue_to_accepted_ms', (avg(EXTRACT(EPOCH FROM (provider_accepted_at - queued_at)) * 1000)
                                  FILTER (WHERE provider_accepted_at IS NOT NULL AND queued_at IS NOT NULL))::bigint,
    'avg_accepted_to_delivered_ms', (avg(EXTRACT(EPOCH FROM (delivered_at - provider_accepted_at)) * 1000)
                                  FILTER (WHERE delivered_at IS NOT NULL AND provider_accepted_at IS NOT NULL))::bigint,
    'avg_end_to_end_ms', (avg(end_to_end_duration_ms) FILTER (WHERE end_to_end_duration_ms IS NOT NULL))::bigint,
    'oldest_waiting_at', min(event_recorded_at) FILTER (WHERE current_stage IN ('waiting_to_send','retrying','prepared','preparing'))
  ) INTO v FROM r;

  WITH r AS (
    SELECT * FROM public.omni_comms_priv_email_journey_rows(
      p_organization_id, p_module_code, p_event_code, p_stage,
      p_product_id, p_from, p_to, p_search)
  ), s AS (
    SELECT current_stage AS stage, count(*)::bigint AS total FROM r GROUP BY current_stage
  )
  SELECT COALESCE(jsonb_object_agg(stage, total), '{}'::jsonb) INTO v_stages FROM s;

  WITH r AS (
    SELECT * FROM public.omni_comms_priv_email_journey_rows(
      p_organization_id, p_module_code, p_event_code, p_stage,
      p_product_id, p_from, p_to, p_search)
  ), m AS (
    SELECT COALESCE(module_code, 'UNKNOWN') AS module_code,
           count(*)::bigint AS emails,
           count(*) FILTER (WHERE delivered_at IS NOT NULL)::bigint AS delivered
      FROM r GROUP BY 1 ORDER BY 2 DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'module_code', module_code, 'emails', emails, 'delivered', delivered)), '[]'::jsonb)
    INTO v_modules FROM m;

  RETURN v
    || jsonb_build_object('stages', v_stages)
    || jsonb_build_object('modules', v_modules)
    || jsonb_build_object(
         'needs_attention',
         COALESCE((v_stages->>'needs_configuration')::bigint, 0)
         + COALESCE((v_stages->>'needs_review')::bigint, 0)
         + COALESCE((v_stages->>'failed')::bigint, 0)
         + COALESCE((v_stages->>'bounced')::bigint, 0)
         + COALESCE((v_stages->>'complained')::bigint, 0),
         'delivery_rate',
         CASE WHEN COALESCE((v->>'initiated')::bigint, 0) = 0 THEN NULL
              ELSE round(100.0 * COALESCE((v->>'delivered')::bigint, 0)
                         / (v->>'initiated')::bigint, 1) END,
         'generated_at', now());
END;
$function$;

-- -------------------------------------------------------------- detail
CREATE OR REPLACE FUNCTION public.omni_comms_email_journey_detail(
  p_organization_id uuid,
  p_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row      jsonb;
  v_request  uuid;
  v_audit    jsonb := '[]'::jsonb;
  v_attempts jsonb := '[]'::jsonb;
  v_callbacks jsonb := '[]'::jsonb;
  v_outbox   uuid;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'OC422 message_required' USING ERRCODE='P0001', DETAIL='message_id';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_organization_id);

  SELECT to_jsonb(t) INTO v_row
    FROM (SELECT * FROM public.omni_comms_priv_email_journey_rows(p_organization_id)
           WHERE message_id = p_message_id) t;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'OC404 email_journey_not_found' USING ERRCODE='P0001', DETAIL='message_id';
  END IF;

  v_request := (v_row->>'request_id')::uuid;
  v_outbox  := NULLIF(v_row->>'business_event_id', '')::uuid;

  WITH steps AS (
    SELECT 1 ord, o.created_at at, 'Business event' stage,
           'Business event recorded' action, 'Success' result
      FROM public.omni_comms_business_event_outbox o WHERE o.id = v_outbox
    UNION ALL
    SELECT 2, o.claimed_at, 'Event processing', 'Event claimed', 'Success'
      FROM public.omni_comms_business_event_outbox o
     WHERE o.id = v_outbox AND o.claimed_at IS NOT NULL
    UNION ALL
    SELECT 3, r.created_at, 'Policy', 'Communication request created', 'Success'
      FROM public.omni_comms_request r WHERE r.id = v_request
    UNION ALL
    SELECT 4, c.created_at, 'Recipient',
           'Recipient resolved' || COALESCE(' / ' || c.recipient_role, ''), 'Success'
      FROM public.omni_comms_message m
      JOIN public.omni_comms_recipient c ON c.id = m.recipient_id
     WHERE m.id = p_message_id
    UNION ALL
    SELECT 5, COALESCE(m.rendered_at, m.created_at), 'Rendering', 'Email rendered', 'Success'
      FROM public.omni_comms_message m WHERE m.id = p_message_id
    UNION ALL
    SELECT 6, COALESCE(m.queued_at, j.created_at), 'Queue', 'Email queued', 'Success'
      FROM public.omni_comms_message m
      LEFT JOIN public.omni_comms_dispatch_job j ON j.message_id = m.id
     WHERE m.id = p_message_id AND COALESCE(m.queued_at, j.created_at) IS NOT NULL
    UNION ALL
    SELECT 7, j.locked_at, 'Delivery', 'Job picked up', 'Success'
      FROM public.omni_comms_dispatch_job j
     WHERE j.message_id = p_message_id AND j.locked_at IS NOT NULL
    UNION ALL
    SELECT 8, COALESCE(a.completed_at, a.started_at), 'Provider',
           'Attempt ' || a.attempt_number || ' — ' ||
             COALESCE(a.response_category, a.status, 'attempted'),
           CASE WHEN a.response_category = 'accepted' THEN 'Success'
                WHEN COALESCE(a.response_category,'') = 'outcome_unknown' THEN 'Unknown'
                ELSE 'Failed' END
      FROM public.omni_comms_delivery_attempt a
     WHERE a.message_id = p_message_id
    UNION ALL
    SELECT 9, e.created_at, 'Callback', initcap(replace(e.event_type, '_', ' ')),
           CASE WHEN e.event_type = 'delivered' THEN 'Success'
                WHEN e.event_type IN ('bounced','complained','failed') THEN 'Failed'
                ELSE 'Info' END
      FROM public.omni_comms_message_event e
     WHERE e.message_id = p_message_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', at, 'stage', stage, 'action', action, 'result', result)
           ORDER BY at, ord), '[]'::jsonb)
    INTO v_audit FROM steps WHERE at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'attempt_number', a.attempt_number,
           'started_at', a.started_at,
           'completed_at', a.completed_at,
           'outcome', COALESCE(a.response_category, a.status),
           'retriable', a.is_retriable,
           'failure_category', a.failure_category,
           'latency_ms', a.latency_ms) ORDER BY a.attempt_number), '[]'::jsonb)
    INTO v_attempts
    FROM public.omni_comms_delivery_attempt a
   WHERE a.message_id = p_message_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', e.created_at,
           'event_type', e.event_type,
           'summary', e.summary) ORDER BY e.created_at), '[]'::jsonb)
    INTO v_callbacks
    FROM public.omni_comms_message_event e
   WHERE e.message_id = p_message_id
     AND e.event_type IN ('delivered','bounced','complained','failed','deferred','opened','clicked');

  RETURN v_row
    || jsonb_build_object(
         'audit', v_audit,
         'attempts', v_attempts,
         'callbacks', v_callbacks,
         'technical', jsonb_build_object(
           'message_id', p_message_id,
           'request_id', v_request,
           'business_event_id', v_outbox),
         'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_email_journey_rows(uuid, text, text, text, uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_email_journey_rows(uuid, text, text, text, uuid, timestamptz, timestamptz, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.omni_comms_email_journey_list(uuid, text, text, text, uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_email_journey_summary(uuid, text, text, text, uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_email_journey_detail(uuid, uuid) TO authenticated, service_role;

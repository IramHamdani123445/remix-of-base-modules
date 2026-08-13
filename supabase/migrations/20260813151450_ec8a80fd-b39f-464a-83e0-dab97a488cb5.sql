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
        WHEN b.message_status = 'cancelled' OR b.cancelled_at IS NOT NULL THEN 'cancelled'
        WHEN b.message_status IN ('dry_run_completed','dry_run') THEN 'test_completed'
        WHEN b.has_unknown              THEN 'needs_review'
        WHEN b.message_status = 'failed' OR b.request_status = 'failed' THEN 'failed'
        WHEN b.message_status = 'blocked' OR b.request_status = 'blocked'
             OR COALESCE(jsonb_array_length(b.blockers), 0) > 0 THEN 'needs_configuration'
        WHEN b.picked_up_at IS NOT NULL AND b.last_failure_at IS NOT NULL
             AND b.next_attempt_at IS NOT NULL THEN 'retrying'
        WHEN b.picked_up_at IS NOT NULL THEN 'sending'
        WHEN b.message_status = 'held' OR b.hold_reason IS NOT NULL
             OR (b.queued_at IS NOT NULL AND b.is_runnable IS FALSE) THEN 'held'
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
        WHEN 'test_completed'    THEN 'Test run completed — not sent'
        WHEN 'needs_review'      THEN 'Outcome unknown — needs review'
        WHEN 'failed'            THEN 'Delivery failed'
        WHEN 'needs_configuration' THEN 'Needs sender configuration'
        WHEN 'retrying'          THEN 'Retry scheduled'
        WHEN 'sending'           THEN 'Delivery worker picked it up'
        WHEN 'held'              THEN COALESCE('Held — ' || s.hold_reason, 'Held by release control')
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

REVOKE ALL ON FUNCTION public.omni_comms_priv_email_journey_rows(uuid, text, text, text, uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_email_journey_rows(uuid, text, text, text, uuid, timestamptz, timestamptz, text) TO service_role;

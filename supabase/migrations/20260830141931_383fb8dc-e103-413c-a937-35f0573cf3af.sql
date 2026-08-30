CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_event_status(p_outbox_status text, p_result_code text, p_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  v_held_perm      integer := 0;
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

  -- Held jobs are split by canonical hold classification. A permanently held
  -- historical job (recorded before dispatch activation, or superseded) is
  -- audit evidence: it is NOT waiting for anything and must never be reported
  -- as "Waiting to send".
  SELECT
      count(*) FILTER (WHERE j.is_runnable),
      count(*) FILTER (WHERE NOT j.is_runnable),
      count(*) FILTER (
        WHERE NOT j.is_runnable
          AND public.omni_comms_hold_classification(
                coalesce(j.authorization_outcome, j.hold_reason)
              ) ->> 'bucket' = 'PERMANENT_HISTORICAL')
    INTO v_runnable, v_held, v_held_perm
    FROM public.omni_comms_dispatch_job j
   WHERE j.request_id = p_request_id
     AND j.cancelled_at IS NULL;

  IF v_runnable > 0 THEN RETURN 'sending'; END IF;
  IF v_held > 0 THEN
    IF v_held_perm = v_held THEN
      RETURN 'not_sent_historical';
    END IF;
    RETURN 'waiting_to_send';
  END IF;

  IF v_request_status = 'completed_with_blockers' OR v_blockers > 0 THEN
    RETURN 'needs_review';
  END IF;

  IF v_messages > 0 THEN RETURN 'waiting_to_send'; END IF;

  RETURN 'preparing_communication';
END;
$function$;
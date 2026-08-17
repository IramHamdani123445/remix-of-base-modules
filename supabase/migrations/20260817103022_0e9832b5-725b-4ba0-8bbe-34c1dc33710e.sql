CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_recover_expired_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_job record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('omni_comms.dispatch_worker', 'on', true);

  FOR v_job IN
    SELECT j.id, j.message_id, j.request_id, j.organization_id
    FROM public.omni_comms_dispatch_job j
    WHERE j.channel = 'print'
      AND j.status = 'failed'
      AND j.attempt_count >= 3
      AND NOT EXISTS (
        SELECT 1 FROM public.omni_comms_print_item i WHERE i.message_id = j.message_id
      )
      AND EXISTS (
        SELECT 1 FROM public.omni_comms_delivery_attempt a
        WHERE a.dispatch_job_id = j.id AND a.error_code = 'lease_expired'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.omni_comms_delivery_attempt a
        WHERE a.dispatch_job_id = j.id
          AND coalesce(a.error_code, '') <> 'lease_expired'
          AND a.status NOT IN ('dispatching','started')
      )
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    UPDATE public.omni_comms_dispatch_job
    SET status = 'retry_wait', attempt_count = 0, is_runnable = false,
        next_attempt_at = now(), completed_at = NULL,
        hold_reason = 'automatic_print_lease_recovery',
        lock_token = NULL, locked_at = NULL, locked_by = NULL,
        lease_expires_at = NULL, updated_at = now()
    WHERE id = v_job.id;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      safe_metadata, actor_type, actor_id)
    VALUES (
      v_job.request_id, v_job.message_id, v_job.organization_id,
      'provider_retry_scheduled',
      public.omni_comms_priv_next_event_sequence(v_job.request_id),
      jsonb_build_object('reason', 'worker_lease_expired', 'automatic', true),
      'system', 'omni-comms-print-production');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_print_recover_expired_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_recover_expired_jobs() TO service_role;

SELECT public.omni_comms_priv_print_recover_expired_jobs();
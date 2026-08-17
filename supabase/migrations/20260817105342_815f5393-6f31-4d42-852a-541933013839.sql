
ALTER TABLE public.omni_comms_delivery_attempt
  DROP CONSTRAINT IF EXISTS omni_comms_delivery_attempt_max_attempts_chk;
ALTER TABLE public.omni_comms_delivery_attempt
  ADD CONSTRAINT omni_comms_delivery_attempt_max_attempts_chk
  CHECK (attempt_number <= 6);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_reclaim_expired_leases()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_n integer := 0; v_a record; v_cap integer;
BEGIN
  FOR v_a IN
    SELECT a.id, a.dispatch_job_id, a.message_id, a.organization_id, a.attempt_number,
           j.channel, j.hold_reason
      FROM public.omni_comms_delivery_attempt a
      JOIN public.omni_comms_dispatch_job j ON j.id = a.dispatch_job_id
     WHERE a.status IN ('started','dispatching')
       AND a.lease_expires_at IS NOT NULL
       AND a.lease_expires_at < now()
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    v_cap := CASE
      WHEN v_a.channel = 'print' AND v_a.hold_reason = 'automatic_print_lease_recovery' THEN 6
      ELSE 3 END;

    UPDATE public.omni_comms_delivery_attempt
       SET status = CASE WHEN v_a.attempt_number >= v_cap THEN 'exhausted' ELSE 'outcome_unknown' END,
           completed_at = now(), claim_token = NULL,
           error_code = 'lease_expired',
           error_detail = 'The dispatch lease expired before an outcome was recorded.'
     WHERE id = v_a.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = CASE WHEN v_a.attempt_number >= v_cap THEN 'failed' ELSE 'retry_wait' END,
           is_runnable = false, next_attempt_at = now() + interval '2 minutes',
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_a.dispatch_job_id AND status = 'processing';

    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('reclaimed', v_n);
END; $function$;

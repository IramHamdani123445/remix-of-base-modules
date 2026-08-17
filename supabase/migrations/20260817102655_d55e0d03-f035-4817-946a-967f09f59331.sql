CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_job_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_msg record;
  v_worker boolean := coalesce(current_setting('omni_comms.dispatch_worker', true), '') = 'on';
  v_verified boolean := coalesce(current_setting('omni_comms.verified_callback', true), '') = 'on';
BEGIN
  SELECT organization_id, request_id, channel INTO v_msg FROM public.omni_comms_message WHERE id = NEW.message_id;
  IF v_msg.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 dispatch_message_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.request_id IS DISTINCT FROM NEW.request_id THEN
    RAISE EXCEPTION 'OC422 dispatch_message_request_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.channel <> NEW.channel THEN
    RAISE EXCEPTION 'OC422 dispatch_message_channel_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.mode = 'dry_run' AND NEW.is_runnable = true THEN
    RAISE EXCEPTION 'OC422 dry_run_not_runnable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    IF (
      (OLD.status = 'pending'    AND NEW.status IN ('held','ready','cancelled')) OR
      (OLD.status = 'held'       AND NEW.status IN ('ready','cancelled')) OR
      (OLD.status = 'ready'      AND NEW.status IN ('leased','cancelled')) OR
      (OLD.status = 'leased'     AND NEW.status IN ('processing','ready')) OR
      (OLD.status = 'processing' AND NEW.status IN ('completed','retry_wait','failed')) OR
      (OLD.status = 'retry_wait' AND NEW.status IN ('ready','failed','cancelled'))
    ) THEN
      NULL;
    ELSIF OLD.status = 'failed' AND NEW.status = 'retry_wait' THEN
      IF NOT v_worker OR OLD.channel <> 'print' OR NEW.is_runnable IS NOT FALSE
         OR NEW.hold_reason IS DISTINCT FROM 'automatic_print_lease_recovery' THEN
        RAISE EXCEPTION 'OC403 print_recovery_context_required' USING ERRCODE = 'P0001';
      END IF;
    ELSIF OLD.status = 'processing' AND NEW.status = 'held' THEN
      IF NOT v_worker THEN
        RAISE EXCEPTION 'OC403 dispatch_worker_context_required' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.hold_reason IS DISTINCT FROM 'reconciliation_required' OR NEW.is_runnable IS NOT FALSE THEN
        RAISE EXCEPTION 'OC422 invalid_reconciliation_hold' USING ERRCODE = 'P0001';
      END IF;
    ELSIF OLD.status = 'held'
      AND OLD.hold_reason = 'reconciliation_required'
      AND NEW.status IN ('completed','failed') THEN
      IF NOT v_verified THEN
        RAISE EXCEPTION 'OC403 verified_callback_context_required' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.is_runnable IS NOT FALSE THEN
        RAISE EXCEPTION 'OC422 invalid_reconciliation_resolution' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      RAISE EXCEPTION 'OC422 invalid_dispatch_transition' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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
      AND j.attempt_count >= j.max_attempts
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
      'print_production_requeued',
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
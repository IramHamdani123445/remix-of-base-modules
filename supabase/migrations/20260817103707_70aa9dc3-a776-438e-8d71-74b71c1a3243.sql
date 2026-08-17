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
    ELSIF OLD.status = 'retry_wait' AND NEW.status = 'processing' THEN
      IF NOT v_worker
         OR OLD.channel <> 'print'
         OR OLD.hold_reason IS DISTINCT FROM 'automatic_print_lease_recovery'
         OR NEW.hold_reason IS DISTINCT FROM OLD.hold_reason
         OR NEW.is_runnable IS NOT FALSE
         OR NEW.attempt_count <> OLD.attempt_count + 1
         OR NEW.lock_token IS NULL
         OR NEW.locked_by IS NULL
         OR NEW.lease_expires_at IS NULL THEN
        RAISE EXCEPTION 'OC403 print_recovery_claim_context_required' USING ERRCODE = 'P0001';
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
-- 1. Stop the print worker crashing: attempt budget must never exceed the cap.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_job_attempt_budget()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.attempt_count IS NOT NULL AND NEW.attempt_count > coalesce(NEW.max_attempts, 0) THEN
    NEW.max_attempts := least(25, NEW.attempt_count);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS omni_comms_dispatch_job_attempt_budget ON public.omni_comms_dispatch_job;
CREATE TRIGGER omni_comms_dispatch_job_attempt_budget
BEFORE INSERT OR UPDATE ON public.omni_comms_dispatch_job
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_dispatch_job_attempt_budget();

-- Lease-recovery print jobs are allowed six attempts by the claim RPC.
UPDATE public.omni_comms_dispatch_job
   SET max_attempts = greatest(max_attempts, 6)
 WHERE channel = 'print'
   AND hold_reason = 'automatic_print_lease_recovery'
   AND max_attempts < 6;

-- 2. Queue timing evidence: when the letter artefact was produced / queued.
ALTER TABLE public.omni_comms_print_item
  ADD COLUMN IF NOT EXISTS queued_for_print_at timestamptz;

UPDATE public.omni_comms_print_item
   SET queued_for_print_at = coalesce(queued_for_print_at, updated_at)
 WHERE physical_status = 'queued_for_print';

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_item_stamp_queued()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.physical_status = 'queued_for_print'
     AND (TG_OP = 'INSERT' OR OLD.physical_status IS DISTINCT FROM 'queued_for_print') THEN
    NEW.queued_for_print_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS omni_comms_print_item_stamp_queued ON public.omni_comms_print_item;
CREATE TRIGGER omni_comms_print_item_stamp_queued
BEFORE INSERT OR UPDATE ON public.omni_comms_print_item
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_print_item_stamp_queued();
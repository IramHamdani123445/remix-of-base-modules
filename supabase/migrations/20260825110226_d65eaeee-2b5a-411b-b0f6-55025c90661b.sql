-- Suspend every operational channel release (external delivery off)
UPDATE public.omni_comms_channel_release_control
SET release_state = 'suspended',
    proposed_state = NULL
WHERE release_state <> 'suspended';

-- Turn off scheduled workers that reach external providers or feed them
DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'omni-comms-dispatch-every-minute',
    'process-email-queue',
    'omni-comms-business-event-ingest-every-minute',
    'omni-comms-print-production-every-minute'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = j), active := false);
    END IF;
  END LOOP;
END $$;
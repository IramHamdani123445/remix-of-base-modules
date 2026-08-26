DO $$
DECLARE
  v_job record;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'process-email-queue' LIMIT 1;
  IF v_job.jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_job.jobid, schedule := '* * * * *', active := true);
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'omni-comms-dispatch-every-minute' LIMIT 1;
  IF v_job.jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_job.jobid, schedule := '*/2 * * * *', active := true);
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'omni-comms-business-event-ingest-every-minute' LIMIT 1;
  IF v_job.jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_job.jobid, schedule := '1-59/2 * * * *', active := true);
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'omni-comms-print-production-every-minute' LIMIT 1;
  IF v_job.jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_job.jobid, schedule := '2-59/5 * * * *', active := true);
  END IF;
END $$;

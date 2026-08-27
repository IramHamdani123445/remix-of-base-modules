-- Re-enable recurring workers at a conservative incident-recovery cadence.
DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT * FROM (VALUES
      ('process-email-queue',                            '*/5 * * * *'),
      ('omni-comms-dispatch-every-minute',               '2-59/5 * * * *'),
      ('omni-comms-business-event-ingest-every-minute',  '4-59/10 * * * *')
    ) AS schedules(jobname, schedule)
  LOOP
    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = v_job.jobname LIMIT 1),
      schedule := v_job.schedule,
      active := true
    )
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job.jobname);
  END LOOP;
END $$;
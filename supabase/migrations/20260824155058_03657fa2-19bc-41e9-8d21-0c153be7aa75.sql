-- Database connection stabilization: spread pg_cron workload across minute boundaries.
-- Previous schedules for rollback:
-- process-email-queue                         * * * * *
-- omni-comms-dispatch-every-minute            */2 * * * *
-- omni-comms-business-event-ingest-every-minute 1-59/2 * * * *
-- omni-comms-print-production-every-minute    2-59/5 * * * *
-- ce-audit-communication-dispatch-every-5min  */5 * * * *
-- dms-transfer-retry-drain                    */5 * * * *
-- legal-scheduled-reports-dispatch            */5 * * * *
-- ce-detection-event-runner                   */5 * * * *
-- ce-audit-comm-reminder-escalation           */15 * * * *
-- planner-approval-sla-cron                   */15 * * * *
-- bn-escalation-runner-15m                    */15 * * * *
-- explorer-scheduled-delivery-every-15m       */15 * * * *

DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT * FROM (VALUES
      ('process-email-queue',                            '*/2 * * * *'),
      ('omni-comms-dispatch-every-minute',               '1-59/2 * * * *'),
      ('omni-comms-business-event-ingest-every-minute',  '2-59/3 * * * *'),
      ('omni-comms-print-production-every-minute',       '3-59/5 * * * *'),
      ('ce-audit-communication-dispatch-every-5min',     '1-59/5 * * * *'),
      ('dms-transfer-retry-drain',                       '2-59/5 * * * *'),
      ('legal-scheduled-reports-dispatch',               '3-59/5 * * * *'),
      ('ce-detection-event-runner',                      '4-59/5 * * * *'),
      ('ce-audit-comm-reminder-escalation',              '5-59/15 * * * *'),
      ('planner-approval-sla-cron',                      '7-59/15 * * * *'),
      ('bn-escalation-runner-15m',                       '9-59/15 * * * *'),
      ('explorer-scheduled-delivery-every-15m',          '11-59/15 * * * *')
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
-- Temporary incident recovery pause for recurring workers.
-- Jobs remain registered and their queues remain intact.
DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'ce-audit-communication-dispatch-every-5min',
      'ce-audit-comm-reminder-escalation',
      'process-email-queue',
      'planner-approval-sla-cron',
      'dms-transfer-retry-drain',
      'bn-escalation-runner-15m',
      'explorer-scheduled-delivery-every-15m',
      'legal-scheduled-reports-dispatch',
      'omni-comms-dispatch-every-minute',
      'omni-comms-business-event-ingest-every-minute',
      'ce-detection-event-runner',
      'omni-comms-print-production-every-minute'
    )
  LOOP
    PERFORM cron.alter_job(v_job.jobid, active := false);
  END LOOP;
END $$;
-- 1. Map workers to jobs that had none
UPDATE public.ce_automation_jobs SET parameters = COALESCE(parameters,'{}'::jsonb) || jsonb_build_object('edge_function', v.fn)
FROM (VALUES
  ('JOB-OVERDUE-DETECTION','run-overdue-detection'),
  ('LEDGER-C3-POST','ce-ledger-c3-posting'),
  ('LEDGER-PAY-POST','ce-ledger-payment-posting'),
  ('LEDGER-PENALTY-ACCRUAL','ce-ledger-penalty-accrual'),
  ('LEDGER-RECONCILE','ce-ledger-reconciliation'),
  ('LEDGER-REVERSAL','ce-ledger-reversal'),
  ('LEDGER-BACKFILL','ce-ledger-backfill'),
  ('LEDGER-REBUILD','ce-ledger-rebuild')
) AS v(code, fn)
WHERE ce_automation_jobs.job_code = v.code;

-- 2. Notice generation had no timetable
UPDATE public.ce_automation_jobs
SET schedule_cron = '0 7 * * *'
WHERE job_code = 'JOB-NOTICE-GENERATION' AND COALESCE(btrim(schedule_cron),'') = '';

-- 3. Enable the operational jobs
UPDATE public.ce_automation_jobs
SET is_enabled = true, updated_at = now(), updated_by = 'CHECKPOINT-F'
WHERE job_code IN (
  'JOB-OBLIGATION-LIFECYCLE','JOB-PENALTY-RECALC','JOB-NOTICE-GENERATION',
  'LEDGER-C3-POST','LEDGER-PAY-POST','LEDGER-PENALTY-ACCRUAL','LEDGER-RECONCILE'
);

-- 4. Retire duplicate / legacy shadow rows (kept for audit lineage, never scheduled)
UPDATE public.ce_automation_jobs
SET is_enabled = false,
    schedule_cron = NULL,
    parameters = COALESCE(parameters,'{}'::jsonb) || jsonb_build_object(
      'retired', true,
      'retired_reason', 'Duplicate of live job; retired at Checkpoint F scheduler truth-up',
      'retired_at', now()
    ),
    updated_at = now(),
    updated_by = 'CHECKPOINT-F'
WHERE job_code IN ('BREACH_MONITOR','PENALTY_ENGINE','RISK_RECALC','JOB-BREACH-MONITOR','JOB-ESCALATION-REVIEW','JOB-NOTICE-GEN');

-- 5. Re-sync pg_cron with the job register
SELECT public.ce_sync_automation_job_schedules();
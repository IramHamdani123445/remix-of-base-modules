DO $$
BEGIN
  PERFORM cron.unschedule('audit-due-date-reminders-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('ia-comms-reminder-scheduler-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'ia-comms-reminder-scheduler-daily',
  '15 8 * * *',
  $job$
  SELECT CASE
    WHEN public.platform_try_lease_worker('ia-comms-reminder-scheduler-daily', 1800)
    THEN (SELECT public.ia_comms_generate_reminders(current_date, 1000))::text
    ELSE 'skipped_lease'
  END;
  $job$
);
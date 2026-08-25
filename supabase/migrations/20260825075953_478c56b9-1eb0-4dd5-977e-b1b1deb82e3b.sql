-- Repair: the previous wrapping used btrim(), which strips spaces but NOT newlines.
-- Commands ending ";\n  " therefore kept their inner semicolon and became invalid
-- once nested in a scalar subquery. Restore each command verbatim from the backup
-- captured before the change, then re-wrap using a trim that also removes newlines.

DO $repair$
DECLARE
  r record;
  v_lease integer;
  v_body  text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (b.jobid)
           b.jobid, b.jobname, b.prior_schedule, b.prior_command
      FROM public.platform_worker_command_backup b
      JOIN cron.job j ON j.jobid = b.jobid
     ORDER BY b.jobid, b.captured_at ASC
  LOOP
    v_lease := CASE
      WHEN r.prior_schedule LIKE '%/5 %'  THEN 240
      WHEN r.prior_schedule LIKE '%/10 %' THEN 540
      WHEN r.prior_schedule LIKE '%/15 %' THEN 840
      ELSE 1800
    END;

    -- Strip trailing whitespace, newlines and statement terminators so the
    -- original command is a valid scalar subquery.
    v_body := rtrim(r.prior_command, E' \t\r\n;');

    PERFORM cron.alter_job(
      r.jobid,
      command => format(
        'SELECT CASE WHEN public.platform_try_lease_worker(%L, %s) THEN (%s) ELSE NULL END',
        r.jobname,
        v_lease,
        v_body
      )
    );
  END LOOP;
END;
$repair$;
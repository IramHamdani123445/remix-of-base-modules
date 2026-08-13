CREATE OR REPLACE FUNCTION public.omni_comms_automation_cron_evidence(p_jobname text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_jobid bigint; v_at timestamptz;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = p_jobname LIMIT 1;
  IF v_jobid IS NULL THEN RETURN NULL; END IF;
  BEGIN
    SELECT max(start_time) INTO v_at
      FROM (SELECT jobid, status, start_time
              FROM cron.job_run_details
             ORDER BY runid DESC
             LIMIT 500) recent
     WHERE recent.jobid = v_jobid AND recent.status = 'succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_at := NULL;
  END;
  RETURN v_at;
END; $function$;
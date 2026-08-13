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
      FROM cron.job_run_details
     WHERE jobid = v_jobid
       AND start_time > now() - interval '15 minutes'
       AND status = 'succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_at := NULL;
  END;
  RETURN v_at;
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_automation_cron_evidence(text) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_automation_cron_evidence(text) TO authenticated, service_role;
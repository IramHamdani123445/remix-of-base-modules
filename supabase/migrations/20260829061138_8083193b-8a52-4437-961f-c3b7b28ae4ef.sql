CREATE OR REPLACE FUNCTION public.ce_sync_automation_job_schedules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_headers text;
  v_base    text := 'https://xynceskeiiisiefqlgxo.supabase.co/functions/v1/';
  v_rec     record;
  v_jobname text;
  v_cmd     text;
  v_created int := 0;
  v_removed int := 0;
  v_unmapped text[] := ARRAY[]::text[];
BEGIN
  SELECT substring(command from 'headers:=''(\{[^}]*\})''::jsonb')
    INTO v_headers
  FROM cron.job
  WHERE command LIKE '%functions/v1/%'
    AND command LIKE '%headers:=%'
  ORDER BY jobid
  LIMIT 1;

  IF v_headers IS NULL THEN
    RAISE EXCEPTION 'CE_SCHEDULE_SYNC_NO_TEMPLATE: no existing scheduled edge-function job to inherit request headers from';
  END IF;

  FOR v_rec IN
    SELECT job_code,
           is_enabled,
           NULLIF(btrim(COALESCE(schedule_cron, '')), '') AS schedule_cron,
           NULLIF(btrim(COALESCE(parameters->>'edge_function', '')), '') AS edge_function
    FROM public.ce_automation_jobs
  LOOP
    v_jobname := public.ce_managed_cron_jobname(v_rec.job_code);

    IF v_rec.is_enabled IS TRUE
       AND v_rec.schedule_cron IS NOT NULL
       AND v_rec.edge_function IS NOT NULL THEN

      v_cmd := format(
        $cmd$SELECT CASE WHEN public.platform_try_lease_worker(%L, 1800) THEN (
  SELECT net.http_post(
    url:=%L,
    headers:=%L::jsonb,
    body:=concat('{"dry_run": false, "triggered_by": "SCHEDULER", "job_code": "%s", "time": "', now(), '"}')::jsonb
  )::text) ELSE NULL END$cmd$,
        v_jobname,
        v_base || v_rec.edge_function,
        v_headers,
        v_rec.job_code
      );

      PERFORM cron.schedule(v_jobname, v_rec.schedule_cron, v_cmd);
      v_created := v_created + 1;
    ELSE
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_jobname) THEN
        PERFORM cron.unschedule(v_jobname);
        v_removed := v_removed + 1;
      END IF;

      IF v_rec.is_enabled IS TRUE
         AND v_rec.schedule_cron IS NOT NULL
         AND v_rec.edge_function IS NULL THEN
        v_unmapped := v_unmapped || v_rec.job_code;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scheduled', v_created,
    'unscheduled', v_removed,
    'unmapped_jobs', to_jsonb(v_unmapped),
    'synced_at', now()
  );
END;
$$;
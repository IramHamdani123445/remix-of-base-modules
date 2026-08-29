-- ============================================================
-- Compliance & Enforcement: schedule truth
-- ce_automation_jobs becomes the single source of schedule truth,
-- reconciled into pg_cron.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ce_managed_cron_jobname(p_job_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT 'ce-auto-' || lower(p_job_code) $$;

-- Reconciles pg_cron with ce_automation_jobs.
-- Auth headers are inherited from an existing scheduled compliance job so no
-- credentials are introduced or duplicated by this function.
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
  SELECT substring(command from 'headers:=''(\{.*?\})''::jsonb')
    INTO v_headers
  FROM cron.job
  WHERE command LIKE '%functions/v1/%'
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

GRANT EXECUTE ON FUNCTION public.ce_sync_automation_job_schedules() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_managed_cron_jobname(text) TO authenticated, service_role;

-- Comparison view: configured vs actually running.
CREATE OR REPLACE VIEW public.ce_v_automation_job_schedule_truth AS
SELECT
  j.id,
  j.job_code,
  j.name,
  j.is_enabled,
  j.schedule_cron                                   AS configured_cron,
  j.parameters->>'edge_function'                    AS edge_function,
  c.schedule                                        AS active_cron,
  c.active                                          AS cron_active,
  (c.jobid IS NOT NULL)                             AS is_scheduled,
  CASE
    WHEN j.parameters->>'edge_function' IS NULL AND j.is_enabled THEN 'NO_RUNTIME_BINDING'
    WHEN j.is_enabled AND j.schedule_cron IS NOT NULL AND c.jobid IS NULL THEN 'NOT_SCHEDULED'
    WHEN NOT j.is_enabled AND c.jobid IS NOT NULL THEN 'ORPHAN_SCHEDULE'
    WHEN c.jobid IS NOT NULL AND c.schedule IS DISTINCT FROM j.schedule_cron THEN 'DRIFT'
    WHEN c.jobid IS NOT NULL THEN 'IN_SYNC'
    ELSE 'NOT_APPLICABLE'
  END                                               AS sync_state,
  j.last_run_at,
  j.last_run_status
FROM public.ce_automation_jobs j
LEFT JOIN cron.job c
  ON c.jobname = public.ce_managed_cron_jobname(j.job_code);

GRANT SELECT ON public.ce_v_automation_job_schedule_truth TO authenticated, service_role;

-- Keep pg_cron aligned whenever job configuration changes.
CREATE OR REPLACE FUNCTION public.ce_automation_jobs_schedule_sync_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ce_sync_automation_job_schedules();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_automation_jobs_schedule_sync ON public.ce_automation_jobs;
CREATE TRIGGER trg_ce_automation_jobs_schedule_sync
AFTER INSERT OR UPDATE OF is_enabled, schedule_cron, parameters OR DELETE
ON public.ce_automation_jobs
FOR EACH STATEMENT
EXECUTE FUNCTION public.ce_automation_jobs_schedule_sync_trg();
-- ROOT CAUSE FIX: cron.job_run_details had grown to ~7.9 GB with no autovacuum
-- and no ANALYZE. pg_cron writes one row into this table before every job start,
-- so the bloat stalled job startup ("cron scheduler start timeout") and starved
-- the instance of disk and IO. It holds run-history log rows only -- no business
-- records, messages, deliveries or audit evidence live here.
--
-- TRUNCATE and VACUUM FULL require table ownership (supabase_admin), which is not
-- available, so this prunes with an index-driven batched DELETE keyed on the
-- primary key and lets autovacuum reclaim the space.

CREATE OR REPLACE FUNCTION public.platform_purge_cron_run_details(
  p_keep_runs integer DEFAULT 20000,
  p_max_rows  integer DEFAULT 50000
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_runid bigint;
  v_cutoff    bigint;
  v_deleted   bigint;
BEGIN
  -- Primary-key driven: no sequential scan over the bloated heap.
  SELECT max(runid) INTO v_max_runid FROM cron.job_run_details;
  IF v_max_runid IS NULL THEN
    RETURN 0;
  END IF;

  v_cutoff := v_max_runid - p_keep_runs;
  IF v_cutoff <= 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM cron.job_run_details
   WHERE runid IN (
     SELECT runid
       FROM cron.job_run_details
      WHERE runid < v_cutoff
      ORDER BY runid
      LIMIT p_max_rows
   );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_purge_cron_run_details(integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_purge_cron_run_details(integer, integer) TO service_role;

-- Keep it small forever. Runs often and cheaply; a no-op once caught up.
SELECT cron.schedule(
  'platform-purge-cron-run-details',
  '*/10 * * * *',
  $$SELECT public.platform_purge_cron_run_details(20000, 50000)$$
);
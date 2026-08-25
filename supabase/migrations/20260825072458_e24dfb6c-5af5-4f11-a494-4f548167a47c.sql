-- Platform worker single-flight leases + health registry.
-- Recurring cron workers fire edge functions via net.http_post. Nothing prevented a new
-- run starting while the previous one was still executing, which allowed unbounded
-- overlap during slow periods. This adds a lease so a worker skips its tick when a
-- previous run is still within its execution budget, and records health counters.

CREATE TABLE IF NOT EXISTS public.platform_worker_lease (
  worker_name       text PRIMARY KEY,
  leased_until      timestamptz NOT NULL DEFAULT now(),
  lease_seconds     integer NOT NULL DEFAULT 240,
  last_started_at   timestamptz,
  last_finished_at  timestamptz,
  last_outcome      text,
  run_count         bigint NOT NULL DEFAULT 0,
  skipped_count     bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_worker_lease TO authenticated;
GRANT ALL ON public.platform_worker_lease TO service_role;

ALTER TABLE public.platform_worker_lease ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "worker_lease_read_authenticated" ON public.platform_worker_lease;
CREATE POLICY "worker_lease_read_authenticated"
  ON public.platform_worker_lease FOR SELECT TO authenticated USING (true);

-- Reversibility: keep the exact prior cron command before it is wrapped.
CREATE TABLE IF NOT EXISTS public.platform_worker_command_backup (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jobid         bigint NOT NULL,
  jobname       text NOT NULL,
  prior_schedule text NOT NULL,
  prior_command text NOT NULL,
  captured_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_worker_command_backup TO authenticated;
GRANT ALL ON public.platform_worker_command_backup TO service_role;
ALTER TABLE public.platform_worker_command_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_cmd_backup_no_read" ON public.platform_worker_command_backup;
-- Commands embed service credentials: no client read access at all.

CREATE OR REPLACE FUNCTION public.platform_try_lease_worker(
  p_worker text,
  p_lease_seconds integer DEFAULT 240
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  INSERT INTO public.platform_worker_lease AS l
    (worker_name, leased_until, lease_seconds, last_started_at, run_count)
  VALUES
    (p_worker, now() + make_interval(secs => p_lease_seconds), p_lease_seconds, now(), 1)
  ON CONFLICT (worker_name) DO UPDATE
    SET leased_until    = now() + make_interval(secs => p_lease_seconds),
        lease_seconds   = EXCLUDED.lease_seconds,
        last_started_at = now(),
        run_count       = l.run_count + 1,
        updated_at      = now()
    WHERE l.leased_until <= now()
  RETURNING true INTO v_ok;

  IF v_ok IS NULL THEN
    UPDATE public.platform_worker_lease
       SET skipped_count = skipped_count + 1,
           updated_at = now()
     WHERE worker_name = p_worker;
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_release_worker(
  p_worker text,
  p_outcome text DEFAULT 'ok'
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.platform_worker_lease
     SET leased_until = now(),
         last_finished_at = now(),
         last_outcome = p_outcome,
         updated_at = now()
   WHERE worker_name = p_worker;
$$;

REVOKE ALL ON FUNCTION public.platform_try_lease_worker(text, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_release_worker(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_release_worker(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_try_lease_worker(text, integer) TO service_role;

-- Wrap every active recurring worker in the lease guard, preserving its exact command.
DO $wrap$
DECLARE
  r record;
  v_lease integer;
BEGIN
  FOR r IN
    SELECT jobid, jobname, schedule, command
      FROM cron.job
     WHERE active
       AND command NOT LIKE '%platform_try_lease_worker%'
  LOOP
    -- Execution budget just under the worker's own cadence.
    v_lease := CASE
      WHEN r.schedule LIKE '%/5 %'  THEN 240
      WHEN r.schedule LIKE '%/10 %' THEN 540
      WHEN r.schedule LIKE '%/15 %' THEN 840
      ELSE 1800
    END;

    INSERT INTO public.platform_worker_command_backup (jobid, jobname, prior_schedule, prior_command)
    VALUES (r.jobid, r.jobname, r.schedule, r.command);

    INSERT INTO public.platform_worker_lease (worker_name, lease_seconds, leased_until)
    VALUES (r.jobname, v_lease, now())
    ON CONFLICT (worker_name) DO UPDATE SET lease_seconds = EXCLUDED.lease_seconds;

    PERFORM cron.alter_job(
      r.jobid,
      command => format(
        'SELECT CASE WHEN public.platform_try_lease_worker(%L, %s) THEN (%s) ELSE NULL END',
        r.jobname,
        v_lease,
        rtrim(btrim(r.command), ';')
      )
    );
  END LOOP;
END;
$wrap$;
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(
  p_worker text,
  p_batch_limit integer,
  p_deployed_revision text,
  p_correlation_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_scanned int;
  v_claimed int;
  v_blocker_count int;
  v_raw_blocker text;
  v_blocker text;
BEGIN
  v_result := public.omni_comms_priv_dispatch_claim_email(
    p_worker, p_batch_limit, p_correlation_id, p_deployed_revision, NULL, 'scheduler');

  v_scanned := coalesce((v_result->>'scanned_jobs')::int, 0);
  v_claimed := coalesce((v_result->>'claimed_jobs')::int, 0);
  v_blocker_count := jsonb_array_length(coalesce(v_result->'blockers', '[]'::jsonb));
  v_raw_blocker := nullif(v_result->>'blocker', '');

  -- Zero work is SUCCESS. A tick that scanned nothing and hit no genuine
  -- per-job blocker is healthy and must NOT be recorded as blocked.
  v_blocker := CASE
    WHEN v_scanned = 0 AND v_claimed = 0 AND v_blocker_count = 0 THEN NULL
    ELSE v_raw_blocker
  END;

  INSERT INTO public.omni_comms_scheduler_run (
    worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
  VALUES (
    left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', 'email',
    v_scanned, v_claimed, v_blocker,
    jsonb_build_object(
      'blocker_count', v_blocker_count,
      'jobs_claimed', v_claimed,
      'zero_work', (v_scanned = 0 AND v_claimed = 0),
      'raw_blocker', v_raw_blocker));

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(text, integer, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(text, integer, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(text, integer, text, text) TO service_role;
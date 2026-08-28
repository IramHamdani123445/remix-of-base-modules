CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(p_worker text, p_batch_limit integer, p_deployed_revision text, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_in_app jsonb;
  v_wa jsonb;
  v_claims jsonb;
  v_scanned int;
  v_claimed int;
  v_blocker_count int;
  v_raw_blocker text;
  v_blocker text;
  v_extra jsonb := '{}'::jsonb;
  v_one jsonb;
  v_ch text;
BEGIN
  v_result := public.omni_comms_priv_dispatch_claim_email(
    p_worker, p_batch_limit, p_correlation_id, p_deployed_revision, NULL, 'scheduler');

  v_scanned := coalesce((v_result->>'scanned_jobs')::int, 0);
  v_claimed := coalesce((v_result->>'claimed_jobs')::int, 0);
  v_blocker_count := jsonb_array_length(coalesce(v_result->'blockers', '[]'::jsonb));
  v_raw_blocker := nullif(v_result->>'blocker', '');

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

  v_claims := (
    SELECT coalesce(jsonb_agg(c || jsonb_build_object('channel','email')), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_result->'claims','[]'::jsonb)) AS c);

  v_in_app := public.omni_comms_priv_dispatch_deliver_in_app(
    coalesce(p_worker,'omni-comms-scheduler'), greatest(coalesce(p_batch_limit,5),1), p_correlation_id);

  INSERT INTO public.omni_comms_scheduler_run (
    worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
  VALUES (
    left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', 'in_app',
    coalesce((v_in_app->>'scanned_jobs')::int,0),
    coalesce((v_in_app->>'delivered')::int,0),
    CASE WHEN coalesce((v_in_app->>'blocked')::int,0) > 0 THEN 'in_app_blocked' ELSE NULL END,
    v_in_app);

  v_wa := public.omni_comms_priv_dispatch_claim_whatsapp(
    coalesce(p_worker,'omni-comms-scheduler'), greatest(least(coalesce(p_batch_limit,1),10),1),
    p_correlation_id, p_deployed_revision, 'scheduler');

  INSERT INTO public.omni_comms_scheduler_run (
    worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
  VALUES (
    left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', 'whatsapp',
    coalesce((v_wa->>'scanned_jobs')::int,0),
    coalesce((v_wa->>'claimed_jobs')::int,0),
    nullif(v_wa->>'blocker',''),
    jsonb_build_object('blocker_count', jsonb_array_length(coalesce(v_wa->'blockers','[]'::jsonb))));

  v_claims := v_claims || (
    SELECT coalesce(jsonb_agg(c || jsonb_build_object('channel','whatsapp')), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_wa->'claims','[]'::jsonb)) AS c);

  -- SMS / Push / Webhook / Voice share the generic claim contract.
  FOREACH v_ch IN ARRAY ARRAY['sms','push','webhook','voice'] LOOP
    v_one := public.omni_comms_priv_dispatch_claim_generic(
      p_channel => v_ch,
      p_batch_limit => greatest(least(coalesce(p_batch_limit,1),10),1),
      p_worker => coalesce(p_worker,'omni-comms-scheduler'),
      p_correlation_id => p_correlation_id,
      p_execution_context => 'scheduler',
      p_deployed_revision => p_deployed_revision);

    INSERT INTO public.omni_comms_scheduler_run (
      worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
    VALUES (
      left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', v_ch,
      coalesce((v_one->>'scanned_jobs')::int,0),
      coalesce((v_one->>'claimed_jobs')::int,0),
      nullif(v_one->>'blocker',''),
      jsonb_build_object('blocker_count', jsonb_array_length(coalesce(v_one->'blockers','[]'::jsonb))));

    v_claims := v_claims || coalesce(v_one->'claims','[]'::jsonb);
    v_extra := v_extra || jsonb_build_object(v_ch, v_one);
  END LOOP;

  RETURN v_result
    || jsonb_build_object('claims', v_claims, 'in_app', v_in_app, 'whatsapp', v_wa)
    || v_extra;
END;
$function$;
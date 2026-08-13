CREATE OR REPLACE FUNCTION public.omni_comms_automation_status(
  p_organization_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ing_job record; v_dis_job record;
  v_ing_last record; v_dis_last record;
  v_ing_ok timestamptz; v_dis_ok timestamptz;
  v_ing_cron timestamptz; v_dis_cron timestamptz;
  v_ing_fresh boolean; v_dis_fresh boolean;
  v_ing_blocker text; v_dis_blocker text;
  v_events jsonb; v_jobs jsonb; v_callbacks jsonb; v_runs jsonb;
  v_stale interval := interval '3 minutes';
  v_backlog interval := interval '5 minutes';
BEGIN
  SELECT jobname, schedule, active INTO v_ing_job
    FROM cron.job WHERE jobname = 'omni-comms-business-event-ingest-every-minute' LIMIT 1;
  SELECT jobname, schedule, active INTO v_dis_job
    FROM cron.job WHERE jobname = 'omni-comms-dispatch-every-minute' LIMIT 1;

  SELECT * INTO v_ing_last FROM public.omni_comms_scheduler_run
   WHERE pipeline_stage = 'business_event_ingest' ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_dis_last FROM public.omni_comms_scheduler_run
   WHERE pipeline_stage = 'dispatch' AND execution_context = 'scheduler'
   ORDER BY created_at DESC LIMIT 1;

  SELECT max(created_at) INTO v_ing_ok FROM public.omni_comms_scheduler_run
   WHERE pipeline_stage = 'business_event_ingest' AND blocker IS NULL;
  SELECT max(created_at) INTO v_dis_ok FROM public.omni_comms_scheduler_run
   WHERE pipeline_stage = 'dispatch' AND execution_context = 'scheduler' AND blocker IS NULL;

  v_ing_cron := public.omni_comms_automation_cron_evidence('omni-comms-business-event-ingest-every-minute');
  v_dis_cron := public.omni_comms_automation_cron_evidence('omni-comms-dispatch-every-minute');

  v_ing_fresh := v_ing_ok IS NOT NULL AND v_ing_ok > now() - v_stale;
  v_dis_fresh := v_dis_ok IS NOT NULL AND v_dis_ok > now() - v_stale;

  SELECT jsonb_build_object(
    'pending_events',      count(*) FILTER (WHERE status = 'pending'),
    'processing_events',   count(*) FILTER (WHERE status = 'processing'),
    'retry_events',        count(*) FILTER (WHERE status = 'retry'),
    'blocked_events',      count(*) FILTER (WHERE status = 'blocked'),
    'needs_review_events', count(*) FILTER (WHERE status IN ('blocked', 'needs_review')),
    'oldest_pending_at',   min(created_at) FILTER (WHERE status = 'pending'),
    'oldest_retry_at',     min(next_attempt_at) FILTER (WHERE status = 'retry'))
    INTO v_events
    FROM public.omni_comms_business_event_outbox
   WHERE p_organization_id IS NULL OR organization_id = p_organization_id;

  SELECT jsonb_build_object(
    'waiting_jobs',    count(*) FILTER (WHERE status IN ('pending', 'queued', 'held', 'retry')),
    'ready_jobs',      count(*) FILTER (WHERE is_runnable AND status IN ('pending', 'queued')),
    'held_jobs',       count(*) FILTER (WHERE status = 'held' OR hold_reason IS NOT NULL),
    'retry_wait_jobs', count(*) FILTER (WHERE status = 'retry' OR (next_attempt_at IS NOT NULL AND next_attempt_at > now())),
    'currently_claimed', count(*) FILTER (WHERE locked_at IS NOT NULL AND (lease_expires_at IS NULL OR lease_expires_at > now())),
    'oldest_waiting_at', min(created_at) FILTER (WHERE status IN ('pending', 'queued', 'held', 'retry')))
    INTO v_jobs
    FROM public.omni_comms_dispatch_job
   WHERE p_organization_id IS NULL OR organization_id = p_organization_id;

  v_jobs := coalesce(v_jobs, '{}'::jsonb) || (
    SELECT jsonb_build_object(
      'last_attempt_at', max(created_at),
      'last_provider_accepted_at', max(completed_at) FILTER (WHERE response_category = 'accepted' OR status = 'accepted'),
      'last_outcome_unknown_at', max(completed_at) FILTER (WHERE reconciliation_state = 'required' OR status = 'outcome_unknown'))
      FROM public.omni_comms_delivery_attempt
     WHERE p_organization_id IS NULL OR organization_id = p_organization_id);

  SELECT jsonb_build_object(
    'callback_endpoint_ready', count(*) > 0,
    'last_callback_at',        max(created_at),
    'last_delivered_callback_at', max(created_at) FILTER (WHERE event_type ILIKE '%delivered%'),
    'last_bounce_at',          max(created_at) FILTER (WHERE event_type ILIKE '%bounce%'),
    'last_complaint_at',       max(created_at) FILTER (WHERE event_type ILIKE '%complaint%'),
    'recent_invalid_signature_count', NULL::int)
    INTO v_callbacks
    FROM public.omni_comms_message_event
   WHERE (p_organization_id IS NULL OR organization_id = p_organization_id)
     AND (event_type ILIKE '%callback%' OR event_type ILIKE '%delivered%'
          OR event_type ILIKE '%bounce%' OR event_type ILIKE '%complaint%');

  v_jobs := v_jobs || jsonb_build_object('last_delivered_at', (v_callbacks->>'last_delivered_callback_at'));

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'at' DESC), '[]'::jsonb) INTO v_runs FROM (
    SELECT jsonb_build_object(
      'at', created_at,
      'stage', pipeline_stage,
      'found', coalesce(scanned_jobs, 0),
      'handled', coalesce(claimed_jobs, 0),
      'result', CASE WHEN blocker IS NULL THEN 'success' ELSE 'blocked' END,
      'blocker', blocker) AS r
      FROM public.omni_comms_scheduler_run
     ORDER BY created_at DESC LIMIT 40) s;

  v_ing_blocker := CASE
    WHEN v_ing_job.jobname IS NULL THEN 'scheduler_not_installed'
    WHEN NOT coalesce(v_ing_job.active, false) THEN 'scheduler_inactive'
    WHEN v_ing_cron IS NOT NULL AND v_ing_cron > now() - v_stale
         AND (v_ing_last.created_at IS NULL OR v_ing_last.created_at < now() - v_stale)
      THEN 'worker_did_not_complete'
    WHEN NOT v_ing_fresh THEN 'no_recent_successful_run'
    WHEN (v_events->>'oldest_pending_at') IS NOT NULL
         AND (v_events->>'oldest_pending_at')::timestamptz < now() - v_backlog
      THEN 'events_backlogged'
    WHEN coalesce((v_events->>'needs_review_events')::int, 0) > 0 THEN 'events_need_review'
    ELSE v_ing_last.blocker END;

  v_dis_blocker := CASE
    WHEN v_dis_job.jobname IS NULL THEN 'scheduler_not_installed'
    WHEN NOT coalesce(v_dis_job.active, false) THEN 'scheduler_inactive'
    WHEN v_dis_cron IS NOT NULL AND v_dis_cron > now() - v_stale
         AND (v_dis_last.created_at IS NULL OR v_dis_last.created_at < now() - v_stale)
      THEN 'worker_did_not_complete'
    WHEN NOT v_dis_fresh THEN 'no_recent_successful_run'
    WHEN (v_jobs->>'oldest_waiting_at') IS NOT NULL
         AND coalesce((v_jobs->>'ready_jobs')::int, 0) > 0
         AND (v_jobs->>'oldest_waiting_at')::timestamptz < now() - v_backlog
      THEN 'delivery_backlogged'
    ELSE v_dis_last.blocker END;

  RETURN jsonb_build_object(
    'business_event_processor', jsonb_build_object(
      'worker', 'omni-comms-business-event-ingest',
      'installed', v_ing_job.jobname IS NOT NULL,
      'active', coalesce(v_ing_job.active, false),
      'schedule', v_ing_job.schedule,
      'frequency_label', CASE WHEN v_ing_job.schedule = '* * * * *' THEN 'Runs every minute'
                              WHEN v_ing_job.schedule IS NULL THEN 'Not installed'
                              ELSE 'Runs on a schedule' END,
      'last_run_at', v_ing_last.created_at,
      'last_success_at', v_ing_ok,
      'last_cron_success_at', v_ing_cron,
      'last_result', CASE WHEN v_ing_last.created_at IS NULL THEN NULL
                          WHEN v_ing_last.blocker IS NULL THEN 'success' ELSE 'blocked' END,
      'last_run_found', v_ing_last.scanned_jobs,
      'last_run_handled', v_ing_last.claimed_jobs,
      'last_run_detail', v_ing_last.detail,
      'last_blocker', v_ing_blocker,
      'run_fresh', coalesce(v_ing_fresh, false),
      'healthy', v_ing_blocker IS NULL) || coalesce(v_events, '{}'::jsonb),
    'delivery_processor', jsonb_build_object(
      'worker', 'omni-comms-dispatch',
      'installed', v_dis_job.jobname IS NOT NULL,
      'active', coalesce(v_dis_job.active, false),
      'schedule', v_dis_job.schedule,
      'frequency_label', CASE WHEN v_dis_job.schedule = '* * * * *' THEN 'Runs every minute'
                              WHEN v_dis_job.schedule IS NULL THEN 'Not installed'
                              ELSE 'Runs on a schedule' END,
      'last_run_at', v_dis_last.created_at,
      'last_success_at', v_dis_ok,
      'last_cron_success_at', v_dis_cron,
      'last_result', CASE WHEN v_dis_last.created_at IS NULL THEN NULL
                          WHEN v_dis_last.blocker IS NULL THEN 'success' ELSE 'blocked' END,
      'last_run_found', v_dis_last.scanned_jobs,
      'last_run_handled', v_dis_last.claimed_jobs,
      'last_blocker', v_dis_blocker,
      'run_fresh', coalesce(v_dis_fresh, false),
      'healthy', v_dis_blocker IS NULL) || coalesce(v_jobs, '{}'::jsonb),
    'callback_receiver', coalesce(v_callbacks, '{}'::jsonb) || jsonb_build_object(
      'healthy', coalesce((v_callbacks->>'callback_endpoint_ready')::boolean, false)),
    'recent_runs', v_runs,
    'thresholds', jsonb_build_object('stale_run_seconds', 180, 'backlog_seconds', 300),
    'generated_at', now());
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_automation_status(uuid) TO authenticated, service_role, anon;
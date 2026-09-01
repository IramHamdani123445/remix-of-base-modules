-- DATABASE DISPATCH AUTHORITY: the runtime may only PROPOSE a runnable job.
-- The database independently re-evaluates the same fail-closed contract.
DO $do$
DECLARE src text; before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_persist_rendered_messages';
  IF src IS NULL THEN RAISE EXCEPTION 'persist_missing'; END IF;

  before := src;
  src := replace(src,
    '  v_jobs_created  int := 0;',
    '  v_jobs_created  int := 0;
  v_runnable_jobs int := 0;
  v_proposed      boolean;
  v_authz         text;
  v_effective     boolean;
  v_reason        text;
  v_job_status    text;
  v_msg_dept      uuid;
  v_module        text;');
  IF src = before THEN RAISE EXCEPTION 'anchor_declare'; END IF;

  before := src;
  src := replace(src,
    '    IF coalesce(v_job->>''status'','''') <> ''held''
       OR coalesce((v_job->>''is_runnable'')::boolean, true) <> false THEN
      RAISE EXCEPTION ''OC422 runnable_job_forbidden'' USING ERRCODE=''P0001'';
    END IF;',
    '    IF coalesce(v_job->>''status'','''') NOT IN (''held'',''queued'') THEN
      RAISE EXCEPTION ''OC422 invalid_job_status'' USING ERRCODE=''P0001'';
    END IF;
    -- The Edge Function only ever PROPOSES a runnable job.
    v_proposed := coalesce((v_job->>''is_runnable'')::boolean, false)
                  AND coalesce(v_job->>''status'','''') = ''queued''
                  AND v_req.mode = ''queued'';');
  IF src = before THEN RAISE EXCEPTION 'anchor_guard'; END IF;

  before := src;
  src := replace(src,
    '    v_message_id := v_message_ids[v_idx + 1];

    INSERT INTO public.omni_comms_dispatch_job (',
    '    v_message_id := v_message_ids[v_idx + 1];

    SELECT m.department_id INTO v_msg_dept
      FROM public.omni_comms_message m WHERE m.id = v_message_id;
    SELECT r.caller_module_code INTO v_module
      FROM public.omni_comms_request r WHERE r.id = p_request_id;

    v_authz := NULL;
    IF v_proposed THEN
      v_authz := public.omni_comms_priv_evaluate_dispatch_authorization(
        p_organization_id, v_msg_dept, v_job->>''channel'',
        v_module, v_req.mode, NULL, NULL, v_req.created_at, NULL);
    END IF;

    v_effective  := v_proposed AND v_authz IS NULL;
    v_job_status := CASE WHEN v_effective THEN ''ready'' ELSE ''held'' END;
    v_reason     := CASE
                      WHEN v_effective THEN NULL
                      WHEN v_authz IS NOT NULL THEN left(v_authz, 200)
                      ELSE left(coalesce(v_job->>''hold_reason'',''runtime_hold''), 200)
                    END;
    IF v_effective THEN
      v_runnable_jobs := v_runnable_jobs + 1;
    END IF;

    INSERT INTO public.omni_comms_dispatch_job (');
  IF src = before THEN RAISE EXCEPTION 'anchor_authz'; END IF;

  before := src;
  src := replace(src,
    '      v_job->>''channel'', v_req.mode, ''held'',
      100, NULL, NULL, 0, 5,
      v_req.correlation_id, false,
      left(coalesce(v_job->>''hold_reason'',''runtime_hold''), 200)
    );',
    '      v_job->>''channel'', v_req.mode, v_job_status,
      100, NULL, NULL, 0, 5,
      v_req.correlation_id, v_effective,
      v_reason
    );');
  IF src = before THEN RAISE EXCEPTION 'anchor_insert'; END IF;

  before := src;
  src := replace(src,
    '      p_request_id, v_message_id, p_organization_id, ''dispatch_held'',
      public.omni_comms_priv_next_event_sequence(p_request_id),
      ''rendered'', ''held'',
      jsonb_build_object(
        ''channel'',     v_job->>''channel'',
        ''mode'',        v_req.mode,
        ''hold_reason'', v_job->>''hold_reason'',
        ''is_runnable'', false
      ),',
    '      p_request_id, v_message_id, p_organization_id,
      CASE WHEN v_effective THEN ''dispatch_ready'' ELSE ''dispatch_held'' END,
      public.omni_comms_priv_next_event_sequence(p_request_id),
      ''rendered'', v_job_status,
      jsonb_build_object(
        ''channel'',            v_job->>''channel'',
        ''mode'',               v_req.mode,
        ''hold_reason'',        v_reason,
        ''is_runnable'',        v_effective,
        ''proposed_runnable'',  v_proposed,
        ''database_decision'',  coalesce(v_authz, ''authorized'')
      ),');
  IF src = before THEN RAISE EXCEPTION 'anchor_event'; END IF;

  before := src;
  src := replace(src,
    '      ''runnable_jobs'',   0',
    '      ''runnable_jobs'',   v_runnable_jobs');
  IF src = before THEN RAISE EXCEPTION 'anchor_summary'; END IF;

  before := src;
  src := replace(src,
    '    ''held_job_count'', v_jobs_created
  );',
    '    ''held_job_count'', v_jobs_created,
    ''runnable_job_count'', v_runnable_jobs
  );');
  IF src = before THEN RAISE EXCEPTION 'anchor_return'; END IF;

  EXECUTE src;
END
$do$;

-- Governed in-app delivery worker. It only ever drains jobs the DATABASE
-- authorised (status = 'ready' AND is_runnable), so while the activation
-- record is empty it drains nothing.
SELECT cron.unschedule('omni-comms-in-app-delivery')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'omni-comms-in-app-delivery');

SELECT cron.schedule(
  'omni-comms-in-app-delivery',
  '6-59/10 * * * *',
  $cron$
  SELECT CASE
    WHEN public.platform_try_lease_worker('omni-comms-in-app-delivery', 240)
    THEN (SELECT public.omni_comms_priv_dispatch_deliver_in_app('omni-comms-in-app', 5, NULL)::text)
    ELSE 'skipped_lease'
  END
  $cron$
);
ALTER FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid)
  RENAME TO _bn_uprating_run_command_epic1;

CREATE OR REPLACE FUNCTION public.bn_uprating_run_command_v1(
  p_command_name text,
  p_actor_user_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_run_id uuid DEFAULT NULL::uuid,
  p_exception_id uuid DEFAULT NULL::uuid,
  p_expected_row_version integer DEFAULT NULL::integer,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_correlation_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_hash text;
  v_cache public.bn_uprating_command_idempotency%ROWTYPE;
  r public.bn_uprating_run%ROWTYPE;
  p public.bn_uprating_run_approval_package%ROWTYPE;
  a public.bn_uprating_run_approval%ROWTYPE;
  s public.bn_uprating_execution_schedule%ROWTYPE;
  v_snap public.bn_uprating_run_snapshot%ROWTYPE;
  v_sim public.bn_uprating_simulation%ROWTYPE;
  v_ver public.bn_uprating_policy_version%ROWTYPE;
  v_ready jsonb; v_result jsonb; v_cfg jsonb;
  v_prev text; v_new text; v_actor_name text;
  v_cycle int; v_pkg_id uuid; v_appr_id uuid; v_sched_id uuid; v_sched_ver int;
  v_decision text; v_reason text; v_just text;
  v_planned timestamptz; v_tz text; v_ws timestamptz; v_we timestamptz;
  v_batch int; v_conc int; v_lead int;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNAUTHENTICATED','message','You must be signed in to perform this action.','data',NULL);
  END IF;

  v_hash := md5(COALESCE(p_payload::text,''));
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_cache FROM public.bn_uprating_command_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_cache.command_name IS DISTINCT FROM p_command_name OR v_cache.payload_hash IS DISTINCT FROM v_hash THEN
        RETURN jsonb_build_object('status','ERROR','code','E_IDEMPOTENCY_MISMATCH',
          'message','This request key has already been used with different details. Start a new request.','data',NULL);
      END IF;
      RETURN v_cache.result_json || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  IF p_command_name NOT IN ('BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL','BN_UPRATING_APPROVE_RUN',
      'BN_UPRATING_SCHEDULE_EXECUTION','BN_UPRATING_RESCHEDULE_EXECUTION','BN_UPRATING_CANCEL_EXECUTION_SCHEDULE') THEN
    RETURN public._bn_uprating_run_command_epic1(p_command_name, p_actor_user_id, p_payload, p_run_id,
      p_exception_id, p_expected_row_version, p_idempotency_key, p_correlation_id);
  END IF;

  IF p_run_id IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_INVALID_PAYLOAD','message','An uprating run must be selected.','data',NULL);
  END IF;

  IF p_command_name = 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL' THEN
    PERFORM public._bn_uprating_require(p_actor_user_id,'decide',true);
  ELSE
    PERFORM public._bn_uprating_require(p_actor_user_id,'admin',true);
  END IF;

  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> r.row_version THEN
    RETURN jsonb_build_object('status','ERROR','code','E_STALE_ROW_VERSION',
      'message','This run has changed since you loaded it. Reload and try again.','data',
      jsonb_build_object('row_version', r.row_version));
  END IF;

  v_actor_name := public._bn_uprating_actor_name(p_actor_user_id);
  v_prev := r.status; v_new := r.status;
  v_cfg := public._bn_uprating_schedule_config();

  -- ============ SUBMIT FOR APPROVAL ============
  IF p_command_name = 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL' THEN
    v_ready := public._bn_uprating_approval_readiness(p_run_id, p_actor_user_id);
    IF NOT COALESCE((v_ready->>'can_submit')::boolean,false) THEN
      RETURN jsonb_build_object('status','ERROR',
        'code', COALESCE(v_ready->'blockers'->0->>'code','E_NOT_READY'),
        'message', COALESCE(v_ready->'blockers'->0->>'message','This run is not ready for approval.'),
        'data', jsonb_build_object('blockers', v_ready->'blockers'));
    END IF;

    SELECT * INTO v_snap FROM public.bn_uprating_run_snapshot WHERE snapshot_id = r.current_snapshot_id;
    SELECT * INTO v_sim FROM public.bn_uprating_simulation WHERE simulation_id = r.current_simulation_id;
    SELECT * INTO v_ver FROM public.bn_uprating_policy_version WHERE policy_version_id = r.policy_version_id;
    v_cycle := COALESCE(r.approval_cycle_count,0) + 1;

    INSERT INTO public.bn_uprating_run_approval_package(
      run_id, cycle_no, run_row_version, policy_id, policy_version_id, policy_version_reference,
      frozen_policy_type, target_effective_date, scope_description, snapshot_id, snapshot_version,
      snapshot_fingerprint, simulation_id, simulation_version, input_fingerprint,
      population_total, included_count, excluded_count, exception_count, unresolved_blocking_count,
      failed_item_count, current_total_minor, proposed_total_minor, delta_total_minor,
      status, submitted_by, submitted_by_name, correlation_id)
    VALUES (r.run_id, v_cycle, r.row_version + 1, r.policy_id, r.policy_version_id, v_ver.version_reference,
      r.frozen_policy_type, r.target_effective_date, r.scope_description, v_snap.snapshot_id,
      v_snap.snapshot_version, v_snap.snapshot_fingerprint, v_sim.simulation_id, v_sim.simulation_version,
      v_sim.input_fingerprint, COALESCE(v_snap.total_items,0), COALESCE(v_snap.eligible_items,0),
      COALESCE(v_snap.excluded_items,0), COALESCE(v_snap.exception_items,0),
      (SELECT count(*) FROM public.bn_uprating_run_exception
        WHERE snapshot_id = v_snap.snapshot_id AND resolution_status='OPEN' AND is_blocking),
      COALESCE(v_sim.failed_items,0), COALESCE(v_sim.current_total_minor,0),
      COALESCE(v_sim.proposed_total_minor,0), COALESCE(v_sim.delta_total_minor,0),
      'CURRENT', p_actor_user_id, v_actor_name, p_correlation_id)
    RETURNING package_id INTO v_pkg_id;

    INSERT INTO public.bn_uprating_run_approval(
      run_id, package_id, cycle_no, status, submitted_by, submitted_by_name, submission_note, correlation_id)
    VALUES (r.run_id, v_pkg_id, v_cycle, 'PENDING', p_actor_user_id, v_actor_name,
      NULLIF(p_payload->>'submission_note',''), p_correlation_id)
    RETURNING approval_id INTO v_appr_id;

    UPDATE public.bn_uprating_run
       SET status = 'AWAITING_APPROVAL', current_approval_package_id = v_pkg_id,
           current_approval_id = v_appr_id, approval_cycle_count = v_cycle,
           row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    v_new := 'AWAITING_APPROVAL';

    PERFORM public._bn_uprating_run_event(r.run_id,'APPROVAL_REQUESTED','Submitted for approval',
      'Approval cycle ' || v_cycle || ' submitted with simulation v' || v_sim.simulation_version || '.',
      v_prev, v_new, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status','OK','code',NULL,'message','Run submitted for approval.','data',
      jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'package_id', v_pkg_id,'approval_id', v_appr_id,'cycle_no', v_cycle));

  -- ============ APPROVE / RETURN ============
  ELSIF p_command_name = 'BN_UPRATING_APPROVE_RUN' THEN
    v_decision := upper(COALESCE(NULLIF(trim(p_payload->>'decision'),''),''));
    v_reason := NULLIF(trim(COALESCE(p_payload->>'decision_reason','')),'');
    v_just := NULLIF(trim(COALESCE(p_payload->>'justification','')),'');
    IF v_decision NOT IN ('APPROVE','RETURN_FOR_REWORK') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_PAYLOAD','message','Select approve or return for rework.','data',NULL);
    END IF;
    IF v_reason IS NULL OR v_just IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_JUSTIFICATION_REQUIRED','message','A reason and a justification are required for this decision.','data',NULL);
    END IF;
    IF r.status <> 'AWAITING_APPROVAL' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','This run is not awaiting an approval decision.','data',NULL);
    END IF;

    SELECT * INTO a FROM public.bn_uprating_run_approval
     WHERE run_id = r.run_id AND status = 'PENDING' ORDER BY cycle_no DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NO_PENDING_APPROVAL','message','There is no approval cycle awaiting a decision.','data',NULL);
    END IF;
    SELECT * INTO p FROM public.bn_uprating_run_approval_package WHERE package_id = a.package_id;

    IF a.submitted_by = p_actor_user_id THEN
      RETURN jsonb_build_object('status','ERROR','code','E_MAKER_CHECKER','message','You submitted this run for approval, so you cannot decide it. An independent officer must approve.','data',NULL);
    END IF;
    SELECT * INTO v_sim FROM public.bn_uprating_simulation WHERE simulation_id = p.simulation_id;
    IF v_sim.simulated_by = p_actor_user_id THEN
      RETURN jsonb_build_object('status','ERROR','code','E_MAKER_CHECKER','message','You prepared the simulation for this run, so you cannot decide it. An independent officer must approve.','data',NULL);
    END IF;
    IF p.run_row_version IS DISTINCT FROM r.row_version
       OR p.simulation_id IS DISTINCT FROM r.current_simulation_id
       OR p.snapshot_id IS DISTINCT FROM r.current_snapshot_id
       OR p.input_fingerprint IS DISTINCT FROM r.input_fingerprint THEN
      RETURN jsonb_build_object('status','ERROR','code','E_APPROVAL_STALE',
        'message','The submitted package no longer matches the run. Resubmit a fresh package for approval.','data',NULL);
    END IF;

    IF v_decision = 'APPROVE' THEN
      UPDATE public.bn_uprating_run_approval
         SET status='APPROVED', decision='APPROVE', decision_reason=v_reason, justification=v_just,
             decided_by=p_actor_user_id, decided_by_name=v_actor_name, decided_at=now(),
             row_version = row_version + 1, updated_at = now()
       WHERE approval_id = a.approval_id;
      UPDATE public.bn_uprating_run_approval_package SET status='APPROVED' WHERE package_id = p.package_id;
      UPDATE public.bn_uprating_run
         SET status='APPROVED', approved_at = now(), approved_by = p_actor_user_id,
             approved_by_name = v_actor_name, row_version = row_version + 1, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
      UPDATE public.bn_uprating_run_approval_package SET run_row_version = r.row_version WHERE package_id = p.package_id;
      v_new := 'APPROVED';
      PERFORM public._bn_uprating_run_event(r.run_id,'RUN_APPROVED','Run approved',
        'Approval cycle ' || a.cycle_no || ' approved. Reason: ' || v_reason,
        v_prev, v_new, p_actor_user_id, p_correlation_id);
      v_result := jsonb_build_object('status','OK','code',NULL,'message','Run approved. No award or payment has changed.','data',
        jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
          'approval_id', a.approval_id,'cycle_no', a.cycle_no,'decision','APPROVE'));
    ELSE
      UPDATE public.bn_uprating_run_approval
         SET status='RETURNED', decision='RETURN_FOR_REWORK', decision_reason=v_reason, justification=v_just,
             decided_by=p_actor_user_id, decided_by_name=v_actor_name, decided_at=now(),
             row_version = row_version + 1, updated_at = now()
       WHERE approval_id = a.approval_id;
      UPDATE public.bn_uprating_run_approval_package SET status='HISTORICAL' WHERE package_id = p.package_id;
      UPDATE public.bn_uprating_run
         SET status='DRY_RUN', current_approval_package_id = NULL, current_approval_id = NULL,
             row_version = row_version + 1, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
      v_new := 'DRY_RUN';
      PERFORM public._bn_uprating_run_event(r.run_id,'APPROVAL_RETURNED','Returned for rework',
        'Approval cycle ' || a.cycle_no || ' returned. Reason: ' || v_reason,
        v_prev, v_new, p_actor_user_id, p_correlation_id);
      v_result := jsonb_build_object('status','OK','code',NULL,'message','Run returned for rework.','data',
        jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
          'approval_id', a.approval_id,'cycle_no', a.cycle_no,'decision','RETURN_FOR_REWORK'));
    END IF;

  -- ============ SCHEDULE / RESCHEDULE ============
  ELSIF p_command_name IN ('BN_UPRATING_SCHEDULE_EXECUTION','BN_UPRATING_RESCHEDULE_EXECUTION') THEN
    IF r.status <> 'APPROVED' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only an approved run may be scheduled for execution.','data',NULL);
    END IF;
    SELECT * INTO p FROM public.bn_uprating_run_approval_package WHERE package_id = r.current_approval_package_id;
    SELECT * INTO a FROM public.bn_uprating_run_approval WHERE approval_id = r.current_approval_id;
    IF p.package_id IS NULL OR a.approval_id IS NULL OR a.status <> 'APPROVED' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NO_APPROVAL','message','There is no current approved package for this run.','data',NULL);
    END IF;
    IF p.simulation_id IS DISTINCT FROM r.current_simulation_id
       OR p.input_fingerprint IS DISTINCT FROM r.input_fingerprint THEN
      RETURN jsonb_build_object('status','ERROR','code','E_APPROVAL_STALE','message','The approved package no longer matches the current run.','data',NULL);
    END IF;

    SELECT * INTO s FROM public.bn_uprating_execution_schedule
     WHERE run_id = r.run_id AND status IN ('PLANNED','DUE')
     ORDER BY schedule_version DESC LIMIT 1 FOR UPDATE;
    IF p_command_name = 'BN_UPRATING_SCHEDULE_EXECUTION' AND s.schedule_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_SCHEDULE_EXISTS','message','This run already has an active execution schedule. Reschedule it instead.','data',NULL);
    END IF;
    IF p_command_name = 'BN_UPRATING_RESCHEDULE_EXECUTION' AND s.schedule_id IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NO_SCHEDULE','message','There is no active execution schedule to change.','data',NULL);
    END IF;

    v_planned := NULLIF(p_payload->>'planned_execution_at','')::timestamptz;
    v_tz := COALESCE(NULLIF(trim(p_payload->>'time_zone'),''), v_cfg->>'DEFAULT_TIME_ZONE');
    v_ws := NULLIF(p_payload->>'window_start_at','')::timestamptz;
    v_we := NULLIF(p_payload->>'window_end_at','')::timestamptz;
    v_batch := COALESCE(NULLIF(p_payload->>'batch_size','')::int, (v_cfg->>'DEFAULT_BATCH_SIZE')::int);
    v_conc := COALESCE(NULLIF(p_payload->>'max_concurrent_batches','')::int, (v_cfg->>'DEFAULT_MAX_CONCURRENT_BATCHES')::int);
    v_lead := COALESCE((v_cfg->>'MIN_LEAD_MINUTES')::int, 0);

    IF v_planned IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_PAYLOAD','message','A planned execution date and time is required.','data',NULL);
    END IF;
    IF v_planned < now() + make_interval(mins => v_lead) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_SCHEDULE_IN_PAST',
        'message','The planned execution time must be at least ' || v_lead || ' minutes in the future.','data',NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_TIME_ZONE','message','That time zone is not recognised.','data',NULL);
    END IF;
    IF v_ws IS NOT NULL AND v_we IS NOT NULL AND v_we <= v_ws THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_WINDOW','message','The execution window must end after it starts.','data',NULL);
    END IF;
    IF v_ws IS NOT NULL AND v_we IS NOT NULL AND (v_planned < v_ws OR v_planned > v_we) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_WINDOW','message','The planned execution time must fall inside the execution window.','data',NULL);
    END IF;
    IF v_batch < (v_cfg->>'MIN_BATCH_SIZE')::int OR v_batch > (v_cfg->>'MAX_BATCH_SIZE')::int THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_BATCH_SIZE',
        'message','Batch size must be between ' || (v_cfg->>'MIN_BATCH_SIZE') || ' and ' || (v_cfg->>'MAX_BATCH_SIZE') || '.','data',NULL);
    END IF;
    IF v_conc < 1 OR v_conc > (v_cfg->>'MAX_CONCURRENT_BATCHES')::int THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_CONCURRENCY',
        'message','Concurrent batches must be between 1 and ' || (v_cfg->>'MAX_CONCURRENT_BATCHES') || '.','data',NULL);
    END IF;

    SELECT COALESCE(max(schedule_version),0) + 1 INTO v_sched_ver
      FROM public.bn_uprating_execution_schedule WHERE run_id = r.run_id;

    IF s.schedule_id IS NOT NULL THEN
      UPDATE public.bn_uprating_execution_schedule
         SET status='SUPERSEDED', superseded_at = now(), row_version = row_version + 1, updated_at = now()
       WHERE schedule_id = s.schedule_id;
    END IF;

    INSERT INTO public.bn_uprating_execution_schedule(
      run_id, approval_id, package_id, schedule_version, status, planned_execution_at, time_zone,
      window_start_at, window_end_at, batch_size, max_concurrent_batches, batch_strategy, notes,
      supersedes_schedule_id, created_by, created_by_name, correlation_id)
    VALUES (r.run_id, a.approval_id, p.package_id, v_sched_ver, 'PLANNED', v_planned, v_tz,
      v_ws, v_we, v_batch, v_conc,
      COALESCE(NULLIF(trim(p_payload->>'batch_strategy'),''),'SEQUENTIAL_BY_AWARD'),
      NULLIF(trim(p_payload->>'notes'),''), s.schedule_id, p_actor_user_id, v_actor_name, p_correlation_id)
    RETURNING schedule_id INTO v_sched_id;

    UPDATE public.bn_uprating_run
       SET current_schedule_id = v_sched_id, row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    UPDATE public.bn_uprating_run_approval_package SET run_row_version = r.row_version WHERE package_id = p.package_id;
    v_new := r.status;

    PERFORM public._bn_uprating_run_event(r.run_id,
      CASE WHEN s.schedule_id IS NULL THEN 'EXECUTION_SCHEDULED' ELSE 'EXECUTION_RESCHEDULED' END,
      CASE WHEN s.schedule_id IS NULL THEN 'Execution scheduled' ELSE 'Execution rescheduled' END,
      'Planned for ' || to_char(v_planned AT TIME ZONE v_tz,'YYYY-MM-DD HH24:MI') || ' (' || v_tz ||
      '), batch size ' || v_batch || '. No award or payment has changed.',
      v_prev, v_new, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status','OK','code',NULL,
      'message', CASE WHEN s.schedule_id IS NULL THEN 'Execution scheduled. Nothing has been executed.'
                      ELSE 'Execution rescheduled. Nothing has been executed.' END,
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'schedule_id', v_sched_id,'schedule_version', v_sched_ver,'planned_execution_at', v_planned,
        'time_zone', v_tz,'batch_size', v_batch,'max_concurrent_batches', v_conc));

  -- ============ CANCEL SCHEDULE ============
  ELSE
    v_reason := NULLIF(trim(COALESCE(p_payload->>'cancelled_reason','')),'');
    IF v_reason IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_JUSTIFICATION_REQUIRED','message','A reason is required to cancel an execution schedule.','data',NULL);
    END IF;
    SELECT * INTO s FROM public.bn_uprating_execution_schedule
     WHERE run_id = r.run_id AND status IN ('PLANNED','DUE')
     ORDER BY schedule_version DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NO_SCHEDULE','message','There is no active execution schedule to cancel.','data',NULL);
    END IF;
    UPDATE public.bn_uprating_execution_schedule
       SET status='CANCELLED', cancelled_reason = v_reason, cancelled_at = now(),
           cancelled_by = p_actor_user_id, cancelled_by_name = v_actor_name,
           row_version = row_version + 1, updated_at = now()
     WHERE schedule_id = s.schedule_id;
    UPDATE public.bn_uprating_run
       SET current_schedule_id = NULL, row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    UPDATE public.bn_uprating_run_approval_package SET run_row_version = r.row_version
     WHERE package_id = r.current_approval_package_id;
    v_new := r.status;
    PERFORM public._bn_uprating_run_event(r.run_id,'EXECUTION_SCHEDULE_CANCELLED','Execution schedule cancelled',
      'Reason: ' || v_reason, v_prev, v_new, p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Execution schedule cancelled.','data',
      jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'schedule_id', s.schedule_id));
  END IF;

  INSERT INTO public.bn_uprating_command_audit(command_name, run_id, policy_id, policy_version_id,
    previous_status, new_status, actor_user_id, actor_name, reason_code, justification,
    payload, result_status, correlation_id, idempotency_key)
  VALUES (p_command_name, r.run_id, r.policy_id, r.policy_version_id, v_prev, v_new,
    p_actor_user_id, v_actor_name, NULLIF(p_payload->>'reason_code',''),
    COALESCE(NULLIF(p_payload->>'justification',''), NULLIF(p_payload->>'cancelled_reason','')),
    p_payload, v_result->>'status', p_correlation_id, p_idempotency_key);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_uprating_command_idempotency(idempotency_key, command_name, payload_hash,
      result_json, actor_user_id, correlation_id)
    VALUES (p_idempotency_key, p_command_name, v_hash, v_result, p_actor_user_id, p_correlation_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END; $function$;

REVOKE ALL ON FUNCTION public._bn_uprating_run_command_epic1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_approval_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_execution_schedule_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_approval_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_approval_queue_v1(uuid,jsonb,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_scheduled_run_queue_v1(uuid,jsonb,integer,integer) TO authenticated, service_role;

-- ---------- Backend-driven action availability (all stages) ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_run_actions_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.bn_uprating_run%ROWTYPE; v_write boolean; v_decide boolean; v_admin boolean;
  v_block int := 0; v_actions jsonb := '[]'::jsonb; v_pre boolean;
  a public.bn_uprating_run_approval%ROWTYPE; s public.bn_uprating_execution_schedule%ROWTYPE;
  v_ready jsonb; v_maker boolean := false;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  v_write  := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false);
  v_decide := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  v_admin  := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);
  v_pre := r.status IN ('DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN');
  IF r.current_snapshot_id IS NOT NULL THEN
    SELECT count(*) INTO v_block FROM public.bn_uprating_run_exception
     WHERE snapshot_id = r.current_snapshot_id AND resolution_status='OPEN' AND is_blocking;
  END IF;

  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_UPDATE_RUN','label','Edit run',
    'available', v_write AND r.status='DRAFT',
    'reason', CASE WHEN NOT v_write THEN 'You do not have permission to edit runs.'
                   WHEN r.status<>'DRAFT' THEN 'Only a draft run can be edited.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_PARAMETERISE_RUN','label','Lock parameters',
    'available', v_write AND r.status='DRAFT',
    'reason', CASE WHEN NOT v_write THEN 'You do not have permission to lock run parameters.'
                   WHEN r.status<>'DRAFT' THEN 'Parameters are already locked.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_BUILD_POPULATION',
    'label', CASE WHEN r.current_snapshot_id IS NULL THEN 'Build population' ELSE 'Rebuild population' END,
    'available', v_decide AND r.status IN ('PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN'),
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to build the population.'
                   WHEN r.status='DRAFT' THEN 'Lock the run parameters first.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval or scheduling.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RESOLVE_EXCEPTION','label','Resolve exceptions',
    'available', v_decide AND v_pre AND r.current_snapshot_id IS NOT NULL AND v_block > 0,
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to resolve exceptions.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval or scheduling.'
                   WHEN r.current_snapshot_id IS NULL THEN 'Build the population first.'
                   WHEN v_block = 0 THEN 'There are no open blocking exceptions.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SIMULATE','label','Run simulation',
    'available', v_decide AND v_pre AND r.current_snapshot_id IS NOT NULL AND v_block = 0
                 AND COALESCE(r.frozen_policy_type,'') NOT IN ('FORMULA_DRIVEN','MANUAL_IMPORT'),
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to simulate.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval or scheduling.'
                   WHEN r.current_snapshot_id IS NULL THEN 'Build the population first.'
                   WHEN v_block > 0 THEN 'Resolve all blocking exceptions first.'
                   WHEN COALESCE(r.frozen_policy_type,'') IN ('FORMULA_DRIVEN','MANUAL_IMPORT')
                        THEN 'This policy method cannot be simulated automatically in this release.'
                   ELSE NULL END);

  v_ready := public._bn_uprating_approval_readiness(p_run_id, p_actor_user_id);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL','label','Submit for approval',
    'available', COALESCE((v_ready->>'can_submit')::boolean,false),
    'reason', v_ready->'blockers'->0->>'message');

  SELECT * INTO a FROM public.bn_uprating_run_approval
   WHERE run_id = r.run_id AND status='PENDING' ORDER BY cycle_no DESC LIMIT 1;
  IF a.approval_id IS NOT NULL THEN
    v_maker := a.submitted_by = p_actor_user_id
      OR EXISTS (SELECT 1 FROM public.bn_uprating_simulation x
                  WHERE x.simulation_id = r.current_simulation_id AND x.simulated_by = p_actor_user_id);
  END IF;
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_APPROVE_RUN','label','Record approval decision',
    'available', v_admin AND r.status='AWAITING_APPROVAL' AND a.approval_id IS NOT NULL AND NOT v_maker,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to decide uprating approvals.'
                   WHEN r.status<>'AWAITING_APPROVAL' THEN 'This run is not awaiting an approval decision.'
                   WHEN v_maker THEN 'You prepared or submitted this run, so an independent officer must decide it.'
                   ELSE NULL END);

  SELECT * INTO s FROM public.bn_uprating_execution_schedule
   WHERE run_id = r.run_id AND status IN ('PLANNED','DUE') ORDER BY schedule_version DESC LIMIT 1;
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SCHEDULE_EXECUTION','label','Schedule execution',
    'available', v_admin AND r.status='APPROVED' AND s.schedule_id IS NULL,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to schedule execution.'
                   WHEN r.status<>'APPROVED' THEN 'Only an approved run may be scheduled.'
                   WHEN s.schedule_id IS NOT NULL THEN 'This run already has an active execution schedule.'
                   ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RESCHEDULE_EXECUTION','label','Reschedule execution',
    'available', v_admin AND r.status='APPROVED' AND s.schedule_id IS NOT NULL,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to schedule execution.'
                   WHEN s.schedule_id IS NULL THEN 'There is no active execution schedule.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_CANCEL_EXECUTION_SCHEDULE','label','Cancel schedule',
    'available', v_admin AND s.schedule_id IS NOT NULL,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to schedule execution.'
                   WHEN s.schedule_id IS NULL THEN 'There is no active execution schedule.' ELSE NULL END);

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'run_id', r.run_id,'status', r.status,'row_version', r.row_version,
    'simulation_state', r.simulation_state,'blocking_exceptions', v_block,
    'approval_cycle_count', r.approval_cycle_count,
    'has_active_schedule', s.schedule_id IS NOT NULL,
    'actions', v_actions));
END; $function$;

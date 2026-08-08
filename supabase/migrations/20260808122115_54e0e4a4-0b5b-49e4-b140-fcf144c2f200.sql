-- ============================================================
-- BN Uprating Epic 4 — command boundary, reconciliation and
-- controlled compensating rollback. Never closes the run.
-- ============================================================

CREATE OR REPLACE FUNCTION public._bn_uprating_latest_execution_items(p_run_id uuid)
RETURNS SETOF public.bn_uprating_execution_item
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT DISTINCT ON (i.simulation_item_id) i.*
    FROM public.bn_uprating_execution_item i
   WHERE i.run_id = p_run_id
   ORDER BY i.simulation_item_id, (i.status='APPLIED') DESC, i.attempt_no DESC, i.created_at DESC
$function$;

-- ---------- Epic 4 command boundary ----------
ALTER FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid)
  RENAME TO _bn_uprating_run_command_epic3;

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
  v_hash text; v_cache public.bn_uprating_command_idempotency%ROWTYPE;
  r public.bn_uprating_run%ROWTYPE;
  p public.bn_uprating_run_approval_package%ROWTYPE;
  es public.bn_uprating_execution_session%ROWTYPE;
  ro public.bn_uprating_rollback_operation%ROWTYPE;
  rec public.bn_uprating_reconciliation%ROWTYPE;
  it record; v_cfg jsonb; v_ready jsonb; v_result jsonb; v_res jsonb;
  v_prev text; v_new text; v_actor_name text; v_justif text; v_reason text;
  v_intent_id uuid; v_event_code text; v_tolerance bigint;
  v_processed int := 0; v_ok int := 0; v_failed int := 0;
  v_expected_count int := 0; v_applied int := 0; v_exec_failed int := 0; v_executed int := 0;
  v_exp_base bigint := 0; v_exp_prop bigint := 0; v_exp_delta bigint := 0;
  v_act_prior bigint := 0; v_act_new bigint := 0; v_act_delta bigint := 0;
  v_sched_req int := 0; v_sched_done int := 0; v_sched_fail int := 0; v_sched_pend int := 0; v_sched_unexp int := 0;
  v_comm_req int := 0; v_comm_sent int := 0; v_comm_fail int := 0; v_comm_pend int := 0;
  v_comm_unexp int := 0; v_comm_deliv int := 0; v_comm_missing int := 0; v_sched_missing int := 0;
  v_blocking int := 0; v_warning int := 0; v_status text; v_no int;
  v_eligible int := 0; v_ineligible int := 0; v_comp int := 0; v_compfail int := 0;
  v_comp_delta bigint := 0; v_completion jsonb; v_paid boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNAUTHENTICATED','message','You must be signed in to perform this action.','data',NULL);
  END IF;

  IF p_command_name NOT IN ('BN_UPRATING_REBUILD_SCHEDULES','BN_UPRATING_ISSUE_COMMUNICATIONS',
      'BN_UPRATING_RECONCILE_RUN','BN_UPRATING_MARK_FAILED','BN_UPRATING_ASSESS_ROLLBACK',
      'BN_UPRATING_ROLLBACK_ELIGIBLE') THEN
    RETURN public._bn_uprating_run_command_epic3(p_command_name, p_actor_user_id, p_payload, p_run_id,
      p_exception_id, p_expected_row_version, p_idempotency_key, p_correlation_id);
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

  IF p_run_id IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_INVALID_PAYLOAD','message','An uprating run must be selected.','data',NULL);
  END IF;

  PERFORM public._bn_uprating_require(p_actor_user_id,
    CASE WHEN p_command_name IN ('BN_UPRATING_MARK_FAILED','BN_UPRATING_ROLLBACK_ELIGIBLE')
         THEN 'admin' ELSE 'decide' END, true);

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
  v_cfg   := public._bn_uprating_epic4_config();
  v_prev  := r.status; v_new := r.status;
  v_justif := NULLIF(btrim(COALESCE(p_payload->>'justification','')),'');
  v_reason := NULLIF(btrim(COALESCE(p_payload->>'reason_code','')),'');
  SELECT * INTO p  FROM public.bn_uprating_run_approval_package WHERE package_id = r.current_approval_package_id;
  SELECT * INTO es FROM public.bn_uprating_execution_session WHERE run_id = p_run_id FOR UPDATE;
  v_ready := public._bn_uprating_post_execution_readiness(p_run_id, p_actor_user_id);
  v_completion := v_ready->'completion';

  -- ================= REBUILD SCHEDULES =================
  IF p_command_name = 'BN_UPRATING_REBUILD_SCHEDULES' THEN
    IF NOT (COALESCE((v_ready->>'can_rebuild_schedules')::boolean,false)
            OR COALESCE((v_ready->>'can_retry_schedule_rebuild')::boolean,false)) THEN
      RETURN jsonb_build_object('status','ERROR',
        'code', COALESCE(v_ready->'blockers'->0->>'code','E_NOT_READY'),
        'message', COALESCE(v_ready->'blockers'->0->>'message',
          'Schedule consequences cannot be rebuilt for this run yet.'),
        'data', jsonb_build_object('blockers', v_ready->'blockers'));
    END IF;

    INSERT INTO public.bn_uprating_schedule_rebuild(run_id, session_id, package_id, execution_item_id,
      award_id, award_reference, effective_date, award_rate_history_id, applied_amount_minor,
      request_key, correlation_id)
    SELECT r.run_id, es.session_id, p.package_id, i.execution_item_id, i.award_id, i.award_reference,
           es.target_effective_date, i.award_rate_history_id, COALESCE(i.applied_amount_minor,0),
           'BNUPR-SCH:'||r.run_id::text||':'||i.execution_item_id::text, p_correlation_id
      FROM public._bn_uprating_latest_execution_items(r.run_id) i
     WHERE i.status = 'APPLIED'
    ON CONFLICT (execution_item_id) DO NOTHING;

    FOR it IN SELECT * FROM public.bn_uprating_schedule_rebuild
               WHERE run_id = r.run_id AND (status = 'PENDING' OR (status='FAILED' AND is_retryable))
               ORDER BY award_reference FOR UPDATE
    LOOP
      v_res := public.bn_payment_schedule_rebuild_for_award_v1(it.award_id, it.effective_date,
        'BN_UPRATING', r.run_reference, it.request_key, p_actor_user_id);
      UPDATE public.bn_uprating_schedule_rebuild
         SET status = v_res->>'status',
             attempt_no = attempt_no + CASE WHEN status='FAILED' THEN 1 ELSE 0 END,
             schedule_rows_rebuilt = COALESCE((v_res->>'rows_rebuilt')::int,0),
             schedule_reference = v_res->>'schedule_reference',
             failure_code = v_res->>'failure_code',
             failure_reason = v_res->>'failure_reason',
             is_retryable = COALESCE((v_res->>'is_retryable')::boolean,false),
             processed_at = now(), updated_at = now()
       WHERE rebuild_id = it.rebuild_id;
      v_processed := v_processed + 1;
      IF v_res->>'status' = 'COMPLETED' THEN v_ok := v_ok + 1; ELSE v_failed := v_failed + 1; END IF;
    END LOOP;

    SELECT count(*) FILTER (WHERE status NOT IN ('COMPLETED','NOT_REQUIRED'))
      INTO v_sched_fail FROM public.bn_uprating_schedule_rebuild WHERE run_id = r.run_id;

    IF v_sched_fail = 0 THEN
      IF NOT public._bn_uprating_epic4_can_transition(r.status,'SCHEDULES_REBUILT') THEN
        RETURN jsonb_build_object('status','ERROR','code','E_INVALID_TRANSITION',
          'message','This run is not in a state where schedule consequences can be completed.','data',NULL);
      END IF;
      v_new := 'SCHEDULES_REBUILT';
      UPDATE public.bn_uprating_run
         SET status = v_new, schedules_rebuilt_at = now(),
             execution_finalised_at = COALESCE(execution_finalised_at, now()),
             row_version = row_version + 1, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
      PERFORM public._bn_uprating_run_event(r.run_id,'SCHEDULES_REBUILT','Schedule consequences rebuilt',
        v_ok||' award schedule(s) rebuilt by the paying domain.', v_prev, v_new, p_actor_user_id, p_correlation_id);
    ELSE
      PERFORM public._bn_uprating_run_event(r.run_id,'SCHEDULE_REBUILD_ATTEMPTED','Schedule rebuild attempted',
        v_ok||' succeeded, '||v_failed||' failed.', v_prev, v_new, p_actor_user_id, p_correlation_id);
    END IF;

    v_result := jsonb_build_object('status','OK','code',NULL,
      'message', CASE WHEN v_sched_fail = 0 THEN 'Schedule consequences were rebuilt.'
                      ELSE 'Some schedule consequences could not be rebuilt.' END,
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'processed_count', v_processed,'completed_count', v_ok,'failed_count', v_failed,
        'outstanding_count', v_sched_fail));
  END IF;

  -- ================= ISSUE COMMUNICATIONS =================
  IF p_command_name = 'BN_UPRATING_ISSUE_COMMUNICATIONS' THEN
    IF NOT (COALESCE((v_ready->>'can_issue_communications')::boolean,false)
            OR COALESCE((v_ready->>'can_retry_communications')::boolean,false)) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_READY',
        'message','Claimant notices can only be issued once schedule consequences are complete.','data',
        jsonb_build_object('blockers', v_ready->'blockers'));
    END IF;
    v_event_code := COALESCE(NULLIF(v_cfg->>'COMMUNICATION_EVENT_CODE',''),'BN_UPRATING_AWARD_UPRATED');

    INSERT INTO public.bn_uprating_communication_intent(run_id, session_id, execution_item_id, award_id,
      award_reference, intent_kind, event_code, dispatch_key, context, correlation_id)
    SELECT r.run_id, es.session_id, i.execution_item_id, i.award_id, i.award_reference,
           'UPRATING_APPLIED', v_event_code,
           'BNUPR-COM:'||r.run_id::text||':'||i.execution_item_id::text||':UPRATING_APPLIED',
           jsonb_build_object('run_reference', r.run_reference,
             'effective_date', es.target_effective_date,
             'previous_amount_minor', i.approved_base_amount_minor,
             'new_amount_minor', i.applied_amount_minor,
             'increase_minor', i.applied_delta_minor),
           p_correlation_id
      FROM public._bn_uprating_latest_execution_items(r.run_id) i
     WHERE i.status = 'APPLIED'
    ON CONFLICT (execution_item_id, intent_kind) DO NOTHING;

    FOR it IN SELECT * FROM public.bn_uprating_communication_intent
               WHERE run_id = r.run_id AND (status='PENDING' OR (status='FAILED' AND is_retryable))
               ORDER BY award_reference
    LOOP
      v_res := public._bn_uprating_request_communication(it.intent_id);
      UPDATE public.bn_uprating_communication_intent
         SET status = CASE WHEN v_res->>'status' IN ('REQUESTED','REPLAYED') THEN 'REQUESTED' ELSE 'FAILED' END,
             hub_status = v_res->>'hub_status',
             communication_request_id = COALESCE((v_res->>'communication_request_id')::uuid, communication_request_id),
             attempts = attempts + 1, requested_at = COALESCE(requested_at, now()),
             accepted_at = CASE WHEN v_res->>'status' IN ('REQUESTED','REPLAYED') THEN now() ELSE accepted_at END,
             failure_code = v_res->>'failure_code', failure_reason = v_res->>'failure_reason',
             is_retryable = COALESCE((v_res->>'is_retryable')::boolean,false), updated_at = now()
       WHERE intent_id = it.intent_id;
      v_processed := v_processed + 1;
      IF v_res->>'status' IN ('REQUESTED','REPLAYED') THEN v_ok := v_ok + 1; ELSE v_failed := v_failed + 1; END IF;
    END LOOP;

    SELECT count(*) FILTER (WHERE status='PENDING' OR (status='FAILED' AND is_retryable))
      INTO v_comm_pend FROM public.bn_uprating_communication_intent
     WHERE run_id = r.run_id AND intent_kind='UPRATING_APPLIED';

    IF v_comm_pend = 0 AND r.status = 'SCHEDULES_REBUILT' THEN
      v_new := 'COMMUNICATIONS_ISSUED';
      UPDATE public.bn_uprating_run
         SET status = v_new, communications_issued_at = now(),
             row_version = row_version + 1, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
      PERFORM public._bn_uprating_run_event(r.run_id,'COMMUNICATIONS_ISSUED','Claimant notices issued',
        v_ok||' notice(s) accepted by the Communication Hub.', v_prev, v_new, p_actor_user_id, p_correlation_id);
    ELSE
      PERFORM public._bn_uprating_run_event(r.run_id,'COMMUNICATIONS_ATTEMPTED','Claimant notices attempted',
        v_ok||' accepted, '||v_failed||' not accepted.', v_prev, v_new, p_actor_user_id, p_correlation_id);
    END IF;

    v_result := jsonb_build_object('status','OK','code',NULL,
      'message', CASE WHEN v_comm_pend = 0 THEN 'Claimant notices were submitted to the Communication Hub.'
                      ELSE 'Some claimant notices are still outstanding.' END,
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'processed_count', v_processed,'requested_count', v_ok,'failed_count', v_failed,
        'outstanding_count', v_comm_pend));
  END IF;

  -- ================= RECONCILE RUN (canonical) =================
  IF p_command_name = 'BN_UPRATING_RECONCILE_RUN' THEN
    IF r.status NOT IN ('COMMUNICATIONS_ISSUED','RECONCILED') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_TRANSITION',
        'message','A run can only be reconciled once execution, schedules and notices are complete.','data',
        jsonb_build_object('status', r.status));
    END IF;
    IF es.session_id IS NOT NULL AND es.started_by = p_actor_user_id THEN
      RETURN jsonb_build_object('status','ERROR','code','E_MAKER_CHECKER',
        'message','You executed this run, so an independent officer must reconcile it.','data',NULL);
    END IF;

    v_tolerance := GREATEST(COALESCE(NULLIF(v_cfg->>'RECONCILIATION_TOLERANCE_MINOR','')::bigint,0),0);

    SELECT count(*), count(*) FILTER (WHERE status='APPLIED'), count(*) FILTER (WHERE status='FAILED'),
           COALESCE(sum(approved_base_amount_minor),0), COALESCE(sum(approved_amount_minor),0),
           COALESCE(sum(approved_delta_minor),0),
           COALESCE(sum(approved_base_amount_minor) FILTER (WHERE status='APPLIED'),0),
           COALESCE(sum(applied_amount_minor) FILTER (WHERE status='APPLIED'),0),
           COALESCE(sum(applied_delta_minor) FILTER (WHERE status='APPLIED'),0)
      INTO v_executed, v_applied, v_exec_failed, v_exp_base, v_exp_prop, v_exp_delta,
           v_act_prior, v_act_new, v_act_delta
      FROM public._bn_uprating_latest_execution_items(r.run_id);

    v_expected_count := COALESCE(NULLIF(p.included_count,0), v_executed);
    v_exp_delta := COALESCE(NULLIF(p.delta_total_minor,0), v_exp_delta);

    SELECT count(*), count(*) FILTER (WHERE status='COMPLETED'), count(*) FILTER (WHERE status='FAILED'),
           count(*) FILTER (WHERE status='PENDING')
      INTO v_sched_req, v_sched_done, v_sched_fail, v_sched_pend
      FROM public.bn_uprating_schedule_rebuild WHERE run_id = r.run_id;
    SELECT count(*) INTO v_sched_missing FROM public._bn_uprating_latest_execution_items(r.run_id) i
     WHERE i.status='APPLIED' AND NOT EXISTS (SELECT 1 FROM public.bn_uprating_schedule_rebuild sr
       WHERE sr.execution_item_id = i.execution_item_id AND sr.status IN ('COMPLETED','NOT_REQUIRED'));
    SELECT count(*) INTO v_sched_unexp FROM public.bn_uprating_schedule_rebuild sr
     WHERE sr.run_id = r.run_id AND NOT EXISTS (
       SELECT 1 FROM public._bn_uprating_latest_execution_items(r.run_id) i
        WHERE i.execution_item_id = sr.execution_item_id AND i.status='APPLIED');

    SELECT count(*), count(*) FILTER (WHERE status='REQUESTED'), count(*) FILTER (WHERE status='FAILED'),
           count(*) FILTER (WHERE status='PENDING'),
           count(*) FILTER (WHERE COALESCE(hub_delivery_status,'')='DELIVERED')
      INTO v_comm_req, v_comm_sent, v_comm_fail, v_comm_pend, v_comm_deliv
      FROM public.bn_uprating_communication_intent
     WHERE run_id = r.run_id AND intent_kind='UPRATING_APPLIED';
    SELECT count(*) INTO v_comm_missing FROM public._bn_uprating_latest_execution_items(r.run_id) i
     WHERE i.status='APPLIED' AND NOT EXISTS (SELECT 1 FROM public.bn_uprating_communication_intent ci
       WHERE ci.execution_item_id = i.execution_item_id AND ci.intent_kind='UPRATING_APPLIED' AND ci.status='REQUESTED');
    SELECT count(*) INTO v_comm_unexp FROM public.bn_uprating_communication_intent ci
     WHERE ci.run_id = r.run_id AND ci.intent_kind='UPRATING_APPLIED' AND NOT EXISTS (
       SELECT 1 FROM public._bn_uprating_latest_execution_items(r.run_id) i
        WHERE i.execution_item_id = ci.execution_item_id AND i.status='APPLIED');

    SELECT COALESCE(max(reconciliation_no),0) + 1 INTO v_no
      FROM public.bn_uprating_reconciliation WHERE run_id = r.run_id;
    UPDATE public.bn_uprating_reconciliation SET is_current = false WHERE run_id = r.run_id AND is_current;

    INSERT INTO public.bn_uprating_reconciliation(run_id, reconciliation_no, package_id, session_id,
      status, expected_item_count, actual_executed_item_count, actual_applied_item_count,
      actual_failed_item_count, expected_current_total_minor, expected_proposed_total_minor,
      expected_delta_total_minor, actual_prior_total_minor, actual_new_total_minor, actual_delta_total_minor,
      variance_amount_minor, variance_count, tolerance_amount_minor,
      schedule_required_count, schedule_completed_count, schedule_failed_count, schedule_pending_count,
      communication_required_count, communication_requested_count, communication_failed_count,
      communication_pending_count, communication_delivered_count, finance_confirmation_available,
      performed_by, performed_by_name, correlation_id, idempotency_key)
    VALUES (r.run_id, v_no, p.package_id, es.session_id, 'PASS',
      v_expected_count, v_executed, v_applied, v_exec_failed,
      v_exp_base, v_exp_prop, v_exp_delta, v_act_prior, v_act_new, v_act_delta,
      abs(v_exp_delta - v_act_delta), v_expected_count - v_applied, v_tolerance,
      v_sched_req, v_sched_done, v_sched_fail, v_sched_pend,
      v_comm_req, v_comm_sent, v_comm_fail, v_comm_pend, v_comm_deliv, false,
      p_actor_user_id, v_actor_name, p_correlation_id, p_idempotency_key)
    RETURNING * INTO rec;

    IF NOT COALESCE((v_completion->>'execution_complete')::boolean,false) THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity, detail)
      VALUES (rec.reconciliation_id, r.run_id,'OUTSTANDING_EXECUTION_WORK','BLOCKING','Execution is not complete.');
    END IF;
    IF v_applied <> v_expected_count THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity,
        expected_value, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'EXECUTION_COUNT_MISMATCH','BLOCKING',
        v_expected_count::text, v_applied::text,'The number of applied award changes does not match the approved package.');
    END IF;
    IF abs(v_exp_delta - v_act_delta) > v_tolerance THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity,
        expected_value, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'EXECUTION_AMOUNT_MISMATCH','BLOCKING',
        v_exp_delta::text, v_act_delta::text,'The applied award total does not match the approved simulated total.');
    END IF;
    IF v_sched_missing > 0 THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'MISSING_SCHEDULE_REBUILD','BLOCKING', v_sched_missing::text,
        'Applied award changes without a completed schedule consequence.');
    END IF;
    IF v_sched_fail > 0 THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'FAILED_SCHEDULE_REBUILD','BLOCKING', v_sched_fail::text,
        'Required schedule rebuilds failed.');
    END IF;
    IF v_sched_unexp > 0 THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'UNEXPECTED_SCHEDULE_REBUILD','BLOCKING', v_sched_unexp::text,
        'Schedule rebuilds exist for award changes that were not applied.');
    END IF;
    IF v_comm_missing > 0 THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'MISSING_COMMUNICATION_INTENT','BLOCKING', v_comm_missing::text,
        'Applied award changes without an accepted Communication Hub request.');
    END IF;
    IF v_comm_fail > 0 THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'FAILED_COMMUNICATION_INTENT','WARNING', v_comm_fail::text,
        'Some claimant notices were not accepted by the Communication Hub.');
    END IF;
    IF v_comm_unexp > 0 THEN
      INSERT INTO public.bn_uprating_reconciliation_finding(reconciliation_id, run_id, finding_code, severity, actual_value, detail)
      VALUES (rec.reconciliation_id, r.run_id,'UNEXPECTED_COMMUNICATION_INTENT','BLOCKING', v_comm_unexp::text,
        'Communication requests exist for award changes that were not applied.');
    END IF;

    SELECT count(*) FILTER (WHERE severity='BLOCKING'), count(*) FILTER (WHERE severity='WARNING')
      INTO v_blocking, v_warning FROM public.bn_uprating_reconciliation_finding
     WHERE reconciliation_id = rec.reconciliation_id;
    v_status := CASE WHEN v_blocking > 0 THEN 'BLOCKED'
                     WHEN v_warning > 0 THEN 'PASS_WITH_WARNINGS' ELSE 'PASS' END;
    UPDATE public.bn_uprating_reconciliation
       SET status = v_status, finding_count = v_blocking + v_warning, blocking_finding_count = v_blocking
     WHERE reconciliation_id = rec.reconciliation_id RETURNING * INTO rec;

    IF v_status <> 'BLOCKED' AND r.status = 'COMMUNICATIONS_ISSUED' THEN
      v_new := 'RECONCILED';
      UPDATE public.bn_uprating_run
         SET status = v_new, reconciled_at = now(), current_reconciliation_id = rec.reconciliation_id,
             row_version = row_version + 1, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
    ELSE
      UPDATE public.bn_uprating_run SET current_reconciliation_id = rec.reconciliation_id, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
    END IF;
    PERFORM public._bn_uprating_run_event(r.run_id,'RUN_RECONCILED','Run reconciled',
      'Reconciliation '||v_no||' result '||v_status||'.', v_prev, r.status, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status', CASE WHEN v_status='BLOCKED' THEN 'BLOCKED' ELSE 'OK' END,
      'code', CASE WHEN v_status='BLOCKED' THEN 'E_RECONCILIATION_BLOCKED' ELSE NULL END,
      'message', CASE WHEN v_status='BLOCKED' THEN 'Reconciliation found material differences that must be resolved.'
                      WHEN v_status='PASS_WITH_WARNINGS' THEN 'The run reconciled with observations.'
                      ELSE 'The run reconciled cleanly.' END,
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'reconciliation_id', rec.reconciliation_id,'reconciliation_no', v_no,
        'reconciliation_status', v_status,'blocking_finding_count', v_blocking,'finding_count', v_blocking + v_warning));
  END IF;

  -- ================= MARK FAILED =================
  IF p_command_name = 'BN_UPRATING_MARK_FAILED' THEN
    IF v_justif IS NULL OR length(v_justif) < 10 THEN
      RETURN jsonb_build_object('status','ERROR','code','E_JUSTIFICATION_REQUIRED',
        'message','Record why this run failed, in at least 10 characters.','data',NULL);
    END IF;
    IF NOT COALESCE((v_ready->>'can_mark_failed')::boolean,false) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_TRANSITION',
        'message','This run cannot be recorded as failed in its current state.','data',
        jsonb_build_object('status', r.status));
    END IF;
    v_new := 'FAILED';
    UPDATE public.bn_uprating_run SET status = v_new, failed_at = now(),
        row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    PERFORM public._bn_uprating_run_event(r.run_id,'RUN_FAILED','Run recorded as failed', v_justif,
      v_prev, v_new, p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','The run was recorded as failed.',
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version));
  END IF;

  -- ================= ASSESS ROLLBACK =================
  IF p_command_name = 'BN_UPRATING_ASSESS_ROLLBACK' THEN
    IF r.status <> 'FAILED' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_TRANSITION',
        'message','Rollback can only be assessed for a run that has been recorded as failed.','data',
        jsonb_build_object('status', r.status));
    END IF;
    SELECT COALESCE(max(rollback_no),0) + 1 INTO v_no
      FROM public.bn_uprating_rollback_operation WHERE run_id = r.run_id;
    IF EXISTS (SELECT 1 FROM public.bn_uprating_rollback_operation
                WHERE run_id = r.run_id AND status = 'ASSESSED') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_ROLLBACK_IN_PROGRESS',
        'message','A rollback assessment is already awaiting authorisation for this run.','data',NULL);
    END IF;

    INSERT INTO public.bn_uprating_rollback_operation(run_id, session_id, rollback_no, reason_code,
      justification, assessed_by, assessed_by_name, correlation_id)
    VALUES (r.run_id, es.session_id, v_no, v_reason, v_justif, p_actor_user_id, v_actor_name, p_correlation_id)
    RETURNING * INTO ro;

    FOR it IN SELECT * FROM public._bn_uprating_latest_execution_items(r.run_id) WHERE status='APPLIED'
    LOOP
      v_paid := EXISTS (SELECT 1 FROM public.bn_payment_schedule ps
                         WHERE ps.bn_award_id = it.award_id
                           AND ps.schedule_period >= es.target_effective_date
                           AND ps.paid_at IS NOT NULL);
      INSERT INTO public.bn_uprating_rollback_item(rollback_id, run_id, execution_item_id, award_id,
        award_reference, applied_amount_minor, restore_amount_minor, expected_row_version,
        eligibility_status, blocker_code, blocker_reason, status, request_key, correlation_id)
      VALUES (ro.rollback_id, r.run_id, it.execution_item_id, it.award_id, it.award_reference,
        COALESCE(it.applied_amount_minor,0), it.approved_base_amount_minor, it.applied_row_version,
        CASE WHEN it.award_id IS NULL THEN 'INELIGIBLE'
             WHEN it.approved_base_amount_minor IS NULL THEN 'INELIGIBLE'
             WHEN v_paid THEN 'INELIGIBLE'
             WHEN NOT EXISTS (SELECT 1 FROM public.bn_award aw WHERE aw.id = it.award_id) THEN 'INELIGIBLE'
             WHEN (SELECT round(COALESCE(aw.base_amount,0)*100)::bigint FROM public.bn_award aw WHERE aw.id = it.award_id)
                  IS DISTINCT FROM COALESCE(it.applied_amount_minor,0) THEN 'INELIGIBLE'
             WHEN it.applied_row_version IS NOT NULL
                  AND (SELECT aw.row_version FROM public.bn_award aw WHERE aw.id = it.award_id)
                      IS DISTINCT FROM it.applied_row_version THEN 'INELIGIBLE'
             ELSE 'ELIGIBLE' END,
        CASE WHEN it.award_id IS NULL THEN 'AWARD_NOT_FOUND'
             WHEN it.approved_base_amount_minor IS NULL THEN 'PRIOR_AMOUNT_UNKNOWN'
             WHEN v_paid THEN 'PAYMENT_ALREADY_ISSUED'
             WHEN NOT EXISTS (SELECT 1 FROM public.bn_award aw WHERE aw.id = it.award_id) THEN 'AWARD_NOT_FOUND'
             WHEN (SELECT round(COALESCE(aw.base_amount,0)*100)::bigint FROM public.bn_award aw WHERE aw.id = it.award_id)
                  IS DISTINCT FROM COALESCE(it.applied_amount_minor,0) THEN 'AWARD_STATE_MISMATCH'
             WHEN it.applied_row_version IS NOT NULL
                  AND (SELECT aw.row_version FROM public.bn_award aw WHERE aw.id = it.award_id)
                      IS DISTINCT FROM it.applied_row_version THEN 'LATER_AWARD_AMENDMENT'
             ELSE NULL END,
        public._bn_uprating_ref_label('ROLLBACK_BLOCKER',
          CASE WHEN v_paid THEN 'PAYMENT_ALREADY_ISSUED' ELSE NULL END),
        'PENDING','BNUPR-RBK:'||ro.rollback_id::text||':'||it.execution_item_id::text, p_correlation_id);
    END LOOP;

    UPDATE public.bn_uprating_rollback_item SET status='BLOCKED'
     WHERE rollback_id = ro.rollback_id AND eligibility_status='INELIGIBLE';
    SELECT count(*), count(*) FILTER (WHERE eligibility_status='ELIGIBLE'),
           count(*) FILTER (WHERE eligibility_status='INELIGIBLE')
      INTO v_processed, v_eligible, v_ineligible
      FROM public.bn_uprating_rollback_item WHERE rollback_id = ro.rollback_id;
    UPDATE public.bn_uprating_rollback_operation
       SET applied_item_count = v_processed, eligible_count = v_eligible, ineligible_count = v_ineligible,
           status = CASE WHEN v_eligible = 0 THEN 'BLOCKED' ELSE 'ASSESSED' END, updated_at = now()
     WHERE rollback_id = ro.rollback_id RETURNING * INTO ro;
    UPDATE public.bn_uprating_run SET current_rollback_id = ro.rollback_id, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    PERFORM public._bn_uprating_run_event(r.run_id,'ROLLBACK_ASSESSED','Rollback eligibility assessed',
      v_eligible||' eligible, '||v_ineligible||' not eligible.', v_prev, r.status, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status','OK','code',NULL,
      'message','Rollback eligibility was assessed.',
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'rollback_id', ro.rollback_id,'rollback_no', ro.rollback_no,'rollback_status', ro.status,
        'applied_item_count', v_processed,'eligible_count', v_eligible,'ineligible_count', v_ineligible));
  END IF;

  -- ================= ROLLBACK ELIGIBLE (canonical) =================
  IF p_command_name = 'BN_UPRATING_ROLLBACK_ELIGIBLE' THEN
    IF v_justif IS NULL OR length(v_justif) < 10 THEN
      RETURN jsonb_build_object('status','ERROR','code','E_JUSTIFICATION_REQUIRED',
        'message','Record why these award changes are being reversed, in at least 10 characters.','data',NULL);
    END IF;
    IF r.status <> 'FAILED' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_TRANSITION',
        'message','Only a failed run may be rolled back.','data', jsonb_build_object('status', r.status));
    END IF;
    SELECT * INTO ro FROM public.bn_uprating_rollback_operation
     WHERE run_id = r.run_id AND status = 'ASSESSED' ORDER BY rollback_no DESC LIMIT 1 FOR UPDATE;
    IF ro.rollback_id IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_ROLLBACK_NOT_ASSESSED',
        'message','Assess rollback eligibility before authorising a rollback.','data',NULL);
    END IF;
    IF ro.assessed_by = p_actor_user_id THEN
      RETURN jsonb_build_object('status','ERROR','code','E_MAKER_CHECKER',
        'message','You assessed this rollback, so an independent officer must authorise it.','data',NULL);
    END IF;

    FOR it IN SELECT * FROM public.bn_uprating_rollback_item
               WHERE rollback_id = ro.rollback_id AND eligibility_status='ELIGIBLE' AND status='PENDING'
               ORDER BY award_reference
    LOOP
      v_res := public.bn_award_apply_uprating_compensation_v1(it.award_id, it.expected_row_version,
        it.applied_amount_minor, it.restore_amount_minor, r.target_effective_date,
        r.run_reference, it.request_key, p_actor_user_id);
      UPDATE public.bn_uprating_rollback_item
         SET status = CASE WHEN v_res->>'status' IN ('APPLIED','REPLAYED') THEN 'APPLIED' ELSE 'FAILED' END,
             attempt_no = attempt_no + 1,
             compensating_rate_history_id = (v_res->>'award_rate_history_id')::uuid,
             observed_row_version = COALESCE((v_res->>'observed_row_version')::int, observed_row_version),
             failure_code = v_res->>'failure_code', failure_reason = v_res->>'failure_reason',
             completed_at = now()
       WHERE rollback_item_id = it.rollback_item_id;

      IF v_res->>'status' IN ('APPLIED','REPLAYED') THEN
        v_comp := v_comp + 1;
        v_comp_delta := v_comp_delta + (it.restore_amount_minor - it.applied_amount_minor);
        PERFORM public.bn_payment_schedule_rebuild_for_award_v1(it.award_id, r.target_effective_date,
          'BN_UPRATING', r.run_reference||' rollback', it.request_key||':SCH', p_actor_user_id);
        INSERT INTO public.bn_uprating_communication_intent(run_id, session_id, execution_item_id, award_id,
          award_reference, intent_kind, event_code, dispatch_key, context, correlation_id)
        VALUES (r.run_id, ro.session_id, it.execution_item_id, it.award_id, it.award_reference,
          'UPRATING_REVERSED',
          COALESCE(NULLIF(v_cfg->>'ROLLBACK_EVENT_CODE',''),'BN_UPRATING_AWARD_UPRATING_REVERSED'),
          'BNUPR-COM:'||r.run_id::text||':'||it.execution_item_id::text||':UPRATING_REVERSED',
          jsonb_build_object('run_reference', r.run_reference,
            'restored_amount_minor', it.restore_amount_minor,
            'reversed_amount_minor', it.applied_amount_minor),
          p_correlation_id)
        ON CONFLICT (execution_item_id, intent_kind) DO NOTHING
        RETURNING intent_id INTO v_intent_id;
        IF v_intent_id IS NOT NULL THEN
          v_res := public._bn_uprating_request_communication(v_intent_id);
          UPDATE public.bn_uprating_communication_intent
             SET status = CASE WHEN v_res->>'status' IN ('REQUESTED','REPLAYED') THEN 'REQUESTED' ELSE 'FAILED' END,
                 hub_status = v_res->>'hub_status',
                 communication_request_id = (v_res->>'communication_request_id')::uuid,
                 attempts = attempts + 1, requested_at = now(),
                 failure_code = v_res->>'failure_code', failure_reason = v_res->>'failure_reason',
                 is_retryable = COALESCE((v_res->>'is_retryable')::boolean,false), updated_at = now()
           WHERE intent_id = v_intent_id;
        END IF;
      ELSE
        v_compfail := v_compfail + 1;
      END IF;
    END LOOP;

    SELECT count(*) FILTER (WHERE status='APPLIED'), count(*) FILTER (WHERE status='FAILED'),
           count(*) FILTER (WHERE eligibility_status='ELIGIBLE'), count(*) FILTER (WHERE eligibility_status='INELIGIBLE'),
           count(*)
      INTO v_comp, v_compfail, v_eligible, v_ineligible, v_processed
      FROM public.bn_uprating_rollback_item WHERE rollback_id = ro.rollback_id;

    v_status := CASE WHEN v_comp = 0 THEN 'BLOCKED'
                     WHEN v_comp = v_processed THEN 'COMPLETED' ELSE 'PARTIAL' END;
    UPDATE public.bn_uprating_rollback_operation
       SET status = v_status, compensated_count = v_comp, failed_count = v_compfail,
           compensated_delta_minor = v_comp_delta, authorised_by = p_actor_user_id,
           authorised_by_name = v_actor_name, authorised_at = now(),
           justification = COALESCE(v_justif, justification), reason_code = COALESCE(v_reason, reason_code),
           completed_at = now(), row_version = row_version + 1, updated_at = now()
     WHERE rollback_id = ro.rollback_id RETURNING * INTO ro;

    IF v_status = 'COMPLETED' AND public._bn_uprating_epic4_can_transition(r.status,'ROLLED_BACK') THEN
      v_new := 'ROLLED_BACK';
      UPDATE public.bn_uprating_run SET status = v_new, rolled_back_at = now(),
          current_rollback_id = ro.rollback_id, row_version = row_version + 1, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
    END IF;
    PERFORM public._bn_uprating_run_event(r.run_id,'ROLLBACK_EXECUTED','Rollback executed',
      v_comp||' award change(s) reversed; '||v_compfail||' could not be reversed.',
      v_prev, r.status, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status', CASE WHEN v_status='BLOCKED' THEN 'BLOCKED' ELSE 'OK' END,
      'code', CASE WHEN v_status='BLOCKED' THEN 'E_ROLLBACK_BLOCKED' ELSE NULL END,
      'message', CASE WHEN v_status='COMPLETED' THEN 'Every applied award change was reversed.'
                      WHEN v_status='PARTIAL' THEN 'Some award changes could not be reversed and need manual correction.'
                      ELSE 'No award change could be reversed.' END,
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'rollback_id', ro.rollback_id,'rollback_status', v_status,
        'compensated_count', v_comp,'failed_count', v_compfail,
        'eligible_count', v_eligible,'ineligible_count', v_ineligible,
        'compensated_delta_minor', v_comp_delta));
  END IF;

  INSERT INTO public.bn_uprating_command_audit(command_name, run_id, policy_id, policy_version_id,
    previous_status, new_status, actor_user_id, actor_name, reason_code, justification,
    payload, result_status, correlation_id, idempotency_key)
  VALUES (p_command_name, r.run_id, r.policy_id, r.policy_version_id, v_prev, r.status,
    p_actor_user_id, v_actor_name, v_reason, v_justif, p_payload, v_result->>'status',
    p_correlation_id, p_idempotency_key);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_uprating_command_idempotency(idempotency_key, command_name, payload_hash,
      result_json, actor_user_id, correlation_id)
    VALUES (p_idempotency_key, p_command_name, v_hash, v_result, p_actor_user_id, p_correlation_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END; $function$;

GRANT EXECUTE ON FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid)
  TO authenticated, service_role;

-- ---------- Epic 4 reads ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_reconciliation_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.bn_uprating_run%ROWTYPE; rec public.bn_uprating_reconciliation%ROWTYPE;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  SELECT * INTO rec FROM public.bn_uprating_reconciliation WHERE run_id = p_run_id AND is_current;

  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,'data', jsonb_build_object(
    'run_id', r.run_id,'run_reference', r.run_reference,'run_status', r.status,
    'readiness', public._bn_uprating_post_execution_readiness(p_run_id, p_actor_user_id),
    'current', CASE WHEN rec.reconciliation_id IS NULL THEN NULL ELSE jsonb_build_object(
      'reconciliation_id', rec.reconciliation_id,'reconciliation_no', rec.reconciliation_no,
      'status', rec.status,'performed_by_name', rec.performed_by_name,'performed_at', rec.performed_at,
      'expected_item_count', rec.expected_item_count,
      'actual_applied_item_count', rec.actual_applied_item_count,
      'actual_failed_item_count', rec.actual_failed_item_count,
      'expected_delta_total_minor', rec.expected_delta_total_minor,
      'actual_delta_total_minor', rec.actual_delta_total_minor,
      'variance_amount_minor', rec.variance_amount_minor,'variance_count', rec.variance_count,
      'tolerance_amount_minor', rec.tolerance_amount_minor,
      'schedule_required_count', rec.schedule_required_count,
      'schedule_completed_count', rec.schedule_completed_count,
      'schedule_failed_count', rec.schedule_failed_count,
      'communication_required_count', rec.communication_required_count,
      'communication_requested_count', rec.communication_requested_count,
      'communication_failed_count', rec.communication_failed_count,
      'communication_delivered_count', rec.communication_delivered_count,
      'finding_count', rec.finding_count,'blocking_finding_count', rec.blocking_finding_count) END,
    'findings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'finding_id', f.finding_id,'finding_code', f.finding_code,
        'label', public._bn_uprating_ref_label('RECONCILIATION_FINDING', f.finding_code),
        'severity', f.severity,'expected_value', f.expected_value,'actual_value', f.actual_value,
        'detail', f.detail) ORDER BY f.severity, f.finding_code)
      FROM public.bn_uprating_reconciliation_finding f
     WHERE f.reconciliation_id = rec.reconciliation_id),'[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'reconciliation_id', h.reconciliation_id,'reconciliation_no', h.reconciliation_no,
        'status', h.status,'performed_by_name', h.performed_by_name,'performed_at', h.performed_at,
        'finding_count', h.finding_count) ORDER BY h.reconciliation_no DESC)
      FROM public.bn_uprating_reconciliation h WHERE h.run_id = p_run_id),'[]'::jsonb),
    'schedule_rebuilds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'rebuild_id', s.rebuild_id,'award_reference', s.award_reference,'status', s.status,
        'attempt_no', s.attempt_no,'schedule_rows_rebuilt', s.schedule_rows_rebuilt,
        'failure_code', s.failure_code,'failure_reason', s.failure_reason,'is_retryable', s.is_retryable,
        'processed_at', s.processed_at) ORDER BY s.award_reference)
      FROM public.bn_uprating_schedule_rebuild s WHERE s.run_id = p_run_id),'[]'::jsonb),
    'communications', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'intent_id', c.intent_id,'award_reference', c.award_reference,'intent_kind', c.intent_kind,
        'event_code', c.event_code,'status', c.status,'hub_status', c.hub_status,
        'hub_delivery_status', c.hub_delivery_status,'attempts', c.attempts,
        'failure_code', c.failure_code,'failure_reason', c.failure_reason,'is_retryable', c.is_retryable,
        'requested_at', c.requested_at) ORDER BY c.intent_kind, c.award_reference)
      FROM public.bn_uprating_communication_intent c WHERE c.run_id = p_run_id),'[]'::jsonb)));
END; $function$;
GRANT EXECUTE ON FUNCTION public.bn_uprating_reconciliation_v1(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bn_uprating_rollback_readiness_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r public.bn_uprating_run%ROWTYPE; ro public.bn_uprating_rollback_operation%ROWTYPE;
  v_admin boolean; v_decide boolean;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  v_decide := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  v_admin  := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);
  SELECT * INTO ro FROM public.bn_uprating_rollback_operation
   WHERE run_id = p_run_id ORDER BY rollback_no DESC LIMIT 1;

  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,'data', jsonb_build_object(
    'run_id', r.run_id,'run_reference', r.run_reference,'run_status', r.status,
    'row_version', r.row_version,
    'can_assess_rollback', v_decide AND r.status = 'FAILED'
      AND NOT EXISTS (SELECT 1 FROM public.bn_uprating_rollback_operation
                       WHERE run_id = p_run_id AND status='ASSESSED'),
    'can_authorise_rollback', v_admin AND r.status = 'FAILED'
      AND ro.status = 'ASSESSED' AND ro.assessed_by IS DISTINCT FROM p_actor_user_id,
    'awaiting_authorisation', COALESCE(ro.status,'') = 'ASSESSED',
    'assessed_by_actor', ro.assessed_by = p_actor_user_id,
    'current', CASE WHEN ro.rollback_id IS NULL THEN NULL ELSE jsonb_build_object(
      'rollback_id', ro.rollback_id,'rollback_no', ro.rollback_no,'status', ro.status,
      'applied_item_count', ro.applied_item_count,'eligible_count', ro.eligible_count,
      'ineligible_count', ro.ineligible_count,'compensated_count', ro.compensated_count,
      'failed_count', ro.failed_count,'compensated_delta_minor', ro.compensated_delta_minor,
      'reason_code', ro.reason_code,'justification', ro.justification,
      'assessed_by_name', ro.assessed_by_name,'assessed_at', ro.assessed_at,
      'authorised_by_name', ro.authorised_by_name,'authorised_at', ro.authorised_at,
      'row_version', ro.row_version) END,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'rollback_item_id', i.rollback_item_id,'award_reference', i.award_reference,
        'applied_amount_minor', i.applied_amount_minor,'restore_amount_minor', i.restore_amount_minor,
        'eligibility_status', i.eligibility_status,'blocker_code', i.blocker_code,
        'blocker_label', public._bn_uprating_ref_label('ROLLBACK_BLOCKER', i.blocker_code),
        'status', i.status,'failure_code', i.failure_code,'failure_reason', i.failure_reason,
        'completed_at', i.completed_at) ORDER BY i.eligibility_status, i.award_reference)
      FROM public.bn_uprating_rollback_item i WHERE i.rollback_id = ro.rollback_id),'[]'::jsonb)));
END; $function$;
GRANT EXECUTE ON FUNCTION public.bn_uprating_rollback_readiness_v1(uuid,uuid) TO authenticated, service_role;
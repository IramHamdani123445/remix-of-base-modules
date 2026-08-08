-- ============================================================
-- BN Uprating Epic 5 — Run closure and end-to-end certification.
-- Closure is a governed lifecycle transition only: it never mutates
-- awards, payments, communications or policies, and never deletes
-- evidence. CLOSED is terminal; there is no reopen operation.
-- ============================================================

ALTER TABLE public.bn_uprating_run DROP CONSTRAINT IF EXISTS bn_uprating_run_status_ck;
ALTER TABLE public.bn_uprating_run ADD CONSTRAINT bn_uprating_run_status_ck
  CHECK (status = ANY (ARRAY['DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED',
    'DRY_RUN','AWAITING_APPROVAL','APPROVED','EXECUTING','COMPLETED','PARTIAL','FAILED',
    'SCHEDULES_REBUILT','COMMUNICATIONS_ISSUED','RECONCILED','ROLLED_BACK','CLOSED']));

ALTER TABLE public.bn_uprating_run
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by      uuid,
  ADD COLUMN IF NOT EXISTS closed_by_name text,
  ADD COLUMN IF NOT EXISTS closure_path   text,
  ADD COLUMN IF NOT EXISTS closure_reconciliation_id uuid,
  ADD COLUMN IF NOT EXISTS closure_rollback_id       uuid;

INSERT INTO public.bn_uprating_reference_value(domain, code, label, description, sort_order) VALUES
 ('RUN_STATUS','CLOSED','Closed','The run is finally closed. All evidence is retained and no further uprating action is available.',160),
 ('CLOSURE_PATH','RECONCILED','Reconciled','The run closed after a successful, fully reconciled execution.',10),
 ('CLOSURE_PATH','ROLLED_BACK','Rolled back','The run closed after a governed compensating rollback.',20),
 ('CLOSE_BLOCKER','NOT_CLOSABLE_STATE','Not a closable state','Only a reconciled or rolled-back run may be closed.',10),
 ('CLOSE_BLOCKER','NO_RECONCILIATION','No reconciliation','No current reconciliation exists for this run.',20),
 ('CLOSE_BLOCKER','RECONCILIATION_NOT_PASSED','Reconciliation not passed','The current reconciliation did not pass.',30),
 ('CLOSE_BLOCKER','RECONCILIATION_FINDINGS_OPEN','Blocking findings open','The current reconciliation has unresolved blocking findings.',40),
 ('CLOSE_BLOCKER','EXECUTION_INCOMPLETE','Execution incomplete','Execution work is still outstanding.',50),
 ('CLOSE_BLOCKER','SCHEDULE_OUTSTANDING','Schedule consequences outstanding','Payment schedule consequences are not fully accounted for.',60),
 ('CLOSE_BLOCKER','COMMUNICATION_OUTSTANDING','Claimant notices outstanding','Required claimant notices are not fully accounted for.',70),
 ('CLOSE_BLOCKER','ROLLBACK_AWAITING_AUTHORISATION','Rollback awaiting authorisation','A rollback assessment is awaiting authorisation.',80),
 ('CLOSE_BLOCKER','NO_ROLLBACK','No rollback operation','No rollback operation exists for this run.',90),
 ('CLOSE_BLOCKER','ROLLBACK_INCOMPLETE','Rollback incomplete','The rollback did not complete for every applied award change.',100),
 ('CLOSE_BLOCKER','ROLLBACK_ITEMS_PENDING','Rollback items pending','Some rollback items are still pending or failed.',110),
 ('CLOSE_BLOCKER','ROLLBACK_COMMUNICATION_OUTSTANDING','Corrective notices outstanding','Required corrective claimant notices are not fully accounted for.',120),
 ('CLOSE_BLOCKER','SOURCE_UNAVAILABLE','Source unavailable','An authoritative source could not be read; closure fails closed.',130),
 ('CLOSE_BLOCKER','PERMISSION','Permission required','You do not have permission to close uprating runs.',140),
 ('CLOSE_BLOCKER','ALREADY_CLOSED','Already closed','This run is already closed.',150)
ON CONFLICT (domain, code) DO NOTHING;

-- ---------- Epic 5 transition guard ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_epic5_can_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT p_to = 'CLOSED' AND p_from IN ('RECONCILED','ROLLED_BACK')
$function$;

-- ---------- Backend-owned closure readiness ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_close_readiness(p_run_id uuid, p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r public.bn_uprating_run%ROWTYPE;
  rec public.bn_uprating_reconciliation%ROWTYPE;
  ro public.bn_uprating_rollback_operation%ROWTYPE;
  v_blockers jsonb := '[]'::jsonb;
  v_path text := NULL;
  v_decide boolean := false;
  v_open int := 0;
  v_n int := 0;
  v_exec jsonb;
BEGIN
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('run_id', p_run_id,'source_available', false,'can_close', false,
      'run_status', NULL,'completion_path', NULL,'reconciliation_status', NULL,'rollback_status', NULL,
      'open_operational_items', 0,'available_action', NULL,'row_version', NULL,
      'blocking_reasons', jsonb_build_array(jsonb_build_object('code','SOURCE_UNAVAILABLE',
        'message','That uprating run could not be read, so closure fails closed.')));
  END IF;

  v_decide := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  IF NOT v_decide THEN
    v_blockers := v_blockers || jsonb_build_object('code','PERMISSION',
      'message','You do not have permission to close uprating runs.');
  END IF;

  IF r.status = 'CLOSED' THEN
    RETURN jsonb_build_object('run_id', r.run_id,'run_reference', r.run_reference,'source_available', true,
      'can_close', false,'run_status', r.status,'completion_path', r.closure_path,
      'reconciliation_status', NULL,'rollback_status', NULL,'open_operational_items', 0,
      'available_action', NULL,'row_version', r.row_version,'closed_at', r.closed_at,
      'closed_by_name', r.closed_by_name,
      'blocking_reasons', jsonb_build_array(jsonb_build_object('code','ALREADY_CLOSED',
        'message','This run is already closed.')));
  END IF;

  IF NOT public._bn_uprating_epic5_can_transition(r.status,'CLOSED') THEN
    RETURN jsonb_build_object('run_id', r.run_id,'run_reference', r.run_reference,'source_available', true,
      'can_close', false,'run_status', r.status,'completion_path', NULL,
      'reconciliation_status', NULL,'rollback_status', NULL,'open_operational_items', 0,
      'available_action', NULL,'row_version', r.row_version,
      'blocking_reasons', v_blockers || jsonb_build_object('code','NOT_CLOSABLE_STATE',
        'message','Only a reconciled or a rolled-back run may be closed.'));
  END IF;

  v_path := CASE WHEN r.status = 'RECONCILED' THEN 'RECONCILED' ELSE 'ROLLED_BACK' END;
  SELECT * INTO rec FROM public.bn_uprating_reconciliation WHERE run_id = p_run_id AND is_current;
  SELECT * INTO ro FROM public.bn_uprating_rollback_operation
   WHERE run_id = p_run_id ORDER BY rollback_no DESC LIMIT 1;

  IF v_path = 'RECONCILED' THEN
    v_exec := public._bn_uprating_post_execution_readiness(p_run_id, p_actor_user_id);
    IF NOT COALESCE((v_exec->>'source_available')::boolean,false) THEN
      v_blockers := v_blockers || jsonb_build_object('code','SOURCE_UNAVAILABLE',
        'message','Post-execution state could not be read, so closure fails closed.');
    END IF;
    IF rec.reconciliation_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code','NO_RECONCILIATION',
        'message','No current reconciliation exists for this run.');
    ELSE
      IF rec.status NOT IN ('PASS','PASS_WITH_WARNINGS') THEN
        v_blockers := v_blockers || jsonb_build_object('code','RECONCILIATION_NOT_PASSED',
          'message','The current reconciliation did not pass.');
      END IF;
      SELECT count(*) INTO v_n FROM public.bn_uprating_reconciliation_finding
       WHERE reconciliation_id = rec.reconciliation_id AND severity = 'BLOCKING';
      IF v_n > 0 THEN
        v_open := v_open + v_n;
        v_blockers := v_blockers || jsonb_build_object('code','RECONCILIATION_FINDINGS_OPEN',
          'message', v_n||' blocking reconciliation finding(s) must be resolved before closure.');
      END IF;
    END IF;

    IF NOT COALESCE((v_exec->'completion'->>'execution_complete')::boolean,false) THEN
      v_blockers := v_blockers || jsonb_build_object('code','EXECUTION_INCOMPLETE',
        'message','Execution work is still outstanding for this run.');
    END IF;

    SELECT count(*) INTO v_n FROM public.bn_uprating_schedule_rebuild
     WHERE run_id = p_run_id AND status NOT IN ('COMPLETED','NOT_REQUIRED');
    IF v_n > 0 THEN
      v_open := v_open + v_n;
      v_blockers := v_blockers || jsonb_build_object('code','SCHEDULE_OUTSTANDING',
        'message', v_n||' payment schedule consequence(s) are not accounted for.');
    END IF;

    SELECT count(*) INTO v_n FROM public.bn_uprating_communication_intent
     WHERE run_id = p_run_id AND intent_kind = 'UPRATING_APPLIED' AND status <> 'REQUESTED';
    IF v_n > 0 THEN
      v_open := v_open + v_n;
      v_blockers := v_blockers || jsonb_build_object('code','COMMUNICATION_OUTSTANDING',
        'message', v_n||' claimant notice request(s) are not accounted for.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.bn_uprating_rollback_operation
                WHERE run_id = p_run_id AND status = 'ASSESSED') THEN
      v_open := v_open + 1;
      v_blockers := v_blockers || jsonb_build_object('code','ROLLBACK_AWAITING_AUTHORISATION',
        'message','A rollback assessment is awaiting authorisation for this run.');
    END IF;
  ELSE
    IF ro.rollback_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code','NO_ROLLBACK',
        'message','No rollback operation exists for this run.');
    ELSE
      IF ro.status <> 'COMPLETED' THEN
        v_blockers := v_blockers || jsonb_build_object('code','ROLLBACK_INCOMPLETE',
          'message','The rollback did not complete for every applied award change.');
      END IF;
      SELECT count(*) INTO v_n FROM public.bn_uprating_rollback_item
       WHERE rollback_id = ro.rollback_id AND status IN ('PENDING','FAILED');
      IF v_n > 0 THEN
        v_open := v_open + v_n;
        v_blockers := v_blockers || jsonb_build_object('code','ROLLBACK_ITEMS_PENDING',
          'message', v_n||' rollback item(s) are still pending or failed.');
      END IF;
    END IF;

    SELECT count(*) INTO v_n FROM public.bn_uprating_communication_intent
     WHERE run_id = p_run_id AND intent_kind = 'UPRATING_REVERSED' AND status <> 'REQUESTED';
    IF v_n > 0 THEN
      v_open := v_open + v_n;
      v_blockers := v_blockers || jsonb_build_object('code','ROLLBACK_COMMUNICATION_OUTSTANDING',
        'message', v_n||' corrective claimant notice request(s) are not accounted for.');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'run_id', r.run_id,'run_reference', r.run_reference,'source_available', true,
    'run_status', r.status,'row_version', r.row_version,
    'completion_path', v_path,
    'reconciliation_status', rec.status,
    'reconciliation_id', rec.reconciliation_id,
    'rollback_status', ro.status,
    'rollback_id', ro.rollback_id,
    'open_operational_items', v_open,
    'blocking_reasons', v_blockers,
    'can_close', jsonb_array_length(v_blockers) = 0,
    'available_action', CASE WHEN jsonb_array_length(v_blockers) = 0 THEN 'BN_UPRATING_CLOSE_RUN' ELSE NULL END);
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_uprating_close_readiness_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_data jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  v_data := public._bn_uprating_close_readiness(p_run_id, p_actor_user_id);
  IF NOT COALESCE((v_data->>'source_available')::boolean,false)
     AND v_data->>'run_status' IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND',
      'message','That uprating run could not be found.','data', v_data);
  END IF;
  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,'data', v_data);
END; $function$;
GRANT EXECUTE ON FUNCTION public.bn_uprating_close_readiness_v1(uuid,uuid) TO authenticated, service_role;

-- ---------- Epic 5 command boundary ----------
ALTER FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid)
  RENAME TO _bn_uprating_run_command_epic4;

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
  v_ready jsonb; v_result jsonb; v_prev text; v_actor_name text; v_path text;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNAUTHENTICATED','message','You must be signed in to perform this action.','data',NULL);
  END IF;

  IF p_command_name <> 'BN_UPRATING_CLOSE_RUN' THEN
    RETURN public._bn_uprating_run_command_epic4(p_command_name, p_actor_user_id, p_payload, p_run_id,
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

  PERFORM public._bn_uprating_require(p_actor_user_id,'decide',true);

  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> r.row_version THEN
    RETURN jsonb_build_object('status','ERROR','code','E_STALE_ROW_VERSION',
      'message','This run has changed since you loaded it. Reload and try again.','data',
      jsonb_build_object('row_version', r.row_version));
  END IF;

  IF r.status = 'CLOSED' THEN
    RETURN jsonb_build_object('status','ERROR','code','E_ALREADY_CLOSED',
      'message','This run is already closed.','data',
      jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'completion_path', r.closure_path,'closed_at', r.closed_at));
  END IF;

  v_ready := public._bn_uprating_close_readiness(p_run_id, p_actor_user_id);
  IF NOT COALESCE((v_ready->>'can_close')::boolean,false) THEN
    RETURN jsonb_build_object('status','ERROR',
      'code', CASE WHEN v_ready->'blocking_reasons'->0->>'code' = 'NOT_CLOSABLE_STATE'
                   THEN 'E_INVALID_TRANSITION' ELSE 'E_CLOSURE_BLOCKED' END,
      'message', COALESCE(v_ready->'blocking_reasons'->0->>'message',
        'This run cannot be closed yet.'),
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,
        'blocking_reasons', v_ready->'blocking_reasons'));
  END IF;

  v_prev := r.status;
  v_path := v_ready->>'completion_path';
  v_actor_name := public._bn_uprating_actor_name(p_actor_user_id);

  UPDATE public.bn_uprating_run
     SET status = 'CLOSED', closed_at = now(), closed_by = p_actor_user_id,
         closed_by_name = v_actor_name, closure_path = v_path,
         closure_reconciliation_id = (v_ready->>'reconciliation_id')::uuid,
         closure_rollback_id = (v_ready->>'rollback_id')::uuid,
         row_version = row_version + 1, updated_at = now()
   WHERE run_id = r.run_id RETURNING * INTO r;

  PERFORM public._bn_uprating_run_event(r.run_id,'RUN_CLOSED','Run closed',
    CASE WHEN v_path = 'RECONCILED'
         THEN 'Closed on the reconciled completion path. All evidence is retained.'
         ELSE 'Closed on the rolled-back completion path. All compensation evidence is retained.' END,
    v_prev, 'CLOSED', p_actor_user_id, p_correlation_id);

  v_result := jsonb_build_object('status','OK','code',NULL,
    'message', CASE WHEN v_path = 'RECONCILED'
                    THEN 'The reconciled uprating run was closed.'
                    ELSE 'The rolled-back uprating run was closed.' END,
    'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
      'completion_path', v_path,'closed_at', r.closed_at,
      'reconciliation_id', r.closure_reconciliation_id,'rollback_id', r.closure_rollback_id));

  INSERT INTO public.bn_uprating_command_audit(command_name, run_id, policy_id, policy_version_id,
    previous_status, new_status, actor_user_id, actor_name, reason_code, justification,
    payload, result_status, correlation_id, idempotency_key)
  VALUES (p_command_name, r.run_id, r.policy_id, r.policy_version_id, v_prev, r.status,
    p_actor_user_id, v_actor_name, v_path, NULLIF(btrim(COALESCE(p_payload->>'justification','')),''),
    p_payload, v_result->>'status', p_correlation_id, p_idempotency_key);

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

-- ---------- Backend actions: CLOSED is terminal ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_run_actions_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.bn_uprating_run%ROWTYPE; v_write boolean; v_decide boolean; v_admin boolean;
  v_block int := 0; v_actions jsonb := '[]'::jsonb; v_pre boolean;
  a public.bn_uprating_run_approval%ROWTYPE; s public.bn_uprating_execution_schedule%ROWTYPE;
  v_ready jsonb; v_exec jsonb; v_close jsonb; v_maker boolean := false;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;

  -- CLOSED is terminal: no mutation action is offered, the run stays readable.
  IF r.status = 'CLOSED' THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
      'run_id', r.run_id,'status', r.status,'row_version', r.row_version,
      'simulation_state', r.simulation_state,'blocking_exceptions', 0,
      'approval_cycle_count', r.approval_cycle_count,
      'has_active_schedule', false,'has_execution_session', false,
      'pending_batches', 0,'retryable_failures', 0,
      'is_terminal', true,'completion_path', r.closure_path,
      'closed_at', r.closed_at,'closed_by_name', r.closed_by_name,
      'actions', '[]'::jsonb));
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
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval, scheduling or execution.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RESOLVE_EXCEPTION','label','Resolve exceptions',
    'available', v_decide AND v_pre AND r.current_snapshot_id IS NOT NULL AND v_block > 0,
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to resolve exceptions.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval, scheduling or execution.'
                   WHEN r.current_snapshot_id IS NULL THEN 'Build the population first.'
                   WHEN v_block = 0 THEN 'There are no open blocking exceptions.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SIMULATE','label','Run simulation',
    'available', v_decide AND v_pre AND r.current_snapshot_id IS NOT NULL AND v_block = 0
                 AND COALESCE(r.frozen_policy_type,'') NOT IN ('FORMULA_DRIVEN','MANUAL_IMPORT'),
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to simulate.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval, scheduling or execution.'
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
    'available', v_admin AND r.status='APPROVED' AND s.schedule_id IS NOT NULL,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to schedule execution.'
                   WHEN r.status<>'APPROVED' THEN 'Execution has started, so the schedule can no longer be cancelled.'
                   WHEN s.schedule_id IS NULL THEN 'There is no active execution schedule.' ELSE NULL END);

  v_exec := public._bn_uprating_execution_readiness(p_run_id, p_actor_user_id);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_EXECUTE_BATCH',
    'label', CASE WHEN COALESCE((v_exec->>'has_session')::boolean,false) THEN 'Execute next batch' ELSE 'Start execution' END,
    'available', COALESCE((v_exec->>'can_execute')::boolean,false),
    'reason', v_exec->'blockers'->0->>'message');
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RETRY_FAILED','label','Retry failed items',
    'available', COALESCE((v_exec->>'can_retry')::boolean,false),
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to retry execution failures.'
                   WHEN NOT COALESCE((v_exec->>'has_session')::boolean,false) THEN 'This run has not been executed yet.'
                   WHEN COALESCE((v_exec->>'retryable_failures')::int,0) = 0 THEN 'There are no eligible items to retry.'
                   ELSE NULL END);

  v_close := public._bn_uprating_close_readiness(p_run_id, p_actor_user_id);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_CLOSE_RUN',
    'label', CASE WHEN v_close->>'completion_path' = 'ROLLED_BACK'
                  THEN 'Close rolled-back uprating run' ELSE 'Close reconciled uprating run' END,
    'available', COALESCE((v_close->>'can_close')::boolean,false),
    'reason', v_close->'blocking_reasons'->0->>'message');

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'run_id', r.run_id,'status', r.status,'row_version', r.row_version,
    'simulation_state', r.simulation_state,'blocking_exceptions', v_block,
    'approval_cycle_count', r.approval_cycle_count,
    'has_active_schedule', s.schedule_id IS NOT NULL,
    'has_execution_session', COALESCE((v_exec->>'has_session')::boolean,false),
    'pending_batches', COALESCE((v_exec->>'pending_batches')::int,0),
    'retryable_failures', COALESCE((v_exec->>'retryable_failures')::int,0),
    'is_terminal', false,'completion_path', v_close->>'completion_path',
    'actions', v_actions));
END; $function$;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_actions_v1(uuid,uuid) TO authenticated, service_role;
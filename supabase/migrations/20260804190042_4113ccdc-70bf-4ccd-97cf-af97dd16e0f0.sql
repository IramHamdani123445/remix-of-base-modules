-- =====================================================================
-- BN Award Suspension — defect correction pass
-- =====================================================================

-- 1. Restricted operational error log (no client grants at all).
CREATE TABLE IF NOT EXISTS public.bn_susp_operational_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  command text NOT NULL,
  stage text,
  entity_id uuid,
  correlation_id text,
  safe_code text NOT NULL,
  sqlstate text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.bn_susp_operational_error_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bn_susp_operational_error_log TO service_role;
ALTER TABLE public.bn_susp_operational_error_log ENABLE ROW LEVEL SECURITY;

-- 2. Safe-code mapping + restricted logging helper.
CREATE OR REPLACE FUNCTION public._bn_susp_safe_code(p_stage text, p_sqlstate text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(coalesce(p_stage,''))
    WHEN 'PAYMENT_IMPACT'       THEN 'E_PAYMENT_IMPACT_FAILED'
    WHEN 'PAYMENT_HOLD'         THEN 'E_PAYMENT_HOLD_FAILED'
    WHEN 'AUDIT'                THEN 'E_AUDIT_FAILED'
    WHEN 'COMMUNICATION_INTENT' THEN 'E_COMMUNICATION_INTENT_FAILED'
    WHEN 'CALC_PERSIST'         THEN 'E_CALCULATION_PERSIST_FAILED'
    ELSE 'E_EXECUTION_INTERNAL'
  END
$$;

CREATE OR REPLACE FUNCTION public._bn_susp_log_operational_error(
  p_command text, p_stage text, p_entity uuid, p_correlation text,
  p_safe_code text, p_sqlstate text, p_detail text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.bn_susp_operational_error_log
    (command, stage, entity_id, correlation_id, safe_code, sqlstate, detail)
  VALUES (p_command, p_stage, p_entity, p_correlation, p_safe_code, p_sqlstate, left(coalesce(p_detail,''), 4000));
EXCEPTION WHEN OTHERS THEN
  RETURN; -- logging must never mask the originating failure
END $$;
REVOKE ALL ON FUNCTION public._bn_susp_safe_code(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_log_operational_error(text,text,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- 3. Communication boundary: intent only, no queued outbox row.
CREATE OR REPLACE FUNCTION public._bn_susp_comm(
  p_award_id uuid, p_event_code text, p_context jsonb, p_user_code text, p_correlation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim uuid; v_intent uuid := gen_random_uuid();
BEGIN
  SELECT bn_claim_id INTO v_claim FROM public.bn_award WHERE id = p_award_id;
  IF v_claim IS NULL THEN RETURN NULL; END IF;
  -- Benefits does NOT enqueue, dispatch or select templates. It records a
  -- communication INTENT in the platform audit trail; the shared communication
  -- facade owns template resolution, queueing and dispatch.
  PERFORM public._bn_susp_audit(
    NULL, 'BN.SUSPENSION.COMMUNICATION_INTENT', 'execute', p_award_id::text,
    '{}'::jsonb,
    jsonb_build_object(
      'intent_id', v_intent, 'claim_id', v_claim, 'event_code', p_event_code,
      'module', 'bn_award_suspension', 'context', coalesce(p_context,'{}'::jsonb),
      'dispatch_owner', 'shared_communication_facade'),
    p_correlation, NULL);
  RETURN v_intent;
END $$;

-- 4. Calculation persistence must fail closed.
CREATE OR REPLACE FUNCTION public._bn_susp_persist_arrears_run(
  p_claim_id uuid, p_arrears jsonb, p_user_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run uuid; v_step jsonb; v_seq int := 0; v_expected int; v_actual int;
BEGIN
  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION 'E_CALCULATION_PERSIST_FAILED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.bn_calc_run
    (claim_id, run_mode, run_status, triggered_by, completed_at,
     payment_frequency, variables_snapshot, entered_by, modified_by)
  VALUES (p_claim_id,'LIVE',
          CASE WHEN p_arrears->>'status' = 'REVIEW_REQUIRED' THEN 'FAILED' ELSE 'COMPLETED' END,
          'BN_AWARD_SUSPENSION_REINSTATEMENT_ARREARS', now(),
          p_arrears->>'frequency', p_arrears,
          coalesce(p_user_code,'SCHEDULER'), coalesce(p_user_code,'SCHEDULER'))
  RETURNING id INTO v_run;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'E_CALCULATION_PERSIST_FAILED' USING ERRCODE='P0001';
  END IF;

  v_expected := jsonb_array_length(coalesce(p_arrears->'trace','[]'::jsonb));
  FOR v_step IN SELECT * FROM jsonb_array_elements(coalesce(p_arrears->'trace','[]'::jsonb)) LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.bn_calc_trace (calc_run_id, step_no, step_name, output_value)
    VALUES (v_run, v_seq, v_step->>'step', v_step);
  END LOOP;

  SELECT count(*) INTO v_actual FROM public.bn_calc_trace WHERE calc_run_id = v_run;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'E_CALCULATION_PERSIST_FAILED' USING ERRCODE='P0001';
  END IF;

  -- Evidence must belong to the claim being reinstated.
  PERFORM 1 FROM public.bn_calc_run WHERE id = v_run AND claim_id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_CALCULATION_PERSIST_FAILED' USING ERRCODE='P0001';
  END IF;

  RETURN v_run;
END $$;
REVOKE ALL ON FUNCTION public._bn_susp_persist_arrears_run(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;

-- 5. Hold release boundaries keyed on the reinstatement effective date.
DROP FUNCTION IF EXISTS public._bn_susp_release_holds(uuid,uuid,uuid,text);
CREATE OR REPLACE FUNCTION public._bn_susp_release_holds(
  p_susp_id uuid, p_award_id uuid, p_actor uuid, p_user_code text,
  p_effective_date date, p_arrears_status text DEFAULT 'CALCULATED')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_rel int := 0; v_ret int := 0; v_straddle int := 0; v_susp_period int := 0;
  v_start date; v_end date; v_due date; v_status text; v_batch uuid; v_paid date;
  v_claim uuid; v_exc uuid; v_reason text;
BEGIN
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'E_PAYMENT_HOLD_FAILED' USING ERRCODE='P0001';
  END IF;
  SELECT bn_claim_id INTO v_claim FROM public.bn_award WHERE id = p_award_id;

  FOR r IN
    SELECT * FROM public.bn_award_suspension_payment_impact
     WHERE suspension_id = p_susp_id AND phase='SUSPENSION' AND impact_action='HELD'
  LOOP
    v_start := NULL; v_end := NULL; v_due := NULL; v_status := NULL;
    v_batch := NULL; v_paid := NULL; v_exc := NULL;

    IF r.record_type = 'PAYMENT_SCHEDULE' THEN
      SELECT s.due_date, s.due_date, s.due_date, s.status, NULL::uuid, s.paid_at::date
        INTO v_start, v_end, v_due, v_status, v_batch, v_paid
        FROM public.bn_payment_schedule s WHERE s.id = r.record_id;
    ELSE
      SELECT coalesce(i.period_start, i.due_date), coalesce(i.period_end, i.due_date),
             i.due_date, i.status, i.batch_id, i.paid_date
        INTO v_start, v_end, v_due, v_status, v_batch, v_paid
        FROM public.bn_payment_instruction i WHERE i.id = r.record_id;
    END IF;

    -- Record vanished or is no longer held: never touch it.
    IF v_status IS NULL OR v_status <> 'HELD' THEN
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
         previous_status,new_status,reason,created_by_user_id)
      VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RETAINED',
              'HELD', coalesce(v_status,'UNKNOWN'),'NOT_RELEASABLE_STATE_CHANGED',p_actor);
      v_ret := v_ret + 1; CONTINUE;
    END IF;

    -- Open exception blocks any automatic movement.
    IF EXISTS (SELECT 1 FROM public.bn_payment_exception e
                WHERE e.instruction_id = r.record_id AND e.status = 'OPEN') THEN
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
         previous_status,new_status,reason,created_by_user_id)
      VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RETAINED',
              'HELD','HELD','OPEN_EXCEPTION_REQUIRES_MANUAL_RESOLUTION',p_actor);
      v_ret := v_ret + 1; CONTINUE;
    END IF;

    -- (a) Wholly inside the suspended period: NEVER released. Settled through
    --     the arrears calculation, so it can never be separately payable.
    IF coalesce(v_end, v_due) < p_effective_date THEN
      v_reason := CASE WHEN upper(coalesce(p_arrears_status,'')) = 'REVIEW_REQUIRED'
                       THEN 'SUSPENDED_PERIOD_HELD_PENDING_ARREARS_REVIEW'
                       ELSE 'SUSPENDED_PERIOD_SETTLED_VIA_ARREARS' END;
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
         previous_status,new_status,amount,reason,detail,created_by_user_id)
      VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RETAINED',
              'HELD','HELD', r.amount, v_reason,
              jsonb_build_object('period_start',v_start,'period_end',v_end,
                                 'due_date',v_due,'effective_date',p_effective_date), p_actor);
      v_ret := v_ret + 1; v_susp_period := v_susp_period + 1; CONTINUE;
    END IF;

    -- (b) Straddling the reinstatement date: retain + raise proration review.
    IF coalesce(v_start, v_due) < p_effective_date
       AND coalesce(v_end, v_due) >= p_effective_date THEN
      IF r.record_type <> 'PAYMENT_SCHEDULE' THEN
        INSERT INTO public.bn_payment_exception
          (instruction_id, claim_id, exception_type, description, status, raised_by, raised_at)
        VALUES (r.record_id, v_claim, 'PRORATION_REVIEW',
                'Payment period straddles reinstatement effective date '||p_effective_date::text
                ||'; manual proration required before release.', 'OPEN',
                coalesce(p_user_code,'SCHEDULER'), now())
        RETURNING id INTO v_exc;
      END IF;
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
         previous_status,new_status,amount,reason,exception_id,detail,created_by_user_id)
      VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RETAINED',
              'HELD','HELD', r.amount,'STRADDLES_REINSTATEMENT_REQUIRES_PRORATION', v_exc,
              jsonb_build_object('period_start',v_start,'period_end',v_end,
                                 'due_date',v_due,'effective_date',p_effective_date), p_actor);
      v_ret := v_ret + 1; v_straddle := v_straddle + 1; CONTINUE;
    END IF;

    -- (c) Wholly on/after reinstatement: release only when demonstrably safe.
    IF v_batch IS NOT NULL OR v_paid IS NOT NULL THEN
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
         previous_status,new_status,reason,created_by_user_id)
      VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RETAINED',
              'HELD','HELD','BATCHED_OR_PAID_REQUIRES_MANUAL_REVIEW',p_actor);
      v_ret := v_ret + 1; CONTINUE;
    END IF;

    IF r.record_type = 'PAYMENT_SCHEDULE' THEN
      UPDATE public.bn_payment_schedule
         SET status = coalesce(r.previous_status,'SCHEDULED'),
             modified_by=coalesce(p_user_code,'SCHEDULER'), modified_at=now()
       WHERE id = r.record_id AND status='HELD';
    ELSE
      UPDATE public.bn_payment_instruction
         SET status = coalesce(r.previous_status,'PENDING'),
             hold_reason=NULL, hold_by=NULL, hold_at=NULL,
             modified_by=coalesce(p_user_code,'SCHEDULER'), modified_at=now()
       WHERE id = r.record_id AND status='HELD' AND batch_id IS NULL AND paid_date IS NULL;
    END IF;

    INSERT INTO public.bn_award_suspension_payment_impact
      (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
       previous_status,new_status,amount,reason,detail,created_by_user_id)
    VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RELEASED',
            'HELD', coalesce(r.previous_status,'SCHEDULED'), r.amount,
            'SAFE_RELEASE_ON_OR_AFTER_REINSTATEMENT',
            jsonb_build_object('period_start',v_start,'period_end',v_end,
                               'due_date',v_due,'effective_date',p_effective_date), p_actor);
    v_rel := v_rel + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'released_count', v_rel, 'retained_count', v_ret,
    'suspended_period_retained_count', v_susp_period,
    'straddling_review_count', v_straddle,
    'effective_date', p_effective_date,
    'arrears_status', p_arrears_status);
END $$;
REVOKE ALL ON FUNCTION public._bn_susp_release_holds(uuid,uuid,uuid,text,date,text) FROM PUBLIC, anon, authenticated;

-- 6. Manual execution: sanitized failure persistence.
CREATE OR REPLACE FUNCTION public.bn_award_suspension_execute_v1(
  p_suspension_id uuid, p_expected_row_version integer, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_case public.bn_award_suspension_event%ROWTYPE;
  v_user_code text; v_result jsonb; v_policy record;
  v_state text; v_detail text; v_safe text; v_attempts int;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();

  IF NOT public.has_permission(v_actor,'bn_award_suspension','execute') THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_hash := encode(digest(coalesce(p_suspension_id::text,'')||'|'||
    coalesce(p_expected_row_version::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_award_suspension_execute_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_case FROM public.bn_award_suspension_event WHERE id = p_suspension_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_case.row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_policy FROM public._bn_susp_resolve_policy_levels() WHERE level=1 LIMIT 1;
  IF v_case.proposed_by_user_id = v_actor
     AND NOT coalesce(v_policy.self_approval_allowed,false) THEN
    RAISE EXCEPTION 'E_SELF_APPROVAL_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_user_code := public._bn_susp_user_code(v_actor);

  BEGIN
    v_result := public._bn_susp_execute_core(p_suspension_id, v_actor, v_user_code,
                                             p_narrative, p_correlation_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = MESSAGE_TEXT;
    IF v_detail LIKE 'E\_%' THEN
      v_safe := split_part(v_detail,' ',1);
    ELSE
      v_safe := public._bn_susp_safe_code(NULL, v_state);
    END IF;
    PERFORM set_config('bn.susp.trusted','on', true);
    PERFORM public._bn_susp_log_operational_error(
      'bn_award_suspension_execute_v1','EXECUTE', p_suspension_id, p_correlation_id,
      v_safe, v_state, v_detail);
    UPDATE public.bn_award_suspension_event
       SET status = CASE WHEN status IN ('APPROVED','EXECUTION_FAILED')
                         THEN 'EXECUTION_FAILED' ELSE status END,
           execution_status='FAILED',
           execution_attempts = execution_attempts + 1,
           last_execution_error = v_safe,
           row_version = row_version + 1,
           modified_at = now(), modified_by = coalesce(v_user_code,'SYSTEM')
     WHERE id = p_suspension_id
     RETURNING execution_attempts INTO v_attempts;
    PERFORM public._bn_susp_audit(v_actor,'BN.SUSPENSION.EXECUTION_FAILED','execute',
      p_suspension_id::text, jsonb_build_object('case_status', v_case.status),
      jsonb_build_object('execution_status','FAILED','error_code', v_safe,
                         'correlation_id', p_correlation_id,
                         'attempted_at', now(), 'attempt_count', v_attempts),
      p_correlation_id, p_narrative);
    RETURN jsonb_build_object('suspension_id',p_suspension_id,'status','EXECUTION_FAILED',
                              'execution_status','FAILED','error_code', v_safe,
                              'correlation_id', p_correlation_id,
                              'attempt_count', v_attempts, 'attempted_at', now());
  END;

  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_suspension_execute_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

-- 7. Scheduled execution: same sanitisation.
CREATE OR REPLACE FUNCTION public.bn_award_suspension_execute_scheduled_v1(
  p_suspension_id uuid, p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cached jsonb; v_hash text; v_result jsonb;
        v_state text; v_detail text; v_safe text; v_attempts int;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_hash := encode(digest('scheduler|'||coalesce(p_suspension_id::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(NULL,'bn_award_suspension_execute_scheduled_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  BEGIN
    v_result := public._bn_susp_execute_core(p_suspension_id, NULL,'SCHEDULER',
                  'Automatic execution of approved suspension', p_correlation_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = MESSAGE_TEXT;
    IF v_detail LIKE 'E\_%' THEN
      v_safe := split_part(v_detail,' ',1);
    ELSE
      v_safe := public._bn_susp_safe_code(NULL, v_state);
    END IF;
    PERFORM set_config('bn.susp.trusted','on', true);
    PERFORM public._bn_susp_log_operational_error(
      'bn_award_suspension_execute_scheduled_v1','EXECUTE', p_suspension_id,
      p_correlation_id, v_safe, v_state, v_detail);
    UPDATE public.bn_award_suspension_event
       SET status = CASE WHEN status IN ('APPROVED','EXECUTION_FAILED')
                         THEN 'EXECUTION_FAILED' ELSE status END,
           execution_status='FAILED',
           execution_attempts = execution_attempts + 1,
           last_execution_error = v_safe, modified_at = now(), modified_by='SCHEDULER'
     WHERE id = p_suspension_id
     RETURNING execution_attempts INTO v_attempts;
    RETURN jsonb_build_object('suspension_id',p_suspension_id,'status','EXECUTION_FAILED',
                              'execution_status','FAILED','error_code', v_safe,
                              'correlation_id', p_correlation_id,
                              'attempt_count', v_attempts, 'attempted_at', now());
  END;

  PERFORM public._bn_susp_receipt_store(NULL,'bn_award_suspension_execute_scheduled_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

-- 8. Reinstatement execution: effective-date hold boundary + calc evidence gate.
CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_execute_v1(
  p_reinstatement_id uuid, p_expected_row_version integer, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_user_code text;
  v_case public.bn_award_suspension_event%ROWTYPE;
  v_susp public.bn_award_suspension_event%ROWTYPE;
  v_award public.bn_award%ROWTYPE; v_arrears jsonb; v_release jsonb;
  v_instr uuid; v_result jsonb; v_run uuid; v_arrears_status text; v_eff date;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();
  IF NOT public.has_permission(v_actor,'bn_award_suspension','resume_execute') THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_hash := encode(digest('exec|'||coalesce(p_reinstatement_id::text,'')||'|'||
    coalesce(p_expected_row_version::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_award_reinstatement_execute_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_case FROM public.bn_award_suspension_event
   WHERE id = p_reinstatement_id AND case_kind='REINSTATEMENT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_case.status <> 'REINSTATEMENT_APPROVED' THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001';
  END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_case.row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;
  IF v_case.suspended_to IS NULL OR v_case.suspended_to > current_date THEN
    RAISE EXCEPTION 'E_NOT_DUE' USING ERRCODE='P0001';
  END IF;
  IF v_case.proposed_by_user_id = v_actor THEN
    RAISE EXCEPTION 'E_SELF_APPROVAL_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_susp FROM public.bn_award_suspension_event
   WHERE id = v_case.reinstatement_of_id FOR UPDATE;
  IF NOT FOUND OR v_susp.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'E_NO_ACTIVE_SUSPENSION' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_award FROM public.bn_award WHERE id = v_case.bn_award_id FOR UPDATE;
  IF v_award.status <> 'SUSPENDED' THEN
    RAISE EXCEPTION 'E_AWARD_NOT_SUSPENDED' USING ERRCODE='P0001';
  END IF;

  v_user_code := public._bn_susp_user_code(v_actor);
  v_eff := v_case.suspended_to;
  PERFORM set_config('bn.susp.trusted','on', true);

  v_arrears := public._bn_susp_arrears(v_award.id, v_susp.suspended_from, v_eff);
  v_arrears_status := v_arrears->>'status';

  -- Fail closed: no calculation evidence, no financial completion.
  v_run := public._bn_susp_persist_arrears_run(v_award.bn_claim_id, v_arrears, v_user_code);
  IF v_run IS NULL THEN
    RAISE EXCEPTION 'E_CALCULATION_PERSIST_FAILED' USING ERRCODE='P0001';
  END IF;

  v_release := public._bn_susp_release_holds(v_susp.id, v_award.id, v_actor, v_user_code,
                                             v_eff, v_arrears_status);

  UPDATE public.bn_award
     SET status='ACTIVE', row_version = row_version + 1,
         modified_by = v_user_code, modified_at = now()
   WHERE id = v_award.id;

  INSERT INTO public.bn_award_status_event
    (bn_award_id, from_status, to_status, event_date, reason_code, remarks, entered_by)
  VALUES (v_award.id,'SUSPENDED','ACTIVE', v_eff, v_case.reason_code,
          concat_ws(' | ','Reinstatement executed', p_narrative,
                    'reinstatement='||p_reinstatement_id::text), v_user_code);

  UPDATE public.bn_award_suspension_event
     SET status='RESUMED', resumed_at = now(), resumed_by = v_user_code,
         suspended_to = v_eff, row_version = row_version + 1,
         modified_by = v_user_code, modified_at = now()
   WHERE id = v_susp.id;

  IF v_arrears_status = 'REVIEW_REQUIRED' THEN
    INSERT INTO public.bn_award_suspension_payment_impact
      (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
       new_status,amount,reason,detail,created_by_user_id)
    VALUES (v_susp.id, v_award.id,'REINSTATEMENT','ARREARS', p_reinstatement_id,
            'ARREARS_REVIEW_REQUIRED','PENDING_REVIEW',
            nullif(v_arrears->>'net_arrears','')::numeric,
            'REINSTATEMENT_ARREARS_REVIEW_REQUIRED',
            jsonb_build_object('arrears', v_arrears, 'calc_run_id', v_run,
                               'release', v_release), v_actor);

    PERFORM public._bn_susp_comm(v_award.id,'BN.ARREARS.REVIEW_REQUIRED',
      jsonb_build_object('reinstatement_id',p_reinstatement_id,
                         'notes', v_arrears->>'notes'), v_user_code, p_correlation_id);

  ELSIF v_arrears_status = 'CALCULATED' AND (v_arrears->>'net_arrears')::numeric > 0 THEN
    -- A suspended-period payment must never be both released and re-paid as arrears.
    IF EXISTS (
      SELECT 1 FROM public.bn_award_suspension_payment_impact pi
       WHERE pi.suspension_id = v_susp.id AND pi.phase='REINSTATEMENT'
         AND pi.impact_action='RELEASED'
         AND coalesce((pi.detail->>'period_end')::date,
                      (pi.detail->>'due_date')::date) < v_eff
    ) THEN
      RAISE EXCEPTION 'E_PAYMENT_HOLD_FAILED' USING ERRCODE='P0001';
    END IF;

    INSERT INTO public.bn_payment_instruction
      (award_id, claim_id, ssn, amount, currency, due_date, description, status,
       period_start, period_end, instruction_type, payment_type, entitlement_id,
       modified_by, modified_at)
    VALUES (v_award.id, v_award.bn_claim_id, v_award.ssn,
            (v_arrears->>'net_arrears')::numeric, coalesce(v_award.currency,'XCD'),
            current_date,
            'Reinstatement arrears for suspension '||v_susp.id::text,
            'PENDING', v_susp.suspended_from, v_eff,
            'ARREARS','ARREARS', NULL, v_user_code, now())
    RETURNING id INTO v_instr;

    INSERT INTO public.bn_award_suspension_payment_impact
      (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
       new_status,amount,reason,detail,created_by_user_id)
    VALUES (v_susp.id, v_award.id,'REINSTATEMENT','PAYMENT_INSTRUCTION', v_instr,
            'ARREARS_CREATED','PENDING',(v_arrears->>'net_arrears')::numeric,
            'REINSTATEMENT_ARREARS',
            jsonb_build_object('arrears', v_arrears, 'calc_run_id', v_run,
                               'release', v_release), v_actor);
  ELSE
    INSERT INTO public.bn_award_suspension_payment_impact
      (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
       new_status,amount,reason,detail,created_by_user_id)
    VALUES (v_susp.id, v_award.id,'REINSTATEMENT','ARREARS', p_reinstatement_id,
            'ARREARS_NOT_REQUIRED','NONE',0,'NO_ARREARS_DUE',
            jsonb_build_object('arrears', v_arrears, 'calc_run_id', v_run), v_actor);
  END IF;

  UPDATE public.bn_award_suspension_event
     SET status='RESUMED', executed_at = now(), executed_by_user_id = v_actor,
         execution_status='EXECUTED', execution_attempts = execution_attempts + 1,
         arrears_snapshot = v_arrears, arrears_calc_run_id = v_run,
         row_version = row_version + 1,
         modified_by = v_user_code, modified_at = now()
   WHERE id = p_reinstatement_id;

  UPDATE public.core_workflow_instance
     SET status='COMPLETED',
         metadata = coalesce(metadata,'{}'::jsonb)
           || jsonb_build_object('execution_status','EXECUTED','arrears',v_arrears)
   WHERE id = v_case.workflow_instance_id;

  PERFORM public._bn_susp_audit(v_actor,'BN.REINSTATEMENT.EXECUTED','resume_execute',
    p_reinstatement_id::text,
    jsonb_build_object('award_status','SUSPENDED','case_status','REINSTATEMENT_APPROVED'),
    jsonb_build_object('award_status','ACTIVE','case_status','RESUMED',
                       'arrears', v_arrears,'release', v_release,'calc_run_id', v_run),
    p_correlation_id, p_narrative);

  PERFORM public._bn_susp_comm(v_award.id,'BN.REINSTATEMENT.EFFECTIVE',
    jsonb_build_object('reinstatement_id',p_reinstatement_id,
                       'effective_from', v_eff), v_user_code, p_correlation_id);
  IF v_instr IS NOT NULL THEN
    PERFORM public._bn_susp_comm(v_award.id,'BN.ARREARS.CREATED',
      jsonb_build_object('instruction_id',v_instr,
                         'net_arrears',(v_arrears->>'net_arrears')::numeric),
      v_user_code, p_correlation_id);
  END IF;

  v_result := jsonb_build_object('reinstatement_id',p_reinstatement_id,'status','RESUMED',
    'award_status','ACTIVE','arrears', v_arrears,'payment_release', v_release,
    'arrears_instruction_id', v_instr,'arrears_calc_run_id', v_run,
    'arrears_review_required', (v_arrears_status = 'REVIEW_REQUIRED'),
    'row_version', v_case.row_version + 1);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_reinstatement_execute_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.bn_award_suspension_execute_v1(uuid,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_execute_v1(uuid,integer,text,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_award_suspension_execute_scheduled_v1(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_execute_scheduled_v1(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.bn_award_reinstatement_execute_v1(uuid,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_execute_v1(uuid,integer,text,text,text) TO authenticated, service_role;
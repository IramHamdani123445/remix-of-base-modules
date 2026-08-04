-- =====================================================================
-- BN Award Suspension execution & reinstatement closure
-- =====================================================================

-- 1. Impact vocabulary extensions -------------------------------------
ALTER TABLE public.bn_award_suspension_payment_impact
  DROP CONSTRAINT IF EXISTS bn_susp_impact_action_chk;
ALTER TABLE public.bn_award_suspension_payment_impact
  ADD CONSTRAINT bn_susp_impact_action_chk CHECK (impact_action::text = ANY (ARRAY[
    'HELD','EXCEPTION_RAISED','NO_ACTION','RELEASED','RETAINED',
    'ARREARS_CREATED','ARREARS_REVIEW_REQUIRED','ARREARS_NOT_REQUIRED']));

ALTER TABLE public.bn_award_suspension_payment_impact
  DROP CONSTRAINT IF EXISTS bn_susp_impact_record_chk;
ALTER TABLE public.bn_award_suspension_payment_impact
  ADD CONSTRAINT bn_susp_impact_record_chk CHECK (record_type::text = ANY (ARRAY[
    'PAYMENT_SCHEDULE','PAYMENT_INSTRUCTION','BATCH_ITEM','ARREARS']));

-- one arrears outcome per suspension, ever
CREATE UNIQUE INDEX IF NOT EXISTS bn_susp_impact_arrears_uq
  ON public.bn_award_suspension_payment_impact (suspension_id)
  WHERE phase = 'REINSTATEMENT'
    AND impact_action::text IN ('ARREARS_CREATED','ARREARS_REVIEW_REQUIRED','ARREARS_NOT_REQUIRED');

-- 2. Idempotency receipts: system actor sentinel ----------------------
CREATE OR REPLACE FUNCTION public._bn_susp_receipt_store(
  p_actor uuid, p_command text, p_key text, p_payload_hash text,
  p_response jsonb, p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN RETURN; END IF;
  INSERT INTO public.core_command_receipt
    (actor_user_id, command_name, idempotency_key, payload_hash,
     response, status, correlation_id)
  VALUES
    (coalesce(p_actor,'00000000-0000-0000-0000-000000000000'::uuid),
     p_command, p_key, p_payload_hash, p_response, 'SUCCESS', p_correlation)
  ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public._bn_susp_receipt_lookup(
  p_actor uuid, p_command text, p_key text, p_payload_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.core_command_receipt%ROWTYPE;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.core_command_receipt
   WHERE actor_user_id = coalesce(p_actor,'00000000-0000-0000-0000-000000000000'::uuid)
     AND command_name = p_command
     AND idempotency_key = p_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.payload_hash <> p_payload_hash THEN
    RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  RETURN r.response;
END $function$;

-- 3. Arrears calculation v2 -------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_susp_arrears(p_award_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_award public.bn_award%ROWTYPE; v_ent public.bn_entitlement%ROWTYPE;
  v_freq text; v_rate numeric; v_units numeric; v_gross numeric;
  v_paid_sched numeric := 0; v_paid_instr numeric := 0; v_paid numeric := 0;
  v_deduct numeric := 0; v_net numeric;
  v_status text := 'CALCULATED'; v_notes text[] := ARRAY[]::text[];
  v_days integer; v_trace jsonb;
BEGIN
  SELECT * INTO v_award FROM public.bn_award WHERE id = p_award_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_to IS NULL OR p_from IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_ent FROM public.bn_entitlement
   WHERE claim_id = v_award.bn_claim_id
     AND (effective_from IS NULL OR effective_from <= p_to)
   ORDER BY effective_from DESC NULLS LAST LIMIT 1;

  v_freq := upper(coalesce(v_ent.payment_frequency, v_award.frequency, ''));
  v_days := (p_to - p_from);

  IF v_freq LIKE 'WEEK%' THEN
    v_rate := coalesce(v_ent.weekly_rate, v_award.base_amount);
    v_units := round(v_days::numeric / 7.0, 4);
  ELSIF v_freq LIKE 'MONTH%' THEN
    v_rate := coalesce(v_ent.monthly_rate, v_award.base_amount);
    v_units := round(v_days::numeric / 30.4375, 4);
  ELSE
    v_rate := NULL;
  END IF;

  IF v_rate IS NULL OR v_rate <= 0 OR v_units IS NULL THEN
    v_status := 'REVIEW_REQUIRED';
    v_notes := v_notes || 'Entitlement rate or payment frequency not resolvable.';
    v_gross := 0; v_units := coalesce(v_units,0); v_rate := coalesce(v_rate,0);
  ELSE
    v_gross := round(v_rate * v_units, 2);
  END IF;

  -- Paid amounts. Schedules and instructions can represent the SAME money,
  -- so they are never summed together; the larger settled view is used and
  -- an overlap is flagged for manual review.
  SELECT coalesce(sum(net_amount),0) INTO v_paid_sched
    FROM public.bn_payment_schedule
   WHERE bn_award_id = p_award_id AND paid_at IS NOT NULL
     AND due_date >= p_from AND due_date < p_to;

  SELECT coalesce(sum(amount),0) INTO v_paid_instr
    FROM public.bn_payment_instruction
   WHERE award_id = p_award_id AND paid_date IS NOT NULL
     AND due_date >= p_from AND due_date < p_to;

  v_paid := greatest(v_paid_sched, v_paid_instr);
  IF v_paid_sched > 0 AND v_paid_instr > 0 THEN
    v_status := 'REVIEW_REQUIRED';
    v_notes := v_notes || 'Both paid schedules and paid instructions exist in the suspended period; settled amount cannot be derived automatically.';
  END IF;

  -- Outstanding overpayments overlapping the suspended period are deducted.
  SELECT coalesce(sum(greatest(coalesce(outstanding_amount,0),0)),0) INTO v_deduct
    FROM public.bn_overpayment
   WHERE bn_award_id = p_award_id
     AND coalesce(outstanding_amount,0) > 0
     AND upper(coalesce(recovery_status,'')) NOT IN ('CLOSED','WAIVED','WRITTEN_OFF','RECOVERED');

  v_net := round(greatest(v_gross - v_paid - v_deduct, 0), 2);
  IF v_status = 'CALCULATED' AND v_net = 0 THEN v_status := 'NO_ARREARS'; END IF;

  v_trace := jsonb_build_array(
    jsonb_build_object('step','period','from',p_from,'to',p_to,'days',v_days),
    jsonb_build_object('step','rate','frequency',nullif(v_freq,''),'rate',v_rate,'units',v_units),
    jsonb_build_object('step','gross','value',v_gross),
    jsonb_build_object('step','already_paid','from_schedules',v_paid_sched,
                       'from_instructions',v_paid_instr,'applied',v_paid),
    jsonb_build_object('step','deductions','outstanding_overpayments',v_deduct),
    jsonb_build_object('step','net','value',v_net));

  RETURN jsonb_build_object(
    'status', v_status, 'calc_version','v2',
    'period_from', p_from, 'period_to', p_to, 'period_days', v_days,
    'frequency', nullif(v_freq,''), 'rate', v_rate, 'units', v_units,
    'currency', coalesce(v_award.currency,'XCD'),
    'gross_payable', v_gross, 'already_paid', v_paid,
    'paid_from_schedules', v_paid_sched, 'paid_from_instructions', v_paid_instr,
    'deductions', v_deduct,
    'net_arrears', v_net,
    'notes', nullif(array_to_string(v_notes,' '),''),
    'trace', v_trace,
    'calculated_at', now());
END $function$;

-- 4. Persist arrears calculation as an auditable calc run --------------
CREATE OR REPLACE FUNCTION public._bn_susp_persist_arrears_run(
  p_claim_id uuid, p_arrears jsonb, p_user_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_run uuid; v_step jsonb; v_seq int := 0;
BEGIN
  IF p_claim_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.bn_calc_run
    (claim_id, run_mode, run_status, triggered_by, completed_at,
     payment_frequency, variables_snapshot, entered_by, modified_by)
  VALUES (p_claim_id,'LIVE',
          CASE WHEN p_arrears->>'status' = 'REVIEW_REQUIRED' THEN 'FAILED' ELSE 'COMPLETED' END,
          'BN_AWARD_SUSPENSION_REINSTATEMENT_ARREARS', now(),
          p_arrears->>'frequency', p_arrears,
          coalesce(p_user_code,'SCHEDULER'), coalesce(p_user_code,'SCHEDULER'))
  RETURNING id INTO v_run;

  FOR v_step IN SELECT * FROM jsonb_array_elements(coalesce(p_arrears->'trace','[]'::jsonb)) LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.bn_calc_trace (calc_run_id, step_no, step_name, output_value)
    VALUES (v_run, v_seq, v_step->>'step', v_step);
  END LOOP;
  RETURN v_run;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RETURN v_run;
END $function$;

-- 5. Reinstatement approval: validate the specific task ----------------
CREATE OR REPLACE FUNCTION public._bn_reinst_decide(
  p_reinstatement_id uuid, p_task_id uuid, p_decision text, p_reason_code text,
  p_narrative text, p_expected_row_version integer, p_correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_actor uuid; v_case public.bn_award_suspension_event%ROWTYPE;
  v_new text; v_user_code text; v_policy record; v_task public.core_workflow_task%ROWTYPE;
BEGIN
  v_actor := public._bn_susp_actor();
  IF NOT public.has_permission(v_actor,'bn_award_suspension','resume_approve') THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_case FROM public.bn_award_suspension_event
   WHERE id = p_reinstatement_id AND case_kind='REINSTATEMENT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_case.status <> 'REINSTATEMENT_PROPOSED' THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001';
  END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_case.row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_policy FROM public._bn_susp_resolve_policy_levels() WHERE level=1 LIMIT 1;
  IF v_case.proposed_by_user_id = v_actor
     AND NOT coalesce(v_policy.self_approval_allowed,false) THEN
    RAISE EXCEPTION 'E_SELF_APPROVAL_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  -- Task resolution: an explicitly supplied task must belong to this case
  -- and still be open; otherwise the single open task is resolved.
  IF p_task_id IS NOT NULL THEN
    SELECT * INTO v_task FROM public.core_workflow_task
     WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND OR v_task.workflow_instance_id IS DISTINCT FROM v_case.workflow_instance_id THEN
      RAISE EXCEPTION 'E_TASK_NOT_FOR_CASE' USING ERRCODE='P0001';
    END IF;
    IF upper(coalesce(v_task.task_status,'')) <> 'OPEN' THEN
      RAISE EXCEPTION 'E_TASK_NOT_OPEN' USING ERRCODE='P0001';
    END IF;
  ELSE
    SELECT * INTO v_task FROM public.core_workflow_task
     WHERE workflow_instance_id = v_case.workflow_instance_id
       AND task_status = 'OPEN'
     ORDER BY created_at LIMIT 1 FOR UPDATE;
  END IF;

  v_new := CASE WHEN p_decision='APPROVE' THEN 'REINSTATEMENT_APPROVED'
                ELSE 'REINSTATEMENT_REJECTED' END;
  IF p_decision='REJECT' AND coalesce(trim(p_reason_code),'')='' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  v_user_code := public._bn_susp_user_code(v_actor);
  PERFORM set_config('bn.susp.trusted','on', true);

  UPDATE public.bn_award_suspension_event
     SET status = v_new, row_version = row_version + 1,
         modified_by = v_user_code, modified_at = now()
   WHERE id = p_reinstatement_id;

  IF v_task.id IS NOT NULL THEN
    UPDATE public.core_workflow_task
       SET task_status='COMPLETED', completed_at=now(), completed_by=v_actor,
           outcome = p_decision
     WHERE id = v_task.id;
  END IF;

  UPDATE public.core_workflow_instance
     SET status = CASE WHEN p_decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
         current_step_code = CASE WHEN p_decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END
   WHERE id = v_case.workflow_instance_id;

  INSERT INTO public.core_workflow_action_log
    (workflow_instance_id, workflow_task_id, action_type, action_name, from_step_code,
     to_step_code, actor_user_id, outcome, comments, before_status, after_status, metadata)
  VALUES (v_case.workflow_instance_id, v_task.id, p_decision,'Reinstatement '||p_decision,
          'PENDING_APPROVAL', CASE WHEN p_decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
          v_actor,'SUCCESS', p_narrative,'REINSTATEMENT_PROPOSED', v_new,
          jsonb_build_object('reinstatement_id',p_reinstatement_id,'reason_code',p_reason_code));

  PERFORM public._bn_susp_audit(v_actor,
    CASE WHEN p_decision='APPROVE' THEN 'BN.REINSTATEMENT.APPROVED'
         ELSE 'BN.REINSTATEMENT.REJECTED' END,
    'resume_approve', p_reinstatement_id::text,
    jsonb_build_object('status','REINSTATEMENT_PROPOSED'),
    jsonb_build_object('status',v_new), p_correlation, p_narrative);

  PERFORM public._bn_susp_comm(v_case.bn_award_id,
    CASE WHEN p_decision='APPROVE' THEN 'BN.REINSTATEMENT.APPROVED'
         ELSE 'BN.REINSTATEMENT.REJECTED' END,
    jsonb_build_object('reinstatement_id',p_reinstatement_id), v_user_code, p_correlation);

  RETURN jsonb_build_object('reinstatement_id',p_reinstatement_id,'status',v_new,
                            'task_id', v_task.id,
                            'row_version', v_case.row_version + 1);
END $function$;

-- 6. Reinstatement execution: explicit REVIEW_REQUIRED + calc run ------
CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_execute_v1(
  p_reinstatement_id uuid, p_expected_row_version integer, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_user_code text;
  v_case public.bn_award_suspension_event%ROWTYPE;
  v_susp public.bn_award_suspension_event%ROWTYPE;
  v_award public.bn_award%ROWTYPE; v_arrears jsonb; v_release jsonb;
  v_instr uuid; v_result jsonb; v_run uuid; v_arrears_status text;
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
  PERFORM set_config('bn.susp.trusted','on', true);

  v_arrears := public._bn_susp_arrears(v_award.id, v_susp.suspended_from, v_case.suspended_to);
  v_arrears_status := v_arrears->>'status';
  v_run := public._bn_susp_persist_arrears_run(v_award.bn_claim_id, v_arrears, v_user_code);
  v_release := public._bn_susp_release_holds(v_susp.id, v_award.id, v_actor, v_user_code);

  UPDATE public.bn_award
     SET status='ACTIVE', row_version = row_version + 1,
         modified_by = v_user_code, modified_at = now()
   WHERE id = v_award.id;

  INSERT INTO public.bn_award_status_event
    (bn_award_id, from_status, to_status, event_date, reason_code, remarks, entered_by)
  VALUES (v_award.id,'SUSPENDED','ACTIVE', v_case.suspended_to, v_case.reason_code,
          concat_ws(' | ','Reinstatement executed', p_narrative,
                    'reinstatement='||p_reinstatement_id::text), v_user_code);

  UPDATE public.bn_award_suspension_event
     SET status='RESUMED', resumed_at = now(), resumed_by = v_user_code,
         suspended_to = v_case.suspended_to, row_version = row_version + 1,
         modified_by = v_user_code, modified_at = now()
   WHERE id = v_susp.id;

  IF v_arrears_status = 'REVIEW_REQUIRED' THEN
    -- No money is moved automatically; the case is parked for manual handling.
    INSERT INTO public.bn_award_suspension_payment_impact
      (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
       new_status,amount,reason,detail,created_by_user_id)
    VALUES (v_susp.id, v_award.id,'REINSTATEMENT','ARREARS', p_reinstatement_id,
            'ARREARS_REVIEW_REQUIRED','PENDING_REVIEW',
            nullif(v_arrears->>'net_arrears','')::numeric,
            'REINSTATEMENT_ARREARS_REVIEW_REQUIRED',
            jsonb_build_object('arrears', v_arrears, 'calc_run_id', v_run), v_actor);

    PERFORM public._bn_susp_comm(v_award.id,'BN.ARREARS.REVIEW_REQUIRED',
      jsonb_build_object('reinstatement_id',p_reinstatement_id,
                         'notes', v_arrears->>'notes'), v_user_code, p_correlation_id);

  ELSIF v_arrears_status = 'CALCULATED' AND (v_arrears->>'net_arrears')::numeric > 0 THEN
    INSERT INTO public.bn_payment_instruction
      (award_id, claim_id, ssn, amount, currency, due_date, description, status,
       period_start, period_end, instruction_type, payment_type, entitlement_id,
       modified_by, modified_at)
    VALUES (v_award.id, v_award.bn_claim_id, v_award.ssn,
            (v_arrears->>'net_arrears')::numeric, coalesce(v_award.currency,'XCD'),
            current_date,
            'Reinstatement arrears for suspension '||v_susp.id::text,
            'PENDING', v_susp.suspended_from, v_case.suspended_to,
            'ARREARS','ARREARS', NULL, v_user_code, now())
    RETURNING id INTO v_instr;

    INSERT INTO public.bn_award_suspension_payment_impact
      (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
       new_status,amount,reason,detail,created_by_user_id)
    VALUES (v_susp.id, v_award.id,'REINSTATEMENT','PAYMENT_INSTRUCTION', v_instr,
            'ARREARS_CREATED','PENDING',(v_arrears->>'net_arrears')::numeric,
            'REINSTATEMENT_ARREARS',
            jsonb_build_object('arrears', v_arrears, 'calc_run_id', v_run), v_actor);
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
                       'effective_from',v_case.suspended_to), v_user_code, p_correlation_id);
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
END $function$;

-- 7. Manual suspension execution: persist failures safely --------------
CREATE OR REPLACE FUNCTION public.bn_award_suspension_execute_v1(
  p_suspension_id uuid, p_expected_row_version integer, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_case public.bn_award_suspension_event%ROWTYPE;
  v_user_code text; v_result jsonb; v_policy record; v_err text;
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
    v_err := SQLERRM;
    PERFORM set_config('bn.susp.trusted','on', true);
    UPDATE public.bn_award_suspension_event
       SET status = CASE WHEN status IN ('APPROVED','EXECUTION_FAILED')
                         THEN 'EXECUTION_FAILED' ELSE status END,
           execution_status='FAILED',
           execution_attempts = execution_attempts + 1,
           last_execution_error = v_err,
           row_version = row_version + 1,
           modified_at = now(), modified_by = coalesce(v_user_code,'SYSTEM')
     WHERE id = p_suspension_id;
    PERFORM public._bn_susp_audit(v_actor,'BN.SUSPENSION.EXECUTION_FAILED','execute',
      p_suspension_id::text, jsonb_build_object('case_status', v_case.status),
      jsonb_build_object('execution_status','FAILED','error', v_err),
      p_correlation_id, p_narrative);
    RETURN jsonb_build_object('suspension_id',p_suspension_id,'status','EXECUTION_FAILED',
                              'execution_status','FAILED','error', v_err);
  END;

  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_suspension_execute_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $function$;

-- 8. Payment-impact reads require the dedicated permission -------------
CREATE OR REPLACE FUNCTION public.bn_award_suspension_preview_payment_impact_v1(p_suspension_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_actor uuid; v_case public.bn_award_suspension_event%ROWTYPE;
BEGIN
  v_actor := public._bn_susp_actor();
  IF NOT (public.has_permission(v_actor,'bn_award_suspension','view_payment_impact')
       OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_case FROM public.bn_award_suspension_event WHERE id = p_suspension_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  RETURN public._bn_susp_payment_impact(p_suspension_id, v_case.bn_award_id,
           v_case.suspended_from, false, v_actor, NULL);
END $function$;

CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_calculate_arrears_v1(p_reinstatement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_actor uuid; v_case public.bn_award_suspension_event%ROWTYPE;
        v_susp public.bn_award_suspension_event%ROWTYPE;
BEGIN
  v_actor := public._bn_susp_actor();
  IF NOT (public.has_permission(v_actor,'bn_award_suspension','view_payment_impact')
       OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_case FROM public.bn_award_suspension_event
   WHERE id = p_reinstatement_id AND case_kind='REINSTATEMENT';
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_susp FROM public.bn_award_suspension_event
   WHERE id = v_case.reinstatement_of_id;
  RETURN public._bn_susp_arrears(v_case.bn_award_id,
           coalesce(v_susp.suspended_from, v_case.suspended_from), v_case.suspended_to);
END $function$;

-- 9. Paged, permission-checked impact ledger ---------------------------
CREATE OR REPLACE FUNCTION public.bn_award_suspension_payment_impact_list_v1(
  p_suspension_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, phase text, record_type text, record_id uuid, impact_action text,
  previous_status text, new_status text, exception_id uuid, amount numeric,
  reason text, created_at timestamptz, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_actor uuid;
BEGIN
  v_actor := public._bn_susp_actor();
  IF NOT (public.has_permission(v_actor,'bn_award_suspension','view_payment_impact')
       OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY
  SELECT i.id, i.phase::text, i.record_type::text, i.record_id, i.impact_action::text,
         i.previous_status, i.new_status, i.exception_id, i.amount, i.reason, i.created_at,
         count(*) OVER () AS total_count
    FROM public.bn_award_suspension_payment_impact i
   WHERE i.suspension_id = p_suspension_id
   ORDER BY i.created_at DESC
   LIMIT greatest(least(coalesce(p_limit,50),200),1)
  OFFSET greatest(coalesce(p_offset,0),0);
END $function$;

-- 10. Grants -----------------------------------------------------------
REVOKE ALL ON FUNCTION public._bn_susp_arrears(uuid,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_persist_arrears_run(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_reinst_decide(uuid,uuid,text,text,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_receipt_lookup(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_receipt_store(uuid,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_susp_arrears(uuid,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_susp_persist_arrears_run(uuid,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.bn_award_suspension_payment_impact_list_v1(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_payment_impact_list_v1(uuid,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_execute_v1(uuid,integer,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_execute_v1(uuid,integer,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_calculate_arrears_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_preview_payment_impact_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_due_for_execution_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_execute_scheduled_v1(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.bn_award_suspension_due_for_execution_v1(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_award_suspension_execute_scheduled_v1(uuid,text,text) FROM PUBLIC, anon, authenticated;
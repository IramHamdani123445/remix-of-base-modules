-- ============================================================
-- BN Award Suspension — Execution & Reinstatement (dark-launched)
-- ============================================================

-- 1. Schema -------------------------------------------------
ALTER TABLE public.bn_award
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.bn_award_suspension_event
  ADD COLUMN IF NOT EXISTS case_kind varchar(20) NOT NULL DEFAULT 'SUSPENSION',
  ADD COLUMN IF NOT EXISTS reinstatement_of_id uuid REFERENCES public.bn_award_suspension_event(id),
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS execution_status varchar(20) NOT NULL DEFAULT 'NOT_DUE',
  ADD COLUMN IF NOT EXISTS execution_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_execution_error text,
  ADD COLUMN IF NOT EXISTS arrears_calc_run_id uuid,
  ADD COLUMN IF NOT EXISTS arrears_snapshot jsonb;

ALTER TABLE public.bn_award_suspension_event
  DROP CONSTRAINT IF EXISTS bn_award_suspension_event_status_chk;
ALTER TABLE public.bn_award_suspension_event
  ADD CONSTRAINT bn_award_suspension_event_status_chk CHECK (status::text = ANY (ARRAY[
    'PROPOSED','APPROVED','REJECTED','WITHDRAWN','ACTIVE','RESUMED','EXECUTION_FAILED',
    'REINSTATEMENT_PROPOSED','REINSTATEMENT_APPROVED','REINSTATEMENT_REJECTED','REINSTATEMENT_WITHDRAWN'
  ]));

ALTER TABLE public.bn_award_suspension_event
  DROP CONSTRAINT IF EXISTS bn_award_suspension_event_case_kind_chk;
ALTER TABLE public.bn_award_suspension_event
  ADD CONSTRAINT bn_award_suspension_event_case_kind_chk
  CHECK (case_kind::text = ANY (ARRAY['SUSPENSION','REINSTATEMENT']));

ALTER TABLE public.bn_award_suspension_event
  DROP CONSTRAINT IF EXISTS bn_award_suspension_event_exec_status_chk;
ALTER TABLE public.bn_award_suspension_event
  ADD CONSTRAINT bn_award_suspension_event_exec_status_chk
  CHECK (execution_status::text = ANY (ARRAY['NOT_DUE','SCHEDULED','EXECUTING','EXECUTED','FAILED','NOT_APPLICABLE']));

DROP INDEX IF EXISTS ux_bn_award_suspension_open_case;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_award_suspension_open_case
  ON public.bn_award_suspension_event (bn_award_id, case_kind)
  WHERE status IN ('PROPOSED','APPROVED','REINSTATEMENT_PROPOSED','REINSTATEMENT_APPROVED','EXECUTION_FAILED');

CREATE INDEX IF NOT EXISTS ix_bn_award_suspension_due
  ON public.bn_award_suspension_event (execution_status, suspended_from)
  WHERE status IN ('APPROVED','REINSTATEMENT_APPROVED','EXECUTION_FAILED');

-- 2. Payment impact ledger (traceability, not a parallel hold model)
CREATE TABLE IF NOT EXISTS public.bn_award_suspension_payment_impact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suspension_id uuid NOT NULL REFERENCES public.bn_award_suspension_event(id) ON DELETE RESTRICT,
  bn_award_id uuid NOT NULL,
  phase varchar(20) NOT NULL DEFAULT 'SUSPENSION',
  record_type varchar(30) NOT NULL,
  record_id uuid NOT NULL,
  impact_action varchar(30) NOT NULL,
  previous_status text,
  new_status text,
  exception_id uuid,
  amount numeric,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_susp_impact_action_chk CHECK (impact_action::text = ANY (ARRAY[
    'HELD','EXCEPTION_RAISED','NO_ACTION','RELEASED','RETAINED','ARREARS_CREATED'])),
  CONSTRAINT bn_susp_impact_record_chk CHECK (record_type::text = ANY (ARRAY[
    'PAYMENT_SCHEDULE','PAYMENT_INSTRUCTION','BATCH_ITEM'])),
  CONSTRAINT bn_susp_impact_phase_chk CHECK (phase::text = ANY (ARRAY['SUSPENSION','REINSTATEMENT']))
);

GRANT SELECT ON public.bn_award_suspension_payment_impact TO authenticated;
GRANT ALL ON public.bn_award_suspension_payment_impact TO service_role;

CREATE INDEX IF NOT EXISTS ix_bn_susp_impact_case
  ON public.bn_award_suspension_payment_impact (suspension_id, phase);

-- 3. Reason-code defect fix in the existing propose command --
CREATE OR REPLACE FUNCTION public.bn_award_suspension_propose_v1(
  p_award_id uuid, p_reason_code text, p_effective_from date, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_award public.bn_award%ROWTYPE;
  v_wf_def public.core_workflow_definition%ROWTYPE;
  v_susp_id uuid; v_wf_inst_id uuid; v_task_id uuid; v_result jsonb;
  v_policy record; v_user_code text; v_audit_id uuid;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();

  IF NOT (public.has_permission(v_actor,'bn_award_suspension','propose')
       OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_hash := encode(digest(
    coalesce(p_award_id::text,'')||'|'||coalesce(p_reason_code,'')||'|'||
    coalesce(p_effective_from::text,'')||'|'||coalesce(p_narrative,''), 'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_award_suspension_propose_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_award FROM public.bn_award WHERE id = p_award_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_award.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'E_AWARD_NOT_ELIGIBLE' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_reason_code
                  WHERE reason_code = p_reason_code AND coalesce(is_active,true)) THEN
    RAISE EXCEPTION 'E_INVALID_REASON_CODE' USING ERRCODE='P0001';
  END IF;
  IF p_effective_from IS NULL OR p_effective_from < v_award.start_date THEN
    RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_policy FROM public._bn_susp_resolve_policy_levels() WHERE level=1 LIMIT 1;

  IF EXISTS (SELECT 1 FROM public.bn_award_suspension_event
              WHERE bn_award_id=p_award_id AND case_kind='SUSPENSION'
                AND status IN ('PROPOSED','APPROVED','EXECUTION_FAILED','ACTIVE')) THEN
    RAISE EXCEPTION 'E_CONFLICTING_OPEN_CASE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_wf_def FROM public.core_workflow_definition
   WHERE workflow_code='BN_AWARD_SUSPENSION' AND is_active;

  v_user_code := public._bn_susp_user_code(v_actor);
  PERFORM set_config('bn.susp.trusted','on', true);

  INSERT INTO public.bn_award_suspension_event
    (bn_award_id, suspension_type, suspended_from, reason_code, reason_text,
     status, entered_by, proposed_by_user_id, correlation_id, row_version,
     case_kind, execution_status)
  VALUES
    (p_award_id,'STANDARD', p_effective_from, p_reason_code, p_narrative,
     'PROPOSED', v_user_code, v_actor, p_correlation_id, 1,
     'SUSPENSION','NOT_DUE')
  RETURNING id INTO v_susp_id;

  INSERT INTO public.core_workflow_instance
    (workflow_definition_id, workflow_code, workflow_version, module_code,
     entity_type, entity_id, current_step_code, status,
     submitted_by, submitted_at, priority, metadata)
  VALUES
    (v_wf_def.id,'BN_AWARD_SUSPENSION', v_wf_def.version,'bn_award_suspension',
     'bn_award_suspension_event', v_susp_id::text,
     'PENDING_APPROVAL','PENDING_APPROVAL',
     v_actor, now(),'NORMAL',
     jsonb_build_object('award_id',p_award_id,'suspension_id',v_susp_id,
                        'reason_code',p_reason_code,'policy_id',v_policy.policy_id,
                        'correlation_id',p_correlation_id))
  RETURNING id INTO v_wf_inst_id;

  UPDATE public.bn_award_suspension_event
     SET workflow_instance_id = v_wf_inst_id WHERE id = v_susp_id;

  INSERT INTO public.core_workflow_task
    (workflow_instance_id, task_code, task_name, step_code, step_name,
     assigned_to_role_key, assigned_to_permission_key, task_status, priority, metadata)
  VALUES
    (v_wf_inst_id,'SUSPENSION_APPROVAL_L1','Approve award suspension (level 1)',
     'PENDING_APPROVAL','Awaiting approval',
     v_policy.approval_role,'bn_award_suspension.approve','OPEN','NORMAL',
     jsonb_build_object('policy_id', v_policy.policy_id,'approval_level',1,
       'workbasket_id', v_policy.approval_workbasket_id,
       'required_role', v_policy.approval_role,'correlation_id', p_correlation_id))
  RETURNING id INTO v_task_id;

  INSERT INTO public.core_workflow_action_log
    (workflow_instance_id, workflow_task_id, action_type, action_name,
     from_step_code, to_step_code, actor_user_id, outcome, comments,
     before_status, after_status, metadata)
  VALUES
    (v_wf_inst_id, v_task_id,'SUBMIT','Propose suspension',
     null,'PENDING_APPROVAL', v_actor,'SUCCESS', p_narrative,
     null,'PENDING_APPROVAL',
     jsonb_build_object('suspension_id',v_susp_id,'correlation_id',p_correlation_id,
                        'policy_id',v_policy.policy_id,'approval_level',1));

  PERFORM public._bn_susp_audit(v_actor,'BN.SUSPENSION.PROPOSED','propose',
    v_susp_id::text, null,
    jsonb_build_object('status','PROPOSED','award_id',p_award_id,
                       'suspended_from',p_effective_from,'reason_code',p_reason_code),
    p_correlation_id, p_narrative);

  SELECT id INTO v_audit_id FROM public.core_audit_log
    WHERE entity_id=v_susp_id::text AND event_code='BN.SUSPENSION.PROPOSED'
      AND actor_user_id=v_actor ORDER BY event_time DESC LIMIT 1;
  IF v_audit_id IS NOT NULL THEN
    UPDATE public.core_audit_log
       SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'permission_action','bn_award_suspension.propose',
             'workflow_instance_id', v_wf_inst_id,'workflow_task_id', v_task_id,
             'policy_id', v_policy.policy_id,'approval_level',1,
             'workbasket_id', v_policy.approval_workbasket_id,
             'module','bn_award_suspension'),
           is_system_generated=false
     WHERE id = v_audit_id;
  END IF;

  PERFORM public._bn_susp_comm(p_award_id,'BN.SUSPENSION.PROPOSED',
    jsonb_build_object('suspension_id',v_susp_id,'award_id',p_award_id,
                       'reason_code',p_reason_code), v_user_code, p_correlation_id);

  v_result := jsonb_build_object('suspension_id', v_susp_id,
    'workflow_instance_id', v_wf_inst_id,'task_id', v_task_id,
    'status','PROPOSED','approval_level',1,'row_version',1);

  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_suspension_propose_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $function$;

-- 4. Communication intent helper (reuses bn_communication_log outbox)
CREATE OR REPLACE FUNCTION public._bn_susp_comm(
  p_award_id uuid, p_event_code text, p_context jsonb, p_user_code text, p_correlation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_claim uuid; v_id uuid;
BEGIN
  SELECT bn_claim_id INTO v_claim FROM public.bn_award WHERE id = p_award_id;
  IF v_claim IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.bn_communication_log
    (claim_id, event_code, channel, recipient_type, status, context, created_by)
  VALUES (v_claim, p_event_code, 'LETTER', 'CLAIMANT', 'QUEUED',
          coalesce(p_context,'{}'::jsonb)
            || jsonb_build_object('award_id',p_award_id,'correlation_id',p_correlation,
                                  'module','bn_award_suspension'),
          coalesce(p_user_code,'SCHEDULER'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 5. Payment impact assessment / application
CREATE OR REPLACE FUNCTION public._bn_susp_payment_impact(
  p_susp_id uuid, p_award_id uuid, p_from date, p_apply boolean, p_actor uuid, p_user_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record; v_held int := 0; v_exc int := 0; v_noop int := 0;
  v_exc_id uuid; v_action text; v_reason text; v_items jsonb := '[]'::jsonb;
BEGIN
  -- Payment schedules: future / unpaid rows are held
  FOR r IN
    SELECT id, status, due_date, net_amount, paid_at
      FROM public.bn_payment_schedule
     WHERE bn_award_id = p_award_id AND due_date >= p_from
     ORDER BY due_date
  LOOP
    IF r.paid_at IS NOT NULL OR upper(coalesce(r.status,'')) IN ('PAID','ISSUED') THEN
      v_action := 'EXCEPTION_RAISED'; v_reason := 'SUSPENSION_AFTER_ISSUE';
    ELSIF upper(coalesce(r.status,'')) IN ('CANCELLED','FAILED','RETURNED','HELD') THEN
      v_action := 'NO_ACTION'; v_reason := 'NOT_STOPPABLE_NOT_REQUIRED';
    ELSE
      v_action := 'HELD'; v_reason := 'SUSPENSION_HOLD';
    END IF;

    IF p_apply THEN
      IF v_action = 'HELD' THEN
        UPDATE public.bn_payment_schedule
           SET status='HELD', modified_by=coalesce(p_user_code,'SCHEDULER'), modified_at=now(),
               notes = concat_ws(' | ', notes, 'Held by award suspension '||p_susp_id::text)
         WHERE id = r.id;
      END IF;
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id, bn_award_id, phase, record_type, record_id, impact_action,
         previous_status, new_status, amount, reason, created_by_user_id)
      VALUES (p_susp_id, p_award_id,'SUSPENSION','PAYMENT_SCHEDULE', r.id, v_action,
              r.status, CASE WHEN v_action='HELD' THEN 'HELD' ELSE r.status END,
              r.net_amount, v_reason, p_actor);
    END IF;

    v_items := v_items || jsonb_build_object('record_type','PAYMENT_SCHEDULE','record_id',r.id,
      'action',v_action,'reason',v_reason,'amount',r.net_amount,'due_date',r.due_date);
    IF v_action='HELD' THEN v_held := v_held+1;
    ELSIF v_action='EXCEPTION_RAISED' THEN v_exc := v_exc+1; ELSE v_noop := v_noop+1; END IF;
  END LOOP;

  -- Payment instructions
  FOR r IN
    SELECT pi.id, pi.status, pi.due_date, pi.amount, pi.paid_date, pi.batch_id,
           pi.claim_id, pi.period_start, pi.period_end,
           (SELECT bi.issued_at FROM public.bn_batch_item bi
             WHERE bi.instruction_id = pi.id ORDER BY bi.added_at DESC LIMIT 1) AS issued_at
      FROM public.bn_payment_instruction pi
     WHERE pi.award_id = p_award_id
       AND (pi.due_date >= p_from OR (pi.period_end IS NOT NULL AND pi.period_end >= p_from))
     ORDER BY pi.due_date
  LOOP
    IF r.paid_date IS NOT NULL OR r.issued_at IS NOT NULL
       OR upper(coalesce(r.status,'')) IN ('PAID','ISSUED','RECONCILED') THEN
      v_action := 'EXCEPTION_RAISED'; v_reason := 'SUSPENSION_AFTER_ISSUE';
    ELSIF upper(coalesce(r.status,'')) IN ('CANCELLED','FAILED','RETURNED','HELD') THEN
      v_action := 'NO_ACTION'; v_reason := 'NOT_STOPPABLE_NOT_REQUIRED';
    ELSIF r.batch_id IS NOT NULL THEN
      v_action := 'EXCEPTION_RAISED'; v_reason := 'SUSPENSION_HOLD_REQUIRED_IN_BATCH';
    ELSIF r.period_start IS NOT NULL AND r.period_start < p_from THEN
      v_action := 'EXCEPTION_RAISED'; v_reason := 'SUSPENSION_PRORATION_REQUIRED';
    ELSE
      v_action := 'HELD'; v_reason := 'SUSPENSION_HOLD';
    END IF;

    IF p_apply THEN
      v_exc_id := NULL;
      IF v_action = 'HELD' THEN
        UPDATE public.bn_payment_instruction
           SET status='HELD', hold_reason='AWARD_SUSPENSION:'||p_susp_id::text,
               hold_by=coalesce(p_user_code,'SCHEDULER'), hold_at=now(),
               modified_by=coalesce(p_user_code,'SCHEDULER'), modified_at=now()
         WHERE id = r.id;
      ELSIF v_action = 'EXCEPTION_RAISED' THEN
        INSERT INTO public.bn_payment_exception
          (instruction_id, batch_id, claim_id, exception_type, description, status, raised_by, raised_at)
        VALUES (r.id, r.batch_id, r.claim_id, v_reason,
                'Award suspension '||p_susp_id::text||' requires manual handling of this payment.',
                'OPEN', coalesce(p_user_code,'SCHEDULER'), now())
        RETURNING id INTO v_exc_id;
        UPDATE public.bn_payment_instruction
           SET exception_code = v_reason,
               exception_detail = 'Award suspension '||p_susp_id::text,
               exception_at = now()
         WHERE id = r.id;
      END IF;
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id, bn_award_id, phase, record_type, record_id, impact_action,
         previous_status, new_status, exception_id, amount, reason, created_by_user_id)
      VALUES (p_susp_id, p_award_id,'SUSPENSION','PAYMENT_INSTRUCTION', r.id, v_action,
              r.status, CASE WHEN v_action='HELD' THEN 'HELD' ELSE r.status END,
              v_exc_id, r.amount, v_reason, p_actor);
    END IF;

    v_items := v_items || jsonb_build_object('record_type','PAYMENT_INSTRUCTION','record_id',r.id,
      'action',v_action,'reason',v_reason,'amount',r.amount,'due_date',r.due_date);
    IF v_action='HELD' THEN v_held := v_held+1;
    ELSIF v_action='EXCEPTION_RAISED' THEN v_exc := v_exc+1; ELSE v_noop := v_noop+1; END IF;
  END LOOP;

  RETURN jsonb_build_object('held_count',v_held,'exception_count',v_exc,
    'no_action_count',v_noop,'items',v_items,'effective_from',p_from,'applied',p_apply);
END $$;

-- 6. Safe hold release (reinstatement)
CREATE OR REPLACE FUNCTION public._bn_susp_release_holds(
  p_susp_id uuid, p_award_id uuid, p_actor uuid, p_user_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_rel int := 0; v_ret int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.bn_award_suspension_payment_impact
     WHERE suspension_id = p_susp_id AND phase='SUSPENSION' AND impact_action='HELD'
  LOOP
    IF EXISTS (SELECT 1 FROM public.bn_payment_exception e
                WHERE e.instruction_id = r.record_id AND e.status = 'OPEN') THEN
      INSERT INTO public.bn_award_suspension_payment_impact
        (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
         previous_status,new_status,reason,created_by_user_id)
      VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RETAINED',
              'HELD','HELD','OPEN_EXCEPTION_REQUIRES_MANUAL_RESOLUTION',p_actor);
      v_ret := v_ret + 1;
      CONTINUE;
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
       WHERE id = r.record_id AND status='HELD';
    END IF;

    INSERT INTO public.bn_award_suspension_payment_impact
      (suspension_id,bn_award_id,phase,record_type,record_id,impact_action,
       previous_status,new_status,amount,reason,created_by_user_id)
    VALUES (p_susp_id,p_award_id,'REINSTATEMENT',r.record_type,r.record_id,'RELEASED',
            'HELD', coalesce(r.previous_status,'SCHEDULED'), r.amount,
            'SAFE_RELEASE_ON_REINSTATEMENT', p_actor);
    v_rel := v_rel + 1;
  END LOOP;
  RETURN jsonb_build_object('released_count',v_rel,'retained_count',v_ret);
END $$;

-- 7. Arrears calculation (server-authoritative, repeatable)
CREATE OR REPLACE FUNCTION public._bn_susp_arrears(
  p_award_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_award public.bn_award%ROWTYPE; v_ent public.bn_entitlement%ROWTYPE;
  v_freq text; v_rate numeric; v_units numeric; v_gross numeric;
  v_paid numeric := 0; v_net numeric; v_status text := 'CALCULATED'; v_notes text := NULL;
  v_days integer;
BEGIN
  SELECT * INTO v_award FROM public.bn_award WHERE id = p_award_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_to < p_from THEN RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATE' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_ent FROM public.bn_entitlement
   WHERE claim_id = v_award.bn_claim_id
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
    v_notes := 'Entitlement rate or payment frequency not resolvable — manual review required.';
    v_gross := 0; v_units := coalesce(v_units,0); v_rate := coalesce(v_rate,0);
  ELSE
    v_gross := round(v_rate * v_units, 2);
  END IF;

  SELECT coalesce(sum(net_amount),0) INTO v_paid
    FROM public.bn_payment_schedule
   WHERE bn_award_id = p_award_id AND paid_at IS NOT NULL
     AND due_date >= p_from AND due_date < p_to;

  v_paid := v_paid + coalesce((
    SELECT sum(amount) FROM public.bn_payment_instruction
     WHERE award_id = p_award_id AND paid_date IS NOT NULL
       AND due_date >= p_from AND due_date < p_to), 0);

  v_net := round(greatest(v_gross - v_paid, 0), 2);
  IF v_status = 'CALCULATED' AND v_net = 0 THEN v_status := 'NO_ARREARS'; END IF;

  RETURN jsonb_build_object(
    'status', v_status, 'calc_version','v1',
    'period_from', p_from, 'period_to', p_to, 'period_days', v_days,
    'frequency', nullif(v_freq,''), 'rate', v_rate, 'units', v_units,
    'currency', coalesce(v_award.currency,'XCD'),
    'gross_payable', v_gross, 'already_paid', v_paid, 'deductions', 0,
    'net_arrears', v_net, 'notes', v_notes, 'calculated_at', now());
END $$;

-- 8. Execution core (shared by manual + scheduler paths)
CREATE OR REPLACE FUNCTION public._bn_susp_execute_core(
  p_susp_id uuid, p_actor uuid, p_user_code text, p_narrative text, p_correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_case public.bn_award_suspension_event%ROWTYPE;
  v_award public.bn_award%ROWTYPE; v_impact jsonb; v_result jsonb;
BEGIN
  SELECT * INTO v_case FROM public.bn_award_suspension_event
   WHERE id = p_susp_id AND case_kind='SUSPENSION' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_case.status NOT IN ('APPROVED','EXECUTION_FAILED') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001';
  END IF;
  IF v_case.suspended_from IS NULL OR v_case.suspended_from > current_date THEN
    RAISE EXCEPTION 'E_NOT_DUE' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_reason_code
                  WHERE reason_code = v_case.reason_code AND coalesce(is_active,true)) THEN
    RAISE EXCEPTION 'E_INVALID_REASON_CODE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_award FROM public.bn_award WHERE id = v_case.bn_award_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_award.status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'E_AWARD_ALREADY_SUSPENDED' USING ERRCODE='P0001';
  END IF;
  IF v_award.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'E_AWARD_NOT_ELIGIBLE' USING ERRCODE='P0001';
  END IF;

  PERFORM set_config('bn.susp.trusted','on', true);

  v_impact := public._bn_susp_payment_impact(
    p_susp_id, v_award.id, v_case.suspended_from, true, p_actor, p_user_code);

  UPDATE public.bn_award
     SET status='SUSPENDED', row_version = row_version + 1,
         modified_by = coalesce(p_user_code,'SCHEDULER'), modified_at = now()
   WHERE id = v_award.id;

  INSERT INTO public.bn_award_status_event
    (bn_award_id, from_status, to_status, event_date, reason_code, remarks, entered_by)
  VALUES (v_award.id, v_award.status,'SUSPENDED', v_case.suspended_from,
          v_case.reason_code,
          concat_ws(' | ','Suspension executed', p_narrative, 'case='||p_susp_id::text),
          coalesce(p_user_code,'SCHEDULER'));

  UPDATE public.bn_award_suspension_event
     SET status='ACTIVE', execution_status='EXECUTED', executed_at=now(),
         executed_by_user_id=p_actor, execution_attempts = execution_attempts + 1,
         last_execution_error = NULL, row_version = row_version + 1,
         modified_by = coalesce(p_user_code,'SCHEDULER'), modified_at = now()
   WHERE id = p_susp_id;

  UPDATE public.core_workflow_instance
     SET status='COMPLETED', current_step_code='APPROVED',
         metadata = coalesce(metadata,'{}'::jsonb)
           || jsonb_build_object('execution_status','EXECUTED','executed_at',now())
   WHERE id = v_case.workflow_instance_id;

  PERFORM public._bn_susp_audit(p_actor,'BN.SUSPENSION.EXECUTED','execute',
    p_susp_id::text,
    jsonb_build_object('award_status', v_award.status,'case_status', v_case.status),
    jsonb_build_object('award_status','SUSPENDED','case_status','ACTIVE',
                       'payment_impact', v_impact - 'items'),
    p_correlation, p_narrative);

  PERFORM public._bn_susp_comm(v_award.id,'BN.SUSPENSION.EFFECTIVE',
    jsonb_build_object('suspension_id',p_susp_id,'effective_from',v_case.suspended_from,
                       'payment_impact', v_impact - 'items'), p_user_code, p_correlation);

  IF (v_impact->>'exception_count')::int > 0 THEN
    PERFORM public._bn_susp_comm(v_award.id,'BN.SUSPENSION.PAYMENT_EXCEPTION',
      jsonb_build_object('suspension_id',p_susp_id,
                         'exception_count',(v_impact->>'exception_count')::int),
      p_user_code, p_correlation);
  END IF;

  v_result := jsonb_build_object('suspension_id',p_susp_id,'status','ACTIVE',
    'execution_status','EXECUTED','award_status','SUSPENDED',
    'row_version', v_case.row_version + 1,'payment_impact', v_impact - 'items');
  RETURN v_result;
END $$;

-- 9. Public execution command
CREATE OR REPLACE FUNCTION public.bn_award_suspension_execute_v1(
  p_suspension_id uuid, p_expected_row_version integer, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_case public.bn_award_suspension_event%ROWTYPE;
  v_user_code text; v_result jsonb; v_policy record;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();

  IF NOT public.has_permission(v_actor,'bn_award_suspension','execute') THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_hash := encode(digest(coalesce(p_suspension_id::text,'')||'|'||
    coalesce(p_expected_row_version::text,'')||'|'||coalesce(p_narrative,''),'sha256'),'hex');
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
  v_result := public._bn_susp_execute_core(p_suspension_id, v_actor, v_user_code,
                                           p_narrative, p_correlation_id);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_suspension_execute_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

-- 10. Payment impact preview (read-only)
CREATE OR REPLACE FUNCTION public.bn_award_suspension_preview_payment_impact_v1(
  p_suspension_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_case public.bn_award_suspension_event%ROWTYPE;
BEGIN
  v_actor := public._bn_susp_actor();
  IF NOT (public.has_permission(v_actor,'bn_award_suspension','view_payment_impact')
       OR public.has_permission(v_actor,'bn_award_suspension','view')
       OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_case FROM public.bn_award_suspension_event WHERE id = p_suspension_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  RETURN public._bn_susp_payment_impact(p_suspension_id, v_case.bn_award_id,
           v_case.suspended_from, false, v_actor, NULL);
END $$;

-- 11. Scheduler feed + scheduled execution (service_role only)
CREATE OR REPLACE FUNCTION public.bn_award_suspension_due_for_execution_v1(p_limit integer DEFAULT 50)
RETURNS TABLE(suspension_id uuid, bn_award_id uuid, suspended_from date,
              row_version integer, execution_attempts integer, status text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT e.id, e.bn_award_id, e.suspended_from, e.row_version, e.execution_attempts, e.status::text
    FROM public.bn_award_suspension_event e
    JOIN public.bn_award a ON a.id = e.bn_award_id
   WHERE e.case_kind='SUSPENSION'
     AND e.status IN ('APPROVED','EXECUTION_FAILED')
     AND e.suspended_from <= current_date
     AND a.status = 'ACTIVE'
   ORDER BY e.suspended_from
   LIMIT coalesce(p_limit,50);
$$;

CREATE OR REPLACE FUNCTION public.bn_award_suspension_execute_scheduled_v1(
  p_suspension_id uuid, p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cached jsonb; v_hash text; v_result jsonb; v_err text;
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
    v_err := SQLERRM;
    PERFORM set_config('bn.susp.trusted','on', true);
    UPDATE public.bn_award_suspension_event
       SET status = CASE WHEN status IN ('APPROVED','EXECUTION_FAILED')
                         THEN 'EXECUTION_FAILED' ELSE status END,
           execution_status='FAILED',
           execution_attempts = execution_attempts + 1,
           last_execution_error = v_err, modified_at = now(), modified_by='SCHEDULER'
     WHERE id = p_suspension_id;
    RETURN jsonb_build_object('suspension_id',p_suspension_id,'status','EXECUTION_FAILED',
                              'execution_status','FAILED','error', v_err);
  END;

  PERFORM public._bn_susp_receipt_store(NULL,'bn_award_suspension_execute_scheduled_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

-- 12. Reinstatement lifecycle
CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_propose_v1(
  p_suspension_id uuid, p_reason_code text, p_effective_from date, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_user_code text;
  v_case public.bn_award_suspension_event%ROWTYPE; v_award public.bn_award%ROWTYPE;
  v_wf_def public.core_workflow_definition%ROWTYPE; v_policy record;
  v_rid uuid; v_inst uuid; v_task uuid; v_result jsonb;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();
  IF NOT public.has_permission(v_actor,'bn_award_suspension','resume_propose') THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  IF coalesce(trim(p_narrative),'') = '' THEN
    RAISE EXCEPTION 'E_NARRATIVE_REQUIRED' USING ERRCODE='P0001';
  END IF;

  v_hash := encode(digest(coalesce(p_suspension_id::text,'')||'|'||coalesce(p_reason_code,'')
    ||'|'||coalesce(p_effective_from::text,'')||'|'||coalesce(p_narrative,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_award_reinstatement_propose_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_case FROM public.bn_award_suspension_event
   WHERE id = p_suspension_id AND case_kind='SUSPENSION' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_case.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'E_NO_ACTIVE_SUSPENSION' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_award FROM public.bn_award WHERE id = v_case.bn_award_id FOR UPDATE;
  IF v_award.status <> 'SUSPENDED' THEN
    RAISE EXCEPTION 'E_AWARD_NOT_SUSPENDED' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_award_suspension_event
              WHERE reinstatement_of_id = p_suspension_id
                AND status IN ('REINSTATEMENT_PROPOSED','REINSTATEMENT_APPROVED')) THEN
    RAISE EXCEPTION 'E_CONFLICTING_OPEN_CASE' USING ERRCODE='P0001';
  END IF;
  IF p_effective_from IS NULL OR p_effective_from < v_case.suspended_from THEN
    RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATE' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_reason_code
                  WHERE reason_code = p_reason_code AND coalesce(is_active,true)) THEN
    RAISE EXCEPTION 'E_INVALID_REASON_CODE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_policy FROM public._bn_susp_resolve_policy_levels() WHERE level=1 LIMIT 1;
  SELECT * INTO v_wf_def FROM public.core_workflow_definition
   WHERE workflow_code='BN_AWARD_SUSPENSION' AND is_active;
  v_user_code := public._bn_susp_user_code(v_actor);
  PERFORM set_config('bn.susp.trusted','on', true);

  INSERT INTO public.bn_award_suspension_event
    (bn_award_id, suspension_type, suspended_from, suspended_to, reason_code, reason_text,
     status, entered_by, proposed_by_user_id, correlation_id, row_version,
     case_kind, reinstatement_of_id, execution_status)
  VALUES (v_case.bn_award_id,'REINSTATEMENT', v_case.suspended_from, p_effective_from,
          p_reason_code, p_narrative,'REINSTATEMENT_PROPOSED', v_user_code, v_actor,
          p_correlation_id, 1,'REINSTATEMENT', p_suspension_id,'NOT_APPLICABLE')
  RETURNING id INTO v_rid;

  INSERT INTO public.core_workflow_instance
    (workflow_definition_id, workflow_code, workflow_version, module_code,
     entity_type, entity_id, current_step_code, status, submitted_by, submitted_at,
     priority, metadata)
  VALUES (v_wf_def.id,'BN_AWARD_SUSPENSION', v_wf_def.version,'bn_award_suspension',
          'bn_award_suspension_event', v_rid::text,'PENDING_APPROVAL','PENDING_APPROVAL',
          v_actor, now(),'NORMAL',
          jsonb_build_object('award_id',v_case.bn_award_id,'reinstatement_of',p_suspension_id,
                             'case_kind','REINSTATEMENT','policy_id',v_policy.policy_id,
                             'correlation_id',p_correlation_id))
  RETURNING id INTO v_inst;

  UPDATE public.bn_award_suspension_event SET workflow_instance_id = v_inst WHERE id = v_rid;

  INSERT INTO public.core_workflow_task
    (workflow_instance_id, task_code, task_name, step_code, step_name,
     assigned_to_role_key, assigned_to_permission_key, task_status, priority, metadata)
  VALUES (v_inst,'REINSTATEMENT_APPROVAL_L1','Approve award reinstatement (level 1)',
          'PENDING_APPROVAL','Awaiting approval', v_policy.approval_role,
          'bn_award_suspension.resume_approve','OPEN','NORMAL',
          jsonb_build_object('policy_id',v_policy.policy_id,'approval_level',1,
            'workbasket_id',v_policy.approval_workbasket_id,'correlation_id',p_correlation_id))
  RETURNING id INTO v_task;

  INSERT INTO public.core_workflow_action_log
    (workflow_instance_id, workflow_task_id, action_type, action_name, from_step_code,
     to_step_code, actor_user_id, outcome, comments, before_status, after_status, metadata)
  VALUES (v_inst, v_task,'SUBMIT','Propose reinstatement', null,'PENDING_APPROVAL',
          v_actor,'SUCCESS', p_narrative, null,'PENDING_APPROVAL',
          jsonb_build_object('reinstatement_id',v_rid,'suspension_id',p_suspension_id));

  PERFORM public._bn_susp_audit(v_actor,'BN.REINSTATEMENT.PROPOSED','resume_propose',
    v_rid::text, null,
    jsonb_build_object('status','REINSTATEMENT_PROPOSED','suspension_id',p_suspension_id,
                       'effective_from',p_effective_from), p_correlation_id, p_narrative);

  PERFORM public._bn_susp_comm(v_case.bn_award_id,'BN.REINSTATEMENT.PROPOSED',
    jsonb_build_object('reinstatement_id',v_rid,'suspension_id',p_suspension_id),
    v_user_code, p_correlation_id);

  v_result := jsonb_build_object('reinstatement_id',v_rid,'workflow_instance_id',v_inst,
    'task_id',v_task,'status','REINSTATEMENT_PROPOSED','row_version',1);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_reinstatement_propose_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public._bn_reinst_decide(
  p_reinstatement_id uuid, p_task_id uuid, p_decision text, p_reason_code text,
  p_narrative text, p_expected_row_version integer, p_correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_case public.bn_award_suspension_event%ROWTYPE;
  v_new text; v_user_code text; v_policy record;
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

  UPDATE public.core_workflow_task
     SET task_status='COMPLETED', completed_at=now(), completed_by=v_actor,
         outcome = p_decision
   WHERE workflow_instance_id = v_case.workflow_instance_id AND task_status='OPEN';

  UPDATE public.core_workflow_instance
     SET status = CASE WHEN p_decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
         current_step_code = CASE WHEN p_decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END
   WHERE id = v_case.workflow_instance_id;

  INSERT INTO public.core_workflow_action_log
    (workflow_instance_id, workflow_task_id, action_type, action_name, from_step_code,
     to_step_code, actor_user_id, outcome, comments, before_status, after_status, metadata)
  VALUES (v_case.workflow_instance_id, p_task_id, p_decision,'Reinstatement '||p_decision,
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
                            'row_version', v_case.row_version + 1);
END $$;

CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_approve_v1(
  p_reinstatement_id uuid, p_task_id uuid, p_narrative text,
  p_expected_row_version integer, p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_hash text; v_cached jsonb; v_result jsonb;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();
  v_hash := encode(digest('approve|'||coalesce(p_reinstatement_id::text,'')||'|'||
    coalesce(p_expected_row_version::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_award_reinstatement_approve_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_result := public._bn_reinst_decide(p_reinstatement_id, p_task_id,'APPROVE', NULL,
                p_narrative, p_expected_row_version, p_correlation_id);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_reinstatement_approve_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_reject_v1(
  p_reinstatement_id uuid, p_task_id uuid, p_reason_code text, p_narrative text,
  p_expected_row_version integer, p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_hash text; v_cached jsonb; v_result jsonb;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();
  v_hash := encode(digest('reject|'||coalesce(p_reinstatement_id::text,'')||'|'||
    coalesce(p_reason_code,'')||'|'||coalesce(p_expected_row_version::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_award_reinstatement_reject_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_result := public._bn_reinst_decide(p_reinstatement_id, p_task_id,'REJECT', p_reason_code,
                p_narrative, p_expected_row_version, p_correlation_id);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_reinstatement_reject_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_withdraw_v1(
  p_reinstatement_id uuid, p_narrative text, p_expected_row_version integer,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_case public.bn_award_suspension_event%ROWTYPE;
  v_user_code text; v_result jsonb;
BEGIN
  PERFORM public._bn_susp_assert_module_enabled();
  v_actor := public._bn_susp_actor();
  IF NOT public.has_permission(v_actor,'bn_award_suspension','resume_propose') THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  v_hash := encode(digest('withdraw|'||coalesce(p_reinstatement_id::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_award_reinstatement_withdraw_v1',
                                             p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_case FROM public.bn_award_suspension_event
   WHERE id = p_reinstatement_id AND case_kind='REINSTATEMENT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_case.status <> 'REINSTATEMENT_PROPOSED' THEN
    RAISE EXCEPTION 'E_ONLY_PROPOSED_MAY_WITHDRAW' USING ERRCODE='P0001';
  END IF;
  IF v_case.proposed_by_user_id <> v_actor THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_case.row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;

  v_user_code := public._bn_susp_user_code(v_actor);
  PERFORM set_config('bn.susp.trusted','on', true);
  UPDATE public.bn_award_suspension_event
     SET status='REINSTATEMENT_WITHDRAWN', row_version = row_version + 1,
         modified_by=v_user_code, modified_at=now()
   WHERE id = p_reinstatement_id;
  UPDATE public.core_workflow_task SET task_status='CANCELLED', completed_at=now()
   WHERE workflow_instance_id = v_case.workflow_instance_id AND task_status='OPEN';
  UPDATE public.core_workflow_instance SET status='WITHDRAWN'
   WHERE id = v_case.workflow_instance_id;

  PERFORM public._bn_susp_audit(v_actor,'BN.REINSTATEMENT.WITHDRAWN','resume_propose',
    p_reinstatement_id::text, jsonb_build_object('status','REINSTATEMENT_PROPOSED'),
    jsonb_build_object('status','REINSTATEMENT_WITHDRAWN'), p_correlation_id, p_narrative);

  v_result := jsonb_build_object('reinstatement_id',p_reinstatement_id,
    'status','REINSTATEMENT_WITHDRAWN','row_version', v_case.row_version + 1);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_reinstatement_withdraw_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

-- 13. Arrears preview + reinstatement execution
CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_calculate_arrears_v1(
  p_reinstatement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid; v_case public.bn_award_suspension_event%ROWTYPE;
BEGIN
  v_actor := public._bn_susp_actor();
  IF NOT (public.has_permission(v_actor,'bn_award_suspension','view_payment_impact')
       OR public.has_permission(v_actor,'bn_award_suspension','view')
       OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_case FROM public.bn_award_suspension_event
   WHERE id = p_reinstatement_id AND case_kind='REINSTATEMENT';
  IF NOT FOUND THEN RAISE EXCEPTION 'E_SUSPENSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  RETURN public._bn_susp_arrears(v_case.bn_award_id, v_case.suspended_from, v_case.suspended_to);
END $$;

CREATE OR REPLACE FUNCTION public.bn_award_reinstatement_execute_v1(
  p_reinstatement_id uuid, p_expected_row_version integer, p_narrative text,
  p_idempotency_key text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_user_code text;
  v_case public.bn_award_suspension_event%ROWTYPE;
  v_susp public.bn_award_suspension_event%ROWTYPE;
  v_award public.bn_award%ROWTYPE; v_arrears jsonb; v_release jsonb;
  v_instr uuid; v_result jsonb;
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

  -- arrears payment intent through the existing payment boundary
  IF (v_arrears->>'status') = 'CALCULATED' AND (v_arrears->>'net_arrears')::numeric > 0 THEN
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
       new_status,amount,reason,created_by_user_id)
    VALUES (v_susp.id, v_award.id,'REINSTATEMENT','PAYMENT_INSTRUCTION', v_instr,
            'ARREARS_CREATED','PENDING',(v_arrears->>'net_arrears')::numeric,
            'REINSTATEMENT_ARREARS', v_actor);
  END IF;

  UPDATE public.bn_award_suspension_event
     SET status='RESUMED', executed_at = now(), executed_by_user_id = v_actor,
         execution_status='EXECUTED', execution_attempts = execution_attempts + 1,
         arrears_snapshot = v_arrears, row_version = row_version + 1,
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
                       'arrears', v_arrears,'release', v_release),
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
    'arrears_instruction_id', v_instr,'row_version', v_case.row_version + 1);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_award_reinstatement_execute_v1',
    p_idempotency_key, v_hash, v_result, p_correlation_id);
  RETURN v_result;
END $$;

-- 14. Grants ------------------------------------------------
REVOKE ALL ON FUNCTION public.bn_award_suspension_execute_v1(uuid,integer,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_suspension_preview_payment_impact_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_reinstatement_propose_v1(uuid,text,date,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_reinstatement_approve_v1(uuid,uuid,text,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_reinstatement_reject_v1(uuid,uuid,text,text,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_reinstatement_withdraw_v1(uuid,text,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_reinstatement_calculate_arrears_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_reinstatement_execute_v1(uuid,integer,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_award_suspension_due_for_execution_v1(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_award_suspension_execute_scheduled_v1(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_execute_core(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_payment_impact(uuid,uuid,date,boolean,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_release_holds(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_arrears(uuid,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_susp_comm(uuid,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_reinst_decide(uuid,uuid,text,text,text,integer,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bn_award_suspension_execute_v1(uuid,integer,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_preview_payment_impact_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_propose_v1(uuid,text,date,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_approve_v1(uuid,uuid,text,integer,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_reject_v1(uuid,uuid,text,text,integer,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_withdraw_v1(uuid,text,integer,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_calculate_arrears_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_reinstatement_execute_v1(uuid,integer,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_due_for_execution_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bn_award_suspension_execute_scheduled_v1(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_susp_execute_core(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_susp_payment_impact(uuid,uuid,date,boolean,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_susp_release_holds(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_susp_arrears(uuid,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_susp_comm(uuid,text,jsonb,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_reinst_decide(uuid,uuid,text,text,text,integer,text) TO service_role;

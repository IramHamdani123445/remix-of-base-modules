CREATE OR REPLACE FUNCTION public.ce_reconcile_ledger_payment_to_arrangement(p_ledger_entry_id uuid, p_actor character varying DEFAULT 'SYSTEM'::character varying)
 RETURNS ce_reconcile_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result        ce_reconcile_result;
  v_ledger        RECORD;
  v_arrangement   RECORD;
  v_remaining     NUMERIC;
  v_inst          RECORD;
  v_alloc         NUMERIC;
  v_new_paid      NUMERIC;
  v_inst_touched  INT := 0;
  v_obs_idem_key  VARCHAR;
  v_existing_obs  UUID;
  v_total_paid    NUMERIC;
  v_inst_paid_cnt INT;
  v_next_due      DATE;
  v_old_arr_status VARCHAR;
  v_new_arr_status VARCHAR;
BEGIN
  v_result.was_duplicate := false;
  v_result.arrangement_completed := false;
  v_result.installments_touched := 0;
  v_result.allocated_amount := 0;

  v_obs_idem_key := 'obs-' || p_ledger_entry_id::TEXT || '-ALLOCATED';

  SELECT id INTO v_existing_obs
  FROM ce_payment_observation_log
  WHERE idempotency_key = v_obs_idem_key;

  IF v_existing_obs IS NOT NULL THEN
    v_result.observation_id := v_existing_obs;
    v_result.was_duplicate := true;
    RETURN v_result;
  END IF;

  SELECT * INTO v_ledger
  FROM ce_employer_financial_ledger
  WHERE id = p_ledger_entry_id
    AND status = 'POSTED'
    AND entry_type IN ('PAYMENT_RECEIVED', 'ARRANGEMENT_CREDIT', 'REFUND')
    AND reversal_of_id IS NULL;

  IF v_ledger IS NULL THEN
    RAISE EXCEPTION 'Ledger entry % not found or not a payment-type entry', p_ledger_entry_id;
  END IF;

  IF v_ledger.reference_type = 'PAYMENT_ARRANGEMENT' AND v_ledger.reference_id IS NOT NULL THEN
    SELECT * INTO v_arrangement
    FROM ce_payment_arrangements
    WHERE id = v_ledger.reference_id
      AND status = 'ACTIVE';
  END IF;

  IF v_arrangement IS NULL THEN
    SELECT * INTO v_arrangement
    FROM ce_payment_arrangements
    WHERE employer_id = v_ledger.employer_id
      AND status = 'ACTIVE'
    ORDER BY start_date ASC
    LIMIT 1;
  END IF;

  IF v_arrangement IS NULL THEN
    INSERT INTO ce_payment_observation_log (
      ledger_entry_id, employer_id, observation_type,
      notes, observed_by, idempotency_key
    ) VALUES (
      p_ledger_entry_id, v_ledger.employer_id, 'DETECTED',
      'No active arrangement found for employer; payment not allocated to arrangement',
      p_actor,
      'obs-' || p_ledger_entry_id::TEXT || '-DETECTED'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_result.observation_id;

    IF v_result.observation_id IS NULL THEN
      SELECT id INTO v_result.observation_id
      FROM ce_payment_observation_log
      WHERE idempotency_key = 'obs-' || p_ledger_entry_id::TEXT || '-DETECTED';
    END IF;

    RETURN v_result;
  END IF;

  v_result.arrangement_id := v_arrangement.id;
  v_remaining := v_ledger.credit_amount;
  v_old_arr_status := v_arrangement.status;

  FOR v_inst IN
    SELECT *
    FROM ce_installments
    WHERE arrangement_id = v_arrangement.id
      AND status IN ('PENDING', 'PARTIAL', 'OVERDUE')
    ORDER BY installment_number ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_alloc := LEAST(v_remaining, v_inst.amount - COALESCE(v_inst.paid_amount, 0));

    IF v_alloc <= 0 THEN
      CONTINUE;
    END IF;

    v_new_paid := COALESCE(v_inst.paid_amount, 0) + v_alloc;

    UPDATE ce_installments
    SET paid_amount = v_new_paid,
        paid_date = CASE WHEN v_new_paid >= amount THEN CURRENT_DATE ELSE paid_date END,
        payment_reference = COALESCE(
          payment_reference || '; ' || v_ledger.idempotency_key,
          v_ledger.idempotency_key
        ),
        status = CASE
          WHEN v_new_paid >= amount THEN 'PAID'
          WHEN v_new_paid > 0 THEN 'PARTIAL'
          ELSE status
        END
    WHERE id = v_inst.id;

    -- canonical attribution trail (audit only; creates no ledger entry)
    PERFORM core_record_ledger_allocation(p_ledger_entry_id, v_inst.id, v_alloc, p_actor::text);

    v_remaining := v_remaining - v_alloc;
    v_result.allocated_amount := v_result.allocated_amount + v_alloc;
    v_inst_touched := v_inst_touched + 1;
  END LOOP;

  v_result.installments_touched := v_inst_touched;

  SELECT
    COALESCE(SUM(paid_amount), 0),
    COUNT(*) FILTER (WHERE status = 'PAID')
  INTO v_total_paid, v_inst_paid_cnt
  FROM ce_installments
  WHERE arrangement_id = v_arrangement.id;

  SELECT MIN(due_date) INTO v_next_due
  FROM ce_installments
  WHERE arrangement_id = v_arrangement.id
    AND status IN ('PENDING', 'PARTIAL', 'OVERDUE');

  IF v_inst_paid_cnt >= v_arrangement.number_of_installments THEN
    v_new_arr_status := 'COMPLETED';
    v_result.arrangement_completed := true;
  ELSE
    v_new_arr_status := 'ACTIVE';
  END IF;

  UPDATE ce_payment_arrangements
  SET total_paid = v_total_paid,
      installments_paid = v_inst_paid_cnt,
      next_due_date = v_next_due,
      status = v_new_arr_status,
      updated_by = p_actor,
      updated_at = now()
  WHERE id = v_arrangement.id;

  -- keep the canonical header in step with the legacy operational record
  UPDATE core_payment_arrangement
  SET total_paid = v_total_paid,
      outstanding_balance = GREATEST(COALESCE(total_arranged_amount,0) - v_total_paid, 0),
      status = core_map_ce_arrangement_status(v_new_arr_status),
      updated_at = now()
  WHERE legacy_ce_arrangement_id = v_arrangement.id;

  IF v_result.arrangement_completed AND v_arrangement.case_id IS NOT NULL THEN
    INSERT INTO ce_case_history (
      case_id, action, from_status, to_status,
      notes, performed_by, performed_at
    ) VALUES (
      v_arrangement.case_id,
      'ARRANGEMENT_COMPLETED',
      NULL,
      NULL,
      format('Payment arrangement %s completed. Total paid: %s',
             v_arrangement.arrangement_number, v_total_paid),
      p_actor,
      now()
    );

    UPDATE ce_cases
    SET amount_collected = COALESCE(amount_collected, 0) + v_result.allocated_amount,
        updated_by = p_actor,
        updated_at = now()
    WHERE id = v_arrangement.case_id;
  END IF;

  INSERT INTO ce_audit_log (
    entity_type, entity_id, action,
    description, old_values, new_values,
    performed_by, performed_at
  ) VALUES (
    'PAYMENT_ARRANGEMENT',
    v_arrangement.id,
    'PAYMENT_RECONCILED',
    format('Reconciled ledger entry %s: allocated %s to %s installment(s) on arrangement %s',
           p_ledger_entry_id, v_result.allocated_amount, v_inst_touched, v_arrangement.arrangement_number),
    jsonb_build_object(
      'total_paid', v_arrangement.total_paid,
      'installments_paid', v_arrangement.installments_paid,
      'status', v_old_arr_status
    ),
    jsonb_build_object(
      'total_paid', v_total_paid,
      'installments_paid', v_inst_paid_cnt,
      'status', v_new_arr_status,
      'allocated_amount', v_result.allocated_amount,
      'ledger_entry_id', p_ledger_entry_id
    ),
    p_actor,
    now()
  );

  INSERT INTO ce_payment_observation_log (
    ledger_entry_id, employer_id, observation_type,
    notes, observed_by, idempotency_key
  ) VALUES (
    p_ledger_entry_id,
    v_ledger.employer_id,
    'ALLOCATED',
    format('Allocated %s to arrangement %s (%s installments)',
           v_result.allocated_amount, v_arrangement.arrangement_number, v_inst_touched),
    p_actor,
    v_obs_idem_key
  )
  RETURNING id INTO v_result.observation_id;

  RETURN v_result;
END;
$function$;
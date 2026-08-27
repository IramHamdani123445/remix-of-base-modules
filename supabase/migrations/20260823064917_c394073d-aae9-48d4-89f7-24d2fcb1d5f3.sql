CREATE OR REPLACE FUNCTION public.core_arrangement_add_item(
  p_arrangement_id uuid,
  p_liability_type text,
  p_arranged_amount numeric,
  p_source_module text DEFAULT 'COMPLIANCE',
  p_source_record_type text DEFAULT 'CASE',
  p_source_record_id text DEFAULT NULL,
  p_source_reference_no text DEFAULT NULL,
  p_period_from text DEFAULT NULL,
  p_period_to text DEFAULT NULL,
  p_principal numeric DEFAULT NULL,
  p_penalty numeric DEFAULT NULL,
  p_cost numeric DEFAULT NULL,
  p_actor text DEFAULT 'SYSTEM'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_arr RECORD; v_covered numeric; v_id uuid; v_dupe int;
  v_from date := nullif(trim(coalesce(p_period_from,'')),'')::date;
  v_to   date := nullif(trim(coalesce(p_period_to,'')),'')::date;
BEGIN
  SELECT * INTO v_arr FROM core_payment_arrangement WHERE id = p_arrangement_id FOR UPDATE;
  IF v_arr.id IS NULL THEN RAISE EXCEPTION 'Arrangement % not found', p_arrangement_id; END IF;
  IF v_arr.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Covered liabilities can only be added while the arrangement is DRAFT (current status: %)', v_arr.status;
  END IF;
  IF coalesce(p_arranged_amount,0) <= 0 THEN
    RAISE EXCEPTION 'Covered liability amount must be greater than zero';
  END IF;
  IF p_principal IS NOT NULL OR p_penalty IS NOT NULL OR p_cost IS NOT NULL THEN
    IF coalesce(p_principal,0) + coalesce(p_penalty,0) + coalesce(p_cost,0) <> p_arranged_amount THEN
      RAISE EXCEPTION 'Principal + penalty + cost (%) must equal the covered amount (%)',
        coalesce(p_principal,0) + coalesce(p_penalty,0) + coalesce(p_cost,0), p_arranged_amount;
    END IF;
  END IF;

  SELECT count(*) INTO v_dupe FROM core_payment_arrangement_item
  WHERE arrangement_id = p_arrangement_id
    AND status <> 'CANCELLED'
    AND source_record_id IS NOT DISTINCT FROM p_source_record_id
    AND source_record_type IS NOT DISTINCT FROM p_source_record_type
    AND liability_type IS NOT DISTINCT FROM p_liability_type
    AND period_from IS NOT DISTINCT FROM v_from
    AND period_to IS NOT DISTINCT FROM v_to;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'This liability is already covered by the arrangement';
  END IF;

  SELECT coalesce(sum(arranged_amount),0) INTO v_covered
  FROM core_payment_arrangement_item
  WHERE arrangement_id = p_arrangement_id AND status <> 'CANCELLED';

  IF v_covered + p_arranged_amount > coalesce(v_arr.total_arranged_amount,0) THEN
    RAISE EXCEPTION 'Covered liabilities (%) would exceed the arrangement amount (%)',
      v_covered + p_arranged_amount, v_arr.total_arranged_amount;
  END IF;

  INSERT INTO core_payment_arrangement_item (
    arrangement_id, source_module, source_record_type, source_record_id,
    source_reference_no, liability_type, period_from, period_to,
    principal_amount, penalty_amount, cost_amount,
    arranged_amount, paid_amount, outstanding_amount, status,
    coverage_confidence, created_by
  ) VALUES (
    p_arrangement_id, p_source_module, p_source_record_type, p_source_record_id,
    p_source_reference_no, p_liability_type, v_from, v_to,
    p_principal, p_penalty, p_cost,
    p_arranged_amount, 0, p_arranged_amount, 'OPEN', 'DECLARED', p_actor
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.core_record_ledger_allocation(
  p_ledger_entry_id uuid,
  p_ce_installment_id uuid,
  p_amount numeric,
  p_actor text DEFAULT 'SYSTEM'
)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_inst RECORD; v_core_inst RECORD; v_ledger RECORD;
  v_policy text; v_liab text; v_remaining numeric; v_item RECORD;
  v_take numeric; v_order int := 0; v_key text; v_rows int := 0;
  v_alloc_total numeric;
BEGIN
  IF coalesce(p_amount,0) <= 0 THEN RETURN 0; END IF;

  SELECT * INTO v_ledger FROM ce_employer_financial_ledger WHERE id = p_ledger_entry_id;
  IF v_ledger.id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_core_inst FROM core_payment_schedule_installment
  WHERE legacy_ce_installment_id = p_ce_installment_id;
  IF v_core_inst.id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_inst FROM ce_installments WHERE id = p_ce_installment_id;

  v_policy := coalesce(
    (SELECT setting_value FROM ce_settings WHERE setting_key = 'arrangement.allocation_policy' LIMIT 1),
    'OLDEST_LIABILITY_FIRST');

  v_liab := core_map_ledger_fund_to_liability(v_ledger.fund_type::text);
  v_remaining := p_amount;

  FOR v_item IN
    SELECT * FROM core_payment_arrangement_item
    WHERE arrangement_id = v_core_inst.arrangement_id
      AND status IN ('OPEN','PARTIAL')
      AND coalesce(outstanding_amount,0) > 0
      AND (v_liab IS NULL OR liability_type = v_liab)
    ORDER BY
      CASE WHEN v_policy = 'HIGHEST_OUTSTANDING_FIRST' THEN outstanding_amount END DESC NULLS LAST,
      coalesce(period_from, DATE '9999-12-31'), created_at
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := least(v_remaining, v_item.outstanding_amount);
    v_order := v_order + 1;
    v_key := 'LEDGER:'||p_ledger_entry_id::text||':INST:'||v_core_inst.id::text||':ITEM:'||v_item.id::text;

    INSERT INTO core_payment_allocation (
      arrangement_id, installment_id, receipt_id, payment_date, amount_received,
      allocated_to_item_id, allocation_amount, allocation_order,
      source_module, source_record_id, ledger_entry_id, allocation_key,
      fund_type, allocation_policy, created_by
    ) VALUES (
      v_core_inst.arrangement_id, v_core_inst.id, v_ledger.payment_reference,
      coalesce(v_ledger.effective_date, v_ledger.posted_at::date), p_amount,
      v_item.id, v_take, v_order, 'COMPLIANCE', p_ledger_entry_id::text,
      p_ledger_entry_id, v_key, v_ledger.fund_type::text, v_policy, p_actor
    )
    ON CONFLICT (allocation_key) WHERE allocation_key IS NOT NULL DO NOTHING;

    IF FOUND THEN
      v_rows := v_rows + 1;
      UPDATE core_payment_arrangement_item i
      SET paid_amount = coalesce(sub.paid,0),
          outstanding_amount = greatest(i.arranged_amount - coalesce(sub.paid,0), 0),
          status = CASE WHEN coalesce(sub.paid,0) >= i.arranged_amount THEN 'PAID'
                        WHEN coalesce(sub.paid,0) > 0 THEN 'PARTIAL' ELSE 'OPEN' END,
          updated_at = now()
      FROM (SELECT sum(allocation_amount) paid FROM core_payment_allocation
            WHERE allocated_to_item_id = v_item.id AND is_reversed = false) sub
      WHERE i.id = v_item.id;
    END IF;
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    v_key := 'LEDGER:'||p_ledger_entry_id::text||':INST:'||v_core_inst.id::text||':UNATTRIBUTED';
    INSERT INTO core_payment_allocation (
      arrangement_id, installment_id, receipt_id, payment_date, amount_received,
      allocated_to_item_id, allocation_amount, allocation_order,
      source_module, source_record_id, ledger_entry_id, allocation_key,
      fund_type, allocation_policy, created_by
    ) VALUES (
      v_core_inst.arrangement_id, v_core_inst.id, v_ledger.payment_reference,
      coalesce(v_ledger.effective_date, v_ledger.posted_at::date), p_amount,
      NULL, v_remaining, v_order + 1, 'COMPLIANCE', p_ledger_entry_id::text,
      p_ledger_entry_id, v_key, v_ledger.fund_type::text,
      v_policy||' (no matching covered liability in fund)', p_actor
    )
    ON CONFLICT (allocation_key) WHERE allocation_key IS NOT NULL DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;

  SELECT coalesce(sum(allocation_amount),0) INTO v_alloc_total
  FROM core_payment_allocation
  WHERE installment_id = v_core_inst.id AND is_reversed = false;

  IF v_alloc_total > v_core_inst.due_amount THEN
    RAISE EXCEPTION 'Allocations (%) would exceed installment amount (%) for installment %',
      v_alloc_total, v_core_inst.due_amount, v_core_inst.id;
  END IF;

  UPDATE core_payment_schedule_installment
  SET paid_amount = coalesce(v_inst.paid_amount, v_alloc_total),
      paid_date = v_inst.paid_date,
      status = core_map_ce_installment_status(v_inst.status),
      updated_at = now()
  WHERE id = v_core_inst.id;

  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.core_record_ledger_allocation(uuid, uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.core_record_ledger_allocation(uuid, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_add_item(uuid, text, numeric, text, text, text, text, text, text, numeric, numeric, numeric, text) TO authenticated, service_role;
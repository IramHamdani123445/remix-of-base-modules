-- ── fund mapping (never cross-fund) ────────────────────────
CREATE OR REPLACE FUNCTION public.core_map_ledger_fund_to_liability(p_fund text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $fn$
  SELECT CASE upper(coalesce(p_fund,''))
    WHEN 'SS' THEN 'SS'
    WHEN 'LEVY' THEN 'LV'
    WHEN 'LV' THEN 'LV'
    WHEN 'PE' THEN 'PE'
    ELSE NULL
  END
$fn$;

-- ── coverage validation ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.core_arrangement_validate_coverage(p_arrangement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_arr RECORD; v_covered numeric; v_items int;
BEGIN
  SELECT * INTO v_arr FROM core_payment_arrangement WHERE id = p_arrangement_id;
  IF v_arr.id IS NULL THEN RAISE EXCEPTION 'Arrangement % not found', p_arrangement_id; END IF;

  SELECT coalesce(sum(arranged_amount),0), count(*) INTO v_covered, v_items
  FROM core_payment_arrangement_item
  WHERE arrangement_id = p_arrangement_id AND status <> 'CANCELLED';

  RETURN jsonb_build_object(
    'arrangement_id', p_arrangement_id,
    'total_arranged_amount', v_arr.total_arranged_amount,
    'covered_amount', v_covered,
    'item_count', v_items,
    'difference', coalesce(v_arr.total_arranged_amount,0) - v_covered,
    'balanced', v_items > 0 AND v_covered = coalesce(v_arr.total_arranged_amount,0),
    'coverage_status', v_arr.coverage_status
  );
END;
$fn$;

-- ── add covered liability (DRAFT assembly, item by item) ───
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
    AND coalesce(source_record_id,'') = coalesce(p_source_record_id,'')
    AND coalesce(source_record_type,'') = coalesce(p_source_record_type,'')
    AND coalesce(liability_type,'') = coalesce(p_liability_type,'')
    AND coalesce(period_from,'') = coalesce(p_period_from,'')
    AND coalesce(period_to,'') = coalesce(p_period_to,'');
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
    p_source_reference_no, p_liability_type, p_period_from, p_period_to,
    p_principal, p_penalty, p_cost,
    p_arranged_amount, 0, p_arranged_amount, 'OPEN', 'DECLARED', p_actor
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ── lifecycle transition (server-side financial gate) ──────
CREATE OR REPLACE FUNCTION public.core_arrangement_set_status(
  p_arrangement_id uuid, p_new_status text, p_actor text DEFAULT 'SYSTEM'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_arr RECORD; v_cov jsonb;
BEGIN
  SELECT * INTO v_arr FROM core_payment_arrangement WHERE id = p_arrangement_id FOR UPDATE;
  IF v_arr.id IS NULL THEN RAISE EXCEPTION 'Arrangement % not found', p_arrangement_id; END IF;

  IF upper(p_new_status) IN ('PENDING_APPROVAL','ACTIVE') THEN
    v_cov := core_arrangement_validate_coverage(p_arrangement_id);
    IF (v_cov->>'item_count')::int = 0 THEN
      RAISE EXCEPTION 'Cannot move arrangement to %: no covered liabilities recorded', p_new_status;
    END IF;
    IF NOT (v_cov->>'balanced')::boolean THEN
      RAISE EXCEPTION 'Cannot move arrangement to %: covered liabilities total % but the arrangement amount is % (difference %)',
        p_new_status, v_cov->>'covered_amount', v_cov->>'total_arranged_amount', v_cov->>'difference';
    END IF;
  END IF;

  UPDATE core_payment_arrangement
  SET status = upper(p_new_status),
      approved_by = CASE WHEN upper(p_new_status) = 'ACTIVE' THEN coalesce(approved_by, p_actor) ELSE approved_by END,
      approved_at = CASE WHEN upper(p_new_status) = 'ACTIVE' THEN coalesce(approved_at, now()) ELSE approved_at END,
      updated_at = now()
  WHERE id = p_arrangement_id;

  RETURN jsonb_build_object('arrangement_id', p_arrangement_id, 'status', upper(p_new_status));
END;
$fn$;

-- ── payment attribution (never a financial transaction) ────
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
  IF v_core_inst.id IS NULL THEN RETURN 0; END IF;   -- not yet bridged; nothing to attribute

  SELECT * INTO v_inst FROM ce_installments WHERE id = p_ce_installment_id;

  -- idempotency: one allocation row per (ledger entry, installment, item)
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
      AND (v_liab IS NULL OR liability_type = v_liab)   -- never cross-fund
    ORDER BY
      CASE WHEN v_policy = 'HIGHEST_OUTSTANDING_FIRST' THEN outstanding_amount END DESC NULLS LAST,
      coalesce(period_from, '9999-99'), created_at
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
      v_remaining := v_remaining - v_take;
    ELSE
      v_remaining := v_remaining - v_take;  -- already recorded previously
    END IF;
  END LOOP;

  -- unattributable remainder: record traceability without an item link
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

  -- mirror legacy installment truth onto the canonical schedule
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

-- ── invariant checker (used by regression tests) ───────────
CREATE OR REPLACE FUNCTION public.core_arrangement_verify_invariants(p_arrangement_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT jsonb_build_object(
    'arrangement_id', p_arrangement_id,
    'installment_overallocation', (
      SELECT count(*) FROM core_payment_schedule_installment s
      WHERE s.arrangement_id = p_arrangement_id
        AND (SELECT coalesce(sum(a.allocation_amount),0) FROM core_payment_allocation a
             WHERE a.installment_id = s.id AND a.is_reversed = false) > s.due_amount),
    'item_paid_mismatch', (
      SELECT count(*) FROM core_payment_arrangement_item i
      WHERE i.arrangement_id = p_arrangement_id
        AND coalesce(i.paid_amount,0) <> (
          SELECT coalesce(sum(a.allocation_amount),0) FROM core_payment_allocation a
          WHERE a.allocated_to_item_id = i.id AND a.is_reversed = false)
        AND EXISTS (SELECT 1 FROM core_payment_allocation a2 WHERE a2.allocated_to_item_id = i.id)),
    'item_outstanding_mismatch', (
      SELECT count(*) FROM core_payment_arrangement_item i
      WHERE i.arrangement_id = p_arrangement_id
        AND coalesce(i.outstanding_amount,0) <> greatest(coalesce(i.arranged_amount,0) - coalesce(i.paid_amount,0),0)),
    'cross_fund_allocations', (
      SELECT count(*) FROM core_payment_allocation a
      JOIN core_payment_arrangement_item i ON i.id = a.allocated_to_item_id
      WHERE a.arrangement_id = p_arrangement_id
        AND core_map_ledger_fund_to_liability(a.fund_type) IS NOT NULL
        AND i.liability_type <> core_map_ledger_fund_to_liability(a.fund_type))
  )
$fn$;

-- ── read RPCs ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.core_arrangement_detail(p_arrangement_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT jsonb_build_object(
    'arrangement', to_jsonb(a),
    'coverage', core_arrangement_validate_coverage(a.id),
    'items', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
                       FROM core_payment_arrangement_item i WHERE i.arrangement_id = a.id), '[]'::jsonb),
    'installments', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.installment_no)
                       FROM core_payment_schedule_installment s WHERE s.arrangement_id = a.id), '[]'::jsonb),
    'allocations', coalesce((SELECT jsonb_agg(to_jsonb(al) ORDER BY al.created_at, al.allocation_order)
                       FROM core_payment_allocation al WHERE al.arrangement_id = a.id), '[]'::jsonb),
    'breaches', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.detected_at DESC)
                       FROM ce_arrangement_breaches b WHERE b.arrangement_id = a.legacy_ce_arrangement_id), '[]'::jsonb)
  )
  FROM core_payment_arrangement a
  WHERE a.id = p_arrangement_id
$fn$;

CREATE OR REPLACE FUNCTION public.core_arrangement_detail_by_legacy(p_legacy_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT core_arrangement_detail(a.id) FROM core_payment_arrangement a
  WHERE a.legacy_ce_arrangement_id = p_legacy_id
$fn$;

CREATE OR REPLACE FUNCTION public.core_arrangement_liability_coverage(p_employer_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_total numeric; v_under numeric; v_arrangements jsonb;
BEGIN
  SELECT coalesce(sum(debit_amount) - sum(credit_amount), 0) INTO v_total
  FROM ce_employer_financial_ledger
  WHERE employer_id = p_employer_id AND status = 'POSTED';

  SELECT coalesce(sum(a.outstanding_balance),0) INTO v_under
  FROM core_payment_arrangement a
  WHERE a.debtor_id = p_employer_id AND a.status = 'ACTIVE';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'arrangement_id', a.id,
    'arrangement_no', a.arrangement_no,
    'status', a.status,
    'coverage_status', a.coverage_status,
    'total_arranged_amount', a.total_arranged_amount,
    'total_paid', a.total_paid,
    'outstanding_balance', a.outstanding_balance,
    'legacy_ce_arrangement_id', a.legacy_ce_arrangement_id,
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'liability_type', i.liability_type,
        'source_record_type', i.source_record_type, 'source_reference_no', i.source_reference_no,
        'period_from', i.period_from, 'period_to', i.period_to,
        'arranged_amount', i.arranged_amount, 'paid_amount', i.paid_amount,
        'outstanding_amount', i.outstanding_amount, 'status', i.status,
        'coverage_confidence', i.coverage_confidence)
      ORDER BY i.created_at) FROM core_payment_arrangement_item i WHERE i.arrangement_id = a.id), '[]'::jsonb)
  ) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_arrangements
  FROM core_payment_arrangement a
  WHERE a.debtor_id = p_employer_id;

  RETURN jsonb_build_object(
    'employer_id', p_employer_id,
    'total_outstanding', v_total,
    'outstanding_under_active_arrangement', v_under,
    'outstanding_not_under_arrangement', greatest(v_total - v_under, 0),
    'arrangements', v_arrangements
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.core_record_ledger_allocation(uuid, uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.core_record_ledger_allocation(uuid, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_detail_by_legacy(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_liability_coverage(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_validate_coverage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_verify_invariants(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_add_item(uuid, text, numeric, text, text, text, text, text, text, numeric, numeric, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.core_arrangement_set_status(uuid, text, text) TO authenticated, service_role;
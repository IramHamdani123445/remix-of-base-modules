
ALTER TABLE public.ce_employer_financial_ledger
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS arrangement_id uuid,
  ADD COLUMN IF NOT EXISTS installment_id uuid,
  ADD COLUMN IF NOT EXISTS violation_id uuid,
  ADD COLUMN IF NOT EXISTS case_id uuid,
  ADD COLUMN IF NOT EXISTS payment_reference varchar,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_ce_efl_employer_posted ON public.ce_employer_financial_ledger (employer_id, posted_at, id);
CREATE INDEX IF NOT EXISTS idx_ce_efl_employer_fund_posted ON public.ce_employer_financial_ledger (employer_id, fund_type, posted_at, id);
CREATE INDEX IF NOT EXISTS idx_ce_efl_reversal_of ON public.ce_employer_financial_ledger (reversal_of_id);
CREATE INDEX IF NOT EXISTS idx_ce_efl_arrangement ON public.ce_employer_financial_ledger (arrangement_id);

-- ── Paged, filtered chronological passbook ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ce_employer_ledger_page(
  p_employer_id varchar,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_fund_type text DEFAULT NULL,
  p_entry_type text DEFAULT NULL,
  p_direction text DEFAULT NULL,          -- DEBIT | CREDIT
  p_period text DEFAULT NULL,
  p_reference text DEFAULT NULL,          -- free text over description / references
  p_arrangement_id uuid DEFAULT NULL,
  p_source_system text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  entry_id uuid, posted_at timestamptz, effective_date date, period varchar,
  fund_type text, entry_type text, description text,
  debit_amount numeric, credit_amount numeric,
  running_balance_fund numeric, running_balance_total numeric,
  status text, reference_type varchar, reference_id uuid,
  reversal_of_id uuid, reversal_reason text, reversed_by_entry_id uuid,
  arrangement_id uuid, installment_id uuid, violation_id uuid, case_id uuid,
  payment_reference varchar, source_system varchar, source_pk varchar,
  posted_by varchar, total_count bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT l.*,
           SUM(l.debit_amount - l.credit_amount) OVER (
             PARTITION BY l.fund_type ORDER BY l.posted_at, l.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rb_fund,
           SUM(l.debit_amount - l.credit_amount) OVER (
             ORDER BY l.posted_at, l.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rb_total
    FROM ce_employer_financial_ledger l
    WHERE l.employer_id = p_employer_id
  ), filtered AS (
    SELECT b.* FROM base b
    WHERE (p_from_date IS NULL OR COALESCE(b.effective_date, b.posted_at::date) >= p_from_date)
      AND (p_to_date IS NULL OR COALESCE(b.effective_date, b.posted_at::date) <= p_to_date)
      AND (p_fund_type IS NULL OR b.fund_type::text = p_fund_type)
      AND (p_entry_type IS NULL OR b.entry_type::text = p_entry_type)
      AND (p_direction IS NULL
           OR (p_direction = 'DEBIT' AND b.debit_amount > 0)
           OR (p_direction = 'CREDIT' AND b.credit_amount > 0))
      AND (p_period IS NULL OR b.period = p_period)
      AND (p_arrangement_id IS NULL OR b.arrangement_id = p_arrangement_id)
      AND (p_source_system IS NULL OR b.source_system = p_source_system)
      AND (p_reference IS NULL OR p_reference = ''
           OR b.description ILIKE '%' || p_reference || '%'
           OR COALESCE(b.payment_reference,'') ILIKE '%' || p_reference || '%'
           OR COALESCE(b.source_pk,'') ILIKE '%' || p_reference || '%'
           OR COALESCE(b.reference_id::text,'') ILIKE '%' || p_reference || '%')
  )
  SELECT f.id, f.posted_at, f.effective_date, f.period,
         f.fund_type::text, f.entry_type::text, f.description,
         f.debit_amount, f.credit_amount, f.rb_fund, f.rb_total,
         f.status::text, f.reference_type, f.reference_id,
         f.reversal_of_id, f.reversal_reason,
         (SELECT r.id FROM ce_employer_financial_ledger r WHERE r.reversal_of_id = f.id LIMIT 1),
         f.arrangement_id, f.installment_id, f.violation_id, f.case_id,
         f.payment_reference, f.source_system, f.source_pk, f.posted_by,
         (SELECT COUNT(*) FROM filtered)
  FROM filtered f
  ORDER BY f.posted_at DESC, f.id DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

-- ── Passbook header summary ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ce_employer_ledger_summary(
  p_employer_id varchar,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_fund_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH scoped AS (
    SELECT l.*, COALESCE(l.effective_date, l.posted_at::date) AS eff
    FROM ce_employer_financial_ledger l
    WHERE l.employer_id = p_employer_id
      AND (p_fund_type IS NULL OR l.fund_type::text = p_fund_type)
  ),
  opening AS (
    SELECT COALESCE(SUM(debit_amount - credit_amount), 0) AS amt
    FROM scoped WHERE p_from_date IS NOT NULL AND eff < p_from_date
  ),
  window_rows AS (
    SELECT * FROM scoped
    WHERE (p_from_date IS NULL OR eff >= p_from_date)
      AND (p_to_date IS NULL OR eff <= p_to_date)
  ),
  totals AS (
    SELECT COALESCE(SUM(debit_amount),0) d, COALESCE(SUM(credit_amount),0) c, COUNT(*) n
    FROM window_rows
  ),
  by_fund AS (
    SELECT s.fund_type::text AS fund,
           COALESCE(SUM(s.debit_amount),0) AS debits,
           COALESCE(SUM(s.credit_amount),0) AS credits,
           COALESCE(SUM(s.debit_amount - s.credit_amount),0) AS balance
    FROM scoped s GROUP BY 1
  ),
  arrangements AS (
    SELECT COALESCE(SUM(a.total_debt - COALESCE(a.total_paid,0)),0) AS under_arrangement
    FROM ce_payment_arrangements a
    WHERE a.employer_id = p_employer_id AND a.status IN ('ACTIVE','APPROVED','active','approved')
  ),
  unallocated AS (
    SELECT COALESCE(SUM(l.credit_amount),0) - COALESCE((
      SELECT SUM(pa.allocated_amount) FROM ce_payment_allocations pa
      WHERE pa.employer_id = p_employer_id), 0) AS amt
    FROM ce_employer_financial_ledger l
    WHERE l.employer_id = p_employer_id
      AND l.entry_type::text IN ('PAYMENT_RECEIVED','ARRANGEMENT_CREDIT')
      AND l.status::text = 'POSTED'
  )
  SELECT jsonb_build_object(
    'employer_id', p_employer_id,
    'opening_balance', (SELECT amt FROM opening),
    'total_debits', (SELECT d FROM totals),
    'total_credits', (SELECT c FROM totals),
    'entry_count', (SELECT n FROM totals),
    'closing_balance', (SELECT amt FROM opening) + (SELECT d FROM totals) - (SELECT c FROM totals),
    'current_balance', (SELECT COALESCE(SUM(debit_amount - credit_amount),0) FROM scoped),
    'outstanding_amount', GREATEST((SELECT COALESCE(SUM(debit_amount - credit_amount),0) FROM scoped), 0),
    'available_credit', GREATEST(-(SELECT COALESCE(SUM(debit_amount - credit_amount),0) FROM scoped), 0),
    'unallocated_credit', GREATEST((SELECT amt FROM unallocated), 0),
    'amount_under_arrangement', (SELECT under_arrangement FROM arrangements),
    'by_fund', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'fund', fund, 'debits', debits, 'credits', credits, 'balance', balance) ORDER BY fund)
      FROM by_fund), '[]'::jsonb)
  );
$$;

-- ── Single-entry drill-down ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ce_employer_ledger_entry_detail(p_entry_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'entry', to_jsonb(l),
    'original_entry', (SELECT to_jsonb(o) FROM ce_employer_financial_ledger o WHERE o.id = l.reversal_of_id),
    'reversal_entry', (SELECT to_jsonb(r) FROM ce_employer_financial_ledger r WHERE r.reversal_of_id = l.id LIMIT 1),
    'allocations', COALESCE((
      SELECT jsonb_agg(to_jsonb(pa) ORDER BY pa.allocation_sequence)
      FROM ce_payment_allocations pa
      WHERE pa.ledger_credit_entry_id = l.id OR pa.target_ledger_debit_entry_id = l.id), '[]'::jsonb),
    'arrangement', (SELECT to_jsonb(a) FROM ce_payment_arrangements a WHERE a.id = l.arrangement_id),
    'installment', (SELECT to_jsonb(i) FROM ce_installments i WHERE i.id = l.installment_id),
    'violation', (SELECT to_jsonb(v) FROM ce_violations v WHERE v.id = l.violation_id)
  )
  FROM ce_employer_financial_ledger l
  WHERE l.id = p_entry_id;
$$;

-- ── Reconciliation check ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ce_employer_ledger_reconcile(p_employer_id varchar)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH derived AS (
    SELECT fund_type::text AS fund,
           COALESCE(SUM(debit_amount),0) d,
           COALESCE(SUM(credit_amount),0) c,
           COALESCE(SUM(debit_amount - credit_amount),0) bal
    FROM ce_employer_financial_ledger
    WHERE employer_id = p_employer_id GROUP BY 1
  ),
  stored AS (
    SELECT DISTINCT ON (fund_type) fund_type::text AS fund, running_balance
    FROM ce_employer_financial_ledger
    WHERE employer_id = p_employer_id
    ORDER BY fund_type, posted_at DESC, id DESC
  )
  SELECT jsonb_build_object(
    'employer_id', p_employer_id,
    'funds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'fund', d.fund,
        'total_debits', d.d,
        'total_credits', d.c,
        'derived_balance', d.bal,
        'stored_running_balance', s.running_balance,
        'variance', COALESCE(s.running_balance, 0) - d.bal,
        'reconciled', COALESCE(s.running_balance, 0) = d.bal
      ) ORDER BY d.fund) FROM derived d LEFT JOIN stored s ON s.fund = d.fund), '[]'::jsonb),
    'reconciled', NOT EXISTS (
      SELECT 1 FROM derived d LEFT JOIN stored s ON s.fund = d.fund
      WHERE COALESCE(s.running_balance,0) <> d.bal)
  );
$$;

GRANT EXECUTE ON FUNCTION public.ce_employer_ledger_page(varchar,date,date,text,text,text,text,text,uuid,text,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_employer_ledger_summary(varchar,date,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_employer_ledger_entry_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_employer_ledger_reconcile(varchar) TO authenticated, service_role;

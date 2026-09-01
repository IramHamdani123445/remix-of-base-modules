-- =====================================================================
-- Checkpoint C-L1 — Compliance Ledger Reconciliation & Balance Integrity
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Classify the legacy field explicitly.
-- ---------------------------------------------------------------------
COMMENT ON TABLE public.ce_ledger_periods IS
  'Transaction-derived CACHE of ce_employer_financial_ledger, keyed by (employer_id, period, fund_type). Not authoritative. The authoritative per-period figures are public.ce_v_ledger_period_balances.';

COMMENT ON COLUMN public.ce_ledger_periods.balance IS
  'Transaction-derived cached TOTAL OUTSTANDING for the period/fund (charges - credits, signed). NOT a principal balance. Never use as the base for interest: use ce_v_ledger_period_balances.principal_outstanding.';

COMMENT ON COLUMN public.ce_ledger_periods.principal_due IS
  'Cumulative contribution principal CHARGED for the period/fund (C3 dues + opening balance + transfers in). This is gross charged, not outstanding.';

-- ---------------------------------------------------------------------
-- 2. Configured settlement order (policy driven, no hard-coded waterfall)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_ledger_settlement_order()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH p AS (
    SELECT class_order, interest_settlement
    FROM public.ce_allocation_policies
    WHERE is_active
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  ),
  mapped AS (
    SELECT DISTINCT ON (comp) comp, ord
    FROM p, unnest(p.class_order) WITH ORDINALITY AS u(cls, ord),
    LATERAL (SELECT CASE u.cls WHEN 'contribution' THEN 'principal' ELSE 'penalty' END AS comp) m
    ORDER BY comp, ord
  )
  SELECT COALESCE(
    (SELECT array_agg(comp ORDER BY ord) FROM mapped) || ARRAY['interest'],
    ARRAY['principal','penalty','interest']
  );
$$;

COMMENT ON FUNCTION public.ce_ledger_settlement_order() IS
  'Component settlement order used to derive how credits are split across principal / penalty / interest. Sourced from the active ce_allocation_policies row (fines fold into penalty; interest settles last while interest_settlement = separate).';

-- ---------------------------------------------------------------------
-- 3. Canonical, transaction-derived per-period balances
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ce_v_ledger_period_balances AS
WITH base AS (
  SELECT
    l.employer_id,
    l.period,
    l.fund_type,
    -- charges
    SUM(CASE WHEN l.entry_type IN ('C3_DUES_POSTED','OPENING_BALANCE','TRANSFER_IN')
             THEN l.debit_amount ELSE 0 END)
      + SUM(CASE WHEN l.entry_type = 'ADJUSTMENT'
                 THEN l.debit_amount - l.credit_amount ELSE 0 END) AS principal_charged,
    SUM(CASE WHEN l.entry_type = 'PENALTY_ASSESSED' THEN l.debit_amount ELSE 0 END) AS penalty_charged,
    SUM(CASE WHEN l.entry_type = 'INTEREST_ACCRUED' THEN l.debit_amount ELSE 0 END) AS interest_accrued,
    -- credits
    SUM(CASE WHEN l.entry_type IN ('PAYMENT_RECEIVED','ARRANGEMENT_CREDIT')
             THEN l.credit_amount ELSE 0 END) AS payments_received,
    SUM(CASE WHEN l.entry_type = 'WAIVER_APPLIED' THEN l.credit_amount ELSE 0 END) AS waivers_applied,
    SUM(CASE WHEN l.entry_type = 'WRITE_OFF' THEN l.credit_amount ELSE 0 END) AS write_offs,
    SUM(CASE WHEN l.entry_type = 'REFUND' THEN l.credit_amount ELSE 0 END) AS refunds,
    COUNT(*) AS posted_entry_count
  FROM public.ce_employer_financial_ledger l
  WHERE l.status = 'POSTED'
    -- a REVERSAL mirrors an entry that is itself excluded (status REVERSED);
    -- counting the mirror as well would double-subtract.
    AND l.entry_type <> 'REVERSAL'
  GROUP BY l.employer_id, l.period, l.fund_type
),
totals AS (
  SELECT b.*,
         GREATEST(b.principal_charged, 0) + b.penalty_charged + b.interest_accrued AS total_charged,
         b.payments_received + b.waivers_applied + b.write_offs + b.refunds        AS total_credits
  FROM base b
),
expanded AS (
  SELECT t.*, u.comp, u.idx,
         CASE u.comp
           WHEN 'principal' THEN GREATEST(t.principal_charged, 0)
           WHEN 'penalty'   THEN t.penalty_charged
           ELSE t.interest_accrued
         END AS comp_charged
  FROM totals t,
       unnest(public.ce_ledger_settlement_order()) WITH ORDINALITY AS u(comp, idx)
),
allocated AS (
  SELECT e.*,
         GREATEST(
           LEAST(
             e.comp_charged,
             e.total_credits - COALESCE(
               SUM(e.comp_charged) OVER (
                 PARTITION BY e.employer_id, e.period, e.fund_type
                 ORDER BY e.idx
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)
           ), 0) AS comp_settled
  FROM expanded e
)
SELECT
  a.employer_id,
  a.period,
  a.fund_type,
  ROUND(GREATEST(a.principal_charged, 0), 2)                                   AS principal_due,
  ROUND(SUM(a.comp_settled) FILTER (WHERE a.comp = 'principal'), 2)            AS principal_paid,
  ROUND(GREATEST(a.principal_charged, 0)
        - SUM(a.comp_settled) FILTER (WHERE a.comp = 'principal'), 2)          AS principal_outstanding,
  ROUND(a.penalty_charged, 2)                                                  AS penalty_charged,
  ROUND(SUM(a.comp_settled) FILTER (WHERE a.comp = 'penalty'), 2)              AS penalty_paid,
  ROUND(a.penalty_charged
        - SUM(a.comp_settled) FILTER (WHERE a.comp = 'penalty'), 2)            AS penalty_outstanding,
  ROUND(a.interest_accrued, 2)                                                 AS interest_accrued,
  ROUND(SUM(a.comp_settled) FILTER (WHERE a.comp = 'interest'), 2)             AS interest_paid,
  ROUND(a.interest_accrued
        - SUM(a.comp_settled) FILTER (WHERE a.comp = 'interest'), 2)           AS interest_outstanding,
  ROUND(a.payments_received, 2)                                                AS payments_received,
  ROUND(a.waivers_applied, 2)                                                  AS waivers_applied,
  ROUND(a.write_offs, 2)                                                       AS write_offs,
  ROUND(GREATEST(a.total_credits - a.total_charged, 0), 2)                     AS credit_available,
  ROUND(a.total_charged - SUM(a.comp_settled), 2)                              AS total_outstanding,
  ROUND(a.total_charged - a.total_credits, 2)                                  AS net_balance_signed,
  a.posted_entry_count
FROM allocated a
GROUP BY a.employer_id, a.period, a.fund_type, a.principal_charged, a.penalty_charged,
         a.interest_accrued, a.payments_received, a.waivers_applied, a.write_offs,
         a.refunds, a.total_charged, a.total_credits, a.posted_entry_count;

COMMENT ON VIEW public.ce_v_ledger_period_balances IS
  'AUTHORITATIVE per-period, per-fund compliance balances derived from the immutable ce_employer_financial_ledger transactions. principal_outstanding is the only valid base for CR-002 interest. total_outstanding is the collectible arrears figure for enforcement/legal escalation.';

GRANT SELECT ON public.ce_v_ledger_period_balances TO authenticated;
GRANT SELECT ON public.ce_v_ledger_period_balances TO service_role;

-- ---------------------------------------------------------------------
-- 4. Employer-level rollup (arrears figure for enforcement / legal)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ce_v_employer_outstanding AS
SELECT
  employer_id,
  fund_type,
  SUM(principal_due)          AS principal_due,
  SUM(principal_paid)         AS principal_paid,
  SUM(principal_outstanding)  AS principal_outstanding,
  SUM(penalty_charged)        AS penalty_charged,
  SUM(penalty_outstanding)    AS penalty_outstanding,
  SUM(interest_accrued)       AS interest_accrued,
  SUM(interest_outstanding)   AS interest_outstanding,
  SUM(credit_available)       AS credit_available,
  SUM(total_outstanding)      AS total_outstanding,
  COUNT(*) FILTER (WHERE principal_outstanding > 0) AS periods_in_arrears,
  MIN(period) FILTER (WHERE principal_outstanding > 0) AS oldest_arrears_period
FROM public.ce_v_ledger_period_balances
GROUP BY employer_id, fund_type;

COMMENT ON VIEW public.ce_v_employer_outstanding IS
  'Employer/fund arrears rollup. periods_in_arrears is the count used by arrears-threshold (e.g. 9x) enforcement rules; total_outstanding is the collectible balance.';

GRANT SELECT ON public.ce_v_employer_outstanding TO authenticated;
GRANT SELECT ON public.ce_v_employer_outstanding TO service_role;

-- ---------------------------------------------------------------------
-- 5. Non-destructive posting: balance must be additive
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_post_ledger_entry(
  p_employer_id character varying,
  p_employer_name character varying DEFAULT NULL::character varying,
  p_territory character varying DEFAULT NULL::character varying,
  p_entry_type ce_ledger_entry_type DEFAULT 'C3_DUES_POSTED'::ce_ledger_entry_type,
  p_fund_type ce_fund_type DEFAULT 'SS'::ce_fund_type,
  p_period character varying DEFAULT NULL::character varying,
  p_amount numeric DEFAULT 0,
  p_description text DEFAULT ''::text,
  p_reference_type character varying DEFAULT NULL::character varying,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_idempotency_key character varying DEFAULT NULL::character varying,
  p_posted_by character varying DEFAULT 'SYSTEM'::character varying
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
  v_debit NUMERIC := 0;
  v_credit NUMERIC := 0;
  v_running_balance NUMERIC := 0;
  v_idem_key VARCHAR;
  v_period VARCHAR;
BEGIN
  v_idem_key := COALESCE(p_idempotency_key, gen_random_uuid()::VARCHAR);
  v_period := COALESCE(p_period, to_char(now(), 'YYYY-MM'));

  SELECT id INTO v_existing_id
  FROM ce_employer_financial_ledger
  WHERE idempotency_key = v_idem_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  IF p_entry_type IN ('C3_DUES_POSTED','PENALTY_ASSESSED','INTEREST_ACCRUED','OPENING_BALANCE','TRANSFER_IN') THEN
    v_debit := ABS(p_amount); v_credit := 0;
  ELSIF p_entry_type IN ('PAYMENT_RECEIVED','WAIVER_APPLIED','WRITE_OFF','ARRANGEMENT_CREDIT','REFUND') THEN
    v_debit := 0; v_credit := ABS(p_amount);
  ELSIF p_entry_type = 'ADJUSTMENT' THEN
    IF p_amount >= 0 THEN v_debit := ABS(p_amount); ELSE v_credit := ABS(p_amount); END IF;
  ELSIF p_entry_type = 'REVERSAL' THEN
    IF p_amount >= 0 THEN v_credit := ABS(p_amount); ELSE v_debit := ABS(p_amount); END IF;
  END IF;

  SELECT COALESCE(SUM(debit_amount) - SUM(credit_amount), 0) INTO v_running_balance
  FROM ce_employer_financial_ledger
  WHERE employer_id = p_employer_id
    AND fund_type = p_fund_type
    AND status = 'POSTED';

  v_running_balance := v_running_balance + v_debit - v_credit;

  INSERT INTO ce_employer_financial_ledger (
    employer_id, employer_name, territory, entry_type, fund_type, period,
    debit_amount, credit_amount, running_balance, status,
    idempotency_key, reference_type, reference_id, description, posted_by
  ) VALUES (
    p_employer_id, p_employer_name, p_territory, p_entry_type, p_fund_type, v_period,
    v_debit, v_credit, v_running_balance, 'POSTED',
    v_idem_key, p_reference_type, p_reference_id, p_description, p_posted_by
  )
  RETURNING id INTO v_new_id;

  INSERT INTO ce_ledger_periods (employer_id, period, fund_type)
  VALUES (p_employer_id, v_period, p_fund_type)
  ON CONFLICT (employer_id, period, fund_type) DO NOTHING;

  -- Additive component update. Each posting only ever ADDS to its own bucket;
  -- no posting may overwrite or erase another component (notably principal_due).
  UPDATE ce_ledger_periods
  SET
    principal_due = principal_due + CASE WHEN p_entry_type IN ('C3_DUES_POSTED','OPENING_BALANCE','TRANSFER_IN') THEN v_debit ELSE 0 END,
    penalties     = penalties     + CASE WHEN p_entry_type = 'PENALTY_ASSESSED' THEN v_debit ELSE 0 END,
    interest      = interest      + CASE WHEN p_entry_type = 'INTEREST_ACCRUED' THEN v_debit ELSE 0 END,
    payments      = payments      + CASE WHEN p_entry_type IN ('PAYMENT_RECEIVED','ARRANGEMENT_CREDIT') THEN v_credit ELSE 0 END,
    waivers       = waivers       + CASE WHEN p_entry_type = 'WAIVER_APPLIED' THEN v_credit ELSE 0 END,
    adjustments   = adjustments   + CASE WHEN p_entry_type = 'ADJUSTMENT' THEN (v_debit - v_credit) ELSE 0 END,
    write_offs    = write_offs    + CASE WHEN p_entry_type = 'WRITE_OFF' THEN v_credit ELSE 0 END,
    entry_count   = entry_count + 1,
    last_recalculated_at = now(),
    last_recalculated_by = p_posted_by
  WHERE employer_id = p_employer_id AND period = v_period AND fund_type = p_fund_type;

  -- Cached total is recomputed from the (already updated) components, never
  -- from the delta of the entry just posted.
  UPDATE ce_ledger_periods
  SET balance = principal_due + penalties + interest - payments - waivers + adjustments - write_offs
  WHERE employer_id = p_employer_id AND period = v_period AND fund_type = p_fund_type;

  RETURN v_new_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 6. Forward-only, auditable reconciliation
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ce_ledger_balance_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  employer_id character varying(20) NOT NULL,
  period character varying(7) NOT NULL,
  fund_type ce_fund_type NOT NULL,
  balance_before numeric(15,2) NOT NULL,
  balance_after numeric(15,2) NOT NULL,
  components_before jsonb NOT NULL,
  components_after jsonb NOT NULL,
  cause text NOT NULL,
  reconciled_by character varying(100) NOT NULL DEFAULT 'SYSTEM',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ce_ledger_balance_reconciliation_log TO authenticated;
GRANT ALL ON public.ce_ledger_balance_reconciliation_log TO service_role;

ALTER TABLE public.ce_ledger_balance_reconciliation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Compliance staff can read ledger reconciliation log"
  ON public.ce_ledger_balance_reconciliation_log
  FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE public.ce_ledger_balance_reconciliation_log IS
  'Append-only audit of every ce_ledger_periods balance correction. Historical rows are never silently rewritten — each change records before/after components and the cause.';

CREATE OR REPLACE FUNCTION public.ce_recalculate_ledger_period_balances(
  p_employer_id character varying DEFAULT NULL,
  p_cause text DEFAULT 'CHECKPOINT-C-L1 balance derivation repair',
  p_dry_run boolean DEFAULT true,
  p_actor character varying DEFAULT 'SYSTEM'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_examined int := 0;
  v_drift int := 0;
  v_corrected int := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  CREATE TEMP TABLE _ce_recalc ON COMMIT DROP AS
  SELECT lp.employer_id, lp.period, lp.fund_type,
         lp.principal_due, lp.penalties, lp.interest, lp.payments,
         lp.waivers, lp.adjustments, lp.write_offs, lp.balance,
         (lp.principal_due + lp.penalties + lp.interest - lp.payments
          - lp.waivers + lp.adjustments - lp.write_offs) AS derived_balance,
         v.total_outstanding, v.principal_outstanding
  FROM ce_ledger_periods lp
  LEFT JOIN ce_v_ledger_period_balances v
    ON v.employer_id = lp.employer_id AND v.period = lp.period AND v.fund_type = lp.fund_type
  WHERE p_employer_id IS NULL OR lp.employer_id = p_employer_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE balance <> derived_balance)
    INTO v_examined, v_drift FROM _ce_recalc;

  IF NOT p_dry_run THEN
    INSERT INTO ce_ledger_balance_reconciliation_log (
      run_id, employer_id, period, fund_type, balance_before, balance_after,
      components_before, components_after, cause, reconciled_by)
    SELECT v_run_id, r.employer_id, r.period, r.fund_type, r.balance, r.derived_balance,
           jsonb_build_object('principal_due', r.principal_due, 'penalties', r.penalties,
                              'interest', r.interest, 'payments', r.payments,
                              'waivers', r.waivers, 'adjustments', r.adjustments,
                              'write_offs', r.write_offs, 'balance', r.balance),
           jsonb_build_object('balance', r.derived_balance,
                              'principal_outstanding', r.principal_outstanding,
                              'total_outstanding', r.total_outstanding),
           p_cause, p_actor
    FROM _ce_recalc r
    WHERE r.balance <> r.derived_balance;

    UPDATE ce_ledger_periods lp
    SET balance = r.derived_balance,
        last_recalculated_at = now(),
        last_recalculated_by = p_actor
    FROM _ce_recalc r
    WHERE lp.employer_id = r.employer_id AND lp.period = r.period
      AND lp.fund_type = r.fund_type AND lp.balance <> r.derived_balance;

    GET DIAGNOSTICS v_corrected = ROW_COUNT;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'employer_id', employer_id, 'period', period, 'fund', fund_type,
           'stored_balance', balance, 'derived_balance', derived_balance,
           'difference', derived_balance - balance,
           'principal_outstanding', principal_outstanding,
           'total_outstanding', total_outstanding)), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT * FROM _ce_recalc WHERE balance <> derived_balance ORDER BY employer_id, period LIMIT 50) s;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'dry_run', p_dry_run, 'examined', v_examined,
    'drifted', v_drift, 'corrected', v_corrected, 'sample', v_rows);
END;
$function$;

COMMENT ON FUNCTION public.ce_recalculate_ledger_period_balances(character varying, text, boolean, character varying) IS
  'Forward-only reconciliation of the ce_ledger_periods balance cache against its own components and the authoritative transaction-derived view. Dry-run by default; every correction is written to ce_ledger_balance_reconciliation_log.';
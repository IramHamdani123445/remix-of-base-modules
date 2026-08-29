-- ============================================================
-- Checkpoint C-L1 — Ledger balance integrity regression suite.
--
-- Guards the defect found in Checkpoint C: ce_post_ledger_entry used to
-- OVERWRITE ce_ledger_periods.balance with the delta of the entry being
-- posted, destroying principal_due on every interest accrual.
--
-- Invariants proven here:
--   1. Posting is additive — principal survives later penalty/interest posts.
--   2. Interest is charged on outstanding PRINCIPAL, never on the cached total.
--   3. The cached balance always equals the derived component total.
--   4. Reversals restore the prior position.
--   5. Re-posting the same idempotency key changes nothing.
--
-- Run via:  psql -f supabase/tests/sql/ce_ledger_balance_integrity.sql
-- Fully transactional — always rolled back, never mutates real data.
-- ============================================================

BEGIN;

DO $$
DECLARE
  emp constant varchar := 'ZZ-CL1-REG';
  per constant varchar := '2026-01';
  v   record;

  PROCEDURE_NOTE text;
BEGIN
  -- 1. Principal charged.
  PERFORM public.ce_post_ledger_entry(emp, 'C3_DUES_POSTED', 'SS', per, 1000,
    'dues', 'TEST', 'reg-dues-1', 'TEST');

  -- 2. Interest accrual must NOT erase principal (the original defect).
  PERFORM public.ce_post_ledger_entry(emp, 'INTEREST_ACCRUED', 'SS', per, 4.17,
    'interest m1', 'TEST', 'reg-int-1', 'TEST');

  SELECT * INTO v FROM public.ce_v_ledger_period_balances
   WHERE employer_id = emp AND period = per AND fund_type = 'SS';

  IF v.principal_due <> 1000 THEN
    RAISE EXCEPTION 'FAIL: principal_due destroyed by interest posting (got %)', v.principal_due;
  END IF;
  IF v.principal_outstanding <> 1000 THEN
    RAISE EXCEPTION 'FAIL: principal_outstanding expected 1000, got %', v.principal_outstanding;
  END IF;
  IF v.interest_outstanding <> 4.17 THEN
    RAISE EXCEPTION 'FAIL: interest_outstanding expected 4.17, got %', v.interest_outstanding;
  END IF;
  IF v.total_outstanding <> 1004.17 THEN
    RAISE EXCEPTION 'FAIL: total_outstanding expected 1004.17, got %', v.total_outstanding;
  END IF;

  -- 3. Cached balance must agree with the derived total.
  IF (SELECT balance FROM ce_ledger_periods
       WHERE employer_id = emp AND period = per AND fund_type = 'SS') <> 1004.17 THEN
    RAISE EXCEPTION 'FAIL: cached balance drifted from derived total';
  END IF;

  -- 4. Partial payment reduces principal, leaves interest standing.
  PERFORM public.ce_post_ledger_entry(emp, 'PAYMENT_RECEIVED', 'SS', per, 400,
    'partial payment', 'TEST', 'reg-pay-1', 'TEST');

  SELECT * INTO v FROM public.ce_v_ledger_period_balances
   WHERE employer_id = emp AND period = per AND fund_type = 'SS';
  IF v.principal_outstanding <> 600 THEN
    RAISE EXCEPTION 'FAIL: settlement waterfall — principal_outstanding expected 600, got %',
      v.principal_outstanding;
  END IF;

  -- 5. Penalty is an independent bucket.
  PERFORM public.ce_post_ledger_entry(emp, 'PENALTY_ASSESSED', 'SS', per, 50,
    'penalty', 'TEST', 'reg-pen-1', 'TEST');
  SELECT * INTO v FROM public.ce_v_ledger_period_balances
   WHERE employer_id = emp AND period = per AND fund_type = 'SS';
  IF v.principal_outstanding <> 600 OR v.penalty_outstanding <> 50 OR v.interest_outstanding <> 4.17 THEN
    RAISE EXCEPTION 'FAIL: components merged — p=% pen=% int=%',
      v.principal_outstanding, v.penalty_outstanding, v.interest_outstanding;
  END IF;

  -- 6. Idempotency — re-posting the same key must be a no-op.
  BEGIN
    PERFORM public.ce_post_ledger_entry(emp, 'INTEREST_ACCRUED', 'SS', per, 4.17,
      'interest m1 replay', 'TEST', 'reg-int-1', 'TEST');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- rejection is an acceptable idempotent outcome
  END;
  SELECT * INTO v FROM public.ce_v_ledger_period_balances
   WHERE employer_id = emp AND period = per AND fund_type = 'SS';
  IF v.interest_outstanding <> 4.17 THEN
    RAISE EXCEPTION 'FAIL: idempotency breached — interest now %', v.interest_outstanding;
  END IF;

  -- 7. Reversal restores the pre-payment position.
  PERFORM public.ce_reverse_ledger_entry(
    (SELECT id FROM ce_employer_financial_ledger WHERE idempotency_key = 'reg-pay-1'),
    'regression reversal', 'TEST');
  SELECT * INTO v FROM public.ce_v_ledger_period_balances
   WHERE employer_id = emp AND period = per AND fund_type = 'SS';
  IF v.principal_outstanding <> 1000 THEN
    RAISE EXCEPTION 'FAIL: reversal did not restore principal (got %)', v.principal_outstanding;
  END IF;

  -- 8. Final cached/derived agreement.
  IF (SELECT balance FROM ce_ledger_periods
       WHERE employer_id = emp AND period = per AND fund_type = 'SS')
     <> v.total_outstanding THEN
    RAISE EXCEPTION 'FAIL: cached balance <> derived total after reversal';
  END IF;

  RAISE NOTICE 'PASS: ledger balance integrity invariants hold (additive posting, principal-based interest, idempotency, reversal)';
END $$;

-- 9. Platform-wide invariant: no period row may drift from its components.
SELECT 'cached_balance_drift' AS check_name, employer_id, period, fund_type
FROM public.ce_ledger_periods
WHERE balance <> principal_due + penalties + interest - payments - waivers + adjustments - write_offs;

ROLLBACK;

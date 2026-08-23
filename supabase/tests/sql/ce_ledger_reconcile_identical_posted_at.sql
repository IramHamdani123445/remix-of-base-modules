-- ============================================================
-- Regression test: ce_employer_ledger_reconcile must resolve the TRUE
-- terminal balance of a fund chain even when several entries share the
-- exact same posted_at timestamp (bulk/batch posting).
--
-- Guard: reconciliation must NOT fall back to "last row by posted_at, id",
-- it must follow the predecessor/snapshot chain
-- (running_balance - (debit - credit) = predecessor.running_balance).
--
-- Run via:  psql -f supabase/tests/sql/ce_ledger_reconcile_identical_posted_at.sql
-- Fully transactional — always rolled back, never mutates real data.
-- ============================================================

BEGIN;

-- Deterministic ids chosen so that "ORDER BY posted_at DESC, id DESC"
-- would pick the FIRST (wrong) entry of the chain, not the terminal one.
INSERT INTO public.ce_employer_financial_ledger
  (id, employer_id, entry_type, fund_type, period,
   debit_amount, credit_amount, running_balance,
   idempotency_key, reference_type, description, posted_by, posted_at)
VALUES
  ('ffffffff-0000-0000-0000-000000000003', 'ZZ-TIE-TEST', 'C3_DUES_POSTED', 'SS', '2026-01',
   1000, 0, 1000, 'zz-tie-1', 'TEST', 'tie entry 1', 'TEST', '2026-01-15T10:00:00Z'),
  ('ffffffff-0000-0000-0000-000000000002', 'ZZ-TIE-TEST', 'C3_DUES_POSTED', 'SS', '2026-01',
   500, 0, 1500, 'zz-tie-2', 'TEST', 'tie entry 2', 'TEST', '2026-01-15T10:00:00Z'),
  ('ffffffff-0000-0000-0000-000000000001', 'ZZ-TIE-TEST', 'PAYMENT_RECEIVED', 'SS', '2026-01',
   0, 200, 1300, 'zz-tie-3', 'TEST', 'tie entry 3 (terminal)', 'TEST', '2026-01-15T10:00:00Z');

DO $$
DECLARE
  r jsonb;
  fund jsonb;
BEGIN
  r := public.ce_employer_ledger_reconcile('ZZ-TIE-TEST');
  SELECT f INTO fund
  FROM jsonb_array_elements(r->'funds') f
  WHERE f->>'fund' = 'SS';

  IF fund IS NULL THEN
    RAISE EXCEPTION 'FAIL: no SS fund row returned by reconcile';
  END IF;

  IF (fund->>'derived_balance')::numeric <> 1300 THEN
    RAISE EXCEPTION 'FAIL: derived_balance expected 1300, got %', fund->>'derived_balance';
  END IF;

  -- The core regression assertion: terminal snapshot must be 1300 (entry 3),
  -- not 1000 (entry 1, which wins a naive posted_at/id ordering).
  IF (fund->>'stored_running_balance')::numeric <> 1300 THEN
    RAISE EXCEPTION 'FAIL: terminal running_balance expected 1300, got % (chain walk broken on identical posted_at)',
      fund->>'stored_running_balance';
  END IF;

  IF (fund->>'variance')::numeric <> 0 OR (fund->>'reconciled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: expected zero variance / reconciled=true, got variance=% reconciled=%',
      fund->>'variance', fund->>'reconciled';
  END IF;

  IF (r->>'reconciled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: employer-level reconciled expected true';
  END IF;

  RAISE NOTICE 'PASS: ce_employer_ledger_reconcile identical posted_at chain resolves terminal balance 1300';
END $$;

ROLLBACK;

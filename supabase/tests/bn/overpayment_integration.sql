-- =====================================================================
-- BN Overpayments — seeded lifecycle integration harness (Phases B12/B13)
--
-- Runs inside a single transaction and ALWAYS rolls back. Emits exactly one
--   BN_OP_HARNESS_RESULT: PASS
-- marker on success; raises otherwise. No SKIP paths.
--
-- Journeys
--   A  candidate -> calculate -> verify -> notice -> representation -> confirm
--   B  propose -> approve -> activate benefit deduction -> receipts
--   C  waiver request -> approve
--   D  write-off request -> approve
--   E  reversal (Model A signed contra) -> balance invariant
--   F  appeal hold / release, suspend / resume recovery
--   G  reconcile -> close -> reopen
--   Negative security matrix: E_ACTIONS_DISABLED, E_PERMISSION_DENIED,
--   E_STALE_ROW_VERSION, E_SELF_APPROVAL, E_INVALID_STATE.
-- =====================================================================
\set ON_ERROR_STOP on

BEGIN;

-- Refuse to run against a production-marked database ------------------
DO $$
DECLARE v_env text;
BEGIN
  SELECT environment_kind INTO v_env
  FROM public.platform_environment_marker
  WHERE id = true;

  IF upper(COALESCE(v_env, 'UNMARKED')) <> 'CI' THEN
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL refusing to run against % database', COALESCE(v_env, 'UNMARKED');
  END IF;
END
$$;

-- Synthetic authorisation fixture ------------------------------------
-- Seeded inside the transaction so ROLLBACK removes it; CI proves zero
-- residue afterwards. Never seeded by a migration.
INSERT INTO public.bn_op_role_action (role_code, action_code, is_synthetic)
SELECT r.role_code, a.action_code, true
FROM (VALUES
  ('BN_OP_SYNTH_MAKER',   ARRAY['view','view_financial_detail','create_candidate','calculate_liability','issue_notice','record_representation','propose_recovery_plan','record_receipt','allocate_receipt','request_waiver','request_writeoff']),
  ('BN_OP_SYNTH_CHECKER', ARRAY['view','view_financial_detail','verify','confirm_liability','approve_recovery_plan','activate_deduction','approve_waiver','approve_writeoff','reverse_transaction','place_appeal_hold','release_appeal_hold','suspend_recovery','resume_recovery','refer_legal','refer_estate','close','reopen']),
  ('BN_OP_SYNTH_FINANCE', ARRAY['view','view_financial_detail','reconcile']),
  ('BN_OP_SYNTH_AUDITOR', ARRAY['view','view_financial_detail','audit'])
) AS r(role_code, actions)
CROSS JOIN LATERAL unnest(r.actions) AS a(action_code)
ON CONFLICT DO NOTHING;

INSERT INTO public.bn_op_user_role (user_id, role_code, is_synthetic)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'BN_OP_SYNTH_MAKER',   true),
  -- the maker also holds checker capability: self-approval must still be
  -- blocked by the maker-checker guard, not by a missing permission.
  ('00000000-0000-0000-0000-0000000000a1', 'BN_OP_SYNTH_CHECKER', true),
  ('00000000-0000-0000-0000-0000000000a2', 'BN_OP_SYNTH_CHECKER', true),
  ('00000000-0000-0000-0000-0000000000a2', 'BN_OP_SYNTH_MAKER',   true),
  ('00000000-0000-0000-0000-0000000000a2', 'BN_OP_SYNTH_FINANCE', true),
  ('00000000-0000-0000-0000-0000000000a2', 'BN_OP_SYNTH_AUDITOR', true)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_case      uuid;
  v_maker     uuid := '00000000-0000-0000-0000-0000000000a1';
  v_checker   uuid := '00000000-0000-0000-0000-0000000000a2';
  v_nobody    uuid := '00000000-0000-0000-0000-0000000000a9';
  v_version   integer;
  v_out       numeric;
  v_err       text;
  v_actions   boolean;
  v_plan      uuid;
  v_plan_version integer;
  v_hold      uuid;
  v_hold_version integer;
  v_suspension uuid;
  v_suspension_version integer;
  v_waiver    uuid;
  v_waiver_version integer;
  v_writeoff  uuid;
  v_writeoff_version integer;
BEGIN
  -- Harness runs with actions temporarily enabled inside the transaction;
  -- the module row is restored by ROLLBACK and re-asserted by CI postflight.
  SELECT actions_enabled INTO v_actions
  FROM public.app_modules WHERE name = 'bn_overpayments';
  IF v_actions IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL bn_overpayments must be dark-launched (actions_enabled=false)';
  END IF;

  -- ── Negative: actions disabled ───────────────────────────────────
  -- Authenticated maker: proves the gate is the module switch, not auth.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.bn_overpayment_create_candidate_v1(
      NULL, 'DUPLICATE_PAYMENT', NULL, NULL, 'XCD', 'HARNESS', 'HARNESS:NEG:DISABLED');
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL expected E_ACTIONS_DISABLED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_ACTIONS_DISABLED%' THEN RAISE; END IF;
  END;

  UPDATE public.app_modules SET actions_enabled = true WHERE name = 'bn_overpayments';

  -- ── Negative: permission denied ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_nobody, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.bn_overpayment_create_candidate_v1(
      NULL, 'DUPLICATE_PAYMENT', NULL, NULL, 'XCD', 'HARNESS', 'HARNESS:NEG:PERM');
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL expected E_PERMISSION_DENIED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_PERMISSION_DENIED%' THEN RAISE; END IF;
  END;

  -- ── Journey A: detection through confirmed liability ─────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  v_case := (public.bn_overpayment_create_candidate_v1(
    NULL, 'DUPLICATE_PAYMENT', '2025-01-01', '2025-06-30', 'XCD', 'HARNESS',
    'HARNESS:A:CANDIDATE') ->> 'case_id')::uuid;

  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;

  -- Negative: stale row version
  BEGIN
    PERFORM public.bn_overpayment_calculate_liability_v1(
      v_case, v_version - 1, 1500.00, 'XCD', 'MANUAL', '{}'::jsonb, 'HARNESS:NEG:STALE');
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL expected E_STALE_ROW_VERSION';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_STALE_ROW_VERSION%' THEN RAISE; END IF;
  END;

  PERFORM public.bn_overpayment_calculate_liability_v1(
    v_case, v_version, 1500.00, 'XCD', 'MANUAL', '{}'::jsonb, 'HARNESS:A:CALC');

  -- Negative: self approval on verification
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  BEGIN
    PERFORM public.bn_overpayment_verify_v1(v_case, v_version, 'HARNESS', 'HARNESS:NEG:SELF');
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL expected E_SELF_APPROVAL';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_SELF_APPROVAL%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_verify_v1(v_case, v_version, 'HARNESS', 'HARNESS:A:VERIFY');

  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_issue_notice_v1(v_case, v_version, 'LETTER', 'HARNESS:A:NOTICE');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_record_representation_v1(
    v_case, v_version, 'Claimant disputes period', 'PORTAL', 'HARNESS:A:REP');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_confirm_liability_v1(
    v_case, v_version, 'Liability confirmed by checker', 'HARNESS:A:CONFIRM');

  -- ── Journey B: recovery plan and receipts ────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_propose_recovery_plan_v1(
    v_case, v_version, 1500.00, 100.00, 'MONTHLY', 'BENEFIT_DEDUCTION',
    CURRENT_DATE, 'XCD', 'HARNESS:B:PROPOSE');
  SELECT id, row_version INTO v_plan, v_plan_version
  FROM public.bn_op_recovery_plan WHERE case_id = v_case ORDER BY created_at DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
  PERFORM public.bn_overpayment_approve_recovery_plan_v1(
    v_case, v_plan, v_plan_version, 'HARNESS:B:APPROVE');

  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_activate_benefit_deduction_v1(
    v_case, v_plan, v_version, 100.00, 'XCD', 'HARNESS:B:ACTIVATE');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_record_receipt_v1(
    v_case, v_version, 300.00, 'XCD', 'CASH', 'HARNESS:B:RECEIPT');

  -- ── Journey E: Model A signed contra invariant ───────────────────
  -- confirmed 1500, receipt 300, full reversal 300  ->  outstanding 1500
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_reverse_transaction_v1(
    v_case,
     (SELECT id FROM public.bn_op_recovery_transaction WHERE case_id = v_case AND txn_type = 'RECEIPT' ORDER BY posted_at DESC LIMIT 1),
     300.00, 'XCD', 'HARNESS_CORRECTION', 'HARNESS:E:REVERSE');

  SELECT outstanding_amount INTO v_out FROM public.bn_op_case WHERE id = v_case;
  IF round(v_out, 2) <> 1500.00 THEN
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL reversal invariant broken: outstanding % (expected 1500.00)', v_out;
  END IF;

  -- partial recovery then balance check: receipt 300 -> outstanding 1200
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_record_receipt_v1(
    v_case, v_version, 300.00, 'XCD', 'CASH', 'HARNESS:E:RECEIPT2');

  SELECT outstanding_amount INTO v_out FROM public.bn_op_case WHERE id = v_case;
  IF round(v_out, 2) <> 1200.00 THEN
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL balance broken: outstanding % (expected 1200.00)', v_out;
  END IF;
  RAISE NOTICE 'Model A signed contra invariant verified (expected 1200.00, got %)', round(v_out, 2);

  -- ── Journey F: appeal hold and recovery suspension ───────────────
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_place_appeal_hold_v1(
    v_case, v_version, 'APP-HARNESS-001', 'APPEAL_LODGED', 'HARNESS:F:HOLD');
  SELECT id, row_version INTO v_hold, v_hold_version
  FROM public.bn_op_appeal_hold WHERE case_id = v_case AND is_active;

  -- Negative: recovery action while on appeal hold
  BEGIN
    SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
    PERFORM public.bn_overpayment_record_receipt_v1(
      v_case, v_version, 50.00, 'XCD', 'CASH', 'HARNESS:NEG:HOLD');
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL expected hold rejection during appeal hold';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_%HOLD%' AND v_err NOT LIKE '%E_INVALID_STATE%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
  PERFORM public.bn_overpayment_release_appeal_hold_v1(
    v_case, v_hold, v_hold_version, 'DISMISSED', 'HARNESS:F:RELEASE');

  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_suspend_recovery_v1(
    v_case, v_version, 'HARDSHIP', 'Temporary hardship', 'HARNESS:F:SUSPEND');
  SELECT id, row_version INTO v_suspension, v_suspension_version
  FROM public.bn_op_recovery_suspension WHERE case_id = v_case AND is_active;
  PERFORM public.bn_overpayment_resume_recovery_v1(
    v_case, v_suspension, v_suspension_version, 'HARNESS:F:RESUME');

  -- ── Journeys C/D: waiver and write-off of the residual balance ───
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_request_waiver_v1(
    v_case, v_version, 200.00, false, 'HARDSHIP', 'Documented hardship', 'XCD', 'HARNESS:C:REQUEST');
  SELECT id, row_version INTO v_waiver, v_waiver_version
  FROM public.bn_op_waiver_request WHERE case_id = v_case ORDER BY created_at DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
  PERFORM public.bn_overpayment_approve_waiver_v1(
    v_case, v_waiver, v_waiver_version, 'Approved by checker', 'HARNESS:C:APPROVE');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_maker, 'role', 'authenticated')::text, true);
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_request_writeoff_v1(
    v_case, v_version, 1000.00, false, 'IRRECOVERABLE', 'Recovery exhausted', 'XCD', 'HARNESS:D:REQUEST');
  SELECT id, row_version INTO v_writeoff, v_writeoff_version
  FROM public.bn_op_writeoff_request WHERE case_id = v_case ORDER BY created_at DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
  PERFORM public.bn_overpayment_approve_writeoff_v1(
    v_case, v_writeoff, v_writeoff_version, 'Approved by checker', 'HARNESS:D:APPROVE');

  -- ── Journey G: reconcile, close, reopen ──────────────────────────
  SELECT outstanding_amount INTO v_out FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_reconcile_v1(
    v_case, v_out, 'XCD', 'Finance balance reconciled', 'HARNESS:G:RECONCILE');
  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_close_v1(v_case, v_version, 'SETTLED', 'HARNESS:G:CLOSE');

  -- Negative: mutation on a closed case
  BEGIN
    SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
    PERFORM public.bn_overpayment_record_receipt_v1(
      v_case, v_version, 10.00, 'XCD', 'CASH', 'HARNESS:NEG:CLOSED');
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL expected E_INVALID_STATE on closed case';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_INVALID_STATE%' THEN RAISE; END IF;
  END;

  SELECT row_version INTO v_version FROM public.bn_op_case WHERE id = v_case;
  PERFORM public.bn_overpayment_reopen_v1(v_case, v_version, 'HARNESS_REVIEW', 'HARNESS:G:REOPEN');

  -- ── Audit completeness ───────────────────────────────────────────
  IF (SELECT count(*) FROM public.bn_op_event WHERE case_id = v_case) < 20 THEN
    RAISE EXCEPTION 'BN_OP_HARNESS_RESULT: FAIL audit trail incomplete';
  END IF;

  -- No cleanup is performed here. The enclosing ROLLBACK is the only cleanup
  -- mechanism, and CI independently proves every bn_op_* table has zero rows.
  RAISE NOTICE 'BN_OP_HARNESS_RESULT: PASS';
END
$$;

ROLLBACK;

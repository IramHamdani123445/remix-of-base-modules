-- =====================================================================
-- BN Overpayments — effective-grant verifier (Phase B7)
--
-- Fails (RAISE EXCEPTION) when the Overpayment domain is reachable by the
-- browser roles other than through the secured versioned RPC boundary.
--
-- Contract:
--   1. anon / authenticated hold NO table privileges on any bn_op_* table.
--   2. Every bn_op_* table has RLS enabled.
--   3. The exact 29 command RPCs and 14 query RPCs exist, are SECURITY DEFINER,
--      and are EXECUTE-able by authenticated.
--   4. No *_svc_v1 service adapter is EXECUTE-able by anon or authenticated.
-- =====================================================================
DO $$
DECLARE
  v_bad   text;
  v_commands constant text[] := ARRAY[
    'bn_overpayment_create_candidate_v1','bn_overpayment_calculate_liability_v1',
    'bn_overpayment_verify_v1','bn_overpayment_issue_notice_v1',
    'bn_overpayment_record_representation_v1','bn_overpayment_confirm_liability_v1',
    'bn_overpayment_propose_recovery_plan_v1','bn_overpayment_approve_recovery_plan_v1',
    'bn_overpayment_reject_recovery_plan_v1','bn_overpayment_revise_recovery_plan_v1',
    'bn_overpayment_activate_benefit_deduction_v1','bn_overpayment_record_receipt_v1',
    'bn_overpayment_allocate_receipt_v1','bn_overpayment_request_waiver_v1',
    'bn_overpayment_approve_waiver_v1','bn_overpayment_reject_waiver_v1',
    'bn_overpayment_request_writeoff_v1','bn_overpayment_approve_writeoff_v1',
    'bn_overpayment_reject_writeoff_v1','bn_overpayment_refer_legal_v1',
    'bn_overpayment_refer_estate_v1','bn_overpayment_reverse_transaction_v1',
    'bn_overpayment_reconcile_v1','bn_overpayment_close_v1','bn_overpayment_reopen_v1',
    'bn_overpayment_place_appeal_hold_v1','bn_overpayment_release_appeal_hold_v1',
    'bn_overpayment_suspend_recovery_v1','bn_overpayment_resume_recovery_v1'
  ];
  v_queries constant text[] := ARRAY[
    'bn_overpayment_worklist_v1','bn_overpayment_case_detail_v1',
    'bn_overpayment_available_actions_v1','bn_overpayment_balance_v1',
    'bn_overpayment_transactions_v1','bn_overpayment_recovery_plans_v1',
    'bn_overpayment_waiver_requests_v1','bn_overpayment_writeoff_requests_v1',
    'bn_overpayment_appeal_holds_v1','bn_overpayment_referrals_v1',
    'bn_overpayment_reconciliations_v1','bn_overpayment_timeline_v1',
    'bn_overpayment_audit_history_v1','bn_overpayment_liability_versions_v1'
  ];
BEGIN
  -- 1. No direct table privileges for browser roles -------------------
  SELECT string_agg(DISTINCT format('%s:%s:%s', grantee, table_name, privilege_type), ', ')
    INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name LIKE 'bn\_op\_%'
    AND grantee IN ('anon', 'authenticated');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_OP_GRANT_FAIL: browser roles hold table privileges: %', v_bad;
  END IF;

  -- 2. RLS enabled on every domain table ------------------------------
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname LIKE 'bn\_op\_%'
    AND c.relrowsecurity IS FALSE;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_OP_RLS_FAIL: RLS disabled on: %', v_bad;
  END IF;

  SELECT string_agg(expected, ', ') INTO v_bad
  FROM unnest(v_commands || v_queries) expected
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = expected
  );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_OP_RPC_MISSING: %', v_bad;
  END IF;

  -- 3c. All boundary RPCs must be SECURITY DEFINER ---------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY(v_commands || v_queries)
    AND (p.prosecdef IS FALSE OR p.proconfig IS NULL
      OR NOT ('search_path=public' = ANY(p.proconfig)));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_OP_SECURITY_FAIL: not SECURITY DEFINER with search_path=public: %', v_bad;
  END IF;

  -- 3d. Boundary RPCs executable by authenticated ----------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY(v_commands || v_queries)
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_OP_EXECUTE_FAIL: authenticated cannot execute: %', v_bad;
  END IF;

  -- 4. Service adapters must NOT be callable from the browser ----------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'bn\_overpayment\_%\_svc\_v1'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_OP_SVC_EXPOSED_FAIL: service adapters exposed to browser: %', v_bad;
  END IF;

  RAISE NOTICE 'BN_OP_GRANTS_RESULT: PASS';
END
$$;

-- =====================================================================
-- BN Overpayments — effective-grant verifier (Phase B7)
--
-- Fails (RAISE EXCEPTION) when the Overpayment domain is reachable by the
-- browser roles other than through the secured versioned RPC boundary.
--
-- Contract:
--   1. anon / authenticated hold NO table privileges on any bn_op_* table.
--   2. Every bn_op_* table has RLS enabled.
--   3. All 29 command RPCs and 14 query RPCs exist, are SECURITY DEFINER,
--      and are EXECUTE-able by authenticated.
--   4. No *_svc_v1 service adapter is EXECUTE-able by anon or authenticated.
-- =====================================================================
DO $$
DECLARE
  v_bad   text;
  v_count integer;
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

  -- 3a. Command RPC count ---------------------------------------------
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'bn\_overpayment\_%\_v1'
    AND p.proname NOT LIKE '%\_svc\_v1'
    AND pg_get_function_arguments(p.oid) LIKE '%p_idempotency_key%';
  IF v_count <> 29 THEN
    RAISE EXCEPTION 'BN_OP_COMMAND_COUNT_FAIL: expected 29 command RPCs, found %', v_count;
  END IF;

  -- 3b. Query RPC count -----------------------------------------------
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'bn\_overpayment\_%\_v1'
    AND p.proname NOT LIKE '%\_svc\_v1'
    AND pg_get_function_arguments(p.oid) NOT LIKE '%p_idempotency_key%';
  IF v_count <> 14 THEN
    RAISE EXCEPTION 'BN_OP_QUERY_COUNT_FAIL: expected 14 query RPCs, found %', v_count;
  END IF;

  -- 3c. All boundary RPCs must be SECURITY DEFINER ---------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'bn\_overpayment\_%\_v1'
    AND p.prosecdef IS FALSE;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_OP_SECDEF_FAIL: not SECURITY DEFINER: %', v_bad;
  END IF;

  -- 3d. Boundary RPCs executable by authenticated ----------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'bn\_overpayment\_%\_v1'
    AND p.proname NOT LIKE '%\_svc\_v1'
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

  RAISE NOTICE 'BN_OP_GRANT_RESULT=PASS';
END
$$;

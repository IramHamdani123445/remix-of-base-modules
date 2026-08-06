-- =====================================================================
-- BN Mortality — effective-grant verifier (Phase M6)
--
-- Fails (RAISE EXCEPTION) when the Mortality domain is reachable by the
-- browser roles other than through the secured boundary.
--
-- Contract:
--   1. anon / authenticated hold NO write privileges on any bn_mortality_*
--      or bn_cross_module_handoff* table, and anon holds nothing at all.
--   2. The unhardened v1 command entry point is NOT executable by browser
--      roles — only bn_mortality_execute_command_v2 (service side) is used.
--   3. Read-model / catalogue RPCs exist, are SECURITY DEFINER with a pinned
--      search_path, and are executable by authenticated.
--   4. Internal helpers (_bn_mortality_*, _bn_cross_module_*) and the
--      cross-module handoff executor are NOT executable by browser roles.
--   5. The Mortality module is registered and dark-launched.
--
-- Emits exactly one:  BN_MORT_GRANTS_RESULT: PASS
-- =====================================================================
DO $$
DECLARE
  v_bad text;
  v_missing text;
  v_boundary constant text[] := ARRAY[
    'bn_mortality_available_actions_v1',
    'bn_mortality_check_actor_permission'
  ];
BEGIN
  -- 1a. anon must hold nothing on the domain ---------------------------
  SELECT string_agg(DISTINCT format('%s:%s', table_name, privilege_type), ', ')
    INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND (table_name LIKE 'bn\_mortality\_%' OR table_name LIKE 'bn\_cross\_module\_handoff%')
    AND grantee = 'anon';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_GRANT_FAIL: anon holds privileges: %', v_bad;
  END IF;

  -- 1b. authenticated must hold no write privileges --------------------
  SELECT string_agg(DISTINCT format('%s:%s', table_name, privilege_type), ', ')
    INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND (table_name LIKE 'bn\_mortality\_%' OR table_name LIKE 'bn\_cross\_module\_handoff%')
    AND grantee = 'authenticated'
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_GRANT_FAIL: authenticated holds write privileges: %', v_bad;
  END IF;

  -- 1c. operational tables must not be directly readable by the browser
  SELECT string_agg(DISTINCT table_name, ', ') INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee = 'authenticated'
    AND privilege_type = 'SELECT'
    AND table_name IN (
      'bn_mortality_event', 'bn_mortality_event_history',
      'bn_mortality_award_impact', 'bn_mortality_referral',
      'bn_mortality_evidence', 'bn_mortality_command_maker',
      'bn_mortality_command_idempotency'
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_READ_FAIL: operational tables readable by authenticated: %', v_bad;
  END IF;

  -- 2. v1 entry point must not be browser-callable ---------------------
  SELECT string_agg(p.proname || '/' || pg_get_function_identity_arguments(p.oid), ', ')
    INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'bn_mortality_execute_command'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_V1_EXPOSED_FAIL: %', v_bad;
  END IF;

  -- 2b. v2 must exist and must not be browser-callable either ----------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bn_mortality_execute_command_v2'
  ) THEN
    RAISE EXCEPTION 'BN_MORT_RPC_MISSING: bn_mortality_execute_command_v2';
  END IF;
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'bn_mortality_execute_command_v2'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_V2_EXPOSED_FAIL: v2 must be service-side only: %', v_bad;
  END IF;

  -- 3a. boundary read RPCs exist ---------------------------------------
  SELECT string_agg(x, ', ') INTO v_missing
  FROM unnest(v_boundary) AS x
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = x
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_RPC_MISSING: %', v_missing;
  END IF;

  -- 3b. SECURITY DEFINER with pinned search_path -----------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY(v_boundary || ARRAY['bn_mortality_execute_command_v2','bn_mortality_execute_command'])
    AND (p.prosecdef IS FALSE OR p.proconfig IS NULL
      OR NOT ('search_path=public' = ANY(p.proconfig)));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_SECURITY_FAIL: not SECURITY DEFINER with search_path=public: %', v_bad;
  END IF;

  -- 3c. read boundary executable by authenticated ----------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY(v_boundary)
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_EXECUTE_FAIL: authenticated cannot execute: %', v_bad;
  END IF;

  -- 4. internal helpers and handoff executor stay server-side ----------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE '\_bn\_mortality\_%'
      OR p.proname LIKE '\_bn\_cross\_module\_%'
      OR p.proname = 'bn_cross_module_handoff_execute_v1')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_MORT_HELPER_EXPOSED_FAIL: %', v_bad;
  END IF;

  -- 5. module registered and dark-launched -----------------------------
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name = 'bn_mortality') THEN
    RAISE EXCEPTION 'BN_MORT_MODULE_MISSING: bn_mortality not registered';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_modules
    WHERE name = 'bn_mortality' AND COALESCE(actions_enabled, false) = true
  ) THEN
    RAISE EXCEPTION 'BN_MORT_DARK_LAUNCH_FAIL: actions_enabled must be false';
  END IF;

  RAISE NOTICE 'BN_MORT_GRANTS_RESULT: PASS';
END
$$;

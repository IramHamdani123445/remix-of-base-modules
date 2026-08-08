-- =====================================================================
-- BN Eligibility & Calculation — effective-grant verifier (Epic 0)
--
-- Contract:
--   1. anon holds NO execute privilege on any bn_calc_* boundary function.
--   2. Internal helpers (_bn_calc_*) are not executable by browser roles.
--   3. Every boundary function exists, is SECURITY DEFINER with a pinned
--      search_path, and is executable by `authenticated`.
--   4. The governed-configuration guard triggers are installed.
--   5. Trace provenance columns exist on bn_calc_trace.
--
-- Emits exactly one:  BN_ELIG_CALC_GRANTS_RESULT: PASS
-- =====================================================================
DO $$
DECLARE
  v_bad text;
  v_missing text;
  v_fn text;
  v_boundary constant text[] := ARRAY[
    'bn_calc_resolve_formula_version_v1',
    'bn_calc_rate_lookup_v1',
    'bn_calc_round_v1',
    'bn_calc_check_variables_v1',
    'bn_calc_open_run_v1',
    'bn_calc_record_trace_v1',
    'bn_calc_finalise_run_v1',
    'bn_calc_config_save_formula_version_v1',
    'bn_calc_config_save_rate_table_row_v1',
    'bn_calc_config_delete_rate_table_row_v1'
  ];
  v_internal constant text[] := ARRAY[
    '_bn_calc_boundary_enter',
    '_bn_calc_in_boundary',
    '_bn_calc_num',
    '_bn_calc_dim_match',
    '_bn_calc_guard_formula_version',
    '_bn_calc_guard_rate_table_row'
  ];
BEGIN
  -- 1. every boundary function must exist -----------------------------
  SELECT string_agg(f, ', ') INTO v_missing
  FROM unnest(v_boundary) f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: missing boundary functions: %', v_missing;
  END IF;

  -- 2. SECURITY DEFINER + pinned search_path --------------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (v_boundary)
    AND (NOT p.prosecdef
         OR p.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: not SECURITY DEFINER with pinned search_path: %', v_bad;
  END IF;

  -- 3. anon must hold nothing -----------------------------------------
  FOREACH v_fn IN ARRAY v_boundary || v_internal LOOP
    SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn
      AND has_function_privilege('anon', p.oid, 'EXECUTE');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: anon can execute %', v_bad;
    END IF;
  END LOOP;

  -- 4. internal helpers must not be browser-callable -------------------
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (v_internal)
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: authenticated can execute internal helper(s): %', v_bad;
  END IF;

  -- 5. legitimate application RPCs remain callable ---------------------
  SELECT string_agg(f, ', ') INTO v_bad
  FROM unnest(v_boundary) f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: authenticated cannot execute boundary function(s): %', v_bad;
  END IF;

  -- 6. governance guard triggers installed -----------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bn_calc_guard_formula_version' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: formula-version immutability trigger missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bn_calc_guard_rate_table_row' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: rate-table-row governance trigger missing';
  END IF;

  -- 7. trace provenance columns ----------------------------------------
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['formula_version_id','formula_code','formula_version_no',
                    'rounding_rule','unrounded_value','lookup_provenance']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bn_calc_trace' AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_GRANTS_FAIL: bn_calc_trace missing provenance column(s): %', v_missing;
  END IF;

  RAISE NOTICE 'BN_ELIG_CALC_GRANTS_RESULT: PASS';
END
$$;

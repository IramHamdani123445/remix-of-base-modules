-- =====================================================================
-- BN Eligibility & Calculation — Epic 0 clean-database runtime harness
--
-- Journeys
--   A  effective formula/version resolution (+ missing / ambiguous fail)
--   B  simple deterministic calculation (exact numeric result)
--   C  effective-date succession (before → A, after → B)
--   D  rate lookup + recorded lookup provenance
--   E  tier / matrix lookup (boundaries, open-ended tier, ambiguity)
--   F  material rounding with recorded rounding semantics
--   G  trace persistence with formula identity
--   H  historical version integrity after succession
--   I  simulation safety (no award / entitlement / payment mutation)
--   J  invalid variable & invalid configuration fail safely
--
-- Runs entirely inside one transaction that is ROLLED BACK, so a
-- disposable database is left with zero test business rows.
--
-- Emits exactly one:  BN_ELIG_CALC_HARNESS_RESULT: PASS
--             and one: BN_ELIG_CALC_POSTFLIGHT_RESULT: PASS
-- =====================================================================
\set ON_ERROR_STOP on
\timing off

BEGIN;

DO $harness$
DECLARE
  -- fixed fixture identities so postflight can assert their removal
  c_tpl_a      constant uuid := '0e11c0de-0000-4000-a000-00000000a001';
  c_tpl_amb    constant uuid := '0e11c0de-0000-4000-a000-00000000a002';
  c_tpl_draft  constant uuid := '0e11c0de-0000-4000-a000-00000000a003';
  c_rate_tbl   constant uuid := '0e11c0de-0000-4000-a000-00000000b001';
  c_tier_tbl   constant uuid := '0e11c0de-0000-4000-a000-00000000b002';
  c_amb_tbl    constant uuid := '0e11c0de-0000-4000-a000-00000000b003';
  c_claim      constant uuid := '0e11c0de-0000-4000-a000-00000000c001';
  c_code       constant text := 'ZZ_EPIC0_F1';
  c_code_amb   constant text := 'ZZ_EPIC0_AMB';

  v_res        jsonb;
  v_look       jsonb;
  v_round      jsonb;
  v_vars       jsonb;
  v_run_live   uuid;
  v_run_sim    uuid;
  v_v1         uuid;
  v_v2         uuid;
  v_n          int;
  v_awards_before      bigint;
  v_entitle_before     bigint;
  v_awards_after       bigint;
  v_entitle_after      bigint;
  v_issue_before       bigint;
  v_failed     boolean;
  v_msg        text;
  v_draft_ver  uuid;
  v_draft_tbl  uuid;
  v_draft_row  uuid;

BEGIN
  RAISE NOTICE '--- BN_ELIG_CALC harness starting ---';

  -- =================================================================
  -- Fixtures (synthetic, disposable)
  -- =================================================================
  INSERT INTO public.bn_formula_template
    (id, template_code, template_name, formula_expression, output_type,
     country_code, is_active, governance_status, rounding_rule, entered_by)
  VALUES
    (c_tpl_a, c_code, 'Epic 0 harness formula', '{AVG_INSURABLE_WAGE} * 0.60',
     'CURRENCY', 'KN', true, 'ACTIVE', 'ROUND_HALF_UP', 'HARNESS'),
    (c_tpl_amb, c_code_amb, 'Epic 0 ambiguity fixture', '{AVG_INSURABLE_WAGE}',
     'CURRENCY', 'KN', true, 'ACTIVE', 'ROUND_HALF_UP', 'HARNESS'),
    (c_tpl_draft, c_code || '_DRAFTONLY', 'Epic 0 draft-only fixture', '{AVG_INSURABLE_WAGE}',
     'CURRENCY', 'KN', true, 'DRAFT', 'ROUND_HALF_UP', 'HARNESS');

  -- Variable registry entry so the formula's variable is governed/known.
  INSERT INTO public.bn_formula_variable_registry
    (variable_code, display_name, source_type, source_path, data_type, is_active, created_by)
  VALUES ('AVG_INSURABLE_WAGE', 'Average insurable wage (harness)',
          'FACT', 'harness.avg_insurable_wage', 'NUMBER', true, 'HARNESS')
  ON CONFLICT DO NOTHING;

  -- Two legitimate effective-dated successor versions (Journey C/H).
  INSERT INTO public.bn_formula_version
    (formula_template_id, formula_code, version_no, expression_type, expression,
     steps_json, output_variable, rounding_rule, governance_status,
     effective_from, effective_to, is_active, entered_by)
  VALUES
    (c_tpl_a, c_code, 1, 'SIMPLE_EXPRESSION', '{AVG_INSURABLE_WAGE} * 0.60',
     '{}'::jsonb, 'WEEKLY_RATE', 'ROUND_HALF_UP', 'ACTIVE',
     DATE '2020-01-01', DATE '2024-12-31', true, 'HARNESS')
  RETURNING id INTO v_v1;

  INSERT INTO public.bn_formula_version
    (formula_template_id, formula_code, version_no, expression_type, expression,
     steps_json, output_variable, rounding_rule, governance_status,
     effective_from, effective_to, is_active, entered_by)
  VALUES
    (c_tpl_a, c_code, 2, 'SIMPLE_EXPRESSION', '{AVG_INSURABLE_WAGE} * 0.65',
     '{}'::jsonb, 'WEEKLY_RATE', 'ROUND_HALF_UP', 'ACTIVE',
     DATE '2025-01-01', NULL, true, 'HARNESS')
  RETURNING id INTO v_v2;

  -- Deliberately overlapping configuration (Journey A negative).
  INSERT INTO public.bn_formula_version
    (formula_template_id, formula_code, version_no, expression_type, expression,
     output_variable, rounding_rule, governance_status,
     effective_from, effective_to, is_active, entered_by)
  VALUES
    (c_tpl_amb, c_code_amb, 1, 'SIMPLE_EXPRESSION', '{AVG_INSURABLE_WAGE}',
     'WEEKLY_RATE', 'ROUND_HALF_UP', 'ACTIVE', DATE '2020-01-01', NULL, true, 'HARNESS'),
    (c_tpl_amb, c_code_amb, 2, 'SIMPLE_EXPRESSION', '{AVG_INSURABLE_WAGE}',
     'WEEKLY_RATE', 'ROUND_HALF_UP', 'ACTIVE', DATE '2021-01-01', NULL, true, 'HARNESS');

  -- Rate table (single dimension, EXACT) ------------------------------
  INSERT INTO public.bn_rate_table
    (id, table_code, table_name, table_type, lookup_mode, country_code,
     version_no, effective_from, effective_to, status, entered_by)
  VALUES (c_rate_tbl, 'ZZ_EPIC0_RATE', 'Epic 0 harness rate table', 'RATE_TABLE',
          'EXACT_MATCH', 'KN', 1, DATE '2020-01-01', NULL, 'DRAFT', 'HARNESS');

  INSERT INTO public.bn_rate_table_dimension
    (rate_table_id, dimension_key, dimension_label, dimension_type, match_type, sequence_no)
  VALUES (c_rate_tbl, 'benefit_code', 'Benefit', 'TEXT', 'EXACT', 1);

  INSERT INTO public.bn_rate_table_row
    (rate_table_id, row_order, dimension_values_json, output_key, output_value,
     output_type, effective_from, effective_to, entered_by)
  VALUES
    (c_rate_tbl, 1, '{"benefit_code":"SICK"}'::jsonb, 'RATE_PCT', 0.60, 'RATE',
     DATE '2020-01-01', DATE '2024-12-31', 'HARNESS'),
    (c_rate_tbl, 2, '{"benefit_code":"SICK"}'::jsonb, 'RATE_PCT', 0.65, 'RATE',
     DATE '2025-01-01', NULL, 'HARNESS'),
    (c_rate_tbl, 3, '{"benefit_code":"MATERNITY"}'::jsonb, 'RATE_PCT', 0.65, 'RATE',
     DATE '2020-01-01', NULL, 'HARNESS');

  -- Tier table (RANGE, incl. open-ended top tier) ---------------------
  INSERT INTO public.bn_rate_table
    (id, table_code, table_name, table_type, lookup_mode, country_code,
     version_no, effective_from, status, entered_by)
  VALUES (c_tier_tbl, 'ZZ_EPIC0_TIER', 'Epic 0 harness tier table', 'TIER',
          'RANGE_MATCH', 'KN', 1, DATE '2020-01-01', 'DRAFT', 'HARNESS');

  INSERT INTO public.bn_rate_table_dimension
    (rate_table_id, dimension_key, dimension_label, dimension_type, match_type, sequence_no)
  VALUES
    (c_tier_tbl, 'weekly_wage', 'Weekly wage', 'NUMBER', 'RANGE', 1),
    (c_tier_tbl, 'category',    'Category',    'TEXT',   'EXACT', 2);

  INSERT INTO public.bn_rate_table_row
    (rate_table_id, row_order, dimension_values_json, output_key, output_value, output_type, entered_by)
  VALUES
    (c_tier_tbl, 1, '{"weekly_wage":{"min":0,"max":199.99},"category":"A"}'::jsonb,
     'TIER_1', 25.00, 'AMOUNT', 'HARNESS'),
    (c_tier_tbl, 2, '{"weekly_wage":{"min":200,"max":499.99},"category":"A"}'::jsonb,
     'TIER_2', 50.00, 'AMOUNT', 'HARNESS'),
    (c_tier_tbl, 3, '{"weekly_wage":{"min":500},"category":"A"}'::jsonb,
     'TIER_3', 90.00, 'AMOUNT', 'HARNESS');

  -- Ambiguous matrix (two rows match the same input) ------------------
  INSERT INTO public.bn_rate_table
    (id, table_code, table_name, table_type, lookup_mode, country_code,
     version_no, effective_from, status, entered_by)
  VALUES (c_amb_tbl, 'ZZ_EPIC0_AMBIG', 'Epic 0 ambiguous matrix', 'MATRIX',
          'RANGE_MATCH', 'KN', 1, DATE '2020-01-01', 'DRAFT', 'HARNESS');

  INSERT INTO public.bn_rate_table_dimension
    (rate_table_id, dimension_key, dimension_label, dimension_type, match_type, sequence_no)
  VALUES (c_amb_tbl, 'weekly_wage', 'Weekly wage', 'NUMBER', 'RANGE', 1);

  INSERT INTO public.bn_rate_table_row
    (rate_table_id, row_order, dimension_values_json, output_key, output_value, output_type, entered_by)
  VALUES
    (c_amb_tbl, 1, '{"weekly_wage":{"min":0,"max":500}}'::jsonb, 'X', 10, 'AMOUNT', 'HARNESS'),
    (c_amb_tbl, 2, '{"weekly_wage":{"min":100,"max":900}}'::jsonb, 'Y', 20, 'AMOUNT', 'HARNESS');

  -- Activate the configured tables (rows are only editable while DRAFT).
  UPDATE public.bn_rate_table SET status = 'ACTIVE'
  WHERE id IN (c_rate_tbl, c_tier_tbl, c_amb_tbl);

  -- =================================================================
  -- Journey A — effective formula/version resolution
  -- =================================================================
  v_res := public.bn_calc_resolve_formula_version_v1(c_code, DATE '2023-06-01', 'LIVE');
  IF (v_res ->> 'formula_version_id')::uuid <> v_v1 THEN
    RAISE EXCEPTION 'A1 FAIL: expected v1, got %', v_res;
  END IF;
  IF (v_res ->> 'authoritative')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'A2 FAIL: LIVE resolution must be authoritative: %', v_res;
  END IF;

  -- A3 missing configuration fails explicitly
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_resolve_formula_version_v1('ZZ_NO_SUCH_FORMULA', DATE '2023-06-01', 'LIVE');
  EXCEPTION WHEN others THEN
    v_failed := true; v_msg := SQLERRM;
  END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_NO_EFFECTIVE_FORMULA%' THEN
    RAISE EXCEPTION 'A3 FAIL: missing configuration did not fail explicitly (%)', v_msg;
  END IF;

  -- A4 date before any version fails explicitly (no silent fallback)
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_resolve_formula_version_v1(c_code, DATE '2019-01-01', 'LIVE');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_NO_EFFECTIVE_FORMULA%' THEN
    RAISE EXCEPTION 'A4 FAIL: out-of-window date did not fail explicitly (%)', v_msg;
  END IF;

  -- A5 ambiguous overlapping configuration fails explicitly
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_resolve_formula_version_v1(c_code_amb, DATE '2023-06-01', 'LIVE');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_AMBIGUOUS_FORMULA%' THEN
    RAISE EXCEPTION 'A5 FAIL: ambiguous configuration was silently resolved (%)', v_msg;
  END IF;

  -- A6 unapproved (DRAFT) configuration is never operationally usable
  INSERT INTO public.bn_formula_version
    (formula_template_id, formula_code, version_no, expression_type, expression,
     output_variable, rounding_rule, governance_status, effective_from, is_active, entered_by)
  VALUES (c_tpl_draft, c_code || '_DRAFTONLY', 1, 'SIMPLE_EXPRESSION', '{AVG_INSURABLE_WAGE}',
          'WEEKLY_RATE', 'ROUND_HALF_UP', 'DRAFT', DATE '2020-01-01', true, 'HARNESS');
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_resolve_formula_version_v1(c_code || '_DRAFTONLY', DATE '2023-06-01', 'LIVE');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'A6 FAIL: DRAFT configuration was accepted for LIVE calculation';
  END IF;
  -- ... but simulation may preview it
  v_res := public.bn_calc_resolve_formula_version_v1(c_code || '_DRAFTONLY', DATE '2023-06-01', 'SIMULATION');
  IF (v_res ->> 'authoritative')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'A7 FAIL: simulation preview must be non-authoritative: %', v_res;
  END IF;

  -- =================================================================
  -- Journey C — effective-date succession
  -- =================================================================
  IF (public.bn_calc_resolve_formula_version_v1(c_code, DATE '2024-12-31', 'LIVE') ->> 'formula_version_id')::uuid <> v_v1 THEN
    RAISE EXCEPTION 'C1 FAIL: boundary date 2024-12-31 must resolve to version A';
  END IF;
  IF (public.bn_calc_resolve_formula_version_v1(c_code, DATE '2025-01-01', 'LIVE') ->> 'formula_version_id')::uuid <> v_v2 THEN
    RAISE EXCEPTION 'C2 FAIL: boundary date 2025-01-01 must resolve to version B';
  END IF;

  -- =================================================================
  -- Journey D — rate lookup + provenance
  -- =================================================================
  v_look := public.bn_calc_rate_lookup_v1('ZZ_EPIC0_RATE',
              '{"benefit_code":"SICK"}'::jsonb, DATE '2023-06-01');
  IF (v_look ->> 'output_value')::numeric <> 0.60 THEN
    RAISE EXCEPTION 'D1 FAIL: expected 0.60, got %', v_look;
  END IF;
  IF (v_look ->> 'matched_row_id') IS NULL OR (v_look ->> 'table_id') IS NULL THEN
    RAISE EXCEPTION 'D2 FAIL: lookup provenance incomplete: %', v_look;
  END IF;
  -- effective-dated succession inside the rate table
  IF (public.bn_calc_rate_lookup_v1('ZZ_EPIC0_RATE', '{"benefit_code":"SICK"}'::jsonb,
        DATE '2025-06-01') ->> 'output_value')::numeric <> 0.65 THEN
    RAISE EXCEPTION 'D3 FAIL: rate succession not honoured';
  END IF;
  -- missing rate fails explicitly
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_rate_lookup_v1('ZZ_EPIC0_RATE', '{"benefit_code":"NOPE"}'::jsonb, DATE '2023-06-01');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_RATE_NO_MATCH%' THEN
    RAISE EXCEPTION 'D4 FAIL: missing rate did not fail explicitly (%)', v_msg;
  END IF;
  -- missing table fails explicitly
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_rate_lookup_v1('ZZ_NO_TABLE', '{}'::jsonb, DATE '2023-06-01');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_RATE_TABLE_NOT_FOUND%' THEN
    RAISE EXCEPTION 'D5 FAIL: missing rate table did not fail explicitly (%)', v_msg;
  END IF;

  -- =================================================================
  -- Journey E — tier / matrix
  -- =================================================================
  IF (public.bn_calc_rate_lookup_v1('ZZ_EPIC0_TIER',
        '{"weekly_wage":150,"category":"A"}'::jsonb, DATE '2023-06-01') ->> 'output_value')::numeric <> 25.00 THEN
    RAISE EXCEPTION 'E1 FAIL: tier 1 lookup incorrect';
  END IF;
  IF (public.bn_calc_rate_lookup_v1('ZZ_EPIC0_TIER',
        '{"weekly_wage":200,"category":"A"}'::jsonb, DATE '2023-06-01') ->> 'output_value')::numeric <> 50.00 THEN
    RAISE EXCEPTION 'E2 FAIL: lower boundary 200 must select tier 2';
  END IF;
  IF (public.bn_calc_rate_lookup_v1('ZZ_EPIC0_TIER',
        '{"weekly_wage":499.99,"category":"A"}'::jsonb, DATE '2023-06-01') ->> 'output_value')::numeric <> 50.00 THEN
    RAISE EXCEPTION 'E3 FAIL: upper boundary 499.99 must select tier 2';
  END IF;
  IF (public.bn_calc_rate_lookup_v1('ZZ_EPIC0_TIER',
        '{"weekly_wage":10000,"category":"A"}'::jsonb, DATE '2023-06-01') ->> 'output_value')::numeric <> 90.00 THEN
    RAISE EXCEPTION 'E4 FAIL: open-ended top tier not selected';
  END IF;
  -- tier gap (category B has no rows) fails explicitly
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_rate_lookup_v1('ZZ_EPIC0_TIER', '{"weekly_wage":150,"category":"B"}'::jsonb, DATE '2023-06-01');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_RATE_NO_MATCH%' THEN
    RAISE EXCEPTION 'E5 FAIL: tier gap did not fail explicitly (%)', v_msg;
  END IF;
  -- overlapping matrix must NOT silently pick the first row
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_rate_lookup_v1('ZZ_EPIC0_AMBIG', '{"weekly_wage":200}'::jsonb, DATE '2023-06-01');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_AMBIGUOUS_RATE_MATCH%' THEN
    RAISE EXCEPTION 'E6 FAIL: ambiguous matrix silently resolved (%)', v_msg;
  END IF;

  -- =================================================================
  -- Journey F — material rounding
  -- =================================================================
  v_round := public.bn_calc_round_v1(432.5555, 'ROUND_HALF_UP');
  IF (v_round ->> 'rounded_value')::numeric <> 432.56
     OR (v_round ->> 'unrounded_value')::numeric <> 432.5555
     OR (v_round ->> 'rounding_rule') <> 'ROUND_HALF_UP'
     OR (v_round ->> 'material')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'F1 FAIL: rounding provenance incorrect: %', v_round;
  END IF;
  IF (public.bn_calc_round_v1(432.5555, 'ROUND_DOWN') ->> 'rounded_value')::numeric <> 432.55 THEN
    RAISE EXCEPTION 'F2 FAIL: ROUND_DOWN incorrect';
  END IF;
  IF (public.bn_calc_round_v1(432.5155, 'ROUND_UP') ->> 'rounded_value')::numeric <> 432.52 THEN
    RAISE EXCEPTION 'F3 FAIL: ROUND_UP incorrect';
  END IF;
  IF (public.bn_calc_round_v1(432.5555, 'ROUND_NEAREST_DOLLAR') ->> 'rounded_value')::numeric <> 433 THEN
    RAISE EXCEPTION 'F4 FAIL: ROUND_NEAREST_DOLLAR incorrect';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.bn_calc_round_v1(1.0, 'NOT_A_RULE');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_UNKNOWN_ROUNDING_RULE%' THEN
    RAISE EXCEPTION 'F5 FAIL: unknown rounding rule accepted (%)', v_msg;
  END IF;

  -- =================================================================
  -- Journeys B + G — deterministic calculation and trace persistence
  -- =================================================================
  v_res  := public.bn_calc_resolve_formula_version_v1(c_code, DATE '2023-06-01', 'LIVE');
  v_look := public.bn_calc_rate_lookup_v1('ZZ_EPIC0_RATE', '{"benefit_code":"SICK"}'::jsonb, DATE '2023-06-01');
  -- 720.925 * 0.60 = 432.555  → ROUND_HALF_UP(2) = 432.56
  v_round := public.bn_calc_round_v1(720.925 * (v_look ->> 'output_value')::numeric,
                                     v_res ->> 'rounding_rule');
  IF (v_round ->> 'rounded_value')::numeric <> 432.56 THEN
    RAISE EXCEPTION 'B1 FAIL: expected 432.56, got %', v_round;
  END IF;

  v_run_live := public.bn_calc_open_run_v1(c_claim, NULL, 'LIVE', 'HARNESS', 'KN');

  v_n := public.bn_calc_record_trace_v1(v_run_live, jsonb_build_array(
    jsonb_build_object(
      'engine_layer', 'CALCULATION', 'step_number', 1,
      'step_code', 'RESOLVE_FORMULA', 'step_label', 'Resolve effective formula version',
      'formula_expression', v_res ->> 'expression',
      'formula_version_id', v_res ->> 'formula_version_id',
      'formula_code', v_res ->> 'formula_code',
      'formula_version_no', v_res ->> 'version_no',
      'inputs', jsonb_build_object('as_of', '2023-06-01'),
      'severity', 'INFO', 'passed', true),
    jsonb_build_object(
      'engine_layer', 'CALCULATION', 'step_number', 2,
      'step_code', 'RATE_LOOKUP', 'step_label', 'Resolve insurable-wage replacement rate',
      'lookup_provenance', v_look,
      'output_value', v_look ->> 'output_value',
      'severity', 'INFO', 'passed', true),
    jsonb_build_object(
      'engine_layer', 'CALCULATION', 'step_number', 3,
      'step_code', 'APPLY_ROUNDING', 'step_label', 'Apply configured rounding',
      'formula_version_id', v_res ->> 'formula_version_id',
      'formula_code', v_res ->> 'formula_code',
      'formula_version_no', v_res ->> 'version_no',
      'unrounded_value', v_round ->> 'unrounded_value',
      'rounding_rule', v_round ->> 'rounding_rule',
      'output_value', v_round ->> 'rounded_value',
      'inputs', jsonb_build_object('avg_insurable_wage', 720.925),
      'severity', 'INFO', 'passed', true)
  ));
  IF v_n <> 3 THEN RAISE EXCEPTION 'G1 FAIL: expected 3 trace rows, wrote %', v_n; END IF;

  PERFORM public.bn_calc_finalise_run_v1(v_run_live, 'COMPLETED',
    jsonb_build_object('weekly_rate', 432.56));

  -- G2 trace proves formula identity and rounding semantics
  IF NOT EXISTS (
    SELECT 1 FROM public.bn_calc_trace t
    WHERE t.calc_run_id = v_run_live
      AND t.step_code = 'APPLY_ROUNDING'
      AND t.formula_version_id = v_v1
      AND t.formula_code = c_code
      AND t.formula_version_no = 1
      AND t.rounding_rule = 'ROUND_HALF_UP'
      AND t.unrounded_value = 432.5550
      AND t.output_value = 432.56
  ) THEN
    RAISE EXCEPTION 'G2 FAIL: rounding trace provenance missing/incorrect';
  END IF;

  -- G3 lookup provenance persisted
  IF NOT EXISTS (
    SELECT 1 FROM public.bn_calc_trace t
    WHERE t.calc_run_id = v_run_live
      AND t.step_code = 'RATE_LOOKUP'
      AND t.lookup_provenance ->> 'table_code' = 'ZZ_EPIC0_RATE'
      AND (t.lookup_provenance ->> 'matched_row_id') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'G3 FAIL: rate lookup provenance not persisted';
  END IF;

  -- G4 no claimant PII persisted in the generic trace
  IF EXISTS (
    SELECT 1 FROM public.bn_calc_trace t
    WHERE t.calc_run_id = v_run_live
      AND (t.inputs::text ~* '(ssn|national_id|bank_account|passport)')
  ) THEN
    RAISE EXCEPTION 'G4 FAIL: identifier-like keys present in calculation trace';
  END IF;

  -- Determinism: identical context → identical result
  IF (public.bn_calc_round_v1(720.925 *
        (public.bn_calc_rate_lookup_v1('ZZ_EPIC0_RATE', '{"benefit_code":"SICK"}'::jsonb,
          DATE '2023-06-01') ->> 'output_value')::numeric,
        'ROUND_HALF_UP') ->> 'rounded_value')::numeric <> 432.56 THEN
    RAISE EXCEPTION 'B2 FAIL: calculation is not deterministic';
  END IF;

  -- =================================================================
  -- Journey H — historical version integrity after succession
  -- =================================================================
  -- The active version's semantics are frozen: only succession is allowed.
  v_failed := false;
  BEGIN
    UPDATE public.bn_formula_version SET expression = '{AVG_INSURABLE_WAGE} * 0.99' WHERE id = v_v1;
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_IMMUTABLE_FORMULA_VERSION%' THEN
    RAISE EXCEPTION 'H1 FAIL: an ACTIVE formula version was destructively editable (%)', v_msg;
  END IF;

  -- Introduce a further successor and prove today's resolution moves on…
  INSERT INTO public.bn_formula_version
    (formula_template_id, formula_code, version_no, expression_type, expression,
     output_variable, rounding_rule, governance_status, effective_from, is_active, entered_by)
  VALUES (c_tpl_a, c_code, 3, 'SIMPLE_EXPRESSION', '{AVG_INSURABLE_WAGE} * 0.70',
          'WEEKLY_RATE', 'ROUND_HALF_UP', 'ACTIVE', DATE '2999-01-01', true, 'HARNESS');

  -- …while the historical trace still points at the version actually used.
  IF NOT EXISTS (
    SELECT 1 FROM public.bn_calc_trace t
    WHERE t.calc_run_id = v_run_live AND t.formula_version_id = v_v1
  ) THEN
    RAISE EXCEPTION 'H2 FAIL: historical trace no longer references the original version';
  END IF;
  IF (public.bn_calc_resolve_formula_version_v1(c_code, DATE '2023-06-01', 'LIVE')
        ->> 'formula_version_id')::uuid <> v_v1 THEN
    RAISE EXCEPTION 'H3 FAIL: historical date resolved to a newer version';
  END IF;

  -- =================================================================
  -- Journey I — simulation safety
  -- =================================================================
  SELECT count(*) INTO v_issue_before   FROM public.bn_issue_record;
  SELECT count(*) INTO v_awards_before  FROM public.bn_award;
  SELECT count(*) INTO v_entitle_before FROM public.bn_entitlement;

  v_run_sim := public.bn_calc_open_run_v1(c_claim, NULL, 'SIMULATION', 'HARNESS', 'KN');
  PERFORM public.bn_calc_record_trace_v1(v_run_sim, jsonb_build_array(
    jsonb_build_object('step_number', 1, 'step_code', 'SIM', 'step_label', 'Simulated evaluation',
                       'output_value', 432.56, 'severity', 'INFO', 'passed', true)));
  v_res := public.bn_calc_finalise_run_v1(v_run_sim, 'COMPLETED', jsonb_build_object('weekly_rate', 432.56));

  IF (v_res ->> 'authoritative')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'I1 FAIL: simulation run reported as authoritative';
  END IF;
  IF (v_res ->> 'advisory') IS NULL THEN
    RAISE EXCEPTION 'I2 FAIL: simulation run carries no non-authoritative advisory';
  END IF;

  SELECT count(*) INTO v_awards_after  FROM public.bn_award;
  SELECT count(*) INTO v_entitle_after FROM public.bn_entitlement;
  IF v_awards_after <> v_awards_before OR v_entitle_after <> v_entitle_before THEN
    RAISE EXCEPTION 'I3 FAIL: simulation mutated award/entitlement state';
  END IF;
  SELECT count(*) INTO v_awards_after FROM public.bn_issue_record;
  IF v_awards_after <> v_issue_before THEN
    RAISE EXCEPTION 'I4 FAIL: simulation created a payment issue record';
  END IF;

  -- =================================================================
  -- Journey J — invalid variable / invalid configuration
  -- =================================================================
  v_vars := public.bn_calc_check_variables_v1('{AVG_INSURABLE_WAGE} * 0.6');
  IF (v_vars ->> 'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'J1 FAIL: registered variable reported unknown: %', v_vars;
  END IF;

  v_vars := public.bn_calc_check_variables_v1('{AVG_INSURABLE_WAGE} + {ZZ_NOT_REGISTERED}');
  IF (v_vars ->> 'ok')::boolean IS NOT FALSE
     OR NOT (v_vars -> 'unknown' @> '["ZZ_NOT_REGISTERED"]'::jsonb) THEN
    RAISE EXCEPTION 'J2 FAIL: unknown variable not detected: %', v_vars;
  END IF;

  v_failed := false;
  BEGIN PERFORM public.bn_calc_check_variables_v1('{ZZ_NOT_REGISTERED}', true);
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_UNKNOWN_VARIABLE%' THEN
    RAISE EXCEPTION 'J3 FAIL: governed unknown-variable error not raised (%)', v_msg;
  END IF;

  -- J4 a failed resolution must not leave a false successful trace behind
  SELECT count(*) INTO v_n FROM public.bn_calc_trace WHERE calc_run_id IS NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'J4 FAIL: orphan trace rows exist'; END IF;

  -- J5 governed configuration writes reject non-DRAFT targets
  v_failed := false;
  BEGIN
    PERFORM public.bn_calc_config_save_formula_version_v1(
      v_v1, 'SIMPLE_EXPRESSION', '{}'::jsonb, '{AVG_INSURABLE_WAGE}', 'HARNESS');
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_IMMUTABLE_FORMULA_VERSION%' THEN
    RAISE EXCEPTION 'J5 FAIL: governed write accepted an ACTIVE version (%)', v_msg;
  END IF;

  -- J6 rows of an ACTIVE rate table cannot be mutated on any path
  v_failed := false;
  BEGIN
    UPDATE public.bn_rate_table_row SET output_value = 9.99
    WHERE rate_table_id = c_rate_tbl AND row_order = 1;
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_IMMUTABLE_RATE_TABLE%' THEN
    RAISE EXCEPTION 'J6 FAIL: ACTIVE rate table row was directly mutable (%)', v_msg;
  END IF;

  -- =====================================================================
  -- Journey K — BUG-14: the immutability guards must actually EXECUTE.
  -- Before the fix, every write aborted with 42501 on _bn_calc_in_boundary
  -- and no business rule was ever evaluated.
  -- =====================================================================

  -- K1 the guard trigger functions must run with owner privileges so that
  --    the boundary check itself is never a permission failure.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('_bn_calc_guard_formula_version', '_bn_calc_guard_rate_table_row')
      AND (NOT p.prosecdef
           OR p.proconfig IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%'))
  ) THEN
    RAISE EXCEPTION 'K1 FAIL: calculation guards are not SECURITY DEFINER with a pinned search_path';
  END IF;

  -- K2 a DRAFT formula version saves through the governed RPC
  SELECT id INTO v_draft_ver FROM public.bn_formula_version
  WHERE formula_code = c_code || '_DRAFTONLY' AND upper(governance_status) = 'DRAFT'
  LIMIT 1;
  IF v_draft_ver IS NULL THEN RAISE EXCEPTION 'K2 FAIL: draft fixture missing'; END IF;
  PERFORM public.bn_calc_config_save_formula_version_v1(
    v_draft_ver, 'SIMPLE_EXPRESSION', '{"expression":"{AVG_INSURABLE_WAGE}"}'::jsonb,
    '{AVG_INSURABLE_WAGE}', 'HARNESS');
  IF (SELECT expression FROM public.bn_formula_version WHERE id = v_draft_ver)
     <> '{AVG_INSURABLE_WAGE}' THEN
    RAISE EXCEPTION 'K2 FAIL: DRAFT formula version did not save through the governed RPC';
  END IF;

  -- K3 a DRAFT formula version is directly editable, and the failure mode is
  --    never a permission error
  v_failed := false;
  BEGIN
    UPDATE public.bn_formula_version SET modified_by = 'HARNESS' WHERE id = v_draft_ver;
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF v_failed THEN
    RAISE EXCEPTION 'K3 FAIL: DRAFT formula version write was refused (%)', v_msg;
  END IF;

  -- K4 deleting a non-DRAFT version is refused with the business message
  v_failed := false;
  BEGIN
    DELETE FROM public.bn_formula_version WHERE id = v_v1;
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_IMMUTABLE_FORMULA_VERSION%' THEN
    RAISE EXCEPTION 'K4 FAIL: non-DRAFT version deletion was not refused with the business message (%)', v_msg;
  END IF;

  -- K5 DRAFT rate table rows save and delete through the governed RPCs
  INSERT INTO public.bn_rate_table (
    id, table_code, table_name, table_type, lookup_strategy, country_code,
    version_no, effective_from, status, entered_by
  ) VALUES (
    gen_random_uuid(), 'ZZ_EPIC0_DRAFT_RATE', 'Epic 0 draft rate table', 'RATE_TABLE',
    'EXACT_MATCH', 'KN', 1, DATE '2020-01-01', 'DRAFT', 'HARNESS'
  ) RETURNING id INTO v_draft_tbl;

  v_draft_row := public.bn_calc_config_save_rate_table_row_v2(
    NULL, v_draft_tbl, 1, '{"benefit_code":"SICK"}'::jsonb, 'RATE_PCT', 0.55,
    NULL, 'RATE', DATE '2020-01-01', NULL, 'harness note', 'HARNESS');
  IF v_draft_row IS NULL THEN RAISE EXCEPTION 'K5 FAIL: DRAFT rate row insert did not return an id'; END IF;

  PERFORM public.bn_calc_config_save_rate_table_row_v2(
    v_draft_row, v_draft_tbl, 1, '{"benefit_code":"SICK"}'::jsonb, 'RATE_PCT', 0.66,
    NULL, 'RATE', DATE '2020-01-01', NULL, 'harness note', 'HARNESS');
  IF (SELECT output_value FROM public.bn_rate_table_row WHERE id = v_draft_row) <> 0.66 THEN
    RAISE EXCEPTION 'K5 FAIL: DRAFT rate row update did not persist';
  END IF;

  PERFORM public.bn_calc_config_delete_rate_table_row_v1(v_draft_row, 'HARNESS');
  IF EXISTS (SELECT 1 FROM public.bn_rate_table_row WHERE id = v_draft_row) THEN
    RAISE EXCEPTION 'K5 FAIL: DRAFT rate row delete did not persist';
  END IF;

  -- K6 the boundary signal cannot be forged by the caller
  PERFORM set_config('bn.calc_boundary', 'on', true);
  v_failed := false;
  BEGIN
    UPDATE public.bn_rate_table_row SET output_value = 9.99
    WHERE rate_table_id = c_rate_tbl AND row_order = 1;
  EXCEPTION WHEN others THEN v_failed := true; v_msg := SQLERRM; END;
  PERFORM set_config('bn.calc_boundary', '', true);
  IF NOT v_failed OR v_msg NOT LIKE 'BN_CALC_IMMUTABLE_RATE_TABLE%' THEN
    RAISE EXCEPTION 'K6 FAIL: a forged boundary flag bypassed the immutability guard (%)', v_msg;
  END IF;

  RAISE NOTICE 'BN_ELIG_CALC_HARNESS_RESULT: PASS';

END
$harness$;

ROLLBACK;

-- =====================================================================
-- Postflight — the disposable database must retain zero harness rows.
-- =====================================================================
DO $postflight$
DECLARE
  v_n bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM public.bn_formula_template WHERE template_code LIKE 'ZZ\_EPIC0\_%')
  + (SELECT count(*) FROM public.bn_formula_version  WHERE formula_code  LIKE 'ZZ\_EPIC0\_%')
  + (SELECT count(*) FROM public.bn_rate_table       WHERE table_code    LIKE 'ZZ\_EPIC0\_%')
  + (SELECT count(*) FROM public.bn_calc_run         WHERE triggered_by  = 'HARNESS')
  + (SELECT count(*) FROM public.bn_formula_variable_registry WHERE created_by = 'HARNESS')
  INTO v_n;

  IF v_n <> 0 THEN
    RAISE EXCEPTION 'BN_ELIG_CALC_POSTFLIGHT_RESULT: FAIL — % harness rows survived rollback', v_n;
  END IF;
  RAISE NOTICE 'BN_ELIG_CALC_POSTFLIGHT_RESULT: PASS';
END
$postflight$;

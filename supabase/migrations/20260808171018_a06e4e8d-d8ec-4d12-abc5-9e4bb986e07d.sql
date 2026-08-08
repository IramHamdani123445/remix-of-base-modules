-- =====================================================================
-- BN Eligibility & Calculation — Epic 0 governed foundation
-- =====================================================================

-- 1. Trace provenance columns (additive, nullable) ---------------------
ALTER TABLE public.bn_calc_trace
  ADD COLUMN IF NOT EXISTS formula_version_id uuid,
  ADD COLUMN IF NOT EXISTS formula_code text,
  ADD COLUMN IF NOT EXISTS formula_version_no integer,
  ADD COLUMN IF NOT EXISTS rounding_rule text,
  ADD COLUMN IF NOT EXISTS unrounded_value numeric,
  ADD COLUMN IF NOT EXISTS lookup_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bn_calc_trace_formula_version
  ON public.bn_calc_trace (formula_version_id);

-- 2. Internal helpers --------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_calc_boundary_enter()
RETURNS void LANGUAGE sql SET search_path = public AS $$
  SELECT set_config('bn.calc_boundary', 'on', true)::void;
$$;

CREATE OR REPLACE FUNCTION public._bn_calc_in_boundary()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(current_setting('bn.calc_boundary', true), 'off') = 'on';
$$;

CREATE OR REPLACE FUNCTION public._bn_calc_num(p_val text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN p_val::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._bn_calc_dim_match(
  p_match_type text, p_row_val jsonb, p_input jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_in numeric; v_min numeric; v_max numeric; v_row numeric;
BEGIN
  IF p_row_val IS NULL OR jsonb_typeof(p_row_val) = 'null' THEN RETURN false; END IF;

  IF upper(coalesce(p_match_type, 'RANGE')) = 'EXACT' THEN
    RETURN (p_row_val #>> '{}') IS NOT DISTINCT FROM (p_input #>> '{}');
  END IF;

  IF upper(p_match_type) = 'IN' THEN
    IF jsonb_typeof(p_row_val) <> 'array' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_row_val) e
      WHERE (e #>> '{}') = (p_input #>> '{}')
    );
  END IF;

  -- RANGE
  v_in := public._bn_calc_num(p_input #>> '{}');
  IF v_in IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p_row_val) = 'object' THEN
    v_min := public._bn_calc_num(p_row_val ->> 'min');
    v_max := public._bn_calc_num(p_row_val ->> 'max');
    RETURN (v_min IS NULL OR v_in >= v_min) AND (v_max IS NULL OR v_in <= v_max);
  END IF;
  v_row := public._bn_calc_num(p_row_val #>> '{}');
  RETURN v_row IS NOT NULL AND v_row = v_in;
END;
$$;

-- 3. Deterministic effective formula/version resolution ----------------
CREATE OR REPLACE FUNCTION public.bn_calc_resolve_formula_version_v1(
  p_formula_code text,
  p_as_of date DEFAULT current_date,
  p_mode text DEFAULT 'LIVE'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode text := upper(coalesce(p_mode, 'LIVE'));
  v_allowed text[];
  v_count int;
  v_row public.bn_formula_version%ROWTYPE;
  v_codes text;
BEGIN
  IF p_formula_code IS NULL OR btrim(p_formula_code) = '' THEN
    RAISE EXCEPTION 'BN_CALC_FORMULA_CODE_REQUIRED';
  END IF;
  IF v_mode NOT IN ('LIVE', 'SIMULATION') THEN
    RAISE EXCEPTION 'BN_CALC_INVALID_MODE: %', p_mode;
  END IF;

  -- Operational calculation may only use governed ACTIVE configuration.
  -- Simulation may additionally preview DRAFT, but never RETIRED.
  v_allowed := CASE WHEN v_mode = 'LIVE'
                    THEN ARRAY['ACTIVE']
                    ELSE ARRAY['ACTIVE', 'DRAFT'] END;

  SELECT count(*) INTO v_count
  FROM public.bn_formula_version v
  WHERE v.formula_code = p_formula_code
    AND v.is_active
    AND upper(v.governance_status) = ANY (v_allowed)
    AND (v.effective_from IS NULL OR v.effective_from <= p_as_of)
    AND (v.effective_to   IS NULL OR v.effective_to   >= p_as_of);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'BN_CALC_NO_EFFECTIVE_FORMULA: % as_of % mode %',
      p_formula_code, p_as_of, v_mode;
  END IF;

  IF v_count > 1 THEN
    -- Simulation may legitimately see one ACTIVE + one DRAFT; it then
    -- previews the DRAFT. Any other multiplicity is ambiguous config.
    SELECT count(*) INTO v_count
    FROM public.bn_formula_version v
    WHERE v.formula_code = p_formula_code
      AND v.is_active
      AND upper(v.governance_status) = 'ACTIVE'
      AND (v.effective_from IS NULL OR v.effective_from <= p_as_of)
      AND (v.effective_to   IS NULL OR v.effective_to   >= p_as_of);

    IF v_mode = 'LIVE' OR v_count > 1 THEN
      SELECT string_agg(v.version_no::text || ':' || v.governance_status, ',' ORDER BY v.version_no)
        INTO v_codes
      FROM public.bn_formula_version v
      WHERE v.formula_code = p_formula_code
        AND v.is_active
        AND upper(v.governance_status) = ANY (v_allowed)
        AND (v.effective_from IS NULL OR v.effective_from <= p_as_of)
        AND (v.effective_to   IS NULL OR v.effective_to   >= p_as_of);
      RAISE EXCEPTION 'BN_CALC_AMBIGUOUS_FORMULA: % as_of % candidates [%]',
        p_formula_code, p_as_of, v_codes;
    END IF;
  END IF;

  SELECT * INTO v_row
  FROM public.bn_formula_version v
  WHERE v.formula_code = p_formula_code
    AND v.is_active
    AND upper(v.governance_status) = ANY (v_allowed)
    AND (v.effective_from IS NULL OR v.effective_from <= p_as_of)
    AND (v.effective_to   IS NULL OR v.effective_to   >= p_as_of)
  ORDER BY CASE WHEN upper(v.governance_status) = 'DRAFT' THEN 0 ELSE 1 END,
           v.version_no DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'formula_code',       v_row.formula_code,
    'formula_version_id', v_row.id,
    'version_no',         v_row.version_no,
    'template_id',        v_row.formula_template_id,
    'expression_type',    v_row.expression_type,
    'expression',         v_row.expression,
    'steps_json',         v_row.steps_json,
    'output_variable',    v_row.output_variable,
    'rounding_rule',      coalesce(v_row.rounding_rule, 'ROUND_HALF_UP'),
    'governance_status',  v_row.governance_status,
    'effective_from',     v_row.effective_from,
    'effective_to',       v_row.effective_to,
    'mode',               v_mode,
    'authoritative',      (v_mode = 'LIVE'),
    'as_of',              p_as_of,
    'resolved_at',        now()
  );
END;
$$;

-- 4. Rate / tier / matrix lookup with ambiguity detection --------------
CREATE OR REPLACE FUNCTION public.bn_calc_rate_lookup_v1(
  p_table_code text,
  p_inputs jsonb,
  p_as_of date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hdr public.bn_rate_table%ROWTYPE;
  v_hdr_count int;
  v_matches uuid[];
  v_row public.bn_rate_table_row%ROWTYPE;
  v_dims jsonb;
BEGIN
  IF p_table_code IS NULL OR btrim(p_table_code) = '' THEN
    RAISE EXCEPTION 'BN_CALC_RATE_TABLE_CODE_REQUIRED';
  END IF;

  SELECT count(*) INTO v_hdr_count
  FROM public.bn_rate_table t
  WHERE t.table_code = p_table_code
    AND upper(t.status) = 'ACTIVE'
    AND (t.effective_from IS NULL OR t.effective_from <= p_as_of)
    AND (t.effective_to   IS NULL OR t.effective_to   >= p_as_of);

  IF v_hdr_count = 0 THEN
    RAISE EXCEPTION 'BN_CALC_RATE_TABLE_NOT_FOUND: % as_of %', p_table_code, p_as_of;
  END IF;
  IF v_hdr_count > 1 THEN
    RAISE EXCEPTION 'BN_CALC_AMBIGUOUS_RATE_TABLE: % as_of % (% active versions in force)',
      p_table_code, p_as_of, v_hdr_count;
  END IF;

  SELECT * INTO v_hdr
  FROM public.bn_rate_table t
  WHERE t.table_code = p_table_code
    AND upper(t.status) = 'ACTIVE'
    AND (t.effective_from IS NULL OR t.effective_from <= p_as_of)
    AND (t.effective_to   IS NULL OR t.effective_to   >= p_as_of);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'dimension_key', d.dimension_key,
           'match_type', d.match_type,
           'sequence_no', d.sequence_no) ORDER BY d.sequence_no), '[]'::jsonb)
    INTO v_dims
  FROM public.bn_rate_table_dimension d
  WHERE d.rate_table_id = v_hdr.id;

  SELECT array_agg(r.id ORDER BY r.row_order) INTO v_matches
  FROM public.bn_rate_table_row r
  WHERE r.rate_table_id = v_hdr.id
    AND (r.effective_from IS NULL OR r.effective_from <= p_as_of)
    AND (r.effective_to   IS NULL OR r.effective_to   >= p_as_of)
    AND NOT EXISTS (
      SELECT 1
      FROM public.bn_rate_table_dimension d
      WHERE d.rate_table_id = v_hdr.id
        AND NOT public._bn_calc_dim_match(
              d.match_type,
              r.dimension_values_json -> d.dimension_key,
              coalesce(p_inputs -> d.dimension_key, 'null'::jsonb))
    );

  IF v_matches IS NULL OR array_length(v_matches, 1) IS NULL THEN
    RAISE EXCEPTION 'BN_CALC_RATE_NO_MATCH: % inputs % as_of %',
      p_table_code, coalesce(p_inputs::text, '{}'), p_as_of;
  END IF;
  IF array_length(v_matches, 1) > 1 THEN
    RAISE EXCEPTION 'BN_CALC_AMBIGUOUS_RATE_MATCH: % matched % rows for inputs %',
      p_table_code, array_length(v_matches, 1), coalesce(p_inputs::text, '{}');
  END IF;

  SELECT * INTO v_row FROM public.bn_rate_table_row r WHERE r.id = v_matches[1];

  RETURN jsonb_build_object(
    'table_code',      v_hdr.table_code,
    'table_id',        v_hdr.id,
    'table_type',      v_hdr.table_type,
    'lookup_mode',     v_hdr.lookup_mode,
    'country_code',    v_hdr.country_code,
    'table_version_no', v_hdr.version_no,
    'dimensions',      v_dims,
    'inputs',          coalesce(p_inputs, '{}'::jsonb),
    'matched_row_id',  v_row.id,
    'matched_row_order', v_row.row_order,
    'output_key',      v_row.output_key,
    'output_value',    v_row.output_value,
    'output_text',     v_row.output_text,
    'output_type',     v_row.output_type,
    'as_of',           p_as_of
  );
END;
$$;

-- 5. Rounding with provenance -----------------------------------------
CREATE OR REPLACE FUNCTION public.bn_calc_round_v1(
  p_value numeric, p_rule text DEFAULT 'ROUND_HALF_UP'
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule text := upper(coalesce(p_rule, 'ROUND_HALF_UP'));
  v_out numeric;
BEGIN
  IF p_value IS NULL THEN RAISE EXCEPTION 'BN_CALC_ROUND_VALUE_REQUIRED'; END IF;
  v_out := CASE v_rule
    WHEN 'NONE'                 THEN p_value
    WHEN 'ROUND_HALF_UP'        THEN round(p_value, 2)
    WHEN 'ROUND_NEAREST_CENT'   THEN round(p_value, 2)
    WHEN 'ROUND_DOWN'           THEN floor(p_value * 100) / 100
    WHEN 'ROUND_UP'             THEN ceil(p_value * 100) / 100
    WHEN 'ROUND_NEAREST_DOLLAR' THEN round(p_value, 0)
    WHEN 'ROUND_DOWN_DOLLAR'    THEN floor(p_value)
    WHEN 'ROUND_UP_DOLLAR'      THEN ceil(p_value)
    ELSE NULL END;
  IF v_out IS NULL THEN
    RAISE EXCEPTION 'BN_CALC_UNKNOWN_ROUNDING_RULE: %', p_rule;
  END IF;
  RETURN jsonb_build_object(
    'unrounded_value', p_value,
    'rounding_rule',   v_rule,
    'rounded_value',   v_out,
    'material',        (v_out <> p_value)
  );
END;
$$;

-- 6. Variable registry check ------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_calc_check_variables_v1(
  p_expression text, p_raise boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tokens text[];
  v_unknown text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_tokens
  FROM regexp_matches(coalesce(p_expression, ''), '\{([A-Za-z_][A-Za-z0-9_]*)\}', 'g') m;

  SELECT coalesce(array_agg(t ORDER BY t), ARRAY[]::text[]) INTO v_unknown
  FROM unnest(v_tokens) t
  WHERE NOT EXISTS (
          SELECT 1 FROM public.bn_formula_variable_registry r
          WHERE r.variable_code = t AND r.is_active)
    AND NOT EXISTS (
          SELECT 1 FROM public.bn_data_field_registry f WHERE f.field_code = t);

  IF p_raise AND array_length(v_unknown, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'BN_CALC_UNKNOWN_VARIABLE: %', array_to_string(v_unknown, ',');
  END IF;

  RETURN jsonb_build_object(
    'referenced', to_jsonb(v_tokens),
    'unknown',    to_jsonb(v_unknown),
    'ok',         (array_length(v_unknown, 1) IS NULL)
  );
END;
$$;

-- 7. Calculation run + trace persistence boundary ----------------------
CREATE OR REPLACE FUNCTION public.bn_calc_open_run_v1(
  p_claim_id uuid,
  p_product_version_id uuid,
  p_mode text,
  p_triggered_by text,
  p_country_code text DEFAULT 'KN'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode text := upper(coalesce(p_mode, 'LIVE'));
  v_id uuid;
BEGIN
  IF v_mode NOT IN ('LIVE', 'SIMULATION', 'PARALLEL') THEN
    RAISE EXCEPTION 'BN_CALC_INVALID_MODE: %', p_mode;
  END IF;
  IF p_claim_id IS NULL THEN RAISE EXCEPTION 'BN_CALC_CLAIM_REQUIRED'; END IF;
  IF p_triggered_by IS NULL OR btrim(p_triggered_by) = '' THEN
    RAISE EXCEPTION 'BN_CALC_ACTOR_REQUIRED';
  END IF;

  INSERT INTO public.bn_calc_run (
    claim_id, product_version_id, run_mode, run_status,
    triggered_by, country_code, entered_by
  ) VALUES (
    p_claim_id, p_product_version_id, v_mode, 'RUNNING',
    p_triggered_by, coalesce(p_country_code, 'KN'), p_triggered_by
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_calc_record_trace_v1(
  p_calc_run_id uuid, p_steps jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bn_calc_run WHERE id = p_calc_run_id) THEN
    RAISE EXCEPTION 'BN_CALC_RUN_NOT_FOUND: %', p_calc_run_id;
  END IF;
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'BN_CALC_TRACE_STEPS_REQUIRED';
  END IF;

  INSERT INTO public.bn_calc_trace (
    calc_run_id, engine_layer, step_number, step_code, step_label,
    rule_code, formula_expression, inputs, output_value, output_text,
    passed, severity, message, duration_ms,
    formula_version_id, formula_code, formula_version_no,
    rounding_rule, unrounded_value, lookup_provenance
  )
  SELECT
    p_calc_run_id,
    coalesce(s ->> 'engine_layer', 'CALCULATION'),
    coalesce((s ->> 'step_number')::int, ord::int),
    coalesce(s ->> 'step_code', 'STEP'),
    coalesce(s ->> 'step_label', coalesce(s ->> 'step_code', 'STEP')),
    s ->> 'rule_code',
    s ->> 'formula_expression',
    coalesce(s -> 'inputs', '{}'::jsonb),
    nullif(s ->> 'output_value', '')::numeric,
    s ->> 'output_text',
    (s ->> 'passed')::boolean,
    coalesce(s ->> 'severity', 'INFO'),
    s ->> 'message',
    nullif(s ->> 'duration_ms', '')::int,
    nullif(s ->> 'formula_version_id', '')::uuid,
    s ->> 'formula_code',
    nullif(s ->> 'formula_version_no', '')::int,
    s ->> 'rounding_rule',
    nullif(s ->> 'unrounded_value', '')::numeric,
    coalesce(s -> 'lookup_provenance', '{}'::jsonb)
  FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS t(s, ord);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_calc_finalise_run_v1(
  p_calc_run_id uuid, p_status text, p_outputs jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.bn_calc_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.bn_calc_run WHERE id = p_calc_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BN_CALC_RUN_NOT_FOUND: %', p_calc_run_id; END IF;
  IF upper(coalesce(p_status, '')) NOT IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'BN_CALC_INVALID_RUN_STATUS: %', p_status;
  END IF;

  UPDATE public.bn_calc_run SET
    run_status   = upper(p_status),
    completed_at = now(),
    modified_at  = now(),
    weekly_rate  = coalesce(nullif(p_outputs ->> 'weekly_rate','')::numeric, weekly_rate),
    monthly_rate = coalesce(nullif(p_outputs ->> 'monthly_rate','')::numeric, monthly_rate),
    lump_sum     = coalesce(nullif(p_outputs ->> 'lump_sum','')::numeric, lump_sum),
    annual_amount= coalesce(nullif(p_outputs ->> 'annual_amount','')::numeric, annual_amount),
    variables_snapshot = coalesce(p_outputs -> 'variables_snapshot', variables_snapshot),
    errors       = coalesce(p_outputs -> 'errors', errors),
    warnings     = coalesce(p_outputs -> 'warnings', warnings)
  WHERE id = p_calc_run_id;

  RETURN jsonb_build_object(
    'calc_run_id',   p_calc_run_id,
    'run_mode',      v_run.run_mode,
    'run_status',    upper(p_status),
    'authoritative', (upper(v_run.run_mode) = 'LIVE'),
    'advisory',      CASE WHEN upper(v_run.run_mode) = 'LIVE' THEN NULL
                          ELSE 'SIMULATION result — not an approved entitlement, award or payment amount' END
  );
END;
$$;

-- 8. Governed configuration writes -------------------------------------
CREATE OR REPLACE FUNCTION public.bn_calc_config_save_formula_version_v1(
  p_version_id uuid,
  p_expression_type text,
  p_steps_json jsonb,
  p_expression text,
  p_user_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.bn_formula_version%ROWTYPE;
BEGIN
  IF p_user_code IS NULL OR btrim(p_user_code) = '' THEN
    RAISE EXCEPTION 'BN_CALC_ACTOR_REQUIRED';
  END IF;
  SELECT * INTO v_row FROM public.bn_formula_version WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BN_CALC_FORMULA_VERSION_NOT_FOUND: %', p_version_id; END IF;
  IF upper(v_row.governance_status) <> 'DRAFT' THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_FORMULA_VERSION: % is % — create a successor version',
      p_version_id, v_row.governance_status;
  END IF;

  PERFORM public._bn_calc_boundary_enter();
  UPDATE public.bn_formula_version SET
    expression_type = coalesce(p_expression_type, expression_type),
    steps_json      = coalesce(p_steps_json, steps_json),
    expression      = p_expression,
    modified_by     = p_user_code,
    updated_by      = p_user_code,
    updated_at      = now()
  WHERE id = p_version_id;

  RETURN jsonb_build_object('formula_version_id', p_version_id, 'saved_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_calc_config_save_rate_table_row_v1(
  p_row_id uuid,
  p_rate_table_id uuid,
  p_row_order integer,
  p_dimension_values jsonb,
  p_output_key text,
  p_output_value numeric,
  p_output_text text,
  p_output_type text,
  p_effective_from date,
  p_effective_to date,
  p_user_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_id uuid := p_row_id;
BEGIN
  IF p_user_code IS NULL OR btrim(p_user_code) = '' THEN
    RAISE EXCEPTION 'BN_CALC_ACTOR_REQUIRED';
  END IF;
  SELECT upper(status) INTO v_status FROM public.bn_rate_table WHERE id = p_rate_table_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'BN_CALC_RATE_TABLE_NOT_FOUND: %', p_rate_table_id; END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_RATE_TABLE: % is % — create a successor version',
      p_rate_table_id, v_status;
  END IF;

  PERFORM public._bn_calc_boundary_enter();
  IF v_id IS NULL THEN
    INSERT INTO public.bn_rate_table_row (
      rate_table_id, row_order, dimension_values_json, output_key, output_value,
      output_text, output_type, effective_from, effective_to, entered_by
    ) VALUES (
      p_rate_table_id, coalesce(p_row_order, 1), coalesce(p_dimension_values, '{}'::jsonb),
      p_output_key, p_output_value, p_output_text, coalesce(p_output_type, 'AMOUNT'),
      p_effective_from, p_effective_to, p_user_code
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.bn_rate_table_row SET
      row_order = coalesce(p_row_order, row_order),
      dimension_values_json = coalesce(p_dimension_values, dimension_values_json),
      output_key = p_output_key,
      output_value = p_output_value,
      output_text = p_output_text,
      output_type = coalesce(p_output_type, output_type),
      effective_from = p_effective_from,
      effective_to = p_effective_to,
      modified_by = p_user_code,
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BN_CALC_RATE_ROW_NOT_FOUND: %', v_id; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_calc_config_delete_rate_table_row_v1(
  p_row_id uuid, p_user_code text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF p_user_code IS NULL OR btrim(p_user_code) = '' THEN
    RAISE EXCEPTION 'BN_CALC_ACTOR_REQUIRED';
  END IF;
  SELECT upper(t.status) INTO v_status
  FROM public.bn_rate_table_row r JOIN public.bn_rate_table t ON t.id = r.rate_table_id
  WHERE r.id = p_row_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'BN_CALC_RATE_ROW_NOT_FOUND: %', p_row_id; END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_RATE_TABLE: parent table is % — rows are historical', v_status;
  END IF;
  PERFORM public._bn_calc_boundary_enter();
  DELETE FROM public.bn_rate_table_row WHERE id = p_row_id;
END;
$$;

-- 9. Immutability guards (enforced on every path) ----------------------
CREATE OR REPLACE FUNCTION public._bn_calc_guard_formula_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public._bn_calc_in_boundary() THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF upper(OLD.governance_status) <> 'DRAFT' THEN
      RAISE EXCEPTION 'BN_CALC_IMMUTABLE_FORMULA_VERSION: cannot delete % version %',
        OLD.governance_status, OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  -- Governance transitions (status/effective dates) remain the lifecycle
  -- RPCs' responsibility; the calculation semantics must never change.
  IF upper(OLD.governance_status) <> 'DRAFT'
     AND (NEW.expression IS DISTINCT FROM OLD.expression
       OR NEW.steps_json IS DISTINCT FROM OLD.steps_json
       OR NEW.expression_type IS DISTINCT FROM OLD.expression_type
       OR NEW.output_variable IS DISTINCT FROM OLD.output_variable
       OR NEW.rounding_rule IS DISTINCT FROM OLD.rounding_rule) THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_FORMULA_VERSION: % version % semantics are frozen — use versioned succession',
      OLD.governance_status, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bn_calc_guard_formula_version ON public.bn_formula_version;
CREATE TRIGGER trg_bn_calc_guard_formula_version
  BEFORE UPDATE OR DELETE ON public.bn_formula_version
  FOR EACH ROW EXECUTE FUNCTION public._bn_calc_guard_formula_version();

CREATE OR REPLACE FUNCTION public._bn_calc_guard_rate_table_row()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_status text;
  v_table uuid;
BEGIN
  IF public._bn_calc_in_boundary() THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_table := CASE TG_OP WHEN 'DELETE' THEN OLD.rate_table_id ELSE NEW.rate_table_id END;
  SELECT upper(status) INTO v_status FROM public.bn_rate_table WHERE id = v_table;
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_RATE_TABLE: table % is % — use the governed boundary and versioned succession',
      v_table, v_status;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_bn_calc_guard_rate_table_row ON public.bn_rate_table_row;
CREATE TRIGGER trg_bn_calc_guard_rate_table_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.bn_rate_table_row
  FOR EACH ROW EXECUTE FUNCTION public._bn_calc_guard_rate_table_row();

-- 10. Grants -----------------------------------------------------------
REVOKE ALL ON FUNCTION public._bn_calc_boundary_enter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_in_boundary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_num(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_dim_match(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_guard_formula_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_guard_rate_table_row() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.bn_calc_resolve_formula_version_v1(text, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_rate_lookup_v1(text, jsonb, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_round_v1(numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_check_variables_v1(text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_open_run_v1(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_record_trace_v1(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_finalise_run_v1(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_config_save_formula_version_v1(uuid, text, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_config_save_rate_table_row_v1(uuid, uuid, integer, jsonb, text, numeric, text, text, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_calc_config_delete_rate_table_row_v1(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bn_calc_resolve_formula_version_v1(text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_rate_lookup_v1(text, jsonb, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_round_v1(numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_check_variables_v1(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_open_run_v1(uuid, uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_record_trace_v1(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_finalise_run_v1(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_config_save_formula_version_v1(uuid, text, jsonb, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_config_save_rate_table_row_v1(uuid, uuid, integer, jsonb, text, numeric, text, text, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_calc_config_delete_rate_table_row_v1(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.bn_calc_resolve_formula_version_v1(text, date, text) IS
  'BN Eligibility & Calculation Epic 0 — authoritative effective formula/version resolution. Exactly one version or an explicit governed failure.';
COMMENT ON FUNCTION public.bn_calc_rate_lookup_v1(text, jsonb, date) IS
  'BN Eligibility & Calculation Epic 0 — authoritative rate/tier/matrix lookup with ambiguity detection and lookup provenance.';
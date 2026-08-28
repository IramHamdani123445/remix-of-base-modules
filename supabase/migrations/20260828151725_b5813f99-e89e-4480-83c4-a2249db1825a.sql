-- Stage 1B: Internal Audit planning engine defect fixes (DEF-S1B-02 effort units, DEF-S1B-03 fiscal-year slotting)
INSERT INTO public.ia_planning_parameters (parameter_key, parameter_group, value_json, value_type, scope_type, is_active, change_reason, created_by)
SELECT 'planning_hours_per_day', 'capacity', '{"value": 7.5}'::jsonb, 'numeric', 'global', true,
       'Stage 1B DEF-S1B-02: explicit working hours per audit day for effort conversion', 'STAGE_1B'
WHERE NOT EXISTS (SELECT 1 FROM public.ia_planning_parameters WHERE parameter_key = 'planning_hours_per_day' AND scope_type = 'global');

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- 1) ia_generate_auto_plan_candidates
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'ia_generate_auto_plan_candidates'
    AND pronamespace = 'public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'ia_generate_auto_plan_candidates not found'; END IF;

  v_new := v_def;

  IF position('v_hours_per_day' in v_new) = 0 THEN
    v_new := replace(v_new,
      '  v_coverage text;' || chr(10),
      '  v_coverage text;' || chr(10) ||
      '  v_hours_per_day numeric := 7.5;' || chr(10) ||
      '  v_plan_year integer;' || chr(10));

    v_new := replace(v_new,
      '  DELETE FROM public.ia_planning_score_explanations WHERE plan_id = p_plan_id;',
      '  v_param := ia_resolve_planning_parameter(''planning_hours_per_day'', p_plan_id);' || chr(10) ||
      '  v_hours_per_day := COALESCE(NULLIF(v_param->>''value'', '''')::numeric, 7.5);' || chr(10) || chr(10) ||
      '  SELECT COALESCE(NULLIF(regexp_replace(COALESCE(p_fiscal_year, ap.fiscal_year, ''''), ''[^0-9]'', '''', ''g''), '''')::integer,' || chr(10) ||
      '                  EXTRACT(YEAR FROM CURRENT_DATE)::integer)' || chr(10) ||
      '    INTO v_plan_year' || chr(10) ||
      '  FROM public.ia_annual_plans ap WHERE ap.id = p_plan_id;' || chr(10) ||
      '  v_plan_year := COALESCE(v_plan_year,' || chr(10) ||
      '                          NULLIF(regexp_replace(COALESCE(p_fiscal_year, ''''), ''[^0-9]'', '''', ''g''), '''')::integer,' || chr(10) ||
      '                          EXTRACT(YEAR FROM CURRENT_DATE)::integer);' || chr(10) || chr(10) ||
      '  DELETE FROM public.ia_planning_score_explanations WHERE plan_id = p_plan_id;');
  END IF;

  v_new := replace(v_new, '(EXTRACT(YEAR FROM CURRENT_DATE)::text || ''-', '(v_plan_year::text || ''-');
  v_new := replace(v_new, 'CEIL(v_est_days / 5.0)', 'CEIL(v_est_days * v_hours_per_day)');

  IF v_new = v_def THEN
    RAISE NOTICE 'ia_generate_auto_plan_candidates already patched';
  ELSE
    EXECUTE v_new;
  END IF;

  -- 2) ia_convert_candidates_to_engagements
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'ia_convert_candidates_to_engagements'
    AND pronamespace = 'public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'ia_convert_candidates_to_engagements not found'; END IF;

  v_new := replace(v_def,
    'COALESCE(v_candidate.suggested_hours, CEIL(v_est_days / 5.0))',
    'COALESCE(NULLIF(v_candidate.suggested_hours, 0), CEIL(v_est_days * COALESCE(NULLIF((ia_resolve_planning_parameter(''planning_hours_per_day'', p_plan_id)->>''value''), '''')::numeric, 7.5)))');

  IF v_new = v_def THEN
    RAISE NOTICE 'ia_convert_candidates_to_engagements already patched';
  ELSE
    EXECUTE v_new;
  END IF;
END
$mig$;

-- Verification: neither planning function may still divide days by 5 to derive hours
DO $chk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname IN ('ia_generate_auto_plan_candidates', 'ia_convert_candidates_to_engagements')
      AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%v_est_days / 5.0%'
  ) THEN
    RAISE EXCEPTION 'DEF-S1B-02 fix did not apply: effort-hours division still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'ia_generate_auto_plan_candidates'
      AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%(EXTRACT(YEAR FROM CURRENT_DATE)::text || ''-01-01'')%'
  ) THEN
    RAISE EXCEPTION 'DEF-S1B-03 fix did not apply: planning slots still anchored to current year';
  END IF;
END
$chk$;
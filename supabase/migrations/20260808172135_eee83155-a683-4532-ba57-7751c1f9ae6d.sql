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
          SELECT 1 FROM public.bn_data_field_registry f
          WHERE upper(f.column_name) = upper(t) AND f.active);

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

REVOKE ALL ON FUNCTION public.bn_calc_check_variables_v1(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_calc_check_variables_v1(text, boolean) TO authenticated, service_role;
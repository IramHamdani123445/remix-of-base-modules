CREATE OR REPLACE FUNCTION public.platform_environment_consistency(p_expected_project_ref text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runtime text;
  v_marker public.platform_environment_marker%ROWTYPE;
  v_status text := 'PASS';
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  v_runtime := public.omni_comms_priv_runtime_environment();
  SELECT * INTO v_marker FROM public.platform_environment_marker WHERE id;

  IF v_marker.environment_kind IS NULL THEN
    v_status := 'ENVIRONMENT_MARKER_MISSING';
    v_reasons := array_append(v_reasons, 'marker row absent'::text);
  ELSE
    IF v_marker.environment_kind = 'PRODUCTION' AND v_runtime <> 'production' THEN
      v_status := 'ENVIRONMENT_CLASSIFICATION_CONFLICT';
      v_reasons := array_append(v_reasons, ('marker PRODUCTION vs runtime ' || v_runtime)::text);
    END IF;
    IF v_marker.environment_kind <> 'PRODUCTION' AND v_runtime = 'production' THEN
      v_status := 'ENVIRONMENT_CLASSIFICATION_CONFLICT';
      v_reasons := array_append(v_reasons, 'non-production marker vs runtime production'::text);
    END IF;
    IF v_marker.allows_controlled_test_activation AND v_runtime <> 'non_production' THEN
      v_status := 'ENVIRONMENT_CLASSIFICATION_CONFLICT';
      v_reasons := array_append(v_reasons, 'controlled activation granted outside non_production runtime'::text);
    END IF;
    IF p_expected_project_ref IS NOT NULL
       AND btrim(p_expected_project_ref) <> coalesce(v_marker.project_ref, '') THEN
      v_status := 'ENVIRONMENT_PROJECT_REF_MISMATCH';
      v_reasons := array_append(v_reasons, 'marker project_ref does not bind to the running backend'::text);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'runtime_environment', v_runtime,
    'marker_environment_kind', v_marker.environment_kind,
    'marker_environment_label', v_marker.environment_label,
    'marker_project_ref', v_marker.project_ref,
    'allows_controlled_test_activation', coalesce(v_marker.allows_controlled_test_activation, false),
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_environment_consistency(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_environment_consistency(text) TO authenticated, service_role;
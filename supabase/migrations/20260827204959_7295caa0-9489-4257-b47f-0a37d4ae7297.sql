-- Governed environment marker configuration path (auditable, idempotent, fail-closed)

CREATE TABLE IF NOT EXISTS public.platform_environment_marker_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  from_state jsonb,
  to_state jsonb NOT NULL,
  reason text,
  correlation_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.platform_environment_marker_event FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.platform_environment_marker_event TO authenticated;
GRANT ALL ON TABLE public.platform_environment_marker_event TO service_role;

ALTER TABLE public.platform_environment_marker_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_environment_marker_event_read ON public.platform_environment_marker_event;
CREATE POLICY platform_environment_marker_event_read
  ON public.platform_environment_marker_event
  FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.platform_environment_marker_configure(
  p_actor_id uuid,
  p_environment_kind text,
  p_environment_label text,
  p_project_ref text,
  p_allows_controlled_test_activation boolean,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_label text;
  v_ref text;
  v_allows boolean;
  v_from jsonb;
  v_to jsonb;
  v_changed boolean;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'platform: environment marker configuration requires an actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (public.has_permission(p_actor_id, 'omni_comms', 'operate')
          AND public.has_permission(p_actor_id, 'omni_comms', 'configure')) THEN
    RAISE EXCEPTION 'platform: environment marker configuration requires privileged capability'
      USING ERRCODE = '42501';
  END IF;

  v_kind := upper(btrim(coalesce(p_environment_kind, '')));
  IF v_kind NOT IN ('PRODUCTION','TEST','LOCAL','CI') THEN
    RAISE EXCEPTION 'platform: invalid environment_kind'
      USING ERRCODE = '22023';
  END IF;

  v_label := btrim(coalesce(p_environment_label, ''));
  IF v_label = '' OR length(v_label) > 200 THEN
    RAISE EXCEPTION 'platform: environment_label must be a bounded non-empty string'
      USING ERRCODE = '22023';
  END IF;

  v_ref := btrim(coalesce(p_project_ref, ''));
  IF v_ref = '' OR length(v_ref) > 120 THEN
    RAISE EXCEPTION 'platform: project_ref is required'
      USING ERRCODE = '22023';
  END IF;

  v_allows := coalesce(p_allows_controlled_test_activation, false);

  -- Fail closed: controlled test activation can never be granted to PRODUCTION.
  IF v_allows AND v_kind = 'PRODUCTION' THEN
    RAISE EXCEPTION 'platform: controlled test activation is not permitted for PRODUCTION environments'
      USING ERRCODE = '22023';
  END IF;

  -- Fail closed: a TEST marker granting controlled activation must agree with the
  -- governed runtime classification of this very backend.
  IF v_allows AND public.omni_comms_priv_runtime_environment() <> 'non_production' THEN
    RAISE EXCEPTION 'platform: ENVIRONMENT_CLASSIFICATION_CONFLICT - runtime environment is not non_production'
      USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(m) INTO v_from FROM public.platform_environment_marker m WHERE m.id;

  INSERT INTO public.platform_environment_marker AS m
    (id, environment_kind, environment_label, project_ref, allows_controlled_test_activation, notes)
  VALUES (true, v_kind, v_label, v_ref, v_allows, left(coalesce(p_reason, ''), 1000))
  ON CONFLICT (id) DO UPDATE
    SET environment_kind = EXCLUDED.environment_kind,
        environment_label = EXCLUDED.environment_label,
        project_ref = EXCLUDED.project_ref,
        allows_controlled_test_activation = EXCLUDED.allows_controlled_test_activation,
        notes = EXCLUDED.notes;

  SELECT to_jsonb(m) INTO v_to FROM public.platform_environment_marker m WHERE m.id;

  v_changed := v_from IS NULL
    OR (v_from - 'updated_at' - 'created_at') IS DISTINCT FROM (v_to - 'updated_at' - 'created_at');

  IF v_changed THEN
    INSERT INTO public.platform_environment_marker_event
      (actor_id, from_state, to_state, reason, correlation_id)
    VALUES (p_actor_id, v_from, v_to, left(coalesce(p_reason, ''), 500),
            left(coalesce(p_correlation_id, ''), 120));
  END IF;

  RETURN jsonb_build_object('marker', v_to, 'previous', v_from, 'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_environment_marker_configure(uuid, text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_environment_marker_configure(uuid, text, text, text, boolean, text, text) TO service_role;

-- Environment consistency evaluator (read-only, safe for authenticated diagnostics)
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
    v_reasons := v_reasons || 'marker row absent';
  ELSE
    IF v_marker.environment_kind = 'PRODUCTION' AND v_runtime <> 'production' THEN
      v_status := 'ENVIRONMENT_CLASSIFICATION_CONFLICT';
      v_reasons := v_reasons || 'marker PRODUCTION vs runtime ' || v_runtime;
    END IF;
    IF v_marker.environment_kind <> 'PRODUCTION' AND v_runtime = 'production' THEN
      v_status := 'ENVIRONMENT_CLASSIFICATION_CONFLICT';
      v_reasons := v_reasons || 'non-production marker vs runtime production';
    END IF;
    IF v_marker.allows_controlled_test_activation AND v_runtime <> 'non_production' THEN
      v_status := 'ENVIRONMENT_CLASSIFICATION_CONFLICT';
      v_reasons := v_reasons || 'controlled activation granted outside non_production runtime';
    END IF;
    IF p_expected_project_ref IS NOT NULL
       AND btrim(p_expected_project_ref) <> coalesce(v_marker.project_ref, '') THEN
      v_status := 'ENVIRONMENT_PROJECT_REF_MISMATCH';
      v_reasons := v_reasons || 'marker project_ref does not bind to the running backend';
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

COMMENT ON FUNCTION public.platform_environment_marker_configure(uuid, text, text, text, boolean, text, text) IS
  'Governed, permission-checked, idempotent, fail-closed configuration path for the singleton platform_environment_marker. service_role only; never callable from the browser.';
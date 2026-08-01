CREATE TABLE IF NOT EXISTS public.omni_comms_runtime_certification (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  certification_state text NOT NULL DEFAULT 'pending'
    CHECK (certification_state IN ('pending', 'certified', 'failed')),
  certified_commit text NULL CHECK (certified_commit IS NULL OR certified_commit ~ '^[0-9a-f]{40}$'),
  workflow_run_id text NULL CHECK (workflow_run_id IS NULL OR length(workflow_run_id) <= 200),
  certified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_runtime_certification_certified_complete CHECK (
    (certification_state = 'certified'
      AND certified_commit IS NOT NULL
      AND workflow_run_id IS NOT NULL
      AND certified_at IS NOT NULL)
    OR (certification_state = 'pending'
      AND certified_commit IS NULL
      AND certified_at IS NULL)
    OR certification_state = 'failed'
  )
);

REVOKE ALL ON public.omni_comms_runtime_certification FROM PUBLIC;
REVOKE ALL ON public.omni_comms_runtime_certification FROM anon;
REVOKE ALL ON public.omni_comms_runtime_certification FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.omni_comms_runtime_certification TO service_role;

ALTER TABLE public.omni_comms_runtime_certification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_runtime_certification FORCE ROW LEVEL SECURITY;

INSERT INTO public.omni_comms_runtime_certification (singleton, certification_state)
VALUES (true, 'pending')
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_runtime_certification()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_count integer;
  v_state text;
  v_commit text;
  v_run text;
  v_at timestamptz;
  v_commit_valid boolean;
BEGIN
  BEGIN
    SELECT count(*) INTO v_count FROM public.omni_comms_runtime_certification;
    IF v_count <> 1 THEN
      RETURN jsonb_build_object(
        'certification_state', 'pending',
        'certified_commit', NULL,
        'certified_commit_valid', false,
        'workflow_run_id', NULL,
        'certified_at', NULL,
        'effective_certified', false
      );
    END IF;
    SELECT lower(btrim(coalesce(certification_state, ''))),
           lower(btrim(coalesce(certified_commit, ''))),
           workflow_run_id,
           certified_at
      INTO v_state, v_commit, v_run, v_at
      FROM public.omni_comms_runtime_certification
     WHERE singleton;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'certification_state', 'pending',
      'certified_commit', NULL,
      'certified_commit_valid', false,
      'workflow_run_id', NULL,
      'certified_at', NULL,
      'effective_certified', false
    );
  END;

  IF v_state IS NULL OR v_state NOT IN ('pending', 'certified', 'failed') THEN
    v_state := 'pending';
  END IF;

  v_commit_valid := v_commit ~ '^[0-9a-f]{40}$';
  IF NOT v_commit_valid THEN
    v_commit := NULL;
  END IF;

  RETURN jsonb_build_object(
    'certification_state', v_state,
    'certified_commit', v_commit,
    'certified_commit_valid', v_commit_valid,
    'workflow_run_id', v_run,
    'certified_at', v_at,
    'effective_certified', (v_state = 'certified' AND v_commit_valid AND v_run IS NOT NULL AND v_at IS NOT NULL)
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_runtime_certification() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_certification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_certification() FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_certification() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_runtime_certification() TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_runtime_certification(
  p_certification_state text,
  p_certified_commit text DEFAULT NULL,
  p_workflow_run_id text DEFAULT NULL,
  p_certified_at timestamptz DEFAULT NULL,
  p_deployed_revision text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_state text;
  v_commit text;
  v_deployed text;
  v_run text;
  v_at timestamptz;
  v_env text;
BEGIN
  v_state := lower(btrim(coalesce(p_certification_state, '')));
  v_commit := lower(btrim(coalesce(p_certified_commit, '')));
  v_deployed := lower(btrim(coalesce(p_deployed_revision, '')));
  v_run := nullif(btrim(coalesce(p_workflow_run_id, '')), '');
  v_at := p_certified_at;

  IF v_state NOT IN ('pending', 'certified', 'failed') THEN
    RAISE EXCEPTION 'omni_comms: invalid certification state' USING ERRCODE = '22023';
  END IF;

  IF v_run IS NOT NULL AND length(v_run) > 200 THEN
    RAISE EXCEPTION 'omni_comms: workflow run id exceeds bounded length' USING ERRCODE = '22023';
  END IF;

  IF v_state = 'pending' THEN
    IF v_commit <> '' OR v_at IS NOT NULL THEN
      RAISE EXCEPTION 'omni_comms: pending certification must not carry a commit or timestamp'
        USING ERRCODE = '22023';
    END IF;
    v_commit := NULL;
  ELSIF v_state = 'failed' THEN
    IF v_commit <> '' AND v_commit !~ '^[0-9a-f]{40}$' THEN
      RAISE EXCEPTION 'omni_comms: attempted commit must be a full 40-character sha'
        USING ERRCODE = '22023';
    END IF;
    v_commit := nullif(v_commit, '');
  ELSE
    IF v_commit !~ '^[0-9a-f]{40}$' THEN
      RAISE EXCEPTION 'omni_comms: certified commit must be a full 40-character sha'
        USING ERRCODE = '22023';
    END IF;
    IF v_run IS NULL THEN
      RAISE EXCEPTION 'omni_comms: certified record requires a workflow run id'
        USING ERRCODE = '22023';
    END IF;
    IF v_at IS NULL THEN
      RAISE EXCEPTION 'omni_comms: certified record requires a certification timestamp'
        USING ERRCODE = '22023';
    END IF;
    IF v_deployed !~ '^[0-9a-f]{40}$' OR v_deployed <> v_commit THEN
      RAISE EXCEPTION 'omni_comms: certified commit must equal the deployed revision'
        USING ERRCODE = '22023';
    END IF;
    v_env := public.omni_comms_priv_runtime_environment();
    IF v_env IS DISTINCT FROM 'non_production' THEN
      RAISE EXCEPTION 'omni_comms: certification may only be recorded in a non_production environment'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.omni_comms_runtime_certification
    (singleton, certification_state, certified_commit, workflow_run_id, certified_at, updated_at)
  VALUES (true, v_state, v_commit, v_run, CASE WHEN v_state = 'certified' THEN v_at ELSE NULL END, now())
  ON CONFLICT (singleton) DO UPDATE
    SET certification_state = EXCLUDED.certification_state,
        certified_commit = EXCLUDED.certified_commit,
        workflow_run_id = EXCLUDED.workflow_run_id,
        certified_at = EXCLUDED.certified_at,
        updated_at = now();

  DELETE FROM public.omni_comms_runtime_certification WHERE singleton IS DISTINCT FROM true;

  RETURN public.omni_comms_priv_runtime_certification();
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_record_runtime_certification(text, text, text, timestamptz, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_record_runtime_certification(text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_record_runtime_certification(text, text, text, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_record_runtime_certification(text, text, text, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_record_runtime_certification(text, text, text, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_certification_posture()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cert jsonb;
  v_state text;
  v_commit text;
  v_env text;
  v_commit_valid boolean;
BEGIN
  -- Certification state and certified commit have EXACTLY ONE authoritative
  -- source: the protected singleton certification record. No GUC, no fallback.
  v_cert := public.omni_comms_priv_runtime_certification();
  v_state := coalesce(v_cert->>'certification_state', 'pending');
  v_commit := lower(btrim(coalesce(v_cert->>'certified_commit', '')));

  -- Environment has EXACTLY ONE authoritative source: the protected
  -- singleton configuration record. There is no GUC and no fallback.
  v_env := public.omni_comms_priv_runtime_environment();

  IF v_state NOT IN ('certified', 'pending', 'failed') THEN
    v_state := 'pending';
  END IF;

  IF v_env NOT IN ('production', 'non_production') THEN
    v_env := 'unknown';
  END IF;

  v_commit_valid := v_commit ~ '^[0-9a-f]{40}$';
  IF NOT v_commit_valid THEN
    v_commit := NULL;
  END IF;

  RETURN jsonb_build_object(
    'certification_state', v_state,
    'certified_commit', v_commit,
    'certified_commit_valid', v_commit_valid,
    'workflow_run_id', v_cert->>'workflow_run_id',
    'certified_at', v_cert->>'certified_at',
    'environment', v_env,
    'effective_certified', (v_state = 'certified' AND v_commit_valid AND coalesce((v_cert->>'effective_certified')::boolean, false))
  );
END;
$function$;
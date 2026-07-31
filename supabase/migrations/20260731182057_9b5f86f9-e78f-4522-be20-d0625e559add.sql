CREATE TABLE IF NOT EXISTS public.omni_comms_runtime_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL DEFAULT 'unknown'
    CHECK (environment IN ('unknown', 'non_production', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.omni_comms_runtime_environment FROM PUBLIC;
REVOKE ALL ON public.omni_comms_runtime_environment FROM anon;
REVOKE ALL ON public.omni_comms_runtime_environment FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.omni_comms_runtime_environment TO service_role;

ALTER TABLE public.omni_comms_runtime_environment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_runtime_environment FORCE ROW LEVEL SECURITY;

INSERT INTO public.omni_comms_runtime_environment (singleton, environment)
VALUES (true, 'unknown')
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_runtime_environment()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_env text;
  v_count integer;
BEGIN
  BEGIN
    SELECT count(*) INTO v_count FROM public.omni_comms_runtime_environment;
    IF v_count <> 1 THEN
      RETURN 'unknown';
    END IF;
    SELECT lower(btrim(coalesce(environment, '')))
      INTO v_env
      FROM public.omni_comms_runtime_environment
     WHERE singleton;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'unknown';
  END;

  IF v_env IS NULL OR v_env NOT IN ('non_production', 'production') THEN
    RETURN 'unknown';
  END IF;
  RETURN v_env;
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_runtime_environment() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_environment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_environment() FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_environment() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_runtime_environment() TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_set_runtime_environment(p_environment text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_env text;
BEGIN
  v_env := lower(btrim(coalesce(p_environment, '')));
  IF v_env NOT IN ('unknown', 'non_production', 'production') THEN
    RAISE EXCEPTION 'omni_comms: invalid runtime environment value'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.omni_comms_runtime_environment (singleton, environment, updated_at)
  VALUES (true, v_env, now())
  ON CONFLICT (singleton) DO UPDATE
    SET environment = EXCLUDED.environment,
        updated_at = now();

  DELETE FROM public.omni_comms_runtime_environment WHERE singleton IS DISTINCT FROM true;

  RETURN jsonb_build_object(
    'environment', v_env,
    'updated_at', (SELECT updated_at FROM public.omni_comms_runtime_environment WHERE singleton)
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_set_runtime_environment(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_certification_posture()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_state text;
  v_commit text;
  v_env text;
  v_commit_valid boolean;
BEGIN
  BEGIN
    v_state := lower(btrim(coalesce(current_setting('omni_comms.certification_state', true), '')));
  EXCEPTION WHEN OTHERS THEN v_state := '';
  END;
  BEGIN
    v_commit := lower(btrim(coalesce(current_setting('omni_comms.certified_commit', true), '')));
  EXCEPTION WHEN OTHERS THEN v_commit := '';
  END;

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
    'environment', v_env,
    'effective_certified', (v_state = 'certified' AND v_commit_valid)
  );
END;
$function$;
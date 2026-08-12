ALTER TABLE public.omni_comms_runtime_certification
  ADD COLUMN IF NOT EXISTS observed_runtime_revision text,
  ADD COLUMN IF NOT EXISTS observed_dispatcher_revision text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_runtime_deployment(
  p_runtime_revision text,
  p_dispatcher_revision text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rt text := lower(coalesce(p_runtime_revision, ''));
  v_dp text := lower(coalesce(p_dispatcher_revision, ''));
BEGIN
  IF v_rt !~ '^[0-9a-f]{40}$' THEN v_rt := NULL; END IF;
  IF v_dp !~ '^[0-9a-f]{40}$' THEN v_dp := NULL; END IF;

  UPDATE public.omni_comms_runtime_certification
     SET observed_runtime_revision = v_rt,
         observed_dispatcher_revision = v_dp,
         observed_at = now()
   WHERE singleton;

  RETURN jsonb_build_object(
    'runtime_revision', v_rt,
    'dispatcher_revision', v_dp,
    'observed_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_observed_deployed_revision()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.observed_runtime_revision
  FROM public.omni_comms_runtime_certification c
  WHERE c.singleton
    AND c.observed_at > now() - interval '30 minutes'
    AND c.observed_runtime_revision IS NOT NULL
    AND c.observed_runtime_revision = c.observed_dispatcher_revision;
$function$;

DROP TABLE IF EXISTS public.omni_comms_runtime_deployment;

REVOKE ALL ON FUNCTION public.omni_comms_priv_record_runtime_deployment(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_record_runtime_deployment(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_observed_deployed_revision() TO authenticated, service_role;
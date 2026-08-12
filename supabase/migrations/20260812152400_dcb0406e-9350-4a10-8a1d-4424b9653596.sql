-- (withdrawn) the transient omni_comms_runtime_deployment table was replaced
-- by observation columns on omni_comms_runtime_certification in the next
-- migration; no new registry object is introduced here.

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
  INSERT INTO public.omni_comms_runtime_deployment(singleton, runtime_revision, dispatcher_revision, observed_at)
  VALUES (true, v_rt, v_dp, now())
  ON CONFLICT (singleton) DO UPDATE
    SET runtime_revision = EXCLUDED.runtime_revision,
        dispatcher_revision = EXCLUDED.dispatcher_revision,
        observed_at = EXCLUDED.observed_at;
  RETURN jsonb_build_object('runtime_revision', v_rt, 'dispatcher_revision', v_dp, 'observed_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_record_runtime_deployment(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_record_runtime_deployment(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_observed_deployed_revision()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT d.runtime_revision
  FROM public.omni_comms_runtime_deployment d
  WHERE d.observed_at > now() - interval '30 minutes'
    AND d.runtime_revision IS NOT NULL
    AND d.runtime_revision = d.dispatcher_revision;
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_observed_deployed_revision() TO authenticated, service_role;

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_channel_release_prerequisites';

  IF v_def IS NULL THEN RAISE EXCEPTION 'prerequisites function missing'; END IF;

  v_new := replace(
    v_def,
    'lower(coalesce(p_deployed_revision,''''))',
    'lower(coalesce(p_deployed_revision, public.omni_comms_priv_observed_deployed_revision(), ''''))'
  );

  v_new := replace(
    v_new,
    'CASE WHEN to_regprocedure(''public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)'') IS NOT NULL AND to_regprocedure(''public.omni_comms_priv_dispatch_attempt_complete(uuid,text,text,text,integer,jsonb,text,text)'') IS NOT NULL THEN ''passed'' ELSE ''failed'' END',
    'CASE WHEN public.omni_comms_priv_business_dispatch_installed() THEN ''passed'' ELSE ''failed'' END'
  );

  IF v_new = v_def THEN RAISE EXCEPTION 'prerequisites function did not match expected shape'; END IF;

  EXECUTE v_new;
END $mig$;
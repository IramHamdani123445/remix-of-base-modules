CREATE OR REPLACE FUNCTION public.omni_comms_priv_dry_run_gate_state()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_enabled boolean;
  v_raw text;
BEGIN
  -- Primary source: the existing platform feature-flag configuration surface.
  SELECT f.is_enabled INTO v_enabled
    FROM public.feature_flags f
   WHERE f.flag_key = 'omni_comms.controlled_dry_run'
   LIMIT 1;

  IF FOUND THEN
    RETURN CASE WHEN v_enabled THEN 'enabled' ELSE 'disabled' END;
  END IF;

  -- Fallback: server-side configuration parameter (unset => unavailable).
  BEGIN
    v_raw := lower(btrim(coalesce(current_setting('omni_comms.controlled_dry_run', true), '')));
  EXCEPTION WHEN OTHERS THEN
    v_raw := '';
  END;
  IF v_raw = '' THEN RETURN 'unavailable'; END IF;
  IF v_raw IN ('enabled','on','true','1') THEN RETURN 'enabled'; END IF;
  RETURN 'disabled';
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_dry_run_gate_state() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dry_run_gate_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dry_run_gate_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dry_run_gate_state() TO service_role;

INSERT INTO public.feature_flags (flag_key, display_name, description, is_enabled, rollout_state)
VALUES (
  'omni_comms.controlled_dry_run',
  'Omni-Comms Controlled Dry Run',
  'Permits the Omnichannel Communications administration surface to submit one safe dry-run request. No provider is contacted and no email is sent.',
  true,
  'internal_pilot'
)
ON CONFLICT (flag_key) DO NOTHING;
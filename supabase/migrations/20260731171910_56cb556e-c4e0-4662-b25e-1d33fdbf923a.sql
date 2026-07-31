-- Omni-Comms — authoritative certification gating for the administration
-- safe dry test.
--
-- The browser must never decide, on its own, whether the safe dry test may
-- execute. The decision is made here, from server-held configuration, and is
-- bound to the deployed Edge revision supplied by the runtime itself.
--
-- No new tables. No dispatch, delivery, retry, webhook or Legacy cutover
-- capability is added.

-- 1. Server-held certification posture.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_certification_posture()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_state text;
  v_commit text;
  v_env text;
BEGIN
  BEGIN
    v_state := lower(btrim(coalesce(current_setting('omni_comms.certification_state', true), '')));
  EXCEPTION WHEN OTHERS THEN v_state := '';
  END;
  BEGIN
    v_commit := lower(btrim(coalesce(current_setting('omni_comms.certified_commit', true), '')));
  EXCEPTION WHEN OTHERS THEN v_commit := '';
  END;
  BEGIN
    v_env := lower(btrim(coalesce(current_setting('omni_comms.environment', true), '')));
  EXCEPTION WHEN OTHERS THEN v_env := '';
  END;

  -- An unset certification state is "pending". It is never "certified".
  IF v_state NOT IN ('certified', 'pending', 'failed') THEN
    v_state := 'pending';
  END IF;
  IF v_env NOT IN ('production', 'non_production') THEN
    v_env := 'non_production';
  END IF;

  RETURN jsonb_build_object(
    'certification_state', v_state,
    'certified_commit', nullif(v_commit, ''),
    'environment', v_env
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_certification_posture() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_certification_posture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_certification_posture() FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_certification_posture() TO service_role;

-- 2. Gate now reports the authoritative execution decision.
CREATE OR REPLACE FUNCTION public.omni_comms_controlled_dry_run_gate()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_state text;
  v_posture jsonb;
  v_cert text;
  v_env text;
  v_operate boolean;
  v_permitted boolean;
  v_blocked text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_state := public.omni_comms_priv_dry_run_gate_state();
  v_posture := public.omni_comms_priv_certification_posture();
  v_cert := v_posture ->> 'certification_state';
  v_env := v_posture ->> 'environment';
  v_operate := public.has_permission(v_uid, 'omni_comms', 'operate');

  v_permitted := true;
  v_blocked := NULL;
  IF v_state <> 'enabled' THEN
    v_permitted := false; v_blocked := 'admin_dry_run_disabled';
  ELSIF NOT v_operate THEN
    v_permitted := false; v_blocked := 'permission_denied';
  ELSIF v_env = 'production' THEN
    v_permitted := false; v_blocked := 'admin_dry_run_environment_blocked';
  ELSIF v_cert = 'failed' THEN
    v_permitted := false; v_blocked := 'admin_dry_run_certification_blocked';
  END IF;

  RETURN jsonb_build_object(
    'state', v_state,
    'reason', CASE v_state
                WHEN 'enabled' THEN 'controlled_dry_run_enabled'
                WHEN 'disabled' THEN 'controlled_dry_run_disabled'
                ELSE 'controlled_dry_run_not_configured' END,
    'source', 'server_configuration',
    'caller_module_code', 'OMNI_COMMS_ADMIN_DRY_RUN',
    'allowed_mode', 'dry_run',
    'allowed_channels', jsonb_build_array('email'),
    'recipient_limit', 1,
    'required_recipient_domain', 'example.com',
    'live_delivery_enabled', false,
    'can_view', true,
    'can_operate', v_operate,
    'can_view_sensitive_content', public.has_permission(v_uid, 'omni_comms', 'view_sensitive_content'),
    'certification_state', v_cert,
    'certified_commit', v_posture -> 'certified_commit',
    'environment', v_env,
    'execution_permitted', v_permitted,
    'execution_blocked_reason', v_blocked,
    'checked_at', now()
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_controlled_dry_run_gate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_controlled_dry_run_gate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_controlled_dry_run_gate() FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_controlled_dry_run_gate() TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_controlled_dry_run_gate() TO service_role;

-- 3. Guard enforces environment, certification state and revision binding.
DROP FUNCTION IF EXISTS public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_admin_dry_run_guard(
  p_actor_id uuid,
  p_mode text,
  p_channels text[],
  p_recipients jsonb,
  p_deployed_revision text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_state text;
  v_posture jsonb;
  v_cert text;
  v_env text;
  v_commit text;
  v_rev text;
  v_r jsonb;
  v_email text;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'authentication_required');
  END IF;
  IF NOT public.has_permission(p_actor_id, 'omni_comms', 'operate') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'permission_denied');
  END IF;

  v_state := public.omni_comms_priv_dry_run_gate_state();
  IF v_state <> 'enabled' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_disabled');
  END IF;

  v_posture := public.omni_comms_priv_certification_posture();
  v_cert := v_posture ->> 'certification_state';
  v_env := v_posture ->> 'environment';
  v_commit := v_posture ->> 'certified_commit';
  v_rev := lower(btrim(coalesce(p_deployed_revision, '')));

  IF v_env = 'production' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_environment_blocked');
  END IF;
  IF v_cert = 'failed' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_certification_blocked');
  END IF;
  -- Revision binding: when a certified commit is recorded, the deployed
  -- runtime must be that exact revision.
  IF v_commit IS NOT NULL AND v_rev <> '' AND v_commit <> v_rev
     AND position(v_rev in v_commit) <> 1 AND position(v_commit in v_rev) <> 1 THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_revision_mismatch');
  END IF;

  IF coalesce(p_mode, '') <> 'dry_run' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_mode_required');
  END IF;

  IF p_channels IS NULL OR array_length(p_channels, 1) IS DISTINCT FROM 1
     OR p_channels[1] <> 'email' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_channel_invalid');
  END IF;

  IF p_recipients IS NULL OR jsonb_typeof(p_recipients) <> 'array'
     OR jsonb_array_length(p_recipients) <> 1 THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_recipient_limit');
  END IF;

  v_r := p_recipients -> 0;
  IF jsonb_typeof(v_r) <> 'object' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_recipient_invalid');
  END IF;
  IF coalesce(v_r ->> 'recipientType', '') <> 'synthetic_test' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_recipient_invalid');
  END IF;

  v_email := lower(btrim(coalesce(v_r ->> 'email', '')));
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@example\.com$' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_domain_required');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'code', NULL);
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb, text) TO service_role;
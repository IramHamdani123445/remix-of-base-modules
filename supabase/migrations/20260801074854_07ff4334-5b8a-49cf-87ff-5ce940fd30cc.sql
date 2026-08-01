-- Require effective_certified throughout the server certification gate.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_runtime_health_posture(p_deployed_revision text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_posture jsonb;
  v_cert text;
  v_env text;
  v_commit text;
  v_commit_valid boolean;
  v_effective boolean;
  v_rev text;
  v_rev_verified boolean;
  v_match text;
  v_permitted boolean;
  v_reason text;
  v_gate text;
BEGIN
  v_posture := public.omni_comms_priv_certification_posture();
  v_cert := v_posture ->> 'certification_state';
  v_env := v_posture ->> 'environment';
  v_commit := v_posture ->> 'certified_commit';
  v_commit_valid := coalesce((v_posture ->> 'certified_commit_valid')::boolean, false);
  v_effective := coalesce((v_posture ->> 'effective_certified')::boolean, false);
  v_rev := lower(btrim(coalesce(p_deployed_revision, '')));
  v_rev_verified := v_rev ~ '^[0-9a-f]{40}$';
  v_gate := public.omni_comms_priv_dry_run_gate_state();

  IF NOT v_rev_verified OR NOT v_commit_valid THEN
    v_match := 'unknown';
  ELSIF v_rev = lower(v_commit) THEN
    v_match := 'match';
  ELSE
    v_match := 'mismatch';
  END IF;

  v_permitted := false;
  IF v_gate <> 'enabled' THEN
    v_reason := 'admin_dry_run_disabled';
  ELSIF v_env <> 'non_production' THEN
    v_reason := 'non_production_environment_required';
  ELSIF v_cert = 'failed' THEN
    v_reason := 'runtime_certification_failed';
  ELSIF v_cert <> 'certified' THEN
    v_reason := 'runtime_certification_required';
  ELSIF NOT v_commit_valid THEN
    v_reason := 'runtime_certified_commit_invalid';
  ELSIF NOT v_effective THEN
    v_reason := 'runtime_certification_record_incomplete';
  ELSIF NOT v_rev_verified THEN
    v_reason := 'runtime_revision_unverified';
  ELSIF v_match <> 'match' THEN
    v_reason := 'runtime_revision_mismatch';
  ELSE
    v_permitted := true;
    v_reason := NULL;
  END IF;

  RETURN jsonb_build_object(
    'certificationState', v_cert,
    'certifiedCommit', v_commit,
    'environment', v_env,
    'revision', nullif(v_rev, ''),
    'revisionVerified', v_rev_verified,
    'revisionMatch', v_match,
    'effectiveCertified', v_effective,
    'safeTestPermitted', v_permitted,
    'safeTestBlockedReason', v_reason
  );
END;
$function$;

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
  v_commit_valid boolean;
  v_effective boolean;
  v_operate boolean;
  v_permitted boolean;
  v_blocked text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_state := public.omni_comms_priv_dry_run_gate_state();
  v_posture := public.omni_comms_priv_certification_posture();
  v_cert := v_posture ->> 'certification_state';
  v_env := v_posture ->> 'environment';
  v_commit_valid := coalesce((v_posture ->> 'certified_commit_valid')::boolean, false);
  v_effective := coalesce((v_posture ->> 'effective_certified')::boolean, false);
  v_operate := public.has_permission(v_uid, 'omni_comms', 'operate');

  v_permitted := false;
  IF v_state <> 'enabled' THEN
    v_blocked := 'admin_dry_run_disabled';
  ELSIF NOT v_operate THEN
    v_blocked := 'permission_denied';
  ELSIF v_env <> 'non_production' THEN
    v_blocked := 'non_production_environment_required';
  ELSIF v_cert = 'failed' THEN
    v_blocked := 'runtime_certification_failed';
  ELSIF v_cert <> 'certified' THEN
    v_blocked := 'runtime_certification_required';
  ELSIF NOT v_commit_valid THEN
    v_blocked := 'runtime_certified_commit_invalid';
  ELSIF NOT v_effective THEN
    v_blocked := 'runtime_certification_record_incomplete';
  ELSE
    v_permitted := true;
    v_blocked := NULL;
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
    'certified_commit_valid', v_commit_valid,
    'effective_certified', v_effective,
    'environment', v_env,
    'execution_permitted', v_permitted,
    'execution_blocked_reason', v_blocked,
    'checked_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_admin_dry_run_guard(p_actor_id uuid, p_mode text, p_channels text[], p_recipients jsonb, p_deployed_revision text DEFAULT NULL::text)
 RETURNS jsonb
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
  v_commit_valid boolean;
  v_effective boolean;
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
  v_commit := lower(btrim(coalesce(v_posture ->> 'certified_commit', '')));
  v_commit_valid := coalesce((v_posture ->> 'certified_commit_valid')::boolean, false);
  v_effective := coalesce((v_posture ->> 'effective_certified')::boolean, false);
  v_rev := lower(btrim(coalesce(p_deployed_revision, '')));

  -- Environment must be exactly non_production.
  IF v_env <> 'non_production' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'non_production_environment_required');
  END IF;
  -- Certification must be exactly certified. Pending/unknown/failed block.
  IF v_cert = 'failed' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'runtime_certification_failed');
  END IF;
  IF v_cert <> 'certified' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'runtime_certification_required');
  END IF;
  -- Certified commit must be exactly 40 hexadecimal characters.
  IF NOT v_commit_valid OR v_commit !~ '^[0-9a-f]{40}$' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'runtime_certified_commit_invalid');
  END IF;
  -- The certification record must be complete: workflow run id and timestamp.
  IF NOT v_effective THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'runtime_certification_record_incomplete');
  END IF;
  -- Deployed revision must be exactly 40 hexadecimal characters.
  IF v_rev !~ '^[0-9a-f]{40}$' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'runtime_revision_unverified');
  END IF;
  -- Exact full-SHA equality. No prefix matching.
  IF v_rev <> v_commit THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'runtime_revision_mismatch');
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

REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_health_posture(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_runtime_health_posture(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.omni_comms_controlled_dry_run_gate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_controlled_dry_run_gate() TO authenticated, service_role;
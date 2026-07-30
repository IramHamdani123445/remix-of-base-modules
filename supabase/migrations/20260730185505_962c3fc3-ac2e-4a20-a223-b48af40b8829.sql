-- Omni-Comms Phase 5 — Controlled Dry-Run Test Surface.
-- Read-only gate + payload validation + trusted admin guard. No new tables.

-- 1. Environment gate state (server-side configuration surface).
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dry_run_gate_state()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text;
BEGIN
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

-- 2. Public, bounded gate read for the administration surface.
CREATE OR REPLACE FUNCTION public.omni_comms_controlled_dry_run_gate()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_state text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_state := public.omni_comms_priv_dry_run_gate_state();
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
    'can_operate', public.has_permission(v_uid, 'omni_comms', 'operate'),
    'can_view_sensitive_content', public.has_permission(v_uid, 'omni_comms', 'view_sensitive_content'),
    'checked_at', now()
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_controlled_dry_run_gate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_controlled_dry_run_gate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_controlled_dry_run_gate() FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_controlled_dry_run_gate() TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_controlled_dry_run_gate() TO service_role;

-- 3. Authoritative synthetic payload validation against the published contract.
CREATE OR REPLACE FUNCTION public.omni_comms_validate_dry_run_payload(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_event_definition_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_ed public.omni_comms_event_definition;
  v_ct public.omni_comms_event_contract;
  v_errors jsonb := '[]'::jsonb;
  v_size int;
  v_valid boolean := false;
  v_missing text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('operate');

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;
  IF p_event_definition_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'event_definition_required';
  END IF;

  SELECT * INTO v_ed FROM public.omni_comms_event_definition WHERE id = p_event_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found'
      USING ERRCODE = 'P0001', DETAIL = 'event_definition_not_found';
  END IF;
  IF v_ed.status <> 'active' THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'event_not_active';
  END IF;

  SELECT * INTO v_ct FROM public.omni_comms_event_contract
   WHERE event_definition_id = v_ed.id AND status = 'published'
   ORDER BY version_number DESC LIMIT 1;
  IF v_ct.id IS NULL THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'no_published_contract';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'payload_not_object',
      'message', 'The synthetic payload must be a JSON object.'));
  ELSE
    v_size := octet_length(p_payload::text);
    IF v_size > 262144 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'The synthetic payload exceeds the 256 KiB limit.'));
    ELSE
      FOR v_missing IN
        SELECT x FROM jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(v_ct.json_schema -> 'required') = 'array'
                             THEN v_ct.json_schema -> 'required' ELSE '[]'::jsonb END) AS t(x)
         WHERE NOT (p_payload ? x)
         LIMIT 25
      LOOP
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'required_field_missing',
          'field', v_missing,
          'message', format('Required contract field "%s" is missing.', v_missing)));
      END LOOP;

      BEGIN
        v_valid := extensions.jsonb_matches_schema(v_ct.json_schema::text::json, p_payload);
      EXCEPTION WHEN OTHERS THEN
        v_valid := false;
      END;

      IF NOT v_valid THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'schema_validation_failed',
          'message', 'The synthetic payload does not satisfy the published event contract.'));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'event_definition_id', v_ed.id,
    'event_code', v_ed.code,
    'contract_id', v_ct.id,
    'contract_version', v_ct.version_number,
    'contract_checksum', v_ct.checksum,
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'payload_bytes', coalesce(octet_length(p_payload::text), 0),
    'errors', v_errors,
    'validated_at', now()
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_validate_dry_run_payload(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_validate_dry_run_payload(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_validate_dry_run_payload(uuid, uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_validate_dry_run_payload(uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_validate_dry_run_payload(uuid, uuid, uuid, jsonb) TO service_role;

-- 4. Trusted-boundary guard for administration dry-run requests.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_admin_dry_run_guard(
  p_actor_id uuid,
  p_mode text,
  p_channels text[],
  p_recipients jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_state text;
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
  IF coalesce(v_r ->> 'phone', '') <> '' OR coalesce(v_r ->> 'pushDestination', '') <> '' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_recipient_invalid');
  END IF;

  v_email := lower(btrim(coalesce(v_r ->> 'email', '')));
  IF v_email = '' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_recipient_invalid');
  END IF;
  IF v_email !~ '^[^@[:space:]]+@example\.com$' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'admin_dry_run_domain_required');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'code', 'ok');
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_admin_dry_run_guard(uuid, text, text[], jsonb) TO service_role;

-- 5. Environment configuration: enable the controlled dry-run surface in this
--    (non-production) environment. Administrators may set 'disabled' to turn
--    the administration test action off without any code change.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET "omni_comms.controlled_dry_run" = %L',
                 current_database(), 'enabled');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'controlled dry-run GUC not set: %', SQLERRM;
END;
$$;
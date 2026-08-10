-- Omni-Comms — Sender Addresses (Email) operator screen support RPCs.
-- No new tables. Bounded SECURITY DEFINER readers/commands over the existing
-- omni_comms_sender_identity model. No provider contact, no sending.

CREATE OR REPLACE FUNCTION public.omni_comms_priv_sender_address_facts(
  p_row public.omni_comms_sender_identity
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_addr text;
  v_domain text;
  v_ep public.omni_comms_channel_endpoint%ROWTYPE;
  v_dv public.omni_comms_domain_verification%ROWTYPE;
  v_pa public.omni_comms_provider_account%ROWTYPE;
  v_routes int := 0; v_bindings int := 0; v_messages int := 0; v_tests int := 0;
  v_blocker text := NULL;
  v_domain_ready boolean := false;
BEGIN
  v_addr := lower(btrim(coalesce(p_row.identity_config->>'from_address', p_row.from_address, '')));
  v_domain := NULLIF(split_part(v_addr, '@', 2), '');

  IF v_domain IS NOT NULL THEN
    SELECT * INTO v_ep
      FROM public.omni_comms_channel_endpoint e
     WHERE e.organization_id = p_row.organization_id
       AND e.channel = 'email'
       AND e.endpoint_type = 'sending_domain'
       AND lower(coalesce(e.endpoint_config->>'domain_name','')) = v_domain
     ORDER BY (e.status = 'active') DESC, e.updated_at DESC
     LIMIT 1;

    IF v_ep.id IS NOT NULL THEN
      SELECT * INTO v_dv
        FROM public.omni_comms_domain_verification d
       WHERE d.channel_endpoint_id = v_ep.id
       ORDER BY d.updated_at DESC
       LIMIT 1;

      IF v_ep.provider_account_id IS NOT NULL THEN
        SELECT * INTO v_pa FROM public.omni_comms_provider_account a
         WHERE a.id = v_ep.provider_account_id;
      END IF;
    END IF;
  END IF;

  SELECT count(*) INTO v_routes
    FROM public.omni_comms_event_route r WHERE r.sender_identity_id = p_row.id;
  SELECT count(*) INTO v_bindings
    FROM public.omni_comms_sender_provider_binding b WHERE b.sender_identity_id = p_row.id;
  SELECT count(*) INTO v_messages
    FROM public.omni_comms_message m WHERE m.sender_identity_id = p_row.id;
  SELECT count(*) INTO v_tests
    FROM public.omni_comms_channel_test_delivery t WHERE t.sender_identity_id = p_row.id;

  v_domain_ready := v_dv.id IS NOT NULL
                AND v_dv.status = 'verified'
                AND coalesce(v_dv.association_confirmed,false)
                AND v_ep.status = 'active';

  -- Single, most actionable activation blocker.
  IF v_addr = '' OR v_addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    v_blocker := 'invalid_email_address';
  ELSIF coalesce(btrim(p_row.display_name),'') = '' THEN
    v_blocker := 'display_name_required';
  ELSIF v_ep.id IS NULL THEN
    v_blocker := 'domain_not_configured';
  ELSIF v_dv.id IS NULL OR v_dv.status <> 'verified' THEN
    v_blocker := 'domain_not_verified';
  ELSIF NOT coalesce(v_dv.association_confirmed,false) THEN
    v_blocker := 'domain_association_not_confirmed';
  ELSIF v_ep.status <> 'active' THEN
    v_blocker := 'sending_domain_not_active';
  ELSIF v_pa.id IS NULL OR v_pa.status <> 'active' THEN
    v_blocker := 'provider_account_unusable';
  END IF;

  RETURN jsonb_build_object(
    'from_address', NULLIF(v_addr,''),
    'domain_name', v_domain,
    'channel_endpoint_id', v_ep.id,
    'channel_endpoint_code', v_ep.code,
    'channel_endpoint_status', v_ep.status,
    'domain_verification_status', v_dv.status,
    'domain_association_confirmed', coalesce(v_dv.association_confirmed,false),
    'domain_ready', v_domain_ready,
    'provider_account_id', v_pa.id,
    'provider_account_code', v_pa.code,
    'provider_account_name', v_pa.display_name,
    'provider_account_status', v_pa.status,
    'usage_routes', v_routes,
    'usage_bindings', v_bindings,
    'usage_messages', v_messages,
    'usage_test_deliveries', v_tests,
    'usage_total', v_routes + v_bindings + v_messages + v_tests,
    'activation_blocker', v_blocker,
    'can_activate', v_blocker IS NULL,
    'can_hard_delete',
      p_row.data_origin <> 'reference_seed'
      AND p_row.status IN ('draft','disabled')
      AND (v_routes + v_bindings + v_messages + v_tests) = 0
  );
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_sender_address_facts(public.omni_comms_sender_identity) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_sender_address_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_include_reference boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_can_configure boolean; v_allow_ref boolean;
        v_rows jsonb; v_ref jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_can_configure := public.has_permission(v_uid,'omni_comms','configure');
  v_allow_ref := COALESCE(p_include_reference,false) AND v_can_configure;

  WITH ident AS (
    SELECT s.* FROM public.omni_comms_sender_identity s
     WHERE s.organization_id = p_organization_id
       AND s.channel = 'email'
       AND (p_department_id IS NULL
            OR s.department_id IS NULL
            OR s.department_id = p_department_id)
  ), shaped AS (
    SELECT i.data_origin AS origin, i.created_at,
      jsonb_build_object(
        'id', i.id, 'code', i.code, 'display_name', i.display_name,
        'channel', i.channel, 'identity_type', i.identity_type,
        'identity_config', i.identity_config,
        'department_id', i.department_id,
        'department_name', d.name,
        'status', i.status, 'data_origin', i.data_origin,
        'from_address', i.from_address, 'from_name', i.from_name,
        'reply_to_address', i.reply_to_address,
        'created_at', i.created_at, 'updated_at', i.updated_at,
        'activated_at', i.activated_at, 'retired_at', i.retired_at,
        'retirement_reason', i.retirement_reason
      ) || public.omni_comms_priv_sender_address_facts(i.*) AS row_json
      FROM ident i
      LEFT JOIN public.core_department d
        ON d.id = i.department_id AND d.organization_id = p_organization_id
  )
  SELECT
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin <> 'reference_seed'),'[]'::jsonb),
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin = 'reference_seed'),'[]'::jsonb)
    INTO v_rows, v_ref
  FROM shaped;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', 'email',
    'can_manage', v_can_configure,
    'senders', v_rows,
    'reference_senders', CASE WHEN v_allow_ref THEN v_ref ELSE '[]'::jsonb END,
    'reference_sender_count', CASE WHEN v_can_configure THEN jsonb_array_length(v_ref) ELSE 0 END,
    'generated_at', now());
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_sender_address_summary(uuid, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_sender_address_activate(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_sender_identity%ROWTYPE; v_facts jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_row FROM public.omni_comms_sender_identity WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_row.organization_id, NULL);
  IF v_row.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_identity_non_operational';
  END IF;
  IF v_row.channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel';
  END IF;

  v_facts := public.omni_comms_priv_sender_address_facts(v_row.*);
  IF NOT (v_facts->>'can_activate')::boolean THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE='P0001', DETAIL = v_facts->>'activation_blocker';
  END IF;

  PERFORM public.omni_comms_priv_channel_identity_lifecycle(
    v_uid, p_id, p_expected_updated_at, 'activate', NULL, p_correlation_id);

  RETURN jsonb_build_object('id', p_id, 'status', 'active', 'facts', v_facts);
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_sender_address_activate(uuid, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_sender_address_delete(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_sender_identity%ROWTYPE; v_facts jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_row FROM public.omni_comms_sender_identity WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_row.organization_id, NULL);
  IF v_row.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_identity_read_only';
  END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;

  v_facts := public.omni_comms_priv_sender_address_facts(v_row.*);
  IF NOT (v_facts->>'can_hard_delete')::boolean THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE='P0001', DETAIL='sender_has_dependencies';
  END IF;

  DELETE FROM public.omni_comms_sender_identity WHERE id = p_id;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, 'delete', 'sender_identity', p_id, v_row.code,
    to_jsonb(v_row), NULL::jsonb, p_correlation_id);

  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_sender_address_delete(uuid, timestamptz, text) TO authenticated, service_role;
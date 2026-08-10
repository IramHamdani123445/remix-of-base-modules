
CREATE OR REPLACE FUNCTION public.omni_comms_priv_verify_binding_configuration(
  p_actor_id uuid,
  p_id uuid,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  b public.omni_comms_sender_provider_binding%ROWTYPE;
  i public.omni_comms_sender_identity%ROWTYPE;
  a public.omni_comms_provider_account%ROWTYPE;
  e public.omni_comms_channel_endpoint%ROWTYPE;
  d public.omni_comms_domain_verification%ROWTYPE;
  v_checks jsonb := '[]'::jsonb;
  v_failure text := NULL;
  v_domain text; v_sender_domain text; v_from text;
  v_status text; v_code text;

  PROCEDURE_placeholder boolean;
BEGIN
  SELECT * INTO b FROM public.omni_comms_sender_provider_binding WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='binding'; END IF;
  IF b.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',
      DETAIL='reference_binding_non_operational'; END IF;

  PERFORM public.omni_comms_priv_require_tenant_access(
    p_actor_id, b.organization_id, b.department_id);

  IF b.channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',
      DETAIL='channel_verification_not_supported'; END IF;

  SELECT * INTO i FROM public.omni_comms_sender_identity WHERE id = b.sender_identity_id;
  SELECT * INTO a FROM public.omni_comms_provider_account WHERE id = b.provider_account_id;
  SELECT * INTO e FROM public.omni_comms_channel_endpoint WHERE id = b.channel_endpoint_id;

  v_from := lower(btrim(coalesce(i.identity_config->>'from_address', i.from_address, '')));
  v_sender_domain := split_part(v_from, '@', 2);
  v_domain := lower(btrim(coalesce(e.endpoint_config->>'domain_name','')));

  IF e.id IS NOT NULL THEN
    SELECT * INTO d FROM public.omni_comms_domain_verification
     WHERE channel_endpoint_id = e.id AND domain_name = v_domain
     ORDER BY updated_at DESC LIMIT 1;
  END IF;

  -- Bounded, zero-send configuration checks against canonical records only.
  DECLARE
    v_pairs text[][] := ARRAY[]::text[][];
  BEGIN
    NULL;
  END;

  -- helper: append check
  CREATE TEMP TABLE IF NOT EXISTS omni_comms_tmp_binding_checks(
    ord int, key text, ok boolean) ON COMMIT DROP;
  DELETE FROM omni_comms_tmp_binding_checks;

  INSERT INTO omni_comms_tmp_binding_checks(ord, key, ok) VALUES
    (1,  'sender_present',              i.id IS NOT NULL),
    (2,  'sender_active',               i.status = 'active'),
    (3,  'sender_genuine',              i.data_origin <> 'reference_seed'),
    (4,  'sender_from_address_valid',   v_from ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
    (5,  'endpoint_present',            e.id IS NOT NULL),
    (6,  'endpoint_type_sending_domain',e.endpoint_type = 'sending_domain'),
    (7,  'endpoint_active',             e.status = 'active'),
    (8,  'endpoint_genuine',            e.data_origin <> 'reference_seed'),
    (9,  'sender_domain_matches_endpoint',
         v_domain <> '' AND v_sender_domain = v_domain),
    (10, 'provider_account_present',    a.id IS NOT NULL),
    (11, 'provider_account_active',     a.status = 'active'),
    (12, 'provider_account_genuine',    a.data_origin <> 'reference_seed'),
    (13, 'endpoint_provider_account_matches',
         e.provider_account_id IS NOT DISTINCT FROM b.provider_account_id),
    (14, 'organization_consistent',
         i.organization_id = b.organization_id
         AND a.organization_id = b.organization_id
         AND e.organization_id = b.organization_id),
    (15, 'department_scope_consistent',
         (i.department_id IS NULL OR i.department_id IS NOT DISTINCT FROM b.department_id)
         AND (e.department_id IS NULL OR e.department_id IS NOT DISTINCT FROM b.department_id)),
    (16, 'sending_credential_usable',
         a.secret_ref IS NOT NULL
         AND (a.verification_status = 'verified'
              OR a.verification_result_code IN ('verified','restricted_api_key'))),
    (17, 'domain_verification_present',  d.id IS NOT NULL),
    (18, 'domain_verification_verified', d.status = 'verified'),
    (19, 'domain_verification_fresh',
         d.dns_checked_at IS NOT NULL
         AND d.dns_checked_at > now() - make_interval(days => coalesce(d.dns_freshness_days,30))),
    (20, 'domain_association_current',
         d.association_confirmed IS TRUE
         AND d.association_confirmed_at IS NOT NULL
         AND d.association_confirmed_at
             > now() - make_interval(days => coalesce(d.association_freshness_days,90))),
    (21, 'domain_association_provider_account_matches',
         d.provider_account_id IS NOT DISTINCT FROM b.provider_account_id);

  SELECT key INTO v_failure FROM omni_comms_tmp_binding_checks
   WHERE ok IS DISTINCT FROM true ORDER BY ord LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object('key', key, 'ok', coalesce(ok,false)) ORDER BY ord)
    INTO v_checks FROM omni_comms_tmp_binding_checks;

  IF v_failure IS NULL THEN
    v_status := 'verified';
    v_code := 'configuration_verified';
  ELSE
    v_status := 'failed';
    v_code := left(v_failure, 64);
  END IF;

  PERFORM public.omni_comms_priv_record_binding_verification(
    p_actor_id, p_id, NULL, v_status, 'service', v_code,
    CASE WHEN v_failure IS NULL
      THEN 'Trusted zero-send configuration verification passed against canonical records.'
      ELSE 'Trusted zero-send configuration verification failed: ' || v_failure
    END,
    p_correlation_id);

  RETURN jsonb_build_object(
    'bindingId', p_id,
    'verificationStatus', v_status,
    'verificationSource', 'service',
    'resultCode', v_code,
    'checks', coalesce(v_checks,'[]'::jsonb),
    'emailsSent', 0,
    'providerCalls', 0);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_binding_verify_configuration(
  p_id uuid,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001',
      DETAIL='authentication_required'; END IF;
  RETURN public.omni_comms_priv_verify_binding_configuration(v_actor, p_id, p_correlation_id);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_verify_binding_configuration(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_verify_binding_configuration(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.omni_comms_binding_verify_configuration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_binding_verify_configuration(uuid, text) TO authenticated, service_role;

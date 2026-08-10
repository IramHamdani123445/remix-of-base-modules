
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
  v_keys text[];
  v_oks boolean[];
  v_checks jsonb := '[]'::jsonb;
  v_failure text := NULL;
  v_domain text; v_sender_domain text; v_from text;
  v_status text; v_code text; n int;
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

  IF e.id IS NOT NULL AND v_domain <> '' THEN
    SELECT * INTO d FROM public.omni_comms_domain_verification
     WHERE channel_endpoint_id = e.id AND lower(domain_name) = v_domain
     ORDER BY updated_at DESC LIMIT 1;
  END IF;

  v_keys := ARRAY[
    'sender_present','sender_active','sender_genuine','sender_from_address_valid',
    'endpoint_present','endpoint_type_sending_domain','endpoint_active','endpoint_genuine',
    'sender_domain_matches_endpoint','provider_account_present','provider_account_active',
    'provider_account_genuine','endpoint_provider_account_matches','organization_consistent',
    'department_scope_consistent','sending_credential_usable','domain_verification_present',
    'domain_verification_verified','domain_verification_fresh','domain_association_current',
    'domain_association_provider_account_matches'];

  v_oks := ARRAY[
    i.id IS NOT NULL,
    i.status = 'active',
    i.data_origin IS DISTINCT FROM 'reference_seed',
    v_from ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$',
    e.id IS NOT NULL,
    e.endpoint_type = 'sending_domain',
    e.status = 'active',
    e.data_origin IS DISTINCT FROM 'reference_seed',
    v_domain <> '' AND v_sender_domain = v_domain,
    a.id IS NOT NULL,
    a.status = 'active',
    a.data_origin IS DISTINCT FROM 'reference_seed',
    e.provider_account_id IS NOT DISTINCT FROM b.provider_account_id,
    i.organization_id = b.organization_id
      AND a.organization_id = b.organization_id
      AND e.organization_id = b.organization_id,
    (i.department_id IS NULL OR i.department_id IS NOT DISTINCT FROM b.department_id)
      AND (e.department_id IS NULL OR e.department_id IS NOT DISTINCT FROM b.department_id),
    a.secret_ref IS NOT NULL
      AND (a.verification_status = 'verified'
           OR a.verification_result_code IN ('verified','restricted_api_key')),
    d.id IS NOT NULL,
    d.status = 'verified',
    d.dns_checked_at IS NOT NULL
      AND d.dns_checked_at > now() - make_interval(days => coalesce(d.dns_freshness_days,30)),
    d.association_confirmed IS TRUE
      AND d.association_confirmed_at IS NOT NULL
      AND d.association_confirmed_at
          > now() - make_interval(days => coalesce(d.association_freshness_days,90)),
    d.provider_account_id IS NOT DISTINCT FROM b.provider_account_id];

  FOR n IN 1 .. array_length(v_keys,1) LOOP
    v_checks := v_checks || jsonb_build_object(
      'key', v_keys[n], 'ok', coalesce(v_oks[n], false));
    IF v_failure IS NULL AND coalesce(v_oks[n], false) IS NOT TRUE THEN
      v_failure := v_keys[n];
    END IF;
  END LOOP;

  IF v_failure IS NULL THEN
    v_status := 'verified'; v_code := 'configuration_verified';
  ELSE
    v_status := 'failed'; v_code := left(v_failure, 64);
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
    'checks', v_checks,
    'emailsSent', 0,
    'providerCalls', 0);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_verify_binding_configuration(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_verify_binding_configuration(uuid, uuid, text) TO service_role;

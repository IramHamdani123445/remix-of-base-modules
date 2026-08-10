ALTER TABLE public.omni_comms_domain_verification
  ADD COLUMN IF NOT EXISTS association_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS association_provider_status text,
  ADD COLUMN IF NOT EXISTS association_provider_reference text,
  ADD COLUMN IF NOT EXISTS association_note text,
  ADD COLUMN IF NOT EXISTS association_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS association_confirmed_by uuid;

CREATE OR REPLACE FUNCTION public.omni_comms_domain_association_confirm(
  p_organization_id uuid,
  p_domain_verification_id uuid,
  p_provider_account_id uuid,
  p_provider_console_status text,
  p_provider_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_domain_verification; v_acct record;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_organization_id IS NULL OR p_domain_verification_id IS NULL
     OR p_provider_account_id IS NULL OR coalesce(btrim(p_provider_console_status),'') = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_input';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  IF lower(btrim(p_provider_console_status)) NOT IN ('verified','pending','failed','not_found') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_status_invalid';
  END IF;

  SELECT a.id, a.code, a.display_name, a.data_origin, a.organization_id
    INTO v_acct
    FROM public.omni_comms_provider_account a
   WHERE a.id = p_provider_account_id;
  IF NOT FOUND OR v_acct.data_origin <> 'user' OR v_acct.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_invalid';
  END IF;

  UPDATE public.omni_comms_domain_verification d
     SET provider_account_id           = p_provider_account_id,
         association_confirmed         = (lower(btrim(p_provider_console_status)) = 'verified'),
         association_provider_status   = lower(btrim(p_provider_console_status)),
         association_provider_reference= nullif(btrim(coalesce(p_provider_reference,'')),''),
         association_note              = nullif(btrim(coalesce(p_note,'')),''),
         association_confirmed_at      = now(),
         association_confirmed_by      = v_uid,
         updated_at                    = now(),
         updated_by                    = v_uid
   WHERE d.id = p_domain_verification_id
     AND d.organization_id = p_organization_id
  RETURNING d.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='not_found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'domainName', v_row.domain_name,
    'providerAccountCode', v_acct.code,
    'providerAccountName', v_acct.display_name,
    'associationConfirmed', v_row.association_confirmed,
    'associationProviderStatus', v_row.association_provider_status,
    'associationProviderReference', v_row.association_provider_reference,
    'associationConfirmedAt', v_row.association_confirmed_at,
    'readyForProviderAccount', (v_row.status = 'verified' AND v_row.association_confirmed
      AND v_row.verification_source IN ('provider_api','external_provider_plus_dns'))
  );
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_domain_association_confirm(uuid,uuid,uuid,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_domain_association_confirm(uuid,uuid,uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_domain_verification_summary(
  p_organization_id uuid,
  p_channel_endpoint_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_rows jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_required';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'channelEndpointId', d.channel_endpoint_id,
      'providerAccountId', d.provider_account_id,
      'providerAccountCode', a.code,
      'providerAccountName', a.display_name,
      'domainName', d.domain_name,
      'verificationSource', d.verification_source,
      'claimedStatus', d.claimed_status,
      'providerReference', d.provider_reference,
      'expectedDns', d.expected_dns,
      'dnsEvidence', d.dns_evidence,
      'dnsCheckedAt', d.dns_checked_at,
      'status', d.status,
      'resultCode', d.result_code,
      'detail', d.detail,
      'notes', d.notes,
      'verifiedAt', d.verified_at,
      'updatedAt', d.updated_at,
      'associationConfirmed', d.association_confirmed,
      'associationProviderStatus', d.association_provider_status,
      'associationProviderReference', d.association_provider_reference,
      'associationNote', d.association_note,
      'associationConfirmedAt', d.association_confirmed_at,
      'readyForProviderAccount', (d.status = 'verified' AND d.association_confirmed
        AND d.verification_source IN ('provider_api','external_provider_plus_dns'))
    ) ORDER BY d.created_at), '[]'::jsonb) INTO v_rows
    FROM public.omni_comms_domain_verification d
    LEFT JOIN public.omni_comms_provider_account a ON a.id = d.provider_account_id
   WHERE d.organization_id = p_organization_id
     AND (p_channel_endpoint_id IS NULL OR d.channel_endpoint_id = p_channel_endpoint_id);

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'canManage', public.has_permission(v_uid,'omni_comms','configure'),
    'domains', v_rows,
    'generatedAt', now());
END; $function$;
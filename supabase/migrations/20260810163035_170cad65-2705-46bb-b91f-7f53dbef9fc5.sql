-- Omni-Comms — sending-domain verification hardening (evidence, association, freshness)

ALTER TABLE public.omni_comms_domain_verification
  ADD COLUMN IF NOT EXISTS provider_code text NOT NULL DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS provider_domain_id text,
  ADD COLUMN IF NOT EXISTS provider_domain_status text,
  ADD COLUMN IF NOT EXISTS provider_domain_region text,
  ADD COLUMN IF NOT EXISTS sending_capability text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS config_fingerprint text,
  ADD COLUMN IF NOT EXISTS dns_freshness_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS association_freshness_days integer NOT NULL DEFAULT 90;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_domain_verification
    ADD CONSTRAINT omni_comms_domain_verification_sending_chk
    CHECK (sending_capability = ANY (ARRAY['enabled','disabled','unknown']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_domain_verification
    ADD CONSTRAINT omni_comms_domain_verification_provider_status_chk
    CHECK (provider_domain_status IS NULL OR provider_domain_status = ANY (
      ARRAY['not_started','pending','temporary_failure','verified','failed','not_found']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_domain_verification
    ADD CONSTRAINT omni_comms_domain_verification_freshness_chk
    CHECK (dns_freshness_days BETWEEN 1 AND 365 AND association_freshness_days BETWEEN 1 AND 365);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Fingerprint of every material verification input. Any change invalidates
-- previously collected DNS evidence and any provider-account confirmation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_domain_config_fingerprint(
  p_provider_account_id uuid, p_domain_name text, p_provider_code text,
  p_provider_domain_id text, p_provider_domain_region text,
  p_provider_domain_status text, p_sending_capability text,
  p_verification_source text, p_expected_dns jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
  SELECT md5(
    coalesce(p_provider_account_id::text,'') || '|' ||
    coalesce(lower(btrim(p_domain_name)),'') || '|' ||
    coalesce(lower(btrim(p_provider_code)),'') || '|' ||
    coalesce(btrim(p_provider_domain_id),'') || '|' ||
    coalesce(lower(btrim(p_provider_domain_region)),'') || '|' ||
    coalesce(lower(btrim(p_provider_domain_status)),'') || '|' ||
    coalesce(lower(btrim(p_sending_capability)),'') || '|' ||
    coalesce(p_verification_source,'') || '|' ||
    coalesce(p_expected_dns::text,'[]'))
$$;

-- True only when every REQUIRED expectation uses an exact match mode.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_domain_expectations_exact(p_expected_dns jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
  SELECT jsonb_typeof(coalesce(p_expected_dns,'[]'::jsonb)) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_expected_dns,'[]'::jsonb)) e
                  WHERE coalesce((e->>'required')::boolean, true))
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(p_expected_dns,'[]'::jsonb)) e
        WHERE coalesce((e->>'required')::boolean, true)
          AND coalesce(e->>'matchMode','contains') NOT IN ('equals','exact_txt','exact_mx'))
$$;

-- Central readiness projection: strong, specific and FRESH evidence only.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_domain_readiness(
  d public.omni_comms_domain_verification)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_ep record; v_dns_fresh boolean; v_assoc_fresh boolean; v_exact boolean;
        v_account_matches boolean; v_ready boolean; v_blocker text;
BEGIN
  SELECT e.channel, e.provider_account_id INTO v_ep
    FROM public.omni_comms_channel_endpoint e WHERE e.id = d.channel_endpoint_id;

  v_exact := public.omni_comms_priv_domain_expectations_exact(d.expected_dns);
  v_dns_fresh := d.dns_checked_at IS NOT NULL
    AND d.dns_checked_at > now() - make_interval(days => d.dns_freshness_days);
  v_assoc_fresh := d.association_confirmed_at IS NOT NULL
    AND d.association_confirmed_at > now() - make_interval(days => d.association_freshness_days);
  v_account_matches := d.provider_account_id IS NOT NULL
    AND v_ep.provider_account_id IS NOT DISTINCT FROM d.provider_account_id;

  v_ready := d.status = 'verified'
    AND d.verification_source IN ('provider_api','external_provider_plus_dns')
    AND v_exact
    AND d.association_confirmed
    AND v_account_matches
    AND coalesce(v_ep.channel,'') = 'email'
    AND d.provider_domain_status = 'verified'
    AND d.sending_capability = 'enabled'
    AND v_dns_fresh AND v_assoc_fresh;

  v_blocker := CASE
    WHEN v_ready THEN NULL
    WHEN d.verification_source = 'external_admin_attestation'
      THEN 'An administrator statement alone cannot make this domain ready.'
    WHEN NOT v_exact
      THEN 'Record the exact provider DNS values (SPF, MX with priority, DKIM key) before this domain can be used.'
    WHEN d.status <> 'verified' THEN 'Server DNS evidence has not passed yet.'
    WHEN NOT v_dns_fresh THEN 'DNS evidence is beyond the freshness window. Run the DNS check again.'
    WHEN NOT d.association_confirmed
      THEN 'Confirm the domain is registered in this exact provider account.'
    WHEN NOT v_account_matches
      THEN 'The confirmed provider account is not the account assigned to this sending-domain endpoint.'
    WHEN NOT v_assoc_fresh
      THEN 'The provider-account confirmation is beyond the freshness window. Confirm it again.'
    WHEN coalesce(d.provider_domain_status,'') <> 'verified'
      THEN 'The provider does not report this domain as verified.'
    WHEN d.sending_capability <> 'enabled'
      THEN 'Sending is not enabled for this domain in the provider account.'
    ELSE 'Domain readiness is incomplete.' END;

  RETURN jsonb_build_object(
    'readyForProviderAccount', v_ready,
    'expectationsExact', v_exact,
    'dnsFresh', coalesce(v_dns_fresh,false),
    'associationFresh', coalesce(v_assoc_fresh,false),
    'accountMatchesEndpoint', coalesce(v_account_matches,false),
    'endpointChannel', v_ep.channel,
    'endpointProviderAccountId', v_ep.provider_account_id,
    'readinessBlocker', v_blocker);
END; $$;

-- ---------------------------------------------------------------------------
-- Upsert: capture exact provider facts, invalidate stale evidence on change.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_domain_verification_upsert(uuid,uuid,text,uuid,text,text,text,jsonb,text);

CREATE OR REPLACE FUNCTION public.omni_comms_domain_verification_upsert(
  p_organization_id uuid, p_channel_endpoint_id uuid, p_domain_name text,
  p_provider_account_id uuid DEFAULT NULL, p_verification_source text DEFAULT 'external_provider_plus_dns',
  p_claimed_status text DEFAULT NULL, p_provider_reference text DEFAULT NULL,
  p_expected_dns jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL,
  p_provider_code text DEFAULT 'resend', p_provider_domain_id text DEFAULT NULL,
  p_provider_domain_status text DEFAULT NULL, p_provider_domain_region text DEFAULT NULL,
  p_sending_capability text DEFAULT 'unknown')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_id uuid; v_status text; v_fp text; v_domain text;
        v_sending text; v_pstatus text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_organization_id IS NULL OR p_channel_endpoint_id IS NULL OR p_domain_name IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='invalid_input';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  IF jsonb_typeof(p_expected_dns) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='expected_dns_invalid';
  END IF;

  v_domain := lower(btrim(p_domain_name));
  v_sending := lower(btrim(coalesce(p_sending_capability,'unknown')));
  IF v_sending NOT IN ('enabled','disabled','unknown') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='sending_capability_invalid';
  END IF;
  v_pstatus := nullif(lower(btrim(coalesce(p_provider_domain_status,''))),'');
  IF v_pstatus IS NOT NULL AND v_pstatus NOT IN
     ('not_started','pending','temporary_failure','verified','failed','not_found') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='provider_domain_status_invalid';
  END IF;

  v_status := CASE
    WHEN p_verification_source = 'external_admin_attestation' THEN 'external_verification_required'
    ELSE 'pending' END;

  v_fp := public.omni_comms_priv_domain_config_fingerprint(
    p_provider_account_id, v_domain, p_provider_code, p_provider_domain_id,
    p_provider_domain_region, v_pstatus, v_sending, p_verification_source, p_expected_dns);

  INSERT INTO public.omni_comms_domain_verification AS d (
    organization_id, channel_endpoint_id, provider_account_id, domain_name,
    verification_source, claimed_status, provider_reference, expected_dns,
    notes, status, result_code, detail, created_by, updated_by,
    provider_code, provider_domain_id, provider_domain_status,
    provider_domain_region, sending_capability, config_fingerprint)
  VALUES (
    p_organization_id, p_channel_endpoint_id, p_provider_account_id, v_domain,
    p_verification_source, p_claimed_status, p_provider_reference, p_expected_dns,
    p_notes, v_status, 'awaiting_dns_evidence', NULL, v_uid, v_uid,
    lower(btrim(coalesce(p_provider_code,'resend'))), nullif(btrim(coalesce(p_provider_domain_id,'')),''),
    v_pstatus, nullif(lower(btrim(coalesce(p_provider_domain_region,''))),''), v_sending, v_fp)
  ON CONFLICT (channel_endpoint_id, domain_name) DO UPDATE
    SET provider_account_id     = EXCLUDED.provider_account_id,
        verification_source     = EXCLUDED.verification_source,
        claimed_status          = EXCLUDED.claimed_status,
        provider_reference      = EXCLUDED.provider_reference,
        expected_dns            = EXCLUDED.expected_dns,
        notes                   = EXCLUDED.notes,
        provider_code           = EXCLUDED.provider_code,
        provider_domain_id      = EXCLUDED.provider_domain_id,
        provider_domain_status  = EXCLUDED.provider_domain_status,
        provider_domain_region  = EXCLUDED.provider_domain_region,
        sending_capability      = EXCLUDED.sending_capability,
        config_fingerprint      = EXCLUDED.config_fingerprint,
        -- Material change ⇒ old DNS evidence and old association are void.
        status = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN v_status ELSE d.status END,
        result_code = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN 'awaiting_dns_evidence' ELSE d.result_code END,
        detail = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.detail END,
        dns_evidence = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN '[]'::jsonb ELSE d.dns_evidence END,
        dns_checked_at = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.dns_checked_at END,
        verified_at = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.verified_at END,
        verified_by = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.verified_by END,
        association_confirmed = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN false ELSE d.association_confirmed END,
        association_provider_status = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.association_provider_status END,
        association_provider_reference = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.association_provider_reference END,
        association_note = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.association_note END,
        association_confirmed_at = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.association_confirmed_at END,
        association_confirmed_by = CASE WHEN d.config_fingerprint IS DISTINCT FROM EXCLUDED.config_fingerprint
                      THEN NULL ELSE d.association_confirmed_by END,
        updated_at = now(), updated_by = v_uid
  RETURNING d.id INTO v_id;

  RETURN v_id;
END; $$;

-- ---------------------------------------------------------------------------
-- Association: the server proves the account against the ENDPOINT, not the UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_domain_association_confirm(
  p_organization_id uuid, p_domain_verification_id uuid, p_provider_account_id uuid,
  p_provider_console_status text, p_provider_reference text DEFAULT NULL,
  p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_row public.omni_comms_domain_verification; v_acct record;
        v_ep record; v_ready jsonb; v_status text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_organization_id IS NULL OR p_domain_verification_id IS NULL
     OR p_provider_account_id IS NULL OR coalesce(btrim(p_provider_console_status),'') = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_input';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  v_status := lower(btrim(p_provider_console_status));
  IF v_status NOT IN ('verified','pending','failed','not_found','temporary_failure','not_started') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_status_invalid';
  END IF;

  SELECT * INTO v_row FROM public.omni_comms_domain_verification
   WHERE id = p_domain_verification_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='not_found';
  END IF;

  SELECT e.id, e.channel, e.provider_account_id, e.organization_id
    INTO v_ep FROM public.omni_comms_channel_endpoint e WHERE e.id = v_row.channel_endpoint_id;
  IF NOT FOUND OR v_ep.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_invalid';
  END IF;
  IF v_ep.channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_channel_invalid';
  END IF;
  IF v_ep.provider_account_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_provider_account_missing';
  END IF;
  IF v_ep.provider_account_id IS DISTINCT FROM p_provider_account_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_mismatch';
  END IF;

  SELECT a.id, a.code, a.display_name, a.data_origin, a.organization_id, pr.code AS provider_code
    INTO v_acct
    FROM public.omni_comms_provider_account a
    JOIN public.omni_comms_provider pr ON pr.id = a.provider_id
   WHERE a.id = p_provider_account_id;
  IF NOT FOUND OR v_acct.data_origin <> 'user' OR v_acct.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_invalid';
  END IF;
  IF v_row.provider_code IS NOT NULL
     AND v_acct.provider_code NOT LIKE v_row.provider_code || '%' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_mismatch';
  END IF;

  UPDATE public.omni_comms_domain_verification d
     SET provider_account_id           = p_provider_account_id,
         association_confirmed         = (v_status = 'verified'),
         association_provider_status   = v_status,
         association_provider_reference= nullif(btrim(coalesce(p_provider_reference,'')),''),
         association_note              = nullif(btrim(coalesce(p_note,'')),''),
         association_confirmed_at      = now(),
         association_confirmed_by      = v_uid,
         updated_at                    = now(),
         updated_by                    = v_uid
   WHERE d.id = p_domain_verification_id
     AND d.organization_id = p_organization_id
  RETURNING d.* INTO v_row;

  v_ready := public.omni_comms_priv_domain_readiness(v_row);

  RETURN jsonb_build_object(
    'id', v_row.id,
    'domainName', v_row.domain_name,
    'providerAccountCode', v_acct.code,
    'providerAccountName', v_acct.display_name,
    'associationConfirmed', v_row.association_confirmed,
    'associationProviderStatus', v_row.association_provider_status,
    'associationProviderReference', v_row.association_provider_reference,
    'associationConfirmedAt', v_row.association_confirmed_at,
    'readyForProviderAccount', (v_ready->>'readyForProviderAccount')::boolean,
    'readinessBlocker', v_ready->>'readinessBlocker');
END; $$;

-- ---------------------------------------------------------------------------
-- Summary: expose provider evidence and freshness alongside DNS evidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_domain_verification_summary(
  p_organization_id uuid, p_channel_endpoint_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
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
      'providerCode', d.provider_code,
      'providerDomainId', d.provider_domain_id,
      'providerDomainStatus', d.provider_domain_status,
      'providerDomainRegion', d.provider_domain_region,
      'sendingCapability', d.sending_capability,
      'expectedDns', d.expected_dns,
      'dnsEvidence', d.dns_evidence,
      'dnsCheckedAt', d.dns_checked_at,
      'dnsFreshnessDays', d.dns_freshness_days,
      'associationFreshnessDays', d.association_freshness_days,
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
      'endpointProviderAccountId', e.provider_account_id,
      'endpointChannel', e.channel
    ) || public.omni_comms_priv_domain_readiness(d.*) ORDER BY d.created_at), '[]'::jsonb) INTO v_rows
    FROM public.omni_comms_domain_verification d
    LEFT JOIN public.omni_comms_provider_account a ON a.id = d.provider_account_id
    LEFT JOIN public.omni_comms_channel_endpoint e ON e.id = d.channel_endpoint_id
   WHERE d.organization_id = p_organization_id
     AND (p_channel_endpoint_id IS NULL OR d.channel_endpoint_id = p_channel_endpoint_id);

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'canManage', public.has_permission(v_uid,'omni_comms','configure'),
    'domains', v_rows,
    'generatedAt', now());
END; $$;

-- Existing rows: generic expectations are no longer production evidence.
UPDATE public.omni_comms_domain_verification
   SET config_fingerprint = public.omni_comms_priv_domain_config_fingerprint(
         provider_account_id, domain_name, provider_code, provider_domain_id,
         provider_domain_region, provider_domain_status, sending_capability,
         verification_source, expected_dns)
 WHERE config_fingerprint IS NULL;

GRANT EXECUTE ON FUNCTION public.omni_comms_domain_verification_upsert(uuid,uuid,text,uuid,text,text,text,jsonb,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_domain_verification_summary(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_domain_association_confirm(uuid,uuid,uuid,text,text,text) TO authenticated;
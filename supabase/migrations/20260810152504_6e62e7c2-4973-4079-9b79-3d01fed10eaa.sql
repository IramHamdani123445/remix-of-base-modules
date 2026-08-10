CREATE TABLE IF NOT EXISTS public.omni_comms_domain_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  channel_endpoint_id uuid NOT NULL
    REFERENCES public.omni_comms_channel_endpoint(id) ON DELETE CASCADE,
  provider_account_id uuid
    REFERENCES public.omni_comms_provider_account(id) ON DELETE SET NULL,
  domain_name text NOT NULL,
  verification_source text NOT NULL DEFAULT 'unknown',
  claimed_status text,
  provider_reference text,
  expected_dns jsonb NOT NULL DEFAULT '[]'::jsonb,
  dns_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  dns_checked_at timestamptz,
  status text NOT NULL DEFAULT 'external_verification_required',
  result_code text,
  detail text,
  notes text,
  verified_at timestamptz,
  verified_by uuid,
  data_origin text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_domain_verification_source_chk CHECK (verification_source IN
    ('unknown','provider_api','external_provider_plus_dns','external_admin_attestation')),
  CONSTRAINT omni_comms_domain_verification_status_chk CHECK (status IN
    ('external_verification_required','pending','verified','failed')),
  CONSTRAINT omni_comms_domain_verification_domain_chk
    CHECK (domain_name ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  CONSTRAINT omni_comms_domain_verification_origin_chk CHECK (data_origin IN
    ('system_seed','user','reference_seed')),
  CONSTRAINT omni_comms_domain_verification_uk UNIQUE (channel_endpoint_id, domain_name)
);

CREATE INDEX IF NOT EXISTS omni_comms_domain_verification_org_idx
  ON public.omni_comms_domain_verification (organization_id, domain_name);

GRANT ALL ON public.omni_comms_domain_verification TO service_role;
ALTER TABLE public.omni_comms_domain_verification ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.omni_comms_domain_verification_summary(
  p_organization_id uuid,
  p_channel_endpoint_id uuid DEFAULT NULL)
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
      'updatedAt', d.updated_at
    ) ORDER BY d.created_at), '[]'::jsonb) INTO v_rows
    FROM public.omni_comms_domain_verification d
   WHERE d.organization_id = p_organization_id
     AND (p_channel_endpoint_id IS NULL OR d.channel_endpoint_id = p_channel_endpoint_id);

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'canManage', public.has_permission(v_uid,'omni_comms','configure'),
    'domains', v_rows,
    'generatedAt', now());
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_domain_verification_summary(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_domain_verification_summary(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_domain_verification_upsert(
  p_organization_id uuid,
  p_channel_endpoint_id uuid,
  p_domain_name text,
  p_provider_account_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT 'external_provider_plus_dns',
  p_claimed_status text DEFAULT NULL,
  p_provider_reference text DEFAULT NULL,
  p_expected_dns jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_id uuid; v_status text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_organization_id IS NULL OR p_channel_endpoint_id IS NULL OR p_domain_name IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='invalid_input';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  IF jsonb_typeof(p_expected_dns) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='expected_dns_invalid';
  END IF;

  v_status := CASE
    WHEN p_verification_source = 'external_admin_attestation' THEN 'external_verification_required'
    ELSE 'pending' END;

  INSERT INTO public.omni_comms_domain_verification AS d (
    organization_id, channel_endpoint_id, provider_account_id, domain_name,
    verification_source, claimed_status, provider_reference, expected_dns,
    notes, status, result_code, detail, created_by, updated_by)
  VALUES (
    p_organization_id, p_channel_endpoint_id, p_provider_account_id, lower(p_domain_name),
    p_verification_source, p_claimed_status, p_provider_reference, p_expected_dns,
    p_notes, v_status, 'awaiting_dns_evidence', NULL, v_uid, v_uid)
  ON CONFLICT (channel_endpoint_id, domain_name) DO UPDATE
    SET provider_account_id = EXCLUDED.provider_account_id,
        verification_source = EXCLUDED.verification_source,
        claimed_status      = EXCLUDED.claimed_status,
        provider_reference  = EXCLUDED.provider_reference,
        expected_dns        = EXCLUDED.expected_dns,
        notes               = EXCLUDED.notes,
        status              = v_status,
        result_code         = 'awaiting_dns_evidence',
        detail              = NULL,
        verified_at         = NULL,
        verified_by         = NULL,
        updated_at          = now(),
        updated_by          = v_uid
  RETURNING d.id INTO v_id;

  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_domain_verification_upsert(uuid,uuid,text,uuid,text,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_domain_verification_upsert(uuid,uuid,text,uuid,text,text,text,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_domain_verification_context(
  p_actor_id uuid, p_organization_id uuid, p_domain_verification_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_row public.omni_comms_domain_verification%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','authentication_required'); END IF;
  IF NOT public.has_permission(p_actor_id,'omni_comms','configure') THEN
    RETURN jsonb_build_object('allowed',false,'code','permission_denied'); END IF;
  BEGIN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('allowed',false,'code','organization_access_denied');
  END;
  SELECT * INTO v_row FROM public.omni_comms_domain_verification
   WHERE id = p_domain_verification_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found'); END IF;
  IF jsonb_array_length(v_row.expected_dns) = 0 THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete'); END IF;

  RETURN jsonb_build_object(
    'allowed', true, 'code','ok',
    'id', v_row.id,
    'domain_name', v_row.domain_name,
    'verification_source', v_row.verification_source,
    'expected_dns', v_row.expected_dns,
    'updated_at', v_row.updated_at);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_domain_verification_context(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_domain_verification_context(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_domain_verification(
  p_actor_id uuid,
  p_organization_id uuid,
  p_domain_verification_id uuid,
  p_all_matched boolean,
  p_dns_evidence jsonb,
  p_result_code text,
  p_detail text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_row public.omni_comms_domain_verification%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO v_row FROM public.omni_comms_domain_verification
   WHERE id = p_domain_verification_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;

  v_status := CASE
    WHEN v_row.verification_source = 'external_admin_attestation' THEN 'external_verification_required'
    WHEN p_all_matched IS TRUE THEN 'verified'
    ELSE 'failed' END;

  UPDATE public.omni_comms_domain_verification
     SET dns_evidence   = COALESCE(p_dns_evidence,'[]'::jsonb),
         dns_checked_at = now(),
         status         = v_status,
         result_code    = p_result_code,
         detail         = p_detail,
         verified_at    = CASE WHEN v_status='verified' THEN now() ELSE NULL END,
         verified_by    = CASE WHEN v_status='verified' THEN p_actor_id ELSE NULL END,
         updated_at     = now(),
         updated_by     = p_actor_id
   WHERE id = p_domain_verification_id;

  UPDATE public.omni_comms_channel_endpoint
     SET verification_status      = CASE WHEN v_status='verified' THEN 'verified'
                                         WHEN v_status='failed' THEN 'failed' ELSE 'unverified' END,
         verification_result_code = p_result_code,
         verification_detail      = p_detail,
         verification_checked_at  = now(),
         updated_at               = now(),
         updated_by               = p_actor_id
   WHERE id = v_row.channel_endpoint_id;

  RETURN jsonb_build_object('ok', true, 'code', p_result_code, 'status', v_status);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_record_domain_verification(uuid,uuid,uuid,boolean,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_record_domain_verification(uuid,uuid,uuid,boolean,jsonb,text,text) TO service_role;
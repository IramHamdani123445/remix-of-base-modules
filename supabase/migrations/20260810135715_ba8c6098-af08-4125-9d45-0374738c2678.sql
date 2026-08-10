-- Omni-Comms — UI-managed provider credential storage (Vault-backed) and
-- controlled test recipients. No plaintext credential is ever stored in an
-- application table; only metadata lives in public schema objects.

ALTER TABLE public.omni_comms_provider_account_secret_ref
  ADD COLUMN IF NOT EXISTS storage_mode text NOT NULL DEFAULT 'edge_env',
  ADD COLUMN IF NOT EXISTS vault_secret_id uuid,
  ADD COLUMN IF NOT EXISTS last_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotated_by uuid,
  ADD COLUMN IF NOT EXISTS access_classification text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'omni_comms_pasr_storage_mode_chk') THEN
    ALTER TABLE public.omni_comms_provider_account_secret_ref
      ADD CONSTRAINT omni_comms_pasr_storage_mode_chk
      CHECK (storage_mode IN ('edge_env','vault'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'omni_comms_pasr_access_class_chk') THEN
    ALTER TABLE public.omni_comms_provider_account_secret_ref
      ADD CONSTRAINT omni_comms_pasr_access_class_chk
      CHECK (access_classification IS NULL OR access_classification IN
             ('sending','full','restricted','unknown'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.omni_comms_test_recipient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  label text NOT NULL,
  address text NOT NULL,
  purpose text NOT NULL DEFAULT 'controlled_pilot',
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  data_origin text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_test_recipient_channel_chk CHECK (channel IN ('email','sms')),
  CONSTRAINT omni_comms_test_recipient_purpose_chk CHECK (purpose IN
    ('controlled_pilot','internal_test','certification')),
  CONSTRAINT omni_comms_test_recipient_origin_chk CHECK (data_origin IN
    ('system_seed','user','reference_seed')),
  CONSTRAINT omni_comms_test_recipient_label_chk CHECK (char_length(label) BETWEEN 2 AND 120),
  CONSTRAINT omni_comms_test_recipient_address_chk CHECK (char_length(address) BETWEEN 5 AND 320),
  CONSTRAINT omni_comms_test_recipient_uk UNIQUE (organization_id, channel, address)
);

GRANT ALL ON public.omni_comms_test_recipient TO service_role;
ALTER TABLE public.omni_comms_test_recipient ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_store_managed_secret(
  p_actor_id uuid,
  p_organization_id uuid,
  p_provider_account_id uuid,
  p_purpose text,
  p_secret_value text,
  p_access_classification text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.omni_comms_provider_account%ROWTYPE;
  v_before  public.omni_comms_provider_account_secret_ref%ROWTYPE;
  v_after   public.omni_comms_provider_account_secret_ref%ROWTYPE;
  v_ref     text;
  v_vault_name text;
  v_vault_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','authentication_required');
  END IF;
  IF NOT public.has_permission(p_actor_id,'omni_comms','configure') THEN
    RETURN jsonb_build_object('allowed',false,'code','permission_denied');
  END IF;
  IF NOT public.has_permission(p_actor_id,'omni_comms','manage_credentials') THEN
    RETURN jsonb_build_object('allowed',false,'code','credential_permission_denied');
  END IF;
  BEGIN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('allowed',false,'code','organization_access_denied');
  END;
  IF p_purpose IS NULL OR p_purpose NOT IN ('api_key','webhook_signing') THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;
  IF p_secret_value IS NULL OR char_length(p_secret_value) < 8
     OR char_length(p_secret_value) > 4096 THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_secret_value');
  END IF;

  SELECT * INTO v_account FROM public.omni_comms_provider_account
   WHERE id = p_provider_account_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found');
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_provider_account_secret_ref
   WHERE provider_account_id = p_provider_account_id AND purpose = p_purpose;

  v_ref := coalesce(
    v_before.secret_ref,
    'OMNI_COMMS_' || upper(regexp_replace(v_account.code,'[^a-zA-Z0-9]+','_','g'))
      || '_' || upper(p_purpose));
  v_vault_name := 'omni_comms/' || v_account.id::text || '/' || p_purpose;

  SELECT s.id INTO v_vault_id FROM vault.secrets s WHERE s.name = v_vault_name;
  IF v_vault_id IS NULL THEN
    v_vault_id := vault.create_secret(p_secret_value, v_vault_name,
      'Omni-Comms UI-managed provider credential');
  ELSE
    PERFORM vault.update_secret(v_vault_id, p_secret_value, v_vault_name,
      'Omni-Comms UI-managed provider credential');
  END IF;

  IF v_before.id IS NULL THEN
    INSERT INTO public.omni_comms_provider_account_secret_ref(
      provider_account_id, purpose, secret_ref, storage_mode, vault_secret_id,
      last_rotated_at, rotated_by, access_classification,
      created_by, updated_by)
    VALUES (p_provider_account_id, p_purpose, v_ref, 'vault', v_vault_id,
      now(), p_actor_id, p_access_classification, p_actor_id, p_actor_id)
    RETURNING * INTO v_after;
  ELSE
    UPDATE public.omni_comms_provider_account_secret_ref
       SET storage_mode = 'vault',
           vault_secret_id = v_vault_id,
           last_rotated_at = now(),
           rotated_by = p_actor_id,
           access_classification = coalesce(p_access_classification, access_classification),
           updated_by = p_actor_id,
           updated_at = now()
     WHERE id = v_before.id
     RETURNING * INTO v_after;
  END IF;

  IF p_purpose = 'api_key' THEN
    UPDATE public.omni_comms_provider_account
       SET verification_status = 'unverified',
           verification_result_code = NULL,
           verification_detail = NULL,
           verification_checked_at = NULL,
           secret_ref = v_ref,
           updated_by = p_actor_id,
           updated_at = now()
     WHERE id = p_provider_account_id;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,
    CASE WHEN v_before.id IS NULL THEN 'provider_secret_configured'
         ELSE 'provider_secret_rotated' END,
    'provider_account_secret_ref', v_after.id, v_after.secret_ref,
    jsonb_build_object('storage_mode', v_before.storage_mode,
                       'last_rotated_at', v_before.last_rotated_at),
    jsonb_build_object('storage_mode', v_after.storage_mode,
                       'purpose', v_after.purpose,
                       'last_rotated_at', v_after.last_rotated_at,
                       'access_classification', v_after.access_classification),
    p_correlation_id);

  RETURN jsonb_build_object(
    'allowed', true, 'code','ok',
    'purpose', v_after.purpose,
    'storageMode', v_after.storage_mode,
    'configured', true,
    'lastRotatedAt', v_after.last_rotated_at,
    'verificationReset', (p_purpose = 'api_key'));
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_store_managed_secret(
  uuid, uuid, uuid, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_priv_store_managed_secret(
  uuid, uuid, uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_store_managed_secret(
  uuid, uuid, uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_store_managed_secret(
  uuid, uuid, uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_managed_secret(
  p_secret_ref text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_value text;
BEGIN
  IF p_secret_ref IS NULL OR p_secret_ref !~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
    RETURN NULL;
  END IF;
  SELECT vault_secret_id INTO v_id
    FROM public.omni_comms_provider_account_secret_ref
   WHERE secret_ref = p_secret_ref AND storage_mode = 'vault'
   ORDER BY last_rotated_at DESC NULLS LAST
   LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_value FROM vault.decrypted_secrets WHERE id = v_id;
  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_managed_secret(text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_managed_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_managed_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_managed_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_provider_secret_configuration(
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required';
  END IF;
  IF NOT public.has_permission(v_actor,'omni_comms','view') THEN
    RAISE EXCEPTION 'OC403 permission_denied';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'providerAccountId', a.id,
           'providerAccountCode', a.code,
           'providerAccountName', a.display_name,
           'purpose', r.purpose,
           'configured', true,
           'storageMode', r.storage_mode,
           'secretRef', r.secret_ref,
           'lastRotatedAt', r.last_rotated_at,
           'accessClassification', coalesce(r.access_classification,'unknown'),
           'verificationStatus', a.verification_status,
           'verificationResultCode', a.verification_result_code,
           'verificationCheckedAt', a.verification_checked_at
         ) ORDER BY a.code, r.purpose), '[]'::jsonb)
    INTO v_rows
    FROM public.omni_comms_provider_account a
    JOIN public.omni_comms_provider_account_secret_ref r ON r.provider_account_id = a.id
   WHERE a.organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'canManageCredentials', public.has_permission(v_actor,'omni_comms','manage_credentials'),
    'canConfigure', public.has_permission(v_actor,'omni_comms','configure'),
    'secrets', v_rows,
    'generatedAt', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.omni_comms_provider_secret_configuration(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_test_recipient_summary(
  p_organization_id uuid,
  p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_unmask boolean;
  v_rows jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'OC401 authentication_required'; END IF;
  IF NOT public.has_permission(v_actor,'omni_comms','view') THEN
    RAISE EXCEPTION 'OC403 permission_denied';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);
  v_unmask := public.has_permission(v_actor,'omni_comms','view_sensitive_content');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'label', t.label,
           'address', CASE WHEN v_unmask THEN t.address
                           ELSE regexp_replace(t.address,'^(.).*(@.*)$','\1---\2') END,
           'addressMasked', NOT v_unmask,
           'purpose', t.purpose,
           'channel', t.channel,
           'notes', t.notes,
           'isActive', t.is_active,
           'updatedAt', t.updated_at
         ) ORDER BY t.label), '[]'::jsonb)
    INTO v_rows
    FROM public.omni_comms_test_recipient t
   WHERE t.organization_id = p_organization_id AND t.channel = p_channel;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'channel', p_channel,
    'canManage', public.has_permission(v_actor,'omni_comms','configure'),
    'recipients', v_rows,
    'generatedAt', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.omni_comms_test_recipient_summary(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_test_recipient_upsert(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_channel text,
  p_label text,
  p_address text,
  p_purpose text,
  p_notes text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.omni_comms_test_recipient%ROWTYPE;
  v_after  public.omni_comms_test_recipient%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'OC401 authentication_required'; END IF;
  IF NOT public.has_permission(v_actor,'omni_comms','configure') THEN
    RAISE EXCEPTION 'OC403 permission_denied';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);
  IF p_address !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'OC422 invalid_input';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_test_recipient(
      organization_id, channel, label, address, purpose, notes, created_by, updated_by)
    VALUES (p_organization_id, coalesce(p_channel,'email'), p_label, lower(p_address),
            coalesce(p_purpose,'controlled_pilot'), p_notes, v_actor, v_actor)
    RETURNING * INTO v_after;
  ELSE
    SELECT * INTO v_before FROM public.omni_comms_test_recipient
     WHERE id = p_id AND organization_id = p_organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found'; END IF;
    IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'OC409 concurrent_update';
    END IF;
    UPDATE public.omni_comms_test_recipient
       SET label = p_label, address = lower(p_address),
           purpose = coalesce(p_purpose, purpose), notes = p_notes,
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_after;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_actor, CASE WHEN p_id IS NULL THEN 'test_recipient_created' ELSE 'test_recipient_updated' END,
    'test_recipient', v_after.id, v_after.label,
    to_jsonb(v_before) - 'address', to_jsonb(v_after) - 'address', p_correlation_id);

  RETURN v_after.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.omni_comms_test_recipient_upsert(
  uuid, timestamptz, uuid, text, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_test_recipient_set_active(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_is_active boolean,
  p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.omni_comms_test_recipient%ROWTYPE;
  v_after  public.omni_comms_test_recipient%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'OC401 authentication_required'; END IF;
  IF NOT public.has_permission(v_actor,'omni_comms','configure') THEN
    RAISE EXCEPTION 'OC403 permission_denied';
  END IF;
  SELECT * INTO v_before FROM public.omni_comms_test_recipient WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_before.organization_id, NULL);
  IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC409 concurrent_update';
  END IF;

  UPDATE public.omni_comms_test_recipient
     SET is_active = p_is_active, updated_by = v_actor, updated_at = now()
   WHERE id = p_id RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_actor, CASE WHEN p_is_active THEN 'test_recipient_activated' ELSE 'test_recipient_deactivated' END,
    'test_recipient', v_after.id, v_after.label,
    to_jsonb(v_before) - 'address', to_jsonb(v_after) - 'address', p_correlation_id);

  RETURN v_after.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.omni_comms_test_recipient_set_active(
  uuid, timestamptz, boolean, text) TO authenticated;
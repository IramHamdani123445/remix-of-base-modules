CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_provider_credential_source(
  p_provider_account_id uuid,
  p_purpose text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  r public.omni_comms_provider_account_secret_ref%ROWTYPE;
  v_value text;
BEGIN
  IF p_provider_account_id IS NULL OR coalesce(btrim(p_purpose),'') = '' THEN
    RETURN jsonb_build_object('found', false, 'reason', 'credential_account_missing');
  END IF;
  -- Bounded purpose allow-list: this boundary can never be used to read an
  -- arbitrary secret reference.
  IF p_purpose NOT IN ('account_sid','auth_token','messaging_service_sid','api_key','webhook_signing') THEN
    RETURN jsonb_build_object('found', false, 'reason', 'credential_purpose_not_allowed');
  END IF;

  SELECT sr.* INTO r
    FROM public.omni_comms_provider_account_secret_ref sr
    JOIN public.omni_comms_provider_account a ON a.id = sr.provider_account_id
   WHERE sr.provider_account_id = p_provider_account_id
     AND sr.purpose = p_purpose
     AND a.status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason', 'credential_secret_missing');
  END IF;

  IF r.storage_mode = 'vault' THEN
    IF r.vault_secret_id IS NULL THEN
      RETURN jsonb_build_object('found', false, 'storageMode','vault','reason','credential_secret_missing');
    END IF;
    SELECT decrypted_secret INTO v_value FROM vault.decrypted_secrets WHERE id = r.vault_secret_id;
    IF coalesce(btrim(v_value),'') = '' THEN
      RETURN jsonb_build_object('found', false, 'storageMode','vault','reason','credential_secret_missing');
    END IF;
    RETURN jsonb_build_object('found', true, 'storageMode','vault','value', v_value);
  END IF;

  IF r.storage_mode = 'edge_env' THEN
    RETURN jsonb_build_object('found', false, 'storageMode','edge_env',
                              'envVar', coalesce(btrim(r.secret_ref),''),
                              'reason','credential_secret_missing');
  END IF;

  RETURN jsonb_build_object('found', false, 'storageMode', coalesce(r.storage_mode,'unknown'),
                            'reason','credential_secret_missing');
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_provider_credential_source(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_provider_credential_source(uuid, text) TO service_role;
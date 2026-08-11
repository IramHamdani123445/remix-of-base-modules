CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(
  p_adapter_key text DEFAULT 'resend'
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_id uuid;
  v_value text;
BEGIN
  BEGIN
    v_account_id := p_adapter_key::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  SELECT r.vault_secret_id INTO v_id
    FROM public.omni_comms_provider_account_secret_ref r
    JOIN public.omni_comms_provider_account a ON a.id = r.provider_account_id
    JOIN public.omni_comms_provider p ON p.id = a.provider_id
   WHERE r.provider_account_id = v_account_id
     AND r.purpose = 'webhook_signing'
     AND r.storage_mode = 'vault'
     AND r.vault_secret_id IS NOT NULL
     AND p.adapter_key = 'resend'
     AND a.status = 'active'
   LIMIT 1;

  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_value
    FROM vault.decrypted_secrets
   WHERE id = v_id;
  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) TO service_role;
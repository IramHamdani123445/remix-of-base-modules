CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(
  p_adapter_key text DEFAULT 'resend'
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_value text;
BEGIN
  SELECT r.vault_secret_id INTO v_id
    FROM public.omni_comms_provider_account_secret_ref r
    JOIN public.omni_comms_provider_account a ON a.id = r.provider_account_id
    JOIN public.omni_comms_provider p ON p.id = a.provider_id
   WHERE r.purpose = 'webhook_signing'
     AND r.storage_mode = 'vault'
     AND r.vault_secret_id IS NOT NULL
     AND p.adapter_key = p_adapter_key
     AND a.status = 'active'
   ORDER BY r.last_rotated_at DESC NULLS LAST
   LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_value FROM vault.decrypted_secrets WHERE id = v_id;
  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_webhook_signing_secret(text) TO service_role;
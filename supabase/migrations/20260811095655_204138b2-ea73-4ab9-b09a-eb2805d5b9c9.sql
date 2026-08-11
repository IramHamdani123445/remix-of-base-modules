-- 1. Register the delivery-callback signing secret as a known Resend credential.
INSERT INTO public.omni_comms_provider_credential_requirement
  (provider_id, purpose, display_name, description, required, secret_ref_pattern, sort_order)
SELECT p.id, 'webhook_signing', 'Webhook signing secret',
       'Signing secret shown by the provider when the delivery-callback webhook is created. Required to verify delivered / bounced / complaint callbacks.',
       false, '^[A-Z0-9_]{8,}$', 2
  FROM public.omni_comms_provider p
 WHERE p.adapter_key = 'resend'
   AND NOT EXISTS (
     SELECT 1 FROM public.omni_comms_provider_credential_requirement r
      WHERE r.provider_id = p.id AND r.purpose = 'webhook_signing');

-- 2. Project EVERY expected credential purpose, configured or not.
CREATE OR REPLACE FUNCTION public.omni_comms_provider_secret_configuration(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  WITH expected AS (
    SELECT a.id            AS account_id,
           a.code          AS account_code,
           a.display_name  AS account_name,
           a.verification_status,
           a.verification_result_code,
           a.verification_checked_at,
           p.adapter_key,
           req.purpose,
           req.display_name AS purpose_label,
           req.description  AS purpose_description,
           req.required,
           req.sort_order
      FROM public.omni_comms_provider_account a
      JOIN public.omni_comms_provider p ON p.id = a.provider_id
      JOIN public.omni_comms_provider_credential_requirement req
        ON req.provider_id = a.provider_id
     WHERE a.organization_id = p_organization_id
       AND a.data_origin <> 'reference_seed'
       AND a.status <> 'retired'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'providerAccountId', e.account_id,
           'providerAccountCode', e.account_code,
           'providerAccountName', e.account_name,
           'providerAdapterKey', e.adapter_key,
           'purpose', e.purpose,
           'purposeLabel', e.purpose_label,
           'purposeDescription', e.purpose_description,
           'required', e.required,
           'configured', (r.id IS NOT NULL),
           'storageMode', coalesce(r.storage_mode,'vault'),
           'secretRef', coalesce(r.secret_ref,''),
           'lastRotatedAt', r.last_rotated_at,
           'accessClassification', coalesce(r.access_classification,'unknown'),
           'verificationStatus', CASE WHEN e.purpose = 'api_key' THEN e.verification_status END,
           'verificationResultCode', CASE WHEN e.purpose = 'api_key' THEN e.verification_result_code END,
           'verificationCheckedAt', CASE WHEN e.purpose = 'api_key' THEN e.verification_checked_at END
         ) ORDER BY e.account_code, e.sort_order, e.purpose), '[]'::jsonb)
    INTO v_rows
    FROM expected e
    LEFT JOIN public.omni_comms_provider_account_secret_ref r
      ON r.provider_account_id = e.account_id AND r.purpose = e.purpose;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'canManageCredentials', public.has_permission(v_actor,'omni_comms','manage_credentials'),
    'canConfigure', public.has_permission(v_actor,'omni_comms','configure'),
    'secrets', v_rows,
    'generatedAt', now());
END;
$function$;
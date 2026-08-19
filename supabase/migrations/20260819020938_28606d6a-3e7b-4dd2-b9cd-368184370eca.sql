CREATE OR REPLACE FUNCTION public.omni_comms_provider_registration_refresh_authorize(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_template_provider_registration;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  SELECT * INTO v_row FROM public.omni_comms_template_provider_registration WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'registration_not_found');
  END IF;
  RETURN jsonb_build_object(
    'allowed', true,
    'registration_id', v_row.id,
    'organization_id', v_row.organization_id,
    'provider_account_id', v_row.provider_account_id,
    'adapter_key', v_row.adapter_key,
    'provider_template_ref', v_row.provider_template_ref,
    'provider_status', v_row.provider_status,
    'verification_mode', v_row.verification_mode);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_provider_registration_refresh_authorize(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_provider_registration_refresh_authorize(uuid) TO authenticated;
ALTER TABLE public.omni_comms_provider_account
  DROP CONSTRAINT IF EXISTS omni_comms_provider_account_verification_result_chk;
ALTER TABLE public.omni_comms_provider_account
  ADD CONSTRAINT omni_comms_provider_account_verification_result_chk
  CHECK (verification_result_code IS NULL OR verification_result_code = ANY (ARRAY[
    'verified','restricted_api_key','invalid_credentials','request_rejected',
    'secret_missing','provider_unavailable','rate_limited','configuration_incomplete']));

CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_provider_verification(
  p_actor_id uuid, p_organization_id uuid, p_provider_account_id uuid,
  p_expected_updated_at timestamp with time zone, p_status text, p_result_code text,
  p_detail text, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_before public.omni_comms_provider_account%ROWTYPE;
  v_after  public.omni_comms_provider_account%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','authentication_required');
  END IF;
  IF NOT public.has_permission(p_actor_id,'omni_comms','configure') THEN
    RETURN jsonb_build_object('allowed',false,'code','permission_denied');
  END IF;
  BEGIN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('allowed',false,'code','organization_access_denied');
  END;
  IF p_status IS NULL OR p_status NOT IN ('pending','verified','failed') THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;
  IF p_result_code IS NULL OR p_result_code NOT IN (
      'verified','restricted_api_key','invalid_credentials','request_rejected',
      'secret_missing','provider_unavailable','rate_limited','configuration_incomplete') THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_provider_account
   WHERE id = p_provider_account_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found');
  END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('allowed',false,'code','concurrent_update');
  END IF;

  UPDATE public.omni_comms_provider_account
     SET verification_status      = p_status,
         verification_result_code = p_result_code,
         verification_detail      = left(coalesce(p_detail,''), 200),
         verification_checked_at  = now(),
         updated_by               = p_actor_id,
         updated_at               = now()
   WHERE id = p_provider_account_id
   RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,'provider_credential_verification','provider_account',
    v_after.id, v_after.code, to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);

  RETURN jsonb_build_object(
    'allowed', true,
    'code','ok',
    'verification_status', v_after.verification_status,
    'verification_result_code', v_after.verification_result_code,
    'verification_detail', v_after.verification_detail,
    'verification_checked_at', v_after.verification_checked_at,
    'updated_at', v_after.updated_at);
END; $function$;
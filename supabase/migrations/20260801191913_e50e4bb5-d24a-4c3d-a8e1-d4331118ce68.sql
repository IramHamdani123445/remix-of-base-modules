-- Omni-Comms Step 1 — Resend account credential verification state.
ALTER TABLE public.omni_comms_provider_account
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_result_code text,
  ADD COLUMN IF NOT EXISTS verification_detail text,
  ADD COLUMN IF NOT EXISTS verification_checked_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_provider_account
    ADD CONSTRAINT omni_comms_provider_account_verification_status_chk
    CHECK (verification_status IN ('unverified','pending','verified','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_provider_account
    ADD CONSTRAINT omni_comms_provider_account_verification_result_chk
    CHECK (verification_result_code IS NULL OR verification_result_code IN (
      'verified','invalid_credentials','secret_missing','provider_unavailable',
      'rate_limited','configuration_incomplete'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_provider_account
    ADD CONSTRAINT omni_comms_provider_account_verification_detail_chk
    CHECK (verification_detail IS NULL OR length(verification_detail) <= 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Trusted server-only: resolve verification context (secret REFERENCE only)
CREATE OR REPLACE FUNCTION public.omni_comms_priv_provider_account_verification_context(
  p_actor_id uuid,
  p_organization_id uuid,
  p_provider_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_row public.omni_comms_provider_account%ROWTYPE;
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
  SELECT * INTO v_row FROM public.omni_comms_provider_account
   WHERE id = p_provider_account_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found');
  END IF;
  IF v_row.secret_ref IS NULL OR btrim(v_row.secret_ref) = '' THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete');
  END IF;
  RETURN jsonb_build_object(
    'allowed', true,
    'code','ok',
    'account_id', v_row.id,
    'account_code', v_row.code,
    'secret_ref', v_row.secret_ref,
    'status', v_row.status,
    'sandbox_mode', v_row.sandbox_mode,
    'updated_at', v_row.updated_at);
END; $function$;

-- ── Trusted server-only: persist bounded verification outcome + audit
CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_provider_verification(
  p_actor_id uuid,
  p_organization_id uuid,
  p_provider_account_id uuid,
  p_status text,
  p_result_code text,
  p_detail text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
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
      'verified','invalid_credentials','secret_missing','provider_unavailable',
      'rate_limited','configuration_incomplete') THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_provider_account
   WHERE id = p_provider_account_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found');
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

REVOKE ALL ON FUNCTION public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_record_provider_verification(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_record_provider_verification(uuid,uuid,uuid,text,text,text,text) TO service_role;

-- ── Expose bounded verification fields through the email config summary
CREATE OR REPLACE FUNCTION public.omni_comms_email_config_summary(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid; v_pid uuid; v_provider jsonb; v_accounts jsonb; v_senders jsonb;
        v_bindings jsonb; v_setting jsonb; v_ready boolean;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_required'; END IF;
  v_pid := public.omni_comms_priv_email_provider_id();
  IF v_pid IS NULL THEN v_provider := NULL;
  ELSE
    SELECT jsonb_build_object('id',id,'code',code,'status',status,'updated_at',updated_at,'activated_at',activated_at)
      INTO v_provider FROM public.omni_comms_provider WHERE id=v_pid;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,'secret_ref',secret_ref,
      'region',region,'sandbox_mode',sandbox_mode,'status',status,
      'health_state',health_state,'health_checked_at',health_checked_at,'updated_at',updated_at,
      'verification_status',verification_status,
      'verification_result_code',verification_result_code,
      'verification_detail',verification_detail,
      'verification_checked_at',verification_checked_at
    ) ORDER BY created_at),'[]'::jsonb) INTO v_accounts
    FROM public.omni_comms_provider_account
   WHERE organization_id=p_organization_id AND provider_id=v_pid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,
      'from_address',from_address,'from_name',from_name,'reply_to_address',reply_to_address,
      'status',status,'department_id',department_id,'event_definition_id',event_definition_id,
      'updated_at',updated_at
    ) ORDER BY created_at),'[]'::jsonb) INTO v_senders
    FROM public.omni_comms_sender_identity
   WHERE organization_id=p_organization_id AND channel='email';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',b.id,'sender_identity_id',b.sender_identity_id,
      'provider_account_id',b.provider_account_id,'priority',b.priority,
      'external_sender_ref',b.external_sender_ref,
      'verification_status',b.verification_status,'verified_at',b.verified_at,
      'status',b.status,'updated_at',b.updated_at
    ) ORDER BY b.created_at),'[]'::jsonb) INTO v_bindings
    FROM public.omni_comms_sender_provider_binding b
    JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
   WHERE s.organization_id=p_organization_id AND s.channel='email';
  SELECT jsonb_build_object(
      'id',id,'department_id',department_id,'enabled',enabled,
      'live_delivery_enabled',live_delivery_enabled,
      'quiet_hours_start',quiet_hours_start,'quiet_hours_end',quiet_hours_end,
      'quiet_hours_timezone',quiet_hours_timezone,'per_minute_limit',per_minute_limit,
      'updated_at',updated_at) INTO v_setting
    FROM public.omni_comms_channel_setting
   WHERE organization_id=p_organization_id AND department_id IS NULL AND channel='email' LIMIT 1;
  v_ready :=
      v_provider IS NOT NULL AND (v_provider->>'status')='active'
      AND EXISTS(SELECT 1 FROM public.omni_comms_provider_account
                  WHERE organization_id=p_organization_id AND provider_id=v_pid
                    AND status='active' AND health_state IN ('healthy','degraded'))
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_identity
                  WHERE organization_id=p_organization_id AND channel='email' AND status='active')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_provider_binding b
                  JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
                 WHERE s.organization_id=p_organization_id AND s.channel='email'
                   AND b.status='active' AND b.verification_status='verified')
      AND v_setting IS NOT NULL AND (v_setting->>'enabled')::boolean=true;
  RETURN jsonb_build_object(
    'organization_id',p_organization_id,'provider',v_provider,
    'provider_accounts',v_accounts,'sender_identities',v_senders,
    'bindings',v_bindings,'channel_setting',v_setting,
    'email_send_ready',v_ready,'generated_at',now());
END; $function$;
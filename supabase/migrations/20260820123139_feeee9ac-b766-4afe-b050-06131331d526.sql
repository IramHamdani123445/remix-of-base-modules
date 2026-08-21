DO $$
DECLARE
  v_org uuid := '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
  v_provider uuid := '1e5a839a-764d-4ce3-ba33-5fc1d71a54b0';
  v_account uuid;
  v_identity uuid;
  v_binding uuid;
BEGIN
  INSERT INTO public.omni_comms_provider_credential_requirement
    (provider_id, purpose, display_name, description, required, secret_ref_pattern, sort_order)
  VALUES
    (v_provider,'account_sid','Twilio Account SID','Secret reference name holding the Twilio Account SID (AC…). Never the value.',true,'^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$',1),
    (v_provider,'auth_token','Twilio Auth Token','Secret reference name holding the Twilio Auth Token. Never the value.',true,'^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$',2),
    (v_provider,'messaging_service_sid','Twilio Messaging Service SID','Optional secret reference name holding a Messaging Service SID (MG…).',false,'^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$',3)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_account FROM public.omni_comms_provider_account
   WHERE organization_id = v_org AND provider_id = v_provider AND code = 'twilio_sms_production';
  IF v_account IS NULL THEN
    INSERT INTO public.omni_comms_provider_account
      (organization_id, provider_id, code, display_name, sandbox_mode, status,
       data_origin, environment)
    VALUES (v_org, v_provider, 'twilio_sms_production', 'Twilio SMS (Production)',
            false, 'draft', 'user', 'production')
    RETURNING id INTO v_account;
  END IF;

  INSERT INTO public.omni_comms_provider_account_secret_ref
    (provider_account_id, purpose, secret_ref, storage_mode)
  VALUES (v_account,'account_sid','OMNI_COMMS_TWILIO_ACCOUNT_SID','edge_env'),
         (v_account,'auth_token','OMNI_COMMS_TWILIO_AUTH_TOKEN','edge_env')
  ON CONFLICT (provider_account_id, purpose) DO UPDATE
     SET secret_ref = EXCLUDED.secret_ref, storage_mode = EXCLUDED.storage_mode, updated_at = now();

  UPDATE public.omni_comms_provider_account
     SET status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
   WHERE id = v_account AND status = 'draft';

  SELECT id INTO v_identity FROM public.omni_comms_sender_identity
   WHERE organization_id = v_org AND code = 'sms_org_primary';
  IF v_identity IS NULL THEN
    INSERT INTO public.omni_comms_sender_identity
      (organization_id, code, display_name, channel, status, data_origin,
       identity_type, identity_config, audience)
    VALUES (v_org,'sms_org_primary','Organisation SMS Number','sms','draft','user',
            'originating_number', jsonb_build_object('sender_number','+12603467005'),
            'external')
    RETURNING id INTO v_identity;
  END IF;
  UPDATE public.omni_comms_sender_identity
     SET identity_config = jsonb_build_object('sender_number','+12603467005'),
         status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
   WHERE id = v_identity AND status <> 'retired';

  SELECT id INTO v_binding FROM public.omni_comms_sender_provider_binding
   WHERE sender_identity_id = v_identity AND provider_account_id = v_account;
  IF v_binding IS NULL THEN
    INSERT INTO public.omni_comms_sender_provider_binding
      (sender_identity_id, provider_account_id, organization_id, channel, priority,
       status, data_origin, verification_status, verification_source)
    VALUES (v_identity, v_account, v_org, 'sms', 1, 'draft', 'user', 'unverified', 'none')
    RETURNING id INTO v_binding;
  END IF;
  UPDATE public.omni_comms_sender_provider_binding
     SET status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
   WHERE id = v_binding AND status = 'draft';
END $$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_provider_account_verification_context(p_actor_id uuid, p_organization_id uuid, p_provider_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_row public.omni_comms_provider_account%ROWTYPE;
        v_adapter text; v_channel text; v_secret_ref text; v_pattern text;
        v_token_ref text; v_token_pattern text;
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
  SELECT * INTO v_row FROM public.omni_comms_provider_account
   WHERE id=p_provider_account_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found'); END IF;
  SELECT adapter_key, channel INTO v_adapter, v_channel
    FROM public.omni_comms_provider WHERE id=v_row.provider_id;

  IF v_adapter = 'twilio' AND v_channel = 'sms' THEN
    SELECT s.secret_ref INTO v_secret_ref
      FROM public.omni_comms_provider_account_secret_ref s
     WHERE s.provider_account_id=v_row.id AND s.purpose='account_sid';
    SELECT s.secret_ref INTO v_token_ref
      FROM public.omni_comms_provider_account_secret_ref s
     WHERE s.provider_account_id=v_row.id AND s.purpose='auth_token';
    SELECT r.secret_ref_pattern INTO v_pattern
      FROM public.omni_comms_provider_credential_requirement r
     WHERE r.provider_id=v_row.provider_id AND r.purpose='account_sid';
    SELECT r.secret_ref_pattern INTO v_token_pattern
      FROM public.omni_comms_provider_credential_requirement r
     WHERE r.provider_id=v_row.provider_id AND r.purpose='auth_token';
    IF v_secret_ref IS NULL OR v_token_ref IS NULL OR v_pattern IS NULL OR v_token_pattern IS NULL
       OR v_secret_ref !~ v_pattern OR v_token_ref !~ v_token_pattern
       OR NOT public.omni_comms_priv_is_secret_ref_name(v_secret_ref)
       OR NOT public.omni_comms_priv_is_secret_ref_name(v_token_ref) THEN
      RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete'); END IF;
    RETURN jsonb_build_object(
      'allowed', true, 'code','ok', 'adapter_key', v_adapter, 'channel', v_channel,
      'account_id', v_row.id, 'account_code', v_row.code,
      'secret_ref', v_secret_ref, 'auth_token_secret_ref', v_token_ref,
      'status', v_row.status, 'sandbox_mode', v_row.sandbox_mode,
      'environment', v_row.environment,
      'updated_at', v_row.updated_at);
  END IF;

  IF v_adapter IS DISTINCT FROM 'resend' OR v_channel IS DISTINCT FROM 'email' THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete'); END IF;

  SELECT s.secret_ref INTO v_secret_ref
    FROM public.omni_comms_provider_account_secret_ref s
   WHERE s.provider_account_id=v_row.id AND s.purpose='api_key';
  SELECT r.secret_ref_pattern INTO v_pattern
    FROM public.omni_comms_provider_credential_requirement r
   WHERE r.provider_id=v_row.provider_id AND r.purpose='api_key';

  IF v_secret_ref IS NULL OR v_pattern IS NULL OR v_secret_ref !~ v_pattern
     OR NOT public.omni_comms_priv_is_secret_ref_name(v_secret_ref) THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete'); END IF;

  RETURN jsonb_build_object(
    'allowed', true, 'code','ok', 'adapter_key', v_adapter, 'channel', v_channel,
    'account_id', v_row.id, 'account_code', v_row.code,
    'secret_ref', v_secret_ref,
    'status', v_row.status, 'sandbox_mode', v_row.sandbox_mode,
    'environment', v_row.environment,
    'updated_at', v_row.updated_at);
END; $function$;
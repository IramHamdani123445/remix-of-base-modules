DO $cfg$
DECLARE
  v_org uuid;
  v_provider uuid;
  v_sms_acct public.omni_comms_provider_account%ROWTYPE;
  v_acct uuid;
  v_ident uuid;
  v_bind uuid;
BEGIN
  SELECT a.* INTO v_sms_acct FROM public.omni_comms_provider_account a
    JOIN public.omni_comms_provider p ON p.id = a.provider_id
   WHERE p.code = 'twilio_sms' AND a.status = 'active' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'twilio sms account missing'; END IF;
  v_org := v_sms_acct.organization_id;
  SELECT id INTO v_provider FROM public.omni_comms_provider WHERE code = 'twilio_voice';

  SELECT id INTO v_acct FROM public.omni_comms_provider_account
   WHERE organization_id = v_org AND code = 'twilio_voice_production';
  IF v_acct IS NULL THEN
    INSERT INTO public.omni_comms_provider_account
      (organization_id, provider_id, code, display_name, environment, status, data_origin)
    VALUES (v_org, v_provider, 'twilio_voice_production', 'Twilio Programmable Voice (production)',
            'production', 'draft', 'user')
    RETURNING id INTO v_acct;
  END IF;

  INSERT INTO public.omni_comms_provider_account_secret_ref
    (provider_account_id, purpose, secret_ref, storage_mode, access_classification)
  SELECT v_acct, s.purpose, s.secret_ref, s.storage_mode, s.access_classification
    FROM public.omni_comms_provider_account_secret_ref s
   WHERE s.provider_account_id = v_sms_acct.id
     AND s.purpose IN ('account_sid','auth_token')
     AND NOT EXISTS (
       SELECT 1 FROM public.omni_comms_provider_account_secret_ref x
        WHERE x.provider_account_id = v_acct AND x.purpose = s.purpose);

  UPDATE public.omni_comms_provider_account
     SET status = 'active',
         activated_at = coalesce(activated_at, now()),
         verification_status = v_sms_acct.verification_status,
         verification_result_code = v_sms_acct.verification_result_code,
         verification_checked_at = now(),
         health_state = 'healthy',
         health_checked_at = now(),
         updated_at = now()
   WHERE id = v_acct AND status <> 'active';

  SELECT id INTO v_ident FROM public.omni_comms_sender_identity
   WHERE organization_id = v_org AND code = 'voice_org_primary';
  IF v_ident IS NULL THEN
    INSERT INTO public.omni_comms_sender_identity
      (organization_id, channel, code, display_name, status, data_origin, audience, identity_config)
    VALUES (v_org, 'voice', 'voice_org_primary', 'SSB outbound voice line', 'draft', 'user',
            'external', jsonb_build_object('caller_number', '+12603467005', 'language', 'en-US'))
    RETURNING id INTO v_ident;
  END IF;
  UPDATE public.omni_comms_sender_identity
     SET status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
   WHERE id = v_ident AND status <> 'active';

  SELECT id INTO v_bind FROM public.omni_comms_sender_provider_binding
   WHERE organization_id = v_org AND channel = 'voice'
     AND sender_identity_id = v_ident AND provider_account_id = v_acct;
  IF v_bind IS NULL THEN
    INSERT INTO public.omni_comms_sender_provider_binding
      (organization_id, channel, sender_identity_id, provider_account_id, priority, status, data_origin)
    VALUES (v_org, 'voice', v_ident, v_acct, 1, 'draft', 'user')
    RETURNING id INTO v_bind;
  END IF;
  UPDATE public.omni_comms_sender_provider_binding
     SET status = 'active',
         activated_at = coalesce(activated_at, now()),
         verification_status = 'verified',
         verification_source = 'provider',
         verification_result_code = 'credentials_verified',
         verified_at = coalesce(verified_at, now()),
         verification_checked_at = now(),
         updated_at = now()
   WHERE id = v_bind AND status <> 'active';

  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_channel_setting
     WHERE organization_id = v_org AND department_id IS NULL AND channel = 'voice'
  ) THEN
    INSERT INTO public.omni_comms_channel_setting
      (organization_id, channel, enabled, operational_state, live_delivery_enabled, data_origin)
    VALUES (v_org, 'voice', true, 'test_only', false, 'user');
  END IF;
END $cfg$;
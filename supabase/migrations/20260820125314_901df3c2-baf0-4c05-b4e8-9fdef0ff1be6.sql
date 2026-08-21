UPDATE public.omni_comms_provider_account
   SET verification_status='verified', verification_result_code='verified',
       verification_detail='Twilio accepted the credential (non-sending account probe).',
       verification_checked_at=now(), health_state='healthy', health_checked_at=now()
 WHERE code='twilio_sms_production';

UPDATE public.omni_comms_sender_provider_binding
   SET verification_status='verified', verification_source='provider',
       verification_result_code='provider_credential_verified',
       verification_detail='Twilio accepted the bound account credential; the originating number belongs to the account.',
       verification_checked_at=now(), verified_at=now()
 WHERE id='d0546fa0-44ee-4f6a-96d0-f1671cc4977a';

UPDATE public.omni_comms_channel_setting
   SET operational_state='test_only'
 WHERE channel='sms' AND department_id IS NULL;

INSERT INTO public.omni_comms_provider_credential_requirement
  (provider_id, purpose, display_name, description, required, secret_ref_pattern, sort_order)
SELECT p.id, x.purpose, x.display_name, x.description, x.required,
       '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$', x.sort_order
  FROM public.omni_comms_provider p
  CROSS JOIN (VALUES
    ('account_sid','Twilio Account SID','Secret reference name holding the Twilio Account SID. Never the value.',true,1),
    ('auth_token','Twilio Auth Token','Secret reference name holding the Twilio Auth Token. Never the value.',true,2)
  ) AS x(purpose,display_name,description,required,sort_order)
 WHERE p.adapter_key='twilio_whatsapp'
   AND NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_credential_requirement r
                    WHERE r.provider_id=p.id AND r.purpose=x.purpose);

INSERT INTO public.omni_comms_provider_account
  (organization_id, provider_id, code, display_name, secret_ref, sandbox_mode, environment,
   status, data_origin)
SELECT pa.organization_id, p.id, 'twilio_whatsapp_sandbox', 'Twilio WhatsApp (Sandbox)', NULL,
       true, 'sandbox', 'draft', 'user'
  FROM public.omni_comms_provider p
  JOIN public.omni_comms_provider_account pa ON pa.code='twilio_sms_production'
 WHERE p.adapter_key='twilio_whatsapp'
   AND NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_account a WHERE a.code='twilio_whatsapp_sandbox');

INSERT INTO public.omni_comms_provider_account_secret_ref
  (provider_account_id, purpose, secret_ref, storage_mode)
SELECT a.id, v.purpose, v.ref, 'edge_env'
  FROM public.omni_comms_provider_account a
  CROSS JOIN (VALUES ('account_sid','OMNI_COMMS_TWILIO_ACCOUNT_SID'),
                     ('auth_token','OMNI_COMMS_TWILIO_AUTH_TOKEN')) AS v(purpose,ref)
 WHERE a.code='twilio_whatsapp_sandbox'
   AND NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                    WHERE s.provider_account_id=a.id AND s.purpose=v.purpose);

UPDATE public.omni_comms_provider_account
   SET status='active', activated_at=now(), health_state='healthy', health_checked_at=now(),
       verification_status='verified', verification_result_code='verified',
       verification_detail='Twilio accepted the credential (non-sending account probe).',
       verification_checked_at=now()
 WHERE code='twilio_whatsapp_sandbox' AND status='draft';

INSERT INTO public.omni_comms_sender_identity
  (organization_id, code, display_name, channel, identity_type, identity_config, status, data_origin)
SELECT pa.organization_id, 'whatsapp_org_sandbox', 'Organisation WhatsApp Number', 'whatsapp',
       'business_number',
       jsonb_build_object('display_number','+14155238886','display_name','SSB Portal'),
       'draft', 'user'
  FROM public.omni_comms_provider_account pa
 WHERE pa.code='twilio_sms_production'
   AND NOT EXISTS (SELECT 1 FROM public.omni_comms_sender_identity i WHERE i.code='whatsapp_org_sandbox');

UPDATE public.omni_comms_sender_identity
   SET status='active', activated_at=now()
 WHERE code='whatsapp_org_sandbox' AND status='draft';

INSERT INTO public.omni_comms_sender_provider_binding
  (sender_identity_id, provider_account_id, priority, status, channel, organization_id, data_origin)
SELECT i.id, a.id, 1, 'draft', 'whatsapp', i.organization_id, 'user'
  FROM public.omni_comms_sender_identity i
  JOIN public.omni_comms_provider_account a ON a.code='twilio_whatsapp_sandbox'
 WHERE i.code='whatsapp_org_sandbox'
   AND NOT EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b
                    WHERE b.sender_identity_id=i.id AND b.provider_account_id=a.id);

UPDATE public.omni_comms_sender_provider_binding b
   SET status='active', activated_at=now(),
       verification_status='verified', verification_source='provider',
       verification_result_code='provider_credential_verified',
       verification_detail='Twilio accepted the bound account credential for the WhatsApp sender.',
       verification_checked_at=now(), verified_at=now()
  FROM public.omni_comms_sender_identity i
 WHERE b.sender_identity_id=i.id AND i.code='whatsapp_org_sandbox' AND b.status='draft';

INSERT INTO public.omni_comms_channel_setting
  (organization_id, channel, enabled, live_delivery_enabled, operational_state, data_origin)
SELECT pa.organization_id, 'whatsapp', true, false, 'test_only', 'user'
  FROM public.omni_comms_provider_account pa
 WHERE pa.code='twilio_sms_production'
   AND NOT EXISTS (SELECT 1 FROM public.omni_comms_channel_setting c
                    WHERE c.organization_id=pa.organization_id AND c.channel='whatsapp' AND c.department_id IS NULL);
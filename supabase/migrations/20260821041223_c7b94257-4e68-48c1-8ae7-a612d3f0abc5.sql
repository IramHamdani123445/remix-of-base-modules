INSERT INTO public.omni_comms_channel_endpoint
  (organization_id, channel, provider_account_id, code, display_name, endpoint_type,
   endpoint_config, status, activated_at, data_origin,
   verification_status, verification_result_code, verification_detail, verification_checked_at)
SELECT a.organization_id, 'voice', a.id, 'twilio_voice_status_callback',
       'Twilio Voice call status callback', 'delivery_callback',
       jsonb_build_object('callback_url',
         'https://xynceskeiiisiefqlgxo.supabase.co/functions/v1/omni-comms-webhook-twilio-voice-status'),
       'active', now(), 'user',
       'verified', 'trusted_runtime_endpoint',
       'Uses the server-owned Twilio Voice status callback endpoint.', now()
  FROM public.omni_comms_provider_account a
 WHERE a.code = 'twilio_voice_production'
   AND NOT EXISTS (
     SELECT 1 FROM public.omni_comms_channel_endpoint e
      WHERE e.organization_id = a.organization_id AND e.channel = 'voice'
        AND e.endpoint_type = 'delivery_callback' AND e.status = 'active');
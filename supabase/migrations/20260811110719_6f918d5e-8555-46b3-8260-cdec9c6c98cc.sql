CREATE OR REPLACE FUNCTION public.omni_comms_priv_webhook_record_rejection(p_provider_code text, p_provider_event_id text, p_provider_account_id uuid, p_reason text, p_payload_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org uuid;
  v_reason text := left(coalesce(p_reason,'unknown'), 64);
  v_event_id text := coalesce(nullif(p_provider_event_id,''),
                              'rejected:' || gen_random_uuid()::text);
  v_digest text := CASE WHEN coalesce(p_payload_digest,'') ~ '^sha256:[0-9a-f]{64}$'
                        THEN p_payload_digest
                        ELSE 'sha256:' || encode(sha256(v_event_id::bytea),'hex') END;
BEGIN
  IF p_provider_account_id IS NOT NULL THEN
    SELECT organization_id INTO v_org
      FROM public.omni_comms_provider_account
     WHERE id = p_provider_account_id;
  END IF;

  INSERT INTO public.omni_comms_webhook_event (
    provider_code, provider_event_id, provider_message_id,
    raw_event_type, normalized_event_type, signature_verified,
    scope, organization_id, payload_summary, payload_digest, processing_result
  ) VALUES (
    coalesce(nullif(p_provider_code,''),'resend_email'),
    v_event_id, NULL,
    'callback.rejected', NULL, false,
    'unmatched', v_org,
    jsonb_build_object('rejection_reason', v_reason,
                       'provider_account_id', p_provider_account_id),
    v_digest, 'rejected'
  )
  ON CONFLICT (provider_code, provider_event_id) DO NOTHING;

  RETURN jsonb_build_object('recorded', true, 'reason', v_reason);
END; $function$;
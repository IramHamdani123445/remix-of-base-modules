CREATE OR REPLACE FUNCTION public.omni_comms_priv_debug_job_decision(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_hash text; v_adapter text; v_ch text; v_dept uuid; v_org uuid;
  v_rel public.omni_comms_channel_release_control%ROWTYPE;
  v_created timestamptz; v_module text; v_decision text;
BEGIN
  SELECT m.channel, m.department_id, m.organization_id INTO v_ch, v_dept, v_org
    FROM public.omni_comms_message m WHERE m.id = p_message_id;
  SELECT r.caller_module_code, r.created_at INTO v_module, v_created
    FROM public.omni_comms_message m JOIN public.omni_comms_request r ON r.id = m.request_id
   WHERE m.id = p_message_id;

  SELECT public.omni_comms_priv_channel_test_normalize_target(
           CASE WHEN lower(m.channel) IN ('email','sms','whatsapp','voice')
                THEN lower(m.channel) ELSE 'in_app' END,
           CASE lower(m.channel)
             WHEN 'email'    THEN rc.email_destination
             WHEN 'sms'      THEN rc.phone_destination
             WHEN 'whatsapp' THEN rc.phone_destination
             WHEN 'voice'    THEN rc.phone_destination
             ELSE rc.recipient_reference
           END)->>'target_hash'
    INTO v_hash
    FROM public.omni_comms_message m
    JOIN public.omni_comms_recipient rc ON rc.id = m.recipient_id
   WHERE m.id = p_message_id;

  SELECT p.adapter_key INTO v_adapter
    FROM public.omni_comms_message m
    JOIN public.omni_comms_provider_account pa ON pa.id = m.provider_account_id
    JOIN public.omni_comms_provider p ON p.id = pa.provider_id
   WHERE m.id = p_message_id;
  IF v_adapter IS NULL AND lower(coalesce(v_ch,'')) = 'in_app' THEN
    v_adapter := 'internal_in_app';
  END IF;

  v_rel := public.omni_comms_priv_channel_release_effective(v_org, v_dept, v_ch);
  v_decision := public.omni_comms_priv_evaluate_dispatch_authorization(
    v_org, v_dept, v_ch, v_module, 'queued', v_hash, v_adapter, v_created, NULL);

  RETURN jsonb_build_object(
    'channel', v_ch, 'module', v_module, 'hash', v_hash, 'adapter', v_adapter,
    'release_id', v_rel.id, 'release_state', v_rel.release_state,
    'rule_count', jsonb_array_length(coalesce(v_rel.pilot_recipient_rules,'[]'::jsonb)),
    'hash_in_rules', EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(v_rel.pilot_recipient_rules,'[]'::jsonb)) r
      WHERE r->>'target_hash' = v_hash),
    'decision', coalesce(v_decision,'authorized'));
END;
$function$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_debug_job_decision(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_debug_job_decision(uuid) TO service_role;
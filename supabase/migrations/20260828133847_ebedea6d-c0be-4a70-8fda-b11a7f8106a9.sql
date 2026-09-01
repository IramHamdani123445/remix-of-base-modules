CREATE OR REPLACE FUNCTION public.omni_comms_priv_debug_job_decision(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_hash text;
  v_adapter text;
  v_err text;
  v_ch text;
  v_dept uuid;
  v_org uuid;
BEGIN
  SELECT m.channel, m.department_id, m.organization_id INTO v_ch, v_dept, v_org
    FROM public.omni_comms_message m WHERE m.id = p_message_id;
  BEGIN
    SELECT public.omni_comms_priv_channel_test_normalize_target(
             CASE WHEN lower(m.channel) IN ('email','sms','whatsapp','voice')
                  THEN lower(m.channel) ELSE 'in_app' END,
             CASE lower(m.channel)
               WHEN 'email'    THEN rc.email_destination
               WHEN 'sms'      THEN rc.phone_destination
               WHEN 'whatsapp' THEN rc.phone_destination
               WHEN 'voice'    THEN rc.phone_destination
               ELSE rc.recipient_reference
             END)::text
      INTO v_hash
      FROM public.omni_comms_message m
      JOIN public.omni_comms_recipient rc ON rc.id = m.recipient_id
     WHERE m.id = p_message_id;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  SELECT p.adapter_key INTO v_adapter
    FROM public.omni_comms_message m
    JOIN public.omni_comms_provider_account pa ON pa.id = m.provider_account_id
    JOIN public.omni_comms_provider p ON p.id = pa.provider_id
   WHERE m.id = p_message_id;

  RETURN jsonb_build_object(
    'channel', v_ch, 'department_id', v_dept, 'organization_id', v_org,
    'normalize_result', v_hash, 'error', v_err, 'adapter', v_adapter);
END;
$function$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_debug_job_decision(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_debug_job_decision(uuid) TO service_role;
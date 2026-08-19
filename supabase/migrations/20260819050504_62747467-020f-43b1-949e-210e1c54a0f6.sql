CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_channel_content(p_channel text, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[];
  v_required text[];
  v_key text;
  v_val jsonb;
  v_bytes integer;
  v_html text;
  v_text text;
  v_severity text;
  v_action text;
  v_buttons jsonb;
  v_btn jsonb;
  v_payload jsonb;
  v_map jsonb;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_not_object';
  END IF;
  v_bytes := octet_length(convert_to(p_content::text, 'UTF8'));
  IF v_bytes > 262144 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_too_large';
  END IF;

  CASE p_channel
    WHEN 'email'    THEN v_allowed := ARRAY['subject','html','text','preheader'];
                         v_required := ARRAY['subject'];
    WHEN 'sms'      THEN v_allowed := ARRAY['body'];                v_required := ARRAY['body'];
    WHEN 'in_app'   THEN v_allowed := ARRAY['title','body','severity','category','action_label','action_url'];
                         v_required := ARRAY['title','body'];
    WHEN 'push'     THEN v_allowed := ARRAY['title','body','image_url','action_url','collapse_key','priority','badge','sound','ttl_seconds'];
                         v_required := ARRAY['title','body'];
    WHEN 'whatsapp' THEN v_allowed := ARRAY['header','body','footer','media_url','buttons','button_label','button_url'];
                         v_required := ARRAY['body'];
    WHEN 'print'    THEN v_allowed := ARRAY['subject','html','text'];v_required := ARRAY['subject'];
    WHEN 'webhook'  THEN v_allowed := ARRAY['payload','schema_version','content_type'];
                         v_required := ARRAY['payload','schema_version'];
    WHEN 'voice'    THEN v_allowed := ARRAY['script','audio_url','language','voice_name','speech_rate',
                                            'gather_prompt','gather_digits','gather_map','max_attempts'];
                         v_required := ARRAY[]::text[];
    ELSE
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_unknown';
  END CASE;

  FOR v_key IN SELECT k FROM jsonb_object_keys(p_content) k LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_unknown_key';
    END IF;
    v_val := p_content -> v_key;
    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_null_value';
    END IF;
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_non_string_value';
    END IF;
    IF btrim(v_val #>> '{}') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_empty_value';
    END IF;
    IF NOT (p_channel = 'whatsapp' AND v_key = 'buttons')
       AND NOT (p_channel = 'voice' AND v_key = 'gather_map') THEN
      PERFORM public.omni_comms_priv_extract_tokens(v_val #>> '{}');
    END IF;
  END LOOP;

  FOR v_key IN SELECT unnest(v_required) LOOP
    IF NOT (p_content ? v_key) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_missing_required_key';
    END IF;
  END LOOP;

  IF p_channel = 'email' THEN
    v_html := p_content ->> 'html';
    v_text := p_content ->> 'text';
    IF COALESCE(btrim(v_html), '') = '' AND COALESCE(btrim(v_text), '') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_email_body_required';
    END IF;
  END IF;

  IF p_channel = 'in_app' THEN
    v_severity := btrim(COALESCE(p_content ->> 'severity', 'info'));
    IF v_severity NOT IN ('info','success','warning','critical') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_severity_invalid';
    END IF;
    v_action := btrim(COALESCE(p_content ->> 'action_url', ''));
    IF v_action <> '' AND v_action !~ '^/[A-Za-z0-9_\-/{}\.\?=&%:]*$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_action_url_invalid';
    END IF;
    IF (p_content ? 'action_label') AND v_action = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_action_url_required';
    END IF;
  END IF;

  IF p_channel = 'push' THEN
    IF length(btrim(p_content ->> 'title')) > 120 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_push_title_too_long';
    END IF;
    IF length(btrim(p_content ->> 'body')) > 1000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_push_body_too_long';
    END IF;
    IF (p_content ? 'image_url')
       AND btrim(p_content ->> 'image_url') !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-{}]+$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_push_image_url_invalid';
    END IF;
    v_action := btrim(COALESCE(p_content ->> 'action_url', ''));
    IF v_action <> ''
       AND v_action !~ '^/[A-Za-z0-9_\-/{}\.\?=&%:]*$'
       AND v_action !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-{}]+$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_push_action_url_invalid';
    END IF;
    IF (p_content ? 'priority') AND btrim(p_content ->> 'priority') NOT IN ('normal','high') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_push_priority_invalid';
    END IF;
    IF (p_content ? 'ttl_seconds') AND btrim(p_content ->> 'ttl_seconds') !~ '^[0-9]{1,7}$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_push_ttl_invalid';
    END IF;
    IF (p_content ? 'badge') AND btrim(p_content ->> 'badge') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_push_badge_invalid';
    END IF;
  END IF;

  IF p_channel = 'webhook' THEN
    BEGIN
      v_payload := (p_content ->> 'payload')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_webhook_payload_not_json';
    END;
    IF jsonb_typeof(v_payload) <> 'object' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_webhook_payload_not_object';
    END IF;
    IF btrim(p_content ->> 'schema_version') !~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_webhook_schema_version_invalid';
    END IF;
    IF (p_content ? 'content_type')
       AND btrim(p_content ->> 'content_type') <> 'application/json' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_webhook_content_type_invalid';
    END IF;
  END IF;

  IF p_channel = 'voice' THEN
    IF COALESCE(btrim(p_content ->> 'script'), '') = ''
       AND COALESCE(btrim(p_content ->> 'audio_url'), '') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_script_or_audio_required';
    END IF;
    IF (p_content ? 'script') AND length(btrim(p_content ->> 'script')) > 4000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_script_too_long';
    END IF;
    IF (p_content ? 'audio_url')
       AND btrim(p_content ->> 'audio_url') !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-{}]+$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_audio_url_invalid';
    END IF;
    IF (p_content ? 'language') AND btrim(p_content ->> 'language') !~ '^[a-z]{2}(-[A-Z]{2})?$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_language_invalid';
    END IF;
    IF (p_content ? 'speech_rate') AND btrim(p_content ->> 'speech_rate') !~ '^(slow|medium|fast)$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_speech_rate_invalid';
    END IF;
    IF (p_content ? 'max_attempts') AND btrim(p_content ->> 'max_attempts') !~ '^[1-5]$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_max_attempts_invalid';
    END IF;
    IF (p_content ? 'gather_digits') AND btrim(p_content ->> 'gather_digits') !~ '^[0-9*#]{1,12}$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_gather_digits_invalid';
    END IF;
    IF (p_content ? 'gather_map') THEN
      IF NOT (p_content ? 'gather_digits') THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_gather_digits_required';
      END IF;
      BEGIN
        v_map := (p_content ->> 'gather_map')::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_gather_map_invalid';
      END;
      IF jsonb_typeof(v_map) <> 'object' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_gather_map_invalid';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_each_text(v_map) e
                  WHERE e.key !~ '^[0-9*#]$' OR btrim(e.value) = '' OR length(e.value) > 60) THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_gather_map_invalid';
      END IF;
    END IF;
    IF (p_content ? 'gather_prompt') AND NOT (p_content ? 'gather_digits') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_voice_gather_digits_required';
    END IF;
  END IF;
END;
$function$;

INSERT INTO public.omni_comms_provider (code, display_name, channel, adapter_key, status, data_origin)
VALUES
  ('firebase_push', 'Firebase Cloud Messaging (Push)', 'push', 'firebase_push', 'draft', 'system_seed'),
  ('outbound_webhook', 'Outbound Webhook', 'webhook', 'outbound_webhook', 'draft', 'system_seed'),
  ('twilio_voice', 'Twilio Programmable Voice', 'voice', 'twilio_voice', 'draft', 'system_seed')
ON CONFLICT (code) DO NOTHING;

UPDATE public.omni_comms_provider
   SET status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
 WHERE code IN ('firebase_push','outbound_webhook','twilio_voice')
   AND status = 'draft';

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_push_devices(uuid,uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_push_device_feedback(text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_push_devices(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_push_device_feedback(text,text,text) TO service_role;
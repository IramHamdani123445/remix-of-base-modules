-- WhatsApp: provider-neutral content contract (ContentSid removed, structured buttons added)
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
    WHEN 'push'     THEN v_allowed := ARRAY['title','body'];        v_required := ARRAY['title','body'];
    -- Provider registration metadata (e.g. Twilio ContentSid) is NOT business
    -- content and is refused here; it lives on omni_comms_template_provider_registration.
    WHEN 'whatsapp' THEN v_allowed := ARRAY['header','body','footer','media_url','buttons','button_label','button_url'];
                         v_required := ARRAY['body'];
    WHEN 'print'    THEN v_allowed := ARRAY['subject','html','text'];v_required := ARRAY['subject'];
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
    IF NOT (p_channel = 'whatsapp' AND v_key = 'buttons') THEN
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

  IF p_channel = 'whatsapp' THEN
    IF length(btrim(p_content ->> 'body')) > 1024 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_body_too_long';
    END IF;
    IF (p_content ? 'header') AND length(btrim(p_content ->> 'header')) > 60 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_header_too_long';
    END IF;
    IF (p_content ? 'footer') AND length(btrim(p_content ->> 'footer')) > 60 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_footer_too_long';
    END IF;
    IF (p_content ? 'media_url')
       AND btrim(p_content ->> 'media_url') !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-]+$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_media_url_invalid';
    END IF;
    IF (p_content ? 'button_url')
       AND btrim(p_content ->> 'button_url') !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-{}]+$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_button_url_invalid';
    END IF;
    IF (p_content ? 'button_label') AND NOT (p_content ? 'button_url') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_button_url_required';
    END IF;

    -- Structured buttons: compact JSON array of {label,url?} held as a string
    -- so the canonical content representation stays string-only.
    IF (p_content ? 'buttons') THEN
      BEGIN
        v_buttons := (p_content ->> 'buttons')::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_buttons_invalid';
      END;
      IF jsonb_typeof(v_buttons) <> 'array' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_buttons_invalid';
      END IF;
      IF jsonb_array_length(v_buttons) > 3 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_buttons_too_many';
      END IF;
      FOR v_btn IN SELECT b FROM jsonb_array_elements(v_buttons) b LOOP
        IF jsonb_typeof(v_btn) <> 'object' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_buttons_invalid';
        END IF;
        IF COALESCE(btrim(v_btn ->> 'label'), '') = '' OR length(btrim(v_btn ->> 'label')) > 25 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_button_label_invalid';
        END IF;
        IF (v_btn ? 'url')
           AND btrim(v_btn ->> 'url') !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-{}]+$' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_button_url_invalid';
        END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(v_btn) k WHERE k NOT IN ('label','url')) > 0 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_buttons_invalid';
        END IF;
      END LOOP;
    END IF;
  END IF;
END;
$function$;

-- Backward compatibility: ContentSid leaves canonical content.
UPDATE public.omni_comms_template_version
   SET content = content - 'content_sid'
 WHERE channel = 'whatsapp' AND content ? 'content_sid';

-- Provider-neutral WhatsApp business identity: display_number required,
-- Meta-specific phone_number_id no longer mandatory.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_identity_config(
  p_channel text, p_identity_type text, p_config jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ch text; v_type text; v_allowed text[]; v_required text[];
  v_key text; v_raw jsonb; v_val text; v_out jsonb := '{}'::jsonb; v_req text;
BEGIN
  v_ch   := btrim(coalesce(p_channel,''));
  v_type := btrim(coalesce(p_identity_type,''));

  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='identity_config_object_required'; END IF;
  IF char_length(p_config::text) > 4000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='identity_config_too_large'; END IF;

  IF v_ch='email' AND v_type='email_sender' THEN
    v_allowed := ARRAY['from_address','from_name','reply_to_address'];
    v_required := ARRAY['from_address'];
  ELSIF v_ch='sms' AND v_type IN ('sender_id','originating_number') THEN
    v_allowed := ARRAY['sender_value','default_country_code','message_class'];
    v_required := ARRAY['sender_value'];
  ELSIF v_ch='whatsapp' AND v_type='business_number' THEN
    v_allowed := ARRAY['display_number','display_name','phone_number_id','business_account_id','business_number'];
    v_required := ARRAY['display_number'];
  ELSIF v_ch='push' AND v_type='application' THEN
    v_allowed := ARRAY['application_code','platform','package_or_bundle_id','display_name'];
    v_required := ARRAY['application_code','platform'];
  ELSIF v_ch='in_app' AND v_type='application' THEN
    v_allowed := ARRAY['application_code','display_name','icon_key','default_category'];
    v_required := ARRAY['application_code','display_name'];
  ELSIF v_ch='print' AND v_type='issuing_authority' THEN
    v_allowed := ARRAY['issuing_authority','letterhead_code','document_profile','return_address'];
    v_required := ARRAY['issuing_authority'];
  ELSE
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_identity_type';
  END IF;

  FOR v_key, v_raw IN SELECT key, value FROM jsonb_each(p_config) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_config_key:'||v_key; END IF;
    IF jsonb_typeof(v_raw) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_must_be_string:'||v_key; END IF;
    v_val := NULLIF(btrim(coalesce(v_raw #>> '{}','')),'');
    IF v_val IS NULL THEN CONTINUE; END IF;
    IF char_length(v_val) > 254 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_too_long:'||v_key; END IF;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  END LOOP;

  -- Legacy rows carrying only business_number are promoted, not refused.
  IF v_ch='whatsapp' AND (v_out ->> 'display_number') IS NULL
     AND (v_out ->> 'business_number') IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('display_number', v_out ->> 'business_number');
  END IF;

  FOREACH v_req IN ARRAY v_required LOOP
    IF (v_out ->> v_req) IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='missing_required_field:'||v_req; END IF;
  END LOOP;

  IF (v_out ? 'from_address') AND (v_out->>'from_address') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_email:from_address'; END IF;
  IF (v_out ? 'reply_to_address') AND (v_out->>'reply_to_address') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_email:reply_to_address'; END IF;
  IF (v_out ? 'from_name') AND char_length(v_out->>'from_name') > 120 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_too_long:from_name'; END IF;

  IF v_type='sender_id' AND (v_out->>'sender_value') !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{2,10}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_sender_id'; END IF;
  IF v_type='originating_number' AND (v_out->>'sender_value') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_e164:sender_value'; END IF;
  IF (v_out ? 'default_country_code') AND (v_out->>'default_country_code') !~ '^\+?[0-9]{1,4}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_country_code'; END IF;
  IF (v_out ? 'message_class') AND (v_out->>'message_class') NOT IN ('transactional','promotional','mixed') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_message_class'; END IF;

  IF (v_out ? 'display_number') AND (v_out->>'display_number') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_e164:display_number'; END IF;
  IF (v_out ? 'business_number') AND (v_out->>'business_number') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_e164:business_number'; END IF;
  IF (v_out ? 'phone_number_id') AND (v_out->>'phone_number_id') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_phone_number_id'; END IF;
  IF (v_out ? 'business_account_id') AND (v_out->>'business_account_id') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_business_account_id'; END IF;

  IF (v_out ? 'application_code') AND (v_out->>'application_code') !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_application_code'; END IF;
  IF (v_out ? 'application_code') AND char_length(v_out->>'application_code') > 64 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_too_long:application_code'; END IF;
  IF v_ch='push' AND (v_out->>'platform') NOT IN ('android','ios','web','cross_platform') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_platform'; END IF;
  IF (v_out ? 'package_or_bundle_id') AND (v_out->>'package_or_bundle_id') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_package_or_bundle_id'; END IF;
  IF (v_out ? 'icon_key') AND (v_out->>'icon_key') !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_icon_key'; END IF;
  IF (v_out ? 'default_category') AND (v_out->>'default_category') !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_default_category'; END IF;

  IF (v_out ? 'issuing_authority') AND char_length(v_out->>'issuing_authority') NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_issuing_authority'; END IF;
  IF (v_out ? 'letterhead_code') AND (v_out->>'letterhead_code') !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_letterhead_code'; END IF;
  IF (v_out ? 'document_profile') AND (v_out->>'document_profile') !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_document_profile'; END IF;

  IF (v_out ? 'display_name') AND char_length(v_out->>'display_name') > 160 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_too_long:display_name'; END IF;

  RETURN v_out;
END; $function$;

UPDATE public.omni_comms_sender_identity
   SET identity_config = identity_config
     || jsonb_build_object('display_number', identity_config ->> 'business_number')
 WHERE channel = 'whatsapp'
   AND identity_config ? 'business_number'
   AND NOT (identity_config ? 'display_number');
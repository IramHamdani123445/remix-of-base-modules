CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_normalize_payload(p_channel text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v jsonb := coalesce(p_payload, '{}'::jsonb);
  v_allowed text[];
  v_key text;
  v_bytes integer;
  v_summary jsonb;
  v_s text; v_b text; v_t text; v_d text; v_lang text; v_vars jsonb;
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RETURN jsonb_build_object('valid', false, 'code', 'payload_not_object');
  END IF;

  v_bytes := octet_length(v::text);
  IF v_bytes > 20000 THEN
    RETURN jsonb_build_object('valid', false, 'code', 'payload_too_large');
  END IF;

  v_allowed := CASE p_channel
    WHEN 'email'    THEN ARRAY['subject','body']
    WHEN 'sms'      THEN ARRAY['text']
    WHEN 'whatsapp' THEN ARRAY['template_code','language_code','variables','text']
    WHEN 'push'     THEN ARRAY['title','body']
    WHEN 'in_app'   THEN ARRAY['title','body','deep_link']
    WHEN 'print'    THEN ARRAY['document_title','sample_text']
    ELSE ARRAY[]::text[] END;

  IF array_length(v_allowed, 1) IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'code', 'payload_channel_unsupported');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_unknown_key');
    END IF;
  END LOOP;

  IF p_channel = 'email' THEN
    v_s := btrim(coalesce(v->>'subject',''));
    v_b := coalesce(v->>'body','');
    IF v_s = '' OR length(v_s) > 200 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_subject'); END IF;
    IF btrim(v_b) = '' OR length(v_b) > 10000 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_body'); END IF;
    IF v_b ~ '<\s*[A-Za-z/!]' OR v_s ~ '<\s*[A-Za-z/!]' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_markup_not_allowed'); END IF;
    v_summary := jsonb_build_object(
      'subject', v_s,
      'body_character_count', length(v_b),
      'attachment_count', 0,
      'payload_byte_count', v_bytes);

  ELSIF p_channel = 'sms' THEN
    v_b := coalesce(v->>'text','');
    IF btrim(v_b) = '' OR length(v_b) > 1600 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_text'); END IF;
    v_summary := jsonb_build_object(
      'message_character_count', length(v_b),
      'payload_byte_count', v_bytes);

  ELSIF p_channel = 'whatsapp' AND (v ? 'text') THEN
    -- Session (free-form) message shape. Mutually exclusive with the template shape
    -- so the preflight payload and the real provider test message stay identical.
    IF (v ? 'template_code') OR (v ? 'language_code') OR (v ? 'variables') THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_unknown_key'); END IF;
    v_b := coalesce(v->>'text','');
    IF btrim(v_b) = '' OR length(v_b) > 4000 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_text'); END IF;
    v_summary := jsonb_build_object(
      'message_character_count', length(v_b),
      'payload_byte_count', v_bytes);

  ELSIF p_channel = 'whatsapp' THEN
    v_t := btrim(coalesce(v->>'template_code',''));
    v_lang := btrim(coalesce(v->>'language_code',''));
    v_vars := coalesce(v->'variables', '[]'::jsonb);
    IF v_t !~ '^[a-z][a-z0-9_]{2,63}$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_template_code'); END IF;
    IF v_lang !~ '^[a-z]{2}(_[A-Z]{2})?$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_language_code'); END IF;
    IF jsonb_typeof(v_vars) <> 'array' OR jsonb_array_length(v_vars) > 20 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_variables'); END IF;
    v_summary := jsonb_build_object(
      'template_code', v_t,
      'language_code', v_lang,
      'variable_count', jsonb_array_length(v_vars),
      'payload_byte_count', v_bytes);

  ELSIF p_channel = 'push' THEN
    v_t := btrim(coalesce(v->>'title',''));
    v_b := coalesce(v->>'body','');
    IF v_t = '' OR length(v_t) > 120 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_title'); END IF;
    IF btrim(v_b) = '' OR length(v_b) > 1000 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_body'); END IF;
    v_summary := jsonb_build_object(
      'title', v_t,
      'body_character_count', length(v_b),
      'payload_byte_count', v_bytes);

  ELSIF p_channel = 'in_app' THEN
    v_t := btrim(coalesce(v->>'title',''));
    v_b := coalesce(v->>'body','');
    v_d := btrim(coalesce(v->>'deep_link',''));
    IF v_t = '' OR length(v_t) > 160 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_title'); END IF;
    IF btrim(v_b) = '' OR length(v_b) > 4000 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_body'); END IF;
    IF length(v_d) > 500 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_deep_link'); END IF;
    v_summary := jsonb_build_object(
      'title', v_t,
      'body_character_count', length(v_b),
      'deep_link_present', (v_d <> ''),
      'payload_byte_count', v_bytes);

  ELSE
    v_t := btrim(coalesce(v->>'document_title',''));
    v_b := coalesce(v->>'sample_text','');
    IF v_t = '' OR length(v_t) > 200 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_document_title'); END IF;
    IF btrim(v_b) = '' OR length(v_b) > 10000 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_sample_text'); END IF;
    v_summary := jsonb_build_object(
      'document_title', v_t,
      'sample_character_count', length(v_b),
      'payload_byte_count', v_bytes);
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', 'payload_valid',
    'payload_summary', v_summary,
    'payload_hash', public.omni_comms_priv_channel_test_sha256(p_channel || '|' || v::text)
  );
END; $function$;
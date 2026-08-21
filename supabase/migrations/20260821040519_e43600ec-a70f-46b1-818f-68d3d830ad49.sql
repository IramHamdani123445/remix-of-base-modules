DO $mig$
DECLARE d text;
BEGIN
  -- 1. Payload validation for the Voice channel
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_channel_test_normalize_payload';
  IF d IS NULL THEN RAISE EXCEPTION 'normalize_payload missing'; END IF;
  IF position($x$WHEN 'voice'$x$ in d) = 0 THEN
    d := replace(d,
      $x$WHEN 'print'    THEN ARRAY['document_title','sample_text']$x$,
      $x$WHEN 'print'    THEN ARRAY['document_title','sample_text']
    WHEN 'voice'    THEN ARRAY['script','gather_prompt','gather_digits']$x$);
    d := replace(d,
      $x$  ELSIF p_channel = 'push' THEN$x$,
      $x$  ELSIF p_channel = 'voice' THEN
    v_b := coalesce(v->>'script','');
    IF btrim(v_b) = '' OR length(v_b) > 2000 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_script'); END IF;
    v_t := btrim(coalesce(v->>'gather_prompt',''));
    v_d := btrim(coalesce(v->>'gather_digits',''));
    IF length(v_t) > 500 THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_gather_prompt'); END IF;
    IF v_d <> '' AND v_d !~ '^[0-9*#]{1,12}$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_gather_digits'); END IF;
    IF (v_t <> '') <> (v_d <> '') THEN
      RETURN jsonb_build_object('valid', false, 'code', 'payload_invalid_gather_digits'); END IF;
    v_summary := jsonb_build_object(
      'script_character_count', length(v_b),
      'keypad_question', (v_d <> ''),
      'accepted_digits', nullif(v_d, ''),
      'payload_byte_count', v_bytes);

  ELSIF p_channel = 'push' THEN$x$);
    EXECUTE d;
  END IF;

  -- 2. Preflight accepts the Voice channel
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_channel_test_run_preflight';
  IF d IS NULL THEN RAISE EXCEPTION 'preflight missing'; END IF;
  IF position($x$'print','voice'$x$ in d) = 0 THEN
    d := replace(d,
      $x$IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN$x$,
      $x$IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print','voice') THEN$x$);
    EXECUTE d;
  END IF;

  -- 3. Controlled test delivery preparation supports Voice
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_channel_test_delivery_prepare';
  IF d IS NULL THEN RAISE EXCEPTION 'prepare missing'; END IF;
  IF position($x$twilio_voice$x$ in d) = 0 THEN
    d := replace(d,
      $x$IF v_channel NOT IN ('email','sms','whatsapp','print') THEN$x$,
      $x$IF v_channel NOT IN ('email','sms','whatsapp','print','voice') THEN$x$);
    d := replace(d,
      $x$  ELSIF v_channel IN ('sms','whatsapp') THEN
    v_target := regexp_replace$x$,
      $x$  ELSIF v_channel IN ('sms','whatsapp','voice') THEN
    v_target := regexp_replace$x$);
    d := replace(d,
      $x$  ELSE
    v_pnorm := public.omni_comms_priv_channel_test_normalize_payload(v_channel, jsonb_build_object('text', coalesce(p_body_text,'')));
  END IF;$x$,
      $x$  ELSIF v_channel = 'voice' THEN
    v_pnorm := public.omni_comms_priv_channel_test_normalize_payload('voice',
      CASE WHEN btrim(coalesce(p_subject,'')) = ''
           THEN jsonb_build_object('script', coalesce(p_body_text,''))
           ELSE jsonb_build_object('script', coalesce(p_body_text,''),
                                   'gather_prompt', btrim(coalesce(p_subject,'')),
                                   'gather_digits', '1234567890') END);
  ELSE
    v_pnorm := public.omni_comms_priv_channel_test_normalize_payload(v_channel, jsonb_build_object('text', coalesce(p_body_text,'')));
  END IF;$x$);
    d := replace(d,
      $x$  ELSE
    v_prov_subject := NULL;
    v_prov_body := '[TEST] ' || coalesce(p_body_text,'');$x$,
      $x$  ELSIF v_channel = 'voice' THEN
    v_prov_subject := nullif(btrim(coalesce(p_subject,'')), '');
    v_prov_body := 'Test call from Omni Comms. ' || coalesce(p_body_text,'');
    v_prov_hash := public.omni_comms_priv_channel_test_sha256('voice|' || jsonb_build_object('script', v_prov_body, 'gather_prompt', coalesce(v_prov_subject,''))::text);
  ELSE
    v_prov_subject := NULL;
    v_prov_body := '[TEST] ' || coalesce(p_body_text,'');$x$);
    d := replace(d,
      $x$IF v_channel = 'print' AND coalesce(v_provider_code,'') <> 'print_spool' THEN$x$,
      $x$IF v_channel = 'voice' AND coalesce(v_provider_code,'') <> 'twilio_voice' THEN RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_not_supported'; END IF;
  IF v_channel = 'print' AND coalesce(v_provider_code,'') <> 'print_spool' THEN$x$);
    d := replace(d,
      $x$  ELSIF v_channel IN ('sms','whatsapp') THEN
    SELECT s.secret_ref, s.storage_mode INTO v_secret$x$,
      $x$  ELSIF v_channel IN ('sms','whatsapp','voice') THEN
    SELECT s.secret_ref, s.storage_mode INTO v_secret$x$);
    d := replace(d,
      $x$  ELSIF v_channel = 'print' THEN
    v_sender := coalesce(nullif(btrim(coalesce(v_identity.identity_config->>'return_address','')),'')$x$,
      $x$  ELSIF v_channel = 'voice' THEN
    v_sender := coalesce(nullif(btrim(coalesce(v_identity.identity_config->>'caller_number','')),''), nullif(btrim(coalesce(v_identity.identity_config->>'sender_number','')),''), nullif(btrim(coalesce(v_binding.external_sender_ref,'')),''));
    IF v_sender IS NULL THEN RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='voice_caller_number_not_configured'; END IF;
  ELSIF v_channel = 'print' THEN
    v_sender := coalesce(nullif(btrim(coalesce(v_identity.identity_config->>'return_address','')),'')$x$);
    EXECUTE d;
  END IF;
END $mig$;
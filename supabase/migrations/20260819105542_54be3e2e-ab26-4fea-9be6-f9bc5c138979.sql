
ALTER TABLE public.omni_comms_channel_endpoint
  DROP CONSTRAINT omni_comms_channel_endpoint_type_chk;
ALTER TABLE public.omni_comms_channel_endpoint
  ADD CONSTRAINT omni_comms_channel_endpoint_type_chk CHECK (endpoint_type = ANY (ARRAY[
    'sending_domain','event_callback','delivery_callback','inbound_callback',
    'business_webhook','realtime_endpoint','render_service',
    'subscriber_endpoint','status_callback','ivr_action_callback']));

CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_channel_endpoint(
  p_channel text, p_endpoint_type text, p_endpoint_config jsonb, p_secret_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ch text; v_type text;
  v_allowed text[]; v_required text[]; v_arrays text[];
  v_secret_allowed text[]; v_secret_required text[];
  v_key text; v_raw jsonb; v_val text; v_req text;
  v_out jsonb := '{}'::jsonb; v_secrets jsonb := '{}'::jsonb;
  v_elem text; v_arr jsonb; v_norm jsonb;
  v_allowed_events text[] := ARRAY['delivered','delayed','bounced','complained','failed'];
  v_allowed_fields text[] := ARRAY['messages','message_template_status_update','account_update'];
BEGIN
  v_ch   := btrim(coalesce(p_channel,''));
  v_type := btrim(coalesce(p_endpoint_type,''));

  IF v_ch NOT IN ('email','sms','whatsapp','in_app','print','webhook','voice') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_channel'; END IF;
  IF p_endpoint_config IS NULL OR jsonb_typeof(p_endpoint_config) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_config_object_required'; END IF;
  IF char_length(p_endpoint_config::text) > 4000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_config_too_large'; END IF;
  IF p_secret_refs IS NOT NULL AND jsonb_typeof(p_secret_refs) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_refs_object_required'; END IF;
  IF p_secret_refs IS NOT NULL AND char_length(p_secret_refs::text) > 2000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_refs_too_large'; END IF;

  IF v_ch='email' AND v_type='sending_domain' THEN
    v_allowed := ARRAY['domain_name','return_path_domain'];
    v_required := ARRAY['domain_name'];
    v_secret_allowed := ARRAY[]::text[]; v_secret_required := ARRAY[]::text[];
  ELSIF v_ch='email' AND v_type='event_callback' THEN
    v_allowed := ARRAY['callback_url','event_types']; v_arrays := ARRAY['event_types'];
    v_required := ARRAY['callback_url','event_types'];
    v_secret_allowed := ARRAY['signing_secret']; v_secret_required := ARRAY['signing_secret'];
  ELSIF v_ch='sms' AND v_type IN ('delivery_callback','inbound_callback') THEN
    v_allowed := ARRAY['callback_url']; v_required := ARRAY['callback_url'];
    v_secret_allowed := ARRAY['signature_secret']; v_secret_required := ARRAY[]::text[];
  ELSIF v_ch='whatsapp' AND v_type='business_webhook' THEN
    v_allowed := ARRAY['callback_url','subscribed_fields']; v_arrays := ARRAY['subscribed_fields'];
    v_required := ARRAY['callback_url','subscribed_fields'];
    v_secret_allowed := ARRAY['verify_token']; v_secret_required := ARRAY['verify_token'];
  ELSIF v_ch='in_app' AND v_type='realtime_endpoint' THEN
    v_allowed := ARRAY['transport','topic_prefix']; v_required := ARRAY['transport','topic_prefix'];
    v_secret_allowed := ARRAY[]::text[]; v_secret_required := ARRAY[]::text[];
  ELSIF v_ch='print' AND v_type='render_service' THEN
    v_allowed := ARRAY['service_mode','service_reference','health_path'];
    v_required := ARRAY['service_mode','service_reference'];
    v_secret_allowed := ARRAY['auth_token']; v_secret_required := ARRAY[]::text[];
  ELSIF v_ch='webhook' AND v_type='subscriber_endpoint' THEN
    v_allowed := ARRAY['callback_url']; v_required := ARRAY['callback_url'];
    v_secret_allowed := ARRAY['signing_secret']; v_secret_required := ARRAY['signing_secret'];
  ELSIF v_ch='voice' AND v_type IN ('status_callback','ivr_action_callback') THEN
    v_allowed := ARRAY['callback_url']; v_required := ARRAY['callback_url'];
    v_secret_allowed := ARRAY['signature_secret']; v_secret_required := ARRAY[]::text[];
  ELSE
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_endpoint_type';
  END IF;

  v_arrays := coalesce(v_arrays, ARRAY[]::text[]);

  FOR v_key, v_raw IN SELECT key, value FROM jsonb_each(p_endpoint_config) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_config_key:'||v_key; END IF;
    IF v_key = ANY(v_arrays) THEN
      IF jsonb_typeof(v_raw) <> 'array' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_must_be_array:'||v_key; END IF;
      IF jsonb_array_length(v_raw) = 0 OR jsonb_array_length(v_raw) > 10 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_array_out_of_bounds:'||v_key; END IF;
      v_arr := '[]'::jsonb;
      FOR v_elem IN SELECT jsonb_array_elements_text(v_raw) LOOP
        IF char_length(coalesce(v_elem,'')) > 64 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_too_long:'||v_key; END IF;
        v_elem := lower(btrim(v_elem));
        IF v_key='event_types' AND NOT (v_elem = ANY(v_allowed_events)) THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_event_type:'||v_elem; END IF;
        IF v_key='subscribed_fields' AND NOT (v_elem = ANY(v_allowed_fields)) THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_subscribed_field:'||v_elem; END IF;
        IF NOT (v_arr @> to_jsonb(ARRAY[v_elem])) THEN
          v_arr := v_arr || to_jsonb(ARRAY[v_elem]); END IF;
      END LOOP;
      v_out := v_out || jsonb_build_object(v_key, v_arr);
    ELSE
      IF jsonb_typeof(v_raw) NOT IN ('string','null') THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_must_be_string:'||v_key; END IF;
      v_val := NULLIF(btrim(coalesce(v_raw #>> '{}','')),'');
      IF v_val IS NULL THEN CONTINUE; END IF;
      IF char_length(v_val) > 512 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='config_value_too_long:'||v_key; END IF;
      v_out := v_out || jsonb_build_object(v_key, v_val);
    END IF;
  END LOOP;

  FOREACH v_req IN ARRAY v_required LOOP
    IF (v_out ? v_req) IS NOT TRUE THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='missing_required_field:'||v_req; END IF;
  END LOOP;

  IF v_out ? 'domain_name' THEN
    v_out := jsonb_set(v_out,'{domain_name}',
      to_jsonb(public.omni_comms_priv_normalize_endpoint_domain(v_out->>'domain_name','domain_name'))); END IF;
  IF v_out ? 'return_path_domain' THEN
    v_out := jsonb_set(v_out,'{return_path_domain}',
      to_jsonb(public.omni_comms_priv_normalize_endpoint_domain(v_out->>'return_path_domain','return_path_domain'))); END IF;
  IF v_out ? 'callback_url' THEN
    v_out := jsonb_set(v_out,'{callback_url}',
      to_jsonb(public.omni_comms_priv_normalize_endpoint_url(v_out->>'callback_url','callback_url'))); END IF;

  IF v_type='realtime_endpoint' THEN
    IF (v_out->>'transport') NOT IN ('database','realtime') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_transport'; END IF;
    IF (v_out->>'topic_prefix') !~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
       OR char_length(v_out->>'topic_prefix') > 64 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_topic_prefix'; END IF;
  END IF;

  IF v_type='render_service' THEN
    IF (v_out->>'service_mode') NOT IN ('internal','https') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_service_mode'; END IF;
    IF (v_out->>'service_mode')='internal' THEN
      IF (v_out->>'service_reference') !~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
         OR char_length(v_out->>'service_reference') > 64 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_internal_service_reference'; END IF;
    ELSE
      v_out := jsonb_set(v_out,'{service_reference}',
        to_jsonb(public.omni_comms_priv_normalize_endpoint_url(v_out->>'service_reference','service_reference')));
    END IF;
    IF v_out ? 'health_path' THEN
      IF (v_out->>'health_path') !~ '^/[A-Za-z0-9._~/-]{0,128}$' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_health_path'; END IF;
    END IF;
  END IF;

  IF p_secret_refs IS NOT NULL THEN
    FOR v_key, v_raw IN SELECT key, value FROM jsonb_each(p_secret_refs) LOOP
      IF NOT (v_key = ANY(v_secret_allowed)) THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_secret_purpose:'||v_key; END IF;
      IF v_secrets ? v_key THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='duplicate_secret_purpose:'||v_key; END IF;
      IF jsonb_typeof(v_raw) NOT IN ('string','null') THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_ref_must_be_string:'||v_key; END IF;
      v_val := NULLIF(btrim(coalesce(v_raw #>> '{}','')),'');
      IF v_val IS NULL THEN CONTINUE; END IF;
      IF char_length(v_val) > 128 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_ref_too_long:'||v_key; END IF;
      IF v_val !~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='raw_secret_value_rejected:'||v_key; END IF;
      v_secrets := v_secrets || jsonb_build_object(v_key, v_val);
    END LOOP;
  END IF;

  FOREACH v_req IN ARRAY v_secret_required LOOP
    IF (v_secrets ->> v_req) IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='missing_required_secret_ref:'||v_req; END IF;
  END LOOP;

  v_norm := jsonb_build_object('endpoint_config', v_out, 'secret_refs', v_secrets);
  RETURN v_norm;
END; $fn$;

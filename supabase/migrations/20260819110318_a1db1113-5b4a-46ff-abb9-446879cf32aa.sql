
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_identity_config(
  p_channel text, p_identity_type text, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $fn$
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
  ELSIF v_ch='voice' AND v_type='originating_number' THEN
    v_allowed := ARRAY['sender_value','default_country_code'];
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

  IF v_ch='push' AND (v_out->>'platform') NOT IN ('android','ios','web') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_platform'; END IF;
  IF (v_out ? 'application_code') AND (v_out->>'application_code') !~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_application_code'; END IF;

  RETURN v_out;
END; $fn$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_identity_upsert(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_organization_id uuid, p_department_id uuid, p_channel text,
  p_code text, p_display_name text, p_identity_type text,
  p_identity_config jsonb, p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_ch text; v_cfg jsonb;
        v_before public.omni_comms_sender_identity%ROWTYPE;
        v_after  public.omni_comms_sender_identity%ROWTYPE;
        v_from text; v_fname text; v_reply text; v_print jsonb; v_org uuid; v_dept uuid;
BEGIN
  v_ch := btrim(coalesce(p_channel,''));
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print','voice') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;

  v_cfg := public.omni_comms_priv_normalize_identity_config(v_ch, p_identity_type, p_identity_config);

  v_from  := CASE WHEN v_ch='email' THEN v_cfg->>'from_address' END;
  v_fname := CASE WHEN v_ch='email' THEN v_cfg->>'from_name' END;
  v_reply := CASE WHEN v_ch='email' THEN v_cfg->>'reply_to_address' END;
  v_print := CASE WHEN v_ch='print' THEN v_cfg END;

  IF p_id IS NULL THEN
    v_org := p_organization_id; v_dept := p_department_id;
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, v_org, v_dept);
    BEGIN
      INSERT INTO public.omni_comms_sender_identity(
        organization_id, department_id, event_definition_id, code, display_name,
        channel, identity_type, identity_config,
        from_address, from_name, reply_to_address, print_config,
        data_origin, status, created_by, updated_by)
      VALUES(v_org, v_dept, NULL, btrim(coalesce(p_code,'')), btrim(coalesce(p_display_name,'')),
        v_ch, btrim(coalesce(p_identity_type,'')), v_cfg,
        v_from, v_fname, v_reply, v_print,
        'user','draft', p_actor_id, p_actor_id)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='identity_code_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
      WHEN foreign_key_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_or_department';
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      p_actor_id,'create','sender_identity',v_after.id,v_after.code,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_sender_identity WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, v_before.organization_id, p_department_id);
  IF p_organization_id IS NOT NULL AND v_before.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='organization_mismatch'; END IF;
  IF v_before.data_origin='reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_identity_read_only'; END IF;
  IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft'; END IF;
  IF v_before.channel IS DISTINCT FROM v_ch THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_immutable'; END IF;

  BEGIN
    UPDATE public.omni_comms_sender_identity
       SET department_id=p_department_id,
           code=btrim(coalesce(p_code,'')), display_name=btrim(coalesce(p_display_name,'')),
           identity_type=btrim(coalesce(p_identity_type,'')), identity_config=v_cfg,
           from_address=v_from, from_name=v_fname, reply_to_address=v_reply,
           print_config=v_print,
           updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='identity_code_exists';
    WHEN check_violation THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_or_department';
  END;
  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,'update_draft','sender_identity',p_id,v_after.code,
    to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $fn$;

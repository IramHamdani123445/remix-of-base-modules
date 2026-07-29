-- Omni-Comms Accelerated Build 2 — Email configuration RPCs (Resend)

-- Private: channel-domain audit writer
CREATE OR REPLACE FUNCTION public.omni_comms_priv_write_channel_audit(
  p_actor_id uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_entity_display text, p_before jsonb, p_after jsonb, p_correlation_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions AS $$
DECLARE v_actor_name text; v_actor_email text; v_changed text[];
BEGIN
  BEGIN
    SELECT p.full_name, u.email INTO v_actor_name, v_actor_email
      FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.user_id
      WHERE p.user_id=p_actor_id LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_actor_name:=NULL; v_actor_email:=NULL; END;
  IF p_before IS NOT NULL AND p_after IS NOT NULL THEN
    SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_changed
      FROM (SELECT key AS k FROM jsonb_each(p_after)
             WHERE p_before -> key IS DISTINCT FROM p_after -> key) diff;
  END IF;
  BEGIN
    INSERT INTO public.core_audit_log(
      event_code,event_name,event_category,severity,risk_level,
      actor_user_id,actor_name,actor_email,
      module_code,domain_code,entity_type,entity_id,entity_display_name,
      action,outcome,before_value,after_value,changed_fields,
      correlation_id,source,source_component)
    VALUES(
      'OMNI_COMMS.CHANNELS.'||upper(p_entity_type)||'.'||upper(p_action),
      p_action,'configuration','info','low',
      p_actor_id,v_actor_name,v_actor_email,
      'OMNI_COMMS','channels',p_entity_type,p_entity_id::text,p_entity_display,
      p_action,'success',p_before,p_after,v_changed,
      p_correlation_id,'rpc','omni_comms_channel_management');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'OC450 audit_write_failed' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_write_channel_audit(uuid,text,text,uuid,text,jsonb,jsonb,text) FROM PUBLIC;
ALTER FUNCTION public.omni_comms_priv_write_channel_audit(uuid,text,text,uuid,text,jsonb,jsonb,text) OWNER TO postgres;

-- Private: resolve canonical resend email provider id
CREATE OR REPLACE FUNCTION public.omni_comms_priv_email_provider_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
  SELECT id FROM public.omni_comms_provider
   WHERE adapter_key='resend' AND channel='email' ORDER BY created_at ASC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_email_provider_id() FROM PUBLIC;
ALTER FUNCTION public.omni_comms_priv_email_provider_id() OWNER TO postgres;

-- 1. provider ensure
CREATE OR REPLACE FUNCTION public.omni_comms_email_provider_ensure(p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid; v_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_id := public.omni_comms_priv_email_provider_id();
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.omni_comms_provider(code,display_name,channel,adapter_key,status,created_by,updated_by)
  VALUES('resend_email','Resend (Email)','email','resend','draft',v_uid,v_uid)
  RETURNING id INTO v_id;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'ensure','provider',v_id,'resend_email',NULL,
    jsonb_build_object('code','resend_email','channel','email','adapter_key','resend','status','draft'),
    p_correlation_id);
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_email_provider_ensure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_email_provider_ensure(text) TO authenticated;

-- 2. provider activate
CREATE OR REPLACE FUNCTION public.omni_comms_email_provider_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid; v_before public.omni_comms_provider%ROWTYPE; v_after public.omni_comms_provider%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_provider WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='provider'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  UPDATE public.omni_comms_provider
     SET status='active',activated_at=now(),activated_by=v_uid,updated_by=v_uid,updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'activate','provider',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_email_provider_activate(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_email_provider_activate(uuid,timestamptz,text) TO authenticated;

-- 3. provider_account upsert draft
CREATE OR REPLACE FUNCTION public.omni_comms_provider_account_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_code text, p_display_name text, p_secret_ref text, p_region text,
  p_sandbox_mode boolean, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid; v_provider_id uuid;
  v_before public.omni_comms_provider_account%ROWTYPE;
  v_after  public.omni_comms_provider_account%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_provider_id := public.omni_comms_priv_email_provider_id();
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='email_provider_missing'; END IF;
  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public.omni_comms_provider_account(
        organization_id,provider_id,code,display_name,secret_ref,region,sandbox_mode,
        status,created_by,updated_by)
      VALUES(p_organization_id,v_provider_id,p_code,p_display_name,p_secret_ref,
        NULLIF(btrim(coalesce(p_region,'')),''),COALESCE(p_sandbox_mode,false),
        'draft',v_uid,v_uid) RETURNING * INTO v_after;
    EXCEPTION
      WHEN check_violation THEN RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
      WHEN foreign_key_violation THEN RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_id';
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','provider_account',v_after.id,v_after.code,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;
  SELECT * INTO v_before FROM public.omni_comms_provider_account WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='provider_account'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  BEGIN
    UPDATE public.omni_comms_provider_account
       SET code=p_code, display_name=p_display_name, secret_ref=p_secret_ref,
           region=NULLIF(btrim(coalesce(p_region,'')),''),
           sandbox_mode=COALESCE(p_sandbox_mode,false),
           updated_by=v_uid, updated_at=now(),
           health_state='unknown', health_checked_at=NULL
     WHERE id=p_id RETURNING * INTO v_after;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
  END;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update_draft','provider_account',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_provider_account_upsert_draft(uuid,timestamptz,uuid,text,text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_provider_account_upsert_draft(uuid,timestamptz,uuid,text,text,text,text,boolean,text) TO authenticated;

-- 4. provider_account activate
CREATE OR REPLACE FUNCTION public.omni_comms_provider_account_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_provider_account%ROWTYPE;
  v_after  public.omni_comms_provider_account%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_provider_account WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='provider_account'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  IF v_before.health_state='unknown' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='credential_check_required'; END IF;
  IF v_before.health_state='failed' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='credential_check_failed'; END IF;
  UPDATE public.omni_comms_provider_account
     SET status='active',activated_at=now(),activated_by=v_uid,updated_by=v_uid,updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'activate','provider_account',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_provider_account_activate(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_provider_account_activate(uuid,timestamptz,text) TO authenticated;

-- 5. record credential check result
CREATE OR REPLACE FUNCTION public.omni_comms_provider_account_record_credential_check(
  p_id uuid, p_expected_updated_at timestamptz, p_result text, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_provider_account%ROWTYPE;
  v_after  public.omni_comms_provider_account%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_result IS NULL OR p_result NOT IN ('healthy','degraded','failed') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='invalid_health_result'; END IF;
  SELECT * INTO v_before FROM public.omni_comms_provider_account WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='provider_account'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  UPDATE public.omni_comms_provider_account
     SET health_state=p_result, health_checked_at=now(), updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'credential_check','provider_account',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_provider_account_record_credential_check(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_provider_account_record_credential_check(uuid,timestamptz,text,text) TO authenticated;

-- 6. sender_identity upsert draft
CREATE OR REPLACE FUNCTION public.omni_comms_sender_identity_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_department_id uuid, p_event_definition_id uuid, p_code text, p_display_name text,
  p_from_address text, p_from_name text, p_reply_to_address text, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_sender_identity%ROWTYPE;
  v_after  public.omni_comms_sender_identity%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public.omni_comms_sender_identity(
        organization_id,department_id,event_definition_id,code,display_name,
        channel,from_address,from_name,reply_to_address,status,created_by,updated_by)
      VALUES(p_organization_id,p_department_id,p_event_definition_id,p_code,p_display_name,
        'email',p_from_address,p_from_name,p_reply_to_address,'draft',v_uid,v_uid)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN check_violation THEN RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
      WHEN foreign_key_violation THEN RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_or_department';
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','sender_identity',v_after.id,v_after.code,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;
  SELECT * INTO v_before FROM public.omni_comms_sender_identity WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='sender_identity'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  BEGIN
    UPDATE public.omni_comms_sender_identity
       SET department_id=p_department_id, event_definition_id=p_event_definition_id,
           code=p_code, display_name=p_display_name,
           from_address=p_from_address, from_name=p_from_name, reply_to_address=p_reply_to_address,
           updated_by=v_uid, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
  END;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update_draft','sender_identity',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_sender_identity_upsert_draft(uuid,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_sender_identity_upsert_draft(uuid,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text) TO authenticated;

-- 7. sender_identity activate
CREATE OR REPLACE FUNCTION public.omni_comms_sender_identity_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_sender_identity%ROWTYPE;
  v_after  public.omni_comms_sender_identity%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_sender_identity WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='sender_identity'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  UPDATE public.omni_comms_sender_identity
     SET status='active',activated_at=now(),activated_by=v_uid,updated_by=v_uid,updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'activate','sender_identity',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_sender_identity_activate(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_sender_identity_activate(uuid,timestamptz,text) TO authenticated;

-- 8. binding upsert draft
CREATE OR REPLACE FUNCTION public.omni_comms_binding_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_sender_identity_id uuid,
  p_provider_account_id uuid, p_priority integer, p_external_sender_ref text,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_sender_provider_binding%ROWTYPE;
  v_after  public.omni_comms_sender_provider_binding%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public.omni_comms_sender_provider_binding(
        sender_identity_id,provider_account_id,priority,external_sender_ref,status,created_by,updated_by)
      VALUES(p_sender_identity_id,p_provider_account_id,COALESCE(p_priority,100),
        NULLIF(btrim(coalesce(p_external_sender_ref,'')),''),'draft',v_uid,v_uid)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN RAISE EXCEPTION 'OC409 duplicate_binding' USING ERRCODE='P0001',DETAIL='sender_provider_pair';
      WHEN check_violation THEN RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
      WHEN foreign_key_violation THEN RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='sender_or_account_missing';
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','binding',v_after.id,v_after.id::text,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;
  SELECT * INTO v_before FROM public.omni_comms_sender_provider_binding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='binding'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  UPDATE public.omni_comms_sender_provider_binding
     SET priority=COALESCE(p_priority,priority),
         external_sender_ref=NULLIF(btrim(coalesce(p_external_sender_ref,'')),''),
         updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update_draft','binding',p_id,p_id::text,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_binding_upsert_draft(uuid,timestamptz,uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_binding_upsert_draft(uuid,timestamptz,uuid,uuid,integer,text,text) TO authenticated;

-- 9. binding verification record
CREATE OR REPLACE FUNCTION public.omni_comms_binding_record_verification(
  p_id uuid, p_expected_updated_at timestamptz, p_status text, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_sender_provider_binding%ROWTYPE;
  v_after  public.omni_comms_sender_provider_binding%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_status IS NULL OR p_status NOT IN ('pending','verified','failed') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='invalid_verification_status'; END IF;
  SELECT * INTO v_before FROM public.omni_comms_sender_provider_binding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='binding'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  UPDATE public.omni_comms_sender_provider_binding
     SET verification_status=p_status,
         verified_at=CASE WHEN p_status='verified' THEN now() ELSE NULL END,
         updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'verification_'||p_status,'binding',p_id,p_id::text,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_binding_record_verification(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_binding_record_verification(uuid,timestamptz,text,text) TO authenticated;

-- 10. binding activate
CREATE OR REPLACE FUNCTION public.omni_comms_binding_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_sender_provider_binding%ROWTYPE;
  v_after  public.omni_comms_sender_provider_binding%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_sender_provider_binding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='binding'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  IF v_before.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='verification_required'; END IF;
  BEGIN
    UPDATE public.omni_comms_sender_provider_binding
       SET status='active',activated_at=now(),activated_by=v_uid,updated_by=v_uid,updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 duplicate_priority' USING ERRCODE='P0001',DETAIL='active_priority_taken';
  END;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'activate','binding',p_id,p_id::text,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_binding_activate(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_binding_activate(uuid,timestamptz,text) TO authenticated;

-- 11. channel_setting upsert (email only)
CREATE OR REPLACE FUNCTION public.omni_comms_channel_setting_upsert(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_department_id uuid, p_channel text, p_enabled boolean, p_live_delivery_enabled boolean,
  p_quiet_hours_start time, p_quiet_hours_end time, p_quiet_hours_timezone text,
  p_per_minute_limit integer, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid;
  v_before public.omni_comms_channel_setting%ROWTYPE;
  v_after  public.omni_comms_channel_setting%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_channel IS NULL OR p_channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='email_channel_only_in_build2'; END IF;
  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public.omni_comms_channel_setting(
        organization_id,department_id,channel,enabled,live_delivery_enabled,
        quiet_hours_start,quiet_hours_end,quiet_hours_timezone,per_minute_limit,
        created_by,updated_by)
      VALUES(p_organization_id,p_department_id,p_channel,
        COALESCE(p_enabled,false),COALESCE(p_live_delivery_enabled,false),
        p_quiet_hours_start,p_quiet_hours_end,p_quiet_hours_timezone,
        p_per_minute_limit,v_uid,v_uid)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN RAISE EXCEPTION 'OC409 duplicate_channel_setting' USING ERRCODE='P0001',DETAIL='org_dept_channel_exists';
      WHEN check_violation THEN RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','channel_setting',v_after.id,p_channel,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;
  SELECT * INTO v_before FROM public.omni_comms_channel_setting WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='channel_setting'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  BEGIN
    UPDATE public.omni_comms_channel_setting
       SET enabled=COALESCE(p_enabled,enabled),
           live_delivery_enabled=COALESCE(p_live_delivery_enabled,live_delivery_enabled),
           quiet_hours_start=p_quiet_hours_start,
           quiet_hours_end=p_quiet_hours_end,
           quiet_hours_timezone=p_quiet_hours_timezone,
           per_minute_limit=p_per_minute_limit,
           updated_by=v_uid, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
  END;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update','channel_setting',p_id,v_after.channel,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_channel_setting_upsert(uuid,timestamptz,uuid,uuid,text,boolean,boolean,time,time,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_setting_upsert(uuid,timestamptz,uuid,uuid,text,boolean,boolean,time,time,text,integer,text) TO authenticated;

-- 12. email configuration summary
CREATE OR REPLACE FUNCTION public.omni_comms_email_config_summary(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid; v_pid uuid; v_provider jsonb; v_accounts jsonb; v_senders jsonb;
        v_bindings jsonb; v_setting jsonb; v_ready boolean;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_required'; END IF;
  v_pid := public.omni_comms_priv_email_provider_id();
  IF v_pid IS NULL THEN v_provider := NULL;
  ELSE
    SELECT jsonb_build_object('id',id,'code',code,'status',status,'updated_at',updated_at,'activated_at',activated_at)
      INTO v_provider FROM public.omni_comms_provider WHERE id=v_pid;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,'secret_ref',secret_ref,
      'region',region,'sandbox_mode',sandbox_mode,'status',status,
      'health_state',health_state,'health_checked_at',health_checked_at,'updated_at',updated_at
    ) ORDER BY created_at),'[]'::jsonb) INTO v_accounts
    FROM public.omni_comms_provider_account
   WHERE organization_id=p_organization_id AND provider_id=v_pid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,
      'from_address',from_address,'from_name',from_name,'reply_to_address',reply_to_address,
      'status',status,'department_id',department_id,'event_definition_id',event_definition_id,
      'updated_at',updated_at
    ) ORDER BY created_at),'[]'::jsonb) INTO v_senders
    FROM public.omni_comms_sender_identity
   WHERE organization_id=p_organization_id AND channel='email';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',b.id,'sender_identity_id',b.sender_identity_id,
      'provider_account_id',b.provider_account_id,'priority',b.priority,
      'external_sender_ref',b.external_sender_ref,
      'verification_status',b.verification_status,'verified_at',b.verified_at,
      'status',b.status,'updated_at',b.updated_at
    ) ORDER BY b.created_at),'[]'::jsonb) INTO v_bindings
    FROM public.omni_comms_sender_provider_binding b
    JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
   WHERE s.organization_id=p_organization_id AND s.channel='email';
  SELECT jsonb_build_object(
      'id',id,'department_id',department_id,'enabled',enabled,
      'live_delivery_enabled',live_delivery_enabled,
      'quiet_hours_start',quiet_hours_start,'quiet_hours_end',quiet_hours_end,
      'quiet_hours_timezone',quiet_hours_timezone,'per_minute_limit',per_minute_limit,
      'updated_at',updated_at) INTO v_setting
    FROM public.omni_comms_channel_setting
   WHERE organization_id=p_organization_id AND department_id IS NULL AND channel='email' LIMIT 1;
  v_ready :=
      v_provider IS NOT NULL AND (v_provider->>'status')='active'
      AND EXISTS(SELECT 1 FROM public.omni_comms_provider_account
                  WHERE organization_id=p_organization_id AND provider_id=v_pid
                    AND status='active' AND health_state IN ('healthy','degraded'))
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_identity
                  WHERE organization_id=p_organization_id AND channel='email' AND status='active')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_provider_binding b
                  JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
                 WHERE s.organization_id=p_organization_id AND s.channel='email'
                   AND b.status='active' AND b.verification_status='verified')
      AND v_setting IS NOT NULL AND (v_setting->>'enabled')::boolean=true;
  RETURN jsonb_build_object(
    'organization_id',p_organization_id,'provider',v_provider,
    'provider_accounts',v_accounts,'sender_identities',v_senders,
    'bindings',v_bindings,'channel_setting',v_setting,
    'email_send_ready',v_ready,'generated_at',now());
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_email_config_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_email_config_summary(uuid) TO authenticated;
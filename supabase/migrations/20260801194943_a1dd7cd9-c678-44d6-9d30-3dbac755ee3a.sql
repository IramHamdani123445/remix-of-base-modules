-- Step 1 Resend Account — narrow acceptance correction.

-- Bounded Resend secret-reference validator.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_is_resend_secret_ref(p_ref text)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_ref IS NOT NULL
     AND p_ref ~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$';
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_is_resend_secret_ref(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_is_resend_secret_ref(text) TO service_role;

-- 3. provider_account upsert draft — tenant access, secret-ref restriction,
--    verification invalidation on verification-relevant change only.
CREATE OR REPLACE FUNCTION public.omni_comms_provider_account_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_code text, p_display_name text, p_secret_ref text, p_region text,
  p_sandbox_mode boolean, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,extensions AS $$
DECLARE v_uid uuid; v_provider_id uuid; v_region text; v_sandbox boolean; v_reset boolean;
  v_before public.omni_comms_provider_account%ROWTYPE;
  v_after  public.omni_comms_provider_account%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_provider_id := public.omni_comms_priv_email_provider_id();
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='email_provider_missing'; END IF;
  IF NOT public.omni_comms_priv_is_resend_secret_ref(btrim(coalesce(p_secret_ref,''))) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='secret_ref_pattern'; END IF;
  v_region  := NULLIF(btrim(coalesce(p_region,'')),'');
  v_sandbox := COALESCE(p_sandbox_mode,false);

  IF p_id IS NULL THEN
    PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);
    BEGIN
      INSERT INTO public.omni_comms_provider_account(
        organization_id,provider_id,code,display_name,secret_ref,region,sandbox_mode,
        status,created_by,updated_by,
        verification_status,verification_result_code,verification_detail,verification_checked_at)
      VALUES(p_organization_id,v_provider_id,p_code,p_display_name,btrim(p_secret_ref),
        v_region,v_sandbox,'draft',v_uid,v_uid,'unverified',NULL,NULL,NULL)
      RETURNING * INTO v_after;
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
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_before.organization_id, NULL);
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;

  -- verification-relevant configuration change?
  v_reset := (v_before.secret_ref   IS DISTINCT FROM btrim(p_secret_ref))
          OR (v_before.provider_id  IS DISTINCT FROM v_provider_id)
          OR (v_before.sandbox_mode IS DISTINCT FROM v_sandbox)
          OR (v_before.region       IS DISTINCT FROM v_region);

  BEGIN
    UPDATE public.omni_comms_provider_account
       SET code=p_code, display_name=p_display_name, secret_ref=btrim(p_secret_ref),
           provider_id=v_provider_id,
           region=v_region,
           sandbox_mode=v_sandbox,
           updated_by=v_uid, updated_at=now(),
           health_state = CASE WHEN v_reset THEN 'unknown' ELSE health_state END,
           health_checked_at = CASE WHEN v_reset THEN NULL ELSE health_checked_at END,
           verification_status = CASE WHEN v_reset THEN 'unverified' ELSE verification_status END,
           verification_result_code = CASE WHEN v_reset THEN NULL ELSE verification_result_code END,
           verification_detail = CASE WHEN v_reset THEN NULL ELSE verification_detail END,
           verification_checked_at = CASE WHEN v_reset THEN NULL ELSE verification_checked_at END
     WHERE id=p_id RETURNING * INTO v_after;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL=SQLERRM;
  END;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update_draft','provider_account',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;

-- 4. provider_account activate — tenant access + real verification required.
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
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_before.organization_id, NULL);
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='must_be_draft'; END IF;
  IF v_before.verification_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001',DETAIL='provider_verification_required'; END IF;
  UPDATE public.omni_comms_provider_account
     SET status='active',activated_at=now(),activated_by=v_uid,updated_by=v_uid,updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'activate','provider_account',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;

-- 5. manual (non-authoritative) health evidence — tenant access enforced.
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
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_before.organization_id, NULL);
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  UPDATE public.omni_comms_provider_account
     SET health_state=p_result, health_checked_at=now(), updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'credential_check','provider_account',p_id,v_after.code,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;

-- Verification context — canonical Resend provider + restricted secret ref.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_provider_account_verification_context(
  p_actor_id uuid,
  p_organization_id uuid,
  p_provider_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_row public.omni_comms_provider_account%ROWTYPE;
        v_adapter text; v_channel text;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','authentication_required');
  END IF;
  IF NOT public.has_permission(p_actor_id,'omni_comms','configure') THEN
    RETURN jsonb_build_object('allowed',false,'code','permission_denied');
  END IF;
  BEGIN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('allowed',false,'code','organization_access_denied');
  END;
  SELECT * INTO v_row FROM public.omni_comms_provider_account
   WHERE id = p_provider_account_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found');
  END IF;
  SELECT adapter_key, channel INTO v_adapter, v_channel
    FROM public.omni_comms_provider WHERE id = v_row.provider_id;
  IF v_adapter IS DISTINCT FROM 'resend' OR v_channel IS DISTINCT FROM 'email' THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete');
  END IF;
  IF NOT public.omni_comms_priv_is_resend_secret_ref(v_row.secret_ref) THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete');
  END IF;
  RETURN jsonb_build_object(
    'allowed', true,
    'code','ok',
    'account_id', v_row.id,
    'account_code', v_row.code,
    'secret_ref', v_row.secret_ref,
    'status', v_row.status,
    'sandbox_mode', v_row.sandbox_mode,
    'updated_at', v_row.updated_at);
END; $function$;

-- Record verification — bound to the exact account version probed.
DROP FUNCTION IF EXISTS public.omni_comms_priv_record_provider_verification(uuid,uuid,uuid,text,text,text,text);
CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_provider_verification(
  p_actor_id uuid,
  p_organization_id uuid,
  p_provider_account_id uuid,
  p_expected_updated_at timestamptz,
  p_status text,
  p_result_code text,
  p_detail text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_before public.omni_comms_provider_account%ROWTYPE;
  v_after  public.omni_comms_provider_account%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','authentication_required');
  END IF;
  IF NOT public.has_permission(p_actor_id,'omni_comms','configure') THEN
    RETURN jsonb_build_object('allowed',false,'code','permission_denied');
  END IF;
  BEGIN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('allowed',false,'code','organization_access_denied');
  END;
  IF p_status IS NULL OR p_status NOT IN ('pending','verified','failed') THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;
  IF p_result_code IS NULL OR p_result_code NOT IN (
      'verified','invalid_credentials','secret_missing','provider_unavailable',
      'rate_limited','configuration_incomplete') THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','invalid_input');
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_provider_account
   WHERE id = p_provider_account_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found');
  END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('allowed',false,'code','concurrent_update');
  END IF;

  UPDATE public.omni_comms_provider_account
     SET verification_status      = p_status,
         verification_result_code = p_result_code,
         verification_detail      = left(coalesce(p_detail,''), 200),
         verification_checked_at  = now(),
         updated_by               = p_actor_id,
         updated_at               = now()
   WHERE id = p_provider_account_id
   RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,'provider_credential_verification','provider_account',
    v_after.id, v_after.code, to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);

  RETURN jsonb_build_object(
    'allowed', true,
    'code','ok',
    'verification_status', v_after.verification_status,
    'verification_result_code', v_after.verification_result_code,
    'verification_detail', v_after.verification_detail,
    'verification_checked_at', v_after.verification_checked_at,
    'updated_at', v_after.updated_at);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_record_provider_verification(uuid,uuid,uuid,timestamptz,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_record_provider_verification(uuid,uuid,uuid,timestamptz,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid) TO service_role;

-- Email config summary — tenant access + verification-backed readiness.
CREATE OR REPLACE FUNCTION public.omni_comms_email_config_summary(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid; v_pid uuid; v_provider jsonb; v_accounts jsonb; v_senders jsonb;
        v_bindings jsonb; v_setting jsonb; v_ready boolean;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_required'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);
  v_pid := public.omni_comms_priv_email_provider_id();
  IF v_pid IS NULL THEN v_provider := NULL;
  ELSE
    SELECT jsonb_build_object('id',id,'code',code,'status',status,'updated_at',updated_at,'activated_at',activated_at)
      INTO v_provider FROM public.omni_comms_provider WHERE id=v_pid;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,'secret_ref',secret_ref,
      'region',region,'sandbox_mode',sandbox_mode,'status',status,
      'health_state',health_state,'health_checked_at',health_checked_at,'updated_at',updated_at,
      'verification_status',verification_status,
      'verification_result_code',verification_result_code,
      'verification_detail',verification_detail,
      'verification_checked_at',verification_checked_at
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
                    AND status='active' AND verification_status='verified')
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
END; $function$;
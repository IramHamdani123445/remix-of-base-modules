-- ═══════════════════════════════════════════════════════════════════
-- Omni-Comms Channels C3A — generic channel identities
-- Additive only. No identity deleted/retired, no provider accounts touched,
-- no runtime request/message/job/attempt objects, no Legacy Hub objects.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. new identity columns ───────────────────────────────────────
ALTER TABLE public.omni_comms_sender_identity
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS identity_type text,
  ADD COLUMN IF NOT EXISTS identity_config jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_sender_identity_data_origin_chk') THEN
    ALTER TABLE public.omni_comms_sender_identity
      ADD CONSTRAINT omni_comms_sender_identity_data_origin_chk
      CHECK (data_origin IN ('system_seed','user','reference_seed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_sender_identity_identity_type_chk') THEN
    ALTER TABLE public.omni_comms_sender_identity
      ADD CONSTRAINT omni_comms_sender_identity_identity_type_chk
      CHECK (identity_type IS NULL OR identity_type IN
        ('email_sender','sender_id','originating_number','business_number',
         'application','issuing_authority'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_sender_identity_identity_config_chk') THEN
    ALTER TABLE public.omni_comms_sender_identity
      ADD CONSTRAINT omni_comms_sender_identity_identity_config_chk
      CHECK (jsonb_typeof(identity_config)='object' AND char_length(identity_config::text) <= 4000);
  END IF;
END $$;

-- ─── 2. reference classification (idempotent) ──────────────────────
UPDATE public.omni_comms_sender_identity
   SET data_origin='reference_seed'
 WHERE data_origin <> 'reference_seed'
   AND (code LIKE 'ref\_sender\_%'
        OR code LIKE 'ref\_sim\_%'
        OR code LIKE 'simulation\_%'
        OR code LIKE 'omni\_pilot\_%'
        OR lower(coalesce(from_address,'')) LIKE '%@example.com'
        OR lower(coalesce(from_address,'')) LIKE '%.example.com');

UPDATE public.omni_comms_sender_identity
   SET data_origin='user'
 WHERE data_origin NOT IN ('reference_seed','user');

-- ─── 3. canonical model backfill ───────────────────────────────────
UPDATE public.omni_comms_sender_identity
   SET identity_type='email_sender',
       identity_config = jsonb_strip_nulls(jsonb_build_object(
         'from_address', from_address,
         'from_name', from_name,
         'reply_to_address', reply_to_address))
 WHERE channel='email' AND identity_type IS NULL;

UPDATE public.omni_comms_sender_identity
   SET identity_type='issuing_authority',
       identity_config = COALESCE(print_config,'{}'::jsonb)
 WHERE channel='print' AND identity_type IS NULL
   AND (print_config IS NULL OR jsonb_typeof(print_config)='object');

-- ─── 4. relax Email-era constraints ────────────────────────────────
ALTER TABLE public.omni_comms_sender_identity
  DROP CONSTRAINT IF EXISTS omni_comms_sender_identity_from_required_chk;
ALTER TABLE public.omni_comms_sender_identity
  DROP CONSTRAINT IF EXISTS omni_comms_sender_identity_status_chk;
ALTER TABLE public.omni_comms_sender_identity
  DROP CONSTRAINT IF EXISTS omni_comms_sender_identity_activated_meta_chk;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_sender_identity_from_required_chk') THEN
    ALTER TABLE public.omni_comms_sender_identity
      ADD CONSTRAINT omni_comms_sender_identity_from_required_chk
      CHECK (channel <> 'email' OR from_address IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_sender_identity_status_chk') THEN
    ALTER TABLE public.omni_comms_sender_identity
      ADD CONSTRAINT omni_comms_sender_identity_status_chk
      CHECK (status IN ('draft','active','disabled','retired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_sender_identity_activated_meta_chk') THEN
    ALTER TABLE public.omni_comms_sender_identity
      ADD CONSTRAINT omni_comms_sender_identity_activated_meta_chk
      CHECK ((status='draft' AND activated_at IS NULL AND activated_by IS NULL)
             OR status IN ('active','disabled','retired'));
  END IF;
END $$;

-- ═══ 5. bounded identity validator / normaliser ════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_identity_config(
  p_channel text, p_identity_type text, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'pg_catalog','public' AS $$
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
    v_allowed := ARRAY['display_number','phone_number_id','business_account_id','display_name'];
    v_required := ARRAY['display_number','phone_number_id'];
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
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_identity_config(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_normalize_identity_config(text,text,jsonb) TO service_role;

-- ═══ 6. private generic upsert worker ══════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_identity_upsert(
  p_actor_id uuid,
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_code text,
  p_display_name text,
  p_identity_type text,
  p_identity_config jsonb,
  p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_ch text; v_cfg jsonb;
        v_before public.omni_comms_sender_identity%ROWTYPE;
        v_after  public.omni_comms_sender_identity%ROWTYPE;
        v_from text; v_fname text; v_reply text; v_print jsonb; v_org uuid; v_dept uuid;
BEGIN
  v_ch := btrim(coalesce(p_channel,''));
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
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
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_identity_upsert(uuid,uuid,timestamptz,uuid,uuid,text,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_identity_upsert(uuid,uuid,timestamptz,uuid,uuid,text,text,text,text,jsonb,text) TO service_role;

-- ═══ 7. private lifecycle worker ═══════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_identity_lifecycle(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_action text, p_reason text, p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_action text; v_reason text;
        v_before public.omni_comms_sender_identity%ROWTYPE;
        v_after  public.omni_comms_sender_identity%ROWTYPE;
BEGIN
  v_action := btrim(lower(coalesce(p_action,'')));
  IF v_action NOT IN ('activate','disable','retire') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_action'; END IF;

  SELECT * INTO v_before FROM public.omni_comms_sender_identity WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, v_before.organization_id, NULL);
  IF v_before.data_origin='reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_identity_non_operational'; END IF;
  IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;

  IF v_action='activate' THEN
    IF v_before.status NOT IN ('draft','disabled') THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft_or_disabled'; END IF;
    IF v_before.channel NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
    PERFORM public.omni_comms_priv_normalize_identity_config(
      v_before.channel, v_before.identity_type, v_before.identity_config);
    UPDATE public.omni_comms_sender_identity
       SET status='active',
           activated_at=COALESCE(activated_at, now()), activated_by=COALESCE(activated_by, p_actor_id),
           updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSIF v_action='disable' THEN
    IF v_before.status <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_active'; END IF;
    UPDATE public.omni_comms_sender_identity
       SET status='disabled', updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSE
    v_reason := NULLIF(btrim(coalesce(p_reason,'')),'');
    IF v_reason IS NULL OR char_length(v_reason) > 2000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='retirement_reason_required'; END IF;
    IF v_before.status='retired' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_retired'; END IF;
    UPDATE public.omni_comms_sender_identity
       SET status='retired', retired_at=now(), retired_by=p_actor_id,
           retirement_reason=v_reason, updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id, v_action, 'sender_identity', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_identity_lifecycle(uuid,uuid,timestamptz,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_identity_lifecycle(uuid,uuid,timestamptz,text,text,text) TO service_role;

-- ═══ 8. public generic RPCs ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_channel_identity_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_include_reference boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_ch text; v_allow_ref boolean;
        v_rows jsonb; v_ref_rows jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_ch := btrim(coalesce(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_allow_ref := COALESCE(p_include_reference,false)
                 AND public.has_permission(v_uid,'omni_comms','configure');

  WITH ident AS (
    SELECT s.* FROM public.omni_comms_sender_identity s
     WHERE s.organization_id = p_organization_id
       AND s.channel = v_ch
       AND (p_department_id IS NULL
            OR s.department_id IS NULL
            OR s.department_id = p_department_id)
  ), shaped AS (
    SELECT i.data_origin AS origin, i.created_at, jsonb_build_object(
      'id',i.id,'code',i.code,'display_name',i.display_name,'channel',i.channel,
      'identity_type',i.identity_type,'identity_config',i.identity_config,
      'department_id',i.department_id,'event_definition_id',i.event_definition_id,
      'status',i.status,'data_origin',i.data_origin,
      'from_address',i.from_address,'from_name',i.from_name,
      'reply_to_address',i.reply_to_address,
      'updated_at',i.updated_at,'activated_at',i.activated_at,
      'retired_at',i.retired_at,'retirement_reason',i.retirement_reason) AS row_json
      FROM ident i
  )
  SELECT
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin <> 'reference_seed'),'[]'::jsonb),
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin = 'reference_seed'),'[]'::jsonb)
    INTO v_rows, v_ref_rows
  FROM shaped;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', v_ch,
    'identities', v_rows,
    'reference_identities', CASE WHEN v_allow_ref THEN v_ref_rows ELSE '[]'::jsonb END,
    'reference_identity_count', CASE WHEN v_allow_ref THEN jsonb_array_length(v_ref_rows) ELSE 0 END,
    'generated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_identity_summary(uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_identity_summary(uuid,uuid,text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_identity_upsert_draft(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_code text,
  p_display_name text,
  p_identity_type text,
  p_identity_config jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_identity_upsert(
    v_uid, p_id, p_expected_updated_at, p_organization_id, p_department_id,
    p_channel, p_code, p_display_name, p_identity_type, p_identity_config, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_identity_upsert_draft(uuid,timestamptz,uuid,uuid,text,text,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_identity_upsert_draft(uuid,timestamptz,uuid,uuid,text,text,text,text,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_identity_set_lifecycle(
  p_id uuid, p_expected_updated_at timestamptz, p_action text,
  p_reason text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_identity_lifecycle(
    v_uid, p_id, p_expected_updated_at, p_action, p_reason, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_identity_set_lifecycle(uuid,timestamptz,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_identity_set_lifecycle(uuid,timestamptz,text,text,text) TO authenticated, service_role;

-- ═══ 9. legacy Email RPCs become thin compatibility wrappers ═══════
CREATE OR REPLACE FUNCTION public.omni_comms_sender_identity_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_department_id uuid, p_event_definition_id uuid, p_code text, p_display_name text,
  p_from_address text, p_from_name text, p_reply_to_address text,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_org uuid; v_dept uuid; v_res uuid; v_evt uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_org := p_organization_id; v_dept := p_department_id; v_evt := p_event_definition_id;
  IF p_id IS NOT NULL THEN
    SELECT organization_id, event_definition_id INTO v_org, v_evt
      FROM public.omni_comms_sender_identity WHERE id=p_id;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity'; END IF;
  END IF;

  v_res := public.omni_comms_priv_channel_identity_upsert(
    v_uid, p_id, p_expected_updated_at, v_org, v_dept, 'email',
    p_code, p_display_name, 'email_sender',
    jsonb_strip_nulls(jsonb_build_object(
      'from_address', NULLIF(btrim(coalesce(p_from_address,'')),''),
      'from_name', NULLIF(btrim(coalesce(p_from_name,'')),''),
      'reply_to_address', NULLIF(btrim(coalesce(p_reply_to_address,'')),''))),
    p_correlation_id);

  UPDATE public.omni_comms_sender_identity
     SET event_definition_id = v_evt
   WHERE id = v_res AND event_definition_id IS DISTINCT FROM v_evt;

  RETURN v_res;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_sender_identity_upsert_draft(uuid,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_sender_identity_upsert_draft(uuid,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_sender_identity_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_identity_lifecycle(
    v_uid, p_id, p_expected_updated_at, 'activate', NULL, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_sender_identity_activate(uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_sender_identity_activate(uuid,timestamptz,text) TO authenticated, service_role;
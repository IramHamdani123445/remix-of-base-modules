-- Omni-Comms C2.1 — generic provider administration RPCs
-- Reuses existing tables: omni_comms_provider, omni_comms_provider_credential_requirement

CREATE OR REPLACE FUNCTION public.omni_comms_channel_provider_admin_summary(
  p_channel text,
  p_include_reference boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE v_uid uuid; v_channel text; v_include boolean; v_providers jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_channel := btrim(COALESCE(p_channel,''));
  IF v_channel NOT IN ('email','sms','whatsapp','push','in_app','webhook','print','voice') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel';
  END IF;
  v_include := COALESCE(p_include_reference,false)
               AND public.has_permission(v_uid,'omni_comms','configure');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',p.id,'code',p.code,'display_name',p.display_name,'channel',p.channel,
      'adapter_key',p.adapter_key,'status',p.status,'data_origin',p.data_origin,
      'updated_at',p.updated_at,'activated_at',p.activated_at,
      'retired_at',p.retired_at,'retirement_reason',p.retirement_reason,
      'credential_requirements', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id',r.id,'provider_id',r.provider_id,'purpose',r.purpose,
                 'display_name',r.display_name,'description',r.description,
                 'required',r.required,'secret_ref_pattern',r.secret_ref_pattern,
                 'sort_order',r.sort_order) ORDER BY r.sort_order, r.purpose)
          FROM public.omni_comms_provider_credential_requirement r
         WHERE r.provider_id=p.id),'[]'::jsonb),
      'account_count', (SELECT count(*) FROM public.omni_comms_provider_account a
                         WHERE a.provider_id=p.id)
    ) ORDER BY p.code),'[]'::jsonb)
    INTO v_providers
    FROM public.omni_comms_provider p
   WHERE p.channel=v_channel
     AND (p.data_origin <> 'reference_seed' OR v_include);

  RETURN jsonb_build_object(
    'channel',v_channel,
    'providers',v_providers,
    'reference_included',v_include,
    'generated_at',now());
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_provider_upsert_draft(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_channel text,
  p_code text,
  p_display_name text,
  p_adapter_key text,
  p_credential_requirements jsonb DEFAULT '[]'::jsonb,
  p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE v_uid uuid; v_id uuid; v_channel text; v_code text; v_name text;
        v_adapter text; v_before jsonb; v_req jsonb; v_purposes text[] := '{}';
        v_row public.omni_comms_provider%ROWTYPE; v_i int := 0;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_channel := btrim(COALESCE(p_channel,''));
  v_code := lower(btrim(COALESCE(p_code,'')));
  v_name := btrim(COALESCE(p_display_name,''));
  v_adapter := lower(btrim(COALESCE(p_adapter_key,'')));

  IF v_channel NOT IN ('email','sms','in_app','push','whatsapp','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_not_supported_by_schema';
  END IF;
  IF v_code !~ '^[a-z0-9]+(_[a-z0-9]+)*$' OR char_length(v_code) < 3 OR char_length(v_code) > 64 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_code';
  END IF;
  IF v_adapter !~ '^[a-z0-9]+(_[a-z0-9]+)*$' OR char_length(v_adapter) < 3 OR char_length(v_adapter) > 64 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_adapter_key';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_display_name';
  END IF;
  IF p_credential_requirements IS NULL OR jsonb_typeof(p_credential_requirements) <> 'array' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_credential_requirements';
  END IF;
  IF jsonb_array_length(p_credential_requirements) > 10 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='too_many_credential_requirements';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_provider(
      code, display_name, channel, adapter_key, status, data_origin, created_by, updated_by)
    VALUES (v_code, v_name, v_channel, v_adapter, 'draft', 'user', v_uid, v_uid)
    RETURNING id INTO v_id;
    v_before := NULL;
  ELSE
    SELECT * INTO v_row FROM public.omni_comms_provider WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_not_found'; END IF;
    IF v_row.data_origin <> 'user' THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='seeded_provider_read_only'; END IF;
    IF v_row.status <> 'draft' THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='only_draft_provider_editable'; END IF;
    IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'OC409 stale_write' USING ERRCODE='P0001', DETAIL='concurrent_modification'; END IF;
    v_before := to_jsonb(v_row) - 'created_by' - 'updated_by';
    UPDATE public.omni_comms_provider
       SET code=v_code, display_name=v_name, channel=v_channel,
           adapter_key=v_adapter, updated_by=v_uid
     WHERE id=p_id
     RETURNING id INTO v_id;
  END IF;

  -- replace credential requirements for the draft provider
  FOR v_req IN SELECT * FROM jsonb_array_elements(p_credential_requirements) LOOP
    v_i := v_i + 1;
    IF COALESCE(v_req->>'purpose','') !~ '^[a-z0-9]+(_[a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_purpose'; END IF;
    IF char_length(btrim(COALESCE(v_req->>'display_name',''))) < 2 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_requirement_display_name'; END IF;
    IF char_length(COALESCE(v_req->>'secret_ref_pattern','')) < 3 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_secret_ref_pattern'; END IF;
    v_purposes := v_purposes || (v_req->>'purpose');

    INSERT INTO public.omni_comms_provider_credential_requirement(
      provider_id, purpose, display_name, description, required, secret_ref_pattern, sort_order)
    VALUES (v_id, v_req->>'purpose', btrim(v_req->>'display_name'),
            NULLIF(btrim(COALESCE(v_req->>'description','')),''),
            COALESCE((v_req->>'required')::boolean, true),
            v_req->>'secret_ref_pattern', v_i)
    ON CONFLICT (provider_id, purpose) DO UPDATE
      SET display_name=EXCLUDED.display_name,
          description=EXCLUDED.description,
          required=EXCLUDED.required,
          secret_ref_pattern=EXCLUDED.secret_ref_pattern,
          sort_order=EXCLUDED.sort_order;
  END LOOP;

  DELETE FROM public.omni_comms_provider_credential_requirement
   WHERE provider_id=v_id AND NOT (purpose = ANY(v_purposes));

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END,
    'provider', v_id, v_code, v_before,
    (SELECT to_jsonb(p) - 'created_by' - 'updated_by' FROM public.omni_comms_provider p WHERE p.id=v_id),
    p_correlation_id);

  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_provider_set_lifecycle(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE v_uid uuid; v_row public.omni_comms_provider%ROWTYPE; v_before jsonb; v_action text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_action := lower(btrim(COALESCE(p_action,'')));
  IF v_action NOT IN ('activate','retire') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_action'; END IF;

  SELECT * INTO v_row FROM public.omni_comms_provider WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_not_found'; END IF;
  IF v_row.data_origin <> 'user' THEN
    RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='seeded_provider_read_only'; END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC409 stale_write' USING ERRCODE='P0001', DETAIL='concurrent_modification'; END IF;
  v_before := to_jsonb(v_row) - 'created_by' - 'updated_by';

  IF v_action = 'activate' THEN
    IF v_row.status <> 'draft' THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='only_draft_can_activate'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_credential_requirement r
                    WHERE r.provider_id=p_id) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',
        DETAIL='credential_requirements_required_before_activation'; END IF;
    UPDATE public.omni_comms_provider
       SET status='active', activated_at=now(), activated_by=v_uid, updated_by=v_uid
     WHERE id=p_id;
  ELSE
    IF char_length(btrim(COALESCE(p_reason,''))) < 1 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='retirement_reason_required'; END IF;
    IF EXISTS (SELECT 1 FROM public.omni_comms_provider_account a
                WHERE a.provider_id=p_id AND a.status IN ('draft','active')) THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='provider_has_live_accounts'; END IF;
    UPDATE public.omni_comms_provider
       SET status='retired', retired_at=now(), retired_by=v_uid,
           retirement_reason=btrim(p_reason), updated_by=v_uid
     WHERE id=p_id;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, v_action, 'provider', p_id, v_row.code, v_before,
    (SELECT to_jsonb(p) - 'created_by' - 'updated_by' FROM public.omni_comms_provider p WHERE p.id=p_id),
    p_correlation_id);

  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_provider_admin_summary(text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_channel_provider_upsert_draft(uuid, timestamptz, text, text, text, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_channel_provider_set_lifecycle(uuid, timestamptz, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_provider_admin_summary(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_provider_upsert_draft(uuid, timestamptz, text, text, text, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_provider_set_lifecycle(uuid, timestamptz, text, text, text) TO authenticated, service_role;
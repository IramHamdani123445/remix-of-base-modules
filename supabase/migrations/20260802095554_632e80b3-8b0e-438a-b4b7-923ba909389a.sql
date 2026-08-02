-- ═══════════════════════════════════════════════════════════════════
-- Omni-Comms Channels C3B — Domains and Channel Endpoints
-- Additive only. No provider adapter, no DNS, no callback receiver,
-- no runtime request/message/job/attempt object, no Legacy Hub object.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. endpoint table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.omni_comms_channel_endpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  channel text NOT NULL,
  provider_account_id uuid NULL REFERENCES public.omni_comms_provider_account(id),
  code text NOT NULL,
  display_name text NOT NULL,
  endpoint_type text NOT NULL,
  endpoint_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_origin text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'draft',
  verification_status text NOT NULL DEFAULT 'unverified',
  verification_result_code text NULL,
  verification_detail text NULL,
  verification_checked_at timestamptz NULL,
  activated_at timestamptz NULL,
  activated_by uuid NULL,
  retired_at timestamptz NULL,
  retired_by uuid NULL,
  retirement_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT omni_comms_channel_endpoint_channel_chk
    CHECK (channel IN ('email','sms','whatsapp','in_app','print')),
  CONSTRAINT omni_comms_channel_endpoint_type_chk
    CHECK (endpoint_type IN ('sending_domain','event_callback','delivery_callback',
                             'inbound_callback','business_webhook','realtime_endpoint',
                             'render_service')),
  CONSTRAINT omni_comms_channel_endpoint_origin_chk
    CHECK (data_origin IN ('system_seed','user','reference_seed')),
  CONSTRAINT omni_comms_channel_endpoint_status_chk
    CHECK (status IN ('draft','active','disabled','retired')),
  CONSTRAINT omni_comms_channel_endpoint_verification_chk
    CHECK (verification_status IN ('unverified','pending','verified','failed')),
  CONSTRAINT omni_comms_channel_endpoint_config_chk
    CHECK (jsonb_typeof(endpoint_config)='object' AND char_length(endpoint_config::text) <= 4000),
  CONSTRAINT omni_comms_channel_endpoint_code_chk
    CHECK (code ~ '^[a-z0-9][a-z0-9_]{2,63}$'),
  CONSTRAINT omni_comms_channel_endpoint_display_chk
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 160)
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_channel_endpoint_org_code_uk
  ON public.omni_comms_channel_endpoint (organization_id, code);
CREATE INDEX IF NOT EXISTS omni_comms_channel_endpoint_org_channel_ix
  ON public.omni_comms_channel_endpoint (organization_id, channel, status);
CREATE INDEX IF NOT EXISTS omni_comms_channel_endpoint_account_ix
  ON public.omni_comms_channel_endpoint (provider_account_id);

REVOKE ALL ON TABLE public.omni_comms_channel_endpoint FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.omni_comms_channel_endpoint TO service_role;

-- ─── 2. endpoint secret-reference table ────────────────────────────
CREATE TABLE IF NOT EXISTS public.omni_comms_channel_endpoint_secret_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_endpoint_id uuid NOT NULL
    REFERENCES public.omni_comms_channel_endpoint(id),
  purpose text NOT NULL,
  secret_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT omni_comms_channel_endpoint_secret_purpose_chk
    CHECK (purpose ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' AND char_length(purpose) <= 40),
  CONSTRAINT omni_comms_channel_endpoint_secret_ref_chk
    CHECK (secret_ref ~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$' AND char_length(secret_ref) <= 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_channel_endpoint_secret_uk
  ON public.omni_comms_channel_endpoint_secret_ref (channel_endpoint_id, purpose);

REVOKE ALL ON TABLE public.omni_comms_channel_endpoint_secret_ref FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.omni_comms_channel_endpoint_secret_ref TO service_role;

-- ═══ 3. bounded URL normaliser (never fetched) ═════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_endpoint_url(
  p_url text, p_field text)
RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v text; v_rest text; v_authority text; v_host text; v_query text;
BEGIN
  v := btrim(coalesce(p_url,''));
  IF v = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='missing_required_field:'||p_field; END IF;
  IF char_length(v) > 512 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='url_too_long:'||p_field; END IF;
  IF v ~ '\s' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_url:'||p_field; END IF;
  IF position('#' in v) > 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='url_fragment_not_allowed:'||p_field; END IF;
  IF lower(left(v,8)) <> 'https://' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='https_required:'||p_field; END IF;

  v_rest := substring(v from 9);
  v_authority := split_part(split_part(v_rest,'/',1),'?',1);
  IF position('@' in v_authority) > 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='url_credentials_not_allowed:'||p_field; END IF;
  v_host := lower(split_part(v_authority,':',1));
  IF v_host = '' OR v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_url_host:'||p_field; END IF;
  IF v_host ~ '^[0-9.]+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='ip_host_not_allowed:'||p_field; END IF;
  IF v_host IN ('localhost','localhost.localdomain') OR v_host LIKE '%.local'
     OR v_host LIKE '%.internal' OR v_host LIKE '%.localhost' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='loopback_host_not_allowed:'||p_field; END IF;

  v_query := split_part(v_rest,'?',2);
  IF char_length(v_query) > 200 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='url_query_too_long:'||p_field; END IF;

  RETURN 'https://' || v_host
       || CASE WHEN split_part(v_authority,':',2) <> '' THEN ':'||split_part(v_authority,':',2) ELSE '' END
       || CASE WHEN position('/' in v_rest) > 0 THEN substring(v_rest from position('/' in v_rest)) ELSE '' END;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_endpoint_url(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_normalize_endpoint_url(text,text) TO service_role;

-- ═══ 4. bounded domain normaliser (never resolved) ═════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_endpoint_domain(
  p_domain text, p_field text)
RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v text;
BEGIN
  v := lower(btrim(coalesce(p_domain,'')));
  IF v = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='missing_required_field:'||p_field; END IF;
  IF char_length(v) > 253 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='domain_too_long:'||p_field; END IF;
  IF v ~ '\s' OR position('://' in v) > 0 OR position('/' in v) > 0
     OR position('?' in v) > 0 OR position('#' in v) > 0 OR position('@' in v) > 0
     OR position(':' in v) > 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_domain:'||p_field; END IF;
  IF position('*' in v) > 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='wildcard_domain_not_allowed:'||p_field; END IF;
  IF left(v,1)='.' OR right(v,1)='.' OR position('..' in v) > 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_domain:'||p_field; END IF;
  IF v ~ '^[0-9.]+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='ip_domain_not_allowed:'||p_field; END IF;
  IF v !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_domain:'||p_field; END IF;
  IF split_part(reverse(v),'.',1) ~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_domain:'||p_field; END IF;
  RETURN v;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_endpoint_domain(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_normalize_endpoint_domain(text,text) TO service_role;

-- ═══ 5. generic endpoint validator / normaliser ════════════════════
-- Returns { "endpoint_config": {...}, "secret_refs": {purpose: NAME} }
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_channel_endpoint(
  p_channel text, p_endpoint_type text, p_endpoint_config jsonb, p_secret_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'pg_catalog','public' AS $$
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

  IF v_ch NOT IN ('email','sms','whatsapp','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_channel'; END IF;
  IF p_endpoint_config IS NULL OR jsonb_typeof(p_endpoint_config) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_config_object_required'; END IF;
  IF char_length(p_endpoint_config::text) > 4000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_config_too_large'; END IF;
  IF p_secret_refs IS NOT NULL AND jsonb_typeof(p_secret_refs) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_refs_object_required'; END IF;
  IF p_secret_refs IS NOT NULL AND char_length(p_secret_refs::text) > 2000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_refs_too_large'; END IF;

  -- channel → endpoint-type mapping (single server-side source of truth)
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
  ELSE
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_endpoint_type';
  END IF;

  v_arrays := coalesce(v_arrays, ARRAY[]::text[]);

  -- generic key/shape validation
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

  -- field-specific normalisation
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

  -- secret references (names only, never values)
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
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_channel_endpoint(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_normalize_channel_endpoint(text,text,jsonb,jsonb) TO service_role;

-- ═══ 6. provider-account association validator ═════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_endpoint_requires_account(
  p_channel text, p_endpoint_type text, p_config jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog','public' AS $$
  SELECT CASE
    WHEN p_channel='email' AND p_endpoint_type IN ('sending_domain','event_callback') THEN true
    WHEN p_channel='sms'   AND p_endpoint_type IN ('delivery_callback','inbound_callback') THEN true
    WHEN p_channel='whatsapp' AND p_endpoint_type='business_webhook' THEN true
    WHEN p_channel='print' AND p_endpoint_type='render_service'
         AND coalesce(p_config->>'service_mode','') = 'https' THEN true
    ELSE false END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_endpoint_requires_account(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_endpoint_requires_account(text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_endpoint_account(
  p_account_id uuid, p_organization_id uuid, p_channel text, p_required boolean,
  p_require_active boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_org uuid; v_status text; v_origin text; v_ch text;
BEGIN
  IF p_account_id IS NULL THEN
    IF p_required THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_required'; END IF;
    RETURN;
  END IF;
  SELECT a.organization_id, a.status, a.data_origin, p.channel
    INTO v_org, v_status, v_origin, v_ch
    FROM public.omni_comms_provider_account a
    JOIN public.omni_comms_provider p ON p.id = a.provider_id
   WHERE a.id = p_account_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_account'; END IF;
  IF v_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='provider_account_organization_mismatch'; END IF;
  IF v_ch IS DISTINCT FROM p_channel THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_channel_mismatch'; END IF;
  IF v_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_provider_account_not_allowed'; END IF;
  IF v_status = 'retired' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_retired'; END IF;
  IF p_require_active AND v_status <> 'active' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='provider_account_not_active'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_endpoint_account(uuid,uuid,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_validate_endpoint_account(uuid,uuid,text,boolean,boolean) TO service_role;

-- ═══ 7. private upsert worker ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_endpoint_upsert(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_organization_id uuid, p_department_id uuid, p_channel text,
  p_provider_account_id uuid, p_code text, p_display_name text,
  p_endpoint_type text, p_endpoint_config jsonb, p_secret_refs jsonb,
  p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_ch text; v_type text; v_norm jsonb; v_cfg jsonb; v_secrets jsonb;
        v_before public.omni_comms_channel_endpoint%ROWTYPE;
        v_after  public.omni_comms_channel_endpoint%ROWTYPE;
        v_before_secrets jsonb; v_material boolean; v_key text; v_val text;
BEGIN
  v_ch := btrim(coalesce(p_channel,''));
  v_type := btrim(coalesce(p_endpoint_type,''));
  v_norm := public.omni_comms_priv_normalize_channel_endpoint(v_ch, v_type, p_endpoint_config, p_secret_refs);
  v_cfg := v_norm->'endpoint_config';
  v_secrets := v_norm->'secret_refs';

  PERFORM public.omni_comms_priv_validate_endpoint_account(
    p_provider_account_id, p_organization_id, v_ch,
    public.omni_comms_priv_endpoint_requires_account(v_ch, v_type, v_cfg), false);

  IF p_id IS NULL THEN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, p_department_id);
    BEGIN
      INSERT INTO public.omni_comms_channel_endpoint(
        organization_id, department_id, channel, provider_account_id, code, display_name,
        endpoint_type, endpoint_config, data_origin, status, verification_status,
        created_by, updated_by)
      VALUES(p_organization_id, p_department_id, v_ch, p_provider_account_id,
        lower(btrim(coalesce(p_code,''))), btrim(coalesce(p_display_name,'')),
        v_type, v_cfg, 'user', 'draft', 'unverified', p_actor_id, p_actor_id)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='endpoint_code_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    END;
  ELSE
    SELECT * INTO v_before FROM public.omni_comms_channel_endpoint WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='channel_endpoint'; END IF;
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, v_before.organization_id, p_department_id);
    IF p_organization_id IS NOT NULL AND v_before.organization_id IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='organization_mismatch'; END IF;
    IF v_before.data_origin='reference_seed' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_endpoint_read_only'; END IF;
    IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;
    IF v_before.status <> 'draft' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft'; END IF;
    IF v_before.channel IS DISTINCT FROM v_ch THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_immutable'; END IF;

    SELECT COALESCE(jsonb_object_agg(purpose, secret_ref),'{}'::jsonb) INTO v_before_secrets
      FROM public.omni_comms_channel_endpoint_secret_ref WHERE channel_endpoint_id=p_id;

    v_material :=
      v_before.provider_account_id IS DISTINCT FROM p_provider_account_id
      OR v_before.endpoint_type IS DISTINCT FROM v_type
      OR v_before.endpoint_config IS DISTINCT FROM v_cfg
      OR v_before_secrets IS DISTINCT FROM v_secrets;

    BEGIN
      UPDATE public.omni_comms_channel_endpoint
         SET department_id=p_department_id,
             provider_account_id=p_provider_account_id,
             code=lower(btrim(coalesce(p_code,''))),
             display_name=btrim(coalesce(p_display_name,'')),
             endpoint_type=v_type, endpoint_config=v_cfg,
             verification_status = CASE WHEN v_material THEN 'unverified' ELSE verification_status END,
             verification_result_code = CASE WHEN v_material THEN NULL ELSE verification_result_code END,
             verification_detail = CASE WHEN v_material THEN NULL ELSE verification_detail END,
             verification_checked_at = CASE WHEN v_material THEN NULL ELSE verification_checked_at END,
             updated_by=p_actor_id, updated_at=now()
       WHERE id=p_id RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='endpoint_code_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    END;
  END IF;

  -- secret references: names only, replaced atomically inside this transaction
  DELETE FROM public.omni_comms_channel_endpoint_secret_ref
   WHERE channel_endpoint_id = v_after.id
     AND purpose NOT IN (SELECT jsonb_object_keys(v_secrets));
  FOR v_key, v_val IN SELECT key, value #>> '{}' FROM jsonb_each(v_secrets) LOOP
    INSERT INTO public.omni_comms_channel_endpoint_secret_ref(
      channel_endpoint_id, purpose, secret_ref, created_by, updated_by)
    VALUES(v_after.id, v_key, v_val, p_actor_id, p_actor_id)
    ON CONFLICT (channel_endpoint_id, purpose)
      DO UPDATE SET secret_ref=EXCLUDED.secret_ref, updated_by=p_actor_id, updated_at=now();
  END LOOP;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id, CASE WHEN p_id IS NULL THEN 'create' ELSE 'update_draft' END,
    'channel_endpoint', v_after.id, v_after.code,
    CASE WHEN p_id IS NULL THEN NULL
         ELSE to_jsonb(v_before) || jsonb_build_object('secret_refs', v_before_secrets) END,
    to_jsonb(v_after) || jsonb_build_object('secret_refs', v_secrets),
    p_correlation_id);

  RETURN v_after.id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_endpoint_upsert(uuid,uuid,timestamptz,uuid,uuid,text,uuid,text,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_endpoint_upsert(uuid,uuid,timestamptz,uuid,uuid,text,uuid,text,text,text,jsonb,jsonb,text) TO service_role;

-- ═══ 8. private lifecycle worker ═══════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_endpoint_lifecycle(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_action text, p_reason text, p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_action text; v_reason text; v_secrets jsonb;
        v_before public.omni_comms_channel_endpoint%ROWTYPE;
        v_after  public.omni_comms_channel_endpoint%ROWTYPE;
BEGIN
  v_action := btrim(lower(coalesce(p_action,'')));
  IF v_action NOT IN ('activate','disable','retire') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_action'; END IF;

  SELECT * INTO v_before FROM public.omni_comms_channel_endpoint WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='channel_endpoint'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, v_before.organization_id, NULL);
  IF v_before.data_origin='reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_endpoint_non_operational'; END IF;
  IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;

  IF v_action='activate' THEN
    IF v_before.status NOT IN ('draft','disabled') THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft_or_disabled'; END IF;
    SELECT COALESCE(jsonb_object_agg(purpose, secret_ref),'{}'::jsonb) INTO v_secrets
      FROM public.omni_comms_channel_endpoint_secret_ref WHERE channel_endpoint_id=p_id;
    PERFORM public.omni_comms_priv_normalize_channel_endpoint(
      v_before.channel, v_before.endpoint_type, v_before.endpoint_config, v_secrets);
    PERFORM public.omni_comms_priv_validate_endpoint_account(
      v_before.provider_account_id, v_before.organization_id, v_before.channel,
      public.omni_comms_priv_endpoint_requires_account(
        v_before.channel, v_before.endpoint_type, v_before.endpoint_config),
      public.omni_comms_priv_endpoint_requires_account(
        v_before.channel, v_before.endpoint_type, v_before.endpoint_config));
    UPDATE public.omni_comms_channel_endpoint
       SET status='active',
           activated_at=COALESCE(activated_at, now()), activated_by=COALESCE(activated_by, p_actor_id),
           updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSIF v_action='disable' THEN
    IF v_before.status <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_active'; END IF;
    UPDATE public.omni_comms_channel_endpoint
       SET status='disabled', updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSE
    v_reason := NULLIF(btrim(coalesce(p_reason,'')),'');
    IF v_reason IS NULL OR char_length(v_reason) > 2000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='retirement_reason_required'; END IF;
    IF v_before.status='retired' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_retired'; END IF;
    UPDATE public.omni_comms_channel_endpoint
       SET status='retired', retired_at=now(), retired_by=p_actor_id,
           retirement_reason=v_reason, updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id, v_action, 'channel_endpoint', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_endpoint_lifecycle(uuid,uuid,timestamptz,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_endpoint_lifecycle(uuid,uuid,timestamptz,text,text,text) TO service_role;

-- ═══ 9. public generic RPCs ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_channel_endpoint_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_include_reference boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_ch text; v_can_configure boolean; v_allow_ref boolean;
        v_rows jsonb; v_ref_rows jsonb; v_accounts jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_ch := btrim(coalesce(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_can_configure := public.has_permission(v_uid,'omni_comms','configure');
  v_allow_ref := COALESCE(p_include_reference,false) AND v_can_configure;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',a.id,'code',a.code,'display_name',a.display_name,'status',a.status,
      'adapter_key',p.adapter_key,'channel',p.channel,'data_origin',a.data_origin
    ) ORDER BY a.created_at),'[]'::jsonb) INTO v_accounts
    FROM public.omni_comms_provider_account a
    JOIN public.omni_comms_provider p ON p.id=a.provider_id
   WHERE a.organization_id=p_organization_id
     AND p.channel=v_ch
     AND a.data_origin <> 'reference_seed'
     AND a.status <> 'retired';

  WITH ep AS (
    SELECT e.* FROM public.omni_comms_channel_endpoint e
     WHERE e.organization_id = p_organization_id
       AND e.channel = v_ch
       AND (p_department_id IS NULL
            OR e.department_id IS NULL
            OR e.department_id = p_department_id)
  ), shaped AS (
    SELECT e.data_origin AS origin, e.created_at, jsonb_build_object(
      'id',e.id,'code',e.code,'display_name',e.display_name,'channel',e.channel,
      'endpoint_type',e.endpoint_type,'endpoint_config',e.endpoint_config,
      'provider_account_id',e.provider_account_id,
      'provider_account_code',a.code,
      'provider_account_display_name',a.display_name,
      'provider_account_status',a.status,
      'provider_adapter_key',pr.adapter_key,
      'department_id',e.department_id,'department_name',d.name,
      'secret_refs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('purpose',s.purpose,'secret_ref',s.secret_ref)
                         ORDER BY s.purpose)
          FROM public.omni_comms_channel_endpoint_secret_ref s
         WHERE s.channel_endpoint_id=e.id),'[]'::jsonb),
      'status',e.status,'data_origin',e.data_origin,
      'verification_status',e.verification_status,
      'verification_result_code',e.verification_result_code,
      'verification_detail',left(coalesce(e.verification_detail,''),300),
      'verification_checked_at',e.verification_checked_at,
      'updated_at',e.updated_at,'activated_at',e.activated_at,
      'retired_at',e.retired_at,'retirement_reason',e.retirement_reason) AS row_json
      FROM ep e
      LEFT JOIN public.omni_comms_provider_account a ON a.id = e.provider_account_id
      LEFT JOIN public.omni_comms_provider pr ON pr.id = a.provider_id
      LEFT JOIN public.core_department d
        ON d.id = e.department_id AND d.organization_id = p_organization_id
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
    'provider_accounts', v_accounts,
    'endpoints', v_rows,
    'reference_endpoints', CASE WHEN v_allow_ref THEN v_ref_rows ELSE '[]'::jsonb END,
    'reference_endpoint_count',
      CASE WHEN v_can_configure THEN jsonb_array_length(v_ref_rows) ELSE 0 END,
    'generated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_endpoint_summary(uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_endpoint_summary(uuid,uuid,text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_endpoint_upsert_draft(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_provider_account_id uuid,
  p_code text,
  p_display_name text,
  p_endpoint_type text,
  p_endpoint_config jsonb DEFAULT '{}'::jsonb,
  p_secret_refs jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_endpoint_upsert(
    v_uid, p_id, p_expected_updated_at, p_organization_id, p_department_id,
    p_channel, p_provider_account_id, p_code, p_display_name,
    p_endpoint_type, p_endpoint_config, p_secret_refs, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_endpoint_upsert_draft(uuid,timestamptz,uuid,uuid,text,uuid,text,text,text,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_endpoint_upsert_draft(uuid,timestamptz,uuid,uuid,text,uuid,text,text,text,jsonb,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_endpoint_set_lifecycle(
  p_id uuid, p_expected_updated_at timestamptz, p_action text,
  p_reason text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_endpoint_lifecycle(
    v_uid, p_id, p_expected_updated_at, p_action, p_reason, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_endpoint_set_lifecycle(uuid,timestamptz,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_endpoint_set_lifecycle(uuid,timestamptz,text,text,text) TO authenticated, service_role;

-- ═══ 10. Email summary projects endpoint records ═══════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_email_config_summary(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','extensions' AS $$
DECLARE v_uid uuid; v_pid uuid; v_provider jsonb; v_accounts jsonb; v_senders jsonb;
        v_bindings jsonb; v_setting jsonb; v_ready boolean; v_endpoints jsonb;
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
      'id',a.id,'code',a.code,'display_name',a.display_name,'secret_ref',a.secret_ref,
      'region',a.region,'sandbox_mode',a.sandbox_mode,'status',a.status,
      'environment',a.environment,'data_origin',a.data_origin,
      'provider_account_reference',a.provider_account_reference,
      'health_state',a.health_state,'health_checked_at',a.health_checked_at,'updated_at',a.updated_at,
      'verification_status',a.verification_status,
      'verification_result_code',a.verification_result_code,
      'verification_detail',a.verification_detail,
      'verification_checked_at',a.verification_checked_at
    ) ORDER BY a.created_at),'[]'::jsonb) INTO v_accounts
    FROM public.omni_comms_provider_account a
   WHERE a.organization_id=p_organization_id AND a.provider_id=v_pid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,
      'from_address',from_address,'from_name',from_name,'reply_to_address',reply_to_address,
      'status',status,'department_id',department_id,'event_definition_id',event_definition_id,
      'data_origin',data_origin,'identity_type',identity_type,'identity_config',identity_config,
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id,'code',e.code,'display_name',e.display_name,'channel',e.channel,
      'endpoint_type',e.endpoint_type,'endpoint_config',e.endpoint_config,
      'provider_account_id',e.provider_account_id,
      'department_id',e.department_id,
      'status',e.status,'data_origin',e.data_origin,
      'verification_status',e.verification_status,
      'secret_refs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('purpose',s2.purpose,'secret_ref',s2.secret_ref)
                         ORDER BY s2.purpose)
          FROM public.omni_comms_channel_endpoint_secret_ref s2
         WHERE s2.channel_endpoint_id=e.id),'[]'::jsonb),
      'updated_at',e.updated_at
    ) ORDER BY e.created_at),'[]'::jsonb) INTO v_endpoints
    FROM public.omni_comms_channel_endpoint e
   WHERE e.organization_id=p_organization_id AND e.channel='email';
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
                    AND status='active' AND verification_status='verified'
                    AND data_origin <> 'reference_seed')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_identity
                  WHERE organization_id=p_organization_id AND channel='email' AND status='active'
                    AND data_origin <> 'reference_seed')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_provider_binding b
                  JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
                 WHERE s.organization_id=p_organization_id AND s.channel='email'
                   AND b.status='active' AND b.verification_status='verified')
      AND v_setting IS NOT NULL AND (v_setting->>'enabled')::boolean=true;
  RETURN jsonb_build_object(
    'organization_id',p_organization_id,'provider',v_provider,
    'provider_accounts',v_accounts,'sender_identities',v_senders,
    'bindings',v_bindings,'channel_setting',v_setting,
    'endpoints',v_endpoints,
    'email_send_ready',v_ready,'generated_at',now());
END; $$;

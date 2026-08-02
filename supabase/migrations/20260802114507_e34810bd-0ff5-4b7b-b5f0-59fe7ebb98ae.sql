-- =====================================================================
-- Omni-Comms C5A — Channel Test Centre preflight + immutable test-run ledger
-- Exactly one new object: public.omni_comms_channel_test_run
-- Zero-send: no provider contact, no request/message/dispatch/attempt writes.
-- =====================================================================

CREATE TABLE public.omni_comms_channel_test_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  channel text NOT NULL,
  binding_id uuid NOT NULL,
  test_kind text NOT NULL DEFAULT 'configuration_preflight',
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  configuration_fingerprint text NOT NULL,
  configuration_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_type text NOT NULL,
  target_masked text NOT NULL,
  target_hash text NOT NULL,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  status text NOT NULL,
  result_code text NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocker_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  correlation_id text NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_ctr_channel_chk
    CHECK (channel IN ('email','sms','whatsapp','push','in_app','print')),
  CONSTRAINT omni_comms_ctr_kind_chk
    CHECK (test_kind = 'configuration_preflight'),
  CONSTRAINT omni_comms_ctr_status_chk
    CHECK (status IN ('passed','failed')),
  CONSTRAINT omni_comms_ctr_result_chk
    CHECK (result_code IN ('preflight_passed','preflight_failed')),
  CONSTRAINT omni_comms_ctr_status_result_chk
    CHECK ((status = 'passed' AND result_code = 'preflight_passed')
        OR (status = 'failed' AND result_code = 'preflight_failed')),
  CONSTRAINT omni_comms_ctr_idem_chk
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT omni_comms_ctr_reqfp_chk
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_ctr_cfgfp_chk
    CHECK (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_ctr_target_hash_chk
    CHECK (target_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_ctr_payload_hash_chk
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_ctr_target_type_chk
    CHECK (target_type IN ('email_address','phone_number','whatsapp_number',
                           'device_token','user_reference','recipient_reference')),
  CONSTRAINT omni_comms_ctr_checks_chk
    CHECK (jsonb_typeof(checks) = 'array' AND jsonb_array_length(checks) = 21),
  CONSTRAINT omni_comms_ctr_snapshot_chk
    CHECK (jsonb_typeof(configuration_snapshot) = 'object'),
  CONSTRAINT omni_comms_ctr_payload_summary_chk
    CHECK (jsonb_typeof(payload_summary) = 'object'),
  CONSTRAINT omni_comms_ctr_masked_chk
    CHECK (btrim(target_masked) <> ''),
  CONSTRAINT omni_comms_ctr_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.core_organization(id),
  CONSTRAINT omni_comms_ctr_binding_fk
    FOREIGN KEY (binding_id) REFERENCES public.omni_comms_sender_provider_binding(id)
);

CREATE UNIQUE INDEX omni_comms_ctr_idem_uniq
  ON public.omni_comms_channel_test_run (organization_id, idempotency_key);

CREATE INDEX omni_comms_ctr_history_idx
  ON public.omni_comms_channel_test_run (organization_id, channel, requested_at DESC);

CREATE INDEX omni_comms_ctr_binding_idx
  ON public.omni_comms_channel_test_run (binding_id, requested_at DESC);

COMMENT ON TABLE public.omni_comms_channel_test_run IS
  'Omni-Comms C5A: immutable technical configuration-preflight ledger. No raw target or raw payload content is ever stored. No message is ever sent.';

-- Direct table access denied to the browser; RPC-only surface.
REVOKE ALL ON public.omni_comms_channel_test_run FROM PUBLIC;
REVOKE ALL ON public.omni_comms_channel_test_run FROM anon;
REVOKE ALL ON public.omni_comms_channel_test_run FROM authenticated;
GRANT ALL ON public.omni_comms_channel_test_run TO service_role;

ALTER TABLE public.omni_comms_channel_test_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_channel_test_run FORCE ROW LEVEL SECURITY;
-- Intentionally no policies: readable/writable only through SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------
-- Immutability guard
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_run_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public'
AS $$
BEGIN
  RAISE EXCEPTION 'OC412 invalid_state'
    USING ERRCODE = 'P0001', DETAIL = 'test_run_immutable';
END; $$;

CREATE TRIGGER omni_comms_ctr_immutable_trg
BEFORE UPDATE OR DELETE ON public.omni_comms_channel_test_run
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_channel_test_run_immutable();

-- ---------------------------------------------------------------------
-- Deterministic SHA-256 helper (no extension required)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_sha256(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$ SELECT encode(sha256(convert_to(coalesce(p_text,''), 'UTF8')), 'hex'); $$;

-- ---------------------------------------------------------------------
-- Binding-specific configuration snapshot (canonical, bounded)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_config_snapshot(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_binding_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  b public.omni_comms_sender_provider_binding%ROWTYPE;
  a public.omni_comms_provider_account%ROWTYPE;
  i public.omni_comms_sender_identity%ROWTYPE;
  e public.omni_comms_channel_endpoint%ROWTYPE;
  s_org public.omni_comms_channel_setting%ROWTYPE;
  s_dept public.omni_comms_channel_setting%ROWTYPE;
  v_policy jsonb := 'null'::jsonb;
  v_policy_source text := 'none';
  v_dept_found boolean := false;
  v_req_total integer := 0;
  v_req_met integer := 0;
  v_acct_refs jsonb := '[]'::jsonb;
  v_ep_refs jsonb := '[]'::jsonb;
BEGIN
  IF p_binding_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='binding_required';
  END IF;

  SELECT * INTO b FROM public.omni_comms_sender_provider_binding WHERE id = p_binding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='binding_not_found';
  END IF;
  IF b.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied'
      USING ERRCODE='P0001', DETAIL='binding_organization_mismatch';
  END IF;
  IF b.channel IS DISTINCT FROM p_channel THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='binding_channel_mismatch';
  END IF;

  SELECT * INTO a FROM public.omni_comms_provider_account WHERE id = b.provider_account_id;
  SELECT * INTO i FROM public.omni_comms_sender_identity   WHERE id = b.sender_identity_id;
  IF b.channel_endpoint_id IS NOT NULL THEN
    SELECT * INTO e FROM public.omni_comms_channel_endpoint WHERE id = b.channel_endpoint_id;
  END IF;

  SELECT * INTO s_org FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND department_id IS NULL
     AND channel = p_channel AND data_origin <> 'reference_seed';

  IF p_department_id IS NOT NULL THEN
    SELECT * INTO s_dept FROM public.omni_comms_channel_setting
     WHERE organization_id = p_organization_id AND department_id = p_department_id
       AND channel = p_channel AND data_origin <> 'reference_seed';
    v_dept_found := FOUND;
  END IF;

  IF v_dept_found AND coalesce(s_dept.department_override_enabled,false) THEN
    v_policy := public.omni_comms_priv_channel_policy_json(s_dept);
    v_policy_source := 'department_override';
  ELSIF s_org.id IS NOT NULL THEN
    v_policy := public.omni_comms_priv_channel_policy_json(s_org);
    v_policy_source := 'organisation_baseline';
  END IF;

  IF a.id IS NOT NULL THEN
    SELECT count(*) INTO v_req_total
      FROM public.omni_comms_provider_credential_requirement r
     WHERE r.provider_id = a.provider_id AND r.required = true;

    SELECT count(*) INTO v_req_met
      FROM public.omni_comms_provider_credential_requirement r
      JOIN public.omni_comms_provider_account_secret_ref sr
        ON sr.provider_account_id = a.id AND sr.purpose = r.purpose
       AND btrim(coalesce(sr.secret_ref,'')) <> ''
     WHERE r.provider_id = a.provider_id AND r.required = true;

    SELECT coalesce(jsonb_agg(sr.purpose ORDER BY sr.purpose), '[]'::jsonb)
      INTO v_acct_refs
      FROM public.omni_comms_provider_account_secret_ref sr
     WHERE sr.provider_account_id = a.id;
  END IF;

  IF e.id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(sr.purpose ORDER BY sr.purpose), '[]'::jsonb)
      INTO v_ep_refs
      FROM public.omni_comms_channel_endpoint_secret_ref sr
     WHERE sr.channel_endpoint_id = e.id;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', p_channel,
    'endpoint_requirement', public.omni_comms_priv_binding_endpoint_requirement(p_channel),
    'binding', jsonb_build_object(
      'id', b.id,
      'status', b.status,
      'priority', b.priority,
      'verification_status', b.verification_status,
      'verification_source', b.verification_source,
      'verification_result_code', b.verification_result_code,
      'data_origin', b.data_origin,
      'department_id', b.department_id
    ),
    'provider_account', CASE WHEN a.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', a.id,
      'provider_id', a.provider_id,
      'code', a.code,
      'status', a.status,
      'environment', a.environment,
      'region', a.region,
      'verification_status', a.verification_status,
      'verification_result_code', a.verification_result_code,
      'data_origin', a.data_origin,
      'secret_ref_purposes', v_acct_refs,
      'required_credential_count', v_req_total,
      'satisfied_credential_count', v_req_met
    ) END,
    'identity', CASE WHEN i.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', i.id,
      'code', i.code,
      'status', i.status,
      'identity_type', i.identity_type,
      'identity_config', coalesce(i.identity_config, '{}'::jsonb),
      'data_origin', i.data_origin,
      'department_id', i.department_id
    ) END,
    'endpoint', CASE WHEN e.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', e.id,
      'code', e.code,
      'status', e.status,
      'endpoint_type', e.endpoint_type,
      'endpoint_config', coalesce(e.endpoint_config, '{}'::jsonb),
      'verification_status', e.verification_status,
      'data_origin', e.data_origin,
      'secret_ref_purposes', v_ep_refs,
      'department_id', e.department_id
    ) END,
    'policy', v_policy,
    'policy_source', v_policy_source
  ));
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_config_fingerprint(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_binding_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT public.omni_comms_priv_channel_test_sha256(
    public.omni_comms_priv_channel_test_config_snapshot(
      p_organization_id, p_department_id, p_channel, p_binding_id)::text);
$$;

-- ---------------------------------------------------------------------
-- Safe target normalisation (masked + hashed only)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_normalize_target(
  p_channel text,
  p_target text
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v text := btrim(coalesce(p_target,''));
  v_digits text;
  v_type text;
  v_masked text;
BEGIN
  IF v = '' THEN
    RETURN jsonb_build_object('valid', false, 'code', 'target_missing');
  END IF;

  IF p_channel = 'email' THEN
    v_type := 'email_address';
    v := lower(v);
    IF length(v) > 254 OR v !~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_email');
    END IF;
    v_masked := public.omni_comms_priv_mask_email(v);

  ELSIF p_channel IN ('sms','whatsapp') THEN
    v_type := CASE WHEN p_channel = 'sms' THEN 'phone_number' ELSE 'whatsapp_number' END;
    v := regexp_replace(v, '[\s()\-\.]', '', 'g');
    IF v !~ '^\+[1-9][0-9]{6,14}$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_phone');
    END IF;
    v_digits := regexp_replace(v, '\D', '', 'g');
    v_masked := '+' || left(v_digits, 1)
                || repeat('*', greatest(length(v_digits) - 5, 1))
                || right(v_digits, 4);

  ELSIF p_channel = 'push' THEN
    v_type := 'device_token';
    IF length(v) < 8 OR length(v) > 512 OR v ~ '\s' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_device_token');
    END IF;
    v_masked := 'tok_' || repeat('*', 6) || right(v, 4);

  ELSIF p_channel = 'in_app' THEN
    v_type := 'user_reference';
    IF length(v) < 3 OR length(v) > 128 OR v !~ '^[A-Za-z0-9._:@-]+$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_user_reference');
    END IF;
    v_masked := public.omni_comms_priv_mask_reference(v);

  ELSIF p_channel = 'print' THEN
    v_type := 'recipient_reference';
    IF length(v) < 3 OR length(v) > 160 OR v !~ '^[A-Za-z0-9 .,''\-/#&()]+$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_recipient_reference');
    END IF;
    v_masked := public.omni_comms_priv_mask_reference(v);

  ELSE
    RETURN jsonb_build_object('valid', false, 'code', 'target_channel_unsupported');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', 'target_valid',
    'target_type', v_type,
    'target_masked', coalesce(v_masked, 'masked'),
    'target_hash', public.omni_comms_priv_channel_test_sha256(p_channel || '|' || v)
  );
END; $$;

-- ---------------------------------------------------------------------
-- Safe payload validation (summary + hash only; never raw content)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_normalize_payload(
  p_channel text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
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
    WHEN 'whatsapp' THEN ARRAY['template_code','language_code','variables']
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
END; $$;

-- ---------------------------------------------------------------------
-- Canonical 21-check preflight checklist
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_checklist(
  p_channel text,
  p_snapshot jsonb,
  p_target jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v jsonb := '[]'::jsonb;
  b jsonb := p_snapshot->'binding';
  a jsonb := p_snapshot->'provider_account';
  i jsonb := p_snapshot->'identity';
  e jsonb := p_snapshot->'endpoint';
  pol jsonb := p_snapshot->'policy';
  v_req text := coalesce(p_snapshot->>'endpoint_requirement','forbidden');

  PROCEDURE_DUMMY boolean;

  FUNCTION_DUMMY boolean;
BEGIN
  RETURN v;
END; $$;

DROP FUNCTION public.omni_comms_priv_channel_test_checklist(text, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_checklist(
  p_channel text,
  p_snapshot jsonb,
  p_target jsonb,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  b jsonb   := coalesce(p_snapshot->'binding', 'null'::jsonb);
  a jsonb   := coalesce(p_snapshot->'provider_account', 'null'::jsonb);
  i jsonb   := coalesce(p_snapshot->'identity', 'null'::jsonb);
  e jsonb   := coalesce(p_snapshot->'endpoint', 'null'::jsonb);
  pol jsonb := coalesce(p_snapshot->'policy', 'null'::jsonb);
  v_req text := coalesce(p_snapshot->>'endpoint_requirement','forbidden');
  v_state text := coalesce(pol->>'operational_state','');
  v_checks jsonb := '[]'::jsonb;

  -- local helper values
  v_ok boolean;
  v_detail text;
BEGIN
  -- 1 binding selected
  v_ok := (b <> 'null'::jsonb);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_selected','category','binding','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail', CASE WHEN v_ok THEN 'A candidate binding is selected.' ELSE 'No binding selected.' END));

  -- 2 binding active
  v_ok := (b->>'status' = 'active');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_active','category','binding','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Binding lifecycle status must be active.'));

  -- 3 binding genuine (not reference seed)
  v_ok := coalesce(b->>'data_origin','') <> 'reference_seed';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_not_reference','category','binding','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Reference bindings are illustrative and cannot be tested.'));

  -- 4 binding verified by provider
  v_ok := coalesce(b->>'verification_status','') = 'verified';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_verified','category','binding','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Binding must carry a provider-confirmed verified state.'));

  -- 5 provider account present
  v_ok := (a <> 'null'::jsonb);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_account_present','category','provider_account','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Binding must reference a provider account.'));

  -- 6 provider account active
  v_ok := (a->>'status' = 'active');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_account_active','category','provider_account','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Provider account lifecycle status must be active.'));

  -- 7 provider account genuine
  v_ok := (a <> 'null'::jsonb) AND coalesce(a->>'data_origin','') <> 'reference_seed';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_account_not_reference','category','provider_account','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Reference provider accounts are non-operational.'));

  -- 8 provider account verified
  v_ok := coalesce(a->>'verification_status','') = 'verified';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_account_verified','category','provider_account','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Provider account must be verified.'));

  -- 9 credential references complete
  v_ok := (a <> 'null'::jsonb)
          AND coalesce((a->>'satisfied_credential_count')::int, 0)
              >= coalesce((a->>'required_credential_count')::int, 0);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_credentials_complete','category','provider_account','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','All required credential references must be configured.'));

  -- 10 identity present
  v_ok := (i <> 'null'::jsonb);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','identity_present','category','identity','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Binding must reference a channel identity.'));

  -- 11 identity active
  v_ok := (i->>'status' = 'active');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','identity_active','category','identity','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Channel identity lifecycle status must be active.'));

  -- 12 identity genuine
  v_ok := (i <> 'null'::jsonb) AND coalesce(i->>'data_origin','') <> 'reference_seed';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','identity_not_reference','category','identity','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Reference identities are illustrative only.'));

  -- 13 identity configuration complete for channel
  v_ok := (i <> 'null'::jsonb)
          AND coalesce(i->>'identity_type','') <> ''
          AND jsonb_typeof(coalesce(i->'identity_config','null'::jsonb)) = 'object'
          AND coalesce(i->'identity_config','{}'::jsonb) <> '{}'::jsonb;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','identity_configuration_complete','category','identity','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Channel identity must carry a complete configuration.'));

  -- 14 endpoint requirement satisfied
  v_ok := CASE v_req
            WHEN 'required'  THEN (e <> 'null'::jsonb)
            WHEN 'forbidden' THEN (e = 'null'::jsonb)
            ELSE true END;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','endpoint_requirement_satisfied','category','endpoint','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Endpoint presence must match the channel requirement (' || v_req || ').'));

  -- 15 endpoint active (skipped when not applicable)
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','endpoint_active','category','endpoint','status',
    CASE WHEN e = 'null'::jsonb THEN
           CASE WHEN v_req = 'required' THEN 'failed' ELSE 'skipped' END
         WHEN e->>'status' = 'active' THEN 'passed' ELSE 'failed' END,
    'detail','Channel endpoint lifecycle status must be active when present.'));

  -- 16 endpoint verified (skipped when not applicable)
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','endpoint_verified','category','endpoint','status',
    CASE WHEN e = 'null'::jsonb THEN
           CASE WHEN v_req = 'required' THEN 'failed' ELSE 'skipped' END
         WHEN coalesce(e->>'verification_status','') = 'verified' THEN 'passed' ELSE 'failed' END,
    'detail','Channel endpoint must be verified when present.'));

  -- 17 effective policy present and genuine
  v_ok := (pol <> 'null'::jsonb) AND coalesce(pol->>'data_origin','') <> 'reference_seed';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','policy_effective_present','category','policy','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','A genuine effective channel policy must resolve for this scope.'));

  -- 18 policy operational state permits technical testing
  v_ok := v_state IN ('test_only','pilot_ready');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','policy_state_allows_test','category','policy','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Effective policy must be in test_only or pilot_ready state.'));

  -- 19 live delivery remains disabled (fail-closed safety)
  v_ok := (pol <> 'null'::jsonb) AND coalesce((pol->>'live_delivery_enabled')::boolean, false) = false;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','policy_live_delivery_disabled','category','policy','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Live delivery must remain disabled for technical testing.'));

  -- 20 test target valid
  v_ok := coalesce((p_target->>'valid')::boolean, false);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','test_target_valid','category','test_input','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail', coalesce(p_target->>'code','target_missing')));

  -- 21 test payload valid
  v_ok := coalesce((p_payload->>'valid')::boolean, false);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','test_payload_valid','category','test_input','status',
    CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail', coalesce(p_payload->>'code','payload_missing')));

  RETURN v_checks;
END; $$;

-- ---------------------------------------------------------------------
-- Row projection
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_run_json(
  r public.omni_comms_channel_test_run,
  p_include_snapshot boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'organization_id', r.organization_id,
    'department_id', r.department_id,
    'channel', r.channel,
    'binding_id', r.binding_id,
    'test_kind', r.test_kind,
    'idempotency_key', r.idempotency_key,
    'request_fingerprint', r.request_fingerprint,
    'configuration_fingerprint', r.configuration_fingerprint,
    'target_type', r.target_type,
    'target_masked', r.target_masked,
    'target_hash', r.target_hash,
    'payload_summary', r.payload_summary,
    'payload_hash', r.payload_hash,
    'status', r.status,
    'result_code', r.result_code,
    'checks', r.checks,
    'blocker_codes', to_jsonb(r.blocker_codes),
    'correlation_id', r.correlation_id,
    'requested_by', r.requested_by,
    'requested_at', r.requested_at,
    'configuration_snapshot',
      CASE WHEN p_include_snapshot THEN r.configuration_snapshot ELSE 'null'::jsonb END
  );
$$;

-- ---------------------------------------------------------------------
-- Public RPC: run a configuration preflight (never sends)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_run_preflight(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_binding_id uuid,
  p_target text,
  p_payload jsonb,
  p_idempotency_key text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid;
  v_ch text := btrim(coalesce(p_channel,''));
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_snapshot jsonb;
  v_cfg_fp text;
  v_target jsonb;
  v_payload jsonb;
  v_checks jsonb;
  v_blockers text[];
  v_status text;
  v_req_fp text;
  v_existing public.omni_comms_channel_test_run%ROWTYPE;
  v_row public.omni_comms_channel_test_run%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_channel'; END IF;
  IF p_binding_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='binding_required'; END IF;
  IF v_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_idempotency_key'; END IF;

  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  IF p_department_id IS NOT NULL
     AND NOT public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id) THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='department_organization_mismatch'; END IF;

  v_snapshot := public.omni_comms_priv_channel_test_config_snapshot(
    p_organization_id, p_department_id, v_ch, p_binding_id);
  v_cfg_fp := public.omni_comms_priv_channel_test_sha256(v_snapshot::text);

  v_target  := public.omni_comms_priv_channel_test_normalize_target(v_ch, p_target);
  v_payload := public.omni_comms_priv_channel_test_normalize_payload(v_ch, p_payload);

  v_req_fp := public.omni_comms_priv_channel_test_sha256(
    jsonb_build_object(
      'organization_id', p_organization_id,
      'department_id', p_department_id,
      'channel', v_ch,
      'binding_id', p_binding_id,
      'configuration_fingerprint', v_cfg_fp,
      'target_type', coalesce(v_target->>'target_type', 'invalid'),
      'target_hash', coalesce(v_target->>'target_hash', v_target->>'code'),
      'payload_hash', coalesce(v_payload->>'payload_hash', v_payload->>'code')
    )::text);

  SELECT * INTO v_existing FROM public.omni_comms_channel_test_run
   WHERE organization_id = p_organization_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_req_fp THEN
      RAISE EXCEPTION 'OC409 conflict'
        USING ERRCODE='P0001', DETAIL='test_idempotency_payload_mismatch';
    END IF;
    RETURN jsonb_build_object('replayed', true,
      'run', public.omni_comms_priv_channel_test_run_json(v_existing, true));
  END IF;

  IF NOT coalesce((v_target->>'valid')::boolean, false) THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL = coalesce(v_target->>'code','target_invalid');
  END IF;
  IF NOT coalesce((v_payload->>'valid')::boolean, false) THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL = coalesce(v_payload->>'code','payload_invalid');
  END IF;

  v_checks := public.omni_comms_priv_channel_test_checklist(v_ch, v_snapshot, v_target, v_payload);

  SELECT coalesce(array_agg(c->>'code' ORDER BY c->>'code'), ARRAY[]::text[])
    INTO v_blockers
    FROM jsonb_array_elements(v_checks) c
   WHERE c->>'status' = 'failed';

  v_status := CASE WHEN array_length(v_blockers,1) IS NULL THEN 'passed' ELSE 'failed' END;

  INSERT INTO public.omni_comms_channel_test_run (
    organization_id, department_id, channel, binding_id, test_kind,
    idempotency_key, request_fingerprint, configuration_fingerprint,
    configuration_snapshot, target_type, target_masked, target_hash,
    payload_summary, payload_hash, status, result_code, checks, blocker_codes,
    correlation_id, requested_by)
  VALUES (
    p_organization_id, p_department_id, v_ch, p_binding_id, 'configuration_preflight',
    v_key, v_req_fp, v_cfg_fp,
    v_snapshot, v_target->>'target_type', v_target->>'target_masked', v_target->>'target_hash',
    v_payload->'payload_summary', v_payload->>'payload_hash',
    v_status,
    CASE WHEN v_status = 'passed' THEN 'preflight_passed' ELSE 'preflight_failed' END,
    v_checks, v_blockers,
    nullif(btrim(coalesce(p_correlation_id,'')), ''), v_uid)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('replayed', false,
    'run', public.omni_comms_priv_channel_test_run_json(v_row, true));
END; $$;

-- ---------------------------------------------------------------------
-- Public RPC: Test Centre summary (candidates, current result, history)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_centre_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_binding_id uuid DEFAULT NULL,
  p_history_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid;
  v_ch text := btrim(coalesce(p_channel,''));
  v_limit integer := least(greatest(coalesce(p_history_limit,20),1),100);
  v_can_configure boolean;
  v_candidates jsonb := '[]'::jsonb;
  v_binding uuid := p_binding_id;
  v_cfg_fp text := NULL;
  v_latest public.omni_comms_channel_test_run%ROWTYPE;
  v_latest_json jsonb := 'null'::jsonb;
  v_stale boolean := false;
  v_history jsonb := '[]'::jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_channel'; END IF;

  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  IF p_department_id IS NOT NULL
     AND NOT public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id) THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='department_organization_mismatch'; END IF;

  v_can_configure := public.has_permission(v_uid, 'omni_comms', 'configure');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'binding_id', b.id,
           'priority', b.priority,
           'status', b.status,
           'verification_status', b.verification_status,
           'department_id', b.department_id,
           'identity_code', i.code,
           'provider_account_code', a.code,
           'provider_id', a.provider_id,
           'endpoint_code', e.code
         ) ORDER BY b.priority NULLS LAST, b.created_at), '[]'::jsonb)
    INTO v_candidates
    FROM public.omni_comms_sender_provider_binding b
    LEFT JOIN public.omni_comms_sender_identity i  ON i.id = b.sender_identity_id
    LEFT JOIN public.omni_comms_provider_account a ON a.id = b.provider_account_id
    LEFT JOIN public.omni_comms_channel_endpoint e ON e.id = b.channel_endpoint_id
   WHERE b.organization_id = p_organization_id
     AND b.channel = v_ch
     AND coalesce(b.data_origin,'') <> 'reference_seed'
     AND (p_department_id IS NULL OR b.department_id IS NULL OR b.department_id = p_department_id);

  IF v_binding IS NULL THEN
    SELECT (v_candidates->0->>'binding_id')::uuid INTO v_binding;
  END IF;

  IF v_binding IS NOT NULL THEN
    v_cfg_fp := public.omni_comms_priv_channel_test_config_fingerprint(
      p_organization_id, p_department_id, v_ch, v_binding);

    SELECT * INTO v_latest FROM public.omni_comms_channel_test_run
     WHERE organization_id = p_organization_id
       AND channel = v_ch
       AND binding_id = v_binding
       AND department_id IS NOT DISTINCT FROM p_department_id
     ORDER BY requested_at DESC LIMIT 1;

    IF FOUND THEN
      v_latest_json := public.omni_comms_priv_channel_test_run_json(v_latest, v_can_configure);
      v_stale := (v_latest.configuration_fingerprint IS DISTINCT FROM v_cfg_fp);
    END IF;

    SELECT coalesce(jsonb_agg(public.omni_comms_priv_channel_test_run_json(r, false)
             ORDER BY r.requested_at DESC), '[]'::jsonb)
      INTO v_history
      FROM (
        SELECT * FROM public.omni_comms_channel_test_run
         WHERE organization_id = p_organization_id
           AND channel = v_ch
           AND binding_id = v_binding
         ORDER BY requested_at DESC
         LIMIT v_limit
      ) r;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', v_ch,
    'can_configure', v_can_configure,
    'selected_binding_id', v_binding,
    'candidate_bindings', v_candidates,
    'configuration_fingerprint', v_cfg_fp,
    'latest_run', v_latest_json,
    'latest_run_is_stale', v_stale,
    'history', v_history,
    'sends_message', false);
END; $$;

-- ---------------------------------------------------------------------
-- Grants: RPC-only surface
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_run_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_sha256(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_config_snapshot(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_config_fingerprint(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_normalize_target(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_normalize_payload(text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_checklist(text,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_run_json(public.omni_comms_channel_test_run, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.omni_comms_channel_test_run_preflight(uuid,uuid,text,uuid,text,jsonb,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_channel_test_centre_summary(uuid,uuid,text,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_run_preflight(uuid,uuid,text,uuid,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_centre_summary(uuid,uuid,text,uuid,integer) TO authenticated;

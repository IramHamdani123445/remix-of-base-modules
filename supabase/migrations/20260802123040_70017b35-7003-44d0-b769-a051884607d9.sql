-- =====================================================================
-- Omni-Comms C5A.1 — Test Centre product and evidence hardening
-- ZERO SEND: no provider contact, no request/message/dispatch/attempt writes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Direct evidence columns on the immutable ledger
--    Bounded FKs (NO ACTION) on the three configuration records: history
--    preservation blocks deleting a record that has preflight evidence.
--    policy_id intentionally carries no FK: effective policy rows are
--    replaceable configuration and must remain deletable.
-- ---------------------------------------------------------------------
ALTER TABLE public.omni_comms_channel_test_run
  ADD COLUMN IF NOT EXISTS provider_account_id uuid NULL,
  ADD COLUMN IF NOT EXISTS sender_identity_id  uuid NULL,
  ADD COLUMN IF NOT EXISTS channel_endpoint_id uuid NULL,
  ADD COLUMN IF NOT EXISTS policy_id           uuid NULL,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz NULL;

ALTER TABLE public.omni_comms_channel_test_run
  ADD CONSTRAINT omni_comms_ctr_provider_account_fk
    FOREIGN KEY (provider_account_id) REFERENCES public.omni_comms_provider_account(id),
  ADD CONSTRAINT omni_comms_ctr_identity_fk
    FOREIGN KEY (sender_identity_id) REFERENCES public.omni_comms_sender_identity(id),
  ADD CONSTRAINT omni_comms_ctr_endpoint_fk
    FOREIGN KEY (channel_endpoint_id) REFERENCES public.omni_comms_channel_endpoint(id);

COMMENT ON COLUMN public.omni_comms_channel_test_run.policy_id IS
  'Effective channel-policy row resolved at preflight time. No FK: policy rows are replaceable configuration; evidence must survive their removal.';

-- ---------------------------------------------------------------------
-- 2. Ordered 21-check contract validator (used as a CHECK constraint)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_checks_valid(p_checks jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT jsonb_typeof(p_checks) = 'array'
     AND jsonb_array_length(p_checks) = 21
     AND (
       SELECT coalesce(array_agg(c->>'code' ORDER BY ord), ARRAY[]::text[])
         FROM jsonb_array_elements(p_checks) WITH ORDINALITY AS t(c, ord)
     ) = ARRAY[
       'tenant_access','channel_supported','effective_policy_present','policy_test_state',
       'binding_selected','binding_active','binding_scope_valid','provider_account_active',
       'provider_credentials_complete','provider_credentials_verified','identity_active',
       'endpoint_requirement','endpoint_active','binding_verification','target_valid',
       'payload_valid','reference_configuration','live_delivery_disabled',
       'provider_dispatch','delivery_callback','technical_delivery_result']
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_checks) c
        WHERE coalesce(c->>'state','') NOT IN
              ('passed','failed','warning','not_applicable','not_implemented')
           OR coalesce(btrim(c->>'label'), '') = ''
           OR coalesce(btrim(c->>'detail'), '') = ''
     );
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_checks_valid(jsonb) FROM PUBLIC, anon, authenticated;

-- NOT VALID: pre-existing C5A rows are preserved untouched.
ALTER TABLE public.omni_comms_channel_test_run
  ADD CONSTRAINT omni_comms_ctr_check_contract_chk
  CHECK (public.omni_comms_priv_channel_test_checks_valid(checks)) NOT VALID;

-- ---------------------------------------------------------------------
-- 3. Hardened configuration snapshot (adds updated_at + safe reference
--    metadata; secret-reference names are hashed, never returned raw)
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
  s_eff public.omni_comms_channel_setting%ROWTYPE;
  v_policy jsonb := 'null'::jsonb;
  v_policy_source text := 'none';
  v_dept_found boolean := false;
  v_req_total integer := 0;
  v_req_met integer := 0;
  v_acct_ref_count integer := 0;
  v_acct_ref_digest text := public.omni_comms_priv_channel_test_sha256('');
  v_ep_ref_count integer := 0;
  v_ep_ref_digest text := public.omni_comms_priv_channel_test_sha256('');
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
    s_eff := s_dept;
    v_policy := public.omni_comms_priv_channel_policy_json(s_dept);
    v_policy_source := 'department_override';
  ELSIF s_org.id IS NOT NULL THEN
    s_eff := s_org;
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

    -- Safe canonical credential-reference metadata: a one-way digest over
    -- purpose + secret NAME + last-updated time. Never a credential value,
    -- and the names themselves are never returned.
    SELECT count(*),
           public.omni_comms_priv_channel_test_sha256(
             coalesce(string_agg(
               sr.purpose || '|' || coalesce(sr.secret_ref,'') || '|' ||
               coalesce(to_char(sr.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.USZ'),''),
               String_agg_sep ORDER BY sr.purpose, sr.id), ''))
      INTO v_acct_ref_count, v_acct_ref_digest
      FROM public.omni_comms_provider_account_secret_ref sr,
           LATERAL (SELECT E'\n' AS String_agg_sep) sep
     WHERE sr.provider_account_id = a.id;
  END IF;

  IF e.id IS NOT NULL THEN
    SELECT count(*),
           public.omni_comms_priv_channel_test_sha256(
             coalesce(string_agg(
               sr.purpose || '|' || coalesce(sr.secret_ref,'') || '|' ||
               coalesce(to_char(sr.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.USZ'),''),
               String_agg_sep ORDER BY sr.purpose, sr.id), ''))
      INTO v_ep_ref_count, v_ep_ref_digest
      FROM public.omni_comms_channel_endpoint_secret_ref sr,
           LATERAL (SELECT E'\n' AS String_agg_sep) sep
     WHERE sr.channel_endpoint_id = e.id;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'schema_version', 2,
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
      'department_id', b.department_id,
      'updated_at', b.updated_at
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
      'credential_reference_count', v_acct_ref_count,
      'credential_reference_digest', v_acct_ref_digest,
      'required_credential_count', v_req_total,
      'satisfied_credential_count', v_req_met,
      'updated_at', a.updated_at
    ) END,
    'identity', CASE WHEN i.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', i.id,
      'code', i.code,
      'status', i.status,
      'identity_type', i.identity_type,
      'identity_config', coalesce(i.identity_config, '{}'::jsonb),
      'data_origin', i.data_origin,
      'department_id', i.department_id,
      'updated_at', i.updated_at
    ) END,
    'endpoint', CASE WHEN e.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', e.id,
      'code', e.code,
      'status', e.status,
      'endpoint_type', e.endpoint_type,
      'endpoint_config', coalesce(e.endpoint_config, '{}'::jsonb),
      'verification_status', e.verification_status,
      'data_origin', e.data_origin,
      'secret_reference_count', v_ep_ref_count,
      'secret_reference_digest', v_ep_ref_digest,
      'department_id', e.department_id,
      'updated_at', e.updated_at
    ) END,
    'policy', v_policy,
    'policy_id', s_eff.id,
    'policy_updated_at', s_eff.updated_at,
    'policy_source', v_policy_source
  ));
END; $$;

-- ---------------------------------------------------------------------
-- 4. Delivery-aware ordered 21-check contract
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
  b jsonb   := coalesce(p_snapshot->'binding', 'null'::jsonb);
  a jsonb   := coalesce(p_snapshot->'provider_account', 'null'::jsonb);
  i jsonb   := coalesce(p_snapshot->'identity', 'null'::jsonb);
  e jsonb   := coalesce(p_snapshot->'endpoint', 'null'::jsonb);
  pol jsonb := coalesce(p_snapshot->'policy', 'null'::jsonb);
  v_req text := coalesce(p_snapshot->>'endpoint_requirement','forbidden');
  v_state text := coalesce(pol->>'operational_state','');
  v_dept uuid := nullif(p_snapshot->>'department_id','')::uuid;
  v_bdept uuid := nullif(b->>'department_id','')::uuid;
  v_checks jsonb := '[]'::jsonb;
  v_ok boolean;
BEGIN
  -- 1 tenant_access
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','tenant_access','label','Tenant access','state','passed',
    'detail','The caller holds Omni-Comms access to this organisation and scope.'));

  -- 2 channel_supported
  v_ok := p_channel IN ('email','sms','whatsapp','push','in_app','print');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','channel_supported','label','Channel supported',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','The channel supports a configuration preflight.'));

  -- 3 effective_policy_present
  v_ok := (pol <> 'null'::jsonb) AND coalesce(pol->>'data_origin','') <> 'reference_seed';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','effective_policy_present','label','Effective policy present',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','A genuine effective channel policy must resolve for this scope.'));

  -- 4 policy_test_state
  v_ok := v_state IN ('test_only','pilot_ready');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','policy_test_state','label','Policy permits testing',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Effective policy must be in test_only or pilot_ready state.'));

  -- 5 binding_selected
  v_ok := (b <> 'null'::jsonb);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_selected','label','Binding selected',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','A candidate binding must be selected.'));

  -- 6 binding_active
  v_ok := (b->>'status' = 'active');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_active','label','Binding active',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Binding lifecycle status must be active.'));

  -- 7 binding_scope_valid
  v_ok := (b <> 'null'::jsonb)
          AND (v_bdept IS NULL OR v_dept IS NOT DISTINCT FROM v_bdept);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_scope_valid','label','Binding scope valid',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Binding scope must match the organisation or the selected department.'));

  -- 8 provider_account_active
  v_ok := (a <> 'null'::jsonb) AND (a->>'status' = 'active');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_account_active','label','Provider account active',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','The bound provider account must exist and be active.'));

  -- 9 provider_credentials_complete
  v_ok := (a <> 'null'::jsonb)
          AND coalesce((a->>'satisfied_credential_count')::int, 0)
              >= coalesce((a->>'required_credential_count')::int, 0);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_credentials_complete','label','Credential references complete',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','All required credential references must be configured.'));

  -- 10 provider_credentials_verified
  v_ok := coalesce(a->>'verification_status','') = 'verified';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_credentials_verified','label','Credentials verified',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','The provider account must carry a provider-confirmed verified state.'));

  -- 11 identity_active
  v_ok := (i <> 'null'::jsonb) AND (i->>'status' = 'active')
          AND coalesce(i->>'identity_type','') <> ''
          AND coalesce(i->'identity_config','{}'::jsonb) <> '{}'::jsonb;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','identity_active','label','Channel identity active',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','The bound channel identity must be active and fully configured.'));

  -- 12 endpoint_requirement
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','endpoint_requirement','label','Endpoint requirement',
    'state', CASE
      WHEN v_req = 'required'  THEN CASE WHEN e <> 'null'::jsonb THEN 'passed' ELSE 'failed' END
      WHEN v_req = 'forbidden' THEN CASE WHEN e = 'null'::jsonb THEN 'not_applicable' ELSE 'failed' END
      ELSE CASE WHEN e = 'null'::jsonb THEN 'not_applicable' ELSE 'passed' END END,
    'detail','Endpoint presence must match the channel requirement (' || v_req || ').'));

  -- 13 endpoint_active
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','endpoint_active','label','Endpoint active and verified',
    'state', CASE
      WHEN e = 'null'::jsonb THEN CASE WHEN v_req = 'required' THEN 'failed' ELSE 'not_applicable' END
      WHEN e->>'status' = 'active' AND coalesce(e->>'verification_status','') = 'verified' THEN 'passed'
      WHEN e->>'status' = 'active' THEN 'warning'
      ELSE 'failed' END,
    'detail','A present channel endpoint must be active and verified.'));

  -- 14 binding_verification
  v_ok := coalesce(b->>'verification_status','') = 'verified';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','binding_verification','label','Binding verification',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Binding must carry a provider-confirmed verified state.'));

  -- 15 target_valid
  v_ok := coalesce((p_target->>'valid')::boolean, false);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','target_valid','label','Test target valid',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail', coalesce(p_target->>'code','target_missing')));

  -- 16 payload_valid
  v_ok := coalesce((p_payload->>'valid')::boolean, false);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','payload_valid','label','Test content valid',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail', coalesce(p_payload->>'code','payload_missing')));

  -- 17 reference_configuration
  v_ok := coalesce(b->>'data_origin','') <> 'reference_seed'
      AND coalesce(a->>'data_origin','') <> 'reference_seed'
      AND coalesce(i->>'data_origin','') <> 'reference_seed'
      AND coalesce(e->>'data_origin','') <> 'reference_seed';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','reference_configuration','label','No reference configuration',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Illustrative reference records are non-operational and cannot be tested.'));

  -- 18 live_delivery_disabled (fail-closed safety)
  v_ok := (pol <> 'null'::jsonb)
          AND coalesce((pol->>'live_delivery_enabled')::boolean, false) = false;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','live_delivery_disabled','label','Live delivery disabled',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail','Live delivery must remain disabled for technical testing.'));

  -- 19-21 delivery points: not implemented in C5A.1 (never a pass)
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object('code','provider_dispatch','label','Provider dispatch',
      'state','not_implemented',
      'detail','No provider is contacted. Controlled test delivery is not implemented in this release.'),
    jsonb_build_object('code','delivery_callback','label','Delivery callback',
      'state','not_implemented',
      'detail','No delivery callback is received. Callback handling is not implemented in this release.'),
    jsonb_build_object('code','technical_delivery_result','label','Technical delivery result',
      'state','not_implemented',
      'detail','No delivery result exists. A passed preflight confirms configuration only.'));

  RETURN v_checks;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_checklist(text,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Row projection with the new evidence columns
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
    'provider_account_id', r.provider_account_id,
    'sender_identity_id', r.sender_identity_id,
    'channel_endpoint_id', r.channel_endpoint_id,
    'policy_id', r.policy_id,
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
    'completed_at', r.completed_at,
    'configuration_snapshot',
      CASE WHEN p_include_snapshot THEN r.configuration_snapshot ELSE 'null'::jsonb END
  );
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_run_json(public.omni_comms_channel_test_run, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Preflight RPC: populate direct evidence links and completed_at
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
   WHERE c->>'state' = 'failed';

  v_status := CASE WHEN array_length(v_blockers,1) IS NULL THEN 'passed' ELSE 'failed' END;

  INSERT INTO public.omni_comms_channel_test_run (
    organization_id, department_id, channel, binding_id, test_kind,
    idempotency_key, request_fingerprint, configuration_fingerprint,
    configuration_snapshot, target_type, target_masked, target_hash,
    payload_summary, payload_hash, status, result_code, checks, blocker_codes,
    correlation_id, requested_by,
    provider_account_id, sender_identity_id, channel_endpoint_id, policy_id, completed_at)
  VALUES (
    p_organization_id, p_department_id, v_ch, p_binding_id, 'configuration_preflight',
    v_key, v_req_fp, v_cfg_fp,
    v_snapshot, v_target->>'target_type', v_target->>'target_masked', v_target->>'target_hash',
    v_payload->'payload_summary', v_payload->>'payload_hash',
    v_status,
    CASE WHEN v_status = 'passed' THEN 'preflight_passed' ELSE 'preflight_failed' END,
    v_checks, v_blockers,
    nullif(btrim(coalesce(p_correlation_id,'')), ''), v_uid,
    nullif(v_snapshot->'provider_account'->>'id','')::uuid,
    nullif(v_snapshot->'identity'->>'id','')::uuid,
    nullif(v_snapshot->'endpoint'->>'id','')::uuid,
    nullif(v_snapshot->>'policy_id','')::uuid,
    now())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('replayed', false,
    'run', public.omni_comms_priv_channel_test_run_json(v_row, true));
END; $$;

-- ---------------------------------------------------------------------
-- 7. Summary RPC: richer candidate labels
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
           'identity_display', coalesce(
             i.identity_config->>'email_address',
             i.identity_config->>'from_address',
             i.identity_config->>'sender_id',
             i.identity_config->>'phone_number',
             i.identity_config->>'display_name',
             i.from_address, i.display_name, i.code),
           'identity_status', i.status,
           'identity_data_origin', i.data_origin,
           'provider_account_code', a.code,
           'provider_account_status', a.status,
           'provider_account_verification_status', a.verification_status,
           'provider_environment', a.environment,
           'provider_id', a.provider_id,
           'endpoint_code', e.code,
           'endpoint_status', e.status,
           'endpoint_verification_status', e.verification_status,
           'data_origin', b.data_origin
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

REVOKE ALL ON FUNCTION public.omni_comms_channel_test_run_preflight(uuid,uuid,text,uuid,text,jsonb,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_channel_test_centre_summary(uuid,uuid,text,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_run_preflight(uuid,uuid,text,uuid,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_centre_summary(uuid,uuid,text,uuid,integer) TO authenticated;
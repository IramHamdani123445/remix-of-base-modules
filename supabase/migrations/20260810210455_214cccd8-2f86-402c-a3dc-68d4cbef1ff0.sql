CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_checklist(p_channel text, p_snapshot jsonb, p_target jsonb, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  v_cred text;
  v_cred_code text;
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
  --    Canonical sending-credential readiness, identical to Delivery Setup and
  --    the trusted binding configuration verifier: a provider-confirmed
  --    verified state OR a provider-authenticated sending-only credential
  --    (restricted_api_key). Missing, invalid or rejected credentials fail.
  v_cred := coalesce(a->>'verification_status','');
  v_cred_code := coalesce(a->>'verification_result_code','');
  v_ok := (a <> 'null'::jsonb)
          AND (v_cred = 'verified' OR v_cred_code = 'restricted_api_key');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'code','provider_credentials_verified','label','Credentials verified',
    'state', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'detail', CASE
      WHEN v_cred_code = 'restricted_api_key' AND v_cred <> 'verified'
        THEN 'Resend authenticated the credential with Sending-only access. Administrative provider APIs are restricted, but the credential is valid for sending.'
      WHEN v_ok THEN 'The provider confirmed the credential is valid for sending.'
      ELSE 'The provider account must carry a credential the provider accepted for sending.' END));

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
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_test_recipient_upsert(p_id uuid, p_expected_updated_at timestamp with time zone, p_organization_id uuid, p_channel text, p_label text, p_address text, p_purpose text, p_notes text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.omni_comms_test_recipient%ROWTYPE;
  v_after  public.omni_comms_test_recipient%ROWTYPE;
  v_purpose text := coalesce(nullif(btrim(p_purpose),''), 'internal_test');
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'OC401 authentication_required'; END IF;
  IF NOT public.has_permission(v_actor,'omni_comms','configure') THEN
    RAISE EXCEPTION 'OC403 permission_denied';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);
  IF p_address !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'OC422 invalid_input';
  END IF;

  -- Bounded purpose vocabulary, validated BEFORE any write so a raw CHECK
  -- violation (which would echo the failing row) can never reach the operator.
  IF v_purpose NOT IN ('controlled_pilot','internal_test','certification') THEN
    RAISE EXCEPTION 'OC422 invalid_test_recipient_purpose'
      USING ERRCODE='P0001', DETAIL='invalid_test_recipient_purpose';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_test_recipient(
      organization_id, channel, label, address, purpose, notes, created_by, updated_by)
    VALUES (p_organization_id, coalesce(p_channel,'email'), p_label, lower(p_address),
            v_purpose, p_notes, v_actor, v_actor)
    RETURNING * INTO v_after;
  ELSE
    SELECT * INTO v_before FROM public.omni_comms_test_recipient
     WHERE id = p_id AND organization_id = p_organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found'; END IF;
    IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'OC409 concurrent_update';
    END IF;
    UPDATE public.omni_comms_test_recipient
       SET label = p_label, address = lower(p_address),
           purpose = v_purpose, notes = p_notes,
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_after;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_actor, CASE WHEN p_id IS NULL THEN 'test_recipient_created' ELSE 'test_recipient_updated' END,
    'test_recipient', v_after.id, v_after.label,
    to_jsonb(v_before) - 'address', to_jsonb(v_after) - 'address', p_correlation_id);

  RETURN v_after.id;
END;
$function$;
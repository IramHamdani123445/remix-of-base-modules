-- DEF-14: adapter-capability aware email claim + database dispatch authority
-- recheck inside the claim transaction. Applied as a guarded in-place patch of
-- the existing function body so no unrelated governance logic can drift.
DO $do$
DECLARE src text; before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_dispatch_claim_email';
  IF src IS NULL THEN RAISE EXCEPTION 'claim_email_missing'; END IF;

  before := src;
  src := replace(src,
    '  v_deny       text;',
    '  v_deny       text;
  v_cap        public.omni_comms_channel_adapter_capability%ROWTYPE;
  v_authz      text;');
  IF src = before THEN RAISE EXCEPTION 'anchor_declare'; END IF;

  before := src;
  src := replace(src,
    '           r.caller_module_code, r.event_definition_id,',
    '           r.caller_module_code, r.event_definition_id, r.created_at AS request_created_at,');
  IF src = before THEN RAISE EXCEPTION 'anchor_scan_select'; END IF;

  before := src;
  src := replace(src,
    '        (j.status = ''held''       AND m.status IN (''held'',''queued''))',
    '        (j.status = ''held''       AND m.status IN (''held'',''queued''))
        OR
        (j.status = ''ready'' AND j.is_runnable = true AND m.status IN (''held'',''queued''))');
  IF src = before THEN RAISE EXCEPTION 'anchor_scan_status'; END IF;

  before := src;
  src := replace(src,
    '    -- (e2) Live delivery must never be enabled on the governing policy.',
    '    -- (e1b) DATABASE DISPATCH AUTHORITY. The database independently
    --       re-evaluates the certification contract from persisted facts.
    IF v_deny IS NULL THEN
      v_authz := public.omni_comms_priv_evaluate_dispatch_authorization(
        v_job.organization_id, v_job.msg_department_id, ''email'',
        v_job.caller_module_code, ''queued'', v_hash, NULL,
        v_job.request_created_at, p_deployed_revision);
      IF v_authz IS NOT NULL THEN v_deny := v_authz; END IF;
    END IF;

    -- (e2) Live delivery must never be enabled on the governing policy.');
  IF src = before THEN RAISE EXCEPTION 'anchor_authz'; END IF;

  before := src;
  src := replace(src,
    '        SELECT p.code INTO v_provider_code
          FROM public.omni_comms_provider p WHERE p.id = v_account.provider_id;',
    '        SELECT p.code INTO v_provider_code
          FROM public.omni_comms_provider p WHERE p.id = v_account.provider_id;
        SELECT * INTO v_cap
          FROM public.omni_comms_channel_adapter_capability
         WHERE adapter_code = coalesce(v_provider_code,'''');');
  IF src = before THEN RAISE EXCEPTION 'anchor_capability'; END IF;

  before := src;
  src := replace(src,
    '        ELSIF coalesce(v_provider_code,'''') <> ''resend_email'' THEN
          v_deny := ''provider_not_supported'';',
    '        ELSIF v_cap.adapter_code IS NULL OR coalesce(v_cap.channel,'''') <> ''email'' THEN
          v_deny := ''provider_not_supported'';
        ELSIF v_cap.enabled IS NOT TRUE THEN
          v_deny := ''provider_adapter_disabled'';
        ELSIF v_rel.release_state = ''controlled_pilot''
          AND v_cap.certification_safe IS NOT TRUE THEN
          v_deny := ''provider_not_certification_safe'';');
  IF src = before THEN RAISE EXCEPTION 'anchor_provider_supported'; END IF;

  before := src;
  src := replace(src,
    '        ELSIF v_binding.channel_endpoint_id IS NULL THEN
          v_deny := ''endpoint_missing'';',
    '        ELSIF v_cap.requires_verified_sender_domain AND v_binding.channel_endpoint_id IS NULL THEN
          v_deny := ''endpoint_missing'';');
  IF src = before THEN RAISE EXCEPTION 'anchor_endpoint_missing'; END IF;

  before := src;
  src := replace(src,
    '        ELSIF v_endpoint.id IS NULL
           OR v_endpoint.status <> ''active''',
    '        ELSIF v_cap.requires_verified_sender_domain AND (
              v_endpoint.id IS NULL
           OR v_endpoint.status <> ''active''');
  IF src = before THEN RAISE EXCEPTION 'anchor_endpoint_open'; END IF;

  before := src;
  src := replace(src,
    '           OR coalesce(v_endpoint.data_origin,'''') = ''reference_seed'' THEN
          v_deny := ''endpoint_not_verified'';
        ELSIF v_endpoint.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := ''endpoint_tenant_mismatch'';
        ELSIF v_endpoint.department_id IS NOT NULL
          AND v_endpoint.department_id IS DISTINCT FROM v_job.msg_department_id THEN
          v_deny := ''endpoint_department_mismatch'';
        ELSIF coalesce(v_secret,'''') !~ ''^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$'' THEN
          v_deny := ''secret_reference_invalid'';',
    '           OR coalesce(v_endpoint.data_origin,'''') = ''reference_seed'') THEN
          v_deny := ''endpoint_not_verified'';
        ELSIF v_cap.requires_verified_sender_domain
          AND v_endpoint.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := ''endpoint_tenant_mismatch'';
        ELSIF v_cap.requires_verified_sender_domain
          AND v_endpoint.department_id IS NOT NULL
          AND v_endpoint.department_id IS DISTINCT FROM v_job.msg_department_id THEN
          v_deny := ''endpoint_department_mismatch'';
        ELSIF v_cap.requires_external_credentials
          AND (v_cap.secret_ref_pattern IS NULL
               OR coalesce(v_secret,'''') !~ v_cap.secret_ref_pattern) THEN
          v_deny := ''secret_reference_invalid'';');
  IF src = before THEN RAISE EXCEPTION 'anchor_endpoint_close'; END IF;

  before := src;
  src := replace(src,
    '      ''attempt_id'', v_attempt_id,',
    '      ''attempt_id'', v_attempt_id,
      ''adapter_code'', v_cap.adapter_code,
      ''requires_external_credentials'', coalesce(v_cap.requires_external_credentials, true),');
  IF src = before THEN RAISE EXCEPTION 'anchor_claim_payload'; END IF;

  EXECUTE src;
END
$do$;
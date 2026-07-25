-- Fix 1: prepare_comm_hub_preview must store normalized recipients (string arrays)
-- so downstream consumers can read them deterministically.
CREATE OR REPLACE FUNCTION public.prepare_comm_hub_preview(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_module_code text := p_payload->>'module_code';
  v_event_code  text := p_payload->>'event_code';
  v_channel     text := COALESCE(p_payload->>'channel','email');
  v_send_ctx    text := COALESCE(p_payload->>'send_context','preview');
  v_to  jsonb := COALESCE(p_payload->'to_recipients','[]'::jsonb);
  v_cc  jsonb := COALESCE(p_payload->'cc_recipients','[]'::jsonb);
  v_bcc jsonb := COALESCE(p_payload->'bcc_recipients','[]'::jsonb);
  v_sender_id uuid := NULLIF(p_payload->>'sender_profile_id','')::uuid;
  v_sender RECORD;
  v_ctx_in jsonb := public.comm_hub_scrub_protected_keys(COALESCE(p_payload->'context_data','{}'::jsonb));
  v_map RECORD; v_tpl RECORD; v_ver RECORD; v_policy RECORD; v_scenario RECORD;
  v_scenario_found boolean := false;
  v_recipient_name text; v_recipient_name_confirmed boolean := false;
  v_request_no text;
  v_generated_at timestamptz := now();
  v_tokens jsonb;
  v_system_tokens jsonb; v_request_tokens jsonb; v_recipient_tokens jsonb := '{}'::jsonb;
  v_resolver jsonb;
  v_render jsonb;
  v_snapshot_id uuid;
  v_recipient_norm jsonb;
  v_recipient_hash text;
  v_recipient_count int;
  v_first_to text;
  v_correlation uuid := COALESCE(NULLIF(p_payload->>'correlation_id','')::uuid, gen_random_uuid());
  v_scan jsonb; v_raw_count int; v_malformed_count int; v_gate jsonb;
  v_resolver_unresolved jsonb; v_renderer_unresolved jsonb;
  v_resolver_total_unresolved int := 0;
  v_resolver_required_unresolved int := 0;
  v_entry jsonb; v_req_val jsonb;
  v_current_dep_hash text;
  v_certified_dep_hash text;
  v_cert RECORD;
  v_governance_evidence jsonb;
  v_content_hash text;
  v_norm_to jsonb; v_norm_cc jsonb; v_norm_bcc jsonb;
  v_dup_count int;
BEGIN
  IF v_module_code IS NULL OR v_event_code IS NULL THEN
    RAISE EXCEPTION 'module_code and event_code are required';
  END IF;

  v_gate := public.assert_comm_hub_runtime_transition('PREPARE_PREVIEW', jsonb_build_object(
    'module_code', v_module_code, 'event_code', v_event_code, 'channel', v_channel,
    'correlation_id', v_correlation, 'invoked_from', 'prepare_comm_hub_preview'
  ));
  IF (v_gate->>'allowed')::boolean = false THEN
    RAISE EXCEPTION 'runtime_transition_denied: %', v_gate->'denied_reasons';
  END IF;

  SELECT * INTO v_map FROM public.communication_hub_event_template_map
    WHERE module_code = v_module_code AND event_code = v_event_code AND active = true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no active template mapped for %/%', v_module_code, v_event_code; END IF;
  SELECT * INTO v_tpl FROM public.core_template WHERE id = v_map.template_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','TEMPLATE_MISSING')));
  END IF;
  SELECT * INTO v_ver FROM public.core_template_version WHERE id = v_tpl.active_version_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','TEMPLATE_VERSION_MISSING')));
  END IF;
  SELECT * INTO v_policy FROM public.communication_hub_recipient_policy LIMIT 1;

  IF v_sender_id IS NULL THEN v_sender_id := NULLIF(v_map.sender_profile_id::text,'')::uuid; END IF;
  IF v_sender_id IS NULL THEN
    SELECT id INTO v_sender_id FROM public.communication_hub_sender_profile
     WHERE is_enabled=true AND is_default=true AND (channel IS NULL OR channel = v_channel)
     ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF v_sender_id IS NULL THEN
    SELECT id INTO v_sender_id FROM public.communication_hub_sender_profile
     WHERE is_enabled=true AND (channel IS NULL OR channel = v_channel)
     ORDER BY is_default DESC NULLS LAST, updated_at DESC LIMIT 1;
  END IF;
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'sender_profile_missing: no active sender profile is configured for channel %', v_channel;
  END IF;
  SELECT * INTO v_sender FROM public.communication_hub_sender_profile WHERE id = v_sender_id;
  IF NOT FOUND OR COALESCE(v_sender.is_enabled,false)=false
     OR NULLIF(trim(COALESCE(v_sender.from_email,'')),'') IS NULL THEN
    RAISE EXCEPTION 'sender_profile_invalid: sender profile % is unusable', v_sender_id;
  END IF;

  v_recipient_norm := public.comm_hub_normalize_recipient_set(v_to, v_cc, v_bcc);
  IF v_recipient_norm IS NULL OR jsonb_typeof(v_recipient_norm) <> 'object' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','PREVIEW_RECIPIENT_HASH_RECOMPUTE_FAILED',
        'detail','normalizer_returned_non_object')));
  END IF;
  v_recipient_hash := v_recipient_norm->>'recipient_set_hash';
  IF v_recipient_hash IS NULL OR length(trim(v_recipient_hash)) = 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','PREVIEW_RECIPIENT_HASH_RECOMPUTE_FAILED',
        'detail','recipient_set_hash_missing')));
  END IF;
  v_norm_to  := COALESCE(v_recipient_norm->'to',  '[]'::jsonb);
  v_norm_cc  := COALESCE(v_recipient_norm->'cc',  '[]'::jsonb);
  v_norm_bcc := COALESCE(v_recipient_norm->'bcc', '[]'::jsonb);
  v_recipient_count :=
      COALESCE(jsonb_array_length(v_norm_to),0)
    + COALESCE(jsonb_array_length(v_norm_cc),0)
    + COALESCE(jsonb_array_length(v_norm_bcc),0);
  IF v_recipient_count = 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','PREVIEW_FROZEN_RECIPIENT_EVIDENCE_MISSING',
        'detail','recipient_count_zero')));
  END IF;
  SELECT COUNT(*) INTO v_dup_count FROM (
    SELECT x FROM jsonb_array_elements_text(v_norm_to) t(x)
    UNION ALL SELECT x FROM jsonb_array_elements_text(v_norm_cc) t(x)
    UNION ALL SELECT x FROM jsonb_array_elements_text(v_norm_bcc) t(x)
  ) all_addr GROUP BY x HAVING COUNT(*) > 1;
  IF v_dup_count IS NOT NULL AND v_dup_count > 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','PREVIEW_RECIPIENT_DUPLICATE_INVALID',
        'detail','address_present_in_multiple_buckets')));
  END IF;

  v_first_to := CASE WHEN jsonb_array_length(v_norm_to) > 0 THEN v_norm_to->>0 ELSE NULL END;

  IF v_policy.active_mode = 'SINGLE_CONFIGURED_RECIPIENT'
     AND v_policy.single_configured_display_name IS NOT NULL
     AND v_policy.single_configured_display_name_confirmed = true THEN
    v_recipient_name := v_policy.single_configured_display_name;
    v_recipient_name_confirmed := true;
  END IF;

  v_request_no := 'TEST-COMM-' || to_char(v_generated_at,'YYYYMMDD') || '-' ||
                  substr(replace(gen_random_uuid()::text,'-',''),1,8);

  v_system_tokens := jsonb_build_object(
    'module_code', v_module_code, 'event_code', v_event_code, 'channel', v_channel,
    'generated_at', to_char(v_generated_at,'YYYY-MM-DD HH24:MI:SS TZ'),
    'current_date', to_char(v_generated_at,'YYYY-MM-DD'),
    'correlation_id', v_correlation::text);
  v_request_tokens := jsonb_build_object(
    'request_no', v_request_no,
    'request_id', gen_random_uuid()::text,
    'requested_at', to_char(v_generated_at,'YYYY-MM-DD HH24:MI:SS TZ'));
  IF v_recipient_name IS NOT NULL THEN
    v_recipient_tokens := v_recipient_tokens || jsonb_build_object('display_name', v_recipient_name);
  END IF;
  IF v_first_to IS NOT NULL THEN
    v_recipient_tokens := v_recipient_tokens || jsonb_build_object('email', v_first_to);
  END IF;

  SELECT * INTO v_scenario FROM public.communication_hub_event_test_scenario
    WHERE module_code=v_module_code AND event_code=v_event_code
      AND channel=v_channel AND is_active=true
    ORDER BY (scenario_key='default') DESC, updated_at DESC LIMIT 1;
  v_scenario_found := FOUND;
  IF NOT v_scenario_found THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','GOVERNED_TEST_SCENARIO_MISSING',
        'detail', jsonb_build_object('module_code',v_module_code,'event_code',v_event_code,'channel',v_channel))));
  END IF;

  BEGIN
    v_resolver := public.resolve_comm_hub_template_variables(
      v_ver.id, v_module_code, v_event_code, v_channel, 'PREVIEW_TEST',
      v_scenario.id, COALESCE(v_scenario.tokens,'{}'::jsonb),
      v_recipient_tokens, v_request_tokens, v_system_tokens);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RESOLVER_EVIDENCE_INVALID',
        'detail','resolver_raised_exception','sqlstate',SQLSTATE)));
  END;
  IF v_resolver IS NULL OR jsonb_typeof(v_resolver) <> 'object'
     OR jsonb_typeof(COALESCE(v_resolver->'tokens','{}'::jsonb)) <> 'object'
     OR NULLIF(v_resolver->>'resolver_version','') IS NULL THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RESOLVER_EVIDENCE_INVALID',
        'detail','resolver_result_shape_invalid')));
  END IF;
  v_resolver_unresolved := COALESCE(v_resolver->'unresolved_variables', '[]'::jsonb);
  IF jsonb_typeof(v_resolver_unresolved) <> 'array' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RESOLVER_EVIDENCE_INVALID',
        'detail','unresolved_variables_not_array')));
  END IF;

  v_resolver_total_unresolved := jsonb_array_length(v_resolver_unresolved);
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_resolver_unresolved) LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN
      RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
        'blockers', jsonb_build_array(jsonb_build_object('code','RESOLVER_EVIDENCE_INVALID',
          'detail','unresolved_entry_not_object')));
    END IF;
    v_req_val := v_entry->'required';
    IF v_req_val IS NOT NULL THEN
      IF jsonb_typeof(v_req_val) <> 'boolean' THEN
        RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
          'blockers', jsonb_build_array(jsonb_build_object('code','RESOLVER_EVIDENCE_INVALID',
            'detail','required_flag_not_boolean')));
      END IF;
      IF (v_req_val)::text = 'true' THEN
        v_resolver_required_unresolved := v_resolver_required_unresolved + 1;
      END IF;
    END IF;
  END LOOP;
  IF v_resolver_required_unresolved > 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RESOLVER_REQUIRED_UNRESOLVED',
        'detail', jsonb_build_object('required_unresolved_count', v_resolver_required_unresolved))));
  END IF;

  v_tokens := (v_resolver->'tokens') || v_ctx_in || v_recipient_tokens || v_system_tokens || v_request_tokens;

  BEGIN
    v_render := public.render_comm_hub_template_version(v_ver.id, v_tokens, v_channel, 'PREVIEW_TEST');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RENDERER_EVIDENCE_INVALID',
        'detail','renderer_raised_exception','sqlstate',SQLSTATE)));
  END;
  IF v_render IS NULL OR jsonb_typeof(v_render) <> 'object' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RENDERER_EVIDENCE_INVALID',
        'detail','render_result_not_object')));
  END IF;
  v_content_hash := v_render->>'content_hash';
  IF v_content_hash IS NULL OR length(trim(v_content_hash)) = 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RENDERER_EVIDENCE_INVALID',
        'detail','content_hash_missing')));
  END IF;
  v_renderer_unresolved := COALESCE(v_render->'unresolved_variables', '[]'::jsonb);
  IF jsonb_typeof(v_renderer_unresolved) <> 'array' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RENDERER_EVIDENCE_INVALID',
        'detail','renderer_unresolved_not_array')));
  END IF;
  IF jsonb_array_length(v_renderer_unresolved) > 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RENDERER_UNRESOLVED_PRESENT',
        'detail', jsonb_build_object('count', jsonb_array_length(v_renderer_unresolved)))));
  END IF;

  v_scan := public.scan_comm_hub_raw_placeholders(
    v_render->>'rendered_subject', v_render->>'rendered_body_html', v_render->>'rendered_body_text');
  IF v_scan IS NULL OR jsonb_typeof(v_scan) <> 'object' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RAW_PLACEHOLDER_EVIDENCE_MISSING',
        'detail','scanner_returned_null_or_non_object')));
  END IF;
  IF NULLIF(v_scan->>'scanner_version','') IS DISTINCT FROM 'comm-hub-raw-placeholder-scanner/v2' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','SCANNER_VERSION_MISMATCH',
        'detail', jsonb_build_object('expected','comm-hub-raw-placeholder-scanner/v2',
                                     'actual', v_scan->>'scanner_version'))));
  END IF;
  IF v_scan->'total_occurrences' IS NULL OR jsonb_typeof(v_scan->'total_occurrences') <> 'number' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RAW_PLACEHOLDER_EVIDENCE_MISSING',
        'detail','total_occurrences_missing_or_not_number')));
  END IF;
  IF v_scan->'malformed_brace_count' IS NULL THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','MALFORMED_BRACE_EVIDENCE_MISSING')));
  END IF;
  IF jsonb_typeof(v_scan->'malformed_brace_count') <> 'number' THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','MALFORMED_BRACE_EVIDENCE_INVALID',
        'detail','malformed_brace_count_not_number')));
  END IF;
  v_raw_count       := (v_scan->>'total_occurrences')::int;
  v_malformed_count := (v_scan->>'malformed_brace_count')::int;
  IF v_raw_count < 0 OR v_malformed_count < 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','MALFORMED_BRACE_EVIDENCE_INVALID','detail','negative_count')));
  END IF;
  IF v_malformed_count > 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','MALFORMED_BRACES_PRESENT',
        'detail', jsonb_build_object('count', v_malformed_count))));
  END IF;
  IF v_raw_count > 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','RAW_PLACEHOLDER_RESIDUE',
        'detail', jsonb_build_object('count', v_raw_count))));
  END IF;

  SELECT dependency_hash INTO v_current_dep_hash
    FROM public.build_comm_hub_certification_dependency_hash(v_ver.id);
  IF v_current_dep_hash IS NULL OR length(trim(v_current_dep_hash)) = 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','PREVIEW_DEPENDENCY_HASH_UNAVAILABLE',
        'detail','current_dependency_hash_builder_returned_null',
        'template_version_id', v_ver.id::text)));
  END IF;

  SELECT * INTO v_cert FROM public.comm_hub_certification
   WHERE entity_type = 'TEMPLATE_VERSION' AND entity_id = v_ver.id
     AND certification_layer = 'TEMPLATE_STRUCTURE_CERTIFICATION'
     AND certification_kind = 'STANDARD' AND provenance_state = 'AUTHORITATIVE'
     AND result IN ('PASS','CERTIFIED') AND is_stale = false AND superseded_by IS NULL
   ORDER BY certified_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','TEMPLATE_STRUCTURE_CERTIFICATION_REQUIRED',
        'detail', jsonb_build_object('template_version_id', v_ver.id::text))));
  END IF;
  v_certified_dep_hash := v_cert.dependency_hash;
  IF v_certified_dep_hash IS NULL OR length(trim(v_certified_dep_hash)) = 0 THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','CERTIFIED_DEPENDENCY_HASH_MISSING',
        'detail', jsonb_build_object('certification_id', v_cert.id::text))));
  END IF;
  IF v_certified_dep_hash <> v_current_dep_hash THEN
    RETURN jsonb_build_object('status','BLOCKED','correlation_id',v_correlation,
      'blockers', jsonb_build_array(jsonb_build_object('code','PREVIEW_DEPENDENCY_HASH_DRIFT',
        'detail', jsonb_build_object('certified_dependency_hash', v_certified_dep_hash,
          'current_dependency_hash', v_current_dep_hash, 'certification_id', v_cert.id::text))));
  END IF;

  v_governance_evidence := jsonb_build_object(
    'evidence_version','comm-hub-preview-governance-evidence/v1',
    'template_certification', jsonb_build_object(
      'certification_id', v_cert.id::text,
      'certified_dependency_hash', v_certified_dep_hash,
      'current_dependency_hash', v_current_dep_hash, 'hash_match', true,
      'template_version_id', v_ver.id::text, 'template_id', v_tpl.id::text,
      'schema_version', 'comm-hub-template-dependency-manifest/v1'),
    'raw_placeholders',   jsonb_build_object('count', v_raw_count),
    'malformed_braces',   jsonb_build_object('count', v_malformed_count),
    'renderer',           jsonb_build_object('unresolved_count', jsonb_array_length(v_renderer_unresolved)),
    'resolver',           jsonb_build_object(
      'total_unresolved_count', v_resolver_total_unresolved,
      'required_unresolved_count', v_resolver_required_unresolved),
    'recipients',         jsonb_build_object(
      'recipient_set_hash', v_recipient_hash,
      'recipient_count', v_recipient_count, 'duplicates_valid', true),
    'scanner',            jsonb_build_object('version', v_scan->>'scanner_version'),
    'built_at',           to_char(v_generated_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  UPDATE public.communication_preview_snapshot
     SET status = 'SUPERSEDED'
   WHERE module_code = v_module_code AND event_code = v_event_code
     AND channel = v_channel AND status = 'PREPARED';

  INSERT INTO public.communication_preview_snapshot(
    id, module_code, event_code, channel, send_context,
    to_recipients, cc_recipients, bcc_recipients, recipient_set_hash,
    template_id, template_version_id, sender_profile_id,
    rendered_subject, rendered_body_html, rendered_body_text,
    subject_hash, body_hash, content_hash, context_hash,
    unresolved_variables, context_data, status, expires_at, created_at,
    resolver_version, resolved_token_bundle, variable_evidence,
    unresolved_variables_normalised, test_scenario_id, test_scenario_hash,
    request_context_values, correlation_id, renderer_unresolved_variables,
    raw_placeholders, raw_placeholder_count, placeholder_scanner_version,
    certified_dependency_hash, current_dependency_hash,
    governance_evidence, event_template_map_id, governance_certification_id
  ) VALUES (
    gen_random_uuid(), v_module_code, v_event_code, v_channel, v_send_ctx,
    -- FIX: store the NORMALIZED recipient arrays instead of raw input
    v_norm_to, v_norm_cc, v_norm_bcc, v_recipient_hash,
    v_tpl.id, v_ver.id, v_sender_id,
    v_render->>'rendered_subject', v_render->>'rendered_body_html', v_render->>'rendered_body_text',
    v_render->>'subject_hash', v_render->>'body_hash', v_content_hash,
    encode(extensions.digest(v_tokens::text,'sha256'),'hex'),
    v_resolver_unresolved,
    v_tokens || jsonb_build_object(
      'request_no', v_request_no,
      'recipient_name_confirmed', v_recipient_name_confirmed,
      'scenario_id',  v_scenario.id::text,
      'scenario_key', v_scenario.scenario_key,
      'template_purpose', v_render->>'template_purpose',
      'canonical_renderer_version', v_render->>'canonical_renderer_version'),
    'PREPARED', now() + interval '24 hours', now(),
    v_resolver->>'resolver_version',
    v_resolver->'tokens',
    v_resolver->'evidence',
    v_resolver_unresolved,
    (v_resolver->>'test_scenario_id')::uuid,
    v_resolver->>'test_scenario_hash',
    v_request_tokens, v_correlation, v_renderer_unresolved,
    v_scan->'placeholders', v_raw_count, v_scan->>'scanner_version',
    v_certified_dep_hash, v_current_dep_hash,
    v_governance_evidence, v_map.id, v_cert.id
  ) RETURNING id INTO v_snapshot_id;

  RETURN (SELECT to_jsonb(s.*) || jsonb_build_object(
            'status','PREPARED', 'correlation_id', v_correlation,
            'raw_placeholder_scan', v_scan,
            'governance_certification_id', v_cert.id)
          FROM public.communication_preview_snapshot s WHERE s.id = v_snapshot_id);
END; $function$;

-- Fix 2: create_comm_hub_controlled_stub_message must accept BOTH
-- canonical string-array recipients and legacy object recipients,
-- validate the extracted email against execution.recipient, and verify
-- the recipient set hash matches both snapshot and grant.
CREATE OR REPLACE FUNCTION public.create_comm_hub_controlled_stub_message(p_execution_id uuid, p_grant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_execution  public.communication_controlled_live_execution%ROWTYPE;
  v_grant      public.communication_controlled_live_grant%ROWTYPE;
  v_approval   public.communication_preview_approval%ROWTYPE;
  v_snapshot   public.communication_preview_snapshot%ROWTYPE;
  v_dry_run    public.communication_dry_run_certification%ROWTYPE;
  v_governance public.comm_hub_certification;
  v_governance_id uuid; v_dep_hash text;
  v_first jsonb; v_first_type text;
  v_to_email   text; v_to_name text;
  v_to_count   int; v_cc_count int; v_bcc_count int;
  v_sender     public.communication_hub_sender_profile%ROWTYPE;
  v_action     text := 'RUN_CONTROLLED_STUB';
  v_idem_key   text;
  v_request_id uuid; v_request_no text;
  v_recipient_id uuid; v_message_id uuid; v_existing_msg uuid;
  v_exec_recipient text;
  v_recomputed_hash text; v_norm jsonb;
BEGIN
  IF p_execution_id IS NULL OR p_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'input_invalid',
      'message', 'execution_id and grant_id are required');
  END IF;

  SELECT * INTO v_execution FROM public.communication_controlled_live_execution
   WHERE id = p_execution_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'execution_not_found');
  END IF;

  SELECT * INTO v_grant FROM public.communication_controlled_live_grant
   WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'grant_not_found'); END IF;
  IF v_grant.execution_id <> v_execution.id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'grant_execution_mismatch');
  END IF;
  IF v_grant.status NOT IN ('ISSUED','RESERVED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'grant_not_dispatchable',
      'grant_status', v_grant.status);
  END IF;
  IF v_grant.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'grant_expired');
  END IF;

  v_idem_key := 'controlled-stub:request:' || v_execution.id::text || ':' || v_action;

  SELECT id INTO v_request_id FROM public.communication_request WHERE idempotency_key = v_idem_key;
  IF FOUND THEN
    SELECT id INTO v_existing_msg FROM public.communication_message
     WHERE request_id = v_request_id AND targeted_dispatch_only = true
       AND controlled_live_execution_id = v_execution.id
       AND controlled_live_grant_id = v_grant.id
       AND controlled_action = v_action;
    IF v_existing_msg IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict_incomplete',
        'message', 'request exists but authoritative message does not match');
    END IF;
    SELECT id INTO v_recipient_id FROM public.communication_recipient
     WHERE request_id = v_request_id AND role='to' LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'action', v_action,
      'request_id', v_request_id, 'message_id', v_existing_msg,
      'recipient_id', v_recipient_id,
      'execution_id', v_execution.id, 'grant_id', v_grant.id);
  END IF;

  SELECT * INTO v_approval FROM public.communication_preview_approval
   WHERE id = v_execution.preview_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'preview_approval_missing'); END IF;
  IF v_approval.status NOT IN ('ACTIVE','RESERVED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'preview_approval_not_usable',
      'approval_status', v_approval.status);
  END IF;
  IF v_approval.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'preview_approval_expired');
  END IF;
  IF v_grant.preview_approval_id <> v_approval.id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'grant_preview_mismatch');
  END IF;

  SELECT * INTO v_snapshot FROM public.communication_preview_snapshot WHERE id = v_approval.snapshot_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'preview_snapshot_missing'); END IF;
  IF v_snapshot.status <> 'PREPARED' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'preview_snapshot_not_prepared',
      'snapshot_status', v_snapshot.status);
  END IF;
  IF v_snapshot.expires_at IS NOT NULL AND v_snapshot.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'preview_snapshot_expired');
  END IF;
  IF v_snapshot.content_hash IS DISTINCT FROM v_approval.content_hash_at_approval THEN
    RETURN jsonb_build_object('ok', false, 'code', 'preview_content_hash_mismatch');
  END IF;

  SELECT * INTO v_dry_run FROM public.communication_dry_run_certification
   WHERE id = v_execution.dry_run_certification_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'dry_run_certification_missing'); END IF;
  IF v_dry_run.status <> 'ACTIVE' OR v_dry_run.result <> 'DRY_RUN_PASSED' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'dry_run_certification_not_valid',
      'status', v_dry_run.status, 'result', v_dry_run.result);
  END IF;
  IF v_dry_run.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'dry_run_certification_expired');
  END IF;
  IF v_dry_run.preview_approval_id IS DISTINCT FROM v_approval.id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'dry_run_approval_mismatch');
  END IF;

  IF v_snapshot.template_version_id IS NOT NULL THEN
    SELECT * INTO v_governance FROM public.comm_hub_certification
     WHERE entity_type = 'TEMPLATE_VERSION' AND entity_id = v_snapshot.template_version_id
       AND result = 'PASSED' AND is_stale = false
     ORDER BY certified_at DESC LIMIT 1;
    IF FOUND THEN v_governance_id := v_governance.id; v_dep_hash := v_governance.dependency_hash; END IF;
  END IF;

  -- Recipient extraction (accept canonical string array + legacy object entries)
  v_to_count := COALESCE(jsonb_array_length(v_snapshot.to_recipients), 0);
  v_cc_count := COALESCE(jsonb_array_length(v_snapshot.cc_recipients), 0);
  v_bcc_count := COALESCE(jsonb_array_length(v_snapshot.bcc_recipients), 0);
  IF v_to_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'recipient_count_invalid', 'to_count', v_to_count);
  END IF;
  IF v_cc_count > 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'cc_not_allowed'); END IF;
  IF v_bcc_count > 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'bcc_not_allowed'); END IF;

  v_first := v_snapshot.to_recipients->0;
  v_first_type := jsonb_typeof(v_first);
  IF v_first_type = 'string' THEN
    v_to_email := lower(btrim(v_snapshot.to_recipients->>0));
    v_to_name  := NULL;
  ELSIF v_first_type = 'object' THEN
    v_to_email := lower(btrim(COALESCE(v_first->>'email','')));
    v_to_name  := v_first->>'name';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'recipient_shape_invalid',
      'message', 'to_recipients[0] must be a string or object', 'jsonb_type', v_first_type);
  END IF;
  IF v_to_email IS NULL OR v_to_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'recipient_email_missing');
  END IF;

  -- Validate email against the execution's frozen recipient
  v_exec_recipient := lower(btrim(COALESCE(v_execution.recipient,'')));
  IF v_exec_recipient <> '' AND v_exec_recipient <> v_to_email THEN
    RETURN jsonb_build_object('ok', false, 'code', 'recipient_execution_mismatch',
      'detail', jsonb_build_object('snapshot_email', v_to_email, 'execution_recipient', v_exec_recipient));
  END IF;

  -- Recompute hash from the extracted set and verify against snapshot + grant
  v_norm := public.comm_hub_normalize_recipient_set(
    jsonb_build_array(v_to_email), '[]'::jsonb, '[]'::jsonb);
  v_recomputed_hash := v_norm->>'recipient_set_hash';
  IF v_recomputed_hash IS DISTINCT FROM v_snapshot.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code', 'recipient_hash_snapshot_mismatch',
      'detail', jsonb_build_object('recomputed', v_recomputed_hash, 'snapshot', v_snapshot.recipient_set_hash));
  END IF;
  IF v_recomputed_hash IS DISTINCT FROM v_grant.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code', 'recipient_hash_grant_mismatch',
      'detail', jsonb_build_object('recomputed', v_recomputed_hash, 'grant', v_grant.recipient_set_hash));
  END IF;

  IF v_snapshot.template_version_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'template_version_missing');
  END IF;
  IF v_snapshot.sender_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'sender_profile_missing');
  END IF;
  IF v_snapshot.rendered_subject IS NULL OR btrim(v_snapshot.rendered_subject) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rendered_subject_missing');
  END IF;
  IF (v_snapshot.rendered_body_html IS NULL OR btrim(v_snapshot.rendered_body_html) = '')
     AND (v_snapshot.rendered_body_text IS NULL OR btrim(v_snapshot.rendered_body_text) = '') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rendered_body_missing');
  END IF;
  IF v_snapshot.subject_hash IS NULL OR v_snapshot.body_hash IS NULL
     OR v_snapshot.content_hash IS NULL OR v_snapshot.recipient_set_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'snapshot_hashes_missing');
  END IF;

  SELECT * INTO v_sender FROM public.communication_hub_sender_profile WHERE id = v_snapshot.sender_profile_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'sender_profile_not_found'); END IF;

  PERFORM set_config('comm_hub.allow_targeted_update', 'true', true);

  v_request_no := 'CS-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS')
                        || '-' || upper(substr(md5(random()::text),1,6));

  BEGIN
    INSERT INTO public.communication_request(
      request_no, module_code, department_code, event_code,
      channels, priority, status, payload, context, idempotency_key, requested_by,
      original_decision_id, decision_send_context,
      configuration_version, recipient_policy_version,
      targeted_dispatch_only, controlled_action,
      controlled_live_execution_id, controlled_live_grant_id
    ) VALUES (
      v_request_no, v_execution.module_code, NULL, v_execution.event_code,
      ARRAY['email'], 'high', 'approved',
      COALESCE(v_snapshot.context_data, '{}'::jsonb),
      jsonb_build_object(
        'correlation_id', v_execution.id::text, 'origin', 'comm_hub',
        'send_context', 'controlled_live',
        'source', 'create_comm_hub_controlled_stub_message'),
      v_idem_key, v_execution.requested_by,
      v_execution.original_decision_id, 'controlled_live',
      v_execution.configuration_version, v_execution.recipient_policy_version::integer,
      true, v_action, v_execution.id, v_grant.id
    ) RETURNING id INTO v_request_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_request_id FROM public.communication_request WHERE idempotency_key = v_idem_key;
    SELECT id INTO v_message_id FROM public.communication_message
     WHERE request_id = v_request_id AND targeted_dispatch_only = true;
    SELECT id INTO v_recipient_id FROM public.communication_recipient WHERE request_id = v_request_id AND role='to' LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'action', v_action,
      'request_id', v_request_id, 'message_id', v_message_id,
      'recipient_id', v_recipient_id,
      'execution_id', v_execution.id, 'grant_id', v_grant.id);
  END;

  INSERT INTO public.communication_recipient(request_id, role, recipient_type, name, email)
  VALUES (v_request_id, 'to', 'email', v_to_name, v_to_email)
  RETURNING id INTO v_recipient_id;

  INSERT INTO public.communication_message(
    request_id, recipient_id, channel, template_version_id,
    subject, body_text, body_html, status,
    origin, sender_profile_id, from_email, from_display_name, reply_to_email,
    original_decision_id, send_context, test_mode,
    targeted_dispatch_only, controlled_action,
    controlled_live_execution_id, controlled_live_grant_id,
    preview_snapshot_id, preview_approval_id, dry_run_certification_id,
    governance_certification_id, certified_dependency_hash,
    recipient_set_hash, subject_hash, body_hash, content_hash
  ) VALUES (
    v_request_id, v_recipient_id, 'email', v_snapshot.template_version_id,
    v_snapshot.rendered_subject, v_snapshot.rendered_body_text, v_snapshot.rendered_body_html,
    'queued', 'comm_hub', v_snapshot.sender_profile_id,
    COALESCE(v_sender.from_email, v_sender.reply_to_email),
    v_sender.from_display_name, v_sender.reply_to_email,
    v_execution.original_decision_id, 'controlled_live', false,
    true, v_action, v_execution.id, v_grant.id,
    v_snapshot.id, v_approval.id, v_dry_run.id,
    v_governance_id, v_dep_hash,
    v_snapshot.recipient_set_hash, v_snapshot.subject_hash,
    v_snapshot.body_hash, v_snapshot.content_hash
  ) RETURNING id INTO v_message_id;

  UPDATE public.communication_controlled_live_execution
     SET request_id = v_request_id, message_id = v_message_id, updated_at = now()
   WHERE id = v_execution.id AND (request_id IS NULL OR request_id = v_request_id);

  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', false, 'action', v_action,
    'request_id', v_request_id, 'request_no', v_request_no,
    'message_id', v_message_id, 'recipient_id', v_recipient_id,
    'execution_id', v_execution.id, 'grant_id', v_grant.id,
    'preview_snapshot_id', v_snapshot.id,
    'preview_approval_id', v_approval.id,
    'dry_run_certification_id', v_dry_run.id,
    'governance_certification_id', v_governance_id,
    'certified_dependency_hash', v_dep_hash,
    'recipient_set_hash', v_snapshot.recipient_set_hash,
    'subject_hash', v_snapshot.subject_hash,
    'body_hash', v_snapshot.body_hash,
    'content_hash', v_snapshot.content_hash,
    'template_version_id', v_snapshot.template_version_id,
    'sender_profile_id', v_snapshot.sender_profile_id);
END; $function$;

-- Fix 3: reconcile the leaked ISSUED grant from the failed attempt.
UPDATE public.communication_controlled_live_grant
   SET status='REVOKED', revoked_at=now(), updated_at=now(),
       revocation_reason='reconciliation:pre_provider_recipient_email_missing'
 WHERE id='4947ee39-d89e-4827-8dc5-9d44cf627419'
   AND status IN ('ISSUED','RESERVED');

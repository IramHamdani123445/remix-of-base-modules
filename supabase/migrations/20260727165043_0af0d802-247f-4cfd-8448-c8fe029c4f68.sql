
-- ============================================================
-- A4.1.3 — Atomic canonical controlled-revalidation preparation
-- ============================================================

-- 1. Broaden state check to include COMPLETE and RECOVERY_REQUIRED
ALTER TABLE public.communication_hub_revalidation_execution
  DROP CONSTRAINT IF EXISTS communication_hub_revalidation_execution_state_chk;
ALTER TABLE public.communication_hub_revalidation_execution
  ADD CONSTRAINT communication_hub_revalidation_execution_state_chk
  CHECK (state = ANY (ARRAY[
    'PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','PROVIDER_ACCEPTED',
    'PROVIDER_REJECTED','FAILED_PRE_PROVIDER','RECONCILING','CONFIRMED','VOIDED',
    'COMPLETE','RECOVERY_REQUIRED'
  ]));

-- 2. Atomic canonical preparation RPC
CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_prepare_delivery(
  p_cycle_id uuid,
  p_authorisation_id uuid,
  p_operator_id uuid,
  p_runtime_build text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_role text := current_setting('request.jwt.claim.role', true);
  v_cycle       public.communication_hub_revalidation_cycle%ROWTYPE;
  v_auth        public.communication_hub_revalidation_send_authorisation%ROWTYPE;
  v_ctx         jsonb;
  v_prep_ver    integer;
  v_existing    public.communication_hub_revalidation_execution%ROWTYPE;
  v_new_exec_id uuid;
  v_request_id  uuid;
  v_recipient_id uuid;
  v_message_id  uuid;
  v_trace_id    uuid;
  v_step_id     uuid;
  v_attempt_id  uuid;
  v_provider_id uuid;
  v_template_version_id uuid;
  v_template_manifest_hash text;
  v_sender_profile_id uuid;
  v_from_email  text;
  v_from_name   text;
  v_recipient_email text;
  v_recipient_norm text;
  v_recipient_set_hash text;
  v_recipient_policy_version text;
  v_module_code text;
  v_event_code  text;
  v_channel     text;
  v_key         text;
  v_render      jsonb;
  v_subject     text;
  v_body_html   text;
  v_body_text   text;
  v_subject_hash text;
  v_body_hash    text;
  v_content_hash text;
  v_request_no   text;
  v_trace_no     text;
  v_now          timestamptz := now();
  v_err_state    text;
  v_err_msg      text;
  v_err_detail   text;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501',
      HINT = 'Internal atomic preparation. Call via the Edge Function service-role client.';
  END IF;
  IF p_cycle_id IS NULL OR p_authorisation_id IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PREPARE_ARGS' USING ERRCODE = '22023';
  END IF;

  -- A. Lock the cycle row (FOR UPDATE — no drift while we prepare).
  SELECT * INTO v_cycle
    FROM public.communication_hub_revalidation_cycle
   WHERE id = p_cycle_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'reused', false, 'state', NULL,
      'blockers', jsonb_build_array(jsonb_build_object('code','cycle_not_found','stage','cycle')),
      'provider_call_attempted', false);
  END IF;

  -- B. Lock the authorisation row (FOR UPDATE).
  SELECT * INTO v_auth
    FROM public.communication_hub_revalidation_send_authorisation
   WHERE id = p_authorisation_id AND cycle_id = p_cycle_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'reused', false, 'state', NULL,
      'blockers', jsonb_build_array(jsonb_build_object('code','authorisation_not_found','stage','authorisation')),
      'provider_call_attempted', false);
  END IF;

  -- C. Legacy sweep — mark any PREPARING/READY_FOR_PROVIDER rows without
  --    complete canonical evidence linkage as RECOVERY_REQUIRED. These
  --    can only be cleared through the dedicated admin recovery path.
  UPDATE public.communication_hub_revalidation_execution
     SET state = 'RECOVERY_REQUIRED',
         failure_code = 'legacy_pre_atomic_incomplete_linkage',
         failure_detail = COALESCE(failure_detail,'{}'::jsonb)
                          || jsonb_build_object(
                               'swept_at', v_now,
                               'reason', 'inserted before A4.1.3 atomic runtime; missing linked request/message/attempt'),
         updated_at = v_now
   WHERE cycle_id = p_cycle_id
     AND state IN ('PREPARING','READY_FOR_PROVIDER')
     AND (request_id IS NULL OR message_id IS NULL OR delivery_attempt_id IS NULL);

  -- D. Any prior provider-boundary use forbids new preparation.
  IF EXISTS (
    SELECT 1 FROM public.communication_hub_revalidation_execution
     WHERE cycle_id = p_cycle_id AND provider_call_attempted = true
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'reused', false, 'state', NULL,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','cycle_provider_boundary_already_used','stage','execution')),
      'provider_call_attempted', false);
  END IF;

  -- E. RECOVERY_REQUIRED blocks new prepares — go through admin path.
  IF EXISTS (
    SELECT 1 FROM public.communication_hub_revalidation_execution
     WHERE cycle_id = p_cycle_id AND state = 'RECOVERY_REQUIRED'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'reused', false, 'state', 'RECOVERY_REQUIRED',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','recovery_required','stage','execution',
        'message','Execution requires admin recovery before a new preparation may start.')),
      'provider_call_attempted', false);
  END IF;

  -- F. Re-run fresh authority via canonical resolver (must be OK).
  SELECT public.resolve_comm_hub_revalidation_preparation_context(
    p_cycle_id, p_authorisation_id) INTO v_ctx;
  IF NOT COALESCE((v_ctx->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'ok', false, 'reused', false, 'state', NULL,
      'blockers', COALESCE(v_ctx->'blockers','[]'::jsonb),
      'warnings', COALESCE(v_ctx->'warnings','[]'::jsonb),
      'provider_call_attempted', false);
  END IF;

  v_module_code             := v_ctx->>'module_code';
  v_event_code              := v_ctx->>'event_code';
  v_channel                 := COALESCE(v_ctx->>'channel','email');
  v_template_version_id     := NULLIF(v_ctx#>>'{template,version_id}','')::uuid;
  v_template_manifest_hash  := v_ctx#>>'{template,manifest_hash}';
  v_sender_profile_id       := NULLIF(v_ctx#>>'{sender,profile_id}','')::uuid;
  v_from_email              := v_ctx#>>'{sender,from_email}';
  v_from_name               := v_ctx#>>'{sender,display_name}';
  v_provider_id             := NULLIF(v_ctx#>>'{provider_configuration,provider_id}','')::uuid;
  v_recipient_email         := COALESCE(v_ctx#>>'{recipient,email}', v_auth.recipient_email);
  v_recipient_policy_version:= v_ctx#>>'{recipient,policy_version}';
  v_recipient_set_hash      := COALESCE(
                                 v_ctx#>>'{recipient,recipient_set_hash}',
                                 v_cycle.recipient_set_hash,
                                 md5(lower(trim(v_recipient_email))));

  IF v_recipient_email IS NULL OR position('@' IN v_recipient_email) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reused', false,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','recipient_email_invalid','stage','recipient')),
      'provider_call_attempted', false);
  END IF;
  v_recipient_norm := lower(trim(v_recipient_email));

  -- G. Idempotency reuse: active preparation for this cycle+authorisation
  --    that is fully linked → return reused.
  SELECT * INTO v_existing
    FROM public.communication_hub_revalidation_execution
   WHERE cycle_id = p_cycle_id
     AND authorisation_id = p_authorisation_id
     AND state IN ('PREPARING','READY_FOR_PROVIDER')
     AND request_id IS NOT NULL
     AND message_id IS NOT NULL
     AND delivery_attempt_id IS NOT NULL
   ORDER BY preparation_version DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'reused', true,
      'state', v_existing.state,
      'execution_id', v_existing.id,
      'request_id', v_existing.request_id,
      'message_id', v_existing.message_id,
      'recipient_id', NULL,
      'trace_id', v_existing.trace_id,
      'delivery_attempt_id', v_existing.delivery_attempt_id,
      'preparation_version', v_existing.preparation_version,
      'canonical_idempotency_key', v_existing.idempotency_key,
      'provider_call_attempted', false,
      'blockers','[]'::jsonb,'warnings','[]'::jsonb);
  END IF;

  -- H. Compute next preparation_version (max of prior + 1).
  SELECT COALESCE(MAX(preparation_version), 0) + 1 INTO v_prep_ver
    FROM public.communication_hub_revalidation_execution
   WHERE cycle_id = p_cycle_id;

  v_key := 'crev-prep:' || p_cycle_id::text || ':' ||
           p_authorisation_id::text || ':' || v_prep_ver::text;

  -- I. Insert PREPARING execution row (durable anchor for evidence).
  INSERT INTO public.communication_hub_revalidation_execution (
    cycle_id, authorisation_id, operator_id, idempotency_key,
    preparation_version, state, provider_boundary_state,
    provider_call_attempted,
    event_certification_id, production_lineage_id,
    baseline_ore_certification_id, baseline_fingerprint_v2, current_fingerprint_v2,
    template_version_id, template_manifest_hash, sender_profile_id,
    recipient_policy_version, recipient_set_hash, provider_id,
    runtime_build, metadata
  ) VALUES (
    p_cycle_id, p_authorisation_id, p_operator_id, v_key,
    v_prep_ver, 'PREPARING', 'NOT_ENTERED', false,
    NULLIF(v_ctx->>'baseline_event_certification_id','')::uuid,
    NULLIF(v_ctx->>'production_lineage_id','')::uuid,
    NULLIF(v_ctx->>'baseline_ore_certification_id','')::uuid,
    v_ctx->>'baseline_fingerprint_v2',
    v_ctx->>'current_fingerprint_v2',
    v_template_version_id, v_template_manifest_hash, v_sender_profile_id,
    v_recipient_policy_version, v_recipient_set_hash, v_provider_id,
    COALESCE(p_runtime_build,'atomic-a4.1.3'),
    jsonb_build_object(
      'module_code', v_module_code,
      'event_code',  v_event_code,
      'channel',     v_channel,
      'canonical_idempotency_key', v_key,
      'runtime_contract', 'atomic-preparation/1')
  )
  RETURNING id INTO v_new_exec_id;

  -- J. Guarded sub-transaction — canonical evidence creation.
  BEGIN
    v_request_no := 'CREV-' || upper(substr(p_cycle_id::text, 1, 8))
                    || '-' || upper(substr(v_new_exec_id::text, 1, 6))
                    || '-V' || v_prep_ver::text;

    INSERT INTO public.communication_request (
      request_no, module_code, event_code, channels,
      priority, status, payload, context,
      idempotency_key, requested_by, approved_by, approved_at,
      decision_send_context, targeted_dispatch_only,
      recipient_policy_version
    ) VALUES (
      v_request_no, v_module_code, v_event_code, ARRAY[v_channel]::text[],
      'normal', 'pending',
      jsonb_build_object(
        'cycle_id', p_cycle_id,
        'authorisation_id', p_authorisation_id,
        'purpose', 'CONTROLLED_REVALIDATION_PREPARATION',
        'preparation_version', v_prep_ver),
      jsonb_build_object(
        'send_context', 'CONTROLLED_REVALIDATION',
        'execution_id', v_new_exec_id,
        'baseline_ore_certification_id', v_ctx->>'baseline_ore_certification_id',
        'production_lineage_id', v_ctx->>'production_lineage_id',
        'baseline_fingerprint_v2', v_ctx->>'baseline_fingerprint_v2',
        'current_fingerprint_v2', v_ctx->>'current_fingerprint_v2',
        'recipient_normalized', v_recipient_norm,
        'recipient_set_hash', v_recipient_set_hash,
        'template_version_id', v_template_version_id,
        'template_manifest_hash', v_template_manifest_hash,
        'sender_profile_id', v_sender_profile_id,
        'provider_id', v_provider_id,
        'provider_boundary_state', 'NOT_ENTERED',
        'provider_call_attempted', false),
      v_key, p_operator_id, p_operator_id, v_now,
      'controlled_revalidation', true,
      NULLIF(regexp_replace(COALESCE(v_recipient_policy_version,''), '\D', '', 'g'), '')::integer
    ) RETURNING id INTO v_request_id;

    -- Canonical recipient row (role=to, normalized email).
    INSERT INTO public.communication_recipient (
      request_id, role, recipient_type, name, email, channel_hint
    ) VALUES (
      v_request_id, 'to', 'email', NULL, v_recipient_norm, v_channel
    ) RETURNING id INTO v_recipient_id;

    -- Canonical template render (no React renderer).
    v_render := NULL;
    IF v_template_version_id IS NOT NULL THEN
      BEGIN
        v_render := public.render_comm_hub_template_version(
          v_template_version_id,
          jsonb_build_object(
            'module_code', v_module_code,
            'event_code', v_event_code,
            'channel', v_channel,
            'cycle_id', p_cycle_id,
            'authorisation_id', p_authorisation_id,
            'preparation_version', v_prep_ver,
            'current_fingerprint_v2', v_ctx->>'current_fingerprint_v2',
            'production_lineage_id', v_ctx->>'production_lineage_id'),
          v_channel,
          'CONTROLLED_LIVE_TEST'
        );
      EXCEPTION WHEN OTHERS THEN
        v_render := NULL;
      END;
    END IF;

    v_subject   := COALESCE(v_render->>'subject',
                            '[Controlled revalidation — PREPARED] '
                            || v_module_code || ' / ' || v_event_code);
    v_body_html := COALESCE(v_render->>'body_html', v_render->>'html',
                            '<p>Canonical revalidation preparation. No provider call.</p>');
    v_body_text := COALESCE(v_render->>'body_text', v_render->>'text',
                            'Canonical revalidation preparation. No provider call.');
    v_subject_hash := encode(digest(v_subject, 'sha256'), 'hex');
    v_body_hash    := encode(digest(COALESCE(v_body_text,''), 'sha256'), 'hex');
    v_content_hash := encode(digest(v_subject_hash || v_body_hash, 'sha256'), 'hex');

    INSERT INTO public.communication_message (
      request_id, recipient_id, channel, provider_id,
      template_version_id, subject, body_text, body_html,
      rendered_at, status, send_context,
      sender_profile_id, from_email, from_display_name,
      targeted_dispatch_only, controlled_action,
      recipient_set_hash, subject_hash, body_hash, content_hash,
      certified_dependency_hash
    ) VALUES (
      v_request_id, v_recipient_id, v_channel, v_provider_id,
      v_template_version_id, v_subject, v_body_text, v_body_html,
      v_now, 'queued', 'controlled_revalidation',
      v_sender_profile_id, v_from_email, v_from_name,
      true, 'CONTROLLED_REVALIDATION',
      v_recipient_set_hash, v_subject_hash, v_body_hash, v_content_hash,
      v_template_manifest_hash
    ) RETURNING id INTO v_message_id;

    -- Canonical hub trace + first step (no execution-ID fallback).
    v_trace_no := 'CHT-' || to_char(v_now, 'YYYYMMDDHH24MISS')
                  || '-' || upper(substr(v_new_exec_id::text, 1, 6));
    INSERT INTO public.communication_hub_trace (
      trace_no, correlation_id, module_code, event_code, channel,
      entity_type, entity_id, source_module, source_screen, source_action,
      initiated_by, recipient_email_masked, recipient_domain,
      status, current_stage, request_id, request_no, message_id, metadata
    ) VALUES (
      v_trace_no, p_cycle_id::text, v_module_code, v_event_code, v_channel,
      'revalidation_execution', v_new_exec_id::text,
      'communication_hub', 'controlled_revalidation', 'PREPARE',
      p_operator_id,
      regexp_replace(v_recipient_norm, '(^.).*(@.*$)', '\1***\2'),
      split_part(v_recipient_norm, '@', 2),
      'in_progress', 'PREPARATION_COMPLETE',
      v_request_id, v_request_no, v_message_id,
      jsonb_build_object(
        'preparation_version', v_prep_ver,
        'execution_id', v_new_exec_id,
        'canonical_idempotency_key', v_key,
        'provider_call_attempted', false)
    ) RETURNING id INTO v_trace_id;

    INSERT INTO public.communication_hub_trace_step (
      trace_id, stage_code, stage_name, status,
      request_id, message_id, plain_summary, payload
    ) VALUES (
      v_trace_id, 'PREPARATION_COMPLETE', 'Canonical preparation complete', 'passed',
      v_request_id, v_message_id,
      'Atomic preparation created request, recipient, message, trace, and attempt. No provider call.',
      jsonb_build_object(
        'execution_id', v_new_exec_id,
        'preparation_version', v_prep_ver,
        'recipient_set_hash', v_recipient_set_hash,
        'subject_hash', v_subject_hash,
        'body_hash', v_body_hash,
        'content_hash', v_content_hash)
    ) RETURNING id INTO v_step_id;

    -- Canonical delivery attempt (attempt_no=0 preparation-only).
    INSERT INTO public.communication_delivery_attempt (
      message_id, attempt_no, status, provider_id,
      provider_call_attempted, send_context, attempt_type,
      recipient_set_hash, subject_hash, body_hash
    ) VALUES (
      v_message_id, 0, 'pending', v_provider_id,
      false, 'controlled_revalidation', 'controlled_revalidation_preparation',
      v_recipient_set_hash, v_subject_hash, v_body_hash
    ) RETURNING id INTO v_attempt_id;

    -- Transition PREPARING → READY_FOR_PROVIDER bound to real IDs.
    UPDATE public.communication_hub_revalidation_execution
       SET request_id          = v_request_id,
           message_id          = v_message_id,
           trace_id            = v_trace_id,
           delivery_attempt_id = v_attempt_id,
           state               = 'READY_FOR_PROVIDER',
           metadata            = COALESCE(metadata,'{}'::jsonb)
                                 || jsonb_build_object(
                                      'ready_at', v_now,
                                      'recipient_id', v_recipient_id,
                                      'subject_hash', v_subject_hash,
                                      'body_hash', v_body_hash,
                                      'content_hash', v_content_hash,
                                      'trace_no', v_trace_no,
                                      'request_no', v_request_no),
           updated_at          = v_now
     WHERE id = v_new_exec_id;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE,
                            v_err_msg   = MESSAGE_TEXT,
                            v_err_detail= PG_EXCEPTION_DETAIL;
    -- Sub-transaction rolled back; dependent rows do not exist.
    UPDATE public.communication_hub_revalidation_execution
       SET state         = 'FAILED_PRE_PROVIDER',
           failure_code  = 'atomic_preparation_evidence_failed',
           failure_detail= jsonb_build_object(
                             'sqlstate', v_err_state,
                             'message',  v_err_msg,
                             'detail',   v_err_detail,
                             'failed_at', v_now),
           updated_at    = v_now
     WHERE id = v_new_exec_id;
    RETURN jsonb_build_object(
      'ok', false, 'reused', false,
      'state', 'FAILED_PRE_PROVIDER',
      'execution_id', v_new_exec_id,
      'preparation_version', v_prep_ver,
      'canonical_idempotency_key', v_key,
      'provider_call_attempted', false,
      'failure_code', 'atomic_preparation_evidence_failed',
      'failure_detail', jsonb_build_object(
                          'sqlstate', v_err_state,
                          'message',  v_err_msg,
                          'detail',   v_err_detail),
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','atomic_preparation_evidence_failed','stage','pre_provider_evidence',
        'message', v_err_msg)),
      'warnings','[]'::jsonb);
  END;

  RETURN jsonb_build_object(
    'ok', true, 'reused', false,
    'state', 'READY_FOR_PROVIDER',
    'execution_id', v_new_exec_id,
    'request_id',   v_request_id,
    'message_id',   v_message_id,
    'recipient_id', v_recipient_id,
    'trace_id',     v_trace_id,
    'delivery_attempt_id', v_attempt_id,
    'preparation_version', v_prep_ver,
    'canonical_idempotency_key', v_key,
    'recipient_set_hash', v_recipient_set_hash,
    'subject_hash', v_subject_hash,
    'body_hash',    v_body_hash,
    'content_hash', v_content_hash,
    'provider_call_attempted', false,
    'blockers','[]'::jsonb,'warnings','[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public._comm_hub_revalidation_prepare_delivery(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_delivery(uuid,uuid,uuid,text) TO service_role;

-- 3. Admin recovery RPC — no-send path for RECOVERY_REQUIRED rows.
CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_recover_execution(
  p_execution_id uuid,
  p_admin_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $rec$
DECLARE
  v_uid uuid := COALESCE(p_admin_id, auth.uid());
  v_row public.communication_hub_revalidation_execution%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 6 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023',
      HINT = 'Provide a recovery reason (min 6 characters).';
  END IF;

  SELECT * INTO v_row
    FROM public.communication_hub_revalidation_execution
    WHERE id = p_execution_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.state <> 'RECOVERY_REQUIRED' THEN
    RAISE EXCEPTION 'execution_not_in_recovery_required'
      USING ERRCODE = '55000', DETAIL = 'current_state=' || v_row.state;
  END IF;
  IF v_row.provider_call_attempted THEN
    RAISE EXCEPTION 'provider_boundary_already_used' USING ERRCODE = '55000';
  END IF;

  UPDATE public.communication_hub_revalidation_execution
     SET state = 'VOIDED',
         failure_detail = COALESCE(failure_detail,'{}'::jsonb)
                          || jsonb_build_object(
                               'recovered_at', now(),
                               'recovered_by', v_uid,
                               'reason', p_reason),
         updated_at = now()
   WHERE id = p_execution_id;

  RETURN jsonb_build_object(
    'ok', true, 'execution_id', p_execution_id, 'new_state', 'VOIDED');
END;
$rec$;

REVOKE ALL ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid,uuid,text) TO service_role;

COMMENT ON FUNCTION public._comm_hub_revalidation_prepare_delivery(uuid,uuid,uuid,text) IS
'A4.1.3 atomic canonical controlled-revalidation preparation. One transaction. Guarded sub-transaction for evidence. Rollback on any failure → FAILED_PRE_PROVIDER, no orphans. Never contacts a provider.';
COMMENT ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid,uuid,text) IS
'A4.1.3 dedicated no-send admin recovery path for RECOVERY_REQUIRED rows. Transitions RECOVERY_REQUIRED → VOIDED with reason. Normal PREPARE never clears these.';

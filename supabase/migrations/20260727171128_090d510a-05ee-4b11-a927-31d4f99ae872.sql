
-- =========================================================================
-- A4.1.3A — Canonical atomic controlled-revalidation preparation
-- =========================================================================

-- 1. Add revalidation_execution_id binding columns (nullable; targeted branch
--    enforces non-null via completeness check).
ALTER TABLE public.communication_request
  ADD COLUMN IF NOT EXISTS revalidation_execution_id uuid
    REFERENCES public.communication_hub_revalidation_execution(id);

ALTER TABLE public.communication_message
  ADD COLUMN IF NOT EXISTS revalidation_execution_id uuid
    REFERENCES public.communication_hub_revalidation_execution(id);

CREATE INDEX IF NOT EXISTS ix_comm_request_revalidation_execution
  ON public.communication_request(revalidation_execution_id)
  WHERE revalidation_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_comm_message_revalidation_execution
  ON public.communication_message(revalidation_execution_id)
  WHERE revalidation_execution_id IS NOT NULL;

-- 2. Refresh targeted-classification constraints on communication_request.
ALTER TABLE public.communication_request
  DROP CONSTRAINT IF EXISTS communication_request_targeted_action_chk;
ALTER TABLE public.communication_request
  ADD CONSTRAINT communication_request_targeted_action_chk
  CHECK (controlled_action IS NULL
      OR controlled_action = ANY (ARRAY[
           'RUN_CONTROLLED_STUB',
           'SEND_ONE_REAL_EMAIL',
           'CONTROLLED_REVALIDATION_PREPARE']));

ALTER TABLE public.communication_request
  DROP CONSTRAINT IF EXISTS communication_request_targeted_completeness_chk;
ALTER TABLE public.communication_request
  ADD CONSTRAINT communication_request_targeted_completeness_chk
  CHECK (
    (NOT targeted_dispatch_only)
    OR (
      -- Existing controlled-live branch (preserved verbatim).
      controlled_action IN ('RUN_CONTROLLED_STUB','SEND_ONE_REAL_EMAIL')
      AND controlled_live_execution_id IS NOT NULL
      AND controlled_live_grant_id IS NOT NULL
    )
    OR (
      -- New controlled-revalidation preparation branch.
      controlled_action = 'CONTROLLED_REVALIDATION_PREPARE'
      AND revalidation_execution_id IS NOT NULL
      AND controlled_live_execution_id IS NULL
      AND controlled_live_grant_id IS NULL
      AND decision_send_context = 'controlled_revalidation'
    )
  );

-- 3. Refresh targeted-classification constraints on communication_message.
ALTER TABLE public.communication_message
  DROP CONSTRAINT IF EXISTS comm_msg_targeted_action_chk;
ALTER TABLE public.communication_message
  ADD CONSTRAINT comm_msg_targeted_action_chk
  CHECK (controlled_action IS NULL
      OR controlled_action = ANY (ARRAY[
           'RUN_CONTROLLED_STUB',
           'SEND_ONE_REAL_EMAIL',
           'CONTROLLED_REVALIDATION_PREPARE']));

ALTER TABLE public.communication_message
  DROP CONSTRAINT IF EXISTS comm_msg_targeted_completeness_chk;
ALTER TABLE public.communication_message
  ADD CONSTRAINT comm_msg_targeted_completeness_chk
  CHECK (
    (NOT targeted_dispatch_only)
    OR (
      -- Preserved controlled-live branch.
      controlled_action IN ('RUN_CONTROLLED_STUB','SEND_ONE_REAL_EMAIL')
      AND controlled_live_execution_id IS NOT NULL
      AND controlled_live_grant_id IS NOT NULL
      AND preview_snapshot_id IS NOT NULL
      AND preview_approval_id IS NOT NULL
      AND dry_run_certification_id IS NOT NULL
      AND send_context = 'controlled_live'
      AND origin = 'comm_hub'
      AND channel = 'email'
      AND template_version_id IS NOT NULL
      AND sender_profile_id IS NOT NULL
      AND recipient_set_hash IS NOT NULL
      AND subject_hash IS NOT NULL
      AND body_hash IS NOT NULL
      AND content_hash IS NOT NULL
    )
    OR (
      -- New controlled-revalidation preparation branch.
      controlled_action = 'CONTROLLED_REVALIDATION_PREPARE'
      AND revalidation_execution_id IS NOT NULL
      AND controlled_live_execution_id IS NULL
      AND controlled_live_grant_id IS NULL
      AND send_context = 'controlled_revalidation'
      AND origin = 'comm_hub'
      AND channel = 'email'
      AND template_version_id IS NOT NULL
      AND sender_profile_id IS NOT NULL
      AND provider_id IS NOT NULL
      AND recipient_set_hash IS NOT NULL
      AND subject_hash IS NOT NULL
      AND body_hash IS NOT NULL
      AND content_hash IS NOT NULL
    )
  );

-- 4. Extend the targeted-immutability trigger to also protect
--    revalidation_execution_id on prepared messages.
CREATE OR REPLACE FUNCTION public.communication_message_targeted_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_allowed text := current_setting('comm_hub.allow_targeted_update', true);
BEGIN
  IF v_allowed IS DISTINCT FROM 'true' THEN
    IF NEW.targeted_dispatch_only IS DISTINCT FROM OLD.targeted_dispatch_only
       OR NEW.controlled_action IS DISTINCT FROM OLD.controlled_action
       OR NEW.controlled_live_execution_id IS DISTINCT FROM OLD.controlled_live_execution_id
       OR NEW.controlled_live_grant_id IS DISTINCT FROM OLD.controlled_live_grant_id
       OR NEW.preview_snapshot_id IS DISTINCT FROM OLD.preview_snapshot_id
       OR NEW.preview_approval_id IS DISTINCT FROM OLD.preview_approval_id
       OR NEW.dry_run_certification_id IS DISTINCT FROM OLD.dry_run_certification_id
       OR NEW.governance_certification_id IS DISTINCT FROM OLD.governance_certification_id
       OR NEW.certified_dependency_hash IS DISTINCT FROM OLD.certified_dependency_hash
       OR NEW.recipient_set_hash IS DISTINCT FROM OLD.recipient_set_hash
       OR NEW.subject_hash IS DISTINCT FROM OLD.subject_hash
       OR NEW.body_hash IS DISTINCT FROM OLD.body_hash
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.revalidation_execution_id IS DISTINCT FROM OLD.revalidation_execution_id THEN
      RAISE EXCEPTION 'targeted classification is immutable (message %)', OLD.id
        USING ERRCODE = '42501';
    END IF;
    IF OLD.targeted_dispatch_only THEN
      IF NEW.send_context IS DISTINCT FROM OLD.send_context
         OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
         OR NEW.sender_profile_id IS DISTINCT FROM OLD.sender_profile_id
         OR NEW.from_email IS DISTINCT FROM OLD.from_email
         OR NEW.from_display_name IS DISTINCT FROM OLD.from_display_name
         OR NEW.reply_to_email IS DISTINCT FROM OLD.reply_to_email
         OR NEW.origin IS DISTINCT FROM OLD.origin
         OR NEW.channel IS DISTINCT FROM OLD.channel
         OR NEW.request_id IS DISTINCT FROM OLD.request_id
         OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id THEN
        RAISE EXCEPTION 'frozen evidence fields are immutable on targeted messages (message %)', OLD.id
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5. Rewrite the atomic canonical preparation RPC.
CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_prepare_delivery(
  p_cycle_id uuid,
  p_authorisation_id uuid,
  p_operator_id uuid,
  p_runtime_build text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','extensions'
AS $function$
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
  v_render_subject_hash text;
  v_render_body_hash    text;
  v_render_content_hash text;
  v_render_blockers jsonb;
  v_render_unresolved int;
  v_render_template_version_id uuid;
  v_request_no   text;
  v_trace_no     text;
  v_now          timestamptz := now();
  v_err_state    text;
  v_err_msg      text;
  v_err_detail   text;
  v_blockers     jsonb;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501',
      HINT = 'Internal atomic preparation. Call via the Edge Function service-role client.';
  END IF;
  IF p_cycle_id IS NULL OR p_authorisation_id IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PREPARE_ARGS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cycle
    FROM public.communication_hub_revalidation_cycle
   WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reused',false,'state',NULL,
      'blockers', jsonb_build_array(jsonb_build_object('code','cycle_not_found','stage','cycle')),
      'provider_call_attempted', false);
  END IF;

  SELECT * INTO v_auth
    FROM public.communication_hub_revalidation_send_authorisation
   WHERE id = p_authorisation_id AND cycle_id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reused',false,'state',NULL,
      'blockers', jsonb_build_array(jsonb_build_object('code','authorisation_not_found','stage','authorisation')),
      'provider_call_attempted', false);
  END IF;

  -- Strict legacy sweep — any prior PREPARING/READY_FOR_PROVIDER row missing
  -- complete canonical linkage (including revalidation_execution_id on the
  -- linked request/message) becomes RECOVERY_REQUIRED and cannot be reused.
  UPDATE public.communication_hub_revalidation_execution e
     SET state = 'RECOVERY_REQUIRED',
         failure_code = COALESCE(failure_code,'legacy_incomplete_canonical_linkage'),
         failure_detail = COALESCE(failure_detail,'{}'::jsonb)
                          || jsonb_build_object('swept_at', v_now,
                                                'reason','A4.1.3A strict linkage sweep'),
         updated_at = v_now
   WHERE e.cycle_id = p_cycle_id
     AND e.state IN ('PREPARING','READY_FOR_PROVIDER')
     AND (
       e.request_id IS NULL OR e.message_id IS NULL OR e.delivery_attempt_id IS NULL
       OR e.trace_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.communication_request r
                       WHERE r.id = e.request_id
                         AND r.revalidation_execution_id = e.id
                         AND r.targeted_dispatch_only = true
                         AND r.controlled_action = 'CONTROLLED_REVALIDATION_PREPARE')
       OR NOT EXISTS (SELECT 1 FROM public.communication_message m
                       WHERE m.id = e.message_id
                         AND m.revalidation_execution_id = e.id
                         AND m.targeted_dispatch_only = true
                         AND m.controlled_action = 'CONTROLLED_REVALIDATION_PREPARE'
                         AND m.provider_id IS NOT NULL
                         AND m.template_version_id IS NOT NULL
                         AND m.sender_profile_id IS NOT NULL
                         AND m.recipient_set_hash IS NOT NULL
                         AND m.subject_hash IS NOT NULL
                         AND m.body_hash IS NOT NULL
                         AND m.content_hash IS NOT NULL
                         AND COALESCE(m.subject,'') NOT ILIKE '%PREPARED%'
                         AND COALESCE(m.body_text,'') NOT ILIKE '%Canonical revalidation preparation. No provider call.%')
       OR NOT EXISTS (SELECT 1 FROM public.communication_recipient rc
                       WHERE rc.id IN (SELECT recipient_id FROM public.communication_message
                                        WHERE id = e.message_id)
                         AND rc.request_id = e.request_id
                         AND rc.role = 'to')
       OR NOT EXISTS (SELECT 1 FROM public.communication_hub_trace t
                       WHERE t.id = e.trace_id
                         AND t.request_id = e.request_id
                         AND t.message_id = e.message_id)
       OR NOT EXISTS (SELECT 1 FROM public.communication_delivery_attempt a
                       WHERE a.id = e.delivery_attempt_id
                         AND a.message_id = e.message_id
                         AND a.provider_call_attempted = false)
     );

  IF EXISTS (SELECT 1 FROM public.communication_hub_revalidation_execution
              WHERE cycle_id = p_cycle_id AND provider_call_attempted = true) THEN
    RETURN jsonb_build_object('ok',false,'reused',false,'state',NULL,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','cycle_provider_boundary_already_used','stage','execution')),
      'provider_call_attempted', false);
  END IF;

  IF EXISTS (SELECT 1 FROM public.communication_hub_revalidation_execution
              WHERE cycle_id = p_cycle_id AND state = 'RECOVERY_REQUIRED') THEN
    RETURN jsonb_build_object('ok',false,'reused',false,'state','RECOVERY_REQUIRED',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','recovery_required','stage','execution',
        'message','Execution requires admin recovery before a new preparation may start.')),
      'provider_call_attempted', false);
  END IF;

  -- Fresh authority.
  SELECT public.resolve_comm_hub_revalidation_preparation_context(
    p_cycle_id, p_authorisation_id) INTO v_ctx;
  IF NOT COALESCE((v_ctx->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok',false,'reused',false,'state',NULL,
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
  v_recipient_set_hash      := v_ctx#>>'{recipient,recipient_set_hash}';

  -- Fail-closed authority requirements — no MD5/email fallbacks.
  v_blockers := '[]'::jsonb;
  IF v_recipient_policy_version IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','recipient_policy_version_missing','stage','recipient'); END IF;
  IF v_recipient_set_hash IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','recipient_set_hash_missing','stage','recipient'); END IF;
  IF v_template_version_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','template_version_id_missing','stage','template'); END IF;
  IF v_template_manifest_hash IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','template_manifest_hash_missing','stage','template'); END IF;
  IF v_sender_profile_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','sender_profile_id_missing','stage','sender'); END IF;
  IF v_from_email IS NULL OR position('@' IN COALESCE(v_from_email,'')) = 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','from_email_missing','stage','sender'); END IF;
  IF v_provider_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','provider_id_missing','stage','provider'); END IF;
  IF v_recipient_email IS NULL OR position('@' IN v_recipient_email) = 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','recipient_email_invalid','stage','recipient'); END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok',false,'reused',false,'state',NULL,
      'blockers', v_blockers, 'provider_call_attempted', false);
  END IF;

  v_recipient_norm := lower(trim(v_recipient_email));

  -- Reuse: fully-linked active preparation for same cycle+authorisation.
  SELECT * INTO v_existing
    FROM public.communication_hub_revalidation_execution
   WHERE cycle_id = p_cycle_id
     AND authorisation_id = p_authorisation_id
     AND state IN ('PREPARING','READY_FOR_PROVIDER')
     AND request_id IS NOT NULL AND message_id IS NOT NULL
     AND delivery_attempt_id IS NOT NULL AND trace_id IS NOT NULL
   ORDER BY preparation_version DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    SELECT recipient_id INTO v_recipient_id
      FROM public.communication_message WHERE id = v_existing.message_id;
    RETURN jsonb_build_object(
      'ok', true, 'reused', true, 'state', v_existing.state,
      'execution_id', v_existing.id,
      'request_id', v_existing.request_id,
      'message_id', v_existing.message_id,
      'recipient_id', v_recipient_id,
      'trace_id', v_existing.trace_id,
      'delivery_attempt_id', v_existing.delivery_attempt_id,
      'preparation_version', v_existing.preparation_version,
      'canonical_idempotency_key', v_existing.idempotency_key,
      'provider_call_attempted', false,
      'blockers','[]'::jsonb,'warnings','[]'::jsonb);
  END IF;

  SELECT COALESCE(MAX(preparation_version), 0) + 1 INTO v_prep_ver
    FROM public.communication_hub_revalidation_execution
   WHERE cycle_id = p_cycle_id;

  v_key := 'crev-prep:' || p_cycle_id::text || ':' ||
           p_authorisation_id::text || ':' || v_prep_ver::text;

  INSERT INTO public.communication_hub_revalidation_execution (
    cycle_id, authorisation_id, operator_id, idempotency_key,
    preparation_version, state, provider_boundary_state, provider_call_attempted,
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
    COALESCE(p_runtime_build,'atomic-a4.1.3a'),
    jsonb_build_object(
      'module_code', v_module_code, 'event_code', v_event_code,
      'channel', v_channel, 'canonical_idempotency_key', v_key,
      'runtime_contract', 'atomic-preparation/2-a413a'))
  RETURNING id INTO v_new_exec_id;

  BEGIN
    -- Canonical render — mandatory success, no fallbacks.
    v_render := public.render_comm_hub_template_version(
      v_template_version_id,
      jsonb_build_object(
        'module_code', v_module_code, 'event_code', v_event_code,
        'channel', v_channel, 'cycle_id', p_cycle_id,
        'authorisation_id', p_authorisation_id,
        'preparation_version', v_prep_ver,
        'current_fingerprint_v2', v_ctx->>'current_fingerprint_v2',
        'production_lineage_id', v_ctx->>'production_lineage_id',
        'recipient_email', v_recipient_norm),
      v_channel, 'CONTROLLED_LIVE_TEST');

    v_render_blockers := COALESCE(v_render->'blockers','[]'::jsonb);
    v_render_unresolved := COALESCE((v_render->>'unresolved_count')::int, 0);
    v_render_template_version_id := NULLIF(v_render->>'template_version_id','')::uuid;
    v_subject   := v_render->>'rendered_subject';
    v_body_html := v_render->>'rendered_body_html';
    v_body_text := v_render->>'rendered_body_text';
    v_render_subject_hash := v_render->>'subject_hash';
    v_render_body_hash    := v_render->>'body_hash';
    v_render_content_hash := v_render->>'content_hash';

    IF jsonb_array_length(v_render_blockers) > 0 THEN
      RAISE EXCEPTION 'renderer_blockers: %', v_render_blockers::text USING ERRCODE = '22023';
    END IF;
    IF v_render_unresolved > 0 THEN
      RAISE EXCEPTION 'renderer_unresolved_tokens: %', v_render_unresolved USING ERRCODE = '22023';
    END IF;
    IF v_render_template_version_id IS DISTINCT FROM v_template_version_id THEN
      RAISE EXCEPTION 'renderer_template_version_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_channel = 'email' AND (v_subject IS NULL OR length(trim(v_subject)) = 0) THEN
      RAISE EXCEPTION 'rendered_subject_blank' USING ERRCODE = '22023';
    END IF;
    IF (COALESCE(v_body_html,'') = '' AND COALESCE(v_body_text,'') = '') THEN
      RAISE EXCEPTION 'rendered_body_blank' USING ERRCODE = '22023';
    END IF;
    IF v_render_subject_hash IS NULL OR v_render_body_hash IS NULL OR v_render_content_hash IS NULL THEN
      RAISE EXCEPTION 'renderer_hashes_missing' USING ERRCODE = '22023';
    END IF;

    -- Independent recomputation using extensions.digest — must match renderer.
    v_subject_hash := encode(extensions.digest(COALESCE(v_subject,''), 'sha256'), 'hex');
    v_body_hash    := encode(extensions.digest(
      COALESCE(v_body_html,'') || E'\n---\n' || COALESCE(v_body_text,''), 'sha256'), 'hex');
    v_content_hash := encode(extensions.digest(v_subject_hash || v_body_hash, 'sha256'), 'hex');

    IF v_subject_hash <> v_render_subject_hash
       OR v_body_hash <> v_render_body_hash
       OR v_content_hash <> v_render_content_hash THEN
      RAISE EXCEPTION 'renderer_hash_mismatch: independent recomputation disagreed with renderer'
        USING ERRCODE = '22023';
    END IF;

    v_request_no := 'CREV-' || upper(substr(p_cycle_id::text, 1, 8))
                    || '-' || upper(substr(v_new_exec_id::text, 1, 6))
                    || '-V' || v_prep_ver::text;

    -- Canonical request bound to execution.
    INSERT INTO public.communication_request (
      request_no, module_code, event_code, channels,
      priority, status, payload, context,
      idempotency_key, requested_by, approved_by, approved_at,
      decision_send_context, targeted_dispatch_only,
      controlled_action, revalidation_execution_id,
      recipient_policy_version
    ) VALUES (
      v_request_no, v_module_code, v_event_code, ARRAY[v_channel]::text[],
      'normal', 'pending',
      jsonb_build_object('cycle_id', p_cycle_id,
                         'authorisation_id', p_authorisation_id,
                         'purpose', 'CONTROLLED_REVALIDATION_PREPARATION',
                         'preparation_version', v_prep_ver),
      jsonb_build_object('send_context','controlled_revalidation',
                         'execution_id', v_new_exec_id,
                         'recipient_normalized', v_recipient_norm,
                         'recipient_set_hash', v_recipient_set_hash,
                         'template_version_id', v_template_version_id,
                         'template_manifest_hash', v_template_manifest_hash,
                         'sender_profile_id', v_sender_profile_id,
                         'provider_id', v_provider_id,
                         'provider_boundary_state','NOT_ENTERED',
                         'provider_call_attempted', false),
      v_key, p_operator_id, p_operator_id, v_now,
      'controlled_revalidation', true,
      'CONTROLLED_REVALIDATION_PREPARE', v_new_exec_id,
      NULLIF(regexp_replace(COALESCE(v_recipient_policy_version,''), '\D', '', 'g'), '')::integer
    ) RETURNING id INTO v_request_id;

    INSERT INTO public.communication_recipient (
      request_id, role, recipient_type, name, email, channel_hint
    ) VALUES (
      v_request_id, 'to', 'email', NULL, v_recipient_norm, v_channel
    ) RETURNING id INTO v_recipient_id;

    INSERT INTO public.communication_message (
      request_id, recipient_id, channel, provider_id, origin,
      template_version_id, subject, body_text, body_html,
      rendered_at, status, send_context,
      sender_profile_id, from_email, from_display_name,
      targeted_dispatch_only, controlled_action, revalidation_execution_id,
      recipient_set_hash, subject_hash, body_hash, content_hash,
      certified_dependency_hash
    ) VALUES (
      v_request_id, v_recipient_id, v_channel, v_provider_id, 'comm_hub',
      v_template_version_id, v_subject, v_body_text, v_body_html,
      v_now, 'queued', 'controlled_revalidation',
      v_sender_profile_id, v_from_email, v_from_name,
      true, 'CONTROLLED_REVALIDATION_PREPARE', v_new_exec_id,
      v_recipient_set_hash, v_subject_hash, v_body_hash, v_content_hash,
      v_template_manifest_hash
    ) RETURNING id INTO v_message_id;

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
      jsonb_build_object('preparation_version', v_prep_ver,
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
      'Atomic canonical preparation created request, recipient, message, trace and attempt. No provider call.',
      jsonb_build_object('execution_id', v_new_exec_id,
                         'preparation_version', v_prep_ver,
                         'recipient_set_hash', v_recipient_set_hash,
                         'subject_hash', v_subject_hash,
                         'body_hash', v_body_hash,
                         'content_hash', v_content_hash)
    ) RETURNING id INTO v_step_id;

    INSERT INTO public.communication_delivery_attempt (
      message_id, attempt_no, status, provider_id,
      provider_call_attempted, send_context, attempt_type,
      recipient_set_hash, subject_hash, body_hash
    ) VALUES (
      v_message_id, 0, 'pending', v_provider_id,
      false, 'controlled_revalidation', 'controlled_revalidation_preparation',
      v_recipient_set_hash, v_subject_hash, v_body_hash
    ) RETURNING id INTO v_attempt_id;

    UPDATE public.communication_hub_revalidation_execution
       SET request_id = v_request_id, message_id = v_message_id,
           trace_id = v_trace_id, delivery_attempt_id = v_attempt_id,
           state = 'READY_FOR_PROVIDER',
           metadata = COALESCE(metadata,'{}'::jsonb)
                      || jsonb_build_object('ready_at', v_now,
                           'recipient_id', v_recipient_id,
                           'subject_hash', v_subject_hash,
                           'body_hash', v_body_hash,
                           'content_hash', v_content_hash,
                           'trace_no', v_trace_no,
                           'request_no', v_request_no),
           updated_at = v_now
     WHERE id = v_new_exec_id;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE,
                            v_err_msg   = MESSAGE_TEXT,
                            v_err_detail= PG_EXCEPTION_DETAIL;
    UPDATE public.communication_hub_revalidation_execution
       SET state = 'FAILED_PRE_PROVIDER',
           failure_code  = 'atomic_preparation_evidence_failed',
           failure_detail= jsonb_build_object('sqlstate', v_err_state,
                             'message', v_err_msg, 'detail', v_err_detail,
                             'failed_at', v_now),
           updated_at = v_now
     WHERE id = v_new_exec_id;
    RETURN jsonb_build_object('ok', false, 'reused', false,
      'state','FAILED_PRE_PROVIDER',
      'execution_id', v_new_exec_id,
      'preparation_version', v_prep_ver,
      'canonical_idempotency_key', v_key,
      'provider_call_attempted', false,
      'failure_code','atomic_preparation_evidence_failed',
      'failure_detail', jsonb_build_object('sqlstate', v_err_state,
                          'message', v_err_msg, 'detail', v_err_detail),
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','atomic_preparation_evidence_failed','stage','pre_provider_evidence',
        'message', v_err_msg)),
      'warnings','[]'::jsonb);
  END;

  RETURN jsonb_build_object(
    'ok', true, 'reused', false, 'state','READY_FOR_PROVIDER',
    'execution_id', v_new_exec_id,
    'request_id', v_request_id, 'message_id', v_message_id,
    'recipient_id', v_recipient_id, 'trace_id', v_trace_id,
    'delivery_attempt_id', v_attempt_id,
    'preparation_version', v_prep_ver,
    'canonical_idempotency_key', v_key,
    'template_version_id', v_template_version_id,
    'template_manifest_hash', v_template_manifest_hash,
    'sender_profile_id', v_sender_profile_id,
    'from_email', v_from_email,
    'provider_id', v_provider_id,
    'recipient_set_hash', v_recipient_set_hash,
    'subject_hash', v_subject_hash, 'body_hash', v_body_hash,
    'content_hash', v_content_hash,
    'provider_call_attempted', false,
    'blockers','[]'::jsonb,'warnings','[]'::jsonb);
END;
$function$;

-- 6. Harden recovery RPC authority — service_role only.
REVOKE EXECUTE ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_recover_execution(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_delivery(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_delivery(uuid, uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_delivery(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_delivery(uuid, uuid, uuid, text) TO service_role;

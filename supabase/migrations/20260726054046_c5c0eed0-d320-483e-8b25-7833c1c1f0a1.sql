
-- =====================================================================
-- Stage 6 runtime-contract alignment
-- =====================================================================

-- A. Extend certification constraints to include a terminal PROVIDER_REJECTED
--    outcome. This ADDS values; it never weakens the existing check.
ALTER TABLE public.communication_controlled_live_certification
  DROP CONSTRAINT IF EXISTS clc_provider_outcome_check;
ALTER TABLE public.communication_controlled_live_certification
  ADD CONSTRAINT clc_provider_outcome_check
  CHECK (provider_outcome = ANY (ARRAY[
    'PROVIDER_ACCEPTED','DELIVERY_PENDING','DELIVERED','PROVIDER_REJECTED']));

ALTER TABLE public.communication_controlled_live_certification
  DROP CONSTRAINT IF EXISTS clc_status_check;
ALTER TABLE public.communication_controlled_live_certification
  ADD CONSTRAINT clc_status_check
  CHECK (status = ANY (ARRAY[
    'PROVIDER_ACCEPTED','DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY',
    'INVALIDATED','REVOKED','PROVIDER_REJECTED']));

-- =====================================================================
-- B. Reserve grant now asserts DISPATCH_ONE_REAL_EMAIL
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reserve_comm_hub_one_real_email_grant(
  p_grant_id uuid, p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_svc jsonb; v_g public.communication_controlled_live_grant%ROWTYPE;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','DISPATCH_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_svc->'blockers');
  END IF;

  SELECT * INTO v_g FROM public.communication_controlled_live_grant WHERE id=p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_FOUND')));
  END IF;
  IF v_g.execution_id <> p_execution_id THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_EXECUTION_MISMATCH')));
  END IF;
  IF v_g.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_NOT_REAL_EMAIL')));
  END IF;
  IF v_g.status = 'RESERVED' THEN
    RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'RESERVED',
      'idempotent_replay', true);
  END IF;
  IF v_g.status <> 'ISSUED' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_STATE_INVALID','detail',
        jsonb_build_object('status', v_g.status))));
  END IF;
  IF v_g.expires_at IS NOT NULL AND v_g.expires_at <= now() THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_EXPIRED')));
  END IF;
  UPDATE public.communication_controlled_live_grant
     SET status='RESERVED', reserved_at=now(), updated_at=now() WHERE id=v_g.id;
  RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'RESERVED');
END $function$;

-- =====================================================================
-- C. Corrected create_comm_hub_one_real_email_message
--    - Targeted message uses send_context='controlled_live'
--    - Explicit per-field guard before INSERT
--    - Catches check_violation / foreign_key_violation
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_comm_hub_one_real_email_message(
  p_execution_id uuid, p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_execution  public.communication_controlled_live_execution%ROWTYPE;
  v_grant      public.communication_controlled_live_grant%ROWTYPE;
  v_approval   public.communication_preview_approval%ROWTYPE;
  v_snapshot   public.communication_preview_snapshot%ROWTYPE;
  v_dry_run    public.communication_dry_run_certification%ROWTYPE;
  v_sender     public.communication_hub_sender_profile%ROWTYPE;
  v_provider   public.notification_providers%ROWTYPE;
  v_first jsonb; v_first_type text;
  v_to_email text; v_to_name text;
  v_to_count int; v_cc_count int; v_bcc_count int;
  v_action text := 'SEND_ONE_REAL_EMAIL';
  v_idem_key text;
  v_request_id uuid; v_request_no text;
  v_recipient_id uuid; v_message_id uuid; v_existing_msg uuid;
  v_exec_recipient text;
  v_recomputed_hash text; v_norm jsonb;
  v_sender_from text; v_sender_name text; v_sender_reply text;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF p_execution_id IS NULL OR p_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'input_invalid');
  END IF;

  SELECT * INTO v_execution FROM public.communication_controlled_live_execution
   WHERE id = p_execution_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','execution_not_found'); END IF;

  IF v_execution.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_not_real_email');
  END IF;
  IF coalesce(v_execution.provider_mode,'') <> 'real' THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_not_provider_real');
  END IF;
  IF v_execution.real_email_authorised IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_not_real_email_authorised');
  END IF;
  IF v_execution.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','execution_terminal');
  END IF;

  SELECT * INTO v_grant FROM public.communication_controlled_live_grant
   WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','grant_not_found'); END IF;
  IF v_grant.execution_id <> v_execution.id THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_execution_mismatch');
  END IF;
  IF v_grant.send_context <> 'REAL_EMAIL' THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_not_real_email');
  END IF;
  IF v_grant.status NOT IN ('ISSUED','RESERVED') THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_not_dispatchable',
      'grant_status', v_grant.status);
  END IF;
  IF v_grant.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_expired');
  END IF;
  IF v_grant.scope_hash <> v_execution.scope_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_scope_hash_mismatch');
  END IF;
  IF v_grant.recipient_set_hash <> v_execution.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_recipient_hash_mismatch');
  END IF;
  IF v_grant.preview_approval_id <> v_execution.preview_approval_id THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_preview_mismatch');
  END IF;
  IF v_grant.dry_run_certification_id <> v_execution.dry_run_certification_id THEN
    RETURN jsonb_build_object('ok', false, 'code','grant_dry_run_mismatch');
  END IF;

  -- Idempotent request replay (per-execution/action).
  v_idem_key := 'one-real-email:request:' || v_execution.id::text || ':' || v_action;
  SELECT id INTO v_request_id FROM public.communication_request WHERE idempotency_key = v_idem_key;
  IF FOUND THEN
    SELECT id INTO v_existing_msg FROM public.communication_message
     WHERE request_id = v_request_id AND targeted_dispatch_only = true
       AND controlled_live_execution_id = v_execution.id
       AND controlled_live_grant_id = v_grant.id
       AND controlled_action = v_action;
    IF v_existing_msg IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code','idempotency_conflict_incomplete');
    END IF;
    SELECT id INTO v_recipient_id FROM public.communication_recipient
     WHERE request_id = v_request_id AND role='to' LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'action', v_action,
      'request_id', v_request_id, 'message_id', v_existing_msg,
      'recipient_id', v_recipient_id,
      'execution_id', v_execution.id, 'grant_id', v_grant.id);
  END IF;

  -- Approval / snapshot / dry-run alignment
  SELECT * INTO v_approval FROM public.communication_preview_approval
    WHERE id = v_execution.preview_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','preview_approval_missing'); END IF;
  IF v_approval.status NOT IN ('ACTIVE','RESERVED') THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_approval_not_usable', 'approval_status', v_approval.status);
  END IF;
  IF v_approval.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_approval_expired');
  END IF;

  SELECT * INTO v_snapshot FROM public.communication_preview_snapshot WHERE id = v_approval.snapshot_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','preview_snapshot_missing'); END IF;
  IF v_snapshot.status <> 'PREPARED' THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_snapshot_not_prepared','snapshot_status',v_snapshot.status);
  END IF;
  IF v_snapshot.content_hash IS DISTINCT FROM v_approval.content_hash_at_approval THEN
    RETURN jsonb_build_object('ok', false, 'code','preview_content_hash_mismatch');
  END IF;

  SELECT * INTO v_dry_run FROM public.communication_dry_run_certification
   WHERE id = v_execution.dry_run_certification_id;
  IF NOT FOUND OR v_dry_run.status <> 'ACTIVE' OR v_dry_run.result <> 'DRY_RUN_PASSED' THEN
    RETURN jsonb_build_object('ok', false, 'code','dry_run_certification_not_valid');
  END IF;
  IF v_dry_run.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code','dry_run_certification_expired');
  END IF;
  IF v_dry_run.preview_approval_id IS DISTINCT FROM v_approval.id THEN
    RETURN jsonb_build_object('ok', false, 'code','dry_run_approval_mismatch');
  END IF;

  v_to_count  := coalesce(jsonb_array_length(v_snapshot.to_recipients), 0);
  v_cc_count  := coalesce(jsonb_array_length(v_snapshot.cc_recipients), 0);
  v_bcc_count := coalesce(jsonb_array_length(v_snapshot.bcc_recipients), 0);
  IF v_to_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_count_invalid','to_count',v_to_count);
  END IF;
  IF v_cc_count > 0  THEN RETURN jsonb_build_object('ok', false, 'code','cc_not_allowed'); END IF;
  IF v_bcc_count > 0 THEN RETURN jsonb_build_object('ok', false, 'code','bcc_not_allowed'); END IF;

  v_first := v_snapshot.to_recipients->0;
  v_first_type := jsonb_typeof(v_first);
  IF v_first_type = 'string' THEN
    v_to_email := lower(btrim(v_snapshot.to_recipients->>0));
    v_to_name  := NULL;
  ELSIF v_first_type = 'object' THEN
    v_to_email := lower(btrim(coalesce(v_first->>'email','')));
    v_to_name  := v_first->>'name';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code','recipient_shape_invalid');
  END IF;
  IF v_to_email IS NULL OR v_to_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_email_missing');
  END IF;

  v_exec_recipient := lower(btrim(coalesce(v_execution.recipient,'')));
  IF v_exec_recipient <> '' AND v_exec_recipient <> v_to_email THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_execution_mismatch');
  END IF;

  v_norm := public.comm_hub_normalize_recipient_set(
    jsonb_build_array(v_to_email), '[]'::jsonb, '[]'::jsonb);
  v_recomputed_hash := v_norm->>'recipient_set_hash';
  IF v_recomputed_hash IS DISTINCT FROM v_snapshot.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_hash_snapshot_mismatch');
  END IF;
  IF v_recomputed_hash IS DISTINCT FROM v_grant.recipient_set_hash THEN
    RETURN jsonb_build_object('ok', false, 'code','recipient_hash_grant_mismatch');
  END IF;

  IF v_snapshot.template_version_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','template_version_missing');
  END IF;
  IF v_snapshot.sender_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','sender_profile_missing');
  END IF;
  IF v_snapshot.rendered_subject IS NULL OR btrim(v_snapshot.rendered_subject) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','rendered_subject_missing');
  END IF;
  IF (v_snapshot.rendered_body_html IS NULL OR btrim(v_snapshot.rendered_body_html) = '')
     AND (v_snapshot.rendered_body_text IS NULL OR btrim(v_snapshot.rendered_body_text) = '') THEN
    RETURN jsonb_build_object('ok', false, 'code','rendered_body_missing');
  END IF;

  SELECT * INTO v_sender FROM public.communication_hub_sender_profile
    WHERE id = v_snapshot.sender_profile_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','sender_profile_not_found'); END IF;
  v_sender_from  := btrim(coalesce(v_sender.from_email,''));
  v_sender_name  := btrim(coalesce(v_sender.display_name,''));
  v_sender_reply := btrim(coalesce(v_sender.reply_to_email,''));
  IF v_sender_from = '' OR v_sender_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','sender_profile_not_verified');
  END IF;
  IF v_sender_reply = '' THEN v_sender_reply := v_sender_from; END IF;

  SELECT * INTO v_provider FROM public.notification_providers
   WHERE channel = 'email'::notification_channel
     AND is_active = true AND is_default = true
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','no_active_real_provider'); END IF;

  -- Explicit pre-insert contract guard for every targeted-message field.
  IF v_action IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','controlled_action_missing','field','controlled_action');
  END IF;
  IF v_execution.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','controlled_live_execution_id_missing','field','controlled_live_execution_id');
  END IF;
  IF v_grant.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','controlled_live_grant_id_missing','field','controlled_live_grant_id');
  END IF;
  IF v_snapshot.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','preview_snapshot_id_missing','field','preview_snapshot_id');
  END IF;
  IF v_approval.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','preview_approval_id_missing','field','preview_approval_id');
  END IF;
  IF v_dry_run.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_certification_id_missing','field','dry_run_certification_id');
  END IF;
  IF v_snapshot.template_version_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','template_version_id_missing','field','template_version_id');
  END IF;
  IF v_snapshot.sender_profile_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','sender_profile_id_missing','field','sender_profile_id');
  END IF;
  IF v_snapshot.recipient_set_hash IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','recipient_set_hash_missing','field','recipient_set_hash');
  END IF;
  IF v_snapshot.subject_hash IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','subject_hash_missing','field','subject_hash');
  END IF;
  IF v_snapshot.body_hash IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','body_hash_missing','field','body_hash');
  END IF;
  IF v_snapshot.content_hash IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','content_hash_missing','field','content_hash');
  END IF;
  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code','targeted_message_field_missing',
      'blockers', v_blockers);
  END IF;

  PERFORM set_config('comm_hub.allow_targeted_update', 'true', true);

  v_request_no := 'ORE-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS')
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
      coalesce(v_snapshot.context_data, '{}'::jsonb),
      jsonb_build_object(
        'correlation_id', v_execution.id::text, 'origin', 'comm_hub',
        'send_context','controlled_live',
        'stage','ONE_REAL_EMAIL',
        'controlled_action', v_action,
        'source','create_comm_hub_one_real_email_message'),
      v_idem_key, v_execution.requested_by,
      v_execution.original_decision_id, 'controlled_live',
      v_execution.configuration_version, v_execution.recipient_policy_version::integer,
      true, v_action, v_execution.id, v_grant.id
    ) RETURNING id INTO v_request_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_request_id FROM public.communication_request WHERE idempotency_key = v_idem_key;
      SELECT id INTO v_message_id FROM public.communication_message
       WHERE request_id = v_request_id AND targeted_dispatch_only = true;
      SELECT id INTO v_recipient_id FROM public.communication_recipient
       WHERE request_id = v_request_id AND role='to' LIMIT 1;
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'action', v_action,
        'request_id', v_request_id, 'message_id', v_message_id,
        'recipient_id', v_recipient_id,
        'execution_id', v_execution.id, 'grant_id', v_grant.id);
    WHEN check_violation THEN
      RETURN jsonb_build_object('ok', false, 'code','request_check_violation',
        'sqlstate', SQLSTATE, 'sqlerrm', SQLERRM);
    WHEN foreign_key_violation THEN
      RETURN jsonb_build_object('ok', false, 'code','request_foreign_key_violation',
        'sqlstate', SQLSTATE, 'sqlerrm', SQLERRM);
  END;

  INSERT INTO public.communication_recipient(request_id, role, recipient_type, name, email)
  VALUES (v_request_id, 'to', 'email', v_to_name, v_to_email)
  RETURNING id INTO v_recipient_id;

  BEGIN
    INSERT INTO public.communication_message(
      request_id, recipient_id, channel, template_version_id,
      subject, body_text, body_html, status,
      origin, sender_profile_id, from_email, from_display_name, reply_to_email,
      original_decision_id, send_context, test_mode,
      targeted_dispatch_only, controlled_action,
      controlled_live_execution_id, controlled_live_grant_id,
      preview_snapshot_id, preview_approval_id, dry_run_certification_id,
      recipient_set_hash, subject_hash, body_hash, content_hash,
      provider_id
    ) VALUES (
      v_request_id, v_recipient_id, 'email', v_snapshot.template_version_id,
      v_snapshot.rendered_subject, v_snapshot.rendered_body_text, v_snapshot.rendered_body_html,
      'queued', 'comm_hub', v_snapshot.sender_profile_id,
      v_sender_from, v_sender_name, v_sender_reply,
      v_execution.original_decision_id, 'controlled_live', false,
      true, v_action, v_execution.id, v_grant.id,
      v_snapshot.id, v_approval.id, v_dry_run.id,
      v_snapshot.recipient_set_hash, v_snapshot.subject_hash,
      v_snapshot.body_hash, v_snapshot.content_hash,
      v_provider.id
    ) RETURNING id INTO v_message_id;
  EXCEPTION
    WHEN check_violation THEN
      RETURN jsonb_build_object('ok', false, 'code','message_check_violation',
        'sqlstate', SQLSTATE, 'sqlerrm', SQLERRM,
        'request_id', v_request_id);
    WHEN foreign_key_violation THEN
      RETURN jsonb_build_object('ok', false, 'code','message_foreign_key_violation',
        'sqlstate', SQLSTATE, 'sqlerrm', SQLERRM,
        'request_id', v_request_id);
  END;

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
    'template_version_id', v_snapshot.template_version_id,
    'sender_profile_id', v_snapshot.sender_profile_id,
    'from_email', v_sender_from,
    'provider_id', v_provider.id,
    'provider_name', v_provider.provider_name,
    'original_decision_id', v_execution.original_decision_id);
END; $function$;

-- =====================================================================
-- D. Message lifecycle helper (queued→sending→sent/failed).
--    Runs under the targeted-update guard so the edge function can drive
--    transitions without needing raw table privileges.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_comm_hub_one_real_email_message_status(
  p_message_id uuid,
  p_target_status text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_svc jsonb; v_msg public.communication_message%ROWTYPE;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','DISPATCH_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'blockers', v_svc->'blockers');
  END IF;
  IF p_target_status NOT IN ('sending','sent','failed') THEN
    RETURN jsonb_build_object('ok', false, 'code','invalid_target_status');
  END IF;

  SELECT * INTO v_msg FROM public.communication_message WHERE id=p_message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','message_not_found'); END IF;
  IF v_msg.targeted_dispatch_only IS NOT TRUE
     OR v_msg.controlled_action <> 'SEND_ONE_REAL_EMAIL' THEN
    RETURN jsonb_build_object('ok', false, 'code','message_not_one_real_email');
  END IF;

  -- Enforce a strict forward-only lifecycle.
  IF p_target_status = 'sending' AND v_msg.status <> 'queued' THEN
    RETURN jsonb_build_object('ok', false, 'code','invalid_transition',
      'from', v_msg.status, 'to', p_target_status);
  END IF;
  IF p_target_status IN ('sent','failed') AND v_msg.status <> 'sending' THEN
    RETURN jsonb_build_object('ok', false, 'code','invalid_transition',
      'from', v_msg.status, 'to', p_target_status);
  END IF;

  PERFORM set_config('comm_hub.allow_targeted_update','true', true);

  UPDATE public.communication_message SET
    status = p_target_status,
    sent_at = CASE WHEN p_target_status='sent' THEN now() ELSE sent_at END,
    provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
    error_code = CASE WHEN p_target_status='failed' THEN p_error_code ELSE error_code END,
    error_message = CASE WHEN p_target_status='failed' THEN p_error_message ELSE error_message END,
    updated_at = now()
  WHERE id = p_message_id;

  RETURN jsonb_build_object('ok', true, 'message_id', p_message_id, 'status', p_target_status);
END $function$;

REVOKE ALL ON FUNCTION public.set_comm_hub_one_real_email_message_status(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_comm_hub_one_real_email_message_status(uuid,text,text,text,text)
  TO service_role;

-- =====================================================================
-- E. Finalizer — map every attempt outcome, including rejection.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.finalize_comm_hub_one_real_email(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_svc jsonb;
  v_exec_id uuid := (p_payload->>'execution_id')::uuid;
  v_exec public.communication_controlled_live_execution%ROWTYPE;
  v_grant public.communication_controlled_live_grant%ROWTYPE;
  v_attempt record;
  v_attempt_count int := 0;
  v_provider_outcome text;
  v_cert_status text;
  v_derived_provider_status text;
  v_existing_cert record;
  v_cert_result jsonb;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','FINALIZE_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'blockers', v_svc->'blockers');
  END IF;

  IF v_exec_id IS NULL THEN RAISE EXCEPTION 'execution_id_required'; END IF;

  SELECT * INTO v_exec FROM public.communication_controlled_live_execution WHERE id=v_exec_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'execution_not_found'; END IF;

  IF v_exec.send_context <> 'REAL_EMAIL' THEN RAISE EXCEPTION 'execution_not_real_email'; END IF;
  IF coalesce(v_exec.provider_mode,'') <> 'real' THEN RAISE EXCEPTION 'execution_not_provider_real'; END IF;
  IF v_exec.real_email_authorised IS NOT TRUE THEN RAISE EXCEPTION 'execution_not_real_email_authorised'; END IF;
  IF v_exec.provider_call_attempted IS NOT TRUE THEN RAISE EXCEPTION 'provider_not_invoked'; END IF;

  SELECT * INTO v_existing_cert
    FROM public.communication_controlled_live_certification
   WHERE execution_id = v_exec_id AND certification_kind = 'ONE_REAL_EMAIL';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent_replay', true,
      'certification_id', v_existing_cert.id,
      'certification_kind', 'ONE_REAL_EMAIL',
      'certification_status', v_existing_cert.status,
      'provider_outcome', v_existing_cert.provider_outcome,
      'provider_status', v_existing_cert.provider_status,
      'provider_mode', 'real', 'real_email_authorised', true,
      'provider_call_attempted', true);
  END IF;

  SELECT * INTO v_grant FROM public.communication_controlled_live_grant
   WHERE execution_id = v_exec_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF v_grant.send_context <> 'REAL_EMAIL' THEN RAISE EXCEPTION 'grant_not_real_email'; END IF;
  -- Rejection preserves the CONSUMED grant so it cannot be retried.
  IF v_grant.status NOT IN ('CONSUMED') THEN
    RAISE EXCEPTION 'grant_not_consumed' USING DETAIL = 'grant_status=' || v_grant.status;
  END IF;

  SELECT count(*) INTO v_attempt_count FROM public.communication_delivery_attempt
   WHERE message_id = v_exec.message_id;
  IF v_attempt_count <> 1 THEN
    RAISE EXCEPTION 'delivery_attempt_count_invalid' USING DETAIL = 'count=' || v_attempt_count;
  END IF;
  SELECT * INTO v_attempt FROM public.communication_delivery_attempt
   WHERE message_id = v_exec.message_id LIMIT 1;
  IF v_attempt.provider_id IS NULL THEN RAISE EXCEPTION 'attempt_provider_missing'; END IF;

  v_derived_provider_status := coalesce(v_attempt.status::text, '');
  IF v_derived_provider_status = 'success' THEN
    v_provider_outcome := 'PROVIDER_ACCEPTED';
    v_cert_status := 'PROVIDER_ACCEPTED';
  ELSIF v_derived_provider_status = 'delivered' THEN
    v_provider_outcome := 'DELIVERED';
    v_cert_status := 'DELIVERY_CONFIRMED';
  ELSIF v_derived_provider_status IN ('pending') THEN
    v_provider_outcome := 'DELIVERY_PENDING';
    v_cert_status := 'PROVIDER_ACCEPTED';
  ELSIF v_derived_provider_status IN ('failure','timeout','throttled','skipped') THEN
    v_provider_outcome := 'PROVIDER_REJECTED';
    v_cert_status := 'PROVIDER_REJECTED';
  ELSE
    RAISE EXCEPTION 'attempt_outcome_not_certifiable' USING DETAIL = 'status=' || v_derived_provider_status;
  END IF;

  INSERT INTO public.communication_controlled_live_certification(
    execution_id, module_code, event_code, channel, recipient_set_hash,
    preview_snapshot_id, preview_approval_id, dry_run_certification_id,
    request_id, message_id, delivery_attempt_id, trace_id,
    provider_name, provider_message_id, provider_outcome, provider_status,
    status, recipient_policy_version, configuration_version,
    operating_mode_prior, operating_mode_final, cleanup_succeeded,
    certified_at, certified_by, certification_kind)
  VALUES (
    v_exec_id, v_exec.module_code, v_exec.event_code, v_exec.channel,
    v_exec.recipient_set_hash,
    v_exec.preview_snapshot_id, v_exec.preview_approval_id, v_exec.dry_run_certification_id,
    v_exec.request_id, v_exec.message_id, v_attempt.id, v_exec.trace_id,
    v_exec.provider_name, v_exec.provider_message_id, v_provider_outcome,
    coalesce(v_exec.provider_status, v_derived_provider_status),
    v_cert_status,
    v_exec.recipient_policy_version::integer, v_exec.configuration_version::integer,
    v_exec.prior_operating_mode::text, v_exec.final_operating_mode::text,
    coalesce(v_exec.cleanup_succeeded, true),
    now(), v_exec.requested_by, 'ONE_REAL_EMAIL')
  RETURNING id INTO v_cert_result;
  v_cert_result := jsonb_build_object('certification_id', v_cert_result);

  UPDATE public.communication_controlled_live_execution
     SET state = CASE v_provider_outcome
                   WHEN 'DELIVERED' THEN 'DELIVERED'::communication_controlled_live_state
                   WHEN 'DELIVERY_PENDING' THEN 'DELIVERY_PENDING'::communication_controlled_live_state
                   WHEN 'PROVIDER_REJECTED' THEN 'PROVIDER_REJECTED'::communication_controlled_live_state
                   ELSE 'PROVIDER_ACCEPTED'::communication_controlled_live_state
                 END,
         completed_at = now(), updated_at = now()
   WHERE id = v_exec_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', false,
    'certification_id', v_cert_result->>'certification_id',
    'certification_kind', 'ONE_REAL_EMAIL',
    'certification_status', v_cert_status,
    'provider_outcome', v_provider_outcome,
    'provider_status', coalesce(v_exec.provider_status, v_derived_provider_status),
    'provider_mode', 'real', 'real_email_authorised', true,
    'provider_call_attempted', true,
    'retry_safe', (v_provider_outcome = 'PROVIDER_REJECTED') = false OR true = false); -- retry_safe = false for rejection
END $function$;

-- If the execution state enum lacks PROVIDER_REJECTED, add it so the UPDATE
-- above is valid. ADD VALUE is idempotent via IF NOT EXISTS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname='communication_controlled_live_state') THEN
    BEGIN
      ALTER TYPE public.communication_controlled_live_state ADD VALUE IF NOT EXISTS 'PROVIDER_REJECTED';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- =====================================================================
-- F. Runtime-contract introspection probe
-- =====================================================================
CREATE OR REPLACE FUNCTION public.probe_comm_hub_one_real_email_runtime()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'evaluated_at', now(),
    'constraints', (
      SELECT jsonb_object_agg(conname, pg_get_constraintdef(oid))
      FROM pg_constraint
      WHERE conname IN (
        'comm_msg_targeted_completeness_chk',
        'comm_msg_targeted_action_chk',
        'communication_message_status_chk',
        'communication_delivery_attempt_status_chk',
        'clc_status_check','clc_provider_outcome_check')),
    'rpcs', (
      SELECT jsonb_object_agg(proname, pg_get_function_identity_arguments(oid))
      FROM pg_proc
      WHERE proname IN (
        'begin_comm_hub_one_real_email',
        'create_comm_hub_one_real_email_message',
        'reserve_comm_hub_one_real_email_grant',
        'consume_comm_hub_one_real_email_grant',
        'revoke_comm_hub_one_real_email_grant',
        'reconcile_comm_hub_one_real_email_pre_provider',
        'finalize_comm_hub_one_real_email',
        'set_comm_hub_one_real_email_message_status',
        'get_comm_hub_one_real_email_context',
        'get_comm_hub_request_auth_context')),
    'allowlist', (
      SELECT jsonb_object_agg(operation, active)
      FROM public.comm_hub_service_operation_allowlist
      WHERE service_account='comm-hub-send-one-real-email'),
    'attempt_columns', (
      SELECT jsonb_agg(column_name ORDER BY ordinal_position)
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='communication_delivery_attempt')
  );
$$;

REVOKE ALL ON FUNCTION public.probe_comm_hub_one_real_email_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.probe_comm_hub_one_real_email_runtime()
  TO authenticated, service_role;

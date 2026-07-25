
-- 1. Patch create_comm_hub_controlled_stub_message to use correct sender column.
CREATE OR REPLACE FUNCTION public.create_comm_hub_controlled_stub_message(
  p_execution_id uuid, p_grant_id uuid)
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
  v_sender_from  text;
  v_sender_name  text;
  v_sender_reply text;
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

  v_exec_recipient := lower(btrim(COALESCE(v_execution.recipient,'')));
  IF v_exec_recipient <> '' AND v_exec_recipient <> v_to_email THEN
    RETURN jsonb_build_object('ok', false, 'code', 'recipient_execution_mismatch',
      'detail', jsonb_build_object('snapshot_email', v_to_email, 'execution_recipient', v_exec_recipient));
  END IF;

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

  v_sender_from  := btrim(COALESCE(v_sender.from_email, ''));
  v_sender_name  := btrim(COALESCE(v_sender.display_name, ''));
  v_sender_reply := btrim(COALESCE(v_sender.reply_to_email, ''));
  IF v_sender_from = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'sender_from_email_missing',
      'detail', jsonb_build_object('sender_profile_id', v_sender.id));
  END IF;
  IF v_sender_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'sender_display_name_missing',
      'detail', jsonb_build_object('sender_profile_id', v_sender.id));
  END IF;
  IF v_sender_reply = '' THEN v_sender_reply := v_sender_from; END IF;

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
    v_sender_from,
    v_sender_name, v_sender_reply,
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
    'sender_profile_id', v_snapshot.sender_profile_id,
    'from_email', v_sender_from,
    'from_display_name', v_sender_name);
END; $function$;

-- 2. Patch revoke_comm_hub_controlled_live_grant to use bound service guard
-- (assert_comm_hub_service_operation derives service from JWT iss which
-- never matches the logical service account name).
CREATE OR REPLACE FUNCTION public.revoke_comm_hub_controlled_live_grant(
  p_grant_id uuid, p_execution_id uuid, p_reason text, p_service_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_svc jsonb; v_g record;
BEGIN
  IF p_service_operation IS DISTINCT FROM 'REVOKE_GRANT' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','SERVICE_OPERATION_INVALID',
        'message','p_service_operation must be REVOKE_GRANT',
        'detail', jsonb_build_object('supplied', p_service_operation))));
  END IF;
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-controlled-live-test', 'REVOKE_GRANT');
  IF NOT COALESCE((v_svc->>'allowed')::bool, false) THEN
    RETURN jsonb_build_object('allowed',false,'blockers', v_svc->'blockers');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason)='' THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_SERVICE_OPERATION_DENIED','message','Reason required')));
  END IF;
  SELECT * INTO v_g FROM public.communication_controlled_live_grant WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_NOT_FOUND','message','Grant not found'))); END IF;
  IF v_g.execution_id IS DISTINCT FROM p_execution_id THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_EXECUTION_MISMATCH','message','Execution mismatch'))); END IF;
  IF v_g.status::text NOT IN ('ISSUED','RESERVED') THEN
    RETURN jsonb_build_object('allowed',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_STATE_INVALID','message','Not revocable',
        'detail',jsonb_build_object('status',v_g.status)))); END IF;
  UPDATE public.communication_controlled_live_grant
     SET status='REVOKED', revoked_at=now(), revocation_reason=p_reason, updated_at=now() WHERE id=v_g.id;
  RETURN jsonb_build_object('allowed',true,'grant_id',v_g.id,'status','REVOKED');
END; $function$;

-- 3. Reconcile stuck grant.
UPDATE public.communication_controlled_live_grant
   SET status='REVOKED', revoked_at=COALESCE(revoked_at, now()),
       revocation_reason=COALESCE(revocation_reason,'pre_provider_request_creation_failed'),
       updated_at=now()
 WHERE id='5dda9bb7-21a9-418d-b023-0c8be15b7971'
   AND status IN ('ISSUED','RESERVED');

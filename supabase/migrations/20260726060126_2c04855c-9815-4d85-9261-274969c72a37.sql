
-- =====================================================================
-- 1. Corrected finalize_comm_hub_one_real_email
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
  v_msg_status text;
  v_attempt record;
  v_attempt_count int := 0;
  v_provider_outcome text;
  v_cert_status text;
  v_derived_provider_status text;
  v_existing_cert record;
  v_cert_id uuid;
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
  IF v_exec.trace_id IS NULL THEN RAISE EXCEPTION 'execution_trace_missing'; END IF;
  IF v_exec.message_id IS NULL THEN RAISE EXCEPTION 'execution_message_missing'; END IF;

  -- Idempotency: return existing certification untouched.
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
      'provider_call_attempted', true,
      'retry_safe', false,
      'automatic_retry_allowed', false);
  END IF;

  SELECT * INTO v_grant FROM public.communication_controlled_live_grant
   WHERE execution_id = v_exec_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF v_grant.send_context <> 'REAL_EMAIL' THEN RAISE EXCEPTION 'grant_not_real_email'; END IF;
  IF v_grant.status NOT IN ('CONSUMED') THEN
    RAISE EXCEPTION 'grant_not_consumed' USING DETAIL = 'grant_status=' || v_grant.status;
  END IF;

  SELECT status::text INTO v_msg_status FROM public.communication_message WHERE id = v_exec.message_id;
  IF v_msg_status IS NULL THEN RAISE EXCEPTION 'message_not_found'; END IF;
  IF v_msg_status NOT IN ('sent','failed') THEN
    RAISE EXCEPTION 'message_not_terminal' USING DETAIL = 'status=' || v_msg_status;
  END IF;

  SELECT count(*) INTO v_attempt_count FROM public.communication_delivery_attempt
   WHERE message_id = v_exec.message_id;
  IF v_attempt_count <> 1 THEN
    RAISE EXCEPTION 'delivery_attempt_count_invalid' USING DETAIL = 'count=' || v_attempt_count;
  END IF;
  SELECT * INTO v_attempt FROM public.communication_delivery_attempt
   WHERE message_id = v_exec.message_id LIMIT 1;
  IF v_attempt.provider_id IS NULL THEN RAISE EXCEPTION 'attempt_provider_missing'; END IF;
  IF v_attempt.provider_call_attempted IS NOT TRUE THEN
    RAISE EXCEPTION 'attempt_provider_call_not_attempted';
  END IF;

  v_derived_provider_status := coalesce(v_attempt.status::text, '');
  IF v_derived_provider_status = 'success' THEN
    IF v_attempt.provider_message_id IS NULL AND v_exec.provider_message_id IS NULL THEN
      RAISE EXCEPTION 'provider_message_id_missing';
    END IF;
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
    v_exec.provider_name,
    coalesce(v_attempt.provider_message_id, v_exec.provider_message_id),
    v_provider_outcome,
    coalesce(v_exec.provider_status, v_derived_provider_status),
    v_cert_status,
    v_exec.recipient_policy_version::integer, v_exec.configuration_version::integer,
    v_exec.prior_operating_mode::text, v_exec.final_operating_mode::text,
    coalesce(v_exec.cleanup_succeeded, true),
    now(), v_exec.requested_by, 'ONE_REAL_EMAIL')
  RETURNING id INTO v_cert_id;

  UPDATE public.communication_controlled_live_execution
     SET state = CASE v_provider_outcome
                   WHEN 'DELIVERED' THEN 'DELIVERED'::communication_controlled_live_state
                   WHEN 'DELIVERY_PENDING' THEN 'DELIVERY_PENDING'::communication_controlled_live_state
                   WHEN 'PROVIDER_REJECTED' THEN 'PROVIDER_REJECTED'::communication_controlled_live_state
                   ELSE 'PROVIDER_ACCEPTED'::communication_controlled_live_state
                 END,
         delivery_attempt_id = coalesce(delivery_attempt_id, v_attempt.id),
         completed_at = now(), updated_at = now()
   WHERE id = v_exec_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', false,
    'certification_id', v_cert_id,
    'certification_kind', 'ONE_REAL_EMAIL',
    'certification_status', v_cert_status,
    'provider_outcome', v_provider_outcome,
    'provider_status', coalesce(v_exec.provider_status, v_derived_provider_status),
    'provider_mode', 'real', 'real_email_authorised', true,
    'provider_call_attempted', true,
    'retry_safe', false,
    'automatic_retry_allowed', false);
END $function$;

REVOKE ALL ON FUNCTION public.finalize_comm_hub_one_real_email(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_comm_hub_one_real_email(jsonb) TO service_role;

-- =====================================================================
-- 2. Service-role-only recovery: resume finalization
--    Never sends, never creates a grant/message/attempt/provider call.
--    Binds a trace if the execution has none, then delegates to the
--    corrected finalizer. Fully idempotent.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resume_comm_hub_one_real_email_finalization(
  p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_svc jsonb;
  v_exec public.communication_controlled_live_execution%ROWTYPE;
  v_existing_cert record;
  v_trace_id uuid;
  v_trace_no text;
  v_finalize jsonb;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-resume-one-real-email-finalization',
    'RESUME_FINALIZE_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'blockers', v_svc->'blockers');
  END IF;

  IF p_execution_id IS NULL THEN RAISE EXCEPTION 'execution_id_required'; END IF;

  SELECT * INTO v_exec FROM public.communication_controlled_live_execution
   WHERE id = p_execution_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'execution_not_found'; END IF;

  -- Idempotency: existing certification is authoritative.
  SELECT * INTO v_existing_cert
    FROM public.communication_controlled_live_certification
   WHERE execution_id = p_execution_id AND certification_kind = 'ONE_REAL_EMAIL';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'certification_id', v_existing_cert.id,
      'certification_kind', 'ONE_REAL_EMAIL',
      'certification_status', v_existing_cert.status,
      'provider_outcome', v_existing_cert.provider_outcome,
      'provider_status', v_existing_cert.provider_status,
      'provider_call_attempted', true,
      'retry_safe', false,
      'automatic_retry_allowed', false);
  END IF;

  -- Recovery preconditions: provider must have been invoked, otherwise
  -- there is nothing to certify without another send.
  IF v_exec.provider_call_attempted IS NOT TRUE THEN
    RAISE EXCEPTION 'provider_not_invoked_cannot_resume';
  END IF;
  IF v_exec.send_context <> 'REAL_EMAIL' THEN
    RAISE EXCEPTION 'execution_not_real_email';
  END IF;

  -- Bind a trace if absent (finalizer requires trace_id NOT NULL).
  IF v_exec.trace_id IS NULL THEN
    v_trace_no := 'RESUMED-' || substr(p_execution_id::text, 1, 8) || '-' ||
                  to_char(now(), 'YYYYMMDDHH24MISS');
    INSERT INTO public.communication_hub_trace(
      trace_no, correlation_id, module_code, event_code, channel,
      entity_type, entity_id, source_module, source_action,
      initiated_by, recipient_email_masked, recipient_domain,
      status, current_stage, request_id, message_id, provider_message_id,
      metadata)
    VALUES (
      v_trace_no,
      p_execution_id::text,
      v_exec.module_code, v_exec.event_code, v_exec.channel,
      'controlled_live_execution', p_execution_id::text,
      'comm-hub', 'resume_finalization',
      v_exec.requested_by,
      CASE WHEN v_exec.recipient IS NULL THEN NULL
           ELSE substring(v_exec.recipient FROM 1 FOR 1) || '***@' ||
                split_part(v_exec.recipient, '@', 2) END,
      split_part(coalesce(v_exec.recipient,''), '@', 2),
      'resumed', 'finalization',
      v_exec.request_id, v_exec.message_id, v_exec.provider_message_id,
      jsonb_build_object(
        'resumed_at', now(),
        'reason', 'finalization_recovery_after_uuid_jsonb_bug'))
    RETURNING id INTO v_trace_id;

    UPDATE public.communication_controlled_live_execution
       SET trace_id = v_trace_id, updated_at = now()
     WHERE id = p_execution_id;
  END IF;

  -- Delegate to the corrected finalizer (which enforces every invariant).
  v_finalize := public.finalize_comm_hub_one_real_email(
    jsonb_build_object('execution_id', p_execution_id));

  RETURN v_finalize || jsonb_build_object('resumed', true);
END $function$;

REVOKE ALL ON FUNCTION public.resume_comm_hub_one_real_email_finalization(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_comm_hub_one_real_email_finalization(uuid)
  TO service_role;

-- =====================================================================
-- 3. Register the recovery service operations in the allowlist.
-- =====================================================================
INSERT INTO public.comm_hub_service_operation_allowlist(
  service_account, operation, reason, active)
VALUES
  ('comm-hub-resume-one-real-email-finalization',
   'RESUME_FINALIZE_ONE_REAL_EMAIL',
   'Recovery: finalize an already-sent Stage 6 execution whose finalizer failed with the UUID/jsonb bug.',
   true),
  ('comm-hub-resume-one-real-email-finalization',
   'FINALIZE_ONE_REAL_EMAIL',
   'Recovery: allowed because the resume RPC delegates to finalize_comm_hub_one_real_email as service role.',
   true)
ON CONFLICT (service_account, operation) DO UPDATE
  SET active = true, updated_at = now();

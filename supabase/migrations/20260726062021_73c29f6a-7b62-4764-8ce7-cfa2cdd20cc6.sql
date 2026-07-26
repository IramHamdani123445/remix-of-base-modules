
-- ============================================================
-- 1. Read-only recovery status RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_comm_hub_one_real_email_recovery_status(
  p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_exec public.communication_controlled_live_execution%ROWTYPE;
  v_grant public.communication_controlled_live_grant%ROWTYPE;
  v_msg_status text;
  v_attempt_id uuid;
  v_attempt_status text;
  v_cert record;
  v_blockers jsonb := '[]'::jsonb;
  v_can_resume boolean := false;
BEGIN
  IF p_execution_id IS NULL THEN
    RETURN jsonb_build_object(
      'execution_id', NULL,
      'can_resume', false,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','execution_id_required','stage','input','message','execution_id is required')));
  END IF;

  SELECT * INTO v_exec FROM public.communication_controlled_live_execution
   WHERE id = p_execution_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'execution_id', p_execution_id,
      'can_resume', false,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','execution_not_found','stage','lookup','message','no execution row found')));
  END IF;

  SELECT * INTO v_grant FROM public.communication_controlled_live_grant
   WHERE execution_id = p_execution_id
   ORDER BY created_at DESC NULLS LAST LIMIT 1;

  IF v_exec.message_id IS NOT NULL THEN
    SELECT status::text INTO v_msg_status FROM public.communication_message
     WHERE id = v_exec.message_id;
    SELECT id, status::text INTO v_attempt_id, v_attempt_status
      FROM public.communication_delivery_attempt
     WHERE message_id = v_exec.message_id
     ORDER BY created_at DESC NULLS LAST LIMIT 1;
  END IF;

  SELECT * INTO v_cert
    FROM public.communication_controlled_live_certification
   WHERE execution_id = p_execution_id
     AND certification_kind = 'ONE_REAL_EMAIL';

  -- Determine can_resume + blockers
  IF FOUND THEN
    v_can_resume := false;  -- already certified; treat as idempotent
  ELSE
    IF v_exec.provider_call_attempted IS NOT TRUE THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','provider_not_invoked','stage','precondition',
        'message','Provider was not invoked; recovery would require another send.');
    END IF;
    IF v_exec.send_context <> 'REAL_EMAIL' THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','execution_not_real_email','stage','precondition',
        'message','Execution send_context is not REAL_EMAIL.');
    END IF;
    IF v_exec.message_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','message_missing','stage','precondition',
        'message','Execution has no bound message_id.');
    END IF;
    IF v_msg_status IS NOT NULL AND v_msg_status NOT IN ('sent','failed') THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','message_not_terminal','stage','precondition',
        'message','Message status must be sent or failed.',
        'detail', v_msg_status);
    END IF;
    IF v_attempt_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','delivery_attempt_missing','stage','precondition',
        'message','No delivery attempt exists for the message.');
    END IF;
    v_can_resume := jsonb_array_length(v_blockers) = 0;
  END IF;

  RETURN jsonb_build_object(
    'execution_id', v_exec.id,
    'provider_call_attempted', v_exec.provider_call_attempted,
    'provider_message_id', v_exec.provider_message_id,
    'grant_id', v_grant.id,
    'grant_status', v_grant.status,
    'message_id', v_exec.message_id,
    'message_status', v_msg_status,
    'delivery_attempt_id', v_attempt_id,
    'attempt_status', v_attempt_status,
    'trace_id', v_exec.trace_id,
    'certification_id', v_cert.id,
    'certification_status', v_cert.status,
    'certification_kind', v_cert.certification_kind,
    'can_resume', v_can_resume,
    'blockers', v_blockers);
END $function$;

REVOKE ALL ON FUNCTION public.get_comm_hub_one_real_email_recovery_status(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_one_real_email_recovery_status(uuid)
  TO authenticated, service_role;

-- ============================================================
-- 2. Hardened resume RPC — safe trace binding via UPDATE RETURNING
-- ============================================================
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
  v_new_trace_id uuid;
  v_bound_trace_id uuid;
  v_trace_no text;
  v_trace_inserted boolean := false;
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
   WHERE execution_id = p_execution_id
     AND certification_kind = 'ONE_REAL_EMAIL';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'resumed', false,
      'trace_inserted', false,
      'trace_id', v_exec.trace_id,
      'execution_id', p_execution_id,
      'certification_id', v_existing_cert.id,
      'certification_kind', 'ONE_REAL_EMAIL',
      'certification_status', v_existing_cert.status,
      'provider_outcome', v_existing_cert.provider_outcome,
      'provider_status', v_existing_cert.provider_status,
      'provider_call_attempted', true,
      'retry_safe', false,
      'automatic_retry_allowed', false);
  END IF;

  IF v_exec.provider_call_attempted IS NOT TRUE THEN
    RAISE EXCEPTION 'provider_not_invoked_cannot_resume';
  END IF;
  IF v_exec.send_context <> 'REAL_EMAIL' THEN
    RAISE EXCEPTION 'execution_not_real_email';
  END IF;

  -- Bind a trace if absent; UPDATE ... RETURNING must yield a non-null id.
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
    RETURNING id INTO v_new_trace_id;
    v_trace_inserted := true;

    UPDATE public.communication_controlled_live_execution
       SET trace_id = v_new_trace_id, updated_at = now()
     WHERE id = p_execution_id
    RETURNING trace_id INTO v_bound_trace_id;

    IF v_bound_trace_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'trace_binding_failed',
        'execution_id', p_execution_id,
        'trace_inserted', v_trace_inserted,
        'trace_id', v_new_trace_id,
        'safe_detail',
          'UPDATE ... RETURNING trace_id yielded NULL; execution not updated.');
    END IF;

    -- Re-read execution so downstream sees the bound trace.
    SELECT * INTO v_exec FROM public.communication_controlled_live_execution
     WHERE id = p_execution_id FOR UPDATE;
    IF v_exec.trace_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'trace_binding_failed',
        'execution_id', p_execution_id,
        'trace_inserted', v_trace_inserted,
        'trace_id', v_new_trace_id,
        'safe_detail',
          'Re-read execution still has NULL trace_id after UPDATE RETURNING succeeded.');
    END IF;
  END IF;

  v_finalize := public.finalize_comm_hub_one_real_email(
    jsonb_build_object('execution_id', p_execution_id));

  RETURN v_finalize || jsonb_build_object(
    'resumed', true,
    'trace_inserted', v_trace_inserted,
    'execution_id', p_execution_id);
END $function$;

REVOKE ALL ON FUNCTION public.resume_comm_hub_one_real_email_finalization(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_comm_hub_one_real_email_finalization(uuid)
  TO service_role;

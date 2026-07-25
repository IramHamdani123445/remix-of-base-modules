-- Fix column names (error_code, error_message) and re-run.

CREATE OR REPLACE FUNCTION public.reserve_comm_hub_controlled_live_grant(
  p_grant_id uuid, p_execution_id uuid, p_expected_action text,
  p_expected_correlation_id uuid, p_service_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_svc jsonb; v_g record;
BEGIN
  IF p_service_operation IS DISTINCT FROM 'DISPATCH_CONTROLLED_STUB' THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','SERVICE_OPERATION_INVALID',
        'message','p_service_operation must be DISPATCH_CONTROLLED_STUB',
        'detail', jsonb_build_object('supplied', p_service_operation))));
  END IF;
  v_svc := public._comm_hub_assert_bound_service_operation('comm-hub-dispatch','DISPATCH_CONTROLLED_STUB');
  IF NOT COALESCE((v_svc->>'allowed')::bool, false) THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_svc->'blockers');
  END IF;
  SELECT g.*, s.correlation_id AS snap_correlation INTO v_g
    FROM public.communication_controlled_live_grant g
    JOIN public.communication_preview_approval a ON a.id = g.preview_approval_id
    JOIN public.communication_preview_snapshot s ON s.id = a.snapshot_id
   WHERE g.id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_NOT_FOUND','message','Grant not found'))); END IF;
  IF v_g.execution_id IS DISTINCT FROM p_execution_id THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_EXECUTION_MISMATCH','message','Execution mismatch'))); END IF;
  IF v_g.expires_at IS NOT NULL AND v_g.expires_at < now() THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_EXPIRED','message','Expired'))); END IF;
  IF v_g.status::text = 'RESERVED' THEN RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status','RESERVED','idempotent', true); END IF;
  IF v_g.status::text = 'CONSUMED' THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_ALREADY_CONSUMED','message','Already consumed'))); END IF;
  IF v_g.status::text = 'REVOKED' THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_REVOKED','message','Revoked'))); END IF;
  IF v_g.status::text <> 'ISSUED' THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_STATE_INVALID','message','Not ISSUED',
    'detail', jsonb_build_object('status', v_g.status)))); END IF;
  IF p_expected_action IS NOT NULL AND p_expected_action <> 'RUN_CONTROLLED_STUB' THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_ACTION_MISMATCH','message','Only RUN_CONTROLLED_STUB supported'))); END IF;
  IF p_expected_correlation_id IS NOT NULL AND v_g.snap_correlation IS DISTINCT FROM p_expected_correlation_id THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_CORRELATION_MISMATCH','message','Correlation mismatch'))); END IF;
  UPDATE public.communication_controlled_live_grant
     SET status='RESERVED', reserved_at=now(), updated_at=now() WHERE id = v_g.id;
  RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'RESERVED');
END; $$;

CREATE OR REPLACE FUNCTION public.consume_comm_hub_controlled_live_grant(
  p_grant_id uuid, p_execution_id uuid, p_message_id uuid,
  p_expected_correlation_id uuid, p_service_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_svc jsonb; v_g record; v_msg_exec uuid; v_evidence_count int;
BEGIN
  IF p_service_operation IS DISTINCT FROM 'DISPATCH_CONTROLLED_STUB' THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','SERVICE_OPERATION_INVALID',
        'message','p_service_operation must be DISPATCH_CONTROLLED_STUB',
        'detail', jsonb_build_object('supplied', p_service_operation)))); END IF;
  v_svc := public._comm_hub_assert_bound_service_operation('comm-hub-dispatch','DISPATCH_CONTROLLED_STUB');
  IF NOT COALESCE((v_svc->>'allowed')::bool, false) THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_svc->'blockers'); END IF;
  SELECT g.*, s.correlation_id AS snap_correlation INTO v_g
    FROM public.communication_controlled_live_grant g
    JOIN public.communication_preview_approval a ON a.id = g.preview_approval_id
    JOIN public.communication_preview_snapshot s ON s.id = a.snapshot_id
   WHERE g.id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_NOT_FOUND','message','Grant not found'))); END IF;
  IF v_g.status::text = 'CONSUMED' THEN RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status','CONSUMED','idempotent', true); END IF;
  IF v_g.status::text <> 'RESERVED' THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_STATE_INVALID','message','Not RESERVED',
      'detail', jsonb_build_object('status', v_g.status)))); END IF;
  IF v_g.execution_id IS DISTINCT FROM p_execution_id THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_EXECUTION_MISMATCH','message','Execution mismatch'))); END IF;
  IF p_expected_correlation_id IS NOT NULL AND v_g.snap_correlation IS DISTINCT FROM p_expected_correlation_id THEN
    RETURN jsonb_build_object('allowed', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','GRANT_CORRELATION_MISMATCH','message','Correlation mismatch'))); END IF;
  IF p_message_id IS NULL THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_MESSAGE_BINDING_MISMATCH','message','Message id required'))); END IF;
  SELECT controlled_live_execution_id INTO v_msg_exec FROM public.communication_message WHERE id = p_message_id;
  IF v_msg_exec IS DISTINCT FROM p_execution_id THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_MESSAGE_BINDING_MISMATCH','message','Message not bound to execution'))); END IF;
  SELECT count(*) INTO v_evidence_count FROM public.communication_delivery_attempt
   WHERE message_id = p_message_id AND attempt_type='controlled_live'
     AND provider_call_attempted=true
     AND provider_status IN ('PROVIDER_ACCEPTED','DELIVERY_PENDING','PROVIDER_REJECTED');
  IF v_evidence_count <> 1 THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','GRANT_MESSAGE_BINDING_MISMATCH',
      'message','Message must have exactly one durable provider-attempted attempt',
      'detail', jsonb_build_object('count', v_evidence_count)))); END IF;
  UPDATE public.communication_controlled_live_grant
     SET status='CONSUMED', consumed_at=now(), updated_at=now() WHERE id = v_g.id;
  RETURN jsonb_build_object('allowed', true, 'grant_id', v_g.id, 'status', 'CONSUMED');
END; $$;

CREATE OR REPLACE FUNCTION public.reconcile_comm_hub_controlled_live_pre_provider(
  p_grant_id uuid, p_execution_id uuid, p_message_id uuid,
  p_failure_stage text, p_failure_code text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_svc jsonb; v_g record; v_msg record; v_provider_seen int; v_grant_after text;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation('comm-hub-dispatch','DISPATCH_CONTROLLED_STUB');
  IF NOT COALESCE((v_svc->>'allowed')::bool, false) THEN
    RETURN jsonb_build_object('allowed', false, 'blockers', v_svc->'blockers'); END IF;
  SELECT count(*) INTO v_provider_seen FROM public.communication_delivery_attempt
   WHERE message_id = p_message_id AND attempt_type='controlled_live' AND provider_call_attempted=true;
  IF v_provider_seen > 0 THEN RETURN jsonb_build_object('allowed', false, 'blockers',
    jsonb_build_array(jsonb_build_object('code','PROVIDER_ALREADY_ATTEMPTED',
      'message','Cannot pre-provider reconcile after a provider call was attempted'))); END IF;
  SELECT * INTO v_g FROM public.communication_controlled_live_grant WHERE id = p_grant_id FOR UPDATE;
  IF FOUND AND v_g.execution_id = p_execution_id AND v_g.status::text IN ('ISSUED','RESERVED') THEN
    UPDATE public.communication_controlled_live_grant
       SET status='REVOKED', revoked_at=now(),
           revocation_reason=COALESCE(p_reason,'pre_provider_reconciliation'), updated_at=now()
     WHERE id = v_g.id;
    v_grant_after := 'REVOKED';
  ELSE v_grant_after := COALESCE(v_g.status::text, 'MISSING'); END IF;
  PERFORM set_config('comm_hub.allow_targeted_update', 'true', true);
  UPDATE public.communication_message
     SET status='failed', locked_at=NULL, locked_by=NULL,
         error_code=p_failure_code, error_message=LEFT(COALESCE(p_reason,''),500), updated_at=now()
   WHERE id = p_message_id RETURNING * INTO v_msg;
  RETURN jsonb_build_object('allowed', true, 'grant_status', v_grant_after,
    'message_status', COALESCE(v_msg.status,'missing'),
    'retry_safe', true, 'automatic_retry_allowed', false,
    'requires_new_execution', true, 'requires_new_grant', true,
    'failure_stage', p_failure_stage, 'failure_code', p_failure_code);
END; $$;

GRANT EXECUTE ON FUNCTION public.reserve_comm_hub_controlled_live_grant(uuid,uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_comm_hub_controlled_live_grant(uuid,uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_comm_hub_controlled_live_pre_provider(uuid,uuid,uuid,text,text,text) TO service_role;

INSERT INTO public.comm_hub_service_operation_allowlist(service_account, operation, reason, active)
VALUES ('comm-hub-dispatch','DISPATCH_CONTROLLED_STUB','Dispatcher reserves and consumes controlled stub grants', true)
ON CONFLICT (service_account, operation) DO UPDATE SET active = true;

UPDATE public.communication_controlled_live_grant
   SET status='REVOKED', revoked_at=now(),
       revocation_reason='pre_provider_reconciliation:revalidation_signature_repair', updated_at=now()
 WHERE id='85186bdc-cabf-428e-9ddd-2c84ba73dbd4' AND status IN ('ISSUED','RESERVED');

DO $reconcile$
BEGIN
  PERFORM set_config('comm_hub.allow_targeted_update', 'true', true);
  UPDATE public.communication_message
     SET status='failed', locked_at=NULL, locked_by=NULL,
         error_code='revalidation_exception',
         error_message='pre_provider_reconciliation:revalidation_signature_repair', updated_at=now()
   WHERE id='2e1b2f5e-8933-4b4b-80aa-7cca17b43fb5' AND status='sending';
END $reconcile$;
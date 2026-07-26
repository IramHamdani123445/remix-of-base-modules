
CREATE OR REPLACE FUNCTION public.assert_comm_hub_one_real_email_provider_boundary(
  p_execution_id uuid,
  p_grant_id uuid,
  p_message_id uuid,
  p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_svc jsonb;
  v_msg public.communication_message%ROWTYPE;
  v_grant public.communication_controlled_live_grant%ROWTYPE;
  v_attempt public.communication_delivery_attempt%ROWTYPE;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  v_svc := public._comm_hub_assert_bound_service_operation(
    'comm-hub-send-one-real-email','DISPATCH_ONE_REAL_EMAIL');
  IF NOT coalesce((v_svc->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'stage','authorisation',
      'blockers', v_svc->'blockers');
  END IF;

  SELECT * INTO v_msg FROM public.communication_message WHERE id = p_message_id;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_object('code','message_missing');
  ELSE
    IF v_msg.status <> 'sending' THEN
      v_blockers := v_blockers || jsonb_build_object('code','message_not_sending','detail',
        jsonb_build_object('status', v_msg.status)); END IF;
    IF v_msg.controlled_action IS DISTINCT FROM 'SEND_ONE_REAL_EMAIL' THEN
      v_blockers := v_blockers || jsonb_build_object('code','message_controlled_action_mismatch'); END IF;
    IF v_msg.send_context IS DISTINCT FROM 'controlled_live' THEN
      v_blockers := v_blockers || jsonb_build_object('code','message_send_context_mismatch'); END IF;
    IF v_msg.controlled_live_execution_id IS DISTINCT FROM p_execution_id THEN
      v_blockers := v_blockers || jsonb_build_object('code','message_execution_mismatch'); END IF;
    IF v_msg.controlled_live_grant_id IS DISTINCT FROM p_grant_id THEN
      v_blockers := v_blockers || jsonb_build_object('code','message_grant_mismatch'); END IF;
  END IF;

  SELECT * INTO v_grant FROM public.communication_controlled_live_grant WHERE id = p_grant_id;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_object('code','grant_missing');
  ELSE
    IF v_grant.status <> 'RESERVED' THEN
      v_blockers := v_blockers || jsonb_build_object('code','grant_not_reserved','detail',
        jsonb_build_object('status', v_grant.status)); END IF;
    IF v_grant.execution_id IS DISTINCT FROM p_execution_id THEN
      v_blockers := v_blockers || jsonb_build_object('code','grant_execution_mismatch'); END IF;
    IF v_grant.send_context <> 'REAL_EMAIL' THEN
      v_blockers := v_blockers || jsonb_build_object('code','grant_not_real_email'); END IF;
    IF v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now() THEN
      v_blockers := v_blockers || jsonb_build_object('code','grant_expired'); END IF;
  END IF;

  SELECT * INTO v_attempt FROM public.communication_delivery_attempt WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_object('code','attempt_missing');
  ELSE
    IF v_attempt.message_id IS DISTINCT FROM p_message_id THEN
      v_blockers := v_blockers || jsonb_build_object('code','attempt_message_mismatch'); END IF;
    IF v_attempt.status <> 'pending' THEN
      v_blockers := v_blockers || jsonb_build_object('code','attempt_not_pending','detail',
        jsonb_build_object('status', v_attempt.status)); END IF;
    IF v_attempt.provider_call_attempted IS TRUE THEN
      v_blockers := v_blockers || jsonb_build_object('code','attempt_provider_already_attempted'); END IF;
    IF v_attempt.grant_id IS DISTINCT FROM p_grant_id THEN
      v_blockers := v_blockers || jsonb_build_object('code','attempt_grant_mismatch'); END IF;
    IF v_attempt.controlled_live_execution_id IS DISTINCT FROM p_execution_id THEN
      v_blockers := v_blockers || jsonb_build_object('code','attempt_execution_mismatch'); END IF;
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'stage','provider_boundary', 'blockers', v_blockers);
  END IF;
  RETURN jsonb_build_object('ok', true, 'evaluated_at', now());
END $function$;

REVOKE ALL ON FUNCTION public.assert_comm_hub_one_real_email_provider_boundary(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_comm_hub_one_real_email_provider_boundary(uuid,uuid,uuid,uuid)
  TO service_role;

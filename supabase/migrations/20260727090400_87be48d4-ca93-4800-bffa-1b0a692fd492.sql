
CREATE OR REPLACE FUNCTION public.reserve_comm_hub_revalidation_send_authorisation(
  p_cycle_id uuid,
  p_authorisation_id uuid,
  p_current_fingerprint text,
  p_recipient_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public._chrc_require_admin();
  v_cycle record;
  v_auth record;
  v_ctrl record;
  v_event_cert record;
  v_recipient text := lower(trim(coalesce(p_recipient_email,'')));
BEGIN
  IF p_cycle_id IS NULL OR p_authorisation_id IS NULL THEN
    RAISE EXCEPTION 'cycle_and_authorisation_required';
  END IF;

  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
    WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;

  SELECT * INTO v_auth FROM public.communication_hub_revalidation_send_authorisation
    WHERE id = p_authorisation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorisation_not_found'; END IF;
  IF v_auth.cycle_id <> p_cycle_id THEN RAISE EXCEPTION 'authorisation_cycle_mismatch'; END IF;
  IF v_auth.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'authorisation_revoked'; END IF;
  IF v_auth.consumed_at IS NOT NULL THEN
    -- Idempotent recovery: only accept if the same execution was already recorded
    -- against this cycle. Do not allow a second provider call.
    IF v_cycle.status = 'PROVIDER_PROCESSING'::public.comm_hub_revalidation_status
       AND v_cycle.controlled_email_execution_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already_reserved', true,
        'cycle_id', v_cycle.id,
        'authorisation_id', v_auth.id,
        'module_code', v_cycle.module_code,
        'event_code', v_cycle.event_code,
        'channel', v_cycle.channel,
        'recipient_email', v_auth.recipient_email,
        'current_fingerprint', v_auth.bound_current_fingerprint,
        'event_certification_id', v_auth.bound_event_certification_id,
        'production_lineage_id', v_auth.bound_production_lineage_id,
        'baseline_ore_certification_id', v_cycle.baseline_ore_certification_id,
        'controlled_email_execution_id', v_cycle.controlled_email_execution_id
      );
    END IF;
    RAISE EXCEPTION 'authorisation_already_consumed';
  END IF;
  IF v_auth.expires_at <= now() THEN RAISE EXCEPTION 'authorisation_expired'; END IF;
  IF v_auth.bound_current_fingerprint IS DISTINCT FROM p_current_fingerprint THEN
    RAISE EXCEPTION 'fingerprint_mismatch';
  END IF;
  IF lower(trim(v_auth.recipient_email)) <> v_recipient THEN
    RAISE EXCEPTION 'recipient_mismatch';
  END IF;

  -- Cycle must be in EMAIL_AUTHORISED (or already PROVIDER_PROCESSING for recovery above).
  IF v_cycle.status <> 'EMAIL_AUTHORISED'::public.comm_hub_revalidation_status THEN
    RAISE EXCEPTION 'cycle_not_email_authorised: %', v_cycle.status;
  END IF;
  IF v_cycle.provider_call_attempted THEN
    RAISE EXCEPTION 'provider_call_already_attempted';
  END IF;
  IF v_cycle.controlled_email_execution_id IS NOT NULL THEN
    RAISE EXCEPTION 'provider_execution_already_exists';
  END IF;
  IF v_cycle.current_evidence_fingerprint_v2 IS DISTINCT FROM p_current_fingerprint THEN
    RAISE EXCEPTION 'cycle_fingerprint_drifted';
  END IF;

  -- Validate anchor integrity.
  IF v_auth.bound_event_certification_id IS DISTINCT FROM v_cycle.baseline_event_certification_id
     OR v_auth.bound_production_lineage_id IS DISTINCT FROM v_cycle.baseline_production_lineage_id THEN
    RAISE EXCEPTION 'anchor_binding_mismatch';
  END IF;

  SELECT id, status INTO v_event_cert FROM public.communication_hub_event_certification
    WHERE id = v_cycle.baseline_event_certification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_certification_not_found'; END IF;

  -- Mode / automation / batch / bulk gates.
  SELECT operating_mode, automation_state, batch_enabled, bulk_enabled
    INTO v_ctrl FROM public.communication_hub_control_settings LIMIT 1;
  IF v_ctrl.operating_mode = 'EMERGENCY_STOP' THEN RAISE EXCEPTION 'emergency_stop_active'; END IF;
  IF v_ctrl.automation_state = 'ARMED' THEN RAISE EXCEPTION 'automation_armed_blocks_revalidation'; END IF;
  IF v_ctrl.batch_enabled OR v_ctrl.bulk_enabled THEN RAISE EXCEPTION 'batch_or_bulk_enabled'; END IF;
  IF v_ctrl.operating_mode NOT IN ('MANUAL_PRODUCTION','AUTOMATED_PRODUCTION') THEN
    RAISE EXCEPTION 'invalid_operating_mode: %', v_ctrl.operating_mode;
  END IF;

  -- Transition cycle to PROVIDER_PROCESSING. Authorisation stays unconsumed
  -- until record_comm_hub_revalidation_provider_result marks it consumed.
  UPDATE public.communication_hub_revalidation_cycle
     SET status = 'PROVIDER_PROCESSING'::public.comm_hub_revalidation_status,
         updated_at = now()
   WHERE id = p_cycle_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_reserved', false,
    'cycle_id', v_cycle.id,
    'authorisation_id', v_auth.id,
    'module_code', v_cycle.module_code,
    'event_code', v_cycle.event_code,
    'channel', v_cycle.channel,
    'recipient_email', v_auth.recipient_email,
    'current_fingerprint', v_auth.bound_current_fingerprint,
    'event_certification_id', v_auth.bound_event_certification_id,
    'production_lineage_id', v_auth.bound_production_lineage_id,
    'baseline_ore_certification_id', v_cycle.baseline_ore_certification_id,
    'controlled_email_execution_id', null
  );
END $$;

GRANT EXECUTE ON FUNCTION public.reserve_comm_hub_revalidation_send_authorisation(uuid,uuid,text,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_comm_hub_revalidation_send_context(
  p_cycle_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public._chrc_require_admin();
  v_cycle record;
  v_auth record;
BEGIN
  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle WHERE id = p_cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;

  SELECT * INTO v_auth FROM public.communication_hub_revalidation_send_authorisation
    WHERE cycle_id = p_cycle_id
    ORDER BY issued_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'cycle_id', v_cycle.id,
    'cycle_status', v_cycle.status,
    'provider_call_attempted', v_cycle.provider_call_attempted,
    'controlled_email_execution_id', v_cycle.controlled_email_execution_id,
    'authorisation', CASE WHEN v_auth.id IS NULL THEN null ELSE jsonb_build_object(
      'id', v_auth.id,
      'recipient_email', v_auth.recipient_email,
      'issued_at', v_auth.issued_at,
      'expires_at', v_auth.expires_at,
      'consumed_at', v_auth.consumed_at,
      'consumed_execution_id', v_auth.consumed_execution_id,
      'revoked_at', v_auth.revoked_at
    ) END,
    'module_code', v_cycle.module_code,
    'event_code', v_cycle.event_code,
    'channel', v_cycle.channel,
    'inbox_confirmation_status', v_cycle.inbox_confirmation_status
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_comm_hub_revalidation_send_context(uuid)
  TO authenticated, service_role;

-- Checkpoint 0 remediation: void an empty Manual Production observation.
-- Immutable audit; refuses when real provider evidence exists.

CREATE OR REPLACE FUNCTION public.void_comm_hub_manual_production_observation(
  p_observation_id uuid,
  p_reason         text,
  p_confirmation   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_row    public.communication_manual_production_observation%ROWTYPE;
  v_before jsonb;
  v_after  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN
    RAISE EXCEPTION 'not_comm_hub_admin' USING ERRCODE = '42501';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'VOID EMPTY OBSERVATION' THEN
    RAISE EXCEPTION 'confirmation_phrase_mismatch' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.communication_manual_production_observation
  WHERE id = p_observation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'observation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'SUPERSEDED' THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true,
      'observation_id', v_row.id, 'status', v_row.status
    );
  END IF;

  -- Refuse when ANY real provider linkage exists. Only fully-empty
  -- observations may be voided this way.
  IF v_row.message_id IS NOT NULL
     OR v_row.request_id IS NOT NULL
     OR v_row.delivery_attempt_id IS NOT NULL
     OR v_row.trace_id IS NOT NULL
     OR v_row.provider_id IS NOT NULL
     OR v_row.provider_message_id IS NOT NULL
     OR v_row.dispatched_at IS NOT NULL
     OR coalesce(v_row.provider_call_attempted, false) = true
  THEN
    RAISE EXCEPTION 'observation_has_provider_evidence' USING ERRCODE = '42P17';
  END IF;

  v_before := to_jsonb(v_row);

  UPDATE public.communication_manual_production_observation
     SET status = 'SUPERSEDED',
         inbox_confirmation_status = NULL,
         inbox_confirmed_at        = NULL,
         inbox_confirmed_by        = NULL,
         inbox_confirmation_note   = left(
           coalesce(inbox_confirmation_note || E'\n', '') ||
           'SUPERSEDED by ' || v_uid::text || ' at ' || now()::text || ': ' || p_reason,
           4000),
         updated_at = now()
   WHERE id = p_observation_id
   RETURNING to_jsonb(communication_manual_production_observation.*) INTO v_after;

  INSERT INTO public.communication_hub_control_audit
    (setting_key, old_value, new_value, reason, changed_by, source)
  VALUES (
    'manual_production_observation.void',
    v_before,
    v_after,
    p_reason,
    v_uid,
    'void_comm_hub_manual_production_observation'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'observation_id', p_observation_id,
    'status', 'SUPERSEDED',
    'voided_by', v_uid,
    'voided_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.void_comm_hub_manual_production_observation(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_comm_hub_manual_production_observation(uuid, text, text) TO authenticated;
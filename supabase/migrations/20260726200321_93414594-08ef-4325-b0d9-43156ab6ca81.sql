-- 1. Extend intent phase constraint to include VOIDED (terminal).
ALTER TABLE public.communication_manual_production_observation_intent
  DROP CONSTRAINT IF EXISTS communication_manual_production_observation_intent_phase_check;
ALTER TABLE public.communication_manual_production_observation_intent
  ADD CONSTRAINT communication_manual_production_observation_intent_phase_check
  CHECK (phase = ANY (ARRAY[
    'ENQUEUED','AWAITING_PROVIDER','AWAITING_INBOX_CONFIRMATION',
    'CONFIRMED','NOT_RECEIVED','FAILED','VOIDED'
  ]));

-- 2. Rewrite the void RPC with authoritative provider-evidence predicate
--    and atomic intent reconciliation.
CREATE OR REPLACE FUNCTION public.void_comm_hub_manual_production_observation(
  p_observation_id uuid,
  p_reason         text,
  p_confirmation   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_row       public.communication_manual_production_observation%ROWTYPE;
  v_intent    public.communication_manual_production_observation_intent%ROWTYPE;
  v_before    jsonb;
  v_after     jsonb;
  v_audit_id  uuid;
  v_attempt_exists boolean := false;
  v_request_exists boolean := false;
  v_message_exists boolean := false;
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
      'observation_id', v_row.id,
      'observation_status', v_row.status,
      'provider_evidence_found', false
    );
  END IF;

  -- Authoritative provider-evidence checks. dispatched_at is NOT NULL
  -- DEFAULT now(), so it MUST NOT be used to infer provider contact.
  IF v_row.request_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.communication_requests WHERE id = v_row.request_id)
      INTO v_request_exists;
  END IF;
  IF v_row.message_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.communication_messages WHERE id = v_row.message_id)
      INTO v_message_exists;
  END IF;
  IF v_row.message_id IS NOT NULL OR v_row.delivery_attempt_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.communication_delivery_attempts a
       WHERE (v_row.delivery_attempt_id IS NOT NULL AND a.id = v_row.delivery_attempt_id)
          OR (v_row.message_id IS NOT NULL AND a.message_id = v_row.message_id)
    ) INTO v_attempt_exists;
  END IF;

  IF v_request_exists
     OR v_message_exists
     OR v_attempt_exists
     OR v_row.delivery_attempt_id IS NOT NULL
     OR v_row.trace_id IS NOT NULL
     OR v_row.provider_id IS NOT NULL
     OR coalesce(btrim(v_row.provider_message_id), '') <> ''
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

  -- Reconcile the related intent atomically. Match by finalized_observation_id
  -- or by the observation's idempotency key.
  SELECT * INTO v_intent
    FROM public.communication_manual_production_observation_intent
   WHERE finalized_observation_id = p_observation_id
      OR idempotency_key = v_row.idempotency_key
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_intent.phase NOT IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED') THEN
    UPDATE public.communication_manual_production_observation_intent
       SET phase = 'VOIDED',
           last_error = left('voided_empty_observation: ' || p_reason, 4000),
           updated_at = now()
     WHERE idempotency_key = v_intent.idempotency_key;
  END IF;

  INSERT INTO public.communication_hub_control_audit
    (setting_key, old_value, new_value, reason, changed_by, source)
  VALUES (
    'manual_production_observation.void',
    v_before,
    v_after,
    p_reason,
    v_uid,
    'void_comm_hub_manual_production_observation'
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'observation_id', p_observation_id,
    'observation_status', 'SUPERSEDED',
    'intent_idempotency_key', v_intent.idempotency_key,
    'intent_phase', CASE WHEN v_intent.idempotency_key IS NULL THEN NULL ELSE 'VOIDED' END,
    'provider_evidence_found', false,
    'audit_id', v_audit_id,
    'voided_by', v_uid,
    'voided_at', now()
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.void_comm_hub_manual_production_observation(uuid, text, text) TO authenticated;

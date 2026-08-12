CREATE OR REPLACE FUNCTION public.omni_comms_priv_request_never_dispatched(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.omni_comms_message x WHERE x.request_id = p_request_id)
     AND NOT EXISTS (SELECT 1 FROM public.omni_comms_dispatch_job x WHERE x.request_id = p_request_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.omni_comms_delivery_attempt a
        WHERE a.dispatch_job_id IN (
          SELECT j.id FROM public.omni_comms_dispatch_job j WHERE j.request_id = p_request_id));
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_request_never_dispatched(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_request_never_dispatched(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_request_never_dispatched(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_request_never_dispatched(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_request_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx text;
  v_recovery boolean := false;
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(NEW.department_id, NEW.organization_id);
  END IF;
  PERFORM public.omni_comms_priv_require_json_object(NEW.payload_snapshot, 262144);
  PERFORM public.omni_comms_priv_validate_channel_array(NEW.requested_channels);
  IF jsonb_typeof(NEW.blockers) <> 'array' THEN
    RAISE EXCEPTION 'OC422 blockers_must_be_array' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_ctx := current_setting('omni_comms.recovery_request_id', true);
    v_recovery := v_ctx IS NOT NULL AND v_ctx <> '' AND v_ctx = OLD.id::text;

    IF v_recovery THEN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.event_definition_id IS DISTINCT FROM OLD.event_definition_id
         OR NEW.mode IS DISTINCT FROM OLD.mode
         OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
         OR NEW.caller_module_code IS DISTINCT FROM OLD.caller_module_code
         OR NEW.caller_entity_type IS DISTINCT FROM OLD.caller_entity_type
         OR NEW.caller_entity_id IS DISTINCT FROM OLD.caller_entity_id
         OR NEW.department_id IS DISTINCT FROM OLD.department_id
         OR NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot
         OR NEW.requested_channels IS DISTINCT FROM OLD.requested_channels
         OR NEW.producer_event_binding_id IS DISTINCT FROM OLD.producer_event_binding_id
         OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'OC422 request_immutable_fields' USING ERRCODE = 'P0001';
      END IF;
      IF NOT (OLD.status IN ('failed','blocked') AND NEW.status = 'accepted') THEN
        RAISE EXCEPTION 'OC422 invalid_request_transition' USING ERRCODE = 'P0001';
      END IF;
      IF NOT public.omni_comms_priv_request_never_dispatched(OLD.id) THEN
        RAISE EXCEPTION 'OC409 abandoned_request_materialised' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.event_definition_id IS DISTINCT FROM OLD.event_definition_id
       OR NEW.mode IS DISTINCT FROM OLD.mode
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
       OR NEW.caller_module_code IS DISTINCT FROM OLD.caller_module_code
       OR NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot THEN
      RAISE EXCEPTION 'OC422 request_immutable_fields' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'accepted'   AND NEW.status IN ('processing','failed','blocked')) OR
        (OLD.status = 'processing' AND NEW.status IN ('completed','completed_with_blockers','blocked','failed'))
      ) THEN
        RAISE EXCEPTION 'OC422 invalid_request_transition' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_recover_request(p_request_id uuid, p_new_fingerprint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.omni_comms_request;
  v_recipients integer := 0;
BEGIN
  SELECT * INTO v_req FROM public.omni_comms_request WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_req.status NOT IN ('failed','blocked')
     OR NOT public.omni_comms_priv_request_never_dispatched(p_request_id) THEN
    RAISE EXCEPTION 'OC409 request_not_recoverable' USING ERRCODE='P0001';
  END IF;

  SELECT count(*) INTO v_recipients
    FROM public.omni_comms_recipient WHERE request_id = p_request_id;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id
  ) VALUES (
    p_request_id, NULL, v_req.organization_id, 'request_recovered',
    public.omni_comms_priv_next_event_sequence(p_request_id),
    v_req.status, 'accepted',
    jsonb_build_object(
      'previous_status', v_req.status,
      'previous_request_fingerprint', v_req.request_fingerprint,
      'previous_blockers', coalesce(v_req.blockers, '[]'::jsonb),
      'purged_recipient_count', v_recipients,
      'recovered_at', now(),
      'trusted_actor_type', 'runtime_service'),
    v_req.correlation_id, 'system', 'omni_comms_runtime'
  );

  DELETE FROM public.omni_comms_recipient WHERE request_id = p_request_id;

  PERFORM set_config('omni_comms.recovery_request_id', p_request_id::text, true);
  UPDATE public.omni_comms_request
     SET status = 'accepted',
         request_fingerprint = p_new_fingerprint,
         blockers = '[]'::jsonb,
         failed_at = NULL,
         accepted_at = now(),
         updated_at = now()
   WHERE id = p_request_id;
  PERFORM set_config('omni_comms.recovery_request_id', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_recover_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_recover_request(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_recover_request(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_recover_request(uuid, text) TO service_role;

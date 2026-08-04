-- =====================================================================
-- Benefits shared communication adapter — terminal-state hardening.
-- CANCELLED / DELIVERED / FAILED become genuinely terminal across
-- dispatch, failure recording and Hub synchronisation.
-- =====================================================================

CREATE OR REPLACE FUNCTION public._bn_comm_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE COALESCE(NULLIF(btrim(p_from),''),'PENDING')
    WHEN 'PENDING'    THEN p_to IN ('PENDING','RETRY','REQUESTED','FAILED','CANCELLED')
    WHEN 'RETRY'      THEN p_to IN ('RETRY','REQUESTED','FAILED','CANCELLED')
    WHEN 'REQUESTED'  THEN p_to IN ('REQUESTED','QUEUED','DISPATCHED','DELIVERED','FAILED','CANCELLED')
    WHEN 'QUEUED'     THEN p_to IN ('QUEUED','DISPATCHED','DELIVERED','FAILED','CANCELLED')
    WHEN 'DISPATCHED' THEN p_to IN ('DISPATCHED','DELIVERED','FAILED','CANCELLED')
    WHEN 'DELIVERED'  THEN p_to = 'DELIVERED'
    WHEN 'FAILED'     THEN p_to = 'FAILED'
    WHEN 'CANCELLED'  THEN p_to = 'CANCELLED'
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public._bn_comm_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_comm_transition_allowed(text, text) TO service_role;

-- ---------------------------------------------------------------------
-- Dispatch: cancellation-safe, terminal-safe, race-safe.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_communication_adapter_dispatch_v1(p_source_module text, p_source_intent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_intent public.bn_life_certificate_communication_intent%ROWTYPE;
  v_claim uuid; v_email text; v_phone text; v_name text;
  v_key text; v_req_id uuid; v_disp public.bn_communication_dispatch%ROWTYPE;
  v_channels text[]; v_entity uuid; v_src public.bn_communication_adapter_source%ROWTYPE;
  v_status text;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_src FROM public.bn_communication_adapter_source
   WHERE source_module = p_source_module AND is_enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_UNSUPPORTED_SOURCE_MODULE' USING ERRCODE='P0001'; END IF;
  IF v_src.source_table <> 'bn_life_certificate_communication_intent' THEN
    RAISE EXCEPTION 'E_UNSUPPORTED_SOURCE_MODULE' USING ERRCODE='P0001'; END IF;

  -- The row lock is taken before the status is read, so a cancellation that
  -- lands between pending-feed selection and dispatch is still honoured.
  SELECT * INTO v_intent FROM public.bn_life_certificate_communication_intent
   WHERE id = p_source_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_INTENT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  v_entity := v_intent.life_certificate_id;
  v_status := COALESCE(NULLIF(btrim(v_intent.delivery_status),''),'PENDING');

  v_key := 'bn-comm:'||p_source_module||':'||p_source_intent_id::text;

  SELECT * INTO v_disp FROM public.bn_communication_dispatch
   WHERE source_module = p_source_module AND source_intent_id = p_source_intent_id;

  -- A request that already exists is replayed verbatim — except when the
  -- intent was cancelled before any request was ever created.
  IF FOUND AND v_disp.communication_request_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','REPLAYED','communication_request_id', v_disp.communication_request_id,
                              'dispatch_key', v_disp.dispatch_key,
                              'intent_status', v_status);
  END IF;

  IF v_status = 'CANCELLED' THEN
    RETURN jsonb_build_object('status','NO_OP','error_code','E_INTENT_CANCELLED',
                              'intent_status','CANCELLED','dispatch_key', v_key);
  END IF;

  IF v_status = 'DELIVERED' THEN
    RETURN jsonb_build_object('status','NO_OP','error_code','E_INTENT_ALREADY_DELIVERED',
                              'intent_status','DELIVERED',
                              'communication_request_id', v_intent.delivery_reference,
                              'dispatch_key', v_key);
  END IF;

  IF v_status = 'FAILED' THEN
    -- Terminal failure requires an explicit, approved manual recovery that
    -- resets the intent to RETRY; the runner must never resurrect it.
    RETURN jsonb_build_object('status','NO_OP','error_code','E_INTENT_TERMINAL_FAILED',
                              'intent_status','FAILED','dispatch_key', v_key);
  END IF;

  IF v_status NOT IN ('PENDING','RETRY') THEN
    RETURN jsonb_build_object('status','NO_OP','error_code','E_INTENT_NOT_DISPATCHABLE',
                              'intent_status', v_status, 'dispatch_key', v_key);
  END IF;

  SELECT a.bn_claim_id INTO v_claim FROM public.bn_award a WHERE a.id = v_intent.bn_award_id;
  SELECT c.contact_email, c.contact_phone INTO v_email, v_phone
    FROM public.bn_claim c WHERE c.id = v_claim;
  IF v_email IS NULL AND v_phone IS NULL THEN
    SELECT p.email, p.phone, p.display_name INTO v_email, v_phone, v_name
      FROM public.bn_claim_participant p
     WHERE p.claim_id = v_claim AND COALESCE(p.is_primary_applicant,false)
     ORDER BY p.created_at LIMIT 1;
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    UPDATE public.bn_life_certificate_communication_intent
       SET delivery_status='FAILED', last_error_code='E_NO_APPROVED_CONTACT',
           attempts = COALESCE(attempts,0)+1, updated_at = now()
     WHERE id = p_source_intent_id
       AND public._bn_comm_transition_allowed(COALESCE(delivery_status,'PENDING'),'FAILED');
    RETURN jsonb_build_object('status','FAILED','error_code','E_NO_APPROVED_CONTACT');
  END IF;

  v_channels := CASE WHEN v_email IS NOT NULL THEN ARRAY['email'] ELSE ARRAY['sms'] END;

  INSERT INTO public.communication_request
    (request_no, module_code, department_code, event_code, entity_type, entity_id,
     reference_no, channels, priority, status, payload, context, idempotency_key,
     business_event_id, business_event_type)
  VALUES ('BNCOMM-'||to_char(now(),'YYYYMMDDHH24MISS')||'-'||substr(md5(v_key),1,8),
          'BENEFITS', 'BENEFITS', v_intent.event_code,
          p_source_module, v_entity::text, v_intent.correlation_id,
          v_channels, 'normal', 'pending',
          jsonb_build_object('event_code', v_intent.event_code,
                             'source_module', p_source_module,
                             'source_entity_id', v_entity,
                             'context', COALESCE(v_intent.context,'{}'::jsonb)),
          jsonb_build_object('source_module', p_source_module,
                             'source_table', v_src.source_table,
                             'source_intent_id', p_source_intent_id,
                             'correlation_id', v_intent.correlation_id),
          v_key, v_intent.correlation_id, v_intent.event_code)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_req_id;

  IF v_req_id IS NULL THEN
    SELECT id INTO v_req_id FROM public.communication_request WHERE idempotency_key = v_key;
  ELSE
    INSERT INTO public.communication_recipient (request_id, role, recipient_type, name, email, phone)
    VALUES (v_req_id, 'to', 'CLAIMANT', v_name, v_email, v_phone);
  END IF;

  INSERT INTO public.bn_communication_dispatch
    (source_module, source_table, source_intent_id, source_entity_id, event_code,
     correlation_id, dispatch_key, communication_request_id, status, attempts)
  VALUES (p_source_module, v_src.source_table, p_source_intent_id,
          v_entity, v_intent.event_code, v_intent.correlation_id, v_key, v_req_id, 'REQUESTED', 1)
  ON CONFLICT (source_module, source_intent_id) DO UPDATE
    SET communication_request_id = COALESCE(public.bn_communication_dispatch.communication_request_id, EXCLUDED.communication_request_id),
        attempts = public.bn_communication_dispatch.attempts + 1,
        status = 'REQUESTED', last_error_code = NULL, updated_at = now();

  UPDATE public.bn_life_certificate_communication_intent
     SET delivery_status = 'REQUESTED', delivery_reference = v_req_id::text,
         attempts = COALESCE(attempts,0)+1, last_error_code = NULL, updated_at = now()
   WHERE id = p_source_intent_id
     AND public._bn_comm_transition_allowed(COALESCE(delivery_status,'PENDING'),'REQUESTED');

  RETURN jsonb_build_object('status','DISPATCHED','communication_request_id', v_req_id,
                            'dispatch_key', v_key, 'event_code', v_intent.event_code);
END $function$;

-- ---------------------------------------------------------------------
-- Failure recording: terminal states are preserved untouched.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_communication_adapter_record_failure_v1(p_source_module text, p_source_intent_id uuid, p_error_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_safe text := COALESCE(substring(COALESCE(p_error_code,'') from 'E_[A-Z_]+'),'E_UNKNOWN');
  v_intent public.bn_life_certificate_communication_intent%ROWTYPE;
  v_status text; v_next text; v_attempts integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  IF p_source_module IS DISTINCT FROM 'BN_LIFE_CERTIFICATE' THEN
    RETURN jsonb_build_object('status','NO_OP','error_code','E_UNSUPPORTED_SOURCE_MODULE');
  END IF;

  SELECT * INTO v_intent FROM public.bn_life_certificate_communication_intent
   WHERE id = p_source_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NO_OP','error_code','E_INTENT_NOT_FOUND');
  END IF;

  v_status := COALESCE(NULLIF(btrim(v_intent.delivery_status),''),'PENDING');

  IF v_status IN ('CANCELLED','DELIVERED','FAILED') THEN
    -- Terminal evidence, delivery status and delivery reference are preserved.
    RETURN jsonb_build_object('status','NO_OP','error_code',
                              CASE v_status WHEN 'CANCELLED' THEN 'E_INTENT_CANCELLED'
                                            WHEN 'DELIVERED' THEN 'E_INTENT_ALREADY_DELIVERED'
                                            ELSE 'E_INTENT_TERMINAL_FAILED' END,
                              'intent_status', v_status,
                              'attempts', COALESCE(v_intent.attempts,0));
  END IF;

  v_attempts := COALESCE(v_intent.attempts,0) + 1;
  v_next := CASE WHEN v_attempts >= 5 THEN 'FAILED' ELSE 'RETRY' END;
  IF NOT public._bn_comm_transition_allowed(v_status, v_next) THEN
    RETURN jsonb_build_object('status','NO_OP','error_code','E_INTENT_TRANSITION_BLOCKED',
                              'intent_status', v_status,
                              'attempts', COALESCE(v_intent.attempts,0));
  END IF;

  UPDATE public.bn_life_certificate_communication_intent
     SET attempts = v_attempts, last_error_code = v_safe,
         delivery_status = v_next, updated_at = now()
   WHERE id = p_source_intent_id;

  RETURN jsonb_build_object('status','RECORDED','error_code', v_safe,
                            'intent_status', v_next, 'attempts', v_attempts);
END $function$;

-- ---------------------------------------------------------------------
-- Synchronisation: monotonic, guarded by the transition matrix.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_communication_adapter_sync_v1(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_synced integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  WITH src AS (
    SELECT d.id AS dispatch_id, d.source_intent_id, d.status AS dispatch_status,
           public._bn_comm_map_hub_status(r.status) AS mapped
      FROM public.bn_communication_dispatch d
      JOIN public.communication_request r ON r.id = d.communication_request_id
     WHERE d.source_module = 'BN_LIFE_CERTIFICATE'
     ORDER BY d.updated_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),500)
  ), upd_d AS (
    UPDATE public.bn_communication_dispatch d
       SET status = s.mapped, updated_at = now()
      FROM src s
     WHERE d.id = s.dispatch_id
       AND d.status IS DISTINCT FROM s.mapped
       AND public._bn_comm_transition_allowed(COALESCE(d.status,'PENDING'), s.mapped)
    RETURNING d.id
  ), upd_i AS (
    UPDATE public.bn_life_certificate_communication_intent i
       SET delivery_status = s.mapped, updated_at = now()
      FROM src s
     WHERE i.id = s.source_intent_id
       AND i.delivery_status IS DISTINCT FROM s.mapped
       AND public._bn_comm_transition_allowed(COALESCE(i.delivery_status,'PENDING'), s.mapped)
    RETURNING i.id
  )
  SELECT (SELECT count(*) FROM upd_i) INTO v_synced;

  RETURN jsonb_build_object('status','SYNCED','synced', v_synced);
END $function$;

REVOKE ALL ON FUNCTION public.bn_communication_adapter_dispatch_v1(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_communication_adapter_record_failure_v1(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_communication_adapter_sync_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_communication_adapter_dispatch_v1(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bn_communication_adapter_record_failure_v1(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bn_communication_adapter_sync_v1(integer) TO service_role;
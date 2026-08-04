-- ═══════════════════════════════════════════════════════════════════════
-- Shared Benefits → Communication Hub adapter (reusable across BN modules)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bn_communication_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_module text NOT NULL,
  source_table text NOT NULL,
  source_intent_id uuid NOT NULL,
  source_entity_id uuid,
  event_code text NOT NULL,
  correlation_id text,
  dispatch_key text NOT NULL,
  communication_request_id uuid REFERENCES public.communication_request(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'REQUESTED',
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_communication_dispatch_key_uq UNIQUE (dispatch_key),
  CONSTRAINT bn_communication_dispatch_source_uq UNIQUE (source_module, source_intent_id)
);

REVOKE ALL ON public.bn_communication_dispatch FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bn_communication_dispatch TO service_role;
ALTER TABLE public.bn_communication_dispatch ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS bn_communication_dispatch_status_idx
  ON public.bn_communication_dispatch (status, created_at);

-- ── Pending intent feed (union of module outboxes) ────────────────────
CREATE OR REPLACE FUNCTION public.bn_communication_adapter_pending_v1(p_limit integer DEFAULT 50)
RETURNS TABLE(source_module text, source_table text, source_intent_id uuid, source_entity_id uuid,
              bn_award_id uuid, event_code text, correlation_id text, context jsonb, attempts integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  RETURN QUERY
  SELECT 'BN_LIFE_CERTIFICATE'::text, 'bn_life_certificate_communication_intent'::text,
         i.id, i.life_certificate_id, i.bn_award_id, i.event_code, i.correlation_id,
         COALESCE(i.context,'{}'::jsonb), COALESCE(i.attempts,0)
    FROM public.bn_life_certificate_communication_intent i
    LEFT JOIN public.bn_communication_dispatch d
      ON d.source_module = 'BN_LIFE_CERTIFICATE' AND d.source_intent_id = i.id
   WHERE d.id IS NULL
     AND COALESCE(i.delivery_status,'PENDING') IN ('PENDING','RETRY')
     AND COALESCE(i.attempts,0) < 5
   ORDER BY i.created_at
   LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),200);
END $function$;

REVOKE ALL ON FUNCTION public.bn_communication_adapter_pending_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_communication_adapter_pending_v1(integer) TO service_role;

-- ── Dispatch one intent into the shared communication boundary ────────
CREATE OR REPLACE FUNCTION public.bn_communication_adapter_dispatch_v1(
  p_source_module text, p_source_intent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_intent public.bn_life_certificate_communication_intent%ROWTYPE;
  v_claim uuid; v_email text; v_phone text; v_name text;
  v_key text; v_req_id uuid; v_disp public.bn_communication_dispatch%ROWTYPE;
  v_channels text[]; v_entity uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF p_source_module <> 'BN_LIFE_CERTIFICATE' THEN
    RAISE EXCEPTION 'E_UNSUPPORTED_SOURCE_MODULE' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_intent FROM public.bn_life_certificate_communication_intent
   WHERE id = p_source_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_INTENT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  v_entity := v_intent.life_certificate_id;

  -- Deterministic identity: the same intent can never produce two requests.
  v_key := 'bn-comm:'||p_source_module||':'||p_source_intent_id::text;

  SELECT * INTO v_disp FROM public.bn_communication_dispatch
   WHERE source_module = p_source_module AND source_intent_id = p_source_intent_id;
  IF FOUND AND v_disp.communication_request_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','REPLAYED','communication_request_id', v_disp.communication_request_id,
                              'dispatch_key', v_disp.dispatch_key);
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
     WHERE id = p_source_intent_id;
    RETURN jsonb_build_object('status','FAILED','error_code','E_NO_APPROVED_CONTACT');
  END IF;

  v_channels := CASE WHEN v_email IS NOT NULL THEN ARRAY['email'] ELSE ARRAY['sms'] END;

  -- Template, branding, sender and dispatch remain owned by the hub.
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
                             'source_table', 'bn_life_certificate_communication_intent',
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
  VALUES (p_source_module, 'bn_life_certificate_communication_intent', p_source_intent_id,
          v_entity, v_intent.event_code, v_intent.correlation_id, v_key, v_req_id, 'REQUESTED', 1)
  ON CONFLICT (source_module, source_intent_id) DO UPDATE
    SET communication_request_id = COALESCE(public.bn_communication_dispatch.communication_request_id, EXCLUDED.communication_request_id),
        attempts = public.bn_communication_dispatch.attempts + 1,
        status = 'REQUESTED', last_error_code = NULL, updated_at = now();

  UPDATE public.bn_life_certificate_communication_intent
     SET delivery_status = 'REQUESTED', delivery_reference = v_req_id::text,
         attempts = COALESCE(attempts,0)+1, last_error_code = NULL, updated_at = now()
   WHERE id = p_source_intent_id;

  RETURN jsonb_build_object('status','DISPATCHED','communication_request_id', v_req_id,
                            'dispatch_key', v_key, 'event_code', v_intent.event_code);
END $function$;

REVOKE ALL ON FUNCTION public.bn_communication_adapter_dispatch_v1(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_communication_adapter_dispatch_v1(text, uuid) TO service_role;

-- ── Sanitised failure recording (never alters obligation state) ───────
CREATE OR REPLACE FUNCTION public.bn_communication_adapter_record_failure_v1(
  p_source_module text, p_source_intent_id uuid, p_error_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_safe text := COALESCE(substring(COALESCE(p_error_code,'') from 'E_[A-Z_]+'),'E_UNKNOWN');
        v_attempts integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  UPDATE public.bn_life_certificate_communication_intent
     SET attempts = COALESCE(attempts,0)+1, last_error_code = v_safe,
         delivery_status = CASE WHEN COALESCE(attempts,0)+1 >= 5 THEN 'FAILED' ELSE 'RETRY' END,
         updated_at = now()
   WHERE id = p_source_intent_id AND p_source_module = 'BN_LIFE_CERTIFICATE'
   RETURNING attempts INTO v_attempts;

  RETURN jsonb_build_object('error_code', v_safe, 'attempts', COALESCE(v_attempts,0));
END $function$;

REVOKE ALL ON FUNCTION public.bn_communication_adapter_record_failure_v1(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_communication_adapter_record_failure_v1(text, uuid, text) TO service_role;

-- ── Status synchronisation back into the module outbox ────────────────
CREATE OR REPLACE FUNCTION public.bn_communication_adapter_sync_v1(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_synced integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  WITH src AS (
    SELECT d.id AS dispatch_id, d.source_intent_id, r.status
      FROM public.bn_communication_dispatch d
      JOIN public.communication_request r ON r.id = d.communication_request_id
     WHERE d.source_module = 'BN_LIFE_CERTIFICATE'
     ORDER BY d.updated_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),500)
  ), upd_d AS (
    UPDATE public.bn_communication_dispatch d
       SET status = upper(s.status), updated_at = now()
      FROM src s WHERE d.id = s.dispatch_id AND d.status IS DISTINCT FROM upper(s.status)
    RETURNING d.id
  ), upd_i AS (
    UPDATE public.bn_life_certificate_communication_intent i
       SET delivery_status = upper(s.status), updated_at = now()
      FROM src s WHERE i.id = s.source_intent_id AND i.delivery_status IS DISTINCT FROM upper(s.status)
    RETURNING i.id
  )
  SELECT (SELECT count(*) FROM upd_i) INTO v_synced;

  RETURN jsonb_build_object('status','SYNCED','synced', v_synced);
END $function$;

REVOKE ALL ON FUNCTION public.bn_communication_adapter_sync_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_communication_adapter_sync_v1(integer) TO service_role;

-- =====================================================================
-- BN Life Certificates — navigation/communication closure
-- =====================================================================

-- 1. Canonical communication intent status model -----------------------
ALTER TABLE public.bn_life_certificate_communication_intent
  DROP CONSTRAINT IF EXISTS bn_lc_comm_delivery_status_chk;

UPDATE public.bn_life_certificate_communication_intent
   SET delivery_status = CASE upper(COALESCE(delivery_status,'PENDING'))
     WHEN 'PENDING' THEN 'PENDING'
     WHEN 'RETRY' THEN 'RETRY'
     WHEN 'REQUESTED' THEN 'REQUESTED'
     WHEN 'QUEUED' THEN 'QUEUED'
     WHEN 'DISPATCHED' THEN 'DISPATCHED'
     WHEN 'DELIVERED' THEN 'DELIVERED'
     WHEN 'FAILED' THEN 'FAILED'
     WHEN 'CANCELLED' THEN 'CANCELLED'
     ELSE 'REQUESTED' END
 WHERE upper(COALESCE(delivery_status,'PENDING')) NOT IN
   ('PENDING','RETRY','REQUESTED','QUEUED','DISPATCHED','DELIVERED','FAILED','CANCELLED');

ALTER TABLE public.bn_life_certificate_communication_intent
  ADD CONSTRAINT bn_lc_comm_delivery_status_chk
  CHECK (delivery_status = ANY (ARRAY[
    'PENDING','RETRY','REQUESTED','QUEUED','DISPATCHED','DELIVERED','FAILED','CANCELLED']));

DROP INDEX IF EXISTS public.ix_bn_lc_comm_pending;
CREATE INDEX IF NOT EXISTS ix_bn_lc_comm_actionable
  ON public.bn_life_certificate_communication_intent (delivery_status, created_at)
  WHERE delivery_status IN ('PENDING','RETRY');

-- 2. Explicit hub-status → Benefits-intent mapping ---------------------
CREATE OR REPLACE FUNCTION public._bn_comm_map_hub_status(p_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE lower(btrim(COALESCE(p_status,'')))
    WHEN 'pending'    THEN 'REQUESTED'
    WHEN 'created'    THEN 'REQUESTED'
    WHEN 'accepted'   THEN 'REQUESTED'
    WHEN 'queued'     THEN 'QUEUED'
    WHEN 'processing' THEN 'QUEUED'
    WHEN 'sending'    THEN 'QUEUED'
    WHEN 'sent'       THEN 'DISPATCHED'
    WHEN 'dispatched' THEN 'DISPATCHED'
    WHEN 'delivered'  THEN 'DELIVERED'
    WHEN 'completed'  THEN 'DELIVERED'
    WHEN 'failed'     THEN 'FAILED'
    WHEN 'error'      THEN 'FAILED'
    WHEN 'bounced'    THEN 'FAILED'
    WHEN 'rejected'   THEN 'FAILED'
    WHEN 'cancelled'  THEN 'CANCELLED'
    WHEN 'canceled'   THEN 'CANCELLED'
    ELSE 'REQUESTED'
  END
$$;
REVOKE ALL ON FUNCTION public._bn_comm_map_hub_status(text) FROM PUBLIC, anon, authenticated;

-- 3. Adapter source registry (extension point for later modules) -------
CREATE TABLE IF NOT EXISTS public.bn_communication_adapter_source (
  source_module text PRIMARY KEY,
  source_table  text NOT NULL,
  is_enabled    boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bn_communication_adapter_source TO service_role;
REVOKE ALL ON public.bn_communication_adapter_source FROM PUBLIC, anon, authenticated;
ALTER TABLE public.bn_communication_adapter_source ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bn_communication_adapter_source (source_module, source_table, is_enabled, notes)
VALUES ('BN_LIFE_CERTIFICATE','bn_life_certificate_communication_intent', true,
        'Only operational Benefits source. Other modules must register here before dispatch is supported.')
ON CONFLICT (source_module) DO UPDATE
  SET source_table = EXCLUDED.source_table, updated_at = now();

-- 4. Dispatch: validate the source through the registry ----------------
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
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_src FROM public.bn_communication_adapter_source
   WHERE source_module = p_source_module AND is_enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_UNSUPPORTED_SOURCE_MODULE' USING ERRCODE='P0001'; END IF;
  -- Only the Life Certificate outbox has a physical dispatch implementation.
  IF v_src.source_table <> 'bn_life_certificate_communication_intent' THEN
    RAISE EXCEPTION 'E_UNSUPPORTED_SOURCE_MODULE' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_intent FROM public.bn_life_certificate_communication_intent
   WHERE id = p_source_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_INTENT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  v_entity := v_intent.life_certificate_id;

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
   WHERE id = p_source_intent_id;

  RETURN jsonb_build_object('status','DISPATCHED','communication_request_id', v_req_id,
                            'dispatch_key', v_key, 'event_code', v_intent.event_code);
END $function$;

-- 5. Sync: canonical mapping instead of upper(status) ------------------
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
    SELECT d.id AS dispatch_id, d.source_intent_id,
           public._bn_comm_map_hub_status(r.status) AS mapped
      FROM public.bn_communication_dispatch d
      JOIN public.communication_request r ON r.id = d.communication_request_id
     WHERE d.source_module = 'BN_LIFE_CERTIFICATE'
     ORDER BY d.updated_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),500)
  ), upd_d AS (
    UPDATE public.bn_communication_dispatch d
       SET status = s.mapped, updated_at = now()
      FROM src s WHERE d.id = s.dispatch_id AND d.status IS DISTINCT FROM s.mapped
    RETURNING d.id
  ), upd_i AS (
    UPDATE public.bn_life_certificate_communication_intent i
       SET delivery_status = s.mapped, updated_at = now()
      FROM src s
     WHERE i.id = s.source_intent_id
       AND i.delivery_status IS DISTINCT FROM s.mapped
       AND i.delivery_status NOT IN ('CANCELLED')
    RETURNING i.id
  )
  SELECT (SELECT count(*) FROM upd_i) INTO v_synced;

  RETURN jsonb_build_object('status','SYNCED','synced', v_synced);
END $function$;

-- 6. Award-filtered worklist (additive v2) -----------------------------
CREATE OR REPLACE FUNCTION public.bn_life_certificate_worklist_v2(
  p_bucket text DEFAULT 'ALL',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_award_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid; v_limit integer := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
        v_rows jsonb; v_total bigint; v_search text := NULLIF(btrim(COALESCE(p_search,'')),'');
        v_reveal boolean; v_pattern text; v_award record; v_visible integer;
        v_award_ctx jsonb := NULL;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  v_reveal := public.has_permission(v_actor,'bn_life_certificate','view_sensitive_identity')
              OR public.is_admin(v_actor);

  IF v_search IS NOT NULL AND length(v_search) < 4 THEN
    RAISE EXCEPTION 'E_SEARCH_TOO_SHORT' USING ERRCODE='P0001';
  END IF;
  v_pattern := CASE WHEN v_search IS NULL THEN NULL
                    ELSE '%'||replace(replace(replace(v_search,'\','\\'),'%','\%'),'_','\_')||'%' END;

  IF p_award_id IS NOT NULL THEN
    SELECT a.id, a.award_number, a.ssn, a.benefit_code, a.status
      INTO v_award FROM public.bn_award a WHERE a.id = p_award_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001';
    END IF;

    SELECT count(*) INTO v_visible
      FROM public.bn_life_certificate lc
     WHERE lc.bn_award_id = p_award_id
       AND public._bn_lc_can_access(v_actor, lc.id);

    IF v_visible = 0 AND EXISTS (
      SELECT 1 FROM public.bn_life_certificate lc WHERE lc.bn_award_id = p_award_id
    ) THEN
      RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
    END IF;

    v_award_ctx := jsonb_build_object(
      'id', v_award.id,
      'award_number', v_award.award_number,
      'ssn', public._bn_lc_mask_ssn(v_award.ssn, v_reveal),
      'benefit_code', v_award.benefit_code,
      'status', v_award.status);
  END IF;

  WITH base AS (
    SELECT lc.*, a.award_number, a.ssn, a.benefit_code, a.status AS award_status,
           att.manual_intervention_required, att.failed_attempts, att.last_error_code
      FROM public.bn_life_certificate lc
      JOIN public.bn_award a ON a.id = lc.bn_award_id
      LEFT JOIN LATERAL (
        SELECT s.manual_intervention_required, s.failed_attempts, s.last_error_code
          FROM public.bn_life_certificate_scheduler_attempt s
         WHERE s.life_certificate_id = lc.id
         ORDER BY s.manual_intervention_required DESC, s.updated_at DESC LIMIT 1) att ON true
     WHERE public._bn_lc_can_access(v_actor, lc.id)
       AND (p_award_id IS NULL OR lc.bn_award_id = p_award_id)
       AND (p_bucket = 'ALL'
        OR (p_bucket='DUE' AND lc.obligation_status IN ('DUE','REMINDER_SENT'))
        OR (p_bucket='GRACE' AND lc.obligation_status='GRACE')
        OR (p_bucket='OVERDUE' AND lc.obligation_status='OVERDUE')
        OR (p_bucket='AWAITING_REVIEW' AND lc.obligation_status IN ('RECEIVED','UNDER_REVIEW'))
        OR (p_bucket='REJECTED' AND lc.obligation_status IN ('REJECTED','RESUBMISSION_REQUIRED'))
        OR (p_bucket='VERIFIED' AND lc.obligation_status='VERIFIED')
        OR (p_bucket='WAIVED_DEFERRED' AND lc.obligation_status IN ('WAIVED','DEFERRED'))
        OR (p_bucket='SUSPENSIONS' AND lc.suspension_event_id IS NOT NULL)
        OR (p_bucket='REINSTATEMENTS' AND lc.reinstatement_event_id IS NOT NULL)
        OR (p_bucket='MANUAL_INTERVENTION' AND COALESCE(att.manual_intervention_required,false)))
       AND (v_pattern IS NULL
            OR COALESCE(a.award_number,'') ILIKE v_pattern ESCAPE '\'
            OR (v_reveal AND a.ssn ILIKE v_pattern ESCAPE '\')
            OR (NOT v_reveal AND a.ssn = v_search))
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb), (SELECT count(*) FROM base)
    INTO v_rows, v_total
  FROM (
    SELECT b.id, b.bn_award_id, b.award_number,
           public._bn_lc_mask_ssn(b.ssn, v_reveal) AS ssn,
           b.benefit_code, b.award_status,
           b.obligation_period, b.due_date, b.grace_end_date, b.escalation_date,
           b.obligation_status, b.evidence_status, b.verification_status,
           b.escalation_status, b.communication_status, b.reminder_count,
           b.suspension_event_id, b.reinstatement_event_id, b.row_version,
           COALESCE(b.manual_intervention_required,false) AS manual_intervention_required,
           COALESCE(b.failed_attempts,0) AS scheduler_failed_attempts,
           b.last_error_code AS scheduler_last_error_code
      FROM base b
     ORDER BY b.due_date
     LIMIT v_limit OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) t;

  RETURN jsonb_build_object('rows', v_rows,'total', v_total,'limit', v_limit,
                            'offset', COALESCE(p_offset,0),'identity_masked', NOT v_reveal,
                            'award', v_award_ctx);
END $function$;

REVOKE ALL ON FUNCTION public.bn_life_certificate_worklist_v2(text,text,integer,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_worklist_v2(text,text,integer,integer,uuid) TO authenticated, service_role;
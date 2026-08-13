-- ===========================================================================
-- Omni-Comms — durable business-event integration, SOURCE-CONTROLLED.
-- Reproduces the canonical live definitions idempotently and additionally:
--   * makes the Benefits claim + business event genuinely ATOMIC,
--   * gives the outbox a bounded transient retry lifecycle,
--   * recovers stale `processing` rows through a claim lease,
--   * records a truthful terminal "no communication configured" outcome.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.omni_comms_business_event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  module_code text NOT NULL,
  event_code text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  occurrence text NOT NULL DEFAULT 'default',
  product_id uuid NULL,
  department_context_id uuid NULL,
  recipient_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  correlation_id text NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NULL,
  blocker_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  processed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.omni_comms_business_event_outbox
  ADD COLUMN IF NOT EXISTS result_code text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.omni_comms_business_event_outbox'::regclass
                    AND conname='omni_comms_business_event_outbox_identity_uq') THEN
    ALTER TABLE public.omni_comms_business_event_outbox
      ADD CONSTRAINT omni_comms_business_event_outbox_identity_uq
      UNIQUE (organization_id, module_code, idempotency_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.omni_comms_business_event_outbox'::regclass
                    AND conname='omni_comms_business_event_outbox_key_chk') THEN
    ALTER TABLE public.omni_comms_business_event_outbox
      ADD CONSTRAINT omni_comms_business_event_outbox_key_chk
      CHECK (length(idempotency_key) >= 8 AND length(idempotency_key) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.omni_comms_business_event_outbox'::regclass
                    AND conname='omni_comms_business_event_outbox_payload_chk') THEN
    ALTER TABLE public.omni_comms_business_event_outbox
      ADD CONSTRAINT omni_comms_business_event_outbox_payload_chk
      CHECK (jsonb_typeof(payload_snapshot)='object' AND octet_length(payload_snapshot::text) <= 262144);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.omni_comms_business_event_outbox'::regclass
                    AND conname='omni_comms_business_event_outbox_recipients_chk') THEN
    ALTER TABLE public.omni_comms_business_event_outbox
      ADD CONSTRAINT omni_comms_business_event_outbox_recipients_chk
      CHECK (jsonb_typeof(recipient_facts)='object' AND octet_length(recipient_facts::text) <= 65536);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.omni_comms_business_event_outbox'::regclass
                    AND conname='omni_comms_business_event_outbox_status_chk') THEN
    ALTER TABLE public.omni_comms_business_event_outbox
      ADD CONSTRAINT omni_comms_business_event_outbox_status_chk
      CHECK (status IN ('pending','processing','processed','blocked','needs_review'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS omni_comms_business_event_outbox_due_idx
  ON public.omni_comms_business_event_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS omni_comms_business_event_outbox_entity_idx
  ON public.omni_comms_business_event_outbox (organization_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS omni_comms_business_event_outbox_request_idx
  ON public.omni_comms_business_event_outbox (request_id);

-- Runtime object. No browser reaches it: RLS on, no policy, no role grant.
ALTER TABLE public.omni_comms_business_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.omni_comms_business_event_outbox FROM PUBLIC;
REVOKE ALL ON public.omni_comms_business_event_outbox FROM anon;
REVOKE ALL ON public.omni_comms_business_event_outbox FROM authenticated;
GRANT ALL ON public.omni_comms_business_event_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_event_key(
  p_organization_id uuid, p_module_code text, p_event_code text,
  p_entity_type text, p_entity_id text, p_occurrence text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT 'omni-event-v2:' || encode(
    extensions.digest(
      concat_ws(chr(31),
        p_organization_id::text,
        upper(btrim(p_module_code)),
        upper(btrim(p_event_code)),
        btrim(p_entity_type),
        btrim(p_entity_id),
        coalesce(nullif(btrim(p_occurrence), ''), 'default')
      ), 'sha256'), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_organization(p_module_code text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.id
  FROM public.core_organization o
  WHERE o.status = 'ACTIVE'
  ORDER BY o.created_at
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.module_code IS DISTINCT FROM OLD.module_code
     OR NEW.event_code IS DISTINCT FROM OLD.event_code
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.occurrence IS DISTINCT FROM OLD.occurrence
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.recipient_facts IS DISTINCT FROM OLD.recipient_facts
     OR NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'OC422 business_event_immutable' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS omni_comms_business_event_outbox_immutable
  ON public.omni_comms_business_event_outbox;
CREATE TRIGGER omni_comms_business_event_outbox_immutable
  BEFORE UPDATE ON public.omni_comms_business_event_outbox
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_business_event_immutable();

-- Enqueue. Called INSIDE the business transaction. It never resolves a
-- channel, template, sender or provider: it records that the fact happened.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_enqueue_business_event(
  p_organization_id uuid, p_module_code text, p_event_code text,
  p_entity_type text, p_entity_id text, p_occurrence text,
  p_product_id uuid, p_department_context_id uuid,
  p_recipient_facts jsonb, p_payload jsonb, p_correlation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := p_organization_id;
  v_module text := upper(btrim(coalesce(p_module_code, '')));
  v_event text := upper(btrim(coalesce(p_event_code, '')));
  v_key text;
  v_id uuid;
  v_status text;
  v_role text;
BEGIN
  IF v_module = '' OR v_event = '' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE = 'P0001';
  END IF;
  IF v_org IS NULL THEN
    v_org := public.omni_comms_priv_business_organization(v_module);
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC422 organization_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_caller_module_registry m
    WHERE upper(m.module_code) = v_module AND m.is_active
  ) THEN
    RAISE EXCEPTION 'OC403 caller_module_not_registered' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_event_definition e WHERE e.code = v_event
  ) THEN
    RAISE EXCEPTION 'OC404 event_code_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_entity_type IS NULL OR btrim(p_entity_type) = ''
     OR p_entity_id IS NULL OR btrim(p_entity_id) = '' THEN
    RAISE EXCEPTION 'OC422 entity_required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'OC422 payload_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(coalesce(p_recipient_facts, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'OC422 recipient_facts_invalid' USING ERRCODE = 'P0001';
  END IF;
  FOR v_role IN SELECT jsonb_object_keys(coalesce(p_recipient_facts, '{}'::jsonb)) LOOP
    IF v_role !~ '^[a-z][a-z0-9_]{0,63}$' THEN
      RAISE EXCEPTION 'OC422 recipient_role_invalid' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_key := public.omni_comms_priv_business_event_key(
    v_org, v_module, v_event, p_entity_type, p_entity_id, p_occurrence);

  INSERT INTO public.omni_comms_business_event_outbox (
    organization_id, module_code, event_code, entity_type, entity_id, occurrence,
    product_id, department_context_id, recipient_facts, payload_snapshot,
    idempotency_key, correlation_id
  ) VALUES (
    v_org, v_module, v_event, btrim(p_entity_type), btrim(p_entity_id),
    coalesce(nullif(btrim(p_occurrence), ''), 'default'),
    p_product_id, p_department_context_id,
    coalesce(p_recipient_facts, '{}'::jsonb), coalesce(p_payload, '{}'::jsonb),
    v_key, nullif(btrim(coalesce(p_correlation_id, '')), '')
  )
  ON CONFLICT (organization_id, module_code, idempotency_key) DO NOTHING
  RETURNING id, status INTO v_id, v_status;

  IF v_id IS NULL THEN
    SELECT id, status INTO v_id, v_status
    FROM public.omni_comms_business_event_outbox
    WHERE organization_id = v_org AND module_code = v_module AND idempotency_key = v_key;
    RETURN jsonb_build_object(
      'event_outbox_id', v_id, 'idempotency_key', v_key,
      'status', v_status, 'deduplicated', true);
  END IF;

  RETURN jsonb_build_object(
    'event_outbox_id', v_id, 'idempotency_key', v_key,
    'status', v_status, 'deduplicated', false);
END;
$function$;

-- Claim. The CALLER can never choose what is ingested. A crashed worker's
-- `processing` row becomes claimable again only after the lease expires.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_claim_business_events(p_limit integer)
RETURNS SETOF public.omni_comms_business_event_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.omni_comms_business_event_outbox o
     SET status = 'processing', claimed_at = now(), updated_at = now()
   WHERE o.id IN (
     SELECT id FROM public.omni_comms_business_event_outbox
      WHERE (
              (status = 'pending' AND next_attempt_at <= now())
              OR (status = 'processing'
                  AND coalesce(claimed_at, created_at) < now() - interval '10 minutes')
            )
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT greatest(1, least(coalesce(p_limit, 10), 50))
   )
  RETURNING o.*;
$function$;

-- Complete. Bounded transient retry lifecycle.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_complete_business_event(
  p_id uuid, p_status text, p_request_id uuid, p_blocker_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.omni_comms_business_event_outbox;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_code text := nullif(btrim(coalesce(p_blocker_code, '')), '');
  v_next text;
  v_attempt int;
  v_delay interval;
  v_result text;
BEGIN
  SELECT * INTO v_row FROM public.omni_comms_business_event_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 business_event_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_status IN ('processed', 'no_communication_configured') THEN
    v_result := CASE WHEN v_status = 'no_communication_configured'
                     THEN 'no_communication_configured' ELSE 'communication_requested' END;
    UPDATE public.omni_comms_business_event_outbox
       SET status = 'processed',
           request_id = coalesce(p_request_id, request_id),
           result_code = v_result,
           blocker_code = v_code,
           processed_at = now(), updated_at = now()
     WHERE id = p_id;
    RETURN jsonb_build_object('status', 'processed', 'result_code', v_result);
  END IF;

  IF v_status = 'blocked' THEN
    UPDATE public.omni_comms_business_event_outbox
       SET status = 'blocked', request_id = coalesce(p_request_id, request_id),
           result_code = 'configuration_blocked',
           blocker_code = v_code, processed_at = now(), updated_at = now()
     WHERE id = p_id;
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  IF v_status = 'needs_review' THEN
    UPDATE public.omni_comms_business_event_outbox
       SET status = 'needs_review', attempt_count = v_row.attempt_count + 1,
           blocker_code = v_code, claimed_at = NULL, updated_at = now()
     WHERE id = p_id;
    RETURN jsonb_build_object('status', 'needs_review');
  END IF;

  v_attempt := v_row.attempt_count + 1;
  v_delay := CASE v_attempt
               WHEN 1 THEN interval '1 minute'
               WHEN 2 THEN interval '5 minutes'
               WHEN 3 THEN interval '15 minutes'
               ELSE interval '30 minutes'
             END;
  v_next := CASE WHEN v_attempt >= 8 THEN 'needs_review' ELSE 'pending' END;
  UPDATE public.omni_comms_business_event_outbox
     SET status = v_next,
         attempt_count = v_attempt,
         blocker_code = v_code,
         next_attempt_at = now() + v_delay,
         claimed_at = NULL,
         updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('status', v_next, 'attempt_count', v_attempt,
                            'next_attempt_in', v_delay::text);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_enqueue_business_event(uuid,text,text,text,text,text,uuid,uuid,jsonb,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_enqueue_business_event(uuid,text,text,text,text,text,uuid,uuid,jsonb,jsonb,text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_claim_business_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_claim_business_events(integer) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_claim_business_events(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_complete_business_event(uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_complete_business_event(uuid,text,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_complete_business_event(uuid,text,uuid,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_claim_business_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_complete_business_event(uuid,text,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_business_event_outbox_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'pending',      count(*) FILTER (WHERE status = 'pending'),
    'processing',   count(*) FILTER (WHERE status = 'processing'),
    'processed',    count(*) FILTER (WHERE status = 'processed'),
    'blocked',      count(*) FILTER (WHERE status = 'blocked'),
    'needs_review', count(*) FILTER (WHERE status = 'needs_review'),
    'no_communication_configured',
      count(*) FILTER (WHERE result_code = 'no_communication_configured'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status = 'pending'),
    'checked_at', now()
  )
  FROM public.omni_comms_business_event_outbox;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_business_event_outbox_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_business_event_outbox_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_business_event_outbox_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_business_event_outbox_health() TO service_role;

-- ATOMIC Benefits claim + business event: the enqueue is no longer wrapped in
-- a swallowing EXCEPTION block, so a claim can never commit without its
-- communication obligation.
CREATE OR REPLACE FUNCTION public.bn_submit_claim_application(p_ssn text, p_product_code text, p_claim_date date, p_channel text, p_form_payload jsonb, p_employer_regno text DEFAULT NULL::text, p_submitted_by_user_id text DEFAULT NULL::text, p_source_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS TABLE(claim_id uuid, claim_number text, workflow_instance_id uuid, communication_event_id uuid, communication_event_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id UUID;
  v_version_id UUID;
  v_channel_config_id UUID;
  v_workflow_template_id UUID;
  v_workflow_def_id UUID;
  v_claim_id UUID;
  v_claim_no TEXT;
  v_wf_instance UUID := NULL;
  v_person RECORD;
  v_employer RECORD;
  v_contrib RECORD;
  v_user_text TEXT := COALESCE(NULLIF(p_submitted_by_user_id, ''), 'SYSTEM');
  v_channel_config_code TEXT;
  v_product_name TEXT;
  v_claimant_name TEXT;
  v_claimant_email TEXT;
  v_comm JSONB;
  v_comm_id UUID := NULL;
  v_comm_status TEXT := NULL;
BEGIN
  v_channel_config_code := CASE
    WHEN p_channel = 'PUBLIC_ONLINE' THEN 'ONLINE'
    ELSE 'OFFLINE'
  END;

  SELECT p.id, pv.id, pcc.id,
         COALESCE(pcc.workflow_template_id, pv.workflow_template_id),
         pcc.workflow_definition_id, p.benefit_name
    INTO v_product_id, v_version_id, v_channel_config_id, v_workflow_template_id, v_workflow_def_id, v_product_name
  FROM public.bn_product p
  JOIN public.bn_product_version pv ON pv.product_id = p.id
  LEFT JOIN public.bn_product_channel_config pcc
    ON pcc.product_version_id = pv.id
   AND pcc.channel_code = v_channel_config_code
   AND COALESCE(pcc.is_enabled, true) = true
  WHERE p.benefit_code = p_product_code
    AND p.status = 'ACTIVE'
    AND pv.status = 'ACTIVE'
    AND pv.effective_from <= p_claim_date
    AND (pv.effective_to IS NULL OR pv.effective_to >= p_claim_date)
  ORDER BY pv.effective_from DESC
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'No active product version found for % on %', p_product_code, p_claim_date;
  END IF;

  v_claim_no := 'BN-' || to_char(now(),'YYYYMMDD') || '-' || lpad((floor(random()*100000))::text, 5, '0');

  INSERT INTO public.bn_claim (
    claim_number, ssn, product_id, product_version_id, employer_regno,
    status, priority, claim_date, submission_date, source, application_channel, channel_code,
    contact_phone, contact_email, bank_account, bank_routing_number,
    declaration, entered_by, entered_at, workflow_definition_id, channel_config_id
  )
  VALUES (
    v_claim_no, p_ssn, v_product_id, v_version_id, p_employer_regno,
    'INTAKE', COALESCE(NULLIF(p_form_payload->>'priority', ''), 'NORMAL'), p_claim_date, now(), p_channel, p_channel, v_channel_config_code,
    NULLIF(p_form_payload->>'contact_phone', ''), NULLIF(p_form_payload->>'contact_email', ''),
    NULLIF(p_form_payload->>'bank_account', ''), NULLIF(p_form_payload->>'bank_routing_number', ''),
    COALESCE((p_form_payload->>'declaration_accepted')::boolean, false),
    v_user_text, now(), v_workflow_def_id, v_channel_config_id
  )
  RETURNING id INTO v_claim_id;

  INSERT INTO public.bn_claim_application (
    claim_id, product_id, product_version_id, application_channel,
    submitted_by_type, submitted_by_user_id, submitted_at,
    declaration_accepted, raw_application_json, source_ip, user_agent,
    entered_by
  ) VALUES (
    v_claim_id, v_product_id, v_version_id, p_channel,
    CASE WHEN p_channel='PUBLIC_ONLINE' THEN 'PUBLIC_USER' ELSE 'EMPLOYEE' END,
    v_user_text, now(),
    COALESCE((p_form_payload->>'declaration_accepted')::boolean, false),
    p_form_payload, p_source_ip, p_user_agent, v_user_text
  );

  SELECT ssn, firstname, surname, dob, sex, status, email_addr, phone,
         resident_addr1, resident_addr2, district, place_of_residence
    INTO v_person
  FROM public.ip_master WHERE ssn = p_ssn LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.bn_claim_person_snapshot (
      claim_id, ssn, full_name, date_of_birth, gender, person_status,
      address_json, phone, email
    ) VALUES (
      v_claim_id, v_person.ssn,
      trim(coalesce(v_person.firstname,'') || ' ' || coalesce(v_person.surname,'')),
      v_person.dob, v_person.sex, v_person.status,
      jsonb_build_object('line1', v_person.resident_addr1, 'line2', v_person.resident_addr2,
                         'district', v_person.district, 'country', v_person.place_of_residence),
      v_person.phone, v_person.email_addr
    );
  END IF;

  IF p_employer_regno IS NOT NULL THEN
    SELECT regno, name, status, maddr1, maddr2, hq_addr1, hq_addr2
      INTO v_employer
    FROM public.er_master WHERE regno = p_employer_regno LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.bn_claim_employer_snapshot (
        claim_id, employer_regno, employer_name, employer_status, address_json
      ) VALUES (
        v_claim_id, v_employer.regno, v_employer.name, v_employer.status,
        jsonb_build_object('line1', COALESCE(v_employer.maddr1, v_employer.hq_addr1),
                           'line2', COALESCE(v_employer.maddr2, v_employer.hq_addr2))
      );
    END IF;
  END IF;

  BEGIN
    SELECT
      MIN(period) AS period_from,
      MAX(period) AS period_to,
      COUNT(*)::int AS total_weeks,
      COALESCE(SUM(total_wages),0) AS total_wages
    INTO v_contrib
    FROM public.ip_wages
    WHERE ssn = p_ssn;

    INSERT INTO public.bn_claim_contribution_snapshot (
      claim_id, period_from, period_to, total_weeks, paid_weeks, credited_weeks,
      total_wages, average_weekly_wage, contribution_json
    ) VALUES (
      v_claim_id, v_contrib.period_from, v_contrib.period_to,
      COALESCE(v_contrib.total_weeks, 0), COALESCE(v_contrib.total_weeks, 0), 0,
      COALESCE(v_contrib.total_wages, 0),
      CASE WHEN COALESCE(v_contrib.total_weeks, 0) > 0 THEN COALESCE(v_contrib.total_wages, 0) / v_contrib.total_weeks ELSE 0 END,
      jsonb_build_object('source','ip_wages', 'rows', COALESCE(v_contrib.total_weeks, 0))
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.bn_claim_intake_validation (claim_id, check_code, status, message, details_json)
    VALUES (v_claim_id, 'CONTRIBUTION_SNAPSHOT', 'WARN', 'Contribution snapshot could not be generated', jsonb_build_object('error', SQLERRM));
  END;

  BEGIN
    INSERT INTO public.bn_evidence_checklist (claim_id, requirement_id, status, is_blocking, entered_at)
    SELECT v_claim_id, dr.id, 'OUTSTANDING', COALESCE(dr.blocks_submission, true), now()
    FROM public.bn_doc_requirement dr
    WHERE dr.product_version_id = v_version_id
      AND COALESCE(dr.is_active, true) = true;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.bn_claim_intake_validation (claim_id, check_code, status, message, details_json)
    VALUES (v_claim_id, 'DOCUMENT_CHECKLIST', 'WARN', 'Document checklist could not be generated', jsonb_build_object('error', SQLERRM));
  END;

  INSERT INTO public.bn_claim_intake_validation (claim_id, check_code, status, message)
  VALUES
    (v_claim_id, 'PERSON_FOUND',
       CASE WHEN v_person.ssn IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       CASE WHEN v_person.ssn IS NOT NULL THEN 'Claimant matched in ip_master' ELSE 'No matching person for SSN' END),
    (v_claim_id, 'PRODUCT_VERSION_ACTIVE', 'PASS', 'Active product version resolved');

  INSERT INTO public.bn_claim_event (claim_id, event_type, from_status, to_status, notes, performed_by, metadata)
  VALUES (v_claim_id, 'CLAIM_SUBMITTED', NULL, 'INTAKE', 'Claim submitted via intake registration', v_user_text, jsonb_build_object('channel', p_channel));

  -- ==========================================================
  -- Durable communication obligation, SAME transaction as the claim.
  -- No EXCEPTION handler: a failure here rolls the claim back.
  -- ==========================================================
  v_claimant_name := NULLIF(trim(coalesce(v_person.firstname,'') || ' ' || coalesce(v_person.surname,'')), '');
  v_claimant_email := COALESCE(NULLIF(p_form_payload->>'contact_email',''), NULLIF(v_person.email_addr,''));

  v_comm := public.omni_comms_priv_enqueue_business_event(
    NULL,
    'BENEFITS',
    'BENEFITS.CLAIM.SUBMITTED',
    'bn_claim',
    v_claim_id::text,
    'submitted',
    v_product_id,
    NULL,
    jsonb_build_object(
      'claimant', jsonb_build_object(
        'recipient_type', 'external',
        'recipient_reference', v_claim_no,
        'display_name', COALESCE(v_claimant_name, 'Claimant'),
        'email', v_claimant_email
      )
    ),
    jsonb_build_object(
      'reference', v_claim_no,
      'subjectName', COALESCE(v_claimant_name, 'Claimant'),
      'claimType', COALESCE(v_product_name, p_product_code)
    ),
    'benefits-claim-registered:' || v_claim_id::text
  );
  v_comm_id := NULLIF(v_comm->>'event_outbox_id','')::uuid;
  v_comm_status := v_comm->>'status';

  RETURN QUERY SELECT v_claim_id, v_claim_no, v_wf_instance, v_comm_id, v_comm_status;
END;
$function$;

-- =====================================================================
-- BN RISK / FRAUD — EPIC 0: signal intake, triage, linking, dismissal
-- =====================================================================

CREATE TABLE public.bn_risk_reference_value (
  reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  nature text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, code)
);
GRANT SELECT ON public.bn_risk_reference_value TO authenticated;
GRANT ALL ON public.bn_risk_reference_value TO service_role;
ALTER TABLE public.bn_risk_reference_value ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk reference readable by staff" ON public.bn_risk_reference_value
  FOR SELECT TO authenticated USING (true);

CREATE SEQUENCE public.bn_risk_signal_seq;

CREATE TABLE public.bn_risk_signal (
  signal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_reference text NOT NULL UNIQUE,
  source_module text NOT NULL,
  source_event_code text,
  source_reference text,
  source_record_id text,
  source_version text,
  person_id bigint,
  person_ssn text,
  claim_id uuid,
  award_id uuid,
  payment_id uuid,
  means_assessment_id uuid,
  category_code text NOT NULL,
  rule_code text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  observed_on date,
  severity_code text,
  priority_code text,
  status text NOT NULL DEFAULT 'NEW',
  summary text NOT NULL,
  observation text,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  created_by_source text NOT NULL DEFAULT 'SYSTEM',
  created_by_user_id uuid,
  triage_owner_user_id uuid,
  triage_priority_code text,
  triage_classification_code text,
  triage_route_code text,
  triaged_at timestamptz,
  triage_notes text,
  dismissal_reason_code text,
  dismissal_justification text,
  dismissed_at timestamptz,
  dismissed_by_user_id uuid,
  evidence_reference text,
  correlation_id uuid,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bn_risk_signal_status_idx ON public.bn_risk_signal (status, detected_at DESC);
CREATE INDEX bn_risk_signal_person_idx ON public.bn_risk_signal (person_id);
CREATE INDEX bn_risk_signal_owner_idx ON public.bn_risk_signal (triage_owner_user_id);
GRANT SELECT ON public.bn_risk_signal TO authenticated;
GRANT ALL ON public.bn_risk_signal TO service_role;
ALTER TABLE public.bn_risk_signal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk signals readable by staff" ON public.bn_risk_signal
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.bn_risk_signal_link (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.bn_risk_signal(signal_id) ON DELETE CASCADE,
  related_signal_id uuid NOT NULL REFERENCES public.bn_risk_signal(signal_id) ON DELETE CASCADE,
  pair_low uuid NOT NULL,
  pair_high uuid NOT NULL,
  link_type_code text NOT NULL DEFAULT 'POSSIBLY_RELATED',
  link_reason text,
  created_by_user_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_signal_link_no_self CHECK (signal_id <> related_signal_id),
  CONSTRAINT bn_risk_signal_link_pair UNIQUE (pair_low, pair_high)
);
GRANT SELECT ON public.bn_risk_signal_link TO authenticated;
GRANT ALL ON public.bn_risk_signal_link TO service_role;
ALTER TABLE public.bn_risk_signal_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk signal links readable by staff" ON public.bn_risk_signal_link
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.bn_risk_signal_note (
  note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.bn_risk_signal(signal_id) ON DELETE CASCADE,
  note_kind text NOT NULL DEFAULT 'GENERAL',
  body text NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_signal_note_kind CHECK (note_kind IN ('GENERAL','RESTRICTED'))
);
GRANT SELECT ON public.bn_risk_signal_note TO service_role;
GRANT ALL ON public.bn_risk_signal_note TO service_role;
ALTER TABLE public.bn_risk_signal_note ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bn_risk_signal_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES public.bn_risk_signal(signal_id) ON DELETE CASCADE,
  event_code text NOT NULL,
  command_name text,
  from_status text,
  to_status text,
  reason_code text,
  justification text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  actor_user_code text,
  actor_source text,
  correlation_id uuid,
  row_version bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bn_risk_signal_event_signal_idx ON public.bn_risk_signal_event (signal_id, created_at);
GRANT SELECT ON public.bn_risk_signal_event TO authenticated;
GRANT ALL ON public.bn_risk_signal_event TO service_role;
ALTER TABLE public.bn_risk_signal_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk signal history readable by staff" ON public.bn_risk_signal_event
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.bn_risk_command_idempotency (
  idempotency_key uuid PRIMARY KEY,
  command_name text NOT NULL,
  payload_hash text NOT NULL DEFAULT ''::text,
  signal_id uuid,
  entity_version bigint,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'COMPLETED',
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT ON public.bn_risk_command_idempotency TO authenticated;
GRANT ALL ON public.bn_risk_command_idempotency TO service_role;
ALTER TABLE public.bn_risk_command_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk replay register readable by staff" ON public.bn_risk_command_idempotency
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.bn_risk_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER bn_risk_signal_touch BEFORE UPDATE ON public.bn_risk_signal
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();
CREATE TRIGGER bn_risk_reference_touch BEFORE UPDATE ON public.bn_risk_reference_value
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();

-- ---------------------------------------------------------------------
-- Permission boundary
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_check_actor_permission(
  p_actor_user_id uuid, p_action_name text, p_is_mutation boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_module public.app_modules%ROWTYPE;
  v_action_id uuid;
  v_action_enabled boolean;
  v_has_grant boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  END IF;
  SELECT * INTO v_module FROM public.app_modules WHERE name = 'bn_risk_management';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MODULE_NOT_REGISTERED');
  END IF;
  IF NOT v_module.is_enabled THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MODULE_DISABLED');
  END IF;
  IF NOT COALESCE(v_module.routes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROUTES_DISABLED');
  END IF;
  IF p_is_mutation AND NOT COALESCE(v_module.actions_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTIONS_DISABLED');
  END IF;

  SELECT id, is_enabled INTO v_action_id, v_action_enabled
    FROM public.module_actions
   WHERE module_id = v_module.id AND action_name = p_action_name;
  IF v_action_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_UNREGISTERED');
  END IF;
  IF NOT COALESCE(v_action_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_DISABLED');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.role_permissions rp
      JOIN public.roles r ON r.id = rp.role_id
      JOIN public.user_roles ur ON ur.role = r.role_name
     WHERE ur.user_id = p_actor_user_id
       AND rp.action_id = v_action_id
       AND COALESCE(rp.is_granted, true) = true
       AND COALESCE(r.is_active, true) = true
  ) INTO v_has_grant;

  IF NOT v_has_grant THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'PERMITTED',
    'module_id', v_module.id, 'action_id', v_action_id);
END; $$;

CREATE OR REPLACE FUNCTION public._bn_risk_require(p_actor uuid, p_action text, p_mutation boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor, p_action, p_mutation);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'E_%: %', v_perm->>'code', p_action;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public._bn_risk_signal_can_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_from
    WHEN 'NEW'          THEN p_to IN ('TRIAGED','DISMISSED')
    WHEN 'TRIAGED'      THEN p_to IN ('LINKED','UNDER_REVIEW','DISMISSED')
    WHEN 'LINKED'       THEN p_to IN ('UNDER_REVIEW','DISMISSED')
    WHEN 'UNDER_REVIEW' THEN p_to IN ('CONFIRMED','DISMISSED')
    WHEN 'CONFIRMED'    THEN p_to IN ('ACTIONED','CLOSED')
    WHEN 'DISMISSED'    THEN p_to IN ('CLOSED')
    WHEN 'ACTIONED'     THEN p_to IN ('CLOSED')
    ELSE false END; $$;

CREATE OR REPLACE FUNCTION public._bn_risk_next_reference()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'RS-' || to_char(now(),'YYYY') || '-' ||
         lpad(nextval('public.bn_risk_signal_seq')::text, 6, '0'); $$;

CREATE OR REPLACE FUNCTION public._bn_risk_event(
  p_signal uuid, p_code text, p_command text, p_from text, p_to text,
  p_reason text, p_justification text, p_detail jsonb,
  p_actor uuid, p_actor_code text, p_actor_source text,
  p_correlation uuid, p_row_version bigint)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.bn_risk_signal_event(
    signal_id, event_code, command_name, from_status, to_status, reason_code,
    justification, detail, actor_user_id, actor_user_code, actor_source,
    correlation_id, row_version)
  VALUES (p_signal, p_code, p_command, p_from, p_to, p_reason, p_justification,
          COALESCE(p_detail,'{}'::jsonb), p_actor, p_actor_code, p_actor_source,
          p_correlation, p_row_version); $$;

CREATE OR REPLACE FUNCTION public._bn_risk_mask_ssn(p_ssn text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_ssn IS NULL OR length(btrim(p_ssn)) < 4 THEN NULL
              ELSE '•••' || right(btrim(p_ssn), 3) END; $$;

CREATE OR REPLACE FUNCTION public._bn_risk_signal_summary_row(s public.bn_risk_signal)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'signal_id', s.signal_id,
    'signal_reference', s.signal_reference,
    'person_id', s.person_id,
    'person_name', (SELECT btrim(COALESCE(m.firstname,'') || ' ' || COALESCE(m.surname,''))
                      FROM public.ip_master m
                     WHERE NULLIF(regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g'),'')::bigint = s.person_id
                     LIMIT 1),
    'person_masked_identifier', public._bn_risk_mask_ssn(s.person_ssn),
    'source_module', s.source_module,
    'source_module_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
        WHERE domain='SOURCE_MODULE' AND code=s.source_module), s.source_module),
    'category_code', s.category_code,
    'category_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
        WHERE domain='CATEGORY' AND code=s.category_code), s.category_code),
    'category_nature', (SELECT nature FROM public.bn_risk_reference_value
        WHERE domain='CATEGORY' AND code=s.category_code),
    'detected_at', s.detected_at,
    'observed_on', s.observed_on,
    'priority_code', COALESCE(s.triage_priority_code, s.severity_code),
    'priority_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
        WHERE domain='TRIAGE_PRIORITY' AND code=COALESCE(s.triage_priority_code, s.severity_code)),
        COALESCE(s.triage_priority_code, s.severity_code)),
    'status', s.status,
    'status_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
        WHERE domain='SIGNAL_STATUS' AND code=s.status), s.status),
    'linked_signal_count', (SELECT count(*) FROM public.bn_risk_signal_link l
        WHERE l.signal_id = s.signal_id OR l.related_signal_id = s.signal_id),
    'triage_owner_user_id', s.triage_owner_user_id,
    'age_days', GREATEST(0, (date_part('day', now() - s.detected_at))::int),
    'summary', s.summary,
    'action_required', CASE s.status
        WHEN 'NEW' THEN 'Triage required'
        WHEN 'TRIAGED' THEN 'Continue review or link related signals'
        WHEN 'LINKED' THEN 'Continue review'
        WHEN 'UNDER_REVIEW' THEN 'Review in progress'
        WHEN 'CONFIRMED' THEN 'Confirmed — awaiting risk assessment capability'
        WHEN 'DISMISSED' THEN 'No further action'
        ELSE 'No action required' END,
    'row_version', s.row_version); $$;

-- ---------------------------------------------------------------------
-- Command boundary
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_execute_command_v1(
  p_command_name text,
  p_signal_id uuid,
  p_actor_user_id uuid,
  p_actor_user_code text,
  p_correlation_id uuid,
  p_expected_row_version bigint,
  p_reason_code text,
  p_justification text,
  p_payload jsonb,
  p_payload_hash text,
  p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_signal public.bn_risk_signal%ROWTYPE;
  v_other public.bn_risk_signal%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_dedupe text;
  v_result jsonb;
  v_to_status text;
  v_new_id uuid;
  v_ref text;
  v_related uuid;
  v_person bigint;
  v_ssn text;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED: no actor'; END IF;

  IF p_command_name NOT IN ('BN_RISK_GENERATE_SIGNAL','BN_RISK_REGISTER_MANUAL_SIGNAL',
                            'BN_RISK_TRIAGE_SIGNAL','BN_RISK_LINK_SIGNALS','BN_RISK_DISMISS_SIGNAL') THEN
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: %', p_command_name;
  END IF;

  -- capability: dismissal is a decision, everything else is write
  IF p_command_name = 'BN_RISK_DISMISS_SIGNAL' THEN
    PERFORM public._bn_risk_require(p_actor_user_id, 'decide', true);
  ELSE
    PERFORM public._bn_risk_require(p_actor_user_id, 'write', true);
  END IF;

  -- idempotency replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.bn_risk_command_idempotency
      WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.command_name <> p_command_name
         OR v_existing.payload_hash IS DISTINCT FROM COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH: key already used with a different request';
      END IF;
      RETURN jsonb_set(v_existing.result_json, '{status}', '"REPLAYED"'::jsonb);
    END IF;
  END IF;

  -- ---------------- creation commands ----------------
  IF p_command_name IN ('BN_RISK_GENERATE_SIGNAL','BN_RISK_REGISTER_MANUAL_SIGNAL') THEN
    IF NULLIF(btrim(COALESCE(v_payload->>'category_code','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: category_code';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                    WHERE domain='CATEGORY' AND code = v_payload->>'category_code' AND is_active) THEN
      RAISE EXCEPTION 'E_INVALID_VALUE: category_code';
    END IF;
    IF NULLIF(btrim(COALESCE(v_payload->>'summary','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: summary';
    END IF;

    IF p_command_name = 'BN_RISK_REGISTER_MANUAL_SIGNAL' THEN
      IF NULLIF(btrim(COALESCE(p_justification,'')),'') IS NULL THEN
        RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED: manual registration requires a justification';
      END IF;
      IF (v_payload->>'person_id') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: person_id';
      END IF;
    ELSE
      IF NULLIF(btrim(COALESCE(v_payload->>'source_module','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: source_module';
      END IF;
      IF NULLIF(btrim(COALESCE(v_payload->>'source_reference','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: source_reference';
      END IF;
    END IF;

    v_person := NULLIF(v_payload->>'person_id','')::bigint;
    SELECT m.ssn INTO v_ssn FROM public.ip_master m
      WHERE NULLIF(regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g'),'')::bigint = v_person LIMIT 1;
    IF v_person IS NOT NULL AND v_ssn IS NULL THEN
      RAISE EXCEPTION 'E_NOT_FOUND: person';
    END IF;

    v_dedupe := NULLIF(btrim(COALESCE(v_payload->>'dedupe_key','')),'');
    IF v_dedupe IS NULL THEN
      v_dedupe := encode(digest(concat_ws('|',
        CASE WHEN p_command_name = 'BN_RISK_REGISTER_MANUAL_SIGNAL' THEN 'MANUAL'
             ELSE upper(v_payload->>'source_module') END,
        COALESCE(v_payload->>'source_reference', p_idempotency_key::text),
        COALESCE(v_person::text,'-'),
        v_payload->>'category_code',
        COALESCE(v_payload->>'rule_code','-'),
        COALESCE(v_payload->>'source_version','-')), 'sha256'), 'hex');
    END IF;

    SELECT * INTO v_signal FROM public.bn_risk_signal WHERE dedupe_key = v_dedupe;
    IF FOUND THEN
      v_result := jsonb_build_object(
        'status','DUPLICATE', 'signal_id', v_signal.signal_id,
        'signal_reference', v_signal.signal_reference,
        'entity_version', v_signal.row_version,
        'message','An equivalent signal already exists; the existing signal was returned.');
      IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
          signal_id, entity_version, result_json, status, actor_user_id, completed_at)
        VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), v_signal.signal_id,
          v_signal.row_version, v_result, 'COMPLETED', p_actor_user_id, now());
      END IF;
      RETURN v_result;
    END IF;

    v_ref := public._bn_risk_next_reference();
    INSERT INTO public.bn_risk_signal(
      signal_reference, source_module, source_event_code, source_reference, source_record_id,
      source_version, person_id, person_ssn, claim_id, award_id, payment_id, means_assessment_id,
      category_code, rule_code, detected_at, observed_on, severity_code, status, summary,
      observation, facts, dedupe_key, created_by_source, created_by_user_id,
      evidence_reference, correlation_id)
    VALUES (
      v_ref,
      CASE WHEN p_command_name = 'BN_RISK_REGISTER_MANUAL_SIGNAL' THEN 'MANUAL'
           ELSE upper(v_payload->>'source_module') END,
      NULLIF(v_payload->>'source_event_code',''),
      NULLIF(v_payload->>'source_reference',''),
      NULLIF(v_payload->>'source_record_id',''),
      NULLIF(v_payload->>'source_version',''),
      v_person, v_ssn,
      NULLIF(v_payload->>'claim_id','')::uuid,
      NULLIF(v_payload->>'award_id','')::uuid,
      NULLIF(v_payload->>'payment_id','')::uuid,
      NULLIF(v_payload->>'means_assessment_id','')::uuid,
      v_payload->>'category_code',
      NULLIF(v_payload->>'rule_code',''),
      COALESCE(NULLIF(v_payload->>'detected_at','')::timestamptz, now()),
      NULLIF(v_payload->>'observed_on','')::date,
      NULLIF(v_payload->>'severity_code',''),
      'NEW',
      v_payload->>'summary',
      NULLIF(v_payload->>'observation',''),
      COALESCE(v_payload->'facts','{}'::jsonb),
      v_dedupe,
      CASE WHEN p_command_name = 'BN_RISK_REGISTER_MANUAL_SIGNAL' THEN 'MANUAL' ELSE 'SYSTEM' END,
      p_actor_user_id,
      NULLIF(v_payload->>'evidence_reference',''),
      p_correlation_id)
    RETURNING signal_id INTO v_new_id;

    IF NULLIF(btrim(COALESCE(v_payload->>'restricted_note','')),'') IS NOT NULL THEN
      INSERT INTO public.bn_risk_signal_note(signal_id, note_kind, body, created_by_user_id)
      VALUES (v_new_id, 'RESTRICTED', v_payload->>'restricted_note', p_actor_user_id);
    END IF;

    PERFORM public._bn_risk_event(v_new_id,
      CASE WHEN p_command_name = 'BN_RISK_REGISTER_MANUAL_SIGNAL'
           THEN 'MANUAL_SIGNAL_REGISTERED' ELSE 'SIGNAL_GENERATED' END,
      p_command_name, NULL, 'NEW', p_reason_code, p_justification,
      jsonb_build_object('source_module', v_payload->>'source_module',
                         'source_reference', v_payload->>'source_reference',
                         'category_code', v_payload->>'category_code'),
      p_actor_user_id, p_actor_user_code,
      CASE WHEN p_command_name = 'BN_RISK_REGISTER_MANUAL_SIGNAL' THEN 'MANUAL' ELSE 'SYSTEM' END,
      p_correlation_id, 1);

    v_result := jsonb_build_object('status','EXECUTED','signal_id', v_new_id,
      'signal_reference', v_ref, 'entity_version', 1);

  ELSE
    -- ---------------- signal-scoped commands ----------------
    IF p_signal_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED: signal_id'; END IF;
    SELECT * INTO v_signal FROM public.bn_risk_signal WHERE signal_id = p_signal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: signal'; END IF;
    IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_signal.row_version THEN
      RAISE EXCEPTION 'E_STALE_ROW_VERSION: this signal was updated by someone else — refresh and try again';
    END IF;

    IF p_command_name = 'BN_RISK_TRIAGE_SIGNAL' THEN
      IF NULLIF(btrim(COALESCE(v_payload->>'triage_priority_code','')),'') IS NULL
         OR NULLIF(btrim(COALESCE(v_payload->>'triage_classification_code','')),'') IS NULL
         OR NULLIF(btrim(COALESCE(v_payload->>'triage_route_code','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: triage priority, classification and route are required';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
          WHERE domain='TRIAGE_PRIORITY' AND code=v_payload->>'triage_priority_code' AND is_active)
        OR NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
          WHERE domain='TRIAGE_CLASSIFICATION' AND code=v_payload->>'triage_classification_code' AND is_active)
        OR NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
          WHERE domain='TRIAGE_ROUTE' AND code=v_payload->>'triage_route_code' AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: triage reference value';
      END IF;
      IF NOT public._bn_risk_signal_can_transition(v_signal.status, 'TRIAGED') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: a signal at status % cannot be triaged', v_signal.status;
      END IF;
      v_to_status := CASE WHEN v_payload->>'triage_route_code' = 'CONTINUE_REVIEW'
                          THEN 'UNDER_REVIEW' ELSE 'TRIAGED' END;

      UPDATE public.bn_risk_signal SET
        status = v_to_status,
        triage_priority_code = v_payload->>'triage_priority_code',
        triage_classification_code = v_payload->>'triage_classification_code',
        triage_route_code = v_payload->>'triage_route_code',
        triage_owner_user_id = COALESCE(NULLIF(v_payload->>'triage_owner_user_id','')::uuid, p_actor_user_id),
        triage_notes = NULLIF(v_payload->>'notes',''),
        triaged_at = now(),
        row_version = row_version + 1
      WHERE signal_id = p_signal_id;

      PERFORM public._bn_risk_event(p_signal_id, 'SIGNAL_TRIAGED', p_command_name,
        v_signal.status, v_to_status, p_reason_code, p_justification,
        jsonb_build_object('priority', v_payload->>'triage_priority_code',
                           'classification', v_payload->>'triage_classification_code',
                           'route', v_payload->>'triage_route_code'),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_signal.row_version + 1);

      v_result := jsonb_build_object('status','EXECUTED','signal_id', p_signal_id,
        'entity_version', v_signal.row_version + 1, 'signal_status', v_to_status);

    ELSIF p_command_name = 'BN_RISK_LINK_SIGNALS' THEN
      v_related := NULLIF(v_payload->>'related_signal_id','')::uuid;
      IF v_related IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: related_signal_id';
      END IF;
      IF v_related = p_signal_id THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: a signal cannot be linked to itself';
      END IF;
      SELECT * INTO v_other FROM public.bn_risk_signal WHERE signal_id = v_related;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: related signal'; END IF;
      IF EXISTS (SELECT 1 FROM public.bn_risk_signal_link
                  WHERE pair_low = LEAST(p_signal_id, v_related)
                    AND pair_high = GREATEST(p_signal_id, v_related)) THEN
        RAISE EXCEPTION 'E_DUPLICATE_LINK: these signals are already linked';
      END IF;
      IF v_signal.status NOT IN ('NEW','TRIAGED','LINKED','UNDER_REVIEW') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: a signal at status % cannot be linked', v_signal.status;
      END IF;

      INSERT INTO public.bn_risk_signal_link(signal_id, related_signal_id, pair_low, pair_high,
        link_type_code, link_reason, created_by_user_id, correlation_id)
      VALUES (p_signal_id, v_related, LEAST(p_signal_id, v_related), GREATEST(p_signal_id, v_related),
        COALESCE(NULLIF(v_payload->>'link_type_code',''),'POSSIBLY_RELATED'),
        NULLIF(v_payload->>'link_reason',''), p_actor_user_id, p_correlation_id);

      v_to_status := CASE WHEN public._bn_risk_signal_can_transition(v_signal.status, 'LINKED')
                          THEN 'LINKED' ELSE v_signal.status END;
      UPDATE public.bn_risk_signal
         SET status = v_to_status, row_version = row_version + 1
       WHERE signal_id = p_signal_id;

      PERFORM public._bn_risk_event(p_signal_id, 'SIGNALS_LINKED', p_command_name,
        v_signal.status, v_to_status, p_reason_code, p_justification,
        jsonb_build_object('related_signal_reference', v_other.signal_reference,
                           'link_type_code', COALESCE(NULLIF(v_payload->>'link_type_code',''),'POSSIBLY_RELATED')),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_signal.row_version + 1);
      PERFORM public._bn_risk_event(v_related, 'SIGNALS_LINKED', p_command_name,
        v_other.status, v_other.status, p_reason_code, p_justification,
        jsonb_build_object('related_signal_reference', v_signal.signal_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_other.row_version);

      v_result := jsonb_build_object('status','EXECUTED','signal_id', p_signal_id,
        'entity_version', v_signal.row_version + 1, 'signal_status', v_to_status,
        'related_signal_id', v_related);

    ELSE -- BN_RISK_DISMISS_SIGNAL
      IF NULLIF(btrim(COALESCE(p_reason_code,'')),'') IS NULL THEN
        RAISE EXCEPTION 'E_REASON_CODE_REQUIRED: a dismissal reason is required';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
          WHERE domain='DISMISSAL_REASON' AND code=p_reason_code AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: dismissal reason';
      END IF;
      IF NULLIF(btrim(COALESCE(p_justification,'')),'') IS NULL THEN
        RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED: a dismissal justification is required';
      END IF;
      IF NOT public._bn_risk_signal_can_transition(v_signal.status, 'DISMISSED') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: a signal at status % cannot be dismissed', v_signal.status;
      END IF;

      UPDATE public.bn_risk_signal SET
        status='DISMISSED', dismissal_reason_code = p_reason_code,
        dismissal_justification = p_justification, dismissed_at = now(),
        dismissed_by_user_id = p_actor_user_id, row_version = row_version + 1
      WHERE signal_id = p_signal_id;

      PERFORM public._bn_risk_event(p_signal_id, 'SIGNAL_DISMISSED', p_command_name,
        v_signal.status, 'DISMISSED', p_reason_code, p_justification, '{}'::jsonb,
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_signal.row_version + 1);

      v_result := jsonb_build_object('status','EXECUTED','signal_id', p_signal_id,
        'entity_version', v_signal.row_version + 1, 'signal_status','DISMISSED');
    END IF;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
      signal_id, entity_version, result_json, status, actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''),
      NULLIF(v_result->>'signal_id','')::uuid, NULLIF(v_result->>'entity_version','')::bigint,
      v_result, 'COMPLETED', p_actor_user_id, now());
  END IF;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.bn_risk_execute_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Query boundary
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_reference_data_v1(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_perm jsonb; v_data jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT jsonb_object_agg(domain, items) INTO v_data FROM (
    SELECT domain, jsonb_agg(jsonb_build_object('code', code, 'label', label,
             'description', description, 'nature', nature) ORDER BY sort_order, label) items
      FROM public.bn_risk_reference_value WHERE is_active GROUP BY domain) t;
  RETURN jsonb_build_object('status','OK','data', COALESCE(v_data,'{}'::jsonb));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_reference_data_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bn_risk_signal_queue_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_perm jsonb; v_f jsonb := COALESCE(p_filters,'{}'::jsonb);
  v_rows jsonb; v_total bigint; v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),1),200);
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_search text := NULLIF(btrim(COALESCE(v_f->>'search','')),'');
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  WITH filtered AS (
    SELECT s.* FROM public.bn_risk_signal s
     WHERE (v_f->>'status' IS NULL OR s.status = v_f->>'status')
       AND (v_f->>'category_code' IS NULL OR s.category_code = v_f->>'category_code')
       AND (v_f->>'source_module' IS NULL OR s.source_module = v_f->>'source_module')
       AND (v_f->>'priority_code' IS NULL
            OR COALESCE(s.triage_priority_code, s.severity_code) = v_f->>'priority_code')
       AND (v_f->>'detected_from' IS NULL OR s.detected_at >= (v_f->>'detected_from')::timestamptz)
       AND (v_f->>'detected_to' IS NULL OR s.detected_at < ((v_f->>'detected_to')::date + 1))
       AND (COALESCE(v_f->>'ownership','ALL') <> 'MINE' OR s.triage_owner_user_id = p_actor_user_id)
       AND (COALESCE(v_f->>'ownership','ALL') <> 'UNASSIGNED' OR s.triage_owner_user_id IS NULL)
       AND (v_search IS NULL
            OR s.signal_reference ILIKE '%'||v_search||'%'
            OR COALESCE(s.source_reference,'') ILIKE '%'||v_search||'%'
            OR COALESCE(s.person_ssn,'') ILIKE '%'||v_search||'%'
            OR EXISTS (SELECT 1 FROM public.ip_master m
                        WHERE NULLIF(regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g'),'')::bigint = s.person_id
                          AND btrim(COALESCE(m.firstname,'')||' '||COALESCE(m.surname,'')) ILIKE '%'||v_search||'%'))
  )
  SELECT count(*) INTO v_total FROM filtered;

  WITH filtered AS (
    SELECT s.* FROM public.bn_risk_signal s
     WHERE (v_f->>'status' IS NULL OR s.status = v_f->>'status')
       AND (v_f->>'category_code' IS NULL OR s.category_code = v_f->>'category_code')
       AND (v_f->>'source_module' IS NULL OR s.source_module = v_f->>'source_module')
       AND (v_f->>'priority_code' IS NULL
            OR COALESCE(s.triage_priority_code, s.severity_code) = v_f->>'priority_code')
       AND (v_f->>'detected_from' IS NULL OR s.detected_at >= (v_f->>'detected_from')::timestamptz)
       AND (v_f->>'detected_to' IS NULL OR s.detected_at < ((v_f->>'detected_to')::date + 1))
       AND (COALESCE(v_f->>'ownership','ALL') <> 'MINE' OR s.triage_owner_user_id = p_actor_user_id)
       AND (COALESCE(v_f->>'ownership','ALL') <> 'UNASSIGNED' OR s.triage_owner_user_id IS NULL)
       AND (v_search IS NULL
            OR s.signal_reference ILIKE '%'||v_search||'%'
            OR COALESCE(s.source_reference,'') ILIKE '%'||v_search||'%'
            OR COALESCE(s.person_ssn,'') ILIKE '%'||v_search||'%'
            OR EXISTS (SELECT 1 FROM public.ip_master m
                        WHERE NULLIF(regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g'),'')::bigint = s.person_id
                          AND btrim(COALESCE(m.firstname,'')||' '||COALESCE(m.surname,'')) ILIKE '%'||v_search||'%'))
     ORDER BY s.detected_at DESC
     LIMIT v_size OFFSET (v_page - 1) * v_size
  )
  SELECT COALESCE(jsonb_agg(public._bn_risk_signal_summary_row(f.*)), '[]'::jsonb)
    INTO v_rows FROM filtered f;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', v_rows, 'total_count', v_total, 'page', v_page, 'page_size', v_size,
    'status_counts', COALESCE((SELECT jsonb_object_agg(status, c) FROM
        (SELECT status, count(*) c FROM public.bn_risk_signal GROUP BY status) x), '{}'::jsonb)));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_signal_queue_v1(uuid,jsonb,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.bn_risk_signal_detail_v1(p_actor_user_id uuid, p_signal_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_perm jsonb; v_s public.bn_risk_signal%ROWTYPE;
  v_restricted boolean; v_notes jsonb; v_links jsonb; v_hist jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_s FROM public.bn_risk_signal WHERE signal_id = p_signal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','SIGNAL_NOT_FOUND','data', NULL);
  END IF;

  v_restricted := COALESCE((public.bn_risk_check_actor_permission(
    p_actor_user_id, 'restricted_notes', false)->>'ok')::boolean, false);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('note_id', n.note_id, 'note_kind', n.note_kind,
           'body', n.body, 'created_at', n.created_at) ORDER BY n.created_at), '[]'::jsonb)
    INTO v_notes FROM public.bn_risk_signal_note n
   WHERE n.signal_id = p_signal_id AND (v_restricted OR n.note_kind = 'GENERAL');

  SELECT COALESCE(jsonb_agg(public._bn_risk_signal_summary_row(o.*)), '[]'::jsonb)
    INTO v_links FROM public.bn_risk_signal_link l
    JOIN public.bn_risk_signal o
      ON o.signal_id = CASE WHEN l.signal_id = p_signal_id THEN l.related_signal_id ELSE l.signal_id END
   WHERE l.signal_id = p_signal_id OR l.related_signal_id = p_signal_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('event_code', e.event_code,
           'from_status', e.from_status, 'to_status', e.to_status,
           'reason_code', e.reason_code, 'justification', e.justification,
           'actor_source', e.actor_source, 'created_at', e.created_at,
           'detail', e.detail) ORDER BY e.created_at), '[]'::jsonb)
    INTO v_hist FROM public.bn_risk_signal_event e WHERE e.signal_id = p_signal_id;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'summary', public._bn_risk_signal_summary_row(v_s),
    'source', jsonb_build_object(
       'source_module', v_s.source_module,
       'source_module_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
          WHERE domain='SOURCE_MODULE' AND code=v_s.source_module), v_s.source_module),
       'source_event_code', v_s.source_event_code,
       'source_reference', v_s.source_reference,
       'rule_code', v_s.rule_code,
       'observation', COALESCE(v_s.observation, v_s.summary),
       'created_by_source', v_s.created_by_source),
    'context', jsonb_build_object(
       'claim_id', v_s.claim_id, 'award_id', v_s.award_id, 'payment_id', v_s.payment_id,
       'means_assessment_id', v_s.means_assessment_id,
       'means_assessment_reference', (SELECT a.assessment_reference FROM public.bn_means_assessment a
          WHERE a.assessment_id = v_s.means_assessment_id),
       'claim_reference', (SELECT c.claim_number FROM public.bn_claim c WHERE c.id = v_s.claim_id),
       'award_reference', (SELECT w.award_number FROM public.bn_award w WHERE w.id = v_s.award_id),
       'evidence_reference', v_s.evidence_reference),
    'facts', v_s.facts,
    'triage', jsonb_build_object(
       'priority_code', v_s.triage_priority_code,
       'classification_code', v_s.triage_classification_code,
       'route_code', v_s.triage_route_code,
       'owner_user_id', v_s.triage_owner_user_id,
       'triaged_at', v_s.triaged_at, 'notes', v_s.triage_notes),
    'dismissal', jsonb_build_object('reason_code', v_s.dismissal_reason_code,
       'justification', v_s.dismissal_justification, 'dismissed_at', v_s.dismissed_at),
    'related_signals', v_links,
    'history', v_hist,
    'notes', v_notes,
    'restricted_notes_visible', v_restricted,
    'technical', jsonb_build_object('signal_id', v_s.signal_id,
       'source_record_id', v_s.source_record_id, 'dedupe_key', v_s.dedupe_key,
       'correlation_id', v_s.correlation_id, 'row_version', v_s.row_version,
       'category_code', v_s.category_code)));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_signal_detail_v1(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bn_risk_related_signal_search_v1(
  p_actor_user_id uuid, p_signal_id uuid, p_search text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_perm jsonb; v_rows jsonb; v_s public.bn_risk_signal%ROWTYPE;
        v_q text := NULLIF(btrim(COALESCE(p_search,'')),'');
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_s FROM public.bn_risk_signal WHERE signal_id = p_signal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','SIGNAL_NOT_FOUND','data', NULL);
  END IF;

  WITH candidates AS (
    SELECT o.* FROM public.bn_risk_signal o
     WHERE o.signal_id <> p_signal_id
       AND NOT EXISTS (SELECT 1 FROM public.bn_risk_signal_link l
                        WHERE l.pair_low = LEAST(o.signal_id, p_signal_id)
                          AND l.pair_high = GREATEST(o.signal_id, p_signal_id))
       AND (v_q IS NOT NULL
            OR o.person_id IS NOT DISTINCT FROM v_s.person_id
            OR o.category_code = v_s.category_code)
       AND (v_q IS NULL
            OR o.signal_reference ILIKE '%'||v_q||'%'
            OR COALESCE(o.source_reference,'') ILIKE '%'||v_q||'%'
            OR COALESCE(o.person_ssn,'') ILIKE '%'||v_q||'%')
     ORDER BY o.detected_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),50))
  SELECT COALESCE(jsonb_agg(public._bn_risk_signal_summary_row(c.*)), '[]'::jsonb)
    INTO v_rows FROM candidates c;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows', v_rows));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_related_signal_search_v1(uuid,uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.bn_risk_available_actions_v1(p_actor_user_id uuid, p_signal_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_perm jsonb; v_s public.bn_risk_signal%ROWTYPE;
  v_write boolean; v_decide boolean; v_actions jsonb := '[]'::jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_s FROM public.bn_risk_signal WHERE signal_id = p_signal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','SIGNAL_NOT_FOUND','data', NULL);
  END IF;

  v_write := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false);
  v_decide := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);

  IF v_write AND public._bn_risk_signal_can_transition(v_s.status, 'TRIAGED') THEN
    v_actions := v_actions || jsonb_build_object('action','TRIAGE','label','Triage signal',
      'command','BN_RISK_TRIAGE_SIGNAL','enabled',true);
  END IF;
  IF v_write AND v_s.status IN ('NEW','TRIAGED','LINKED','UNDER_REVIEW') THEN
    v_actions := v_actions || jsonb_build_object('action','LINK','label','Link related signals',
      'command','BN_RISK_LINK_SIGNALS','enabled',true);
  END IF;
  IF v_decide AND public._bn_risk_signal_can_transition(v_s.status, 'DISMISSED') THEN
    v_actions := v_actions || jsonb_build_object('action','DISMISS','label','Dismiss signal',
      'command','BN_RISK_DISMISS_SIGNAL','enabled',true);
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'signal_id', p_signal_id, 'signal_status', v_s.status,
    'row_version', v_s.row_version, 'actions', v_actions,
    'notice', CASE WHEN v_s.status = 'CONFIRMED'
      THEN 'Confirmed — awaiting risk assessment capability' ELSE NULL END));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_available_actions_v1(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bn_risk_person_search_v1(
  p_actor_user_id uuid, p_search text, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_perm jsonb; v_rows jsonb; v_q text := NULLIF(btrim(COALESCE(p_search,'')),'');
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  IF v_q IS NULL OR length(v_q) < 2 THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows','[]'::jsonb));
  END IF;
  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'person_id', NULLIF(regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g'),'')::bigint,
      'full_name', btrim(COALESCE(m.firstname,'')||' '||COALESCE(m.surname,'')),
      'masked_identifier', public._bn_risk_mask_ssn(m.ssn),
      'date_of_birth', m.dob,
      'is_deceased', (m.date_died IS NOT NULL)) r
      FROM public.ip_master m
     WHERE NULLIF(regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g'),'') IS NOT NULL
       AND (btrim(COALESCE(m.firstname,'')||' '||COALESCE(m.surname,'')) ILIKE '%'||v_q||'%'
            OR COALESCE(m.ssn,'') ILIKE '%'||v_q||'%')
     ORDER BY m.surname NULLS LAST
     LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),50)) t;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows', v_rows));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_person_search_v1(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.bn_risk_person_safe_summary_v1(
  p_actor_user_id uuid, p_person_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_perm jsonb; v_open int; v_action int;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'view', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT count(*) FILTER (WHERE status IN ('NEW','TRIAGED','LINKED','UNDER_REVIEW')),
         count(*) FILTER (WHERE status = 'CONFIRMED')
    INTO v_open, v_action
    FROM public.bn_risk_signal WHERE person_id = p_person_id;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'person_id', p_person_id,
    'review_state', CASE WHEN v_action > 0 THEN 'ACTION_REQUIRED'
                         WHEN v_open > 0 THEN 'REVIEW_IN_PROGRESS'
                         ELSE 'NO_ACTIVE_REVIEW' END,
    'review_state_label', CASE WHEN v_action > 0 THEN 'Action required'
                               WHEN v_open > 0 THEN 'Review in progress'
                               ELSE 'No active review' END));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_person_safe_summary_v1(uuid,bigint) TO authenticated;

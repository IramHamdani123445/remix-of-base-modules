
ALTER TABLE public.bn_risk_command_idempotency
  ADD COLUMN IF NOT EXISTS assessment_id uuid;

-- ============ helpers ============
CREATE OR REPLACE FUNCTION public._bn_risk_next_assessment_reference()
RETURNS text LANGUAGE sql VOLATILE SET search_path TO 'public' AS $$
  SELECT 'RA-' || to_char(now(),'YYYY') || '-' ||
    lpad(((SELECT count(*) FROM public.bn_risk_assessment
            WHERE created_at >= date_trunc('year', now())) + 1)::text, 6, '0');
$$;

CREATE OR REPLACE FUNCTION public._bn_risk_next_factor_reference()
RETURNS text LANGUAGE sql VOLATILE SET search_path TO 'public' AS $$
  SELECT 'RF-' || to_char(now(),'YYYY') || '-' ||
    lpad(((SELECT count(*) FROM public.bn_risk_factor
            WHERE created_at >= date_trunc('year', now())) + 1)::text, 6, '0');
$$;

CREATE OR REPLACE FUNCTION public._bn_risk_next_request_reference()
RETURNS text LANGUAGE sql VOLATILE SET search_path TO 'public' AS $$
  SELECT 'RIR-' || to_char(now(),'YYYY') || '-' ||
    lpad(((SELECT count(*) FROM public.bn_risk_information_request
            WHERE created_at >= date_trunc('year', now())) + 1)::text, 6, '0');
$$;

CREATE OR REPLACE FUNCTION public._bn_risk_assessment_can_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_from
    WHEN 'DRAFT' THEN p_to IN ('OPEN','CLOSED')
    WHEN 'OPEN' THEN p_to IN ('INFORMATION_PENDING','REVIEW','CLOSED')
    WHEN 'INFORMATION_PENDING' THEN p_to IN ('REVIEW','CLOSED')
    WHEN 'REVIEW' THEN p_to IN ('RECOMMENDATION','INFORMATION_PENDING')
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public._bn_risk_assessment_event(
  p_assessment uuid, p_code text, p_command text, p_from text, p_to text,
  p_reason text, p_justification text, p_detail jsonb,
  p_actor uuid, p_actor_code text, p_actor_source text, p_correlation uuid, p_version bigint)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.bn_risk_assessment_event(assessment_id, event_code, command_name,
    from_status, to_status, reason_code, justification, detail, actor_user_id,
    actor_user_code, actor_source, correlation_id, entity_version)
  VALUES (p_assessment, p_code, p_command, p_from, p_to, p_reason, p_justification,
    COALESCE(p_detail,'{}'::jsonb), p_actor, p_actor_code,
    COALESCE(p_actor_source,'OFFICER'), p_correlation, p_version);
$$;

CREATE OR REPLACE FUNCTION public._bn_risk_actor_name(p_actor uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')),'')
       FROM public.profiles p WHERE p.id = p_actor),
    'System user');
$$;

-- ============ creation readiness ============
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_creation_readiness_v1(
  p_actor_user_id uuid, p_signal_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_signal public.bn_risk_signal%ROWTYPE;
  v_blockers text[] := '{}'; v_warnings text[] := '{}';
  v_existing public.bn_risk_assessment%ROWTYPE;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_signal FROM public.bn_risk_signal WHERE signal_id = p_signal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','SIGNAL_NOT_FOUND','data', NULL);
  END IF;

  IF NOT COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false) THEN
    v_blockers := v_blockers || 'You do not have permission to create a risk assessment.';
  END IF;
  IF v_signal.status IN ('DISMISSED','CLOSED') THEN
    v_blockers := v_blockers || 'This signal has been closed or dismissed.';
  ELSIF v_signal.status = 'NEW' THEN
    v_blockers := v_blockers || 'This signal must be triaged before an assessment can be created.';
  END IF;
  IF v_signal.person_id IS NULL THEN
    v_blockers := v_blockers || 'The subject of this signal could not be resolved.';
  END IF;

  SELECT a.* INTO v_existing FROM public.bn_risk_assessment a
    JOIN public.bn_risk_assessment_signal s ON s.assessment_id = a.assessment_id
   WHERE s.signal_id = p_signal_id
     AND a.status NOT IN ('COMPLETED','CLOSED')
   LIMIT 1;
  IF FOUND THEN
    v_blockers := v_blockers ||
      format('This signal is already covered by risk assessment %s.', v_existing.assessment_reference);
  END IF;

  IF v_signal.status = 'TRIAGED' THEN
    v_warnings := v_warnings || 'This signal has not yet been confirmed under review.';
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'signal_id', p_signal_id,
    'signal_reference', v_signal.signal_reference,
    'signal_status', v_signal.status,
    'person_id', v_signal.person_id,
    'category_code', v_signal.category_code,
    'existing_assessment_id', v_existing.assessment_id,
    'existing_assessment_reference', v_existing.assessment_reference,
    'can_create', (array_length(v_blockers,1) IS NULL),
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings)));
END; $$;

-- ============ command boundary ============
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_reason_code text,
  p_justification text, p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload,'{}'::jsonb);
  v_a public.bn_risk_assessment%ROWTYPE;
  v_signal public.bn_risk_signal%ROWTYPE;
  v_ft public.bn_risk_factor_type%ROWTYPE;
  v_old_factor public.bn_risk_factor%ROWTYPE;
  v_req public.bn_risk_information_request%ROWTYPE;
  v_link public.bn_risk_evidence_link%ROWTYPE;
  v_result jsonb; v_ref text; v_new uuid; v_dedupe text;
  v_readiness jsonb; v_sig uuid; v_role text; v_item jsonb;
  v_direction text; v_provenance text; v_status text; v_new_status text;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED: no actor'; END IF;

  IF p_command_name NOT IN (
      'BN_RISK_CREATE_ASSESSMENT','BN_RISK_ADD_FACTOR','BN_RISK_REQUEST_EVIDENCE',
      'BN_RISK_OP_CORRECT_FACTOR','BN_RISK_OP_VOID_FACTOR','BN_RISK_OP_LINK_EVIDENCE',
      'BN_RISK_OP_UNLINK_EVIDENCE','BN_RISK_OP_RECORD_EVIDENCE_USABILITY',
      'BN_RISK_OP_RECORD_REQUEST_RESPONSE','BN_RISK_OP_CLOSE_REQUEST',
      'BN_RISK_OP_ADD_SIGNAL','BN_RISK_OP_ASSIGN_ASSESSMENT',
      'BN_RISK_OP_COMPLETE_INFORMATION_GATHERING','BN_RISK_OP_RECORD_COMMUNICATION_RESULT') THEN
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: %', p_command_name;
  END IF;

  IF p_command_name IN ('BN_RISK_OP_VOID_FACTOR','BN_RISK_OP_COMPLETE_INFORMATION_GATHERING') THEN
    PERFORM public._bn_risk_require(p_actor_user_id, 'decide', true);
  ELSE
    PERFORM public._bn_risk_require(p_actor_user_id, 'write', true);
  END IF;

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

  -- ---------- CREATE ASSESSMENT ----------
  IF p_command_name = 'BN_RISK_CREATE_ASSESSMENT' THEN
    v_sig := NULLIF(v_payload->>'primary_signal_id','')::uuid;
    IF v_sig IS NULL THEN RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: primary_signal_id'; END IF;

    v_readiness := public.bn_risk_assessment_creation_readiness_v1(p_actor_user_id, v_sig);
    IF v_readiness->>'status' <> 'OK' THEN
      RAISE EXCEPTION 'E_NOT_FOUND: signal';
    END IF;
    IF NOT COALESCE((v_readiness->'data'->>'can_create')::boolean,false) THEN
      RAISE EXCEPTION 'E_INVALID_STATE: %',
        COALESCE(v_readiness->'data'->'blockers'->>0,'this signal cannot start an assessment');
    END IF;

    SELECT * INTO v_signal FROM public.bn_risk_signal WHERE signal_id = v_sig FOR UPDATE;

    v_ref := public._bn_risk_next_assessment_reference();
    INSERT INTO public.bn_risk_assessment(
      assessment_reference, person_id, person_ssn, primary_signal_id, primary_category_code,
      claim_id, award_id, payment_id, means_assessment_id, summary, context_snapshot,
      status, opened_by_user_id, assigned_owner_user_id, assigned_team_code, correlation_id)
    VALUES (v_ref, v_signal.person_id, v_signal.person_ssn, v_sig, v_signal.category_code,
      v_signal.claim_id, v_signal.award_id, v_signal.payment_id, v_signal.means_assessment_id,
      COALESCE(NULLIF(btrim(COALESCE(v_payload->>'summary','')),''), v_signal.summary),
      jsonb_build_object(
        'source_module', v_signal.source_module,
        'source_reference', v_signal.source_reference,
        'signal_reference', v_signal.signal_reference,
        'signal_detected_at', v_signal.detected_at,
        'signal_category_code', v_signal.category_code),
      'OPEN', p_actor_user_id,
      COALESCE(NULLIF(v_payload->>'assigned_owner_user_id','')::uuid, p_actor_user_id),
      NULLIF(v_payload->>'assigned_team_code',''), p_correlation_id)
    RETURNING assessment_id INTO v_new;

    INSERT INTO public.bn_risk_assessment_signal(assessment_id, signal_id, role_code, added_by_user_id)
    VALUES (v_new, v_sig, 'PRIMARY', p_actor_user_id);

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'related_signals','[]'::jsonb))
    LOOP
      v_sig := NULLIF(v_item->>'signal_id','')::uuid;
      v_role := COALESCE(NULLIF(v_item->>'role_code',''),'RELATED');
      IF v_sig IS NULL THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='SIGNAL_ROLE' AND code=v_role AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: signal role %', v_role;
      END IF;
      IF EXISTS (SELECT 1 FROM public.bn_risk_assessment a
                   JOIN public.bn_risk_assessment_signal s ON s.assessment_id=a.assessment_id
                  WHERE s.signal_id = v_sig AND a.status NOT IN ('COMPLETED','CLOSED')) THEN
        RAISE EXCEPTION 'E_INVALID_STATE: a related signal is already covered by an active assessment';
      END IF;
      INSERT INTO public.bn_risk_assessment_signal(assessment_id, signal_id, role_code, added_by_user_id)
      VALUES (v_new, v_sig, v_role, p_actor_user_id)
      ON CONFLICT (assessment_id, signal_id) DO NOTHING;
    END LOOP;

    IF NULLIF(btrim(COALESCE(v_payload->>'restricted_note','')),'') IS NOT NULL THEN
      INSERT INTO public.bn_risk_assessment_note(assessment_id, note_kind, body, created_by_user_id)
      VALUES (v_new, 'RESTRICTED', v_payload->>'restricted_note', p_actor_user_id);
    END IF;

    PERFORM public._bn_risk_assessment_event(v_new, 'ASSESSMENT_CREATED', p_command_name,
      NULL, 'OPEN', p_reason_code, p_justification,
      jsonb_build_object('primary_signal_reference', v_signal.signal_reference),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, 1);

    v_result := jsonb_build_object('status','EXECUTED','assessment_id', v_new,
      'assessment_reference', v_ref, 'entity_version', 1, 'assessment_status','OPEN');

  ELSE
    IF p_assessment_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED: assessment_id'; END IF;
    SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: assessment'; END IF;
    IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_a.row_version THEN
      RAISE EXCEPTION 'E_STALE_ROW_VERSION: this assessment was updated by someone else — refresh and try again';
    END IF;
    IF v_a.status NOT IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW') THEN
      RAISE EXCEPTION 'E_INVALID_STATE: this assessment is beyond the information gathering stage';
    END IF;

    -- ---------- ADD / CORRECT FACTOR ----------
    IF p_command_name IN ('BN_RISK_ADD_FACTOR','BN_RISK_OP_CORRECT_FACTOR') THEN
      IF p_command_name = 'BN_RISK_OP_CORRECT_FACTOR' THEN
        SELECT * INTO v_old_factor FROM public.bn_risk_factor
          WHERE factor_id = NULLIF(v_payload->>'factor_id','')::uuid
            AND assessment_id = p_assessment_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: factor'; END IF;
        IF v_old_factor.status <> 'ACTIVE' THEN
          RAISE EXCEPTION 'E_INVALID_STATE: only an active factor can be corrected';
        END IF;
        IF NULLIF(btrim(COALESCE(v_payload->>'correction_reason','')),'') IS NULL THEN
          RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED: a correction reason is required';
        END IF;
      END IF;

      SELECT * INTO v_ft FROM public.bn_risk_factor_type
        WHERE factor_type_code = v_payload->>'factor_type_code' AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_INVALID_VALUE: factor_type_code'; END IF;

      v_direction := COALESCE(NULLIF(v_payload->>'direction_code',''), v_ft.default_direction_code);
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='FACTOR_DIRECTION' AND code=v_direction AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: direction_code';
      END IF;
      v_provenance := NULLIF(btrim(COALESCE(v_payload->>'provenance_code','')),'');
      IF v_provenance IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: the source of this observation is required';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='FACTOR_PROVENANCE' AND code=v_provenance AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: provenance_code';
      END IF;
      IF v_provenance <> 'OFFICER_CONFIRMED'
         AND NULLIF(btrim(COALESCE(v_payload->>'provenance_reference','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: a traceable source reference is required';
      END IF;
      IF v_ft.requires_reason AND NULLIF(btrim(COALESCE(v_payload->>'reason','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: a reason is required for this factor';
      END IF;
      IF v_ft.value_kind = 'AMOUNT' AND (v_payload->>'value_numeric') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: an amount is required for this factor';
      END IF;
      IF v_ft.value_kind = 'DATE' AND (v_payload->>'value_date') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: a date is required for this factor';
      END IF;
      IF v_ft.value_kind = 'TRISTATE' AND COALESCE(v_payload->>'value_code','') NOT IN ('YES','NO','UNKNOWN') THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: this factor expects yes, no or unknown';
      END IF;
      IF v_ft.value_kind = 'DECISION' AND v_ft.value_domain IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                          WHERE domain = v_ft.value_domain AND code = v_payload->>'value_code' AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: value_code';
      END IF;

      v_dedupe := public._bn_risk_dedupe_hash(concat_ws('|', p_assessment_id::text,
        v_ft.factor_type_code, COALESCE(v_payload->>'signal_id','-'),
        COALESCE(v_payload->>'subject_reference','-'), COALESCE(v_payload->>'value_code','-'),
        COALESCE(v_payload->>'value_numeric','-'), COALESCE(v_payload->>'value_date','-'),
        COALESCE(v_payload->>'value_text','-')));

      IF p_command_name = 'BN_RISK_ADD_FACTOR'
         AND EXISTS (SELECT 1 FROM public.bn_risk_factor
                      WHERE assessment_id = p_assessment_id AND dedupe_key = v_dedupe AND status='ACTIVE') THEN
        SELECT * INTO v_old_factor FROM public.bn_risk_factor
          WHERE assessment_id = p_assessment_id AND dedupe_key = v_dedupe AND status='ACTIVE';
        v_result := jsonb_build_object('status','DUPLICATE','assessment_id', p_assessment_id,
          'factor_id', v_old_factor.factor_id, 'factor_reference', v_old_factor.factor_reference,
          'entity_version', v_a.row_version,
          'message','An identical factor is already recorded on this assessment.');
        IF p_idempotency_key IS NOT NULL THEN
          INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
            assessment_id, entity_version, result_json, status, actor_user_id, completed_at)
          VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), p_assessment_id,
            v_a.row_version, v_result, 'COMPLETED', p_actor_user_id, now());
        END IF;
        RETURN v_result;
      END IF;

      v_ref := public._bn_risk_next_factor_reference();
      INSERT INTO public.bn_risk_factor(
        factor_reference, assessment_id, signal_id, factor_type_code, category_code,
        direction_code, provenance_code, provenance_reference, subject_kind, subject_reference,
        materiality_code, observed_on, value_kind, value_text, value_numeric, value_date,
        value_boolean, value_code, value_context, evidence_requirement_code, reason, notes,
        status, supersedes_factor_id, correction_reason, factor_version, dedupe_key,
        correlation_id, created_by_user_id)
      VALUES (
        v_ref, p_assessment_id, NULLIF(v_payload->>'signal_id','')::uuid, v_ft.factor_type_code,
        COALESCE(NULLIF(v_payload->>'category_code',''), v_a.primary_category_code),
        v_direction, v_provenance, NULLIF(v_payload->>'provenance_reference',''),
        NULLIF(v_payload->>'subject_kind',''), NULLIF(v_payload->>'subject_reference',''),
        NULLIF(v_payload->>'materiality_code',''), NULLIF(v_payload->>'observed_on','')::date,
        v_ft.value_kind, NULLIF(v_payload->>'value_text',''),
        NULLIF(v_payload->>'value_numeric','')::numeric, NULLIF(v_payload->>'value_date','')::date,
        NULLIF(v_payload->>'value_boolean','')::boolean, NULLIF(v_payload->>'value_code',''),
        COALESCE(v_payload->'value_context','{}'::jsonb), v_ft.evidence_requirement_code,
        NULLIF(v_payload->>'reason',''), NULLIF(v_payload->>'notes',''), 'ACTIVE',
        CASE WHEN p_command_name='BN_RISK_OP_CORRECT_FACTOR' THEN v_old_factor.factor_id END,
        NULLIF(v_payload->>'correction_reason',''),
        CASE WHEN p_command_name='BN_RISK_OP_CORRECT_FACTOR' THEN v_old_factor.factor_version + 1 ELSE 1 END,
        v_dedupe, p_correlation_id, p_actor_user_id)
      RETURNING factor_id INTO v_new;

      IF p_command_name = 'BN_RISK_OP_CORRECT_FACTOR' THEN
        UPDATE public.bn_risk_factor
           SET status='SUPERSEDED', superseded_by_factor_id = v_new
         WHERE factor_id = v_old_factor.factor_id;
      END IF;

      UPDATE public.bn_risk_assessment SET row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;

      PERFORM public._bn_risk_assessment_event(p_assessment_id,
        CASE WHEN p_command_name='BN_RISK_OP_CORRECT_FACTOR' THEN 'FACTOR_CORRECTED' ELSE 'FACTOR_ADDED' END,
        p_command_name, v_a.status, v_a.status, p_reason_code,
        COALESCE(NULLIF(v_payload->>'correction_reason',''), p_justification),
        jsonb_build_object('factor_reference', v_ref, 'factor_type', v_ft.label,
          'direction_code', v_direction, 'provenance_code', v_provenance,
          'supersedes', v_old_factor.factor_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'factor_id', v_new, 'factor_reference', v_ref, 'entity_version', v_a.row_version + 1);

    -- ---------- VOID FACTOR ----------
    ELSIF p_command_name = 'BN_RISK_OP_VOID_FACTOR' THEN
      SELECT * INTO v_old_factor FROM public.bn_risk_factor
        WHERE factor_id = NULLIF(v_payload->>'factor_id','')::uuid
          AND assessment_id = p_assessment_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: factor'; END IF;
      IF v_old_factor.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'E_INVALID_STATE: this factor is no longer active';
      END IF;
      IF NULLIF(btrim(COALESCE(p_reason_code,'')),'') IS NULL
         OR NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                         WHERE domain='FACTOR_VOID_REASON' AND code=p_reason_code AND is_active) THEN
        RAISE EXCEPTION 'E_REASON_CODE_REQUIRED: a void reason is required';
      END IF;
      IF NULLIF(btrim(COALESCE(p_justification,'')),'') IS NULL THEN
        RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED: a justification is required to void a factor';
      END IF;

      UPDATE public.bn_risk_factor
         SET status='VOID', void_reason_code = p_reason_code, void_justification = p_justification,
             voided_at = now(), voided_by_user_id = p_actor_user_id
       WHERE factor_id = v_old_factor.factor_id;
      UPDATE public.bn_risk_assessment SET row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;

      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'FACTOR_VOIDED', p_command_name,
        v_a.status, v_a.status, p_reason_code, p_justification,
        jsonb_build_object('factor_reference', v_old_factor.factor_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'factor_id', v_old_factor.factor_id, 'entity_version', v_a.row_version + 1);

    -- ---------- LINK EVIDENCE ----------
    ELSIF p_command_name = 'BN_RISK_OP_LINK_EVIDENCE' THEN
      IF NULLIF(btrim(COALESCE(v_payload->>'document_id','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: document_id';
      END IF;
      IF EXISTS (SELECT 1 FROM public.bn_risk_evidence_link
                  WHERE assessment_id = p_assessment_id
                    AND document_id = v_payload->>'document_id'
                    AND COALESCE(factor_id,'00000000-0000-0000-0000-000000000000'::uuid)
                        = COALESCE(NULLIF(v_payload->>'factor_id','')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
                    AND status='LINKED') THEN
        RAISE EXCEPTION 'E_DUPLICATE_LINK: this document is already linked here';
      END IF;

      INSERT INTO public.bn_risk_evidence_link(assessment_id, factor_id, signal_id, document_id,
        document_reference, document_title, document_type_code, document_source, received_on,
        scope_code, usability_code, created_by_user_id)
      VALUES (p_assessment_id, NULLIF(v_payload->>'factor_id','')::uuid,
        NULLIF(v_payload->>'signal_id','')::uuid, v_payload->>'document_id',
        NULLIF(v_payload->>'document_reference',''), NULLIF(v_payload->>'document_title',''),
        NULLIF(v_payload->>'document_type_code',''), NULLIF(v_payload->>'document_source',''),
        NULLIF(v_payload->>'received_on','')::date,
        COALESCE(NULLIF(v_payload->>'scope_code',''),'ASSESSMENT'), 'RECEIVED', p_actor_user_id)
      RETURNING evidence_link_id INTO v_new;

      UPDATE public.bn_risk_assessment SET row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'EVIDENCE_LINKED', p_command_name,
        v_a.status, v_a.status, NULL, NULL,
        jsonb_build_object('document_reference', v_payload->>'document_reference'),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'evidence_link_id', v_new, 'entity_version', v_a.row_version + 1);

    ELSIF p_command_name = 'BN_RISK_OP_UNLINK_EVIDENCE' THEN
      SELECT * INTO v_link FROM public.bn_risk_evidence_link
        WHERE evidence_link_id = NULLIF(v_payload->>'evidence_link_id','')::uuid
          AND assessment_id = p_assessment_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: evidence link'; END IF;
      UPDATE public.bn_risk_evidence_link
         SET status='UNLINKED', unlinked_at = now(), unlink_reason = NULLIF(v_payload->>'reason','')
       WHERE evidence_link_id = v_link.evidence_link_id;
      UPDATE public.bn_risk_assessment SET row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'EVIDENCE_UNLINKED', p_command_name,
        v_a.status, v_a.status, NULL, NULLIF(v_payload->>'reason',''),
        jsonb_build_object('document_reference', v_link.document_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'entity_version', v_a.row_version + 1);

    ELSIF p_command_name = 'BN_RISK_OP_RECORD_EVIDENCE_USABILITY' THEN
      SELECT * INTO v_link FROM public.bn_risk_evidence_link
        WHERE evidence_link_id = NULLIF(v_payload->>'evidence_link_id','')::uuid
          AND assessment_id = p_assessment_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: evidence link'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='EVIDENCE_USABILITY' AND code = v_payload->>'usability_code' AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: usability_code';
      END IF;
      UPDATE public.bn_risk_evidence_link
         SET usability_code = v_payload->>'usability_code',
             usability_reason = NULLIF(v_payload->>'usability_reason',''),
             usability_recorded_at = now(), usability_recorded_by_user_id = p_actor_user_id
       WHERE evidence_link_id = v_link.evidence_link_id;
      UPDATE public.bn_risk_assessment SET row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'EVIDENCE_USABILITY_RECORDED',
        p_command_name, v_a.status, v_a.status, v_payload->>'usability_code',
        NULLIF(v_payload->>'usability_reason',''),
        jsonb_build_object('document_reference', v_link.document_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'entity_version', v_a.row_version + 1);

    -- ---------- REQUEST EVIDENCE ----------
    ELSIF p_command_name = 'BN_RISK_REQUEST_EVIDENCE' THEN
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='REQUEST_TYPE' AND code = v_payload->>'request_type_code' AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: request_type_code';
      END IF;
      IF NULLIF(btrim(COALESCE(v_payload->>'required_information','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: describe the information required';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='REQUEST_RECIPIENT_KIND'
                        AND code = COALESCE(v_payload->>'recipient_kind','PERSON') AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: recipient_kind';
      END IF;
      IF (v_payload->>'channel_code') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                          WHERE domain='REQUEST_CHANNEL' AND code = v_payload->>'channel_code' AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: channel_code';
      END IF;

      v_ref := public._bn_risk_next_request_reference();
      INSERT INTO public.bn_risk_information_request(
        request_reference, assessment_id, factor_id, signal_id, request_type_code, recipient_kind,
        recipient_person_id, recipient_name, recipient_reference, required_information, reason,
        due_on, is_blocking, channel_code, status, communication_status, correlation_id,
        created_by_user_id)
      VALUES (v_ref, p_assessment_id, NULLIF(v_payload->>'factor_id','')::uuid,
        NULLIF(v_payload->>'signal_id','')::uuid, v_payload->>'request_type_code',
        COALESCE(NULLIF(v_payload->>'recipient_kind',''),'PERSON'),
        COALESCE(NULLIF(v_payload->>'recipient_person_id','')::bigint, v_a.person_id),
        NULLIF(v_payload->>'recipient_name',''), NULLIF(v_payload->>'recipient_reference',''),
        v_payload->>'required_information', NULLIF(v_payload->>'reason',''),
        NULLIF(v_payload->>'due_on','')::date,
        COALESCE(NULLIF(v_payload->>'is_blocking','')::boolean, true),
        NULLIF(v_payload->>'channel_code',''), 'REQUESTED', 'PENDING_DISPATCH',
        p_correlation_id, p_actor_user_id)
      RETURNING request_id INTO v_new;

      v_new_status := v_a.status;
      IF COALESCE(NULLIF(v_payload->>'is_blocking','')::boolean, true)
         AND public._bn_risk_assessment_can_transition(v_a.status, 'INFORMATION_PENDING') THEN
        v_new_status := 'INFORMATION_PENDING';
      END IF;
      UPDATE public.bn_risk_assessment
         SET status = v_new_status, information_gathering_complete = false,
             row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;

      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'INFORMATION_REQUESTED',
        p_command_name, v_a.status, v_new_status, NULL, NULLIF(v_payload->>'reason',''),
        jsonb_build_object('request_reference', v_ref,
          'is_blocking', COALESCE(NULLIF(v_payload->>'is_blocking','')::boolean, true),
          'due_on', v_payload->>'due_on'),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'request_id', v_new, 'request_reference', v_ref,
        'assessment_status', v_new_status, 'entity_version', v_a.row_version + 1,
        'communication_status','PENDING_DISPATCH');

    ELSIF p_command_name = 'BN_RISK_OP_RECORD_COMMUNICATION_RESULT' THEN
      SELECT * INTO v_req FROM public.bn_risk_information_request
        WHERE request_id = NULLIF(v_payload->>'request_id','')::uuid
          AND assessment_id = p_assessment_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: information request'; END IF;
      IF COALESCE(v_payload->>'communication_status','') NOT IN
         ('DISPATCHED','FAILED','NOT_DISPATCHED','PENDING_DISPATCH') THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: communication_status';
      END IF;
      UPDATE public.bn_risk_information_request
         SET communication_status = v_payload->>'communication_status',
             communication_request_id = NULLIF(v_payload->>'communication_request_id','')::uuid,
             communication_detail = NULLIF(v_payload->>'communication_detail',''),
             status = CASE WHEN v_payload->>'communication_status' = 'DISPATCHED' AND status='REQUESTED'
                           THEN 'SENT' ELSE status END,
             row_version = row_version + 1
       WHERE request_id = v_req.request_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'INFORMATION_REQUEST_DISPATCH_RECORDED',
        p_command_name, v_a.status, v_a.status, v_payload->>'communication_status',
        NULLIF(v_payload->>'communication_detail',''),
        jsonb_build_object('request_reference', v_req.request_reference),
        p_actor_user_id, p_actor_user_code, 'SYSTEM', p_correlation_id, v_a.row_version);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'request_id', v_req.request_id, 'entity_version', v_a.row_version);

    ELSIF p_command_name = 'BN_RISK_OP_RECORD_REQUEST_RESPONSE' THEN
      SELECT * INTO v_req FROM public.bn_risk_information_request
        WHERE request_id = NULLIF(v_payload->>'request_id','')::uuid
          AND assessment_id = p_assessment_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: information request'; END IF;
      IF v_req.status IN ('RESOLVED','CANCELLED') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: this request is already closed';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='RESPONSE_OUTCOME' AND code = v_payload->>'response_outcome_code' AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: response_outcome_code';
      END IF;
      UPDATE public.bn_risk_information_request
         SET status='RESPONSE_RECEIVED', response_received_at = now(),
             response_summary = NULLIF(v_payload->>'response_summary',''),
             response_outcome_code = v_payload->>'response_outcome_code',
             row_version = row_version + 1
       WHERE request_id = v_req.request_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'INFORMATION_RESPONSE_RECEIVED',
        p_command_name, v_a.status, v_a.status, v_payload->>'response_outcome_code',
        NULLIF(v_payload->>'response_summary',''),
        jsonb_build_object('request_reference', v_req.request_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'request_id', v_req.request_id, 'entity_version', v_a.row_version);

    ELSIF p_command_name = 'BN_RISK_OP_CLOSE_REQUEST' THEN
      SELECT * INTO v_req FROM public.bn_risk_information_request
        WHERE request_id = NULLIF(v_payload->>'request_id','')::uuid
          AND assessment_id = p_assessment_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: information request'; END IF;
      IF v_req.status IN ('RESOLVED','CANCELLED') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: this request is already closed';
      END IF;
      IF NULLIF(btrim(COALESCE(v_payload->>'closure_reason','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED: a closure reason is required';
      END IF;
      v_status := CASE WHEN COALESCE(v_payload->>'outcome','RESOLVED') = 'CANCELLED'
                       THEN 'CANCELLED' ELSE 'RESOLVED' END;
      UPDATE public.bn_risk_information_request
         SET status = v_status, resolved_at = now(), resolved_by_user_id = p_actor_user_id,
             closure_reason = v_payload->>'closure_reason', row_version = row_version + 1
       WHERE request_id = v_req.request_id;
      UPDATE public.bn_risk_assessment SET row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'INFORMATION_REQUEST_CLOSED',
        p_command_name, v_a.status, v_a.status, v_status, v_payload->>'closure_reason',
        jsonb_build_object('request_reference', v_req.request_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'request_id', v_req.request_id, 'entity_version', v_a.row_version + 1);

    ELSIF p_command_name = 'BN_RISK_OP_ADD_SIGNAL' THEN
      v_sig := NULLIF(v_payload->>'signal_id','')::uuid;
      v_role := COALESCE(NULLIF(v_payload->>'role_code',''),'RELATED');
      IF v_sig IS NULL THEN RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: signal_id'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='SIGNAL_ROLE' AND code=v_role AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: role_code';
      END IF;
      SELECT * INTO v_signal FROM public.bn_risk_signal WHERE signal_id = v_sig;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: signal'; END IF;
      IF v_signal.status IN ('DISMISSED','CLOSED') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: a dismissed or closed signal cannot be added';
      END IF;
      IF EXISTS (SELECT 1 FROM public.bn_risk_assessment_signal
                  WHERE assessment_id = p_assessment_id AND signal_id = v_sig) THEN
        RAISE EXCEPTION 'E_DUPLICATE_LINK: this signal is already part of the assessment';
      END IF;
      IF EXISTS (SELECT 1 FROM public.bn_risk_assessment a
                   JOIN public.bn_risk_assessment_signal s ON s.assessment_id=a.assessment_id
                  WHERE s.signal_id = v_sig AND a.status NOT IN ('COMPLETED','CLOSED')) THEN
        RAISE EXCEPTION 'E_INVALID_STATE: this signal is already covered by another active assessment';
      END IF;
      INSERT INTO public.bn_risk_assessment_signal(assessment_id, signal_id, role_code, added_by_user_id)
      VALUES (p_assessment_id, v_sig, v_role, p_actor_user_id);
      UPDATE public.bn_risk_assessment SET row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'SIGNAL_ADDED_TO_ASSESSMENT',
        p_command_name, v_a.status, v_a.status, v_role, NULL,
        jsonb_build_object('signal_reference', v_signal.signal_reference),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'entity_version', v_a.row_version + 1);

    ELSIF p_command_name = 'BN_RISK_OP_ASSIGN_ASSESSMENT' THEN
      UPDATE public.bn_risk_assessment
         SET assigned_owner_user_id = NULLIF(v_payload->>'assigned_owner_user_id','')::uuid,
             assigned_team_code = NULLIF(v_payload->>'assigned_team_code',''),
             row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'ASSESSMENT_ASSIGNED', p_command_name,
        v_a.status, v_a.status, NULL, NULL, '{}'::jsonb,
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'entity_version', v_a.row_version + 1);

    -- ---------- COMPLETE INFORMATION GATHERING ----------
    ELSE
      v_readiness := public.bn_risk_assessment_readiness_v1(p_actor_user_id, p_assessment_id);
      IF NOT COALESCE((v_readiness->'data'->>'can_review')::boolean,false) THEN
        RAISE EXCEPTION 'E_INVALID_STATE: %',
          COALESCE(v_readiness->'data'->'blockers'->>0,
                   'information gathering is not complete');
      END IF;
      IF NOT public._bn_risk_assessment_can_transition(v_a.status, 'REVIEW') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: this assessment cannot move to review from %', v_a.status;
      END IF;
      UPDATE public.bn_risk_assessment
         SET status='REVIEW', information_gathering_complete = true,
             information_complete_at = now(), review_entered_at = now(),
             row_version = row_version + 1
       WHERE assessment_id = p_assessment_id;
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'INFORMATION_GATHERING_COMPLETED',
        p_command_name, v_a.status, 'REVIEW', p_reason_code, p_justification, '{}'::jsonb,
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
        'assessment_status','REVIEW','entity_version', v_a.row_version + 1);
    END IF;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
      assessment_id, entity_version, result_json, status, actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''),
      NULLIF(v_result->>'assessment_id','')::uuid, NULLIF(v_result->>'entity_version','')::bigint,
      v_result, 'COMPLETED', p_actor_user_id, now());
  END IF;

  RETURN v_result;
END; $$;

-- ============ readiness ============
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_blockers text[] := '{}'; v_warnings text[] := '{}';
  v_active int; v_required int; v_unsatisfied int; v_blocking_open int; v_signals int;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;

  SELECT count(*) INTO v_signals FROM public.bn_risk_assessment_signal
   WHERE assessment_id = p_assessment_id;
  SELECT count(*) INTO v_active FROM public.bn_risk_factor
   WHERE assessment_id = p_assessment_id AND status = 'ACTIVE';
  SELECT count(*) INTO v_required FROM public.bn_risk_factor
   WHERE assessment_id = p_assessment_id AND status='ACTIVE' AND evidence_requirement_code='REQUIRED';
  SELECT count(*) INTO v_unsatisfied FROM public.bn_risk_factor f
   WHERE f.assessment_id = p_assessment_id AND f.status='ACTIVE'
     AND f.evidence_requirement_code='REQUIRED'
     AND NOT EXISTS (SELECT 1 FROM public.bn_risk_evidence_link e
                      WHERE e.assessment_id = f.assessment_id AND e.factor_id = f.factor_id
                        AND e.status='LINKED' AND e.usability_code='USABLE');
  SELECT count(*) INTO v_blocking_open FROM public.bn_risk_information_request
   WHERE assessment_id = p_assessment_id AND is_blocking
     AND status NOT IN ('RESOLVED','CANCELLED');

  IF v_active = 0 THEN
    v_blockers := v_blockers || 'Record at least one factor before moving to review.';
  END IF;
  IF v_unsatisfied > 0 THEN
    v_blockers := v_blockers ||
      format('%s factor(s) still need usable supporting evidence.', v_unsatisfied);
  END IF;
  IF v_blocking_open > 0 THEN
    v_blockers := v_blockers ||
      format('%s information request(s) are still outstanding.', v_blocking_open);
  END IF;
  IF v_a.status NOT IN ('DRAFT','OPEN','INFORMATION_PENDING') THEN
    v_blockers := v_blockers || 'This assessment has already left information gathering.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_risk_evidence_link
              WHERE assessment_id = p_assessment_id AND status='LINKED' AND usability_code='RECEIVED') THEN
    v_warnings := v_warnings || 'Some linked evidence has not yet been assessed for usability.';
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'linked_signal_count', v_signals,
    'active_factor_count', v_active,
    'evidence_required_factor_count', v_required,
    'outstanding_evidence_count', v_unsatisfied,
    'open_blocking_request_count', v_blocking_open,
    'information_gathering_complete', v_a.information_gathering_complete,
    'can_review', (array_length(v_blockers,1) IS NULL),
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'stage_note', CASE
      WHEN array_length(v_blockers,1) IS NULL
        THEN 'Information gathering is sufficiently complete. Scoring and recommendation are not available in this release.'
      ELSE 'Information gathering is still in progress.' END));
END; $$;

-- ============ available actions ============
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_actions_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_write boolean; v_decide boolean; v_early boolean; v_ready jsonb; v_actions jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;
  v_write := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false);
  v_decide := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  v_early := v_a.status IN ('DRAFT','OPEN','INFORMATION_PENDING');
  v_ready := public.bn_risk_assessment_readiness_v1(p_actor_user_id, p_assessment_id);

  v_actions := jsonb_build_array(
    jsonb_build_object('action','ADD_FACTOR','label','Record factor',
      'command','BN_RISK_ADD_FACTOR','enabled', v_write AND v_early),
    jsonb_build_object('action','CORRECT_FACTOR','label','Correct factor',
      'command','BN_RISK_OP_CORRECT_FACTOR','enabled', v_write AND v_early),
    jsonb_build_object('action','VOID_FACTOR','label','Void factor',
      'command','BN_RISK_OP_VOID_FACTOR','enabled', v_decide AND v_early),
    jsonb_build_object('action','LINK_EVIDENCE','label','Link evidence',
      'command','BN_RISK_OP_LINK_EVIDENCE','enabled', v_write AND v_early),
    jsonb_build_object('action','RECORD_EVIDENCE_USABILITY','label','Record evidence usability',
      'command','BN_RISK_OP_RECORD_EVIDENCE_USABILITY','enabled', v_write AND v_early),
    jsonb_build_object('action','REQUEST_EVIDENCE','label','Request information',
      'command','BN_RISK_REQUEST_EVIDENCE','enabled', v_write AND v_early),
    jsonb_build_object('action','RECORD_RESPONSE','label','Record response',
      'command','BN_RISK_OP_RECORD_REQUEST_RESPONSE','enabled', v_write AND v_early),
    jsonb_build_object('action','CLOSE_REQUEST','label','Close request',
      'command','BN_RISK_OP_CLOSE_REQUEST','enabled', v_write AND v_early),
    jsonb_build_object('action','ADD_SIGNAL','label','Add signal',
      'command','BN_RISK_OP_ADD_SIGNAL','enabled', v_write AND v_early),
    jsonb_build_object('action','COMPLETE_INFORMATION_GATHERING','label','Complete information gathering',
      'command','BN_RISK_OP_COMPLETE_INFORMATION_GATHERING',
      'enabled', v_decide AND v_early AND COALESCE((v_ready->'data'->>'can_review')::boolean,false)));

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'row_version', v_a.row_version,
    'actions', v_actions,
    'notice', CASE WHEN NOT v_early
      THEN 'This assessment has left the information gathering stage. Later stages are not available in this release.'
      ELSE NULL END));
END; $$;

-- ============ factor catalogue ============
CREATE OR REPLACE FUNCTION public.bn_risk_factor_catalogue_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_cats text[]; v_rows jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;
  SELECT array_agg(DISTINCT s.category_code) INTO v_cats
    FROM public.bn_risk_assessment_signal a
    JOIN public.bn_risk_signal s ON s.signal_id = a.signal_id
   WHERE a.assessment_id = p_assessment_id;
  v_cats := COALESCE(v_cats, ARRAY[v_a.primary_category_code]);

  SELECT jsonb_agg(jsonb_build_object(
      'factor_type_code', t.factor_type_code, 'label', t.label, 'description', t.description,
      'value_kind', t.value_kind, 'value_domain', t.value_domain,
      'default_direction_code', t.default_direction_code,
      'evidence_requirement_code', t.evidence_requirement_code,
      'requires_reason', t.requires_reason,
      'is_contextual', (cardinality(t.applicable_category_codes) = 0
                        OR t.applicable_category_codes && v_cats))
      ORDER BY (cardinality(t.applicable_category_codes) > 0
                AND t.applicable_category_codes && v_cats) DESC, t.sort_order, t.label)
    INTO v_rows
    FROM public.bn_risk_factor_type t WHERE t.is_active;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'context_categories', to_jsonb(v_cats),
    'factor_types', COALESCE(v_rows,'[]'::jsonb)));
END; $$;

-- ============ evidence search (existing document store only) ============
CREATE OR REPLACE FUNCTION public.bn_risk_evidence_search_v1(
  p_actor_user_id uuid, p_assessment_id uuid, p_search text, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_rows jsonb; v_q text;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;
  v_q := '%' || COALESCE(btrim(p_search),'') || '%';

  SELECT jsonb_agg(r ORDER BY r->>'received_on' DESC NULLS LAST) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'document_id', d.id::text,
      'document_reference', d.reference_no,
      'document_title', COALESCE(d.subject, d.doc_type_code, 'Document'),
      'document_type_code', d.doc_type_code,
      'document_source', d.module_code,
      'received_on', COALESCE(d.issued_at, d.generated_at)::date,
      'business_context', concat_ws(' · ', d.entity_type, d.entity_id),
      'already_linked', EXISTS (SELECT 1 FROM public.bn_risk_evidence_link l
                                 WHERE l.assessment_id = p_assessment_id
                                   AND l.document_id = d.id::text AND l.status='LINKED')) AS r
      FROM public.core_generated_document d
     WHERE (
        (v_a.person_id IS NOT NULL AND d.entity_id = v_a.person_id::text)
        OR (v_a.claim_id IS NOT NULL AND d.entity_id = v_a.claim_id::text)
        OR (v_a.award_id IS NOT NULL AND d.entity_id = v_a.award_id::text)
        OR (v_a.means_assessment_id IS NOT NULL AND d.entity_id = v_a.means_assessment_id::text)
        OR (btrim(COALESCE(p_search,'')) <> '' AND d.reference_no ILIKE v_q))
       AND (btrim(COALESCE(p_search,'')) = ''
            OR d.reference_no ILIKE v_q OR COALESCE(d.subject,'') ILIKE v_q
            OR COALESCE(d.doc_type_code,'') ILIKE v_q)
     LIMIT GREATEST(COALESCE(p_limit,20),1)) t;

  RETURN jsonb_build_object('status','OK','data',
    jsonb_build_object('rows', COALESCE(v_rows,'[]'::jsonb)));
END; $$;

-- ============ assessment detail ============
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_detail_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_restricted boolean;
  v_signals jsonb; v_factors jsonb; v_evidence jsonb; v_requests jsonb;
  v_history jsonb; v_notes jsonb; v_ready jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;
  v_restricted := COALESCE(
    (public.bn_risk_check_actor_permission(p_actor_user_id,'restricted_notes',false)->>'ok')::boolean, false);

  SELECT jsonb_agg(jsonb_build_object(
    'signal_id', s.signal_id, 'signal_reference', s.signal_reference,
    'role_code', l.role_code, 'status', s.status,
    'category_code', s.category_code,
    'category_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                 WHERE domain='CATEGORY' AND code=s.category_code), s.category_code),
    'source_module', s.source_module, 'source_reference', s.source_reference,
    'detected_at', s.detected_at, 'summary', s.summary) ORDER BY l.role_code, s.detected_at)
    INTO v_signals
    FROM public.bn_risk_assessment_signal l
    JOIN public.bn_risk_signal s ON s.signal_id = l.signal_id
   WHERE l.assessment_id = p_assessment_id;

  SELECT jsonb_agg(jsonb_build_object(
    'factor_id', f.factor_id, 'factor_reference', f.factor_reference,
    'factor_type_code', f.factor_type_code,
    'factor_type_label', COALESCE(t.label, f.factor_type_code),
    'direction_code', f.direction_code,
    'direction_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                  WHERE domain='FACTOR_DIRECTION' AND code=f.direction_code), f.direction_code),
    'provenance_code', f.provenance_code,
    'provenance_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                   WHERE domain='FACTOR_PROVENANCE' AND code=f.provenance_code), f.provenance_code),
    'provenance_reference', f.provenance_reference,
    'signal_id', f.signal_id,
    'subject_kind', f.subject_kind, 'subject_reference', f.subject_reference,
    'materiality_code', f.materiality_code, 'observed_on', f.observed_on,
    'value_kind', f.value_kind, 'value_text', f.value_text,
    'value_numeric', f.value_numeric::text, 'value_date', f.value_date,
    'value_boolean', f.value_boolean, 'value_code', f.value_code,
    'evidence_requirement_code', f.evidence_requirement_code,
    'evidence_satisfied', EXISTS (SELECT 1 FROM public.bn_risk_evidence_link e
                                   WHERE e.factor_id = f.factor_id AND e.status='LINKED'
                                     AND e.usability_code='USABLE'),
    'reason', f.reason, 'notes', f.notes, 'status', f.status,
    'supersedes_factor_id', f.supersedes_factor_id,
    'superseded_by_factor_id', f.superseded_by_factor_id,
    'correction_reason', f.correction_reason,
    'void_reason_code', f.void_reason_code, 'void_justification', f.void_justification,
    'factor_version', f.factor_version,
    'created_at', f.created_at,
    'created_by_name', public._bn_risk_actor_name(f.created_by_user_id))
    ORDER BY f.created_at DESC)
    INTO v_factors
    FROM public.bn_risk_factor f
    LEFT JOIN public.bn_risk_factor_type t ON t.factor_type_code = f.factor_type_code
   WHERE f.assessment_id = p_assessment_id;

  SELECT jsonb_agg(jsonb_build_object(
    'evidence_link_id', e.evidence_link_id, 'document_id', e.document_id,
    'document_reference', e.document_reference, 'document_title', e.document_title,
    'document_type_code', e.document_type_code, 'document_source', e.document_source,
    'received_on', e.received_on, 'scope_code', e.scope_code,
    'factor_id', e.factor_id, 'signal_id', e.signal_id,
    'usability_code', e.usability_code,
    'usability_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                  WHERE domain='EVIDENCE_USABILITY' AND code=e.usability_code), e.usability_code),
    'usability_reason', e.usability_reason, 'status', e.status,
    'created_at', e.created_at) ORDER BY e.created_at DESC)
    INTO v_evidence
    FROM public.bn_risk_evidence_link e WHERE e.assessment_id = p_assessment_id;

  SELECT jsonb_agg(jsonb_build_object(
    'request_id', r.request_id, 'request_reference', r.request_reference,
    'request_type_code', r.request_type_code,
    'request_type_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                     WHERE domain='REQUEST_TYPE' AND code=r.request_type_code), r.request_type_code),
    'recipient_kind', r.recipient_kind, 'recipient_name', r.recipient_name,
    'required_information', r.required_information, 'reason', r.reason,
    'due_on', r.due_on, 'is_blocking', r.is_blocking, 'channel_code', r.channel_code,
    'status', r.status,
    'status_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                               WHERE domain='REQUEST_STATUS' AND code=r.status), r.status),
    'communication_status', r.communication_status, 'communication_detail', r.communication_detail,
    'response_received_at', r.response_received_at, 'response_summary', r.response_summary,
    'response_outcome_code', r.response_outcome_code,
    'factor_id', r.factor_id, 'signal_id', r.signal_id,
    'resolved_at', r.resolved_at, 'created_at', r.created_at,
    'row_version', r.row_version) ORDER BY r.created_at DESC)
    INTO v_requests
    FROM public.bn_risk_information_request r WHERE r.assessment_id = p_assessment_id;

  SELECT jsonb_agg(jsonb_build_object(
    'event_code', e.event_code, 'from_status', e.from_status, 'to_status', e.to_status,
    'reason_code', e.reason_code, 'justification', e.justification,
    'detail', e.detail - 'restricted_note',
    'actor_name', public._bn_risk_actor_name(e.actor_user_id),
    'actor_source', e.actor_source, 'created_at', e.created_at) ORDER BY e.created_at DESC)
    INTO v_history
    FROM public.bn_risk_assessment_event e WHERE e.assessment_id = p_assessment_id;

  SELECT jsonb_agg(jsonb_build_object('note_id', n.note_id, 'note_kind', n.note_kind,
    'body', n.body, 'created_at', n.created_at) ORDER BY n.created_at DESC)
    INTO v_notes
    FROM public.bn_risk_assessment_note n
   WHERE n.assessment_id = p_assessment_id
     AND (n.note_kind = 'GENERAL' OR v_restricted);

  v_ready := public.bn_risk_assessment_readiness_v1(p_actor_user_id, p_assessment_id);

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'header', jsonb_build_object(
      'assessment_id', v_a.assessment_id,
      'assessment_reference', v_a.assessment_reference,
      'person_id', v_a.person_id,
      'person_name', (SELECT NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)),'')
                        FROM public.ip_master m WHERE m.ssn = v_a.person_ssn LIMIT 1),
      'person_masked_identifier', public._bn_risk_mask_ssn(v_a.person_ssn),
      'primary_category_code', v_a.primary_category_code,
      'primary_category_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                           WHERE domain='CATEGORY' AND code=v_a.primary_category_code),
                                          v_a.primary_category_code),
      'claim_reference', v_a.claim_reference, 'award_reference', v_a.award_reference,
      'means_assessment_reference', v_a.means_assessment_reference,
      'status', v_a.status,
      'status_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                 WHERE domain='ASSESSMENT_STATUS' AND code=v_a.status), v_a.status),
      'summary', v_a.summary,
      'opened_at', v_a.opened_at,
      'opened_by_name', public._bn_risk_actor_name(v_a.opened_by_user_id),
      'assigned_owner_name', public._bn_risk_actor_name(v_a.assigned_owner_user_id),
      'assigned_team_code', v_a.assigned_team_code,
      'linked_signal_count', (SELECT count(*) FROM public.bn_risk_assessment_signal
                               WHERE assessment_id = p_assessment_id),
      'information_gathering_complete', v_a.information_gathering_complete,
      'row_version', v_a.row_version),
    'context', v_a.context_snapshot,
    'signals', COALESCE(v_signals,'[]'::jsonb),
    'factors', COALESCE(v_factors,'[]'::jsonb),
    'evidence', COALESCE(v_evidence,'[]'::jsonb),
    'requests', COALESCE(v_requests,'[]'::jsonb),
    'history', COALESCE(v_history,'[]'::jsonb),
    'notes', COALESCE(v_notes,'[]'::jsonb),
    'restricted_notes_visible', v_restricted,
    'readiness', v_ready->'data',
    'technical', jsonb_build_object(
      'assessment_id', v_a.assessment_id,
      'primary_signal_id', v_a.primary_signal_id,
      'claim_id', v_a.claim_id, 'award_id', v_a.award_id,
      'payment_id', v_a.payment_id, 'means_assessment_id', v_a.means_assessment_id,
      'row_version', v_a.row_version, 'correlation_id', v_a.correlation_id)));
END; $$;

-- ============ assessment queue ============
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_queue_v1(
  p_actor_user_id uuid, p_filters jsonb, p_page integer, p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_rows jsonb; v_total int; v_counts jsonb;
  v_status text := NULLIF(p_filters->>'status',''); v_search text := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  v_own text := COALESCE(p_filters->>'ownership','ALL');
  v_page int := GREATEST(COALESCE(p_page,1),1); v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),1),100);
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _risk_q(x int) ON COMMIT DROP;

  WITH base AS (
    SELECT a.*,
      (SELECT count(*) FROM public.bn_risk_assessment_signal s WHERE s.assessment_id=a.assessment_id) sig_count,
      (SELECT count(*) FROM public.bn_risk_information_request r
        WHERE r.assessment_id=a.assessment_id AND r.status NOT IN ('RESOLVED','CANCELLED')) open_requests
      FROM public.bn_risk_assessment a
     WHERE a.status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW')
       AND (v_status IS NULL OR a.status = v_status)
       AND (v_own <> 'MINE' OR a.assigned_owner_user_id = p_actor_user_id)
       AND (v_own <> 'UNASSIGNED' OR a.assigned_owner_user_id IS NULL)
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
            OR a.summary ILIKE '%'||v_search||'%')
  )
  SELECT count(*), jsonb_object_agg(status, c) FROM (
    SELECT status, count(*) c FROM base GROUP BY status) s INTO v_total, v_counts;

  SELECT jsonb_agg(r) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'assessment_id', a.assessment_id, 'assessment_reference', a.assessment_reference,
      'person_id', a.person_id,
      'person_name', (SELECT NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)),'')
                        FROM public.ip_master m WHERE m.ssn = a.person_ssn LIMIT 1),
      'person_masked_identifier', public._bn_risk_mask_ssn(a.person_ssn),
      'primary_category_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                           WHERE domain='CATEGORY' AND code=a.primary_category_code),
                                          a.primary_category_code),
      'linked_signal_count', (SELECT count(*) FROM public.bn_risk_assessment_signal s
                               WHERE s.assessment_id=a.assessment_id),
      'status', a.status,
      'status_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                 WHERE domain='ASSESSMENT_STATUS' AND code=a.status), a.status),
      'outstanding_information', (SELECT count(*) FROM public.bn_risk_information_request r
                                   WHERE r.assessment_id=a.assessment_id
                                     AND r.status NOT IN ('RESOLVED','CANCELLED')),
      'assigned_owner_name', public._bn_risk_actor_name(a.assigned_owner_user_id),
      'assigned_team_code', a.assigned_team_code,
      'opened_at', a.opened_at,
      'age_days', GREATEST(0, (CURRENT_DATE - a.opened_at::date)),
      'action_required', CASE a.status
        WHEN 'DRAFT' THEN 'Start information gathering'
        WHEN 'OPEN' THEN 'Record factors and evidence'
        WHEN 'INFORMATION_PENDING' THEN 'Awaiting requested information'
        ELSE 'Ready for review' END) AS r
      FROM public.bn_risk_assessment a
     WHERE a.status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW')
       AND (v_status IS NULL OR a.status = v_status)
       AND (v_own <> 'MINE' OR a.assigned_owner_user_id = p_actor_user_id)
       AND (v_own <> 'UNASSIGNED' OR a.assigned_owner_user_id IS NULL)
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
            OR a.summary ILIKE '%'||v_search||'%')
     ORDER BY a.opened_at DESC
     LIMIT v_size OFFSET (v_page-1)*v_size) t;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', COALESCE(v_rows,'[]'::jsonb), 'total_count', COALESCE(v_total,0),
    'page', v_page, 'page_size', v_size, 'status_counts', COALESCE(v_counts,'{}'::jsonb)));
END; $$;

-- ============ signal → assessment links ============
CREATE OR REPLACE FUNCTION public.bn_risk_signal_assessment_links_v1(
  p_actor_user_id uuid, p_signal_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_perm jsonb; v_rows jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'assessment_id', a.assessment_id, 'assessment_reference', a.assessment_reference,
    'role_code', l.role_code, 'status', a.status,
    'status_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                               WHERE domain='ASSESSMENT_STATUS' AND code=a.status), a.status))
    ORDER BY a.opened_at DESC)
    INTO v_rows
    FROM public.bn_risk_assessment_signal l
    JOIN public.bn_risk_assessment a ON a.assessment_id = l.assessment_id
   WHERE l.signal_id = p_signal_id;
  RETURN jsonb_build_object('status','OK','data',
    jsonb_build_object('rows', COALESCE(v_rows,'[]'::jsonb)));
END; $$;

-- ============ privacy-safe 360 summary (extended, status only) ============
CREATE OR REPLACE FUNCTION public.bn_risk_person_safe_summary_v1(
  p_actor_user_id uuid, p_person_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_state text; v_label text;
  v_a public.bn_risk_assessment%ROWTYPE; v_open int;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  SELECT * INTO v_a FROM public.bn_risk_assessment
   WHERE person_id = p_person_id AND status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW')
   ORDER BY opened_at DESC LIMIT 1;

  IF FOUND THEN
    v_state := CASE WHEN v_a.status = 'INFORMATION_PENDING'
                    THEN 'AWAITING_INFORMATION' ELSE 'REVIEW_IN_PROGRESS' END;
    v_label := CASE WHEN v_a.status = 'INFORMATION_PENDING'
                    THEN 'Risk review — awaiting information' ELSE 'Risk review in progress' END;
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
      'person_id', p_person_id, 'review_state', v_state, 'review_state_label', v_label,
      'assessment_id', v_a.assessment_id,
      'assessment_reference', v_a.assessment_reference,
      'stage_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                WHERE domain='ASSESSMENT_STATUS' AND code=v_a.status), v_a.status)));
  END IF;

  SELECT count(*) INTO v_open FROM public.bn_risk_signal
   WHERE person_id = p_person_id AND status IN ('NEW','TRIAGED','LINKED','UNDER_REVIEW','CONFIRMED');
  IF v_open > 0 THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
      'person_id', p_person_id, 'review_state','ACTION_REQUIRED',
      'review_state_label','Risk review pending', 'assessment_id', NULL,
      'assessment_reference', NULL, 'stage_label', NULL));
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'person_id', p_person_id, 'review_state','NO_ACTIVE_REVIEW',
    'review_state_label','No active review', 'assessment_id', NULL,
    'assessment_reference', NULL, 'stage_label', NULL));
END; $$;

GRANT EXECUTE ON FUNCTION public.bn_risk_assessment_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_assessment_creation_readiness_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_assessment_readiness_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_assessment_actions_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_assessment_detail_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_assessment_queue_v1(uuid,jsonb,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_factor_catalogue_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_evidence_search_v1(uuid,uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_risk_signal_assessment_links_v1(uuid,uuid) TO authenticated;

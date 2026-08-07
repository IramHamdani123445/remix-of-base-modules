
CREATE OR REPLACE FUNCTION public._bn_risk_dedupe_hash(p_input text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(COALESCE(p_input,''), 'UTF8')), 'hex');
$$;

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

  IF p_command_name = 'BN_RISK_DISMISS_SIGNAL' THEN
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
      v_dedupe := public._bn_risk_dedupe_hash(concat_ws('|',
        CASE WHEN p_command_name = 'BN_RISK_REGISTER_MANUAL_SIGNAL' THEN 'MANUAL'
             ELSE upper(v_payload->>'source_module') END,
        COALESCE(v_payload->>'source_reference', p_idempotency_key::text, gen_random_uuid()::text),
        COALESCE(v_person::text,'-'),
        v_payload->>'category_code',
        COALESCE(v_payload->>'rule_code','-'),
        COALESCE(v_payload->>'source_version','-')));
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

    ELSE
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

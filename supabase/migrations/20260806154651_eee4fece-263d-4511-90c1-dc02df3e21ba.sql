CREATE OR REPLACE FUNCTION public.bn_mortality_execute_command_v2(
  p_command_name text,
  p_entity_id uuid,
  p_actor_user_id uuid,
  p_actor_user_code text,
  p_correlation_id uuid,
  p_expected_row_version bigint,
  p_reason_code text,
  p_justification text,
  p_payload jsonb,
  p_payload_hash text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perm        jsonb;
  v_action      text;
  v_maker_src   text;
  v_maker_user  uuid;
  v_prior       public.bn_mortality_command_idempotency%ROWTYPE;
  v_open_reqs   int;
  v_referrals   int;
  v_result      jsonb;
  v_handoff     jsonb;
  v_event_id    uuid := p_entity_id;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name;
  END IF;

  v_action := public._bn_mortality_action_for_command(p_command_name);
  v_perm := public.bn_mortality_check_actor_permission(p_actor_user_id, v_action, true);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'E_%:%', v_perm->>'code', p_command_name;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior
      FROM public.bn_mortality_command_idempotency
     WHERE idempotency_key = p_idempotency_key
       AND command_name = p_command_name
       AND status = 'COMPLETED';
    IF FOUND THEN
      IF COALESCE(v_prior.payload_hash,'') <> COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH:%', p_command_name;
      END IF;
      RETURN v_prior.result_json || jsonb_build_object('status', 'REPLAYED');
    END IF;
  END IF;

  v_maker_src := public._bn_mortality_maker_source(p_command_name);
  IF v_maker_src IS NOT NULL AND v_event_id IS NOT NULL THEN
    SELECT maker_user_id INTO v_maker_user
      FROM public.bn_mortality_command_maker
     WHERE event_id = v_event_id AND maker_role = v_maker_src;
    IF v_maker_user IS NULL THEN
      RAISE EXCEPTION 'E_MAKER_REQUIRED:% needs prior %', p_command_name, v_maker_src;
    END IF;
    IF v_maker_user = p_actor_user_id THEN
      RAISE EXCEPTION 'E_SELF_APPROVAL:%', p_command_name;
    END IF;
  END IF;

  IF p_command_name = 'BN_MORTALITY_CLOSE_EVENT' AND v_event_id IS NOT NULL THEN
    SELECT count(*) INTO v_open_reqs
      FROM public.bn_mortality_required_action
     WHERE event_id = v_event_id AND is_mandatory AND status = 'OPEN';
    IF v_open_reqs > 0 THEN
      RAISE EXCEPTION 'E_OUTSTANDING_REQUIRED_ACTIONS:%', v_open_reqs;
    END IF;
  END IF;

  IF p_command_name = 'BN_MORTALITY_COMPLETE_FOLLOWON' AND v_event_id IS NOT NULL THEN
    SELECT count(*) INTO v_referrals
      FROM public.bn_mortality_referral WHERE event_id = v_event_id;
    IF v_referrals = 0 THEN
      RAISE EXCEPTION 'E_NO_FOLLOWON_RAISED:%', v_event_id;
    END IF;
  END IF;

  IF p_command_name = 'BN_MORTALITY_ATTACH_EVIDENCE' THEN
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'ENTITY_REQUIRED:%', p_command_name;
    END IF;
    IF COALESCE(p_payload->>'dms_document_id', '') = ''
       AND COALESCE(p_payload->>'dms_reference', '') = '' THEN
      RAISE EXCEPTION 'E_EVIDENCE_REFERENCE_REQUIRED:%', p_command_name;
    END IF;
    INSERT INTO public.bn_mortality_evidence(
      event_id, evidence_type, dms_document_id, dms_reference,
      received_at, status, notes, correlation_id, created_by
    ) VALUES (
      v_event_id, COALESCE(p_payload->>'evidence_type','DEATH_CERTIFICATE'),
      NULLIF(p_payload->>'dms_document_id',''), NULLIF(p_payload->>'dms_reference',''),
      COALESCE((p_payload->>'received_at')::timestamptz, now()),
      COALESCE(p_payload->>'status','ATTACHED'),
      p_payload->>'notes', p_correlation_id, p_actor_user_id
    );
  END IF;

  v_result := public.bn_mortality_execute_command(
    p_command_name, p_entity_id, p_actor_user_id, p_actor_user_code,
    p_correlation_id, p_expected_row_version, p_reason_code,
    p_justification, p_payload, p_payload_hash
  );
  v_event_id := COALESCE((v_result->>'entity_id')::uuid, v_event_id);

  IF p_command_name = 'BN_MORTALITY_CREATE_PAD_OVERPAYMENT' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'POTENTIAL_OVERPAYMENT', 'bn_overpayments', 'OVERPAYMENT',
      COALESCE(p_reason_code,'PAYMENT_AFTER_DEATH'), p_payload, p_correlation_id, p_actor_user_id);
  ELSIF p_command_name = 'BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'POTENTIAL_SURVIVOR_ASSESSMENT', 'bn_survivors', 'SURVIVOR',
      COALESCE(p_reason_code,'DEATH_CONFIRMED'), p_payload, p_correlation_id, p_actor_user_id);
  ELSIF p_command_name = 'BN_MORTALITY_INITIATE_FUNERAL_GRANT' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'FUNERAL_GRANT_INTAKE', 'bn_claims', 'FUNERAL',
      COALESCE(p_reason_code,'DEATH_CONFIRMED'), p_payload, p_correlation_id, p_actor_user_id);
  ELSIF p_command_name = 'BN_MORTALITY_REFER_LEGAL' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'LEGAL_ESTATE_REFERRAL', 'legal', 'LEGAL',
      COALESCE(p_reason_code,'ESTATE_RECOVERY'), p_payload, p_correlation_id, p_actor_user_id);
  END IF;

  IF v_handoff IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('handoff', v_handoff);
  END IF;

  IF p_command_name = 'BN_MORTALITY_COMPLETE_FOLLOWON' AND v_event_id IS NOT NULL THEN
    UPDATE public.bn_mortality_required_action
       SET status = 'SATISFIED', resolved_at = now(), resolved_by = p_actor_user_id
     WHERE event_id = v_event_id AND status = 'OPEN';
  END IF;

  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.bn_mortality_command_maker(event_id, maker_role, maker_user_id, correlation_id)
    VALUES (v_event_id, p_command_name, p_actor_user_id, p_correlation_id)
    ON CONFLICT (event_id, maker_role)
      DO UPDATE SET maker_user_id = EXCLUDED.maker_user_id,
                    recorded_at = now(),
                    correlation_id = EXCLUDED.correlation_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_mortality_command_idempotency(
      idempotency_key, command_name, payload_hash, entity_id, entity_version,
      result_json, status, completed_at, actor_user_id
    ) VALUES (
      p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), v_event_id,
      NULLIF(v_result->>'entity_version','')::bigint, v_result, 'COMPLETED', now(), p_actor_user_id
    )
    ON CONFLICT (idempotency_key, command_name) DO UPDATE
      SET result_json = EXCLUDED.result_json,
          status = 'COMPLETED',
          completed_at = now(),
          entity_id = EXCLUDED.entity_id,
          entity_version = EXCLUDED.entity_version;
  END IF;

  RETURN v_result || jsonb_build_object('status', 'EXECUTED');
END;
$$;

REVOKE ALL ON FUNCTION public.bn_mortality_execute_command_v2(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_mortality_execute_command_v2(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;
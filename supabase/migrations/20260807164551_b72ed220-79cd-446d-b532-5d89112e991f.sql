-- ---------------------------------------------------------------
-- 3. Activation execution (BN_MEANS_ACTIVATE + governed retries)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_activation_execute(
  p_command_name text, p_assessment_id uuid, p_actor uuid, p_actor_code text,
  p_correlation uuid, p_reason_code text, p_justification text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a     public.bn_means_assessment%ROWTYPE;
  v_c     public.bn_means_calculation%ROWTYPE;
  v_pub   public.bn_means_fact_publication%ROWTYPE;
  v_h     public.bn_cross_module_handoff%ROWTYPE;
  v_ar    public.bn_cross_module_handoff%ROWTYPE;
  v_ready jsonb;
  v_fact  jsonb;
  v_from  text;
  v_code  text;
  v_msg   text;
  v_seq   int;
  v_review boolean := false;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment
   WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:%', p_assessment_id; END IF;
  v_from := v_a.status;
  v_c := public._bn_means_latest_calculation(p_assessment_id);

  SELECT * INTO v_pub FROM public.bn_means_fact_publication
   WHERE assessment_id = p_assessment_id
   ORDER BY (status = 'PUBLISHED') DESC, created_at DESC LIMIT 1;

  -- ======================= ACTIVATE =============================
  IF p_command_name = 'BN_MEANS_ACTIVATE' THEN
    -- Idempotent: an already-active assessment returns its original refs.
    IF v_a.status IN ('ACTIVE','REASSESSMENT_DUE') THEN
      SELECT * INTO v_h FROM public.bn_cross_module_handoff
       WHERE source_module = 'bn_means_tests' AND handoff_type = 'ELIGIBILITY_RERUN'
         AND source_record_id = v_pub.publication_id ORDER BY created_at DESC LIMIT 1;
      RETURN jsonb_build_object('assessment_id', p_assessment_id,
        'entity_version', v_a.row_version, 'to_status', v_a.status,
        'already_active', true,
        'publication_id', v_pub.publication_id,
        'publication_reference', v_pub.publication_reference,
        'bundle_hash', v_pub.bundle_hash,
        'eligibility_request_id', v_h.handoff_id,
        'eligibility_status', COALESCE(v_pub.eligibility_status,'NOT_REQUESTED'));
    END IF;

    -- Readiness is re-run transactionally; the earlier React read is never trusted.
    v_ready := public._bn_means_activation_readiness(p_assessment_id, p_actor);
    IF NOT COALESCE((v_ready->>'can_activate')::boolean,false) THEN
      v_code := COALESCE(v_ready->'blockers'->0->>'code','INVALID_STATE');
      v_msg  := COALESCE(v_ready->'blockers'->0->>'message','Activation is not available.');
      RAISE EXCEPTION 'E_%:%', v_code, v_msg;
    END IF;
    IF NOT public._bn_means_can_transition(v_from, 'ACTIVE') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% -> ACTIVE', v_from;
    END IF;

    v_fact := public._bn_means_fact_bundle(p_assessment_id);
    IF NOT COALESCE((v_fact->>'ready')::boolean,false) THEN
      RAISE EXCEPTION 'E_FACT_PUBLICATION_NOT_READY:%',
        COALESCE(v_fact->>'refusal_reason','the fact bundle cannot be assembled');
    END IF;

    -- Create or reuse the canonical publication (hash-unique per assessment).
    SELECT * INTO v_pub FROM public.bn_means_fact_publication
     WHERE assessment_id = p_assessment_id AND bundle_hash = v_fact->>'bundle_hash';
    IF NOT FOUND THEN
      SELECT COALESCE(max(publication_version),0) + 1 INTO v_seq
        FROM public.bn_means_fact_publication WHERE assessment_id = p_assessment_id;
      INSERT INTO public.bn_means_fact_publication(
        assessment_id, assessment_version_id, calculation_id, fact_bundle, bundle_hash,
        publication_reference, publication_version, status, published_at, published_by,
        correlation_id, created_by)
      VALUES (p_assessment_id, NULLIF(v_fact->>'assessment_version_id','')::uuid,
        NULLIF(v_fact->>'calculation_id','')::uuid, v_fact->'bundle', v_fact->>'bundle_hash',
        'MTF-' || v_a.assessment_reference || '-' || v_seq::text, v_seq,
        'PUBLISHED', now(), p_actor, p_correlation, p_actor)
      RETURNING * INTO v_pub;
    ELSIF v_pub.status <> 'PUBLISHED' THEN
      UPDATE public.bn_means_fact_publication
         SET status='PUBLISHED', published_at=now(), published_by=p_actor,
             failure_code=NULL, failure_detail=NULL
       WHERE publication_id = v_pub.publication_id RETURNING * INTO v_pub;
    END IF;

    PERFORM public._bn_means_event(p_assessment_id,'MEANS_FACTS_PUBLISHED','BN_MEANS_ACTIVATE',
      v_from, v_from, p_reason_code, p_justification,
      jsonb_build_object('publication_id', v_pub.publication_id,
                         'publication_reference', v_pub.publication_reference,
                         'bundle_hash', v_pub.bundle_hash),
      p_actor, p_actor_code, p_correlation, v_a.row_version);

    -- Lifecycle transition.
    UPDATE public.bn_means_assessment
       SET status = 'ACTIVE', activated_at = now(),
           result = COALESCE(v_c.result, result),
           valid_from = COALESCE(valid_from, v_c.valid_from, effective_from),
           valid_until = COALESCE(valid_until, v_c.valid_until),
           reassessment_due = COALESCE(reassessment_due, v_c.reassessment_due),
           checker_user_id = COALESCE(checker_user_id, p_actor),
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor
     WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;

    -- Eligibility rerun through the existing governed handoff boundary.
    SELECT * INTO v_h FROM public.bn_cross_module_handoff
     WHERE source_module='bn_means_tests' AND handoff_type='ELIGIBILITY_RERUN'
       AND source_record_id = v_pub.publication_id
     ORDER BY created_at DESC LIMIT 1;
    IF v_h.handoff_id IS NULL THEN
      INSERT INTO public.bn_cross_module_handoff(
        source_module, source_record_id, target_module, handoff_type,
        person_id, claim_id, award_id, reason_code, structured_context,
        status, correlation_id, created_by)
      VALUES ('bn_means_tests', v_pub.publication_id, 'bn_eligibility', 'ELIGIBILITY_RERUN',
        v_a.person_id, v_a.claim_id, v_a.award_id, 'MEANS_ASSESSMENT_ACTIVATED',
        jsonb_build_object(
          'assessment_id', v_a.assessment_id,
          'assessment_reference', v_a.assessment_reference,
          'calculation_id', v_pub.calculation_id,
          'publication_id', v_pub.publication_id,
          'publication_reference', v_pub.publication_reference,
          'benefit_programme', v_a.benefit_programme,
          'effective_date', v_a.effective_from,
          'facts', v_pub.fact_bundle),
        'PENDING', p_correlation, p_actor)
      RETURNING * INTO v_h;
    END IF;

    UPDATE public.bn_means_fact_publication
       SET eligibility_request_id = v_h.handoff_id,
           eligibility_status = CASE WHEN eligibility_status IN ('COMPLETED','PROCESSING')
                                     THEN eligibility_status ELSE 'PENDING' END,
           eligibility_requested_at = COALESCE(eligibility_requested_at, now())
     WHERE publication_id = v_pub.publication_id RETURNING * INTO v_pub;

    PERFORM public._bn_means_event(p_assessment_id,'MEANS_ASSESSMENT_ACTIVATED','BN_MEANS_ACTIVATE',
      v_from, 'ACTIVE', p_reason_code, p_justification,
      jsonb_build_object('publication_id', v_pub.publication_id,
                         'eligibility_request_id', v_h.handoff_id),
      p_actor, p_actor_code, p_correlation, v_a.row_version);
    PERFORM public._bn_means_event(p_assessment_id,'ELIGIBILITY_RERUN_REQUESTED','BN_MEANS_ACTIVATE',
      'ACTIVE','ACTIVE', NULL, NULL,
      jsonb_build_object('eligibility_request_id', v_h.handoff_id, 'status', v_h.status),
      p_actor, p_actor_code, p_correlation, v_a.row_version);

    -- Governed reassessment task + Communication Hub intent (never a direct send).
    IF v_a.reassessment_due IS NOT NULL THEN
      INSERT INTO public.bn_means_reassessment_schedule(
        assessment_id, due_date, reason_code, status, created_by)
      SELECT p_assessment_id, v_a.reassessment_due, 'ACTIVATION', 'SCHEDULED', p_actor
       WHERE NOT EXISTS (SELECT 1 FROM public.bn_means_reassessment_schedule s
                          WHERE s.assessment_id = p_assessment_id AND s.status = 'SCHEDULED');
    END IF;

    INSERT INTO public.bn_means_communication_intent(
      assessment_id, event_code, recipient_ref, context_data, idempotency_key,
      correlation_id, created_by)
    SELECT p_assessment_id, 'MEANS_ASSESSMENT_ACTIVATED',
      jsonb_build_object('person_id', v_a.person_id, 'claim_id', v_a.claim_id),
      jsonb_build_object('assessment_reference', v_a.assessment_reference,
        'benefit_programme', v_a.benefit_programme, 'result', v_a.result,
        'valid_until', v_a.valid_until, 'reassessment_due', v_a.reassessment_due),
      'MEANS_ACTIVATE:' || v_pub.publication_id::text, p_correlation, p_actor
     WHERE NOT EXISTS (SELECT 1 FROM public.bn_means_communication_intent ci
                        WHERE ci.idempotency_key = 'MEANS_ACTIVATE:' || v_pub.publication_id::text);

    RETURN jsonb_build_object('assessment_id', p_assessment_id,
      'entity_version', v_a.row_version, 'to_status','ACTIVE',
      'publication_id', v_pub.publication_id,
      'publication_reference', v_pub.publication_reference,
      'bundle_hash', v_pub.bundle_hash,
      'eligibility_request_id', v_h.handoff_id,
      'eligibility_status', v_pub.eligibility_status);

  -- ================ RETRY FACT PUBLICATION ======================
  ELSIF p_command_name = 'BN_MEANS_RETRY_FACT_PUBLICATION' THEN
    IF v_pub.publication_id IS NULL THEN
      RAISE EXCEPTION 'E_FACT_PUBLICATION_NOT_READY:there is no publication to retry';
    END IF;
    IF v_pub.status = 'PUBLISHED' THEN
      RETURN jsonb_build_object('assessment_id', p_assessment_id,
        'entity_version', v_a.row_version, 'publication_id', v_pub.publication_id,
        'publication_status', v_pub.status, 'no_change', true);
    END IF;
    UPDATE public.bn_means_fact_publication
       SET status='PUBLISHED', published_at=now(), published_by=p_actor,
           failure_code=NULL, failure_detail=NULL, retry_count = retry_count + 1
     WHERE publication_id = v_pub.publication_id RETURNING * INTO v_pub;
    PERFORM public._bn_means_event(p_assessment_id,'MEANS_FACTS_PUBLISHED',p_command_name,
      v_from, v_from, p_reason_code, p_justification,
      jsonb_build_object('publication_id', v_pub.publication_id,'retry', true),
      p_actor, p_actor_code, p_correlation, v_a.row_version);
    RETURN jsonb_build_object('assessment_id', p_assessment_id,
      'entity_version', v_a.row_version, 'publication_id', v_pub.publication_id,
      'publication_status', v_pub.status);

  -- ================ RETRY ELIGIBILITY REQUEST ===================
  ELSIF p_command_name = 'BN_MEANS_RETRY_ELIGIBILITY_REQUEST' THEN
    IF v_pub.publication_id IS NULL OR v_pub.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'E_FACT_PUBLICATION_NOT_READY:the means facts are not published yet';
    END IF;
    SELECT * INTO v_h FROM public.bn_cross_module_handoff
     WHERE source_module='bn_means_tests' AND handoff_type='ELIGIBILITY_RERUN'
       AND source_record_id = v_pub.publication_id
     ORDER BY created_at DESC LIMIT 1;
    IF v_h.handoff_id IS NOT NULL AND v_h.status IN ('PENDING','ACCEPTED','COMPLETED') THEN
      RETURN jsonb_build_object('assessment_id', p_assessment_id,
        'entity_version', v_a.row_version, 'eligibility_request_id', v_h.handoff_id,
        'eligibility_status', v_pub.eligibility_status, 'no_change', true);
    END IF;
    INSERT INTO public.bn_cross_module_handoff(
      source_module, source_record_id, target_module, handoff_type,
      person_id, claim_id, award_id, reason_code, structured_context, status,
      correlation_id, created_by)
    VALUES ('bn_means_tests', v_pub.publication_id, 'bn_eligibility', 'ELIGIBILITY_RERUN',
      v_a.person_id, v_a.claim_id, v_a.award_id, 'MEANS_ELIGIBILITY_RETRY',
      jsonb_build_object('assessment_id', v_a.assessment_id,
        'assessment_reference', v_a.assessment_reference,
        'publication_id', v_pub.publication_id,
        'benefit_programme', v_a.benefit_programme,
        'effective_date', v_a.effective_from, 'facts', v_pub.fact_bundle),
      'PENDING', p_correlation, p_actor)
    RETURNING * INTO v_h;
    UPDATE public.bn_means_fact_publication
       SET eligibility_request_id = v_h.handoff_id, eligibility_status='PENDING',
           eligibility_requested_at = now(), failure_code=NULL, failure_detail=NULL,
           retry_count = retry_count + 1
     WHERE publication_id = v_pub.publication_id RETURNING * INTO v_pub;
    PERFORM public._bn_means_event(p_assessment_id,'ELIGIBILITY_RERUN_REQUESTED',p_command_name,
      v_from, v_from, p_reason_code, p_justification,
      jsonb_build_object('eligibility_request_id', v_h.handoff_id,'retry', true),
      p_actor, p_actor_code, p_correlation, v_a.row_version);
    RETURN jsonb_build_object('assessment_id', p_assessment_id,
      'entity_version', v_a.row_version, 'eligibility_request_id', v_h.handoff_id,
      'eligibility_status', v_pub.eligibility_status);

  -- ================ REFRESH ELIGIBILITY RESULT ==================
  ELSIF p_command_name = 'BN_MEANS_REFRESH_ELIGIBILITY_RESULT' THEN
    IF v_pub.publication_id IS NULL THEN
      RAISE EXCEPTION 'E_FACT_PUBLICATION_NOT_READY:there is no publication to refresh';
    END IF;
    SELECT * INTO v_h FROM public.bn_cross_module_handoff
     WHERE handoff_id = v_pub.eligibility_request_id;
    IF v_h.handoff_id IS NULL THEN
      RAISE EXCEPTION 'E_ELIGIBILITY_BOUNDARY_UNAVAILABLE:no eligibility request exists';
    END IF;

    UPDATE public.bn_means_fact_publication
       SET eligibility_status = CASE v_h.status
             WHEN 'PENDING'   THEN 'PENDING'
             WHEN 'ACCEPTED'  THEN 'PROCESSING'
             WHEN 'COMPLETED' THEN 'COMPLETED'
             WHEN 'REJECTED'  THEN 'FAILED'
             WHEN 'CANCELLED' THEN 'FAILED'
             ELSE 'PENDING' END,
           eligibility_completed_at = CASE WHEN v_h.status='COMPLETED' THEN COALESCE(eligibility_completed_at, now()) END,
           eligibility_result_reference = v_h.target_reference,
           determination_status = NULLIF(v_h.structured_context->>'determination_status',''),
           failure_code = CASE WHEN v_h.status IN ('REJECTED','CANCELLED')
                               THEN COALESCE(v_h.reason_code,'ELIGIBILITY_REQUEST_REJECTED') END,
           failure_detail = CASE WHEN v_h.status IN ('REJECTED','CANCELLED')
                               THEN v_h.structured_context->>'failure_detail' END
     WHERE publication_id = v_pub.publication_id RETURNING * INTO v_pub;

    v_review := COALESCE((v_h.structured_context->>'award_review_required')::boolean,false);
    IF v_h.status = 'COMPLETED' AND v_review AND v_a.award_id IS NOT NULL THEN
      SELECT * INTO v_ar FROM public.bn_cross_module_handoff
       WHERE source_module='bn_means_tests' AND handoff_type='AWARD_REVIEW'
         AND source_record_id = v_pub.publication_id
       ORDER BY created_at DESC LIMIT 1;
      IF v_ar.handoff_id IS NULL THEN
        INSERT INTO public.bn_cross_module_handoff(
          source_module, source_record_id, target_module, handoff_type,
          person_id, claim_id, award_id, reason_code, structured_context, status,
          correlation_id, created_by)
        VALUES ('bn_means_tests', v_pub.publication_id, 'bn_awards', 'AWARD_REVIEW',
          v_a.person_id, v_a.claim_id, v_a.award_id, 'MEANS_ELIGIBILITY_RERUN_MATERIAL',
          jsonb_build_object('assessment_id', v_a.assessment_id,
            'assessment_reference', v_a.assessment_reference,
            'calculation_id', v_pub.calculation_id,
            'publication_id', v_pub.publication_id,
            'eligibility_reference', v_h.target_reference,
            'determination_status', v_h.structured_context->>'determination_status'),
          'PENDING', p_correlation, p_actor)
        RETURNING * INTO v_ar;
        PERFORM public._bn_means_event(p_assessment_id,'AWARD_REVIEW_HANDOFF_CREATED',p_command_name,
          v_from, v_from, NULL, NULL,
          jsonb_build_object('handoff_id', v_ar.handoff_id),
          p_actor, p_actor_code, p_correlation, v_a.row_version);
      END IF;
      UPDATE public.bn_means_fact_publication SET award_review_handoff_id = v_ar.handoff_id
       WHERE publication_id = v_pub.publication_id RETURNING * INTO v_pub;
    END IF;

    PERFORM public._bn_means_event(p_assessment_id,
      CASE WHEN v_pub.eligibility_status = 'COMPLETED' THEN 'ELIGIBILITY_RERUN_COMPLETED'
           WHEN v_pub.eligibility_status = 'FAILED'    THEN 'ELIGIBILITY_RERUN_FAILED'
           ELSE 'ELIGIBILITY_RERUN_UPDATED' END,
      p_command_name, v_from, v_from, NULL, NULL,
      jsonb_build_object('eligibility_status', v_pub.eligibility_status,
                         'eligibility_request_id', v_h.handoff_id),
      p_actor, p_actor_code, p_correlation, v_a.row_version);

    RETURN jsonb_build_object('assessment_id', p_assessment_id,
      'entity_version', v_a.row_version,
      'eligibility_request_id', v_h.handoff_id,
      'eligibility_status', v_pub.eligibility_status,
      'award_review_handoff_id', v_pub.award_review_handoff_id);
  END IF;

  RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED:%', p_command_name;
END;
$fn$;

-- Governed activation command boundary (permission, row version, idempotency).
CREATE OR REPLACE FUNCTION public.bn_means_activation_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid,
  p_actor_user_code text, p_correlation_id uuid, p_expected_row_version bigint,
  p_reason_code text, p_justification text, p_payload jsonb,
  p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm  jsonb;
  v_prior public.bn_means_command_idempotency%ROWTYPE;
  v_a     public.bn_means_assessment%ROWTYPE;
  v_res   jsonb;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name; END IF;
  IF p_command_name NOT IN ('BN_MEANS_ACTIVATE','BN_MEANS_RETRY_FACT_PUBLICATION',
                            'BN_MEANS_RETRY_ELIGIBILITY_REQUEST','BN_MEANS_REFRESH_ELIGIBILITY_RESULT') THEN
    RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
  END IF;
  IF p_assessment_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:%', p_command_name; END IF;

  v_perm := public.bn_means_check_actor_permission(
    p_actor_user_id,
    CASE WHEN p_command_name = 'BN_MEANS_REFRESH_ELIGIBILITY_RESULT' THEN 'write' ELSE 'approve' END,
    true);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'E_%:%', v_perm->>'code', p_command_name;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.bn_means_command_idempotency
     WHERE idempotency_key = p_idempotency_key AND command_name = p_command_name;
    IF FOUND THEN
      IF v_prior.payload_hash <> COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH:%', p_command_name;
      END IF;
      RETURN v_prior.result_json || jsonb_build_object('status','REPLAYED');
    END IF;
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:%', p_assessment_id; END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_a.row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION:expected=% actual=%', p_expected_row_version, v_a.row_version;
  END IF;

  v_res := public._bn_means_activation_execute(
    p_command_name, p_assessment_id, p_actor_user_id, p_actor_user_code,
    p_correlation_id, p_reason_code, p_justification, COALESCE(p_payload,'{}'::jsonb));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_means_command_idempotency(
      idempotency_key, command_name, payload_hash, assessment_id, entity_version,
      result_json, status, completed_at, actor_user_id)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), p_assessment_id,
      NULLIF(v_res->>'entity_version','')::bigint, v_res, 'COMPLETED', now(), p_actor_user_id)
    ON CONFLICT (idempotency_key, command_name) DO NOTHING;
  END IF;

  RETURN v_res || jsonb_build_object('status','EXECUTED');
END;
$fn$;

REVOKE ALL ON FUNCTION public.bn_means_activation_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_activation_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_activation_execute(text,uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_means_activation_execute(text,uuid,uuid,text,uuid,text,text,jsonb) TO service_role;
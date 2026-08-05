-- =====================================================================
-- BN Medical Reviews — lifecycle commands (part 2)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ASSESSMENT COMMANDS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_medical_review_start_assessment_v1(
  p_referral_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('submit_assessment');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id);
  v_cached jsonb; rf record; v_id uuid; v_provider uuid; v_resp jsonb; v_channel text;
BEGIN
  v_cached := public._bn_mr_cmd_begin('START_ASSESSMENT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(v_actor, rf.obligation_id);
  PERFORM public._bn_mr_check_version(rf.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('REFERRAL', rf.status, 'ASSESSMENT_IN_PROGRESS');

  IF rf.provider_id IS NULL THEN RAISE EXCEPTION 'E_NOT_FOUND:provider' USING ERRCODE='P0001'; END IF;
  IF rf.accountable_practitioner_id IS NULL THEN
    RAISE EXCEPTION 'E_PROVIDER_NO_ACCOUNTABLE_PRACTITIONER' USING ERRCODE='P0001';
  END IF;

  v_provider := public._bn_mr_provider_for_user(v_actor);
  v_channel := CASE WHEN v_provider IS NOT NULL THEN 'EXTERNAL_PROVIDER_PORTAL'
                    ELSE 'INTERNAL_DOCTOR_WORKSPACE' END;

  INSERT INTO public.bn_medical_review_assessment
    (referral_id, obligation_id, provider_id, status, submission_channel,
     correlation_id, created_by)
  VALUES (p_referral_id, rf.obligation_id, rf.provider_id, 'DRAFT', v_channel,
          rf.correlation_id, v_actor)
  RETURNING id INTO v_id;

  UPDATE public.bn_medical_review_referral
     SET status='ASSESSMENT_IN_PROGRESS', row_version = row_version + 1,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_referral_id;

  PERFORM public._bn_mr_event(rf.obligation_id,'ASSESSMENT',v_id,'BN_MR_ASSESSMENT_STARTED',
    NULL,'DRAFT',v_actor, CASE WHEN v_provider IS NOT NULL THEN 'PROVIDER' ELSE 'MEDICAL_OFFICER' END,
    '{}'::jsonb, rf.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_ASSESSMENT_STARTED', v_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('status','DRAFT'), p_reason, rf.correlation_id,
    CASE WHEN v_provider IS NOT NULL THEN 'PROVIDER_PORTAL' ELSE 'USER_RPC' END);

  v_resp := jsonb_build_object('status','OK','assessment_id',v_id,'assessment_status','DRAFT');
  RETURN public._bn_mr_cmd_finish('START_ASSESSMENT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_save_assessment_draft_v1(
  p_assessment_id uuid, p_fields jsonb, p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('submit_assessment');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id, 'version', p_expected_row_version);
  v_cached jsonb; asr record; f jsonb := COALESCE(p_fields, '{}'::jsonb); v_resp jsonb; v_provider uuid;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SAVE_ASSESSMENT_DRAFT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO asr FROM public.bn_medical_review_assessment WHERE id = p_assessment_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(asr.id, 'assessment');
  PERFORM public._bn_mr_assert_access(v_actor, asr.obligation_id);
  PERFORM public._bn_mr_check_version(asr.row_version, p_expected_row_version);
  IF asr.status NOT IN ('DRAFT','CLARIFICATION_REQUIRED','ADDENDUM_REQUIRED') THEN
    RAISE EXCEPTION 'E_INVALID_STATE_TRANSITION:ASSESSMENT:%->DRAFT_SAVE', asr.status USING ERRCODE='P0001';
  END IF;

  v_provider := public._bn_mr_provider_for_user(v_actor);
  IF v_provider IS NOT NULL AND v_provider IS DISTINCT FROM asr.provider_id THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_review_assessment SET
    examination_date            = COALESCE((f ->> 'examination_date')::date, examination_date),
    identity_verification_method= COALESCE(f ->> 'identity_verification_method', identity_verification_method),
    attendance_result           = COALESCE(f ->> 'attendance_result', attendance_result),
    medical_outcome             = COALESCE(f ->> 'medical_outcome', medical_outcome),
    functional_conclusion       = COALESCE(f ->> 'functional_conclusion', functional_conclusion),
    functional_limitations      = COALESCE(f -> 'functional_limitations', functional_limitations),
    work_capacity_opinion       = COALESCE(f ->> 'work_capacity_opinion', work_capacity_opinion),
    expected_duration_months    = COALESCE((f ->> 'expected_duration_months')::int, expected_duration_months),
    incapacity_nature           = COALESCE(f ->> 'incapacity_nature', incapacity_nature),
    prognosis_category          = COALESCE(f ->> 'prognosis_category', prognosis_category),
    impairment_percentage       = COALESCE((f ->> 'impairment_percentage')::numeric, impairment_percentage),
    specialist_required         = COALESCE((f ->> 'specialist_required')::boolean, specialist_required),
    further_evidence_required   = COALESCE((f ->> 'further_evidence_required')::boolean, further_evidence_required),
    recommended_next_review_date= COALESCE((f ->> 'recommended_next_review_date')::date, recommended_next_review_date),
    clinical_narrative          = COALESCE(f ->> 'clinical_narrative', clinical_narrative),
    evidence_reviewed           = COALESCE(f -> 'evidence_reviewed', evidence_reviewed),
    conflict_declared           = COALESCE((f ->> 'conflict_declared')::boolean, conflict_declared),
    conflict_details            = COALESCE(f ->> 'conflict_details', conflict_details),
    provider_declaration_complete = COALESCE((f ->> 'provider_declaration_complete')::boolean, provider_declaration_complete),
    status = 'DRAFT',
    row_version = row_version + 1, updated_at = now()
  WHERE id = p_assessment_id;

  PERFORM public._bn_mr_audit('BN_MR_ASSESSMENT_DRAFT_SAVED', v_actor, p_assessment_id, 'UPDATE',
    jsonb_build_object('status', asr.status), jsonb_build_object('status','DRAFT'),
    p_reason, asr.correlation_id,
    CASE WHEN v_provider IS NOT NULL THEN 'PROVIDER_PORTAL' ELSE 'USER_RPC' END);

  v_resp := jsonb_build_object('status','OK','assessment_id',p_assessment_id,
                               'assessment_status','DRAFT','row_version', asr.row_version + 1);
  RETURN public._bn_mr_cmd_finish('SAVE_ASSESSMENT_DRAFT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_submit_assessment_v1(
  p_assessment_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('submit_assessment');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id);
  v_cached jsonb; asr record; rf record; ob record; v_provider uuid; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SUBMIT_ASSESSMENT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO asr FROM public.bn_medical_review_assessment WHERE id = p_assessment_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(asr.id, 'assessment');
  PERFORM public._bn_mr_assert_access(v_actor, asr.obligation_id);
  PERFORM public._bn_mr_check_version(asr.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('ASSESSMENT', asr.status, 'SUBMITTED');

  v_provider := public._bn_mr_provider_for_user(v_actor);
  IF v_provider IS NOT NULL AND v_provider IS DISTINCT FROM asr.provider_id THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  IF asr.medical_outcome IS NULL OR asr.examination_date IS NULL
     OR NOT COALESCE(asr.provider_declaration_complete, false) THEN
    RAISE EXCEPTION 'E_ASSESSMENT_INCOMPLETE' USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_review_assessment
     SET status='SUBMITTED', submitted_at = now(), submitted_by = v_actor,
         receipt_revision = receipt_revision + 1,
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_assessment_id;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = asr.referral_id FOR UPDATE;
  IF public._bn_mr_transition_allowed('REFERRAL', rf.status, 'REPORT_SUBMITTED') THEN
    UPDATE public.bn_medical_review_referral SET status='REPORT_SUBMITTED',
           row_version = row_version + 1, updated_at = now(), updated_by = v_actor
     WHERE id = rf.id;
  END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = asr.obligation_id FOR UPDATE;
  IF public._bn_mr_transition_allowed('OBLIGATION', ob.status, 'AWAITING_ADMINISTRATIVE_DECISION') THEN
    UPDATE public.bn_medical_review_obligation SET status='AWAITING_ADMINISTRATIVE_DECISION',
           row_version = row_version + 1, updated_at = now(), updated_by = v_actor
     WHERE id = ob.id;
  END IF;

  PERFORM public._bn_mr_event(asr.obligation_id,'ASSESSMENT',p_assessment_id,'BN_MR_ASSESSMENT_SUBMITTED',
    asr.status,'SUBMITTED',v_actor, CASE WHEN v_provider IS NOT NULL THEN 'PROVIDER' ELSE 'MEDICAL_OFFICER' END,
    '{}'::jsonb, asr.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_ASSESSMENT_SUBMITTED', v_actor, p_assessment_id, 'SUBMIT',
    jsonb_build_object('status', asr.status), jsonb_build_object('status','SUBMITTED'),
    p_reason, asr.correlation_id,
    CASE WHEN v_provider IS NOT NULL THEN 'PROVIDER_PORTAL' ELSE 'USER_RPC' END);

  v_resp := jsonb_build_object('status','OK','assessment_id',p_assessment_id,
                               'assessment_status','SUBMITTED','row_version', asr.row_version + 1);
  RETURN public._bn_mr_cmd_finish('SUBMIT_ASSESSMENT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_staff_receipt_v1(
  p_assessment_id uuid, p_submission_method text, p_provider_verification_method text,
  p_signed_report_document_id uuid, p_portal_not_used_reason text,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('validate_report');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id, 'method', p_submission_method);
  v_cached jsonb; asr record; v_id uuid; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_STAFF_RECEIPT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_portal_not_used_reason IS NULL OR btrim(p_portal_not_used_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO asr FROM public.bn_medical_review_assessment WHERE id = p_assessment_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(asr.id, 'assessment');
  PERFORM public._bn_mr_assert_access(v_actor, asr.obligation_id);

  INSERT INTO public.bn_medical_review_submission_receipt
    (assessment_id, receiving_officer, submission_method, provider_id,
     provider_verification_method, signed_report_document_id,
     structured_fields_transcribed, transcribing_officer, portal_not_used_reason)
  VALUES (p_assessment_id, v_actor, p_submission_method, asr.provider_id,
          p_provider_verification_method, p_signed_report_document_id,
          true, v_actor, p_portal_not_used_reason)
  RETURNING id INTO v_id;

  UPDATE public.bn_medical_review_assessment
     SET submission_channel = 'STAFF_ASSISTED_UPLOAD',
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_assessment_id;

  PERFORM public._bn_mr_audit('BN_MR_STAFF_RECEIPT_RECORDED', v_actor, p_assessment_id, 'CREATE',
    NULL, jsonb_build_object('receipt_id', v_id), p_reason, asr.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','receipt_id',v_id,'assessment_id',p_assessment_id);
  RETURN public._bn_mr_cmd_finish('RECORD_STAFF_RECEIPT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_assessment_transition(
  p_actor uuid, p_assessment uuid, p_to text, p_event text, p_expected integer,
  p_rejection text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE asr record;
BEGIN
  SELECT * INTO asr FROM public.bn_medical_review_assessment WHERE id = p_assessment FOR UPDATE;
  PERFORM public._bn_mr_require_record(asr.id, 'assessment');
  PERFORM public._bn_mr_assert_access(p_actor, asr.obligation_id);
  PERFORM public._bn_mr_check_version(asr.row_version, p_expected);
  PERFORM public._bn_mr_assert_transition('ASSESSMENT', asr.status, p_to);

  UPDATE public.bn_medical_review_assessment
     SET status = p_to,
         validated_at = CASE WHEN p_to = 'VALIDATED' THEN now() ELSE validated_at END,
         validated_by = CASE WHEN p_to = 'VALIDATED' THEN p_actor ELSE validated_by END,
         locked_at    = CASE WHEN p_to = 'LOCKED' THEN now() ELSE locked_at END,
         rejection_reason = COALESCE(p_rejection, rejection_reason),
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_assessment;

  PERFORM public._bn_mr_event(asr.obligation_id,'ASSESSMENT',p_assessment,p_event,
    asr.status, p_to, p_actor, 'BENEFITS_OFFICER', '{}'::jsonb, asr.correlation_id);
  PERFORM public._bn_mr_audit(p_event, p_actor, p_assessment, 'TRANSITION',
    jsonb_build_object('status', asr.status), jsonb_build_object('status', p_to),
    p_reason, asr.correlation_id, 'USER_RPC');

  RETURN jsonb_build_object('status','OK','assessment_id',p_assessment,
                            'assessment_status',p_to,'row_version', asr.row_version + 1);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_validate_report_v1(
  p_assessment_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('validate_report');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('VALIDATE_REPORT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public._bn_mr_assessment_transition(v_actor, p_assessment_id, 'VALIDATED',
              'BN_MR_REPORT_VALIDATED', p_expected_row_version, NULL, p_reason);
  RETURN public._bn_mr_cmd_finish('VALIDATE_REPORT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_reject_report_v1(
  p_assessment_id uuid, p_rejection_reason text, p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('validate_report');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id, 'rej', p_rejection_reason);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('REJECT_REPORT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_rejection_reason IS NULL OR btrim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;
  v_resp := public._bn_mr_assessment_transition(v_actor, p_assessment_id, 'REJECTED_INCOMPLETE',
              'BN_MR_REPORT_REJECTED', p_expected_row_version, p_rejection_reason, p_reason);
  RETURN public._bn_mr_cmd_finish('REJECT_REPORT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_request_clarification_v1(
  p_assessment_id uuid, p_request_reason text, p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('validate_report');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id, 'req', p_request_reason);
  v_cached jsonb; asr record; v_rev integer; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('REQUEST_CLARIFICATION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_request_reason IS NULL OR btrim(p_request_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO asr FROM public.bn_medical_review_assessment WHERE id = p_assessment_id;
  PERFORM public._bn_mr_require_record(asr.id, 'assessment');

  v_resp := public._bn_mr_assessment_transition(v_actor, p_assessment_id, 'CLARIFICATION_REQUIRED',
              'BN_MR_CLARIFICATION_REQUESTED', p_expected_row_version, NULL, p_reason);

  SELECT COALESCE(max(revision_no), 0) + 1 INTO v_rev
    FROM public.bn_medical_review_assessment_addendum WHERE assessment_id = p_assessment_id;

  INSERT INTO public.bn_medical_review_assessment_addendum
    (assessment_id, revision_no, addendum_type, requested_by, requested_at, request_reason,
     prior_snapshot, addendum_content)
  VALUES (p_assessment_id, v_rev, 'CLARIFICATION', v_actor, now(), p_request_reason,
          to_jsonb(asr) - 'clinical_narrative', '{}'::jsonb);

  RETURN public._bn_mr_cmd_finish('REQUEST_CLARIFICATION', p_idempotency_key, v_payload,
           v_resp || jsonb_build_object('revision_no', v_rev), v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_submit_clarification_v1(
  p_assessment_id uuid, p_addendum_content jsonb, p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('submit_assessment');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id);
  v_cached jsonb; asr record; v_rev integer; v_resp jsonb; v_provider uuid;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SUBMIT_CLARIFICATION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO asr FROM public.bn_medical_review_assessment WHERE id = p_assessment_id;
  PERFORM public._bn_mr_require_record(asr.id, 'assessment');
  v_provider := public._bn_mr_provider_for_user(v_actor);
  IF v_provider IS NOT NULL AND v_provider IS DISTINCT FROM asr.provider_id THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_resp := public._bn_mr_assessment_transition(v_actor, p_assessment_id, 'SUBMITTED',
              'BN_MR_CLARIFICATION_SUBMITTED', p_expected_row_version, NULL, p_reason);

  SELECT max(revision_no) INTO v_rev FROM public.bn_medical_review_assessment_addendum
   WHERE assessment_id = p_assessment_id;
  IF v_rev IS NULL THEN
    v_rev := 1;
    INSERT INTO public.bn_medical_review_assessment_addendum
      (assessment_id, revision_no, addendum_type, prior_snapshot, addendum_content,
       submitted_by, submitted_at)
    VALUES (p_assessment_id, v_rev, 'ADDENDUM', to_jsonb(asr) - 'clinical_narrative',
            COALESCE(p_addendum_content,'{}'::jsonb), v_actor, now());
  ELSE
    UPDATE public.bn_medical_review_assessment_addendum
       SET addendum_content = COALESCE(p_addendum_content,'{}'::jsonb),
           submitted_by = v_actor, submitted_at = now()
     WHERE assessment_id = p_assessment_id AND revision_no = v_rev;
  END IF;

  RETURN public._bn_mr_cmd_finish('SUBMIT_CLARIFICATION', p_idempotency_key, v_payload,
           v_resp || jsonb_build_object('revision_no', v_rev), v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_lock_assessment_v1(
  p_assessment_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('validate_report');
  v_payload jsonb := jsonb_build_object('assessment', p_assessment_id);
  v_cached jsonb; v_resp jsonb; asr record;
BEGIN
  v_cached := public._bn_mr_cmd_begin('LOCK_ASSESSMENT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public._bn_mr_assessment_transition(v_actor, p_assessment_id, 'LOCKED',
              'BN_MR_ASSESSMENT_LOCKED', p_expected_row_version, NULL, p_reason);
  SELECT * INTO asr FROM public.bn_medical_review_assessment WHERE id = p_assessment_id;
  UPDATE public.bn_medical_review_referral
     SET status = 'COMPLETED', row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE id = asr.referral_id
     AND public._bn_mr_transition_allowed('REFERRAL', status, 'COMPLETED');
  RETURN public._bn_mr_cmd_finish('LOCK_ASSESSMENT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- ---------------------------------------------------------------------
-- MEDICAL BOARD COMMANDS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_medical_review_refer_to_board_v1(
  p_obligation_id uuid, p_assessment_id uuid, p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('refer_to_board');
  v_payload jsonb := jsonb_build_object('obligation', p_obligation_id, 'assessment', p_assessment_id);
  v_cached jsonb; ob record; req jsonb; v_id uuid; v_ref text; v_board uuid; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('REFER_TO_BOARD', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  req := public.bn_medical_review_board_requirement_v1(p_obligation_id);
  IF NOT COALESCE((req ->> 'board_required')::boolean, false) THEN
    RAISE EXCEPTION 'E_BOARD_NOT_REQUIRED:%', COALESCE(req ->> 'reason','') USING ERRCODE='P0001';
  END IF;

  v_board := (req #>> '{board,board_id}')::uuid;
  v_ref := public._bn_mr_reference('MRB');

  INSERT INTO public.bn_medical_board_case
    (obligation_id, bn_award_id, case_reference, board_id, board_type, assessment_id,
     trigger_rule_id, trigger_snapshot, status, required_specialties, required_quorum,
     determination_binding, required_completion_date, referred_at, referred_by, correlation_id)
  VALUES
    (p_obligation_id, ob.bn_award_id, v_ref, v_board, COALESCE(req ->> 'board_type','UNCONFIGURED'),
     p_assessment_id, (req ->> 'trigger_rule_id')::uuid, req, 'REFERRED',
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(req -> 'required_specialties','[]'::jsonb))),
     COALESCE((req ->> 'required_quorum')::int, 1),
     COALESCE((req ->> 'determination_binding')::boolean, false),
     (req ->> 'required_completion_date')::date, now(), v_actor, ob.correlation_id)
  RETURNING id INTO v_id;

  IF public._bn_mr_transition_allowed('OBLIGATION', ob.status, 'AWAITING_BOARD') THEN
    UPDATE public.bn_medical_review_obligation SET status='AWAITING_BOARD',
           row_version = row_version + 1, updated_at = now(), updated_by = v_actor
     WHERE id = p_obligation_id;
  END IF;

  PERFORM public._bn_mr_event(p_obligation_id,'BOARD_CASE',v_id,'BN_MR_BOARD_CASE_REFERRED',
    NULL,'REFERRED',v_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('board_reference', v_ref, 'board_id', v_board)),
    ob.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_CASE_REFERRED', v_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('status','REFERRED','board_reference',v_ref), p_reason, ob.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','board_case_id',v_id,'case_reference',v_ref,
                               'board_case_status','REFERRED','requirement', req);
  RETURN public._bn_mr_cmd_finish('REFER_TO_BOARD', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_select_board_v1(
  p_board_case_id uuid, p_board_id uuid, p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_board_case');
  v_payload jsonb := jsonb_build_object('case', p_board_case_id, 'board', p_board_id);
  v_cached jsonb; bc record; bd record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SELECT_BOARD', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);
  PERFORM public._bn_mr_check_version(bc.row_version, p_expected_row_version);
  IF public._bn_mr_terminal('BOARD_CASE', bc.status) THEN
    RAISE EXCEPTION 'E_STATE_TERMINAL:BOARD_CASE:%', bc.status USING ERRCODE='P0001';
  END IF;

  SELECT * INTO bd FROM public.bn_medical_board WHERE id = p_board_id;
  PERFORM public._bn_mr_require_record(bd.id, 'board');
  IF NOT COALESCE(bd.is_active, false) THEN
    RAISE EXCEPTION 'E_BOARD_NOT_ACTIVE' USING ERRCODE='P0001';
  END IF;
  IF COALESCE(array_length(bc.required_specialties,1),0) > 0
     AND NOT (bd.required_specialties && bc.required_specialties) THEN
    RAISE EXCEPTION 'E_BOARD_SPECIALTY_MISMATCH' USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_board_case
     SET board_id = p_board_id,
         required_quorum = GREATEST(bc.required_quorum, COALESCE(bd.minimum_quorum, 1)),
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_board_case_id;

  PERFORM public._bn_mr_audit('BN_MR_BOARD_SELECTED', v_actor, p_board_case_id, 'UPDATE',
    jsonb_build_object('board_id', bc.board_id), jsonb_build_object('board_id', p_board_id),
    p_reason, bc.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','board_case_id',p_board_case_id,'board_id',p_board_id,
                               'row_version', bc.row_version + 1);
  RETURN public._bn_mr_cmd_finish('SELECT_BOARD', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_assign_board_members_v1(
  p_board_case_id uuid, p_member_ids uuid[], p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_board_case');
  v_payload jsonb := jsonb_build_object('case', p_board_case_id, 'members', to_jsonb(p_member_ids));
  v_cached jsonb; bc record; m record; v_count integer := 0; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('ASSIGN_BOARD_MEMBERS', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);
  PERFORM public._bn_mr_check_version(bc.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('BOARD_CASE', bc.status, 'MEMBERS_ASSIGNED');
  IF bc.board_id IS NULL THEN RAISE EXCEPTION 'E_BOARD_NOT_SELECTED' USING ERRCODE='P0001'; END IF;

  FOR m IN SELECT * FROM public.bn_medical_board_member
            WHERE id = ANY(COALESCE(p_member_ids, ARRAY[]::uuid[]))
  LOOP
    IF m.board_id <> bc.board_id THEN
      RAISE EXCEPTION 'E_MEMBER_NOT_ON_BOARD' USING ERRCODE='P0001';
    END IF;
    INSERT INTO public.bn_medical_board_case_participant
      (board_case_id, member_id, member_user_id, member_role, member_specialty, assigned_by)
    VALUES (p_board_case_id, m.id, m.member_user_id, m.member_role, m.specialty, v_actor)
    ON CONFLICT (board_case_id, member_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_count < bc.required_quorum THEN
    RAISE EXCEPTION 'E_QUORUM_NOT_MET:%', bc.required_quorum USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_board_case
     SET status='MEMBERS_ASSIGNED', row_version = row_version + 1, updated_at = now()
   WHERE id = p_board_case_id;

  PERFORM public._bn_mr_event(bc.obligation_id,'BOARD_CASE',p_board_case_id,'BN_MR_BOARD_MEMBERS_ASSIGNED',
    bc.status,'MEMBERS_ASSIGNED',v_actor,'BOARD_SECRETARY',
    public._bn_mr_safe_detail(jsonb_build_object('count', v_count)), bc.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_MEMBERS_ASSIGNED', v_actor, p_board_case_id, 'UPDATE',
    jsonb_build_object('status', bc.status), jsonb_build_object('status','MEMBERS_ASSIGNED','count',v_count),
    p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','board_case_id',p_board_case_id,'members_assigned',v_count,
                               'board_case_status','MEMBERS_ASSIGNED','row_version', bc.row_version + 1);
  RETURN public._bn_mr_cmd_finish('ASSIGN_BOARD_MEMBERS', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_schedule_board_session_v1(
  p_board_case_id uuid, p_scheduled_at timestamptz, p_location_reference text, p_meeting_mode text,
  p_expected_row_version integer, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_board_session');
  v_payload jsonb := jsonb_build_object('case', p_board_case_id, 'at', p_scheduled_at);
  v_cached jsonb; bc record; v_id uuid; v_ref text; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SCHEDULE_BOARD_SESSION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);
  PERFORM public._bn_mr_check_version(bc.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('BOARD_CASE', bc.status, 'SCHEDULED');
  IF p_scheduled_at IS NULL THEN RAISE EXCEPTION 'E_SESSION_DATE_INVALID' USING ERRCODE='P0001'; END IF;

  v_ref := public._bn_mr_reference('MRS');
  INSERT INTO public.bn_medical_board_session
    (board_case_id, board_id, session_reference, scheduled_at, location_reference,
     meeting_mode, status, scheduled_by)
  VALUES (p_board_case_id, bc.board_id, v_ref, p_scheduled_at, p_location_reference,
          COALESCE(p_meeting_mode,'IN_PERSON'), 'SCHEDULED', v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.bn_medical_board_session_participation
    (session_id, board_case_id, participant_id, member_id, member_user_id, created_by)
  SELECT v_id, p_board_case_id, p.id, p.member_id, p.member_user_id, v_actor
    FROM public.bn_medical_board_case_participant p
   WHERE p.board_case_id = p_board_case_id AND NOT p.recused
  ON CONFLICT (session_id, member_id) DO NOTHING;

  UPDATE public.bn_medical_board_case
     SET status='SCHEDULED', row_version = row_version + 1, updated_at = now()
   WHERE id = p_board_case_id;

  PERFORM public._bn_mr_event(bc.obligation_id,'BOARD_SESSION',v_id,'BN_MR_BOARD_SESSION_SCHEDULED',
    bc.status,'SCHEDULED',v_actor,'BOARD_SECRETARY',
    public._bn_mr_safe_detail(jsonb_build_object('session_reference', v_ref)), bc.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_SESSION_SCHEDULED', v_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('session_reference', v_ref), p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','session_id',v_id,'session_reference',v_ref,
                               'session_status','SCHEDULED','board_case_status','SCHEDULED');
  RETURN public._bn_mr_cmd_finish('SCHEDULE_BOARD_SESSION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_declare_board_conflict_v1(
  p_session_id uuid, p_member_id uuid, p_conflict_details text,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('declare_conflict');
  v_payload jsonb := jsonb_build_object('session', p_session_id, 'member', p_member_id);
  v_cached jsonb; sp record; bc record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('DECLARE_BOARD_CONFLICT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_conflict_details IS NULL OR btrim(p_conflict_details) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO sp FROM public.bn_medical_board_session_participation
   WHERE session_id = p_session_id AND member_id = p_member_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(sp.id, 'session_participation');
  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = sp.board_case_id;
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);

  UPDATE public.bn_medical_board_session_participation
     SET conflict_declared = true, conflict_details = p_conflict_details,
         recorded_by = v_actor, recorded_at = now(),
         row_version = row_version + 1, updated_at = now()
   WHERE id = sp.id;

  UPDATE public.bn_medical_board_case_participant
     SET conflict_declared = true, conflict_details = p_conflict_details
   WHERE board_case_id = sp.board_case_id AND member_id = p_member_id;

  PERFORM public._bn_mr_event(bc.obligation_id,'BOARD_SESSION',p_session_id,'BN_MR_BOARD_CONFLICT_DECLARED',
    NULL, NULL, v_actor, 'BOARD_MEMBER',
    public._bn_mr_safe_detail(jsonb_build_object('member_id', p_member_id)), bc.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_CONFLICT_DECLARED', v_actor, sp.id, 'UPDATE',
    jsonb_build_object('conflict_declared', sp.conflict_declared),
    jsonb_build_object('conflict_declared', true), p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','session_id',p_session_id,'member_id',p_member_id,
                               'conflict_declared', true);
  RETURN public._bn_mr_cmd_finish('DECLARE_BOARD_CONFLICT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_recusal_v1(
  p_session_id uuid, p_member_id uuid, p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('declare_conflict');
  v_payload jsonb := jsonb_build_object('session', p_session_id, 'member', p_member_id);
  v_cached jsonb; sp record; bc record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_RECUSAL', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO sp FROM public.bn_medical_board_session_participation
   WHERE session_id = p_session_id AND member_id = p_member_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(sp.id, 'session_participation');
  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = sp.board_case_id;
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);

  UPDATE public.bn_medical_board_session_participation
     SET recused = true, recused_at = now(), vote = NULL, voted_at = NULL,
         attendance_status = 'WITHDRAWN', recorded_by = v_actor, recorded_at = now(),
         row_version = row_version + 1, updated_at = now()
   WHERE id = sp.id;

  UPDATE public.bn_medical_board_case_participant
     SET recused = true, recused_at = now(), participated = false, vote = NULL
   WHERE board_case_id = sp.board_case_id AND member_id = p_member_id;

  PERFORM public._bn_mr_event(bc.obligation_id,'BOARD_SESSION',p_session_id,'BN_MR_BOARD_RECUSAL_RECORDED',
    NULL, NULL, v_actor, 'BOARD_SECRETARY',
    public._bn_mr_safe_detail(jsonb_build_object('member_id', p_member_id)), bc.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_RECUSAL_RECORDED', v_actor, sp.id, 'UPDATE',
    jsonb_build_object('recused', sp.recused), jsonb_build_object('recused', true),
    p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','session_id',p_session_id,'member_id',p_member_id,'recused',true);
  RETURN public._bn_mr_cmd_finish('RECORD_RECUSAL', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_board_participation_v1(
  p_session_id uuid, p_member_id uuid, p_attendance_status text,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('record_board_participation');
  v_payload jsonb := jsonb_build_object('session', p_session_id, 'member', p_member_id,
                                        'attendance', p_attendance_status);
  v_cached jsonb; sp record; bc record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_BOARD_PARTICIPATION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_attendance_status NOT IN ('EXPECTED','PRESENT','ABSENT','APOLOGIES','WITHDRAWN') THEN
    RAISE EXCEPTION 'E_INVALID_ATTENDANCE_STATUS' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO sp FROM public.bn_medical_board_session_participation
   WHERE session_id = p_session_id AND member_id = p_member_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(sp.id, 'session_participation');
  IF sp.recused THEN RAISE EXCEPTION 'E_MEMBER_RECUSED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = sp.board_case_id;
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);

  UPDATE public.bn_medical_board_session_participation
     SET attendance_status = p_attendance_status, recorded_by = v_actor, recorded_at = now(),
         row_version = row_version + 1, updated_at = now()
   WHERE id = sp.id;

  UPDATE public.bn_medical_board_case_participant
     SET participated = (p_attendance_status = 'PRESENT'), participation_recorded_at = now()
   WHERE board_case_id = sp.board_case_id AND member_id = p_member_id;

  PERFORM public._bn_mr_audit('BN_MR_BOARD_PARTICIPATION_RECORDED', v_actor, sp.id, 'UPDATE',
    jsonb_build_object('attendance_status', sp.attendance_status),
    jsonb_build_object('attendance_status', p_attendance_status),
    p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','session_id',p_session_id,'member_id',p_member_id,
                               'attendance_status', p_attendance_status);
  RETURN public._bn_mr_cmd_finish('RECORD_BOARD_PARTICIPATION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_request_board_evidence_v1(
  p_board_case_id uuid, p_evidence_types text[], p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_board_case');
  v_payload jsonb := jsonb_build_object('case', p_board_case_id, 'types', to_jsonb(p_evidence_types));
  v_cached jsonb; bc record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('REQUEST_BOARD_EVIDENCE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);
  PERFORM public._bn_mr_check_version(bc.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('BOARD_CASE', bc.status, 'EVIDENCE_REQUESTED');

  UPDATE public.bn_medical_board_case
     SET status='EVIDENCE_REQUESTED', row_version = row_version + 1, updated_at = now()
   WHERE id = p_board_case_id;

  PERFORM public._bn_mr_event(bc.obligation_id,'BOARD_CASE',p_board_case_id,'BN_MR_BOARD_EVIDENCE_REQUESTED',
    bc.status,'EVIDENCE_REQUESTED',v_actor,'BOARD_SECRETARY','{}'::jsonb, bc.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_EVIDENCE_REQUESTED', v_actor, p_board_case_id, 'UPDATE',
    jsonb_build_object('status', bc.status), jsonb_build_object('status','EVIDENCE_REQUESTED'),
    p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','board_case_id',p_board_case_id,
                               'board_case_status','EVIDENCE_REQUESTED','row_version', bc.row_version + 1);
  RETURN public._bn_mr_cmd_finish('REQUEST_BOARD_EVIDENCE', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_board_vote_v1(
  p_session_id uuid, p_member_id uuid, p_vote text, p_vote_outcome_code text, p_vote_reason text,
  p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('record_board_determination');
  v_payload jsonb := jsonb_build_object('session', p_session_id, 'member', p_member_id, 'vote', p_vote);
  v_cached jsonb; sp record; bc record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_BOARD_VOTE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_vote NOT IN ('FOR','AGAINST','ABSTAIN') THEN
    RAISE EXCEPTION 'E_INVALID_VOTE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO sp FROM public.bn_medical_board_session_participation
   WHERE session_id = p_session_id AND member_id = p_member_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(sp.id, 'session_participation');
  IF sp.recused THEN RAISE EXCEPTION 'E_MEMBER_RECUSED' USING ERRCODE='P0001'; END IF;
  IF sp.attendance_status <> 'PRESENT' THEN
    RAISE EXCEPTION 'E_MEMBER_NOT_PRESENT' USING ERRCODE='P0001';
  END IF;
  IF sp.vote IS NOT NULL THEN RAISE EXCEPTION 'E_VOTE_ALREADY_RECORDED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = sp.board_case_id;
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);

  UPDATE public.bn_medical_board_session_participation
     SET vote = p_vote, vote_reason = p_vote_reason, voted_at = now(),
         recorded_by = v_actor, recorded_at = now(),
         row_version = row_version + 1, updated_at = now()
   WHERE id = sp.id;

  UPDATE public.bn_medical_board_case_participant
     SET vote = p_vote, vote_outcome_code = p_vote_outcome_code, vote_reason = p_vote_reason,
         voted_at = now(), participated = true
   WHERE board_case_id = sp.board_case_id AND member_id = p_member_id;

  PERFORM public._bn_mr_audit('BN_MR_BOARD_VOTE_RECORDED', v_actor, sp.id, 'UPDATE',
    NULL, jsonb_build_object('vote', p_vote), NULL, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','session_id',p_session_id,'member_id',p_member_id,'vote',p_vote);
  RETURN public._bn_mr_cmd_finish('RECORD_BOARD_VOTE', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_finalise_board_determination_v1(
  p_board_case_id uuid, p_session_id uuid, p_outcome_code text, p_determination_summary text,
  p_impairment_percentage numeric, p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('record_board_determination');
  v_payload jsonb := jsonb_build_object('case', p_board_case_id, 'session', p_session_id,
                                        'outcome', p_outcome_code);
  v_cached jsonb; bc record; v_for int; v_against int; v_abstain int; v_present int;
  v_id uuid; v_rev integer; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('FINALISE_BOARD_DETERMINATION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_determination_summary IS NULL OR btrim(p_determination_summary) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);
  PERFORM public._bn_mr_check_version(bc.row_version, p_expected_row_version);

  IF bc.status = 'SCHEDULED' THEN
    UPDATE public.bn_medical_board_case SET status='IN_SESSION',
           row_version = row_version + 1, updated_at = now() WHERE id = p_board_case_id;
    bc.status := 'IN_SESSION'; bc.row_version := bc.row_version + 1;
  END IF;
  PERFORM public._bn_mr_assert_transition('BOARD_CASE', bc.status, 'DETERMINED');

  SELECT count(*) FILTER (WHERE vote = 'FOR'),
         count(*) FILTER (WHERE vote = 'AGAINST'),
         count(*) FILTER (WHERE vote = 'ABSTAIN'),
         count(*) FILTER (WHERE attendance_status = 'PRESENT' AND NOT recused)
    INTO v_for, v_against, v_abstain, v_present
    FROM public.bn_medical_board_session_participation
   WHERE session_id = p_session_id;

  IF v_present < bc.required_quorum THEN
    RAISE EXCEPTION 'E_QUORUM_NOT_MET:%', bc.required_quorum USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(max(revision_no), 0) + 1 INTO v_rev
    FROM public.bn_medical_board_determination WHERE board_case_id = p_board_case_id;

  INSERT INTO public.bn_medical_board_determination
    (board_case_id, revision_no, outcome_code, impairment_percentage, determination_summary,
     is_binding, quorum_at_determination, votes_for, votes_against, votes_abstain,
     decided_at, recorded_by, finalised)
  VALUES (p_board_case_id, v_rev, p_outcome_code, p_impairment_percentage, p_determination_summary,
          COALESCE(bc.determination_binding, false), v_present, v_for, v_against, v_abstain,
          now(), v_actor, true)
  RETURNING id INTO v_id;

  UPDATE public.bn_medical_board_case SET status='DETERMINED',
         row_version = row_version + 1, updated_at = now() WHERE id = p_board_case_id;
  UPDATE public.bn_medical_board_session SET status='HELD', quorum_met = true, updated_at = now()
   WHERE id = p_session_id;

  UPDATE public.bn_medical_review_obligation
     SET status='AWAITING_ADMINISTRATIVE_DECISION', row_version = row_version + 1,
         updated_at = now(), updated_by = v_actor
   WHERE id = bc.obligation_id
     AND public._bn_mr_transition_allowed('OBLIGATION', status, 'AWAITING_ADMINISTRATIVE_DECISION');

  PERFORM public._bn_mr_event(bc.obligation_id,'BOARD_CASE',p_board_case_id,'BN_MR_BOARD_DETERMINED',
    bc.status,'DETERMINED',v_actor,'BOARD_CHAIR',
    public._bn_mr_safe_detail(jsonb_build_object('decision_outcome_code', p_outcome_code)),
    bc.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_DETERMINED', v_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('outcome_code', p_outcome_code, 'is_binding', bc.determination_binding),
    p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','determination_id',v_id,'board_case_id',p_board_case_id,
                               'board_case_status','DETERMINED','revision_no',v_rev,
                               'is_binding', COALESCE(bc.determination_binding,false),
                               'votes', jsonb_build_object('for',v_for,'against',v_against,'abstain',v_abstain));
  RETURN public._bn_mr_cmd_finish('FINALISE_BOARD_DETERMINATION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_defer_board_case_v1(
  p_board_case_id uuid, p_deferred_until date, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_board_case');
  v_payload jsonb := jsonb_build_object('case', p_board_case_id, 'until', p_deferred_until);
  v_cached jsonb; bc record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('DEFER_BOARD_CASE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO bc FROM public.bn_medical_board_case WHERE id = p_board_case_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(bc.id, 'board_case');
  PERFORM public._bn_mr_assert_access(v_actor, bc.obligation_id);
  PERFORM public._bn_mr_check_version(bc.row_version, p_expected_row_version);
  IF bc.status = 'SCHEDULED' THEN
    UPDATE public.bn_medical_board_case SET status='IN_SESSION',
           row_version = row_version + 1, updated_at = now() WHERE id = p_board_case_id;
    bc.status := 'IN_SESSION'; bc.row_version := bc.row_version + 1;
  END IF;
  PERFORM public._bn_mr_assert_transition('BOARD_CASE', bc.status, 'DEFERRED');

  UPDATE public.bn_medical_board_case
     SET status='DEFERRED', deferred_until = p_deferred_until, deferral_reason = p_reason,
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_board_case_id;
  UPDATE public.bn_medical_board_session SET status='ADJOURNED', updated_at = now()
   WHERE board_case_id = p_board_case_id AND status = 'SCHEDULED';

  PERFORM public._bn_mr_event(bc.obligation_id,'BOARD_CASE',p_board_case_id,'BN_MR_BOARD_CASE_DEFERRED',
    bc.status,'DEFERRED',v_actor,'BOARD_SECRETARY','{}'::jsonb, bc.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_BOARD_CASE_DEFERRED', v_actor, p_board_case_id, 'UPDATE',
    jsonb_build_object('status', bc.status), jsonb_build_object('status','DEFERRED'),
    p_reason, bc.correlation_id, 'BOARD_WORKSPACE');

  v_resp := jsonb_build_object('status','OK','board_case_id',p_board_case_id,
                               'board_case_status','DEFERRED','row_version', bc.row_version + 1);
  RETURN public._bn_mr_cmd_finish('DEFER_BOARD_CASE', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_reconvene_board_case_v1(
  p_board_case_id uuid, p_scheduled_at timestamptz, p_location_reference text,
  p_expected_row_version integer, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_board_session');
  v_payload jsonb := jsonb_build_object('case', p_board_case_id, 'at', p_scheduled_at);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECONVENE_BOARD_CASE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public.bn_medical_review_schedule_board_session_v1(
              p_board_case_id, p_scheduled_at, p_location_reference, NULL,
              p_expected_row_version, p_idempotency_key || ':session', p_reason);
  RETURN public._bn_mr_cmd_finish('RECONVENE_BOARD_CASE', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- ---------------------------------------------------------------------
-- ADMINISTRATIVE DECISION COMMANDS (maker-checker enforced)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_medical_review_prepare_decision_v1(
  p_obligation_id uuid, p_assessment_id uuid, p_board_case_id uuid, p_outcome_code text,
  p_medical_recommendation_accepted boolean, p_departure_reason text,
  p_effective_date date, p_next_review_date date, p_reason_code text, p_reason_narrative text,
  p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('prepare_decision');
  v_payload jsonb := jsonb_build_object('obligation', p_obligation_id, 'outcome', p_outcome_code);
  v_cached jsonb; ob record; det record; v_id uuid; v_ref text; v_resp jsonb; v_auth text;
BEGIN
  v_cached := public._bn_mr_cmd_begin('PREPARE_DECISION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);
  IF public._bn_mr_terminal('OBLIGATION', ob.status) THEN
    RAISE EXCEPTION 'E_STATE_TERMINAL:OBLIGATION:%', ob.status USING ERRCODE='P0001';
  END IF;
  IF p_medical_recommendation_accepted IS FALSE
     AND (p_departure_reason IS NULL OR btrim(p_departure_reason) = '') THEN
    RAISE EXCEPTION 'E_DEPARTURE_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  IF p_board_case_id IS NOT NULL THEN
    SELECT d.* INTO det FROM public.bn_medical_board_determination d
     WHERE d.board_case_id = p_board_case_id AND d.finalised
     ORDER BY d.revision_no DESC LIMIT 1;
    IF det.id IS NOT NULL AND det.is_binding AND p_medical_recommendation_accepted IS FALSE THEN
      RAISE EXCEPTION 'E_BINDING_MEDICAL_DETERMINATION' USING ERRCODE='P0001';
    END IF;
  END IF;

  v_auth := COALESCE(ob.policy_snapshot ->> 'administrative_decision_authority',
                     'BENEFITS_DECISION_OFFICER');
  v_ref  := public._bn_mr_reference('MRD');

  INSERT INTO public.bn_medical_review_administrative_decision
    (obligation_id, decision_reference, assessment_id, board_case_id, board_determination_id,
     status, outcome_code, board_determination_outcome, medical_recommendation_accepted,
     departure_reason, decision_authority, made_by, made_at, effective_date, next_review_date,
     evidence_snapshot, reason_code, reason_narrative, correlation_id, created_by)
  VALUES
    (p_obligation_id, v_ref, p_assessment_id, p_board_case_id, det.id, 'READY', p_outcome_code,
     det.outcome_code, p_medical_recommendation_accepted, p_departure_reason, v_auth,
     v_actor, now(), p_effective_date, p_next_review_date,
     jsonb_build_object('assessment_id', p_assessment_id, 'board_case_id', p_board_case_id,
                        'determination_id', det.id, 'prepared_at', now()),
     p_reason_code, p_reason_narrative, ob.correlation_id, v_actor)
  RETURNING id INTO v_id;

  PERFORM public._bn_mr_event(p_obligation_id,'DECISION',v_id,'BN_MR_DECISION_PREPARED',
    NULL,'READY',v_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('decision_outcome_code', p_outcome_code)),
    ob.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_DECISION_PREPARED', v_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('status','READY','outcome_code',p_outcome_code), p_reason_code,
    ob.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','decision_id',v_id,'decision_reference',v_ref,
                               'decision_status','READY','decision_authority', v_auth);
  RETURN public._bn_mr_cmd_finish('PREPARE_DECISION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_decision_transition(
  p_actor uuid, p_decision uuid, p_to text, p_event text, p_expected integer,
  p_returned_reason text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; ob record;
BEGIN
  SELECT * INTO d FROM public.bn_medical_review_administrative_decision
   WHERE id = p_decision FOR UPDATE;
  PERFORM public._bn_mr_require_record(d.id, 'decision');
  PERFORM public._bn_mr_assert_access(p_actor, d.obligation_id);
  PERFORM public._bn_mr_check_version(d.row_version, p_expected);
  PERFORM public._bn_mr_assert_transition('DECISION', d.status, p_to);

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = d.obligation_id;

  IF p_to IN ('APPROVED','RETURNED')
     AND COALESCE((ob.policy_snapshot ->> 'maker_checker_required')::boolean, true)
     AND d.made_by IS NOT DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'E_SELF_APPROVAL_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_review_administrative_decision
     SET status = p_to,
         approved_by = CASE WHEN p_to = 'APPROVED' THEN p_actor ELSE approved_by END,
         approved_at = CASE WHEN p_to = 'APPROVED' THEN now() ELSE approved_at END,
         returned_reason = COALESCE(p_returned_reason, returned_reason),
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_decision;

  PERFORM public._bn_mr_event(d.obligation_id,'DECISION',p_decision,p_event,
    d.status, p_to, p_actor, 'BENEFITS_APPROVER', '{}'::jsonb, d.correlation_id);
  PERFORM public._bn_mr_audit(p_event, p_actor, p_decision, 'TRANSITION',
    jsonb_build_object('status', d.status), jsonb_build_object('status', p_to),
    p_reason, d.correlation_id, 'USER_RPC');

  RETURN jsonb_build_object('status','OK','decision_id',p_decision,'decision_status',p_to,
                            'row_version', d.row_version + 1);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_submit_decision_v1(
  p_decision_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('prepare_decision');
  v_payload jsonb := jsonb_build_object('decision', p_decision_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SUBMIT_DECISION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public._bn_mr_decision_transition(v_actor, p_decision_id, 'PENDING_APPROVAL',
              'BN_MR_DECISION_SUBMITTED', p_expected_row_version, NULL, p_reason);
  RETURN public._bn_mr_cmd_finish('SUBMIT_DECISION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_approve_decision_v1(
  p_decision_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('approve_decision');
  v_payload jsonb := jsonb_build_object('decision', p_decision_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('APPROVE_DECISION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public._bn_mr_decision_transition(v_actor, p_decision_id, 'APPROVED',
              'BN_MR_DECISION_APPROVED', p_expected_row_version, NULL, p_reason);
  RETURN public._bn_mr_cmd_finish('APPROVE_DECISION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_return_decision_v1(
  p_decision_id uuid, p_returned_reason text, p_expected_row_version integer,
  p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('approve_decision');
  v_payload jsonb := jsonb_build_object('decision', p_decision_id, 'ret', p_returned_reason);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RETURN_DECISION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_returned_reason IS NULL OR btrim(p_returned_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;
  v_resp := public._bn_mr_decision_transition(v_actor, p_decision_id, 'RETURNED',
              'BN_MR_DECISION_RETURNED', p_expected_row_version, p_returned_reason, p_returned_reason);
  RETURN public._bn_mr_cmd_finish('RETURN_DECISION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_complete_decision_v1(
  p_decision_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('approve_decision');
  v_payload jsonb := jsonb_build_object('decision', p_decision_id);
  v_cached jsonb; v_resp jsonb; d record; ob record;
BEGIN
  v_cached := public._bn_mr_cmd_begin('COMPLETE_DECISION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  v_resp := public._bn_mr_decision_transition(v_actor, p_decision_id, 'COMPLETED',
              'BN_MR_DECISION_COMPLETED', p_expected_row_version, NULL, p_reason);

  SELECT * INTO d FROM public.bn_medical_review_administrative_decision WHERE id = p_decision_id;
  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = d.obligation_id FOR UPDATE;
  IF public._bn_mr_transition_allowed('OBLIGATION', ob.status, 'COMPLETED') THEN
    UPDATE public.bn_medical_review_obligation SET status='COMPLETED',
           row_version = row_version + 1, updated_at = now(), updated_by = v_actor
     WHERE id = ob.id;
  END IF;

  PERFORM public._bn_mr_comm(ob.id, ob.bn_award_id, 'BN_MR_REVIEW_OUTCOME_NOTICE', 'CLAIMANT',
    jsonb_build_object('review_reference', ob.obligation_reference,
                       'status_label', 'REVIEW_COMPLETED', 'notice_type','REVIEW_OUTCOME'),
    'BN_MR_OUTCOME:' || p_decision_id::text, ob.correlation_id);

  RETURN public._bn_mr_cmd_finish('COMPLETE_DECISION', p_idempotency_key, v_payload,
           v_resp || jsonb_build_object('obligation_status','COMPLETED'), v_actor);
END $$;

-- ---------------------------------------------------------------------
-- AWARD ACTION PROPOSALS (proposal only — never execution)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_mr_create_proposal(
  p_actor uuid, p_decision uuid, p_kind text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; ob record; v_id uuid; v_key text;
BEGIN
  SELECT * INTO d FROM public.bn_medical_review_administrative_decision
   WHERE id = p_decision FOR UPDATE;
  PERFORM public._bn_mr_require_record(d.id, 'decision');
  PERFORM public._bn_mr_assert_access(p_actor, d.obligation_id);
  IF d.status NOT IN ('APPROVED','COMPLETED') THEN
    RAISE EXCEPTION 'E_DECISION_NOT_APPROVED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = d.obligation_id;
  v_key := 'BN_MR_PROPOSAL:' || p_decision::text || ':' || p_kind;

  INSERT INTO public.bn_medical_review_suspension_link
    (obligation_id, decision_id, proposal_kind, idempotency_key, correlation_id,
     proposed_by, proposal_status)
  VALUES (d.obligation_id, p_decision, p_kind, v_key, ob.correlation_id, p_actor, 'PROPOSED')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.bn_medical_review_suspension_link WHERE idempotency_key = v_key;
  END IF;

  PERFORM public._bn_mr_event(d.obligation_id,'PROPOSAL',v_id,'BN_MR_AWARD_ACTION_PROPOSED',
    NULL,'PROPOSED',p_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('proposal_kind', p_kind)), ob.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_AWARD_ACTION_PROPOSED', p_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('proposal_kind', p_kind, 'proposal_status','PROPOSED'),
    p_reason, ob.correlation_id, 'USER_RPC');

  RETURN jsonb_build_object('status','OK','proposal_id',v_id,'proposal_kind',p_kind,
                            'proposal_status','PROPOSED','executed', false,
                            'executor','bn_award_suspension');
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_propose_suspension_v1(
  p_decision_id uuid, p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('propose_suspension');
  v_payload jsonb := jsonb_build_object('decision', p_decision_id, 'kind', 'SUSPENSION');
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('PROPOSE_SUSPENSION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;
  v_resp := public._bn_mr_create_proposal(v_actor, p_decision_id, 'SUSPENSION', p_reason);
  RETURN public._bn_mr_cmd_finish('PROPOSE_SUSPENSION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_propose_reinstatement_v1(
  p_decision_id uuid, p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('propose_reinstatement');
  v_payload jsonb := jsonb_build_object('decision', p_decision_id, 'kind', 'REINSTATEMENT');
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('PROPOSE_REINSTATEMENT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;
  v_resp := public._bn_mr_create_proposal(v_actor, p_decision_id, 'REINSTATEMENT', p_reason);
  RETURN public._bn_mr_cmd_finish('PROPOSE_REINSTATEMENT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- =====================================================================
-- Grants
-- =====================================================================
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND (p.proname LIKE '\_bn\_mr\_%' OR p.proname LIKE 'bn\_medical\_review\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF r.proname NOT LIKE '\_%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END
$g$;
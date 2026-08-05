-- =====================================================================
-- BN Medical Reviews — command framework + lifecycle commands (part 1)
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_proposal_status_chk') THEN
    ALTER TABLE public.bn_medical_review_suspension_link
      ADD CONSTRAINT bn_mr_proposal_status_chk CHECK (proposal_status = ANY (ARRAY[
        'PROPOSED','ACCEPTED','EXECUTED','REJECTED','WITHDRAWN']));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Transition matrices
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_mr_terminal(p_entity text, p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_entity, p_status) IN (
    ('OBLIGATION','COMPLETED'), ('OBLIGATION','CLOSED'),
    ('REFERRAL','COMPLETED'), ('REFERRAL','CANCELLED'),
    ('APPOINTMENT','ATTENDED'), ('APPOINTMENT','CANCELLED'), ('APPOINTMENT','NOT_REQUIRED'),
    ('ASSESSMENT','LOCKED'),
    ('BOARD_CASE','DETERMINED'), ('BOARD_CASE','CANCELLED'),
    ('BOARD_SESSION','HELD'), ('BOARD_SESSION','CANCELLED'),
    ('DECISION','COMPLETED'),
    ('PROPOSAL','EXECUTED'), ('PROPOSAL','REJECTED'), ('PROPOSAL','WITHDRAWN'),
    ('COMMUNICATION','DELIVERED'), ('COMMUNICATION','FAILED'), ('COMMUNICATION','CANCELLED'))
$$;

CREATE OR REPLACE FUNCTION public._bn_mr_transition_allowed(p_entity text, p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_from IS NOT DISTINCT FROM p_to THEN true
    WHEN public._bn_mr_terminal(p_entity, p_from) THEN false
    ELSE (p_entity, p_from, p_to) IN (
      -- OBLIGATION
      ('OBLIGATION','NOT_DUE','NOTICE_READY'),('OBLIGATION','NOTICE_READY','NOTICE_SENT'),
      ('OBLIGATION','NOTICE_SENT','DUE'),('OBLIGATION','NOT_DUE','DUE'),
      ('OBLIGATION','DUE','IN_PROGRESS'),('OBLIGATION','NOTICE_SENT','IN_PROGRESS'),
      ('OBLIGATION','IN_PROGRESS','AWAITING_PROVIDER'),
      ('OBLIGATION','AWAITING_PROVIDER','AWAITING_REPORT'),
      ('OBLIGATION','AWAITING_PROVIDER','IN_PROGRESS'),
      ('OBLIGATION','AWAITING_REPORT','AWAITING_BOARD'),
      ('OBLIGATION','AWAITING_REPORT','AWAITING_ADMINISTRATIVE_DECISION'),
      ('OBLIGATION','AWAITING_BOARD','AWAITING_ADMINISTRATIVE_DECISION'),
      ('OBLIGATION','AWAITING_ADMINISTRATIVE_DECISION','COMPLETED'),
      ('OBLIGATION','NOT_DUE','DEFERRED'),('OBLIGATION','NOTICE_READY','DEFERRED'),
      ('OBLIGATION','NOTICE_SENT','DEFERRED'),('OBLIGATION','DUE','DEFERRED'),
      ('OBLIGATION','IN_PROGRESS','DEFERRED'),('OBLIGATION','DEFERRED','DUE'),
      ('OBLIGATION','DUE','OVERDUE'),('OBLIGATION','NOTICE_SENT','OVERDUE'),
      ('OBLIGATION','AWAITING_PROVIDER','OVERDUE'),('OBLIGATION','AWAITING_REPORT','OVERDUE'),
      ('OBLIGATION','OVERDUE','IN_PROGRESS'),('OBLIGATION','OVERDUE','MANUAL_INTERVENTION'),
      ('OBLIGATION','IN_PROGRESS','MANUAL_INTERVENTION'),
      ('OBLIGATION','AWAITING_PROVIDER','MANUAL_INTERVENTION'),
      ('OBLIGATION','AWAITING_REPORT','MANUAL_INTERVENTION'),
      ('OBLIGATION','MANUAL_INTERVENTION','IN_PROGRESS'),
      ('OBLIGATION','NOT_DUE','CLOSED'),('OBLIGATION','NOTICE_READY','CLOSED'),
      ('OBLIGATION','NOTICE_SENT','CLOSED'),('OBLIGATION','DUE','CLOSED'),
      ('OBLIGATION','IN_PROGRESS','CLOSED'),('OBLIGATION','AWAITING_PROVIDER','CLOSED'),
      ('OBLIGATION','AWAITING_REPORT','CLOSED'),('OBLIGATION','AWAITING_BOARD','CLOSED'),
      ('OBLIGATION','AWAITING_ADMINISTRATIVE_DECISION','CLOSED'),
      ('OBLIGATION','DEFERRED','CLOSED'),('OBLIGATION','OVERDUE','CLOSED'),
      ('OBLIGATION','MANUAL_INTERVENTION','CLOSED'),
      -- REFERRAL
      ('REFERRAL','DRAFT','PROVIDER_SELECTION_REQUIRED'),
      ('REFERRAL','DRAFT','PROVIDER_ASSIGNED'),
      ('REFERRAL','PROVIDER_SELECTION_REQUIRED','PROVIDER_ASSIGNED'),
      ('REFERRAL','PROVIDER_ASSIGNED','ISSUED'),
      ('REFERRAL','ISSUED','ACCEPTED'),('REFERRAL','ISSUED','DECLINED'),
      ('REFERRAL','ISSUED','EXPIRED'),
      ('REFERRAL','DECLINED','REASSIGNMENT_REQUIRED'),
      ('REFERRAL','EXPIRED','REASSIGNMENT_REQUIRED'),
      ('REFERRAL','REASSIGNMENT_REQUIRED','PROVIDER_ASSIGNED'),
      ('REFERRAL','ACCEPTED','ASSESSMENT_IN_PROGRESS'),
      ('REFERRAL','ASSESSMENT_IN_PROGRESS','REPORT_SUBMITTED'),
      ('REFERRAL','REPORT_SUBMITTED','ASSESSMENT_IN_PROGRESS'),
      ('REFERRAL','REPORT_SUBMITTED','COMPLETED'),
      ('REFERRAL','DRAFT','CANCELLED'),('REFERRAL','PROVIDER_SELECTION_REQUIRED','CANCELLED'),
      ('REFERRAL','PROVIDER_ASSIGNED','CANCELLED'),('REFERRAL','ISSUED','CANCELLED'),
      ('REFERRAL','ACCEPTED','CANCELLED'),('REFERRAL','DECLINED','CANCELLED'),
      ('REFERRAL','EXPIRED','CANCELLED'),('REFERRAL','REASSIGNMENT_REQUIRED','CANCELLED'),
      -- APPOINTMENT
      ('APPOINTMENT','PENDING','SCHEDULED'),('APPOINTMENT','SCHEDULED','RESCHEDULED'),
      ('APPOINTMENT','RESCHEDULED','RESCHEDULED'),('APPOINTMENT','SCHEDULED','ATTENDED'),
      ('APPOINTMENT','RESCHEDULED','ATTENDED'),
      ('APPOINTMENT','SCHEDULED','CLAIMANT_NO_SHOW'),('APPOINTMENT','RESCHEDULED','CLAIMANT_NO_SHOW'),
      ('APPOINTMENT','SCHEDULED','PROVIDER_CANCELLED'),('APPOINTMENT','RESCHEDULED','PROVIDER_CANCELLED'),
      ('APPOINTMENT','CLAIMANT_NO_SHOW','SCHEDULED'),('APPOINTMENT','PROVIDER_CANCELLED','SCHEDULED'),
      ('APPOINTMENT','PENDING','CANCELLED'),('APPOINTMENT','SCHEDULED','CANCELLED'),
      ('APPOINTMENT','RESCHEDULED','CANCELLED'),('APPOINTMENT','CLAIMANT_NO_SHOW','CANCELLED'),
      ('APPOINTMENT','PROVIDER_CANCELLED','CANCELLED'),
      -- ASSESSMENT
      ('ASSESSMENT','NOT_STARTED','DRAFT'),('ASSESSMENT','DRAFT','SUBMITTED'),
      ('ASSESSMENT','SUBMITTED','VALIDATED'),('ASSESSMENT','SUBMITTED','REJECTED_INCOMPLETE'),
      ('ASSESSMENT','SUBMITTED','CLARIFICATION_REQUIRED'),('ASSESSMENT','SUBMITTED','ADDENDUM_REQUIRED'),
      ('ASSESSMENT','CLARIFICATION_REQUIRED','SUBMITTED'),('ASSESSMENT','ADDENDUM_REQUIRED','SUBMITTED'),
      ('ASSESSMENT','REJECTED_INCOMPLETE','DRAFT'),('ASSESSMENT','VALIDATED','LOCKED'),
      -- BOARD CASE
      ('BOARD_CASE','REFERRED','MEMBERS_ASSIGNED'),('BOARD_CASE','REFERRED','SCHEDULED'),
      ('BOARD_CASE','MEMBERS_ASSIGNED','SCHEDULED'),('BOARD_CASE','SCHEDULED','EVIDENCE_REQUESTED'),
      ('BOARD_CASE','MEMBERS_ASSIGNED','EVIDENCE_REQUESTED'),
      ('BOARD_CASE','EVIDENCE_REQUESTED','SCHEDULED'),('BOARD_CASE','SCHEDULED','IN_SESSION'),
      ('BOARD_CASE','IN_SESSION','DETERMINED'),('BOARD_CASE','IN_SESSION','DEFERRED'),
      ('BOARD_CASE','DEFERRED','SCHEDULED'),('BOARD_CASE','REFERRED','CANCELLED'),
      ('BOARD_CASE','MEMBERS_ASSIGNED','CANCELLED'),('BOARD_CASE','SCHEDULED','CANCELLED'),
      ('BOARD_CASE','EVIDENCE_REQUESTED','CANCELLED'),('BOARD_CASE','DEFERRED','CANCELLED'),
      -- BOARD SESSION
      ('BOARD_SESSION','SCHEDULED','HELD'),('BOARD_SESSION','SCHEDULED','ADJOURNED'),
      ('BOARD_SESSION','SCHEDULED','CANCELLED'),('BOARD_SESSION','ADJOURNED','SCHEDULED'),
      ('BOARD_SESSION','ADJOURNED','HELD'),('BOARD_SESSION','ADJOURNED','CANCELLED'),
      -- DECISION
      ('DECISION','NOT_READY','READY'),('DECISION','READY','PENDING_APPROVAL'),
      ('DECISION','PENDING_APPROVAL','APPROVED'),('DECISION','PENDING_APPROVAL','RETURNED'),
      ('DECISION','RETURNED','READY'),('DECISION','APPROVED','COMPLETED'),
      -- PROPOSAL
      ('PROPOSAL','PROPOSED','ACCEPTED'),('PROPOSAL','PROPOSED','REJECTED'),
      ('PROPOSAL','PROPOSED','WITHDRAWN'),('PROPOSAL','ACCEPTED','EXECUTED'),
      ('PROPOSAL','ACCEPTED','WITHDRAWN'),
      -- COMMUNICATION
      ('COMMUNICATION','PENDING','REQUESTED'),('COMMUNICATION','PENDING','QUEUED'),
      ('COMMUNICATION','PENDING','CANCELLED'),('COMMUNICATION','REQUESTED','QUEUED'),
      ('COMMUNICATION','REQUESTED','CANCELLED'),('COMMUNICATION','QUEUED','DISPATCHED'),
      ('COMMUNICATION','QUEUED','CANCELLED'),('COMMUNICATION','DISPATCHED','DELIVERED'),
      ('COMMUNICATION','DISPATCHED','FAILED'),('COMMUNICATION','DISPATCHED','RETRY'),
      ('COMMUNICATION','RETRY','QUEUED'),('COMMUNICATION','RETRY','FAILED'),
      ('COMMUNICATION','RETRY','CANCELLED'))
  END
$$;

CREATE OR REPLACE FUNCTION public._bn_mr_assert_transition(p_entity text, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF public._bn_mr_terminal(p_entity, p_from) AND p_from IS DISTINCT FROM p_to THEN
    RAISE EXCEPTION 'E_STATE_TERMINAL:%:%', p_entity, p_from USING ERRCODE='P0001';
  END IF;
  IF NOT public._bn_mr_transition_allowed(p_entity, p_from, p_to) THEN
    RAISE EXCEPTION 'E_INVALID_STATE_TRANSITION:%:%->%', p_entity, p_from, p_to USING ERRCODE='P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_check_version(p_actual integer, p_expected integer)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_expected IS NOT NULL AND p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'E_VERSION_CONFLICT' USING ERRCODE='P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Idempotency framework
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_mr_fingerprint(p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(extensions.digest(convert_to(COALESCE(p_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION public._bn_mr_cmd_begin(p_command text, p_idem text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF p_idem IS NULL OR btrim(p_idem) = '' THEN
    RAISE EXCEPTION 'E_IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE='P0001';
  END IF;
  SELECT response INTO v FROM public.bn_medical_review_idempotency
   WHERE idempotency_key = p_idem AND command_code = p_command;
  IF v IS NOT NULL THEN RETURN v || jsonb_build_object('replayed', true); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_cmd_finish(
  p_command text, p_idem text, p_payload jsonb, p_response jsonb, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  INSERT INTO public.bn_medical_review_idempotency
    (idempotency_key, command_code, request_fingerprint, response, actor_user_id)
  VALUES (p_idem, p_command, public._bn_mr_fingerprint(p_payload), p_response, p_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT response INTO v FROM public.bn_medical_review_idempotency WHERE idempotency_key = p_idem;
  RETURN COALESCE(v, p_response);
END $$;

-- Common command preamble.
CREATE OR REPLACE FUNCTION public._bn_mr_cmd_actor(p_permission text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := public._bn_mr_actor();
BEGIN
  PERFORM public._bn_mr_assert_enabled();
  PERFORM public._bn_mr_require(v_actor, p_permission);
  RETURN v_actor;
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_reference(p_prefix text)
RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT p_prefix || '-' || to_char(now(),'YYYYMMDD') || '-' ||
         upper(substr(md5(gen_random_uuid()::text), 1, 8))
$$;

-- =====================================================================
-- POLICY COMMANDS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bn_medical_review_publish_policy_v1(
  p_policy_id uuid, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('publish_policy');
  v_payload jsonb := jsonb_build_object('policy_id', p_policy_id);
  v_cached jsonb; pol record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('PUBLISH_POLICY', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO pol FROM public.bn_medical_review_policy WHERE id = p_policy_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(pol.id, 'policy');
  IF pol.lifecycle_state <> 'DRAFT' THEN
    RAISE EXCEPTION 'E_INVALID_STATE_TRANSITION:POLICY:%->PUBLISHED', pol.lifecycle_state USING ERRCODE='P0001';
  END IF;

  PERFORM public._bn_mr_validate_policy(p_policy_id);

  UPDATE public.bn_medical_review_policy
     SET lifecycle_state = 'PUBLISHED', published_at = now(), published_by = v_actor,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_policy_id;

  PERFORM public._bn_mr_audit('BN_MR_POLICY_PUBLISHED', v_actor, p_policy_id, 'PUBLISH',
    jsonb_build_object('lifecycle_state', pol.lifecycle_state),
    jsonb_build_object('lifecycle_state','PUBLISHED'), p_reason, gen_random_uuid(), 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','policy_id',p_policy_id,'lifecycle_state','PUBLISHED');
  RETURN public._bn_mr_cmd_finish('PUBLISH_POLICY', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_supersede_policy_v1(
  p_policy_id uuid, p_successor_policy_id uuid, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('publish_policy');
  v_payload jsonb := jsonb_build_object('policy_id', p_policy_id, 'successor', p_successor_policy_id);
  v_cached jsonb; pol record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SUPERSEDE_POLICY', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO pol FROM public.bn_medical_review_policy WHERE id = p_policy_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(pol.id, 'policy');
  IF pol.lifecycle_state NOT IN ('PUBLISHED','EFFECTIVE') THEN
    RAISE EXCEPTION 'E_INVALID_STATE_TRANSITION:POLICY:%->SUPERSEDED', pol.lifecycle_state USING ERRCODE='P0001';
  END IF;
  IF p_successor_policy_id IS NOT NULL THEN
    PERFORM 1 FROM public.bn_medical_review_policy WHERE id = p_successor_policy_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:successor_policy' USING ERRCODE='P0001'; END IF;
  END IF;

  UPDATE public.bn_medical_review_policy
     SET lifecycle_state = 'SUPERSEDED',
         effective_to = COALESCE(effective_to, public._bn_mr_today(pol.timezone_code)),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_policy_id;

  PERFORM public._bn_mr_audit('BN_MR_POLICY_SUPERSEDED', v_actor, p_policy_id, 'SUPERSEDE',
    jsonb_build_object('lifecycle_state', pol.lifecycle_state),
    jsonb_build_object('lifecycle_state','SUPERSEDED','successor', p_successor_policy_id),
    p_reason, gen_random_uuid(), 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','policy_id',p_policy_id,'lifecycle_state','SUPERSEDED');
  RETURN public._bn_mr_cmd_finish('SUPERSEDE_POLICY', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- =====================================================================
-- OBLIGATION COMMANDS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bn_medical_review_preview_obligation_v1(
  p_award_id uuid, p_policy_id uuid, p_review_type text, p_review_reason text,
  p_period_start date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  pol record; v_start date; v_due date; v_notice date; v_grace date;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'generate_obligations');
  IF NOT public._bn_mr_can_access_award(v_actor, p_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO pol FROM public.bn_medical_review_policy WHERE id = p_policy_id;
  PERFORM public._bn_mr_require_record(pol.id, 'policy');
  IF pol.lifecycle_state NOT IN ('PUBLISHED','EFFECTIVE') THEN
    RAISE EXCEPTION 'E_POLICY_NOT_PUBLISHED' USING ERRCODE='P0001';
  END IF;

  v_start  := COALESCE(p_period_start, public._bn_mr_today(pol.timezone_code));
  v_due    := public._bn_mr_add_days(v_start, pol.initial_review_offset_days, pol.business_days_only);
  v_notice := public._bn_mr_add_days(v_due, -1 * pol.notice_period_days, false);
  v_grace  := public._bn_mr_add_days(v_due, pol.grace_period_days, pol.business_days_only);

  RETURN jsonb_build_object(
    'status','PREVIEW', 'bn_award_id', p_award_id, 'policy_id', p_policy_id,
    'review_type', COALESCE(p_review_type, pol.review_type), 'review_reason', p_review_reason,
    'review_period_start', v_start, 'due_date', v_due,
    'notice_due_date', v_notice, 'grace_end_date', v_grace,
    'timezone_code', pol.timezone_code,
    'already_open', EXISTS (SELECT 1 FROM public.bn_medical_review_obligation o
                             WHERE o.bn_award_id = p_award_id
                               AND o.status NOT IN ('COMPLETED','CLOSED')));
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_generate_obligation_v1(
  p_award_id uuid, p_policy_id uuid, p_review_type text, p_review_reason text,
  p_period_start date, p_period_end date, p_risk_classification text,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('generate_obligations');
  v_payload jsonb := jsonb_build_object('award', p_award_id, 'policy', p_policy_id,
                       'review_type', p_review_type, 'reason', p_review_reason,
                       'start', p_period_start, 'end', p_period_end);
  v_cached jsonb; pol record; aw record; v_id uuid; v_ref text;
  v_start date; v_end date; v_due date; v_notice date; v_grace date; v_corr uuid := gen_random_uuid();
  v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('GENERATE_OBLIGATION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT public._bn_mr_can_access_award(v_actor, p_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO aw FROM public.bn_award WHERE id = p_award_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(aw.id, 'award');

  SELECT * INTO pol FROM public.bn_medical_review_policy WHERE id = p_policy_id;
  PERFORM public._bn_mr_require_record(pol.id, 'policy');
  IF pol.lifecycle_state NOT IN ('PUBLISHED','EFFECTIVE') THEN
    RAISE EXCEPTION 'E_POLICY_NOT_PUBLISHED' USING ERRCODE='P0001';
  END IF;
  PERFORM public._bn_mr_validate_policy(p_policy_id);

  v_start  := COALESCE(p_period_start, public._bn_mr_today(pol.timezone_code));
  v_due    := public._bn_mr_add_days(v_start, pol.initial_review_offset_days, pol.business_days_only);
  v_end    := COALESCE(p_period_end, v_due);
  v_notice := public._bn_mr_add_days(v_due, -1 * pol.notice_period_days, false);
  v_grace  := public._bn_mr_add_days(v_due, pol.grace_period_days, pol.business_days_only);
  v_ref    := public._bn_mr_reference('MR');

  INSERT INTO public.bn_medical_review_obligation
    (obligation_reference, bn_claim_id, bn_award_id, bn_product_id, bn_product_version_id,
     policy_id, policy_version_no, policy_snapshot, review_type, review_reason,
     review_period_start, review_period_end, status, notice_due_date, due_date, grace_end_date,
     risk_classification, employment_injury_case, correlation_id, generated_by_command,
     created_by, updated_by)
  VALUES
    (v_ref, aw.bn_claim_id, p_award_id, pol.bn_product_id, pol.bn_product_version_id,
     p_policy_id, pol.version_no, public._bn_mr_policy_snapshot(p_policy_id),
     COALESCE(p_review_type, pol.review_type), p_review_reason,
     v_start, v_end, 'NOT_DUE', v_notice, v_due, v_grace,
     COALESCE(p_risk_classification, 'STANDARD'),
     COALESCE(p_review_type, pol.review_type) = 'EMPLOYMENT_INJURY',
     v_corr, 'GENERATE_OBLIGATION', v_actor, v_actor)
  RETURNING id INTO v_id;

  PERFORM public._bn_mr_event(v_id, 'OBLIGATION', v_id, 'BN_MR_OBLIGATION_GENERATED',
    NULL, 'NOT_DUE', v_actor, 'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('reference', v_ref, 'due_date', v_due)), v_corr);
  PERFORM public._bn_mr_audit('BN_MR_OBLIGATION_GENERATED', v_actor, v_id, 'CREATE',
    NULL, jsonb_build_object('status','NOT_DUE','reference',v_ref), p_reason, v_corr, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','obligation_id',v_id,'obligation_reference',v_ref,
                               'due_date',v_due,'obligation_status','NOT_DUE');
  RETURN public._bn_mr_cmd_finish('GENERATE_OBLIGATION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_defer_review_v1(
  p_obligation_id uuid, p_deferred_until date, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('defer_review');
  v_payload jsonb := jsonb_build_object('obligation', p_obligation_id, 'until', p_deferred_until);
  v_cached jsonb; ob record; v_max date; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('DEFER_REVIEW', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);
  PERFORM public._bn_mr_check_version(ob.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('OBLIGATION', ob.status, 'DEFERRED');

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  v_max := public._bn_mr_add_days(ob.due_date,
             COALESCE((ob.policy_snapshot ->> 'max_deferral_days')::int, 0), false);
  IF p_deferred_until IS NULL OR p_deferred_until > v_max THEN
    RAISE EXCEPTION 'E_DEFERRAL_EXCEEDS_POLICY' USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_review_obligation
     SET status='DEFERRED', deferred_until=p_deferred_until,
         row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE id = p_obligation_id;

  PERFORM public._bn_mr_event(p_obligation_id,'OBLIGATION',p_obligation_id,'BN_MR_REVIEW_DEFERRED',
    ob.status,'DEFERRED',v_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('due_date', p_deferred_until)), ob.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_REVIEW_DEFERRED', v_actor, p_obligation_id, 'DEFER',
    jsonb_build_object('status', ob.status), jsonb_build_object('status','DEFERRED'),
    p_reason, ob.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','obligation_id',p_obligation_id,
                               'obligation_status','DEFERRED','row_version',ob.row_version+1);
  RETURN public._bn_mr_cmd_finish('DEFER_REVIEW', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_close_review_v1(
  p_obligation_id uuid, p_expected_row_version integer, p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('close_review');
  v_payload jsonb := jsonb_build_object('obligation', p_obligation_id);
  v_cached jsonb; ob record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('CLOSE_REVIEW', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);
  PERFORM public._bn_mr_check_version(ob.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('OBLIGATION', ob.status, 'CLOSED');
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_review_obligation
     SET status='CLOSED', row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE id = p_obligation_id;

  UPDATE public.bn_medical_review_referral
     SET status='CANCELLED', row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE obligation_id = p_obligation_id
     AND status IN ('DRAFT','PROVIDER_SELECTION_REQUIRED','PROVIDER_ASSIGNED','ISSUED',
                    'ACCEPTED','DECLINED','EXPIRED','REASSIGNMENT_REQUIRED');

  PERFORM public._bn_mr_event(p_obligation_id,'OBLIGATION',p_obligation_id,'BN_MR_REVIEW_CLOSED',
    ob.status,'CLOSED',v_actor,'BENEFITS_OFFICER','{}'::jsonb, ob.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_REVIEW_CLOSED', v_actor, p_obligation_id, 'CLOSE',
    jsonb_build_object('status', ob.status), jsonb_build_object('status','CLOSED'),
    p_reason, ob.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','obligation_id',p_obligation_id,'obligation_status','CLOSED');
  RETURN public._bn_mr_cmd_finish('CLOSE_REVIEW', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- =====================================================================
-- REFERRAL COMMANDS
-- =====================================================================
CREATE OR REPLACE FUNCTION public._bn_mr_accountable_practitioner(p_provider uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pr record;
BEGIN
  SELECT * INTO pr FROM public.bn_medical_provider WHERE id = p_provider;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'E_NOT_FOUND:provider' USING ERRCODE='P0001'; END IF;
  IF pr.is_individual_practitioner THEN RETURN pr.id; END IF;
  IF pr.accountable_practitioner_id IS NOT NULL THEN RETURN pr.accountable_practitioner_id; END IF;
  IF pr.approved_panel_id IS NOT NULL THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'E_PROVIDER_NO_ACCOUNTABLE_PRACTITIONER' USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_create_referral(
  p_actor uuid, p_obligation uuid, p_provider uuid, p_purpose text,
  p_parent uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ob record; snap jsonb; v_id uuid; v_ref text; v_conflict jsonb; v_acct uuid;
  v_tz text; v_today date; v_person uuid; v_group text;
BEGIN
  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation FOR UPDATE;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  IF public._bn_mr_terminal('OBLIGATION', ob.status) THEN
    RAISE EXCEPTION 'E_STATE_TERMINAL:OBLIGATION:%', ob.status USING ERRCODE='P0001';
  END IF;

  snap := COALESCE(ob.policy_snapshot, '{}'::jsonb);
  v_tz := COALESCE(snap ->> 'timezone_code', 'UTC');
  v_today := public._bn_mr_today(v_tz);
  v_group := CASE WHEN p_purpose = 'SECOND_OPINION' THEN 'SECOND_OPINION' ELSE 'PRIMARY' END;

  IF p_purpose = 'SECOND_OPINION'
     AND COALESCE(snap ->> 'second_opinion_mode','NOT_PERMITTED') = 'NOT_PERMITTED' THEN
    RAISE EXCEPTION 'E_SECOND_OPINION_NOT_PERMITTED' USING ERRCODE='P0001';
  END IF;

  SELECT c.person_id INTO v_person FROM public.bn_claim c WHERE c.id = ob.bn_claim_id;

  IF p_provider IS NOT NULL THEN
    PERFORM public._bn_mr_assert_provider_eligible(
      p_provider, ob.bn_product_id, ob.review_type,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(snap -> 'required_specialties','[]'::jsonb))),
      v_today, ob.bn_claim_id);
    v_conflict := public._bn_mr_conflict_check(p_provider, ob.bn_claim_id, ob.bn_award_id, v_person, NULL);
    IF COALESCE((v_conflict ->> 'conflict')::boolean, false) THEN
      RAISE EXCEPTION 'E_PROVIDER_CONFLICT_RESTRICTED:%', COALESCE(v_conflict ->> 'rule','UNKNOWN')
        USING ERRCODE='P0001';
    END IF;
    v_acct := public._bn_mr_accountable_practitioner(p_provider);
  ELSE
    v_conflict := jsonb_build_object('conflict', false, 'checked_at', now());
  END IF;

  v_ref := public._bn_mr_reference('MRR');

  INSERT INTO public.bn_medical_review_referral
    (obligation_id, referral_reference, provider_id, provider_snapshot, bn_claim_id, bn_award_id,
     claimant_person_id, referring_officer, evidence_release_scope, appointment_responsibility,
     acceptance_deadline, report_deadline, consent_status, status, referral_purpose,
     concurrency_group, parent_referral_id, conflict_check, accountable_practitioner_id,
     correlation_id, created_by, updated_by)
  VALUES
    (p_obligation, v_ref, p_provider,
     CASE WHEN p_provider IS NULL THEN NULL ELSE public._bn_mr_provider_snapshot(p_provider) END,
     ob.bn_claim_id, ob.bn_award_id, v_person, p_actor,
     CASE WHEN COALESCE(snap ->> 'assessment_model','') = 'DOCUMENT_ONLY'
          THEN 'CASE_EVIDENCE' ELSE 'FUNCTIONAL_SUMMARY_ONLY' END,
     COALESCE(snap ->> 'appointment_responsibility','NOT_APPLICABLE'),
     public._bn_mr_add_days(v_today, COALESCE((snap ->> 'referral_acceptance_deadline_days')::int, 7),
                            COALESCE((snap ->> 'business_days_only')::boolean, false)),
     public._bn_mr_add_days(v_today, COALESCE((snap ->> 'report_deadline_days')::int, 30),
                            COALESCE((snap ->> 'business_days_only')::boolean, false)),
     'NOT_REQUIRED',
     CASE WHEN p_provider IS NULL THEN 'PROVIDER_SELECTION_REQUIRED' ELSE 'PROVIDER_ASSIGNED' END,
     p_purpose, v_group, p_parent, v_conflict, v_acct, ob.correlation_id, p_actor, p_actor)
  RETURNING id INTO v_id;

  IF ob.status IN ('NOT_DUE','NOTICE_READY','NOTICE_SENT','DUE') THEN
    UPDATE public.bn_medical_review_obligation
       SET status = 'IN_PROGRESS', row_version = row_version + 1, updated_at = now(), updated_by = p_actor
     WHERE id = p_obligation AND public._bn_mr_transition_allowed('OBLIGATION', status, 'IN_PROGRESS');
  END IF;

  PERFORM public._bn_mr_event(p_obligation,'REFERRAL',v_id,'BN_MR_REFERRAL_CREATED',
    NULL, CASE WHEN p_provider IS NULL THEN 'PROVIDER_SELECTION_REQUIRED' ELSE 'PROVIDER_ASSIGNED' END,
    p_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('referral_reference', v_ref, 'provider_id', p_provider)),
    ob.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_REFERRAL_CREATED', p_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('referral_reference', v_ref, 'provider_id', p_provider,
                       'purpose', p_purpose, 'conflict_check', v_conflict),
    p_reason, ob.correlation_id, 'USER_RPC');

  RETURN jsonb_build_object('status','OK','referral_id',v_id,'referral_reference',v_ref,
                            'referral_status', CASE WHEN p_provider IS NULL
                              THEN 'PROVIDER_SELECTION_REQUIRED' ELSE 'PROVIDER_ASSIGNED' END,
                            'conflict_check', v_conflict);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_assign_provider_v1(
  p_obligation_id uuid, p_provider_id uuid, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('assign_provider');
  v_payload jsonb := jsonb_build_object('obligation', p_obligation_id, 'provider', p_provider_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('ASSIGN_PROVIDER', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);
  v_resp := public._bn_mr_create_referral(v_actor, p_obligation_id, p_provider_id, 'PRIMARY', NULL, p_reason);
  RETURN public._bn_mr_cmd_finish('ASSIGN_PROVIDER', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_nominate_treating_doctor_v1(
  p_obligation_id uuid, p_provider_id uuid, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('assign_provider');
  v_payload jsonb := jsonb_build_object('obligation', p_obligation_id, 'provider', p_provider_id);
  v_cached jsonb; ob record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('NOMINATE_TREATING_DOCTOR', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  IF NOT COALESCE((ob.policy_snapshot ->> 'treating_doctor_permitted')::boolean, false) THEN
    RAISE EXCEPTION 'E_TREATING_DOCTOR_NOT_PERMITTED' USING ERRCODE='P0001';
  END IF;

  v_resp := public._bn_mr_create_referral(v_actor, p_obligation_id, NULL, 'PRIMARY', NULL, p_reason);
  UPDATE public.bn_medical_review_referral
     SET provider_id = p_provider_id, updated_at = now(), updated_by = v_actor
   WHERE id = (v_resp ->> 'referral_id')::uuid;
  v_resp := v_resp || jsonb_build_object('nominated_provider_id', p_provider_id,
                                         'referral_status','PROVIDER_SELECTION_REQUIRED',
                                         'requires_verification', true);
  RETURN public._bn_mr_cmd_finish('NOMINATE_TREATING_DOCTOR', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_verify_nominated_provider_v1(
  p_referral_id uuid, p_expected_row_version integer, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('verify_credentials');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id);
  v_cached jsonb; rf record; ob record; snap jsonb; v_conflict jsonb; v_resp jsonb; v_acct uuid;
BEGIN
  v_cached := public._bn_mr_cmd_begin('VERIFY_NOMINATED_PROVIDER', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(v_actor, rf.obligation_id);
  PERFORM public._bn_mr_check_version(rf.row_version, p_expected_row_version);
  PERFORM public._bn_mr_assert_transition('REFERRAL', rf.status, 'PROVIDER_ASSIGNED');
  IF rf.provider_id IS NULL THEN RAISE EXCEPTION 'E_NOT_FOUND:provider' USING ERRCODE='P0001'; END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = rf.obligation_id;
  snap := COALESCE(ob.policy_snapshot, '{}'::jsonb);

  PERFORM public._bn_mr_assert_provider_eligible(
    rf.provider_id, ob.bn_product_id, ob.review_type,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(snap -> 'required_specialties','[]'::jsonb))),
    public._bn_mr_today(COALESCE(snap ->> 'timezone_code','UTC')), ob.bn_claim_id);

  v_conflict := public._bn_mr_conflict_check(rf.provider_id, ob.bn_claim_id, ob.bn_award_id,
                                             rf.claimant_person_id, NULL);
  IF COALESCE((v_conflict ->> 'conflict')::boolean, false) THEN
    RAISE EXCEPTION 'E_PROVIDER_CONFLICT_RESTRICTED:%', v_conflict ->> 'rule' USING ERRCODE='P0001';
  END IF;
  v_acct := public._bn_mr_accountable_practitioner(rf.provider_id);

  UPDATE public.bn_medical_review_referral
     SET status='PROVIDER_ASSIGNED', provider_snapshot = public._bn_mr_provider_snapshot(rf.provider_id),
         conflict_check = v_conflict, accountable_practitioner_id = v_acct,
         row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE id = p_referral_id;

  PERFORM public._bn_mr_event(rf.obligation_id,'REFERRAL',p_referral_id,'BN_MR_PROVIDER_VERIFIED',
    rf.status,'PROVIDER_ASSIGNED',v_actor,'BENEFITS_OFFICER','{}'::jsonb, rf.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_PROVIDER_VERIFIED', v_actor, p_referral_id, 'VERIFY',
    jsonb_build_object('status', rf.status),
    jsonb_build_object('status','PROVIDER_ASSIGNED','conflict_check', v_conflict),
    p_reason, rf.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','referral_id',p_referral_id,
                               'referral_status','PROVIDER_ASSIGNED','row_version', rf.row_version+1);
  RETURN public._bn_mr_cmd_finish('VERIFY_NOMINATED_PROVIDER', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- Generic referral status command used by issue / accept / decline / expire.
CREATE OR REPLACE FUNCTION public._bn_mr_referral_transition(
  p_actor uuid, p_referral uuid, p_to text, p_event text, p_expected integer,
  p_reason text, p_actor_category text, p_decline_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rf record; ob record; v_obl_to text;
BEGIN
  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral FOR UPDATE;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(p_actor, rf.obligation_id);
  PERFORM public._bn_mr_check_version(rf.row_version, p_expected);
  PERFORM public._bn_mr_assert_transition('REFERRAL', rf.status, p_to);

  UPDATE public.bn_medical_review_referral
     SET status = p_to,
         issued_at = CASE WHEN p_to = 'ISSUED' THEN now() ELSE issued_at END,
         responded_at = CASE WHEN p_to IN ('ACCEPTED','DECLINED') THEN now() ELSE responded_at END,
         decline_reason = COALESCE(p_decline_reason, decline_reason),
         row_version = row_version + 1, updated_at = now(), updated_by = p_actor
   WHERE id = p_referral;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = rf.obligation_id FOR UPDATE;
  v_obl_to := CASE WHEN p_to = 'ISSUED' THEN 'AWAITING_PROVIDER'
                   WHEN p_to = 'ACCEPTED' THEN 'AWAITING_REPORT'
                   WHEN p_to IN ('DECLINED','EXPIRED') THEN 'IN_PROGRESS' ELSE NULL END;
  IF v_obl_to IS NOT NULL AND public._bn_mr_transition_allowed('OBLIGATION', ob.status, v_obl_to) THEN
    UPDATE public.bn_medical_review_obligation
       SET status = v_obl_to, row_version = row_version + 1, updated_at = now(), updated_by = p_actor
     WHERE id = ob.id;
  END IF;

  PERFORM public._bn_mr_event(rf.obligation_id,'REFERRAL',p_referral,p_event,
    rf.status, p_to, p_actor, p_actor_category,
    public._bn_mr_safe_detail(jsonb_build_object('reason_code', p_decline_reason)), rf.correlation_id);
  PERFORM public._bn_mr_audit(p_event, p_actor, p_referral, 'TRANSITION',
    jsonb_build_object('status', rf.status), jsonb_build_object('status', p_to),
    p_reason, rf.correlation_id,
    CASE WHEN p_actor_category = 'PROVIDER' THEN 'PROVIDER_PORTAL' ELSE 'USER_RPC' END);

  RETURN jsonb_build_object('status','OK','referral_id',p_referral,'referral_status',p_to,
                            'row_version', rf.row_version + 1);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_issue_referral_v1(
  p_referral_id uuid, p_expected_row_version integer, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('issue_referral');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id);
  v_cached jsonb; v_resp jsonb; rf record;
BEGIN
  v_cached := public._bn_mr_cmd_begin('ISSUE_REFERRAL', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  v_resp := public._bn_mr_referral_transition(v_actor, p_referral_id, 'ISSUED',
              'BN_MR_REFERRAL_ISSUED', p_expected_row_version, p_reason, 'BENEFITS_OFFICER');

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id;
  PERFORM public._bn_mr_comm(rf.obligation_id, rf.bn_award_id, 'BN_MR_REFERRAL_ISSUED', 'PROVIDER',
    jsonb_build_object('referral_reference', rf.referral_reference,
                       'deadline_date', rf.acceptance_deadline, 'notice_type', 'REFERRAL_ISSUED'),
    'BN_MR_REFERRAL_ISSUED:' || p_referral_id::text, rf.correlation_id);

  RETURN public._bn_mr_cmd_finish('ISSUE_REFERRAL', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_accept_referral_v1(
  p_referral_id uuid, p_expected_row_version integer, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('view');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id);
  v_cached jsonb; v_resp jsonb; rf record; v_provider uuid;
BEGIN
  v_cached := public._bn_mr_cmd_begin('ACCEPT_REFERRAL', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  v_provider := public._bn_mr_provider_for_user(v_actor);
  IF v_provider IS DISTINCT FROM rf.provider_id
     AND NOT public._bn_mr_require_ok(v_actor, 'issue_referral') THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_resp := public._bn_mr_referral_transition(v_actor, p_referral_id, 'ACCEPTED',
              'BN_MR_REFERRAL_ACCEPTED', p_expected_row_version, p_reason,
              CASE WHEN v_provider IS NOT NULL THEN 'PROVIDER' ELSE 'BENEFITS_OFFICER' END);
  RETURN public._bn_mr_cmd_finish('ACCEPT_REFERRAL', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_require_ok(p_actor uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_permission(p_actor, 'bn_medical_review', p_action) OR public.is_admin(p_actor)
$$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_decline_referral_v1(
  p_referral_id uuid, p_decline_reason text, p_expected_row_version integer,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('view');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id, 'decline', p_decline_reason);
  v_cached jsonb; v_resp jsonb; rf record; v_provider uuid;
BEGIN
  v_cached := public._bn_mr_cmd_begin('DECLINE_REFERRAL', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_decline_reason IS NULL OR btrim(p_decline_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  v_provider := public._bn_mr_provider_for_user(v_actor);
  IF v_provider IS DISTINCT FROM rf.provider_id
     AND NOT public._bn_mr_require_ok(v_actor, 'issue_referral') THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;

  v_resp := public._bn_mr_referral_transition(v_actor, p_referral_id, 'DECLINED',
              'BN_MR_REFERRAL_DECLINED', p_expected_row_version, p_reason,
              CASE WHEN v_provider IS NOT NULL THEN 'PROVIDER' ELSE 'BENEFITS_OFFICER' END,
              p_decline_reason);
  RETURN public._bn_mr_cmd_finish('DECLINE_REFERRAL', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_expire_referral_v1(
  p_referral_id uuid, p_expected_row_version integer, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('issue_referral');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('EXPIRE_REFERRAL', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public._bn_mr_referral_transition(v_actor, p_referral_id, 'EXPIRED',
              'BN_MR_REFERRAL_EXPIRED', p_expected_row_version, p_reason, 'BENEFITS_OFFICER');
  RETURN public._bn_mr_cmd_finish('EXPIRE_REFERRAL', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_reassign_provider_v1(
  p_referral_id uuid, p_provider_id uuid, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('assign_provider');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id, 'provider', p_provider_id);
  v_cached jsonb; rf record; ob record; snap jsonb; v_conflict jsonb; v_resp jsonb; v_acct uuid;
BEGIN
  v_cached := public._bn_mr_cmd_begin('REASSIGN_PROVIDER', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(v_actor, rf.obligation_id);
  PERFORM public._bn_mr_check_version(rf.row_version, p_expected_row_version);

  IF rf.status IN ('DECLINED','EXPIRED') THEN
    UPDATE public.bn_medical_review_referral SET status='REASSIGNMENT_REQUIRED',
           row_version = row_version + 1, updated_at = now(), updated_by = v_actor
     WHERE id = p_referral_id;
    rf.status := 'REASSIGNMENT_REQUIRED'; rf.row_version := rf.row_version + 1;
  END IF;
  PERFORM public._bn_mr_assert_transition('REFERRAL', rf.status, 'PROVIDER_ASSIGNED');

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = rf.obligation_id;
  snap := COALESCE(ob.policy_snapshot, '{}'::jsonb);

  PERFORM public._bn_mr_assert_provider_eligible(
    p_provider_id, ob.bn_product_id, ob.review_type,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(snap -> 'required_specialties','[]'::jsonb))),
    public._bn_mr_today(COALESCE(snap ->> 'timezone_code','UTC')), ob.bn_claim_id);
  v_conflict := public._bn_mr_conflict_check(p_provider_id, ob.bn_claim_id, ob.bn_award_id,
                                             rf.claimant_person_id, NULL);
  IF COALESCE((v_conflict ->> 'conflict')::boolean, false) THEN
    RAISE EXCEPTION 'E_PROVIDER_CONFLICT_RESTRICTED:%', v_conflict ->> 'rule' USING ERRCODE='P0001';
  END IF;
  v_acct := public._bn_mr_accountable_practitioner(p_provider_id);

  UPDATE public.bn_medical_review_referral
     SET provider_id = p_provider_id, provider_snapshot = public._bn_mr_provider_snapshot(p_provider_id),
         conflict_check = v_conflict, accountable_practitioner_id = v_acct,
         status = 'PROVIDER_ASSIGNED', responded_at = NULL, decline_reason = NULL,
         row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE id = p_referral_id;

  PERFORM public._bn_mr_event(rf.obligation_id,'REFERRAL',p_referral_id,'BN_MR_PROVIDER_REASSIGNED',
    rf.status,'PROVIDER_ASSIGNED',v_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('provider_id', p_provider_id)), rf.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_PROVIDER_REASSIGNED', v_actor, p_referral_id, 'REASSIGN',
    jsonb_build_object('status', rf.status, 'provider_id', rf.provider_id),
    jsonb_build_object('status','PROVIDER_ASSIGNED','provider_id', p_provider_id),
    p_reason, rf.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','referral_id',p_referral_id,
                               'referral_status','PROVIDER_ASSIGNED','row_version', rf.row_version + 1);
  RETURN public._bn_mr_cmd_finish('REASSIGN_PROVIDER', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_request_second_opinion_v1(
  p_obligation_id uuid, p_parent_referral_id uuid, p_provider_id uuid,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('request_second_opinion');
  v_payload jsonb := jsonb_build_object('obligation', p_obligation_id, 'parent', p_parent_referral_id,
                                        'provider', p_provider_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('REQUEST_SECOND_OPINION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  v_resp := public._bn_mr_create_referral(v_actor, p_obligation_id, p_provider_id,
              'SECOND_OPINION', p_parent_referral_id, p_reason)
            || jsonb_build_object('referral_purpose','SECOND_OPINION');
  RETURN public._bn_mr_cmd_finish('REQUEST_SECOND_OPINION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

-- =====================================================================
-- APPOINTMENT COMMANDS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bn_medical_review_schedule_appointment_v1(
  p_referral_id uuid, p_scheduled_at timestamptz, p_location_reference text,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_appointment');
  v_payload jsonb := jsonb_build_object('referral', p_referral_id, 'at', p_scheduled_at);
  v_cached jsonb; rf record; ob record; v_id uuid; v_seq integer; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('SCHEDULE_APPOINTMENT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO rf FROM public.bn_medical_review_referral WHERE id = p_referral_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(rf.id, 'referral');
  PERFORM public._bn_mr_assert_access(v_actor, rf.obligation_id);
  IF rf.status NOT IN ('ACCEPTED','ASSESSMENT_IN_PROGRESS') THEN
    RAISE EXCEPTION 'E_INVALID_STATE_TRANSITION:REFERRAL:%->APPOINTMENT', rf.status USING ERRCODE='P0001';
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() THEN
    RAISE EXCEPTION 'E_APPOINTMENT_DATE_INVALID' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = rf.obligation_id;
  SELECT COALESCE(max(sequence_no), 0) + 1 INTO v_seq
    FROM public.bn_medical_review_appointment WHERE referral_id = p_referral_id;

  INSERT INTO public.bn_medical_review_appointment
    (referral_id, obligation_id, status, responsibility, scheduled_at, location_reference,
     sequence_no, correlation_id, created_by)
  VALUES (p_referral_id, rf.obligation_id, 'SCHEDULED', rf.appointment_responsibility,
          p_scheduled_at, p_location_reference, v_seq, rf.correlation_id, v_actor)
  RETURNING id INTO v_id;

  PERFORM public._bn_mr_event(rf.obligation_id,'APPOINTMENT',v_id,'BN_MR_APPOINTMENT_SCHEDULED',
    NULL,'SCHEDULED',v_actor,'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('sequence_no', v_seq)), rf.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_APPOINTMENT_SCHEDULED', v_actor, v_id, 'CREATE', NULL,
    jsonb_build_object('status','SCHEDULED','sequence_no',v_seq), p_reason, rf.correlation_id, 'USER_RPC');

  PERFORM public._bn_mr_comm(rf.obligation_id, rf.bn_award_id, 'BN_MR_APPOINTMENT_SCHEDULED', 'CLAIMANT',
    jsonb_build_object('review_reference', ob.obligation_reference,
                       'referral_reference', rf.referral_reference,
                       'appointment_date', (p_scheduled_at)::date,
                       'location_label', p_location_reference, 'notice_type','APPOINTMENT'),
    'BN_MR_APPT:' || v_id::text, rf.correlation_id);

  v_resp := jsonb_build_object('status','OK','appointment_id',v_id,'appointment_status','SCHEDULED');
  RETURN public._bn_mr_cmd_finish('SCHEDULE_APPOINTMENT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_appointment_transition(
  p_actor uuid, p_appointment uuid, p_to text, p_event text, p_expected integer,
  p_category text, p_notes text, p_reason text, p_scheduled_at timestamptz DEFAULT NULL,
  p_cause_outcome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ap record;
BEGIN
  SELECT * INTO ap FROM public.bn_medical_review_appointment WHERE id = p_appointment FOR UPDATE;
  PERFORM public._bn_mr_require_record(ap.id, 'appointment');
  PERFORM public._bn_mr_assert_access(p_actor, ap.obligation_id);
  PERFORM public._bn_mr_check_version(ap.row_version, p_expected);
  PERFORM public._bn_mr_assert_transition('APPOINTMENT', ap.status, p_to);

  UPDATE public.bn_medical_review_appointment
     SET status = p_to,
         scheduled_at = COALESCE(p_scheduled_at, scheduled_at),
         reschedule_count = reschedule_count + CASE WHEN p_to = 'RESCHEDULED' THEN 1 ELSE 0 END,
         non_attendance_category = COALESCE(p_category, non_attendance_category),
         non_attendance_notes = COALESCE(p_notes, non_attendance_notes),
         reasonable_cause_reviewed = reasonable_cause_reviewed OR p_cause_outcome IS NOT NULL,
         reasonable_cause_outcome = COALESCE(p_cause_outcome, reasonable_cause_outcome),
         recorded_by = p_actor, recorded_at = now(),
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_appointment;

  PERFORM public._bn_mr_event(ap.obligation_id,'APPOINTMENT',p_appointment,p_event,
    ap.status, p_to, p_actor, 'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('reason_code', p_category)), ap.correlation_id);
  PERFORM public._bn_mr_audit(p_event, p_actor, p_appointment, 'TRANSITION',
    jsonb_build_object('status', ap.status), jsonb_build_object('status', p_to),
    p_reason, ap.correlation_id, 'USER_RPC');

  RETURN jsonb_build_object('status','OK','appointment_id',p_appointment,
                            'appointment_status',p_to,'row_version', ap.row_version + 1);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_reschedule_appointment_v1(
  p_appointment_id uuid, p_scheduled_at timestamptz, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_appointment');
  v_payload jsonb := jsonb_build_object('appointment', p_appointment_id, 'at', p_scheduled_at);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RESCHEDULE_APPOINTMENT', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() THEN
    RAISE EXCEPTION 'E_APPOINTMENT_DATE_INVALID' USING ERRCODE='P0001';
  END IF;
  v_resp := public._bn_mr_appointment_transition(v_actor, p_appointment_id, 'RESCHEDULED',
              'BN_MR_APPOINTMENT_RESCHEDULED', p_expected_row_version, NULL, NULL, p_reason, p_scheduled_at);
  RETURN public._bn_mr_cmd_finish('RESCHEDULE_APPOINTMENT', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_attendance_v1(
  p_appointment_id uuid, p_expected_row_version integer, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_appointment');
  v_payload jsonb := jsonb_build_object('appointment', p_appointment_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_ATTENDANCE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public._bn_mr_appointment_transition(v_actor, p_appointment_id, 'ATTENDED',
              'BN_MR_APPOINTMENT_ATTENDED', p_expected_row_version, NULL, NULL, p_reason);
  RETURN public._bn_mr_cmd_finish('RECORD_ATTENDANCE', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_non_attendance_v1(
  p_appointment_id uuid, p_category text, p_notes text, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_appointment');
  v_payload jsonb := jsonb_build_object('appointment', p_appointment_id, 'category', p_category);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_NON_ATTENDANCE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_category IS NULL THEN RAISE EXCEPTION 'E_REASON_REQUIRED' USING ERRCODE='P0001'; END IF;
  v_resp := public._bn_mr_appointment_transition(v_actor, p_appointment_id, 'CLAIMANT_NO_SHOW',
              'BN_MR_APPOINTMENT_NO_SHOW', p_expected_row_version, p_category, p_notes, p_reason);
  RETURN public._bn_mr_cmd_finish('RECORD_NON_ATTENDANCE', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_provider_cancellation_v1(
  p_appointment_id uuid, p_notes text, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_appointment');
  v_payload jsonb := jsonb_build_object('appointment', p_appointment_id);
  v_cached jsonb; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_PROVIDER_CANCELLATION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  v_resp := public._bn_mr_appointment_transition(v_actor, p_appointment_id, 'PROVIDER_CANCELLED',
              'BN_MR_APPOINTMENT_PROVIDER_CANCELLED', p_expected_row_version,
              'PROVIDER_CANCELLATION', p_notes, p_reason);
  RETURN public._bn_mr_cmd_finish('RECORD_PROVIDER_CANCELLATION', p_idempotency_key, v_payload, v_resp, v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_record_reasonable_cause_v1(
  p_appointment_id uuid, p_outcome text, p_expected_row_version integer,
  p_idempotency_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_appointment');
  v_payload jsonb := jsonb_build_object('appointment', p_appointment_id, 'outcome', p_outcome);
  v_cached jsonb; ap record; v_resp jsonb;
BEGIN
  v_cached := public._bn_mr_cmd_begin('RECORD_REASONABLE_CAUSE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_outcome NOT IN ('CAUSE_ACCEPTED','CAUSE_REJECTED','FURTHER_EVIDENCE_REQUIRED') THEN
    RAISE EXCEPTION 'E_INVALID_OUTCOME' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO ap FROM public.bn_medical_review_appointment WHERE id = p_appointment_id FOR UPDATE;
  PERFORM public._bn_mr_require_record(ap.id, 'appointment');
  PERFORM public._bn_mr_assert_access(v_actor, ap.obligation_id);
  PERFORM public._bn_mr_check_version(ap.row_version, p_expected_row_version);
  IF ap.status NOT IN ('CLAIMANT_NO_SHOW','PROVIDER_CANCELLED') THEN
    RAISE EXCEPTION 'E_INVALID_STATE_TRANSITION:APPOINTMENT:%->REASONABLE_CAUSE', ap.status
      USING ERRCODE='P0001';
  END IF;

  UPDATE public.bn_medical_review_appointment
     SET reasonable_cause_reviewed = true, reasonable_cause_outcome = p_outcome,
         recorded_by = v_actor, recorded_at = now(),
         row_version = row_version + 1, updated_at = now()
   WHERE id = p_appointment_id;

  PERFORM public._bn_mr_event(ap.obligation_id,'APPOINTMENT',p_appointment_id,
    'BN_MR_REASONABLE_CAUSE_RECORDED', ap.status, ap.status, v_actor, 'BENEFITS_OFFICER',
    public._bn_mr_safe_detail(jsonb_build_object('reason_code', p_outcome)), ap.correlation_id);
  PERFORM public._bn_mr_audit('BN_MR_REASONABLE_CAUSE_RECORDED', v_actor, p_appointment_id, 'UPDATE',
    jsonb_build_object('reasonable_cause_outcome', ap.reasonable_cause_outcome),
    jsonb_build_object('reasonable_cause_outcome', p_outcome), p_reason, ap.correlation_id, 'USER_RPC');

  v_resp := jsonb_build_object('status','OK','appointment_id',p_appointment_id,
                               'reasonable_cause_outcome',p_outcome,'row_version', ap.row_version + 1);
  RETURN public._bn_mr_cmd_finish('RECORD_REASONABLE_CAUSE', p_idempotency_key, v_payload, v_resp, v_actor);
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
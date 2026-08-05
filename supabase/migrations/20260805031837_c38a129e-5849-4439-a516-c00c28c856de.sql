-- =====================================================================
-- BN Medical Reviews — Phase 1 forward-only FOUNDATION HARDENING
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 Authority separation
-- ---------------------------------------------------------------------
ALTER TABLE public.bn_medical_review_policy
  ADD COLUMN IF NOT EXISTS medical_determination_authority text NOT NULL DEFAULT 'ASSESSING_DOCTOR',
  ADD COLUMN IF NOT EXISTS administrative_decision_authority text NOT NULL DEFAULT 'BENEFITS_DECISION_OFFICER',
  ADD COLUMN IF NOT EXISTS maker_checker_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maker_checker_chain jsonb NOT NULL DEFAULT '["PREPARER","APPROVER"]'::jsonb,
  ADD COLUMN IF NOT EXISTS board_id uuid,
  ADD COLUMN IF NOT EXISTS concurrent_referrals_permitted boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_policy_med_authority_chk') THEN
    ALTER TABLE public.bn_medical_review_policy
      ADD CONSTRAINT bn_mr_policy_med_authority_chk CHECK (medical_determination_authority = ANY (ARRAY[
        'ASSESSING_DOCTOR','INDEPENDENT_SPECIALIST','MEDICAL_BOARD_ADVISORY',
        'MEDICAL_BOARD_BINDING','MEDICAL_PANEL']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_policy_admin_authority_chk') THEN
    ALTER TABLE public.bn_medical_review_policy
      ADD CONSTRAINT bn_mr_policy_admin_authority_chk CHECK (administrative_decision_authority = ANY (ARRAY[
        'BENEFITS_DECISION_OFFICER','BENEFITS_SUPERVISOR','ADJUDICATION_COMMITTEE','DIRECTOR']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_policy_board_fk') THEN
    ALTER TABLE public.bn_medical_review_policy
      ADD CONSTRAINT bn_mr_policy_board_fk FOREIGN KEY (board_id) REFERENCES public.bn_medical_board(id);
  END IF;
END $$;

-- 1.12 provider-fee policy classifications
ALTER TABLE public.bn_medical_review_policy
  DROP CONSTRAINT IF EXISTS bn_medical_review_policy_provider_fee_responsibility_check;
ALTER TABLE public.bn_medical_review_policy
  ADD CONSTRAINT bn_medical_review_policy_provider_fee_responsibility_check
  CHECK (provider_fee_responsibility = ANY (ARRAY[
    'SOCIAL_SECURITY','CLAIMANT','EMPLOYER','GOVERNMENT_FACILITY','CONTRACT_RETAINER',
    'PER_ASSESSMENT','PANEL_ALLOWANCE','NO_FEE','SHARED','NOT_APPLICABLE']));

-- 1.11 individual clinical actor vs facility
ALTER TABLE public.bn_medical_provider
  ADD COLUMN IF NOT EXISTS is_individual_practitioner boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accountable_practitioner_id uuid,
  ADD COLUMN IF NOT EXISTS approved_panel_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_provider_accountable_fk') THEN
    ALTER TABLE public.bn_medical_provider
      ADD CONSTRAINT bn_mr_provider_accountable_fk
      FOREIGN KEY (accountable_practitioner_id) REFERENCES public.bn_medical_provider(id);
  END IF;
END $$;

UPDATE public.bn_medical_provider
   SET is_individual_practitioner = false
 WHERE provider_type IN ('CLINIC','HOSPITAL','DIAGNOSTIC_PROVIDER');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_provider_actor_chk') THEN
    ALTER TABLE public.bn_medical_provider
      ADD CONSTRAINT bn_mr_provider_actor_chk CHECK (
        is_individual_practitioner
        OR accountable_practitioner_id IS NOT NULL
        OR approved_panel_id IS NOT NULL);
  END IF;
END $$;

-- 1.8 wildcard-safe provider approval uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS bn_mr_provider_approval_uq
  ON public.bn_medical_provider_approval (provider_id, bn_product_id, review_type)
  NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------
-- Obligation routing facts + risk classification
-- ---------------------------------------------------------------------
ALTER TABLE public.bn_medical_review_obligation
  ADD COLUMN IF NOT EXISTS risk_classification text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS manual_board_referral_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS employment_injury_case boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_obligation_risk_chk') THEN
    ALTER TABLE public.bn_medical_review_obligation
      ADD CONSTRAINT bn_mr_obligation_risk_chk
      CHECK (risk_classification = ANY (ARRAY['STANDARD','ELEVATED','HIGH_RISK','EXCEPTIONAL']));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Referral: second-opinion lineage, conflict evidence, integrity
-- ---------------------------------------------------------------------
ALTER TABLE public.bn_medical_review_referral
  ADD COLUMN IF NOT EXISTS referral_purpose text NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN IF NOT EXISTS concurrency_group text NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN IF NOT EXISTS parent_referral_id uuid,
  ADD COLUMN IF NOT EXISTS conflict_check jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS accountable_practitioner_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_referral_purpose_chk') THEN
    ALTER TABLE public.bn_medical_review_referral
      ADD CONSTRAINT bn_mr_referral_purpose_chk
      CHECK (referral_purpose = ANY (ARRAY['PRIMARY','SECOND_OPINION','REASSIGNMENT','BOARD_DIRECTED']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_referral_parent_fk') THEN
    ALTER TABLE public.bn_medical_review_referral
      ADD CONSTRAINT bn_mr_referral_parent_fk
      FOREIGN KEY (parent_referral_id) REFERENCES public.bn_medical_review_referral(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_referral_claim_fk') THEN
    ALTER TABLE public.bn_medical_review_referral
      ADD CONSTRAINT bn_mr_referral_claim_fk FOREIGN KEY (bn_claim_id) REFERENCES public.bn_claim(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_referral_award_fk') THEN
    ALTER TABLE public.bn_medical_review_referral
      ADD CONSTRAINT bn_mr_referral_award_fk FOREIGN KEY (bn_award_id) REFERENCES public.bn_award(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_referral_accountable_fk') THEN
    ALTER TABLE public.bn_medical_review_referral
      ADD CONSTRAINT bn_mr_referral_accountable_fk
      FOREIGN KEY (accountable_practitioner_id) REFERENCES public.bn_medical_provider(id);
  END IF;
END $$;

-- 1.13 evidence link -> board case, suspension link -> canonical suspension event
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_evidence_board_case_fk') THEN
    ALTER TABLE public.bn_medical_review_evidence_link
      ADD CONSTRAINT bn_mr_evidence_board_case_fk
      FOREIGN KEY (board_case_id) REFERENCES public.bn_medical_board_case(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bn_mr_suspension_event_fk') THEN
    ALTER TABLE public.bn_medical_review_suspension_link
      ADD CONSTRAINT bn_mr_suspension_event_fk
      FOREIGN KEY (suspension_event_id) REFERENCES public.bn_award_suspension_event(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1.14 Active-record uniqueness
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS bn_mr_active_referral_uq
  ON public.bn_medical_review_referral (obligation_id, concurrency_group)
  WHERE status IN ('DRAFT','PROVIDER_SELECTION_REQUIRED','PROVIDER_ASSIGNED','ISSUED',
                   'ACCEPTED','ASSESSMENT_IN_PROGRESS','REPORT_SUBMITTED');

CREATE UNIQUE INDEX IF NOT EXISTS bn_mr_active_appointment_uq
  ON public.bn_medical_review_appointment (referral_id)
  WHERE status IN ('PENDING','SCHEDULED','RESCHEDULED');

CREATE UNIQUE INDEX IF NOT EXISTS bn_mr_active_assessment_uq
  ON public.bn_medical_review_assessment (referral_id)
  WHERE status IN ('DRAFT','SUBMITTED','CLARIFICATION_REQUIRED','ADDENDUM_REQUIRED');

CREATE UNIQUE INDEX IF NOT EXISTS bn_mr_active_decision_uq
  ON public.bn_medical_review_administrative_decision (obligation_id)
  WHERE status IN ('NOT_READY','READY','PENDING_APPROVAL','APPROVED','RETURNED');

CREATE UNIQUE INDEX IF NOT EXISTS bn_mr_open_board_case_uq
  ON public.bn_medical_board_case (obligation_id, COALESCE(trigger_rule_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('REFERRED','SCHEDULED','MEMBERS_ASSIGNED','EVIDENCE_REQUESTED','IN_SESSION','DEFERRED');

CREATE UNIQUE INDEX IF NOT EXISTS bn_mr_proposal_uq
  ON public.bn_medical_review_suspension_link (decision_id, proposal_kind)
  WHERE decision_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 1.7 Board session participation (separate from case assignment)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_board_session_participation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.bn_medical_board_session(id) ON DELETE CASCADE,
  board_case_id uuid NOT NULL REFERENCES public.bn_medical_board_case(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.bn_medical_board_case_participant(id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.bn_medical_board_member(id),
  member_user_id uuid,
  attendance_status text NOT NULL DEFAULT 'EXPECTED'
    CHECK (attendance_status = ANY (ARRAY['EXPECTED','PRESENT','ABSENT','APOLOGIES','WITHDRAWN'])),
  conflict_declared boolean NOT NULL DEFAULT false,
  conflict_details text,
  recused boolean NOT NULL DEFAULT false,
  recused_at timestamptz,
  vote text CHECK (vote IS NULL OR vote = ANY (ARRAY['FOR','AGAINST','ABSTAIN'])),
  vote_reason text,
  voted_at timestamptz,
  recorded_by uuid,
  recorded_at timestamptz,
  correlation_id uuid,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_mr_session_participation_uq UNIQUE (session_id, member_id),
  CONSTRAINT bn_mr_session_recusal_chk CHECK (NOT recused OR vote IS NULL)
);

REVOKE ALL ON public.bn_medical_board_session_participation FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bn_medical_board_session_participation TO service_role;

CREATE INDEX IF NOT EXISTS bn_mr_session_participation_case_idx
  ON public.bn_medical_board_session_participation (board_case_id);
CREATE INDEX IF NOT EXISTS bn_mr_session_participation_user_idx
  ON public.bn_medical_board_session_participation (member_user_id);

-- 1.6 recusal must also be visible at case level
ALTER TABLE public.bn_medical_board_case_participant
  ADD COLUMN IF NOT EXISTS recused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recused_at timestamptz;

-- ---------------------------------------------------------------------
-- 1.15 Communication: canonical delivery-status set (shared adapter)
-- ---------------------------------------------------------------------
ALTER TABLE public.bn_medical_review_communication_intent
  DROP CONSTRAINT IF EXISTS bn_medical_review_communication_intent_delivery_status_check;
ALTER TABLE public.bn_medical_review_communication_intent
  ADD CONSTRAINT bn_medical_review_communication_intent_delivery_status_check
  CHECK (delivery_status = ANY (ARRAY['PENDING','RETRY','REQUESTED','QUEUED','DISPATCHED',
                                      'DELIVERED','FAILED','CANCELLED']));

-- =====================================================================
-- Helper corrections
-- =====================================================================

-- 1.5 timezone-aware date helpers (no hard-coded jurisdiction)
CREATE OR REPLACE FUNCTION public._bn_mr_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'UTC')::date $$;

CREATE OR REPLACE FUNCTION public._bn_mr_today(p_tz text)
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF(btrim(p_tz), ''), 'UTC'))::date
$$;

CREATE OR REPLACE FUNCTION public._bn_mr_add_days(p_from date, p_days integer, p_business_only boolean)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date := p_from; n integer := COALESCE(p_days, 0);
BEGIN
  IF NOT COALESCE(p_business_only, false) THEN RETURN d + n; END IF;
  WHILE n > 0 LOOP
    d := d + 1;
    IF EXTRACT(ISODOW FROM d) < 6 THEN n := n - 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- 1.16 audit origin reflects the real actor category
DROP FUNCTION IF EXISTS public._bn_mr_audit(text, uuid, uuid, text, jsonb, jsonb, text, uuid);
CREATE OR REPLACE FUNCTION public._bn_mr_audit(
  p_event_code text, p_actor uuid, p_entity_id uuid, p_action text,
  p_before jsonb, p_after jsonb, p_reason text, p_correlation uuid,
  p_origin text DEFAULT 'USER_RPC')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_origin text := COALESCE(NULLIF(btrim(p_origin), ''), 'USER_RPC');
BEGIN
  IF v_origin NOT IN ('USER_RPC','PROVIDER_PORTAL','BOARD_WORKSPACE','SCHEDULER',
                      'COMMUNICATION_ADAPTER','SYSTEM_REPAIR') THEN
    RAISE EXCEPTION 'E_INVALID_AUDIT_ORIGIN' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.core_audit_log
    (event_code, event_name, event_category, severity, actor_user_id, module_code, domain_code,
     entity_type, entity_id, action, outcome, before_value, after_value, reason,
     correlation_id, source, is_system_generated)
  VALUES
    (p_event_code, p_event_code, 'BENEFITS', 'INFO', p_actor, 'bn_medical_review', 'benefits',
     'bn_medical_review', p_entity_id, p_action, 'SUCCESS', p_before, p_after, p_reason,
     p_correlation, v_origin,
     v_origin IN ('SCHEDULER','COMMUNICATION_ADAPTER','SYSTEM_REPAIR'));
END $$;

-- 1.16 event detail allowlist
CREATE OR REPLACE FUNCTION public._bn_mr_safe_detail(p_detail jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
    FROM jsonb_each(COALESCE(p_detail, '{}'::jsonb)) AS e(k, v)
   WHERE k = ANY (ARRAY['reason_code','status','from_status','to_status','reference',
                        'referral_reference','review_reference','board_reference',
                        'session_reference','due_date','deadline_date','appointment_date',
                        'provider_id','provider_code','board_id','board_case_id','member_id',
                        'decision_outcome_code','proposal_kind','sequence_no','count',
                        'correlation_id','command_code','recipient_category'])
$$;

-- 1.15 communication context allowlist (reject/discard everything else)
CREATE OR REPLACE FUNCTION public._bn_mr_safe_comm_context(p_context jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
    FROM jsonb_each(COALESCE(p_context, '{}'::jsonb)) AS e(k, v)
   WHERE k = ANY (ARRAY['review_reference','referral_reference','appointment_reference',
                        'appointment_date','appointment_time','location_label','facility_label',
                        'deadline_date','due_date','status_label','recipient_category',
                        'correlation_id','board_reference','board_session_date','notice_type'])
$$;

CREATE OR REPLACE FUNCTION public._bn_mr_comm(
  p_obligation uuid, p_award uuid, p_event_code text, p_recipient_category text,
  p_context jsonb, p_idem text, p_correlation uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_ctx jsonb;
BEGIN
  v_ctx := public._bn_mr_safe_comm_context(p_context);

  INSERT INTO public.bn_medical_review_communication_intent
    (obligation_id, bn_award_id, event_code, recipient_reference, recipient_category,
     context, idempotency_key, correlation_id, delivery_status)
  VALUES (p_obligation, p_award, p_event_code, p_award::text,
          COALESCE(p_recipient_category, 'CLAIMANT'), v_ctx, p_idem, p_correlation, 'PENDING')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.bn_medical_review_communication_intent
     WHERE idempotency_key = p_idem;
  ELSIF p_obligation IS NOT NULL THEN
    UPDATE public.bn_medical_review_obligation
       SET communication_status = 'INTENT_RECORDED' WHERE id = p_obligation;
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 1.3 Complete routing snapshot
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_mr_policy_snapshot(p_policy uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (to_jsonb(p) - 'created_at' - 'updated_at' - 'created_by' - 'updated_by')
      || jsonb_build_object(
           'snapshot_at', now(),
           'snapshot_version', 2,
           'timezone_code', p.timezone_code,
           'business_days_only', p.business_days_only,
           'board', (SELECT jsonb_build_object(
                              'board_id', b.id, 'board_code', b.board_code,
                              'board_name', b.board_name, 'review_mode', b.review_mode,
                              'meeting_mode', b.meeting_mode, 'voting_rule', b.voting_rule,
                              'minimum_quorum', b.minimum_quorum,
                              'determination_binding', b.determination_binding,
                              'required_specialties', to_jsonb(b.required_specialties))
                       FROM public.bn_medical_board b WHERE b.id = p.board_id),
           'board_trigger_rules', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'rule_id', r.id, 'rule_code', r.rule_code, 'rule_name', r.rule_name,
                       'evaluation_order', r.evaluation_order, 'condition', r.condition,
                       'board_type', r.board_type,
                       'required_specialties', to_jsonb(r.required_specialties),
                       'required_quorum', r.required_quorum,
                       'determination_binding', r.determination_binding,
                       'completion_offset_days', r.completion_offset_days)
                     ORDER BY r.evaluation_order, r.rule_code)
                FROM public.bn_medical_review_board_trigger_rule r
               WHERE r.policy_id = p.id AND r.is_active), '[]'::jsonb))
    FROM public.bn_medical_review_policy p WHERE p.id = p_policy
$$;

-- ---------------------------------------------------------------------
-- 1.2 Policy validation (invalid combinations rejected at publication)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_mr_validate_policy(p_policy uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_rules integer; v_bad_quorum integer;
BEGIN
  SELECT * INTO p FROM public.bn_medical_review_policy WHERE id = p_policy;
  PERFORM public._bn_mr_require_record(p.id, 'policy');

  IF p.assessment_model = 'MEDICAL_BOARD_DIRECT' AND p.board_mode = 'NONE' THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:BOARD_DIRECT_WITHOUT_BOARD' USING ERRCODE='P0001';
  END IF;

  IF COALESCE(array_length(p.required_specialties, 1), 0) > 0
     AND p.assessment_model IN ('EXTERNAL_APPROVED_PROVIDER','INDEPENDENT_SPECIALIST')
     AND p.provider_selection_model = 'NOT_APPLICABLE' THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:SPECIALTY_WITHOUT_SELECTION_METHOD' USING ERRCODE='P0001';
  END IF;

  IF p.assessment_model = 'DOCUMENT_ONLY'
     AND p.appointment_responsibility <> 'NOT_APPLICABLE' THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:DOCUMENT_ONLY_WITH_APPOINTMENT' USING ERRCODE='P0001';
  END IF;

  IF p.assessment_model = 'CLAIMANT_TREATING_DOCTOR' AND NOT p.treating_doctor_permitted THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:TREATING_DOCTOR_PROHIBITED' USING ERRCODE='P0001';
  END IF;

  IF p.provider_selection_model = 'TREATING_PROVIDER_NOMINATED' AND NOT p.treating_doctor_permitted THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:TREATING_DOCTOR_PROHIBITED' USING ERRCODE='P0001';
  END IF;

  IF p.second_opinion_mode = 'NOT_PERMITTED' AND EXISTS (
       SELECT 1 FROM public.bn_medical_review_board_trigger_rule r
        WHERE r.policy_id = p.id AND r.is_active AND r.rule_code LIKE 'SECOND_OPINION%') THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:SECOND_OPINION_DISABLED' USING ERRCODE='P0001';
  END IF;

  SELECT count(*) INTO v_bad_quorum FROM public.bn_medical_review_board_trigger_rule r
   WHERE r.policy_id = p.id AND r.is_active AND r.required_quorum < 1;
  IF v_bad_quorum > 0 THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:QUORUM_BELOW_ONE' USING ERRCODE='P0001';
  END IF;

  IF (p.board_determination_binding OR p.medical_determination_authority = 'MEDICAL_BOARD_BINDING')
     AND p.board_id IS NULL THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:BINDING_BOARD_NOT_CONFIGURED' USING ERRCODE='P0001';
  END IF;

  SELECT count(*) INTO v_rules FROM public.bn_medical_review_board_trigger_rule r
   WHERE r.policy_id = p.id AND r.is_active;
  IF p.board_mode = 'CONDITIONAL' AND v_rules = 0 THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:CONDITIONAL_WITHOUT_RULES' USING ERRCODE='P0001';
  END IF;

  IF p.medical_determination_authority IN ('MEDICAL_BOARD_ADVISORY','MEDICAL_BOARD_BINDING')
     AND p.board_mode = 'NONE' THEN
    RAISE EXCEPTION 'E_POLICY_INVALID:BOARD_AUTHORITY_WITHOUT_BOARD_MODE' USING ERRCODE='P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1.9 Explicit conflict resolver (JSON arrays evaluated correctly)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_mr_conflict_check(
  p_provider uuid, p_claim uuid, p_award uuid, p_person uuid, p_employer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; r record;
BEGIN
  SELECT COALESCE(conflict_restrictions, '{}'::jsonb) INTO v
    FROM public.bn_medical_provider WHERE id = p_provider;
  IF v IS NULL THEN RETURN jsonb_build_object('conflict', false, 'checked_at', now()); END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('excluded_claim_ids',    'EXCLUDED_CLAIM',    p_claim::text),
      ('excluded_award_ids',    'EXCLUDED_AWARD',    p_award::text),
      ('excluded_person_ids',   'EXCLUDED_PERSON',   p_person::text),
      ('excluded_employer_ids', 'EXCLUDED_EMPLOYER', p_employer::text)
    ) AS t(key, rule, val)
  LOOP
    IF r.val IS NOT NULL
       AND jsonb_typeof(v -> r.key) = 'array'
       AND (v -> r.key) ? r.val THEN
      RETURN jsonb_build_object('conflict', true, 'rule', r.rule,
                                'matched_value', r.val, 'checked_at', now());
    END IF;
  END LOOP;

  IF jsonb_typeof(v -> 'excluded_relationships') = 'array'
     AND p_person IS NOT NULL
     AND (v -> 'excluded_relationships') ? p_person::text THEN
    RETURN jsonb_build_object('conflict', true, 'rule', 'EXCLUDED_RELATIONSHIP',
                              'matched_value', p_person::text, 'checked_at', now());
  END IF;

  RETURN jsonb_build_object('conflict', false, 'checked_at', now());
END $$;

-- 1.10 Provider snapshot including the eligibility basis used at assignment
CREATE OR REPLACE FUNCTION public._bn_mr_provider_snapshot(p_provider uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'provider_id', p.id, 'provider_code', p.provider_code,
           'classification', p.classification, 'provider_type', p.provider_type,
           'is_individual_practitioner', p.is_individual_practitioner,
           'accountable_practitioner_id', p.accountable_practitioner_id,
           'approved_panel_id', p.approved_panel_id,
           'practitioner_name', p.practitioner_name,
           'registration_number', p.registration_number,
           'licensing_authority', p.licensing_authority,
           'licence_expiry_date', p.licence_expiry_date,
           'licence_valid', (p.licence_expiry_date IS NULL OR p.licence_expiry_date >= current_date),
           'specialties', to_jsonb(p.specialties), 'facility_id', p.facility_id,
           'provider_status', p.provider_status,
           'verification_status', p.verification_status,
           'contract_status', p.contract_status,
           'fee_arrangement', p.fee_arrangement,
           'effective_from', p.effective_from, 'effective_to', p.effective_to,
           'approvals', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'approval_id', a.id, 'bn_product_id', a.bn_product_id,
                       'review_type', a.review_type,
                       'effective_from', a.effective_from, 'effective_to', a.effective_to)
                     ORDER BY a.effective_from)
                FROM public.bn_medical_provider_approval a
               WHERE a.provider_id = p.id AND a.is_active), '[]'::jsonb),
           'snapshot_at', now())
    FROM public.bn_medical_provider p WHERE p.id = p_provider
$$;

-- 1.6 Board secretary scoping helpers
CREATE OR REPLACE FUNCTION public._bn_mr_secretary_boards(p_actor uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.board_id FROM public.bn_medical_board_member m
   WHERE m.member_user_id = p_actor
     AND upper(m.member_role) = 'SECRETARY'
     AND COALESCE(m.is_active, true)
$$;

CREATE OR REPLACE FUNCTION public._bn_mr_can_access(p_actor uuid, p_obligation uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_award uuid; v_provider uuid;
BEGIN
  IF p_actor IS NULL OR p_obligation IS NULL THEN RETURN false; END IF;

  SELECT bn_award_id INTO v_award FROM public.bn_medical_review_obligation WHERE id = p_obligation;
  IF v_award IS NULL THEN RETURN false; END IF;

  IF public._bn_mr_can_access_award(p_actor, v_award) THEN RETURN true; END IF;

  v_provider := public._bn_mr_provider_for_user(p_actor);
  IF v_provider IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.bn_medical_review_referral r
        WHERE r.obligation_id = p_obligation AND r.provider_id = v_provider
          AND r.status IN ('ISSUED','ACCEPTED','ASSESSMENT_IN_PROGRESS','REPORT_SUBMITTED','COMPLETED')) THEN
    RETURN true;
  END IF;

  -- Board member: assigned cases only (recused members keep auditable access).
  IF EXISTS (
       SELECT 1 FROM public.bn_medical_board_case_participant p
       JOIN public.bn_medical_board_case c ON c.id = p.board_case_id
        WHERE c.obligation_id = p_obligation AND p.member_user_id = p_actor) THEN
    RETURN true;
  END IF;

  -- Board secretary: only cases belonging to a board they are secretary of,
  -- or cases explicitly assigned to them.
  IF public.has_permission(p_actor, 'bn_medical_review', 'manage_board_session')
     AND EXISTS (
       SELECT 1 FROM public.bn_medical_board_case c
        WHERE c.obligation_id = p_obligation
          AND c.board_id IN (SELECT public._bn_mr_secretary_boards(p_actor))) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

-- 1.6 confidential evidence: recusal removes future access
CREATE OR REPLACE FUNCTION public._bn_mr_can_view_confidential(p_actor uuid, p_obligation uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._bn_mr_can_access(p_actor, p_obligation) THEN RETURN false; END IF;

  IF EXISTS (
       SELECT 1 FROM public.bn_medical_board_case_participant p
       JOIN public.bn_medical_board_case c ON c.id = p.board_case_id
        WHERE c.obligation_id = p_obligation AND p.member_user_id = p_actor
          AND (p.recused OR COALESCE(p.conflict_declared, false))) THEN
    RETURN false;
  END IF;

  RETURN public.is_admin(p_actor)
      OR public.has_permission(p_actor, 'bn_medical_review', 'view_confidential_medical_evidence');
END $$;

-- ---------------------------------------------------------------------
-- 1.4 Server-side fact construction
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_mr_build_facts(p_obligation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ob record; asr record; v_tz text; v_today date;
  v_second_requested boolean; v_second_received boolean; v_second_validated boolean;
  v_conflicting boolean; v_departure boolean; v_temp_extensions integer;
BEGIN
  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation;
  IF ob.id IS NULL THEN RETURN '{}'::jsonb; END IF;

  v_tz := COALESCE(ob.policy_snapshot ->> 'timezone_code', 'UTC');
  v_today := public._bn_mr_today(v_tz);

  SELECT a.* INTO asr FROM public.bn_medical_review_assessment a
    JOIN public.bn_medical_review_referral r ON r.id = a.referral_id
   WHERE a.obligation_id = p_obligation AND r.referral_purpose = 'PRIMARY'
   ORDER BY a.created_at DESC LIMIT 1;

  v_second_requested := EXISTS (
    SELECT 1 FROM public.bn_medical_review_referral r
     WHERE r.obligation_id = p_obligation AND r.referral_purpose = 'SECOND_OPINION'
       AND r.status <> 'CANCELLED');

  v_second_received := EXISTS (
    SELECT 1 FROM public.bn_medical_review_assessment a
      JOIN public.bn_medical_review_referral r ON r.id = a.referral_id
     WHERE a.obligation_id = p_obligation AND r.referral_purpose = 'SECOND_OPINION'
       AND a.status IN ('SUBMITTED','VALIDATED','LOCKED'));

  v_second_validated := EXISTS (
    SELECT 1 FROM public.bn_medical_review_assessment a
      JOIN public.bn_medical_review_referral r ON r.id = a.referral_id
     WHERE a.obligation_id = p_obligation AND r.referral_purpose = 'SECOND_OPINION'
       AND a.status IN ('VALIDATED','LOCKED'));

  SELECT count(DISTINCT a.medical_outcome) > 1 INTO v_conflicting
    FROM public.bn_medical_review_assessment a
   WHERE a.obligation_id = p_obligation
     AND a.status IN ('SUBMITTED','VALIDATED','LOCKED')
     AND a.medical_outcome IS NOT NULL;

  v_departure := EXISTS (
    SELECT 1 FROM public.bn_medical_review_administrative_decision d
     WHERE d.obligation_id = p_obligation AND d.medical_recommendation_accepted IS FALSE);

  SELECT count(*) INTO v_temp_extensions
    FROM public.bn_medical_review_obligation o2
    JOIN public.bn_medical_review_assessment a2 ON a2.obligation_id = o2.id
   WHERE o2.bn_award_id = ob.bn_award_id
     AND a2.status IN ('VALIDATED','LOCKED')
     AND a2.medical_outcome IN ('TEMPORARY_INCAPACITY','INCAPACITY_CONTINUES');

  RETURN jsonb_build_object(
    'employment_injury', COALESCE(ob.employment_injury_case, ob.review_type = 'EMPLOYMENT_INJURY'),
    'review_reason', ob.review_reason,
    'review_type', ob.review_type,
    'medical_outcome', asr.medical_outcome,
    'incapacity_nature', asr.incapacity_nature,
    'impairment_percentage', asr.impairment_percentage,
    'specialist_required', COALESCE(asr.specialist_required, false),
    'further_evidence_required', COALESCE(asr.further_evidence_required, false),
    'provider_unable_to_form_opinion', COALESCE(asr.medical_outcome IN ('UNABLE_TO_ASSESS','INSUFFICIENT_EVIDENCE'), false),
    'second_opinion_recommended', COALESCE(asr.medical_outcome = 'SECOND_OPINION_RECOMMENDED', false),
    'second_opinion_requested', v_second_requested,
    'second_opinion_received', v_second_received,
    'second_opinion_validated', v_second_validated,
    'conflicting_opinions', COALESCE(v_conflicting, false),
    'temporary_extension_count', COALESCE(v_temp_extensions, 0),
    'duration_days', (v_today - ob.review_period_start),
    'officer_departure', v_departure,
    'high_risk', ob.risk_classification IN ('HIGH_RISK','EXCEPTIONAL'),
    'manual_referral', ob.manual_board_referral_requested,
    'timezone_code', v_tz,
    'as_of', v_today);
END $$;

-- 1.4 corrected trigger evaluation
CREATE OR REPLACE FUNCTION public._bn_mr_trigger_matches(
  p_rule_code text, p_condition jsonb, p_ctx jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_outcome text := p_ctx ->> 'medical_outcome';
BEGIN
  RETURN CASE
    WHEN p_rule_code = 'EMPLOYMENT_INJURY_CASE' THEN
      COALESCE((p_ctx ->> 'employment_injury')::boolean, false)
    WHEN p_rule_code = 'PERMANENT_IMPAIRMENT' THEN
      v_outcome = 'PERMANENT_INCAPACITY' OR (p_ctx ->> 'incapacity_nature') = 'PERMANENT'
    WHEN p_rule_code = 'IMPAIRMENT_PERCENTAGE_REQUIRED' THEN
      v_outcome = 'IMPAIRMENT_PERCENTAGE_RECORDED'
      OR ((p_ctx ->> 'impairment_percentage') IS NOT NULL
          AND (p_ctx ->> 'impairment_percentage')::numeric
              >= COALESCE((p_condition ->> 'min_percentage')::numeric, 0))
    WHEN p_rule_code = 'PERMANENT_INCAPACITY' THEN v_outcome = 'PERMANENT_INCAPACITY'
    WHEN p_rule_code = 'BENEFIT_DISCONTINUATION_RECOMMENDED' THEN
      v_outcome IN ('FIT_FOR_WORK','FIT_WITH_RESTRICTIONS','BENEFIT_NO_LONGER_MEDICALLY_SUPPORTED')
    WHEN p_rule_code = 'CONFLICTING_MEDICAL_OPINIONS' THEN
      COALESCE((p_ctx ->> 'conflicting_opinions')::boolean, false)
    WHEN p_rule_code = 'REPEATED_TEMPORARY_EXTENSIONS' THEN
      COALESCE((p_ctx ->> 'temporary_extension_count')::int, 0)
        >= COALESCE((p_condition ->> 'max_extensions')::int, 3)
    WHEN p_rule_code IN ('LONG_DURATION_INCAPACITY','POLICY_DURATION_THRESHOLD') THEN
      COALESCE((p_ctx ->> 'duration_days')::int, 0)
        >= COALESCE((p_condition ->> 'threshold_days')::int, 365)
    WHEN p_rule_code = 'PROVIDER_UNABLE_TO_FORM_OPINION' THEN
      COALESCE((p_ctx ->> 'provider_unable_to_form_opinion')::boolean, false)
    WHEN p_rule_code = 'SECOND_OPINION_RECOMMENDED' THEN
      COALESCE((p_ctx ->> 'second_opinion_recommended')::boolean, false)
    WHEN p_rule_code = 'SECOND_OPINION_REQUESTED' THEN
      COALESCE((p_ctx ->> 'second_opinion_requested')::boolean, false)
    WHEN p_rule_code = 'SECOND_OPINION_RECEIVED' THEN
      COALESCE((p_ctx ->> 'second_opinion_received')::boolean, false)
    WHEN p_rule_code = 'SECOND_OPINION_VALIDATED' THEN
      COALESCE((p_ctx ->> 'second_opinion_validated')::boolean, false)
    WHEN p_rule_code = 'OFFICER_DEPARTS_FROM_MEDICAL_RECOMMENDATION' THEN
      COALESCE((p_ctx ->> 'officer_departure')::boolean, false)
    WHEN p_rule_code = 'EXCEPTIONAL_OR_HIGH_RISK_CASE' THEN
      COALESCE((p_ctx ->> 'high_risk')::boolean, false)
    WHEN p_rule_code = 'MANUAL_REFERRAL_BY_AUTHORISED_OFFICER' THEN
      COALESCE((p_ctx ->> 'manual_referral')::boolean, false)
    WHEN p_rule_code = 'POLICY_PRODUCT_CONDITION' THEN
      ((p_condition ->> 'review_reason') IS NULL
        OR (p_condition ->> 'review_reason') = (p_ctx ->> 'review_reason'))
      AND ((p_condition ->> 'review_type') IS NULL
        OR (p_condition ->> 'review_type') = (p_ctx ->> 'review_type'))
    ELSE false
  END;
END $$;

-- ---------------------------------------------------------------------
-- 1.2 / 1.3 / 1.5 Board requirement resolver, snapshot-driven
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_medical_review_board_requirement_v1(p_obligation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  ob record; snap jsonb; rule jsonb;
  v_ctx jsonb; v_mode text; v_model text; v_tz text; v_today date;
  v_board jsonb; v_quorum integer; v_offset integer;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');

  snap    := COALESCE(ob.policy_snapshot, '{}'::jsonb);
  v_mode  := COALESCE(snap ->> 'board_mode', 'NONE');
  v_model := COALESCE(snap ->> 'assessment_model', 'EXTERNAL_APPROVED_PROVIDER');
  v_tz    := COALESCE(snap ->> 'timezone_code', 'UTC');
  v_today := public._bn_mr_today(v_tz);
  v_board := snap -> 'board';
  v_offset := COALESCE((snap ->> 'report_deadline_days')::int, 30);
  v_quorum := COALESCE((v_board ->> 'minimum_quorum')::int, 1);

  -- Board-direct is an assessment model, never a board mode.
  IF v_model = 'MEDICAL_BOARD_DIRECT'
     OR v_mode IN ('ALWAYS_REQUIRED','FINAL_MEDICAL_AUTHORITY') THEN
    RETURN jsonb_build_object(
      'board_required', true, 'board_mode', v_mode, 'assessment_model', v_model,
      'reason', CASE WHEN v_model = 'MEDICAL_BOARD_DIRECT' THEN 'ASSESSMENT_MODEL_BOARD_DIRECT'
                     ELSE 'POLICY_BOARD_MODE_' || v_mode END,
      'trigger_rule_code', NULL, 'trigger_rule_id', NULL,
      'board', v_board,
      'board_type', COALESCE(v_board ->> 'review_mode', 'UNCONFIGURED'),
      'required_specialties', COALESCE(snap -> 'required_specialties', '[]'::jsonb),
      'required_quorum', v_quorum,
      'determination_binding', COALESCE((snap ->> 'board_determination_binding')::boolean, false),
      'required_completion_date',
        public._bn_mr_add_days(v_today, v_offset, COALESCE((snap ->> 'business_days_only')::boolean, false)),
      'evaluated_from', 'POLICY_SNAPSHOT', 'as_of', v_today);
  END IF;

  IF v_mode = 'NONE' THEN
    RETURN jsonb_build_object('board_required', false, 'board_mode', v_mode,
                              'assessment_model', v_model, 'reason', 'POLICY_BOARD_MODE_NONE',
                              'evaluated_from', 'POLICY_SNAPSHOT', 'as_of', v_today);
  END IF;

  v_ctx := public._bn_mr_build_facts(p_obligation_id);

  FOR rule IN
    SELECT r FROM jsonb_array_elements(COALESCE(snap -> 'board_trigger_rules', '[]'::jsonb)) AS t(r)
     ORDER BY COALESCE((t.r ->> 'evaluation_order')::int, 999), (t.r ->> 'rule_code')
  LOOP
    IF public._bn_mr_trigger_matches(rule ->> 'rule_code', COALESCE(rule -> 'condition', '{}'::jsonb), v_ctx) THEN
      RETURN jsonb_build_object(
        'board_required', true, 'board_mode', v_mode, 'assessment_model', v_model,
        'reason', 'TRIGGER_RULE_MATCHED',
        'trigger_rule_code', rule ->> 'rule_code',
        'trigger_rule_id', (rule ->> 'rule_id')::uuid,
        'board', v_board,
        'board_type', COALESCE(rule ->> 'board_type', v_board ->> 'review_mode', 'UNCONFIGURED'),
        'required_specialties', COALESCE(rule -> 'required_specialties', '[]'::jsonb),
        'required_quorum', COALESCE((rule ->> 'required_quorum')::int, v_quorum),
        'determination_binding', COALESCE((rule ->> 'determination_binding')::boolean,
                                          (snap ->> 'board_determination_binding')::boolean, false),
        'required_completion_date',
          public._bn_mr_add_days(v_today, COALESCE((rule ->> 'completion_offset_days')::int, v_offset),
                                 COALESCE((snap ->> 'business_days_only')::boolean, false)),
        'evaluated_from', 'POLICY_SNAPSHOT', 'as_of', v_today);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('board_required', false, 'board_mode', v_mode,
                            'assessment_model', v_model, 'reason', 'NO_TRIGGER_MATCHED',
                            'evaluated_from', 'POLICY_SNAPSHOT', 'as_of', v_today);
END $$;

-- Private helpers stay unreachable from browser roles.
DO $revoke$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE '\_bn\_mr\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$revoke$;

REVOKE ALL ON FUNCTION public.bn_medical_review_board_requirement_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_medical_review_board_requirement_v1(uuid) TO authenticated, service_role;
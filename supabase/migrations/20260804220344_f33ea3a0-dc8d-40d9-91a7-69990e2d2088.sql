-- =====================================================================
-- BN Medical Reviews — Phase 1 governance foundation (schema).
--
-- Canonical, multi-dimensional Medical Review model. The legacy object
-- public.bn_medical_review_schedule is deliberately NOT touched: it stays
-- intact, read-only and superseded (see docs/bn/BN_MEDICAL_REVIEWS_
-- CONTROLLED_VERTICAL_SLICE.md, "Legacy schedule treatment").
--
-- Security posture (mirrors Life Certificates):
--   * NO RLS. Tables carry no privileges for anon / authenticated / PUBLIC.
--   * All access is through SECURITY DEFINER RPCs with record-level guards.
--   * service_role owns the tables for scheduler / adapter operations.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Product-level Medical Review governance policy (versioned)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL,
  policy_name text NOT NULL,
  bn_product_id uuid NOT NULL REFERENCES public.bn_product(id),
  bn_product_version_id uuid REFERENCES public.bn_product_version(id),
  review_type text NOT NULL,
  jurisdiction_code text,
  version_no integer NOT NULL DEFAULT 1,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_state IN ('DRAFT','PUBLISHED','EFFECTIVE','SUPERSEDED','RETIRED')),
  effective_from date NOT NULL,
  effective_to date,

  -- Assessment / provider / board models -----------------------------
  assessment_model text NOT NULL CHECK (assessment_model IN (
    'INTERNAL_MEDICAL_OFFICER','EXTERNAL_APPROVED_PROVIDER','CLAIMANT_TREATING_DOCTOR',
    'INDEPENDENT_SPECIALIST','GOVERNMENT_MEDICAL_FACILITY','MEDICAL_BOARD_DIRECT',
    'DOCUMENT_ONLY','HYBRID')),
  provider_selection_model text NOT NULL CHECK (provider_selection_model IN (
    'SOCIAL_SECURITY_ASSIGNS','CLAIMANT_SELECTS_FROM_APPROVED_LIST','AUTOMATIC_ALLOCATION',
    'TREATING_PROVIDER_NOMINATED','BOARD_ASSIGNMENT','NOT_APPLICABLE')),
  board_mode text NOT NULL DEFAULT 'NONE' CHECK (board_mode IN (
    'NONE','ALWAYS_REQUIRED','CONDITIONAL','SECOND_LEVEL_REVIEW',
    'CONFLICT_RESOLUTION','APPEAL_ONLY','FINAL_MEDICAL_AUTHORITY')),
  board_determination_binding boolean NOT NULL DEFAULT false,

  -- Authority / responsibility ---------------------------------------
  final_decision_authority text NOT NULL DEFAULT 'BENEFITS_DECISION_OFFICER'
    CHECK (final_decision_authority IN (
      'BENEFITS_DECISION_OFFICER','BENEFITS_SUPERVISOR','MEDICAL_BOARD','DIRECTOR')),
  appointment_responsibility text NOT NULL DEFAULT 'SOCIAL_SECURITY'
    CHECK (appointment_responsibility IN (
      'SOCIAL_SECURITY','PROVIDER','CLAIMANT','SHARED','NOT_APPLICABLE')),
  provider_fee_responsibility text NOT NULL DEFAULT 'SOCIAL_SECURITY'
    CHECK (provider_fee_responsibility IN (
      'SOCIAL_SECURITY','CLAIMANT','EMPLOYER','SHARED','NOT_APPLICABLE')),

  -- Clinical constraints ----------------------------------------------
  required_specialties text[] NOT NULL DEFAULT '{}',
  treating_doctor_permitted boolean NOT NULL DEFAULT false,
  independent_assessment_required boolean NOT NULL DEFAULT false,
  second_opinion_mode text NOT NULL DEFAULT 'NOT_PERMITTED'
    CHECK (second_opinion_mode IN ('NOT_PERMITTED','PERMITTED','MANDATORY')),
  required_evidence_types text[] NOT NULL DEFAULT '{}',

  -- Timing ---------------------------------------------------------------
  initial_review_offset_days integer NOT NULL DEFAULT 90,
  recurring_interval_months integer,
  notice_period_days integer NOT NULL DEFAULT 21,
  referral_acceptance_deadline_days integer NOT NULL DEFAULT 7,
  report_deadline_days integer NOT NULL DEFAULT 21,
  grace_period_days integer NOT NULL DEFAULT 14,
  max_deferral_days integer NOT NULL DEFAULT 30,
  timezone_code text NOT NULL DEFAULT 'America/St_Kitts',
  business_days_only boolean NOT NULL DEFAULT true,

  -- Outcome handling -----------------------------------------------------
  non_attendance_handling text NOT NULL DEFAULT 'REASONABLE_CAUSE_REVIEW'
    CHECK (non_attendance_handling IN (
      'REASONABLE_CAUSE_REVIEW','AUTOMATIC_RESCHEDULE','MANUAL_INTERVENTION','SUSPENSION_PROPOSAL')),
  next_review_authority text NOT NULL DEFAULT 'BENEFITS_DECISION_OFFICER'
    CHECK (next_review_authority IN (
      'BENEFITS_DECISION_OFFICER','MEDICAL_PROVIDER','MEDICAL_BOARD','POLICY_INTERVAL')),
  suspension_proposal_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  reinstatement_proposal_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,

  notes text,
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT bn_mr_policy_code_version_uq UNIQUE (policy_code, version_no),
  CONSTRAINT bn_mr_policy_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_bn_mr_policy_product
  ON public.bn_medical_review_policy (bn_product_id, review_type, lifecycle_state);

-- ---------------------------------------------------------------------
-- 2. Medical Board trigger rules (attached to a policy version)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_board_trigger_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.bn_medical_review_policy(id) ON DELETE CASCADE,
  rule_code text NOT NULL CHECK (rule_code IN (
    'EMPLOYMENT_INJURY_CASE','PERMANENT_IMPAIRMENT','IMPAIRMENT_PERCENTAGE_REQUIRED',
    'PERMANENT_INCAPACITY','BENEFIT_DISCONTINUATION_RECOMMENDED','CONFLICTING_MEDICAL_OPINIONS',
    'REPEATED_TEMPORARY_EXTENSIONS','LONG_DURATION_INCAPACITY','PROVIDER_UNABLE_TO_FORM_OPINION',
    'SECOND_OPINION_RECEIVED','OFFICER_DEPARTS_FROM_MEDICAL_RECOMMENDATION',
    'EXCEPTIONAL_OR_HIGH_RISK_CASE','MANUAL_REFERRAL_BY_AUTHORISED_OFFICER',
    'POLICY_DURATION_THRESHOLD','POLICY_PRODUCT_CONDITION')),
  rule_name text NOT NULL,
  evaluation_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  -- Deterministic, declarative condition. Interpreted only by the
  -- server-side resolver; never evaluated in the browser.
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  board_type text NOT NULL DEFAULT 'STANDARD',
  required_specialties text[] NOT NULL DEFAULT '{}',
  required_quorum integer NOT NULL DEFAULT 3 CHECK (required_quorum >= 1),
  determination_binding boolean NOT NULL DEFAULT false,
  completion_offset_days integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_mr_board_rule_uq UNIQUE (policy_id, rule_code)
);

-- ---------------------------------------------------------------------
-- 3. Individual provider registry (internal + external doctors)
--    bn_medical_facility remains the facility dimension and is referenced.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_provider (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL UNIQUE,
  classification text NOT NULL CHECK (classification IN ('INTERNAL','EXTERNAL')),
  provider_type text NOT NULL CHECK (provider_type IN (
    'INTERNAL_SOCIAL_SECURITY_DOCTOR','EXTERNAL_INDIVIDUAL_DOCTOR','TREATING_DOCTOR',
    'INDEPENDENT_SPECIALIST','GOVERNMENT_MEDICAL_PRACTITIONER','CLINIC','HOSPITAL',
    'DIAGNOSTIC_PROVIDER','MEDICAL_BOARD_MEMBER')),
  practitioner_name text NOT NULL,
  registration_number text,
  licensing_authority text,
  licence_issue_date date,
  licence_expiry_date date,
  specialties text[] NOT NULL DEFAULT '{}',
  facility_id uuid REFERENCES public.bn_medical_facility(id),
  service_locations text[] NOT NULL DEFAULT '{}',
  provider_status text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (provider_status IN (
    'PENDING_VERIFICATION','ACTIVE','INACTIVE','SUSPENDED','EXPIRED','TERMINATED')),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  portal_user_id uuid,
  contract_status text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (contract_status IN (
    'NOT_APPLICABLE','PANEL_MEMBER','CONTRACTED','PROVISIONAL','LAPSED')),
  fee_arrangement text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (fee_arrangement IN (
    'NOT_APPLICABLE','SALARIED_INTERNAL','PER_ASSESSMENT_FEE','SCHEDULE_OF_FEES','NO_FEE')),
  conflict_restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
    'UNVERIFIED','VERIFIED','REJECTED','EXPIRED')),
  verification_date date,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  row_version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_bn_medical_provider_status
  ON public.bn_medical_provider (provider_status, classification);
CREATE INDEX IF NOT EXISTS idx_bn_medical_provider_portal_user
  ON public.bn_medical_provider (portal_user_id) WHERE portal_user_id IS NOT NULL;

-- Approved products / review types per provider.
CREATE TABLE IF NOT EXISTS public.bn_medical_provider_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.bn_medical_provider(id) ON DELETE CASCADE,
  bn_product_id uuid REFERENCES public.bn_product(id),
  review_type text,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT bn_mp_approval_uq UNIQUE (provider_id, bn_product_id, review_type)
);

-- Credential-verification evidence (DMS references only, never paths).
CREATE TABLE IF NOT EXISTS public.bn_medical_provider_credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.bn_medical_provider(id) ON DELETE CASCADE,
  credential_type text NOT NULL,
  credential_reference text,
  document_id uuid,
  issued_on date,
  expires_on date,
  verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
    'UNVERIFIED','VERIFIED','REJECTED','EXPIRED')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- ---------------------------------------------------------------------
-- 4. Medical Board domain
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_board (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_code text NOT NULL UNIQUE,
  board_name text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  applicable_product_ids uuid[] NOT NULL DEFAULT '{}',
  applicable_review_types text[] NOT NULL DEFAULT '{}',
  required_specialties text[] NOT NULL DEFAULT '{}',
  minimum_quorum integer NOT NULL DEFAULT 3 CHECK (minimum_quorum >= 1),
  chairperson_required boolean NOT NULL DEFAULT true,
  secretary_required boolean NOT NULL DEFAULT true,
  voting_rule text NOT NULL DEFAULT 'MAJORITY' CHECK (voting_rule IN ('MAJORITY','UNANIMOUS')),
  determination_binding boolean NOT NULL DEFAULT false,
  conflict_declaration_required boolean NOT NULL DEFAULT true,
  substitute_members_permitted boolean NOT NULL DEFAULT true,
  review_mode text NOT NULL DEFAULT 'MEETING' CHECK (review_mode IN ('DOCUMENT_ONLY','MEETING')),
  meeting_mode text NOT NULL DEFAULT 'IN_PERSON' CHECK (meeting_mode IN ('IN_PERSON','VIRTUAL','HYBRID')),
  claimant_attendance_required boolean NOT NULL DEFAULT false,
  examining_doctor_may_attend boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_medical_board_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.bn_medical_board(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.bn_medical_provider(id),
  member_user_id uuid,
  member_name text NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('CHAIR','MEMBER','SECRETARY','SUBSTITUTE')),
  specialty text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_bn_board_member_board
  ON public.bn_medical_board_member (board_id, is_active);
CREATE INDEX IF NOT EXISTS idx_bn_board_member_user
  ON public.bn_medical_board_member (member_user_id) WHERE member_user_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. Medical Review obligation (canonical case object)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_obligation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_reference text NOT NULL UNIQUE,
  bn_claim_id uuid REFERENCES public.bn_claim(id),
  bn_award_id uuid NOT NULL REFERENCES public.bn_award(id),
  bn_product_id uuid REFERENCES public.bn_product(id),
  bn_product_version_id uuid REFERENCES public.bn_product_version(id),
  policy_id uuid NOT NULL REFERENCES public.bn_medical_review_policy(id),
  policy_version_no integer NOT NULL,
  -- Immutable policy snapshot: later amendments must not change this row.
  policy_snapshot jsonb NOT NULL,
  review_type text NOT NULL,
  review_reason text NOT NULL DEFAULT 'PERIODIC',
  review_period_start date NOT NULL,
  review_period_end date NOT NULL,
  status text NOT NULL DEFAULT 'NOT_DUE' CHECK (status IN (
    'NOT_DUE','NOTICE_READY','NOTICE_SENT','DUE','IN_PROGRESS','AWAITING_PROVIDER',
    'AWAITING_REPORT','AWAITING_BOARD','AWAITING_ADMINISTRATIVE_DECISION','COMPLETED',
    'DEFERRED','OVERDUE','MANUAL_INTERVENTION','CLOSED')),
  notice_due_date date,
  due_date date NOT NULL,
  grace_end_date date,
  deferred_until date,
  assigned_to text,
  workbasket_id uuid,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  row_version integer NOT NULL DEFAULT 1,
  communication_status text NOT NULL DEFAULT 'NONE',
  generated_by_command text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT bn_mr_obligation_natural_uq
    UNIQUE (bn_award_id, review_period_start, review_period_end, review_type, policy_id),
  CONSTRAINT bn_mr_obligation_period CHECK (review_period_end >= review_period_start)
);

CREATE INDEX IF NOT EXISTS idx_bn_mr_obligation_award
  ON public.bn_medical_review_obligation (bn_award_id, status);
CREATE INDEX IF NOT EXISTS idx_bn_mr_obligation_due
  ON public.bn_medical_review_obligation (due_date, status);

-- ---------------------------------------------------------------------
-- 6. Referral
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_referral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  referral_reference text NOT NULL UNIQUE,
  provider_id uuid REFERENCES public.bn_medical_provider(id),
  -- Historical snapshot: referrals must survive provider registry changes.
  provider_snapshot jsonb,
  bn_claim_id uuid,
  bn_award_id uuid NOT NULL,
  claimant_person_id uuid,
  referring_officer uuid,
  review_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_release_scope text NOT NULL DEFAULT 'FUNCTIONAL_SUMMARY_ONLY' CHECK (
    evidence_release_scope IN ('NONE','FUNCTIONAL_SUMMARY_ONLY','CASE_EVIDENCE','FULL_CLINICAL')),
  appointment_responsibility text NOT NULL DEFAULT 'SOCIAL_SECURITY',
  acceptance_deadline date,
  report_deadline date,
  consent_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (
    consent_status IN ('NOT_REQUIRED','PENDING','GRANTED','REFUSED')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','PROVIDER_SELECTION_REQUIRED','PROVIDER_ASSIGNED','ISSUED','ACCEPTED','DECLINED',
    'EXPIRED','REASSIGNMENT_REQUIRED','ASSESSMENT_IN_PROGRESS','REPORT_SUBMITTED',
    'COMPLETED','CANCELLED')),
  decline_reason text,
  issued_at timestamptz,
  responded_at timestamptz,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS idx_bn_mr_referral_provider
  ON public.bn_medical_review_referral (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_bn_mr_referral_obligation
  ON public.bn_medical_review_referral (obligation_id);

-- ---------------------------------------------------------------------
-- 7. Appointment
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.bn_medical_review_referral(id) ON DELETE CASCADE,
  obligation_id uuid NOT NULL REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  responsibility text NOT NULL DEFAULT 'SOCIAL_SECURITY' CHECK (responsibility IN (
    'SOCIAL_SECURITY','PROVIDER','CLAIMANT','SHARED','NOT_APPLICABLE')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'NOT_REQUIRED','PENDING','SCHEDULED','RESCHEDULED','ATTENDED','CLAIMANT_NO_SHOW',
    'PROVIDER_CANCELLED','CANCELLED')),
  scheduled_at timestamptz,
  location_reference text,
  sequence_no integer NOT NULL DEFAULT 1,
  reschedule_count integer NOT NULL DEFAULT 0,
  non_attendance_category text CHECK (non_attendance_category IS NULL OR non_attendance_category IN (
    'CLAIMANT_NO_SHOW','PROVIDER_CANCELLATION','FAILED_NOTICE_DELIVERY',
    'REASONABLE_RESCHEDULING_REQUEST','MEDICAL_EMERGENCY','TRAVEL_OR_ACCESSIBILITY',
    'ADMINISTRATIVE_SCHEDULING_ERROR')),
  non_attendance_notes text,
  reasonable_cause_reviewed boolean NOT NULL DEFAULT false,
  reasonable_cause_outcome text,
  recorded_by uuid,
  recorded_at timestamptz,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bn_mr_appointment_referral
  ON public.bn_medical_review_appointment (referral_id, sequence_no);

-- ---------------------------------------------------------------------
-- 8. Structured medical assessment (clinical authority only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.bn_medical_review_referral(id) ON DELETE CASCADE,
  obligation_id uuid NOT NULL REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.bn_medical_provider(id),
  facility_id uuid REFERENCES public.bn_medical_facility(id),
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN (
    'NOT_STARTED','DRAFT','SUBMITTED','CLARIFICATION_REQUIRED','ADDENDUM_REQUIRED',
    'VALIDATED','REJECTED_INCOMPLETE','LOCKED')),
  submission_channel text CHECK (submission_channel IS NULL OR submission_channel IN (
    'INTERNAL_DOCTOR_WORKSPACE','EXTERNAL_PROVIDER_PORTAL','SECURE_ONE_TIME_TOKEN',
    'STAFF_ASSISTED_UPLOAD','APPROVED_PROVIDER_API')),
  examination_date date,
  identity_verification_method text,
  attendance_result text,
  medical_outcome text CHECK (medical_outcome IS NULL OR medical_outcome IN (
    'INCAPACITY_CONTINUES','TEMPORARY_INCAPACITY','PERMANENT_INCAPACITY','FIT_FOR_WORK',
    'FIT_WITH_RESTRICTIONS','IMPAIRMENT_PERCENTAGE_RECORDED','INSUFFICIENT_EVIDENCE',
    'SPECIALIST_REVIEW_REQUIRED','SECOND_OPINION_RECOMMENDED','UNABLE_TO_ASSESS',
    'CLAIMANT_DID_NOT_ATTEND')),
  -- Controlled functional conclusion: visible to ordinary Benefits users.
  functional_conclusion text,
  functional_limitations jsonb NOT NULL DEFAULT '{}'::jsonb,
  work_capacity_opinion text,
  expected_duration_months integer,
  incapacity_nature text CHECK (incapacity_nature IS NULL OR incapacity_nature IN ('TEMPORARY','PERMANENT','INDETERMINATE')),
  prognosis_category text,
  impairment_percentage numeric(5,2) CHECK (impairment_percentage IS NULL OR (impairment_percentage >= 0 AND impairment_percentage <= 100)),
  specialist_required boolean NOT NULL DEFAULT false,
  further_evidence_required boolean NOT NULL DEFAULT false,
  recommended_next_review_date date,
  -- Confidential clinical content: gated by view_confidential_medical_evidence.
  clinical_narrative text,
  evidence_reviewed jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflict_declared boolean NOT NULL DEFAULT false,
  conflict_details text,
  provider_declaration_complete boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  submitted_by uuid,
  locked_at timestamptz,
  validated_at timestamptz,
  validated_by uuid,
  rejection_reason text,
  receipt_revision integer NOT NULL DEFAULT 0,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_mr_assessment_referral_uq UNIQUE (referral_id)
);

-- Versioned addenda: the original submission is never replaced.
CREATE TABLE IF NOT EXISTS public.bn_medical_review_assessment_addendum (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_medical_review_assessment(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  addendum_type text NOT NULL CHECK (addendum_type IN ('CLARIFICATION','ADDENDUM','CORRECTION')),
  requested_by uuid,
  requested_at timestamptz,
  request_reason text,
  -- Immutable snapshot of the assessment as it stood before this addendum.
  prior_snapshot jsonb NOT NULL,
  addendum_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by uuid,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_mr_addendum_uq UNIQUE (assessment_id, revision_no)
);

-- Staff-assisted report receipt (a bare email attachment is not evidence).
CREATE TABLE IF NOT EXISTS public.bn_medical_review_submission_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_medical_review_assessment(id) ON DELETE CASCADE,
  receiving_officer uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  submission_method text NOT NULL CHECK (submission_method IN (
    'SIGNED_PHYSICAL_REPORT','SCANNED_REPORT','IN_PERSON_HANDOVER','POSTAL','COURIER')),
  provider_id uuid REFERENCES public.bn_medical_provider(id),
  provider_verification_method text NOT NULL,
  signed_report_document_id uuid,
  structured_fields_transcribed boolean NOT NULL DEFAULT false,
  transcribing_officer uuid,
  portal_not_used_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 9. Evidence links (DMS boundary; no browser-visible storage paths)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_evidence_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  referral_id uuid REFERENCES public.bn_medical_review_referral(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES public.bn_medical_review_assessment(id) ON DELETE CASCADE,
  board_case_id uuid,
  document_id uuid,
  evidence_class text NOT NULL CHECK (evidence_class IN (
    'ADMINISTRATIVE','FUNCTIONAL_CONCLUSION','CLINICAL_REPORT','CONFIDENTIAL_MEDICAL')),
  evidence_type text NOT NULL,
  document_title text,
  released_to_board boolean NOT NULL DEFAULT false,
  released_to_provider boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_bn_mr_evidence_obligation
  ON public.bn_medical_review_evidence_link (obligation_id, evidence_class);

-- Every read of confidential medical evidence is audited.
CREATE TABLE IF NOT EXISTS public.bn_medical_review_evidence_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_link_id uuid REFERENCES public.bn_medical_review_evidence_link(id) ON DELETE SET NULL,
  obligation_id uuid,
  assessment_id uuid,
  actor_user_id uuid NOT NULL,
  access_kind text NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid
);

-- ---------------------------------------------------------------------
-- 10. Board case / session / participation / determination
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_board_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_reference text NOT NULL UNIQUE,
  board_id uuid NOT NULL REFERENCES public.bn_medical_board(id),
  obligation_id uuid NOT NULL REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES public.bn_medical_review_assessment(id),
  bn_award_id uuid NOT NULL,
  trigger_rule_id uuid REFERENCES public.bn_medical_review_board_trigger_rule(id),
  -- Snapshot of the rule that caused the referral.
  trigger_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  board_type text NOT NULL DEFAULT 'STANDARD',
  required_specialties text[] NOT NULL DEFAULT '{}',
  required_quorum integer NOT NULL DEFAULT 3,
  determination_binding boolean NOT NULL DEFAULT false,
  required_completion_date date,
  status text NOT NULL DEFAULT 'REFERRED' CHECK (status IN (
    'REFERRED','SCHEDULED','MEMBERS_ASSIGNED','EVIDENCE_REQUESTED','IN_SESSION',
    'DETERMINED','DEFERRED','CANCELLED')),
  referred_by uuid,
  referred_at timestamptz NOT NULL DEFAULT now(),
  deferred_until date,
  deferral_reason text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bn_board_case_obligation
  ON public.bn_medical_board_case (obligation_id, status);

CREATE TABLE IF NOT EXISTS public.bn_medical_board_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_case_id uuid NOT NULL REFERENCES public.bn_medical_board_case(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.bn_medical_board(id),
  session_reference text NOT NULL UNIQUE,
  scheduled_at timestamptz NOT NULL,
  meeting_mode text NOT NULL DEFAULT 'IN_PERSON',
  location_reference text,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN (
    'SCHEDULED','HELD','ADJOURNED','CANCELLED')),
  quorum_met boolean,
  scheduled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_medical_board_case_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_case_id uuid NOT NULL REFERENCES public.bn_medical_board_case(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.bn_medical_board_session(id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.bn_medical_board_member(id),
  member_user_id uuid,
  member_role text NOT NULL,
  member_specialty text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid,
  conflict_declared boolean NOT NULL DEFAULT false,
  conflict_details text,
  recused boolean NOT NULL DEFAULT false,
  participated boolean NOT NULL DEFAULT false,
  participation_recorded_at timestamptz,
  vote text CHECK (vote IS NULL OR vote IN ('FOR','AGAINST','ABSTAIN')),
  vote_outcome_code text,
  vote_reason text,
  voted_at timestamptz,
  CONSTRAINT bn_board_participant_uq UNIQUE (board_case_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_bn_board_participant_user
  ON public.bn_medical_board_case_participant (member_user_id);

CREATE TABLE IF NOT EXISTS public.bn_medical_board_determination (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_case_id uuid NOT NULL REFERENCES public.bn_medical_board_case(id) ON DELETE CASCADE,
  revision_no integer NOT NULL DEFAULT 1,
  outcome_code text NOT NULL CHECK (outcome_code IN (
    'MEDICAL_OPINION_ACCEPTED','MEDICAL_OPINION_NOT_ACCEPTED','FURTHER_EVIDENCE_REQUIRED',
    'SPECIALIST_ASSESSMENT_REQUIRED','SECOND_OPINION_REQUIRED','TEMPORARY_INCAPACITY_CONFIRMED',
    'PERMANENT_INCAPACITY_CONFIRMED','IMPAIRMENT_PERCENTAGE_DETERMINED','REVIEW_DEFERRED',
    'CONFLICTING_EVIDENCE_UNRESOLVED','NEXT_REVIEW_RECOMMENDED')),
  impairment_percentage numeric(5,2),
  determination_summary text NOT NULL,
  is_binding boolean NOT NULL DEFAULT false,
  quorum_at_determination integer NOT NULL,
  votes_for integer NOT NULL DEFAULT 0,
  votes_against integer NOT NULL DEFAULT 0,
  votes_abstain integer NOT NULL DEFAULT 0,
  decided_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  finalised boolean NOT NULL DEFAULT true,
  superseded_by uuid REFERENCES public.bn_medical_board_determination(id),
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_board_determination_uq UNIQUE (board_case_id, revision_no)
);

-- ---------------------------------------------------------------------
-- 11. Administrative Benefits decision (separate authority)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_administrative_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  decision_reference text NOT NULL UNIQUE,
  assessment_id uuid REFERENCES public.bn_medical_review_assessment(id),
  board_case_id uuid REFERENCES public.bn_medical_board_case(id),
  board_determination_id uuid REFERENCES public.bn_medical_board_determination(id),
  status text NOT NULL DEFAULT 'NOT_READY' CHECK (status IN (
    'NOT_READY','READY','PENDING_APPROVAL','APPROVED','RETURNED','COMPLETED')),
  outcome_code text CHECK (outcome_code IS NULL OR outcome_code IN (
    'BENEFIT_CONTINUES','BENEFIT_CONTINUES_UNTIL_DATE','TEMPORARY_CONTINUATION',
    'PERMANENT_CONTINUATION','NEXT_REVIEW_REQUIRED','MORE_MEDICAL_EVIDENCE_REQUIRED',
    'SECOND_OPINION_REQUIRED','MEDICAL_BOARD_REQUIRED','NON_COMPLIANCE_REVIEW',
    'BENEFIT_NO_LONGER_MEDICALLY_SUPPORTED','SUSPENSION_PROPOSAL_REQUIRED',
    'REINSTATEMENT_PROPOSAL_REQUIRED','ADMINISTRATIVE_CLOSURE')),
  provider_medical_opinion text,
  board_determination_outcome text,
  medical_recommendation_accepted boolean,
  departure_reason text,
  decision_authority text NOT NULL DEFAULT 'BENEFITS_DECISION_OFFICER',
  made_by uuid,
  made_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  returned_reason text,
  effective_date date,
  next_review_date date,
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_code text,
  reason_narrative text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_mr_decision_departure_reason CHECK (
    medical_recommendation_accepted IS DISTINCT FROM false
    OR (departure_reason IS NOT NULL AND length(btrim(departure_reason)) > 0))
);

-- ---------------------------------------------------------------------
-- 12. Award Suspension proposal link (proposal-only boundary)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_suspension_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.bn_medical_review_administrative_decision(id),
  proposal_kind text NOT NULL CHECK (proposal_kind IN ('SUSPENSION','REINSTATEMENT')),
  suspension_event_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  proposed_by uuid,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  proposal_status text NOT NULL DEFAULT 'PROPOSED',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 13. Event log, communication intents, scheduler attempts, idempotency
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_medical_review_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  event_code text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id uuid,
  actor_category text,
  -- Never carries diagnosis or clinical narrative.
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bn_mr_event_obligation
  ON public.bn_medical_review_event (obligation_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.bn_medical_review_communication_intent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  bn_award_id uuid,
  event_code text NOT NULL,
  recipient_reference text,
  recipient_category text NOT NULL DEFAULT 'CLAIMANT',
  -- Operational context only. Clinical findings are forbidden here.
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid,
  delivery_status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_medical_review_scheduler_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid REFERENCES public.bn_medical_review_obligation(id) ON DELETE CASCADE,
  attempt_kind text NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  outcome text NOT NULL,
  error_code text,
  error_detail text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_medical_review_idempotency (
  idempotency_key text PRIMARY KEY,
  command_code text NOT NULL,
  request_fingerprint text NOT NULL,
  response jsonb NOT NULL,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 14. Privilege posture — no browser role may touch these tables.
-- ---------------------------------------------------------------------
DO $grants$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (c.relname LIKE 'bn_medical_review_%' OR c.relname LIKE 'bn_medical_board%'
            OR c.relname LIKE 'bn_medical_provider%')
       AND c.relname <> 'bn_medical_review_schedule'   -- legacy: untouched
       AND c.relname <> 'bn_medical_provider_type'     -- existing lookup: untouched
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$grants$;
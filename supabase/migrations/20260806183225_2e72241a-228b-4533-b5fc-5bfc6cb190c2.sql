-- =====================================================================
-- BN Means-Test Assessments — MT1 domain foundation, MT2 command &
-- query boundary, MT3 intake slice.
-- Project rule: no RLS (docs/ARCHITECTURE-NO-RLS-RULE.md).
-- Mutations are SECURITY DEFINER RPC-only; browser roles get SELECT only.
-- Module stays dark-launched (actions_enabled = false).
-- =====================================================================

-- ---------- 0. Module actions (granular verbs) ----------
INSERT INTO public.module_actions (module_id, action_name, display_name, is_enabled)
SELECT m.id, a.action_name, a.display_name, true
  FROM public.app_modules m
  CROSS JOIN (VALUES
      ('verify','Verify Information'),
      ('adjust_request','Request Adjustment'),
      ('adjust_approve','Approve Adjustment'),
      ('approve','Approve Assessment'),
      ('reassess','Schedule Reassessment'),
      ('config','Configure Means Policy')) AS a(action_name, display_name)
 WHERE m.name = 'bn_means_tests'
   AND NOT EXISTS (
     SELECT 1 FROM public.module_actions x
      WHERE x.module_id = m.id AND x.action_name = a.action_name);

-- ---------- 1. Policy configuration ----------
CREATE TABLE IF NOT EXISTS public.bn_means_policy (
  policy_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code     text NOT NULL UNIQUE,
  policy_name     text NOT NULL,
  benefit_programme text NOT NULL,
  authority_reference text,
  status          text NOT NULL DEFAULT 'DRAFT',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_policy_status_ck CHECK (status IN ('DRAFT','ACTIVE','RETIRED'))
);

CREATE TABLE IF NOT EXISTS public.bn_means_policy_version (
  policy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       uuid NOT NULL REFERENCES public.bn_means_policy(policy_id) ON DELETE RESTRICT,
  version_label   text NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  currency_code   text NOT NULL,
  household_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  threshold_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  rounding_method text NOT NULL DEFAULT 'HALF_UP',
  rounding_scale  int  NOT NULL DEFAULT 2,
  validity_months int,
  reassessment_months int,
  required_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'DRAFT',
  authority_reference text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_policy_version_status_ck CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED','RETIRED')),
  CONSTRAINT bn_means_policy_version_rounding_ck CHECK (rounding_method IN ('HALF_UP','HALF_EVEN','DOWN','UP')),
  CONSTRAINT bn_means_policy_version_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT bn_means_policy_version_unique UNIQUE (policy_id, version_label)
);
CREATE INDEX IF NOT EXISTS ix_bn_means_policy_version_eff
  ON public.bn_means_policy_version(policy_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS public.bn_means_policy_category (
  category_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES public.bn_means_policy_version(policy_version_id) ON DELETE RESTRICT,
  category_kind   text NOT NULL,
  category_code   text NOT NULL,
  category_name   text NOT NULL,
  is_assessable   boolean NOT NULL DEFAULT true,
  disregard_rule  jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_evidence boolean NOT NULL DEFAULT false,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_policy_category_kind_ck CHECK (category_kind IN ('INCOME','ASSET','DEDUCTION')),
  CONSTRAINT bn_means_policy_category_unique UNIQUE (policy_version_id, category_kind, category_code)
);

-- ---------- 2. Assessment header + frozen versions ----------
CREATE TABLE IF NOT EXISTS public.bn_means_assessment (
  assessment_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_reference text NOT NULL UNIQUE
                        DEFAULT ('MT-' || to_char(now(),'YYYY') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  person_id         bigint,
  declared_person   jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_id          uuid,
  award_id          uuid,
  benefit_programme text NOT NULL,
  assessment_reason text NOT NULL,
  effective_from    date NOT NULL,
  effective_to      date,
  policy_version_id uuid REFERENCES public.bn_means_policy_version(policy_version_id),
  currency_code     text NOT NULL,
  status            text NOT NULL DEFAULT 'DRAFT',
  result            text,
  assigned_to       uuid,
  maker_user_id     uuid,
  checker_user_id   uuid,
  submitted_at      timestamptz,
  approved_at       timestamptz,
  activated_at      timestamptz,
  valid_from        date,
  valid_until       date,
  reassessment_due  date,
  superseded_by_assessment_id uuid REFERENCES public.bn_means_assessment(assessment_id),
  supersedes_assessment_id    uuid REFERENCES public.bn_means_assessment(assessment_id),
  current_version   int NOT NULL DEFAULT 1,
  row_version       bigint NOT NULL DEFAULT 1,
  correlation_id    uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT bn_means_assessment_status_ck CHECK (status IN (
    'DRAFT','INFORMATION_PENDING','SUBMITTED','VERIFICATION_PENDING','CALCULATED',
    'REVIEW_PENDING','APPROVAL_PENDING','APPROVED','ACTIVE','EXPIRED',
    'REASSESSMENT_DUE','SUPERSEDED','CLOSED','INCOMPLETE','FAILED_VERIFICATION',
    'REJECTED','CANCELLED','UNDER_APPEAL')),
  CONSTRAINT bn_means_assessment_result_ck CHECK (result IS NULL OR result IN ('PASS','FAIL','REFER','PROVISIONAL')),
  CONSTRAINT bn_means_assessment_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_bn_means_assessment_person ON public.bn_means_assessment(person_id);
CREATE INDEX IF NOT EXISTS ix_bn_means_assessment_status ON public.bn_means_assessment(status);
CREATE INDEX IF NOT EXISTS ix_bn_means_assessment_award  ON public.bn_means_assessment(award_id);
-- One open assessment per subject + programme + effective start.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_means_assessment_open
  ON public.bn_means_assessment(person_id, benefit_programme, effective_from)
  WHERE status IN ('DRAFT','INFORMATION_PENDING','SUBMITTED','VERIFICATION_PENDING',
                   'CALCULATED','REVIEW_PENDING','APPROVAL_PENDING','APPROVED');

CREATE TABLE IF NOT EXISTS public.bn_means_assessment_version (
  assessment_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  version_no      int NOT NULL,
  frozen_reason   text NOT NULL,
  snapshot        jsonb NOT NULL,
  snapshot_hash   text NOT NULL,
  frozen_at       timestamptz NOT NULL DEFAULT now(),
  frozen_by       uuid,
  correlation_id  uuid,
  CONSTRAINT bn_means_assessment_version_unique UNIQUE (assessment_id, version_no)
);

-- ---------- 3. Facts ----------
CREATE TABLE IF NOT EXISTS public.bn_means_household_member (
  member_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  person_id       bigint,
  declared_person jsonb NOT NULL DEFAULT '{}'::jsonb,
  relationship_code text NOT NULL,
  member_from     date NOT NULL,
  member_to       date,
  is_dependant    boolean NOT NULL DEFAULT false,
  dependency_basis text,
  shares_residence boolean NOT NULL DEFAULT true,
  fact_source     text NOT NULL DEFAULT 'DECLARED',
  verification_status text NOT NULL DEFAULT 'DECLARED',
  evidence_status text NOT NULL DEFAULT 'NONE',
  voided_at       timestamptz,
  voided_by       uuid,
  superseded_by_fact_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_means_household_dates_ck CHECK (member_to IS NULL OR member_to >= member_from),
  CONSTRAINT bn_means_household_verif_ck CHECK (verification_status IN ('DECLARED','VERIFIED','REJECTED','CLARIFICATION_REQUIRED'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_household_assessment ON public.bn_means_household_member(assessment_id);

CREATE TABLE IF NOT EXISTS public.bn_means_income_fact (
  income_fact_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  member_id       uuid REFERENCES public.bn_means_household_member(member_id),
  category_code   text NOT NULL,
  income_source   text,
  basis           text NOT NULL DEFAULT 'GROSS',
  declared_amount numeric(18,2) NOT NULL,
  declared_frequency text NOT NULL,
  currency_code   text NOT NULL,
  normalised_annual_amount numeric(18,2) NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  fact_source     text NOT NULL DEFAULT 'DECLARED',
  evidence_status text NOT NULL DEFAULT 'NONE',
  verification_status text NOT NULL DEFAULT 'DECLARED',
  voided_at       timestamptz,
  voided_by       uuid,
  superseded_by_fact_id uuid REFERENCES public.bn_means_income_fact(income_fact_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_means_income_basis_ck CHECK (basis IN ('GROSS','NET')),
  CONSTRAINT bn_means_income_amount_ck CHECK (declared_amount >= 0),
  CONSTRAINT bn_means_income_freq_ck CHECK (declared_frequency IN
    ('WEEKLY','FORTNIGHTLY','FOUR_WEEKLY','SEMI_MONTHLY','MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ONE_OFF')),
  CONSTRAINT bn_means_income_verif_ck CHECK (verification_status IN ('DECLARED','VERIFIED','REJECTED','CLARIFICATION_REQUIRED')),
  CONSTRAINT bn_means_income_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_bn_means_income_assessment ON public.bn_means_income_fact(assessment_id);

CREATE TABLE IF NOT EXISTS public.bn_means_asset_fact (
  asset_fact_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  member_id       uuid REFERENCES public.bn_means_household_member(member_id),
  category_code   text NOT NULL,
  description     text,
  ownership_share numeric(7,4) NOT NULL DEFAULT 1.0000,
  valuation_amount numeric(18,2) NOT NULL,
  currency_code   text NOT NULL,
  valuation_date  date NOT NULL,
  valuation_source text,
  fact_source     text NOT NULL DEFAULT 'DECLARED',
  evidence_status text NOT NULL DEFAULT 'NONE',
  verification_status text NOT NULL DEFAULT 'DECLARED',
  disregard_candidate boolean NOT NULL DEFAULT false,
  voided_at       timestamptz,
  voided_by       uuid,
  superseded_by_fact_id uuid REFERENCES public.bn_means_asset_fact(asset_fact_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_means_asset_share_ck CHECK (ownership_share > 0 AND ownership_share <= 1),
  CONSTRAINT bn_means_asset_amount_ck CHECK (valuation_amount >= 0),
  CONSTRAINT bn_means_asset_verif_ck CHECK (verification_status IN ('DECLARED','VERIFIED','REJECTED','CLARIFICATION_REQUIRED'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_asset_assessment ON public.bn_means_asset_fact(assessment_id);

CREATE TABLE IF NOT EXISTS public.bn_means_deduction_fact (
  deduction_fact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  member_id       uuid REFERENCES public.bn_means_household_member(member_id),
  category_code   text NOT NULL,
  claimed_amount  numeric(18,2) NOT NULL,
  declared_frequency text NOT NULL DEFAULT 'ANNUAL',
  normalised_annual_amount numeric(18,2) NOT NULL,
  currency_code   text NOT NULL,
  claim_basis     text,
  effective_from  date NOT NULL,
  effective_to    date,
  approval_status text NOT NULL DEFAULT 'CLAIMED',
  evidence_status text NOT NULL DEFAULT 'NONE',
  verification_status text NOT NULL DEFAULT 'DECLARED',
  voided_at       timestamptz,
  voided_by       uuid,
  superseded_by_fact_id uuid REFERENCES public.bn_means_deduction_fact(deduction_fact_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_means_deduction_amount_ck CHECK (claimed_amount >= 0),
  CONSTRAINT bn_means_deduction_approval_ck CHECK (approval_status IN ('CLAIMED','APPROVED','REJECTED')),
  CONSTRAINT bn_means_deduction_verif_ck CHECK (verification_status IN ('DECLARED','VERIFIED','REJECTED','CLARIFICATION_REQUIRED')),
  CONSTRAINT bn_means_deduction_freq_ck CHECK (declared_frequency IN
    ('WEEKLY','FORTNIGHTLY','FOUR_WEEKLY','SEMI_MONTHLY','MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ONE_OFF'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_deduction_assessment ON public.bn_means_deduction_fact(assessment_id);

-- ---------- 4. Supporting records ----------
CREATE TABLE IF NOT EXISTS public.bn_means_evidence (
  evidence_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  fact_kind       text,
  fact_id         uuid,
  evidence_type   text NOT NULL,
  dms_document_id text,
  dms_reference   text,
  status          text NOT NULL DEFAULT 'ATTACHED',
  received_at     timestamptz,
  notes           text,
  correlation_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_means_evidence_status_ck CHECK (status IN ('REQUESTED','ATTACHED','RECEIVED','REJECTED')),
  CONSTRAINT bn_means_evidence_kind_ck CHECK (fact_kind IS NULL OR fact_kind IN ('HOUSEHOLD','INCOME','ASSET','DEDUCTION','ASSESSMENT')),
  CONSTRAINT bn_means_evidence_ref_ck CHECK (COALESCE(dms_document_id,'') <> '' OR COALESCE(dms_reference,'') <> '')
);
CREATE INDEX IF NOT EXISTS ix_bn_means_evidence_assessment ON public.bn_means_evidence(assessment_id);

CREATE TABLE IF NOT EXISTS public.bn_means_information_request (
  request_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  request_code    text NOT NULL,
  details         text,
  status          text NOT NULL DEFAULT 'OPEN',
  due_date        date,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  requested_by    uuid,
  responded_at    timestamptz,
  responded_by    uuid,
  correlation_id  uuid,
  CONSTRAINT bn_means_information_request_status_ck CHECK (status IN ('OPEN','RECEIVED','CANCELLED','OVERDUE'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_inforeq_assessment ON public.bn_means_information_request(assessment_id, status);

CREATE TABLE IF NOT EXISTS public.bn_means_verification (
  verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  fact_kind       text NOT NULL,
  fact_id         uuid NOT NULL,
  outcome         text NOT NULL,
  evidence_checked boolean NOT NULL DEFAULT false,
  evidence_id     uuid REFERENCES public.bn_means_evidence(evidence_id),
  reason_code     text,
  notes           text,
  verified_by     uuid,
  verified_at     timestamptz NOT NULL DEFAULT now(),
  correlation_id  uuid,
  CONSTRAINT bn_means_verification_outcome_ck CHECK (outcome IN ('VERIFIED','REJECTED','CLARIFICATION_REQUIRED')),
  CONSTRAINT bn_means_verification_kind_ck CHECK (fact_kind IN ('HOUSEHOLD','INCOME','ASSET','DEDUCTION'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_verification_assessment ON public.bn_means_verification(assessment_id);

CREATE TABLE IF NOT EXISTS public.bn_means_calculation (
  calculation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  assessment_version_id uuid REFERENCES public.bn_means_assessment_version(assessment_version_id),
  policy_version_id uuid REFERENCES public.bn_means_policy_version(policy_version_id),
  calculation_version text NOT NULL DEFAULT 'v1',
  input_snapshot  jsonb NOT NULL,
  input_hash      text NOT NULL,
  currency_code   text NOT NULL,
  rounding_method text NOT NULL,
  assessable_income numeric(18,2) NOT NULL DEFAULT 0,
  assessable_assets numeric(18,2) NOT NULL DEFAULT 0,
  approved_deductions numeric(18,2) NOT NULL DEFAULT 0,
  household_size  int NOT NULL DEFAULT 0,
  threshold_amount numeric(18,2),
  excess_amount   numeric(18,2),
  result          text,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_hash     text,
  calculated_at   timestamptz NOT NULL DEFAULT now(),
  calculated_by   uuid,
  correlation_id  uuid,
  CONSTRAINT bn_means_calculation_result_ck CHECK (result IS NULL OR result IN ('PASS','FAIL','REFER','PROVISIONAL'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_calculation_assessment ON public.bn_means_calculation(assessment_id);

CREATE TABLE IF NOT EXISTS public.bn_means_calculation_line (
  line_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id  uuid NOT NULL REFERENCES public.bn_means_calculation(calculation_id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  line_kind       text NOT NULL,
  fact_kind       text,
  fact_id         uuid,
  category_code   text,
  parameter_id    text,
  included        boolean NOT NULL DEFAULT true,
  exclusion_reason text,
  raw_amount      numeric(18,2),
  normalised_amount numeric(18,2),
  applied_amount  numeric(18,2),
  narrative       text,
  CONSTRAINT bn_means_calculation_line_unique UNIQUE (calculation_id, line_no)
);

CREATE TABLE IF NOT EXISTS public.bn_means_adjustment (
  adjustment_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  fact_kind       text NOT NULL,
  fact_id         uuid,
  field_name      text NOT NULL,
  original_value  jsonb,
  proposed_value  jsonb NOT NULL,
  reason_code     text NOT NULL,
  justification   text NOT NULL,
  evidence_id     uuid REFERENCES public.bn_means_evidence(evidence_id),
  status          text NOT NULL DEFAULT 'REQUESTED',
  requested_by    uuid,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  correlation_id  uuid,
  CONSTRAINT bn_means_adjustment_status_ck CHECK (status IN ('REQUESTED','APPROVED','REJECTED','WITHDRAWN'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_adjustment_assessment ON public.bn_means_adjustment(assessment_id, status);

CREATE TABLE IF NOT EXISTS public.bn_means_approval (
  approval_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  decision        text NOT NULL,
  decision_reason text,
  justification   text,
  calculation_id  uuid REFERENCES public.bn_means_calculation(calculation_id),
  maker_user_id   uuid,
  decided_by      uuid,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  correlation_id  uuid,
  CONSTRAINT bn_means_approval_decision_ck CHECK (decision IN ('APPROVED','REJECTED'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_approval_assessment ON public.bn_means_approval(assessment_id);

CREATE TABLE IF NOT EXISTS public.bn_means_fact_publication (
  publication_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  calculation_id  uuid REFERENCES public.bn_means_calculation(calculation_id),
  fact_bundle     jsonb NOT NULL,
  bundle_hash     text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING',
  refusal_reason  text,
  eligibility_request_id uuid,
  eligibility_result_reference text,
  correlation_id  uuid,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_means_fact_publication_status_ck CHECK (status IN ('PENDING','PUBLISHED','REFUSED','FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_means_fact_publication_bundle
  ON public.bn_means_fact_publication(assessment_id, bundle_hash);

CREATE TABLE IF NOT EXISTS public.bn_means_reassessment_schedule (
  schedule_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  due_date        date NOT NULL,
  reason_code     text,
  status          text NOT NULL DEFAULT 'SCHEDULED',
  successor_assessment_id uuid REFERENCES public.bn_means_assessment(assessment_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  completed_at    timestamptz,
  CONSTRAINT bn_means_reassessment_status_ck CHECK (status IN ('SCHEDULED','DUE','COMPLETED','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS ix_bn_means_reassessment_due ON public.bn_means_reassessment_schedule(due_date, status);

CREATE TABLE IF NOT EXISTS public.bn_means_circumstance_event (
  circumstance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  change_type     text NOT NULL,
  reported_on     date NOT NULL DEFAULT current_date,
  effective_date  date,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  justification   text,
  successor_assessment_id uuid REFERENCES public.bn_means_assessment(assessment_id),
  handoff_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  correlation_id  uuid
);

CREATE TABLE IF NOT EXISTS public.bn_means_communication_intent (
  intent_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  module_code     text NOT NULL DEFAULT 'bn_means_tests',
  event_code      text NOT NULL,
  recipient_ref   jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'PENDING',
  idempotency_key text,
  correlation_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_means_comm_intent_status_ck CHECK (status IN ('PENDING','DISPATCHED','SUPPRESSED','FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_means_comm_intent_idem
  ON public.bn_means_communication_intent(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bn_means_event (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  event_code      text NOT NULL,
  command_name    text,
  from_status     text,
  to_status       text,
  reason_code     text,
  justification   text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id   uuid,
  actor_user_code text,
  correlation_id  uuid,
  row_version     bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bn_means_event_assessment ON public.bn_means_event(assessment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bn_means_command_idempotency (
  idempotency_key uuid NOT NULL,
  command_name    text NOT NULL,
  payload_hash    text NOT NULL DEFAULT '',
  assessment_id   uuid,
  entity_version  bigint,
  result_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'COMPLETED',
  actor_user_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  PRIMARY KEY (idempotency_key, command_name)
);

CREATE TABLE IF NOT EXISTS public.bn_means_command_maker (
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE RESTRICT,
  maker_role      text NOT NULL,
  maker_user_id   uuid NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  correlation_id  uuid,
  PRIMARY KEY (assessment_id, maker_role)
);

-- ---------- 5. Grants: read-only for browser roles ----------
DO $grants$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bn_means_policy','bn_means_policy_version','bn_means_policy_category',
    'bn_means_assessment','bn_means_assessment_version','bn_means_household_member',
    'bn_means_income_fact','bn_means_asset_fact','bn_means_deduction_fact',
    'bn_means_evidence','bn_means_information_request','bn_means_verification',
    'bn_means_calculation','bn_means_calculation_line','bn_means_adjustment',
    'bn_means_approval','bn_means_fact_publication','bn_means_reassessment_schedule',
    'bn_means_circumstance_event','bn_means_communication_intent','bn_means_event',
    'bn_means_command_idempotency','bn_means_command_maker']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$grants$;

-- ---------- 6. Helpers ----------
CREATE OR REPLACE FUNCTION public.bn_means_check_actor_permission(
  p_actor_user_id uuid, p_action_name text, p_is_mutation boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_module public.app_modules%ROWTYPE;
  v_action_id uuid;
  v_action_enabled boolean;
  v_has_grant boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  END IF;
  SELECT * INTO v_module FROM public.app_modules WHERE name = 'bn_means_tests';
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
    SELECT 1
      FROM public.role_permissions rp
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
END;
$$;
REVOKE ALL ON FUNCTION public.bn_means_check_actor_permission(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_check_actor_permission(uuid,text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._bn_means_action_for_command(p_command_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_command_name
    WHEN 'BN_MEANS_VERIFY_INFORMATION'    THEN 'verify'
    WHEN 'BN_MEANS_CALCULATE'             THEN 'decide'
    WHEN 'BN_MEANS_REQUEST_ADJUSTMENT'    THEN 'adjust_request'
    WHEN 'BN_MEANS_APPROVE_ADJUSTMENT'    THEN 'adjust_approve'
    WHEN 'BN_MEANS_APPROVE'               THEN 'approve'
    WHEN 'BN_MEANS_REJECT'                THEN 'approve'
    WHEN 'BN_MEANS_ACTIVATE'              THEN 'approve'
    WHEN 'BN_MEANS_SUPERSEDE'             THEN 'approve'
    WHEN 'BN_MEANS_CLOSE'                 THEN 'approve'
    WHEN 'BN_MEANS_SCHEDULE_REASSESSMENT' THEN 'reassess'
    ELSE 'write'
  END;
$$;

CREATE OR REPLACE FUNCTION public._bn_means_maker_source(p_command_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_command_name
    WHEN 'BN_MEANS_APPROVE'            THEN 'BN_MEANS_SUBMIT'
    WHEN 'BN_MEANS_REJECT'             THEN 'BN_MEANS_SUBMIT'
    WHEN 'BN_MEANS_APPROVE_ADJUSTMENT' THEN 'BN_MEANS_REQUEST_ADJUSTMENT'
    ELSE NULL
  END;
$$;

-- Deterministic frequency normalisation (annualised).
CREATE OR REPLACE FUNCTION public._bn_means_annualise(p_amount numeric, p_frequency text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT round(p_amount * CASE p_frequency
    WHEN 'WEEKLY'        THEN 52
    WHEN 'FORTNIGHTLY'   THEN 26
    WHEN 'FOUR_WEEKLY'   THEN 13
    WHEN 'SEMI_MONTHLY'  THEN 24
    WHEN 'MONTHLY'       THEN 12
    WHEN 'QUARTERLY'     THEN 4
    WHEN 'SEMI_ANNUAL'   THEN 2
    WHEN 'ANNUAL'        THEN 1
    WHEN 'ONE_OFF'       THEN 1
    ELSE 1 END::numeric, 2);
$$;

CREATE OR REPLACE FUNCTION public._bn_means_event(
  p_assessment_id uuid, p_event_code text, p_command_name text,
  p_from_status text, p_to_status text, p_reason_code text,
  p_justification text, p_detail jsonb, p_actor_user_id uuid,
  p_actor_user_code text, p_correlation_id uuid, p_row_version bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.bn_means_event(
    assessment_id, event_code, command_name, from_status, to_status,
    reason_code, justification, detail, actor_user_id, actor_user_code,
    correlation_id, row_version)
  VALUES (p_assessment_id, p_event_code, p_command_name, p_from_status, p_to_status,
          p_reason_code, p_justification, COALESCE(p_detail,'{}'::jsonb),
          p_actor_user_id, p_actor_user_code, p_correlation_id, p_row_version);
$$;
REVOKE ALL ON FUNCTION public._bn_means_event(uuid,text,text,text,text,text,text,jsonb,uuid,text,uuid,bigint) FROM PUBLIC, anon, authenticated;

-- Canonical transition table.
CREATE OR REPLACE FUNCTION public._bn_means_can_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_to = ANY (CASE p_from
    WHEN 'DRAFT'                THEN ARRAY['INFORMATION_PENDING','SUBMITTED','INCOMPLETE','CANCELLED']
    WHEN 'INFORMATION_PENDING'  THEN ARRAY['SUBMITTED','INCOMPLETE','CANCELLED']
    WHEN 'SUBMITTED'            THEN ARRAY['VERIFICATION_PENDING','CALCULATED','INCOMPLETE','CANCELLED']
    WHEN 'VERIFICATION_PENDING' THEN ARRAY['CALCULATED','FAILED_VERIFICATION','INFORMATION_PENDING','CANCELLED']
    WHEN 'CALCULATED'           THEN ARRAY['REVIEW_PENDING','APPROVAL_PENDING','REJECTED','CANCELLED']
    WHEN 'REVIEW_PENDING'       THEN ARRAY['CALCULATED','APPROVAL_PENDING','REJECTED','CANCELLED']
    WHEN 'APPROVAL_PENDING'     THEN ARRAY['APPROVED','REJECTED','REVIEW_PENDING','CANCELLED']
    WHEN 'APPROVED'             THEN ARRAY['ACTIVE','CANCELLED']
    WHEN 'ACTIVE'               THEN ARRAY['REASSESSMENT_DUE','EXPIRED','SUPERSEDED','UNDER_APPEAL','CLOSED']
    WHEN 'REASSESSMENT_DUE'     THEN ARRAY['ACTIVE','EXPIRED','SUPERSEDED','CLOSED']
    WHEN 'EXPIRED'              THEN ARRAY['SUPERSEDED','CLOSED']
    WHEN 'SUPERSEDED'           THEN ARRAY['CLOSED']
    WHEN 'UNDER_APPEAL'         THEN ARRAY['ACTIVE','SUPERSEDED','REJECTED','CLOSED']
    WHEN 'INCOMPLETE'           THEN ARRAY['DRAFT','CANCELLED']
    WHEN 'FAILED_VERIFICATION'  THEN ARRAY['INFORMATION_PENDING','REJECTED','CANCELLED']
    WHEN 'REJECTED'             THEN ARRAY['UNDER_APPEAL','CLOSED']
    ELSE ARRAY[]::text[] END);
$$;

-- Statuses in which intake facts may still be authored.
CREATE OR REPLACE FUNCTION public._bn_means_is_editable(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_status IN ('DRAFT','INFORMATION_PENDING','INCOMPLETE');
$$;

-- ---------- 7. Governed command entry point ----------
CREATE OR REPLACE FUNCTION public.bn_means_execute_command_v1(
  p_command_name text,
  p_assessment_id uuid,
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_perm       jsonb;
  v_action     text;
  v_maker_src  text;
  v_maker_user uuid;
  v_prior      public.bn_means_command_idempotency%ROWTYPE;
  v_a          public.bn_means_assessment%ROWTYPE;
  v_pv         public.bn_means_policy_version%ROWTYPE;
  v_id         uuid := p_assessment_id;
  v_new_id     uuid;
  v_result     jsonb;
  v_from       text;
  v_currency   text;
  v_amount     numeric(18,2);
  v_norm       numeric(18,2);
  v_freq       text;
  v_count      int;
  v_snapshot   jsonb;
  v_version_no int;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name;
  END IF;
  IF public._bn_means_action_for_command(p_command_name) IS NULL THEN
    RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
  END IF;

  -- (a) dark-launch + granular permission gate
  v_action := public._bn_means_action_for_command(p_command_name);
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, v_action, true);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'E_%:%', v_perm->>'code', p_command_name;
  END IF;

  -- (b) idempotent replay / payload-hash mismatch
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

  -- (c) load + lock the aggregate (all commands except creation)
  IF p_command_name <> 'BN_MEANS_CREATE_ASSESSMENT' THEN
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'E_ENTITY_REQUIRED:%', p_command_name;
    END IF;
    SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_NOT_FOUND:%', v_id;
    END IF;
    IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_a.row_version THEN
      RAISE EXCEPTION 'E_STALE_ROW_VERSION:expected=% actual=%', p_expected_row_version, v_a.row_version;
    END IF;
    v_from := v_a.status;
  END IF;

  -- (d) maker-checker + self-approval prohibition
  v_maker_src := public._bn_means_maker_source(p_command_name);
  IF v_maker_src IS NOT NULL AND v_id IS NOT NULL THEN
    SELECT maker_user_id INTO v_maker_user FROM public.bn_means_command_maker
     WHERE assessment_id = v_id AND maker_role = v_maker_src;
    IF v_maker_user IS NULL THEN
      RAISE EXCEPTION 'E_MAKER_CHECKER_REQUIRED:% needs prior %', p_command_name, v_maker_src;
    END IF;
    IF v_maker_user = p_actor_user_id THEN
      RAISE EXCEPTION 'E_SELF_APPROVAL_DENIED:%', p_command_name;
    END IF;
  END IF;

  -- (e) command handlers — MT3 intake slice
  IF p_command_name = 'BN_MEANS_CREATE_ASSESSMENT' THEN
    IF COALESCE(p_payload->>'benefit_programme','') = ''
       OR COALESCE(p_payload->>'assessment_reason','') = ''
       OR COALESCE(p_payload->>'effective_from','') = ''
       OR COALESCE(p_payload->>'currency_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:assessment context';
    END IF;
    IF (p_payload->>'person_id') IS NULL AND COALESCE(p_payload->>'claim_id','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:person or claim required';
    END IF;

    IF (p_payload->>'policy_version_id') IS NOT NULL THEN
      SELECT * INTO v_pv FROM public.bn_means_policy_version
       WHERE policy_version_id = (p_payload->>'policy_version_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'E_POLICY_NOT_FOUND:%', p_payload->>'policy_version_id';
      END IF;
      IF v_pv.status <> 'ACTIVE'
         OR v_pv.effective_from > (p_payload->>'effective_from')::date
         OR (v_pv.effective_to IS NOT NULL AND v_pv.effective_to < (p_payload->>'effective_from')::date) THEN
        RAISE EXCEPTION 'E_POLICY_NOT_EFFECTIVE:%', v_pv.policy_version_id;
      END IF;
      IF v_pv.currency_code <> (p_payload->>'currency_code') THEN
        RAISE EXCEPTION 'E_CURRENCY_MISMATCH:policy=% payload=%', v_pv.currency_code, p_payload->>'currency_code';
      END IF;
    END IF;

    IF (p_payload->>'effective_to') IS NOT NULL
       AND (p_payload->>'effective_to')::date < (p_payload->>'effective_from')::date THEN
      RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATES:%', p_payload->>'effective_to';
    END IF;

    BEGIN
      INSERT INTO public.bn_means_assessment(
        person_id, declared_person, claim_id, award_id, benefit_programme,
        assessment_reason, effective_from, effective_to, policy_version_id,
        currency_code, status, assigned_to, correlation_id, created_by, updated_by)
      VALUES (
        NULLIF(p_payload->>'person_id','')::bigint,
        COALESCE(p_payload->'declared_person','{}'::jsonb),
        NULLIF(p_payload->>'claim_id','')::uuid,
        NULLIF(p_payload->>'award_id','')::uuid,
        p_payload->>'benefit_programme',
        p_payload->>'assessment_reason',
        (p_payload->>'effective_from')::date,
        NULLIF(p_payload->>'effective_to','')::date,
        NULLIF(p_payload->>'policy_version_id','')::uuid,
        p_payload->>'currency_code',
        'DRAFT',
        NULLIF(p_payload->>'assigned_to','')::uuid,
        p_correlation_id, p_actor_user_id, p_actor_user_id)
      RETURNING assessment_id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'E_DUPLICATE_OPEN_ASSESSMENT:% %', p_payload->>'benefit_programme', p_payload->>'effective_from';
    END;

    v_id := v_new_id;
    SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = v_id;
    PERFORM public._bn_means_event(v_id,'CREATED',p_command_name,NULL,'DRAFT',
      p_reason_code,p_justification,p_payload,p_actor_user_id,p_actor_user_code,p_correlation_id,v_a.row_version);
    v_result := jsonb_build_object('assessment_id', v_id,
      'assessment_reference', v_a.assessment_reference,
      'entity_version', v_a.row_version, 'to_status', 'DRAFT');

  ELSIF p_command_name = 'BN_MEANS_ADD_HOUSEHOLD_MEMBER' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    IF COALESCE(p_payload->>'relationship_code','') = ''
       OR COALESCE(p_payload->>'member_from','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:household member';
    END IF;
    INSERT INTO public.bn_means_household_member(
      assessment_id, person_id, declared_person, relationship_code, member_from,
      member_to, is_dependant, dependency_basis, shares_residence, fact_source, created_by)
    VALUES (v_id, NULLIF(p_payload->>'person_id','')::bigint,
      COALESCE(p_payload->'declared_person','{}'::jsonb),
      p_payload->>'relationship_code', (p_payload->>'member_from')::date,
      NULLIF(p_payload->>'member_to','')::date,
      COALESCE((p_payload->>'is_dependant')::boolean, false),
      NULLIF(p_payload->>'dependency_basis',''),
      COALESCE((p_payload->>'shares_residence')::boolean, true),
      COALESCE(p_payload->>'fact_source','DECLARED'), p_actor_user_id)
    RETURNING member_id INTO v_new_id;
    v_result := jsonb_build_object('member_id', v_new_id);

  ELSIF p_command_name = 'BN_MEANS_ADD_INCOME' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_currency := COALESCE(p_payload->>'currency_code', v_a.currency_code);
    IF v_currency <> v_a.currency_code THEN
      RAISE EXCEPTION 'E_CURRENCY_MISMATCH:assessment=% fact=%', v_a.currency_code, v_currency;
    END IF;
    IF COALESCE(p_payload->>'category_code','') = '' OR (p_payload->>'declared_amount') IS NULL
       OR COALESCE(p_payload->>'declared_frequency','') = '' OR COALESCE(p_payload->>'effective_from','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:income fact';
    END IF;
    v_amount := (p_payload->>'declared_amount')::numeric;
    v_freq   := p_payload->>'declared_frequency';
    v_norm   := public._bn_means_annualise(v_amount, v_freq);
    INSERT INTO public.bn_means_income_fact(
      assessment_id, member_id, category_code, income_source, basis,
      declared_amount, declared_frequency, currency_code, normalised_annual_amount,
      effective_from, effective_to, fact_source, created_by)
    VALUES (v_id, NULLIF(p_payload->>'member_id','')::uuid, p_payload->>'category_code',
      NULLIF(p_payload->>'income_source',''), COALESCE(p_payload->>'basis','GROSS'),
      v_amount, v_freq, v_currency, v_norm,
      (p_payload->>'effective_from')::date, NULLIF(p_payload->>'effective_to','')::date,
      COALESCE(p_payload->>'fact_source','DECLARED'), p_actor_user_id)
    RETURNING income_fact_id INTO v_new_id;
    v_result := jsonb_build_object('income_fact_id', v_new_id, 'normalised_annual_amount', v_norm);

  ELSIF p_command_name = 'BN_MEANS_ADD_ASSET' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_currency := COALESCE(p_payload->>'currency_code', v_a.currency_code);
    IF v_currency <> v_a.currency_code THEN
      RAISE EXCEPTION 'E_CURRENCY_MISMATCH:assessment=% fact=%', v_a.currency_code, v_currency;
    END IF;
    IF COALESCE(p_payload->>'category_code','') = '' OR (p_payload->>'valuation_amount') IS NULL
       OR COALESCE(p_payload->>'valuation_date','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:asset fact';
    END IF;
    INSERT INTO public.bn_means_asset_fact(
      assessment_id, member_id, category_code, description, ownership_share,
      valuation_amount, currency_code, valuation_date, valuation_source,
      fact_source, disregard_candidate, created_by)
    VALUES (v_id, NULLIF(p_payload->>'member_id','')::uuid, p_payload->>'category_code',
      NULLIF(p_payload->>'description',''),
      COALESCE((p_payload->>'ownership_share')::numeric, 1),
      (p_payload->>'valuation_amount')::numeric, v_currency,
      (p_payload->>'valuation_date')::date, NULLIF(p_payload->>'valuation_source',''),
      COALESCE(p_payload->>'fact_source','DECLARED'),
      COALESCE((p_payload->>'disregard_candidate')::boolean, false), p_actor_user_id)
    RETURNING asset_fact_id INTO v_new_id;
    v_result := jsonb_build_object('asset_fact_id', v_new_id);

  ELSIF p_command_name = 'BN_MEANS_ADD_DEDUCTION' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_currency := COALESCE(p_payload->>'currency_code', v_a.currency_code);
    IF v_currency <> v_a.currency_code THEN
      RAISE EXCEPTION 'E_CURRENCY_MISMATCH:assessment=% fact=%', v_a.currency_code, v_currency;
    END IF;
    IF COALESCE(p_payload->>'category_code','') = '' OR (p_payload->>'claimed_amount') IS NULL
       OR COALESCE(p_payload->>'effective_from','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:deduction fact';
    END IF;
    v_amount := (p_payload->>'claimed_amount')::numeric;
    v_freq   := COALESCE(p_payload->>'declared_frequency','ANNUAL');
    v_norm   := public._bn_means_annualise(v_amount, v_freq);
    INSERT INTO public.bn_means_deduction_fact(
      assessment_id, member_id, category_code, claimed_amount, declared_frequency,
      normalised_annual_amount, currency_code, claim_basis, effective_from,
      effective_to, approval_status, created_by)
    VALUES (v_id, NULLIF(p_payload->>'member_id','')::uuid, p_payload->>'category_code',
      v_amount, v_freq, v_norm, v_currency, NULLIF(p_payload->>'claim_basis',''),
      (p_payload->>'effective_from')::date, NULLIF(p_payload->>'effective_to','')::date,
      'CLAIMED', p_actor_user_id)
    RETURNING deduction_fact_id INTO v_new_id;
    v_result := jsonb_build_object('deduction_fact_id', v_new_id, 'normalised_annual_amount', v_norm);

  ELSIF p_command_name = 'BN_MEANS_ATTACH_EVIDENCE' THEN
    IF v_from NOT IN ('DRAFT','INFORMATION_PENDING','INCOMPLETE','SUBMITTED',
                      'VERIFICATION_PENDING','CALCULATED','REVIEW_PENDING','APPROVAL_PENDING') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot accept evidence', v_from;
    END IF;
    IF COALESCE(p_payload->>'dms_document_id','') = ''
       AND COALESCE(p_payload->>'dms_reference','') = '' THEN
      RAISE EXCEPTION 'E_EVIDENCE_REFERENCE_REQUIRED:%', p_command_name;
    END IF;
    INSERT INTO public.bn_means_evidence(
      assessment_id, fact_kind, fact_id, evidence_type, dms_document_id,
      dms_reference, status, received_at, notes, correlation_id, created_by)
    VALUES (v_id, NULLIF(p_payload->>'fact_kind',''), NULLIF(p_payload->>'fact_id','')::uuid,
      COALESCE(p_payload->>'evidence_type','SUPPORTING'),
      NULLIF(p_payload->>'dms_document_id',''), NULLIF(p_payload->>'dms_reference',''),
      COALESCE(p_payload->>'status','ATTACHED'),
      COALESCE(NULLIF(p_payload->>'received_at','')::timestamptz, now()),
      NULLIF(p_payload->>'notes',''), p_correlation_id, p_actor_user_id)
    RETURNING evidence_id INTO v_new_id;

    IF (p_payload->>'fact_kind') = 'INCOME' AND (p_payload->>'fact_id') IS NOT NULL THEN
      UPDATE public.bn_means_income_fact SET evidence_status = 'ATTACHED'
       WHERE income_fact_id = (p_payload->>'fact_id')::uuid AND assessment_id = v_id;
    ELSIF (p_payload->>'fact_kind') = 'ASSET' AND (p_payload->>'fact_id') IS NOT NULL THEN
      UPDATE public.bn_means_asset_fact SET evidence_status = 'ATTACHED'
       WHERE asset_fact_id = (p_payload->>'fact_id')::uuid AND assessment_id = v_id;
    ELSIF (p_payload->>'fact_kind') = 'DEDUCTION' AND (p_payload->>'fact_id') IS NOT NULL THEN
      UPDATE public.bn_means_deduction_fact SET evidence_status = 'ATTACHED'
       WHERE deduction_fact_id = (p_payload->>'fact_id')::uuid AND assessment_id = v_id;
    ELSIF (p_payload->>'fact_kind') = 'HOUSEHOLD' AND (p_payload->>'fact_id') IS NOT NULL THEN
      UPDATE public.bn_means_household_member SET evidence_status = 'ATTACHED'
       WHERE member_id = (p_payload->>'fact_id')::uuid AND assessment_id = v_id;
    END IF;
    v_result := jsonb_build_object('evidence_id', v_new_id);

  ELSIF p_command_name = 'BN_MEANS_SUBMIT' THEN
    IF NOT public._bn_means_can_transition(v_from, 'SUBMITTED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% -> SUBMITTED', v_from;
    END IF;
    IF v_a.policy_version_id IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:policy version';
    END IF;
    SELECT * INTO v_pv FROM public.bn_means_policy_version
     WHERE policy_version_id = v_a.policy_version_id;
    IF v_pv.status <> 'ACTIVE'
       OR v_pv.effective_from > v_a.effective_from
       OR (v_pv.effective_to IS NOT NULL AND v_pv.effective_to < v_a.effective_from) THEN
      RAISE EXCEPTION 'E_POLICY_NOT_EFFECTIVE:%', v_a.policy_version_id;
    END IF;
    IF v_pv.currency_code <> v_a.currency_code THEN
      RAISE EXCEPTION 'E_CURRENCY_MISMATCH:policy=% assessment=%', v_pv.currency_code, v_a.currency_code;
    END IF;

    SELECT count(*) INTO v_count FROM public.bn_means_household_member
     WHERE assessment_id = v_id AND voided_at IS NULL;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:household';
    END IF;

    SELECT count(*) INTO v_count FROM public.bn_means_income_fact
     WHERE assessment_id = v_id AND voided_at IS NULL AND currency_code <> v_a.currency_code;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_CURRENCY_MISMATCH:% income facts', v_count;
    END IF;

    -- Policy-declared required evidence types must be present.
    SELECT count(*) INTO v_count
      FROM jsonb_array_elements_text(COALESCE(v_pv.required_evidence,'[]'::jsonb)) req(code)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.bn_means_evidence e
        WHERE e.assessment_id = v_id AND e.evidence_type = req.code
          AND e.status IN ('ATTACHED','RECEIVED'));
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_MISSING_EVIDENCE:% required evidence type(s)', v_count;
    END IF;

    -- Freeze the submitted version.
    v_version_no := v_a.current_version;
    SELECT jsonb_build_object(
      'assessment', to_jsonb(v_a),
      'household', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at)
                               FROM public.bn_means_household_member h
                              WHERE h.assessment_id = v_id AND h.voided_at IS NULL),'[]'::jsonb),
      'income',    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
                               FROM public.bn_means_income_fact i
                              WHERE i.assessment_id = v_id AND i.voided_at IS NULL),'[]'::jsonb),
      'assets',    COALESCE((SELECT jsonb_agg(to_jsonb(a2) ORDER BY a2.created_at)
                               FROM public.bn_means_asset_fact a2
                              WHERE a2.assessment_id = v_id AND a2.voided_at IS NULL),'[]'::jsonb),
      'deductions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at)
                               FROM public.bn_means_deduction_fact d
                              WHERE d.assessment_id = v_id AND d.voided_at IS NULL),'[]'::jsonb),
      'evidence',  COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
                               FROM public.bn_means_evidence e
                              WHERE e.assessment_id = v_id),'[]'::jsonb)
    ) INTO v_snapshot;

    INSERT INTO public.bn_means_assessment_version(
      assessment_id, version_no, frozen_reason, snapshot, snapshot_hash, frozen_by, correlation_id)
    VALUES (v_id, v_version_no, 'SUBMITTED', v_snapshot,
            encode(digest(v_snapshot::text,'sha256'),'hex'), p_actor_user_id, p_correlation_id)
    ON CONFLICT (assessment_id, version_no) DO NOTHING;

    UPDATE public.bn_means_assessment
       SET status = 'SUBMITTED',
           submitted_at = now(),
           maker_user_id = p_actor_user_id,
           row_version = row_version + 1,
           updated_at = now(),
           updated_by = p_actor_user_id
     WHERE assessment_id = v_id
     RETURNING * INTO v_a;

    INSERT INTO public.bn_means_information_request(assessment_id, request_code, details, status, requested_by, correlation_id)
    SELECT v_id, 'VERIFICATION_TASK', 'Verification required for submitted assessment', 'OPEN', p_actor_user_id, p_correlation_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.bn_means_information_request
        WHERE assessment_id = v_id AND request_code = 'VERIFICATION_TASK' AND status = 'OPEN');

    INSERT INTO public.bn_means_communication_intent(
      assessment_id, event_code, recipient_ref, context_data, idempotency_key, correlation_id, created_by)
    VALUES (v_id, 'MEANS_ASSESSMENT_SUBMITTED',
      jsonb_build_object('person_id', v_a.person_id, 'claim_id', v_a.claim_id),
      jsonb_build_object('assessment_reference', v_a.assessment_reference,
                         'benefit_programme', v_a.benefit_programme),
      'MEANS_SUBMIT:' || v_id::text || ':' || v_version_no::text,
      p_correlation_id, p_actor_user_id)
    ON CONFLICT DO NOTHING;

    v_result := jsonb_build_object('assessment_id', v_id, 'entity_version', v_a.row_version,
      'to_status', 'SUBMITTED', 'frozen_version_no', v_version_no);

  ELSE
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED:%', p_command_name;
  END IF;

  -- (f) touch aggregate + audit for fact-authoring commands
  IF p_command_name IN ('BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_ADD_INCOME',
                        'BN_MEANS_ADD_ASSET','BN_MEANS_ADD_DEDUCTION','BN_MEANS_ATTACH_EVIDENCE') THEN
    UPDATE public.bn_means_assessment
       SET row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = v_id RETURNING * INTO v_a;
    v_result := v_result || jsonb_build_object('assessment_id', v_id, 'entity_version', v_a.row_version);
  END IF;

  IF p_command_name <> 'BN_MEANS_CREATE_ASSESSMENT' THEN
    PERFORM public._bn_means_event(v_id,
      CASE p_command_name
        WHEN 'BN_MEANS_SUBMIT' THEN 'SUBMITTED'
        WHEN 'BN_MEANS_ATTACH_EVIDENCE' THEN 'EVIDENCE_ATTACHED'
        ELSE 'FACT_RECORDED' END,
      p_command_name, v_from, v_a.status, p_reason_code, p_justification,
      v_result, p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version);
  END IF;

  -- (g) maker identity
  IF v_id IS NOT NULL THEN
    INSERT INTO public.bn_means_command_maker(assessment_id, maker_role, maker_user_id, correlation_id)
    VALUES (v_id, p_command_name, p_actor_user_id, p_correlation_id)
    ON CONFLICT (assessment_id, maker_role)
      DO UPDATE SET maker_user_id = EXCLUDED.maker_user_id,
                    recorded_at = now(), correlation_id = EXCLUDED.correlation_id;
  END IF;

  -- (h) idempotency record
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_means_command_idempotency(
      idempotency_key, command_name, payload_hash, assessment_id, entity_version,
      result_json, status, completed_at, actor_user_id)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), v_id,
      NULLIF(v_result->>'entity_version','')::bigint, v_result, 'COMPLETED', now(), p_actor_user_id)
    ON CONFLICT (idempotency_key, command_name) DO NOTHING;
  END IF;

  RETURN v_result || jsonb_build_object('status','EXECUTED');
END;
$$;
REVOKE ALL ON FUNCTION public.bn_means_execute_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_execute_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;

-- ---------- 8. Secured query functions ----------
CREATE OR REPLACE FUNCTION public.bn_means_work_queue_v1(
  p_actor_user_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
  v_total int;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code', 'data', NULL);
  END IF;

  SELECT count(*) INTO v_total
    FROM public.bn_means_assessment a
   WHERE (COALESCE(p_filters->>'status','') = '' OR a.status = p_filters->>'status')
     AND (COALESCE(p_filters->>'benefit_programme','') = '' OR a.benefit_programme = p_filters->>'benefit_programme')
     AND (COALESCE(p_filters->>'assessment_reason','') = '' OR a.assessment_reason = p_filters->>'assessment_reason')
     AND (COALESCE(p_filters->>'assigned_to','') = '' OR a.assigned_to = (p_filters->>'assigned_to')::uuid)
     AND (COALESCE(p_filters->>'policy_version_id','') = '' OR a.policy_version_id = (p_filters->>'policy_version_id')::uuid)
     AND (COALESCE(p_filters->>'effective_from','') = '' OR a.effective_from >= (p_filters->>'effective_from')::date)
     AND (COALESCE(p_filters->>'effective_to','') = '' OR a.effective_from <= (p_filters->>'effective_to')::date)
     AND (COALESCE(p_filters->>'reassessment_due_before','') = '' OR a.reassessment_due <= (p_filters->>'reassessment_due_before')::date)
     AND (COALESCE(p_filters->>'search','') = '' OR a.assessment_reference ILIKE '%' || (p_filters->>'search') || '%');

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'updated_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'assessment_id', a.assessment_id,
      'assessment_reference', a.assessment_reference,
      'person_id', a.person_id,
      'claim_id', a.claim_id,
      'award_id', a.award_id,
      'benefit_programme', a.benefit_programme,
      'assessment_reason', a.assessment_reason,
      'status', a.status,
      'result', a.result,
      'effective_from', a.effective_from,
      'effective_to', a.effective_to,
      'policy_version_id', a.policy_version_id,
      'currency_code', a.currency_code,
      'assigned_to', a.assigned_to,
      'reassessment_due', a.reassessment_due,
      'valid_until', a.valid_until,
      'row_version', a.row_version,
      'updated_at', a.updated_at,
      'open_information_requests', (SELECT count(*) FROM public.bn_means_information_request ir
                                     WHERE ir.assessment_id = a.assessment_id AND ir.status = 'OPEN'),
      'evidence_count', (SELECT count(*) FROM public.bn_means_evidence e WHERE e.assessment_id = a.assessment_id)
    ) AS r
    FROM public.bn_means_assessment a
   WHERE (COALESCE(p_filters->>'status','') = '' OR a.status = p_filters->>'status')
     AND (COALESCE(p_filters->>'benefit_programme','') = '' OR a.benefit_programme = p_filters->>'benefit_programme')
     AND (COALESCE(p_filters->>'assessment_reason','') = '' OR a.assessment_reason = p_filters->>'assessment_reason')
     AND (COALESCE(p_filters->>'assigned_to','') = '' OR a.assigned_to = (p_filters->>'assigned_to')::uuid)
     AND (COALESCE(p_filters->>'policy_version_id','') = '' OR a.policy_version_id = (p_filters->>'policy_version_id')::uuid)
     AND (COALESCE(p_filters->>'effective_from','') = '' OR a.effective_from >= (p_filters->>'effective_from')::date)
     AND (COALESCE(p_filters->>'effective_to','') = '' OR a.effective_from <= (p_filters->>'effective_to')::date)
     AND (COALESCE(p_filters->>'reassessment_due_before','') = '' OR a.reassessment_due <= (p_filters->>'reassessment_due_before')::date)
     AND (COALESCE(p_filters->>'search','') = '' OR a.assessment_reference ILIKE '%' || (p_filters->>'search') || '%')
   ORDER BY a.updated_at DESC
   LIMIT GREATEST(LEAST(COALESCE(p_limit,50), 200), 1) OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) s;

  RETURN jsonb_build_object('status','OK','data', v_rows, 'total_count', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.bn_means_work_queue_v1(uuid,jsonb,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_work_queue_v1(uuid,jsonb,int,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bn_means_assessment_detail_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code', 'data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment', to_jsonb(v_a),
    'policy_version', (SELECT to_jsonb(pv) FROM public.bn_means_policy_version pv
                        WHERE pv.policy_version_id = v_a.policy_version_id),
    'household', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at)
                             FROM public.bn_means_household_member h
                            WHERE h.assessment_id = p_assessment_id AND h.voided_at IS NULL),'[]'::jsonb),
    'income', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
                          FROM public.bn_means_income_fact i
                         WHERE i.assessment_id = p_assessment_id AND i.voided_at IS NULL),'[]'::jsonb),
    'assets', COALESCE((SELECT jsonb_agg(to_jsonb(a2) ORDER BY a2.created_at)
                          FROM public.bn_means_asset_fact a2
                         WHERE a2.assessment_id = p_assessment_id AND a2.voided_at IS NULL),'[]'::jsonb),
    'deductions', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at)
                              FROM public.bn_means_deduction_fact d
                             WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL),'[]'::jsonb),
    'evidence', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
                            FROM public.bn_means_evidence e WHERE e.assessment_id = p_assessment_id),'[]'::jsonb),
    'information_requests', COALESCE((SELECT jsonb_agg(to_jsonb(ir) ORDER BY ir.requested_at)
                            FROM public.bn_means_information_request ir WHERE ir.assessment_id = p_assessment_id),'[]'::jsonb),
    'verifications', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.verified_at)
                            FROM public.bn_means_verification v WHERE v.assessment_id = p_assessment_id),'[]'::jsonb),
    'calculations', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.calculated_at DESC)
                            FROM public.bn_means_calculation c WHERE c.assessment_id = p_assessment_id),'[]'::jsonb),
    'adjustments', COALESCE((SELECT jsonb_agg(to_jsonb(adj) ORDER BY adj.requested_at)
                            FROM public.bn_means_adjustment adj WHERE adj.assessment_id = p_assessment_id),'[]'::jsonb),
    'approvals', COALESCE((SELECT jsonb_agg(to_jsonb(ap) ORDER BY ap.decided_at)
                            FROM public.bn_means_approval ap WHERE ap.assessment_id = p_assessment_id),'[]'::jsonb),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'assessment_version_id', av.assessment_version_id,
                              'version_no', av.version_no,
                              'frozen_reason', av.frozen_reason,
                              'snapshot_hash', av.snapshot_hash,
                              'frozen_at', av.frozen_at) ORDER BY av.version_no)
                            FROM public.bn_means_assessment_version av WHERE av.assessment_id = p_assessment_id),'[]'::jsonb),
    'timeline', COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.created_at DESC)
                            FROM public.bn_means_event ev WHERE ev.assessment_id = p_assessment_id),'[]'::jsonb)
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.bn_means_assessment_detail_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_assessment_detail_v1(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bn_means_available_actions_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_a public.bn_means_assessment%ROWTYPE;
  v_out jsonb := '[]'::jsonb;
  v_cmd text;
  v_perm jsonb;
  v_allowed boolean;
  v_reason text;
  v_maker_src text;
  v_maker uuid;
  v_count int;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  FOREACH v_cmd IN ARRAY ARRAY[
    'BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_ADD_INCOME','BN_MEANS_ADD_ASSET',
    'BN_MEANS_ADD_DEDUCTION','BN_MEANS_ATTACH_EVIDENCE','BN_MEANS_SUBMIT',
    'BN_MEANS_VERIFY_INFORMATION','BN_MEANS_CALCULATE','BN_MEANS_REQUEST_ADJUSTMENT',
    'BN_MEANS_APPROVE_ADJUSTMENT','BN_MEANS_APPROVE','BN_MEANS_REJECT','BN_MEANS_ACTIVATE',
    'BN_MEANS_SCHEDULE_REASSESSMENT','BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE',
    'BN_MEANS_SUPERSEDE','BN_MEANS_CLOSE']
  LOOP
    v_allowed := true; v_reason := NULL;

    v_perm := public.bn_means_check_actor_permission(
      p_actor_user_id, public._bn_means_action_for_command(v_cmd), true);
    IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
      v_allowed := false;
      v_reason := CASE v_perm->>'code'
        WHEN 'ACTIONS_DISABLED' THEN 'ACTIONS_DISABLED'
        WHEN 'UNAUTHENTICATED'  THEN 'PERMISSION_DENIED'
        ELSE 'PERMISSION_DENIED' END;
    END IF;

    IF v_allowed THEN
      IF v_cmd IN ('BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_ADD_INCOME',
                   'BN_MEANS_ADD_ASSET','BN_MEANS_ADD_DEDUCTION')
         AND NOT public._bn_means_is_editable(v_a.status) THEN
        v_allowed := false;
        v_reason := CASE WHEN v_a.status = 'SUBMITTED' THEN 'ALREADY_SUBMITTED' ELSE 'INVALID_STATE' END;
      ELSIF v_cmd = 'BN_MEANS_SUBMIT' THEN
        IF NOT public._bn_means_can_transition(v_a.status, 'SUBMITTED') THEN
          v_allowed := false;
          v_reason := CASE WHEN v_a.status = 'SUBMITTED' THEN 'ALREADY_SUBMITTED' ELSE 'INVALID_STATE' END;
        ELSIF v_a.policy_version_id IS NULL THEN
          v_allowed := false; v_reason := 'MISSING_REQUIRED_INFORMATION';
        ELSE
          SELECT count(*) INTO v_count FROM public.bn_means_household_member
           WHERE assessment_id = p_assessment_id AND voided_at IS NULL;
          IF v_count = 0 THEN
            v_allowed := false; v_reason := 'MISSING_REQUIRED_INFORMATION';
          ELSE
            SELECT count(*) INTO v_count
              FROM public.bn_means_policy_version pv,
                   LATERAL jsonb_array_elements_text(COALESCE(pv.required_evidence,'[]'::jsonb)) req(code)
             WHERE pv.policy_version_id = v_a.policy_version_id
               AND NOT EXISTS (SELECT 1 FROM public.bn_means_evidence e
                                WHERE e.assessment_id = p_assessment_id
                                  AND e.evidence_type = req.code
                                  AND e.status IN ('ATTACHED','RECEIVED'));
            IF v_count > 0 THEN v_allowed := false; v_reason := 'MISSING_EVIDENCE'; END IF;
          END IF;
        END IF;
      ELSIF v_cmd IN ('BN_MEANS_VERIFY_INFORMATION') AND v_a.status NOT IN ('SUBMITTED','VERIFICATION_PENDING') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd = 'BN_MEANS_CALCULATE' AND v_a.status NOT IN ('SUBMITTED','VERIFICATION_PENDING','REVIEW_PENDING') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd IN ('BN_MEANS_APPROVE','BN_MEANS_REJECT') AND v_a.status NOT IN ('CALCULATED','APPROVAL_PENDING','REVIEW_PENDING') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd = 'BN_MEANS_ACTIVATE' AND v_a.status <> 'APPROVED' THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd IN ('BN_MEANS_SUPERSEDE','BN_MEANS_SCHEDULE_REASSESSMENT')
            AND v_a.status NOT IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd = 'BN_MEANS_CLOSE' AND v_a.status IN ('CLOSED','CANCELLED') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      END IF;
    END IF;

    IF v_allowed THEN
      v_maker_src := public._bn_means_maker_source(v_cmd);
      IF v_maker_src IS NOT NULL THEN
        SELECT maker_user_id INTO v_maker FROM public.bn_means_command_maker
         WHERE assessment_id = p_assessment_id AND maker_role = v_maker_src;
        IF v_maker IS NULL THEN
          v_allowed := false; v_reason := 'MAKER_CHECKER_REQUIRED';
        ELSIF v_maker = p_actor_user_id THEN
          v_allowed := false; v_reason := 'SELF_APPROVAL_DENIED';
        END IF;
      END IF;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'command', v_cmd, 'allowed', v_allowed, 'reason', v_reason,
      'row_version', v_a.row_version));
  END LOOP;

  RETURN jsonb_build_object('status','OK','data', v_out,
    'assessment_status', v_a.status, 'row_version', v_a.row_version);
END;
$$;
REVOKE ALL ON FUNCTION public.bn_means_available_actions_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_available_actions_v1(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bn_means_benefit360_summary_v1(
  p_actor_user_id uuid, p_award_id uuid DEFAULT NULL, p_person_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code', 'data', NULL);
  END IF;
  IF p_award_id IS NULL AND p_person_id IS NULL THEN
    RETURN jsonb_build_object('status','INVALID','code','SUBJECT_REQUIRED','data', NULL);
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment a
   WHERE (p_award_id IS NOT NULL AND a.award_id = p_award_id)
      OR (p_award_id IS NULL AND a.person_id = p_person_id)
   ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'REASSESSMENT_DUE' THEN 1 ELSE 2 END,
            a.updated_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','OK','data', NULL);
  END IF;

  -- Deliberately no household finances on the general 360 card.
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', v_a.assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'status', v_a.status,
    'assessment_reason', v_a.assessment_reason,
    'policy_version_id', v_a.policy_version_id,
    'effective_from', v_a.effective_from,
    'effective_to', v_a.effective_to,
    'result', CASE WHEN v_a.status IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED','SUPERSEDED','CLOSED','REJECTED')
                   THEN v_a.result ELSE NULL END,
    'valid_until', v_a.valid_until,
    'reassessment_due', v_a.reassessment_due,
    'missing_information', (SELECT count(*) > 0 FROM public.bn_means_information_request ir
                             WHERE ir.assessment_id = v_a.assessment_id AND ir.status = 'OPEN'),
    'pending_verification', v_a.status IN ('SUBMITTED','VERIFICATION_PENDING')
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.bn_means_benefit360_summary_v1(uuid,uuid,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_benefit360_summary_v1(uuid,uuid,bigint) TO authenticated, service_role;
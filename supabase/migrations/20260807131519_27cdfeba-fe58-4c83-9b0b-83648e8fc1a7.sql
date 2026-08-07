
-- =====================================================================
-- MEANS-TEST EPIC 6 — Evidence and Information Requests
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.bn_means_evidence_link (
  link_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id          uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  evidence_id            uuid REFERENCES public.bn_means_evidence(evidence_id) ON DELETE SET NULL,
  requirement_code       text NOT NULL,
  subject_kind           text NOT NULL,
  subject_ref_id         uuid,
  document_source        text NOT NULL,
  document_ref           text NOT NULL,
  document_title         text,
  document_type_code     text,
  evidence_type          text NOT NULL DEFAULT 'OTHER_SUPPORTING',
  evidence_source        text,
  document_date          date,
  period_from            date,
  period_to              date,
  expiry_date            date,
  usability_status       text NOT NULL DEFAULT 'RECEIVED',
  usability_reason_code  text,
  usability_note         text,
  usability_checked_at   timestamptz,
  usability_checked_by   uuid,
  link_status            text NOT NULL DEFAULT 'LINKED',
  information_request_id uuid,
  officer_notes          text,
  correlation_id         uuid,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  linked_by              uuid,
  unlinked_at            timestamptz,
  unlinked_by            uuid,
  unlink_reason_code     text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,
  CONSTRAINT bn_means_evidence_link_subject_chk CHECK (
    subject_kind IN ('ASSESSMENT','HOUSEHOLD_MEMBER','INCOME_FACT','ASSET_FACT','DEDUCTION_FACT')),
  CONSTRAINT bn_means_evidence_link_source_chk CHECK (
    document_source IN ('BN_CLAIM_EVIDENCE','BN_CLAIM_DOCUMENT','GENERATED_DOCUMENT','EXTERNAL_REFERENCE')),
  CONSTRAINT bn_means_evidence_link_usability_chk CHECK (
    usability_status IN ('RECEIVED','USABLE','UNREADABLE','WRONG_DOCUMENT','EXPIRED','INCOMPLETE','SUPERSEDED')),
  CONSTRAINT bn_means_evidence_link_status_chk CHECK (
    link_status IN ('LINKED','UNLINKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS bn_means_evidence_link_active_uk
  ON public.bn_means_evidence_link (
    assessment_id, requirement_code, subject_kind,
    COALESCE(subject_ref_id,'00000000-0000-0000-0000-000000000000'::uuid),
    document_source, document_ref)
  WHERE link_status = 'LINKED';

CREATE INDEX IF NOT EXISTS bn_means_evidence_link_assessment_idx
  ON public.bn_means_evidence_link (assessment_id, link_status);

GRANT SELECT ON public.bn_means_evidence_link TO authenticated;
GRANT ALL ON public.bn_means_evidence_link TO service_role;

-- Information request extensions -------------------------------------
ALTER TABLE public.bn_means_information_request
  ADD COLUMN IF NOT EXISTS request_type          text NOT NULL DEFAULT 'DOCUMENT_REQUEST',
  ADD COLUMN IF NOT EXISTS request_reference     text,
  ADD COLUMN IF NOT EXISTS requirement_code      text,
  ADD COLUMN IF NOT EXISTS subject_kind          text,
  ADD COLUMN IF NOT EXISTS subject_ref_id        uuid,
  ADD COLUMN IF NOT EXISTS recipient_kind        text,
  ADD COLUMN IF NOT EXISTS recipient_label       text,
  ADD COLUMN IF NOT EXISTS reason_code           text,
  ADD COLUMN IF NOT EXISTS information_required  text,
  ADD COLUMN IF NOT EXISTS is_blocking           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS response_summary      text,
  ADD COLUMN IF NOT EXISTS closed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by             uuid,
  ADD COLUMN IF NOT EXISTS close_reason_code     text,
  ADD COLUMN IF NOT EXISTS created_at            timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by            uuid;

CREATE TABLE IF NOT EXISTS public.bn_means_information_response (
  response_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES public.bn_means_information_request(request_id) ON DELETE CASCADE,
  assessment_id    uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  response_kind    text NOT NULL,
  note             text,
  evidence_link_id uuid REFERENCES public.bn_means_evidence_link(link_id) ON DELETE SET NULL,
  correlation_id   uuid,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_information_response_kind_chk CHECK (
    response_kind IN ('FULL_RESPONSE','PARTIAL_RESPONSE','WRONG_INFORMATION','NO_RESPONSE','WITHDRAWN'))
);

CREATE INDEX IF NOT EXISTS bn_means_information_response_request_idx
  ON public.bn_means_information_response (request_id);

GRANT SELECT ON public.bn_means_information_response TO authenticated;
GRANT ALL ON public.bn_means_information_response TO service_role;

-- =====================================================================
-- Reference data
-- =====================================================================
CREATE OR REPLACE FUNCTION public._bn_means_evidence_reference()
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'EVIDENCE_TYPE', jsonb_build_array(
      jsonb_build_object('value','IDENTITY_DOCUMENT','label','Identity document','applies_to',jsonb_build_array('IDENTITY_EVIDENCE','HOUSEHOLD_RELATIONSHIP_EVIDENCE')),
      jsonb_build_object('value','PROOF_OF_ADDRESS','label','Proof of address','applies_to',jsonb_build_array('RESIDENCE_EVIDENCE','HOUSEHOLD_RELATIONSHIP_EVIDENCE')),
      jsonb_build_object('value','BIRTH_CERTIFICATE','label','Birth certificate','applies_to',jsonb_build_array('IDENTITY_EVIDENCE','HOUSEHOLD_RELATIONSHIP_EVIDENCE')),
      jsonb_build_object('value','MARRIAGE_CERTIFICATE','label','Marriage certificate','applies_to',jsonb_build_array('HOUSEHOLD_RELATIONSHIP_EVIDENCE')),
      jsonb_build_object('value','PAYSLIP','label','Payslip','applies_to',jsonb_build_array('INCOME_EVIDENCE')),
      jsonb_build_object('value','EMPLOYER_LETTER','label','Employer letter','applies_to',jsonb_build_array('INCOME_EVIDENCE')),
      jsonb_build_object('value','BANK_STATEMENT','label','Bank statement','applies_to',jsonb_build_array('INCOME_EVIDENCE','ASSET_EVIDENCE','DEDUCTION_EVIDENCE')),
      jsonb_build_object('value','TAX_RETURN','label','Tax return','applies_to',jsonb_build_array('INCOME_EVIDENCE','ASSET_EVIDENCE')),
      jsonb_build_object('value','BUSINESS_ACCOUNTS','label','Business accounts','applies_to',jsonb_build_array('INCOME_EVIDENCE','ASSET_EVIDENCE')),
      jsonb_build_object('value','PENSION_STATEMENT','label','Pension statement','applies_to',jsonb_build_array('INCOME_EVIDENCE')),
      jsonb_build_object('value','BENEFIT_AWARD_LETTER','label','Benefit award letter','applies_to',jsonb_build_array('INCOME_EVIDENCE')),
      jsonb_build_object('value','PROPERTY_DEED','label','Property deed or title','applies_to',jsonb_build_array('ASSET_EVIDENCE')),
      jsonb_build_object('value','VALUATION_REPORT','label','Valuation report','applies_to',jsonb_build_array('ASSET_EVIDENCE')),
      jsonb_build_object('value','VEHICLE_REGISTRATION','label','Vehicle registration','applies_to',jsonb_build_array('ASSET_EVIDENCE')),
      jsonb_build_object('value','INVESTMENT_STATEMENT','label','Investment statement','applies_to',jsonb_build_array('ASSET_EVIDENCE')),
      jsonb_build_object('value','MEDICAL_INVOICE','label','Medical invoice or receipt','applies_to',jsonb_build_array('DEDUCTION_EVIDENCE')),
      jsonb_build_object('value','RENT_AGREEMENT','label','Rent or tenancy agreement','applies_to',jsonb_build_array('DEDUCTION_EVIDENCE','RESIDENCE_EVIDENCE')),
      jsonb_build_object('value','LOAN_STATEMENT','label','Loan or maintenance statement','applies_to',jsonb_build_array('DEDUCTION_EVIDENCE')),
      jsonb_build_object('value','SCHOOL_ENROLMENT','label','School enrolment record','applies_to',jsonb_build_array('HOUSEHOLD_RELATIONSHIP_EVIDENCE','DEDUCTION_EVIDENCE')),
      jsonb_build_object('value','DECLARATION_FORM','label','Signed declaration','applies_to',jsonb_build_array('IDENTITY_EVIDENCE','INCOME_EVIDENCE','ASSET_EVIDENCE','DEDUCTION_EVIDENCE','HOUSEHOLD_RELATIONSHIP_EVIDENCE','RESIDENCE_EVIDENCE')),
      jsonb_build_object('value','OTHER_SUPPORTING','label','Other supporting document','applies_to',jsonb_build_array('IDENTITY_EVIDENCE','INCOME_EVIDENCE','ASSET_EVIDENCE','DEDUCTION_EVIDENCE','HOUSEHOLD_RELATIONSHIP_EVIDENCE','RESIDENCE_EVIDENCE'))
    ),
    'EVIDENCE_SOURCE', jsonb_build_array(
      jsonb_build_object('value','CLAIMANT_SUBMITTED','label','Submitted by claimant'),
      jsonb_build_object('value','HOUSEHOLD_MEMBER_SUBMITTED','label','Submitted by household member'),
      jsonb_build_object('value','EMPLOYER_PROVIDED','label','Provided by employer'),
      jsonb_build_object('value','GOVERNMENT_AGENCY','label','Provided by another agency'),
      jsonb_build_object('value','THIRD_PARTY','label','Provided by a third party'),
      jsonb_build_object('value','INTERNAL_RECORD','label','Existing internal record'),
      jsonb_build_object('value','SYSTEM_GENERATED','label','System generated document')
    ),
    'EVIDENCE_USABILITY_STATUS', jsonb_build_array(
      jsonb_build_object('value','RECEIVED','label','Received — not yet checked','counts_as_usable',true,'is_issue',false),
      jsonb_build_object('value','USABLE','label','Usable for verification','counts_as_usable',true,'is_issue',false),
      jsonb_build_object('value','UNREADABLE','label','Not readable','counts_as_usable',false,'is_issue',true),
      jsonb_build_object('value','WRONG_DOCUMENT','label','Wrong document','counts_as_usable',false,'is_issue',true),
      jsonb_build_object('value','EXPIRED','label','Out of date','counts_as_usable',false,'is_issue',true),
      jsonb_build_object('value','INCOMPLETE','label','Incomplete','counts_as_usable',false,'is_issue',true),
      jsonb_build_object('value','SUPERSEDED','label','Superseded by a newer document','counts_as_usable',false,'is_issue',false)
    ),
    'EVIDENCE_USABILITY_REASON', jsonb_build_array(
      jsonb_build_object('value','ILLEGIBLE_SCAN','label','Scan is illegible'),
      jsonb_build_object('value','PAGES_MISSING','label','Pages are missing'),
      jsonb_build_object('value','WRONG_PERIOD','label','Covers the wrong period'),
      jsonb_build_object('value','WRONG_SUBJECT','label','Relates to a different person'),
      jsonb_build_object('value','NOT_CERTIFIED','label','Not certified where certification is required'),
      jsonb_build_object('value','UNSIGNED','label','Not signed'),
      jsonb_build_object('value','DATE_OUT_OF_RANGE','label','Dated outside the assessment period'),
      jsonb_build_object('value','DUPLICATE_OF_EXISTING','label','Duplicate of a document already linked'),
      jsonb_build_object('value','SUPERSEDED_BY_NEWER','label','A newer document has been received'),
      jsonb_build_object('value','OTHER','label','Other reason')
    ),
    'EVIDENCE_SUBJECT_KIND', jsonb_build_array(
      jsonb_build_object('value','ASSESSMENT','label','Whole assessment'),
      jsonb_build_object('value','HOUSEHOLD_MEMBER','label','Household member'),
      jsonb_build_object('value','INCOME_FACT','label','Income record'),
      jsonb_build_object('value','ASSET_FACT','label','Asset record'),
      jsonb_build_object('value','DEDUCTION_FACT','label','Deduction or disregard claim')
    ),
    'DOCUMENT_SOURCE', jsonb_build_array(
      jsonb_build_object('value','BN_CLAIM_EVIDENCE','label','Claim evidence register'),
      jsonb_build_object('value','BN_CLAIM_DOCUMENT','label','Claim document store'),
      jsonb_build_object('value','GENERATED_DOCUMENT','label','Generated document archive'),
      jsonb_build_object('value','EXTERNAL_REFERENCE','label','External reference')
    ),
    'INFORMATION_REQUEST_TYPE', jsonb_build_array(
      jsonb_build_object('value','DOCUMENT_REQUEST','label','Request a document','requires_requirement',true),
      jsonb_build_object('value','CLARIFICATION','label','Request a clarification','requires_requirement',false),
      jsonb_build_object('value','DECLARATION','label','Request a signed declaration','requires_requirement',false),
      jsonb_build_object('value','THIRD_PARTY_CONFIRMATION','label','Request third-party confirmation','requires_requirement',false)
    ),
    'INFORMATION_REQUEST_RECIPIENT', jsonb_build_array(
      jsonb_build_object('value','CLAIMANT','label','Claimant'),
      jsonb_build_object('value','HOUSEHOLD_MEMBER','label','Household member'),
      jsonb_build_object('value','EMPLOYER','label','Employer'),
      jsonb_build_object('value','THIRD_PARTY','label','Third party'),
      jsonb_build_object('value','INTERNAL_UNIT','label','Internal unit')
    ),
    'INFORMATION_REQUEST_REASON', jsonb_build_array(
      jsonb_build_object('value','EVIDENCE_MISSING','label','Required evidence has not been received'),
      jsonb_build_object('value','EVIDENCE_UNUSABLE','label','Evidence received cannot be used'),
      jsonb_build_object('value','EVIDENCE_EXPIRED','label','Evidence is out of date'),
      jsonb_build_object('value','CLARIFICATION_REQUIRED','label','A declared fact needs clarification'),
      jsonb_build_object('value','VERIFICATION_SUPPORT','label','Needed to support later verification'),
      jsonb_build_object('value','POLICY_REQUIREMENT','label','Required by policy')
    ),
    'INFORMATION_RESPONSE_KIND', jsonb_build_array(
      jsonb_build_object('value','FULL_RESPONSE','label','Full response received'),
      jsonb_build_object('value','PARTIAL_RESPONSE','label','Partial response received'),
      jsonb_build_object('value','WRONG_INFORMATION','label','Wrong information received'),
      jsonb_build_object('value','NO_RESPONSE','label','No response by due date'),
      jsonb_build_object('value','WITHDRAWN','label','Request withdrawn')
    ),
    'INFORMATION_REQUEST_STATUS', jsonb_build_array(
      jsonb_build_object('value','OPEN','label','Open'),
      jsonb_build_object('value','PARTIALLY_RESPONDED','label','Partially responded'),
      jsonb_build_object('value','RESPONDED','label','Responded'),
      jsonb_build_object('value','FULFILLED','label','Fulfilled'),
      jsonb_build_object('value','CANCELLED','label','Cancelled'),
      jsonb_build_object('value','OVERDUE','label','Overdue')
    ),
    'REQUIREMENT_CATALOGUE', jsonb_build_array(
      jsonb_build_object('value','IDENTITY_EVIDENCE','label','Identity of the claimant','group','ASSESSMENT'),
      jsonb_build_object('value','RESIDENCE_EVIDENCE','label','Residence of the household','group','ASSESSMENT'),
      jsonb_build_object('value','HOUSEHOLD_RELATIONSHIP_EVIDENCE','label','Household relationship','group','HOUSEHOLD'),
      jsonb_build_object('value','INCOME_EVIDENCE','label','Declared income','group','INCOME'),
      jsonb_build_object('value','ASSET_EVIDENCE','label','Declared asset value','group','ASSETS'),
      jsonb_build_object('value','DEDUCTION_EVIDENCE','label','Deduction or disregard claimed','group','DEDUCTIONS')
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_evidence_option(p_set text, p_value text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT x FROM jsonb_array_elements(
           COALESCE(public._bn_means_evidence_reference()->p_set,'[]'::jsonb)) AS x
   WHERE x->>'value' = p_value LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_evidence_label(p_set text, p_value text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(public._bn_means_evidence_option(p_set, p_value)->>'label', p_value);
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_evidence_rules(p_policy_version_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
           'require_identity_evidence', true,
           'require_residence_evidence', false,
           'income_evidence_obligation', 'MANDATORY',
           'asset_evidence_obligation', 'CONDITIONAL',
           'asset_evidence_threshold', 5000,
           'household_relationship_obligation', 'CONDITIONAL',
           'minimum_documents_per_requirement', 1,
           'block_on_unusable_evidence', true,
           'block_on_open_blocking_requests', true,
           'block_on_optional_requirements', false,
           'document_max_age_months', 12,
           'default_response_days', 14
         )
         || COALESCE((SELECT pv.required_evidence
                        FROM public.bn_means_policy_version pv
                       WHERE pv.policy_version_id = p_policy_version_id
                         AND jsonb_typeof(pv.required_evidence) = 'object'), '{}'::jsonb);
$function$;

-- Deterministic requirement identity ----------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_requirement_id(
  p_assessment_id uuid, p_code text, p_subject_kind text, p_subject_ref uuid)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT md5(p_assessment_id::text || '|' || p_code || '|' || p_subject_kind || '|'
             || COALESCE(p_subject_ref::text,''))::uuid;
$function$;

-- =====================================================================
-- Requirement derivation
-- =====================================================================
CREATE OR REPLACE FUNCTION public._bn_means_evidence_requirements(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a     public.bn_means_assessment%ROWTYPE;
  v_rules jsonb;
  v_out   jsonb := '[]'::jsonb;
  r       record;
  v_thr   numeric;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_rules := public._bn_means_evidence_rules(v_a.policy_version_id);
  v_thr := COALESCE((v_rules->>'asset_evidence_threshold')::numeric, 5000);

  IF COALESCE((v_rules->>'require_identity_evidence')::boolean, true) THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'IDENTITY_EVIDENCE','ASSESSMENT',NULL),
      'requirement_code','IDENTITY_EVIDENCE',
      'requirement_label','Identity of the claimant',
      'requirement_group','ASSESSMENT',
      'obligation','MANDATORY','minimum_count',1,
      'subject_kind','ASSESSMENT','subject_ref_id',NULL,
      'subject_label', COALESCE(v_a.assessment_reference,'This assessment'),
      'reason','Policy requires the identity of the claimant to be evidenced.',
      'policy_basis','require_identity_evidence'));
  END IF;

  IF COALESCE((v_rules->>'require_residence_evidence')::boolean, false) THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'RESIDENCE_EVIDENCE','ASSESSMENT',NULL),
      'requirement_code','RESIDENCE_EVIDENCE',
      'requirement_label','Residence of the household',
      'requirement_group','ASSESSMENT',
      'obligation','MANDATORY','minimum_count',1,
      'subject_kind','ASSESSMENT','subject_ref_id',NULL,
      'subject_label', COALESCE(v_a.assessment_reference,'This assessment'),
      'reason','Policy requires proof of where the household resides.',
      'policy_basis','require_residence_evidence'));
  END IF;

  FOR r IN
    SELECT m.member_id, m.relationship_code, m.is_dependant
      FROM public.bn_means_household_member m
     WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
       AND COALESCE(m.is_self,false) = false
     ORDER BY m.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'HOUSEHOLD_RELATIONSHIP_EVIDENCE','HOUSEHOLD_MEMBER',r.member_id),
      'requirement_code','HOUSEHOLD_RELATIONSHIP_EVIDENCE',
      'requirement_label','Household relationship',
      'requirement_group','HOUSEHOLD',
      'obligation', CASE WHEN COALESCE(r.is_dependant,false) THEN 'MANDATORY'
                         ELSE COALESCE(v_rules->>'household_relationship_obligation','CONDITIONAL') END,
      'minimum_count',1,
      'subject_kind','HOUSEHOLD_MEMBER','subject_ref_id', r.member_id,
      'subject_label', public._bn_means_household_label(r.member_id),
      'reason', CASE WHEN COALESCE(r.is_dependant,false)
                     THEN 'Dependency must be evidenced before it can be verified.'
                     ELSE 'Relationship to the claimant should be evidenced.' END,
      'policy_basis','household_relationship_obligation'));
  END LOOP;

  FOR r IN
    SELECT f.income_fact_id, f.category_code, f.declared_amount, f.effective_from, f.effective_to
      FROM public.bn_means_income_fact f
     WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
     ORDER BY f.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'INCOME_EVIDENCE','INCOME_FACT',r.income_fact_id),
      'requirement_code','INCOME_EVIDENCE',
      'requirement_label','Declared income',
      'requirement_group','INCOME',
      'obligation', COALESCE(v_rules->>'income_evidence_obligation','MANDATORY'),
      'minimum_count', COALESCE((v_rules->>'minimum_documents_per_requirement')::int,1),
      'subject_kind','INCOME_FACT','subject_ref_id', r.income_fact_id,
      'subject_label', public._bn_means_income_label(r.income_fact_id),
      'period_from', r.effective_from, 'period_to', r.effective_to,
      'reason','Declared income must be supported before it can be verified.',
      'policy_basis','income_evidence_obligation'));
  END LOOP;

  FOR r IN
    SELECT a.asset_fact_id, a.valuation_amount
      FROM public.bn_means_asset_fact a
     WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL
     ORDER BY a.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'ASSET_EVIDENCE','ASSET_FACT',r.asset_fact_id),
      'requirement_code','ASSET_EVIDENCE',
      'requirement_label','Declared asset value',
      'requirement_group','ASSETS',
      'obligation', CASE WHEN COALESCE(r.valuation_amount,0) >= v_thr THEN 'MANDATORY'
                         ELSE COALESCE(v_rules->>'asset_evidence_obligation','CONDITIONAL') END,
      'minimum_count',1,
      'subject_kind','ASSET_FACT','subject_ref_id', r.asset_fact_id,
      'subject_label', public._bn_means_asset_label(r.asset_fact_id),
      'reason', CASE WHEN COALESCE(r.valuation_amount,0) >= v_thr
                     THEN 'Valuation is at or above the policy evidence threshold.'
                     ELSE 'Supporting valuation evidence is expected where available.' END,
      'policy_basis','asset_evidence_threshold'));
  END LOOP;

  FOR r IN
    SELECT d.deduction_fact_id, d.evidence_requirement
      FROM public.bn_means_deduction_fact d
     WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
     ORDER BY d.created_at
  LOOP
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'requirement_id', public._bn_means_requirement_id(p_assessment_id,'DEDUCTION_EVIDENCE','DEDUCTION_FACT',r.deduction_fact_id),
      'requirement_code','DEDUCTION_EVIDENCE',
      'requirement_label','Deduction or disregard claimed',
      'requirement_group','DEDUCTIONS',
      'obligation', CASE WHEN COALESCE(r.evidence_requirement,'OPTIONAL') = 'REQUIRED'
                         THEN 'MANDATORY' ELSE 'OPTIONAL' END,
      'minimum_count',1,
      'subject_kind','DEDUCTION_FACT','subject_ref_id', r.deduction_fact_id,
      'subject_label', public._bn_means_deduction_label('DEDUCTION_CATEGORY', NULL),
      'reason','The claimed basis must be evidenced before any allowance can be considered.',
      'policy_basis','deduction_evidence_requirement'));
  END LOOP;

  RETURN v_out;
END;
$function$;

-- =====================================================================
-- Readiness
-- =====================================================================
CREATE OR REPLACE FUNCTION public._bn_means_evidence_readiness(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a         public.bn_means_assessment%ROWTYPE;
  v_rules     jsonb;
  v_reqs      jsonb;
  v_items     jsonb := '[]'::jsonb;
  v_block     jsonb := '[]'::jsonb;
  v_warn      jsonb := '[]'::jsonb;
  v_codes     jsonb := '[]'::jsonb;
  r           jsonb;
  v_recv      int;
  v_usable    int;
  v_issue     int;
  v_total     int := 0;
  v_mand      int := 0;
  v_mand_ok   int := 0;
  v_opt_open  int := 0;
  v_unusable  int := 0;
  v_open_req  int := 0;
  v_block_req int := 0;
  v_overdue   int := 0;
  v_links     int := 0;
  v_deds_done boolean;
  v_marked    boolean;
  v_status    text;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_rules := public._bn_means_evidence_rules(v_a.policy_version_id);
  v_reqs  := COALESCE(public._bn_means_evidence_requirements(p_assessment_id), '[]'::jsonb);

  FOR r IN SELECT * FROM jsonb_array_elements(v_reqs) LOOP
    SELECT count(*),
           count(*) FILTER (WHERE l.usability_status IN ('RECEIVED','USABLE')),
           count(*) FILTER (WHERE l.usability_status IN ('UNREADABLE','WRONG_DOCUMENT','EXPIRED','INCOMPLETE'))
      INTO v_recv, v_usable, v_issue
      FROM public.bn_means_evidence_link l
     WHERE l.assessment_id = p_assessment_id
       AND l.link_status = 'LINKED'
       AND l.requirement_code = (r->>'requirement_code')
       AND l.subject_kind = (r->>'subject_kind')
       AND l.subject_ref_id IS NOT DISTINCT FROM NULLIF(r->>'subject_ref_id','')::uuid;

    v_total := v_total + 1;
    v_unusable := v_unusable + v_issue;

    v_items := v_items || jsonb_build_array(r || jsonb_build_object(
      'received_count', v_recv,
      'usable_count', v_usable,
      'issue_count', v_issue,
      'satisfied', (v_usable >= COALESCE((r->>'minimum_count')::int,1)),
      'outstanding', (v_usable < COALESCE((r->>'minimum_count')::int,1))));

    IF (r->>'obligation') = 'MANDATORY' THEN
      v_mand := v_mand + 1;
      IF v_usable >= COALESCE((r->>'minimum_count')::int,1) THEN v_mand_ok := v_mand_ok + 1; END IF;
    ELSIF v_usable = 0 THEN
      v_opt_open := v_opt_open + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_links FROM public.bn_means_evidence_link
   WHERE assessment_id = p_assessment_id AND link_status = 'LINKED';

  SELECT count(*) FILTER (WHERE status NOT IN ('FULFILLED','CANCELLED')),
         count(*) FILTER (WHERE status NOT IN ('FULFILLED','CANCELLED') AND is_blocking),
         count(*) FILTER (WHERE status NOT IN ('FULFILLED','CANCELLED')
                            AND due_date IS NOT NULL AND due_date < current_date)
    INTO v_open_req, v_block_req, v_overdue
    FROM public.bn_means_information_request
   WHERE assessment_id = p_assessment_id;

  v_deds_done := EXISTS (SELECT 1 FROM public.bn_means_section_completion sc
                          WHERE sc.assessment_id = p_assessment_id
                            AND sc.section_code = 'DEDUCTIONS' AND sc.reopened_at IS NULL);
  v_marked := EXISTS (SELECT 1 FROM public.bn_means_section_completion sc
                       WHERE sc.assessment_id = p_assessment_id
                         AND sc.section_code = 'EVIDENCE' AND sc.reopened_at IS NULL);

  IF NOT v_deds_done THEN
    v_codes := v_codes || '"DEDUCTION_SECTION_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','DEDUCTION_SECTION_INCOMPLETE',
      'message','Complete deductions and disregards before completing evidence.'));
  END IF;

  IF v_mand > v_mand_ok THEN
    v_codes := v_codes || '"MANDATORY_EVIDENCE_OUTSTANDING"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','MANDATORY_EVIDENCE_OUTSTANDING',
      'message', (v_mand - v_mand_ok) || ' mandatory evidence requirement(s) are still outstanding.'));
  END IF;

  IF v_unusable > 0 THEN
    IF COALESCE((v_rules->>'block_on_unusable_evidence')::boolean,true) THEN
      v_codes := v_codes || '"EVIDENCE_NOT_USABLE"'::jsonb;
      v_block := v_block || jsonb_build_array(jsonb_build_object(
        'code','EVIDENCE_NOT_USABLE',
        'message', v_unusable || ' linked document(s) cannot be used. Replace them or request the information again.'));
    ELSE
      v_codes := v_codes || '"EVIDENCE_NOT_USABLE"'::jsonb;
      v_warn := v_warn || jsonb_build_array(jsonb_build_object(
        'code','EVIDENCE_NOT_USABLE',
        'message', v_unusable || ' linked document(s) have usability issues.'));
    END IF;
  END IF;

  IF v_block_req > 0 AND COALESCE((v_rules->>'block_on_open_blocking_requests')::boolean,true) THEN
    v_codes := v_codes || '"INFORMATION_REQUEST_OPEN"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','INFORMATION_REQUEST_OPEN',
      'message', v_block_req || ' blocking information request(s) are still open.'));
  END IF;

  IF v_overdue > 0 THEN
    v_codes := v_codes || '"INFORMATION_REQUEST_OVERDUE"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','INFORMATION_REQUEST_OVERDUE',
      'message', v_overdue || ' information request(s) are past their due date.'));
  END IF;

  IF v_opt_open > 0 THEN
    v_codes := v_codes || '"OPTIONAL_EVIDENCE_OUTSTANDING"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','OPTIONAL_EVIDENCE_OUTSTANDING',
      'message', v_opt_open || ' non-mandatory requirement(s) have no document linked.'));
  END IF;

  v_status := CASE
    WHEN jsonb_array_length(v_block) > 0 THEN 'BLOCKED'
    WHEN v_total = 0 AND v_links = 0 THEN 'NOT_STARTED'
    WHEN v_links = 0 THEN 'NOT_STARTED'
    ELSE 'COMPLETE' END;

  RETURN jsonb_build_object(
    'assessment_id', p_assessment_id,
    'section_complete', (jsonb_array_length(v_block) = 0),
    'section_status', v_status,
    'section_marked_complete', v_marked,
    'completion_invalidated', (v_marked AND jsonb_array_length(v_block) > 0),
    'requirement_total', v_total,
    'mandatory_total', v_mand,
    'mandatory_satisfied', v_mand_ok,
    'mandatory_outstanding', (v_mand - v_mand_ok),
    'optional_outstanding', v_opt_open,
    'linked_document_count', v_links,
    'unusable_document_count', v_unusable,
    'open_information_requests', v_open_req,
    'blocking_information_requests', v_block_req,
    'overdue_information_requests', v_overdue,
    'requirements', v_items,
    'rules', v_rules,
    'warnings', v_warn,
    'blockers', v_block,
    'reason_codes', v_codes);
END;
$function$;

-- =====================================================================
-- Governed reads
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bn_means_evidence_readiness_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb; v_data jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_data := public._bn_means_evidence_readiness(p_assessment_id);
  IF v_data IS NULL THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', v_data);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_evidence_reference_v1(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', public._bn_means_evidence_reference());
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_evidence_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_means_assessment%ROWTYPE;
  v_links jsonb; v_reqs jsonb; v_ready jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  v_reqs  := COALESCE(public._bn_means_evidence_requirements(p_assessment_id),'[]'::jsonb);
  v_ready := public._bn_means_evidence_readiness(p_assessment_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.linked_at DESC),'[]'::jsonb)
    INTO v_links FROM public.bn_means_evidence_link l
   WHERE l.assessment_id = p_assessment_id;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'status', v_a.status,
    'editable', public._bn_means_is_editable(v_a.status),
    'row_version', v_a.row_version,
    'requirements', v_reqs,
    'links', v_links,
    'readiness', v_ready,
    'information_requests', COALESCE((
      SELECT jsonb_agg(to_jsonb(ir) ORDER BY ir.requested_at DESC)
        FROM public.bn_means_information_request ir
       WHERE ir.assessment_id = p_assessment_id),'[]'::jsonb),
    'information_responses', COALESCE((
      SELECT jsonb_agg(to_jsonb(rs) ORDER BY rs.recorded_at DESC)
        FROM public.bn_means_information_response rs
       WHERE rs.assessment_id = p_assessment_id),'[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_document_search_v1(
  p_actor_user_id uuid, p_assessment_id uuid, p_term text DEFAULT NULL, p_limit int DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_means_assessment%ROWTYPE; v_rows jsonb; v_term text;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  v_term := '%' || COALESCE(NULLIF(trim(p_term),''),'') || '%';

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'received_at' DESC),'[]'::jsonb) INTO v_rows FROM (
    (SELECT jsonb_build_object(
             'document_source','BN_CLAIM_EVIDENCE',
             'document_ref', e.id::text,
             'document_title', COALESCE(e.document_name, e.file_name,'Claim evidence'),
             'document_type_code', e.document_type_code,
             'status', e.status,
             'received_at', COALESCE(e.entered_at, e.modified_at)) AS x
      FROM public.bn_claim_evidence e
     WHERE v_a.claim_id IS NOT NULL AND e.claim_id = v_a.claim_id
       AND (COALESCE(e.document_name,'') ILIKE v_term OR COALESCE(e.document_type_code,'') ILIKE v_term
            OR COALESCE(e.file_name,'') ILIKE v_term)
     LIMIT GREATEST(p_limit,1))
    UNION ALL
    (SELECT jsonb_build_object(
             'document_source','BN_CLAIM_DOCUMENT',
             'document_ref', d.id::text,
             'document_title', COALESCE(d.document_name, d.file_name,'Claim document'),
             'document_type_code', d.document_type_code,
             'status', d.verification_status,
             'received_at', COALESCE(d.uploaded_at, d.entered_at)) AS x
      FROM public.bn_claim_document d
     WHERE v_a.claim_id IS NOT NULL AND d.claim_id = v_a.claim_id
       AND (COALESCE(d.document_name,'') ILIKE v_term OR COALESCE(d.document_type_code,'') ILIKE v_term
            OR COALESCE(d.file_name,'') ILIKE v_term)
     LIMIT GREATEST(p_limit,1))
  ) s;

  RETURN jsonb_build_object('status','OK','data', v_rows);
END;
$function$;

-- =====================================================================
-- Governed supporting operations
-- =====================================================================
CREATE OR REPLACE FUNCTION public._bn_means_evidence_execute(
  p_command_name text, p_assessment_id uuid, p_from_status text, p_actor_user_id uuid,
  p_actor_user_code text, p_correlation_id uuid, p_reason_code text, p_justification text,
  p_payload jsonb, p_row_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_a       public.bn_means_assessment%ROWTYPE;
  v_rules   jsonb;
  v_link    public.bn_means_evidence_link%ROWTYPE;
  v_req     public.bn_means_information_request%ROWTYPE;
  v_new     uuid;
  v_evi     uuid;
  v_code    text;
  v_kind    text;
  v_ref     uuid;
  v_status  text;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:assessment'; END IF;
  v_rules := public._bn_means_evidence_rules(v_a.policy_version_id);

  IF p_from_status NOT IN ('DRAFT','INFORMATION_PENDING','INCOMPLETE','SUBMITTED',
                           'VERIFICATION_PENDING','CALCULATED','REVIEW_PENDING','APPROVAL_PENDING') THEN
    RAISE EXCEPTION 'E_INVALID_STATE:% cannot change evidence', p_from_status;
  END IF;

  IF p_command_name = 'BN_MEANS_ATTACH_EVIDENCE' THEN
    v_code := NULLIF(p_payload->>'requirement_code','');
    v_kind := COALESCE(NULLIF(p_payload->>'subject_kind',''),'ASSESSMENT');
    v_ref  := NULLIF(p_payload->>'subject_ref_id','')::uuid;
    IF v_code IS NULL THEN RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:requirement_code'; END IF;
    IF COALESCE(p_payload->>'document_ref','') = '' THEN
      RAISE EXCEPTION 'E_EVIDENCE_REFERENCE_REQUIRED:%', p_command_name;
    END IF;
    IF v_kind <> 'ASSESSMENT' AND v_ref IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:subject_ref_id';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bn_means_evidence_link l
                WHERE l.assessment_id = p_assessment_id AND l.link_status = 'LINKED'
                  AND l.requirement_code = v_code AND l.subject_kind = v_kind
                  AND l.subject_ref_id IS NOT DISTINCT FROM v_ref
                  AND l.document_source = COALESCE(p_payload->>'document_source','BN_CLAIM_EVIDENCE')
                  AND l.document_ref = (p_payload->>'document_ref')) THEN
      RAISE EXCEPTION 'E_DUPLICATE_EVIDENCE_LINK:% already supports this requirement', p_payload->>'document_ref';
    END IF;

    INSERT INTO public.bn_means_evidence(
      assessment_id, fact_kind, fact_id, evidence_type, dms_document_id, dms_reference,
      status, received_at, notes, correlation_id, created_by)
    VALUES (p_assessment_id,
      CASE v_kind WHEN 'INCOME_FACT' THEN 'INCOME' WHEN 'ASSET_FACT' THEN 'ASSET'
                  WHEN 'DEDUCTION_FACT' THEN 'DEDUCTION' WHEN 'HOUSEHOLD_MEMBER' THEN 'HOUSEHOLD'
                  ELSE 'ASSESSMENT' END,
      v_ref, COALESCE(NULLIF(p_payload->>'evidence_type',''),'OTHER_SUPPORTING'),
      NULLIF(p_payload->>'document_ref',''), NULLIF(p_payload->>'document_title',''),
      'ATTACHED', now(), NULLIF(p_payload->>'officer_notes',''), p_correlation_id, p_actor_user_id)
    RETURNING evidence_id INTO v_evi;

    INSERT INTO public.bn_means_evidence_link(
      assessment_id, evidence_id, requirement_code, subject_kind, subject_ref_id,
      document_source, document_ref, document_title, document_type_code, evidence_type,
      evidence_source, document_date, period_from, period_to, expiry_date,
      usability_status, information_request_id, officer_notes, correlation_id,
      linked_by, created_by, updated_by)
    VALUES (p_assessment_id, v_evi, v_code, v_kind, v_ref,
      COALESCE(NULLIF(p_payload->>'document_source',''),'BN_CLAIM_EVIDENCE'),
      p_payload->>'document_ref', NULLIF(p_payload->>'document_title',''),
      NULLIF(p_payload->>'document_type_code',''),
      COALESCE(NULLIF(p_payload->>'evidence_type',''),'OTHER_SUPPORTING'),
      NULLIF(p_payload->>'evidence_source',''),
      NULLIF(p_payload->>'document_date','')::date,
      NULLIF(p_payload->>'period_from','')::date,
      NULLIF(p_payload->>'period_to','')::date,
      NULLIF(p_payload->>'expiry_date','')::date,
      'RECEIVED', NULLIF(p_payload->>'information_request_id','')::uuid,
      NULLIF(p_payload->>'officer_notes',''), p_correlation_id,
      p_actor_user_id, p_actor_user_id, p_actor_user_id)
    RETURNING link_id INTO v_new;

    IF v_kind = 'INCOME_FACT' THEN
      UPDATE public.bn_means_income_fact SET evidence_status = 'ATTACHED'
       WHERE income_fact_id = v_ref AND assessment_id = p_assessment_id;
    ELSIF v_kind = 'ASSET_FACT' THEN
      UPDATE public.bn_means_asset_fact SET evidence_status = 'ATTACHED'
       WHERE asset_fact_id = v_ref AND assessment_id = p_assessment_id;
    ELSIF v_kind = 'DEDUCTION_FACT' THEN
      UPDATE public.bn_means_deduction_fact SET evidence_status = 'ATTACHED'
       WHERE deduction_fact_id = v_ref AND assessment_id = p_assessment_id;
    ELSIF v_kind = 'HOUSEHOLD_MEMBER' THEN
      UPDATE public.bn_means_household_member SET evidence_status = 'ATTACHED'
       WHERE member_id = v_ref AND assessment_id = p_assessment_id;
    END IF;

    RETURN jsonb_build_object('link_id', v_new, 'evidence_id', v_evi, 'event_code','EVIDENCE_ATTACHED');

  ELSIF p_command_name = 'BN_MEANS_UNLINK_EVIDENCE' THEN
    SELECT * INTO v_link FROM public.bn_means_evidence_link
     WHERE link_id = NULLIF(p_payload->>'link_id','')::uuid AND assessment_id = p_assessment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:evidence link'; END IF;
    IF v_link.link_status <> 'LINKED' THEN RAISE EXCEPTION 'E_INVALID_STATE:already unlinked'; END IF;
    IF COALESCE(p_reason_code, p_payload->>'reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:reason_code';
    END IF;
    UPDATE public.bn_means_evidence_link
       SET link_status = 'UNLINKED', unlinked_at = now(), unlinked_by = p_actor_user_id,
           unlink_reason_code = COALESCE(p_reason_code, p_payload->>'reason_code'),
           updated_at = now(), updated_by = p_actor_user_id
     WHERE link_id = v_link.link_id;
    RETURN jsonb_build_object('link_id', v_link.link_id, 'event_code','EVIDENCE_UNLINKED');

  ELSIF p_command_name = 'BN_MEANS_RECORD_EVIDENCE_USABILITY' THEN
    SELECT * INTO v_link FROM public.bn_means_evidence_link
     WHERE link_id = NULLIF(p_payload->>'link_id','')::uuid AND assessment_id = p_assessment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:evidence link'; END IF;
    IF v_link.link_status <> 'LINKED' THEN RAISE EXCEPTION 'E_INVALID_STATE:link is not active'; END IF;
    v_status := NULLIF(p_payload->>'usability_status','');
    IF public._bn_means_evidence_option('EVIDENCE_USABILITY_STATUS', v_status) IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_VALUE:usability_status';
    END IF;
    IF COALESCE((public._bn_means_evidence_option('EVIDENCE_USABILITY_STATUS', v_status)->>'is_issue')::boolean,false)
       AND COALESCE(p_payload->>'usability_reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:usability_reason_code';
    END IF;
    UPDATE public.bn_means_evidence_link
       SET usability_status = v_status,
           usability_reason_code = NULLIF(p_payload->>'usability_reason_code',''),
           usability_note = NULLIF(p_payload->>'usability_note',''),
           usability_checked_at = now(), usability_checked_by = p_actor_user_id,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE link_id = v_link.link_id;
    RETURN jsonb_build_object('link_id', v_link.link_id, 'usability_status', v_status,
                              'event_code','EVIDENCE_USABILITY_RECORDED');

  ELSIF p_command_name = 'BN_MEANS_REQUEST_INFORMATION' THEN
    IF COALESCE(p_payload->>'information_required','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:information_required';
    END IF;
    IF public._bn_means_evidence_option('INFORMATION_REQUEST_TYPE', COALESCE(p_payload->>'request_type','DOCUMENT_REQUEST')) IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_VALUE:request_type';
    END IF;
    IF public._bn_means_evidence_option('INFORMATION_REQUEST_RECIPIENT', COALESCE(p_payload->>'recipient_kind','CLAIMANT')) IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_VALUE:recipient_kind';
    END IF;
    INSERT INTO public.bn_means_information_request(
      assessment_id, request_code, request_type, request_reference, requirement_code,
      subject_kind, subject_ref_id, recipient_kind, recipient_label, reason_code,
      information_required, details, status, due_date, is_blocking,
      requested_at, requested_by, correlation_id)
    VALUES (p_assessment_id,
      COALESCE(NULLIF(p_payload->>'requirement_code',''), COALESCE(p_payload->>'request_type','DOCUMENT_REQUEST')),
      COALESCE(p_payload->>'request_type','DOCUMENT_REQUEST'),
      'IR-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,6),
      NULLIF(p_payload->>'requirement_code',''),
      NULLIF(p_payload->>'subject_kind',''), NULLIF(p_payload->>'subject_ref_id','')::uuid,
      COALESCE(p_payload->>'recipient_kind','CLAIMANT'), NULLIF(p_payload->>'recipient_label',''),
      COALESCE(p_reason_code, p_payload->>'reason_code','EVIDENCE_MISSING'),
      p_payload->>'information_required', NULLIF(p_payload->>'details',''),
      'OPEN',
      COALESCE(NULLIF(p_payload->>'due_date','')::date,
               current_date + COALESCE((v_rules->>'default_response_days')::int,14)),
      COALESCE((p_payload->>'is_blocking')::boolean, true),
      now(), p_actor_user_id, p_correlation_id)
    RETURNING request_id INTO v_new;
    RETURN jsonb_build_object('request_id', v_new, 'event_code','INFORMATION_REQUESTED');

  ELSIF p_command_name = 'BN_MEANS_RECORD_INFORMATION_RESPONSE' THEN
    SELECT * INTO v_req FROM public.bn_means_information_request
     WHERE request_id = NULLIF(p_payload->>'request_id','')::uuid AND assessment_id = p_assessment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:information request'; END IF;
    IF v_req.status IN ('FULFILLED','CANCELLED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:request is already closed';
    END IF;
    IF public._bn_means_evidence_option('INFORMATION_RESPONSE_KIND', COALESCE(p_payload->>'response_kind','')) IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_VALUE:response_kind';
    END IF;
    INSERT INTO public.bn_means_information_response(
      request_id, assessment_id, response_kind, note, evidence_link_id, correlation_id, recorded_by)
    VALUES (v_req.request_id, p_assessment_id, p_payload->>'response_kind',
            NULLIF(p_payload->>'note',''), NULLIF(p_payload->>'evidence_link_id','')::uuid,
            p_correlation_id, p_actor_user_id)
    RETURNING response_id INTO v_new;
    UPDATE public.bn_means_information_request
       SET status = CASE p_payload->>'response_kind'
                      WHEN 'FULL_RESPONSE' THEN 'RESPONDED'
                      WHEN 'PARTIAL_RESPONSE' THEN 'PARTIALLY_RESPONDED'
                      ELSE 'OPEN' END,
           responded_at = now(), responded_by = p_actor_user_id,
           response_summary = NULLIF(p_payload->>'note',''),
           updated_at = now(), updated_by = p_actor_user_id
     WHERE request_id = v_req.request_id;
    RETURN jsonb_build_object('response_id', v_new, 'request_id', v_req.request_id,
                              'event_code','INFORMATION_RESPONSE_RECORDED');

  ELSIF p_command_name = 'BN_MEANS_CLOSE_INFORMATION_REQUEST' THEN
    SELECT * INTO v_req FROM public.bn_means_information_request
     WHERE request_id = NULLIF(p_payload->>'request_id','')::uuid AND assessment_id = p_assessment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:information request'; END IF;
    IF v_req.status IN ('FULFILLED','CANCELLED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:request is already closed';
    END IF;
    v_status := COALESCE(p_payload->>'outcome','FULFILLED');
    IF v_status NOT IN ('FULFILLED','CANCELLED') THEN RAISE EXCEPTION 'E_INVALID_VALUE:outcome'; END IF;
    IF v_status = 'CANCELLED' AND COALESCE(p_reason_code, p_payload->>'reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:reason_code';
    END IF;
    UPDATE public.bn_means_information_request
       SET status = v_status, closed_at = now(), closed_by = p_actor_user_id,
           close_reason_code = COALESCE(p_reason_code, p_payload->>'reason_code'),
           updated_at = now(), updated_by = p_actor_user_id
     WHERE request_id = v_req.request_id;
    RETURN jsonb_build_object('request_id', v_req.request_id, 'outcome', v_status,
                              'event_code','INFORMATION_REQUEST_CLOSED');

  ELSIF p_command_name = 'BN_MEANS_MARK_EVIDENCE_COMPLETE' THEN
    IF NOT COALESCE((public._bn_means_evidence_readiness(p_assessment_id)->>'section_complete')::boolean,false) THEN
      RAISE EXCEPTION 'E_SECTION_NOT_READY:EVIDENCE';
    END IF;
    INSERT INTO public.bn_means_section_completion(assessment_id, section_code, completed_at, completed_by)
    VALUES (p_assessment_id, 'EVIDENCE', now(), p_actor_user_id)
    ON CONFLICT (assessment_id, section_code)
      DO UPDATE SET completed_at = now(), completed_by = p_actor_user_id,
                    reopened_at = NULL, reopened_by = NULL, updated_at = now();
    RETURN jsonb_build_object('section_code','EVIDENCE','event_code','SECTION_COMPLETED');

  ELSIF p_command_name = 'BN_MEANS_REOPEN_EVIDENCE' THEN
    UPDATE public.bn_means_section_completion
       SET reopened_at = now(), reopened_by = p_actor_user_id, updated_at = now()
     WHERE assessment_id = p_assessment_id AND section_code = 'EVIDENCE';
    RETURN jsonb_build_object('section_code','EVIDENCE','event_code','SECTION_REOPENED');
  END IF;

  RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED:%', p_command_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_evidence_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_reason_code text,
  p_justification text, p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm  jsonb;
  v_prior public.bn_means_command_idempotency%ROWTYPE;
  v_a     public.bn_means_assessment%ROWTYPE;
  v_from  text;
  v_res   jsonb;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name; END IF;
  IF p_command_name NOT IN ('BN_MEANS_ATTACH_EVIDENCE','BN_MEANS_UNLINK_EVIDENCE',
      'BN_MEANS_RECORD_EVIDENCE_USABILITY','BN_MEANS_REQUEST_INFORMATION',
      'BN_MEANS_RECORD_INFORMATION_RESPONSE','BN_MEANS_CLOSE_INFORMATION_REQUEST',
      'BN_MEANS_MARK_EVIDENCE_COMPLETE','BN_MEANS_REOPEN_EVIDENCE') THEN
    RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
  END IF;

  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'write', true);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'E_FORBIDDEN:%', COALESCE(v_perm->>'code','FORBIDDEN');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.bn_means_command_idempotency
     WHERE idempotency_key = p_idempotency_key AND command_name = p_command_name;
    IF FOUND THEN
      IF COALESCE(v_prior.payload_hash,'') <> COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH:%', p_command_name;
      END IF;
      RETURN COALESCE(v_prior.result_json,'{}'::jsonb) || jsonb_build_object('status','REPLAYED');
    END IF;
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment
   WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:assessment'; END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_a.row_version THEN
    RAISE EXCEPTION 'E_VERSION_CONFLICT:% <> %', p_expected_row_version, v_a.row_version;
  END IF;
  v_from := v_a.status;

  v_res := public._bn_means_evidence_execute(p_command_name, p_assessment_id, v_from,
             p_actor_user_id, p_actor_user_code, p_correlation_id, p_reason_code,
             p_justification, COALESCE(p_payload,'{}'::jsonb), v_a.row_version);

  UPDATE public.bn_means_assessment
     SET row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
   WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;

  v_res := v_res || jsonb_build_object('assessment_id', p_assessment_id,
                                       'entity_version', v_a.row_version);

  PERFORM public._bn_means_event(p_assessment_id,
    COALESCE(v_res->>'event_code','FACT_RECORDED'), p_command_name, v_from, v_a.status,
    p_reason_code, p_justification, v_res, p_actor_user_id, p_actor_user_code,
    p_correlation_id, v_a.row_version);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_means_command_idempotency(
      idempotency_key, command_name, payload_hash, assessment_id, entity_version,
      result_json, status, completed_at, actor_user_id)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), p_assessment_id,
      v_a.row_version, v_res, 'COMPLETED', now(), p_actor_user_id)
    ON CONFLICT (idempotency_key, command_name) DO NOTHING;
  END IF;

  RETURN v_res || jsonb_build_object('status','EXECUTED');
END;
$function$;

REVOKE ALL ON FUNCTION public.bn_means_evidence_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_evidence_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_evidence_execute(text,uuid,text,uuid,text,uuid,text,text,jsonb,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_means_evidence_execute(text,uuid,text,uuid,text,uuid,text,text,jsonb,bigint) TO service_role;

REVOKE ALL ON FUNCTION public.bn_means_evidence_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_evidence_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_evidence_readiness_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_evidence_readiness_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_evidence_reference_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_evidence_reference_v1(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_document_search_v1(uuid,uuid,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_document_search_v1(uuid,uuid,text,int) TO authenticated, service_role;

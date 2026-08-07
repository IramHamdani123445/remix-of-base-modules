-- ============================================================
-- MEANS-TEST EPIC 5 — Deductions and Disregards
-- ============================================================

-- 1. Income facts may also carry a policy-defined disregard candidate marker.
ALTER TABLE public.bn_means_income_fact
  ADD COLUMN IF NOT EXISTS disregard_candidate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disregard_reason_code text;

-- 2. Extend the deduction fact into a claim register ----------
ALTER TABLE public.bn_means_deduction_fact
  ADD COLUMN IF NOT EXISTS claim_kind           text NOT NULL DEFAULT 'DEDUCTION_CLAIM',
  ADD COLUMN IF NOT EXISTS target_kind          text NOT NULL DEFAULT 'HOUSEHOLD_MEMBER',
  ADD COLUMN IF NOT EXISTS target_ref_id        uuid,
  ADD COLUMN IF NOT EXISTS claimed_percentage   numeric(6,3),
  ADD COLUMN IF NOT EXISTS claim_reason_code    text,
  ADD COLUMN IF NOT EXISTS fact_source          text NOT NULL DEFAULT 'APPLICANT_DECLARATION',
  ADD COLUMN IF NOT EXISTS evidence_requirement text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS officer_notes        text,
  ADD COLUMN IF NOT EXISTS treatment_status     text NOT NULL DEFAULT 'CLAIMED',
  ADD COLUMN IF NOT EXISTS fact_version         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_fact_id   uuid,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by           uuid;

ALTER TABLE public.bn_means_deduction_fact
  ALTER COLUMN claimed_amount DROP NOT NULL,
  ALTER COLUMN normalised_annual_amount DROP NOT NULL,
  ALTER COLUMN declared_frequency DROP NOT NULL,
  ALTER COLUMN declared_frequency DROP DEFAULT;

ALTER TABLE public.bn_means_deduction_fact
  DROP CONSTRAINT IF EXISTS bn_means_deduction_claim_kind_ck;
ALTER TABLE public.bn_means_deduction_fact
  ADD CONSTRAINT bn_means_deduction_claim_kind_ck
  CHECK (claim_kind IN ('DEDUCTION_CLAIM','DISREGARD_CANDIDATE'));

ALTER TABLE public.bn_means_deduction_fact
  DROP CONSTRAINT IF EXISTS bn_means_deduction_target_kind_ck;
ALTER TABLE public.bn_means_deduction_fact
  ADD CONSTRAINT bn_means_deduction_target_kind_ck
  CHECK (target_kind IN ('HOUSEHOLD_MEMBER','INCOME_FACT','ASSET_FACT','ASSESSMENT'));

ALTER TABLE public.bn_means_deduction_fact
  DROP CONSTRAINT IF EXISTS bn_means_deduction_treatment_ck;
ALTER TABLE public.bn_means_deduction_fact
  ADD CONSTRAINT bn_means_deduction_treatment_ck
  CHECK (treatment_status IN ('CLAIMED','PENDING_EVIDENCE','PENDING_VERIFICATION','READY_FOR_ASSESSMENT','VOIDED'));

ALTER TABLE public.bn_means_deduction_fact
  DROP CONSTRAINT IF EXISTS bn_means_deduction_evidence_req_ck;
ALTER TABLE public.bn_means_deduction_fact
  ADD CONSTRAINT bn_means_deduction_evidence_req_ck
  CHECK (evidence_requirement IN ('REQUIRED','OPTIONAL','NOT_REQUIRED'));

ALTER TABLE public.bn_means_deduction_fact
  DROP CONSTRAINT IF EXISTS bn_means_deduction_percentage_ck;
ALTER TABLE public.bn_means_deduction_fact
  ADD CONSTRAINT bn_means_deduction_percentage_ck
  CHECK (claimed_percentage IS NULL OR (claimed_percentage > 0 AND claimed_percentage <= 100));

CREATE INDEX IF NOT EXISTS bn_means_deduction_fact_open_idx
  ON public.bn_means_deduction_fact(assessment_id) WHERE voided_at IS NULL;

GRANT SELECT ON public.bn_means_deduction_fact TO authenticated;
GRANT ALL ON public.bn_means_deduction_fact TO service_role;

-- 3. Explicit "none claimed" declaration ----------------------
CREATE TABLE IF NOT EXISTS public.bn_means_no_deduction_declaration (
  declaration_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id       uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  declaration_scope   text NOT NULL DEFAULT 'ASSESSMENT',
  member_id           uuid REFERENCES public.bn_means_household_member(member_id) ON DELETE CASCADE,
  reason_code         text,
  confirmation_note   text,
  declaration_source  text NOT NULL DEFAULT 'APPLICANT_DECLARATION',
  declared_by         uuid,
  declared_at         timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_no_deduction_scope_ck CHECK (declaration_scope IN ('ASSESSMENT','MEMBER')),
  CONSTRAINT bn_means_no_deduction_member_ck
    CHECK ((declaration_scope = 'MEMBER' AND member_id IS NOT NULL)
        OR (declaration_scope = 'ASSESSMENT' AND member_id IS NULL))
);

GRANT SELECT ON public.bn_means_no_deduction_declaration TO authenticated;
GRANT ALL ON public.bn_means_no_deduction_declaration TO service_role;

CREATE INDEX IF NOT EXISTS bn_means_no_deduction_declaration_open_idx
  ON public.bn_means_no_deduction_declaration(assessment_id) WHERE voided_at IS NULL;

-- 4. Governed reference data ---------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_deduction_reference()
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'DEDUCTION_CATEGORY', jsonb_build_array(
      jsonb_build_object('value','PERMITTED_EMPLOYMENT_EXPENSE','label','Permitted employment expense',
        'description','An expense the policy recognises against employment income.',
        'claim_kind','DEDUCTION_CLAIM',
        'allowed_target_types', jsonb_build_array('INCOME_FACT','HOUSEHOLD_MEMBER'),
        'requires_amount',true,'requires_frequency',true,'requires_period',true,
        'requires_evidence',true,'requires_reason',true,'allows_partial_claim',false,
        'maximum_rule_reference','POLICY_EMPLOYMENT_EXPENSE_CAP',
        'verification_required',true,'calculation_treatment_code','INCOME_DEDUCTION'),
      jsonb_build_object('value','MAINTENANCE_PAID','label','Maintenance paid',
        'description','Maintenance the household pays to a person outside the household.',
        'claim_kind','DEDUCTION_CLAIM',
        'allowed_target_types', jsonb_build_array('HOUSEHOLD_MEMBER','ASSESSMENT'),
        'requires_amount',true,'requires_frequency',true,'requires_period',true,
        'requires_evidence',true,'requires_reason',true,'allows_partial_claim',false,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','HOUSEHOLD_DEDUCTION'),
      jsonb_build_object('value','REQUIRED_CARE_EXPENSE','label','Required care expense',
        'description','Care costs the policy recognises for a household member.',
        'claim_kind','DEDUCTION_CLAIM',
        'allowed_target_types', jsonb_build_array('HOUSEHOLD_MEMBER'),
        'requires_amount',true,'requires_frequency',true,'requires_period',true,
        'requires_evidence',true,'requires_reason',true,'allows_partial_claim',false,
        'maximum_rule_reference','POLICY_CARE_EXPENSE_CAP',
        'verification_required',true,'calculation_treatment_code','HOUSEHOLD_DEDUCTION'),
      jsonb_build_object('value','RECOGNISED_HOUSEHOLD_EXPENSE','label','Policy-recognised household expense',
        'description','A household-wide expense recognised by the effective policy.',
        'claim_kind','DEDUCTION_CLAIM',
        'allowed_target_types', jsonb_build_array('ASSESSMENT'),
        'requires_amount',true,'requires_frequency',true,'requires_period',true,
        'requires_evidence',false,'requires_reason',true,'allows_partial_claim',false,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','HOUSEHOLD_DEDUCTION'),
      jsonb_build_object('value','OTHER_CONFIGURED_DEDUCTION','label','Other configured deduction',
        'description','Any other deduction configured by the effective policy.',
        'claim_kind','DEDUCTION_CLAIM',
        'allowed_target_types', jsonb_build_array('HOUSEHOLD_MEMBER','INCOME_FACT','ASSET_FACT','ASSESSMENT'),
        'requires_amount',true,'requires_frequency',false,'requires_period',true,
        'requires_evidence',false,'requires_reason',true,'allows_partial_claim',false,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','OTHER_DEDUCTION'),
      jsonb_build_object('value','INCOME_DISREGARD','label','Income disregard',
        'description','A policy basis that may exclude some or all of an income record.',
        'claim_kind','DISREGARD_CANDIDATE',
        'allowed_target_types', jsonb_build_array('INCOME_FACT'),
        'requires_amount',false,'requires_frequency',false,'requires_period',true,
        'requires_evidence',false,'requires_reason',true,'allows_partial_claim',true,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','INCOME_DISREGARD'),
      jsonb_build_object('value','ASSET_DISREGARD','label','Asset disregard',
        'description','A policy basis that may exclude some or all of an asset record.',
        'claim_kind','DISREGARD_CANDIDATE',
        'allowed_target_types', jsonb_build_array('ASSET_FACT'),
        'requires_amount',false,'requires_frequency',false,'requires_period',false,
        'requires_evidence',false,'requires_reason',true,'allows_partial_claim',true,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','ASSET_DISREGARD'),
      jsonb_build_object('value','PRIMARY_RESIDENCE_DISREGARD','label','Primary residence disregard',
        'description','The dwelling occupied by the household may be excluded.',
        'claim_kind','DISREGARD_CANDIDATE',
        'allowed_target_types', jsonb_build_array('ASSET_FACT'),
        'requires_amount',false,'requires_frequency',false,'requires_period',false,
        'requires_evidence',false,'requires_reason',true,'allows_partial_claim',false,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','ASSET_DISREGARD'),
      jsonb_build_object('value','BUSINESS_USE_ASSET_DISREGARD','label','Business-use asset disregard',
        'description','An asset used in a trade or business may be partly excluded.',
        'claim_kind','DISREGARD_CANDIDATE',
        'allowed_target_types', jsonb_build_array('ASSET_FACT'),
        'requires_amount',false,'requires_frequency',false,'requires_period',false,
        'requires_evidence',true,'requires_reason',true,'allows_partial_claim',true,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','ASSET_DISREGARD'),
      jsonb_build_object('value','POLICY_SPECIFIC_EXCLUSION','label','Policy-specific exclusion',
        'description','Any other exclusion basis configured by the effective policy.',
        'claim_kind','DISREGARD_CANDIDATE',
        'allowed_target_types', jsonb_build_array('INCOME_FACT','ASSET_FACT','ASSESSMENT'),
        'requires_amount',false,'requires_frequency',false,'requires_period',false,
        'requires_evidence',false,'requires_reason',true,'allows_partial_claim',true,
        'maximum_rule_reference',NULL,
        'verification_required',true,'calculation_treatment_code','OTHER_DISREGARD')),
    'DEDUCTION_FREQUENCY', public._bn_means_income_reference()->'INCOME_FREQUENCY',
    'DEDUCTION_REASON', jsonb_build_array(
      jsonb_build_object('value','REQUIRED_FOR_EMPLOYMENT','label','Required in order to work'),
      jsonb_build_object('value','LEGAL_OBLIGATION','label','Legal or court-ordered obligation'),
      jsonb_build_object('value','CARE_NEED','label','Assessed care need'),
      jsonb_build_object('value','ESSENTIAL_HOUSEHOLD_NEED','label','Essential household need'),
      jsonb_build_object('value','OCCUPIED_AS_HOME','label','Occupied by the household as its home'),
      jsonb_build_object('value','USED_IN_BUSINESS','label','Used in a trade or business'),
      jsonb_build_object('value','STATUTORY_BASIS','label','Statutory basis in the effective policy'),
      jsonb_build_object('value','OTHER_CONFIGURED_BASIS','label','Other configured basis')),
    'DEDUCTION_FACT_SOURCE', jsonb_build_array(
      jsonb_build_object('value','APPLICANT_DECLARATION','label','Applicant declaration'),
      jsonb_build_object('value','CLAIM_INFORMATION','label','Claim information'),
      jsonb_build_object('value','EMPLOYER_INFORMATION','label','Employer information'),
      jsonb_build_object('value','FINANCIAL_RECORD','label','Financial record'),
      jsonb_build_object('value','EXISTING_BENEFIT_RECORD','label','Existing benefit record'),
      jsonb_build_object('value','OFFICER_CONFIRMED','label','Officer confirmed'),
      jsonb_build_object('value','EXTERNAL_EVIDENCE','label','External evidence')),
    'DEDUCTION_TARGET_KIND', jsonb_build_array(
      jsonb_build_object('value','HOUSEHOLD_MEMBER','label','Household member'),
      jsonb_build_object('value','INCOME_FACT','label','Recorded income'),
      jsonb_build_object('value','ASSET_FACT','label','Recorded asset'),
      jsonb_build_object('value','ASSESSMENT','label','Whole assessment')),
    'NO_DEDUCTION_REASON', jsonb_build_array(
      jsonb_build_object('value','NONE_CLAIMED','label','Nothing is being claimed'),
      jsonb_build_object('value','NO_QUALIFYING_EXPENSE','label','No qualifying expense exists'),
      jsonb_build_object('value','NO_DISREGARD_BASIS','label','No disregard basis applies'),
      jsonb_build_object('value','OTHER_CONFIRMED_REASON','label','Other confirmed reason'))
  );
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_deduction_option(p_set text, p_value text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT o FROM jsonb_array_elements(public._bn_means_deduction_reference()->p_set) o
   WHERE o->>'value' = p_value LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_deduction_label(p_set text, p_value text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(public._bn_means_deduction_option(p_set, p_value)->>'label', p_value);
$function$;

ALTER TABLE public.bn_means_policy_version
  ADD COLUMN IF NOT EXISTS deduction_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public._bn_means_deduction_rules(p_policy_version_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
           'none_declaration_scope','ASSESSMENT',
           'require_none_declaration_when_no_claims', true,
           'duplicate_treatment','BLOCK',
           'allow_assessment_level_claims', true,
           'block_when_required_evidence_missing', false,
           'disregard_decided_at_calculation', true)
         || COALESCE((SELECT COALESCE(pv.deduction_rules, '{}'::jsonb)
                        FROM public.bn_means_policy_version pv
                       WHERE pv.policy_version_id = p_policy_version_id), '{}'::jsonb);
$function$;

-- 5. Presentation projections --------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_deduction_target_json(
  p_assessment_id uuid, p_target_kind text, p_target_ref_id uuid, p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_target_kind = 'ASSESSMENT' THEN
    RETURN jsonb_build_object('target_label','Whole assessment',
      'target_detail','Applies to the household assessment as a whole.');
  ELSIF p_target_kind = 'HOUSEHOLD_MEMBER' THEN
    SELECT jsonb_build_object(
        'target_label', COALESCE(NULLIF(btrim(m.declared_person->>'full_name'),''),'Household member'),
        'target_detail', public._bn_means_household_label('RELATIONSHIP_TYPE', m.relationship_code)
                         || CASE WHEN m.member_to IS NULL OR m.member_to >= CURRENT_DATE
                                 THEN ' · Current member' ELSE ' · Membership ended' END)
      INTO v_out
      FROM public.bn_means_household_member m
     WHERE m.member_id = COALESCE(p_target_ref_id, p_member_id);
  ELSIF p_target_kind = 'INCOME_FACT' THEN
    SELECT jsonb_build_object(
        'target_label', public._bn_means_income_label('INCOME_CATEGORY', f.category_code)
                        || COALESCE(' · ' || NULLIF(f.source_name,''), ''),
        'target_detail', f.declared_amount::text || ' ' || f.currency_code || ' '
                        || public._bn_means_income_label('INCOME_FREQUENCY', f.declared_frequency)
                        || ' · ' || f.effective_from::text || ' → '
                        || COALESCE(f.effective_to::text,'present'))
      INTO v_out
      FROM public.bn_means_income_fact f
     WHERE f.income_fact_id = p_target_ref_id;
  ELSIF p_target_kind = 'ASSET_FACT' THEN
    SELECT jsonb_build_object(
        'target_label', public._bn_means_asset_label('ASSET_CATEGORY', a.category_code)
                        || COALESCE(' · ' || NULLIF(a.description,''), ''),
        'target_detail', a.valuation_amount::text || ' ' || a.currency_code
                        || ' · ' || (round(COALESCE(a.ownership_share,1)*100,2))::text || '% share'
                        || ' · valued ' || a.valuation_date::text)
      INTO v_out
      FROM public.bn_means_asset_fact a
     WHERE a.asset_fact_id = p_target_ref_id;
  END IF;
  RETURN COALESCE(v_out, jsonb_build_object('target_label','Unavailable','target_detail',NULL));
END;
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_deduction_fact_json(p_f bn_means_deduction_fact)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'deduction_fact_id', p_f.deduction_fact_id,
    'claim_kind', p_f.claim_kind,
    'claim_kind_label', CASE WHEN p_f.claim_kind = 'DISREGARD_CANDIDATE'
                             THEN 'Potential disregard' ELSE 'Deduction claimed' END,
    'target_kind', p_f.target_kind,
    'target_kind_label', public._bn_means_deduction_label('DEDUCTION_TARGET_KIND', p_f.target_kind),
    'target_ref_id', p_f.target_ref_id,
    'member_id', p_f.member_id,
    'member_name', (SELECT COALESCE(NULLIF(btrim(m.declared_person->>'full_name'),''),'Household member')
                      FROM public.bn_means_household_member m WHERE m.member_id = p_f.member_id),
    'category_code', p_f.category_code,
    'category_label', public._bn_means_deduction_label('DEDUCTION_CATEGORY', p_f.category_code),
    'claimed_amount', p_f.claimed_amount,
    'claimed_percentage', p_f.claimed_percentage,
    'declared_frequency', p_f.declared_frequency,
    'declared_frequency_label', CASE WHEN p_f.declared_frequency IS NULL THEN NULL
        ELSE public._bn_means_income_label('INCOME_FREQUENCY', p_f.declared_frequency) END,
    'claimed_normalised_annual_amount', p_f.normalised_annual_amount,
    'currency_code', p_f.currency_code,
    'claim_reason_code', p_f.claim_reason_code,
    'claim_reason_label', CASE WHEN p_f.claim_reason_code IS NULL THEN NULL
        ELSE public._bn_means_deduction_label('DEDUCTION_REASON', p_f.claim_reason_code) END,
    'claim_basis', p_f.claim_basis,
    'fact_source', p_f.fact_source,
    'fact_source_label', public._bn_means_deduction_label('DEDUCTION_FACT_SOURCE', p_f.fact_source),
    'effective_from', p_f.effective_from,
    'effective_to', p_f.effective_to,
    'evidence_requirement', p_f.evidence_requirement,
    'evidence_status', p_f.evidence_status,
    'linked_evidence_count', (SELECT count(*) FROM public.bn_means_evidence e
                               WHERE e.assessment_id = p_f.assessment_id
                                 AND e.fact_kind = 'DEDUCTION'
                                 AND e.fact_id = p_f.deduction_fact_id),
    'verification_status', p_f.verification_status,
    'treatment_status', p_f.treatment_status,
    'treatment_status_label', CASE p_f.treatment_status
        WHEN 'CLAIMED' THEN 'Claimed'
        WHEN 'PENDING_EVIDENCE' THEN 'Pending evidence'
        WHEN 'PENDING_VERIFICATION' THEN 'Pending verification'
        WHEN 'READY_FOR_ASSESSMENT' THEN 'Ready for later assessment'
        ELSE 'Voided' END,
    'officer_notes', p_f.officer_notes,
    'fact_version', p_f.fact_version,
    'supersedes_fact_id', p_f.supersedes_fact_id,
    'created_at', p_f.created_at,
    'updated_at', p_f.updated_at)
  || public._bn_means_deduction_target_json(p_f.assessment_id, p_f.target_kind,
                                            p_f.target_ref_id, p_f.member_id);
$function$;

-- 6. Potential disregard candidates from Income and Assets ----
CREATE OR REPLACE FUNCTION public._bn_means_disregard_candidates(p_assessment_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(jsonb_agg(c ORDER BY c->>'source_type', c->>'candidate_label'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'source_type','ASSET',
             'source_fact_id', a.asset_fact_id,
             'member_id', a.member_id,
             'member_name', (SELECT COALESCE(NULLIF(btrim(m.declared_person->>'full_name'),''),'Household member')
                               FROM public.bn_means_household_member m WHERE m.member_id = a.member_id),
             'category_code', a.category_code,
             'category_label', public._bn_means_asset_label('ASSET_CATEGORY', a.category_code),
             'candidate_label', COALESCE(NULLIF(a.description,''),
                                public._bn_means_asset_label('ASSET_CATEGORY', a.category_code)),
             'declared_amount', a.valuation_amount,
             'currency_code', a.currency_code,
             'candidate_reason_code', a.disregard_reason_code,
             'candidate_reason_label', CASE WHEN a.disregard_reason_code IS NULL THEN NULL
                 ELSE public._bn_means_asset_label('ASSET_DISREGARD_REASON', a.disregard_reason_code) END,
             'claim_recorded', EXISTS (SELECT 1 FROM public.bn_means_deduction_fact d
                                        WHERE d.assessment_id = a.assessment_id AND d.voided_at IS NULL
                                          AND d.claim_kind = 'DISREGARD_CANDIDATE'
                                          AND d.target_kind = 'ASSET_FACT'
                                          AND d.target_ref_id = a.asset_fact_id),
             'status_label', CASE WHEN EXISTS (SELECT 1 FROM public.bn_means_deduction_fact d
                                        WHERE d.assessment_id = a.assessment_id AND d.voided_at IS NULL
                                          AND d.claim_kind = 'DISREGARD_CANDIDATE'
                                          AND d.target_kind = 'ASSET_FACT'
                                          AND d.target_ref_id = a.asset_fact_id)
                                  THEN 'Claim recorded' ELSE 'Requires review' END) AS c
      FROM public.bn_means_asset_fact a
     WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL AND a.disregard_candidate
    UNION ALL
    SELECT jsonb_build_object(
             'source_type','INCOME',
             'source_fact_id', f.income_fact_id,
             'member_id', f.member_id,
             'member_name', (SELECT COALESCE(NULLIF(btrim(m.declared_person->>'full_name'),''),'Household member')
                               FROM public.bn_means_household_member m WHERE m.member_id = f.member_id),
             'category_code', f.category_code,
             'category_label', public._bn_means_income_label('INCOME_CATEGORY', f.category_code),
             'candidate_label', COALESCE(NULLIF(f.source_name,''),
                                public._bn_means_income_label('INCOME_CATEGORY', f.category_code)),
             'declared_amount', f.declared_amount,
             'currency_code', f.currency_code,
             'candidate_reason_code', f.disregard_reason_code,
             'candidate_reason_label', f.disregard_reason_code,
             'claim_recorded', EXISTS (SELECT 1 FROM public.bn_means_deduction_fact d
                                        WHERE d.assessment_id = f.assessment_id AND d.voided_at IS NULL
                                          AND d.claim_kind = 'DISREGARD_CANDIDATE'
                                          AND d.target_kind = 'INCOME_FACT'
                                          AND d.target_ref_id = f.income_fact_id),
             'status_label', CASE WHEN EXISTS (SELECT 1 FROM public.bn_means_deduction_fact d
                                        WHERE d.assessment_id = f.assessment_id AND d.voided_at IS NULL
                                          AND d.claim_kind = 'DISREGARD_CANDIDATE'
                                          AND d.target_kind = 'INCOME_FACT'
                                          AND d.target_ref_id = f.income_fact_id)
                                  THEN 'Claim recorded' ELSE 'Requires review' END) AS c
      FROM public.bn_means_income_fact f
     WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL AND f.disregard_candidate
  ) s;
$function$;

-- 7. Validation ----------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_deduction_validate(
  p_assessment_id uuid, p_payload jsonb, p_existing uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a        public.bn_means_assessment%ROWTYPE;
  v_cat      jsonb;
  v_rules    jsonb;
  v_block    jsonb := '[]'::jsonb;
  v_warn     jsonb := '[]'::jsonb;
  v_kind     text;
  v_target   text;
  v_ref      uuid;
  v_member   uuid;
  v_amount   numeric;
  v_pct      numeric;
  v_from     date;
  v_to       date;
  v_count    int;
  v_mfrom    date;
  v_mto      date;
  v_tfrom    date;
  v_tto      date;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('blockers', jsonb_build_array('NOT_FOUND'), 'warnings','[]'::jsonb);
  END IF;
  v_rules := public._bn_means_deduction_rules(v_a.policy_version_id);
  v_cat   := public._bn_means_deduction_option('DEDUCTION_CATEGORY', p_payload->>'category_code');

  IF v_cat IS NULL THEN
    RETURN jsonb_build_object('blockers', jsonb_build_array('DEDUCTION_CATEGORY_REQUIRED'),
                              'warnings','[]'::jsonb);
  END IF;

  v_kind   := v_cat->>'claim_kind';
  v_target := COALESCE(NULLIF(p_payload->>'target_kind',''),'');
  v_ref    := NULLIF(p_payload->>'target_ref_id','')::uuid;
  v_member := NULLIF(p_payload->>'member_id','')::uuid;
  v_amount := NULLIF(p_payload->>'claimed_amount','')::numeric;
  v_pct    := NULLIF(p_payload->>'claimed_percentage','')::numeric;
  v_from   := NULLIF(p_payload->>'effective_from','')::date;
  v_to     := NULLIF(p_payload->>'effective_to','')::date;

  IF v_target = '' THEN
    v_block := v_block || CASE WHEN v_kind = 'DISREGARD_CANDIDATE'
                          THEN '["DISREGARD_TARGET_REQUIRED"]'::jsonb
                          ELSE '["DEDUCTION_TARGET_REQUIRED"]'::jsonb END;
  ELSIF NOT (v_cat->'allowed_target_types' ? v_target) THEN
    v_block := v_block || '["DISREGARD_NOT_ALLOWED_FOR_TARGET"]'::jsonb;
  ELSIF v_target = 'ASSESSMENT' THEN
    IF COALESCE((v_rules->>'allow_assessment_level_claims')::boolean,true) IS NOT TRUE THEN
      v_block := v_block || '["DISREGARD_NOT_ALLOWED_FOR_TARGET"]'::jsonb;
    END IF;
  ELSIF v_target = 'HOUSEHOLD_MEMBER' THEN
    SELECT count(*), min(member_from), max(member_to) INTO v_count, v_mfrom, v_mto
      FROM public.bn_means_household_member
     WHERE member_id = COALESCE(v_ref, v_member) AND assessment_id = p_assessment_id
       AND voided_at IS NULL;
    IF COALESCE(v_count,0) = 0 THEN
      v_block := v_block || '["MEMBER_NOT_FOUND"]'::jsonb;
    END IF;
  ELSIF v_target = 'INCOME_FACT' THEN
    SELECT count(*), min(effective_from), max(effective_to) INTO v_count, v_tfrom, v_tto
      FROM public.bn_means_income_fact
     WHERE income_fact_id = v_ref AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF COALESCE(v_count,0) = 0 THEN
      v_block := v_block || '["DEDUCTION_TARGET_NOT_FOUND"]'::jsonb;
    END IF;
  ELSIF v_target = 'ASSET_FACT' THEN
    SELECT count(*), min(COALESCE(effective_from, valuation_date)), max(effective_to)
      INTO v_count, v_tfrom, v_tto
      FROM public.bn_means_asset_fact
     WHERE asset_fact_id = v_ref AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF COALESCE(v_count,0) = 0 THEN
      v_block := v_block || '["DEDUCTION_TARGET_NOT_FOUND"]'::jsonb;
    END IF;
  END IF;

  IF COALESCE((v_cat->>'requires_amount')::boolean,false) AND v_amount IS NULL THEN
    v_block := v_block || '["DEDUCTION_AMOUNT_REQUIRED"]'::jsonb;
  END IF;
  IF v_amount IS NOT NULL AND v_amount < 0 THEN
    v_block := v_block || '["INVALID_DEDUCTION_AMOUNT"]'::jsonb;
  END IF;
  IF COALESCE((v_cat->>'requires_frequency')::boolean,false)
     AND COALESCE(p_payload->>'declared_frequency','') = '' THEN
    v_block := v_block || '["DEDUCTION_FREQUENCY_REQUIRED"]'::jsonb;
  END IF;
  IF COALESCE((v_cat->>'requires_reason')::boolean,false)
     AND COALESCE(p_payload->>'claim_reason_code','') = '' THEN
    v_block := v_block || CASE WHEN v_kind = 'DISREGARD_CANDIDATE'
                          THEN '["DISREGARD_REASON_REQUIRED"]'::jsonb
                          ELSE '["DEDUCTION_REASON_REQUIRED"]'::jsonb END;
  END IF;
  IF COALESCE(p_payload->>'claim_reason_code','') <> ''
     AND public._bn_means_deduction_option('DEDUCTION_REASON', p_payload->>'claim_reason_code') IS NULL THEN
    v_block := v_block || '["DEDUCTION_REASON_REQUIRED"]'::jsonb;
  END IF;
  IF v_pct IS NOT NULL THEN
    IF COALESCE((v_cat->>'allows_partial_claim')::boolean,false) IS NOT TRUE THEN
      v_block := v_block || '["INVALID_DEDUCTION_PERCENTAGE"]'::jsonb;
    ELSIF v_pct <= 0 OR v_pct > 100 THEN
      v_block := v_block || '["INVALID_DEDUCTION_PERCENTAGE"]'::jsonb;
    END IF;
  END IF;
  IF COALESCE(p_payload->>'currency_code', v_a.currency_code) <> v_a.currency_code THEN
    v_block := v_block || '["CURRENCY_MISMATCH"]'::jsonb;
  END IF;

  IF COALESCE((v_cat->>'requires_period')::boolean,false) AND v_from IS NULL THEN
    v_block := v_block || '["DEDUCTION_START_REQUIRED"]'::jsonb;
  END IF;
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_to < v_from THEN
    v_block := v_block || '["INVALID_DEDUCTION_PERIOD"]'::jsonb;
  END IF;
  IF v_from IS NOT NULL AND v_a.effective_to IS NOT NULL AND v_from > v_a.effective_to THEN
    v_block := v_block || '["DEDUCTION_OUTSIDE_ASSESSMENT_PERIOD"]'::jsonb;
  END IF;
  IF v_to IS NOT NULL AND v_to < v_a.effective_from THEN
    v_block := v_block || '["DEDUCTION_OUTSIDE_ASSESSMENT_PERIOD"]'::jsonb;
  END IF;
  IF v_from IS NOT NULL AND v_mfrom IS NOT NULL AND v_from < v_mfrom THEN
    v_warn := v_warn || '["DEDUCTION_OUTSIDE_MEMBER_PERIOD"]'::jsonb;
  END IF;
  IF v_from IS NOT NULL AND v_tfrom IS NOT NULL
     AND (v_from < v_tfrom OR (v_tto IS NOT NULL AND v_from > v_tto)) THEN
    v_warn := v_warn || '["DEDUCTION_OUTSIDE_TARGET_PERIOD"]'::jsonb;
  END IF;

  -- Duplicate / conflict detection ---------------------------
  SELECT count(*) INTO v_count FROM public.bn_means_deduction_fact d
   WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
     AND (p_existing IS NULL OR d.deduction_fact_id <> p_existing)
     AND d.category_code = (p_payload->>'category_code')
     AND d.target_kind = v_target
     AND d.target_ref_id IS NOT DISTINCT FROM v_ref
     AND d.effective_from IS NOT DISTINCT FROM v_from
     AND d.claimed_amount IS NOT DISTINCT FROM v_amount
     AND d.claimed_percentage IS NOT DISTINCT FROM v_pct;
  IF v_count > 0 THEN
    IF COALESCE(v_rules->>'duplicate_treatment','BLOCK') = 'BLOCK' THEN
      v_block := v_block || '["DUPLICATE_DEDUCTION"]'::jsonb;
    ELSE
      v_warn := v_warn || '["DUPLICATE_DEDUCTION"]'::jsonb;
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.bn_means_deduction_fact d
   WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
     AND (p_existing IS NULL OR d.deduction_fact_id <> p_existing)
     AND d.category_code = (p_payload->>'category_code')
     AND d.target_kind = v_target
     AND d.target_ref_id IS NOT DISTINCT FROM v_ref
     AND (v_from IS NULL OR d.effective_to IS NULL OR d.effective_to >= v_from)
     AND (v_to IS NULL OR d.effective_from IS NULL OR d.effective_from <= v_to);
  IF v_count > 0 THEN
    v_warn := v_warn || '["POSSIBLE_DUPLICATE_DEDUCTION"]'::jsonb;
  END IF;

  IF v_kind = 'DISREGARD_CANDIDATE' AND v_target IN ('INCOME_FACT','ASSET_FACT') THEN
    SELECT count(*) INTO v_count FROM public.bn_means_deduction_fact d
     WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
       AND (p_existing IS NULL OR d.deduction_fact_id <> p_existing)
       AND d.claim_kind = 'DISREGARD_CANDIDATE'
       AND d.target_kind = v_target AND d.target_ref_id = v_ref
       AND d.category_code <> (p_payload->>'category_code');
    IF v_count > 0 THEN
      v_block := v_block || '["CONFLICTING_DEDUCTION"]'::jsonb;
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.bn_means_no_deduction_declaration n
   WHERE n.assessment_id = p_assessment_id AND n.voided_at IS NULL
     AND (n.declaration_scope = 'ASSESSMENT'
       OR n.member_id IS NOT DISTINCT FROM COALESCE(v_member, v_ref));
  IF v_count > 0 THEN
    v_block := v_block || '["NO_DEDUCTION_DECLARATION_CONFLICT"]'::jsonb;
  END IF;

  RETURN jsonb_build_object('blockers', v_block, 'warnings', v_warn,
                            'claim_kind', v_kind,
                            'evidence_requirement',
                              CASE WHEN COALESCE((v_cat->>'requires_evidence')::boolean,false)
                                   THEN 'REQUIRED' ELSE 'OPTIONAL' END);
END;
$function$;

-- 8. Backend-owned readiness ---------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_deduction_readiness(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a        public.bn_means_assessment%ROWTYPE;
  v_rules    jsonb;
  v_codes    jsonb := '[]'::jsonb;
  v_block    jsonb := '[]'::jsonb;
  v_warn     jsonb := '[]'::jsonb;
  v_claims   int := 0;
  v_ded      int := 0;
  v_dis      int := 0;
  v_members  int := 0;
  v_covered  int := 0;
  v_evidence int := 0;
  v_missing  int := 0;
  v_total    numeric(18,2) := 0;
  v_none     boolean := false;
  v_scope    text;
  v_assets_done boolean;
  v_count    int;
  v_complete boolean;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_rules := public._bn_means_deduction_rules(v_a.policy_version_id);
  v_scope := COALESCE(v_rules->>'none_declaration_scope','ASSESSMENT');

  SELECT count(*),
         count(*) FILTER (WHERE claim_kind = 'DEDUCTION_CLAIM'),
         count(*) FILTER (WHERE claim_kind = 'DISREGARD_CANDIDATE'),
         COALESCE(sum(COALESCE(normalised_annual_amount,0))
                  FILTER (WHERE claim_kind = 'DEDUCTION_CLAIM'),0),
         count(*) FILTER (WHERE evidence_requirement = 'REQUIRED')
    INTO v_claims, v_ded, v_dis, v_total, v_evidence
    FROM public.bn_means_deduction_fact
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL;

  SELECT count(*) INTO v_members FROM public.bn_means_household_member
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL;

  SELECT count(*) INTO v_covered FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND (EXISTS (SELECT 1 FROM public.bn_means_deduction_fact d
                   WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
                     AND (d.member_id = m.member_id OR d.target_ref_id = m.member_id))
       OR EXISTS (SELECT 1 FROM public.bn_means_no_deduction_declaration n
                   WHERE n.assessment_id = p_assessment_id AND n.voided_at IS NULL
                     AND (n.declaration_scope = 'ASSESSMENT' OR n.member_id = m.member_id)));

  SELECT count(*) INTO v_missing FROM public.bn_means_deduction_fact d
   WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
     AND (d.category_code IS NULL OR d.target_kind IS NULL
       OR (d.claim_kind = 'DEDUCTION_CLAIM' AND d.claimed_amount IS NULL));

  v_none := EXISTS (SELECT 1 FROM public.bn_means_no_deduction_declaration n
                     WHERE n.assessment_id = p_assessment_id AND n.voided_at IS NULL);

  v_assets_done := EXISTS (SELECT 1 FROM public.bn_means_section_completion sc
                            WHERE sc.assessment_id = p_assessment_id
                              AND sc.section_code = 'ASSETS' AND sc.reopened_at IS NULL);
  IF NOT v_assets_done THEN
    v_codes := v_codes || '"ASSET_SECTION_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','ASSET_SECTION_INCOMPLETE',
      'message','Complete the asset assessment before completing deductions and disregards.'));
  END IF;

  IF v_claims = 0 AND NOT v_none
     AND COALESCE((v_rules->>'require_none_declaration_when_no_claims')::boolean,true) THEN
    v_codes := v_codes || '"NONE_DECLARATION_REQUIRED"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','NONE_DECLARATION_REQUIRED',
      'message','Record either a claim or an explicit confirmation that nothing is claimed. A missing claim is not the same as none.'));
  END IF;

  IF v_scope = 'MEMBER' AND v_members > v_covered THEN
    v_codes := v_codes || '"MEMBER_DECLARATION_MISSING"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','MEMBER_DECLARATION_MISSING',
      'message', (v_members - v_covered) || ' household member(s) still need a claim or a none declaration.'));
  END IF;

  IF v_missing > 0 THEN
    v_codes := v_codes || '"DEDUCTION_MISSING_INFORMATION"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','DEDUCTION_MISSING_INFORMATION',
      'message', v_missing || ' claim(s) are missing required information.'));
  END IF;

  IF v_evidence > 0 THEN
    IF COALESCE((v_rules->>'block_when_required_evidence_missing')::boolean,false) THEN
      SELECT count(*) INTO v_count FROM public.bn_means_deduction_fact d
       WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
         AND d.evidence_requirement = 'REQUIRED'
         AND NOT EXISTS (SELECT 1 FROM public.bn_means_evidence e
                          WHERE e.assessment_id = p_assessment_id AND e.fact_kind = 'DEDUCTION'
                            AND e.fact_id = d.deduction_fact_id);
      IF v_count > 0 THEN
        v_codes := v_codes || '"DEDUCTION_EVIDENCE_REQUIRED"'::jsonb;
        v_block := v_block || jsonb_build_array(jsonb_build_object(
          'code','DEDUCTION_EVIDENCE_REQUIRED',
          'message', v_count || ' claim(s) require evidence before this section can be completed.'));
      END IF;
    ELSE
      v_codes := v_codes || '"DEDUCTION_EVIDENCE_REQUIRED"'::jsonb;
      v_warn := v_warn || jsonb_build_array(jsonb_build_object(
        'code','DEDUCTION_EVIDENCE_REQUIRED',
        'message', v_evidence || ' claim(s) require evidence. Evidence is collected in the evidence stage.'));
    END IF;
  END IF;

  IF v_claims > 0 AND v_none THEN
    v_codes := v_codes || '"NO_DEDUCTION_DECLARATION_CONFLICT"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','NO_DEDUCTION_DECLARATION_CONFLICT',
      'message','Claims exist alongside a none-claimed declaration. Withdraw one of them.'));
  END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM public.bn_means_deduction_fact a
      JOIN public.bn_means_deduction_fact b
        ON b.assessment_id = a.assessment_id AND b.deduction_fact_id <> a.deduction_fact_id
       AND b.voided_at IS NULL AND b.category_code = a.category_code
       AND b.target_kind = a.target_kind
       AND b.target_ref_id IS NOT DISTINCT FROM a.target_ref_id
     WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL) x;
  IF v_count > 0 THEN
    v_codes := v_codes || '"POSSIBLE_DUPLICATE_DEDUCTION"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','POSSIBLE_DUPLICATE_DEDUCTION',
      'message','Potentially overlapping claims exist for the same subject and category.'));
  END IF;

  v_complete := (jsonb_array_length(v_block) = 0);

  RETURN jsonb_build_object(
    'assessment_id', p_assessment_id,
    'section_complete', v_complete,
    'section_status', CASE
        WHEN jsonb_array_length(v_block) > 0 THEN 'BLOCKED'
        WHEN v_claims = 0 AND NOT v_none THEN 'NOT_STARTED'
        WHEN v_complete THEN 'COMPLETE'
        ELSE 'IN_PROGRESS' END,
    'section_marked_complete', EXISTS (
        SELECT 1 FROM public.bn_means_section_completion sc
         WHERE sc.assessment_id = p_assessment_id AND sc.section_code = 'DEDUCTIONS'
           AND sc.reopened_at IS NULL),
    'claim_count', v_claims,
    'deduction_claim_count', v_ded,
    'disregard_candidate_count', v_dis,
    'household_members_total', v_members,
    'household_members_covered', v_covered,
    'explicit_none_declaration', v_none,
    'none_declaration_scope', v_scope,
    'claims_requiring_evidence', v_evidence,
    'claims_missing_required_information', v_missing,
    'gross_claimed_deduction_total', v_total,
    'currency_code', v_a.currency_code,
    'warnings', v_warn,
    'blockers', v_block,
    'reason_codes', v_codes);
END;
$function$;

-- 9. Secured query surfaces ----------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_deduction_reference_v1(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', public._bn_means_deduction_reference());
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_deductions_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_a public.bn_means_assessment%ROWTYPE;
  v_claims jsonb; v_members jsonb; v_none jsonb; v_income jsonb; v_assets jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(public._bn_means_deduction_fact_json(d) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_claims FROM public.bn_means_deduction_fact d
   WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL;

  SELECT COALESCE(jsonb_agg(public._bn_means_household_member_json(m)
                            ORDER BY m.is_self DESC, m.member_from), '[]'::jsonb)
    INTO v_members FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'declaration_id', n.declaration_id,
           'declaration_scope', n.declaration_scope,
           'member_id', n.member_id,
           'reason_code', n.reason_code,
           'reason_label', public._bn_means_deduction_label('NO_DEDUCTION_REASON', n.reason_code),
           'confirmation_note', n.confirmation_note,
           'declaration_source', n.declaration_source,
           'declaration_source_label', public._bn_means_deduction_label('DEDUCTION_FACT_SOURCE', n.declaration_source),
           'declared_at', n.declared_at) ORDER BY n.declared_at), '[]'::jsonb)
    INTO v_none FROM public.bn_means_no_deduction_declaration n
   WHERE n.assessment_id = p_assessment_id AND n.voided_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'income_fact_id', f.income_fact_id,
           'member_id', f.member_id,
           'member_name', (SELECT COALESCE(NULLIF(btrim(m.declared_person->>'full_name'),''),'Household member')
                             FROM public.bn_means_household_member m WHERE m.member_id = f.member_id),
           'category_label', public._bn_means_income_label('INCOME_CATEGORY', f.category_code),
           'source_name', f.source_name,
           'declared_amount', f.declared_amount,
           'currency_code', f.currency_code,
           'declared_frequency_label', public._bn_means_income_label('INCOME_FREQUENCY', f.declared_frequency),
           'effective_from', f.effective_from,
           'effective_to', f.effective_to) ORDER BY f.effective_from DESC), '[]'::jsonb)
    INTO v_income FROM public.bn_means_income_fact f
   WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'asset_fact_id', a.asset_fact_id,
           'member_id', a.member_id,
           'member_name', (SELECT COALESCE(NULLIF(btrim(m.declared_person->>'full_name'),''),'Household member')
                             FROM public.bn_means_household_member m WHERE m.member_id = a.member_id),
           'category_label', public._bn_means_asset_label('ASSET_CATEGORY', a.category_code),
           'description', a.description,
           'valuation_amount', a.valuation_amount,
           'currency_code', a.currency_code,
           'ownership_share', a.ownership_share,
           'valuation_date', a.valuation_date) ORDER BY a.valuation_date DESC), '[]'::jsonb)
    INTO v_assets FROM public.bn_means_asset_fact a
   WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'editable', public._bn_means_is_editable(v_a.status),
    'currency_code', v_a.currency_code,
    'assessment_from', v_a.effective_from,
    'assessment_to', v_a.effective_to,
    'deduction_rules', public._bn_means_deduction_rules(v_a.policy_version_id),
    'household_members', v_members,
    'income_targets', v_income,
    'asset_targets', v_assets,
    'claims', v_claims,
    'disregard_candidates', public._bn_means_disregard_candidates(p_assessment_id),
    'none_declarations', v_none));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_deduction_readiness_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb; v_data jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_data := public._bn_means_deduction_readiness(p_assessment_id);
  IF v_data IS NULL THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', v_data);
END;
$function$;

-- 10. Governed command handler -------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_deduction_execute(
  p_command_name text, p_assessment_id uuid, p_from_status text, p_actor_user_id uuid,
  p_actor_user_code text, p_correlation_id uuid, p_reason_code text, p_justification text,
  p_payload jsonb, p_row_version bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_a        public.bn_means_assessment%ROWTYPE;
  v_rules    jsonb;
  v_snapshot jsonb;
  v_cat      jsonb;
  v_reason   text;
  v_fact     uuid;
  v_new_id   uuid;
  v_count    int;
  v_ready    jsonb;
  v_amount   numeric;
  v_freq     text;
  v_norm     numeric;
  v_member   uuid;
  v_scope    text;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:%', p_assessment_id; END IF;
  IF NOT public._bn_means_is_editable(p_from_status) THEN
    RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', p_from_status;
  END IF;
  v_rules := public._bn_means_deduction_rules(v_a.policy_version_id);

  IF p_command_name IN ('BN_MEANS_ADD_DEDUCTION','BN_MEANS_CORRECT_DEDUCTION') THEN
    v_fact := NULLIF(p_payload->>'deduction_fact_id','')::uuid;
    IF p_command_name = 'BN_MEANS_CORRECT_DEDUCTION' THEN
      SELECT count(*) INTO v_count FROM public.bn_means_deduction_fact
       WHERE deduction_fact_id = v_fact AND assessment_id = p_assessment_id AND voided_at IS NULL;
      IF COALESCE(v_count,0) = 0 THEN
        RAISE EXCEPTION 'E_DEDUCTION_FACT_NOT_FOUND:deduction claim';
      END IF;
    ELSE
      v_fact := NULL;
    END IF;

    v_snapshot := public._bn_means_deduction_validate(p_assessment_id, p_payload, v_fact);
    IF jsonb_array_length(v_snapshot->'blockers') > 0 THEN
      v_reason := (v_snapshot->'blockers'->>0);
      IF v_reason = 'CURRENCY_MISMATCH' THEN
        RAISE EXCEPTION 'E_CURRENCY_MISMATCH:assessment=%', v_a.currency_code;
      ELSIF v_reason = 'MEMBER_NOT_FOUND' THEN
        RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
      ELSE
        RAISE EXCEPTION 'E_DEDUCTION_VALIDATION_FAILED:%', v_reason;
      END IF;
    END IF;

    v_cat    := public._bn_means_deduction_option('DEDUCTION_CATEGORY', p_payload->>'category_code');
    v_amount := NULLIF(p_payload->>'claimed_amount','')::numeric;
    v_freq   := NULLIF(p_payload->>'declared_frequency','');
    v_norm   := CASE WHEN v_amount IS NULL THEN NULL
                     ELSE public._bn_means_annualise(v_amount, COALESCE(v_freq,'ANNUAL')) END;

    IF p_command_name = 'BN_MEANS_CORRECT_DEDUCTION' THEN
      SELECT fact_version INTO v_count FROM public.bn_means_deduction_fact
       WHERE deduction_fact_id = v_fact;
      UPDATE public.bn_means_deduction_fact
         SET voided_at = now(), voided_by = p_actor_user_id, treatment_status = 'VOIDED',
             updated_at = now(), updated_by = p_actor_user_id
       WHERE deduction_fact_id = v_fact AND assessment_id = p_assessment_id;
    ELSE
      v_count := 0;
    END IF;

    INSERT INTO public.bn_means_deduction_fact(
      assessment_id, member_id, category_code, claim_kind, target_kind, target_ref_id,
      claimed_amount, claimed_percentage, declared_frequency, normalised_annual_amount,
      currency_code, claim_reason_code, claim_basis, fact_source, effective_from, effective_to,
      evidence_requirement, officer_notes, treatment_status, approval_status,
      fact_version, supersedes_fact_id, created_by, updated_by)
    VALUES (p_assessment_id, NULLIF(p_payload->>'member_id','')::uuid,
      p_payload->>'category_code',
      COALESCE(v_cat->>'claim_kind','DEDUCTION_CLAIM'),
      p_payload->>'target_kind', NULLIF(p_payload->>'target_ref_id','')::uuid,
      v_amount, NULLIF(p_payload->>'claimed_percentage','')::numeric, v_freq, v_norm,
      v_a.currency_code,
      NULLIF(p_payload->>'claim_reason_code',''),
      NULLIF(btrim(COALESCE(p_payload->>'claim_basis','')),''),
      COALESCE(NULLIF(p_payload->>'fact_source',''),'APPLICANT_DECLARATION'),
      NULLIF(p_payload->>'effective_from','')::date,
      NULLIF(p_payload->>'effective_to','')::date,
      COALESCE(v_snapshot->>'evidence_requirement','OPTIONAL'),
      NULLIF(btrim(COALESCE(p_payload->>'officer_notes','')),''),
      CASE WHEN COALESCE((v_cat->>'requires_evidence')::boolean,false)
           THEN 'PENDING_EVIDENCE' ELSE 'PENDING_VERIFICATION' END,
      'CLAIMED',
      COALESCE(v_count,0) + 1, v_fact, p_actor_user_id, p_actor_user_id)
    RETURNING deduction_fact_id INTO v_new_id;

    PERFORM public._bn_means_event(p_assessment_id,
      CASE WHEN p_command_name = 'BN_MEANS_CORRECT_DEDUCTION' THEN 'DEDUCTION_CORRECTED'
           ELSE 'DEDUCTION_CLAIMED' END,
      p_command_name, p_from_status, p_from_status, p_reason_code, p_justification,
      p_payload || jsonb_build_object('deduction_fact_id', v_new_id, 'superseded_fact_id', v_fact),
      p_actor_user_id, p_actor_user_code, p_correlation_id, p_row_version);

    RETURN jsonb_build_object('deduction_fact_id', v_new_id,
      'superseded_fact_id', v_fact,
      'claimed_normalised_annual_amount', v_norm,
      'warnings', COALESCE(v_snapshot->'warnings','[]'::jsonb));

  ELSIF p_command_name = 'BN_MEANS_VOID_DEDUCTION' THEN
    v_fact := NULLIF(p_payload->>'deduction_fact_id','')::uuid;
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:deduction claim';
    END IF;
    UPDATE public.bn_means_deduction_fact
       SET voided_at = now(), voided_by = p_actor_user_id, treatment_status = 'VOIDED',
           updated_at = now(), updated_by = p_actor_user_id
     WHERE deduction_fact_id = v_fact AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_DEDUCTION_FACT_NOT_FOUND:deduction claim';
    END IF;
    PERFORM public._bn_means_event(p_assessment_id,'DEDUCTION_VOIDED',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,p_payload,
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('deduction_fact_id', v_fact, 'voided', true);

  ELSIF p_command_name = 'BN_MEANS_DECLARE_NO_DEDUCTIONS' THEN
    v_scope := COALESCE(NULLIF(p_payload->>'declaration_scope',''),
                        COALESCE(v_rules->>'none_declaration_scope','ASSESSMENT'));
    v_member := NULLIF(p_payload->>'member_id','')::uuid;
    IF COALESCE(p_payload->>'reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:none declaration';
    END IF;
    IF public._bn_means_deduction_option('NO_DEDUCTION_REASON', p_payload->>'reason_code') IS NULL THEN
      RAISE EXCEPTION 'E_DEDUCTION_VALIDATION_FAILED:INVALID_NO_DEDUCTION_REASON';
    END IF;
    IF v_scope = 'MEMBER' THEN
      IF v_member IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:household member';
      END IF;
      SELECT count(*) INTO v_count FROM public.bn_means_household_member
       WHERE member_id = v_member AND assessment_id = p_assessment_id AND voided_at IS NULL;
      IF COALESCE(v_count,0) = 0 THEN
        RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
      END IF;
    ELSE
      v_member := NULL;
    END IF;

    SELECT count(*) INTO v_count FROM public.bn_means_deduction_fact d
     WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
       AND (v_scope = 'ASSESSMENT' OR d.member_id = v_member OR d.target_ref_id = v_member);
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_DEDUCTION_VALIDATION_FAILED:NO_DEDUCTION_DECLARATION_CONFLICT';
    END IF;

    SELECT count(*) INTO v_count FROM public.bn_means_no_deduction_declaration n
     WHERE n.assessment_id = p_assessment_id AND n.voided_at IS NULL
       AND n.declaration_scope = v_scope AND n.member_id IS NOT DISTINCT FROM v_member;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_DEDUCTION_VALIDATION_FAILED:DUPLICATE_NO_DEDUCTION_DECLARATION';
    END IF;

    INSERT INTO public.bn_means_no_deduction_declaration(
      assessment_id, declaration_scope, member_id, reason_code, confirmation_note,
      declaration_source, declared_by)
    VALUES (p_assessment_id, v_scope, v_member, p_payload->>'reason_code',
      NULLIF(btrim(COALESCE(p_payload->>'confirmation_note','')),''),
      COALESCE(NULLIF(p_payload->>'declaration_source',''),'APPLICANT_DECLARATION'),
      p_actor_user_id)
    RETURNING declaration_id INTO v_fact;
    PERFORM public._bn_means_event(p_assessment_id,'NO_DEDUCTIONS_DECLARED',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,
      p_payload || jsonb_build_object('declaration_id', v_fact),
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('declaration_id', v_fact, 'declaration_scope', v_scope);

  ELSIF p_command_name = 'BN_MEANS_WITHDRAW_NO_DEDUCTIONS' THEN
    v_fact := NULLIF(p_payload->>'declaration_id','')::uuid;
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:none declaration';
    END IF;
    UPDATE public.bn_means_no_deduction_declaration
       SET voided_at = now(), voided_by = p_actor_user_id, updated_at = now()
     WHERE declaration_id = v_fact AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_DEDUCTION_FACT_NOT_FOUND:none declaration';
    END IF;
    PERFORM public._bn_means_event(p_assessment_id,'NO_DEDUCTIONS_WITHDRAWN',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,p_payload,
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('declaration_id', v_fact, 'voided', true);

  ELSIF p_command_name = 'BN_MEANS_MARK_DEDUCTIONS_COMPLETE' THEN
    v_ready := public._bn_means_deduction_readiness(p_assessment_id);
    IF NOT COALESCE((v_ready->>'section_complete')::boolean,false) THEN
      RAISE EXCEPTION 'E_SECTION_NOT_READY:%', 'DEDUCTIONS';
    END IF;
    INSERT INTO public.bn_means_section_completion(assessment_id, section_code, completed_by)
    VALUES (p_assessment_id, 'DEDUCTIONS', p_actor_user_id)
    ON CONFLICT (assessment_id, section_code) DO UPDATE
      SET completed_at = now(), completed_by = EXCLUDED.completed_by,
          reopened_at = NULL, reopened_by = NULL, updated_at = now();
    PERFORM public._bn_means_event(p_assessment_id,'DEDUCTIONS_SECTION_COMPLETED',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,
      jsonb_build_object('section_code','DEDUCTIONS'),
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('section_code','DEDUCTIONS','section_complete', true);
  END IF;

  RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
END;
$function$;

-- 11. Wire the commands into the governed pipeline ------------
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_new := $new$ELSIF p_command_name IN ('BN_MEANS_ADD_DEDUCTION','BN_MEANS_CORRECT_DEDUCTION',
                           'BN_MEANS_VOID_DEDUCTION','BN_MEANS_DECLARE_NO_DEDUCTIONS',
                           'BN_MEANS_WITHDRAW_NO_DEDUCTIONS','BN_MEANS_MARK_DEDUCTIONS_COMPLETE') THEN
    -- MEANS-TEST EPIC 5 — deductions and disregards handled by the governed helper.
    v_result := public._bn_means_deduction_execute(p_command_name, v_id, v_from, p_actor_user_id,
                  p_actor_user_code, p_correlation_id, p_reason_code, p_justification,
                  COALESCE(p_payload,'{}'::jsonb), v_a.row_version);

  ELSIF p_command_name = 'BN_MEANS_ATTACH_EVIDENCE' THEN$new$;

  v_def := pg_get_functiondef(
    'public.bn_means_execute_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid)'::regprocedure);

  IF position('BN_MEANS_MARK_DEDUCTIONS_COMPLETE' in v_def) = 0 THEN
    v_def := regexp_replace(
      v_def,
      $re$ELSIF p_command_name = 'BN_MEANS_ADD_DEDUCTION' THEN.*?ELSIF p_command_name = 'BN_MEANS_ATTACH_EVIDENCE' THEN$re$,
      v_new,
      '');
    IF position('BN_MEANS_MARK_DEDUCTIONS_COMPLETE' in v_def) = 0 THEN
      RAISE EXCEPTION 'MEANS EPIC 5: could not locate the deduction handler anchor';
    END IF;
    EXECUTE v_def;
  END IF;
END
$do$;

DO $do$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.bn_means_available_actions_v1(uuid,uuid)'::regprocedure);
  IF position('BN_MEANS_MARK_DEDUCTIONS_COMPLETE' in v_def) = 0 THEN
    v_def := replace(v_def,
      $old$'BN_MEANS_ADD_DEDUCTION',$old$,
      $new$'BN_MEANS_ADD_DEDUCTION','BN_MEANS_CORRECT_DEDUCTION','BN_MEANS_VOID_DEDUCTION','BN_MEANS_DECLARE_NO_DEDUCTIONS','BN_MEANS_WITHDRAW_NO_DEDUCTIONS','BN_MEANS_MARK_DEDUCTIONS_COMPLETE',$new$);
    IF position('BN_MEANS_MARK_DEDUCTIONS_COMPLETE' in v_def) = 0 THEN
      RAISE EXCEPTION 'MEANS EPIC 5: could not locate the available-actions anchor';
    END IF;
    EXECUTE v_def;
  END IF;
END
$do$;

REVOKE ALL ON FUNCTION public.bn_means_deductions_v1(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_deduction_readiness_v1(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_deduction_reference_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_deductions_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_deduction_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_deduction_reference_v1(uuid) TO authenticated, service_role;
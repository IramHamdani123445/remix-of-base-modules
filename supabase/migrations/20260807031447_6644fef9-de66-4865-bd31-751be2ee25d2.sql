-- ============================================================
-- MEANS-TEST EPIC 4 — Asset Assessment
-- ============================================================

-- 1. Extend the asset fact table -----------------------------
ALTER TABLE public.bn_means_asset_fact
  ADD COLUMN IF NOT EXISTS ownership_type       text NOT NULL DEFAULT 'SOLE',
  ADD COLUMN IF NOT EXISTS co_owner_note        text,
  ADD COLUMN IF NOT EXISTS asset_details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS valuation_basis      text NOT NULL DEFAULT 'MARKET_VALUE',
  ADD COLUMN IF NOT EXISTS effective_from       date,
  ADD COLUMN IF NOT EXISTS effective_to         date,
  ADD COLUMN IF NOT EXISTS asset_notes          text,
  ADD COLUMN IF NOT EXISTS disregard_reason_code text,
  ADD COLUMN IF NOT EXISTS fact_version         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_fact_id   uuid,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by           uuid;

UPDATE public.bn_means_asset_fact
   SET effective_from = COALESCE(effective_from, valuation_date)
 WHERE effective_from IS NULL;

CREATE INDEX IF NOT EXISTS bn_means_asset_fact_assessment_idx
  ON public.bn_means_asset_fact(assessment_id) WHERE voided_at IS NULL;

-- 2. Explicit no-asset declaration ---------------------------
CREATE TABLE IF NOT EXISTS public.bn_means_no_asset_declaration (
  declaration_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id       uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  member_id           uuid REFERENCES public.bn_means_household_member(member_id) ON DELETE CASCADE,
  effective_from      date NOT NULL,
  effective_to        date,
  declaration_source  text NOT NULL DEFAULT 'APPLICANT_DECLARATION',
  reason_code         text,
  confirmation_note   text,
  declared_by         uuid,
  declared_at         timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_no_asset_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bn_means_no_asset_declaration TO authenticated;
GRANT ALL ON public.bn_means_no_asset_declaration TO service_role;

CREATE INDEX IF NOT EXISTS bn_means_no_asset_declaration_assessment_idx
  ON public.bn_means_no_asset_declaration(assessment_id) WHERE voided_at IS NULL;

-- 3. Governed reference data ---------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_asset_reference()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'ASSET_CATEGORY', jsonb_build_array(
      jsonb_build_object('value','CASH','label','Cash held',
        'description','Notes and coin held by the household.',
        'requires_institution',false,'requires_property_address',false,
        'requires_registration',false,'requires_business_name',false,
        'requires_description',false,'valuation_basis_choice',false,
        'fixed_valuation_basis','BALANCE','disregard_candidate_default',false,
        'evidence_normally_required',false),
      jsonb_build_object('value','BANK_DEPOSIT','label','Bank or credit union deposit',
        'description','Savings, current or fixed-deposit balances.',
        'requires_institution',true,'requires_property_address',false,
        'requires_registration',false,'requires_business_name',false,
        'requires_description',false,'valuation_basis_choice',false,
        'fixed_valuation_basis','BALANCE','disregard_candidate_default',false,
        'evidence_normally_required',true),
      jsonb_build_object('value','INVESTMENT','label','Investment holding',
        'description','Shares, bonds, unit trusts or other securities.',
        'requires_institution',true,'requires_property_address',false,
        'requires_registration',false,'requires_business_name',false,
        'requires_description',true,'valuation_basis_choice',true,
        'disregard_candidate_default',false,'evidence_normally_required',true),
      jsonb_build_object('value','PROPERTY','label','Residential or commercial property',
        'description','A building owned wholly or partly by a household member.',
        'requires_institution',false,'requires_property_address',true,
        'requires_registration',false,'requires_business_name',false,
        'requires_description',true,'valuation_basis_choice',true,
        'disregard_candidate_default',true,'evidence_normally_required',true),
      jsonb_build_object('value','LAND','label','Land',
        'description','Undeveloped land or agricultural holdings.',
        'requires_institution',false,'requires_property_address',true,
        'requires_registration',false,'requires_business_name',false,
        'requires_description',true,'valuation_basis_choice',true,
        'disregard_candidate_default',false,'evidence_normally_required',true),
      jsonb_build_object('value','VEHICLE','label','Vehicle',
        'description','A motor vehicle, boat or other registered vehicle.',
        'requires_institution',false,'requires_property_address',false,
        'requires_registration',true,'requires_business_name',false,
        'requires_description',true,'valuation_basis_choice',true,
        'disregard_candidate_default',true,'evidence_normally_required',false),
      jsonb_build_object('value','BUSINESS','label','Business interest',
        'description','An ownership interest in a trade or business.',
        'requires_institution',false,'requires_property_address',false,
        'requires_registration',false,'requires_business_name',true,
        'requires_description',true,'valuation_basis_choice',true,
        'disregard_candidate_default',false,'evidence_normally_required',true),
      jsonb_build_object('value','RECEIVABLE','label','Money owed to the household',
        'description','Loans made, arrears due or other receivables.',
        'requires_institution',false,'requires_property_address',false,
        'requires_registration',false,'requires_business_name',false,
        'requires_description',true,'valuation_basis_choice',false,
        'fixed_valuation_basis','BALANCE','disregard_candidate_default',false,
        'evidence_normally_required',false),
      jsonb_build_object('value','OTHER_ASSET','label','Other asset',
        'description','Any other asset of value held by a household member.',
        'requires_institution',false,'requires_property_address',false,
        'requires_registration',false,'requires_business_name',false,
        'requires_description',true,'valuation_basis_choice',true,
        'disregard_candidate_default',false,'evidence_normally_required',false)),
    'ASSET_OWNERSHIP_TYPE', jsonb_build_array(
      jsonb_build_object('value','SOLE','label','Solely owned','description','Held by this member alone'),
      jsonb_build_object('value','JOINT','label','Jointly owned','description','Shared with another named owner'),
      jsonb_build_object('value','SHARED_HOUSEHOLD','label','Shared within the household','description','Held in common by household members'),
      jsonb_build_object('value','HELD_IN_TRUST','label','Held in trust','description','Legal title held by another party'),
      jsonb_build_object('value','BENEFICIAL_INTEREST','label','Beneficial interest only','description','Benefit without legal title')),
    'ASSET_VALUATION_BASIS', jsonb_build_array(
      jsonb_build_object('value','MARKET_VALUE','label','Market value','description','Open-market value at the valuation date'),
      jsonb_build_object('value','ASSESSED_VALUE','label','Assessed value','description','Official or statutory assessment'),
      jsonb_build_object('value','BOOK_VALUE','label','Book value','description','Accounting value from records'),
      jsonb_build_object('value','BALANCE','label','Account balance','description','Balance held at the valuation date'),
      jsonb_build_object('value','PURCHASE_PRICE','label','Purchase price','description','Original price paid')),
    'ASSET_FACT_SOURCE', jsonb_build_array(
      jsonb_build_object('value','APPLICANT_DECLARATION','label','Applicant declaration'),
      jsonb_build_object('value','PERSON_RECORD','label','Person record'),
      jsonb_build_object('value','FINANCIAL_STATEMENT','label','Financial statement'),
      jsonb_build_object('value','VALUATION_REPORT','label','Valuation report'),
      jsonb_build_object('value','REGISTRY_RECORD','label','Official registry record'),
      jsonb_build_object('value','OFFICER_CONFIRMED','label','Officer confirmed'),
      jsonb_build_object('value','EXTERNAL_EVIDENCE','label','External evidence')),
    'ASSET_DISREGARD_REASON', jsonb_build_array(
      jsonb_build_object('value','PRIMARY_RESIDENCE','label','Primary residence'),
      jsonb_build_object('value','ESSENTIAL_VEHICLE','label','Essential vehicle'),
      jsonb_build_object('value','TOOLS_OF_TRADE','label','Tools of trade'),
      jsonb_build_object('value','PERSONAL_EFFECTS','label','Personal effects'),
      jsonb_build_object('value','STATUTORY_DISREGARD','label','Statutory disregard'),
      jsonb_build_object('value','OTHER_DISREGARD','label','Other possible disregard')),
    'NO_ASSET_REASON', jsonb_build_array(
      jsonb_build_object('value','NO_ASSETS_HELD','label','Holds no assets of value'),
      jsonb_build_object('value','DEPENDENT_CHILD','label','Dependent child with no assets'),
      jsonb_build_object('value','ASSETS_HELD_BY_HOUSEHOLD','label','Assets are held by another household member'),
      jsonb_build_object('value','OTHER_NO_ASSETS','label','Other confirmed reason'))
  );
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_asset_option(p_set text, p_value text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT o FROM jsonb_array_elements(public._bn_means_asset_reference()->p_set) o
   WHERE o->>'value' = p_value LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_asset_label(p_set text, p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(public._bn_means_asset_option(p_set, p_value)->>'label', p_value);
$function$;

ALTER TABLE public.bn_means_policy_version
  ADD COLUMN IF NOT EXISTS asset_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public._bn_means_asset_rules(p_policy_version_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
           'require_ownership_context', true,
           'require_declaration_for_every_member', true,
           'allow_household_level_asset', false,
           'allow_negative_valuation', false,
           'allow_foreign_currency', false,
           'duplicate_treatment','WARN',
           'disregard_decided_at_calculation', true)
         || COALESCE((SELECT COALESCE(pv.asset_rules, '{}'::jsonb)
                        FROM public.bn_means_policy_version pv
                       WHERE pv.policy_version_id = p_policy_version_id), '{}'::jsonb);
$function$;

-- placeholder removed below

-- 4. Presentation projection ---------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_asset_fact_json(p_f bn_means_asset_fact)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'asset_fact_id', p_f.asset_fact_id,
    'member_id', p_f.member_id,
    'member_name', (SELECT COALESCE(
          NULLIF(btrim(m.declared_person->>'full_name'),''),
          (SELECT btrim(COALESCE(i.firstname,'') || ' ' || COALESCE(i.surname,''))
             FROM public.ip_master i
            WHERE regexp_replace(COALESCE(i.ssn,''),'[^0-9]','','g') = m.person_id::text LIMIT 1),
          'Household member')
        FROM public.bn_means_household_member m WHERE m.member_id = p_f.member_id),
    'member_relationship', (SELECT public._bn_means_household_label('RELATIONSHIP_TYPE', m.relationship_code)
        FROM public.bn_means_household_member m WHERE m.member_id = p_f.member_id),
    'member_is_current', (SELECT (m.member_to IS NULL OR m.member_to >= CURRENT_DATE)
        FROM public.bn_means_household_member m WHERE m.member_id = p_f.member_id),
    'category_code', p_f.category_code,
    'category_label', public._bn_means_asset_label('ASSET_CATEGORY', p_f.category_code),
    'description', p_f.description,
    'asset_details', COALESCE(p_f.asset_details,'{}'::jsonb),
    'ownership_type', p_f.ownership_type,
    'ownership_type_label', public._bn_means_asset_label('ASSET_OWNERSHIP_TYPE', p_f.ownership_type),
    'ownership_share', p_f.ownership_share,
    'co_owner_note', p_f.co_owner_note,
    'valuation_amount', p_f.valuation_amount,
    'attributable_amount', round(p_f.valuation_amount * COALESCE(p_f.ownership_share,1), 2),
    'currency_code', p_f.currency_code,
    'valuation_basis', p_f.valuation_basis,
    'valuation_basis_label', public._bn_means_asset_label('ASSET_VALUATION_BASIS', p_f.valuation_basis),
    'valuation_date', p_f.valuation_date,
    'valuation_source', p_f.valuation_source,
    'effective_from', COALESCE(p_f.effective_from, p_f.valuation_date),
    'effective_to', p_f.effective_to,
    'fact_source', p_f.fact_source,
    'fact_source_label', public._bn_means_asset_label('ASSET_FACT_SOURCE', p_f.fact_source),
    'evidence_status', p_f.evidence_status,
    'verification_status', p_f.verification_status,
    'disregard_candidate', p_f.disregard_candidate,
    'disregard_reason_code', p_f.disregard_reason_code,
    'disregard_reason_label', CASE WHEN p_f.disregard_reason_code IS NULL THEN NULL
        ELSE public._bn_means_asset_label('ASSET_DISREGARD_REASON', p_f.disregard_reason_code) END,
    'asset_notes', p_f.asset_notes,
    'fact_version', p_f.fact_version,
    'supersedes_fact_id', p_f.supersedes_fact_id,
    'created_at', p_f.created_at,
    'updated_at', p_f.updated_at);
$function$;

-- 5. Validation ----------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_asset_validate(
  p_assessment_id uuid, p_payload jsonb, p_exclude_fact_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a      public.bn_means_assessment%ROWTYPE;
  v_m      public.bn_means_household_member%ROWTYPE;
  v_rules  jsonb;
  v_cat    jsonb;
  v_block  jsonb := '[]'::jsonb;
  v_warn   jsonb := '[]'::jsonb;
  v_member uuid  := NULLIF(p_payload->>'member_id','')::uuid;
  v_code   text  := COALESCE(p_payload->>'category_code','');
  v_own    text  := COALESCE(p_payload->>'ownership_type','');
  v_basis  text  := COALESCE(p_payload->>'valuation_basis','');
  v_src    text  := COALESCE(p_payload->>'fact_source','');
  v_amt    numeric := NULLIF(p_payload->>'valuation_amount','')::numeric;
  v_share  numeric := NULLIF(p_payload->>'ownership_share','')::numeric;
  v_vdate  date  := NULLIF(p_payload->>'valuation_date','')::date;
  v_from   date  := NULLIF(p_payload->>'effective_from','')::date;
  v_to     date  := NULLIF(p_payload->>'effective_to','')::date;
  v_cur    text  := NULLIF(p_payload->>'currency_code','');
  v_det    jsonb := COALESCE(p_payload->'asset_details','{}'::jsonb);
  v_count  int;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('blockers', jsonb_build_array('NOT_FOUND'), 'warnings','[]'::jsonb);
  END IF;
  v_rules := public._bn_means_asset_rules(v_a.policy_version_id);
  v_cat   := public._bn_means_asset_option('ASSET_CATEGORY', v_code);

  IF v_code = '' OR v_cat IS NULL THEN
    v_block := v_block || '"ASSET_CATEGORY_REQUIRED"'::jsonb;
  END IF;

  -- ownership context
  IF v_member IS NULL THEN
    IF NOT COALESCE((v_rules->>'allow_household_level_asset')::boolean,false) THEN
      v_block := v_block || '"ASSET_OWNER_REQUIRED"'::jsonb;
    END IF;
  ELSE
    SELECT * INTO v_m FROM public.bn_means_household_member
     WHERE member_id = v_member AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      v_block := v_block || '"MEMBER_NOT_FOUND"'::jsonb;
    ELSIF v_from IS NOT NULL THEN
      IF v_from < v_m.member_from
         OR (v_m.member_to IS NOT NULL AND v_from > v_m.member_to)
         OR (v_m.member_to IS NOT NULL AND v_to IS NOT NULL AND v_to > v_m.member_to) THEN
        v_block := v_block || '"ASSET_OUTSIDE_HOUSEHOLD_MEMBERSHIP"'::jsonb;
      END IF;
    END IF;
  END IF;

  IF v_own = '' OR public._bn_means_asset_option('ASSET_OWNERSHIP_TYPE', v_own) IS NULL THEN
    v_block := v_block || '"ASSET_OWNERSHIP_TYPE_REQUIRED"'::jsonb;
  END IF;

  IF v_share IS NULL THEN
    v_block := v_block || '"ASSET_OWNERSHIP_SHARE_REQUIRED"'::jsonb;
  ELSIF v_share <= 0 OR v_share > 1 THEN
    v_block := v_block || '"INVALID_OWNERSHIP_SHARE"'::jsonb;
  END IF;

  -- valuation
  IF v_amt IS NULL THEN
    v_block := v_block || '"ASSET_VALUATION_REQUIRED"'::jsonb;
  ELSIF v_amt < 0 AND NOT COALESCE((v_rules->>'allow_negative_valuation')::boolean,false) THEN
    v_block := v_block || '"NEGATIVE_VALUATION_NOT_PERMITTED"'::jsonb;
  END IF;

  IF v_cur IS NOT NULL AND v_cur <> v_a.currency_code THEN
    IF COALESCE((v_rules->>'allow_foreign_currency')::boolean,false) THEN
      v_block := v_block || '"CURRENCY_MISMATCH"'::jsonb;
    ELSE
      v_block := v_block || '"FOREIGN_CURRENCY_NOT_SUPPORTED"'::jsonb;
    END IF;
  END IF;

  IF v_basis = '' OR public._bn_means_asset_option('ASSET_VALUATION_BASIS', v_basis) IS NULL THEN
    v_block := v_block || '"ASSET_VALUATION_BASIS_REQUIRED"'::jsonb;
  ELSIF v_cat IS NOT NULL
        AND NOT COALESCE((v_cat->>'valuation_basis_choice')::boolean,false)
        AND v_cat->>'fixed_valuation_basis' IS NOT NULL
        AND v_basis <> (v_cat->>'fixed_valuation_basis') THEN
    v_block := v_block || '"ASSET_VALUATION_BASIS_NOT_PERMITTED"'::jsonb;
  END IF;

  IF v_vdate IS NULL THEN
    v_block := v_block || '"ASSET_VALUATION_DATE_REQUIRED"'::jsonb;
  ELSIF v_vdate > CURRENT_DATE THEN
    v_block := v_block || '"ASSET_VALUATION_DATE_IN_FUTURE"'::jsonb;
  END IF;

  IF v_from IS NULL THEN
    v_block := v_block || '"ASSET_HELD_FROM_REQUIRED"'::jsonb;
  ELSIF v_to IS NOT NULL AND v_to < v_from THEN
    v_block := v_block || '"INVALID_ASSET_PERIOD"'::jsonb;
  END IF;

  IF v_src = '' OR public._bn_means_asset_option('ASSET_FACT_SOURCE', v_src) IS NULL THEN
    v_block := v_block || '"ASSET_FACT_SOURCE_REQUIRED"'::jsonb;
  END IF;

  -- category-driven identification
  IF v_cat IS NOT NULL THEN
    IF COALESCE((v_cat->>'requires_institution')::boolean,false)
       AND COALESCE(btrim(v_det->>'institution_name'),'') = '' THEN
      v_block := v_block || '"ASSET_INSTITUTION_REQUIRED"'::jsonb;
    END IF;
    IF COALESCE((v_cat->>'requires_property_address')::boolean,false)
       AND COALESCE(btrim(v_det->>'property_address'),'') = '' THEN
      v_block := v_block || '"ASSET_PROPERTY_ADDRESS_REQUIRED"'::jsonb;
    END IF;
    IF COALESCE((v_cat->>'requires_registration')::boolean,false)
       AND COALESCE(btrim(v_det->>'registration_number'),'') = '' THEN
      v_block := v_block || '"ASSET_REGISTRATION_REQUIRED"'::jsonb;
    END IF;
    IF COALESCE((v_cat->>'requires_business_name')::boolean,false)
       AND COALESCE(btrim(v_det->>'business_name'),'') = '' THEN
      v_block := v_block || '"ASSET_BUSINESS_NAME_REQUIRED"'::jsonb;
    END IF;
    IF COALESCE((v_cat->>'requires_description')::boolean,false)
       AND COALESCE(btrim(COALESCE(p_payload->>'description','')),'') = '' THEN
      v_block := v_block || '"ASSET_DESCRIPTION_REQUIRED"'::jsonb;
    END IF;
  END IF;

  -- disregard flag must carry a governed reason
  IF COALESCE((p_payload->>'disregard_candidate')::boolean,false)
     AND public._bn_means_asset_option('ASSET_DISREGARD_REASON',
           COALESCE(p_payload->>'disregard_reason_code','')) IS NULL THEN
    v_block := v_block || '"ASSET_DISREGARD_REASON_REQUIRED"'::jsonb;
  END IF;

  -- duplicates / overlaps (warning by default, blocking when policy says so)
  SELECT count(*) INTO v_count FROM public.bn_means_asset_fact f
   WHERE f.assessment_id = p_assessment_id
     AND f.voided_at IS NULL
     AND (p_exclude_fact_id IS NULL OR f.asset_fact_id <> p_exclude_fact_id)
     AND f.member_id IS NOT DISTINCT FROM v_member
     AND f.category_code = v_code
     AND COALESCE(btrim(lower(COALESCE(f.description,''))),'')
         = COALESCE(btrim(lower(COALESCE(p_payload->>'description',''))),'')
     AND COALESCE(f.effective_to,'infinity'::date) >= COALESCE(v_from, f.effective_from)
     AND COALESCE(f.effective_from, f.valuation_date) <= COALESCE(v_to,'infinity'::date);
  IF v_count > 0 THEN
    IF COALESCE(v_rules->>'duplicate_treatment','WARN') = 'BLOCK' THEN
      v_block := v_block || '"DUPLICATE_ASSET"'::jsonb;
    ELSE
      v_warn := v_warn || '"DUPLICATE_ASSET"'::jsonb;
    END IF;
  END IF;

  IF v_from IS NOT NULL AND v_a.effective_to IS NOT NULL AND v_from > v_a.effective_to THEN
    v_warn := v_warn || '"ASSET_OUTSIDE_ASSESSMENT_PERIOD"'::jsonb;
  ELSIF v_to IS NOT NULL AND v_to < v_a.effective_from THEN
    v_warn := v_warn || '"ASSET_OUTSIDE_ASSESSMENT_PERIOD"'::jsonb;
  END IF;

  IF v_member IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.bn_means_no_asset_declaration d
        WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
          AND d.member_id = v_member) THEN
    v_warn := v_warn || '"CONFLICTING_ASSET_FACT"'::jsonb;
  END IF;

  RETURN jsonb_build_object('blockers', v_block, 'warnings', v_warn);
END;
$function$;

-- 6. Backend-owned readiness ---------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_asset_readiness(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a       public.bn_means_assessment%ROWTYPE;
  v_rules   jsonb;
  v_codes   jsonb := '[]'::jsonb;
  v_block   jsonb := '[]'::jsonb;
  v_warn    jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_facts   int := 0;
  v_members int := 0;
  v_with    int := 0;
  v_decl    int := 0;
  v_without int := 0;
  v_total   numeric(18,2) := 0;
  v_flagged int := 0;
  v_count   int;
  v_income_done boolean;
  v_complete boolean;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_rules := public._bn_means_asset_rules(v_a.policy_version_id);

  SELECT count(*), COALESCE(sum(round(valuation_amount * COALESCE(ownership_share,1),2)),0),
         count(*) FILTER (WHERE disregard_candidate)
    INTO v_facts, v_total, v_flagged
    FROM public.bn_means_asset_fact
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL;

  SELECT count(*) INTO v_members FROM public.bn_means_household_member
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL;

  SELECT count(*) INTO v_with FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND EXISTS (SELECT 1 FROM public.bn_means_asset_fact f
                  WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
                    AND f.member_id = m.member_id);

  SELECT count(*) INTO v_decl FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND EXISTS (SELECT 1 FROM public.bn_means_no_asset_declaration d
                  WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
                    AND d.member_id = m.member_id);

  SELECT count(*) INTO v_without FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.bn_means_asset_fact f
                      WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
                        AND f.member_id = m.member_id)
     AND NOT EXISTS (SELECT 1 FROM public.bn_means_no_asset_declaration d
                      WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
                        AND d.member_id = m.member_id);

  v_income_done := EXISTS (SELECT 1 FROM public.bn_means_section_completion sc
                            WHERE sc.assessment_id = p_assessment_id
                              AND sc.section_code = 'INCOME' AND sc.reopened_at IS NULL);
  IF NOT v_income_done THEN
    v_codes := v_codes || '"INCOME_SECTION_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','INCOME_SECTION_INCOMPLETE',
      'message','Complete the income assessment before completing assets.'));
  END IF;

  IF v_members = 0 THEN
    v_codes := v_codes || '"NO_HOUSEHOLD_MEMBERS"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','NO_HOUSEHOLD_MEMBERS',
      'message','No household members are recorded for this assessment.'));
  END IF;

  IF v_without > 0 AND COALESCE((v_rules->>'require_declaration_for_every_member')::boolean,true) THEN
    v_codes := v_codes || '"MEMBER_ASSET_DECLARATION_MISSING"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','MEMBER_ASSET_DECLARATION_MISSING',
      'message', v_without || ' household member(s) have neither a declared asset nor an explicit no-assets declaration.'));
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'code','MEMBER_ASSET_DECLARATION_MISSING',
      'label','Asset or no-assets declaration for every member'));
  END IF;

  SELECT count(*) INTO v_count FROM public.bn_means_asset_fact
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL
     AND ((effective_to IS NOT NULL AND effective_to < v_a.effective_from)
       OR (v_a.effective_to IS NOT NULL
           AND COALESCE(effective_from, valuation_date) > v_a.effective_to));
  IF v_count > 0 THEN
    v_codes := v_codes || '"ASSET_OUTSIDE_ASSESSMENT_PERIOD"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','ASSET_OUTSIDE_ASSESSMENT_PERIOD',
      'message', v_count || ' asset record(s) fall outside the assessment period.'));
  END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM public.bn_means_asset_fact a
      JOIN public.bn_means_asset_fact b
        ON b.assessment_id = a.assessment_id
       AND b.asset_fact_id <> a.asset_fact_id
       AND b.voided_at IS NULL
       AND b.member_id IS NOT DISTINCT FROM a.member_id
       AND b.category_code = a.category_code
       AND btrim(lower(COALESCE(b.description,''))) = btrim(lower(COALESCE(a.description,'')))
     WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL) x;
  IF v_count > 0 THEN
    v_codes := v_codes || '"DUPLICATE_ASSET"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','DUPLICATE_ASSET',
      'message','Potentially duplicate asset records exist for the same owner and category.'));
  END IF;

  SELECT count(*) INTO v_count FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND EXISTS (SELECT 1 FROM public.bn_means_asset_fact f
                  WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL AND f.member_id = m.member_id)
     AND EXISTS (SELECT 1 FROM public.bn_means_no_asset_declaration d
                  WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL AND d.member_id = m.member_id);
  IF v_count > 0 THEN
    v_codes := v_codes || '"CONFLICTING_ASSET_FACT"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','CONFLICTING_ASSET_FACT',
      'message', v_count || ' member(s) have both declared assets and a no-assets declaration.'));
  END IF;

  v_complete := (jsonb_array_length(v_block) = 0 AND v_members > 0);

  RETURN jsonb_build_object(
    'assessment_id', p_assessment_id,
    'section_complete', v_complete,
    'section_status', CASE
        WHEN jsonb_array_length(v_block) > 0 THEN 'BLOCKED'
        WHEN v_facts = 0 AND v_decl = 0 THEN 'NOT_STARTED'
        WHEN v_complete THEN 'COMPLETE'
        ELSE 'IN_PROGRESS' END,
    'section_marked_complete', EXISTS (
        SELECT 1 FROM public.bn_means_section_completion sc
         WHERE sc.assessment_id = p_assessment_id AND sc.section_code = 'ASSETS'
           AND sc.reopened_at IS NULL),
    'current_asset_count', v_facts,
    'household_members_total', v_members,
    'members_with_assets', v_with,
    'members_with_no_asset_declaration', v_decl,
    'members_without_declaration', v_without,
    'declared_attributable_total', v_total,
    'disregard_flagged_count', v_flagged,
    'currency_code', v_a.currency_code,
    'missing_requirements', v_missing,
    'warnings', v_warn,
    'blockers', v_block,
    'reason_codes', v_codes);
END;
$function$;

-- 7. Secured query surfaces ----------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_asset_reference_v1(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', public._bn_means_asset_reference());
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_assets_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_a    public.bn_means_assessment%ROWTYPE;
  v_facts jsonb;
  v_members jsonb;
  v_nodecl jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(public._bn_means_asset_fact_json(f)
                            ORDER BY f.valuation_date DESC, f.created_at DESC), '[]'::jsonb)
    INTO v_facts
    FROM public.bn_means_asset_fact f
   WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL;

  SELECT COALESCE(jsonb_agg(public._bn_means_household_member_json(m)
                            ORDER BY m.is_self DESC, m.member_from), '[]'::jsonb)
    INTO v_members
    FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'declaration_id', d.declaration_id,
           'member_id', d.member_id,
           'effective_from', d.effective_from,
           'effective_to', d.effective_to,
           'declaration_source', d.declaration_source,
           'declaration_source_label', public._bn_means_asset_label('ASSET_FACT_SOURCE', d.declaration_source),
           'reason_code', d.reason_code,
           'reason_label', public._bn_means_asset_label('NO_ASSET_REASON', d.reason_code),
           'confirmation_note', d.confirmation_note,
           'declared_at', d.declared_at) ORDER BY d.declared_at), '[]'::jsonb)
    INTO v_nodecl
    FROM public.bn_means_no_asset_declaration d
   WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'editable', public._bn_means_is_editable(v_a.status),
    'currency_code', v_a.currency_code,
    'assessment_from', v_a.effective_from,
    'assessment_to', v_a.effective_to,
    'asset_rules', public._bn_means_asset_rules(v_a.policy_version_id),
    'household_members', v_members,
    'facts', v_facts,
    'no_asset_declarations', v_nodecl));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_asset_readiness_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb; v_data jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_data := public._bn_means_asset_readiness(p_assessment_id);
  IF v_data IS NULL THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', v_data);
END;
$function$;

-- 8. Governed asset command handler --------------------------
CREATE OR REPLACE FUNCTION public._bn_means_asset_execute(
  p_command_name text, p_assessment_id uuid, p_from_status text, p_actor_user_id uuid,
  p_actor_user_code text, p_correlation_id uuid, p_reason_code text, p_justification text,
  p_payload jsonb, p_row_version bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_a        public.bn_means_assessment%ROWTYPE;
  v_currency text;
  v_snapshot jsonb;
  v_reason   text;
  v_fact     uuid;
  v_new_id   uuid;
  v_count    int;
  v_ready    jsonb;
  v_member   uuid;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:%', p_assessment_id; END IF;
  IF NOT public._bn_means_is_editable(p_from_status) THEN
    RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', p_from_status;
  END IF;

  IF p_command_name IN ('BN_MEANS_ADD_ASSET','BN_MEANS_CORRECT_ASSET') THEN
    v_fact := NULLIF(p_payload->>'asset_fact_id','')::uuid;
    IF p_command_name = 'BN_MEANS_CORRECT_ASSET' THEN
      SELECT count(*) INTO v_count FROM public.bn_means_asset_fact
       WHERE asset_fact_id = v_fact AND assessment_id = p_assessment_id AND voided_at IS NULL;
      IF COALESCE(v_count,0) = 0 THEN
        RAISE EXCEPTION 'E_ASSET_FACT_NOT_FOUND:asset record';
      END IF;
    ELSE
      v_fact := NULL;
    END IF;

    v_currency := COALESCE(NULLIF(p_payload->>'currency_code',''), v_a.currency_code);
    v_snapshot := public._bn_means_asset_validate(p_assessment_id, p_payload, v_fact);
    IF jsonb_array_length(v_snapshot->'blockers') > 0 THEN
      v_reason := (v_snapshot->'blockers'->>0);
      IF v_reason = 'CURRENCY_MISMATCH' THEN
        RAISE EXCEPTION 'E_CURRENCY_MISMATCH:assessment=% fact=%', v_a.currency_code, v_currency;
      ELSIF v_reason = 'FOREIGN_CURRENCY_NOT_SUPPORTED' THEN
        RAISE EXCEPTION 'E_FOREIGN_CURRENCY_NOT_SUPPORTED:%', v_currency;
      ELSIF v_reason = 'MEMBER_NOT_FOUND' THEN
        RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
      ELSE
        RAISE EXCEPTION 'E_ASSET_VALIDATION_FAILED:%', v_reason;
      END IF;
    END IF;

    IF p_command_name = 'BN_MEANS_CORRECT_ASSET' THEN
      UPDATE public.bn_means_asset_fact
         SET voided_at = now(), voided_by = p_actor_user_id,
             updated_at = now(), updated_by = p_actor_user_id
       WHERE asset_fact_id = v_fact AND assessment_id = p_assessment_id;
      SELECT fact_version INTO v_count FROM public.bn_means_asset_fact WHERE asset_fact_id = v_fact;
    ELSE
      v_count := 0;
    END IF;

    INSERT INTO public.bn_means_asset_fact(
      assessment_id, member_id, category_code, description, asset_details,
      ownership_type, ownership_share, co_owner_note, valuation_amount, currency_code,
      valuation_basis, valuation_date, valuation_source, effective_from, effective_to,
      fact_source, disregard_candidate, disregard_reason_code, asset_notes,
      fact_version, supersedes_fact_id, created_by, updated_by)
    VALUES (p_assessment_id, NULLIF(p_payload->>'member_id','')::uuid,
      p_payload->>'category_code',
      NULLIF(btrim(COALESCE(p_payload->>'description','')),''),
      COALESCE(p_payload->'asset_details','{}'::jsonb),
      COALESCE(NULLIF(p_payload->>'ownership_type',''),'SOLE'),
      COALESCE((p_payload->>'ownership_share')::numeric, 1),
      NULLIF(btrim(COALESCE(p_payload->>'co_owner_note','')),''),
      (p_payload->>'valuation_amount')::numeric, v_currency,
      COALESCE(NULLIF(p_payload->>'valuation_basis',''),'MARKET_VALUE'),
      (p_payload->>'valuation_date')::date,
      NULLIF(btrim(COALESCE(p_payload->>'valuation_source','')),''),
      COALESCE(NULLIF(p_payload->>'effective_from','')::date, (p_payload->>'valuation_date')::date),
      NULLIF(p_payload->>'effective_to','')::date,
      COALESCE(NULLIF(p_payload->>'fact_source',''),'APPLICANT_DECLARATION'),
      COALESCE((p_payload->>'disregard_candidate')::boolean, false),
      NULLIF(p_payload->>'disregard_reason_code',''),
      NULLIF(btrim(COALESCE(p_payload->>'asset_notes','')),''),
      COALESCE(v_count,0) + 1, v_fact, p_actor_user_id, p_actor_user_id)
    RETURNING asset_fact_id INTO v_new_id;

    PERFORM public._bn_means_event(p_assessment_id,
      CASE WHEN p_command_name = 'BN_MEANS_CORRECT_ASSET' THEN 'ASSET_CORRECTED' ELSE 'ASSET_ADDED' END,
      p_command_name, p_from_status, p_from_status, p_reason_code, p_justification,
      p_payload || jsonb_build_object('asset_fact_id', v_new_id, 'superseded_fact_id', v_fact),
      p_actor_user_id, p_actor_user_code, p_correlation_id, p_row_version);

    RETURN jsonb_build_object('asset_fact_id', v_new_id,
      'superseded_fact_id', v_fact,
      'warnings', COALESCE(v_snapshot->'warnings','[]'::jsonb));

  ELSIF p_command_name = 'BN_MEANS_VOID_ASSET' THEN
    v_fact := NULLIF(p_payload->>'asset_fact_id','')::uuid;
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:asset record';
    END IF;
    UPDATE public.bn_means_asset_fact
       SET voided_at = now(), voided_by = p_actor_user_id,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE asset_fact_id = v_fact AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_ASSET_FACT_NOT_FOUND:asset record';
    END IF;
    PERFORM public._bn_means_event(p_assessment_id,'ASSET_VOIDED',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,p_payload,
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('asset_fact_id', v_fact, 'voided', true);

  ELSIF p_command_name = 'BN_MEANS_DECLARE_NO_ASSETS' THEN
    v_member := NULLIF(p_payload->>'member_id','')::uuid;
    IF v_member IS NULL OR COALESCE(p_payload->>'effective_from','') = ''
       OR COALESCE(p_payload->>'reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:no-assets declaration';
    END IF;
    SELECT count(*) INTO v_count FROM public.bn_means_household_member
     WHERE member_id = v_member AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF COALESCE(v_count,0) = 0 THEN
      RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
    END IF;
    IF public._bn_means_asset_option('NO_ASSET_REASON', p_payload->>'reason_code') IS NULL THEN
      RAISE EXCEPTION 'E_ASSET_VALIDATION_FAILED:INVALID_NO_ASSET_REASON';
    END IF;
    SELECT count(*) INTO v_count FROM public.bn_means_no_asset_declaration
     WHERE assessment_id = p_assessment_id AND member_id = v_member AND voided_at IS NULL;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_ASSET_VALIDATION_FAILED:DUPLICATE_NO_ASSET_DECLARATION';
    END IF;
    INSERT INTO public.bn_means_no_asset_declaration(
      assessment_id, member_id, effective_from, effective_to, declaration_source,
      reason_code, confirmation_note, declared_by)
    VALUES (p_assessment_id, v_member, (p_payload->>'effective_from')::date,
      NULLIF(p_payload->>'effective_to','')::date,
      COALESCE(NULLIF(p_payload->>'declaration_source',''),'APPLICANT_DECLARATION'),
      p_payload->>'reason_code',
      NULLIF(btrim(COALESCE(p_payload->>'confirmation_note','')),''), p_actor_user_id)
    RETURNING declaration_id INTO v_fact;
    PERFORM public._bn_means_event(p_assessment_id,'NO_ASSETS_DECLARED',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,
      p_payload || jsonb_build_object('declaration_id', v_fact),
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('declaration_id', v_fact);

  ELSIF p_command_name = 'BN_MEANS_WITHDRAW_NO_ASSETS' THEN
    v_fact := NULLIF(p_payload->>'declaration_id','')::uuid;
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:no-assets declaration';
    END IF;
    UPDATE public.bn_means_no_asset_declaration
       SET voided_at = now(), voided_by = p_actor_user_id, updated_at = now()
     WHERE declaration_id = v_fact AND assessment_id = p_assessment_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_ASSET_FACT_NOT_FOUND:no-assets declaration';
    END IF;
    PERFORM public._bn_means_event(p_assessment_id,'NO_ASSETS_WITHDRAWN',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,p_payload,
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('declaration_id', v_fact, 'voided', true);

  ELSIF p_command_name = 'BN_MEANS_MARK_ASSETS_COMPLETE' THEN
    v_ready := public._bn_means_asset_readiness(p_assessment_id);
    IF NOT COALESCE((v_ready->>'section_complete')::boolean,false) THEN
      RAISE EXCEPTION 'E_SECTION_NOT_READY:%', 'ASSETS';
    END IF;
    INSERT INTO public.bn_means_section_completion(assessment_id, section_code, completed_by)
    VALUES (p_assessment_id, 'ASSETS', p_actor_user_id)
    ON CONFLICT (assessment_id, section_code) DO UPDATE
      SET completed_at = now(), completed_by = EXCLUDED.completed_by,
          reopened_at = NULL, reopened_by = NULL, updated_at = now();
    PERFORM public._bn_means_event(p_assessment_id,'ASSETS_SECTION_COMPLETED',p_command_name,
      p_from_status,p_from_status,p_reason_code,p_justification,
      jsonb_build_object('section_code','ASSETS'),
      p_actor_user_id,p_actor_user_code,p_correlation_id,p_row_version);
    RETURN jsonb_build_object('section_code','ASSETS','section_complete', true);
  END IF;

  RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
END;
$function$;

-- 9. Wire the new commands into the governed command pipeline
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_new := $new$ELSIF p_command_name IN ('BN_MEANS_ADD_ASSET','BN_MEANS_CORRECT_ASSET',
                           'BN_MEANS_VOID_ASSET','BN_MEANS_DECLARE_NO_ASSETS',
                           'BN_MEANS_WITHDRAW_NO_ASSETS','BN_MEANS_MARK_ASSETS_COMPLETE') THEN
    -- MEANS-TEST EPIC 4 — asset assessment handled by the governed helper.
    v_result := public._bn_means_asset_execute(p_command_name, v_id, v_from, p_actor_user_id,
                  p_actor_user_code, p_correlation_id, p_reason_code, p_justification,
                  COALESCE(p_payload,'{}'::jsonb), v_a.row_version);

  ELSIF p_command_name = 'BN_MEANS_ADD_DEDUCTION' THEN$new$;

  v_def := pg_get_functiondef(
    'public.bn_means_execute_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid)'::regprocedure);

  IF position('BN_MEANS_MARK_ASSETS_COMPLETE' in v_def) = 0 THEN
    v_def := regexp_replace(
      v_def,
      $re$ELSIF p_command_name = 'BN_MEANS_ADD_ASSET' THEN.*?ELSIF p_command_name = 'BN_MEANS_ADD_DEDUCTION' THEN$re$,
      v_new,
      '');
    IF position('BN_MEANS_MARK_ASSETS_COMPLETE' in v_def) = 0 THEN
      RAISE EXCEPTION 'MEANS EPIC 4: could not locate the asset handler anchor';
    END IF;
    EXECUTE v_def;
  END IF;
END
$do$;

DO $do$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.bn_means_available_actions_v1(uuid,uuid)'::regprocedure);
  IF position('BN_MEANS_MARK_ASSETS_COMPLETE' in v_def) = 0 THEN
    v_def := replace(v_def,
      $old$'BN_MEANS_ADD_ASSET',$old$,
      $new$'BN_MEANS_ADD_ASSET','BN_MEANS_CORRECT_ASSET','BN_MEANS_VOID_ASSET','BN_MEANS_DECLARE_NO_ASSETS','BN_MEANS_WITHDRAW_NO_ASSETS','BN_MEANS_MARK_ASSETS_COMPLETE',$new$);
    IF position('BN_MEANS_MARK_ASSETS_COMPLETE' in v_def) = 0 THEN
      RAISE EXCEPTION 'MEANS EPIC 4: could not locate the available-actions anchor';
    END IF;
    EXECUTE v_def;
  END IF;
END
$do$;

REVOKE ALL ON FUNCTION public.bn_means_assets_v1(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_asset_readiness_v1(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_asset_reference_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_assets_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_asset_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_asset_reference_v1(uuid) TO authenticated, service_role;

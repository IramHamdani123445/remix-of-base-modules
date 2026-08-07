-- =========================================================================
-- MEANS-TEST EPIC 3 — Income assessment foundation
-- =========================================================================

ALTER TABLE public.bn_means_income_fact
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS employer_regno text,
  ADD COLUMN IF NOT EXISTS employer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS income_notes text,
  ADD COLUMN IF NOT EXISTS occurrence_date date,
  ADD COLUMN IF NOT EXISTS annualisation_method text NOT NULL DEFAULT 'FREQUENCY_MULTIPLIER',
  ADD COLUMN IF NOT EXISTS fact_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_fact_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_income_dates_chk') THEN
    ALTER TABLE public.bn_means_income_fact
      ADD CONSTRAINT bn_means_income_dates_chk
      CHECK (effective_to IS NULL OR effective_to >= effective_from);
  END IF;
END $$;

ALTER TABLE public.bn_means_policy_version
  ADD COLUMN IF NOT EXISTS income_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

-- --------------------------------------------------------- no-income record

CREATE TABLE IF NOT EXISTS public.bn_means_no_income_declaration (
  declaration_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES public.bn_means_household_member(member_id) ON DELETE CASCADE,
  effective_from  date NOT NULL,
  effective_to    date,
  declaration_source text NOT NULL DEFAULT 'APPLICANT_DECLARATION',
  reason_code     text,
  confirmation_note text,
  declared_by     uuid,
  declared_at     timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  voided_by       uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_no_income_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

GRANT SELECT ON public.bn_means_no_income_declaration TO authenticated;
GRANT ALL ON public.bn_means_no_income_declaration TO service_role;
ALTER TABLE public.bn_means_no_income_declaration ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='bn_means_no_income_declaration'
                    AND policyname='bn_means_no_income_staff_read') THEN
    CREATE POLICY "bn_means_no_income_staff_read"
      ON public.bn_means_no_income_declaration FOR SELECT TO authenticated
      USING (COALESCE((public.bn_means_check_actor_permission(auth.uid(),'read',false)->>'ok')::boolean,false));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bn_means_no_income_assessment_idx
  ON public.bn_means_no_income_declaration(assessment_id) WHERE voided_at IS NULL;

-- ------------------------------------------------------ section completion

CREATE TABLE IF NOT EXISTS public.bn_means_section_completion (
  completion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  section_code  text NOT NULL,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  completed_by  uuid,
  reopened_at   timestamptz,
  reopened_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_section_code_chk CHECK (section_code IN ('CONTEXT','HOUSEHOLD','INCOME','ASSETS','DEDUCTIONS','EVIDENCE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS bn_means_section_completion_uq
  ON public.bn_means_section_completion(assessment_id, section_code);

GRANT SELECT ON public.bn_means_section_completion TO authenticated;
GRANT ALL ON public.bn_means_section_completion TO service_role;
ALTER TABLE public.bn_means_section_completion ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='bn_means_section_completion'
                    AND policyname='bn_means_section_completion_staff_read') THEN
    CREATE POLICY "bn_means_section_completion_staff_read"
      ON public.bn_means_section_completion FOR SELECT TO authenticated
      USING (COALESCE((public.bn_means_check_actor_permission(auth.uid(),'read',false)->>'ok')::boolean,false));
  END IF;
END $$;

-- ----------------------------------------------------------------- reference

CREATE OR REPLACE FUNCTION public._bn_means_income_reference()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'INCOME_CATEGORY', jsonb_build_array(
      jsonb_build_object('value','EMPLOYMENT','label','Employment income',
        'description','Wages or salary paid by an employer.',
        'requires_employer',true,'requires_source_name',false,'basis_choice',true,
        'allow_one_off',false,'evidence_normally_required',true),
      jsonb_build_object('value','SELF_EMPLOYMENT','label','Self-employment income',
        'description','Income from a trade, business or profession.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',true,
        'allow_one_off',false,'evidence_normally_required',true),
      jsonb_build_object('value','PENSION','label','Pension income',
        'description','Contributory or occupational pension payments.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',false,
        'fixed_basis','GROSS','allow_one_off',false,'evidence_normally_required',true,
        'benefit_source_available',true),
      jsonb_build_object('value','SOCIAL_SECURITY_BENEFIT','label','Social benefit income',
        'description','Other social security or assistance payments.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',false,
        'fixed_basis','GROSS','allow_one_off',true,'evidence_normally_required',false,
        'benefit_source_available',true),
      jsonb_build_object('value','RENTAL','label','Rental income',
        'description','Rent received from land or property.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',true,
        'allow_one_off',false,'evidence_normally_required',true),
      jsonb_build_object('value','INVESTMENT','label','Investment income',
        'description','Interest, dividends or other returns on capital.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',false,
        'fixed_basis','GROSS','allow_one_off',true,'evidence_normally_required',false),
      jsonb_build_object('value','MAINTENANCE','label','Maintenance or support',
        'description','Maintenance, alimony or family support received.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',false,
        'fixed_basis','NET','allow_one_off',true,'evidence_normally_required',false),
      jsonb_build_object('value','REGULAR_TRANSFER','label','Regular transfer',
        'description','Regular money transfer or remittance received.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',false,
        'fixed_basis','NET','allow_one_off',true,'evidence_normally_required',false),
      jsonb_build_object('value','OTHER_INCOME','label','Other income',
        'description','Any other recurring or one-off income.',
        'requires_employer',false,'requires_source_name',true,'basis_choice',true,
        'allow_one_off',true,'evidence_normally_required',false)),
    'INCOME_FREQUENCY', jsonb_build_array(
      jsonb_build_object('value','WEEKLY','label','Weekly','periods_per_year',52),
      jsonb_build_object('value','FORTNIGHTLY','label','Fortnightly','periods_per_year',26),
      jsonb_build_object('value','FOUR_WEEKLY','label','Four-weekly','periods_per_year',13),
      jsonb_build_object('value','SEMI_MONTHLY','label','Semi-monthly','periods_per_year',24),
      jsonb_build_object('value','MONTHLY','label','Monthly','periods_per_year',12),
      jsonb_build_object('value','QUARTERLY','label','Quarterly','periods_per_year',4),
      jsonb_build_object('value','SEMI_ANNUAL','label','Semi-annual','periods_per_year',2),
      jsonb_build_object('value','ANNUAL','label','Annual','periods_per_year',1),
      jsonb_build_object('value','ONE_OFF','label','One-off','periods_per_year',1)),
    'INCOME_BASIS', jsonb_build_array(
      jsonb_build_object('value','GROSS','label','Gross','description','Before statutory deductions'),
      jsonb_build_object('value','NET','label','Net','description','After statutory deductions')),
    'INCOME_FACT_SOURCE', jsonb_build_array(
      jsonb_build_object('value','APPLICANT_DECLARATION','label','Applicant declaration'),
      jsonb_build_object('value','PERSON_RECORD','label','Person record'),
      jsonb_build_object('value','EMPLOYER_RECORD','label','Employer record'),
      jsonb_build_object('value','CONTRIBUTION_RECORD','label','Contribution record'),
      jsonb_build_object('value','BENEFIT_RECORD','label','Existing benefit record'),
      jsonb_build_object('value','OFFICER_CONFIRMED','label','Officer confirmed'),
      jsonb_build_object('value','EXTERNAL_EVIDENCE','label','External evidence')),
    'NO_INCOME_REASON', jsonb_build_array(
      jsonb_build_object('value','NOT_WORKING','label','Not working and receives nothing'),
      jsonb_build_object('value','DEPENDENT_CHILD','label','Dependent child with no income'),
      jsonb_build_object('value','STUDENT','label','Full-time student with no income'),
      jsonb_build_object('value','SUPPORTED_BY_HOUSEHOLD','label','Fully supported by the household'),
      jsonb_build_object('value','OTHER_NO_INCOME','label','Other confirmed reason'))
  );
$$;

CREATE OR REPLACE FUNCTION public._bn_means_income_option(p_set text, p_value text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT o FROM jsonb_array_elements(public._bn_means_income_reference()->p_set) o
   WHERE o->>'value' = p_value LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._bn_means_income_label(p_set text, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(public._bn_means_income_option(p_set, p_value)->>'label', p_value);
$$;

CREATE OR REPLACE FUNCTION public._bn_means_income_rules(p_policy_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'require_declaration_for_every_member', true,
           'allow_household_level_income', false,
           'allow_negative_income', false,
           'allow_foreign_currency', false,
           'duplicate_treatment','WARN')
         || COALESCE((SELECT income_rules FROM public.bn_means_policy_version
                       WHERE policy_version_id = p_policy_version_id), '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.bn_means_income_reference_v1(p_actor_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', public._bn_means_income_reference());
END;
$$;

-- ---------------------------------------------------------------- validation

CREATE OR REPLACE FUNCTION public._bn_means_income_validate(
  p_assessment_id uuid,
  p_payload jsonb,
  p_exclude_fact_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_a      public.bn_means_assessment%ROWTYPE;
  v_m      public.bn_means_household_member%ROWTYPE;
  v_rules  jsonb;
  v_cat    jsonb;
  v_block  jsonb := '[]'::jsonb;
  v_warn   jsonb := '[]'::jsonb;
  v_member uuid  := NULLIF(p_payload->>'member_id','')::uuid;
  v_code   text  := COALESCE(p_payload->>'category_code','');
  v_freq   text  := COALESCE(p_payload->>'declared_frequency','');
  v_basis  text  := COALESCE(p_payload->>'basis','');
  v_src    text  := COALESCE(p_payload->>'fact_source','');
  v_amt    numeric := NULLIF(p_payload->>'declared_amount','')::numeric;
  v_from   date  := NULLIF(p_payload->>'effective_from','')::date;
  v_to     date  := NULLIF(p_payload->>'effective_to','')::date;
  v_cur    text  := NULLIF(p_payload->>'currency_code','');
  v_regno  text  := NULLIF(p_payload->>'employer_regno','');
  v_sname  text  := NULLIF(btrim(COALESCE(p_payload->>'source_name','')),'');
  v_count  int;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('blockers', jsonb_build_array('NOT_FOUND'), 'warnings','[]'::jsonb);
  END IF;
  v_rules := public._bn_means_income_rules(v_a.policy_version_id);
  v_cat   := public._bn_means_income_option('INCOME_CATEGORY', v_code);

  IF v_code = '' THEN
    v_block := v_block || '"INCOME_CATEGORY_REQUIRED"'::jsonb;
  ELSIF v_cat IS NULL THEN
    v_block := v_block || '"INCOME_CATEGORY_REQUIRED"'::jsonb;
  END IF;

  -- household member linkage
  IF v_member IS NULL THEN
    IF NOT COALESCE((v_rules->>'allow_household_level_income')::boolean,false) THEN
      v_block := v_block || '"INCOME_MEMBER_REQUIRED"'::jsonb;
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
        v_block := v_block || '"INCOME_OUTSIDE_HOUSEHOLD_MEMBERSHIP"'::jsonb;
      END IF;
    END IF;
  END IF;

  -- amount
  IF v_amt IS NULL THEN
    v_block := v_block || '"INCOME_AMOUNT_REQUIRED"'::jsonb;
  ELSIF v_amt < 0 AND NOT COALESCE((v_rules->>'allow_negative_income')::boolean,false) THEN
    v_block := v_block || '"NEGATIVE_INCOME_NOT_PERMITTED"'::jsonb;
  END IF;

  -- currency
  IF v_cur IS NOT NULL AND v_cur <> v_a.currency_code THEN
    IF COALESCE((v_rules->>'allow_foreign_currency')::boolean,false) THEN
      v_block := v_block || '"CURRENCY_MISMATCH"'::jsonb;
    ELSE
      v_block := v_block || '"FOREIGN_CURRENCY_NOT_SUPPORTED"'::jsonb;
    END IF;
  END IF;

  -- frequency
  IF v_freq = '' OR public._bn_means_income_option('INCOME_FREQUENCY', v_freq) IS NULL THEN
    v_block := v_block || '"INCOME_FREQUENCY_REQUIRED"'::jsonb;
  ELSIF v_freq = 'ONE_OFF' AND v_cat IS NOT NULL
        AND NOT COALESCE((v_cat->>'allow_one_off')::boolean,false) THEN
    v_block := v_block || '"ONE_OFF_NOT_PERMITTED"'::jsonb;
  END IF;

  -- basis
  IF v_cat IS NOT NULL THEN
    IF COALESCE((v_cat->>'basis_choice')::boolean,false) THEN
      IF v_basis NOT IN ('GROSS','NET') THEN
        v_block := v_block || '"INCOME_BASIS_REQUIRED"'::jsonb;
      END IF;
    ELSIF v_basis <> '' AND v_cat->>'fixed_basis' IS NOT NULL
          AND v_basis <> (v_cat->>'fixed_basis') THEN
      v_block := v_block || '"INCOME_BASIS_REQUIRED"'::jsonb;
    END IF;

    -- source identification
    IF COALESCE((v_cat->>'requires_employer')::boolean,false) AND v_regno IS NULL THEN
      v_block := v_block || '"EMPLOYER_REQUIRED"'::jsonb;
    END IF;
    IF COALESCE((v_cat->>'requires_source_name')::boolean,false) AND v_sname IS NULL THEN
      v_block := v_block || '"INCOME_SOURCE_REQUIRED"'::jsonb;
    END IF;
  END IF;

  -- fact source
  IF v_src = '' OR public._bn_means_income_option('INCOME_FACT_SOURCE', v_src) IS NULL THEN
    v_block := v_block || '"INCOME_FACT_SOURCE_REQUIRED"'::jsonb;
  END IF;

  -- dates
  IF v_from IS NULL THEN
    v_block := v_block || '"INCOME_START_REQUIRED"'::jsonb;
  ELSE
    IF v_to IS NOT NULL AND v_to < v_from THEN
      v_block := v_block || '"INVALID_INCOME_PERIOD"'::jsonb;
    END IF;
    IF (v_to IS NOT NULL AND v_to < v_a.effective_from)
       OR (v_a.effective_to IS NOT NULL AND v_from > v_a.effective_to) THEN
      v_block := v_block || '"INCOME_OUTSIDE_ASSESSMENT_PERIOD"'::jsonb;
    END IF;
  END IF;

  -- duplicates / overlaps / conflicts
  IF v_member IS NOT NULL AND v_code <> '' AND v_from IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.bn_means_income_fact f
     WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
       AND (p_exclude_fact_id IS NULL OR f.income_fact_id <> p_exclude_fact_id)
       AND f.member_id = v_member AND f.category_code = v_code
       AND COALESCE(f.employer_regno,'~') IS NOT DISTINCT FROM COALESCE(v_regno,'~')
       AND lower(COALESCE(f.source_name,'')) = lower(COALESCE(v_sname,''))
       AND COALESCE(f.effective_to,'infinity'::date) >= v_from
       AND f.effective_from <= COALESCE(v_to,'infinity'::date);
    IF v_count > 0 THEN
      SELECT count(*) INTO v_count FROM public.bn_means_income_fact f
       WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
         AND (p_exclude_fact_id IS NULL OR f.income_fact_id <> p_exclude_fact_id)
         AND f.member_id = v_member AND f.category_code = v_code
         AND COALESCE(f.employer_regno,'~') IS NOT DISTINCT FROM COALESCE(v_regno,'~')
         AND lower(COALESCE(f.source_name,'')) = lower(COALESCE(v_sname,''))
         AND COALESCE(f.effective_to,'infinity'::date) >= v_from
         AND f.effective_from <= COALESCE(v_to,'infinity'::date)
         AND f.declared_amount = COALESCE(v_amt, f.declared_amount)
         AND f.declared_frequency = v_freq;
      IF v_count > 0 THEN
        IF COALESCE(v_rules->>'duplicate_treatment','WARN') = 'BLOCK' THEN
          v_block := v_block || '"DUPLICATE_INCOME"'::jsonb;
        ELSE
          v_warn := v_warn || '"DUPLICATE_INCOME"'::jsonb;
        END IF;
      ELSE
        v_warn := v_warn || '"OVERLAPPING_INCOME"'::jsonb;
      END IF;

      SELECT count(*) INTO v_count FROM public.bn_means_income_fact f
       WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
         AND (p_exclude_fact_id IS NULL OR f.income_fact_id <> p_exclude_fact_id)
         AND f.member_id = v_member AND f.category_code = v_code
         AND COALESCE(f.employer_regno,'~') IS NOT DISTINCT FROM COALESCE(v_regno,'~')
         AND COALESCE(f.effective_to,'infinity'::date) >= v_from
         AND f.effective_from <= COALESCE(v_to,'infinity'::date)
         AND v_basis <> '' AND f.basis <> v_basis;
      IF v_count > 0 THEN
        v_warn := v_warn || '"CONFLICTING_INCOME_FACT"'::jsonb;
      END IF;
    END IF;

    -- an explicit no-income declaration contradicts a declared income fact
    SELECT count(*) INTO v_count FROM public.bn_means_no_income_declaration d
     WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
       AND d.member_id = v_member
       AND COALESCE(d.effective_to,'infinity'::date) >= v_from
       AND d.effective_from <= COALESCE(v_to,'infinity'::date);
    IF v_count > 0 THEN
      v_warn := v_warn || '"CONFLICTING_INCOME_FACT"'::jsonb;
    END IF;
  END IF;

  RETURN jsonb_build_object('blockers', v_block, 'warnings', v_warn);
END;
$$;

-- ------------------------------------------------------------------ queries

CREATE OR REPLACE FUNCTION public._bn_means_income_fact_json(p_f public.bn_means_income_fact)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'income_fact_id', p_f.income_fact_id,
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
    'category_label', public._bn_means_income_label('INCOME_CATEGORY', p_f.category_code),
    'income_source', p_f.income_source,
    'source_name', COALESCE(p_f.source_name, NULLIF(p_f.employer_snapshot->>'employer_name',''), p_f.income_source),
    'employer_regno', p_f.employer_regno,
    'employer_name', NULLIF(p_f.employer_snapshot->>'employer_name',''),
    'employer_status', NULLIF(p_f.employer_snapshot->>'employer_status',''),
    'basis', p_f.basis,
    'basis_label', public._bn_means_income_label('INCOME_BASIS', p_f.basis),
    'declared_amount', p_f.declared_amount,
    'declared_frequency', p_f.declared_frequency,
    'declared_frequency_label', public._bn_means_income_label('INCOME_FREQUENCY', p_f.declared_frequency),
    'currency_code', p_f.currency_code,
    'normalised_annual_amount', p_f.normalised_annual_amount,
    'annualisation_method', p_f.annualisation_method,
    'is_one_off', (p_f.declared_frequency = 'ONE_OFF'),
    'occurrence_date', p_f.occurrence_date,
    'effective_from', p_f.effective_from,
    'effective_to', p_f.effective_to,
    'fact_source', p_f.fact_source,
    'fact_source_label', public._bn_means_income_label('INCOME_FACT_SOURCE', p_f.fact_source),
    'evidence_status', p_f.evidence_status,
    'verification_status', p_f.verification_status,
    'income_notes', p_f.income_notes,
    'fact_version', p_f.fact_version,
    'supersedes_fact_id', p_f.supersedes_fact_id,
    'created_at', p_f.created_at,
    'updated_at', p_f.updated_at);
$$;

CREATE OR REPLACE FUNCTION public.bn_means_income_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT COALESCE(jsonb_agg(public._bn_means_income_fact_json(f)
                            ORDER BY f.effective_from DESC, f.created_at DESC), '[]'::jsonb)
    INTO v_facts
    FROM public.bn_means_income_fact f
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
           'declaration_source_label', public._bn_means_income_label('INCOME_FACT_SOURCE', d.declaration_source),
           'reason_code', d.reason_code,
           'reason_label', public._bn_means_income_label('NO_INCOME_REASON', d.reason_code),
           'confirmation_note', d.confirmation_note,
           'declared_at', d.declared_at) ORDER BY d.declared_at), '[]'::jsonb)
    INTO v_nodecl
    FROM public.bn_means_no_income_declaration d
   WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'editable', public._bn_means_is_editable(v_a.status),
    'currency_code', v_a.currency_code,
    'assessment_from', v_a.effective_from,
    'assessment_to', v_a.effective_to,
    'income_rules', public._bn_means_income_rules(v_a.policy_version_id),
    'household_members', v_members,
    'facts', v_facts,
    'no_income_declarations', v_nodecl));
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_means_income_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perm    jsonb;
  v_a       public.bn_means_assessment%ROWTYPE;
  v_rules   jsonb;
  v_codes   jsonb := '[]'::jsonb;
  v_block   jsonb := '[]'::jsonb;
  v_warn    jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_hh_ready jsonb;
  v_facts   int := 0;
  v_members int := 0;
  v_with    int := 0;
  v_decl    int := 0;
  v_without int := 0;
  v_total   numeric(18,2) := 0;
  v_count   int;
  v_complete boolean;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  v_rules := public._bn_means_income_rules(v_a.policy_version_id);

  SELECT count(*), COALESCE(sum(normalised_annual_amount),0)
    INTO v_facts, v_total
    FROM public.bn_means_income_fact
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL;

  SELECT count(*) INTO v_members FROM public.bn_means_household_member
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL;

  SELECT count(*) INTO v_with FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND EXISTS (SELECT 1 FROM public.bn_means_income_fact f
                  WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
                    AND f.member_id = m.member_id);

  SELECT count(*) INTO v_decl FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND EXISTS (SELECT 1 FROM public.bn_means_no_income_declaration d
                  WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
                    AND d.member_id = m.member_id);

  SELECT count(*) INTO v_without FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.bn_means_income_fact f
                      WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL
                        AND f.member_id = m.member_id)
     AND NOT EXISTS (SELECT 1 FROM public.bn_means_no_income_declaration d
                      WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL
                        AND d.member_id = m.member_id);

  -- household must be complete before income can be completed
  v_hh_ready := public.bn_means_household_readiness_v1(p_actor_user_id, p_assessment_id);
  IF NOT COALESCE((v_hh_ready->'data'->>'section_complete')::boolean,false) THEN
    v_codes := v_codes || '"HOUSEHOLD_SECTION_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','HOUSEHOLD_SECTION_INCOMPLETE',
      'message','Complete the household composition before completing income.'));
  END IF;

  IF v_members = 0 THEN
    v_codes := v_codes || '"NO_HOUSEHOLD_MEMBERS"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','NO_HOUSEHOLD_MEMBERS',
      'message','No household members are recorded for this assessment.'));
  END IF;

  IF v_without > 0 AND COALESCE((v_rules->>'require_declaration_for_every_member')::boolean,true) THEN
    v_codes := v_codes || '"MEMBER_INCOME_DECLARATION_MISSING"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','MEMBER_INCOME_DECLARATION_MISSING',
      'message', v_without || ' household member(s) have neither an income record nor an explicit no-income declaration.'));
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'code','MEMBER_INCOME_DECLARATION_MISSING',
      'label','Income or no-income declaration for every member'));
  END IF;

  -- facts recorded outside the assessment period
  SELECT count(*) INTO v_count FROM public.bn_means_income_fact
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL
     AND ((effective_to IS NOT NULL AND effective_to < v_a.effective_from)
       OR (v_a.effective_to IS NOT NULL AND effective_from > v_a.effective_to));
  IF v_count > 0 THEN
    v_codes := v_codes || '"INCOME_OUTSIDE_ASSESSMENT_PERIOD"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','INCOME_OUTSIDE_ASSESSMENT_PERIOD',
      'message', v_count || ' income record(s) fall outside the assessment period.'));
  END IF;

  -- overlapping records for the same member, category and source
  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM public.bn_means_income_fact a
      JOIN public.bn_means_income_fact b
        ON b.assessment_id = a.assessment_id
       AND b.income_fact_id <> a.income_fact_id
       AND b.voided_at IS NULL
       AND b.member_id IS NOT DISTINCT FROM a.member_id
       AND b.category_code = a.category_code
       AND COALESCE(b.employer_regno,'~') IS NOT DISTINCT FROM COALESCE(a.employer_regno,'~')
       AND COALESCE(b.effective_to,'infinity'::date) >= a.effective_from
       AND b.effective_from <= COALESCE(a.effective_to,'infinity'::date)
     WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL) x;
  IF v_count > 0 THEN
    v_codes := v_codes || '"OVERLAPPING_INCOME"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','OVERLAPPING_INCOME',
      'message','Overlapping income records exist for the same member and source.'));
  END IF;

  -- a member with both an income record and a no-income declaration
  SELECT count(*) INTO v_count FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
     AND EXISTS (SELECT 1 FROM public.bn_means_income_fact f
                  WHERE f.assessment_id = p_assessment_id AND f.voided_at IS NULL AND f.member_id = m.member_id)
     AND EXISTS (SELECT 1 FROM public.bn_means_no_income_declaration d
                  WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL AND d.member_id = m.member_id);
  IF v_count > 0 THEN
    v_codes := v_codes || '"CONFLICTING_INCOME_FACT"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','CONFLICTING_INCOME_FACT',
      'message', v_count || ' member(s) have both declared income and a no-income declaration.'));
  END IF;

  v_complete := (jsonb_array_length(v_block) = 0 AND v_members > 0);

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'section_complete', v_complete,
    'section_status', CASE
        WHEN jsonb_array_length(v_block) > 0 THEN 'BLOCKED'
        WHEN v_facts = 0 AND v_decl = 0 THEN 'NOT_STARTED'
        WHEN v_complete THEN 'COMPLETE'
        ELSE 'IN_PROGRESS' END,
    'section_marked_complete', EXISTS (
        SELECT 1 FROM public.bn_means_section_completion sc
         WHERE sc.assessment_id = p_assessment_id AND sc.section_code = 'INCOME'
           AND sc.reopened_at IS NULL),
    'current_income_count', v_facts,
    'household_members_total', v_members,
    'members_with_income', v_with,
    'members_with_no_income_declaration', v_decl,
    'members_without_declaration', v_without,
    'declared_annualised_total', v_total,
    'currency_code', v_a.currency_code,
    'missing_requirements', v_missing,
    'warnings', v_warn,
    'blockers', v_block,
    'reason_codes', v_codes));
END;
$$;

-- governed employer lookup (no raw internal identifier is returned)
CREATE OR REPLACE FUNCTION public.bn_means_employer_search_v1(
  p_actor_user_id uuid, p_term text, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perm jsonb;
  v_term text := btrim(COALESCE(p_term,''));
  v_out  jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  IF length(v_term) < 2 THEN
    RETURN jsonb_build_object('status','INVALID','code','SEARCH_TERM_TOO_SHORT','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'employer_name'), '[]'::jsonb) INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'employer_regno', e.regno,
             'employer_name', COALESCE(NULLIF(btrim(e.name),''), NULLIF(btrim(e.trade_name),''), 'Employer'),
             'trade_name', NULLIF(btrim(e.trade_name),''),
             'employer_status', COALESCE(e.status,'UNKNOWN')) AS x
      FROM public.er_master e
     WHERE e.name ILIKE '%' || v_term || '%'
        OR e.trade_name ILIKE '%' || v_term || '%'
        OR e.regno::text = v_term
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit,20), 50))) s;

  RETURN jsonb_build_object('status','OK','data', v_out);
END;
$$;

-- existing contribution / benefit context for one household member
CREATE OR REPLACE FUNCTION public.bn_means_income_context_v1(
  p_actor_user_id uuid, p_assessment_id uuid, p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perm jsonb;
  v_a    public.bn_means_assessment%ROWTYPE;
  v_m    public.bn_means_household_member%ROWTYPE;
  v_ssn  text;
  v_contrib jsonb := '[]'::jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  SELECT * INTO v_m FROM public.bn_means_household_member
   WHERE member_id = p_member_id AND assessment_id = p_assessment_id AND voided_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','MEMBER_NOT_FOUND','data', NULL);
  END IF;

  IF v_m.person_id IS NOT NULL THEN
    SELECT i.ssn INTO v_ssn FROM public.ip_master i
     WHERE regexp_replace(COALESCE(i.ssn,''),'[^0-9]','','g') = v_m.person_id::text LIMIT 1;
  END IF;

  IF v_ssn IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'period' DESC), '[]'::jsonb) INTO v_contrib
    FROM (
      SELECT jsonb_build_object(
               'employer_regno', w.payer_id,
               'employer_name', COALESCE(NULLIF(btrim(e.name),''), 'Employer ' || w.payer_id),
               'employer_status', COALESCE(e.status,'UNKNOWN'),
               'period', w.period,
               'total_wages', COALESCE(w.total_wages, 0),
               'data_source','CONTRIBUTION_RECORD',
               'last_loaded_at', COALESCE(w.date_modified, w.date_entered)) AS t
        FROM public.ip_wages w
        LEFT JOIN public.er_master e ON e.regno::text = w.payer_id::text
       WHERE w.ssn = v_ssn
       ORDER BY w.period DESC
       LIMIT 12) s;
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'member_id', p_member_id,
    'has_person_record', (v_m.person_id IS NOT NULL),
    'contribution_records', v_contrib,
    'contribution_state', CASE
        WHEN v_m.person_id IS NULL THEN 'NOT_APPLICABLE'
        WHEN jsonb_array_length(v_contrib) = 0 THEN 'EMPTY'
        ELSE 'SUCCESS' END,
    'benefit_sources', '[]'::jsonb,
    'benefit_state','NOT_IMPLEMENTED'));
END;
$$;

REVOKE ALL ON FUNCTION public.bn_means_income_reference_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_income_v1(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_income_readiness_v1(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_income_context_v1(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_employer_search_v1(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_income_reference_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_income_v1(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_income_readiness_v1(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_income_context_v1(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_employer_search_v1(uuid, text, integer) TO authenticated, service_role;

-- ------------------------------------------------ command handler extension

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bn_means_execute_command_v1';
  IF v_def IS NULL THEN RAISE EXCEPTION 'command function not found'; END IF;

  v_new := $blk$ELSIF p_command_name IN ('BN_MEANS_ADD_INCOME','BN_MEANS_CORRECT_INCOME') THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_fact := NULLIF(p_payload->>'income_fact_id','')::uuid;
    IF p_command_name = 'BN_MEANS_CORRECT_INCOME' THEN
      SELECT count(*) INTO v_count FROM public.bn_means_income_fact
       WHERE income_fact_id = v_fact AND assessment_id = v_id AND voided_at IS NULL;
      IF COALESCE(v_count,0) = 0 THEN
        RAISE EXCEPTION 'E_INCOME_FACT_NOT_FOUND:income record';
      END IF;
    ELSE
      v_fact := NULL;
    END IF;

    v_currency := COALESCE(NULLIF(p_payload->>'currency_code',''), v_a.currency_code);
    v_snapshot := public._bn_means_income_validate(v_id, p_payload, v_fact);
    IF jsonb_array_length(v_snapshot->'blockers') > 0 THEN
      v_reason := (v_snapshot->'blockers'->>0);
      IF v_reason = 'CURRENCY_MISMATCH' THEN
        RAISE EXCEPTION 'E_CURRENCY_MISMATCH:assessment=% fact=%', v_a.currency_code, v_currency;
      ELSIF v_reason = 'FOREIGN_CURRENCY_NOT_SUPPORTED' THEN
        RAISE EXCEPTION 'E_FOREIGN_CURRENCY_NOT_SUPPORTED:%', v_currency;
      ELSIF v_reason = 'MEMBER_NOT_FOUND' THEN
        RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
      ELSE
        RAISE EXCEPTION 'E_INCOME_VALIDATION_FAILED:%', v_reason;
      END IF;
    END IF;

    v_amount := (p_payload->>'declared_amount')::numeric;
    v_freq   := p_payload->>'declared_frequency';
    v_norm   := public._bn_means_annualise(v_amount, v_freq);
    v_kind   := COALESCE(NULLIF(p_payload->>'basis',''),
                  COALESCE(public._bn_means_income_option('INCOME_CATEGORY', p_payload->>'category_code')->>'fixed_basis','GROSS'));

    IF p_command_name = 'BN_MEANS_CORRECT_INCOME' THEN
      -- versioned replacement: the corrected record is voided, never mutated
      UPDATE public.bn_means_income_fact
         SET voided_at = now(), voided_by = p_actor_user_id,
             updated_at = now(), updated_by = p_actor_user_id
       WHERE income_fact_id = v_fact AND assessment_id = v_id;
      SELECT fact_version INTO v_count FROM public.bn_means_income_fact WHERE income_fact_id = v_fact;
    ELSE
      v_count := 0;
    END IF;

    INSERT INTO public.bn_means_income_fact(
      assessment_id, member_id, category_code, income_source, source_name,
      employer_regno, employer_snapshot, basis, declared_amount, declared_frequency,
      currency_code, normalised_annual_amount, occurrence_date, effective_from,
      effective_to, fact_source, income_notes, fact_version, supersedes_fact_id,
      created_by, updated_by)
    VALUES (v_id, NULLIF(p_payload->>'member_id','')::uuid, p_payload->>'category_code',
      NULLIF(p_payload->>'income_source',''), NULLIF(btrim(COALESCE(p_payload->>'source_name','')),''),
      NULLIF(p_payload->>'employer_regno',''), COALESCE(p_payload->'employer_snapshot','{}'::jsonb),
      v_kind, v_amount, v_freq, v_currency, v_norm,
      NULLIF(p_payload->>'occurrence_date','')::date,
      (p_payload->>'effective_from')::date, NULLIF(p_payload->>'effective_to','')::date,
      p_payload->>'fact_source', NULLIF(btrim(COALESCE(p_payload->>'income_notes','')),''),
      COALESCE(v_count,0) + 1, v_fact, p_actor_user_id, p_actor_user_id)
    RETURNING income_fact_id INTO v_new_id;

    PERFORM public._bn_means_event(v_id,
      CASE WHEN p_command_name = 'BN_MEANS_CORRECT_INCOME' THEN 'INCOME_CORRECTED' ELSE 'INCOME_ADDED' END,
      p_command_name, v_from, v_from, p_reason_code, p_justification,
      p_payload || jsonb_build_object('income_fact_id', v_new_id,
        'superseded_fact_id', v_fact, 'normalised_annual_amount', v_norm),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version);

    v_result := jsonb_build_object('income_fact_id', v_new_id,
      'normalised_annual_amount', v_norm,
      'superseded_fact_id', v_fact,
      'warnings', COALESCE(v_snapshot->'warnings','[]'::jsonb));

  ELSIF p_command_name = 'BN_MEANS_VOID_INCOME' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_fact := NULLIF(p_payload->>'income_fact_id','')::uuid;
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:income record';
    END IF;
    UPDATE public.bn_means_income_fact
       SET voided_at = now(), voided_by = p_actor_user_id,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE income_fact_id = v_fact AND assessment_id = v_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_INCOME_FACT_NOT_FOUND:income record';
    END IF;
    PERFORM public._bn_means_event(v_id,'INCOME_VOIDED',p_command_name,v_from,v_from,
      p_reason_code,p_justification,p_payload,p_actor_user_id,p_actor_user_code,
      p_correlation_id,v_a.row_version);
    v_result := jsonb_build_object('income_fact_id', v_fact, 'voided', true);

  ELSIF p_command_name = 'BN_MEANS_DECLARE_NO_INCOME' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_new_id := NULLIF(p_payload->>'member_id','')::uuid;
    IF v_new_id IS NULL OR COALESCE(p_payload->>'effective_from','') = ''
       OR COALESCE(p_payload->>'reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:no-income declaration';
    END IF;
    SELECT count(*) INTO v_count FROM public.bn_means_household_member
     WHERE member_id = v_new_id AND assessment_id = v_id AND voided_at IS NULL;
    IF COALESCE(v_count,0) = 0 THEN
      RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
    END IF;
    IF public._bn_means_income_option('NO_INCOME_REASON', p_payload->>'reason_code') IS NULL THEN
      RAISE EXCEPTION 'E_INCOME_VALIDATION_FAILED:INVALID_NO_INCOME_REASON';
    END IF;
    SELECT count(*) INTO v_count FROM public.bn_means_no_income_declaration
     WHERE assessment_id = v_id AND member_id = v_new_id AND voided_at IS NULL;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'E_INCOME_VALIDATION_FAILED:DUPLICATE_NO_INCOME_DECLARATION';
    END IF;
    INSERT INTO public.bn_means_no_income_declaration(
      assessment_id, member_id, effective_from, effective_to, declaration_source,
      reason_code, confirmation_note, declared_by)
    VALUES (v_id, v_new_id, (p_payload->>'effective_from')::date,
      NULLIF(p_payload->>'effective_to','')::date,
      COALESCE(NULLIF(p_payload->>'declaration_source',''),'APPLICANT_DECLARATION'),
      p_payload->>'reason_code',
      NULLIF(btrim(COALESCE(p_payload->>'confirmation_note','')),''), p_actor_user_id)
    RETURNING declaration_id INTO v_fact;
    PERFORM public._bn_means_event(v_id,'NO_INCOME_DECLARED',p_command_name,v_from,v_from,
      p_reason_code,p_justification,p_payload || jsonb_build_object('declaration_id', v_fact),
      p_actor_user_id,p_actor_user_code,p_correlation_id,v_a.row_version);
    v_result := jsonb_build_object('declaration_id', v_fact);

  ELSIF p_command_name = 'BN_MEANS_WITHDRAW_NO_INCOME' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_fact := NULLIF(p_payload->>'declaration_id','')::uuid;
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:no-income declaration';
    END IF;
    UPDATE public.bn_means_no_income_declaration
       SET voided_at = now(), voided_by = p_actor_user_id, updated_at = now()
     WHERE declaration_id = v_fact AND assessment_id = v_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_INCOME_FACT_NOT_FOUND:no-income declaration';
    END IF;
    PERFORM public._bn_means_event(v_id,'NO_INCOME_WITHDRAWN',p_command_name,v_from,v_from,
      p_reason_code,p_justification,p_payload,p_actor_user_id,p_actor_user_code,
      p_correlation_id,v_a.row_version);
    v_result := jsonb_build_object('declaration_id', v_fact, 'voided', true);

  ELSIF p_command_name IN ('BN_MEANS_MARK_HOUSEHOLD_COMPLETE','BN_MEANS_MARK_INCOME_COMPLETE') THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_kind := CASE WHEN p_command_name = 'BN_MEANS_MARK_INCOME_COMPLETE' THEN 'INCOME' ELSE 'HOUSEHOLD' END;
    IF v_kind = 'INCOME' THEN
      v_ready := public.bn_means_income_readiness_v1(p_actor_user_id, v_id);
    ELSE
      v_ready := public.bn_means_household_readiness_v1(p_actor_user_id, v_id);
    END IF;
    IF NOT COALESCE((v_ready->'data'->>'section_complete')::boolean,false) THEN
      RAISE EXCEPTION 'E_SECTION_NOT_READY:%', v_kind;
    END IF;
    INSERT INTO public.bn_means_section_completion(assessment_id, section_code, completed_by)
    VALUES (v_id, v_kind, p_actor_user_id)
    ON CONFLICT (assessment_id, section_code) DO UPDATE
      SET completed_at = now(), completed_by = EXCLUDED.completed_by,
          reopened_at = NULL, reopened_by = NULL, updated_at = now();
    PERFORM public._bn_means_event(v_id, v_kind || '_SECTION_COMPLETED', p_command_name,
      v_from, v_from, p_reason_code, p_justification,
      jsonb_build_object('section_code', v_kind),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version);
    v_result := jsonb_build_object('section_code', v_kind, 'section_complete', true);

  $blk$;

  v_def := regexp_replace(
    v_def,
    'ELSIF p_command_name = ''BN_MEANS_ADD_INCOME'' THEN.*?ELSIF p_command_name = ''BN_MEANS_ADD_ASSET'' THEN',
    v_new || E'ELSIF p_command_name = ''BN_MEANS_ADD_ASSET'' THEN',
    'ns');

  IF position('BN_MEANS_MARK_INCOME_COMPLETE' in v_def) = 0
     OR position('BN_MEANS_CORRECT_INCOME' in v_def) = 0 THEN
    RAISE EXCEPTION 'income handler replacement failed';
  END IF;

  EXECUTE v_def;
END $mig$;

-- available-actions: expose the new income commands
DO $mig2$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bn_means_available_actions_v1';

  v_def := replace(v_def,
    $old$    'BN_MEANS_ADD_INCOME','BN_MEANS_ADD_ASSET',$old$,
    $new$    'BN_MEANS_ADD_INCOME','BN_MEANS_CORRECT_INCOME','BN_MEANS_VOID_INCOME',
    'BN_MEANS_DECLARE_NO_INCOME','BN_MEANS_WITHDRAW_NO_INCOME',
    'BN_MEANS_MARK_HOUSEHOLD_COMPLETE','BN_MEANS_MARK_INCOME_COMPLETE',
    'BN_MEANS_ADD_ASSET',$new$);

  v_def := replace(v_def,
    $old2$'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER','BN_MEANS_CORRECT_CONTEXT','BN_MEANS_ADD_INCOME',$old2$,
    $new2$'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER','BN_MEANS_CORRECT_CONTEXT','BN_MEANS_ADD_INCOME',
                   'BN_MEANS_CORRECT_INCOME','BN_MEANS_VOID_INCOME','BN_MEANS_DECLARE_NO_INCOME',
                   'BN_MEANS_WITHDRAW_NO_INCOME','BN_MEANS_MARK_HOUSEHOLD_COMPLETE',
                   'BN_MEANS_MARK_INCOME_COMPLETE',$new2$);

  IF position('BN_MEANS_MARK_INCOME_COMPLETE' in v_def) = 0 THEN
    RAISE EXCEPTION 'available-actions replacement failed';
  END IF;
  EXECUTE v_def;
END $mig2$;
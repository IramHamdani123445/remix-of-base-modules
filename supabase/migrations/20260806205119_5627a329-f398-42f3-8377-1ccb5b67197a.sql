
-- =========================================================================
-- MEANS-TEST EPIC 2 — Household composition foundation
-- =========================================================================

ALTER TABLE public.bn_means_household_member
  ADD COLUMN IF NOT EXISTS dependency_decision text NOT NULL DEFAULT 'NOT_DEPENDANT',
  ADD COLUMN IF NOT EXISTS residence_inclusion_reason text,
  ADD COLUMN IF NOT EXISTS member_notes text,
  ADD COLUMN IF NOT EXISTS is_self boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS member_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

UPDATE public.bn_means_household_member
   SET dependency_decision = CASE WHEN is_dependant THEN 'DEPENDANT' ELSE 'NOT_DEPENDANT' END
 WHERE dependency_decision NOT IN ('DEPENDANT','NOT_DEPENDANT','UNDETERMINED');

UPDATE public.bn_means_household_member
   SET is_self = true
 WHERE relationship_code = 'SELF' AND is_self = false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_household_dependency_decision_chk') THEN
    ALTER TABLE public.bn_means_household_member
      ADD CONSTRAINT bn_means_household_dependency_decision_chk
      CHECK (dependency_decision IN ('DEPENDANT','NOT_DEPENDANT','UNDETERMINED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_household_dates_chk') THEN
    ALTER TABLE public.bn_means_household_member
      ADD CONSTRAINT bn_means_household_dates_chk
      CHECK (member_to IS NULL OR member_to >= member_from);
  END IF;
END $$;

-- ---------------------------------------------------------------- reference

CREATE OR REPLACE FUNCTION public._bn_means_household_reference()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'RELATIONSHIP_TYPE', jsonb_build_array(
      jsonb_build_object('value','SELF','label','Self (assessed person)'),
      jsonb_build_object('value','SPOUSE','label','Spouse'),
      jsonb_build_object('value','PARTNER','label','Partner'),
      jsonb_build_object('value','CHILD','label','Child'),
      jsonb_build_object('value','STEPCHILD','label','Stepchild'),
      jsonb_build_object('value','PARENT','label','Parent'),
      jsonb_build_object('value','SIBLING','label','Sibling'),
      jsonb_build_object('value','OTHER_RELATIVE','label','Other relative'),
      jsonb_build_object('value','NON_RELATIVE','label','Non-relative household member')),
    'DEPENDENCY_DECISION', jsonb_build_array(
      jsonb_build_object('value','DEPENDANT','label','Dependant'),
      jsonb_build_object('value','NOT_DEPENDANT','label','Not dependant'),
      jsonb_build_object('value','UNDETERMINED','label','Undetermined')),
    'DEPENDENCY_BASIS', jsonb_build_array(
      jsonb_build_object('value','AGE','label','Age'),
      jsonb_build_object('value','DISABILITY','label','Disability'),
      jsonb_build_object('value','EDUCATION','label','Full-time education'),
      jsonb_build_object('value','FINANCIAL','label','Financial dependence'),
      jsonb_build_object('value','LEGAL_RESPONSIBILITY','label','Legal responsibility'),
      jsonb_build_object('value','OTHER_BASIS','label','Other configured basis')),
    'HOUSEHOLD_FACT_SOURCE', jsonb_build_array(
      jsonb_build_object('value','PERSON_RECORD','label','Person record'),
      jsonb_build_object('value','CLAIM_DECLARATION','label','Claim declaration'),
      jsonb_build_object('value','DEPENDANT_RECORD','label','Existing dependant record'),
      jsonb_build_object('value','APPLICANT_DECLARATION','label','Applicant declaration'),
      jsonb_build_object('value','OFFICER_CONFIRMED','label','Officer-confirmed'),
      jsonb_build_object('value','EXTERNAL_EVIDENCE','label','External evidence')),
    'RESIDENCE_INCLUSION_REASON', jsonb_build_array(
      jsonb_build_object('value','TEMPORARY_ABSENCE','label','Temporary absence from the residence'),
      jsonb_build_object('value','INSTITUTIONAL_CARE','label','In institutional or residential care'),
      jsonb_build_object('value','EDUCATION_AWAY','label','Living away in full-time education'),
      jsonb_build_object('value','MAINTAINED_ELSEWHERE','label','Maintained by the household elsewhere'),
      jsonb_build_object('value','POLICY_INCLUSION','label','Included by a policy rule')),
    'CONTEXT_CORRECTION_REASON', jsonb_build_array(
      jsonb_build_object('value','WRONG_EFFECTIVE_DATE','label','Effective date recorded incorrectly'),
      jsonb_build_object('value','WRONG_ASSESSMENT_REASON','label','Assessment reason recorded incorrectly'),
      jsonb_build_object('value','ADMINISTRATIVE_CORRECTION','label','Administrative correction'))
  );
$$;

CREATE OR REPLACE FUNCTION public.bn_means_household_reference_v1(p_actor_user_id uuid)
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
  RETURN jsonb_build_object('status','OK','data', public._bn_means_household_reference());
END;
$$;

CREATE OR REPLACE FUNCTION public._bn_means_household_code_valid(p_set text, p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public._bn_means_household_reference()->p_set) o
     WHERE o->>'value' = p_value);
$$;

CREATE OR REPLACE FUNCTION public._bn_means_household_label(p_set text, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT o->>'label'
                     FROM jsonb_array_elements(public._bn_means_household_reference()->p_set) o
                    WHERE o->>'value' = p_value), p_value);
$$;

CREATE OR REPLACE FUNCTION public._bn_means_household_rules(p_policy_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'self_member_mode','CONFIRM',
           'require_self_member', true,
           'allow_declared_members', true,
           'require_dependency_basis', true,
           'require_residence_reason', true)
         || COALESCE((SELECT household_rules FROM public.bn_means_policy_version
                       WHERE policy_version_id = p_policy_version_id), '{}'::jsonb);
$$;

-- ---------------------------------------------------------------- validation

CREATE OR REPLACE FUNCTION public._bn_means_household_validate(
  p_assessment_id uuid,
  p_payload jsonb,
  p_exclude_member_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_a      public.bn_means_assessment%ROWTYPE;
  v_rules  jsonb;
  v_codes  jsonb := '[]'::jsonb;
  v_person bigint := NULLIF(p_payload->>'person_id','')::bigint;
  v_decl   jsonb  := COALESCE(p_payload->'declared_person','{}'::jsonb);
  v_rel    text   := COALESCE(p_payload->>'relationship_code','');
  v_from   date   := NULLIF(p_payload->>'member_from','')::date;
  v_to     date   := NULLIF(p_payload->>'member_to','')::date;
  v_dec    text   := COALESCE(p_payload->>'dependency_decision','NOT_DEPENDANT');
  v_basis  text   := NULLIF(p_payload->>'dependency_basis','');
  v_shares boolean := COALESCE((p_payload->>'shares_residence')::boolean, true);
  v_resrsn text   := NULLIF(p_payload->>'residence_inclusion_reason','');
  v_src    text   := COALESCE(p_payload->>'fact_source','APPLICANT_DECLARATION');
  v_count  int;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_array('NOT_FOUND');
  END IF;
  v_rules := public._bn_means_household_rules(v_a.policy_version_id);

  IF NOT public._bn_means_household_code_valid('RELATIONSHIP_TYPE', v_rel) THEN
    v_codes := v_codes || '"INVALID_RELATIONSHIP"'::jsonb;
  END IF;
  IF NOT public._bn_means_household_code_valid('DEPENDENCY_DECISION', v_dec) THEN
    v_codes := v_codes || '"INVALID_DEPENDENCY_DECISION"'::jsonb;
  END IF;
  IF NOT public._bn_means_household_code_valid('HOUSEHOLD_FACT_SOURCE', v_src) THEN
    v_codes := v_codes || '"INVALID_FACT_SOURCE"'::jsonb;
  END IF;

  -- identity
  IF v_person IS NOT NULL AND COALESCE(v_decl->>'full_name','') <> '' THEN
    v_codes := v_codes || '"DECLARED_PERSON_CONTEXT_INVALID"'::jsonb;
  ELSIF v_person IS NULL THEN
    IF COALESCE(v_decl->>'full_name','') = '' THEN
      v_codes := v_codes || '"DECLARED_PERSON_NAME_REQUIRED"'::jsonb;
    ELSIF NOT COALESCE((v_rules->>'allow_declared_members')::boolean, true) THEN
      v_codes := v_codes || '"DECLARED_PERSON_CONTEXT_INVALID"'::jsonb;
    END IF;
  END IF;

  -- dates
  IF v_from IS NULL THEN
    v_codes := v_codes || '"INVALID_MEMBERSHIP_DATES"'::jsonb;
  ELSIF v_to IS NOT NULL AND v_to < v_from THEN
    v_codes := v_codes || '"INVALID_MEMBERSHIP_DATES"'::jsonb;
  ELSIF (v_to IS NOT NULL AND v_to < v_a.effective_from)
     OR (v_a.effective_to IS NOT NULL AND v_from > v_a.effective_to) THEN
    v_codes := v_codes || '"MEMBER_OUTSIDE_ASSESSMENT_PERIOD"'::jsonb;
  END IF;

  -- dependency
  IF v_dec = 'DEPENDANT'
     AND COALESCE((v_rules->>'require_dependency_basis')::boolean, true)
     AND v_basis IS NULL THEN
    v_codes := v_codes || '"DEPENDENCY_BASIS_REQUIRED"'::jsonb;
  END IF;

  -- residence
  IF NOT v_shares
     AND COALESCE((v_rules->>'require_residence_reason')::boolean, true)
     AND v_resrsn IS NULL THEN
    v_codes := v_codes || '"RESIDENCE_REASON_REQUIRED"'::jsonb;
  END IF;

  -- self / own dependant
  IF v_person IS NOT NULL AND v_a.person_id IS NOT NULL AND v_person = v_a.person_id THEN
    IF v_rel <> 'SELF' OR v_dec = 'DEPENDANT' THEN
      v_codes := v_codes || '"PERSON_IS_OWN_DEPENDANT"'::jsonb;
    END IF;
  END IF;

  IF v_rel = 'SELF' THEN
    SELECT count(*) INTO v_count FROM public.bn_means_household_member
     WHERE assessment_id = p_assessment_id AND voided_at IS NULL
       AND (p_exclude_member_id IS NULL OR member_id <> p_exclude_member_id)
       AND (is_self OR relationship_code = 'SELF');
    IF v_count > 0 THEN
      v_codes := v_codes || '"DUPLICATE_SELF_MEMBER"'::jsonb;
    END IF;
  END IF;

  -- duplicates (person reference, overlapping period)
  IF v_person IS NOT NULL AND v_from IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.bn_means_household_member m
     WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
       AND (p_exclude_member_id IS NULL OR m.member_id <> p_exclude_member_id)
       AND m.person_id = v_person
       AND COALESCE(m.member_to, 'infinity'::date) >= v_from
       AND m.member_from <= COALESCE(v_to, 'infinity'::date);
    IF v_count > 0 THEN
      v_codes := v_codes || '"PERSON_ALREADY_PRESENT"'::jsonb;
    END IF;
  END IF;

  -- duplicates (declared identity + relationship + overlapping period)
  IF v_person IS NULL AND COALESCE(v_decl->>'full_name','') <> '' AND v_from IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.bn_means_household_member m
     WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL
       AND (p_exclude_member_id IS NULL OR m.member_id <> p_exclude_member_id)
       AND lower(btrim(COALESCE(m.declared_person->>'full_name',''))) = lower(btrim(v_decl->>'full_name'))
       AND COALESCE(m.declared_person->>'date_of_birth','') = COALESCE(v_decl->>'date_of_birth','')
       AND m.relationship_code = v_rel
       AND COALESCE(m.member_to, 'infinity'::date) >= v_from
       AND m.member_from <= COALESCE(v_to, 'infinity'::date);
    IF v_count > 0 THEN
      v_codes := v_codes || '"DUPLICATE_MEMBER"'::jsonb;
    END IF;
  END IF;

  RETURN v_codes;
END;
$$;

-- ---------------------------------------------------------------- queries

CREATE OR REPLACE FUNCTION public._bn_means_household_member_json(p_member public.bn_means_household_member)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'member_id', p_member.member_id,
    'person_id', p_member.person_id,
    'is_self', p_member.is_self,
    'display_name', COALESCE(
        NULLIF(btrim(p_member.declared_person->>'full_name'),''),
        (SELECT btrim(COALESCE(m.firstname,'') || ' ' || COALESCE(m.surname,''))
           FROM public.ip_master m
          WHERE regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') = p_member.person_id::text
          LIMIT 1),
        'Household member'),
    'masked_identifier', (SELECT public._bn_means_mask_ssn(m.ssn) FROM public.ip_master m
                           WHERE regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') = p_member.person_id::text
                           LIMIT 1),
    'date_of_birth', COALESCE(
        NULLIF(p_member.declared_person->>'date_of_birth','')::date,
        (SELECT m.dob FROM public.ip_master m
          WHERE regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') = p_member.person_id::text LIMIT 1)),
    'source_kind', CASE WHEN p_member.person_id IS NOT NULL THEN 'KNOWN_PERSON' ELSE 'DECLARED' END,
    'relationship_code', p_member.relationship_code,
    'relationship_label', public._bn_means_household_label('RELATIONSHIP_TYPE', p_member.relationship_code),
    'member_from', p_member.member_from,
    'member_to', p_member.member_to,
    'is_current', (p_member.member_to IS NULL OR p_member.member_to >= CURRENT_DATE),
    'shares_residence', p_member.shares_residence,
    'residence_inclusion_reason', p_member.residence_inclusion_reason,
    'residence_inclusion_reason_label',
        CASE WHEN p_member.residence_inclusion_reason IS NULL THEN NULL
             ELSE public._bn_means_household_label('RESIDENCE_INCLUSION_REASON', p_member.residence_inclusion_reason) END,
    'dependency_decision', p_member.dependency_decision,
    'dependency_decision_label', public._bn_means_household_label('DEPENDENCY_DECISION', p_member.dependency_decision),
    'dependency_basis', p_member.dependency_basis,
    'dependency_basis_label',
        CASE WHEN p_member.dependency_basis IS NULL THEN NULL
             ELSE public._bn_means_household_label('DEPENDENCY_BASIS', p_member.dependency_basis) END,
    'fact_source', p_member.fact_source,
    'fact_source_label', public._bn_means_household_label('HOUSEHOLD_FACT_SOURCE', p_member.fact_source),
    'verification_status', p_member.verification_status,
    'evidence_status', p_member.evidence_status,
    'member_notes', p_member.member_notes,
    'member_version', p_member.member_version,
    'created_at', p_member.created_at,
    'updated_at', p_member.updated_at);
$$;

CREATE OR REPLACE FUNCTION public.bn_means_household_v1(
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
  v_rows jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(public._bn_means_household_member_json(m)
                            ORDER BY m.is_self DESC, m.member_from, m.created_at), '[]'::jsonb)
    INTO v_rows
    FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_assessment_id AND m.voided_at IS NULL;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'editable', public._bn_means_is_editable(v_a.status),
    'household_rules', public._bn_means_household_rules(v_a.policy_version_id),
    'members', v_rows));
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_means_household_readiness_v1(
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
  v_total   int;
  v_current int;
  v_dep     int;
  v_evid    int;
  v_self    int;
  v_count   int;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  v_rules := public._bn_means_household_rules(v_a.policy_version_id);

  SELECT count(*),
         count(*) FILTER (WHERE member_to IS NULL OR member_to >= CURRENT_DATE),
         count(*) FILTER (WHERE dependency_decision = 'DEPENDANT'),
         count(*) FILTER (WHERE evidence_status = 'REQUIRED'),
         count(*) FILTER (WHERE is_self OR relationship_code = 'SELF')
    INTO v_total, v_current, v_dep, v_evid, v_self
    FROM public.bn_means_household_member
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL;

  IF v_a.policy_version_id IS NULL THEN
    v_codes := v_codes || '"HOUSEHOLD_POLICY_REQUIREMENT_MISSING"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','HOUSEHOLD_POLICY_REQUIREMENT_MISSING',
      'message','No means-test policy version is attached to this assessment.'));
  END IF;

  IF v_self = 0 AND COALESCE((v_rules->>'require_self_member')::boolean, true) THEN
    v_codes := v_codes || '"SELF_MEMBER_MISSING"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','SELF_MEMBER_MISSING',
      'message','The assessed person has not been confirmed as a household member.'));
    v_missing := v_missing || jsonb_build_array(
      jsonb_build_object('code','SELF_MEMBER_MISSING','label','Confirm the assessed person'));
  ELSIF v_self > 1 THEN
    v_codes := v_codes || '"DUPLICATE_SELF_MEMBER"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','DUPLICATE_SELF_MEMBER',
      'message','More than one household member is recorded as the assessed person.'));
  END IF;

  -- dependants without a basis
  SELECT count(*) INTO v_count FROM public.bn_means_household_member
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL
     AND dependency_decision = 'DEPENDANT' AND dependency_basis IS NULL;
  IF v_count > 0 THEN
    v_codes := v_codes || '"DEPENDENCY_BASIS_REQUIRED"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','DEPENDENCY_BASIS_REQUIRED',
      'message', v_count || ' dependant member(s) have no dependency basis recorded.'));
    v_missing := v_missing || jsonb_build_array(
      jsonb_build_object('code','DEPENDENCY_BASIS_REQUIRED','label','Dependency basis'));
  END IF;

  -- non-resident members without an inclusion reason
  SELECT count(*) INTO v_count FROM public.bn_means_household_member
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL
     AND shares_residence = false AND residence_inclusion_reason IS NULL;
  IF v_count > 0 THEN
    v_codes := v_codes || '"RESIDENCE_REASON_REQUIRED"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','RESIDENCE_REASON_REQUIRED',
      'message', v_count || ' non-resident member(s) have no inclusion reason recorded.'));
    v_missing := v_missing || jsonb_build_array(
      jsonb_build_object('code','RESIDENCE_REASON_REQUIRED','label','Residence inclusion reason'));
  END IF;

  -- overlapping membership for the same known person
  SELECT count(*) INTO v_count
    FROM public.bn_means_household_member a
    JOIN public.bn_means_household_member b
      ON b.assessment_id = a.assessment_id AND b.member_id <> a.member_id
     AND b.person_id = a.person_id AND b.voided_at IS NULL
     AND COALESCE(b.member_to,'infinity'::date) >= a.member_from
     AND b.member_from <= COALESCE(a.member_to,'infinity'::date)
   WHERE a.assessment_id = p_assessment_id AND a.voided_at IS NULL AND a.person_id IS NOT NULL;
  IF v_count > 0 THEN
    v_codes := v_codes || '"OVERLAPPING_MEMBERSHIP"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','OVERLAPPING_MEMBERSHIP',
      'message','The same person is recorded more than once for overlapping periods.'));
  END IF;

  -- members entirely outside the assessment period
  SELECT count(*) INTO v_count FROM public.bn_means_household_member
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL
     AND ((member_to IS NOT NULL AND member_to < v_a.effective_from)
       OR (v_a.effective_to IS NOT NULL AND member_from > v_a.effective_to));
  IF v_count > 0 THEN
    v_codes := v_codes || '"MEMBER_OUTSIDE_ASSESSMENT_PERIOD"'::jsonb;
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','MEMBER_OUTSIDE_ASSESSMENT_PERIOD',
      'message', v_count || ' member(s) fall outside the assessment period and are treated as historical.'));
  END IF;

  IF v_total = 0 THEN
    v_missing := v_missing || jsonb_build_array(
      jsonb_build_object('code','NO_MEMBERS','label','At least one household member'));
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'section_complete', (jsonb_array_length(v_block) = 0 AND v_total > 0),
    'section_status', CASE
        WHEN jsonb_array_length(v_block) > 0 THEN 'BLOCKED'
        WHEN v_total = 0 THEN 'NOT_STARTED'
        ELSE 'COMPLETE' END,
    'household_size', v_current,
    'current_members', v_current,
    'total_members', v_total,
    'current_dependants', v_dep,
    'members_requiring_evidence', v_evid,
    'missing_requirements', v_missing,
    'warnings', v_warn,
    'blockers', v_block,
    'reason_codes', v_codes));
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_means_household_candidates_v1(
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
  v_ssn  text;
  v_out  jsonb := '[]'::jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  SELECT m.ssn INTO v_ssn FROM public.ip_master m
   WHERE regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') = v_a.person_id::text LIMIT 1;

  -- the claimant themselves
  IF v_a.person_id IS NOT NULL THEN
    SELECT v_out || jsonb_build_array(jsonb_build_object(
             'candidate_kind','CLAIMANT',
             'person_id', v_a.person_id,
             'full_name', btrim(COALESCE(m.firstname,'') || ' ' || COALESCE(m.surname,'')),
             'masked_identifier', public._bn_means_mask_ssn(m.ssn),
             'date_of_birth', m.dob,
             'suggested_relationship','SELF',
             'suggested_fact_source','PERSON_RECORD',
             'already_present', EXISTS (SELECT 1 FROM public.bn_means_household_member h
                                         WHERE h.assessment_id = p_assessment_id
                                           AND h.voided_at IS NULL
                                           AND h.person_id = v_a.person_id)))
      INTO v_out
      FROM public.ip_master m
     WHERE regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') = v_a.person_id::text
     LIMIT 1;
  END IF;

  -- known dependants recorded against the claimant
  SELECT v_out || COALESCE(jsonb_agg(jsonb_build_object(
           'candidate_kind','KNOWN_DEPENDANT',
           'person_id', NULLIF(regexp_replace(COALESCE(d.dep_ssn,''),'[^0-9]','','g'),'')::bigint,
           'full_name', btrim(COALESCE(d.firstname,'') || ' ' || COALESCE(d.surname,'')),
           'masked_identifier', public._bn_means_mask_ssn(d.dep_ssn),
           'date_of_birth', d.dob,
           'suggested_relationship', CASE
              WHEN upper(COALESCE(d.relationship,'')) LIKE '%SPOUSE%' THEN 'SPOUSE'
              WHEN upper(COALESCE(d.relationship,'')) LIKE '%CHILD%' THEN 'CHILD'
              WHEN upper(COALESCE(d.relationship,'')) LIKE '%PARENT%' THEN 'PARENT'
              ELSE 'OTHER_RELATIVE' END,
           'suggested_fact_source','DEPENDANT_RECORD',
           'already_present', EXISTS (
              SELECT 1 FROM public.bn_means_household_member h
               WHERE h.assessment_id = p_assessment_id AND h.voided_at IS NULL
                 AND h.person_id = NULLIF(regexp_replace(COALESCE(d.dep_ssn,''),'[^0-9]','','g'),'')::bigint)
         ) ORDER BY d.dob NULLS LAST), '[]'::jsonb)
    INTO v_out
    FROM public.au_ip_depend d
   WHERE v_ssn IS NOT NULL AND d.ssn = v_ssn;

  RETURN jsonb_build_object('status','OK','data', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.bn_means_household_reference_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_household_v1(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_household_readiness_v1(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_household_candidates_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_household_reference_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_household_v1(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_household_readiness_v1(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_household_candidates_v1(uuid, uuid) TO authenticated, service_role;

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

  v_new := $blk$ELSIF p_command_name IN ('BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_UPDATE_HOUSEHOLD_MEMBER') THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_new_id := NULLIF(p_payload->>'member_id','')::uuid;
    IF p_command_name = 'BN_MEANS_UPDATE_HOUSEHOLD_MEMBER' THEN
      SELECT count(*) INTO v_count FROM public.bn_means_household_member
       WHERE member_id = v_new_id AND assessment_id = v_id AND voided_at IS NULL;
      IF COALESCE(v_count,0) = 0 THEN
        RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
      END IF;
    ELSE
      v_new_id := NULL;
    END IF;
    IF COALESCE(p_payload->>'relationship_code','') = ''
       OR COALESCE(p_payload->>'member_from','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:household member';
    END IF;
    v_snapshot := public._bn_means_household_validate(v_id, p_payload, v_new_id);
    IF jsonb_array_length(v_snapshot) > 0 THEN
      RAISE EXCEPTION 'E_HOUSEHOLD_VALIDATION_FAILED:%', (v_snapshot->>0);
    END IF;
    IF p_command_name = 'BN_MEANS_UPDATE_HOUSEHOLD_MEMBER' THEN
      UPDATE public.bn_means_household_member SET
        relationship_code = p_payload->>'relationship_code',
        member_from       = (p_payload->>'member_from')::date,
        member_to         = NULLIF(p_payload->>'member_to','')::date,
        dependency_decision = COALESCE(p_payload->>'dependency_decision','NOT_DEPENDANT'),
        is_dependant      = (COALESCE(p_payload->>'dependency_decision','NOT_DEPENDANT') = 'DEPENDANT'),
        dependency_basis  = NULLIF(p_payload->>'dependency_basis',''),
        shares_residence  = COALESCE((p_payload->>'shares_residence')::boolean, true),
        residence_inclusion_reason = NULLIF(p_payload->>'residence_inclusion_reason',''),
        fact_source       = COALESCE(p_payload->>'fact_source','APPLICANT_DECLARATION'),
        member_notes      = NULLIF(p_payload->>'member_notes',''),
        is_self           = (p_payload->>'relationship_code' = 'SELF'),
        member_version    = member_version + 1,
        updated_at        = now(),
        updated_by        = p_actor_user_id
      WHERE member_id = v_new_id AND assessment_id = v_id;
    ELSE
      INSERT INTO public.bn_means_household_member(
        assessment_id, person_id, declared_person, relationship_code, member_from,
        member_to, dependency_decision, is_dependant, dependency_basis, shares_residence,
        residence_inclusion_reason, fact_source, member_notes, is_self, created_by, updated_by)
      VALUES (v_id, NULLIF(p_payload->>'person_id','')::bigint,
        COALESCE(p_payload->'declared_person','{}'::jsonb),
        p_payload->>'relationship_code', (p_payload->>'member_from')::date,
        NULLIF(p_payload->>'member_to','')::date,
        COALESCE(p_payload->>'dependency_decision','NOT_DEPENDANT'),
        (COALESCE(p_payload->>'dependency_decision','NOT_DEPENDANT') = 'DEPENDANT'),
        NULLIF(p_payload->>'dependency_basis',''),
        COALESCE((p_payload->>'shares_residence')::boolean, true),
        NULLIF(p_payload->>'residence_inclusion_reason',''),
        COALESCE(p_payload->>'fact_source','APPLICANT_DECLARATION'),
        NULLIF(p_payload->>'member_notes',''),
        (p_payload->>'relationship_code' = 'SELF'),
        p_actor_user_id, p_actor_user_id)
      RETURNING member_id INTO v_new_id;
    END IF;
    v_result := jsonb_build_object('member_id', v_new_id);

  ELSIF p_command_name = 'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    v_new_id := NULLIF(p_payload->>'member_id','')::uuid;
    IF v_new_id IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:household member';
    END IF;
    UPDATE public.bn_means_household_member
       SET voided_at = now(), voided_by = p_actor_user_id,
           member_version = member_version + 1,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE member_id = v_new_id AND assessment_id = v_id AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_MEMBER_NOT_FOUND:household member';
    END IF;
    v_result := jsonb_build_object('member_id', v_new_id, 'voided', true);

  ELSIF p_command_name = 'BN_MEANS_CORRECT_CONTEXT' THEN
    IF NOT public._bn_means_is_editable(v_from) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_from;
    END IF;
    IF p_payload ?| ARRAY['person_id','claim_id','award_id','benefit_programme',
                          'policy_version_id','currency_code'] THEN
      RAISE EXCEPTION 'E_CONTEXT_CORRECTION_NOT_PERMITTED:create a replacement assessment';
    END IF;
    IF COALESCE(p_reason_code,'') = '' OR length(btrim(COALESCE(p_justification,''))) < 10 THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:correction reason and justification';
    END IF;
    UPDATE public.bn_means_assessment SET
      assessment_reason = COALESCE(NULLIF(p_payload->>'assessment_reason',''), assessment_reason),
      updated_at = now(), updated_by = p_actor_user_id
    WHERE assessment_id = v_id;
    v_result := jsonb_build_object('assessment_id', v_id, 'corrected', true);

  $blk$;

  v_def := regexp_replace(
    v_def,
    'ELSIF p_command_name = ''BN_MEANS_ADD_HOUSEHOLD_MEMBER'' THEN.*?ELSIF p_command_name = ''BN_MEANS_ADD_INCOME'' THEN',
    v_new || E'ELSIF p_command_name = ''BN_MEANS_ADD_INCOME'' THEN',
    'ns');

  IF position('BN_MEANS_REMOVE_HOUSEHOLD_MEMBER' in v_def) = 0 THEN
    RAISE EXCEPTION 'household handler replacement failed';
  END IF;

  EXECUTE v_def;
END $mig$;

-- available-actions: expose the new household commands
DO $mig2$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bn_means_available_actions_v1';

  v_def := replace(v_def,
    $old$    'BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_ADD_INCOME','BN_MEANS_ADD_ASSET',$old$,
    $new$    'BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_UPDATE_HOUSEHOLD_MEMBER',
    'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER','BN_MEANS_CORRECT_CONTEXT',
    'BN_MEANS_ADD_INCOME','BN_MEANS_ADD_ASSET',$new$);

  v_def := replace(v_def,
    $old2$      IF v_cmd IN ('BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_ADD_INCOME',$old2$,
    $new2$      IF v_cmd IN ('BN_MEANS_ADD_HOUSEHOLD_MEMBER','BN_MEANS_UPDATE_HOUSEHOLD_MEMBER',
                   'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER','BN_MEANS_CORRECT_CONTEXT','BN_MEANS_ADD_INCOME',$new2$);

  IF position('BN_MEANS_REMOVE_HOUSEHOLD_MEMBER' in v_def) = 0 THEN
    RAISE EXCEPTION 'available-actions replacement failed';
  END IF;
  EXECUTE v_def;
END $mig2$;

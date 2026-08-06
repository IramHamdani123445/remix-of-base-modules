-- ============================================================
-- MEANS-TEST EPIC 1 — Assessment Initiation backend
-- ============================================================

ALTER TABLE public.bn_means_assessment
  ADD COLUMN IF NOT EXISTS source_entry_point text
    CHECK (source_entry_point IS NULL OR source_entry_point IN
      ('MEANS_LANDING','CLAIM_WORKSPACE','AWARD_360','BENEFIT_360'));

-- ------------------------------------------------------------
-- masking helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_mask_ssn(p_ssn text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN p_ssn IS NULL OR length(btrim(p_ssn)) = 0 THEN NULL
    WHEN length(btrim(p_ssn)) <= 3 THEN repeat('*', length(btrim(p_ssn)))
    ELSE repeat('*', length(btrim(p_ssn)) - 3) || right(btrim(p_ssn), 3)
  END
$fn$;

-- ------------------------------------------------------------
-- policy resolution (single source of truth)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_resolve_policy(p_programme text, p_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count int;
  v_row   jsonb;
BEGIN
  IF COALESCE(p_programme,'') = '' OR p_date IS NULL THEN
    RETURN jsonb_build_object('state','UNRESOLVED','reason_code','PROGRAMME_REQUIRED');
  END IF;

  SELECT count(*) INTO v_count
    FROM public.bn_means_policy p
    JOIN public.bn_means_policy_version v ON v.policy_id = p.policy_id
   WHERE p.benefit_programme = p_programme
     AND p.status = 'ACTIVE'
     AND v.status = 'ACTIVE'
     AND v.effective_from <= p_date
     AND (v.effective_to IS NULL OR v.effective_to >= p_date);

  IF v_count = 0 THEN
    RETURN jsonb_build_object('state','NONE','reason_code','NO_EFFECTIVE_POLICY');
  END IF;
  IF v_count > 1 THEN
    RETURN jsonb_build_object('state','OVERLAPPING','reason_code','OVERLAPPING_POLICY',
      'candidate_count', v_count,
      'support_reference','Means-Test policy configuration — overlapping active policy versions');
  END IF;

  SELECT jsonb_build_object(
           'state','RESOLVED',
           'policy_id', p.policy_id,
           'policy_code', p.policy_code,
           'policy_name', p.policy_name,
           'benefit_programme', p.benefit_programme,
           'authority_reference', COALESCE(v.authority_reference, p.authority_reference),
           'policy_version_id', v.policy_version_id,
           'version_label', v.version_label,
           'effective_from', v.effective_from,
           'effective_to', v.effective_to,
           'currency_code', v.currency_code,
           'validity_months', v.validity_months,
           'reassessment_months', v.reassessment_months,
           'required_evidence', v.required_evidence,
           'status', v.status)
    INTO v_row
    FROM public.bn_means_policy p
    JOIN public.bn_means_policy_version v ON v.policy_id = p.policy_id
   WHERE p.benefit_programme = p_programme
     AND p.status = 'ACTIVE'
     AND v.status = 'ACTIVE'
     AND v.effective_from <= p_date
     AND (v.effective_to IS NULL OR v.effective_to >= p_date);

  RETURN v_row;
END;
$fn$;

-- ------------------------------------------------------------
-- active means-test programmes
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_programmes_v1(
  p_actor_user_id uuid,
  p_effective_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
  v_date date := COALESCE(p_effective_date, CURRENT_DATE);
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'label'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT DISTINCT jsonb_build_object(
      'value', p.benefit_programme,
      'label', COALESCE(pr.benefit_name, p.benefit_programme),
      'description', p.policy_name,
      'is_active', EXISTS (
        SELECT 1 FROM public.bn_means_policy_version v
         WHERE v.policy_id = p.policy_id AND v.status = 'ACTIVE'
           AND v.effective_from <= v_date
           AND (v.effective_to IS NULL OR v.effective_to >= v_date))
    ) AS r
    FROM public.bn_means_policy p
    LEFT JOIN public.bn_product pr ON pr.benefit_code = p.benefit_programme
   WHERE p.status = 'ACTIVE'
  ) s;

  RETURN jsonb_build_object('status','OK','data', v_rows, 'total_count', jsonb_array_length(v_rows));
END;
$fn$;

-- ------------------------------------------------------------
-- effective policy versions for a programme
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_policy_resolution_v1(
  p_actor_user_id uuid,
  p_benefit_programme text,
  p_effective_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK',
    'data', public._bn_means_resolve_policy(p_benefit_programme, p_effective_date));
END;
$fn$;

-- ------------------------------------------------------------
-- governed person search
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_person_search_v1(
  p_actor_user_id uuid,
  p_term text,
  p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
  v_term text := btrim(COALESCE(p_term,''));
  v_dob  date;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  IF length(v_term) < 2 THEN
    RETURN jsonb_build_object('status','INVALID','code','SEARCH_TERM_TOO_SHORT','data', NULL);
  END IF;

  BEGIN
    v_dob := v_term::date;
  EXCEPTION WHEN others THEN
    v_dob := NULL;
  END;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'full_name'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'person_id', NULLIF(regexp_replace(m.ssn,'[^0-9]','','g'),'')::bigint,
      'full_name', btrim(COALESCE(m.firstname,'') || ' ' || COALESCE(m.surname,'')),
      'masked_identifier', public._bn_means_mask_ssn(m.ssn),
      'date_of_birth', m.dob,
      'address_summary', NULLIF(btrim(concat_ws(', ', NULLIF(m.resident_addr1,''),
                                                     NULLIF(m.resident_addr2,''),
                                                     NULLIF(m.district,''))),''),
      'person_status', m.status,
      'is_deceased', (m.date_died IS NOT NULL),
      'open_claim_count', (SELECT count(*) FROM public.bn_claim c
                            WHERE c.ssn = m.ssn
                              AND COALESCE(c.status,'') NOT IN ('CLOSED','REJECTED','WITHDRAWN','CANCELLED')),
      'active_award_count', (SELECT count(*) FROM public.bn_award w
                              WHERE w.ssn = m.ssn AND COALESCE(w.status,'') = 'ACTIVE')
    ) AS r
    FROM public.ip_master m
   WHERE m.ssn IS NOT NULL
     AND (
       regexp_replace(m.ssn,'[^0-9]','','g') = regexp_replace(v_term,'[^0-9]','','g')
       OR m.surname   ILIKE '%' || v_term || '%'
       OR m.firstname ILIKE '%' || v_term || '%'
       OR (v_dob IS NOT NULL AND m.dob = v_dob)
       OR EXISTS (SELECT 1 FROM public.bn_claim c
                   WHERE c.ssn = m.ssn AND c.claim_number ILIKE '%' || v_term || '%')
     )
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit,20), 50))
  ) s;

  RETURN jsonb_build_object('status','OK','data', v_rows, 'total_count', jsonb_array_length(v_rows));
END;
$fn$;

-- ------------------------------------------------------------
-- person context: claims, awards, existing assessments
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_person_context_v1(
  p_actor_user_id uuid,
  p_person_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm   jsonb;
  v_ssn    text;
  v_person jsonb;
  v_claims jsonb;
  v_awards jsonb;
  v_assess jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  IF p_person_id IS NULL THEN
    RETURN jsonb_build_object('status','INVALID','code','PERSON_REQUIRED','data', NULL);
  END IF;

  SELECT m.ssn,
         jsonb_build_object(
           'person_id', p_person_id,
           'full_name', btrim(COALESCE(m.firstname,'') || ' ' || COALESCE(m.surname,'')),
           'masked_identifier', public._bn_means_mask_ssn(m.ssn),
           'date_of_birth', m.dob,
           'address_summary', NULLIF(btrim(concat_ws(', ', NULLIF(m.resident_addr1,''),
                                                          NULLIF(m.resident_addr2,''),
                                                          NULLIF(m.district,''))),''),
           'person_status', m.status,
           'is_deceased', (m.date_died IS NOT NULL))
    INTO v_ssn, v_person
    FROM public.ip_master m
   WHERE regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') = p_person_id::text
   LIMIT 1;

  IF v_person IS NULL THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','PERSON_NOT_FOUND','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'claim_id', c.id,
           'claim_reference', c.claim_number,
           'benefit_programme', pr.benefit_code,
           'programme_label', COALESCE(pr.benefit_name, pr.benefit_code),
           'claim_status', c.status,
           'claim_date', c.claim_date,
           'effective_date', COALESCE(c.claim_date, c.reported_date),
           'existing_assessment_reference',
             (SELECT a.assessment_reference FROM public.bn_means_assessment a
               WHERE a.claim_id = c.id ORDER BY a.created_at DESC LIMIT 1)
         ) ORDER BY c.claim_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_claims
    FROM public.bn_claim c
    LEFT JOIN public.bn_product pr ON pr.id = c.product_id
   WHERE c.ssn = v_ssn;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'award_id', w.id,
           'award_reference', w.award_number,
           'benefit_programme', w.benefit_code,
           'programme_label', COALESCE(pr.benefit_name, w.benefit_code),
           'award_status', w.status,
           'start_date', w.start_date,
           'end_date', w.end_date,
           'claim_id', w.bn_claim_id,
           'payment_frequency', w.frequency,
           'next_review_date', w.next_review_date,
           'existing_assessment_reference',
             (SELECT a.assessment_reference FROM public.bn_means_assessment a
               WHERE a.award_id = w.id ORDER BY a.created_at DESC LIMIT 1)
         ) ORDER BY w.start_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_awards
    FROM public.bn_award w
    LEFT JOIN public.bn_product pr ON pr.benefit_code = w.benefit_code
   WHERE w.ssn = v_ssn;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'assessment_id', a.assessment_id,
           'assessment_reference', a.assessment_reference,
           'benefit_programme', a.benefit_programme,
           'assessment_reason', a.assessment_reason,
           'status', a.status,
           'result', a.result,
           'effective_from', a.effective_from,
           'valid_until', a.valid_until,
           'reassessment_due', a.reassessment_due,
           'assigned_to', a.assigned_to,
           'claim_id', a.claim_id,
           'award_id', a.award_id
         ) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_assess
    FROM public.bn_means_assessment a
   WHERE a.person_id = p_person_id;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'person', v_person, 'claims', v_claims, 'awards', v_awards, 'assessments', v_assess));
END;
$fn$;

-- ------------------------------------------------------------
-- backend-owned initiation check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_initiation_check_v1(
  p_actor_user_id uuid,
  p_context jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_perm      jsonb;
  v_blockers  jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  v_codes     text[] := ARRAY[]::text[];
  v_entry     text := COALESCE(p_context->>'entry_context','STANDALONE_ASSESSMENT');
  v_person    bigint := NULLIF(p_context->>'person_id','')::bigint;
  v_claim     uuid := NULLIF(p_context->>'claim_id','')::uuid;
  v_award     uuid := NULLIF(p_context->>'award_id','')::uuid;
  v_prog      text := NULLIF(p_context->>'benefit_programme','');
  v_reason    text := NULLIF(p_context->>'assessment_reason','');
  v_eff       date := NULLIF(p_context->>'effective_from','')::date;
  v_ssn       text;
  v_claim_row public.bn_claim%ROWTYPE;
  v_award_row public.bn_award%ROWTYPE;
  v_claim_prog text;
  v_policy    jsonb := NULL;
  v_open      jsonb := '[]'::jsonb;
  v_active    jsonb := NULL;
  v_overlap   jsonb := '[]'::jsonb;
  v_reassess  date := NULL;

  PROCEDURE_placeholder int;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'write', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
      'can_create', false,
      'reason_codes', to_jsonb(ARRAY['PERMISSION_DENIED']),
      'blockers', jsonb_build_array(jsonb_build_object('code','PERMISSION_DENIED',
        'message','You do not hold permission to create Means-Test assessments.')),
      'warnings','[]'::jsonb,
      'existing_open_assessments','[]'::jsonb,
      'existing_active_assessment', NULL,
      'overlapping_assessments','[]'::jsonb,
      'reassessment_due', NULL,
      'policy_resolution', NULL));
  END IF;

  -- required context ------------------------------------------------
  IF v_person IS NULL THEN
    v_codes := v_codes || 'PERSON_REQUIRED';
    v_blockers := v_blockers || jsonb_build_object('code','PERSON_REQUIRED','message','Select the person to be assessed.');
  ELSE
    SELECT regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') INTO v_ssn
      FROM public.ip_master m
     WHERE regexp_replace(COALESCE(m.ssn,''),'[^0-9]','','g') = v_person::text
     LIMIT 1;
    IF v_ssn IS NULL THEN
      v_codes := v_codes || 'PERSON_REQUIRED';
      v_blockers := v_blockers || jsonb_build_object('code','PERSON_REQUIRED','message','The selected person could not be confirmed.');
    END IF;
  END IF;

  IF v_entry IN ('NEW_CLAIM_ASSESSMENT','EXISTING_CLAIM_REVIEW') AND v_claim IS NULL THEN
    v_codes := v_codes || 'CLAIM_REQUIRED';
    v_blockers := v_blockers || jsonb_build_object('code','CLAIM_REQUIRED','message','Select the claim this assessment supports.');
  END IF;
  IF v_entry = 'EXISTING_AWARD_REVIEW' AND v_award IS NULL THEN
    v_codes := v_codes || 'AWARD_REQUIRED';
    v_blockers := v_blockers || jsonb_build_object('code','AWARD_REQUIRED','message','Select the award being reviewed.');
  END IF;
  IF v_prog IS NULL THEN
    v_codes := v_codes || 'PROGRAMME_REQUIRED';
    v_blockers := v_blockers || jsonb_build_object('code','PROGRAMME_REQUIRED','message','A benefit programme is required.');
  END IF;
  IF v_reason IS NULL THEN
    v_codes := v_codes || 'REASON_REQUIRED';
    v_blockers := v_blockers || jsonb_build_object('code','REASON_REQUIRED','message','Select why this assessment is being carried out.');
  END IF;
  IF v_eff IS NULL THEN
    v_codes := v_codes || 'EFFECTIVE_DATE_REQUIRED';
    v_blockers := v_blockers || jsonb_build_object('code','EFFECTIVE_DATE_REQUIRED','message','An effective date is required.');
  END IF;

  -- claim context ---------------------------------------------------
  IF v_claim IS NOT NULL THEN
    SELECT * INTO v_claim_row FROM public.bn_claim WHERE id = v_claim;
    IF NOT FOUND THEN
      v_codes := v_codes || 'CLAIM_REQUIRED';
      v_blockers := v_blockers || jsonb_build_object('code','CLAIM_REQUIRED','message','The selected claim could not be found.');
    ELSE
      IF v_ssn IS NOT NULL AND regexp_replace(COALESCE(v_claim_row.ssn,''),'[^0-9]','','g') <> v_ssn THEN
        v_codes := v_codes || 'CONTEXT_PERSON_MISMATCH';
        v_blockers := v_blockers || jsonb_build_object('code','CONTEXT_PERSON_MISMATCH','message','The selected claim belongs to a different person.');
      END IF;
      SELECT pr.benefit_code INTO v_claim_prog FROM public.bn_product pr WHERE pr.id = v_claim_row.product_id;
      IF v_prog IS NOT NULL AND v_claim_prog IS NOT NULL AND v_claim_prog <> v_prog THEN
        v_codes := v_codes || 'CLAIM_PROGRAMME_MISMATCH';
        v_blockers := v_blockers || jsonb_build_object('code','CLAIM_PROGRAMME_MISMATCH','message','The benefit programme does not match the selected claim.');
      END IF;
    END IF;
  END IF;

  -- award context ---------------------------------------------------
  IF v_award IS NOT NULL THEN
    SELECT * INTO v_award_row FROM public.bn_award WHERE id = v_award;
    IF NOT FOUND THEN
      v_codes := v_codes || 'AWARD_REQUIRED';
      v_blockers := v_blockers || jsonb_build_object('code','AWARD_REQUIRED','message','The selected award could not be found.');
    ELSE
      IF v_ssn IS NOT NULL AND regexp_replace(COALESCE(v_award_row.ssn,''),'[^0-9]','','g') <> v_ssn THEN
        v_codes := v_codes || 'CONTEXT_PERSON_MISMATCH';
        v_blockers := v_blockers || jsonb_build_object('code','CONTEXT_PERSON_MISMATCH','message','The selected award belongs to a different person.');
      END IF;
      IF v_prog IS NOT NULL AND COALESCE(v_award_row.benefit_code,'') <> '' AND v_award_row.benefit_code <> v_prog THEN
        v_codes := v_codes || 'AWARD_PROGRAMME_MISMATCH';
        v_blockers := v_blockers || jsonb_build_object('code','AWARD_PROGRAMME_MISMATCH','message','The benefit programme does not match the selected award.');
      END IF;
      IF v_eff IS NOT NULL AND v_award_row.start_date IS NOT NULL AND v_eff < v_award_row.start_date THEN
        v_codes := v_codes || 'EFFECTIVE_DATE_CONFLICT';
        v_blockers := v_blockers || jsonb_build_object('code','EFFECTIVE_DATE_CONFLICT','message','The effective date is before the award start date.');
      END IF;
    END IF;
  END IF;

  -- effective date business range ------------------------------------
  IF v_eff IS NOT NULL AND (v_eff < CURRENT_DATE - INTERVAL '10 years' OR v_eff > CURRENT_DATE + INTERVAL '1 year') THEN
    v_codes := v_codes || 'EFFECTIVE_DATE_CONFLICT';
    v_blockers := v_blockers || jsonb_build_object('code','EFFECTIVE_DATE_CONFLICT',
      'message','The effective date must fall within ten years past and one year ahead of today.');
  END IF;

  -- policy resolution -------------------------------------------------
  IF v_prog IS NOT NULL AND v_eff IS NOT NULL THEN
    v_policy := public._bn_means_resolve_policy(v_prog, v_eff);
    IF v_policy->>'state' = 'NONE' THEN
      v_codes := v_codes || 'NO_EFFECTIVE_POLICY';
      v_blockers := v_blockers || jsonb_build_object('code','NO_EFFECTIVE_POLICY',
        'message','No applicable Means-Test policy is configured for the selected programme and effective date.');
    ELSIF v_policy->>'state' = 'OVERLAPPING' THEN
      v_codes := v_codes || 'OVERLAPPING_POLICY';
      v_blockers := v_blockers || jsonb_build_object('code','OVERLAPPING_POLICY',
        'message','More than one Means-Test policy version is in force for this programme and date. This is a configuration error — contact Means-Test configuration support.');
    END IF;
  END IF;

  -- existing assessments ----------------------------------------------
  IF v_person IS NOT NULL AND v_prog IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'assessment_id', a.assessment_id,
             'assessment_reference', a.assessment_reference,
             'status', a.status,
             'effective_from', a.effective_from,
             'valid_until', a.valid_until,
             'assigned_to', a.assigned_to) ORDER BY a.created_at DESC), '[]'::jsonb)
      INTO v_open
      FROM public.bn_means_assessment a
     WHERE a.person_id = v_person
       AND a.benefit_programme = v_prog
       AND a.status IN ('DRAFT','INFORMATION_PENDING','SUBMITTED','VERIFICATION_PENDING',
                        'CALCULATED','APPROVAL_PENDING','APPROVED');

    IF jsonb_array_length(v_open) > 0 THEN
      v_codes := v_codes || 'OPEN_ASSESSMENT_EXISTS';
      v_blockers := v_blockers || jsonb_build_object('code','OPEN_ASSESSMENT_EXISTS',
        'message','An assessment is already open for this person and programme.');
    END IF;

    SELECT jsonb_build_object(
             'assessment_id', a.assessment_id,
             'assessment_reference', a.assessment_reference,
             'status', a.status,
             'effective_from', a.effective_from,
             'valid_until', a.valid_until,
             'reassessment_due', a.reassessment_due,
             'assigned_to', a.assigned_to), a.reassessment_due
      INTO v_active, v_reassess
      FROM public.bn_means_assessment a
     WHERE a.person_id = v_person AND a.benefit_programme = v_prog AND a.status = 'ACTIVE'
     ORDER BY a.effective_from DESC
     LIMIT 1;

    IF v_active IS NOT NULL AND v_eff IS NOT NULL THEN
      IF (v_active->>'valid_until') IS NULL OR v_eff <= (v_active->>'valid_until')::date THEN
        v_overlap := jsonb_build_array(v_active);
        v_codes := v_codes || 'ACTIVE_ASSESSMENT_EXISTS';
        v_blockers := v_blockers || jsonb_build_object('code','ACTIVE_ASSESSMENT_EXISTS',
          'message','An active assessment already covers this effective date.');
      ELSE
        v_warnings := v_warnings || jsonb_build_object('code','ACTIVE_ASSESSMENT_EXISTS',
          'message','An active assessment exists but its validity ends before the effective date. This will be recorded as a reassessment.');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'can_create', (jsonb_array_length(v_blockers) = 0),
    'reason_codes', to_jsonb(v_codes),
    'blockers', v_blockers,
    'warnings', v_warnings,
    'existing_open_assessments', v_open,
    'existing_active_assessment', v_active,
    'overlapping_assessments', v_overlap,
    'reassessment_due', v_reassess,
    'policy_resolution', v_policy));
END;
$fn$;

REVOKE ALL ON FUNCTION public.bn_means_programmes_v1(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_policy_resolution_v1(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_person_search_v1(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_person_context_v1(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_initiation_check_v1(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._bn_means_resolve_policy(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._bn_means_mask_ssn(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bn_means_programmes_v1(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_policy_resolution_v1(uuid, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_person_search_v1(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_person_context_v1(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_initiation_check_v1(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._bn_means_resolve_policy(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._bn_means_mask_ssn(text) TO service_role;

-- ------------------------------------------------------------
-- rewrite the CREATE_ASSESSMENT branch of the command boundary
-- ------------------------------------------------------------
DO $mig$
DECLARE
  v_src   text;
  v_head  text;
  v_tail  text;
  v_block text;
  v_a_pos int;
  v_b_pos int;
  c_marker_a CONSTANT text := E'  IF p_command_name = ''BN_MEANS_CREATE_ASSESSMENT'' THEN';
  c_marker_b CONSTANT text := E'  ELSIF p_command_name = ''BN_MEANS_ADD_HOUSEHOLD_MEMBER'' THEN';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src FROM pg_proc
   WHERE proname = 'bn_means_execute_command_v1' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'command boundary not found'; END IF;

  v_a_pos := position(c_marker_a in v_src);
  v_b_pos := position(c_marker_b in v_src);
  IF v_a_pos = 0 OR v_b_pos = 0 OR v_b_pos <= v_a_pos THEN
    RAISE EXCEPTION 'CREATE_ASSESSMENT branch markers not located';
  END IF;

  v_head := substr(v_src, 1, v_a_pos - 1);
  v_tail := substr(v_src, v_b_pos);

  v_block := $blk$  IF p_command_name = 'BN_MEANS_CREATE_ASSESSMENT' THEN
    -- MEANS-TEST EPIC 1 — connected initiation. Every prefilled value from
    -- the screen is revalidated here; nothing is trusted from the client.
    IF COALESCE(p_payload->>'source_entry_point','MEANS_LANDING') NOT IN
       ('MEANS_LANDING','CLAIM_WORKSPACE','AWARD_360','BENEFIT_360') THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:source entry point';
    END IF;

    v_snapshot := public.bn_means_initiation_check_v1(p_actor_user_id, p_payload);
    IF NOT COALESCE((v_snapshot->'data'->>'can_create')::boolean, false) THEN
      v_reason := COALESCE(v_snapshot->'data'->'blockers'->0->>'code','MISSING_REQUIRED_INFORMATION');
      IF v_reason = 'NO_EFFECTIVE_POLICY' THEN
        RAISE EXCEPTION 'E_POLICY_NOT_FOUND:% %', p_payload->>'benefit_programme', p_payload->>'effective_from';
      ELSIF v_reason = 'OVERLAPPING_POLICY' THEN
        RAISE EXCEPTION 'E_POLICY_NOT_EFFECTIVE:overlapping policy versions for % on %',
          p_payload->>'benefit_programme', p_payload->>'effective_from';
      ELSIF v_reason IN ('OPEN_ASSESSMENT_EXISTS','ACTIVE_ASSESSMENT_EXISTS') THEN
        RAISE EXCEPTION 'E_DUPLICATE_OPEN_ASSESSMENT:%', v_reason;
      ELSIF v_reason = 'PERMISSION_DENIED' THEN
        RAISE EXCEPTION 'E_PERMISSION_DENIED:%', p_command_name;
      ELSIF v_reason = 'EFFECTIVE_DATE_CONFLICT' THEN
        RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATES:%', p_payload->>'effective_from';
      ELSE
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:%', v_reason;
      END IF;
    END IF;

    v_params := v_snapshot->'data'->'policy_resolution';
    IF COALESCE(v_params->>'state','') <> 'RESOLVED' THEN
      RAISE EXCEPTION 'E_POLICY_NOT_FOUND:% %', p_payload->>'benefit_programme', p_payload->>'effective_from';
    END IF;

    -- the screen may echo the resolved policy, but it may never choose one
    IF NULLIF(p_payload->>'policy_version_id','') IS NOT NULL
       AND (p_payload->>'policy_version_id') <> (v_params->>'policy_version_id') THEN
      RAISE EXCEPTION 'E_POLICY_NOT_EFFECTIVE:%', p_payload->>'policy_version_id';
    END IF;
    IF NULLIF(p_payload->>'currency_code','') IS NOT NULL
       AND (p_payload->>'currency_code') <> (v_params->>'currency_code') THEN
      RAISE EXCEPTION 'E_CURRENCY_MISMATCH:policy=% payload=%',
        v_params->>'currency_code', p_payload->>'currency_code';
    END IF;

    IF NULLIF(p_payload->>'effective_to','') IS NOT NULL
       AND (p_payload->>'effective_to')::date < (p_payload->>'effective_from')::date THEN
      RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATES:%', p_payload->>'effective_to';
    END IF;

    BEGIN
      INSERT INTO public.bn_means_assessment(
        person_id, declared_person, claim_id, award_id, benefit_programme,
        assessment_reason, effective_from, effective_to, policy_version_id,
        currency_code, status, assigned_to, source_entry_point,
        correlation_id, created_by, updated_by)
      VALUES (
        NULLIF(p_payload->>'person_id','')::bigint,
        COALESCE(p_payload->'declared_person','{}'::jsonb),
        NULLIF(p_payload->>'claim_id','')::uuid,
        NULLIF(p_payload->>'award_id','')::uuid,
        p_payload->>'benefit_programme',
        p_payload->>'assessment_reason',
        (p_payload->>'effective_from')::date,
        NULLIF(p_payload->>'effective_to','')::date,
        (v_params->>'policy_version_id')::uuid,
        v_params->>'currency_code',
        'DRAFT',
        COALESCE(NULLIF(p_payload->>'assigned_to','')::uuid, p_actor_user_id),
        COALESCE(p_payload->>'source_entry_point','MEANS_LANDING'),
        p_correlation_id, p_actor_user_id, p_actor_user_id)
      RETURNING assessment_id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'E_DUPLICATE_OPEN_ASSESSMENT:% %', p_payload->>'benefit_programme', p_payload->>'effective_from';
    END;

    v_id := v_new_id;
    SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = v_id;
    PERFORM public._bn_means_event(v_id,'CREATED',p_command_name,NULL,'DRAFT',
      p_reason_code,p_justification,
      p_payload || jsonb_build_object(
        'source_entry_point', COALESCE(p_payload->>'source_entry_point','MEANS_LANDING'),
        'entry_context', COALESCE(p_payload->>'entry_context','STANDALONE_ASSESSMENT'),
        'resolved_policy_version_id', v_params->>'policy_version_id',
        'resolved_currency_code', v_params->>'currency_code'),
      p_actor_user_id,p_actor_user_code,p_correlation_id,v_a.row_version);
    v_result := jsonb_build_object('assessment_id', v_id,
      'assessment_reference', v_a.assessment_reference,
      'entity_version', v_a.row_version, 'to_status', 'DRAFT',
      'policy_version_id', v_params->>'policy_version_id',
      'currency_code', v_params->>'currency_code',
      'source_entry_point', COALESCE(p_payload->>'source_entry_point','MEANS_LANDING'),
      'warnings', COALESCE(v_snapshot->'data'->'warnings','[]'::jsonb));

$blk$;

  EXECUTE v_head || v_block || v_tail;
END;
$mig$;
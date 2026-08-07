-- =====================================================================
-- MEANS-TEST EPIC 7 — Review and Submission
-- =====================================================================

-- ---------- 1. Declaration catalogue (policy configured) ----------
CREATE TABLE IF NOT EXISTS public.bn_means_declaration_definition (
  declaration_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_code   text NOT NULL,
  policy_version_id  uuid REFERENCES public.bn_means_policy_version(policy_version_id) ON DELETE CASCADE,
  label              text NOT NULL,
  description        text,
  statement_text     text NOT NULL,
  statement_version  text NOT NULL DEFAULT 'v1',
  required           boolean NOT NULL DEFAULT true,
  actor_type         text NOT NULL DEFAULT 'OFFICER',
  display_order      int NOT NULL DEFAULT 100,
  active             boolean NOT NULL DEFAULT true,
  effective_from     date NOT NULL DEFAULT current_date,
  effective_to       date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_declaration_actor_chk CHECK (actor_type IN ('OFFICER','SUPERVISOR','CLAIMANT')),
  CONSTRAINT bn_means_declaration_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS bn_means_declaration_definition_uq
  ON public.bn_means_declaration_definition (
    declaration_code,
    COALESCE(policy_version_id,'00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT ON public.bn_means_declaration_definition TO authenticated;
GRANT ALL ON public.bn_means_declaration_definition TO service_role;

-- ---------- 2. Captured submission declarations ----------
CREATE TABLE IF NOT EXISTS public.bn_means_submission_declaration (
  submission_declaration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id         uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  assessment_version_id uuid REFERENCES public.bn_means_assessment_version(assessment_version_id) ON DELETE CASCADE,
  declaration_code      text NOT NULL,
  label                 text NOT NULL,
  statement_text        text NOT NULL,
  statement_version     text NOT NULL,
  actor_type            text NOT NULL DEFAULT 'OFFICER',
  required              boolean NOT NULL DEFAULT true,
  confirmed             boolean NOT NULL DEFAULT true,
  confirmed_by          uuid,
  confirmed_at          timestamptz NOT NULL DEFAULT now(),
  correlation_id        uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bn_means_submission_declaration_uq
  ON public.bn_means_submission_declaration (assessment_version_id, declaration_code);
CREATE INDEX IF NOT EXISTS bn_means_submission_declaration_assessment_idx
  ON public.bn_means_submission_declaration (assessment_id);

GRANT SELECT ON public.bn_means_submission_declaration TO authenticated;
GRANT ALL ON public.bn_means_submission_declaration TO service_role;

-- ---------- 3. Verification work handoff ----------
CREATE TABLE IF NOT EXISTS public.bn_means_verification_work (
  work_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id         uuid NOT NULL REFERENCES public.bn_means_assessment(assessment_id) ON DELETE CASCADE,
  assessment_version_id uuid NOT NULL REFERENCES public.bn_means_assessment_version(assessment_version_id) ON DELETE CASCADE,
  fact_kind             text NOT NULL,
  fact_ref_id           uuid,
  fact_summary          text,
  evidence_refs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority              text NOT NULL DEFAULT 'NORMAL',
  assigned_team         text,
  assigned_user_id      uuid,
  status                text NOT NULL DEFAULT 'PENDING',
  correlation_id        uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_means_verification_work_kind_chk CHECK (
    fact_kind IN ('ASSESSMENT','HOUSEHOLD','INCOME','ASSET','DEDUCTION','EVIDENCE')),
  CONSTRAINT bn_means_verification_work_status_chk CHECK (
    status IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
  CONSTRAINT bn_means_verification_work_priority_chk CHECK (
    priority IN ('LOW','NORMAL','HIGH','URGENT'))
);

CREATE UNIQUE INDEX IF NOT EXISTS bn_means_verification_work_uq
  ON public.bn_means_verification_work (
    assessment_version_id, fact_kind,
    COALESCE(fact_ref_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS bn_means_verification_work_assessment_idx
  ON public.bn_means_verification_work (assessment_id, status);

GRANT SELECT ON public.bn_means_verification_work TO authenticated;
GRANT ALL ON public.bn_means_verification_work TO service_role;

-- ---------- 4. Row level security (staff read only) ----------
ALTER TABLE public.bn_means_declaration_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_means_submission_declaration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_means_verification_work ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='bn_means_declaration_definition'
                  AND policyname='bn_means_declaration_definition_staff_read') THEN
    CREATE POLICY "bn_means_declaration_definition_staff_read"
      ON public.bn_means_declaration_definition FOR SELECT TO authenticated
      USING (COALESCE((public.bn_means_check_actor_permission(auth.uid(),'read',false)->>'ok')::boolean,false));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='bn_means_submission_declaration'
                  AND policyname='bn_means_submission_declaration_staff_read') THEN
    CREATE POLICY "bn_means_submission_declaration_staff_read"
      ON public.bn_means_submission_declaration FOR SELECT TO authenticated
      USING (COALESCE((public.bn_means_check_actor_permission(auth.uid(),'read',false)->>'ok')::boolean,false));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='bn_means_verification_work'
                  AND policyname='bn_means_verification_work_staff_read') THEN
    CREATE POLICY "bn_means_verification_work_staff_read"
      ON public.bn_means_verification_work FOR SELECT TO authenticated
      USING (COALESCE((public.bn_means_check_actor_permission(auth.uid(),'read',false)->>'ok')::boolean,false));
  END IF;
END $$;

-- ---------- 5. Seed default declarations ----------
INSERT INTO public.bn_means_declaration_definition
  (declaration_code, policy_version_id, label, description, statement_text,
   statement_version, required, actor_type, display_order)
VALUES
  ('APPLICANT_INFORMATION_CONFIRMED', NULL,
   'Applicant information confirmed',
   'The information recorded was confirmed with the applicant or their representative.',
   'I confirm that the household, income, asset and deduction information recorded in this assessment was confirmed with the applicant or their authorised representative.',
   'v1', true, 'OFFICER', 10),
  ('OFFICER_REVIEW_COMPLETED', NULL,
   'Officer review completed',
   'The reviewing officer has reviewed every completed section of this assessment.',
   'I confirm that I have reviewed each completed section of this assessment and the supporting evidence recorded against it.',
   'v1', true, 'OFFICER', 20),
  ('INFORMATION_COMPLETE_BEST_KNOWLEDGE', NULL,
   'Information is complete to the best of available knowledge',
   'Optional confirmation that no further information is known to be outstanding.',
   'To the best of the information available to me, the assessment is complete and no further information is known to be outstanding.',
   'v1', false, 'OFFICER', 30)
ON CONFLICT DO NOTHING;

-- ---------- 6. Declaration resolution ----------
CREATE OR REPLACE FUNCTION public._bn_means_declaration_requirements(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a public.bn_means_assessment%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'declaration_code', d.declaration_code,
           'label', d.label,
           'description', d.description,
           'statement_text', d.statement_text,
           'statement_version', d.statement_version,
           'required', d.required,
           'actor_type', d.actor_type,
           'display_order', d.display_order,
           'effective_policy_version', v_a.policy_version_id
         ) ORDER BY d.display_order, d.declaration_code), '[]'::jsonb)
    INTO v_rows
    FROM public.bn_means_declaration_definition d
   WHERE d.active
     AND d.effective_from <= current_date
     AND (d.effective_to IS NULL OR d.effective_to >= current_date)
     AND (d.policy_version_id = v_a.policy_version_id
          OR (d.policy_version_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.bn_means_declaration_definition o
                               WHERE o.declaration_code = d.declaration_code
                                 AND o.policy_version_id = v_a.policy_version_id
                                 AND o.active)));
  RETURN v_rows;
END;
$function$;

-- ---------- 7. Submission readiness (single authoritative boundary) ----------
CREATE OR REPLACE FUNCTION public._bn_means_submission_readiness(
  p_assessment_id uuid, p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a        public.bn_means_assessment%ROWTYPE;
  v_pv       public.bn_means_policy_version%ROWTYPE;
  v_hh       jsonb;
  v_inc      jsonb;
  v_ast      jsonb;
  v_ded      jsonb;
  v_evd      jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_block    jsonb := '[]'::jsonb;
  v_warn     jsonb := '[]'::jsonb;
  v_codes    jsonb := '[]'::jsonb;
  v_decls    jsonb;
  v_open_req int := 0;
  v_conflict int := 0;
  v_submitted boolean;
  v_policy_status text := 'UNKNOWN';

  FUNCTION_PLACEHOLDER boolean;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_hh  := public.bn_means_household_readiness_v1(p_actor_user_id, p_assessment_id)->'data';
  v_inc := public.bn_means_income_readiness_v1(p_actor_user_id, p_assessment_id)->'data';
  v_ast := public._bn_means_asset_readiness(p_assessment_id);
  v_ded := public._bn_means_deduction_readiness(p_assessment_id);
  v_evd := public._bn_means_evidence_readiness(p_assessment_id);
  v_decls := COALESCE(public._bn_means_declaration_requirements(p_assessment_id),'[]'::jsonb);

  v_submitted := v_a.status NOT IN ('DRAFT','INFORMATION_PENDING','INCOMPLETE');

  -- Section statuses (backend derived, never recomputed in the browser).
  v_sections := jsonb_build_array(
    jsonb_build_object('section','CONTEXT','complete', v_a.policy_version_id IS NOT NULL,
      'status', CASE WHEN v_a.policy_version_id IS NOT NULL THEN 'COMPLETE' ELSE 'BLOCKED' END),
    jsonb_build_object('section','HOUSEHOLD',
      'complete', COALESCE((v_hh->>'section_complete')::boolean,false),
      'status', CASE WHEN COALESCE((v_hh->>'section_complete')::boolean,false) THEN 'COMPLETE' ELSE 'BLOCKED' END),
    jsonb_build_object('section','INCOME',
      'complete', COALESCE((v_inc->>'section_marked_complete')::boolean,false),
      'status', CASE WHEN COALESCE((v_inc->>'section_marked_complete')::boolean,false) THEN 'COMPLETE' ELSE 'BLOCKED' END),
    jsonb_build_object('section','ASSETS',
      'complete', COALESCE((v_ast->>'section_marked_complete')::boolean,false),
      'status', CASE WHEN COALESCE((v_ast->>'section_marked_complete')::boolean,false) THEN 'COMPLETE' ELSE 'BLOCKED' END),
    jsonb_build_object('section','DEDUCTIONS',
      'complete', COALESCE((v_ded->>'section_marked_complete')::boolean,false),
      'status', CASE WHEN COALESCE((v_ded->>'section_marked_complete')::boolean,false) THEN 'COMPLETE' ELSE 'BLOCKED' END),
    jsonb_build_object('section','EVIDENCE',
      'complete', COALESCE((v_evd->>'section_marked_complete')::boolean,false)
                  AND NOT COALESCE((v_evd->>'completion_invalidated')::boolean,false),
      'status', CASE WHEN COALESCE((v_evd->>'section_marked_complete')::boolean,false)
                       AND NOT COALESCE((v_evd->>'completion_invalidated')::boolean,false)
                     THEN 'COMPLETE' ELSE 'BLOCKED' END));

  IF v_submitted THEN
    v_codes := v_codes || '"SUBMISSION_ALREADY_COMPLETED"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','SUBMISSION_ALREADY_COMPLETED','section','ASSESSMENT','severity','BLOCKER',
      'message','This assessment has already been submitted and is awaiting verification.'));
  ELSIF NOT public._bn_means_is_editable(v_a.status) THEN
    v_codes := v_codes || '"ASSESSMENT_NOT_EDITABLE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','ASSESSMENT_NOT_EDITABLE','section','ASSESSMENT','severity','BLOCKER',
      'message','This assessment can no longer be edited or submitted.'));
  END IF;

  IF v_a.policy_version_id IS NULL THEN
    v_codes := v_codes || '"POLICY_NOT_EFFECTIVE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','POLICY_NOT_EFFECTIVE','section','ASSESSMENT','severity','BLOCKER',
      'message','No policy version is attached to this assessment.'));
  ELSE
    SELECT * INTO v_pv FROM public.bn_means_policy_version
     WHERE policy_version_id = v_a.policy_version_id;
    v_policy_status := COALESCE(v_pv.status,'UNKNOWN');
    IF v_pv.status = 'RETIRED' THEN
      v_codes := v_codes || '"POLICY_RETIRED"'::jsonb;
      v_block := v_block || jsonb_build_array(jsonb_build_object(
        'code','POLICY_RETIRED','section','ASSESSMENT','severity','BLOCKER',
        'message','The policy version attached to this assessment has been retired.'));
    ELSIF v_pv.status <> 'ACTIVE'
       OR v_pv.effective_from > v_a.effective_from
       OR (v_pv.effective_to IS NOT NULL AND v_pv.effective_to < v_a.effective_from) THEN
      v_codes := v_codes || '"POLICY_NOT_EFFECTIVE"'::jsonb;
      v_block := v_block || jsonb_build_array(jsonb_build_object(
        'code','POLICY_NOT_EFFECTIVE','section','ASSESSMENT','severity','BLOCKER',
        'message','The attached policy version is not effective for this assessment period.'));
    END IF;
    IF v_pv.currency_code IS NOT NULL AND v_pv.currency_code <> v_a.currency_code THEN
      v_codes := v_codes || '"UNRESOLVED_CONFLICT"'::jsonb;
      v_block := v_block || jsonb_build_array(jsonb_build_object(
        'code','UNRESOLVED_CONFLICT','section','ASSESSMENT','severity','BLOCKER',
        'message','The assessment currency does not match the policy currency.'));
    END IF;
  END IF;

  IF NOT COALESCE((v_hh->>'section_complete')::boolean,false) THEN
    v_codes := v_codes || '"HOUSEHOLD_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','HOUSEHOLD_INCOMPLETE','section','HOUSEHOLD','severity','BLOCKER',
      'message','Household composition is not complete.'));
  END IF;
  IF NOT COALESCE((v_inc->>'section_marked_complete')::boolean,false) THEN
    v_codes := v_codes || '"INCOME_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','INCOME_INCOMPLETE','section','INCOME','severity','BLOCKER',
      'message','Income has not been completed for every household member.'));
  END IF;
  IF NOT COALESCE((v_ast->>'section_marked_complete')::boolean,false) THEN
    v_codes := v_codes || '"ASSETS_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','ASSETS_INCOMPLETE','section','ASSETS','severity','BLOCKER',
      'message','Assets have not been completed.'));
  END IF;
  IF NOT COALESCE((v_ded->>'section_marked_complete')::boolean,false) THEN
    v_codes := v_codes || '"DEDUCTIONS_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','DEDUCTIONS_INCOMPLETE','section','DEDUCTIONS','severity','BLOCKER',
      'message','Deductions and disregards have not been completed.'));
  END IF;
  IF NOT COALESCE((v_evd->>'section_marked_complete')::boolean,false)
     OR COALESCE((v_evd->>'completion_invalidated')::boolean,false) THEN
    v_codes := v_codes || '"EVIDENCE_INCOMPLETE"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','EVIDENCE_INCOMPLETE','section','EVIDENCE','severity','BLOCKER',
      'message', COALESCE(NULLIF((v_evd->>'mandatory_outstanding'),'0')
                   || ' mandatory evidence requirement(s) remain outstanding.',
                 'Evidence is not complete.')));
  END IF;

  SELECT count(*) INTO v_open_req
    FROM public.bn_means_information_request
   WHERE assessment_id = p_assessment_id
     AND status NOT IN ('FULFILLED','CANCELLED')
     AND COALESCE(is_blocking,true);
  IF v_open_req > 0 THEN
    v_codes := v_codes || '"OPEN_BLOCKING_INFORMATION_REQUEST"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','OPEN_BLOCKING_INFORMATION_REQUEST','section','EVIDENCE','severity','BLOCKER',
      'message', v_open_req || ' blocking information request(s) are still open.'));
  END IF;

  SELECT count(*) INTO v_conflict
    FROM public.bn_means_income_fact
   WHERE assessment_id = p_assessment_id AND voided_at IS NULL
     AND currency_code <> v_a.currency_code;
  IF v_conflict > 0 THEN
    v_codes := v_codes || '"UNRESOLVED_CONFLICT"'::jsonb;
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','UNRESOLVED_CONFLICT','section','INCOME','severity','BLOCKER',
      'message', v_conflict || ' income record(s) use a different currency to the assessment.'));
  END IF;

  -- Warnings never block submission.
  v_warn := v_warn
    || COALESCE((SELECT jsonb_agg(w || jsonb_build_object('section','EVIDENCE','severity','WARNING'))
                   FROM jsonb_array_elements(COALESCE(v_evd->'warnings','[]'::jsonb)) w),'[]'::jsonb)
    || COALESCE((SELECT jsonb_agg(w || jsonb_build_object('section','ASSETS','severity','WARNING'))
                   FROM jsonb_array_elements(COALESCE(v_ast->'warnings','[]'::jsonb)) w),'[]'::jsonb)
    || COALESCE((SELECT jsonb_agg(w || jsonb_build_object('section','DEDUCTIONS','severity','WARNING'))
                   FROM jsonb_array_elements(COALESCE(v_ded->'warnings','[]'::jsonb)) w),'[]'::jsonb);

  RETURN jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'status', v_a.status,
    'can_submit', (jsonb_array_length(v_block) = 0),
    'section_statuses', v_sections,
    'household_complete', COALESCE((v_hh->>'section_complete')::boolean,false),
    'income_complete', COALESCE((v_inc->>'section_marked_complete')::boolean,false),
    'assets_complete', COALESCE((v_ast->>'section_marked_complete')::boolean,false),
    'deductions_complete', COALESCE((v_ded->>'section_marked_complete')::boolean,false),
    'evidence_complete', COALESCE((v_evd->>'section_marked_complete')::boolean,false)
                         AND NOT COALESCE((v_evd->>'completion_invalidated')::boolean,false),
    'open_blocking_information_requests', v_open_req,
    'unresolved_data_conflicts', v_conflict,
    'policy_status', v_policy_status,
    'policy_version_id', v_a.policy_version_id,
    'required_declarations', v_decls,
    'warnings', v_warn,
    'blockers', v_block,
    'reason_codes', v_codes,
    'expected_row_version', v_a.row_version,
    'already_submitted', v_submitted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_submission_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb; v_data jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_data := public._bn_means_submission_readiness(p_assessment_id, p_actor_user_id);
  IF v_data IS NULL THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', v_data);
END;
$function$;

-- ---------- 8. Review aggregation ----------
CREATE OR REPLACE FUNCTION public.bn_means_review_summary_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_a    public.bn_means_assessment%ROWTYPE;
  v_pv   public.bn_means_policy_version%ROWTYPE;
  v_evd  jsonb;
  v_ded  jsonb;
  v_ast  jsonb;
  v_ver  jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  SELECT * INTO v_pv FROM public.bn_means_policy_version
   WHERE policy_version_id = v_a.policy_version_id;
  v_evd := public._bn_means_evidence_readiness(p_assessment_id);
  v_ded := public._bn_means_deduction_readiness(p_assessment_id);
  v_ast := public._bn_means_asset_readiness(p_assessment_id);

  SELECT to_jsonb(av) INTO v_ver FROM public.bn_means_assessment_version av
   WHERE av.assessment_id = p_assessment_id
   ORDER BY av.version_no DESC LIMIT 1;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'context', jsonb_build_object(
      'assessment_reference', v_a.assessment_reference,
      'person_id', v_a.person_id,
      'claim_id', v_a.claim_id,
      'award_id', v_a.award_id,
      'benefit_programme', v_a.benefit_programme,
      'assessment_reason', v_a.assessment_reason,
      'effective_from', v_a.effective_from,
      'effective_to', v_a.effective_to,
      'policy_version_label', v_pv.version_label,
      'policy_version_id', v_a.policy_version_id,
      'policy_status', v_pv.status,
      'currency_code', v_a.currency_code,
      'assigned_to', v_a.assigned_to,
      'source_entry_point', v_a.assessment_reason,
      'status', v_a.status,
      'row_version', v_a.row_version),
    'household', (
      SELECT jsonb_build_object(
        'total_members', count(*),
        'current_members', count(*) FILTER (WHERE h.member_to IS NULL OR h.member_to >= current_date),
        'ended_members', count(*) FILTER (WHERE h.member_to IS NOT NULL AND h.member_to < current_date),
        'dependants', count(*) FILTER (WHERE h.is_dependant),
        'members', COALESCE(jsonb_agg(jsonb_build_object(
            'display_name', COALESCE(NULLIF(h.declared_person->>'full_name',''),
                                     NULLIF(h.declared_person->>'display_name',''),
                                     'Household member'),
            'relationship_code', h.relationship_code,
            'member_from', h.member_from,
            'member_to', h.member_to,
            'is_dependant', h.is_dependant) ORDER BY h.member_from),'[]'::jsonb))
        FROM public.bn_means_household_member h
       WHERE h.assessment_id = p_assessment_id AND h.voided_at IS NULL),
    'income', (
      SELECT jsonb_build_object(
        'fact_count', count(*),
        'members_with_income', count(DISTINCT i.member_id),
        'declared_annualised_income', COALESCE(sum(i.normalised_annual_amount),0),
        'no_income_declarations', (
          SELECT count(*) FROM public.bn_means_no_income_declaration n
           WHERE n.assessment_id = p_assessment_id AND n.voided_at IS NULL))
        FROM public.bn_means_income_fact i
       WHERE i.assessment_id = p_assessment_id AND i.voided_at IS NULL),
    'assets', jsonb_build_object(
      'asset_count', COALESCE((v_ast->>'current_asset_count')::int,0),
      'declared_valuation', COALESCE((v_ast->>'declared_valuation_total')::numeric,
        (SELECT COALESCE(sum(a2.valuation_amount),0) FROM public.bn_means_asset_fact a2
          WHERE a2.assessment_id = p_assessment_id AND a2.voided_at IS NULL)),
      'possible_disregards', COALESCE((v_ast->>'possible_disregard_count')::int,0),
      'no_asset_declarations', COALESCE((v_ast->>'no_asset_declaration_count')::int,0),
      'warnings', COALESCE(v_ast->'warnings','[]'::jsonb)),
    'deductions', jsonb_build_object(
      'claim_count', COALESCE((v_ded->>'claim_count')::int,0),
      'possible_disregard_count', COALESCE((v_ded->>'possible_disregard_count')::int,0),
      'claimed_total', COALESCE((v_ded->>'claimed_total')::numeric,
        (SELECT COALESCE(sum(d.normalised_annual_amount),0) FROM public.bn_means_deduction_fact d
          WHERE d.assessment_id = p_assessment_id AND d.voided_at IS NULL)),
      'evidence_required_count', COALESCE((v_ded->>'evidence_required_count')::int,0),
      'warnings', COALESCE(v_ded->'warnings','[]'::jsonb)),
    'evidence', jsonb_build_object(
      'mandatory_total', COALESCE((v_evd->>'mandatory_total')::int,0),
      'mandatory_satisfied', COALESCE((v_evd->>'mandatory_satisfied')::int,0),
      'mandatory_outstanding', COALESCE((v_evd->>'mandatory_outstanding')::int,0),
      'unusable_document_count', COALESCE((v_evd->>'unusable_document_count')::int,0),
      'open_information_requests', COALESCE((v_evd->>'open_information_requests')::int,0),
      'overdue_information_requests', COALESCE((v_evd->>'overdue_information_requests')::int,0),
      'section_status', v_evd->>'section_status'),
    'submission', jsonb_build_object(
      'submitted_at', v_a.submitted_at,
      'submitted_by', v_a.maker_user_id,
      'frozen_version', v_ver,
      'verification_work_count', (
        SELECT count(*) FROM public.bn_means_verification_work w
         WHERE w.assessment_id = p_assessment_id),
      'declarations', COALESCE((
        SELECT jsonb_agg(to_jsonb(sd) ORDER BY sd.confirmed_at)
          FROM public.bn_means_submission_declaration sd
         WHERE sd.assessment_id = p_assessment_id),'[]'::jsonb),
      'acknowledgement', (
        SELECT jsonb_build_object('status', ci.status, 'event_code', ci.event_code,
                                  'intent_id', ci.intent_id, 'correlation_id', ci.correlation_id)
          FROM public.bn_means_communication_intent ci
         WHERE ci.assessment_id = p_assessment_id
           AND ci.event_code = 'MEANS_ASSESSMENT_SUBMITTED'
         ORDER BY ci.created_at DESC LIMIT 1)),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'event_code', e.event_code, 'command_name', e.command_name,
               'from_status', e.from_status, 'to_status', e.to_status,
               'created_at', e.created_at, 'correlation_id', e.correlation_id)
             ORDER BY e.created_at)
        FROM public.bn_means_event e WHERE e.assessment_id = p_assessment_id),'[]'::jsonb)
  ));
END;
$function$;

-- ---------- 9. Governed submission boundary ----------
CREATE OR REPLACE FUNCTION public.bn_means_submission_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_reason_code text,
  p_justification text, p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm      jsonb;
  v_prior     public.bn_means_command_idempotency%ROWTYPE;
  v_a         public.bn_means_assessment%ROWTYPE;
  v_from      text;
  v_ready     jsonb;
  v_decls     jsonb;
  v_given     jsonb;
  d           jsonb;
  v_version   uuid;
  v_version_no int;
  v_snapshot  jsonb;
  v_hash      text;
  v_work      int := 0;
  v_res       jsonb;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name; END IF;
  IF p_command_name <> 'BN_MEANS_SUBMIT' THEN
    RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
  END IF;

  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'write', true);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'E_PERMISSION_DENIED:%', COALESCE(v_perm->>'code','FORBIDDEN');
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
    RAISE EXCEPTION 'E_STALE_ROW_VERSION:expected=% actual=%', p_expected_row_version, v_a.row_version;
  END IF;
  v_from := v_a.status;

  IF NOT public._bn_means_is_editable(v_from) THEN
    RAISE EXCEPTION 'E_ALREADY_SUBMITTED:%', v_from;
  END IF;

  -- Policy version the officer reviewed must still be the bound version.
  IF COALESCE(p_payload->>'expected_policy_version','') <> ''
     AND (p_payload->>'expected_policy_version')::uuid IS DISTINCT FROM v_a.policy_version_id THEN
    RAISE EXCEPTION 'E_POLICY_NOT_EFFECTIVE:policy version changed during review';
  END IF;

  -- Authoritative re-evaluation. A browser result is never trusted.
  v_ready := public._bn_means_submission_readiness(p_assessment_id, p_actor_user_id);
  IF NOT COALESCE((v_ready->>'can_submit')::boolean,false) THEN
    RAISE EXCEPTION 'E_SECTION_NOT_READY:%',
      COALESCE(v_ready->'blockers'->0->>'code','NOT_READY');
  END IF;

  -- Required declarations must be confirmed with the configured wording.
  v_decls := COALESCE(v_ready->'required_declarations','[]'::jsonb);
  v_given := COALESCE(p_payload->'declarations','[]'::jsonb);
  FOR d IN SELECT * FROM jsonb_array_elements(v_decls) LOOP
    IF COALESCE((d->>'required')::boolean,false)
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_given) g
          WHERE g->>'declaration_code' = d->>'declaration_code'
            AND COALESCE((g->>'confirmed')::boolean,false)) THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_DECLARATION:%', d->>'declaration_code';
    END IF;
  END LOOP;

  -- Freeze the submitted version.
  SELECT COALESCE(max(version_no),0) + 1 INTO v_version_no
    FROM public.bn_means_assessment_version WHERE assessment_id = p_assessment_id;

  SELECT jsonb_build_object(
    'assessment', to_jsonb(v_a),
    'policy_version_id', v_a.policy_version_id,
    'household', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at)
                             FROM public.bn_means_household_member h
                            WHERE h.assessment_id = p_assessment_id AND h.voided_at IS NULL),'[]'::jsonb),
    'income',    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
                             FROM public.bn_means_income_fact i
                            WHERE i.assessment_id = p_assessment_id AND i.voided_at IS NULL),'[]'::jsonb),
    'assets',    COALESCE((SELECT jsonb_agg(to_jsonb(a2) ORDER BY a2.created_at)
                             FROM public.bn_means_asset_fact a2
                            WHERE a2.assessment_id = p_assessment_id AND a2.voided_at IS NULL),'[]'::jsonb),
    'deductions',COALESCE((SELECT jsonb_agg(to_jsonb(dd) ORDER BY dd.created_at)
                             FROM public.bn_means_deduction_fact dd
                            WHERE dd.assessment_id = p_assessment_id AND dd.voided_at IS NULL),'[]'::jsonb),
    'evidence_links', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.linked_at)
                             FROM public.bn_means_evidence_link l
                            WHERE l.assessment_id = p_assessment_id AND l.link_status = 'LINKED'),'[]'::jsonb),
    'evidence_requirements', COALESCE(
      public._bn_means_evidence_readiness(p_assessment_id)->'requirements','[]'::jsonb),
    'declarations', v_given
  ) INTO v_snapshot;

  v_hash := encode(digest(v_snapshot::text,'sha256'),'hex');

  INSERT INTO public.bn_means_assessment_version(
    assessment_id, version_no, frozen_reason, snapshot, snapshot_hash, frozen_by, correlation_id)
  VALUES (p_assessment_id, v_version_no, 'SUBMITTED', v_snapshot, v_hash,
          p_actor_user_id, p_correlation_id)
  ON CONFLICT (assessment_id, version_no) DO NOTHING
  RETURNING assessment_version_id INTO v_version;

  IF v_version IS NULL THEN
    SELECT assessment_version_id INTO v_version FROM public.bn_means_assessment_version
     WHERE assessment_id = p_assessment_id AND version_no = v_version_no;
  END IF;

  -- Declarations captured against the frozen version, with their wording.
  FOR d IN SELECT * FROM jsonb_array_elements(v_decls) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_given) g
                WHERE g->>'declaration_code' = d->>'declaration_code'
                  AND COALESCE((g->>'confirmed')::boolean,false)) THEN
      INSERT INTO public.bn_means_submission_declaration(
        assessment_id, assessment_version_id, declaration_code, label, statement_text,
        statement_version, actor_type, required, confirmed, confirmed_by, correlation_id)
      VALUES (p_assessment_id, v_version, d->>'declaration_code', d->>'label',
              d->>'statement_text', d->>'statement_version',
              COALESCE(d->>'actor_type','OFFICER'),
              COALESCE((d->>'required')::boolean,false), true,
              p_actor_user_id, p_correlation_id)
      ON CONFLICT (assessment_version_id, declaration_code) DO NOTHING;
    END IF;
  END LOOP;

  -- Verification work built from the frozen version only.
  INSERT INTO public.bn_means_verification_work(
    assessment_id, assessment_version_id, fact_kind, fact_ref_id, fact_summary,
    evidence_refs, priority, correlation_id, created_by)
  SELECT p_assessment_id, v_version, 'HOUSEHOLD', h.member_id,
         h.relationship_code,
         COALESCE((SELECT jsonb_agg(l.link_id) FROM public.bn_means_evidence_link l
                    WHERE l.assessment_id = p_assessment_id AND l.link_status = 'LINKED'
                      AND l.subject_kind = 'HOUSEHOLD_MEMBER' AND l.subject_ref_id = h.member_id),'[]'::jsonb),
         'NORMAL', p_correlation_id, p_actor_user_id
    FROM public.bn_means_household_member h
   WHERE h.assessment_id = p_assessment_id AND h.voided_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.bn_means_verification_work(
    assessment_id, assessment_version_id, fact_kind, fact_ref_id, fact_summary,
    evidence_refs, priority, correlation_id, created_by)
  SELECT p_assessment_id, v_version, 'INCOME', i.income_fact_id, i.category_code,
         COALESCE((SELECT jsonb_agg(l.link_id) FROM public.bn_means_evidence_link l
                    WHERE l.assessment_id = p_assessment_id AND l.link_status = 'LINKED'
                      AND l.subject_kind = 'INCOME_FACT' AND l.subject_ref_id = i.income_fact_id),'[]'::jsonb),
         'NORMAL', p_correlation_id, p_actor_user_id
    FROM public.bn_means_income_fact i
   WHERE i.assessment_id = p_assessment_id AND i.voided_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.bn_means_verification_work(
    assessment_id, assessment_version_id, fact_kind, fact_ref_id, fact_summary,
    evidence_refs, priority, correlation_id, created_by)
  SELECT p_assessment_id, v_version, 'ASSET', a2.asset_fact_id, a2.category_code,
         COALESCE((SELECT jsonb_agg(l.link_id) FROM public.bn_means_evidence_link l
                    WHERE l.assessment_id = p_assessment_id AND l.link_status = 'LINKED'
                      AND l.subject_kind = 'ASSET_FACT' AND l.subject_ref_id = a2.asset_fact_id),'[]'::jsonb),
         'NORMAL', p_correlation_id, p_actor_user_id
    FROM public.bn_means_asset_fact a2
   WHERE a2.assessment_id = p_assessment_id AND a2.voided_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.bn_means_verification_work(
    assessment_id, assessment_version_id, fact_kind, fact_ref_id, fact_summary,
    evidence_refs, priority, correlation_id, created_by)
  SELECT p_assessment_id, v_version, 'DEDUCTION', dd.deduction_fact_id, dd.category_code,
         COALESCE((SELECT jsonb_agg(l.link_id) FROM public.bn_means_evidence_link l
                    WHERE l.assessment_id = p_assessment_id AND l.link_status = 'LINKED'
                      AND l.subject_kind = 'DEDUCTION_FACT' AND l.subject_ref_id = dd.deduction_fact_id),'[]'::jsonb),
         'NORMAL', p_correlation_id, p_actor_user_id
    FROM public.bn_means_deduction_fact dd
   WHERE dd.assessment_id = p_assessment_id AND dd.voided_at IS NULL
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_work FROM public.bn_means_verification_work
   WHERE assessment_version_id = v_version;

  UPDATE public.bn_means_assessment
     SET status = 'SUBMITTED',
         submitted_at = now(),
         maker_user_id = p_actor_user_id,
         current_version = v_version_no,
         row_version = row_version + 1,
         updated_at = now(),
         updated_by = p_actor_user_id
   WHERE assessment_id = p_assessment_id
   RETURNING * INTO v_a;

  -- Acknowledgement is an intent only. Delivery is owned by the Hub.
  INSERT INTO public.bn_means_communication_intent(
    assessment_id, event_code, recipient_ref, context_data, idempotency_key,
    correlation_id, created_by)
  VALUES (p_assessment_id, 'MEANS_ASSESSMENT_SUBMITTED',
    jsonb_build_object('person_id', v_a.person_id, 'claim_id', v_a.claim_id),
    jsonb_build_object('assessment_reference', v_a.assessment_reference,
                       'benefit_programme', v_a.benefit_programme,
                       'assessment_version_id', v_version),
    'MEANS_SUBMIT:' || p_assessment_id::text || ':' || v_version_no::text,
    p_correlation_id, p_actor_user_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.bn_means_command_maker(assessment_id, maker_role, maker_user_id, correlation_id)
  VALUES (p_assessment_id, 'BN_MEANS_SUBMIT', p_actor_user_id, p_correlation_id)
  ON CONFLICT (assessment_id, maker_role)
    DO UPDATE SET maker_user_id = EXCLUDED.maker_user_id,
                  recorded_at = now(), correlation_id = EXCLUDED.correlation_id;

  v_res := jsonb_build_object(
    'assessment_id', p_assessment_id,
    'entity_version', v_a.row_version,
    'to_status', v_a.status,
    'assessment_version_id', v_version,
    'frozen_version_no', v_version_no,
    'snapshot_hash', v_hash,
    'verification_work_count', v_work,
    'submitted_at', v_a.submitted_at,
    'submitted_by', p_actor_user_id,
    'acknowledgement_status', 'PENDING',
    'event_code', 'SUBMITTED');

  PERFORM public._bn_means_event(p_assessment_id, 'SUBMITTED', p_command_name, v_from,
    v_a.status, p_reason_code, p_justification, v_res, p_actor_user_id, p_actor_user_code,
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

REVOKE ALL ON FUNCTION public.bn_means_submission_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_submission_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_submission_readiness_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_submission_readiness_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_review_summary_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_review_summary_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_submission_readiness(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_submission_readiness(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_declaration_requirements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_declaration_requirements(uuid) TO authenticated, service_role;
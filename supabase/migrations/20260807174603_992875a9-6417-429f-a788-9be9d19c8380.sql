-- =====================================================================
-- MEANS-TEST EPIC 12 — Reassessment and Change of Circumstances
-- =====================================================================

ALTER TABLE public.bn_means_circumstance_event
  ADD COLUMN IF NOT EXISTS category_code       text,
  ADD COLUMN IF NOT EXISTS materiality         text NOT NULL DEFAULT 'UNASSESSED',
  ADD COLUMN IF NOT EXISTS outcome             text NOT NULL DEFAULT 'RECORDED',
  ADD COLUMN IF NOT EXISTS reason_code         text,
  ADD COLUMN IF NOT EXISTS reported_channel    text,
  ADD COLUMN IF NOT EXISTS schedule_id         uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_circumstance_materiality_ck') THEN
    ALTER TABLE public.bn_means_circumstance_event
      ADD CONSTRAINT bn_means_circumstance_materiality_ck
      CHECK (materiality = ANY (ARRAY['MATERIAL','NON_MATERIAL','UNASSESSED']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_circumstance_outcome_ck') THEN
    ALTER TABLE public.bn_means_circumstance_event
      ADD CONSTRAINT bn_means_circumstance_outcome_ck
      CHECK (outcome = ANY (ARRAY['RECORDED','REASSESSMENT_SCHEDULED','SUCCESSOR_CREATED','NO_ACTION']));
  END IF;
END $$;

ALTER TABLE public.bn_means_reassessment_schedule
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS justification   text,
  ADD COLUMN IF NOT EXISTS circumstance_id uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by    uuid,
  ADD COLUMN IF NOT EXISTS completed_by    uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_reassessment_source_ck') THEN
    ALTER TABLE public.bn_means_reassessment_schedule
      ADD CONSTRAINT bn_means_reassessment_source_ck
      CHECK (source = ANY (ARRAY['POLICY','MANUAL','CHANGE_OF_CIRCUMSTANCE','APPEAL']));
  END IF;
END $$;

ALTER TABLE public.bn_means_assessment
  ADD COLUMN IF NOT EXISTS closure_reason_code          text,
  ADD COLUMN IF NOT EXISTS closure_justification        text,
  ADD COLUMN IF NOT EXISTS closed_at                    timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_at                timestamptz,
  ADD COLUMN IF NOT EXISTS carried_forward_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_bn_means_schedule_due
  ON public.bn_means_reassessment_schedule (due_date) WHERE status IN ('SCHEDULED','DUE');
CREATE INDEX IF NOT EXISTS ix_bn_means_circumstance_assessment
  ON public.bn_means_circumstance_event (assessment_id, reported_on DESC);

GRANT SELECT ON public.bn_means_reassessment_schedule TO authenticated;
GRANT SELECT ON public.bn_means_circumstance_event    TO authenticated;
GRANT ALL    ON public.bn_means_reassessment_schedule TO service_role;
GRANT ALL    ON public.bn_means_circumstance_event    TO service_role;

CREATE OR REPLACE FUNCTION public._bn_means_action_for_command(p_command_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_command_name
    WHEN 'BN_MEANS_VERIFY_INFORMATION'             THEN 'verify'
    WHEN 'BN_MEANS_CALCULATE'                      THEN 'decide'
    WHEN 'BN_MEANS_REQUEST_ADJUSTMENT'             THEN 'adjust_request'
    WHEN 'BN_MEANS_APPROVE_ADJUSTMENT'             THEN 'adjust_approve'
    WHEN 'BN_MEANS_APPROVE'                        THEN 'approve'
    WHEN 'BN_MEANS_REJECT'                         THEN 'approve'
    WHEN 'BN_MEANS_ACTIVATE'                       THEN 'approve'
    WHEN 'BN_MEANS_SUPERSEDE'                      THEN 'approve'
    WHEN 'BN_MEANS_CLOSE'                          THEN 'approve'
    WHEN 'BN_MEANS_SCHEDULE_REASSESSMENT'          THEN 'reassess'
    WHEN 'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE'  THEN 'reassess'
    WHEN 'BN_MEANS_CANCEL_REASSESSMENT'            THEN 'reassess'
    WHEN 'BN_MEANS_CREATE_SUCCESSOR'               THEN 'reassess'
    WHEN 'BN_MEANS_CONFIRM_CARRIED_FORWARD'        THEN 'write'
    ELSE 'write'
  END;
$$;

CREATE OR REPLACE FUNCTION public._bn_means_lifecycle_reference()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'change_types', jsonb_build_array(
      jsonb_build_object('code','HOUSEHOLD_COMPOSITION','label','Household composition change','default_materiality','MATERIAL'),
      jsonb_build_object('code','INCOME_CHANGE','label','Income change','default_materiality','MATERIAL'),
      jsonb_build_object('code','ASSET_CHANGE','label','Asset change','default_materiality','MATERIAL'),
      jsonb_build_object('code','DEDUCTION_CHANGE','label','Deduction or liability change','default_materiality','NON_MATERIAL'),
      jsonb_build_object('code','RESIDENCE_CHANGE','label','Residence change','default_materiality','NON_MATERIAL'),
      jsonb_build_object('code','CONTACT_DETAILS','label','Contact detail change','default_materiality','NON_MATERIAL'),
      jsonb_build_object('code','DEATH','label','Death of a household member','default_materiality','MATERIAL'),
      jsonb_build_object('code','OTHER','label','Other reported change','default_materiality','UNASSESSED')),
    'materiality_options', jsonb_build_array(
      jsonb_build_object('code','MATERIAL','label','Material — affects the means outcome'),
      jsonb_build_object('code','NON_MATERIAL','label','Not material — recorded only')),
    'reported_channels', jsonb_build_array(
      jsonb_build_object('code','OFFICE_VISIT','label','Office visit'),
      jsonb_build_object('code','TELEPHONE','label','Telephone'),
      jsonb_build_object('code','WRITTEN','label','Written notification'),
      jsonb_build_object('code','SYSTEM','label','System detected')),
    'reassessment_reasons', jsonb_build_array(
      jsonb_build_object('code','POLICY_CYCLE','label','Scheduled policy review cycle'),
      jsonb_build_object('code','CHANGE_OF_CIRCUMSTANCE','label','Reported change of circumstance'),
      jsonb_build_object('code','VALIDITY_EXPIRY','label','Validity period ending'),
      jsonb_build_object('code','APPEAL_OUTCOME','label','Appeal outcome'),
      jsonb_build_object('code','MANUAL_REVIEW','label','Officer directed review')),
    'closure_reasons', jsonb_build_array(
      jsonb_build_object('code','BENEFIT_ENDED','label','Benefit ended'),
      jsonb_build_object('code','CLAIMANT_DECEASED','label','Claimant deceased'),
      jsonb_build_object('code','NO_LONGER_REQUIRED','label','Means test no longer required'),
      jsonb_build_object('code','SUPERSEDED_BY_SUCCESSOR','label','Replaced by a successor assessment'),
      jsonb_build_object('code','ADMINISTRATIVE','label','Administrative closure')),
    'carry_forward_sections', jsonb_build_array(
      jsonb_build_object('code','HOUSEHOLD','label','Household'),
      jsonb_build_object('code','INCOME','label','Income'),
      jsonb_build_object('code','ASSETS','label','Assets'),
      jsonb_build_object('code','DEDUCTIONS','label','Deductions'))
  );
$$;

CREATE OR REPLACE FUNCTION public._bn_means_create_successor(
  p_predecessor    uuid,
  p_reason         text,
  p_effective_from date,
  p_actor          uuid,
  p_actor_code     text,
  p_correlation    uuid
) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_p     public.bn_means_assessment;
  v_pol   jsonb;
  v_new   uuid;
  v_from  date;
BEGIN
  SELECT * INTO v_p FROM public.bn_means_assessment WHERE assessment_id = p_predecessor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_NOT_FOUND:%', p_predecessor;
  END IF;
  IF v_p.superseded_by_assessment_id IS NOT NULL THEN
    RAISE EXCEPTION 'E_SUCCESSOR_EXISTS:%', v_p.superseded_by_assessment_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_means_assessment s
              WHERE s.supersedes_assessment_id = p_predecessor
                AND s.status NOT IN ('CANCELLED','REJECTED','CLOSED')) THEN
    RAISE EXCEPTION 'E_SUCCESSOR_EXISTS:%', p_predecessor;
  END IF;

  v_from := COALESCE(p_effective_from, GREATEST(CURRENT_DATE, COALESCE(v_p.effective_from, CURRENT_DATE)));
  IF v_from < v_p.effective_from THEN
    RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATES:successor cannot precede %', v_p.effective_from;
  END IF;

  v_pol := public._bn_means_resolve_policy(v_p.benefit_programme, v_from);
  IF COALESCE(v_pol->>'state','') <> 'RESOLVED' THEN
    RAISE EXCEPTION 'E_POLICY_NOT_EFFECTIVE:%', COALESCE(v_pol->>'reason_code','NO_EFFECTIVE_POLICY');
  END IF;

  INSERT INTO public.bn_means_assessment(
    person_id, declared_person, claim_id, award_id, benefit_programme,
    assessment_reason, effective_from, policy_version_id, currency_code,
    status, assigned_to, supersedes_assessment_id, correlation_id,
    source_entry_point, created_by, updated_by)
  VALUES (
    v_p.person_id, v_p.declared_person, v_p.claim_id, v_p.award_id, v_p.benefit_programme,
    COALESCE(p_reason,'REASSESSMENT'), v_from,
    (v_pol->>'policy_version_id')::uuid, v_pol->>'currency_code',
    'DRAFT', v_p.assigned_to, p_predecessor, p_correlation,
    v_p.source_entry_point, p_actor, p_actor)
  RETURNING assessment_id INTO v_new;

  INSERT INTO public.bn_means_household_member(
    assessment_id, person_id, declared_person, relationship_code, member_from, member_to,
    is_dependant, dependency_basis, shares_residence, fact_source, member_notes, is_self, created_by)
  SELECT v_new, m.person_id, m.declared_person, m.relationship_code, m.member_from, m.member_to,
         m.is_dependant, m.dependency_basis, m.shares_residence, 'CARRIED_FORWARD', m.member_notes,
         COALESCE(m.is_self,false), p_actor
    FROM public.bn_means_household_member m
   WHERE m.assessment_id = p_predecessor AND m.voided_at IS NULL;

  INSERT INTO public.bn_means_income_fact(
    assessment_id, category_code, income_source, basis, declared_amount, declared_frequency,
    currency_code, normalised_annual_amount, effective_from, effective_to, fact_source,
    source_name, employer_regno, income_notes, annualisation_method, created_by)
  SELECT v_new, f.category_code, f.income_source, f.basis, f.declared_amount, f.declared_frequency,
         f.currency_code, f.normalised_annual_amount, GREATEST(f.effective_from, v_from), f.effective_to,
         'CARRIED_FORWARD', f.source_name, f.employer_regno, f.income_notes, f.annualisation_method, p_actor
    FROM public.bn_means_income_fact f
   WHERE f.assessment_id = p_predecessor AND f.voided_at IS NULL
     AND f.currency_code = (v_pol->>'currency_code')
     AND (f.effective_to IS NULL OR f.effective_to >= GREATEST(f.effective_from, v_from));

  INSERT INTO public.bn_means_asset_fact(
    assessment_id, category_code, description, ownership_share, valuation_amount, currency_code,
    valuation_date, valuation_source, fact_source, ownership_type, asset_details, valuation_basis,
    effective_from, asset_notes, created_by)
  SELECT v_new, a.category_code, a.description, a.ownership_share, a.valuation_amount, a.currency_code,
         a.valuation_date, a.valuation_source, 'CARRIED_FORWARD', a.ownership_type, a.asset_details,
         a.valuation_basis, GREATEST(COALESCE(a.effective_from, v_from), v_from), a.asset_notes, p_actor
    FROM public.bn_means_asset_fact a
   WHERE a.assessment_id = p_predecessor AND a.voided_at IS NULL
     AND a.currency_code = (v_pol->>'currency_code');

  INSERT INTO public.bn_means_deduction_fact(
    assessment_id, category_code, claimed_amount, declared_frequency, normalised_annual_amount,
    currency_code, claim_basis, effective_from, effective_to, fact_source, claim_kind, target_kind,
    claim_reason_code, evidence_requirement, officer_notes, created_by)
  SELECT v_new, d.category_code, d.claimed_amount, d.declared_frequency, d.normalised_annual_amount,
         d.currency_code, d.claim_basis, GREATEST(d.effective_from, v_from), d.effective_to,
         'CARRIED_FORWARD', d.claim_kind, 'ASSESSMENT', d.claim_reason_code, d.evidence_requirement,
         d.officer_notes, p_actor
    FROM public.bn_means_deduction_fact d
   WHERE d.assessment_id = p_predecessor AND d.voided_at IS NULL
     AND d.currency_code = (v_pol->>'currency_code')
     AND (d.effective_to IS NULL OR d.effective_to >= GREATEST(d.effective_from, v_from));

  PERFORM public._bn_means_event(v_new,'CREATED','BN_MEANS_CREATE_SUCCESSOR',NULL,'DRAFT',
    COALESCE(p_reason,'REASSESSMENT'),'Successor created with carried-forward prefill',
    jsonb_build_object('predecessor_assessment_id', p_predecessor,
                       'policy_version_id', v_pol->>'policy_version_id'),
    p_actor, p_actor_code, p_correlation, 1);

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public._bn_means_lifecycle_readiness(
  p_assessment_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_a          public.bn_means_assessment;
  v_cmd        text;
  v_actions    jsonb := '[]'::jsonb;
  v_allowed    boolean;
  v_reason     text;
  v_perm       jsonb;
  v_succ       public.bn_means_assessment;
  v_pending    int;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  SELECT * INTO v_succ FROM public.bn_means_assessment
   WHERE supersedes_assessment_id = p_assessment_id
     AND status NOT IN ('CANCELLED','REJECTED')
   ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) INTO v_pending
    FROM (
      SELECT 1 FROM public.bn_means_household_member WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD'
      UNION ALL SELECT 1 FROM public.bn_means_income_fact    WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD'
      UNION ALL SELECT 1 FROM public.bn_means_asset_fact     WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD'
      UNION ALL SELECT 1 FROM public.bn_means_deduction_fact WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD'
    ) q;

  FOREACH v_cmd IN ARRAY ARRAY[
    'BN_MEANS_SCHEDULE_REASSESSMENT','BN_MEANS_CANCEL_REASSESSMENT',
    'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE','BN_MEANS_CREATE_SUCCESSOR',
    'BN_MEANS_CONFIRM_CARRIED_FORWARD','BN_MEANS_SUPERSEDE','BN_MEANS_CLOSE']
  LOOP
    v_allowed := true; v_reason := NULL;

    v_perm := public.bn_means_check_actor_permission(
      p_actor_user_id, public._bn_means_action_for_command(v_cmd), true);
    IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
      v_allowed := false;
      v_reason  := CASE v_perm->>'code' WHEN 'ACTIONS_DISABLED' THEN 'ACTIONS_DISABLED' ELSE 'PERMISSION_DENIED' END;
    END IF;

    IF v_allowed THEN
      IF v_cmd IN ('BN_MEANS_SCHEDULE_REASSESSMENT','BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE','BN_MEANS_CREATE_SUCCESSOR')
         AND v_a.status NOT IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      ELSIF v_cmd = 'BN_MEANS_CANCEL_REASSESSMENT'
            AND NOT EXISTS (SELECT 1 FROM public.bn_means_reassessment_schedule s
                             WHERE s.assessment_id = p_assessment_id AND s.status IN ('SCHEDULED','DUE')) THEN
        v_allowed := false; v_reason := 'NO_OPEN_SCHEDULE';
      ELSIF v_cmd = 'BN_MEANS_CREATE_SUCCESSOR' AND v_succ.assessment_id IS NOT NULL THEN
        v_allowed := false; v_reason := 'SUCCESSOR_EXISTS';
      ELSIF v_cmd = 'BN_MEANS_CONFIRM_CARRIED_FORWARD' THEN
        IF v_a.supersedes_assessment_id IS NULL THEN
          v_allowed := false; v_reason := 'NOT_A_SUCCESSOR';
        ELSIF NOT public._bn_means_is_editable(v_a.status) THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSIF v_pending = 0 THEN
          v_allowed := false; v_reason := 'NOTHING_TO_CONFIRM';
        END IF;
      ELSIF v_cmd = 'BN_MEANS_SUPERSEDE' THEN
        IF v_a.status NOT IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED') THEN
          v_allowed := false; v_reason := 'INVALID_STATE';
        ELSIF v_succ.assessment_id IS NULL THEN
          v_allowed := false; v_reason := 'SUCCESSOR_REQUIRED';
        ELSIF v_succ.status <> 'ACTIVE' THEN
          v_allowed := false; v_reason := 'SUCCESSOR_NOT_ACTIVE';
        END IF;
      ELSIF v_cmd = 'BN_MEANS_CLOSE' AND v_a.status IN ('CLOSED','CANCELLED') THEN
        v_allowed := false; v_reason := 'INVALID_STATE';
      END IF;
    END IF;

    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'command', v_cmd, 'allowed', v_allowed, 'reason', v_reason,
      'row_version', v_a.row_version));
  END LOOP;

  RETURN v_actions;
END;
$$;

CREATE OR REPLACE FUNCTION public._bn_means_lifecycle_execute(
  p_command_name        text,
  p_assessment_id       uuid,
  p_payload             jsonb,
  p_expected_row_version bigint,
  p_reason_code         text,
  p_justification       text,
  p_actor_user_id       uuid,
  p_actor_user_code     text,
  p_correlation_id      uuid,
  p_idempotency_key     uuid,
  p_payload_hash        text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_prior   public.bn_means_command_idempotency;
  v_perm    jsonb;
  v_a       public.bn_means_assessment;
  v_succ    public.bn_means_assessment;
  v_result  jsonb := '{}'::jsonb;
  v_to      text;
  v_due     date;
  v_sched   uuid;
  v_circ    uuid;
  v_new     uuid;
  v_mat     text;
  v_section text;
  v_count   int := 0;
  v_n       int;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name;
  END IF;
  IF p_command_name NOT IN ('BN_MEANS_SCHEDULE_REASSESSMENT','BN_MEANS_CANCEL_REASSESSMENT',
                            'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE','BN_MEANS_CREATE_SUCCESSOR',
                            'BN_MEANS_CONFIRM_CARRIED_FORWARD','BN_MEANS_SUPERSEDE','BN_MEANS_CLOSE') THEN
    RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
  END IF;

  v_perm := public.bn_means_check_actor_permission(
    p_actor_user_id, public._bn_means_action_for_command(p_command_name), true);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'E_%:%', v_perm->>'code', p_command_name;
  END IF;

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

  IF p_assessment_id IS NULL THEN
    RAISE EXCEPTION 'E_ENTITY_REQUIRED:%', p_command_name;
  END IF;
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:%', p_assessment_id; END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_a.row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION:expected=% actual=%', p_expected_row_version, v_a.row_version;
  END IF;

  SELECT * INTO v_succ FROM public.bn_means_assessment
   WHERE supersedes_assessment_id = p_assessment_id AND status NOT IN ('CANCELLED','REJECTED')
   ORDER BY created_at DESC LIMIT 1;

  IF p_command_name = 'BN_MEANS_SCHEDULE_REASSESSMENT' THEN
    IF v_a.status NOT IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot be scheduled for reassessment', v_a.status;
    END IF;
    IF COALESCE(p_payload->>'due_date','') = '' OR COALESCE(p_payload->>'reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:due date and reason are required';
    END IF;
    v_due := (p_payload->>'due_date')::date;
    IF v_due < v_a.effective_from THEN
      RAISE EXCEPTION 'E_INVALID_EFFECTIVE_DATES:due date precedes the assessment period';
    END IF;

    UPDATE public.bn_means_reassessment_schedule
       SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id AND status IN ('SCHEDULED','DUE');

    INSERT INTO public.bn_means_reassessment_schedule(
      assessment_id, due_date, reason_code, status, source, justification, created_by)
    VALUES (p_assessment_id, v_due, p_payload->>'reason_code',
            CASE WHEN v_due <= CURRENT_DATE THEN 'DUE' ELSE 'SCHEDULED' END,
            COALESCE(p_payload->>'source','MANUAL'), p_justification, p_actor_user_id)
    RETURNING schedule_id INTO v_sched;

    v_to := CASE WHEN v_due <= CURRENT_DATE AND v_a.status = 'ACTIVE' THEN 'REASSESSMENT_DUE' ELSE v_a.status END;
    UPDATE public.bn_means_assessment
       SET reassessment_due = v_due, status = v_to,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_means_event(p_assessment_id,
      CASE WHEN v_to = 'REASSESSMENT_DUE' AND v_a.status <> v_to THEN 'REASSESSMENT_DUE' ELSE 'REASSESSMENT_SCHEDULED' END,
      p_command_name, v_a.status, v_to, p_reason_code, p_justification,
      jsonb_build_object('schedule_id', v_sched, 'due_date', v_due, 'reason_code', p_payload->>'reason_code'),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('schedule_id', v_sched, 'due_date', v_due, 'to_status', v_to);

  ELSIF p_command_name = 'BN_MEANS_CANCEL_REASSESSMENT' THEN
    IF COALESCE(p_justification,'') = '' THEN
      RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED:%', p_command_name;
    END IF;
    UPDATE public.bn_means_reassessment_schedule
       SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id AND status IN ('SCHEDULED','DUE');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'E_NO_OPEN_SCHEDULE:%', p_assessment_id;
    END IF;

    v_to := CASE WHEN v_a.status = 'REASSESSMENT_DUE' THEN 'ACTIVE' ELSE v_a.status END;
    UPDATE public.bn_means_assessment
       SET reassessment_due = NULL, status = v_to,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_means_event(p_assessment_id,'REASSESSMENT_SCHEDULED',p_command_name,
      v_a.status, v_to, p_reason_code, p_justification,
      jsonb_build_object('cancelled_schedules', v_count),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('cancelled_schedules', v_count, 'to_status', v_to);

  ELSIF p_command_name = 'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE' THEN
    IF v_a.status NOT IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot record a change of circumstance', v_a.status;
    END IF;
    IF COALESCE(p_payload->>'change_type','') = '' OR COALESCE(p_payload->>'effective_date','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:change type and effective date are required';
    END IF;
    IF COALESCE(p_justification,'') = '' THEN
      RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED:%', p_command_name;
    END IF;
    v_mat := COALESCE(p_payload->>'materiality','UNASSESSED');
    IF v_mat NOT IN ('MATERIAL','NON_MATERIAL','UNASSESSED') THEN
      RAISE EXCEPTION 'E_INVALID_MATERIALITY:%', v_mat;
    END IF;

    INSERT INTO public.bn_means_circumstance_event(
      assessment_id, change_type, category_code, reported_on, effective_date, details,
      justification, materiality, outcome, reason_code, reported_channel, created_by, correlation_id)
    VALUES (p_assessment_id, p_payload->>'change_type', NULLIF(p_payload->>'category_code',''),
            COALESCE(NULLIF(p_payload->>'reported_on','')::date, CURRENT_DATE),
            (p_payload->>'effective_date')::date,
            COALESCE(p_payload->'details','{}'::jsonb), p_justification, v_mat,
            CASE WHEN v_mat = 'MATERIAL' THEN 'REASSESSMENT_SCHEDULED' ELSE 'RECORDED' END,
            p_reason_code, NULLIF(p_payload->>'reported_channel',''), p_actor_user_id, p_correlation_id)
    RETURNING circumstance_id INTO v_circ;

    v_to := v_a.status;
    IF v_mat = 'MATERIAL' THEN
      v_due := GREATEST(LEAST((p_payload->>'effective_date')::date, CURRENT_DATE), v_a.effective_from);
      UPDATE public.bn_means_reassessment_schedule
         SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_actor_user_id
       WHERE assessment_id = p_assessment_id AND status IN ('SCHEDULED','DUE');
      INSERT INTO public.bn_means_reassessment_schedule(
        assessment_id, due_date, reason_code, status, source, justification, circumstance_id, created_by)
      VALUES (p_assessment_id, v_due, 'CHANGE_OF_CIRCUMSTANCE', 'DUE',
              'CHANGE_OF_CIRCUMSTANCE', p_justification, v_circ, p_actor_user_id)
      RETURNING schedule_id INTO v_sched;
      UPDATE public.bn_means_circumstance_event SET schedule_id = v_sched WHERE circumstance_id = v_circ;
      v_to := CASE WHEN v_a.status = 'ACTIVE' THEN 'REASSESSMENT_DUE' ELSE v_a.status END;
    END IF;

    UPDATE public.bn_means_assessment
       SET status = v_to,
           reassessment_due = CASE WHEN v_mat = 'MATERIAL' THEN v_due ELSE reassessment_due END,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_means_event(p_assessment_id,'CHANGE_OF_CIRCUMSTANCE_RECORDED',p_command_name,
      v_a.status, v_to, p_reason_code, p_justification,
      jsonb_build_object('circumstance_id', v_circ, 'materiality', v_mat,
                         'change_type', p_payload->>'change_type', 'schedule_id', v_sched),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('circumstance_id', v_circ, 'materiality', v_mat,
                                   'schedule_id', v_sched, 'to_status', v_to);

  ELSIF p_command_name = 'BN_MEANS_CREATE_SUCCESSOR' THEN
    IF v_a.status NOT IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot produce a successor', v_a.status;
    END IF;
    IF v_succ.assessment_id IS NOT NULL THEN
      RAISE EXCEPTION 'E_SUCCESSOR_EXISTS:%', v_succ.assessment_id;
    END IF;

    v_new := public._bn_means_create_successor(
      p_assessment_id,
      COALESCE(p_payload->>'assessment_reason','REASSESSMENT'),
      NULLIF(p_payload->>'effective_from','')::date,
      p_actor_user_id, p_actor_user_code, p_correlation_id);

    UPDATE public.bn_means_reassessment_schedule
       SET successor_assessment_id = v_new
     WHERE assessment_id = p_assessment_id AND status IN ('SCHEDULED','DUE');
    UPDATE public.bn_means_circumstance_event
       SET successor_assessment_id = v_new, outcome = 'SUCCESSOR_CREATED'
     WHERE assessment_id = p_assessment_id AND successor_assessment_id IS NULL
       AND materiality = 'MATERIAL';

    UPDATE public.bn_means_assessment
       SET row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_means_event(p_assessment_id,'REASSESSMENT_SCHEDULED',p_command_name,
      v_a.status, v_a.status, p_reason_code, p_justification,
      jsonb_build_object('successor_assessment_id', v_new),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('successor_assessment_id', v_new, 'to_status', v_a.status);

  ELSIF p_command_name = 'BN_MEANS_CONFIRM_CARRIED_FORWARD' THEN
    IF v_a.supersedes_assessment_id IS NULL THEN
      RAISE EXCEPTION 'E_NOT_A_SUCCESSOR:%', p_assessment_id;
    END IF;
    IF NOT public._bn_means_is_editable(v_a.status) THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not editable', v_a.status;
    END IF;
    v_section := COALESCE(p_payload->>'section_code','ALL');
    IF v_section NOT IN ('ALL','HOUSEHOLD','INCOME','ASSETS','DEDUCTIONS') THEN
      RAISE EXCEPTION 'E_INVALID_SECTION:%', v_section;
    END IF;

    IF v_section IN ('ALL','HOUSEHOLD') THEN
      UPDATE public.bn_means_household_member
         SET fact_source = 'CARRIED_FORWARD_CONFIRMED', updated_at = now(), updated_by = p_actor_user_id
       WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
    END IF;
    IF v_section IN ('ALL','INCOME') THEN
      UPDATE public.bn_means_income_fact
         SET fact_source = 'CARRIED_FORWARD_CONFIRMED', updated_at = now(), updated_by = p_actor_user_id
       WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
    END IF;
    IF v_section IN ('ALL','ASSETS') THEN
      UPDATE public.bn_means_asset_fact
         SET fact_source = 'CARRIED_FORWARD_CONFIRMED', updated_at = now(), updated_by = p_actor_user_id
       WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
    END IF;
    IF v_section IN ('ALL','DEDUCTIONS') THEN
      UPDATE public.bn_means_deduction_fact
         SET fact_source = 'CARRIED_FORWARD_CONFIRMED', updated_at = now(), updated_by = p_actor_user_id
       WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
    END IF;

    IF v_count = 0 THEN
      RAISE EXCEPTION 'E_NOTHING_TO_CONFIRM:%', v_section;
    END IF;

    UPDATE public.bn_means_assessment
       SET carried_forward_confirmed_at =
             CASE WHEN NOT EXISTS (
               SELECT 1 FROM public.bn_means_household_member WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD'
               UNION ALL SELECT 1 FROM public.bn_means_income_fact    WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD'
               UNION ALL SELECT 1 FROM public.bn_means_asset_fact     WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD'
               UNION ALL SELECT 1 FROM public.bn_means_deduction_fact WHERE assessment_id = p_assessment_id AND voided_at IS NULL AND fact_source = 'CARRIED_FORWARD')
                  THEN now() ELSE carried_forward_confirmed_at END,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_means_event(p_assessment_id,'CHANGE_OF_CIRCUMSTANCE_RECORDED',p_command_name,
      v_a.status, v_a.status, p_reason_code, p_justification,
      jsonb_build_object('section_code', v_section, 'confirmed_items', v_count),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('section_code', v_section, 'confirmed_items', v_count);

  ELSIF p_command_name = 'BN_MEANS_SUPERSEDE' THEN
    IF NOT public._bn_means_can_transition(v_a.status, 'SUPERSEDED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% -> SUPERSEDED', v_a.status;
    END IF;
    IF v_succ.assessment_id IS NULL THEN
      RAISE EXCEPTION 'E_SUCCESSOR_REQUIRED:%', p_assessment_id;
    END IF;
    IF v_succ.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'E_SUCCESSOR_NOT_ACTIVE:%', v_succ.status;
    END IF;
    IF COALESCE(p_justification,'') = '' THEN
      RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED:%', p_command_name;
    END IF;

    UPDATE public.bn_means_assessment
       SET status = 'SUPERSEDED',
           superseded_by_assessment_id = v_succ.assessment_id,
           superseded_at = now(),
           valid_until = LEAST(COALESCE(valid_until, COALESCE(v_succ.valid_from, v_succ.effective_from) - 1),
                               COALESCE(v_succ.valid_from, v_succ.effective_from) - 1),
           reassessment_due = NULL,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id;

    UPDATE public.bn_means_reassessment_schedule
       SET status = 'COMPLETED', completed_at = now(), completed_by = p_actor_user_id,
           successor_assessment_id = COALESCE(successor_assessment_id, v_succ.assessment_id)
     WHERE assessment_id = p_assessment_id AND status IN ('SCHEDULED','DUE');

    UPDATE public.bn_means_fact_publication
       SET status = 'SUPERSEDED'
     WHERE assessment_id = p_assessment_id AND status = 'PUBLISHED';

    PERFORM public._bn_means_event(p_assessment_id,'SUPERSEDED',p_command_name,
      v_a.status,'SUPERSEDED', p_reason_code, p_justification,
      jsonb_build_object('successor_assessment_id', v_succ.assessment_id),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('successor_assessment_id', v_succ.assessment_id, 'to_status','SUPERSEDED');

  ELSE
    IF v_a.status IN ('CLOSED','CANCELLED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is already terminal', v_a.status;
    END IF;
    IF COALESCE(p_payload->>'closure_reason_code','') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:closure reason is required';
    END IF;
    IF COALESCE(p_justification,'') = '' THEN
      RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED:%', p_command_name;
    END IF;

    UPDATE public.bn_means_assessment
       SET status = 'CLOSED',
           closure_reason_code = p_payload->>'closure_reason_code',
           closure_justification = p_justification,
           closed_at = now(), reassessment_due = NULL,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id;

    UPDATE public.bn_means_reassessment_schedule
       SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_actor_user_id
     WHERE assessment_id = p_assessment_id AND status IN ('SCHEDULED','DUE');

    UPDATE public.bn_means_fact_publication
       SET status = 'SUPERSEDED'
     WHERE assessment_id = p_assessment_id AND status = 'PUBLISHED';

    PERFORM public._bn_means_event(p_assessment_id,'CLOSED',p_command_name,
      v_a.status,'CLOSED', COALESCE(p_reason_code, p_payload->>'closure_reason_code'), p_justification,
      jsonb_build_object('closure_reason_code', p_payload->>'closure_reason_code'),
      p_actor_user_id, p_actor_user_code, p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('closure_reason_code', p_payload->>'closure_reason_code','to_status','CLOSED');
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  v_result := v_result || jsonb_build_object(
    'assessment_id', p_assessment_id,
    'entity_version', v_a.row_version,
    'status','EXECUTED');

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_means_command_idempotency(
      idempotency_key, command_name, payload_hash, assessment_id, entity_version,
      result_json, status, actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), p_assessment_id,
            v_a.row_version, v_result, 'COMPLETED', p_actor_user_id, now())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_means_lifecycle_command_v1(
  p_command_name         text,
  p_assessment_id        uuid DEFAULT NULL,
  p_payload              jsonb DEFAULT '{}'::jsonb,
  p_expected_row_version bigint DEFAULT NULL,
  p_reason_code          text DEFAULT NULL,
  p_justification        text DEFAULT NULL,
  p_actor_user_id        uuid DEFAULT NULL,
  p_actor_user_code      text DEFAULT NULL,
  p_correlation_id       uuid DEFAULT NULL,
  p_idempotency_key      uuid DEFAULT NULL,
  p_payload_hash         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._bn_means_lifecycle_execute(
    p_command_name, p_assessment_id, COALESCE(p_payload,'{}'::jsonb), p_expected_row_version,
    p_reason_code, p_justification, COALESCE(p_actor_user_id, auth.uid()),
    p_actor_user_code, COALESCE(p_correlation_id, gen_random_uuid()),
    p_idempotency_key, p_payload_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_means_lifecycle_context_v1(
  p_actor_user_id uuid,
  p_assessment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_perm jsonb;
  v_a    public.bn_means_assessment;
  v_pred public.bn_means_assessment;
  v_succ public.bn_means_assessment;
  v_data jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  SELECT * INTO v_pred FROM public.bn_means_assessment WHERE assessment_id = v_a.supersedes_assessment_id;
  SELECT * INTO v_succ FROM public.bn_means_assessment
   WHERE supersedes_assessment_id = p_assessment_id AND status NOT IN ('CANCELLED','REJECTED')
   ORDER BY created_at DESC LIMIT 1;

  v_data := jsonb_build_object(
    'assessment_id', v_a.assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'status', v_a.status,
    'result', v_a.result,
    'row_version', v_a.row_version,
    'benefit_programme', v_a.benefit_programme,
    'assessment_reason', v_a.assessment_reason,
    'validity', jsonb_build_object(
      'effective_from', v_a.effective_from,
      'effective_to', v_a.effective_to,
      'valid_from', v_a.valid_from,
      'valid_until', v_a.valid_until,
      'activated_at', v_a.activated_at,
      'reassessment_due', v_a.reassessment_due,
      'days_to_expiry', CASE WHEN v_a.valid_until IS NULL THEN NULL ELSE (v_a.valid_until - CURRENT_DATE) END,
      'days_to_reassessment', CASE WHEN v_a.reassessment_due IS NULL THEN NULL ELSE (v_a.reassessment_due - CURRENT_DATE) END,
      'is_expired', (v_a.valid_until IS NOT NULL AND v_a.valid_until < CURRENT_DATE)),
    'closure', jsonb_build_object(
      'closure_reason_code', v_a.closure_reason_code,
      'closure_justification', v_a.closure_justification,
      'closed_at', v_a.closed_at,
      'superseded_at', v_a.superseded_at),
    'predecessor', CASE WHEN v_pred.assessment_id IS NULL THEN NULL ELSE jsonb_build_object(
      'assessment_id', v_pred.assessment_id, 'assessment_reference', v_pred.assessment_reference,
      'status', v_pred.status, 'effective_from', v_pred.effective_from, 'valid_until', v_pred.valid_until) END,
    'successor', CASE WHEN v_succ.assessment_id IS NULL THEN NULL ELSE jsonb_build_object(
      'assessment_id', v_succ.assessment_id, 'assessment_reference', v_succ.assessment_reference,
      'status', v_succ.status, 'effective_from', v_succ.effective_from,
      'carried_forward_confirmed_at', v_succ.carried_forward_confirmed_at) END,
    'carried_forward', jsonb_build_object(
      'is_successor', (v_a.supersedes_assessment_id IS NOT NULL),
      'confirmed_at', v_a.carried_forward_confirmed_at,
      'sections', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'section_code', s.section_code, 'pending', s.pending, 'confirmed', s.confirmed)
                 ORDER BY s.section_code), '[]'::jsonb)
        FROM (
          SELECT 'HOUSEHOLD' AS section_code,
                 count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD') AS pending,
                 count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD_CONFIRMED') AS confirmed
            FROM public.bn_means_household_member WHERE assessment_id = p_assessment_id AND voided_at IS NULL
          UNION ALL
          SELECT 'INCOME', count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD'),
                 count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD_CONFIRMED')
            FROM public.bn_means_income_fact WHERE assessment_id = p_assessment_id AND voided_at IS NULL
          UNION ALL
          SELECT 'ASSETS', count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD'),
                 count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD_CONFIRMED')
            FROM public.bn_means_asset_fact WHERE assessment_id = p_assessment_id AND voided_at IS NULL
          UNION ALL
          SELECT 'DEDUCTIONS', count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD'),
                 count(*) FILTER (WHERE fact_source = 'CARRIED_FORWARD_CONFIRMED')
            FROM public.bn_means_deduction_fact WHERE assessment_id = p_assessment_id AND voided_at IS NULL
        ) s)),
    'schedules', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schedule_id', s.schedule_id, 'due_date', s.due_date, 'reason_code', s.reason_code,
               'status', s.status, 'source', s.source, 'justification', s.justification,
               'successor_assessment_id', s.successor_assessment_id,
               'circumstance_id', s.circumstance_id,
               'completed_at', s.completed_at, 'cancelled_at', s.cancelled_at,
               'created_at', s.created_at) ORDER BY s.created_at DESC), '[]'::jsonb)
        FROM public.bn_means_reassessment_schedule s WHERE s.assessment_id = p_assessment_id),
    'circumstances', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'circumstance_id', c.circumstance_id, 'change_type', c.change_type,
               'category_code', c.category_code, 'reported_on', c.reported_on,
               'effective_date', c.effective_date, 'materiality', c.materiality,
               'outcome', c.outcome, 'reported_channel', c.reported_channel,
               'justification', c.justification, 'details', c.details,
               'successor_assessment_id', c.successor_assessment_id,
               'schedule_id', c.schedule_id, 'created_at', c.created_at)
               ORDER BY c.reported_on DESC, c.created_at DESC), '[]'::jsonb)
        FROM public.bn_means_circumstance_event c WHERE c.assessment_id = p_assessment_id),
    'history', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'event_id', e.event_id, 'event_code', e.event_code, 'command_name', e.command_name,
               'from_status', e.from_status, 'to_status', e.to_status, 'reason_code', e.reason_code,
               'justification', e.justification, 'created_at', e.created_at)
               ORDER BY e.created_at DESC), '[]'::jsonb)
        FROM public.bn_means_event e
       WHERE e.assessment_id = p_assessment_id
         AND e.event_code IN ('REASSESSMENT_SCHEDULED','REASSESSMENT_DUE',
                              'CHANGE_OF_CIRCUMSTANCE_RECORDED','SUPERSEDED','EXPIRED','CLOSED')),
    'reference', public._bn_means_lifecycle_reference(),
    'available_actions', public._bn_means_lifecycle_readiness(p_assessment_id, p_actor_user_id));

  RETURN jsonb_build_object('status','OK','code', NULL,'data', v_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.bn_means_reassessment_queue_v1(
  p_actor_user_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_perm  jsonb;
  v_rows  jsonb;
  v_total int;
  v_bucket text := COALESCE(NULLIF(p_filters->>'bucket',''),'ALL');
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  WITH base AS (
    SELECT a.*,
           (SELECT count(*) FROM public.bn_means_circumstance_event c
             WHERE c.assessment_id = a.assessment_id AND c.outcome <> 'NO_ACTION'
               AND c.successor_assessment_id IS NULL AND c.materiality = 'MATERIAL') AS open_material_changes,
           (SELECT count(*) FROM public.bn_means_reassessment_schedule s
             WHERE s.assessment_id = a.assessment_id AND s.status IN ('SCHEDULED','DUE')) AS open_schedules,
           (SELECT s2.assessment_id FROM public.bn_means_assessment s2
             WHERE s2.supersedes_assessment_id = a.assessment_id
               AND s2.status NOT IN ('CANCELLED','REJECTED')
             ORDER BY s2.created_at DESC LIMIT 1) AS successor_id
      FROM public.bn_means_assessment a
     WHERE a.status IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED')
  ), filtered AS (
    SELECT b.*,
           CASE
             WHEN b.status = 'EXPIRED' OR (b.valid_until IS NOT NULL AND b.valid_until < CURRENT_DATE) THEN 'EXPIRED'
             WHEN b.reassessment_due IS NOT NULL AND b.reassessment_due <= CURRENT_DATE THEN 'OVERDUE'
             WHEN b.reassessment_due IS NOT NULL AND b.reassessment_due <= CURRENT_DATE + 30 THEN 'DUE_SOON'
             WHEN b.open_material_changes > 0 THEN 'CHANGE_REPORTED'
             ELSE 'SCHEDULED' END AS bucket
      FROM base b
  ), scoped AS (
    SELECT * FROM filtered f
     WHERE (v_bucket = 'ALL' OR f.bucket = v_bucket)
       AND (COALESCE(p_filters->>'benefit_programme','') = '' OR f.benefit_programme = p_filters->>'benefit_programme')
       AND (COALESCE(p_filters->>'assigned_to','') = '' OR f.assigned_to = (p_filters->>'assigned_to')::uuid)
       AND (COALESCE(p_filters->>'due_before','') = '' OR f.reassessment_due <= (p_filters->>'due_before')::date)
       AND (COALESCE(p_filters->>'search','') = '' OR f.assessment_reference ILIKE '%' || (p_filters->>'search') || '%')
  ), page AS (
    SELECT * FROM scoped
     ORDER BY COALESCE(reassessment_due, valid_until, DATE '9999-12-31'), assessment_reference
     LIMIT GREATEST(COALESCE(p_limit,50),1) OFFSET GREATEST(COALESCE(p_offset,0),0)
  )
  SELECT (SELECT count(*) FROM scoped),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'assessment_id', p.assessment_id,
                     'assessment_reference', p.assessment_reference,
                     'person_id', p.person_id,
                     'benefit_programme', p.benefit_programme,
                     'status', p.status,
                     'bucket', p.bucket,
                     'valid_until', p.valid_until,
                     'reassessment_due', p.reassessment_due,
                     'days_to_reassessment', CASE WHEN p.reassessment_due IS NULL THEN NULL ELSE (p.reassessment_due - CURRENT_DATE) END,
                     'open_material_changes', p.open_material_changes,
                     'open_schedules', p.open_schedules,
                     'successor_assessment_id', p.successor_id,
                     'row_version', p.row_version,
                     'updated_at', p.updated_at)
                     ORDER BY COALESCE(p.reassessment_due, p.valid_until, DATE '9999-12-31'), p.assessment_reference)
                   FROM page p), '[]'::jsonb)
    INTO v_total, v_rows;

  RETURN jsonb_build_object('status','OK','code', NULL,
    'data', jsonb_build_object('rows', v_rows, 'total', v_total,
                               'limit', p_limit, 'offset', p_offset, 'bucket', v_bucket));
END;
$$;

REVOKE ALL ON FUNCTION public.bn_means_lifecycle_command_v1(text,uuid,jsonb,bigint,text,text,uuid,text,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_lifecycle_context_v1(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_means_reassessment_queue_v1(uuid,jsonb,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_lifecycle_command_v1(text,uuid,jsonb,bigint,text,text,uuid,text,uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_lifecycle_context_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_reassessment_queue_v1(uuid,jsonb,int,int) TO authenticated, service_role;
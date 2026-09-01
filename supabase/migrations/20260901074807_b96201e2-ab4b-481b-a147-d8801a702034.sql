CREATE OR REPLACE FUNCTION public.ia_persist_plan_engagements(p_plan_id uuid, p_engagements jsonb, p_created_by text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_plan_status text;
  v_eng jsonb;
  v_eng_id uuid;
  v_inserted int := 0;
  v_updated int := 0;
  v_code text;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT status INTO v_plan_status FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found');
  END IF;
  IF v_plan_status NOT IN ('Draft', 'Revision') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Engagements can only be modified on Draft or Revision plans. Current status: ' || v_plan_status);
  END IF;

  FOR v_eng IN SELECT * FROM jsonb_array_elements(p_engagements)
  LOOP
    v_eng_id := NULLIF(v_eng->>'id', '')::uuid;

    IF v_eng_id IS NOT NULL THEN
      UPDATE ia_audit_engagements SET
        engagement_name = CASE WHEN v_eng ? 'engagement_name' THEN COALESCE(NULLIF(v_eng->>'engagement_name',''), engagement_name) ELSE engagement_name END,
        engagement_code = CASE WHEN v_eng ? 'engagement_code' THEN COALESCE(NULLIF(v_eng->>'engagement_code',''), engagement_code) ELSE engagement_code END,
        department_id = CASE WHEN v_eng ? 'department_id' THEN NULLIF(v_eng->>'department_id','')::uuid ELSE department_id END,
        function_id = CASE WHEN v_eng ? 'function_id' THEN NULLIF(v_eng->>'function_id','')::uuid ELSE function_id END,
        engagement_type = CASE WHEN v_eng ? 'engagement_type' THEN COALESCE(NULLIF(v_eng->>'engagement_type',''), engagement_type) ELSE engagement_type END,
        engagement_risk_rating = CASE WHEN v_eng ? 'engagement_risk_rating' THEN COALESCE(NULLIF(v_eng->>'engagement_risk_rating',''), engagement_risk_rating) ELSE engagement_risk_rating END,
        planned_start_date = CASE WHEN v_eng ? 'planned_start_date' THEN NULLIF(v_eng->>'planned_start_date','')::date ELSE planned_start_date END,
        planned_end_date = CASE WHEN v_eng ? 'planned_end_date' THEN NULLIF(v_eng->>'planned_end_date','')::date ELSE planned_end_date END,
        quarter = CASE WHEN v_eng ? 'quarter' THEN NULLIF(v_eng->>'quarter','') ELSE quarter END,
        month = CASE WHEN v_eng ? 'month' THEN NULLIF(v_eng->>'month','') ELSE month END,
        sequence_no = CASE WHEN v_eng ? 'sequence_no' THEN NULLIF(v_eng->>'sequence_no','')::int ELSE sequence_no END,
        lead_auditor_id = CASE WHEN v_eng ? 'lead_auditor_id' THEN NULLIF(v_eng->>'lead_auditor_id','')::uuid ELSE lead_auditor_id END,
        reviewer_id = CASE WHEN v_eng ? 'reviewer_id' THEN NULLIF(v_eng->>'reviewer_id','')::uuid ELSE reviewer_id END,
        supportive_auditor_ids = CASE WHEN v_eng ? 'supportive_auditor_ids' THEN COALESCE(v_eng->'supportive_auditor_ids', '[]'::jsonb) ELSE supportive_auditor_ids END,
        team_member_ids = CASE WHEN v_eng ? 'team_member_ids' THEN COALESCE(v_eng->'team_member_ids', '[]'::jsonb) ELSE team_member_ids END,
        estimated_days = CASE WHEN v_eng ? 'estimated_days' THEN NULLIF(v_eng->>'estimated_days','')::numeric ELSE estimated_days END,
        estimated_hours = CASE WHEN v_eng ? 'estimated_hours' THEN NULLIF(v_eng->>'estimated_hours','')::numeric ELSE estimated_hours END,
        budgeted_hours = CASE WHEN v_eng ? 'budgeted_hours' THEN NULLIF(v_eng->>'budgeted_hours','')::numeric ELSE budgeted_hours END,
        estimated_budget = CASE WHEN v_eng ? 'estimated_budget' THEN NULLIF(v_eng->>'estimated_budget','')::numeric ELSE estimated_budget END,
        scope = CASE WHEN v_eng ? 'scope' THEN NULLIF(v_eng->>'scope','') ELSE scope END,
        objectives = CASE WHEN v_eng ? 'objectives' THEN NULLIF(v_eng->>'objectives','') ELSE objectives END,
        methodology = CASE WHEN v_eng ? 'methodology' THEN NULLIF(v_eng->>'methodology','') ELSE methodology END,
        criteria = CASE WHEN v_eng ? 'criteria' THEN NULLIF(v_eng->>'criteria','') ELSE criteria END,
        auditable_area_summary = CASE WHEN v_eng ? 'auditable_area_summary' THEN NULLIF(v_eng->>'auditable_area_summary','') ELSE auditable_area_summary END,
        coverage_category = CASE WHEN v_eng ? 'coverage_category' THEN NULLIF(v_eng->>'coverage_category','') ELSE coverage_category END,
        inclusion_rationale = CASE WHEN v_eng ? 'inclusion_rationale' THEN NULLIF(v_eng->>'inclusion_rationale','') ELSE inclusion_rationale END,
        inclusion_reason_codes = CASE WHEN v_eng ? 'inclusion_reason_codes' THEN COALESCE(v_eng->'inclusion_reason_codes', '[]'::jsonb) ELSE inclusion_reason_codes END,
        inclusion_reason_notes = CASE WHEN v_eng ? 'inclusion_reason_notes' THEN NULLIF(v_eng->>'inclusion_reason_notes','') ELSE inclusion_reason_notes END,
        expected_deliverable = CASE WHEN v_eng ? 'expected_deliverable' THEN NULLIF(v_eng->>'expected_deliverable','') ELSE expected_deliverable END,
        expected_deliverable_codes = CASE WHEN v_eng ? 'expected_deliverable_codes' THEN COALESCE(v_eng->'expected_deliverable_codes', '[]'::jsonb) ELSE expected_deliverable_codes END,
        expected_deliverable_notes = CASE WHEN v_eng ? 'expected_deliverable_notes' THEN NULLIF(v_eng->>'expected_deliverable_notes','') ELSE expected_deliverable_notes END,
        dependencies = CASE WHEN v_eng ? 'dependencies' THEN NULLIF(v_eng->>'dependencies','') ELSE dependencies END,
        scheduling_notes = CASE WHEN v_eng ? 'scheduling_notes' THEN NULLIF(v_eng->>'scheduling_notes','') ELSE scheduling_notes END,
        board_priority_flag = CASE WHEN v_eng ? 'board_priority_flag' THEN COALESCE((v_eng->>'board_priority_flag')::boolean, board_priority_flag) ELSE board_priority_flag END,
        is_adhoc = CASE WHEN v_eng ? 'is_adhoc' THEN COALESCE((v_eng->>'is_adhoc')::boolean, is_adhoc) ELSE is_adhoc END,
        auditee_contact = CASE WHEN v_eng ? 'auditee_contact' THEN NULLIF(v_eng->>'auditee_contact','') ELSE auditee_contact END,
        primary_auditee_contact_id = CASE WHEN v_eng ? 'primary_auditee_contact_id' THEN NULLIF(v_eng->>'primary_auditee_contact_id','')::uuid ELSE primary_auditee_contact_id END,
        secondary_auditee_contact_ids = CASE WHEN v_eng ? 'secondary_auditee_contact_ids' THEN COALESCE(v_eng->'secondary_auditee_contact_ids', '[]'::jsonb) ELSE secondary_auditee_contact_ids END,
        is_active = true,
        updated_by = p_created_by,
        updated_at = now()
      WHERE id = v_eng_id AND annual_plan_id = p_plan_id;

      IF FOUND THEN
        v_updated := v_updated + 1;
        v_ids := v_ids || v_eng_id;
      END IF;
    ELSE
      v_code := 'ENG-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((floor(random() * 9000 + 1000))::text, 4, '0');

      INSERT INTO ia_audit_engagements (
        annual_plan_id, engagement_name, engagement_code, department_id, function_id,
        engagement_type, engagement_risk_rating, planned_start_date, planned_end_date,
        quarter, month, sequence_no,
        lead_auditor_id, reviewer_id, supportive_auditor_ids, team_member_ids,
        estimated_days, estimated_hours, budgeted_hours, estimated_budget,
        scope, objectives, methodology, criteria, auditable_area_summary,
        coverage_category, inclusion_rationale, inclusion_reason_codes, inclusion_reason_notes,
        expected_deliverable, expected_deliverable_codes, expected_deliverable_notes,
        dependencies, scheduling_notes, board_priority_flag, is_adhoc,
        auditee_contact, primary_auditee_contact_id, secondary_auditee_contact_ids,
        status, is_active, created_by, created_at
      ) VALUES (
        p_plan_id,
        v_eng->>'engagement_name',
        COALESCE(NULLIF(v_eng->>'engagement_code',''), v_code),
        NULLIF(v_eng->>'department_id','')::uuid,
        NULLIF(v_eng->>'function_id','')::uuid,
        COALESCE(NULLIF(v_eng->>'engagement_type',''), 'Planned Audit'),
        COALESCE(NULLIF(v_eng->>'engagement_risk_rating',''), 'Medium'),
        NULLIF(v_eng->>'planned_start_date','')::date,
        NULLIF(v_eng->>'planned_end_date','')::date,
        NULLIF(v_eng->>'quarter',''),
        NULLIF(v_eng->>'month',''),
        NULLIF(v_eng->>'sequence_no','')::int,
        NULLIF(v_eng->>'lead_auditor_id','')::uuid,
        NULLIF(v_eng->>'reviewer_id','')::uuid,
        COALESCE(v_eng->'supportive_auditor_ids', '[]'::jsonb),
        COALESCE(v_eng->'team_member_ids', '[]'::jsonb),
        NULLIF(v_eng->>'estimated_days','')::numeric,
        NULLIF(v_eng->>'estimated_hours','')::numeric,
        NULLIF(v_eng->>'budgeted_hours','')::numeric,
        NULLIF(v_eng->>'estimated_budget','')::numeric,
        NULLIF(v_eng->>'scope',''),
        NULLIF(v_eng->>'objectives',''),
        NULLIF(v_eng->>'methodology',''),
        NULLIF(v_eng->>'criteria',''),
        NULLIF(v_eng->>'auditable_area_summary',''),
        NULLIF(v_eng->>'coverage_category',''),
        NULLIF(v_eng->>'inclusion_rationale',''),
        COALESCE(v_eng->'inclusion_reason_codes', '[]'::jsonb),
        NULLIF(v_eng->>'inclusion_reason_notes',''),
        NULLIF(v_eng->>'expected_deliverable',''),
        COALESCE(v_eng->'expected_deliverable_codes', '[]'::jsonb),
        NULLIF(v_eng->>'expected_deliverable_notes',''),
        NULLIF(v_eng->>'dependencies',''),
        NULLIF(v_eng->>'scheduling_notes',''),
        COALESCE((v_eng->>'board_priority_flag')::boolean, false),
        COALESCE((v_eng->>'is_adhoc')::boolean, false),
        NULLIF(v_eng->>'auditee_contact',''),
        NULLIF(v_eng->>'primary_auditee_contact_id','')::uuid,
        COALESCE(v_eng->'secondary_auditee_contact_ids', '[]'::jsonb),
        'Planned',
        true,
        p_created_by,
        now()
      )
      RETURNING id INTO v_eng_id;

      v_inserted := v_inserted + 1;
      v_ids := v_ids || v_eng_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'engagement_ids', to_jsonb(v_ids)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ia_remove_plan_engagement(p_plan_id uuid, p_engagement_id uuid, p_actor text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_plan_status text;
  v_eng record;
BEGIN
  SELECT status INTO v_plan_status FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found');
  END IF;
  IF v_plan_status NOT IN ('Draft', 'Revision') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Audits can only be removed from Draft or Revision plans. Current status: ' || v_plan_status);
  END IF;

  SELECT * INTO v_eng FROM ia_audit_engagements
   WHERE id = p_engagement_id AND annual_plan_id = p_plan_id;
  IF v_eng.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Audit not found in this plan');
  END IF;

  IF v_eng.launched_at IS NOT NULL
     OR COALESCE(v_eng.execution_status, 'Not Started') NOT IN ('Not Started', 'Pending', 'Planned')
     OR COALESCE(v_eng.status, 'Planned') NOT IN ('Planned', 'Draft', 'Ready', 'In Preparation') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This audit has already started and cannot be removed from the plan');
  END IF;

  IF NOT COALESCE(v_eng.is_active, true) THEN
    RETURN jsonb_build_object('success', true, 'already_removed', true);
  END IF;

  UPDATE ia_audit_engagements
     SET is_active = false,
         updated_by = COALESCE(p_actor, 'system'),
         updated_at = now()
   WHERE id = p_engagement_id;

  INSERT INTO ia_plan_change_log (plan_id, change_type, description, changed_by)
  VALUES (
    p_plan_id,
    'engagement_removed',
    'Audit "' || COALESCE(v_eng.engagement_name, v_eng.engagement_code, p_engagement_id::text) || '" was removed from the plan'
      || COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
    COALESCE(p_actor, 'system')
  );

  RETURN jsonb_build_object('success', true, 'engagement_id', p_engagement_id);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) TO service_role;
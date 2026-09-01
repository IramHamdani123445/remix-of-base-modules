-- ============================================================
-- INTERNAL AUDIT — ANNUAL PLAN CONVERGENCE FINAL CORRECTIVE CHECKPOINT
-- ============================================================

-- 1. Canonical working-copy statuses ------------------------------------
CREATE OR REPLACE FUNCTION public.ia_plan_working_copy_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT ARRAY['Draft','Rejected','Changes Requested','Amendment Pending']::text[] $$;

-- 2. Plan portfolio edit authority --------------------------------------
CREATE OR REPLACE FUNCTION public.ia_can_edit_plan_portfolio(_creating boolean)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
       public.ia_actor_can('audit_plans', 'edit')
       OR public.ia_actor_can('audit_engagements', CASE WHEN _creating THEN 'create' ELSE 'edit' END)
     );
$$;

-- 3. Governed engagement upsert -----------------------------------------
CREATE OR REPLACE FUNCTION public.ia_persist_plan_engagements(p_plan_id uuid, p_engagements jsonb, p_created_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_status text;
  v_eng jsonb;
  v_eng_id uuid;
  v_inserted int := 0;
  v_updated int := 0;
  v_code text;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_actor text;
  v_existing record;
  v_has_create boolean;
  v_has_edit boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
      'error', 'You do not have permission to modify this annual plan.');
  END IF;

  -- Server-derived actor. p_created_by is accepted for wire compatibility only.
  v_actor := COALESCE(NULLIF(trim(COALESCE(public.ia_actor_label(), '')), ''), auth.uid()::text);

  v_has_create := public.ia_can_edit_plan_portfolio(true);
  v_has_edit   := public.ia_can_edit_plan_portfolio(false);

  SELECT status INTO v_plan_status FROM ia_annual_plans WHERE id = p_plan_id FOR UPDATE;
  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PLAN_NOT_FOUND', 'error', 'Plan not found');
  END IF;
  IF NOT (COALESCE(v_plan_status, 'Draft') = ANY (public.ia_plan_working_copy_statuses())) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PLAN_NOT_EDITABLE',
      'error', 'Audits can only be modified while the plan is a working copy (Draft, Rejected, Changes Requested or Amendment Pending). Current status: ' || v_plan_status);
  END IF;

  FOR v_eng IN SELECT * FROM jsonb_array_elements(p_engagements)
  LOOP
    v_eng_id := NULLIF(v_eng->>'id', '')::uuid;

    IF v_eng_id IS NOT NULL THEN
      IF NOT v_has_edit THEN
        RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
          'error', 'You do not have permission to modify this annual plan.');
      END IF;

      SELECT * INTO v_existing FROM ia_audit_engagements WHERE id = v_eng_id;
      IF v_existing.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_NOT_FOUND',
          'error', 'Audit not found.', 'engagement_id', v_eng_id);
      END IF;
      IF v_existing.annual_plan_id IS DISTINCT FROM p_plan_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_PLAN_MISMATCH',
          'error', 'This audit does not belong to the specified annual plan.', 'engagement_id', v_eng_id);
      END IF;
      IF v_existing.launched_at IS NOT NULL
         OR COALESCE(v_existing.execution_status, 'Not Started') NOT IN ('Not Started', 'Pending', 'Planned')
         OR COALESCE(v_existing.status, 'Planned') NOT IN ('Planned', 'Draft', 'Ready', 'In Preparation') THEN
        RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_PROTECTED',
          'error', 'This audit has already started and can no longer be changed from the plan.', 'engagement_id', v_eng_id);
      END IF;

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
        updated_by = v_actor,
        updated_at = now()
      WHERE id = v_eng_id AND annual_plan_id = p_plan_id;

      v_updated := v_updated + 1;
      v_ids := v_ids || v_eng_id;

      INSERT INTO ia_plan_change_log (plan_id, change_type, description, changed_by)
      VALUES (p_plan_id, 'engagement_modified',
        'Audit "' || COALESCE(v_eng->>'engagement_name', v_existing.engagement_name, v_eng_id::text) || '" was updated', v_actor);
    ELSE
      IF NOT v_has_create THEN
        RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
          'error', 'You do not have permission to modify this annual plan.');
      END IF;

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
        v_actor,
        now()
      )
      RETURNING id INTO v_eng_id;

      v_inserted := v_inserted + 1;
      v_ids := v_ids || v_eng_id;

      INSERT INTO ia_plan_change_log (plan_id, change_type, description, changed_by)
      VALUES (p_plan_id, 'engagement_added',
        'Audit "' || COALESCE(v_eng->>'engagement_name', v_eng_id::text) || '" was added to the plan', v_actor);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'actor', v_actor,
    'engagement_ids', to_jsonb(v_ids)
  );
END;
$function$;

-- 4. Governed engagement removal ----------------------------------------
CREATE OR REPLACE FUNCTION public.ia_remove_plan_engagement(p_plan_id uuid, p_engagement_id uuid, p_actor text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_status text;
  v_eng record;
  v_actor text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.ia_can_edit_plan_portfolio(false) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
      'error', 'You do not have permission to modify this annual plan.');
  END IF;

  -- Server-derived actor. p_actor is accepted for wire compatibility only.
  v_actor := COALESCE(NULLIF(trim(COALESCE(public.ia_actor_label(), '')), ''), auth.uid()::text);

  SELECT status INTO v_plan_status FROM ia_annual_plans WHERE id = p_plan_id FOR UPDATE;
  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PLAN_NOT_FOUND', 'error', 'Plan not found');
  END IF;
  IF NOT (COALESCE(v_plan_status, 'Draft') = ANY (public.ia_plan_working_copy_statuses())) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PLAN_NOT_EDITABLE',
      'error', 'Audits can only be removed while the plan is a working copy (Draft, Rejected, Changes Requested or Amendment Pending). Current status: ' || v_plan_status);
  END IF;

  SELECT * INTO v_eng FROM ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_NOT_FOUND', 'error', 'Audit not found.');
  END IF;
  IF v_eng.annual_plan_id IS DISTINCT FROM p_plan_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_PLAN_MISMATCH',
      'error', 'This audit does not belong to the specified annual plan.');
  END IF;

  IF v_eng.launched_at IS NOT NULL
     OR COALESCE(v_eng.execution_status, 'Not Started') NOT IN ('Not Started', 'Pending', 'Planned')
     OR COALESCE(v_eng.status, 'Planned') NOT IN ('Planned', 'Draft', 'Ready', 'In Preparation') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_PROTECTED',
      'error', 'This audit has already started and cannot be removed from the plan');
  END IF;

  IF NOT COALESCE(v_eng.is_active, true) THEN
    RETURN jsonb_build_object('success', true, 'already_removed', true);
  END IF;

  UPDATE ia_audit_engagements
     SET is_active = false, updated_by = v_actor, updated_at = now()
   WHERE id = p_engagement_id;

  INSERT INTO ia_plan_change_log (plan_id, change_type, description, changed_by)
  VALUES (
    p_plan_id,
    'engagement_removed',
    'Audit "' || COALESCE(v_eng.engagement_name, v_eng.engagement_code, p_engagement_id::text) || '" was removed from the plan'
      || COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
    v_actor
  );

  RETURN jsonb_build_object('success', true, 'engagement_id', p_engagement_id, 'actor', v_actor);
END;
$function$;

-- 5. Governed plan header (working copy) update -------------------------
CREATE OR REPLACE FUNCTION public.ia_update_annual_plan_working_copy(p_plan_id uuid, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[] := ARRAY[
    'title','fiscal_year','plan_owner','prepared_by','objective','scope','scope_description',
    'audit_scope','exclusions','methodology','methodology_notes','planning_assumptions',
    'risk_level','planned_start_date','planned_end_date','planned_hours','monthly_working_hours',
    'total_available_hours','auditor_count','buffer_pct','contingency_hours','utilization_pct',
    'resource_constraints','skills_constraints','outsourced_support_notes','executive_summary',
    'department_id','function_id','board_committee_name','assigned_auditor','total_department_audits'
  ];
  v_lifecycle text[] := ARRAY[
    'status','submitted_by','submitted_date','approved_by','approved_date','current_version_number',
    'workflow_instance_id','is_locked','closed_by','closed_date','closure_summary',
    'current_workflow_step','rejected_by','rejected_at','revision_count','approval_comments'
  ];
  v_plan record;
  v_actor text;
  v_key text;
  v_rejected text[] := ARRAY[]::text[];
  v_sets text[] := ARRAY[]::text[];
  v_sql text;
  v_row jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.ia_actor_can('audit_plans', 'edit') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PERMISSION_DENIED',
      'error', 'You do not have permission to modify this annual plan.');
  END IF;

  v_actor := COALESCE(NULLIF(trim(COALESCE(public.ia_actor_label(), '')), ''), auth.uid()::text);

  SELECT * INTO v_plan FROM ia_annual_plans WHERE id = p_plan_id FOR UPDATE;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PLAN_NOT_FOUND', 'error', 'Plan not found');
  END IF;
  IF NOT (COALESCE(v_plan.status, 'Draft') = ANY (public.ia_plan_working_copy_statuses())) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PLAN_NOT_EDITABLE',
      'error', 'Plan details can only be edited while the plan is a working copy (Draft, Rejected, Changes Requested or Amendment Pending). Current status: ' || v_plan.status);
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_changes, '{}'::jsonb))
  LOOP
    IF v_key = ANY (v_lifecycle) THEN
      v_rejected := v_rejected || v_key;
    ELSIF v_key = ANY (v_allowed) THEN
      v_sets := v_sets || format('%I = ($1->>%L)::text::%s', v_key, v_key,
        (SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ia_annual_plans' AND column_name = v_key));
    ELSIF v_key <> 'id' THEN
      v_rejected := v_rejected || v_key;
    END IF;
  END LOOP;

  IF array_length(v_rejected, 1) > 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FIELD_NOT_EDITABLE',
      'error', 'These fields cannot be changed through a normal plan content update: ' || array_to_string(v_rejected, ', '),
      'rejected_fields', to_jsonb(v_rejected));
  END IF;

  IF array_length(v_sets, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NO_CHANGES', 'error', 'No editable changes supplied.');
  END IF;

  v_sql := 'UPDATE ia_annual_plans SET ' || array_to_string(v_sets, ', ')
        || format(', updated_at = now(), updated_by = %L WHERE id = %L RETURNING to_jsonb(ia_annual_plans)', v_actor, p_plan_id);

  EXECUTE v_sql INTO v_row USING p_changes;

  INSERT INTO ia_plan_change_log (plan_id, change_type, description, changed_by)
  VALUES (p_plan_id, 'plan_details_updated',
    'Plan details updated: ' || array_to_string(ARRAY(SELECT jsonb_object_keys(p_changes)), ', '), v_actor);

  PERFORM public.ia_log_event('PLAN_DETAILS_UPDATED', 'ia_annual_plan', p_plan_id, NULL, p_plan_id,
    to_jsonb(v_plan), v_row, NULL, NULL, 'ia_update_annual_plan_working_copy');

  RETURN jsonb_build_object('success', true, 'plan', v_row, 'actor', v_actor);
END;
$function$;

-- 6. Legacy submission command becomes a compatibility wrapper ----------
CREATE OR REPLACE FUNCTION public.ia_submit_annual_plan(p_plan_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Compatibility wrapper. The canonical submission command is
  -- public.ia_start_plan_approval_workflow — no duplicated submission logic here.
  v_result := public.ia_start_plan_approval_workflow(
    p_plan_id := p_plan_id,
    p_submitted_by := COALESCE(auth.uid()::text, 'SYSTEM'),
    p_is_revision := false
  );

  IF COALESCE((v_result->>'success')::boolean, false) AND NULLIF(trim(COALESCE(p_notes, '')), '') IS NOT NULL THEN
    UPDATE ia_approval_actions
       SET comments = p_notes
     WHERE entity_type = 'annual_plan' AND entity_id = p_plan_id
       AND id = (SELECT id FROM ia_approval_actions
                  WHERE entity_type = 'annual_plan' AND entity_id = p_plan_id
                  ORDER BY created_at DESC LIMIT 1);
  END IF;

  RETURN v_result || jsonb_build_object('canonical_command', 'ia_start_plan_approval_workflow');
END;
$function$;

-- 7. Execute privileges --------------------------------------------------
REVOKE ALL ON FUNCTION public.ia_persist_plan_engagements(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_update_annual_plan_working_copy(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_submit_annual_plan(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ia_plan_working_copy_statuses() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_can_edit_plan_portfolio(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_persist_plan_engagements(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_update_annual_plan_working_copy(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_submit_annual_plan(uuid, text) TO authenticated, service_role;
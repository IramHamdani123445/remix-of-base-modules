
CREATE OR REPLACE FUNCTION public.ia_evaluate_engagement_completeness(p_engagement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_gate record;
  v_evidence_count integer;
  v_wp_count integer;
  v_findings_count integer;
  v_responses_pending integer;
  v_actions_pending integer;
  v_reasons text[] := '{}';
BEGIN
  SELECT * INTO v_eng FROM ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('passed', false, 'reasons', ARRAY['Engagement not found']);
  END IF;

  SELECT * INTO v_gate FROM ia_execution_gate_config
  WHERE gate_type = 'engagement_closure' AND is_active = true LIMIT 1;

  SELECT count(*) INTO v_evidence_count FROM ia_evidence WHERE engagement_id = p_engagement_id;
  SELECT count(*) INTO v_wp_count FROM ia_working_papers WHERE engagement_id = p_engagement_id;
  SELECT count(*) INTO v_findings_count FROM ia_findings WHERE engagement_id = p_engagement_id;

  IF v_gate IS NOT NULL THEN
    IF v_evidence_count < v_gate.min_evidence_count THEN
      v_reasons := v_reasons || ('Minimum ' || v_gate.min_evidence_count || ' evidence item(s) required, found ' || v_evidence_count);
    END IF;
    IF v_wp_count < v_gate.min_working_papers_count THEN
      v_reasons := v_reasons || ('Minimum ' || v_gate.min_working_papers_count || ' working paper(s) required, found ' || v_wp_count);
    END IF;
    IF v_gate.min_findings_documented AND v_findings_count = 0 THEN
      v_reasons := v_reasons || 'At least one finding must be documented';
    END IF;
    IF v_gate.require_management_responses THEN
      SELECT count(*) INTO v_responses_pending
      FROM ia_findings f LEFT JOIN ia_management_responses mr ON mr.finding_id = f.id
      WHERE f.engagement_id = p_engagement_id AND mr.id IS NULL;
      IF v_responses_pending > 0 THEN
        v_reasons := v_reasons || (v_responses_pending || ' finding(s) missing management response');
      END IF;
    END IF;
    IF v_gate.require_action_plans THEN
      SELECT count(*) INTO v_actions_pending
      FROM ia_findings f LEFT JOIN ia_action_tracking at ON at.finding_id = f.id
      WHERE f.engagement_id = p_engagement_id AND at.id IS NULL;
      IF v_actions_pending > 0 THEN
        v_reasons := v_reasons || (v_actions_pending || ' finding(s) missing action plan');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'passed', array_length(v_reasons, 1) IS NULL,
    'evidence_count', v_evidence_count,
    'working_papers_count', v_wp_count,
    'findings_count', v_findings_count,
    'reasons', v_reasons,
    'checked_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ia_evaluate_engagement_completeness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ia_evaluate_engagement_completeness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ia_check_engagement_completeness(p_engagement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := public.ia_evaluate_engagement_completeness(p_engagement_id);
  IF v_result ? 'evidence_count' THEN
    UPDATE ia_audit_engagements SET execution_gate_status = v_result WHERE id = p_engagement_id;
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_enforce_engagement_execution_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan_status text;
  v_gate_result jsonb;
  v_in_version boolean;
  v_plan_version integer;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('In Progress', 'Execution', 'Fieldwork') THEN
    IF NEW.annual_plan_id IS NOT NULL THEN
      SELECT status, current_version_number INTO v_plan_status, v_plan_version FROM ia_annual_plans WHERE id = NEW.annual_plan_id;
      IF v_plan_status IS NOT NULL AND v_plan_status NOT IN ('Approved', 'In Progress') THEN
        RAISE EXCEPTION 'Cannot start engagement: parent audit plan status is "%" — must be Approved or In Progress', v_plan_status;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM ia_plan_version_engagements pve
        JOIN ia_plan_versions pv ON pv.id = pve.plan_version_id
        WHERE pve.engagement_id = NEW.id
          AND pv.plan_id = NEW.annual_plan_id
          AND pv.version_number = v_plan_version
          AND pve.change_type != 'removed'
      ) INTO v_in_version;

      IF NOT v_in_version THEN
        RAISE EXCEPTION 'Cannot start engagement: not included in current approved plan version (v%)', v_plan_version;
      END IF;
    END IF;

    IF NEW.lead_auditor_id IS NULL THEN
      RAISE EXCEPTION 'Cannot start engagement: a lead auditor must be assigned';
    END IF;

    IF NEW.planned_start_date IS NULL OR NEW.planned_end_date IS NULL THEN
      RAISE EXCEPTION 'Cannot start engagement: planned start and end dates are required';
    END IF;
  END IF;

  IF NEW.status IN ('Completed', 'Closed') AND OLD.status NOT IN ('Completed', 'Closed') THEN
    -- Read-only evaluation: writing back to this row from a BEFORE trigger
    -- aborts the closing UPDATE ("tuple already modified by the current command").
    v_gate_result := public.ia_evaluate_engagement_completeness(NEW.id);
    IF NOT (v_gate_result->>'passed')::boolean THEN
      RAISE EXCEPTION 'Cannot close engagement: completeness check failed — %', v_gate_result->>'reasons';
    END IF;
    NEW.execution_gate_status := v_gate_result;
  END IF;

  RETURN NEW;
END;
$function$;

-- FINAL-E2E-DEF-04: ia_can_start_engagement appended untyped literals to a
-- text[] ("v_reasons || 'text'"), which Postgres resolves as array || array and
-- fails at runtime with "malformed array literal" the moment any pre-execution
-- gate is not met. Reasons are now explicitly cast to text.
-- FINAL-E2E-DEF-05: gates 4 and 5 only recognised legacy ia_communication_stages
-- rows. Under the command-owned communication architecture, ia_schedule_engagement
-- issues the formal intimation (which discloses team and scope) as an Omni-Comms
-- obligation, so that obligation now satisfies the pre-execution notice gates.
CREATE OR REPLACE FUNCTION public.ia_can_start_engagement(p_engagement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_eng record;
  v_reasons text[] := '{}';
  v_intimation_done boolean;
  v_team_notice_done boolean;
  v_version_approved boolean;
BEGIN
  SELECT e.*, ap.status AS plan_status, ap.current_version_number AS plan_current_version
  INTO v_eng
  FROM ia_audit_engagements e
  LEFT JOIN ia_annual_plans ap ON ap.id = e.annual_plan_id
  WHERE e.id = p_engagement_id;

  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('can_start', false, 'reasons', ARRAY['Engagement not found']::text[]);
  END IF;

  IF v_eng.plan_status IS NOT NULL AND v_eng.plan_status NOT IN ('Approved', 'In Progress') THEN
    v_reasons := v_reasons || ('Parent plan status is "' || COALESCE(v_eng.plan_status, 'NULL') || '" - must be Approved or In Progress')::text;
  END IF;

  IF v_eng.annual_plan_id IS NOT NULL AND v_eng.plan_status IN ('Approved', 'In Progress') THEN
    SELECT EXISTS (
      SELECT 1 FROM ia_plan_version_engagements pve
      JOIN ia_plan_versions pv ON pv.id = pve.plan_version_id
      WHERE pve.engagement_id = p_engagement_id
        AND pv.plan_id = v_eng.annual_plan_id
        AND pv.version_number = v_eng.plan_current_version
        AND pve.change_type != 'removed'
    ) INTO v_version_approved;

    IF NOT v_version_approved THEN
      v_reasons := v_reasons || ('Engagement is not included in the current approved plan version (v' || COALESCE(v_eng.plan_current_version::text, '?') || ')')::text;
    END IF;
  END IF;

  IF v_eng.planned_start_date IS NULL OR v_eng.planned_end_date IS NULL THEN
    v_reasons := v_reasons || 'Engagement must have planned start and end dates'::text;
  END IF;

  IF v_eng.lead_auditor_id IS NULL THEN
    v_reasons := v_reasons || 'A lead auditor must be assigned'::text;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ia_communication_stages cs
    WHERE cs.engagement_id = p_engagement_id
      AND cs.stage_code = 'PLAN_INTIMATION'
      AND cs.delivery_status IN ('Sent','Delivered','Acknowledged')
  ) OR (
    v_eng.intimation_issued_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM omni_comms_business_event_outbox o
      WHERE o.module_code = 'INTERNAL_AUDIT'
        AND o.event_code = 'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED'
        AND o.entity_id = p_engagement_id::text
    )
  ) INTO v_intimation_done;

  IF NOT v_intimation_done THEN
    v_reasons := v_reasons || 'Audit intimation notice must be sent to auditee before execution'::text;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ia_communication_stages cs
    WHERE cs.engagement_id = p_engagement_id
      AND cs.stage_code = 'TEAM_AND_SCOPE_NOTICE'
      AND cs.delivery_status IN ('Sent','Delivered','Acknowledged')
  ) OR COALESCE(v_intimation_done, false) INTO v_team_notice_done;

  IF NOT v_team_notice_done THEN
    v_reasons := v_reasons || 'Team and scope disclosure must be sent to auditee before execution'::text;
  END IF;

  RETURN jsonb_build_object(
    'can_start', array_length(v_reasons, 1) IS NULL,
    'reasons', v_reasons,
    'engagement_status', v_eng.status,
    'plan_status', v_eng.plan_status,
    'plan_version', v_eng.plan_current_version,
    'is_in_current_version', COALESCE(v_version_approved, false)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.ia_can_issue_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report record;
  v_eng_id uuid;
  v_gate record;
  v_evidence_count integer := 0;
  v_wp_count integer := 0;
  v_findings_count integer := 0;
  v_responses_pending integer := 0;
  v_reasons text[] := ARRAY[]::text[];
  v_exit_meeting_done boolean;
  v_draft_discussion_done boolean;
BEGIN
  SELECT * INTO v_report FROM public.ia_audit_reports WHERE id = p_report_id;
  IF v_report IS NULL THEN
    RETURN jsonb_build_object('can_issue', false, 'reasons', to_jsonb(ARRAY['Report not found']));
  END IF;

  v_eng_id := v_report.engagement_id;

  IF NOT public.ia_cmd_guard_elevated('audit_reports', 'view', v_eng_id) THEN
    RETURN jsonb_build_object('can_issue', false, 'code', 'IA_FORBIDDEN',
      'reasons', to_jsonb(ARRAY['You do not have permission to evaluate this report']));
  END IF;

  SELECT * INTO v_gate FROM public.ia_execution_gate_config
   WHERE gate_type = 'report_issuance' AND is_active = true LIMIT 1;

  IF v_eng_id IS NOT NULL THEN
    SELECT count(*) INTO v_evidence_count FROM public.ia_evidence WHERE engagement_id = v_eng_id;
    SELECT count(*) INTO v_wp_count FROM public.ia_working_papers WHERE engagement_id = v_eng_id;
    SELECT count(*) INTO v_findings_count FROM public.ia_findings WHERE engagement_id = v_eng_id;
  END IF;

  IF v_gate IS NOT NULL AND v_eng_id IS NOT NULL THEN
    IF v_evidence_count < COALESCE(v_gate.min_evidence_count, 0) THEN
      v_reasons := v_reasons || ARRAY['Minimum ' || v_gate.min_evidence_count || ' evidence item(s) required, found ' || v_evidence_count];
    END IF;

    IF v_wp_count < COALESCE(v_gate.min_working_papers_count, 0) THEN
      v_reasons := v_reasons || ARRAY['Minimum ' || v_gate.min_working_papers_count || ' working paper(s) required, found ' || v_wp_count];
    END IF;

    IF COALESCE(v_gate.min_findings_documented, false) AND v_findings_count = 0 THEN
      v_reasons := v_reasons || ARRAY['At least one finding must be documented (or mark engagement as no-findings)'];
    END IF;

    IF COALESCE(v_gate.require_management_responses, false) THEN
      SELECT count(*) INTO v_responses_pending
      FROM public.ia_findings f
      LEFT JOIN public.ia_management_responses mr ON mr.finding_id = f.id
      WHERE f.engagement_id = v_eng_id
        AND COALESCE(f.lifecycle_status, 'Draft') <> 'Withdrawn'
        AND mr.id IS NULL;
      IF v_responses_pending > 0 THEN
        v_reasons := v_reasons || ARRAY[v_responses_pending || ' finding(s) missing management response'];
      END IF;
    END IF;
  END IF;

  IF v_eng_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ia_communication_stages cs
      WHERE cs.engagement_id = v_eng_id
        AND cs.stage_code = 'DRAFT_FINDING_DISCUSSION'
        AND cs.delivery_status IN ('Sent','Delivered','Acknowledged')
    ) INTO v_draft_discussion_done;
    IF NOT v_draft_discussion_done THEN
      v_reasons := v_reasons || ARRAY['Draft finding discussion must be completed with auditee before report issuance'];
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.ia_communication_stages cs
      WHERE cs.engagement_id = v_eng_id
        AND cs.stage_code = 'EXIT_MEETING'
        AND cs.delivery_status IN ('Sent','Delivered','Acknowledged')
    ) INTO v_exit_meeting_done;
    IF NOT v_exit_meeting_done THEN
      v_reasons := v_reasons || ARRAY['Exit meeting must be completed before report issuance'];
    END IF;
  END IF;

  UPDATE public.ia_audit_reports SET issuance_gate_status = jsonb_build_object(
    'checked_at', now(),
    'passed', array_length(v_reasons, 1) IS NULL,
    'evidence_count', v_evidence_count,
    'working_papers_count', v_wp_count,
    'findings_count', v_findings_count,
    'reasons', to_jsonb(v_reasons)
  ) WHERE id = p_report_id;

  RETURN jsonb_build_object(
    'can_issue', array_length(v_reasons, 1) IS NULL,
    'reasons', to_jsonb(v_reasons),
    'evidence_count', v_evidence_count,
    'working_papers_count', v_wp_count,
    'findings_count', v_findings_count
  );
END;
$function$;
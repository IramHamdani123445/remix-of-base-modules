-- =====================================================================
-- Internal Audit — Stage 1B / E2E-3
-- Management response governance: return for clarification, versioned
-- resubmission, auditor/management disagreement, dispute escalation and
-- formal disposition.
--
-- DEF-S1B-22  Returning a response for clarification required no reason.
-- DEF-S1B-23  Management could not resubmit a returned response, and a
--             second submission would have flattened the first (no history).
-- DEF-S1B-24  No auditor-owned conclusion field: recording the audit
--             position risked overwriting management's own narrative, and
--             there was no terminal disposition for a genuine disagreement.
-- DEF-S1B-25  Report issuance treated a live, undisposed disagreement the
--             same as an accepted response, and a superseded response
--             version could satisfy the "response received" gate.
-- =====================================================================

ALTER TABLE public.ia_management_responses
  ADD COLUMN IF NOT EXISTS response_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_response_id uuid REFERENCES public.ia_management_responses(id),
  ADD COLUMN IF NOT EXISTS superseded_by_response_id uuid REFERENCES public.ia_management_responses(id),
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS clarification_request text,
  ADD COLUMN IF NOT EXISTS clarification_requested_by text,
  ADD COLUMN IF NOT EXISTS clarification_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS audit_conclusion text,
  ADD COLUMN IF NOT EXISTS audit_concluded_by text,
  ADD COLUMN IF NOT EXISTS audit_concluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_state text NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS escalated_by text,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_authority text,
  ADD COLUMN IF NOT EXISTS escalation_reference text,
  ADD COLUMN IF NOT EXISTS escalation_reason text,
  ADD COLUMN IF NOT EXISTS dispute_disposition text,
  ADD COLUMN IF NOT EXISTS dispute_disposed_by text,
  ADD COLUMN IF NOT EXISTS dispute_disposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_disposition_notes text;

CREATE INDEX IF NOT EXISTS ia_mgmt_resp_current_idx
  ON public.ia_management_responses(finding_id) WHERE is_current;

-- ---------------------------------------------------------------------
-- DEF-S1B-22 + DEF-S1B-24: reviewing a response
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_review_management_response(p_response_id uuid, p_outcome text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_r record; v_actor text := public.ia_actor_label(); v_notes text := COALESCE(trim(p_notes), '');
BEGIN
  SELECT * INTO v_r FROM public.ia_management_responses WHERE id = p_response_id;
  IF v_r IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Response not found'); END IF;
  IF p_outcome NOT IN ('Accepted','Escalated','Revision Requested') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_OUTCOME', 'error', 'Outcome must be Accepted, Escalated or Revision Requested');
  END IF;
  IF NOT public.ia_cmd_guard_elevated('audit_findings', 'approve', v_r.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to review management responses');
  END IF;
  IF v_r.submitted_by IS NOT NULL AND v_r.submitted_by = v_actor THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'The author of a management response cannot review it');
  END IF;
  IF NOT COALESCE(v_r.is_current, true) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_RESPONSE_SUPERSEDED',
      'error', 'This response version has been superseded — review the current version');
  END IF;
  -- DEF-S1B-22: a return for clarification, or an escalation, is a formal act
  -- against management and must carry the auditor's written reason.
  IF p_outcome IN ('Revision Requested','Escalated') AND v_notes = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REASON_REQUIRED',
      'error', 'A written reason is required when a management response is returned for clarification or escalated');
  END IF;

  UPDATE public.ia_management_responses
     SET review_outcome = p_outcome, reviewed_by = v_actor, reviewed_at = now(),
         accepted_at = CASE WHEN p_outcome = 'Accepted' THEN now() ELSE accepted_at END,
         status = CASE WHEN p_outcome = 'Accepted' THEN 'Accepted'
                       WHEN p_outcome = 'Escalated' THEN 'Escalated' ELSE 'Revision Requested' END,
         -- DEF-S1B-24: the auditor writes only into auditor-owned fields.
         -- response_text, action_plan and rejection_rationale stay management-owned.
         clarification_request = CASE WHEN p_outcome = 'Revision Requested' THEN v_notes ELSE clarification_request END,
         clarification_requested_by = CASE WHEN p_outcome = 'Revision Requested' THEN v_actor ELSE clarification_requested_by END,
         clarification_requested_at = CASE WHEN p_outcome = 'Revision Requested' THEN now() ELSE clarification_requested_at END,
         audit_conclusion = CASE WHEN v_notes <> '' THEN v_notes ELSE audit_conclusion END,
         audit_concluded_by = CASE WHEN v_notes <> '' THEN v_actor ELSE audit_concluded_by END,
         audit_concluded_at = CASE WHEN v_notes <> '' THEN now() ELSE audit_concluded_at END,
         dispute_state = CASE
             WHEN p_outcome = 'Escalated' THEN 'Escalated'
             WHEN v_r.management_position = 'Rejected' THEN 'Disputed'
             ELSE dispute_state END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_response_id;

  PERFORM public.ia_log_event(
    CASE WHEN p_outcome = 'Revision Requested' THEN 'IA.RESPONSE.RETURNED' ELSE 'IA.RESPONSE.REVIEWED' END,
    'management_response', p_response_id, v_r.engagement_id, NULL,
    jsonb_build_object('status', v_r.status, 'dispute_state', v_r.dispute_state),
    jsonb_build_object('review_outcome', p_outcome), p_notes, NULL, 'ia_review_management_response');

  RETURN jsonb_build_object('success', true, 'response_id', p_response_id, 'review_outcome', p_outcome);
END;
$function$;

-- ---------------------------------------------------------------------
-- DEF-S1B-23: governed resubmission with full history
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_resubmit_management_response(
  p_response_id uuid, p_response_text text, p_action_plan text DEFAULT NULL,
  p_responsible_person text DEFAULT NULL, p_target_date date DEFAULT NULL,
  p_management_position text DEFAULT NULL, p_rejection_rationale text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prev record; v_f record; v_actor text := public.ia_actor_label();
        v_pos text; v_id uuid;
BEGIN
  SELECT * INTO v_prev FROM public.ia_management_responses WHERE id = p_response_id;
  IF v_prev IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Response not found'); END IF;
  SELECT * INTO v_f FROM public.ia_findings WHERE id = v_prev.finding_id;

  IF NOT (public.ia_cmd_guard('audit_findings', 'edit', v_prev.engagement_id)
          OR public.ia_can_access_engagement(v_prev.engagement_id)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to respond to this finding');
  END IF;
  IF NOT COALESCE(v_prev.is_current, true) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_RESPONSE_SUPERSEDED', 'error', 'This response version has already been superseded');
  END IF;
  IF v_prev.status <> 'Revision Requested' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_RETURNED',
      'error', 'Only a response that Internal Audit has returned for clarification can be resubmitted');
  END IF;
  IF COALESCE(trim(p_response_text), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_RESPONSE_REQUIRED', 'error', 'A written response is required');
  END IF;

  v_pos := COALESCE(p_management_position, v_prev.management_position);
  IF v_pos NOT IN ('Accepted','Partially Accepted','Rejected') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_POSITION',
      'error', 'Management position must be Accepted, Partially Accepted or Rejected');
  END IF;
  IF v_pos IN ('Partially Accepted','Rejected') AND COALESCE(trim(COALESCE(p_rejection_rationale, v_prev.rejection_rationale)), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_RATIONALE_REQUIRED',
      'error', 'A written rationale is required when a finding is rejected or only partially accepted');
  END IF;
  IF v_pos IN ('Accepted','Partially Accepted')
     AND (COALESCE(trim(COALESCE(p_action_plan, v_prev.action_plan)), '') = ''
          OR COALESCE(p_target_date, v_prev.target_date) IS NULL
          OR COALESCE(trim(COALESCE(p_responsible_person, v_prev.responsible_person)), '') = '') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ACTION_PLAN_REQUIRED',
      'error', 'An action plan, responsible person and target date are required when the finding is accepted');
  END IF;

  INSERT INTO public.ia_management_responses(
    finding_id, engagement_id, response_text, action_plan, responsible_person,
    target_date, official_target_date, due_date, management_position, rejection_rationale,
    status, submitted_by, submitted_date, response_version, supersedes_response_id,
    is_current, created_by, updated_by)
  VALUES (v_prev.finding_id, v_prev.engagement_id, p_response_text,
    COALESCE(p_action_plan, v_prev.action_plan), COALESCE(p_responsible_person, v_prev.responsible_person),
    COALESCE(p_target_date, v_prev.target_date), v_prev.official_target_date, v_prev.due_date,
    v_pos, COALESCE(p_rejection_rationale, v_prev.rejection_rationale),
    'Resubmitted', v_actor, now(), COALESCE(v_prev.response_version, 1) + 1, v_prev.id,
    true, v_actor, v_actor)
  RETURNING id INTO v_id;

  -- The returned version is preserved verbatim; it is only marked superseded.
  UPDATE public.ia_management_responses
     SET is_current = false, superseded_by_response_id = v_id, status = 'Superseded',
         updated_at = now(), updated_by = v_actor
   WHERE id = v_prev.id;

  PERFORM public.ia_log_event('IA.RESPONSE.RESUBMITTED', 'management_response', v_id,
    v_prev.engagement_id, NULL,
    jsonb_build_object('version', v_prev.response_version, 'status', v_prev.status),
    jsonb_build_object('version', COALESCE(v_prev.response_version, 1) + 1, 'position', v_pos),
    'Management resubmitted the response after clarification was requested', NULL, 'ia_resubmit_management_response');

  RETURN jsonb_build_object('success', true, 'response_id', v_id,
    'response_version', COALESCE(v_prev.response_version, 1) + 1, 'supersedes', v_prev.id);
END;
$function$;

-- ---------------------------------------------------------------------
-- Dispute escalation and formal disposition (DEF-S1B-24)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_escalate_finding_dispute(
  p_response_id uuid, p_authority text, p_reference text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_r record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_r FROM public.ia_management_responses WHERE id = p_response_id;
  IF v_r IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Response not found'); END IF;
  IF NOT public.ia_cmd_guard_elevated('audit_findings', 'approve', v_r.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to escalate this dispute');
  END IF;
  IF v_r.submitted_by = v_actor THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'The author of a management response cannot escalate it');
  END IF;
  IF COALESCE(trim(p_reason), '') = '' OR COALESCE(trim(p_authority), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REASON_REQUIRED',
      'error', 'The escalation authority and a written reason are required');
  END IF;
  IF v_r.dispute_disposition IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_DISPUTE_CLOSED', 'error', 'This dispute has already been formally disposed');
  END IF;

  UPDATE public.ia_management_responses
     SET dispute_state = 'Escalated', status = 'Escalated', review_outcome = 'Escalated',
         escalated_by = v_actor, escalated_at = now(), escalation_authority = p_authority,
         escalation_reference = p_reference, escalation_reason = p_reason,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_response_id;

  PERFORM public.ia_log_event('IA.DISPUTE.ESCALATED', 'management_response', p_response_id, v_r.engagement_id, NULL,
    jsonb_build_object('dispute_state', v_r.dispute_state),
    jsonb_build_object('dispute_state', 'Escalated', 'authority', p_authority, 'reference', p_reference),
    p_reason, NULL, 'ia_escalate_finding_dispute');

  RETURN jsonb_build_object('success', true, 'response_id', p_response_id, 'dispute_state', 'Escalated');
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_dispose_finding_dispute(
  p_response_id uuid, p_disposition text, p_notes text, p_authority_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_r record; v_actor text := public.ia_actor_label(); v_me uuid := public.ia_current_auditor_id();
        v_authorised boolean;
BEGIN
  SELECT * INTO v_r FROM public.ia_management_responses WHERE id = p_response_id;
  IF v_r IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Response not found'); END IF;
  IF p_disposition NOT IN ('Resolved - Management Agreed','Resolved - Audit Withdrew','Retained with Disagreement') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_DISPOSITION',
      'error', 'Disposition must be "Resolved - Management Agreed", "Resolved - Audit Withdrew" or "Retained with Disagreement"');
  END IF;

  -- Committee-level authority: Head of Internal Audit, or the engagement's
  -- independent reviewer. An ordinary audit team member cannot dispose of a dispute.
  v_authorised := public.ia_is_ia_user() AND EXISTS (
      SELECT 1 FROM public.ia_auditors a WHERE a.id = v_me AND a.role = 'Head of Internal Audit')
    OR EXISTS (SELECT 1 FROM public.ia_audit_engagements e
                WHERE e.id = v_r.engagement_id AND e.reviewer_id = v_me AND v_me IS NOT NULL);
  IF NOT v_authorised THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'Only the Head of Internal Audit or the engagement''s independent reviewer can formally dispose of a dispute');
  END IF;
  IF v_r.submitted_by = v_actor THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION', 'error', 'Management cannot dispose of its own dispute');
  END IF;
  IF v_r.dispute_state NOT IN ('Disputed','Escalated') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NO_DISPUTE', 'error', 'There is no open dispute on this response');
  END IF;
  IF COALESCE(trim(p_notes), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REASON_REQUIRED', 'error', 'Written reasons are required to dispose of a dispute');
  END IF;

  UPDATE public.ia_management_responses
     SET dispute_state = 'Disposed', dispute_disposition = p_disposition,
         dispute_disposed_by = v_actor, dispute_disposed_at = now(),
         dispute_disposition_notes = p_notes,
         escalation_reference = COALESCE(p_authority_reference, escalation_reference),
         status = 'Disposed', updated_at = now(), updated_by = v_actor
   WHERE id = p_response_id;

  PERFORM public.ia_log_event('IA.DISPUTE.DISPOSED', 'management_response', p_response_id, v_r.engagement_id, NULL,
    jsonb_build_object('dispute_state', v_r.dispute_state),
    jsonb_build_object('dispute_state', 'Disposed', 'disposition', p_disposition, 'authority_reference', p_authority_reference),
    p_notes, NULL, 'ia_dispose_finding_dispute');

  RETURN jsonb_build_object('success', true, 'response_id', p_response_id, 'dispute_disposition', p_disposition);
END;
$function$;

-- ---------------------------------------------------------------------
-- Management response register (read model)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_register_management_responses(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_eng uuid := NULLIF(p_filters->>'engagement_id','')::uuid; v_rows jsonb;
BEGIN
  IF NOT public.ia_is_ia_user() THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'Internal Audit access required');
  END IF;
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'finding_ref', (r->>'response_version')::int), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'response_id', mr.id, 'finding_ref', f.finding_id, 'finding_title', f.title,
      'severity', f.severity, 'department', f.department_name, 'engagement_id', mr.engagement_id,
      'management_position', mr.management_position, 'response_status', mr.status,
      'response_version', mr.response_version, 'is_current', mr.is_current,
      'due_date', mr.due_date, 'target_date', mr.target_date,
      'submitted_by', mr.submitted_by, 'submitted_date', mr.submitted_date,
      'returned_reason', mr.clarification_request, 'returned_by', mr.clarification_requested_by,
      'review_outcome', mr.review_outcome, 'reviewed_by', mr.reviewed_by,
      'audit_conclusion', mr.audit_conclusion,
      'dispute_state', mr.dispute_state, 'dispute_disposition', mr.dispute_disposition,
      'escalation_authority', mr.escalation_authority, 'escalation_reference', mr.escalation_reference
    ) r
    FROM public.ia_management_responses mr
    JOIN public.ia_findings f ON f.id = mr.finding_id
    WHERE (v_eng IS NULL OR mr.engagement_id = v_eng)
      AND public.ia_can_access_engagement(mr.engagement_id)
  ) s;
  RETURN jsonb_build_object('success', true, 'rows', v_rows, 'count', jsonb_array_length(v_rows));
END;
$function$;

-- ---------------------------------------------------------------------
-- DEF-S1B-25: report issuance must distinguish an open disagreement from a
-- formally accounted one, and must ignore superseded response versions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_can_issue_report(p_report_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_report record; v_eng_id uuid; v_gate record;
  v_evidence_count integer := 0; v_wp_count integer := 0; v_findings_count integer := 0;
  v_responses_pending integer := 0; v_returned_open integer := 0; v_disputes_open integer := 0;
  v_reasons text[] := ARRAY[]::text[];
  v_exit_meeting_done boolean; v_draft_discussion_done boolean;
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

  SELECT * INTO v_gate FROM public.ia_execution_gate_config WHERE gate_type = 'report_issuance' AND is_active = true LIMIT 1;

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
      WHERE f.engagement_id = v_eng_id
        AND COALESCE(f.lifecycle_status, 'Draft') <> 'Withdrawn'
        AND NOT EXISTS (SELECT 1 FROM public.ia_management_responses mr
                         WHERE mr.finding_id = f.id AND COALESCE(mr.is_current, true));
      IF v_responses_pending > 0 THEN
        v_reasons := v_reasons || ARRAY[v_responses_pending || ' finding(s) missing management response'];
      END IF;

      -- A response returned for clarification is not yet a response.
      SELECT count(*) INTO v_returned_open
      FROM public.ia_management_responses mr
      WHERE mr.engagement_id = v_eng_id AND COALESCE(mr.is_current, true)
        AND mr.status = 'Revision Requested';
      IF v_returned_open > 0 THEN
        v_reasons := v_reasons || ARRAY[v_returned_open || ' management response(s) returned for clarification and not yet resubmitted'];
      END IF;
    END IF;
  END IF;

  -- An open disagreement blocks issuance; a formally disposed one — including
  -- "Retained with Disagreement" — is accounted for and does not.
  IF v_eng_id IS NOT NULL THEN
    SELECT count(*) INTO v_disputes_open
    FROM public.ia_management_responses mr
    WHERE mr.engagement_id = v_eng_id AND COALESCE(mr.is_current, true)
      AND mr.dispute_state IN ('Disputed','Escalated') AND mr.dispute_disposition IS NULL;
    IF v_disputes_open > 0 THEN
      v_reasons := v_reasons || ARRAY[v_disputes_open || ' disputed management response(s) awaiting a formal dispute disposition'];
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.ia_communication_stages cs
      WHERE cs.engagement_id = v_eng_id AND cs.stage_code = 'DRAFT_FINDING_DISCUSSION'
        AND cs.delivery_status IN ('Sent','Delivered','Acknowledged')) INTO v_draft_discussion_done;
    IF NOT v_draft_discussion_done THEN
      v_reasons := v_reasons || ARRAY['Draft finding discussion must be completed with auditee before report issuance'];
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.ia_communication_stages cs
      WHERE cs.engagement_id = v_eng_id AND cs.stage_code = 'EXIT_MEETING'
        AND cs.delivery_status IN ('Sent','Delivered','Acknowledged')) INTO v_exit_meeting_done;
    IF NOT v_exit_meeting_done THEN
      v_reasons := v_reasons || ARRAY['Exit meeting must be completed before report issuance'];
    END IF;
  END IF;

  UPDATE public.ia_audit_reports SET issuance_gate_status = jsonb_build_object(
    'checked_at', now(), 'passed', array_length(v_reasons, 1) IS NULL,
    'evidence_count', v_evidence_count, 'working_papers_count', v_wp_count,
    'findings_count', v_findings_count, 'open_disputes', v_disputes_open,
    'reasons', to_jsonb(v_reasons)) WHERE id = p_report_id;

  RETURN jsonb_build_object('can_issue', array_length(v_reasons, 1) IS NULL, 'reasons', to_jsonb(v_reasons),
    'evidence_count', v_evidence_count, 'working_papers_count', v_wp_count,
    'findings_count', v_findings_count, 'open_disputes', v_disputes_open);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_resubmit_management_response(uuid, text, text, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_escalate_finding_dispute(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_dispose_finding_dispute(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_register_management_responses(jsonb) TO authenticated;
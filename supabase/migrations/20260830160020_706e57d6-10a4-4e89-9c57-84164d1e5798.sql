-- Internal Audit communication certification: bind the remaining catalogued
-- obligations to real business transitions (governed Omni-Comms emitters only).

-- Plan-level recipient resolver: lead auditor when resolvable, else head of audit.
CREATE OR REPLACE FUNCTION public.ia_comms_plan_recipient_fact(p_plan public.ia_annual_plans)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb := '{}'::jsonb;
  v_pid uuid;
BEGIN
  IF coalesce(p_plan.assigned_auditor,'') ~* '^[0-9a-f-]{36}$' THEN
    SELECT au.profile_id INTO v_pid FROM public.ia_auditors au
     WHERE au.id = p_plan.assigned_auditor::uuid;
    IF v_pid IS NULL THEN v_pid := p_plan.assigned_auditor::uuid; END IF;
    v := coalesce(public.ia_comms_profile_fact('lead_auditor', v_pid, 'Lead auditor'), '{}'::jsonb);
  END IF;
  IF v = '{}'::jsonb THEN
    v := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
  END IF;
  RETURN coalesce(v, '{}'::jsonb);
END;
$$;

-- 1. Annual plan decisions and closure
CREATE OR REPLACE FUNCTION public.ia_annual_plans_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recip jsonb;
  v_hoa jsonb;
  v_status text := upper(coalesce(NEW.status,''));
  v_old text := upper(coalesce(OLD.status,''));
  v_ref text := coalesce(NEW.fiscal_year, NEW.id::text);
  v_year text := coalesce(NEW.fiscal_year, 'Not stated');
  v_cf int;
BEGIN
  IF v_status = v_old THEN RETURN NEW; END IF;

  v_recip := public.ia_comms_plan_recipient_fact(NEW);
  v_hoa := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);

  IF v_status = 'APPROVED' AND v_recip <> '{}'::jsonb THEN
    PERFORM public.ia_comms_emit(
      'INTERNAL_AUDIT.PLAN.APPROVED', 'ia_annual_plan', NEW.id::text,
      'approved:' || coalesce(NEW.current_version_number,1)::text, v_recip,
      jsonb_build_object(
        'subjectName', coalesce(v_recip->'lead_auditor'->>'display_name',
                                v_recip->'head_of_audit'->>'display_name','Lead auditor'),
        'reference', v_ref,
        'planYear', v_year,
        'approvedOn', to_char(coalesce(NEW.approved_date, now()::date), 'DD Mon YYYY'),
        'approvedBy', coalesce(nullif(btrim(coalesce(NEW.approved_by,'')),''), 'Approving authority')),
      'internal_audit:plan_approved:' || NEW.id::text || ':' || coalesce(NEW.current_version_number,1)::text,
      NEW.department_id);

  ELSIF v_status = 'REJECTED' AND v_recip <> '{}'::jsonb THEN
    PERFORM public.ia_comms_emit(
      'INTERNAL_AUDIT.PLAN.REJECTED', 'ia_annual_plan', NEW.id::text,
      'rejected:' || coalesce(NEW.revision_count,0)::text, v_recip,
      jsonb_build_object(
        'subjectName', coalesce(v_recip->'lead_auditor'->>'display_name',
                                v_recip->'head_of_audit'->>'display_name','Lead auditor'),
        'reference', v_ref,
        'planYear', v_year,
        'decidedOn', to_char(coalesce(NEW.rejected_at, now()), 'DD Mon YYYY'),
        'decisionReason', coalesce(nullif(btrim(coalesce(NEW.approval_comments,'')),''), 'Not stated')),
      'internal_audit:plan_rejected:' || NEW.id::text || ':' || coalesce(NEW.revision_count,0)::text,
      NEW.department_id);

  ELSIF v_status IN ('REVISION REQUESTED','REVISION_REQUESTED','RETURNED FOR REVISION')
        AND v_recip <> '{}'::jsonb THEN
    PERFORM public.ia_comms_emit(
      'INTERNAL_AUDIT.PLAN.REVISION_REQUESTED', 'ia_annual_plan', NEW.id::text,
      'revision:' || coalesce(NEW.revision_count,0)::text, v_recip,
      jsonb_build_object(
        'subjectName', coalesce(v_recip->'lead_auditor'->>'display_name',
                                v_recip->'head_of_audit'->>'display_name','Lead auditor'),
        'reference', v_ref,
        'planYear', v_year,
        'requestedOn', to_char(now(), 'DD Mon YYYY'),
        'revisionReason', coalesce(nullif(btrim(coalesce(NEW.approval_comments,'')),''), 'Revision requested by the approving authority')),
      'internal_audit:plan_revision_requested:' || NEW.id::text || ':' || coalesce(NEW.revision_count,0)::text,
      NEW.department_id);

  ELSIF v_status = 'CLOSED' AND v_hoa <> '{}'::jsonb THEN
    SELECT count(*) INTO v_cf FROM public.ia_plan_carry_forward cf WHERE cf.annual_plan_id = NEW.id;
    PERFORM public.ia_comms_emit(
      'INTERNAL_AUDIT.PLAN.CLOSED', 'ia_annual_plan', NEW.id::text, 'closed', v_hoa,
      jsonb_build_object(
        'subjectName', coalesce(v_hoa->'head_of_audit'->>'display_name','Head of Internal Audit'),
        'reference', v_ref,
        'planYear', v_year,
        'closedOn', to_char(coalesce(NEW.closed_date, now()::date), 'DD Mon YYYY'),
        'carriedForwardCount', coalesce(v_cf,0)::text),
      'internal_audit:plan_closed:' || NEW.id::text,
      NEW.department_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_annual_plans_comms_trg ON public.ia_annual_plans;
CREATE TRIGGER zz_ia_annual_plans_comms_trg
AFTER UPDATE ON public.ia_annual_plans
FOR EACH ROW EXECUTE FUNCTION public.ia_annual_plans_comms_trg();

-- 2. Corrective action extension request / decision
CREATE OR REPLACE FUNCTION public.ia_action_extensions_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_act record;
  v_ctx jsonb;
  v_hoa jsonb;
  v_owner jsonb;
  v_title text;
  v_ref text;
BEGIN
  SELECT a.* INTO v_act FROM public.ia_action_tracking a WHERE a.id = NEW.action_id;
  IF v_act.id IS NULL THEN RETURN NEW; END IF;

  v_ctx := public.ia_comms_ctx(coalesce(NEW.engagement_id, v_act.engagement_id));
  v_title := coalesce(nullif(btrim(coalesce(v_act.action_description,'')),''), 'Corrective action');
  v_ref := coalesce(v_act.action_ref, v_act.id::text);

  IF TG_OP = 'INSERT' THEN
    v_hoa := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
    IF v_hoa <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.ACTION.EXTENSION_REQUESTED', 'ia_action', v_act.id::text,
        'extension_requested:' || NEW.id::text, v_hoa,
        jsonb_build_object(
          'subjectName', coalesce(v_hoa->'head_of_audit'->>'display_name','Head of Internal Audit'),
          'reference', v_ref,
          'actionTitle', v_title,
          'targetDate', to_char(coalesce(NEW.previous_target_date, v_act.current_target_date, v_act.target_date, current_date), 'DD Mon YYYY'),
          'requestedDate', to_char(coalesce(NEW.new_target_date, NEW.proposed_date, current_date), 'DD Mon YYYY'),
          'extensionReason', coalesce(nullif(btrim(coalesce(NEW.reason,'')),''), 'Not stated')),
        'internal_audit:action_extension_requested:' || NEW.id::text,
        coalesce(v_act.department_id, (v_ctx->>'department_id')::uuid));
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.decided_at IS NOT NULL AND OLD.decided_at IS NULL THEN
    v_owner := public.ia_comms_profile_fact('action_owner', v_act.responsible_profile_id, v_act.responsible_person);
    IF v_owner <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.ACTION.EXTENSION_DECIDED', 'ia_action', v_act.id::text,
        'extension_decided:' || NEW.id::text, v_owner,
        jsonb_build_object(
          'subjectName', coalesce(v_owner->'action_owner'->>'display_name','Action owner'),
          'reference', v_ref,
          'actionTitle', v_title,
          'extensionOutcome', coalesce(nullif(btrim(coalesce(NEW.status,'')),''), 'Decided'),
          'targetDate', to_char(coalesce(NEW.new_target_date, v_act.current_target_date, v_act.target_date, current_date), 'DD Mon YYYY'),
          'decisionReason', coalesce(nullif(btrim(coalesce(NEW.decision_comments,'')),''), 'Not stated')),
        'internal_audit:action_extension_decided:' || NEW.id::text,
        coalesce(v_act.department_id, (v_ctx->>'department_id')::uuid));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_action_extensions_comms_trg ON public.ia_action_extensions;
CREATE TRIGGER zz_ia_action_extensions_comms_trg
AFTER INSERT OR UPDATE ON public.ia_action_extensions
FOR EACH ROW EXECUTE FUNCTION public.ia_action_extensions_comms_trg();

-- 3. Corrective action progress updates
CREATE OR REPLACE FUNCTION public.ia_action_progress_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb;
  v_lead jsonb;
BEGIN
  IF NEW.management_completion_date IS NOT NULL AND OLD.management_completion_date IS NULL THEN
    RETURN NEW; -- completion has its own obligation
  END IF;
  IF NEW.latest_update_at IS NOT DISTINCT FROM OLD.latest_update_at
     AND NEW.progress_pct IS NOT DISTINCT FROM OLD.progress_pct THEN
    RETURN NEW;
  END IF;

  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  v_lead := public.ia_comms_escalation_fact('lead_auditor',
              coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid), NEW.engagement_id);
  IF v_lead = '{}'::jsonb THEN RETURN NEW; END IF;

  PERFORM public.ia_comms_emit(
    'INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED', 'ia_action', NEW.id::text,
    'progress:' || to_char(coalesce(NEW.latest_update_at, now()), 'YYYYMMDDHH24MISS'), v_lead,
    jsonb_build_object(
      'subjectName', coalesce(v_lead->'lead_auditor'->>'display_name','Lead auditor'),
      'reference', coalesce(NEW.action_ref, NEW.id::text),
      'actionTitle', coalesce(nullif(btrim(coalesce(NEW.action_description,'')),''), 'Corrective action'),
      'progressPercent', coalesce(NEW.progress_pct, 0)::text,
      'progressNote', coalesce(nullif(btrim(coalesce(NEW.latest_update,'')),''), 'Progress update recorded')),
    'internal_audit:action_progress:' || NEW.id::text || ':' ||
      to_char(coalesce(NEW.latest_update_at, now()), 'YYYYMMDDHH24MISS'),
    coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_action_progress_comms_trg ON public.ia_action_tracking;
CREATE TRIGGER zz_ia_action_progress_comms_trg
AFTER UPDATE ON public.ia_action_tracking
FOR EACH ROW EXECUTE FUNCTION public.ia_action_progress_comms_trg();

-- 4. Finding severity re-grading after release
CREATE OR REPLACE FUNCTION public.ia_findings_severity_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb;
  v_hoa jsonb;
BEGIN
  IF NEW.released_at IS NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.severity, NEW.risk_rating) IS NOT DISTINCT FROM coalesce(OLD.severity, OLD.risk_rating) THEN
    RETURN NEW;
  END IF;

  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  v_hoa := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
  IF v_hoa = '{}'::jsonb THEN RETURN NEW; END IF;

  PERFORM public.ia_comms_emit(
    'INTERNAL_AUDIT.FINDING.SEVERITY_CHANGED', 'ia_audit_finding', NEW.id::text,
    'severity:' || coalesce(NEW.severity, NEW.risk_rating, 'unspecified'), v_hoa,
    jsonb_build_object(
      'subjectName', coalesce(v_hoa->'head_of_audit'->>'display_name','Head of Internal Audit'),
      'reference', coalesce(NEW.finding_id, NEW.id::text),
      'findingTitle', coalesce(NEW.title, 'Audit finding'),
      'previousSeverity', coalesce(OLD.severity, OLD.risk_rating, 'Not stated'),
      'severity', coalesce(NEW.severity, NEW.risk_rating, 'Not stated'),
      'changeReason', 'Severity re-graded by Internal Audit'),
    'internal_audit:finding_severity_changed:' || NEW.id::text || ':' ||
      coalesce(NEW.severity, NEW.risk_rating, 'unspecified'),
    coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_findings_severity_comms_trg ON public.ia_findings;
CREATE TRIGGER zz_ia_findings_severity_comms_trg
AFTER UPDATE ON public.ia_findings
FOR EACH ROW EXECUTE FUNCTION public.ia_findings_severity_comms_trg();

-- 5. Information request fulfilled (closure acknowledgement to the auditee)
CREATE OR REPLACE FUNCTION public.ia_document_requests_fulfilled_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb;
  v_auditee jsonb;
BEGIN
  IF upper(coalesce(NEW.status,'')) NOT IN ('FULFILLED','COMPLETED','CLOSED') THEN RETURN NEW; END IF;
  IF upper(coalesce(OLD.status,'')) = upper(coalesce(NEW.status,'')) THEN RETURN NEW; END IF;

  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  IF v_ctx IS NULL THEN RETURN NEW; END IF;

  v_auditee := public.ia_comms_auditee_fact(NEW.engagement_id);
  IF v_auditee = '{}'::jsonb THEN RETURN NEW; END IF;

  PERFORM public.ia_comms_emit(
    'INTERNAL_AUDIT.REQUEST.FULFILLED', 'ia_information_request', NEW.id::text, 'fulfilled', v_auditee,
    jsonb_build_object(
      'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
      'reference', NEW.id::text,
      'requestSummary', coalesce(nullif(btrim(coalesce(NEW.document_title,'')),''), 'Information request'),
      'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement')),
    'internal_audit:request_fulfilled:' || NEW.id::text,
    (v_ctx->>'department_id')::uuid);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_document_requests_fulfilled_comms_trg ON public.ia_document_requests;
CREATE TRIGGER zz_ia_document_requests_fulfilled_comms_trg
AFTER UPDATE ON public.ia_document_requests
FOR EACH ROW EXECUTE FUNCTION public.ia_document_requests_fulfilled_comms_trg();

-- 6. Follow-up carried forward into a later plan year
CREATE OR REPLACE FUNCTION public.ia_plan_carry_forward_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoa jsonb;
  v_from text;
BEGIN
  v_hoa := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
  IF v_hoa = '{}'::jsonb THEN RETURN NEW; END IF;

  SELECT p.fiscal_year INTO v_from FROM public.ia_annual_plans p WHERE p.id = NEW.annual_plan_id;

  PERFORM public.ia_comms_emit(
    'INTERNAL_AUDIT.FOLLOWUP.CARRIED_FORWARD', 'ia_followup', NEW.id::text, 'carried_forward', v_hoa,
    jsonb_build_object(
      'subjectName', coalesce(v_hoa->'head_of_audit'->>'display_name','Head of Internal Audit'),
      'reference', coalesce(NEW.source_reference, NEW.id::text),
      'followupSubject', coalesce(nullif(btrim(coalesce(NEW.description,'')),''), 'Carried-forward audit item'),
      'fromPlanYear', coalesce(v_from, 'Not stated'),
      'toPlanYear', coalesce(NEW.target_fiscal_year, 'Next plan year')),
    'internal_audit:followup_carried_forward:' || NEW.id::text,
    NEW.department_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_plan_carry_forward_comms_trg ON public.ia_plan_carry_forward;
CREATE TRIGGER zz_ia_plan_carry_forward_comms_trg
AFTER INSERT ON public.ia_plan_carry_forward
FOR EACH ROW EXECUTE FUNCTION public.ia_plan_carry_forward_comms_trg();

-- 7. Engagement fieldwork completed
CREATE OR REPLACE FUNCTION public.ia_engagement_fieldwork_comms_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoa jsonb;
  v_findings int;
BEGIN
  IF NEW.actual_end_date IS NULL OR OLD.actual_end_date IS NOT NULL THEN RETURN NEW; END IF;

  v_hoa := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
  IF v_hoa = '{}'::jsonb THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_findings FROM public.ia_findings f WHERE f.engagement_id = NEW.id;

  PERFORM public.ia_comms_emit(
    'INTERNAL_AUDIT.ENGAGEMENT.FIELDWORK_COMPLETED', 'ia_audit_engagement', NEW.id::text,
    'fieldwork_completed', v_hoa,
    jsonb_build_object(
      'subjectName', coalesce(v_hoa->'head_of_audit'->>'display_name','Head of Internal Audit'),
      'reference', coalesce(NEW.engagement_code, NEW.id::text),
      'engagementTitle', coalesce(NEW.engagement_name, 'Internal audit engagement'),
      'completedOn', to_char(NEW.actual_end_date, 'DD Mon YYYY'),
      'findingCount', coalesce(v_findings,0)::text),
    'internal_audit:engagement_fieldwork_completed:' || NEW.id::text,
    NEW.department_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_engagement_fieldwork_comms_trg ON public.ia_audit_engagements;
CREATE TRIGGER zz_ia_engagement_fieldwork_comms_trg
AFTER UPDATE ON public.ia_audit_engagements
FOR EACH ROW EXECUTE FUNCTION public.ia_engagement_fieldwork_comms_trg();
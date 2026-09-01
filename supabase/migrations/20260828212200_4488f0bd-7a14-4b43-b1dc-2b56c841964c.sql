-- ============================================================
-- DEF-S1B-47 / 48 / 49 / 50 / 51 — database-owned communication
-- obligations for the Internal Audit lifecycle.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.ia_schedule_engagement(uuid, date, date, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ia_reschedule_engagement(uuid, date, date, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ia_postpone_engagement(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ia_cancel_engagement(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ia_comms_emit_mandatory(text,text,text,text,jsonb,jsonb,text,uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ia_comms_auditee_fact(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ia_comms_contract_project(text, jsonb) FROM anon, public;

ALTER TABLE public.ia_findings
  ADD COLUMN IF NOT EXISTS response_due_date date,
  ADD COLUMN IF NOT EXISTS response_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_requested_by text;

CREATE TABLE IF NOT EXISTS public.ia_comms_obligation_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL UNIQUE,
  days integer NOT NULL,
  description text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ia_comms_obligation_policy TO authenticated;
GRANT ALL ON public.ia_comms_obligation_policy TO service_role;
ALTER TABLE public.ia_comms_obligation_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ia_comms_obligation_policy_read ON public.ia_comms_obligation_policy;
CREATE POLICY ia_comms_obligation_policy_read
  ON public.ia_comms_obligation_policy FOR SELECT TO authenticated USING (true);
DROP TRIGGER IF EXISTS ia_comms_obligation_policy_touch ON public.ia_comms_obligation_policy;
CREATE TRIGGER ia_comms_obligation_policy_touch BEFORE UPDATE ON public.ia_comms_obligation_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ia_comms_obligation_policy (policy_code, days, description) VALUES
  ('management_response_window_days', 14, 'Window given to management to respond to a released finding'),
  ('information_request_due_soon_days', 3, 'Days before an information request due date at which a due-soon notice is issued'),
  ('information_request_overdue_repeat_days', 7, 'Interval between repeat overdue notices for an information request')
ON CONFLICT (policy_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ia_comms_policy_days(p_code text, p_default integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce((SELECT days FROM public.ia_comms_obligation_policy WHERE policy_code = p_code AND is_enabled), p_default);
$function$;

CREATE OR REPLACE FUNCTION public.ia_comms_ctx(p_engagement_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'engagement_id', e.id,
    'reference', coalesce(e.engagement_code, e.id::text),
    'title', coalesce(e.engagement_name, 'Internal audit engagement'),
    'department_id', e.department_id,
    'department_name', coalesce(d.name, 'Audited department'))
  FROM public.ia_audit_engagements e
  LEFT JOIN public.ia_departments d ON d.id = e.department_id
  WHERE e.id = p_engagement_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.ia_comms_ctx(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ia_comms_ctx(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ia_comms_policy_days(text, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ia_comms_policy_days(text, integer) TO authenticated, service_role;

-- DEF-S1B-49 — finding release formally issues the response obligation
CREATE OR REPLACE FUNCTION public.ia_findings_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb;
  v_head jsonb;
  v_due date;
BEGIN
  IF NEW.released_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.released_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  IF v_ctx IS NULL THEN RETURN NEW; END IF;

  v_due := coalesce(NEW.response_due_date,
                    NEW.released_at::date + public.ia_comms_policy_days('management_response_window_days', 14));

  UPDATE public.ia_findings
     SET response_due_date = v_due,
         response_requested_at = coalesce(response_requested_at, NEW.released_at),
         response_requested_by = coalesce(response_requested_by, NEW.released_by)
   WHERE id = NEW.id;

  v_head := public.ia_comms_escalation_fact('department_head', (v_ctx->>'department_id')::uuid, NEW.engagement_id);
  IF v_head = '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IA_COMMS_RESPONSE_RECIPIENT_REQUIRED',
      DETAIL = 'A finding cannot be released for management response without a resolvable department head';
  END IF;

  PERFORM public.ia_comms_emit_mandatory(
    'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED', 'ia_audit_finding', NEW.id::text, 'release',
    v_head,
    jsonb_build_object(
      'subjectName', coalesce(v_head->'department_head'->>'display_name','Head of department'),
      'reference', coalesce(NEW.finding_id, NEW.id::text),
      'findingTitle', coalesce(NEW.title, 'Audit finding'),
      'severity', coalesce(NEW.severity, NEW.risk_rating, 'Not stated'),
      'dueDate', to_char(v_due, 'DD Mon YYYY')),
    'internal_audit:finding_response_requested:' || NEW.id::text,
    (v_ctx->>'department_id')::uuid);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_findings_comms ON public.ia_findings;
CREATE TRIGGER ia_findings_comms
  AFTER INSERT OR UPDATE OF released_at ON public.ia_findings
  FOR EACH ROW EXECUTE FUNCTION public.ia_findings_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_management_responses_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_f record;
  v_ctx jsonb;
  v_head jsonb;
  v_event text;
BEGIN
  IF NEW.review_outcome IS NULL OR NEW.review_outcome IS NOT DISTINCT FROM OLD.review_outcome THEN
    RETURN NEW;
  END IF;

  IF upper(NEW.review_outcome) IN ('ACCEPTED','ACCEPT','APPROVED') THEN
    v_event := 'INTERNAL_AUDIT.FINDING.RESPONSE_ACCEPTED';
  ELSIF upper(NEW.review_outcome) IN ('RETURNED','REJECTED','RETURN','CLARIFICATION_REQUIRED') THEN
    v_event := 'INTERNAL_AUDIT.FINDING.RESPONSE_REJECTED';
  ELSE
    RETURN NEW;
  END IF;

  SELECT * INTO v_f FROM public.ia_findings WHERE id = NEW.finding_id;
  IF v_f IS NULL THEN RETURN NEW; END IF;
  v_ctx := public.ia_comms_ctx(coalesce(NEW.engagement_id, v_f.engagement_id));
  IF v_ctx IS NULL THEN RETURN NEW; END IF;

  v_head := public.ia_comms_escalation_fact('department_head', (v_ctx->>'department_id')::uuid, (v_ctx->>'engagement_id')::uuid);
  IF v_head = '{}'::jsonb THEN RETURN NEW; END IF;

  PERFORM public.ia_comms_emit(
    v_event, 'ia_audit_finding', v_f.id::text, 'review:v' || coalesce(NEW.response_version, 1)::text,
    v_head,
    jsonb_build_object(
      'subjectName', coalesce(v_head->'department_head'->>'display_name','Head of department'),
      'reference', coalesce(v_f.finding_id, v_f.id::text),
      'findingTitle', coalesce(v_f.title,'Audit finding'),
      'decidedOn', to_char(coalesce(NEW.reviewed_at, now()), 'DD Mon YYYY'),
      'reviewerComment', coalesce(nullif(btrim(coalesce(NEW.rejection_rationale, NEW.clarification_request, NEW.audit_conclusion, '')), ''), 'See the audit file for the full review note'),
      'dueDate', to_char(coalesce(NEW.official_target_date, NEW.due_date, v_f.response_due_date, current_date + 14), 'DD Mon YYYY')),
    'internal_audit:response_review:' || NEW.id::text || ':' || coalesce(NEW.response_version,1)::text,
    (v_ctx->>'department_id')::uuid);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_management_responses_comms ON public.ia_management_responses;
CREATE TRIGGER ia_management_responses_comms
  AFTER UPDATE OF review_outcome ON public.ia_management_responses
  FOR EACH ROW EXECUTE FUNCTION public.ia_management_responses_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_audit_reports_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb;
  v_head jsonb;
BEGIN
  IF NEW.issued_at IS NULL OR (TG_OP='UPDATE' AND OLD.issued_at IS NOT NULL) THEN RETURN NEW; END IF;

  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  IF v_ctx IS NULL THEN RETURN NEW; END IF;

  v_head := public.ia_comms_escalation_fact('department_head', (v_ctx->>'department_id')::uuid, NEW.engagement_id);
  IF v_head = '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='IA_COMMS_REPORT_RECIPIENT_REQUIRED',
      DETAIL='A final report cannot be issued without a resolvable audited-department head';
  END IF;

  PERFORM public.ia_comms_emit_mandatory(
    'INTERNAL_AUDIT.REPORT.ISSUED', 'ia_audit_report', NEW.id::text,
    'v' || coalesce(NEW.current_version_number,1)::text,
    v_head,
    jsonb_build_object(
      'subjectName', coalesce(v_head->'department_head'->>'display_name','Head of department'),
      'reference', coalesce(NEW.report_number, NEW.id::text),
      'engagementTitle', v_ctx->>'title',
      'issuedOn', to_char(NEW.issued_at, 'DD Mon YYYY'),
      'versionNumber', coalesce(NEW.current_version_number,1)::text,
      'overallOpinion', coalesce(nullif(btrim(coalesce(NEW.overall_assessment,'')),''), coalesce(NEW.risk_rating,'Not stated'))),
    'internal_audit:report_issued:' || NEW.id::text,
    (v_ctx->>'department_id')::uuid);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_audit_reports_comms ON public.ia_audit_reports;
CREATE TRIGGER ia_audit_reports_comms
  AFTER INSERT OR UPDATE OF issued_at ON public.ia_audit_reports
  FOR EACH ROW EXECUTE FUNCTION public.ia_audit_reports_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_engagement_closure_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_hia jsonb;
  v_open integer;
BEGIN
  IF NEW.execution_status NOT IN ('Closed','Closed – Actions Pending')
     OR NEW.execution_status IS NOT DISTINCT FROM OLD.execution_status THEN
    RETURN NEW;
  END IF;

  v_hia := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
  IF v_hia = '{}'::jsonb THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_open FROM public.ia_action_tracking a
   WHERE a.engagement_id = NEW.id AND coalesce(a.lifecycle_status, a.status, 'Open') NOT IN ('Closed','Cancelled');

  PERFORM public.ia_comms_emit(
    'INTERNAL_AUDIT.ENGAGEMENT.CLOSED', 'ia_audit_engagement', NEW.id::text,
    'closure:' || NEW.execution_status,
    v_hia,
    jsonb_build_object(
      'subjectName', coalesce(v_hia->'head_of_audit'->>'display_name','Head of Internal Audit'),
      'reference', coalesce(NEW.engagement_code, NEW.id::text),
      'engagementTitle', coalesce(NEW.engagement_name,'Internal audit engagement'),
      'closedOn', to_char(coalesce(NEW.closure_date, current_date), 'DD Mon YYYY'),
      'openActionCount', coalesce(v_open,0)::text),
    'internal_audit:engagement_closed:' || NEW.id::text,
    NEW.department_id);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_engagement_closure_comms ON public.ia_audit_engagements;
CREATE TRIGGER ia_engagement_closure_comms
  AFTER UPDATE OF execution_status ON public.ia_audit_engagements
  FOR EACH ROW EXECUTE FUNCTION public.ia_engagement_closure_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_action_tracking_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb;
  v_owner jsonb;
  v_lead jsonb;
  v_ref text;
  v_title text;
  v_target text;
BEGIN
  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  v_ref := coalesce(NEW.action_ref, NEW.id::text);
  v_title := coalesce(nullif(btrim(coalesce(NEW.action_description,'')),''), 'Corrective action');
  v_target := to_char(coalesce(NEW.current_target_date, NEW.target_date, current_date), 'DD Mon YYYY');
  v_owner := public.ia_comms_profile_fact('action_owner', NEW.responsible_profile_id, NEW.responsible_person);
  v_lead := public.ia_comms_escalation_fact('lead_auditor', coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid), NEW.engagement_id);

  IF NEW.responsible_profile_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.responsible_profile_id IS DISTINCT FROM NEW.responsible_profile_id)
     AND v_owner <> '{}'::jsonb THEN
    PERFORM public.ia_comms_emit_mandatory(
      'INTERNAL_AUDIT.ACTION.ASSIGNED', 'ia_action', NEW.id::text,
      'owner:' || NEW.responsible_profile_id::text, v_owner,
      jsonb_build_object(
        'subjectName', coalesce(v_owner->'action_owner'->>'display_name','Action owner'),
        'reference', v_ref, 'actionTitle', v_title,
        'severity', coalesce(NEW.verification_status, 'Normal'),
        'targetDate', v_target,
        'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement')),
      'internal_audit:action_assigned:' || NEW.id::text || ':' || NEW.responsible_profile_id::text,
      coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.management_completion_date IS NOT NULL
       AND OLD.management_completion_date IS NULL
       AND v_lead <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.ACTION.COMPLETION_SUBMITTED', 'ia_action', NEW.id::text, 'completion', v_lead,
        jsonb_build_object(
          'subjectName', coalesce(v_lead->'lead_auditor'->>'display_name','Lead auditor'),
          'reference', v_ref, 'actionTitle', v_title,
          'submittedOn', to_char(NEW.management_completion_date, 'DD Mon YYYY'),
          'completionSummary', coalesce(nullif(btrim(coalesce(NEW.latest_update,'')),''),'Completion evidence submitted for verification')),
        'internal_audit:action_completion:' || NEW.id::text,
        coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));
    END IF;

    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
       AND v_owner <> '{}'::jsonb THEN
      IF upper(coalesce(NEW.verification_status,'')) IN ('VERIFIED','ACCEPTED') THEN
        PERFORM public.ia_comms_emit(
          'INTERNAL_AUDIT.ACTION.VERIFIED', 'ia_action', NEW.id::text, 'verified', v_owner,
          jsonb_build_object(
            'subjectName', coalesce(v_owner->'action_owner'->>'display_name','Action owner'),
            'reference', v_ref, 'actionTitle', v_title,
            'verifiedOn', to_char(coalesce(NEW.verified_at, now()), 'DD Mon YYYY'),
            'verificationComment', coalesce(nullif(btrim(coalesce(NEW.verification_notes,'')),''),'Verified by Internal Audit')),
          'internal_audit:action_verified:' || NEW.id::text,
          coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));
      ELSIF upper(coalesce(NEW.verification_status,'')) IN ('REJECTED','VERIFICATION_REJECTED','RETURNED') THEN
        PERFORM public.ia_comms_emit(
          'INTERNAL_AUDIT.ACTION.VERIFICATION_REJECTED', 'ia_action', NEW.id::text,
          'verification_rejected:' || coalesce(NEW.reopen_count,0)::text, v_owner,
          jsonb_build_object(
            'subjectName', coalesce(v_owner->'action_owner'->>'display_name','Action owner'),
            'reference', v_ref, 'actionTitle', v_title,
            'decidedOn', to_char(now(), 'DD Mon YYYY'),
            'rejectionReason', coalesce(nullif(btrim(coalesce(NEW.verification_notes,'')),''),'Further evidence required'),
            'targetDate', v_target),
          'internal_audit:action_verification_rejected:' || NEW.id::text || ':' || coalesce(NEW.reopen_count,0)::text,
          coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));
      END IF;
    END IF;

    IF coalesce(NEW.lifecycle_status, NEW.status) = 'Closed'
       AND coalesce(OLD.lifecycle_status, OLD.status) IS DISTINCT FROM coalesce(NEW.lifecycle_status, NEW.status)
       AND v_owner <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.ACTION.CLOSED', 'ia_action', NEW.id::text, 'closed', v_owner,
        jsonb_build_object(
          'subjectName', coalesce(v_owner->'action_owner'->>'display_name','Action owner'),
          'reference', v_ref, 'actionTitle', v_title,
          'closedOn', to_char(coalesce(NEW.closure_date, current_date), 'DD Mon YYYY'),
          'closureBasis', coalesce(nullif(btrim(coalesce(NEW.closure_notes,'')),''),'Closed by Internal Audit')),
        'internal_audit:action_closed:' || NEW.id::text,
        coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_action_tracking_comms ON public.ia_action_tracking;
CREATE TRIGGER ia_action_tracking_comms
  AFTER INSERT OR UPDATE ON public.ia_action_tracking
  FOR EACH ROW EXECUTE FUNCTION public.ia_action_tracking_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_follow_ups_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb;
  v_lead jsonb;
  v_hia jsonb;
  v_subject text;
BEGIN
  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  v_subject := coalesce(nullif(btrim(coalesce(NEW.action_required,'')),''), 'Follow-up review');

  IF NEW.scheduled_follow_up_date IS NOT NULL
     AND (TG_OP='INSERT' OR OLD.scheduled_follow_up_date IS DISTINCT FROM NEW.scheduled_follow_up_date) THEN
    v_lead := public.ia_comms_escalation_fact('lead_auditor', coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid), NEW.engagement_id);
    IF v_lead <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit_mandatory(
        'INTERNAL_AUDIT.FOLLOWUP.SCHEDULED', 'ia_follow_up', NEW.id::text,
        'scheduled:' || to_char(NEW.scheduled_follow_up_date,'YYYYMMDD'), v_lead,
        jsonb_build_object(
          'subjectName', coalesce(v_lead->'lead_auditor'->>'display_name','Lead auditor'),
          'reference', NEW.id::text,
          'followupSubject', v_subject,
          'scheduledFor', to_char(NEW.scheduled_follow_up_date,'DD Mon YYYY'),
          'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement')),
        'internal_audit:followup_scheduled:' || NEW.id::text || ':' || to_char(NEW.scheduled_follow_up_date,'YYYYMMDD'),
        coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));
    END IF;
  END IF;

  IF TG_OP='UPDATE' AND NEW.outcome IS NOT NULL AND OLD.outcome IS DISTINCT FROM NEW.outcome THEN
    v_hia := public.ia_comms_escalation_fact('head_of_audit', NULL, NULL);
    IF v_hia <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.FOLLOWUP.OUTCOME_RECORDED', 'ia_follow_up', NEW.id::text,
        'outcome:' || NEW.outcome, v_hia,
        jsonb_build_object(
          'subjectName', coalesce(v_hia->'head_of_audit'->>'display_name','Head of Internal Audit'),
          'reference', NEW.id::text,
          'followupSubject', v_subject,
          'recordedOn', to_char(coalesce(NEW.verified_at, now()),'DD Mon YYYY'),
          'followupOutcome', NEW.outcome),
        'internal_audit:followup_outcome:' || NEW.id::text,
        coalesce(NEW.department_id, (v_ctx->>'department_id')::uuid));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_follow_ups_comms ON public.ia_follow_ups;
CREATE TRIGGER ia_follow_ups_comms
  AFTER INSERT OR UPDATE ON public.ia_follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.ia_follow_ups_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_document_requests_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb;
  v_auditee jsonb;
  v_lead jsonb;
  v_summary text;
BEGIN
  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  IF v_ctx IS NULL THEN RETURN NEW; END IF;
  v_summary := coalesce(nullif(btrim(coalesce(NEW.document_title,'')),''), 'Information requested by Internal Audit');

  IF TG_OP='INSERT' THEN
    v_auditee := public.ia_comms_auditee_fact(NEW.engagement_id);
    IF v_auditee <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.REQUEST.ISSUED', 'ia_information_request', NEW.id::text, 'issued', v_auditee,
        jsonb_build_object(
          'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
          'reference', NEW.id::text,
          'requestSummary', v_summary,
          'dueDate', to_char(coalesce(NEW.due_date, current_date + 7),'DD Mon YYYY'),
          'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement')),
        'internal_audit:request_issued:' || NEW.id::text,
        (v_ctx->>'department_id')::uuid);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.received_date IS NOT NULL AND OLD.received_date IS NULL THEN
    v_lead := public.ia_comms_escalation_fact('lead_auditor', (v_ctx->>'department_id')::uuid, NEW.engagement_id);
    IF v_lead <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.REQUEST.RESPONSE_RECEIVED', 'ia_information_request', NEW.id::text,
        'response_received', v_lead,
        jsonb_build_object(
          'subjectName', coalesce(v_lead->'lead_auditor'->>'display_name','Lead auditor'),
          'reference', NEW.id::text,
          'requestSummary', v_summary,
          'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement'),
          'receivedOn', to_char(NEW.received_date,'DD Mon YYYY'),
          'responseSummary', coalesce(nullif(btrim(coalesce(NEW.notes,'')),''),'Response supplied by the auditee')),
        'internal_audit:request_response_received:' || NEW.id::text,
        (v_ctx->>'department_id')::uuid);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_document_requests_comms ON public.ia_document_requests;
CREATE TRIGGER ia_document_requests_comms
  AFTER INSERT OR UPDATE ON public.ia_document_requests
  FOR EACH ROW EXECUTE FUNCTION public.ia_document_requests_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_audit_queries_comms_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ctx jsonb;
  v_auditee jsonb;
  v_lead jsonb;
  v_summary text;
BEGIN
  v_ctx := public.ia_comms_ctx(NEW.engagement_id);
  IF v_ctx IS NULL THEN RETURN NEW; END IF;
  v_summary := coalesce(nullif(btrim(coalesce(NEW.question,'')),''), 'Audit query');

  IF TG_OP='INSERT' THEN
    v_auditee := public.ia_comms_auditee_fact(NEW.engagement_id);
    IF v_auditee <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.QUERY.ISSUED', 'ia_audit_query', NEW.id::text, 'issued', v_auditee,
        jsonb_build_object(
          'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
          'reference', NEW.id::text,
          'querySummary', v_summary,
          'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement'),
          'dueDate', to_char(coalesce(NEW.requested_date::date, current_date) + 7,'DD Mon YYYY')),
        'internal_audit:query_issued:' || NEW.id::text,
        (v_ctx->>'department_id')::uuid);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.response IS NOT NULL AND OLD.response IS DISTINCT FROM NEW.response THEN
    v_lead := public.ia_comms_escalation_fact('lead_auditor', (v_ctx->>'department_id')::uuid, NEW.engagement_id);
    IF v_lead <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.QUERY.RESPONSE_RECEIVED', 'ia_audit_query', NEW.id::text,
        'response:' || md5(coalesce(NEW.response,'')), v_lead,
        jsonb_build_object(
          'subjectName', coalesce(v_lead->'lead_auditor'->>'display_name','Lead auditor'),
          'reference', NEW.id::text,
          'querySummary', v_summary,
          'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement'),
          'receivedOn', to_char(coalesce(NEW.response_date, now()),'DD Mon YYYY'),
          'responseSummary', left(NEW.response, 500)),
        'internal_audit:query_response:' || NEW.id::text || ':' || md5(coalesce(NEW.response,'')),
        (v_ctx->>'department_id')::uuid);
    END IF;
  END IF;

  IF upper(coalesce(NEW.status,'')) IN ('CLARIFICATION_REQUESTED','CLARIFICATION REQUIRED')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_auditee := public.ia_comms_auditee_fact(NEW.engagement_id);
    IF v_auditee <> '{}'::jsonb THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.QUERY.CLARIFICATION_REQUESTED', 'ia_audit_query', NEW.id::text,
        'clarification:' || to_char(now(),'YYYYMMDDHH24MI'), v_auditee,
        jsonb_build_object(
          'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
          'reference', NEW.id::text,
          'querySummary', v_summary,
          'engagementTitle', coalesce(v_ctx->>'title','Internal audit engagement'),
          'clarificationSummary', coalesce(nullif(btrim(coalesce(NEW.requested_document,'')),''),'Further explanation required'),
          'dueDate', to_char(current_date + 5,'DD Mon YYYY')),
        'internal_audit:query_clarification:' || NEW.id::text || ':' || to_char(now(),'YYYYMMDDHH24MI'),
        (v_ctx->>'department_id')::uuid);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ia_audit_queries_comms ON public.ia_audit_queries;
CREATE TRIGGER ia_audit_queries_comms
  AFTER INSERT OR UPDATE ON public.ia_audit_queries
  FOR EACH ROW EXECUTE FUNCTION public.ia_audit_queries_comms_trg();

CREATE OR REPLACE FUNCTION public.ia_comms_generate_request_reminders(p_today date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_today date := coalesce(p_today, current_date);
  v_soon integer := public.ia_comms_policy_days('information_request_due_soon_days', 3);
  v_repeat integer := public.ia_comms_policy_days('information_request_overdue_repeat_days', 7);
  r record;
  v_ctx jsonb;
  v_auditee jsonb;
  v_emitted integer := 0;
  v_days integer;
BEGIN
  FOR r IN
    SELECT dr.* FROM public.ia_document_requests dr
    WHERE coalesce(dr.is_active, true)
      AND dr.received_date IS NULL
      AND upper(coalesce(dr.status,'')) NOT IN ('FULFILLED','RECEIVED','CANCELLED','CLOSED')
      AND dr.due_date IS NOT NULL
      AND dr.due_date <= v_today + v_soon
  LOOP
    v_ctx := public.ia_comms_ctx(r.engagement_id);
    CONTINUE WHEN v_ctx IS NULL;
    v_auditee := public.ia_comms_auditee_fact(r.engagement_id);
    CONTINUE WHEN v_auditee = '{}'::jsonb;

    v_days := v_today - r.due_date;

    IF v_days < 0 THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.REQUEST.REMINDER', 'ia_information_request', r.id::text,
        'due_soon:' || to_char(v_today,'YYYYMMDD'), v_auditee,
        jsonb_build_object(
          'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
          'reference', r.id::text,
          'requestSummary', coalesce(r.document_title,'Information requested by Internal Audit'),
          'dueDate', to_char(r.due_date,'DD Mon YYYY'),
          'daysRemaining', abs(v_days)::text),
        'internal_audit:request_due_soon:' || r.id::text || ':' || to_char(v_today,'YYYYMMDD'),
        (v_ctx->>'department_id')::uuid);
      v_emitted := v_emitted + 1;
    ELSIF v_days = 0 OR (v_days > 0 AND v_days % greatest(v_repeat,1) = 0) THEN
      PERFORM public.ia_comms_emit(
        'INTERNAL_AUDIT.REQUEST.OVERDUE', 'ia_information_request', r.id::text,
        'overdue:' || to_char(v_today,'YYYYMMDD'), v_auditee,
        jsonb_build_object(
          'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
          'reference', r.id::text,
          'requestSummary', coalesce(r.document_title,'Information requested by Internal Audit'),
          'dueDate', to_char(r.due_date,'DD Mon YYYY'),
          'daysOverdue', greatest(v_days,0)::text),
        'internal_audit:request_overdue:' || r.id::text || ':' || to_char(v_today,'YYYYMMDD'),
        (v_ctx->>'department_id')::uuid);
      v_emitted := v_emitted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('as_of', v_today, 'emitted', v_emitted);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ia_comms_generate_request_reminders(date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ia_comms_generate_request_reminders(date) TO authenticated, service_role;
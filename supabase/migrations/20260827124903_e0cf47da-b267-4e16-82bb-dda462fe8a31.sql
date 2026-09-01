
-- ============================================================
-- INTERNAL AUDIT — WAVE 3 PART 2: READ MODELS / WORK QUEUES
-- ============================================================

CREATE OR REPLACE FUNCTION public.ia_f_txt(f jsonb, k text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(COALESCE(f,'{}'::jsonb) ->> k, '');
$$;

CREATE OR REPLACE FUNCTION public.ia_f_uuid(f jsonb, k text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN NULLIF(COALESCE(f,'{}'::jsonb) ->> k,'') IS NULL THEN NULL
              ELSE (f ->> k)::uuid END;
$$;

CREATE OR REPLACE FUNCTION public.ia_f_bool(f jsonb, k text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE((COALESCE(f,'{}'::jsonb) ->> k)::boolean, false);
$$;

-- ============================================================
-- CORRECTIVE ACTION REGISTER
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_register_actions(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.overdue_days DESC NULLS LAST, t.current_target_date NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT a.id AS action_id,
           a.action_ref,
           a.annual_plan_id, pl.fiscal_year AS plan_fiscal_year, pl.title AS plan_title,
           a.engagement_id, e.engagement_code, e.engagement_name,
           a.department_id, d.name AS department_name,
           a.function_id, fn.function_name AS function_name,
           a.finding_id, f.title AS finding_title, f.severity AS finding_severity,
           f.lifecycle_status AS finding_status,
           a.recommendation_id, r.recommendation_text,
           a.response_id,
           a.responsible_profile_id,
           COALESCE(pr.full_name, pr.email, a.responsible_person) AS action_owner,
           a.accountable_department_id,
           a.action_description,
           a.original_target_date, a.current_target_date,
           COALESCE(a.extension_count,0) AS extension_count,
           a.lifecycle_status, COALESCE(a.progress_pct,0) AS progress_pct,
           a.latest_update, a.latest_update_at,
           CASE WHEN a.evidence_ids IS NULL OR array_length(a.evidence_ids,1) IS NULL
                THEN 'None' ELSE 'Attached (' || array_length(a.evidence_ids,1) || ')' END AS evidence_state,
           a.management_completion_date,
           a.verification_status, a.verified_at, a.verification_notes,
           a.reopen_count, a.closure_date, a.closure_notes, a.cancelled_reason,
           (SELECT fu.lifecycle_status FROM public.ia_follow_ups fu
             WHERE fu.action_id = a.id ORDER BY fu.due_date DESC NULLS LAST LIMIT 1) AS follow_up_state,
           CASE WHEN a.lifecycle_status IN ('Closed','Cancelled') OR a.current_target_date IS NULL THEN 0
                ELSE GREATEST(0, (CURRENT_DATE - a.current_target_date)) END AS overdue_days,
           (a.lifecycle_status NOT IN ('Closed','Cancelled')
             AND a.current_target_date IS NOT NULL
             AND a.current_target_date < CURRENT_DATE) AS is_overdue,
           (a.lifecycle_status NOT IN ('Closed','Cancelled')
             AND a.current_target_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14) AS is_due_soon,
           (a.lifecycle_status NOT IN ('Closed','Cancelled')) AS is_open
      FROM public.ia_action_tracking a
      LEFT JOIN public.ia_audit_engagements e ON e.id = a.engagement_id
      LEFT JOIN public.ia_annual_plans pl ON pl.id = a.annual_plan_id
      LEFT JOIN public.ia_departments d ON d.id = a.department_id
      LEFT JOIN public.ia_department_functions fn ON fn.id = a.function_id
      LEFT JOIN public.ia_findings f ON f.id = a.finding_id
      LEFT JOIN public.ia_recommendations r ON r.id = a.recommendation_id
      LEFT JOIN public.profiles pr ON pr.id = a.responsible_profile_id
     WHERE ( public.ia_can_read_all()
             OR public.ia_can_access_engagement(a.engagement_id)
             OR a.responsible_profile_id = auth.uid() )
       AND (public.ia_f_uuid(p_filters,'plan_id') IS NULL OR a.annual_plan_id = public.ia_f_uuid(p_filters,'plan_id'))
       AND (public.ia_f_uuid(p_filters,'engagement_id') IS NULL OR a.engagement_id = public.ia_f_uuid(p_filters,'engagement_id'))
       AND (public.ia_f_uuid(p_filters,'department_id') IS NULL OR a.department_id = public.ia_f_uuid(p_filters,'department_id'))
       AND (public.ia_f_uuid(p_filters,'function_id') IS NULL OR a.function_id = public.ia_f_uuid(p_filters,'function_id'))
       AND (public.ia_f_uuid(p_filters,'owner_profile_id') IS NULL OR a.responsible_profile_id = public.ia_f_uuid(p_filters,'owner_profile_id'))
       AND (public.ia_f_uuid(p_filters,'finding_id') IS NULL OR a.finding_id = public.ia_f_uuid(p_filters,'finding_id'))
       AND (public.ia_f_txt(p_filters,'severity') IS NULL OR f.severity = public.ia_f_txt(p_filters,'severity'))
       AND (public.ia_f_txt(p_filters,'status') IS NULL OR a.lifecycle_status = public.ia_f_txt(p_filters,'status'))
       AND (public.ia_f_txt(p_filters,'due_from') IS NULL OR a.current_target_date >= (public.ia_f_txt(p_filters,'due_from'))::date)
       AND (public.ia_f_txt(p_filters,'due_to') IS NULL OR a.current_target_date <= (public.ia_f_txt(p_filters,'due_to'))::date)
       AND (NOT public.ia_f_bool(p_filters,'overdue')
            OR (a.lifecycle_status NOT IN ('Closed','Cancelled') AND a.current_target_date < CURRENT_DATE))
       AND (NOT public.ia_f_bool(p_filters,'due_soon')
            OR (a.lifecycle_status NOT IN ('Closed','Cancelled') AND a.current_target_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14))
       AND (NOT public.ia_f_bool(p_filters,'open_only') OR a.lifecycle_status NOT IN ('Closed','Cancelled'))
       AND (NOT public.ia_f_bool(p_filters,'verification_required') OR a.lifecycle_status = 'Verification Required')
  ) t;
$$;

-- ============================================================
-- FINDINGS REGISTER
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_register_findings(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.severity_rank, t.reported_date DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT f.id AS finding_id, f.finding_id AS finding_ref,
           f.annual_plan_id, pl.fiscal_year AS plan_fiscal_year,
           f.engagement_id, e.engagement_code, e.engagement_name,
           f.department_id, COALESCE(d.name, f.department_name) AS department_name,
           f.function_area, e.function_id, fn.function_name AS function_name,
           f.title, COALESCE(f.severity, f.risk_rating) AS severity,
           CASE COALESCE(f.severity, f.risk_rating)
             WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END AS severity_rank,
           f.lifecycle_status, f.status,
           mr.management_position, mr.status AS response_status, mr.id AS response_id,
           (mr.id IS NULL AND f.lifecycle_status = 'Released') AS response_outstanding,
           (mr.management_position = 'Rejected') AS is_disputed,
           (SELECT count(*) FROM public.ia_recommendations rc WHERE rc.finding_id = f.id) AS recommendation_count,
           (SELECT count(*) FROM public.ia_action_tracking a WHERE a.finding_id = f.id) AS action_count,
           (SELECT count(*) FROM public.ia_action_tracking a WHERE a.finding_id = f.id
              AND a.lifecycle_status NOT IN ('Closed','Cancelled')) AS open_action_count,
           (SELECT count(*) FROM public.ia_action_tracking a WHERE a.finding_id = f.id
              AND a.lifecycle_status NOT IN ('Closed','Cancelled') AND a.current_target_date < CURRENT_DATE) AS overdue_action_count,
           COALESCE(f.created_date, f.created_at) AS reported_date,
           (f.lifecycle_status = 'Closed' OR f.status = 'Closed') AS is_closed
      FROM public.ia_findings f
      LEFT JOIN public.ia_audit_engagements e ON e.id = f.engagement_id
      LEFT JOIN public.ia_annual_plans pl ON pl.id = f.annual_plan_id
      LEFT JOIN public.ia_departments d ON d.id = f.department_id
      LEFT JOIN public.ia_department_functions fn ON fn.id = e.function_id
      LEFT JOIN LATERAL (
        SELECT r.* FROM public.ia_management_responses r
         WHERE r.finding_id = f.id ORDER BY r.created_at DESC LIMIT 1) mr ON true
     WHERE ( public.ia_can_read_all() OR public.ia_can_access_engagement(f.engagement_id) )
       AND (public.ia_f_uuid(p_filters,'plan_id') IS NULL OR f.annual_plan_id = public.ia_f_uuid(p_filters,'plan_id'))
       AND (public.ia_f_uuid(p_filters,'engagement_id') IS NULL OR f.engagement_id = public.ia_f_uuid(p_filters,'engagement_id'))
       AND (public.ia_f_uuid(p_filters,'department_id') IS NULL OR f.department_id = public.ia_f_uuid(p_filters,'department_id'))
       AND (public.ia_f_txt(p_filters,'severity') IS NULL OR COALESCE(f.severity, f.risk_rating) = public.ia_f_txt(p_filters,'severity'))
       AND (public.ia_f_txt(p_filters,'status') IS NULL OR f.lifecycle_status = public.ia_f_txt(p_filters,'status'))
       AND (NOT public.ia_f_bool(p_filters,'open_only') OR COALESCE(f.lifecycle_status,'Draft') <> 'Closed')
       AND (NOT public.ia_f_bool(p_filters,'disputed') OR mr.management_position = 'Rejected')
       AND (NOT public.ia_f_bool(p_filters,'response_outstanding') OR (mr.id IS NULL AND f.lifecycle_status = 'Released'))
  ) t;
$$;

-- ============================================================
-- MY AUDIT WORK
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_my_audit_work()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH me AS (SELECT public.ia_current_auditor_id() AS auditor_id, auth.uid() AS uid),
scope AS (
  SELECT e.* FROM public.ia_audit_engagements e, me
   WHERE public.ia_can_read_all() OR public.ia_can_access_engagement_internal(e.id)
),
items AS (
  -- preparation
  SELECT 'Complete preparation'::text AS required_action, s.engagement_code AS reference,
         s.engagement_name AS audit, s.department_id, s.function_id, 'Preparation'::text AS stage,
         NULL::text AS severity, s.lead_auditor_id::text AS owner, s.planned_start_date AS due_date,
         COALESCE(s.status,'Planned') AS status, s.id AS engagement_id, s.id AS record_id,
         ('/audit/engagements/' || s.id || '?tab=preparation') AS link
    FROM scope s
   WHERE COALESCE(s.status,'') NOT IN ('Closed','Cancelled')
     AND NOT EXISTS (SELECT 1 FROM public.ia_audit_event ev
                      WHERE ev.engagement_id = s.id AND ev.event_code = 'IA.PREPARATION.COMPLETED')
  UNION ALL
  -- activities assigned to me / unassigned
  SELECT CASE WHEN a.owner_auditor_id IS NULL THEN 'Assign activity owner' ELSE 'Complete activity' END,
         COALESCE(a.name, a.title), s.engagement_name, s.department_id, s.function_id, 'Fieldwork',
         a.priority, a.owner_auditor_id::text, COALESCE(a.planned_date_to, a.end_date),
         COALESCE(a.status,'Planned'), s.id, a.id, ('/audit/engagements/' || s.id || '?tab=activities')
    FROM public.ia_activities a JOIN scope s ON s.id = a.engagement_id
   WHERE COALESCE(a.status,'Planned') NOT IN ('Completed','Reviewed','Cancelled')
  UNION ALL
  -- activities awaiting my review
  SELECT 'Review completed activity', COALESCE(a.name, a.title), s.engagement_name, s.department_id, s.function_id,
         'Fieldwork Review', a.priority, a.reviewer_auditor_id::text, a.completed_at::date,
         COALESCE(a.review_status,'Pending Review'), s.id, a.id, ('/audit/engagements/' || s.id || '?tab=activities')
    FROM public.ia_activities a JOIN scope s ON s.id = a.engagement_id
   WHERE a.status = 'Completed' AND COALESCE(a.review_status,'') NOT IN ('Reviewed')
  UNION ALL
  -- control tests not concluded
  SELECT 'Conclude control test', COALESCE(ct.remarks, ct.id::text), s.engagement_name, s.department_id, s.function_id,
         'Control Testing', NULL, ct.tested_by, ct.test_date,
         COALESCE(ct.status,'Draft'), s.id, ct.id, ('/audit/engagements/' || s.id || '?tab=control-tests')
    FROM public.ia_control_tests ct JOIN scope s ON s.id = ct.engagement_id
   WHERE ct.conclusion IS NULL
  UNION ALL
  -- findings needing progression
  SELECT CASE f.lifecycle_status WHEN 'Draft' THEN 'Submit finding for review'
                                 WHEN 'Under Review' THEN 'Confirm finding'
                                 WHEN 'Confirmed' THEN 'Release finding to management'
                                 ELSE 'Progress finding' END,
         COALESCE(f.finding_id, f.title), s.engagement_name, s.department_id, s.function_id, 'Findings',
         COALESCE(f.severity, f.risk_rating), NULL, COALESCE(f.created_date, f.created_at)::date,
         COALESCE(f.lifecycle_status,'Draft'), s.id, f.id, ('/audit/engagements/' || s.id || '?tab=findings')
    FROM public.ia_findings f JOIN scope s ON s.id = f.engagement_id
   WHERE COALESCE(f.lifecycle_status,'Draft') IN ('Draft','Under Review','Confirmed')
  UNION ALL
  -- management responses awaiting IA review
  SELECT 'Review management response', COALESCE(mr.id::text,''), s.engagement_name, s.department_id, s.function_id,
         'Responses', NULL, mr.responsible_person, mr.target_date,
         COALESCE(mr.status,'Submitted'), s.id, mr.id, ('/audit/engagements/' || s.id || '?tab=responses')
    FROM public.ia_management_responses mr JOIN scope s ON s.id = mr.engagement_id
   WHERE mr.review_outcome IS NULL
  UNION ALL
  -- corrective actions requiring verification
  SELECT 'Verify corrective action', a.action_ref, s.engagement_name, a.department_id, a.function_id,
         'Corrective Actions', NULL, a.responsible_person, a.current_target_date,
         a.lifecycle_status, s.id, a.id, ('/audit/action-centre?tab=verification&actionId=' || a.id)
    FROM public.ia_action_tracking a JOIN scope s ON s.id = a.engagement_id
   WHERE a.lifecycle_status = 'Verification Required'
  UNION ALL
  -- follow-ups due
  SELECT 'Perform follow-up', COALESCE(fu.action_required,'Follow-up'), s.engagement_name, fu.department_id, NULL,
         'Follow-Up', NULL, fu.responsible_name, fu.due_date,
         COALESCE(fu.lifecycle_status,'Scheduled'), s.id, fu.id, ('/audit/action-centre?tab=followup&followUpId=' || fu.id)
    FROM public.ia_follow_ups fu JOIN scope s ON s.id = fu.engagement_id
   WHERE COALESCE(fu.lifecycle_status,'Scheduled') IN ('Scheduled','Due','In Verification','Reopened')
     AND fu.due_date IS NOT NULL AND fu.due_date <= CURRENT_DATE + 30
  UNION ALL
  -- report rework after QA
  SELECT 'Address quality review rework', COALESCE(qr.id::text,''), s.engagement_name, s.department_id, s.function_id,
         'Quality Review', NULL, qr.reviewer_id::text, qr.review_date,
         COALESCE(qr.status,'In Review'), s.id, qr.id, ('/audit/engagements/' || s.id || '?tab=quality-review')
    FROM public.ia_quality_reviews qr JOIN scope s ON s.id = qr.engagement_id
   WHERE COALESCE(qr.final_disposition,'') = 'Rework Required' OR COALESCE(qr.status,'') = 'Rework Required'
)
SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.overdue_days DESC, x.due_date NULLS LAST), '[]'::jsonb)
FROM (
  SELECT i.*, d.name AS department_name, fn.function_name AS function_name,
         CASE WHEN i.due_date IS NULL THEN 0 ELSE GREATEST(0, CURRENT_DATE - i.due_date) END AS overdue_days
    FROM items i
    LEFT JOIN public.ia_departments d ON d.id = i.department_id
    LEFT JOIN public.ia_department_functions fn ON fn.id = i.function_id
) x;
$$;

-- ============================================================
-- MANAGEMENT ACTIONS QUEUE
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_management_actions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH mine AS (
  SELECT a.* FROM public.ia_action_tracking a
   WHERE a.responsible_profile_id = auth.uid()
      OR public.ia_is_department_respondent(COALESCE(a.accountable_department_id, a.department_id))
),
items AS (
  SELECT 'Submit management response'::text AS required_action,
         COALESCE(f.finding_id, f.title) AS reference, e.engagement_name AS audit,
         f.department_id, 'Findings Awaiting Response'::text AS bucket,
         COALESCE(f.severity, f.risk_rating) AS severity, NULL::date AS due_date,
         COALESCE(f.lifecycle_status,'Released') AS status, f.engagement_id, f.id AS record_id,
         ('/audit/engagements/' || f.engagement_id || '?tab=responses') AS link
    FROM public.ia_findings f
    JOIN public.ia_audit_engagements e ON e.id = f.engagement_id
   WHERE f.lifecycle_status = 'Released'
     AND public.ia_is_department_respondent(f.department_id)
     AND NOT EXISTS (SELECT 1 FROM public.ia_management_responses r WHERE r.finding_id = f.id)
  UNION ALL
  SELECT 'Revise returned response', COALESCE(mr.id::text,''), e.engagement_name, f.department_id,
         'Responses Returned for Clarification', COALESCE(f.severity, f.risk_rating), mr.target_date,
         COALESCE(mr.review_outcome,'Revision Requested'), mr.engagement_id, mr.id,
         ('/audit/engagements/' || mr.engagement_id || '?tab=responses')
    FROM public.ia_management_responses mr
    JOIN public.ia_findings f ON f.id = mr.finding_id
    JOIN public.ia_audit_engagements e ON e.id = mr.engagement_id
   WHERE mr.review_outcome = 'Revision Requested'
     AND public.ia_is_department_respondent(f.department_id)
  UNION ALL
  SELECT CASE
           WHEN a.lifecycle_status = 'Returned' THEN 'Action returned by Internal Audit — resubmit'
           WHEN a.lifecycle_status = 'Verification Required' THEN 'Awaiting Internal Audit verification'
           WHEN a.current_target_date < CURRENT_DATE THEN 'Overdue — update or request extension'
           WHEN a.current_target_date <= CURRENT_DATE + 14 THEN 'Due soon — update progress'
           ELSE 'Progress corrective action' END,
         a.action_ref, e.engagement_name, a.department_id,
         CASE
           WHEN a.lifecycle_status = 'Returned' THEN 'Actions Returned by Internal Audit'
           WHEN a.lifecycle_status = 'Verification Required' THEN 'Awaiting Verification'
           WHEN (a.evidence_ids IS NULL OR array_length(a.evidence_ids,1) IS NULL) THEN 'Actions Awaiting Evidence'
           WHEN a.current_target_date < CURRENT_DATE THEN 'Overdue Actions'
           WHEN a.current_target_date <= CURRENT_DATE + 14 THEN 'Actions Due Soon'
           ELSE 'Corrective Actions Assigned' END,
         NULL, a.current_target_date, a.lifecycle_status, a.engagement_id, a.id,
         ('/audit/action-centre?tab=management&actionId=' || a.id)
    FROM mine a LEFT JOIN public.ia_audit_engagements e ON e.id = a.engagement_id
   WHERE a.lifecycle_status NOT IN ('Closed','Cancelled')
  UNION ALL
  SELECT 'Extension request ' || lower(x.status), a.action_ref, e.engagement_name, a.department_id,
         'Extension Requests', NULL, x.proposed_date, x.status, a.engagement_id, x.id,
         ('/audit/action-centre?tab=management&actionId=' || a.id)
    FROM public.ia_action_extensions x
    JOIN mine a ON a.id = x.action_id
    LEFT JOIN public.ia_audit_engagements e ON e.id = a.engagement_id
   WHERE x.status IN ('Requested','Rejected')
  UNION ALL
  SELECT 'Respond to follow-up', COALESCE(fu.action_required,'Follow-up'), e.engagement_name, fu.department_id,
         'Follow-Up Requests', NULL, fu.due_date, COALESCE(fu.lifecycle_status,'Scheduled'), fu.engagement_id, fu.id,
         ('/audit/action-centre?tab=followup&followUpId=' || fu.id)
    FROM public.ia_follow_ups fu
    LEFT JOIN public.ia_audit_engagements e ON e.id = fu.engagement_id
   WHERE public.ia_is_department_respondent(fu.department_id)
     AND COALESCE(fu.lifecycle_status,'Scheduled') IN ('Scheduled','Due','In Verification','Reopened')
)
SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.overdue_days DESC, x.due_date NULLS LAST),'[]'::jsonb)
FROM (
  SELECT i.*, d.name AS department_name,
         CASE WHEN i.due_date IS NULL THEN 0 ELSE GREATEST(0, CURRENT_DATE - i.due_date) END AS overdue_days
    FROM items i LEFT JOIN public.ia_departments d ON d.id = i.department_id
) x;
$$;

-- ============================================================
-- HEAD OF INTERNAL AUDIT ATTENTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_hia_attention()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH allowed AS (SELECT public.ia_can_read_all() AS ok),
items AS (
  SELECT 'Plans Awaiting Approval'::text AS bucket, pl.title AS reference, pl.fiscal_year AS context,
         'Approve or reject the annual plan'::text AS required_action, NULL::text AS severity,
         pl.submitted_date::date AS due_date, pl.status,
         ('/audit/plan-approval?planId=' || pl.id) AS link, pl.id AS record_id
    FROM public.ia_annual_plans pl, allowed WHERE allowed.ok AND pl.status IN ('Submitted','Under Review')
  UNION ALL
  SELECT 'Audits Not Started on Time', e.engagement_code, e.engagement_name,
         'Audit has passed its planned start date without launch', e.engagement_risk_rating,
         e.planned_start_date, COALESCE(e.status,'Planned'),
         ('/audit/engagements/' || e.id), e.id
    FROM public.ia_audit_engagements e, allowed
   WHERE allowed.ok AND e.planned_start_date < CURRENT_DATE
     AND COALESCE(e.status,'Planned') IN ('Planned','Ready for Launch','Draft')
  UNION ALL
  SELECT CASE WHEN e.engagement_risk_rating IN ('High','Critical') THEN 'High-Risk Audits Delayed' ELSE 'Delayed Audits' END,
         e.engagement_code, e.engagement_name,
         'Audit has passed its planned end date and is not closed', e.engagement_risk_rating,
         e.planned_end_date, COALESCE(e.status,'In Progress'),
         ('/audit/engagements/' || e.id), e.id
    FROM public.ia_audit_engagements e, allowed
   WHERE allowed.ok AND e.planned_end_date < CURRENT_DATE
     AND COALESCE(e.status,'') NOT IN ('Closed','Cancelled','Completed')
  UNION ALL
  SELECT 'High/Critical Findings', COALESCE(f.finding_id, f.title), e.engagement_name,
         'High or critical finding is still open', COALESCE(f.severity, f.risk_rating),
         COALESCE(f.created_date, f.created_at)::date, COALESCE(f.lifecycle_status,'Draft'),
         ('/audit/engagements/' || f.engagement_id || '?tab=findings'), f.id
    FROM public.ia_findings f LEFT JOIN public.ia_audit_engagements e ON e.id = f.engagement_id, allowed
   WHERE allowed.ok AND COALESCE(f.severity, f.risk_rating) IN ('High','Critical')
     AND COALESCE(f.lifecycle_status,'Draft') <> 'Closed'
  UNION ALL
  SELECT 'Disputed Findings', COALESCE(f.finding_id, f.title), e.engagement_name,
         'Management disagrees with the finding', COALESCE(f.severity, f.risk_rating),
         mr.submitted_date::date, COALESCE(f.lifecycle_status,'Released'),
         ('/audit/engagements/' || f.engagement_id || '?tab=responses'), f.id
    FROM public.ia_management_responses mr
    JOIN public.ia_findings f ON f.id = mr.finding_id
    LEFT JOIN public.ia_audit_engagements e ON e.id = f.engagement_id, allowed
   WHERE allowed.ok AND mr.management_position = 'Rejected'
  UNION ALL
  SELECT 'Management Responses Overdue', COALESCE(f.finding_id, f.title), e.engagement_name,
         'No management response received since release', COALESCE(f.severity, f.risk_rating),
         f.released_at::date, 'Released',
         ('/audit/engagements/' || f.engagement_id || '?tab=responses'), f.id
    FROM public.ia_findings f LEFT JOIN public.ia_audit_engagements e ON e.id = f.engagement_id, allowed
   WHERE allowed.ok AND f.lifecycle_status = 'Released'
     AND f.released_at < now() - interval '21 days'
     AND NOT EXISTS (SELECT 1 FROM public.ia_management_responses r WHERE r.finding_id = f.id)
  UNION ALL
  SELECT CASE WHEN a.current_target_date < CURRENT_DATE - 60 THEN 'Actions Seriously Overdue' ELSE 'Corrective Actions Overdue' END,
         a.action_ref, e.engagement_name, 'Corrective action past its approved target date', NULL,
         a.current_target_date, a.lifecycle_status,
         ('/audit/action-centre?tab=register&actionId=' || a.id), a.id
    FROM public.ia_action_tracking a LEFT JOIN public.ia_audit_engagements e ON e.id = a.engagement_id, allowed
   WHERE allowed.ok AND a.lifecycle_status NOT IN ('Closed','Cancelled') AND a.current_target_date < CURRENT_DATE
  UNION ALL
  SELECT 'Repeated Deadline Extensions', a.action_ref, e.engagement_name,
         'Action has been extended ' || a.extension_count || ' times', NULL,
         a.current_target_date, a.lifecycle_status,
         ('/audit/action-centre?tab=register&actionId=' || a.id), a.id
    FROM public.ia_action_tracking a LEFT JOIN public.ia_audit_engagements e ON e.id = a.engagement_id, allowed
   WHERE allowed.ok AND COALESCE(a.extension_count,0) >= 2 AND a.lifecycle_status NOT IN ('Closed','Cancelled')
  UNION ALL
  SELECT 'Audits Awaiting QA', e.engagement_code, e.engagement_name,
         'Fieldwork complete but no quality review recorded', e.engagement_risk_rating,
         e.planned_end_date, COALESCE(e.status,'In Progress'),
         ('/audit/engagements/' || e.id || '?tab=quality-review'), e.id
    FROM public.ia_audit_engagements e, allowed
   WHERE allowed.ok AND COALESCE(e.status,'') NOT IN ('Closed','Cancelled')
     AND NOT EXISTS (SELECT 1 FROM public.ia_quality_reviews q WHERE q.engagement_id = e.id AND q.final_disposition = 'Cleared')
     AND EXISTS (SELECT 1 FROM public.ia_findings f WHERE f.engagement_id = e.id)
)
SELECT COALESCE(jsonb_agg(row_to_json(items)::jsonb ORDER BY items.bucket, items.due_date NULLS LAST), '[]'::jsonb)
FROM items;
$$;

-- ============================================================
-- QUALITY REVIEW QUEUE
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_qa_queue()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.review_date DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT qr.id AS review_id, qr.engagement_id, e.engagement_code, e.engagement_name,
           e.department_id, d.name AS department_name, qr.reviewer_id, qr.review_type,
           qr.review_date, qr.quality_rating, qr.final_disposition,
           COALESCE(qr.status,'In Review') AS status,
           CASE
             WHEN COALESCE(qr.final_disposition,'') = 'Cleared' THEN 'Ready for Sign-Off'
             WHEN COALESCE(qr.final_disposition, qr.status) = 'Rework Required' THEN 'Rework Outstanding'
             WHEN COALESCE(qr.status,'') = 'Resubmitted' THEN 'Resubmitted'
             WHEN qr.reviewer_id IS NOT NULL THEN 'In Review'
             ELSE 'Assigned for QA' END AS bucket,
           ('/audit/engagements/' || qr.engagement_id || '?tab=quality-review') AS link
      FROM public.ia_quality_reviews qr
      LEFT JOIN public.ia_audit_engagements e ON e.id = qr.engagement_id
      LEFT JOIN public.ia_departments d ON d.id = e.department_id
     WHERE public.ia_can_read_all() OR public.ia_can_access_engagement(qr.engagement_id)
  ) t;
$$;

-- ============================================================
-- FOLLOW-UP QUEUE
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_followup_queue(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.overdue_days DESC, t.due_date NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT fu.id AS follow_up_id, fu.action_id, a.action_ref, fu.finding_id,
           fu.engagement_id, e.engagement_code, e.engagement_name,
           fu.annual_plan_id, pl.fiscal_year AS plan_fiscal_year,
           fu.department_id, COALESCE(d.name, fu.department_name) AS department_name,
           e.function_id, fn.function_name AS function_name,
           fu.action_required, fu.due_date, fu.follow_up_type,
           COALESCE(fu.lifecycle_status,'Scheduled') AS lifecycle_status,
           fu.outcome, fu.outcome_notes, fu.responsible_name, fu.fiscal_year,
           COALESCE(f.severity, f.risk_rating) AS severity,
           CASE WHEN fu.due_date IS NULL OR COALESCE(fu.lifecycle_status,'Scheduled') IN ('Implemented','Cancelled')
                THEN 0 ELSE GREATEST(0, CURRENT_DATE - fu.due_date) END AS overdue_days,
           ('/audit/action-centre?tab=followup&followUpId=' || fu.id) AS link
      FROM public.ia_follow_ups fu
      LEFT JOIN public.ia_action_tracking a ON a.id = fu.action_id
      LEFT JOIN public.ia_audit_engagements e ON e.id = fu.engagement_id
      LEFT JOIN public.ia_annual_plans pl ON pl.id = fu.annual_plan_id
      LEFT JOIN public.ia_departments d ON d.id = fu.department_id
      LEFT JOIN public.ia_department_functions fn ON fn.id = e.function_id
      LEFT JOIN public.ia_findings f ON f.id = fu.finding_id
     WHERE ( public.ia_can_read_all()
             OR public.ia_can_access_engagement(fu.engagement_id)
             OR public.ia_is_department_respondent(fu.department_id) )
       AND (public.ia_f_uuid(p_filters,'plan_id') IS NULL OR fu.annual_plan_id = public.ia_f_uuid(p_filters,'plan_id'))
       AND (public.ia_f_uuid(p_filters,'engagement_id') IS NULL OR fu.engagement_id = public.ia_f_uuid(p_filters,'engagement_id'))
       AND (public.ia_f_uuid(p_filters,'department_id') IS NULL OR fu.department_id = public.ia_f_uuid(p_filters,'department_id'))
       AND (public.ia_f_txt(p_filters,'status') IS NULL OR COALESCE(fu.lifecycle_status,'Scheduled') = public.ia_f_txt(p_filters,'status'))
       AND (public.ia_f_txt(p_filters,'severity') IS NULL OR COALESCE(f.severity, f.risk_rating) = public.ia_f_txt(p_filters,'severity'))
       AND (public.ia_f_txt(p_filters,'due_from') IS NULL OR fu.due_date >= (public.ia_f_txt(p_filters,'due_from'))::date)
       AND (public.ia_f_txt(p_filters,'due_to') IS NULL OR fu.due_date <= (public.ia_f_txt(p_filters,'due_to'))::date)
       AND (NOT public.ia_f_bool(p_filters,'overdue')
            OR (fu.due_date < CURRENT_DATE AND COALESCE(fu.lifecycle_status,'Scheduled') NOT IN ('Implemented','Cancelled')))
       AND (NOT public.ia_f_bool(p_filters,'due_soon')
            OR (fu.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14))
  ) t;
$$;

-- ============================================================
-- CLOSURE BLOCKERS (cross-audit)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_closure_blockers(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb := '[]'::jsonb; r record; g jsonb;
BEGIN
  FOR r IN
    SELECT e.id, e.engagement_code, e.engagement_name, e.department_id, e.function_id,
           e.status, e.engagement_risk_rating, d.name AS department_name, fn.function_name AS function_name,
           e.annual_plan_id
      FROM public.ia_audit_engagements e
      LEFT JOIN public.ia_departments d ON d.id = e.department_id
      LEFT JOIN public.ia_department_functions fn ON fn.id = e.function_id
     WHERE (public.ia_can_read_all() OR public.ia_can_access_engagement(e.id))
       AND COALESCE(e.status,'') NOT IN ('Closed','Cancelled')
       AND (public.ia_f_uuid(p_filters,'plan_id') IS NULL OR e.annual_plan_id = public.ia_f_uuid(p_filters,'plan_id'))
       AND (public.ia_f_uuid(p_filters,'department_id') IS NULL OR e.department_id = public.ia_f_uuid(p_filters,'department_id'))
       AND (public.ia_f_uuid(p_filters,'engagement_id') IS NULL OR e.id = public.ia_f_uuid(p_filters,'engagement_id'))
  LOOP
    g := public.ia_evaluate_engagement_closure_v2(r.id);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'engagement_id', r.id, 'engagement_code', r.engagement_code, 'engagement_name', r.engagement_name,
      'department_id', r.department_id, 'department_name', r.department_name,
      'function_id', r.function_id, 'function_name', r.function_name,
      'annual_plan_id', r.annual_plan_id,
      'risk', r.engagement_risk_rating, 'status', r.status,
      'can_close', COALESCE((g->>'can_close')::boolean, false),
      'blockers', COALESCE(g->'reasons', '[]'::jsonb),
      'blocker_count', COALESCE(jsonb_array_length(g->'reasons'), 0),
      'link', '/audit/engagements/' || r.id || '?tab=closure'
    ));
  END LOOP;
  RETURN v_out;
END $$;

-- ============================================================
-- ANNUAL PLAN CLOSURE READINESS
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_plan_closure_readiness(p_plan_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.engagement_code), '[]'::jsonb)
  FROM (
    SELECT e.id AS engagement_id, e.engagement_code, e.engagement_name,
           e.department_id, d.name AS department_name,
           e.function_id, fn.function_name AS function_name,
           e.engagement_risk_rating AS risk, COALESCE(e.status,'Planned') AS status,
           COALESCE((public.ia_engagement_progress(e.id) ->> 'percent')::numeric, 0) AS progress,
           CASE WHEN COALESCE(e.status,'') IN ('Closed','Cancelled')
                THEN COALESCE(e.closure_notes, e.status) ELSE NULL END AS final_disposition_note,
           (SELECT ev.new_value ->> 'disposition' FROM public.ia_audit_event ev
             WHERE ev.engagement_id = e.id AND ev.event_code = 'IA.ENGAGEMENT.CLOSED'
             ORDER BY ev.occurred_at DESC LIMIT 1) AS final_disposition,
           (SELECT count(*) FROM public.ia_action_tracking a
             WHERE a.engagement_id = e.id AND a.lifecycle_status NOT IN ('Closed','Cancelled')) AS open_actions,
           (SELECT count(*) FROM public.ia_action_tracking a
             WHERE a.engagement_id = e.id AND a.lifecycle_status NOT IN ('Closed','Cancelled')
               AND a.current_target_date < CURRENT_DATE) AS overdue_actions,
           CASE WHEN COALESCE(e.status,'') IN ('Closed','Cancelled') THEN NULL
                ELSE COALESCE(public.ia_evaluate_engagement_closure_v2(e.id) -> 'reasons','[]'::jsonb) END AS closure_blockers,
           ('/audit/engagements/' || e.id || '?tab=closure') AS link
      FROM public.ia_audit_engagements e
      LEFT JOIN public.ia_departments d ON d.id = e.department_id
      LEFT JOIN public.ia_department_functions fn ON fn.id = e.function_id
     WHERE e.annual_plan_id = p_plan_id
       AND (public.ia_can_read_all() OR public.ia_can_access_engagement(e.id))
  ) t;
$$;

-- ============================================================
-- ACTION CENTRE COUNTS (dashboard drill-down source of truth)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_q_action_centre_counts(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (SELECT jsonb_array_elements(public.ia_register_actions(p_filters)) e),
       f AS (SELECT jsonb_array_elements(public.ia_register_findings(p_filters)) e),
       fu AS (SELECT jsonb_array_elements(public.ia_q_followup_queue(p_filters)) e),
       cb AS (SELECT jsonb_array_elements(public.ia_q_closure_blockers(p_filters)) e),
       qa AS (SELECT jsonb_array_elements(public.ia_q_qa_queue()) e)
  SELECT jsonb_build_object(
    'open_findings', (SELECT count(*) FROM f WHERE (e->>'is_closed')::boolean IS NOT TRUE),
    'high_findings', (SELECT count(*) FROM f WHERE e->>'severity' IN ('High','Critical') AND (e->>'is_closed')::boolean IS NOT TRUE),
    'disputed_findings', (SELECT count(*) FROM f WHERE (e->>'is_disputed')::boolean),
    'pending_management_responses', (SELECT count(*) FROM f WHERE (e->>'response_outstanding')::boolean),
    'open_actions', (SELECT count(*) FROM a WHERE (e->>'is_open')::boolean),
    'actions_due_soon', (SELECT count(*) FROM a WHERE (e->>'is_due_soon')::boolean),
    'overdue_actions', (SELECT count(*) FROM a WHERE (e->>'is_overdue')::boolean),
    'verification_required', (SELECT count(*) FROM a WHERE e->>'lifecycle_status' = 'Verification Required'),
    'followups_due', (SELECT count(*) FROM fu WHERE (e->>'overdue_days')::int > 0
                        OR (e->>'lifecycle_status') IN ('Due','Scheduled','Reopened')),
    'audits_ready_for_qa', (SELECT count(*) FROM qa WHERE e->>'bucket' IN ('Assigned for QA','Resubmitted')),
    'audits_ready_for_closure', (SELECT count(*) FROM cb WHERE (e->>'can_close')::boolean),
    'audits_blocked_from_closure', (SELECT count(*) FROM cb WHERE (e->>'can_close')::boolean IS NOT TRUE),
    'computed_at', now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.ia_register_actions(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_register_findings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_my_audit_work() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_management_actions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_hia_attention() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_qa_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_followup_queue(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_closure_blockers(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_plan_closure_readiness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_q_action_centre_counts(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_f_txt(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_f_uuid(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_f_bool(jsonb,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.ia_register_actions(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_register_findings(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_my_audit_work() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_management_actions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_hia_attention() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_qa_queue() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_followup_queue(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_closure_blockers(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_plan_closure_readiness(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ia_q_action_centre_counts(jsonb) FROM anon;

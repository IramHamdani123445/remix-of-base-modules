
-- ============================================================
-- INTERNAL AUDIT — BUSINESS CONVERGENCE FINAL SLICE
-- Portfolio intelligence + Prior Audit History + Access Matrix
-- No RLS (docs/ARCHITECTURE-NO-RLS-RULE.md) — authorization is
-- enforced inside SECURITY DEFINER commands via ia_cmd_guard /
-- ia_actor_can, with EXECUTE revoked from anon/PUBLIC.
-- ============================================================

-- ---------- 1. Prior action reference (reference only, never ownership) ----------
CREATE TABLE IF NOT EXISTS public.ia_prior_action_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  current_engagement_id uuid NOT NULL REFERENCES public.ia_audit_engagements(id) ON DELETE CASCADE,
  prior_action_id uuid NOT NULL REFERENCES public.ia_action_tracking(id) ON DELETE CASCADE,
  prior_engagement_id uuid,
  relationship_type text NOT NULL DEFAULT 'PRIOR_ACTION_REVIEW'
    CHECK (relationship_type IN ('PRIOR_ACTION_REVIEW','REPEAT_FINDING','FOLLOWUP_RETEST')),
  relevance_reason text,
  linked_by text,
  linked_by_profile uuid,
  linked_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  unlinked_by text,
  unlinked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ia_prior_action_reference TO authenticated;
GRANT ALL ON public.ia_prior_action_reference TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS ia_prior_action_reference_active_uq
  ON public.ia_prior_action_reference (current_engagement_id, prior_action_id)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS ia_prior_action_reference_engagement_idx
  ON public.ia_prior_action_reference (current_engagement_id);

DROP TRIGGER IF EXISTS ia_prior_action_reference_touch ON public.ia_prior_action_reference;
CREATE TRIGGER ia_prior_action_reference_touch
  BEFORE UPDATE ON public.ia_prior_action_reference
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 2. Preparation acknowledgement ----------
ALTER TABLE public.ia_audit_engagements
  ADD COLUMN IF NOT EXISTS prior_history_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS prior_history_reviewed_by text,
  ADD COLUMN IF NOT EXISTS prior_history_review_note text;

-- ---------- 3. Canonical IA capability module list ----------
CREATE OR REPLACE FUNCTION public.ia_capability_modules()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'internal_audit','internal_audit_configuration',
    'audit_plans','plan_approval','plan_closeout',
    'audit_engagements','activity_workbench','control_testing',
    'evidence_management','working_papers',
    'findings_recommendations','management_responses',
    'action_tracking','follow_up_tracker',
    'audit_report_center','quality_review',
    'audit_configuration','audit_risk_configuration',
    'risk_register','risk_assessment'
  ]::text[];
$$;

-- ============================================================
-- PART A — PORTFOLIO INTELLIGENCE
-- ============================================================

CREATE OR REPLACE FUNCTION public.ia_annual_plan_portfolio_summary(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan record;
  v_capacity numeric;
  v_buffer numeric;
  v_net numeric;
  v_hours numeric;
  v_days numeric;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_plan FROM public.ia_annual_plans WHERE id = p_plan_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PLAN_NOT_FOUND');
  END IF;

  SELECT COALESCE(SUM(COALESCE(e.estimated_hours, 0)), 0),
         COALESCE(SUM(COALESCE(e.estimated_days, 0)), 0)
    INTO v_hours, v_days
    FROM public.ia_audit_engagements e
   WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true);

  v_capacity := COALESCE(
    NULLIF(v_plan.total_available_hours, 0),
    COALESCE(v_plan.auditor_count, 0) * COALESCE(v_plan.monthly_working_hours, 0) * 12
      * (COALESCE(NULLIF(v_plan.utilization_pct, 0), 100) / 100.0)
  );
  v_buffer := ROUND(COALESCE(v_capacity, 0) * COALESCE(v_plan.buffer_pct, 0) / 100.0, 2);
  v_net := GREATEST(COALESCE(v_capacity, 0) - v_buffer, 0);

  SELECT jsonb_build_object(
    'success', true,
    'plan_id', p_plan_id,
    'plan_status', v_plan.status,
    'fiscal_year', v_plan.fiscal_year,
    'totals', jsonb_build_object(
      'engagements', (SELECT count(*) FROM public.ia_audit_engagements e
                       WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)),
      'planned_hours', v_hours,
      'planned_days', v_days,
      'available_capacity_hours', COALESCE(v_capacity, 0),
      'buffer_hours', v_buffer,
      'net_capacity_hours', v_net,
      'utilisation_pct', CASE WHEN v_net > 0 THEN ROUND(v_hours / v_net * 100, 1) ELSE NULL END,
      'remaining_capacity_hours', ROUND(v_net - v_hours, 2)
    ),
    'by_risk', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT COALESCE(NULLIF(e.engagement_risk_rating, ''), 'Unrated') k, count(*) c
          FROM public.ia_audit_engagements e
         WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)
         GROUP BY 1) q
    ),
    'by_quarter', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT COALESCE(NULLIF(e.quarter, ''), 'Unscheduled') k, count(*) c
          FROM public.ia_audit_engagements e
         WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)
         GROUP BY 1) q
    ),
    'by_department', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'department'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'department_id', e.department_id,
                 'department', COALESCE(d.name, 'Unassigned'),
                 'engagements', count(*),
                 'hours', COALESCE(SUM(COALESCE(e.estimated_hours, 0)), 0)) x
          FROM public.ia_audit_engagements e
          LEFT JOIN public.ia_departments d ON d.id = e.department_id
         WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)
         GROUP BY e.department_id, d.name) s
    ),
    'by_function', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'function'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'function_id', e.function_id,
                 'function', COALESCE(f.function_name, 'Not specified'),
                 'engagements', count(*)) x
          FROM public.ia_audit_engagements e
          LEFT JOIN public.ia_department_functions f ON f.id = e.function_id
         WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)
         GROUP BY e.function_id, f.function_name) s
    ),
    'gaps', (
      SELECT jsonb_build_object(
        'unscheduled', count(*) FILTER (WHERE COALESCE(e.quarter,'') = '' AND e.planned_start_date IS NULL),
        'missing_lead', count(*) FILTER (WHERE e.lead_auditor_id IS NULL),
        'missing_reviewer', count(*) FILTER (WHERE e.reviewer_id IS NULL),
        'lead_reviewer_conflict', count(*) FILTER (WHERE e.lead_auditor_id IS NOT NULL
                                                    AND e.lead_auditor_id = e.reviewer_id))
        FROM public.ia_audit_engagements e
       WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)
    ),
    'conflict_engagements', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', e.id, 'name', e.engagement_name,
                'missing_lead', e.lead_auditor_id IS NULL,
                'missing_reviewer', e.reviewer_id IS NULL,
                'lead_reviewer_conflict', e.lead_auditor_id IS NOT NULL AND e.lead_auditor_id = e.reviewer_id,
                'unscheduled', COALESCE(e.quarter,'') = '' AND e.planned_start_date IS NULL)), '[]'::jsonb)
        FROM public.ia_audit_engagements e
       WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)
         AND (e.lead_auditor_id IS NULL OR e.reviewer_id IS NULL
              OR e.lead_auditor_id = e.reviewer_id
              OR (COALESCE(e.quarter,'') = '' AND e.planned_start_date IS NULL))
    ),
    -- Display only. ia_annual_plan_readiness stays authoritative for submission.
    'readiness', public.ia_annual_plan_readiness(p_plan_id),
    'version', jsonb_build_object(
      'current_version_number', COALESCE(v_plan.current_version_number, 1),
      'previous_submitted_version', (
        SELECT jsonb_build_object('version_number', pv.version_number,
                                  'status_at_snapshot', pv.status_at_snapshot,
                                  'created_at', pv.created_at)
          FROM public.ia_plan_versions pv
         WHERE pv.plan_id = p_plan_id
         ORDER BY pv.version_number DESC LIMIT 1)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_annual_plan_coverage(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'department', r->>'function'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'department_id', d.id,
      'department', d.name,
      'department_risk', d.risk_rating,
      'function_id', f.id,
      'function', f.function_name,
      'risk_rating', COALESCE(f.risk_rating, d.risk_rating),
      'last_audit_date', f.last_audit_date,
      'covered', e.id IS NOT NULL,
      'engagement_id', e.id,
      'engagement', e.engagement_name,
      'quarter', e.quarter,
      'effort_hours', e.estimated_hours
    ) r
    FROM public.ia_departments d
    LEFT JOIN public.ia_department_functions f
           ON f.department_id = d.id AND COALESCE(f.is_active, true)
    LEFT JOIN LATERAL (
      SELECT e2.* FROM public.ia_audit_engagements e2
       WHERE e2.annual_plan_id = p_plan_id
         AND COALESCE(e2.is_active, true)
         AND e2.department_id = d.id
         AND (f.id IS NULL OR e2.function_id = f.id OR e2.function_id IS NULL)
       ORDER BY (e2.function_id = f.id) DESC NULLS LAST
       LIMIT 1
    ) e ON true
    WHERE COALESCE(d.is_active, true)
  ) s;

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', p_plan_id,
    'rows', v_rows,
    'uncovered_high_risk', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
        FROM jsonb_array_elements(v_rows) x
       WHERE (x->>'covered') = 'false'
         AND COALESCE(x->>'risk_rating','') IN ('High','Critical')
    ),
    'departments_without_audit', (
      SELECT COALESCE(jsonb_agg(DISTINCT x->>'department'), '[]'::jsonb)
        FROM jsonb_array_elements(v_rows) x
       WHERE (x->>'covered') = 'false'
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_rows) y
            WHERE y->>'department_id' = x->>'department_id' AND (y->>'covered') = 'true')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_annual_plan_version_diff(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version record; v_added jsonb; v_removed jsonb; v_modified jsonb;
        v_base_hours numeric := 0; v_cur_hours numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_version FROM public.ia_plan_versions
   WHERE plan_id = p_plan_id ORDER BY version_number DESC LIMIT 1;

  IF v_version IS NULL THEN
    RETURN jsonb_build_object('success', true, 'has_baseline', false,
      'message', 'This plan has never been submitted, so there is no previous version to compare against.');
  END IF;

  WITH base AS (
    SELECT pve.engagement_id, pve.engagement_snapshot snap
      FROM public.ia_plan_version_engagements pve
     WHERE pve.plan_version_id = v_version.id
  ), cur AS (
    SELECT e.id engagement_id, to_jsonb(e) snap
      FROM public.ia_audit_engagements e
     WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'engagement_id', c.engagement_id,
        'name', c.snap->>'engagement_name',
        'quarter', c.snap->>'quarter',
        'risk', c.snap->>'engagement_risk_rating',
        'hours', c.snap->>'estimated_hours'))
      FROM cur c WHERE NOT EXISTS (SELECT 1 FROM base b WHERE b.engagement_id = c.engagement_id)), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'engagement_id', b.engagement_id,
        'name', b.snap->>'engagement_name',
        'quarter', b.snap->>'quarter',
        'risk', b.snap->>'engagement_risk_rating',
        'hours', b.snap->>'estimated_hours'))
      FROM base b WHERE NOT EXISTS (SELECT 1 FROM cur c WHERE c.engagement_id = b.engagement_id)), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'engagement_id', c.engagement_id,
        'name', COALESCE(c.snap->>'engagement_name', b.snap->>'engagement_name'),
        'changes', (
          SELECT jsonb_agg(jsonb_build_object('field', f, 'from', b.snap->>f, 'to', c.snap->>f))
            FROM unnest(ARRAY['engagement_name','quarter','engagement_risk_rating',
                              'estimated_hours','estimated_days','lead_auditor_id',
                              'reviewer_id','planned_start_date','planned_end_date']) f
           WHERE COALESCE(b.snap->>f,'') IS DISTINCT FROM COALESCE(c.snap->>f,''))))
      FROM cur c JOIN base b ON b.engagement_id = c.engagement_id
      WHERE EXISTS (
        SELECT 1 FROM unnest(ARRAY['engagement_name','quarter','engagement_risk_rating',
                                   'estimated_hours','estimated_days','lead_auditor_id',
                                   'reviewer_id','planned_start_date','planned_end_date']) f
         WHERE COALESCE(b.snap->>f,'') IS DISTINCT FROM COALESCE(c.snap->>f,''))), '[]'::jsonb),
    COALESCE((SELECT SUM(COALESCE((b.snap->>'estimated_hours')::numeric, 0)) FROM base b), 0),
    COALESCE((SELECT SUM(COALESCE((c.snap->>'estimated_hours')::numeric, 0)) FROM cur c), 0)
  INTO v_added, v_removed, v_modified, v_base_hours, v_cur_hours;

  RETURN jsonb_build_object(
    'success', true,
    'has_baseline', true,
    'baseline', jsonb_build_object('version_number', v_version.version_number,
                                   'status_at_snapshot', v_version.status_at_snapshot,
                                   'created_at', v_version.created_at),
    'added', v_added, 'removed', v_removed, 'modified', v_modified,
    'effort', jsonb_build_object('baseline_hours', v_base_hours,
                                 'current_hours', v_cur_hours,
                                 'delta_hours', v_cur_hours - v_base_hours)
  );
END;
$$;

-- ============================================================
-- PART B — PRIOR AUDIT HISTORY
-- ============================================================

CREATE OR REPLACE FUNCTION public.ia_prior_audit_history(p_engagement_id uuid, p_same_function_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eng record; v_audits jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_NOT_FOUND');
  END IF;

  -- Auditor-private capability: management respondents never reach this workspace.
  IF NOT public.ia_cmd_guard('audit_engagements', 'view', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'Prior Audit History is an auditor-private workspace.');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'planned_start_date' DESC NULLS LAST), '[]'::jsonb)
    INTO v_audits
  FROM (
    SELECT jsonb_build_object(
      'engagement_id', pe.id,
      'reference', COALESCE(pe.engagement_code, LEFT(pe.id::text, 8)),
      'title', pe.engagement_name,
      'department_id', pe.department_id,
      'department', d.name,
      'function_id', pe.function_id,
      'function', f.function_name,
      'planned_start_date', pe.planned_start_date,
      'planned_end_date', pe.planned_end_date,
      'period', COALESCE(pe.planned_start_date::text, '') || ' → ' || COALESCE(pe.planned_end_date::text, ''),
      'execution_status', pe.execution_status,
      'closure_status', COALESCE(pe.execution_status, pe.status),
      'closure_date', pe.closure_date,
      'final_report_date', (SELECT MAX(r.issued_at) FROM public.ia_audit_reports r WHERE r.engagement_id = pe.id),
      'findings', (
        SELECT jsonb_build_object(
          'total', count(*),
          'critical', count(*) FILTER (WHERE fi.severity = 'Critical' OR fi.risk_rating = 'Critical'),
          'high', count(*) FILTER (WHERE fi.severity = 'High' OR fi.risk_rating = 'High'),
          'medium', count(*) FILTER (WHERE fi.severity = 'Medium' OR fi.risk_rating = 'Medium'),
          'low', count(*) FILTER (WHERE fi.severity = 'Low' OR fi.risk_rating = 'Low'),
          'open', count(*) FILTER (WHERE COALESCE(fi.lifecycle_status, fi.status) NOT IN ('Closed','Resolved')),
          'closed', count(*) FILTER (WHERE COALESCE(fi.lifecycle_status, fi.status) IN ('Closed','Resolved')))
          FROM public.ia_findings fi WHERE fi.engagement_id = pe.id),
      'actions', (
        SELECT jsonb_build_object(
          'total', count(*),
          'open', count(*) FILTER (WHERE COALESCE(a.lifecycle_status, a.status) IN ('Open','Not Started')),
          'in_progress', count(*) FILTER (WHERE COALESCE(a.lifecycle_status, a.status) = 'In Progress'),
          'overdue', count(*) FILTER (WHERE COALESCE(a.current_target_date, a.target_date) < CURRENT_DATE
                                        AND COALESCE(a.lifecycle_status, a.status) NOT IN ('Closed','Verified','Cancelled')),
          'completion_submitted', count(*) FILTER (WHERE COALESCE(a.lifecycle_status,'') = 'Completion Submitted'),
          'in_verification', count(*) FILTER (WHERE COALESCE(a.verification_status,'') = 'In Verification'),
          'verified', count(*) FILTER (WHERE COALESCE(a.verification_status,'') = 'Verified'),
          'closed', count(*) FILTER (WHERE COALESCE(a.lifecycle_status, a.status) = 'Closed'))
          FROM public.ia_action_tracking a WHERE a.engagement_id = pe.id),
      'follow_ups', (
        SELECT jsonb_build_object(
          'total', count(*),
          'scheduled', count(*) FILTER (WHERE COALESCE(fu.lifecycle_status, fu.status) = 'Scheduled'),
          'due', count(*) FILTER (WHERE fu.scheduled_follow_up_date = CURRENT_DATE),
          'overdue', count(*) FILTER (WHERE fu.scheduled_follow_up_date < CURRENT_DATE
                                        AND COALESCE(fu.lifecycle_status, fu.status) NOT IN ('Completed','Closed')),
          'implemented', count(*) FILTER (WHERE fu.outcome = 'Implemented'),
          'partially_implemented', count(*) FILTER (WHERE fu.outcome = 'Partially Implemented'),
          'not_implemented', count(*) FILTER (WHERE fu.outcome = 'Not Implemented'),
          'reopened', count(*) FILTER (WHERE fu.outcome = 'Reopened'))
          FROM public.ia_follow_ups fu WHERE fu.engagement_id = pe.id)
    ) x
    FROM public.ia_audit_engagements pe
    LEFT JOIN public.ia_departments d ON d.id = pe.department_id
    LEFT JOIN public.ia_department_functions f ON f.id = pe.function_id
    WHERE pe.id <> p_engagement_id
      AND pe.department_id IS NOT DISTINCT FROM v_eng.department_id
      AND (NOT p_same_function_only OR pe.function_id IS NOT DISTINCT FROM v_eng.function_id)
      AND COALESCE(pe.is_active, true)
  ) s;

  RETURN jsonb_build_object(
    'success', true,
    'engagement_id', p_engagement_id,
    'department_id', v_eng.department_id,
    'function_id', v_eng.function_id,
    'acknowledged_at', v_eng.prior_history_reviewed_at,
    'acknowledged_by', v_eng.prior_history_reviewed_by,
    'acknowledgement_note', v_eng.prior_history_review_note,
    'prior_audits', v_audits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_prior_action_detail(p_engagement_id uuid, p_same_function_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eng record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_NOT_FOUND');
  END IF;
  IF NOT public.ia_cmd_guard('audit_engagements', 'view', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'Prior Audit History is an auditor-private workspace.');
  END IF;

  RETURN jsonb_build_object('success', true, 'actions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'action_id', a.id,
      'action_ref', COALESCE(a.action_ref, LEFT(a.id::text, 8)),
      'source_engagement_id', a.engagement_id,
      'source_audit', pe.engagement_name,
      'source_audit_ref', COALESCE(pe.engagement_code, LEFT(pe.id::text, 8)),
      'finding_id', a.finding_id,
      'finding_ref', LEFT(COALESCE(fi.id::text,''), 8),
      'finding_title', fi.title,
      'recommendation', COALESCE(a.action_description, fi.recommendation),
      'severity', COALESCE(fi.severity, fi.risk_rating),
      'responsible_person', a.responsible_person,
      'accountable_department_id', COALESCE(a.accountable_department_id, a.department_id),
      'accountable_department', d.name,
      'function', f.function_name,
      'original_due_date', COALESCE(a.original_target_date, a.target_date),
      'current_target_date', COALESCE(a.current_target_date, a.target_date),
      'progress_pct', COALESCE(a.progress_pct, 0),
      'lifecycle_status', COALESCE(a.lifecycle_status, a.status),
      'verification_status', a.verification_status,
      'follow_up_status', (SELECT COALESCE(fu.outcome, fu.lifecycle_status, fu.status)
                             FROM public.ia_follow_ups fu WHERE fu.action_id = a.id
                            ORDER BY fu.created_at DESC LIMIT 1),
      'last_progress_date', a.latest_update_at,
      'linked_to_current', EXISTS (SELECT 1 FROM public.ia_prior_action_reference pr
                                    WHERE pr.current_engagement_id = p_engagement_id
                                      AND pr.prior_action_id = a.id AND pr.is_active),
      'link', (SELECT jsonb_build_object('id', pr.id, 'relationship_type', pr.relationship_type,
                                         'relevance_reason', pr.relevance_reason,
                                         'linked_by', pr.linked_by, 'linked_at', pr.linked_at)
                 FROM public.ia_prior_action_reference pr
                WHERE pr.current_engagement_id = p_engagement_id
                  AND pr.prior_action_id = a.id AND pr.is_active LIMIT 1)
    ) ORDER BY COALESCE(a.current_target_date, a.target_date) NULLS LAST)
    FROM public.ia_action_tracking a
    JOIN public.ia_audit_engagements pe ON pe.id = a.engagement_id
    LEFT JOIN public.ia_findings fi ON fi.id = a.finding_id
    LEFT JOIN public.ia_departments d ON d.id = COALESCE(a.accountable_department_id, a.department_id)
    LEFT JOIN public.ia_department_functions f ON f.id = a.function_id
    WHERE pe.id <> p_engagement_id
      AND pe.department_id IS NOT DISTINCT FROM v_eng.department_id
      AND (NOT p_same_function_only OR pe.function_id IS NOT DISTINCT FROM v_eng.function_id)
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_link_prior_action(
  p_engagement_id uuid,
  p_prior_action_id uuid,
  p_relationship_type text DEFAULT 'PRIOR_ACTION_REVIEW',
  p_relevance_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor text := public.ia_actor_label(); v_action record; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT public.ia_cmd_guard('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to reference prior audit work in this audit.');
  END IF;
  IF p_relationship_type NOT IN ('PRIOR_ACTION_REVIEW','REPEAT_FINDING','FOLLOWUP_RETEST') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_RELATIONSHIP');
  END IF;

  SELECT * INTO v_action FROM public.ia_action_tracking WHERE id = p_prior_action_id;
  IF v_action IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ACTION_NOT_FOUND');
  END IF;
  IF v_action.engagement_id = p_engagement_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ACTION_NOT_PRIOR',
      'error', 'That corrective action already belongs to this audit.');
  END IF;

  INSERT INTO public.ia_prior_action_reference (
    current_engagement_id, prior_action_id, prior_engagement_id,
    relationship_type, relevance_reason, linked_by, linked_by_profile)
  VALUES (p_engagement_id, p_prior_action_id, v_action.engagement_id,
          p_relationship_type, p_relevance_reason, v_actor, auth.uid())
  ON CONFLICT (current_engagement_id, prior_action_id) WHERE is_active
  DO UPDATE SET relationship_type = EXCLUDED.relationship_type,
                relevance_reason = EXCLUDED.relevance_reason,
                updated_at = now()
  RETURNING id INTO v_id;

  PERFORM public.ia_log_event('IA.PRIOR_ACTION.REFERENCED', 'engagement', p_engagement_id, p_engagement_id,
    NULL, NULL,
    jsonb_build_object('prior_action_id', p_prior_action_id,
                       'prior_engagement_id', v_action.engagement_id,
                       'relationship_type', p_relationship_type),
    p_relevance_reason, NULL, 'ia_link_prior_action');

  RETURN jsonb_build_object('success', true, 'reference_id', v_id,
                            'prior_action_id', p_prior_action_id,
                            'owning_engagement_id', v_action.engagement_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_unlink_prior_action(p_reference_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor text := public.ia_actor_label(); v_ref record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  SELECT * INTO v_ref FROM public.ia_prior_action_reference WHERE id = p_reference_id;
  IF v_ref IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_REFERENCE_NOT_FOUND');
  END IF;
  IF NOT public.ia_cmd_guard('audit_engagements', 'edit', v_ref.current_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN');
  END IF;

  UPDATE public.ia_prior_action_reference
     SET is_active = false, unlinked_by = v_actor, unlinked_at = now(), updated_at = now()
   WHERE id = p_reference_id;

  RETURN jsonb_build_object('success', true, 'reference_id', p_reference_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_acknowledge_prior_history(p_engagement_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor text := public.ia_actor_label();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT public.ia_cmd_guard('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ia_audit_engagements WHERE id = p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ENGAGEMENT_NOT_FOUND');
  END IF;

  UPDATE public.ia_audit_engagements
     SET prior_history_reviewed_at = now(),
         prior_history_reviewed_by = v_actor,
         prior_history_review_note = COALESCE(p_note, prior_history_review_note),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_engagement_id;

  PERFORM public.ia_log_event('IA.PREPARATION.PRIOR_HISTORY_REVIEWED', 'engagement', p_engagement_id,
    p_engagement_id, NULL, NULL, jsonb_build_object('reviewed_by', v_actor), p_note, NULL,
    'ia_acknowledge_prior_history');

  RETURN jsonb_build_object('success', true, 'acknowledged_at', now(), 'acknowledged_by', v_actor);
END;
$$;

-- Preparation completion now also requires the acknowledgement when history exists.
CREATE OR REPLACE FUNCTION public.ia_complete_preparation(p_engagement_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_eng record; v_actor text := public.ia_actor_label();
  v_open int; v_notified boolean; v_reasons text[] := ARRAY[]::text[]; v_prior int;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found'); END IF;
  IF NOT public.ia_cmd_guard('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to complete preparation for this engagement');
  END IF;

  SELECT count(*) INTO v_open FROM public.ia_preparation_checklists c
   WHERE c.engagement_id = p_engagement_id AND COALESCE(c.is_completed, false) = false;
  IF v_open > 0 THEN
    v_reasons := v_reasons || ARRAY[v_open || ' preparation checklist item(s) still open'];
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.ia_communication_stages cs
                  WHERE cs.engagement_id = p_engagement_id
                    AND cs.stage_code IN ('ENGAGEMENT_NOTIFICATION','AUDIT_NOTIFICATION')
                    AND cs.delivery_status IN ('Sent','Delivered','Acknowledged'))
      OR (v_eng.intimation_issued_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.omni_comms_business_event_outbox o
                       WHERE o.module_code = 'INTERNAL_AUDIT'
                         AND o.event_code = 'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED'
                         AND o.entity_id = p_engagement_id::text))
    INTO v_notified;
  IF NOT v_notified THEN
    v_reasons := v_reasons || ARRAY['Engagement notification must be issued to the auditee before preparation is complete'];
  END IF;

  SELECT count(*) INTO v_prior FROM public.ia_audit_engagements pe
   WHERE pe.id <> p_engagement_id
     AND pe.department_id IS NOT DISTINCT FROM v_eng.department_id
     AND COALESCE(pe.is_active, true);
  IF v_prior > 0 AND v_eng.prior_history_reviewed_at IS NULL THEN
    v_reasons := v_reasons || ARRAY['Prior Audit History must be reviewed and acknowledged (open prior actions do not block)'];
  END IF;

  IF array_length(v_reasons, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PREP_INCOMPLETE', 'error', array_to_string(v_reasons, '; '), 'reasons', to_jsonb(v_reasons));
  END IF;

  UPDATE public.ia_audit_engagements
     SET preparation_status = 'Complete',
         preparation_completed_at = now(),
         preparation_completed_by = v_actor,
         preparation_notes = COALESCE(p_notes, preparation_notes),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_engagement_id;

  PERFORM public.ia_log_event('IA.PREPARATION.COMPLETED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id, jsonb_build_object('preparation_status', v_eng.preparation_status),
    jsonb_build_object('preparation_status', 'Complete'), p_notes, NULL, 'ia_complete_preparation');

  RETURN jsonb_build_object('success', true, 'engagement_id', p_engagement_id, 'preparation_status', 'Complete');
END;
$$;

-- ============================================================
-- PART D — ACCESS MATRIX + PERMISSION RECONCILIATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.ia_access_matrix()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT (public.ia_actor_can('audit_configuration', 'configure')
          OR public.ia_actor_can('internal_audit_configuration', 'view')
          OR public.has_role(auth.uid(), 'Admin'::app_role)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'The Access Matrix is an Internal Audit administration screen.');
  END IF;

  WITH ia_perms AS (
    SELECT ur.user_id, r.role_name, m.name module_name, ma.action_name
      FROM public.user_roles ur
      JOIN public.roles r ON r.role_name = ur.role::text
      JOIN public.role_permissions rp ON rp.role_id = r.id AND COALESCE(rp.is_granted, false)
      JOIN public.app_modules m ON m.id = rp.module_id
      JOIN public.module_actions ma ON ma.id = rp.action_id
     WHERE m.name = ANY (public.ia_capability_modules())
  ), candidates AS (
    SELECT DISTINCT user_id FROM ia_perms
    UNION SELECT a.profile_id FROM public.ia_auditors a WHERE a.profile_id IS NOT NULL
    UNION SELECT a.user_id FROM public.ia_auditors a WHERE a.user_id IS NOT NULL
    UNION SELECT d.head_profile_id FROM public.ia_departments d WHERE d.head_profile_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'full_name'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'profile_id', p.id,
      'full_name', COALESCE(p.full_name, p.email),
      'email', p.email,
      'is_active', COALESCE(p.is_active, true),
      'roles', COALESCE((SELECT jsonb_agg(DISTINCT ur.role::text) FROM public.user_roles ur WHERE ur.user_id = p.id), '[]'::jsonb),
      'ia_roles', COALESCE((SELECT jsonb_agg(DISTINCT ip.role_name) FROM ia_perms ip WHERE ip.user_id = p.id), '[]'::jsonb),
      'capabilities', COALESCE((SELECT jsonb_agg(DISTINCT ip.module_name || ':' || ip.action_name)
                                  FROM ia_perms ip WHERE ip.user_id = p.id), '[]'::jsonb),
      'auditor', (SELECT jsonb_build_object('id', a.id, 'employee_no', a.employee_no,
                                            'auditor_role', a.role, 'seniority', a.seniority_level,
                                            'employment_status', a.employment_status)
                    FROM public.ia_auditors a
                   WHERE a.profile_id = p.id OR a.user_id = p.id LIMIT 1),
      'department_scope', COALESCE((SELECT jsonb_agg(DISTINCT d.name) FROM public.ia_departments d
                                     WHERE d.head_profile_id = p.id), '[]'::jsonb),
      'lead_assignments', COALESCE((SELECT count(*) FROM public.ia_audit_engagements e
                                     JOIN public.ia_auditors a ON a.id = e.lead_auditor_id
                                    WHERE (a.profile_id = p.id OR a.user_id = p.id)
                                      AND COALESCE(e.is_active, true)), 0),
      'reviewer_assignments', COALESCE((SELECT count(*) FROM public.ia_audit_engagements e
                                         JOIN public.ia_auditors a ON a.id = e.reviewer_id
                                        WHERE (a.profile_id = p.id OR a.user_id = p.id)
                                          AND COALESCE(e.is_active, true)), 0),
      'active_engagements', COALESCE((SELECT count(*) FROM public.ia_audit_engagements e
                                       JOIN public.ia_auditors a ON a.id IN (e.lead_auditor_id, e.reviewer_id)
                                      WHERE (a.profile_id = p.id OR a.user_id = p.id)
                                        AND COALESCE(e.is_active, true)
                                        AND COALESCE(e.execution_status, '') NOT IN ('Closed','Cancelled')), 0),
      'sod_conflicts', (
        SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM (
          SELECT 'PLAN_PREPARER_AND_APPROVER' c WHERE EXISTS (
            SELECT 1 FROM ia_perms ip WHERE ip.user_id = p.id AND ip.module_name = 'audit_plans' AND ip.action_name IN ('edit','create','submit'))
            AND EXISTS (SELECT 1 FROM ia_perms ip WHERE ip.user_id = p.id AND ip.module_name = 'plan_approval' AND ip.action_name = 'approve')
          UNION ALL
          SELECT 'LEAD_AND_QUALITY_REVIEWER' WHERE EXISTS (
            SELECT 1 FROM public.ia_audit_engagements e JOIN public.ia_auditors a ON a.id = e.lead_auditor_id
             WHERE (a.profile_id = p.id OR a.user_id = p.id) AND COALESCE(e.is_active, true))
            AND EXISTS (SELECT 1 FROM ia_perms ip WHERE ip.user_id = p.id AND ip.module_name = 'quality_review' AND ip.action_name = 'approve')
          UNION ALL
          SELECT 'AUDITOR_AND_MANAGEMENT_SAME_SCOPE' WHERE EXISTS (
            SELECT 1 FROM public.ia_audit_engagements e
              JOIN public.ia_auditors a ON a.id IN (e.lead_auditor_id, e.reviewer_id)
              JOIN public.ia_departments d ON d.id = e.department_id
             WHERE (a.profile_id = p.id OR a.user_id = p.id) AND d.head_profile_id = p.id)
          UNION ALL
          SELECT 'ADMIN_AND_BUSINESS_APPROVER' WHERE EXISTS (
            SELECT 1 FROM ia_perms ip WHERE ip.user_id = p.id AND ip.module_name = 'audit_configuration' AND ip.action_name = 'configure')
            AND EXISTS (SELECT 1 FROM ia_perms ip WHERE ip.user_id = p.id AND ip.module_name = 'plan_approval' AND ip.action_name = 'approve')
          UNION ALL
          SELECT 'ACTION_OWNER_AND_VERIFIER' WHERE EXISTS (
            SELECT 1 FROM public.ia_action_tracking t
             WHERE t.responsible_profile_id = p.id AND t.verified_by_profile = p.id)
        ) q)
    ) x
    FROM public.profiles p
    WHERE p.id IN (SELECT user_id FROM candidates WHERE user_id IS NOT NULL)
  ) s;

  RETURN jsonb_build_object('success', true, 'users', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_permission_reconciliation(p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb; v_unused jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT (public.ia_actor_can('audit_configuration', 'configure')
          OR public.ia_actor_can('internal_audit_configuration', 'view')
          OR public.has_role(auth.uid(), 'Admin'::app_role)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN');
  END IF;

  WITH expected AS (
    SELECT e->>'capability' capability, e->>'module' module_name, e->>'action' action_name
      FROM jsonb_array_elements(COALESCE(p_expected, '[]'::jsonb)) e
  ), resolved AS (
    SELECT x.*,
           m.id module_id, m.is_enabled module_enabled,
           ma.id action_id, ma.is_enabled action_enabled
      FROM expected x
      LEFT JOIN public.app_modules m ON m.name = x.module_name
      LEFT JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = x.action_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'capability', r.capability,
    'module', r.module_name,
    'action', r.action_name,
    'registry_status', CASE
        WHEN r.module_id IS NULL THEN 'MISSING_MODULE'
        WHEN r.action_id IS NULL THEN 'MISSING_ACTION'
        WHEN NOT COALESCE(r.module_enabled, false) OR NOT COALESCE(r.action_enabled, false) THEN 'DISABLED'
        ELSE 'REGISTERED' END,
    'roles_granted', COALESCE((SELECT jsonb_agg(DISTINCT ro.role_name)
                                 FROM public.role_permissions rp
                                 JOIN public.roles ro ON ro.id = rp.role_id
                                WHERE rp.module_id = r.module_id AND rp.action_id = r.action_id
                                  AND COALESCE(rp.is_granted, false)), '[]'::jsonb),
    'grant_count', COALESCE((SELECT count(*) FROM public.role_permissions rp
                              WHERE rp.module_id = r.module_id AND rp.action_id = r.action_id
                                AND COALESCE(rp.is_granted, false)), 0),
    'final_status', CASE
        WHEN r.module_id IS NULL OR r.action_id IS NULL THEN 'MISSING'
        WHEN NOT COALESCE(r.module_enabled, false) OR NOT COALESCE(r.action_enabled, false) THEN 'MISMATCHED'
        WHEN NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                          WHERE rp.module_id = r.module_id AND rp.action_id = r.action_id
                            AND COALESCE(rp.is_granted, false)) THEN 'UNUSED'
        ELSE 'PASS' END
  ) ORDER BY r.capability, r.module_name, r.action_name), '[]'::jsonb) INTO v_rows FROM resolved r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('module', m.name, 'action', ma.action_name)
                            ORDER BY m.name, ma.action_name), '[]'::jsonb) INTO v_unused
    FROM public.app_modules m
    JOIN public.module_actions ma ON ma.module_id = m.id
   WHERE m.name = ANY (public.ia_capability_modules())
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(p_expected, '[]'::jsonb)) e
        WHERE e->>'module' = m.name AND e->>'action' = ma.action_name);

  RETURN jsonb_build_object('success', true, 'rows', v_rows, 'registry_only', v_unused);
END;
$$;

-- ---------- grants ----------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.ia_annual_plan_portfolio_summary(uuid)',
    'public.ia_annual_plan_coverage(uuid)',
    'public.ia_annual_plan_version_diff(uuid)',
    'public.ia_prior_audit_history(uuid, boolean)',
    'public.ia_prior_action_detail(uuid, boolean)',
    'public.ia_link_prior_action(uuid, uuid, text, text)',
    'public.ia_unlink_prior_action(uuid)',
    'public.ia_acknowledge_prior_history(uuid, text)',
    'public.ia_complete_preparation(uuid, text)',
    'public.ia_access_matrix()',
    'public.ia_permission_reconciliation(jsonb)',
    'public.ia_capability_modules()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

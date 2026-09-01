CREATE INDEX IF NOT EXISTS idx_ce_inspections_number ON public.ce_inspections (inspection_number);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_employer ON public.ce_inspections (employer_id);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_inspector ON public.ce_inspections (inspector_id);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_status ON public.ce_inspections (status);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_sched ON public.ce_inspections (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_type ON public.ce_inspections (inspection_type);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_territory ON public.ce_inspections (territory);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_plan_item ON public.ce_inspections (plan_item_id);
CREATE INDEX IF NOT EXISTS idx_ce_inspections_case ON public.ce_inspections (case_id);
CREATE INDEX IF NOT EXISTS idx_ce_inspection_findings_inspection ON public.ce_inspection_findings (inspection_id);
CREATE INDEX IF NOT EXISTS idx_ce_employer_audit_reports_inspection ON public.ce_employer_audit_reports (inspection_id);

-- Canonical lifecycle normaliser: the persisted status column carries mixed
-- legacy casing ("Scheduled", "IN_PROGRESS", "Completed"). Lifecycle state and
-- timing state are deliberately kept separate.
CREATE OR REPLACE FUNCTION public.ce_inspection_lifecycle(_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE upper(replace(trim(coalesce(_status,'')), ' ', '_'))
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'COMPLETE' THEN 'COMPLETED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'CANCELED' THEN 'CANCELLED'
    WHEN 'RESCHEDULED' THEN 'RESCHEDULED'
    WHEN 'DRAFT' THEN 'DRAFT'
    WHEN 'ASSIGNED' THEN 'ASSIGNED'
    WHEN 'OVERDUE' THEN 'SCHEDULED'
    WHEN '' THEN 'SCHEDULED'
    ELSE 'SCHEDULED'
  END
$$;

CREATE OR REPLACE FUNCTION public.ce_inspection_identity_tokens(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ARRAY(
    SELECT DISTINCT lower(t) FROM (
      SELECT p.user_code AS t FROM public.profiles p WHERE p.id = _user_id
      UNION ALL SELECT p.employee_code FROM public.profiles p WHERE p.id = _user_id
      UNION ALL SELECT p.email FROM public.profiles p WHERE p.id = _user_id
      UNION ALL SELECT p.full_name FROM public.profiles p WHERE p.id = _user_id
      UNION ALL SELECT _user_id::text
    ) s WHERE NULLIF(trim(coalesce(t,'')),'') IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.ce_inspection_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'urgency',
  p_dir text DEFAULT 'asc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_export boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_access text := public.ce_field_ops_scope(auth.uid());
  v_me text[] := public.ce_inspection_identity_tokens(auth.uid());
  v_req_scope text := upper(coalesce(NULLIF(p_filters->>'scope',''),'AUTO'));
  v_scope text;
  v_search text := NULLIF(trim(coalesce(p_filters->>'search','')),'');
  v_quick text := upper(coalesce(NULLIF(p_filters->>'quick',''),'ALL'));
  v_statuses text[] := CASE WHEN p_filters ? 'statuses' THEN ARRAY(SELECT upper(jsonb_array_elements_text(p_filters->'statuses'))) END;
  v_types text[] := CASE WHEN p_filters ? 'types' THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'types')) END;
  v_zones text[] := CASE WHEN p_filters ? 'territories' THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'territories')) END;
  v_bands text[] := CASE WHEN p_filters ? 'risk_bands' THEN ARRAY(SELECT upper(jsonb_array_elements_text(p_filters->'risk_bands'))) END;
  v_timing text := upper(coalesce(NULLIF(p_filters->>'timing',''),'ANY'));
  v_findings text := upper(coalesce(NULLIF(p_filters->>'findings',''),'ANY'));
  v_report text := upper(coalesce(NULLIF(p_filters->>'report',''),'ANY'));
  v_evidence text := upper(coalesce(NULLIF(p_filters->>'evidence',''),'ANY'));
  v_inspector text := NULLIF(p_filters->>'inspector','');
  v_employer text := NULLIF(p_filters->>'employer','');
  v_plan text := NULLIF(p_filters->>'plan','');
  v_case text := NULLIF(p_filters->>'case','');
  v_from date := NULLIF(p_filters->>'date_from','')::date;
  v_to date := NULLIF(p_filters->>'date_to','')::date;
  v_page integer := greatest(1, coalesce(p_page,1));
  v_size integer := least(greatest(coalesce(p_page_size,25),1), CASE WHEN p_export THEN 5000 ELSE 200 END);
  v_dir text := CASE WHEN lower(coalesce(p_dir,'asc'))='desc' THEN 'desc' ELSE 'asc' END;
  v_sort text := lower(coalesce(NULLIF(p_sort,''),'urgency'));
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_result jsonb;
BEGIN
  IF v_access = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view the inspection register' USING ERRCODE = '42501';
  END IF;

  v_scope := CASE
    WHEN v_access = 'OWN' THEN 'MINE'
    WHEN v_req_scope IN ('MINE','TEAM','ALL') THEN v_req_scope
    ELSE 'ALL'
  END;

  WITH base AS (
    SELECT
      i.id,
      i.inspection_number,
      i.employer_id,
      i.employer_name,
      coalesce(NULLIF(i.territory,''), rp.territory) AS territory,
      i.inspection_type,
      i.status                                         AS raw_status,
      public.ce_inspection_lifecycle(i.status)         AS lifecycle_status,
      i.inspector_id,
      coalesce(NULLIF(i.inspector_name,''), pr.full_name) AS inspector_name,
      coalesce(pr.user_code, pr.employee_code, i.inspector_id) AS inspector_code,
      i.scheduled_date,
      i.scheduled_time,
      i.visit_date,
      i.actual_start,
      i.actual_end,
      i.check_in_time,
      i.check_out_time,
      i.location_address,
      i.notes,
      i.case_id,
      c.case_number,
      i.plan_item_id,
      pi.plan_id,
      wp.plan_number,
      pi.source_type,
      pi.source_ref,
      i.created_at,
      i.updated_at,
      rp.risk_band,
      rp.total_score AS risk_score,
      coalesce(f.cnt,0)::int          AS findings_count,
      coalesce(f.critical_high,0)::int AS critical_high_findings,
      coalesce(f.pending_review,0)::int AS findings_pending_review,
      coalesce(f.converted,0)::int     AS findings_converted,
      coalesce(ev.cnt,0)::int          AS evidence_count,
      r.report_id,
      r.report_number,
      coalesce(r.report_status,'NOT_STARTED') AS report_status,
      CASE
        WHEN i.scheduled_date IS NULL THEN 'NO_DATE'
        WHEN public.ce_inspection_lifecycle(i.status) IN ('COMPLETED','CANCELLED') THEN 'CLOSED'
        WHEN i.scheduled_date < v_today THEN 'OVERDUE'
        WHEN i.scheduled_date = v_today THEN 'DUE_TODAY'
        WHEN i.scheduled_date <= v_today + 7 THEN 'DUE_WEEK'
        ELSE 'FUTURE'
      END AS timing_status,
      (i.scheduled_date IS NOT NULL
        AND i.scheduled_date < v_today
        AND public.ce_inspection_lifecycle(i.status) NOT IN ('COMPLETED','CANCELLED')) AS is_overdue,
      CASE WHEN i.scheduled_date IS NOT NULL THEN (v_today - i.scheduled_date) END AS age_days,
      (lower(coalesce(i.inspector_id,'')) = ANY(v_me)
        OR lower(coalesce(i.inspector_name,'')) = ANY(v_me)
        OR lower(coalesce(i.created_by,'')) = ANY(v_me)
        OR wp.inspector_id = v_uid) AS is_mine
    FROM public.ce_inspections i
    LEFT JOIN public.profiles pr
      ON lower(coalesce(pr.user_code,'~')) = lower(coalesce(i.inspector_id,'-'))
      OR lower(coalesce(pr.employee_code,'~')) = lower(coalesce(i.inspector_id,'-'))
    LEFT JOIN public.ce_risk_profiles rp ON rp.employer_id = i.employer_id
    LEFT JOIN public.ce_cases c ON c.id = i.case_id
    LEFT JOIN public.ce_weekly_plan_items pi ON pi.id = i.plan_item_id
    LEFT JOIN public.ce_weekly_plans wp ON wp.id = pi.plan_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE upper(coalesce(x.severity,'')) IN ('CRITICAL','HIGH')) AS critical_high,
             count(*) FILTER (WHERE coalesce(x.disposition,'PENDING') IN ('PENDING','PENDING_REVIEW')) AS pending_review,
             count(*) FILTER (WHERE coalesce(x.violation_created,false)) AS converted
      FROM public.ce_inspection_findings x WHERE x.inspection_id = i.id
    ) f ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt FROM public.ce_inspection_evidence e WHERE e.inspection_id = i.id
    ) ev ON true
    LEFT JOIN LATERAL (
      SELECT ar.id AS report_id, ar.report_number, upper(ar.status) AS report_status
      FROM public.ce_employer_audit_reports ar
      WHERE ar.inspection_id = i.id
      ORDER BY ar.created_at DESC LIMIT 1
    ) r ON true
  ),
  scoped AS (
    SELECT * FROM base b
    WHERE (v_scope = 'ALL' OR b.is_mine)
  ),
  filtered AS (
    SELECT * FROM scoped b
    WHERE (v_statuses IS NULL OR array_length(v_statuses,1) IS NULL OR b.lifecycle_status = ANY(v_statuses))
      AND (v_types IS NULL OR array_length(v_types,1) IS NULL OR coalesce(b.inspection_type,'—') = ANY(v_types))
      AND (v_zones IS NULL OR array_length(v_zones,1) IS NULL OR coalesce(b.territory,'—') = ANY(v_zones))
      AND (v_bands IS NULL OR array_length(v_bands,1) IS NULL OR upper(coalesce(b.risk_band,'UNRATED')) = ANY(v_bands))
      AND (v_timing = 'ANY' OR b.timing_status = v_timing)
      AND (v_inspector IS NULL
           OR lower(coalesce(b.inspector_id,'')) = lower(v_inspector)
           OR lower(coalesce(b.inspector_name,'')) = lower(v_inspector)
           OR lower(coalesce(b.inspector_code,'')) = lower(v_inspector))
      AND (v_employer IS NULL OR b.employer_id = v_employer)
      AND (v_plan IS NULL OR b.plan_id::text = v_plan OR b.plan_number = v_plan)
      AND (v_case IS NULL OR b.case_id::text = v_case OR b.case_number = v_case)
      AND (v_from IS NULL OR b.scheduled_date >= v_from)
      AND (v_to IS NULL OR b.scheduled_date <= v_to)
      AND (v_findings = 'ANY'
           OR (v_findings = 'NONE' AND b.findings_count = 0)
           OR (v_findings = 'HAS' AND b.findings_count > 0)
           OR (v_findings = 'CRITICAL_HIGH' AND b.critical_high_findings > 0)
           OR (v_findings = 'PENDING_REVIEW' AND b.findings_pending_review > 0)
           OR (v_findings = 'CONVERTED' AND b.findings_converted > 0))
      AND (v_report = 'ANY' OR b.report_status = v_report)
      AND (v_evidence = 'ANY'
           OR (v_evidence = 'HAS' AND b.evidence_count > 0)
           OR (v_evidence = 'NONE' AND b.evidence_count = 0)
           OR (v_evidence = 'MISSING_ON_COMPLETED' AND b.evidence_count = 0 AND b.lifecycle_status = 'COMPLETED'))
      AND (v_search IS NULL
           OR b.inspection_number ILIKE '%'||v_search||'%'
           OR coalesce(b.employer_name,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.employer_id,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.inspector_name,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.inspector_id,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.inspector_code,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.plan_number,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.case_number,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.inspection_type,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.territory,'') ILIKE '%'||v_search||'%'
           OR coalesce(b.location_address,'') ILIKE '%'||v_search||'%')
      AND (v_quick = 'ALL'
           OR (v_quick = 'MINE' AND b.is_mine)
           OR (v_quick = 'TODAY' AND b.scheduled_date = v_today)
           OR (v_quick = 'SCHEDULED' AND b.lifecycle_status IN ('SCHEDULED','ASSIGNED','DRAFT'))
           OR (v_quick = 'IN_PROGRESS' AND b.lifecycle_status = 'IN_PROGRESS')
           OR (v_quick = 'OVERDUE' AND b.is_overdue)
           OR (v_quick = 'HAS_FINDINGS' AND b.findings_count > 0)
           OR (v_quick = 'REPORT_PENDING' AND b.lifecycle_status = 'COMPLETED' AND b.report_status <> 'FINAL')
           OR (v_quick = 'HIGH_RISK' AND upper(coalesce(b.risk_band,'')) IN ('HIGH','CRITICAL')))
  ),
  kpi AS (
    SELECT count(*) AS total,
      jsonb_build_object(
        'total', count(*),
        'due_today', count(*) FILTER (WHERE timing_status = 'DUE_TODAY'),
        'scheduled', count(*) FILTER (WHERE lifecycle_status IN ('SCHEDULED','ASSIGNED','DRAFT')),
        'in_progress', count(*) FILTER (WHERE lifecycle_status = 'IN_PROGRESS'),
        'overdue', count(*) FILTER (WHERE is_overdue),
        'completed_30d', count(*) FILTER (WHERE lifecycle_status = 'COMPLETED'
             AND coalesce(actual_end, updated_at, created_at) >= now() - interval '30 days'),
        'completed', count(*) FILTER (WHERE lifecycle_status = 'COMPLETED'),
        'cancelled', count(*) FILTER (WHERE lifecycle_status = 'CANCELLED'),
        'findings_total', coalesce(sum(findings_count),0),
        'findings_pending_review', coalesce(sum(findings_pending_review),0),
        'report_pending', count(*) FILTER (WHERE lifecycle_status = 'COMPLETED' AND report_status <> 'FINAL'),
        'high_risk', count(*) FILTER (WHERE upper(coalesce(risk_band,'')) IN ('HIGH','CRITICAL'))
      ) AS k
    FROM filtered
  ),
  attention AS (
    SELECT jsonb_build_object(
      'overdue_not_started', count(*) FILTER (WHERE is_overdue AND lifecycle_status IN ('SCHEDULED','ASSIGNED','DRAFT')),
      'stalled_in_progress', count(*) FILTER (WHERE lifecycle_status = 'IN_PROGRESS'
            AND coalesce(check_in_time, actual_start, updated_at, created_at) < now() - interval '2 days'),
      'completed_no_report', count(*) FILTER (WHERE lifecycle_status = 'COMPLETED' AND report_status = 'NOT_STARTED'),
      'completed_no_evidence', count(*) FILTER (WHERE lifecycle_status = 'COMPLETED' AND evidence_count = 0),
      'critical_findings_pending', count(*) FILTER (WHERE critical_high_findings > 0 AND findings_pending_review > 0),
      'unassigned', count(*) FILTER (WHERE NULLIF(trim(coalesce(inspector_name, inspector_id, '')),'') IS NULL)
    ) AS a
    FROM scoped
  ),
  ordered AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='urgency' THEN
          CASE WHEN f.is_overdue THEN 0
               WHEN f.lifecycle_status='IN_PROGRESS' THEN 1
               WHEN f.lifecycle_status IN ('SCHEDULED','ASSIGNED','DRAFT') THEN 2
               ELSE 3 END END ASC,
        CASE WHEN v_sort='urgency' THEN f.scheduled_date END ASC NULLS LAST,
        CASE WHEN v_sort='scheduled' AND v_dir='asc'  THEN f.scheduled_date END ASC NULLS LAST,
        CASE WHEN v_sort='scheduled' AND v_dir='desc' THEN f.scheduled_date END DESC NULLS LAST,
        CASE WHEN v_sort='inspection' AND v_dir='asc'  THEN f.inspection_number END ASC,
        CASE WHEN v_sort='inspection' AND v_dir='desc' THEN f.inspection_number END DESC,
        CASE WHEN v_sort='employer' AND v_dir='asc'  THEN lower(coalesce(f.employer_name,'')) END ASC,
        CASE WHEN v_sort='employer' AND v_dir='desc' THEN lower(coalesce(f.employer_name,'')) END DESC,
        CASE WHEN v_sort='inspector' AND v_dir='asc'  THEN lower(coalesce(f.inspector_name, f.inspector_id,'')) END ASC,
        CASE WHEN v_sort='inspector' AND v_dir='desc' THEN lower(coalesce(f.inspector_name, f.inspector_id,'')) END DESC,
        CASE WHEN v_sort='status' AND v_dir='asc'  THEN f.lifecycle_status END ASC,
        CASE WHEN v_sort='status' AND v_dir='desc' THEN f.lifecycle_status END DESC,
        CASE WHEN v_sort='type' AND v_dir='asc'  THEN lower(coalesce(f.inspection_type,'')) END ASC,
        CASE WHEN v_sort='type' AND v_dir='desc' THEN lower(coalesce(f.inspection_type,'')) END DESC,
        CASE WHEN v_sort='findings' AND v_dir='asc'  THEN f.findings_count END ASC,
        CASE WHEN v_sort='findings' AND v_dir='desc' THEN f.findings_count END DESC,
        CASE WHEN v_sort='risk' AND v_dir='asc'  THEN coalesce(f.risk_score,-1) END ASC,
        CASE WHEN v_sort='risk' AND v_dir='desc' THEN coalesce(f.risk_score,-1) END DESC,
        CASE WHEN v_sort='created' AND v_dir='asc'  THEN f.created_at END ASC,
        CASE WHEN v_sort='created' AND v_dir='desc' THEN f.created_at END DESC,
        CASE WHEN v_sort='completed' AND v_dir='asc'  THEN f.actual_end END ASC NULLS LAST,
        CASE WHEN v_sort='completed' AND v_dir='desc' THEN f.actual_end END DESC NULLS LAST,
        f.scheduled_date DESC NULLS LAST, f.created_at DESC
    ) AS __rn
    FROM filtered f
  ),
  paged AS (
    SELECT * FROM ordered
    WHERE __rn > CASE WHEN p_export THEN 0 ELSE (v_page - 1) * v_size END
    ORDER BY __rn
    LIMIT v_size
  )
  SELECT jsonb_build_object(
    'access', v_access,
    'scope', v_scope,
    'user_id', v_uid,
    'page', v_page,
    'page_size', v_size,
    'today', v_today,
    'total', (SELECT total FROM kpi),
    'kpis', (SELECT k FROM kpi),
    'attention', (SELECT a FROM attention),
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.__rn) FROM paged p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_inspection_register_facets_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_access text := public.ce_field_ops_scope(auth.uid());
BEGIN
  IF v_access = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view the inspection register' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'access', v_access,
    'statuses', coalesce((SELECT jsonb_agg(DISTINCT public.ce_inspection_lifecycle(status)) FROM public.ce_inspections), '[]'::jsonb),
    'types', coalesce((SELECT jsonb_agg(DISTINCT inspection_type) FROM public.ce_inspections WHERE NULLIF(trim(coalesce(inspection_type,'')),'') IS NOT NULL), '[]'::jsonb),
    'territories', coalesce((SELECT jsonb_agg(DISTINCT territory) FROM public.ce_inspections WHERE NULLIF(trim(coalesce(territory,'')),'') IS NOT NULL), '[]'::jsonb),
    'risk_bands', coalesce((SELECT jsonb_agg(DISTINCT upper(risk_band)) FROM public.ce_risk_profiles WHERE risk_band IS NOT NULL), '[]'::jsonb),
    'report_statuses', coalesce((SELECT jsonb_agg(DISTINCT upper(status)) FROM public.ce_employer_audit_reports WHERE status IS NOT NULL), '[]'::jsonb),
    'inspectors', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'code', t.code) ORDER BY t.name)
      FROM (
        SELECT DISTINCT ON (lower(coalesce(i.inspector_id, i.inspector_name)))
               coalesce(i.inspector_id, i.inspector_name) AS id,
               coalesce(NULLIF(i.inspector_name,''), pr.full_name, i.inspector_id) AS name,
               coalesce(pr.user_code, pr.employee_code, i.inspector_id) AS code
        FROM public.ce_inspections i
        LEFT JOIN public.profiles pr
          ON lower(coalesce(pr.user_code,'~')) = lower(coalesce(i.inspector_id,'-'))
          OR lower(coalesce(pr.employee_code,'~')) = lower(coalesce(i.inspector_id,'-'))
        WHERE NULLIF(trim(coalesce(i.inspector_id, i.inspector_name, '')),'') IS NOT NULL
      ) t
    ), '[]'::jsonb),
    'employers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.employer_id, 'name', t.employer_name) ORDER BY t.employer_name)
      FROM (SELECT DISTINCT employer_id, coalesce(employer_name, employer_id) AS employer_name
            FROM public.ce_inspections WHERE employer_id IS NOT NULL) t
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_inspection_detail_v1(p_inspection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_access text := public.ce_field_ops_scope(auth.uid());
  v_row jsonb;
BEGIN
  IF v_access = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view inspections' USING ERRCODE = '42501';
  END IF;

  SELECT (public.ce_inspection_register_v1(
            jsonb_build_object('scope','ALL'), 'created', 'desc', 1, 1, false) -> 'rows' -> 0)
  INTO v_row;

  RETURN jsonb_build_object(
    'inspection', (SELECT to_jsonb(i) FROM public.ce_inspections i WHERE i.id = p_inspection_id),
    'findings', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'title', f.title, 'finding_type', f.finding_type, 'severity', f.severity,
        'disposition', coalesce(f.disposition,'PENDING'), 'violation_created', f.violation_created,
        'created_at', f.created_at) ORDER BY f.created_at DESC)
      FROM public.ce_inspection_findings f WHERE f.inspection_id = p_inspection_id), '[]'::jsonb),
    'evidence', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'file_name', e.file_name, 'evidence_type', e.evidence_type,
        'description', e.description, 'captured_at', e.captured_at, 'captured_by', e.captured_by)
        ORDER BY e.created_at DESC)
      FROM public.ce_inspection_evidence e WHERE e.inspection_id = p_inspection_id), '[]'::jsonb),
    'report', (SELECT jsonb_build_object('id', ar.id, 'report_number', ar.report_number,
        'status', ar.status, 'report_date', ar.report_date, 'total_findings', ar.total_findings)
      FROM public.ce_employer_audit_reports ar WHERE ar.inspection_id = p_inspection_id
      ORDER BY ar.created_at DESC LIMIT 1)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ce_inspection_register_v1(jsonb, text, text, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_inspection_register_facets_v1() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_inspection_detail_v1(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_inspection_identity_tokens(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_inspection_register_v1(jsonb, text, text, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_inspection_register_facets_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_inspection_detail_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_inspection_identity_tokens(uuid) TO authenticated, service_role;
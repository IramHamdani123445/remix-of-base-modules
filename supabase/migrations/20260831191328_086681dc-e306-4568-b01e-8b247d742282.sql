CREATE OR REPLACE FUNCTION public.ce_field_operations_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'schedule',
  p_dir text DEFAULT 'desc',
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
  v_scope text := public.ce_field_ops_scope(auth.uid());
  v_search text := NULLIF(trim(coalesce(p_filters->>'search','')), '');
  v_quick text := upper(coalesce(NULLIF(p_filters->>'quick',''), 'ALL'));
  v_statuses text[] := CASE WHEN p_filters ? 'statuses'
      THEN ARRAY(SELECT upper(jsonb_array_elements_text(p_filters->'statuses'))) END;
  v_types text[] := CASE WHEN p_filters ? 'visit_types'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'visit_types')) END;
  v_territories text[] := CASE WHEN p_filters ? 'territories'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'territories')) END;
  v_inspector text := NULLIF(p_filters->>'inspector','');
  v_employer text := NULLIF(p_filters->>'employer','');
  v_plan text := NULLIF(p_filters->>'plan_id','');
  v_from date := NULLIF(p_filters->>'date_from','')::date;
  v_to date := NULLIF(p_filters->>'date_to','')::date;
  v_mine boolean := coalesce((p_filters->>'mine_only')::boolean, false);
  v_page integer := greatest(1, coalesce(p_page,1));
  v_size integer := least(greatest(coalesce(p_page_size,25),1), CASE WHEN p_export THEN 2000 ELSE 200 END);
  v_dir text := CASE WHEN lower(coalesce(p_dir,'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := lower(coalesce(NULLIF(p_sort,''),'schedule'));
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_result jsonb;
BEGIN
  IF v_scope = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view field operations' USING ERRCODE = '42501';
  END IF;

  WITH base AS (
    SELECT
      i.id,
      i.plan_id,
      w.plan_number,
      w.status                                  AS plan_status,
      w.inspector_id,
      coalesce(w.inspector_name, pr.full_name)  AS inspector_name,
      coalesce(pr.user_code, pr.employee_code)  AS inspector_code,
      i.employer_id,
      i.employer_name,
      coalesce(NULLIF(i.territory,''), NULLIF(i.area_name,'')) AS territory,
      coalesce(NULLIF(i.visit_type,''), i.item_type, 'VISIT')  AS visit_type,
      i.purpose,
      i.priority,
      i.source_type,
      i.source_ref,
      i.is_mandatory,
      i.scheduled_date,
      i.scheduled_start_time,
      i.scheduled_end_time,
      upper(coalesce(i.execution_status,'PLANNED')) AS execution_status,
      i.check_in_time,
      i.check_in_gps_lat,
      i.check_in_gps_lng,
      i.check_out_time,
      i.check_out_gps_lat,
      i.check_out_gps_lng,
      i.outcome_notes,
      i.findings          AS findings_note,
      i.not_done_reason,
      i.rescheduled_to,
      i.created_at,
      i.updated_at,
      insp.id             AS inspection_id,
      insp.inspection_number,
      insp.status         AS inspection_status,
      (SELECT count(*) FROM public.ce_inspection_evidence e
         WHERE e.plan_item_id = i.id
            OR (insp.id IS NOT NULL AND e.inspection_id = insp.id))::int AS evidence_count,
      (SELECT count(*) FROM public.ce_inspection_findings f
         WHERE insp.id IS NOT NULL AND f.inspection_id = insp.id)::int   AS findings_count,
      (SELECT count(*) FROM public.ce_inspection_working_papers wp
         WHERE insp.id IS NOT NULL AND wp.inspection_id = insp.id)::int  AS working_papers_count,
      CASE
        WHEN i.check_in_time IS NOT NULL AND i.check_out_time IS NOT NULL
          THEN round(extract(epoch FROM (i.check_out_time - i.check_in_time)) / 60.0)::int
        WHEN i.check_in_time IS NOT NULL
          THEN round(extract(epoch FROM (now() - i.check_in_time)) / 60.0)::int
        ELSE NULL
      END AS duration_minutes,
      (i.scheduled_date < v_today
        AND upper(coalesce(i.execution_status,'PLANNED')) IN ('PLANNED','PENDING')) AS is_overdue,
      (v_today - i.scheduled_date) AS age_days
    FROM public.ce_weekly_plan_items i
    JOIN public.ce_weekly_plans w ON w.id = i.plan_id
    LEFT JOIN public.profiles pr ON pr.id = w.inspector_id
    LEFT JOIN LATERAL (
      SELECT x.id, x.inspection_number, x.status
      FROM public.ce_inspections x
      WHERE x.plan_item_id = i.id
      ORDER BY x.created_at DESC
      LIMIT 1
    ) insp ON true
    WHERE coalesce(w.is_current_version, true)
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE (v_scope = 'ALL' OR b.inspector_id = v_uid)
      AND (NOT v_mine OR b.inspector_id = v_uid)
      AND (v_statuses IS NULL OR array_length(v_statuses,1) IS NULL OR b.execution_status = ANY(v_statuses))
      AND (v_types IS NULL OR array_length(v_types,1) IS NULL OR b.visit_type = ANY(v_types))
      AND (v_territories IS NULL OR array_length(v_territories,1) IS NULL OR b.territory = ANY(v_territories))
      AND (v_inspector IS NULL OR b.inspector_id::text = v_inspector
           OR lower(coalesce(b.inspector_name,'')) = lower(v_inspector)
           OR lower(coalesce(b.inspector_code,'')) = lower(v_inspector))
      AND (v_employer IS NULL OR b.employer_id = v_employer)
      AND (v_plan IS NULL OR b.plan_id::text = v_plan)
      AND (v_from IS NULL OR b.scheduled_date >= v_from)
      AND (v_to IS NULL OR b.scheduled_date <= v_to)
      AND (
        v_search IS NULL OR
        b.employer_name ILIKE '%'||v_search||'%' OR
        b.employer_id ILIKE '%'||v_search||'%' OR
        b.plan_number ILIKE '%'||v_search||'%' OR
        coalesce(b.inspector_name,'') ILIKE '%'||v_search||'%' OR
        coalesce(b.inspector_code,'') ILIKE '%'||v_search||'%' OR
        coalesce(b.territory,'') ILIKE '%'||v_search||'%' OR
        coalesce(b.source_ref,'') ILIKE '%'||v_search||'%' OR
        coalesce(b.inspection_number,'') ILIKE '%'||v_search||'%' OR
        coalesce(b.purpose,'') ILIKE '%'||v_search||'%' OR
        coalesce(b.visit_type,'') ILIKE '%'||v_search||'%'
      )
      AND (
        v_quick = 'ALL'
        OR (v_quick = 'ACTIVE'    AND b.check_in_time IS NOT NULL AND b.check_out_time IS NULL)
        OR (v_quick = 'TODAY'     AND b.scheduled_date = v_today)
        OR (v_quick = 'PLANNED'   AND b.execution_status IN ('PLANNED','PENDING'))
        OR (v_quick = 'COMPLETED' AND b.execution_status = 'COMPLETED')
        OR (v_quick = 'OVERDUE'   AND b.is_overdue)
        OR (v_quick = 'NO_EVIDENCE' AND b.evidence_count = 0
            AND b.execution_status IN ('IN_PROGRESS','COMPLETED'))
        OR (v_quick = 'MINE'      AND b.inspector_id = v_uid)
      )
  ),
  kpi AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'active_visits', count(*) FILTER (WHERE check_in_time IS NOT NULL AND check_out_time IS NULL),
      'scheduled_today', count(*) FILTER (WHERE scheduled_date = v_today),
      'planned', count(*) FILTER (WHERE execution_status IN ('PLANNED','PENDING')),
      'in_progress', count(*) FILTER (WHERE execution_status = 'IN_PROGRESS'),
      'completed', count(*) FILTER (WHERE execution_status = 'COMPLETED'),
      'overdue', count(*) FILTER (WHERE is_overdue),
      'evidence_total', coalesce(sum(evidence_count),0),
      'no_evidence', count(*) FILTER (WHERE evidence_count = 0
          AND execution_status IN ('IN_PROGRESS','COMPLETED')),
      'findings_total', coalesce(sum(findings_count),0),
      'avg_visit_minutes', round(avg(duration_minutes) FILTER (WHERE check_out_time IS NOT NULL))
    ) AS k, count(*) AS total
    FROM filtered
  ),
  ordered AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='schedule'  AND v_dir='asc'  THEN f.scheduled_date END ASC,
        CASE WHEN v_sort='schedule'  AND v_dir='desc' THEN f.scheduled_date END DESC,
        CASE WHEN v_sort='employer'  AND v_dir='asc'  THEN lower(f.employer_name) END ASC,
        CASE WHEN v_sort='employer'  AND v_dir='desc' THEN lower(f.employer_name) END DESC,
        CASE WHEN v_sort='inspector' AND v_dir='asc'  THEN lower(coalesce(f.inspector_name,'')) END ASC,
        CASE WHEN v_sort='inspector' AND v_dir='desc' THEN lower(coalesce(f.inspector_name,'')) END DESC,
        CASE WHEN v_sort='status'    AND v_dir='asc'  THEN f.execution_status END ASC,
        CASE WHEN v_sort='status'    AND v_dir='desc' THEN f.execution_status END DESC,
        CASE WHEN v_sort='evidence'  AND v_dir='asc'  THEN f.evidence_count END ASC,
        CASE WHEN v_sort='evidence'  AND v_dir='desc' THEN f.evidence_count END DESC,
        CASE WHEN v_sort='checkin'   AND v_dir='asc'  THEN f.check_in_time END ASC,
        CASE WHEN v_sort='checkin'   AND v_dir='desc' THEN f.check_in_time END DESC,
        CASE WHEN v_sort='territory' AND v_dir='asc'  THEN lower(coalesce(f.territory,'')) END ASC,
        CASE WHEN v_sort='territory' AND v_dir='desc' THEN lower(coalesce(f.territory,'')) END DESC,
        f.scheduled_date DESC, f.created_at DESC
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
    'scope', v_scope,
    'user_id', v_uid,
    'page', v_page,
    'page_size', v_size,
    'total', (SELECT total FROM kpi),
    'kpis', (SELECT k FROM kpi),
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.__rn) FROM paged p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ce_field_operations_register_v1(jsonb, text, text, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_field_operations_register_v1(jsonb, text, text, integer, integer, boolean) TO authenticated, service_role;
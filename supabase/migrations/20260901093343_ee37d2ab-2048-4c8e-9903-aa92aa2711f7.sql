CREATE OR REPLACE FUNCTION public.ia_annual_plan_portfolio_summary_core(p_plan_id uuid)
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

CREATE OR REPLACE FUNCTION public.ia_annual_plan_coverage_core(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
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

CREATE OR REPLACE FUNCTION public.ia_annual_plan_version_diff_core(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version record; v_added jsonb; v_removed jsonb; v_modified jsonb;
        v_base_hours numeric := 0; v_cur_hours numeric := 0;
BEGIN
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

REVOKE ALL ON FUNCTION public.ia_annual_plan_portfolio_summary_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ia_annual_plan_coverage_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ia_annual_plan_version_diff_core(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_annual_plan_portfolio_summary_core(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_annual_plan_coverage_core(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_annual_plan_version_diff_core(uuid) TO service_role;
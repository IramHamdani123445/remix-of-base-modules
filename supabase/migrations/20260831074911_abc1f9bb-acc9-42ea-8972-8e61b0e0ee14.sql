
CREATE OR REPLACE FUNCTION public.ce_inspector_workboard_analytics(
  p_identities text[],
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_today date := (now() at time zone 'UTC')::date;
  v_span int;
  v_grain text;
  v_prev_from date;
  v_prev_to date;
  v_open_v text[] := ARRAY['OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED'];
  v_active_a text[] := ARRAY['PLANNED','SCHEDULED','IN_PROGRESS','OVERDUE'];
  v_result jsonb;
BEGIN
  IF p_identities IS NULL OR array_length(p_identities, 1) IS NULL THEN
    RETURN jsonb_build_object('scoped', false);
  END IF;

  p_to := COALESCE(p_to, v_today);
  p_from := COALESCE(p_from, p_to - 29);
  v_span := GREATEST((p_to - p_from) + 1, 1);
  v_grain := CASE WHEN v_span <= 31 THEN 'day' ELSE 'week' END;
  v_prev_to := p_from - 1;
  v_prev_from := v_prev_to - (v_span - 1);

  WITH
  buckets AS (
    SELECT generate_series(
             date_trunc(v_grain, p_from::timestamp),
             date_trunc(v_grain, p_to::timestamp),
             CASE WHEN v_grain = 'day' THEN interval '1 day' ELSE interval '1 week' END
           )::date AS b
  ),
  my_actions AS (
    SELECT * FROM ce_follow_up_actions
    WHERE COALESCE(is_deleted, false) = false
      AND assigned_to_user_id = ANY(p_identities)
  ),
  my_viol AS (
    SELECT * FROM ce_violations
    WHERE COALESCE(is_deleted, false) = false
      AND assigned_to_user_id = ANY(p_identities)
  ),
  kpis AS (
    SELECT
      count(*) FILTER (WHERE status = ANY(v_active_a) AND due_date = v_today) AS due_today,
      count(*) FILTER (WHERE status = ANY(v_active_a) AND due_date < v_today) AS overdue,
      count(*) FILTER (WHERE status = ANY(v_active_a) AND due_date >= v_today AND due_date <= v_today + 6) AS due_week,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN p_from AND p_to) AS completed_period,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN v_prev_from AND v_prev_to) AS completed_prev,
      count(*) FILTER (WHERE status = ANY(v_active_a)) AS open_actions,
      count(*) FILTER (WHERE created_at::date BETWEEN p_from AND p_to) AS assigned_period,
      count(*) FILTER (WHERE created_at::date BETWEEN v_prev_from AND v_prev_to) AS assigned_prev,
      count(*) FILTER (WHERE due_date BETWEEN p_from AND p_to
                         AND (completed_at IS NULL OR completed_at::date > due_date)) AS became_overdue,
      count(*) FILTER (WHERE due_date BETWEEN v_prev_from AND v_prev_to
                         AND (completed_at IS NULL OR completed_at::date > due_date)) AS became_overdue_prev
    FROM my_actions
  ),
  open_viol AS (
    SELECT count(*) AS n FROM my_viol WHERE status = ANY(v_open_v)
  ),
  workload AS (
    SELECT b,
      (SELECT count(*) FROM my_actions a
        WHERE date_trunc(v_grain, a.created_at)::date = b
          AND a.created_at::date BETWEEN p_from AND p_to) AS assigned,
      (SELECT count(*) FROM my_actions a
        WHERE a.completed_at IS NOT NULL
          AND date_trunc(v_grain, a.completed_at)::date = b
          AND a.completed_at::date BETWEEN p_from AND p_to) AS completed,
      (SELECT count(*) FROM my_actions a
        WHERE a.due_date IS NOT NULL
          AND date_trunc(v_grain, a.due_date::timestamp)::date = b
          AND a.due_date BETWEEN p_from AND p_to
          AND (a.completed_at IS NULL OR a.completed_at::date > a.due_date)) AS overdue
    FROM buckets
  ),
  timeliness AS (
    SELECT
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN p_from AND p_to) AS completed,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN p_from AND p_to
                         AND due_date IS NOT NULL AND completed_at::date <= due_date) AS on_time,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN p_from AND p_to
                         AND due_date IS NOT NULL) AS completed_with_due,
      avg(EXTRACT(epoch FROM (completed_at - created_at)) / 86400.0)
        FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN p_from AND p_to) AS avg_days,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN v_prev_from AND v_prev_to) AS prev_completed,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN v_prev_from AND v_prev_to
                         AND due_date IS NOT NULL AND completed_at::date <= due_date) AS prev_on_time,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at::date BETWEEN v_prev_from AND v_prev_to
                         AND due_date IS NOT NULL) AS prev_completed_with_due
    FROM my_actions
  ),
  outcomes AS (
    SELECT b,
      (SELECT count(*) FROM my_viol v
        WHERE v.resolved_at IS NOT NULL
          AND date_trunc(v_grain, v.resolved_at)::date = b
          AND v.resolved_at::date BETWEEN p_from AND p_to) AS resolved,
      (SELECT count(*) FROM my_viol v
        WHERE date_trunc(v_grain, v.created_at)::date = b
          AND v.created_at::date BETWEEN p_from AND p_to) AS raised,
      (SELECT count(*) FROM my_viol v
        WHERE date_trunc(v_grain, v.created_at)::date = b
          AND v.created_at::date BETWEEN p_from AND p_to
          AND EXISTS (SELECT 1 FROM my_viol p
                       WHERE p.employer_id = v.employer_id
                         AND p.id <> v.id
                         AND p.resolved_at IS NOT NULL
                         AND p.resolved_at < v.created_at)) AS repeat_after_resolution
    FROM buckets
  ),
  by_status AS (
    SELECT s.code AS status, COALESCE(c.n, 0) AS count
    FROM unnest(v_open_v) WITH ORDINALITY AS s(code, ord)
    LEFT JOIN (SELECT status, count(*) n FROM my_viol WHERE status = ANY(v_open_v) GROUP BY 1) c
      ON c.status = s.code
    ORDER BY s.ord
  ),
  by_priority AS (
    SELECT p.code AS priority, COALESCE(c.n, 0) AS count
    FROM (VALUES ('Critical',1),('High',2),('Medium',3),('Low',4)) AS p(code, ord)
    LEFT JOIN (
      SELECT initcap(lower(priority)) pr, count(*) n
      FROM my_viol WHERE status = ANY(v_open_v) GROUP BY 1
    ) c ON c.pr = p.code
    ORDER BY p.ord
  ),
  ageing AS (
    SELECT g.bucket, g.ord, COALESCE(c.n, 0) AS count
    FROM (VALUES ('0-7 days',1),('8-14 days',2),('15-30 days',3),('31-60 days',4),('60+ days',5)) AS g(bucket, ord)
    LEFT JOIN (
      SELECT CASE
               WHEN v_today - COALESCE(discovered_date, created_at::date) <= 7 THEN '0-7 days'
               WHEN v_today - COALESCE(discovered_date, created_at::date) <= 14 THEN '8-14 days'
               WHEN v_today - COALESCE(discovered_date, created_at::date) <= 30 THEN '15-30 days'
               WHEN v_today - COALESCE(discovered_date, created_at::date) <= 60 THEN '31-60 days'
               ELSE '60+ days' END AS bucket,
             count(*) n
      FROM my_viol WHERE status = ANY(v_open_v) GROUP BY 1
    ) c ON c.bucket = g.bucket
    ORDER BY g.ord
  ),
  field AS (
    SELECT
      (SELECT count(*) FROM ce_weekly_plan_items i
         JOIN ce_weekly_plans pl ON pl.id = i.plan_id
        WHERE pl.inspector_id = ANY(p_identities)
          AND i.scheduled_date BETWEEN p_from AND p_to) AS planned,
      (SELECT count(*) FROM ce_weekly_plan_items i
         JOIN ce_weekly_plans pl ON pl.id = i.plan_id
        WHERE pl.inspector_id = ANY(p_identities)
          AND i.scheduled_date BETWEEN p_from AND p_to
          AND upper(COALESCE(i.execution_status, '')) IN ('COMPLETED','EXECUTED','DONE')) AS executed,
      (SELECT count(*) FROM ce_weekly_plan_items i
         JOIN ce_weekly_plans pl ON pl.id = i.plan_id
        WHERE pl.inspector_id = ANY(p_identities)
          AND i.scheduled_date BETWEEN p_from AND p_to
          AND i.scheduled_date < v_today
          AND upper(COALESCE(i.execution_status, 'PENDING')) NOT IN ('COMPLETED','EXECUTED','DONE','RESCHEDULED','CANCELLED')) AS missed,
      (SELECT count(*) FROM ce_inspections ins
        WHERE ins.inspector_id = ANY(p_identities)
          AND upper(COALESCE(ins.status, '')) = 'COMPLETED'
          AND COALESCE(ins.actual_end::date, ins.visit_date, ins.scheduled_date) BETWEEN p_from AND p_to) AS inspections_completed,
      (SELECT count(*) FROM my_actions a
        WHERE a.created_at::date BETWEEN p_from AND p_to) AS followups_generated,
      (SELECT count(*) FROM ce_violations v
        WHERE v.inspection_id IN (SELECT id FROM ce_inspections WHERE inspector_id = ANY(p_identities))
          AND v.created_at::date BETWEEN p_from AND p_to
          AND COALESCE(v.is_deleted, false) = false) AS violations_identified
  ),
  attention AS (
    SELECT v.employer_id,
           max(v.employer_name) AS employer_name,
           count(*) FILTER (WHERE v.status = ANY(v_open_v)) AS open_violations,
           min(COALESCE(v.discovered_date, v.created_at::date)) AS oldest_open,
           max(rp.risk_band) AS risk_band,
           max(rp.total_score) AS risk_score,
           (SELECT count(*) FROM my_actions a
             WHERE a.employer_id = v.employer_id
               AND a.status = ANY(v_active_a) AND a.due_date < v_today) AS overdue_actions,
           (SELECT string_agg(DISTINCT st, ', ')
              FROM (SELECT DISTINCT v2.status AS st FROM my_viol v2
                     WHERE v2.employer_id = v.employer_id AND v2.status = ANY(v_open_v)
                     LIMIT 3) s) AS stages
    FROM my_viol v
    LEFT JOIN ce_risk_profiles rp ON rp.employer_id = v.employer_id
    WHERE v.status = ANY(v_open_v)
    GROUP BY v.employer_id
    ORDER BY count(*) FILTER (WHERE v.status = ANY(v_open_v)) DESC,
             min(COALESCE(v.discovered_date, v.created_at::date)) ASC
    LIMIT 10
  ),
  repeats AS (
    SELECT v.employer_id,
           max(v.employer_name) AS employer_name,
           count(*) AS total_violations,
           count(*) FILTER (WHERE v.status = ANY(v_open_v)) AS open_violations,
           count(*) FILTER (WHERE v.resolved_at IS NOT NULL) AS resolved_violations,
           count(*) FILTER (
             WHERE EXISTS (SELECT 1 FROM my_viol p
                            WHERE p.employer_id = v.employer_id AND p.id <> v.id
                              AND p.resolved_at IS NOT NULL AND p.resolved_at < v.created_at)
           ) AS recurrences,
           (SELECT count(*) FROM my_actions a
             WHERE a.employer_id = v.employer_id
               AND a.status = ANY(v_active_a) AND a.due_date < v_today) AS missed_followups
    FROM my_viol v
    GROUP BY v.employer_id
    HAVING count(*) > 1
    ORDER BY count(*) FILTER (WHERE v.status = ANY(v_open_v)) DESC, count(*) DESC
    LIMIT 8
  ),
  recent AS (
    SELECT * FROM (
      SELECT h.performed_at AS at,
             'VIOLATION' AS kind,
             h.action AS label,
             COALESCE(v.employer_name, v.violation_number) AS subject,
             COALESCE(h.to_value, h.notes) AS detail,
             v.id::text AS ref_id
      FROM ce_violation_history h
      JOIN my_viol v ON v.id = h.violation_id
      WHERE h.performed_at >= (p_from - 7)::timestamp
      UNION ALL
      SELECT a.updated_at AS at,
             'ACTION' AS kind,
             a.status AS label,
             COALESCE(a.employer_name, a.action_type) AS subject,
             a.description AS detail,
             a.id::text AS ref_id
      FROM my_actions a
      WHERE a.updated_at >= (p_from - 7)::timestamp
    ) x
    ORDER BY at DESC
    LIMIT 15
  )
  SELECT jsonb_build_object(
    'scoped', true,
    'generated_at', now(),
    'grain', v_grain,
    'range', jsonb_build_object('from', p_from, 'to', p_to,
                                'prev_from', v_prev_from, 'prev_to', v_prev_to),
    'kpis', (SELECT to_jsonb(k) FROM kpis k) || jsonb_build_object('open_violations', (SELECT n FROM open_viol)),
    'workload', (SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.b), '[]'::jsonb) FROM workload w),
    'timeliness', (SELECT to_jsonb(t) FROM timeliness t),
    'outcomes', (SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.b), '[]'::jsonb) FROM outcomes o),
    'caseload', jsonb_build_object(
      'by_status', (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM by_status s),
      'by_priority', (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM by_priority p),
      'ageing', (SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.ord), '[]'::jsonb) FROM ageing g),
      'total', (SELECT n FROM open_viol)
    ),
    'field', (SELECT to_jsonb(f) FROM field f),
    'attention', (SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM attention a),
    'repeats', (SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM repeats r),
    'recent', (SELECT COALESCE(jsonb_agg(to_jsonb(rc) ORDER BY rc.at DESC), '[]'::jsonb) FROM recent rc)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ce_inspector_workboard_analytics(text[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_inspector_workboard_analytics(text[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_inspector_workboard_analytics(text[], date, date) TO service_role;

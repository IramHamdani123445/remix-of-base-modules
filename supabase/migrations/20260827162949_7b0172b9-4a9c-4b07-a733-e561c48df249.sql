CREATE OR REPLACE FUNCTION public.ia_register_findings(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       AND (public.ia_f_uuid(p_filters,'function_id') IS NULL OR e.function_id = public.ia_f_uuid(p_filters,'function_id'))
       AND (public.ia_f_txt(p_filters,'severity') IS NULL OR COALESCE(f.severity, f.risk_rating) = public.ia_f_txt(p_filters,'severity'))
       AND (public.ia_f_txt(p_filters,'status') IS NULL OR f.lifecycle_status = public.ia_f_txt(p_filters,'status'))
       AND (NOT public.ia_f_bool(p_filters,'high_critical') OR COALESCE(f.severity, f.risk_rating) IN ('Critical','High'))
       AND (NOT public.ia_f_bool(p_filters,'open_only') OR COALESCE(f.lifecycle_status,'Draft') <> 'Closed')
       AND (NOT public.ia_f_bool(p_filters,'disputed') OR mr.management_position = 'Rejected')
       AND (NOT public.ia_f_bool(p_filters,'response_outstanding') OR (mr.id IS NULL AND f.lifecycle_status = 'Released'))
  ) t;
$function$;

REVOKE ALL ON FUNCTION public.ia_register_findings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_register_findings(jsonb) TO authenticated, service_role;
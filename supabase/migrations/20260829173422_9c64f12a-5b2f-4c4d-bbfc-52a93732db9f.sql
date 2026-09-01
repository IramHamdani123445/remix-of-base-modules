CREATE OR REPLACE FUNCTION public.ce_violation_report_group_v1(
  p_dimension text,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_fund text DEFAULT NULL,
  p_zone text DEFAULT NULL,
  p_severity text DEFAULT NULL
)
RETURNS TABLE (
  bucket text,
  violation_count bigint,
  employer_count bigint,
  total_amount numeric,
  resolved_count bigint,
  unresolved_count bigint,
  avg_resolution_days numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      v.employer_id,
      v.status,
      v.total_amount,
      v.resolved_at,
      v.discovered_date,
      v.created_at,
      COALESCE(t.name, t.code, 'Unknown') AS type_label,
      COALESCE(z.zone_name, 'Unassigned') AS zone_label,
      COALESCE(v.fund_type, 'Unspecified') AS fund_label,
      COALESCE(v.severity, 'Unspecified') AS severity_label
    FROM public.ce_violations v
    LEFT JOIN public.ce_violation_types t ON t.id = v.violation_type_id
    LEFT JOIN public.ce_zones z ON z.id = v.zone_id
    WHERE v.is_deleted = false
      AND (p_from IS NULL OR COALESCE(v.discovered_date, v.created_at::date) >= p_from)
      AND (p_to IS NULL OR COALESCE(v.discovered_date, v.created_at::date) <= p_to)
      AND (p_status IS NULL OR v.status = p_status)
      AND (p_fund IS NULL OR COALESCE(v.fund_type, 'Unspecified') = p_fund)
      AND (p_severity IS NULL OR COALESCE(v.severity, 'Unspecified') = p_severity)
      AND (p_type IS NULL OR COALESCE(t.name, t.code, 'Unknown') = p_type)
      AND (p_zone IS NULL OR COALESCE(z.zone_name, 'Unassigned') = p_zone)
  )
  SELECT
    CASE
      WHEN p_dimension = 'status' THEN COALESCE(b.status, 'UNKNOWN')
      WHEN p_dimension = 'zone' THEN b.zone_label
      ELSE b.type_label
    END AS bucket,
    count(*)::bigint AS violation_count,
    count(DISTINCT b.employer_id)::bigint AS employer_count,
    COALESCE(sum(b.total_amount), 0)::numeric AS total_amount,
    count(*) FILTER (WHERE b.resolved_at IS NOT NULL)::bigint AS resolved_count,
    count(*) FILTER (WHERE b.resolved_at IS NULL)::bigint AS unresolved_count,
    ROUND(AVG(
      CASE WHEN b.resolved_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (b.resolved_at - COALESCE(b.discovered_date::timestamptz, b.created_at))) / 86400.0
      END
    )::numeric, 1) AS avg_resolution_days
  FROM base b
  GROUP BY 1
  ORDER BY 2 DESC
$$;

GRANT EXECUTE ON FUNCTION public.ce_violation_report_group_v1(text, date, date, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ce_violation_report_filter_options_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'statuses', (SELECT COALESCE(jsonb_agg(DISTINCT s), '[]'::jsonb) FROM (SELECT status AS s FROM public.ce_violations WHERE is_deleted = false AND status IS NOT NULL) q),
    'types', (SELECT COALESCE(jsonb_agg(DISTINCT COALESCE(name, code)), '[]'::jsonb) FROM public.ce_violation_types),
    'zones', (SELECT COALESCE(jsonb_agg(DISTINCT zone_name), '[]'::jsonb) FROM public.ce_zones WHERE zone_name IS NOT NULL),
    'funds', (SELECT COALESCE(jsonb_agg(DISTINCT f), '[]'::jsonb) FROM (SELECT COALESCE(fund_type, 'Unspecified') AS f FROM public.ce_violations WHERE is_deleted = false) q),
    'severities', (SELECT COALESCE(jsonb_agg(DISTINCT sv), '[]'::jsonb) FROM (SELECT COALESCE(severity, 'Unspecified') AS sv FROM public.ce_violations WHERE is_deleted = false) q)
  )
$$;

GRANT EXECUTE ON FUNCTION public.ce_violation_report_filter_options_v1() TO authenticated;
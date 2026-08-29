DROP FUNCTION IF EXISTS public.ce_violation_report_group_v1(text, date, date, text, text, text, text, text);

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
  avg_resolution_days numeric,
  median_resolution_days numeric,
  min_resolution_days numeric,
  max_resolution_days numeric
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
      COALESCE(t.name, t.code, 'Unknown') AS type_label,
      COALESCE(z.zone_name, 'Unassigned') AS zone_label,
      CASE WHEN v.resolved_at IS NOT NULL THEN
        GREATEST(0, EXTRACT(EPOCH FROM (v.resolved_at - COALESCE(v.discovered_date::timestamptz, v.created_at))) / 86400.0)
      END AS resolution_days
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
    count(*)::bigint,
    count(DISTINCT b.employer_id)::bigint,
    COALESCE(sum(b.total_amount), 0)::numeric,
    count(*) FILTER (WHERE b.resolved_at IS NOT NULL)::bigint,
    count(*) FILTER (WHERE b.resolved_at IS NULL)::bigint,
    ROUND(AVG(b.resolution_days)::numeric, 1),
    ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.resolution_days)::numeric, 1),
    ROUND(MIN(b.resolution_days)::numeric, 1),
    ROUND(MAX(b.resolution_days)::numeric, 1)
  FROM base b
  GROUP BY 1
  ORDER BY 2 DESC
$$;

GRANT EXECUTE ON FUNCTION public.ce_violation_report_group_v1(text, date, date, text, text, text, text, text) TO authenticated;
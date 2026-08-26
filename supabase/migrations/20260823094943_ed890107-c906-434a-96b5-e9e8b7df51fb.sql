-- ── 1. Fast progress signal for the routing backfill ────────────────────────
-- Partial index matching the EXACT unassigned/operational predicate used by
-- fn_ce_unassigned_violation_count() and fn_ce_route_unassigned_violations().
-- No existing index covers (unassigned AND not-deleted AND operational status);
-- idx_ce_violations_assigned is a full index on assigned_to_user_id only.
CREATE INDEX IF NOT EXISTS idx_ce_violations_unassigned_operational
  ON public.ce_violations (status)
  WHERE assigned_queue_id IS NULL
    AND assigned_to_user_id IS NULL
    AND COALESCE(is_deleted, false) = false;

-- ── 2. Canonical routing eligibility classification ─────────────────────────
-- Every non-deleted violation is classified exactly once so the backfill can
-- prove WHAT it touched and WHY the rest was left alone.
CREATE OR REPLACE VIEW public.ce_v_violation_routing_eligibility AS
SELECT
  v.id,
  v.violation_number,
  v.employer_id,
  v.status,
  v.assigned_to_user_id,
  v.assigned_queue_id,
  v.assignment_method,
  e.village_code,
  e.office_code,
  CASE
    WHEN v.assigned_to_user_id IS NOT NULL              THEN 'OWNED_BY_OFFICER'
    WHEN v.assigned_queue_id  IS NOT NULL               THEN 'OWNED_BY_QUEUE'
    WHEN v.status IN ('RESOLVED','CLOSED','CANCELLED')  THEN 'EXCLUDED_CLOSED_HISTORICAL'
    WHEN v.status = 'DRAFT'                             THEN 'EXCLUDED_NOT_OPERATIONAL'
    WHEN v.employer_id IS NULL OR e.regno IS NULL       THEN 'BLOCKED_NO_EMPLOYER_RECORD'
    WHEN COALESCE(e.village_code, e.office_code) IS NULL
                                                        THEN 'BLOCKED_NO_ROUTING_DATA'
    WHEN NOT EXISTS (
      SELECT 1 FROM fn_ce_resolve_zone(e.village_code, e.office_code) z
      WHERE z.zone_id IS NOT NULL
    )                                                   THEN 'BLOCKED_NO_ZONE'
    ELSE 'ELIGIBLE_FOR_ROUTING'
  END AS eligibility
FROM public.ce_violations v
LEFT JOIN public.er_master e ON e.regno = v.employer_id
WHERE COALESCE(v.is_deleted, false) = false;

GRANT SELECT ON public.ce_v_violation_routing_eligibility TO authenticated, service_role;

-- Cheap, index-backed progress counter (unchanged predicate).
CREATE OR REPLACE FUNCTION public.fn_ce_unassigned_violation_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $$
  SELECT count(*)::bigint FROM public.ce_violations
   WHERE COALESCE(is_deleted,false) = false
     AND assigned_queue_id IS NULL
     AND assigned_to_user_id IS NULL
     AND status NOT IN ('RESOLVED','CLOSED','CANCELLED');
$$;
REVOKE EXECUTE ON FUNCTION public.fn_ce_unassigned_violation_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ce_unassigned_violation_count() TO authenticated, service_role;

-- Full acceptance statistics for the routing backfill.
CREATE OR REPLACE FUNCTION public.fn_ce_routing_backfill_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
  SELECT jsonb_object_agg(eligibility, n)
  FROM (
    SELECT eligibility, count(*) AS n
    FROM public.ce_v_violation_routing_eligibility
    GROUP BY eligibility
  ) s;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_ce_routing_backfill_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ce_routing_backfill_stats() TO authenticated, service_role;
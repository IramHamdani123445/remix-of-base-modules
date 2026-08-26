-- ═══ Canonical read-side financial layer for Compliance ═══════════════════
-- Single source of truth for principal / penalty / interest / gross / paid /
-- waived / outstanding. React components must never recompute these.

-- Violation-level financials.
-- paid: payments are only attributed at case/ledger level (ce_payment_allocations
--       has no violation_id), so violation paid is always 0 and collection is
--       reported through the case roll-up.
CREATE OR REPLACE VIEW public.ce_v_violation_financials AS
SELECT
  v.id                                        AS violation_id,
  v.violation_number,
  v.employer_id,
  v.status,
  v.fund_type,
  COALESCE(v.case_id, cv.case_id)             AS case_id,
  (COALESCE(v.case_id, cv.case_id) IS NOT NULL) AS is_case_linked,
  ROUND(COALESCE(v.principal_amount,0), 2)    AS principal,
  ROUND(COALESCE(v.penalty_amount,0), 2)      AS penalty,
  ROUND(COALESCE(v.interest_amount,0), 2)     AS interest,
  ROUND(COALESCE(v.total_amount,
        COALESCE(v.principal_amount,0)+COALESCE(v.penalty_amount,0)
        +COALESCE(v.interest_amount,0)), 2)   AS gross,
  0::numeric(15,2)                            AS paid,
  ROUND(COALESCE(w.waived,0), 2)              AS waived,
  GREATEST(ROUND(COALESCE(v.total_amount,0) - COALESCE(w.waived,0), 2), 0)
                                              AS outstanding,
  (v.status NOT IN ('RESOLVED','CLOSED','CANCELLED')) AS is_open
FROM public.ce_violations v
LEFT JOIN LATERAL (
  SELECT cv2.case_id FROM public.ce_case_violations cv2
   WHERE cv2.violation_id = v.id LIMIT 1
) cv ON true
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(wv.amount_approved,0)) AS waived
    FROM public.ce_waivers wv
   WHERE wv.violation_id = v.id
     AND wv.status IN ('APPROVED','APPLIED')
) w ON true
WHERE COALESCE(v.is_deleted,false) = false;

GRANT SELECT ON public.ce_v_violation_financials TO authenticated, service_role;

-- Case-level financials. Totals are kept correct by trg_ce_violation_case_rollup.
CREATE OR REPLACE VIEW public.ce_v_case_financials AS
SELECT
  c.id                                        AS case_id,
  c.case_number,
  c.employer_id,
  c.status,
  c.fund_type,
  ROUND(COALESCE(c.total_principal,0), 2)     AS principal,
  ROUND(COALESCE(c.total_penalties,0), 2)     AS penalty,
  ROUND(COALESCE(c.total_interest,0), 2)      AS interest,
  ROUND(COALESCE(c.total_amount,0), 2)        AS gross,
  ROUND(COALESCE(c.amount_collected,0), 2)    AS paid,
  ROUND(COALESCE(w.waived,0), 2)              AS waived,
  GREATEST(ROUND(COALESCE(c.total_amount,0) - COALESCE(c.amount_collected,0)
                 - COALESCE(w.waived,0), 2), 0) AS outstanding,
  (c.status NOT IN ('CLOSED','RESOLVED','CANCELLED')) AS is_open
FROM public.ce_cases c
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(wv.amount_approved,0)) AS waived
    FROM public.ce_waivers wv
   WHERE wv.case_id = c.id AND wv.status IN ('APPROVED','APPLIED')
) w ON true
WHERE COALESCE(c.is_deleted,false) = false;

GRANT SELECT ON public.ce_v_case_financials TO authenticated, service_role;

-- Employer enforcement exposure — non-double-counting by construction:
--   exposure = SUM(open case outstanding)            [linked violations counted
--                                                     ONLY through their case]
--            + SUM(open UNLINKED violation outstanding)
CREATE OR REPLACE FUNCTION public.fn_ce_employer_financial_exposure(p_employer_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $$
  WITH cs AS (
    SELECT COUNT(*) FILTER (WHERE is_open)                          AS open_cases,
           COUNT(*)                                                 AS total_cases,
           COALESCE(SUM(gross)      FILTER (WHERE is_open),0)       AS gross,
           COALESCE(SUM(paid),0)                                    AS paid,
           COALESCE(SUM(waived)     FILTER (WHERE is_open),0)       AS waived,
           COALESCE(SUM(outstanding)FILTER (WHERE is_open),0)       AS outstanding
      FROM public.ce_v_case_financials WHERE employer_id = p_employer_id
  ), vi AS (
    SELECT COUNT(*)                                                 AS total_violations,
           COUNT(*) FILTER (WHERE is_open)                          AS open_violations,
           COUNT(*) FILTER (WHERE is_open AND NOT is_case_linked)   AS open_unlinked,
           COALESCE(SUM(gross),0)                                   AS gross_all,
           COALESCE(SUM(outstanding) FILTER (WHERE is_open AND NOT is_case_linked),0)
                                                                    AS unlinked_outstanding,
           COALESCE(SUM(principal),0) AS principal, COALESCE(SUM(penalty),0) AS penalty,
           COALESCE(SUM(interest),0)  AS interest,  COALESCE(SUM(waived),0)  AS waived
      FROM public.ce_v_violation_financials WHERE employer_id = p_employer_id
  )
  SELECT jsonb_build_object(
    'employer_id', p_employer_id,
    'total_violations', vi.total_violations,
    'open_violations', vi.open_violations,
    'open_unlinked_violations', vi.open_unlinked,
    'violation_principal', vi.principal,
    'violation_penalty', vi.penalty,
    'violation_interest', vi.interest,
    'violation_gross', vi.gross_all,
    'violation_waived', vi.waived,
    'total_cases', cs.total_cases,
    'open_cases', cs.open_cases,
    'case_gross', cs.gross,
    'case_paid', cs.paid,
    'case_waived', cs.waived,
    'case_outstanding', cs.outstanding,
    'unlinked_violation_outstanding', vi.unlinked_outstanding,
    'enforcement_exposure', ROUND(cs.outstanding + vi.unlinked_outstanding, 2)
  ) FROM cs, vi;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_ce_employer_financial_exposure(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ce_employer_financial_exposure(text) TO authenticated, service_role;
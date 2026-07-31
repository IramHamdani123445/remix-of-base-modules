DROP VIEW IF EXISTS public.ce_v_employer_filing_status CASCADE;

CREATE VIEW public.ce_v_employer_filing_status AS
WITH periods AS (
  SELECT generate_series(
    date_trunc('month', NOW() - INTERVAL '12 months')::date,
    date_trunc('month', NOW() - INTERVAL '1 month')::date,
    '1 month'::interval
  )::date AS period_date
),
employer_filings AS (
  SELECT
    e.regno,
    e.name AS employer_name,
    e.status AS employer_status,
    e.office_code,
    COALESCE(
      date_trunc('month', e.date_wages_first_paid)::date,
      date_trunc('month', e.registration_date)::date,
      date_trunc('month', NOW() - INTERVAL '12 months')::date
    ) AS compliance_start_period,
    COUNT(DISTINCT c.period) AS total_filings_12m,
    MAX(c.period) AS last_filing_period,
    MAX(c.date_received) AS last_filing_date
  FROM er_master e
  LEFT JOIN cn_c3_reported c ON c.payer_id = e.regno
    AND c.period >= (NOW() - INTERVAL '12 months')::date
    AND c.posting_status IS DISTINCT FROM 'CANCELLED'
  WHERE e.status IN ('A', 'V')
  GROUP BY e.regno, e.name, e.status, e.office_code,
           e.date_wages_first_paid, e.registration_date
)
SELECT
  ef.regno,
  ef.employer_name,
  ef.employer_status,
  ef.office_code,
  ef.total_filings_12m,
  GREATEST(
    (SELECT COUNT(*) FROM periods p WHERE p.period_date >= ef.compliance_start_period)::int
      - COALESCE(ef.total_filings_12m::int, 0),
    0
  ) AS missed_filings_12m,
  ef.last_filing_period,
  ef.last_filing_date,
  (SELECT MAX(period_date) FROM periods) AS latest_period_due,
  CASE WHEN ef.last_filing_period >= (SELECT MAX(period_date) FROM periods) THEN true ELSE false END AS is_current,
  (SELECT COUNT(*) FROM periods p WHERE p.period_date >= ef.compliance_start_period)::int
    AS expected_filings_12m,
  ef.compliance_start_period
FROM employer_filings ef;

ALTER VIEW public.ce_v_employer_filing_status SET (security_invoker = true);

GRANT SELECT ON public.ce_v_employer_filing_status TO authenticated, anon, service_role;
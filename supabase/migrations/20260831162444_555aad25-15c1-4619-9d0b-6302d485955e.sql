CREATE OR REPLACE FUNCTION public.ce_employer_statement_register_v1(
  p_as_of date DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'outstanding',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_as_of date := COALESCE(p_as_of, CURRENT_DATE);
  v_cut text;
  v_page int := GREATEST(1, COALESCE(p_page, 1));
  v_size int := LEAST(200, GREATEST(10, COALESCE(p_page_size, 25)));
  v_sort text := COALESCE(NULLIF(p_sort, ''), 'outstanding');
  v_dir text := CASE WHEN lower(COALESCE(p_dir, 'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_search text := NULLIF(trim(COALESCE(f->>'search', '')), '');
  v_territory text := NULLIF(f->>'territory', '');
  v_period_from text := NULLIF(f->>'period_from', '');
  v_period_to text := NULLIF(f->>'period_to', '');
  v_min numeric := NULLIF(f->>'min_outstanding', '')::numeric;
  v_max numeric := NULLIF(f->>'max_outstanding', '')::numeric;
  v_arrangement text := NULLIF(f->>'arrangement', '');
  v_funds text[];
  v_positions text[];
  v_bands text[];
  v_can_export boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE_STATEMENTS_UNAUTHENTICATED';
  END IF;

  IF NOT (
    public.ce_actor_can(v_uid, 'compliance.reports.operational')
    OR public.ce_actor_can(v_uid, 'compliance.violations.manage')
    OR public.ce_actor_can(v_uid, 'compliance.cases.manage')
    OR public.ce_actor_can(v_uid, 'compliance.enforcement.arrangements')
  ) THEN
    RAISE EXCEPTION 'CE_STATEMENTS_FORBIDDEN';
  END IF;

  v_can_export := public.ce_actor_can(v_uid, 'compliance.reports.operational')
               OR public.ce_actor_can(v_uid, 'compliance.reports.analytics');

  v_cut := to_char(v_as_of, 'YYYY-MM');
  IF v_period_to IS NOT NULL AND v_period_to < v_cut THEN
    v_cut := v_period_to;
  END IF;

  SELECT array_agg(x) INTO v_funds
  FROM jsonb_array_elements_text(COALESCE(f->'funds', '[]'::jsonb)) t(x);
  SELECT array_agg(x) INTO v_positions
  FROM jsonb_array_elements_text(COALESCE(f->'positions', '[]'::jsonb)) t(x);
  SELECT array_agg(x) INTO v_bands
  FROM jsonb_array_elements_text(COALESCE(f->'bands', '[]'::jsonb)) t(x);

  WITH bal AS (
    SELECT b.*
    FROM public.ce_v_ledger_period_balances b
    WHERE b.period <= v_cut
      AND (v_period_from IS NULL OR b.period >= v_period_from)
      AND (v_funds IS NULL OR b.fund_type::text = ANY (v_funds))
  ),
  agg AS (
    SELECT
      b.employer_id,
      SUM(b.principal_outstanding) AS principal_outstanding,
      SUM(b.penalty_outstanding) AS penalty_outstanding,
      SUM(b.interest_outstanding) AS interest_outstanding,
      SUM(b.total_outstanding) AS total_outstanding,
      SUM(b.principal_due + b.penalty_charged + b.interest_accrued) AS total_charged,
      SUM(b.payments_received) AS payments_received,
      SUM(b.waivers_applied) AS waivers_applied,
      SUM(b.write_offs) AS write_offs,
      SUM(b.credit_available) AS credit_available,
      SUM(b.posted_entry_count) AS entry_count,
      COUNT(DISTINCT b.period) AS period_count,
      MIN(b.period) AS first_period,
      MAX(b.period) AS last_period,
      MIN(b.period) FILTER (WHERE b.total_outstanding > 0.005) AS oldest_arrears_period,
      COALESCE(
        array_agg(DISTINCT b.fund_type::text) FILTER (WHERE b.total_outstanding > 0.005),
        ARRAY[]::text[]
      ) AS funds_in_arrears
    FROM bal b
    GROUP BY b.employer_id
  ),
  led AS (
    SELECT
      l.employer_id,
      MAX(l.employer_name) FILTER (WHERE l.employer_name IS NOT NULL) AS employer_name,
      MAX(l.territory) FILTER (WHERE l.territory IS NOT NULL) AS territory,
      MAX(l.posted_at) AS last_entry_at,
      MAX(l.posted_at) FILTER (
        WHERE l.entry_type IN ('PAYMENT_RECEIVED', 'ARRANGEMENT_CREDIT')
      ) AS last_payment_at,
      SUM(l.credit_amount) FILTER (
        WHERE l.entry_type IN ('PAYMENT_RECEIVED', 'ARRANGEMENT_CREDIT')
          AND l.posted_at >= (v_as_of - INTERVAL '12 months')
      ) AS payments_12m
    FROM public.ce_employer_financial_ledger l
    WHERE l.status = 'POSTED'
      AND l.entry_type <> 'REVERSAL'
      AND l.posted_at::date <= v_as_of
    GROUP BY l.employer_id
  ),
  arr AS (
    SELECT
      a.employer_id,
      COUNT(*) FILTER (WHERE a.status IN ('ACTIVE', 'PENDING_APPROVAL')) AS live_arrangements,
      MAX(a.status) FILTER (WHERE a.status = 'ACTIVE') AS active_status,
      MAX(a.status) FILTER (WHERE a.status IN ('DEFAULTED', 'BREACHED')) AS broken_status,
      MAX(a.next_due_date) FILTER (WHERE a.status = 'ACTIVE') AS next_due_date
    FROM public.ce_payment_arrangements a
    GROUP BY a.employer_id
  ),
  vio AS (
    SELECT v.employer_id, COUNT(*) AS open_violations
    FROM public.ce_violations v
    WHERE v.status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'DRAFT')
    GROUP BY v.employer_id
  ),
  cs AS (
    SELECT c.employer_id, COUNT(*) AS open_cases
    FROM public.ce_cases c
    WHERE c.status NOT IN ('CLOSED', 'COMPLETED')
    GROUP BY c.employer_id
  ),
  enriched AS (
    SELECT
      a.employer_id,
      COALESCE(NULLIF(trim(e.name), ''), NULLIF(trim(l.employer_name), ''), a.employer_id) AS employer_name,
      COALESCE(NULLIF(l.territory, ''), NULLIF(e.office_code, ''), 'UNKNOWN') AS territory,
      ROUND(a.principal_outstanding, 2) AS principal_outstanding,
      ROUND(a.penalty_outstanding, 2) AS penalty_outstanding,
      ROUND(a.interest_outstanding, 2) AS interest_outstanding,
      ROUND(a.total_outstanding, 2) AS total_outstanding,
      ROUND(a.total_charged, 2) AS total_charged,
      ROUND(a.payments_received, 2) AS payments_received,
      ROUND(a.waivers_applied, 2) AS waivers_applied,
      ROUND(a.write_offs, 2) AS write_offs,
      ROUND(a.credit_available, 2) AS credit_available,
      ROUND(COALESCE(l.payments_12m, 0), 2) AS payments_12m,
      a.entry_count,
      a.period_count,
      a.first_period,
      a.last_period,
      a.oldest_arrears_period,
      a.funds_in_arrears,
      l.last_entry_at,
      l.last_payment_at,
      COALESCE(arr.live_arrangements, 0) > 0 AS has_arrangement,
      COALESCE(arr.active_status, arr.broken_status) AS arrangement_status,
      arr.next_due_date AS arrangement_next_due,
      COALESCE(vio.open_violations, 0) AS open_violations,
      COALESCE(cs.open_cases, 0) AS open_cases,
      CASE
        WHEN a.total_outstanding > 0.005 AND COALESCE(arr.active_status, '') = 'ACTIVE' THEN 'UNDER_ARRANGEMENT'
        WHEN a.total_outstanding > 0.005 THEN 'IN_ARREARS'
        WHEN a.credit_available > 0.005 THEN 'IN_CREDIT'
        ELSE 'SETTLED'
      END AS position_status,
      CASE
        WHEN a.oldest_arrears_period IS NULL THEN 'CURRENT'
        WHEN (
          (EXTRACT(YEAR FROM v_as_of)::int * 12 + EXTRACT(MONTH FROM v_as_of)::int)
          - (split_part(a.oldest_arrears_period, '-', 1)::int * 12 + split_part(a.oldest_arrears_period, '-', 2)::int)
        ) <= 3 THEN '0_3'
        WHEN (
          (EXTRACT(YEAR FROM v_as_of)::int * 12 + EXTRACT(MONTH FROM v_as_of)::int)
          - (split_part(a.oldest_arrears_period, '-', 1)::int * 12 + split_part(a.oldest_arrears_period, '-', 2)::int)
        ) <= 12 THEN '4_12'
        WHEN (
          (EXTRACT(YEAR FROM v_as_of)::int * 12 + EXTRACT(MONTH FROM v_as_of)::int)
          - (split_part(a.oldest_arrears_period, '-', 1)::int * 12 + split_part(a.oldest_arrears_period, '-', 2)::int)
        ) <= 36 THEN '13_36'
        ELSE '36_PLUS'
      END AS ageing_band,
      GREATEST(
        0,
        CASE
          WHEN a.oldest_arrears_period IS NULL THEN 0
          ELSE (EXTRACT(YEAR FROM v_as_of)::int * 12 + EXTRACT(MONTH FROM v_as_of)::int)
             - (split_part(a.oldest_arrears_period, '-', 1)::int * 12 + split_part(a.oldest_arrears_period, '-', 2)::int)
        END
      ) AS arrears_age_months
    FROM agg a
    LEFT JOIN led l ON l.employer_id = a.employer_id
    LEFT JOIN public.er_master e ON e.regno::text = a.employer_id::text
    LEFT JOIN arr ON arr.employer_id = a.employer_id
    LEFT JOIN vio ON vio.employer_id::text = a.employer_id::text
    LEFT JOIN cs ON cs.employer_id::text = a.employer_id::text
  ),
  filtered AS (
    SELECT * FROM enriched x
    WHERE (v_search IS NULL
           OR x.employer_id ILIKE '%' || v_search || '%'
           OR x.employer_name ILIKE '%' || v_search || '%')
      AND (v_territory IS NULL OR x.territory = v_territory)
      AND (v_positions IS NULL OR x.position_status = ANY (v_positions))
      AND (v_bands IS NULL OR x.ageing_band = ANY (v_bands))
      AND (v_min IS NULL OR x.total_outstanding >= v_min)
      AND (v_max IS NULL OR x.total_outstanding <= v_max)
      AND (v_arrangement IS NULL
           OR (v_arrangement = 'yes' AND x.has_arrangement)
           OR (v_arrangement = 'no' AND NOT x.has_arrangement))
  ),
  ordered AS (
    SELECT x.*, ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN v_dir = 'desc' THEN
          CASE v_sort
            WHEN 'outstanding' THEN x.total_outstanding
            WHEN 'principal' THEN x.principal_outstanding
            WHEN 'penalty' THEN x.penalty_outstanding
            WHEN 'interest' THEN x.interest_outstanding
            WHEN 'charged' THEN x.total_charged
            WHEN 'paid' THEN x.payments_received
            WHEN 'age' THEN x.arrears_age_months::numeric
            WHEN 'periods' THEN x.period_count::numeric
            ELSE NULL
          END
        END DESC NULLS LAST,
        CASE WHEN v_dir = 'asc' THEN
          CASE v_sort
            WHEN 'outstanding' THEN x.total_outstanding
            WHEN 'principal' THEN x.principal_outstanding
            WHEN 'penalty' THEN x.penalty_outstanding
            WHEN 'interest' THEN x.interest_outstanding
            WHEN 'charged' THEN x.total_charged
            WHEN 'paid' THEN x.payments_received
            WHEN 'age' THEN x.arrears_age_months::numeric
            WHEN 'periods' THEN x.period_count::numeric
            ELSE NULL
          END
        END ASC NULLS LAST,
        CASE WHEN v_sort = 'employer' AND v_dir = 'asc' THEN x.employer_name END ASC NULLS LAST,
        CASE WHEN v_sort = 'employer' AND v_dir = 'desc' THEN x.employer_name END DESC NULLS LAST,
        CASE WHEN v_sort = 'employer_id' AND v_dir = 'asc' THEN x.employer_id END ASC NULLS LAST,
        CASE WHEN v_sort = 'employer_id' AND v_dir = 'desc' THEN x.employer_id END DESC NULLS LAST,
        CASE WHEN v_sort = 'last_payment' AND v_dir = 'asc' THEN x.last_payment_at END ASC NULLS LAST,
        CASE WHEN v_sort = 'last_payment' AND v_dir = 'desc' THEN x.last_payment_at END DESC NULLS LAST,
        x.total_outstanding DESC,
        x.employer_id ASC
    ) AS rn
    FROM filtered x
  ),
  page AS (
    SELECT * FROM ordered
    WHERE rn > (v_page - 1) * v_size AND rn <= v_page * v_size
  )
  SELECT jsonb_build_object(
    'as_of', v_as_of,
    'period_cutoff', v_cut,
    'page', v_page,
    'page_size', v_size,
    'sort', v_sort,
    'dir', v_dir,
    'can_export', v_can_export,
    'total', (SELECT COUNT(*) FROM filtered),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.rn) FROM page p), '[]'::jsonb),
    'kpis_filtered', (
      SELECT jsonb_build_object(
        'employers', COUNT(*),
        'outstanding', COALESCE(SUM(total_outstanding), 0),
        'principal', COALESCE(SUM(principal_outstanding), 0),
        'penalty', COALESCE(SUM(penalty_outstanding), 0),
        'interest', COALESCE(SUM(interest_outstanding), 0),
        'charged', COALESCE(SUM(total_charged), 0),
        'paid', COALESCE(SUM(payments_received), 0),
        'credits', COALESCE(SUM(credit_available), 0),
        'in_arrears', COUNT(*) FILTER (WHERE position_status IN ('IN_ARREARS', 'UNDER_ARRANGEMENT')),
        'settled', COUNT(*) FILTER (WHERE position_status = 'SETTLED'),
        'in_credit', COUNT(*) FILTER (WHERE position_status = 'IN_CREDIT'),
        'under_arrangement', COUNT(*) FILTER (WHERE position_status = 'UNDER_ARRANGEMENT'),
        'aged_over_12m', COALESCE(SUM(total_outstanding) FILTER (WHERE arrears_age_months > 12), 0),
        'oldest_months', COALESCE(MAX(arrears_age_months), 0)
      ) FROM filtered
    ),
    'kpis_all', (
      SELECT jsonb_build_object(
        'employers', COUNT(*),
        'outstanding', COALESCE(SUM(total_outstanding), 0),
        'principal', COALESCE(SUM(principal_outstanding), 0),
        'penalty', COALESCE(SUM(penalty_outstanding), 0),
        'interest', COALESCE(SUM(interest_outstanding), 0),
        'charged', COALESCE(SUM(total_charged), 0),
        'paid', COALESCE(SUM(payments_received), 0),
        'credits', COALESCE(SUM(credit_available), 0),
        'in_arrears', COUNT(*) FILTER (WHERE position_status IN ('IN_ARREARS', 'UNDER_ARRANGEMENT')),
        'settled', COUNT(*) FILTER (WHERE position_status = 'SETTLED'),
        'in_credit', COUNT(*) FILTER (WHERE position_status = 'IN_CREDIT'),
        'under_arrangement', COUNT(*) FILTER (WHERE position_status = 'UNDER_ARRANGEMENT'),
        'aged_over_12m', COALESCE(SUM(total_outstanding) FILTER (WHERE arrears_age_months > 12), 0),
        'oldest_months', COALESCE(MAX(arrears_age_months), 0)
      ) FROM enriched
    ),
    'options', jsonb_build_object(
      'territories', COALESCE((SELECT jsonb_agg(DISTINCT territory) FROM enriched), '[]'::jsonb),
      'funds', '["SS","LEVY","EI"]'::jsonb,
      'positions', '["IN_ARREARS","UNDER_ARRANGEMENT","SETTLED","IN_CREDIT"]'::jsonb,
      'bands', '["CURRENT","0_3","4_12","13_36","36_PLUS"]'::jsonb,
      'period_min', (SELECT MIN(first_period) FROM enriched),
      'period_max', (SELECT MAX(last_period) FROM enriched)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ce_employer_statement_register_v1(date, jsonb, text, text, integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.ce_compliance_analytics_v1(date, date, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.ce_compliance_analytics_v1(
  p_from date DEFAULT (current_date - 365),
  p_to date DEFAULT current_date,
  p_zone text DEFAULT NULL,
  p_risk_band text DEFAULT NULL,
  p_violation_type text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_size_tier text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
WITH params AS (
  SELECT p_from AS f, p_to AS t,
         (p_from - (((p_to - p_from) + 1))) AS pf,
         (p_from - 1) AS pt,
         ((p_to - p_from) + 1) AS days
),
emp AS (
  SELECT e.regno::text AS regno,
         e.name,
         COALESCE(NULLIF(e.office_code::text,''),'UNASSIGNED') AS zone,
         COALESCE(NULLIF(e.sector_code::text,''),'UNCLASSIFIED') AS sector,
         CASE
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 5 THEN 'MICRO'
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 20 THEN 'SMALL'
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 100 THEN 'MEDIUM'
           ELSE 'LARGE'
         END AS size_tier
  FROM public.er_master e
  WHERE (p_zone IS NULL OR e.office_code::text = p_zone)
    AND (p_sector IS NULL OR e.sector_code::text = p_sector)
    AND (p_size_tier IS NULL OR p_size_tier = CASE
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 5 THEN 'MICRO'
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 20 THEN 'SMALL'
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 100 THEN 'MEDIUM'
           ELSE 'LARGE' END)
    AND (p_risk_band IS NULL OR EXISTS (
          SELECT 1 FROM public.ce_risk_profiles rp
          WHERE rp.employer_id::text = e.regno::text
            AND COALESCE(rp.override_band, rp.risk_band) = p_risk_band))
),
v AS (
  SELECT vi.id, vi.employer_id::text AS employer_id, vt.code AS type_code, vt.name AS type_name,
         vi.status, COALESCE(vi.total_amount,0) AS total_amount,
         vi.discovered_date, vi.resolved_at, em.zone, em.sector, em.size_tier, em.name AS employer
  FROM public.ce_violations vi
  JOIN emp em ON em.regno = vi.employer_id::text
  LEFT JOIN public.ce_violation_types vt ON vt.id = vi.violation_type_id
  CROSS JOIN params pr
  WHERE COALESCE(vi.is_deleted,false) = false
    AND COALESCE(vi.is_merged,false) = false
    AND (p_violation_type IS NULL OR vt.code = p_violation_type)
    AND vi.discovered_date >= pr.pf AND vi.discovered_date <= pr.t
),
vagg AS (
  SELECT
    count(*) FILTER (WHERE v.discovered_date BETWEEN pr.f AND pr.t) AS v_new,
    count(*) FILTER (WHERE v.discovered_date BETWEEN pr.pf AND pr.pt) AS v_new_prev,
    count(*) FILTER (WHERE v.resolved_at::date BETWEEN pr.f AND pr.t) AS v_res,
    count(*) FILTER (WHERE v.resolved_at::date BETWEEN pr.pf AND pr.pt) AS v_res_prev,
    count(*) FILTER (WHERE v.status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')) AS v_open,
    count(*) FILTER (WHERE v.status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')
                       AND v.discovered_date < current_date - 30) AS v_overdue,
    COALESCE(sum(v.total_amount) FILTER (WHERE v.discovered_date BETWEEN pr.f AND pr.t),0) AS amt,
    COALESCE(sum(v.total_amount) FILTER (WHERE v.discovered_date BETWEEN pr.pf AND pr.pt),0) AS amt_prev,
    round(avg(EXTRACT(epoch FROM (v.resolved_at - v.discovered_date::timestamptz))/86400)
          FILTER (WHERE v.resolved_at::date BETWEEN pr.f AND pr.t), 1) AS avg_res,
    round(avg(EXTRACT(epoch FROM (v.resolved_at - v.discovered_date::timestamptz))/86400)
          FILTER (WHERE v.resolved_at::date BETWEEN pr.pf AND pr.pt), 1) AS avg_res_prev,
    count(DISTINCT v.employer_id) FILTER (WHERE v.discovered_date BETWEEN pr.f AND pr.t) AS emp_with_v
  FROM v CROSS JOIN params pr
),
arr AS (
  SELECT count(*) AS n, COALESCE(sum(a.total_outstanding),0) AS outstanding
  FROM public.ce_v_employer_arrears_summary a
  JOIN emp em ON em.regno = a.regno::text
  WHERE COALESCE(a.total_outstanding,0) > 0
),
risk AS (
  SELECT count(*) AS n,
         count(*) FILTER (WHERE COALESCE(rp.override_band, rp.risk_band) IN ('HIGH','CRITICAL')) AS high,
         round(avg(rp.total_score)::numeric,1) AS avg_score,
         round(avg(rp.arrears_score)::numeric,1) AS d_arrears,
         round(avg(rp.violation_score)::numeric,1) AS d_violation,
         round(avg(rp.filing_score)::numeric,1) AS d_filing,
         round(avg(rp.legal_history_score)::numeric,1) AS d_legal,
         round(avg(rp.payment_behavior_score)::numeric,1) AS d_payment
  FROM public.ce_risk_profiles rp JOIN emp em ON em.regno = rp.employer_id::text
),
months AS (
  SELECT m::date AS m FROM params pr,
    generate_series(date_trunc('month', pr.f::timestamp), date_trunc('month', pr.t::timestamp), interval '1 month') m
),
flow AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'b', to_char(mo.m,'YYYY-MM'),
           'opened', (SELECT count(*) FROM v WHERE date_trunc('month', v.discovered_date) = mo.m),
           'resolved', (SELECT count(*) FROM v WHERE date_trunc('month', v.resolved_at::date) = mo.m),
           'amount', (SELECT COALESCE(sum(total_amount),0) FROM v WHERE date_trunc('month', v.discovered_date) = mo.m)
         ) ORDER BY mo.m), '[]'::jsonb) AS j
  FROM months mo
),
types AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type_code', COALESCE(type_code,'UNMAPPED'),
           'type_name', COALESCE(type_name,'Unmapped'), 'current', c, 'previous', pv, 'amount', amt)
         ORDER BY c DESC), '[]'::jsonb) AS j
  FROM (
    SELECT v.type_code, v.type_name,
           count(*) FILTER (WHERE v.discovered_date BETWEEN pr.f AND pr.t) c,
           count(*) FILTER (WHERE v.discovered_date BETWEEN pr.pf AND pr.pt) pv,
           COALESCE(sum(v.total_amount) FILTER (WHERE v.discovered_date BETWEEN pr.f AND pr.t),0) amt
    FROM v CROSS JOIN params pr GROUP BY 1,2 ORDER BY 3 DESC LIMIT 12
  ) t
),
restime AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'ord', ord, 'count', c) ORDER BY ord), '[]'::jsonb) AS j
  FROM (
    SELECT CASE WHEN d <= 7 THEN '0-7 days' WHEN d <= 30 THEN '8-30 days'
                WHEN d <= 60 THEN '31-60 days' WHEN d <= 90 THEN '61-90 days' ELSE '90+ days' END bucket,
           CASE WHEN d <= 7 THEN 1 WHEN d <= 30 THEN 2 WHEN d <= 60 THEN 3 WHEN d <= 90 THEN 4 ELSE 5 END ord,
           count(*) c
    FROM (SELECT EXTRACT(epoch FROM (v.resolved_at - v.discovered_date::timestamptz))/86400 d
          FROM v CROSS JOIN params pr WHERE v.resolved_at::date BETWEEN pr.f AND pr.t) q
    GROUP BY 1,2
  ) b
),
statusmix AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', c) ORDER BY c DESC), '[]'::jsonb) AS j
  FROM (SELECT v.status, count(*) c FROM v CROSS JOIN params pr
        WHERE v.discovered_date BETWEEN pr.f AND pr.t GROUP BY 1) s
),
c3 AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('b', b, 'submitted', submitted, 'posted', posted,
           'pending', pending, 'nil', nil) ORDER BY b), '[]'::jsonb) AS j
  FROM (
    SELECT to_char(date_trunc('month', c.date_received), 'YYYY-MM') b,
           count(*) submitted,
           count(*) FILTER (WHERE c.posting_status = 'PEN') posted,
           count(*) FILTER (WHERE c.posting_status = 'DFT') pending,
           count(*) FILTER (WHERE COALESCE(c.nil_return,false)) nil
    FROM public.cn_c3_reported c
    JOIN emp em ON em.regno = c.payer_id::text
    CROSS JOIN params pr
    WHERE c.date_received BETWEEN pr.f AND pr.t
    GROUP BY 1
  ) t
),
c3miss AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period', period, 'count', c, 'estimated', est) ORDER BY period DESC), '[]'::jsonb) AS j
  FROM (
    SELECT m.period::text period, count(*) c, COALESCE(sum(m.estimated_amt),0) est
    FROM public.cn_c3_missing m JOIN emp em ON em.regno = m.payer_id::text
    GROUP BY 1 ORDER BY 1 DESC LIMIT 12
  ) t
),
pay AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('b', b, 'payments', n, 'amount', amt) ORDER BY b), '[]'::jsonb) AS j
  FROM (
    SELECT to_char(date_trunc('month', p.payment_date), 'YYYY-MM') b, count(*) n,
           COALESCE(sum(p.payment_amount),0) amt
    FROM public.cn_payment p CROSS JOIN params pr
    WHERE p.payment_date BETWEEN pr.f AND pr.t GROUP BY 1
  ) t
),
arrtrend AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period', period, 'outstanding', outstanding,
           'principal', principal, 'penalty', penalty, 'interest', interest) ORDER BY period), '[]'::jsonb) AS j
  FROM (
    SELECT l.period::text period,
           COALESCE(sum(l.total_outstanding),0) outstanding,
           COALESCE(sum(l.principal_outstanding),0) principal,
           COALESCE(sum(l.penalty_outstanding),0) penalty,
           COALESCE(sum(l.interest_outstanding),0) interest
    FROM public.ce_v_ledger_period_balances l JOIN emp em ON em.regno = l.employer_id::text
    GROUP BY 1 ORDER BY 1 DESC LIMIT 18
  ) t
),
arrtop AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('employer_id', regno, 'employer', employer_name,
           'outstanding', total_outstanding) ORDER BY total_outstanding DESC), '[]'::jsonb) AS j
  FROM (
    SELECT a.regno::text regno, a.employer_name, a.total_outstanding
    FROM public.ce_v_employer_arrears_summary a JOIN emp em ON em.regno = a.regno::text
    WHERE COALESCE(a.total_outstanding,0) > 0 ORDER BY a.total_outstanding DESC LIMIT 10
  ) t
),
bands AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('band', band, 'count', c) ORDER BY c DESC), '[]'::jsonb) AS j
  FROM (
    SELECT COALESCE(rp.override_band, rp.risk_band, 'UNSCORED') band, count(*) c
    FROM public.ce_risk_profiles rp JOIN emp em ON em.regno = rp.employer_id::text GROUP BY 1
  ) t
),
migration AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('from_band', previous_band, 'to_band', new_band,
           'count', c, 'direction', dir) ORDER BY c DESC), '[]'::jsonb) AS j
  FROM (
    SELECT COALESCE(h.previous_band,'UNSCORED') previous_band, COALESCE(h.new_band,'UNSCORED') new_band,
           CASE WHEN h.new_score > COALESCE(h.previous_score,0) THEN 'DETERIORATED'
                WHEN h.new_score < COALESCE(h.previous_score,0) THEN 'IMPROVED' ELSE 'STABLE' END dir,
           count(*) c
    FROM public.ce_risk_score_history h
    JOIN public.ce_risk_profiles rp ON rp.id = h.risk_profile_id
    JOIN emp em ON em.regno = rp.employer_id::text
    CROSS JOIN params pr
    WHERE h.calculated_at::date BETWEEN pr.f AND pr.t
      AND COALESCE(h.previous_band,'') IS DISTINCT FROM COALESCE(h.new_band,'')
    GROUP BY 1,2,3
  ) t
),
insp AS (
  SELECT jsonb_build_object(
    'total', count(*),
    'completed', count(*) FILTER (WHERE i.status = 'COMPLETED'),
    'with_findings', count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.ce_inspection_findings f WHERE f.inspection_id = i.id)),
    'series', COALESCE((SELECT jsonb_agg(jsonb_build_object('b', b, 'count', c) ORDER BY b)
      FROM (SELECT to_char(date_trunc('month', i2.scheduled_date),'YYYY-MM') b, count(*) c
            FROM public.ce_inspections i2 CROSS JOIN params pr2
            WHERE i2.scheduled_date BETWEEN pr2.f AND pr2.t GROUP BY 1) s), '[]'::jsonb)
  ) AS j
  FROM public.ce_inspections i CROSS JOIN params pr
  WHERE i.scheduled_date BETWEEN pr.f AND pr.t
),
arrange AS (
  SELECT jsonb_build_object(
    'total', count(*), 'active', count(*) FILTER (WHERE a.status = 'ACTIVE'),
    'breached', count(*) FILTER (WHERE COALESCE(a.breach_detected,false)),
    'completed', count(*) FILTER (WHERE a.status = 'COMPLETED'),
    'debt', COALESCE(sum(a.total_debt),0), 'paid', COALESCE(sum(a.total_paid),0)) AS j
  FROM public.ce_payment_arrangements a
),
legal AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('b', b, 'referrals', c, 'amount', amt) ORDER BY b), '[]'::jsonb) AS j
  FROM (
    SELECT to_char(date_trunc('month', r.created_at),'YYYY-MM') b, count(*) c, COALESCE(sum(r.grand_total),0) amt
    FROM public.ce_legal_referrals r CROSS JOIN params pr
    WHERE r.created_at::date BETWEEN pr.f AND pr.t GROUP BY 1
  ) t
),
seg AS (
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('segment', seg, 'employers', emps, 'violations', vio,
      'resolved', res, 'amount', amt, 'rate', rate) ORDER BY vio DESC) FILTER (WHERE dim='zone'), '[]'::jsonb) AS zones,
    COALESCE(jsonb_agg(jsonb_build_object('segment', seg, 'employers', emps, 'violations', vio,
      'resolved', res, 'amount', amt, 'rate', rate) ORDER BY vio DESC) FILTER (WHERE dim='sector'), '[]'::jsonb) AS sectors,
    COALESCE(jsonb_agg(jsonb_build_object('segment', seg, 'employers', emps, 'violations', vio,
      'resolved', res, 'amount', amt, 'rate', rate) ORDER BY vio DESC) FILTER (WHERE dim='size'), '[]'::jsonb) AS sizes
  FROM (
    SELECT dim, seg, count(DISTINCT regno) emps,
           count(vid) FILTER (WHERE opened) vio,
           count(vid) FILTER (WHERE closed) res,
           COALESCE(sum(amount) FILTER (WHERE opened),0) amt,
           CASE WHEN count(vid) FILTER (WHERE opened) > 0
                THEN round(count(vid) FILTER (WHERE closed)::numeric / count(vid) FILTER (WHERE opened) * 100, 1) END rate
    FROM (
      SELECT d.dim, d.seg, em.regno, v.id vid, v.total_amount amount,
             (v.discovered_date BETWEEN pr.f AND pr.t) opened,
             (v.resolved_at::date BETWEEN pr.f AND pr.t) closed
      FROM emp em
      CROSS JOIN params pr
      CROSS JOIN LATERAL (VALUES ('zone', em.zone), ('sector', em.sector), ('size', em.size_tier)) AS d(dim, seg)
      LEFT JOIN v ON v.employer_id = em.regno
    ) x GROUP BY 1,2
  ) g
),
persistent AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('employer_id', employer_id, 'employer', employer,
           'violations', vio, 'open', still_open, 'amount', amt, 'zone', zone) ORDER BY vio DESC), '[]'::jsonb) AS j
  FROM (
    SELECT v.employer_id, max(v.employer) employer, count(*) vio,
           count(*) FILTER (WHERE v.status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')) still_open,
           COALESCE(sum(v.total_amount),0) amt, max(v.zone) zone
    FROM v CROSS JOIN params pr
    WHERE v.discovered_date BETWEEN pr.f AND pr.t
    GROUP BY v.employer_id HAVING count(*) > 1 ORDER BY 3 DESC LIMIT 15
  ) t
),
improving AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('employer_id', employer_id, 'employer', employer,
           'current', cur, 'previous', prev, 'change', cur - prev) ORDER BY (cur - prev)), '[]'::jsonb) AS j
  FROM (
    SELECT v.employer_id, max(v.employer) employer,
           count(*) FILTER (WHERE v.discovered_date BETWEEN pr.f AND pr.t) cur,
           count(*) FILTER (WHERE v.discovered_date BETWEEN pr.pf AND pr.pt) prev
    FROM v CROSS JOIN params pr GROUP BY v.employer_id
    HAVING count(*) FILTER (WHERE v.discovered_date BETWEEN (SELECT pf FROM params) AND (SELECT pt FROM params))
         > count(*) FILTER (WHERE v.discovered_date BETWEEN (SELECT f FROM params) AND (SELECT t FROM params))
    ORDER BY 3 - 4 LIMIT 10
  ) t
),
opts AS (
  SELECT jsonb_build_object(
    'zones', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', z.office_code, 'name', z.zone_name))
                       FROM public.ce_zones z WHERE z.office_code IS NOT NULL), '[]'::jsonb),
    'violation_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', vt.code, 'name', vt.name) ORDER BY vt.name)
                       FROM public.ce_violation_types vt WHERE COALESCE(vt.is_active,true)), '[]'::jsonb),
    'sectors', COALESCE((SELECT jsonb_agg(DISTINCT sector) FROM emp WHERE sector <> 'UNCLASSIFIED'), '[]'::jsonb),
    'size_tiers', '["MICRO","SMALL","MEDIUM","LARGE"]'::jsonb,
    'risk_bands', COALESCE((SELECT jsonb_agg(DISTINCT COALESCE(override_band, risk_band))
                       FROM public.ce_risk_profiles WHERE COALESCE(override_band, risk_band) IS NOT NULL), '[]'::jsonb)
  ) AS j
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'range', jsonb_build_object('from', pr.f, 'to', pr.t, 'prev_from', pr.pf, 'prev_to', pr.pt, 'days', pr.days),
  'filters', jsonb_build_object('zone', p_zone, 'risk_band', p_risk_band, 'violation_type', p_violation_type,
                                'sector', p_sector, 'size_tier', p_size_tier),
  'kpis', jsonb_build_object(
     'violations_new', a.v_new, 'violations_new_prev', a.v_new_prev,
     'violations_resolved', a.v_res, 'violations_resolved_prev', a.v_res_prev,
     'violations_open', a.v_open, 'violations_overdue', a.v_overdue,
     'exposure_amount', a.amt, 'exposure_amount_prev', a.amt_prev,
     'avg_resolution_days', a.avg_res, 'avg_resolution_days_prev', a.avg_res_prev,
     'resolution_rate', CASE WHEN a.v_new > 0 THEN round((a.v_res::numeric / a.v_new) * 100, 1) END,
     'resolution_rate_prev', CASE WHEN a.v_new_prev > 0 THEN round((a.v_res_prev::numeric / a.v_new_prev) * 100, 1) END,
     'resolution_numerator', a.v_res, 'resolution_denominator', a.v_new,
     'employers_in_scope', (SELECT count(*) FROM emp),
     'employers_with_violations', a.emp_with_v,
     'employers_in_arrears', ar.n, 'total_outstanding', ar.outstanding,
     'high_risk_employers', rk.high, 'risk_profiles', rk.n, 'avg_risk_score', rk.avg_score),
  'violation_flow', flow.j,
  'violation_type_trend', types.j,
  'resolution_time', jsonb_build_object('avg_days', a.avg_res, 'prev_avg_days', a.avg_res_prev,
                                        'buckets', restime.j, 'status_mix', statusmix.j),
  'c3_behaviour', c3.j,
  'c3_missing', c3miss.j,
  'payment_behaviour', pay.j,
  'arrears_trend', arrtrend.j,
  'arrears_top', arrtop.j,
  'risk_bands', bands.j,
  'risk_migration', migration.j,
  'risk_drivers', jsonb_build_object('arrears', rk.d_arrears, 'violation', rk.d_violation, 'filing', rk.d_filing,
                                     'legal_history', rk.d_legal, 'payment_behavior', rk.d_payment, 'n', rk.n),
  'inspections', insp.j,
  'arrangements', arrange.j,
  'legal_trend', legal.j,
  'zone_comparison', seg.zones,
  'sector_comparison', seg.sectors,
  'size_comparison', seg.sizes,
  'persistent_employers', persistent.j,
  'improving_employers', improving.j,
  'options', opts.j,
  'availability', jsonb_build_object(
    'violations', CASE WHEN a.v_new > 0 OR a.v_new_prev > 0 THEN 'ok' ELSE 'no_data' END,
    'c3', CASE WHEN jsonb_array_length(c3.j) > 0 THEN 'ok' ELSE 'no_data' END,
    'payments', CASE WHEN jsonb_array_length(pay.j) > 0 THEN 'ok' ELSE 'no_data' END,
    'arrears', CASE WHEN jsonb_array_length(arrtrend.j) > 0 THEN 'ok' ELSE 'no_data' END,
    'risk_migration', CASE WHEN jsonb_array_length(migration.j) > 0 THEN 'ok' ELSE 'insufficient_history' END,
    'inspections', CASE WHEN COALESCE((insp.j->>'total')::int,0) > 0 THEN 'ok' ELSE 'no_data' END,
    'arrangements', CASE WHEN COALESCE((arrange.j->>'total')::int,0) > 0 THEN 'ok' ELSE 'no_data' END,
    'legal', CASE WHEN jsonb_array_length(legal.j) > 0 THEN 'ok' ELSE 'no_data' END)
)
FROM params pr, vagg a, arr ar, risk rk, flow, types, restime, statusmix, c3, c3miss, pay,
     arrtrend, arrtop, bands, migration, insp, arrange, legal, seg, persistent, improving, opts;
$fn$;

GRANT EXECUTE ON FUNCTION public.ce_compliance_analytics_v1(date, date, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_compliance_analytics_v1(date, date, text, text, text, text, text) TO service_role;

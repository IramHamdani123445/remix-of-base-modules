
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
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_days int := GREATEST(1, (p_to - p_from) + 1);
  v_prev_to date := p_from - 1;
  v_prev_from date := p_from - v_days;
  v_result jsonb;
  v_emp jsonb; v_kpis jsonb;
  v_new int; v_new_prev int; v_res int; v_res_prev int;
  v_open int; v_overdue int;
  v_amount numeric; v_amount_prev numeric;
  v_avg_res numeric; v_avg_res_prev numeric;
BEGIN
  -- employer dimension (zone / sector / size), filtered
  CREATE TEMP TABLE IF NOT EXISTS _cea_emp (
    regno text primary key, name text, zone text, sector text, size_tier text, headcount int
  ) ON COMMIT DROP;
  DELETE FROM _cea_emp;

  INSERT INTO _cea_emp
  SELECT e.regno::text,
         e.name,
         COALESCE(NULLIF(e.office_code::text,''),'UNASSIGNED'),
         COALESCE(NULLIF(e.sector_code::text,''),'UNCLASSIFIED'),
         CASE
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 5 THEN 'MICRO'
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 20 THEN 'SMALL'
           WHEN COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0) <= 100 THEN 'MEDIUM'
           ELSE 'LARGE'
         END,
         COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0)
  FROM public.er_master e
  WHERE (p_zone IS NULL OR e.office_code::text = p_zone)
    AND (p_sector IS NULL OR e.sector_code::text = p_sector);

  IF p_size_tier IS NOT NULL THEN
    DELETE FROM _cea_emp WHERE size_tier <> p_size_tier;
  END IF;

  IF p_risk_band IS NOT NULL THEN
    DELETE FROM _cea_emp t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ce_risk_profiles rp
      WHERE rp.employer_id::text = t.regno
        AND COALESCE(rp.override_band, rp.risk_band) = p_risk_band
    );
  END IF;

  -- violations in scope
  CREATE TEMP TABLE IF NOT EXISTS _cea_v (
    id uuid, employer_id text, type_code text, type_name text, status text, severity text,
    total_amount numeric, discovered_date date, resolved_at timestamptz, zone text, sector text, size_tier text
  ) ON COMMIT DROP;
  DELETE FROM _cea_v;

  INSERT INTO _cea_v
  SELECT v.id, v.employer_id::text, vt.code, vt.name, v.status, v.severity,
         COALESCE(v.total_amount,0), v.discovered_date, v.resolved_at,
         em.zone, em.sector, em.size_tier
  FROM public.ce_violations v
  JOIN _cea_emp em ON em.regno = v.employer_id::text
  LEFT JOIN public.ce_violation_types vt ON vt.id = v.violation_type_id
  WHERE COALESCE(v.is_deleted,false) = false
    AND COALESCE(v.is_merged,false) = false
    AND (p_violation_type IS NULL OR vt.code = p_violation_type)
    AND v.discovered_date >= v_prev_from
    AND v.discovered_date <= p_to;

  SELECT count(*) FILTER (WHERE discovered_date BETWEEN p_from AND p_to),
         count(*) FILTER (WHERE discovered_date BETWEEN v_prev_from AND v_prev_to),
         count(*) FILTER (WHERE resolved_at::date BETWEEN p_from AND p_to),
         count(*) FILTER (WHERE resolved_at::date BETWEEN v_prev_from AND v_prev_to),
         count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')),
         count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')
                            AND discovered_date < current_date - 30),
         COALESCE(sum(total_amount) FILTER (WHERE discovered_date BETWEEN p_from AND p_to),0),
         COALESCE(sum(total_amount) FILTER (WHERE discovered_date BETWEEN v_prev_from AND v_prev_to),0),
         round(avg(EXTRACT(epoch FROM (resolved_at - discovered_date::timestamptz))/86400)
               FILTER (WHERE resolved_at::date BETWEEN p_from AND p_to), 1),
         round(avg(EXTRACT(epoch FROM (resolved_at - discovered_date::timestamptz))/86400)
               FILTER (WHERE resolved_at::date BETWEEN v_prev_from AND v_prev_to), 1)
  INTO v_new, v_new_prev, v_res, v_res_prev, v_open, v_overdue, v_amount, v_amount_prev, v_avg_res, v_avg_res_prev
  FROM _cea_v;

  v_kpis := jsonb_build_object(
    'violations_new', v_new, 'violations_new_prev', v_new_prev,
    'violations_resolved', v_res, 'violations_resolved_prev', v_res_prev,
    'violations_open', v_open, 'violations_overdue', v_overdue,
    'exposure_amount', v_amount, 'exposure_amount_prev', v_amount_prev,
    'avg_resolution_days', v_avg_res, 'avg_resolution_days_prev', v_avg_res_prev,
    'resolution_rate', CASE WHEN v_new > 0 THEN round((v_res::numeric / v_new) * 100, 1) END,
    'resolution_rate_prev', CASE WHEN v_new_prev > 0 THEN round((v_res_prev::numeric / v_new_prev) * 100, 1) END,
    'resolution_numerator', v_res, 'resolution_denominator', v_new,
    'employers_in_scope', (SELECT count(*) FROM _cea_emp),
    'employers_with_violations', (SELECT count(DISTINCT employer_id) FROM _cea_v WHERE discovered_date BETWEEN p_from AND p_to)
  );

  -- arrears (scoped to employers in filter)
  v_kpis := v_kpis || (
    SELECT jsonb_build_object(
      'employers_in_arrears', COALESCE(count(*),0),
      'total_outstanding', COALESCE(sum(a.total_outstanding),0)
    )
    FROM public.ce_v_employer_arrears_summary a
    JOIN _cea_emp em ON em.regno = a.regno::text
    WHERE COALESCE(a.total_outstanding,0) > 0
  );

  -- risk
  v_kpis := v_kpis || (
    SELECT jsonb_build_object(
      'high_risk_employers', COALESCE(count(*) FILTER (WHERE COALESCE(rp.override_band, rp.risk_band) IN ('HIGH','CRITICAL')),0),
      'risk_profiles', COALESCE(count(*),0),
      'avg_risk_score', round(avg(rp.total_score)::numeric, 1)
    )
    FROM public.ce_risk_profiles rp
    JOIN _cea_emp em ON em.regno = rp.employer_id::text
  );

  v_result := jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'days', v_days),
    'filters', jsonb_build_object('zone', p_zone, 'risk_band', p_risk_band, 'violation_type', p_violation_type,
                                  'sector', p_sector, 'size_tier', p_size_tier),
    'kpis', v_kpis
  );

  -- violation flow (monthly new vs resolved)
  v_result := v_result || jsonb_build_object('violation_flow', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'b')
    FROM (
      SELECT jsonb_build_object('b', to_char(m, 'YYYY-MM'),
        'opened', (SELECT count(*) FROM _cea_v v WHERE date_trunc('month', v.discovered_date) = m),
        'resolved', (SELECT count(*) FROM _cea_v v WHERE date_trunc('month', v.resolved_at::date) = m),
        'amount', (SELECT COALESCE(sum(total_amount),0) FROM _cea_v v WHERE date_trunc('month', v.discovered_date) = m)
      ) AS x
      FROM generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') m
    ) s), '[]'::jsonb));

  -- violation type mix, current vs previous
  v_result := v_result || jsonb_build_object('violation_type_trend', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'type_code', COALESCE(type_code,'UNMAPPED'),
      'type_name', COALESCE(type_name, 'Unmapped'),
      'current', c, 'previous', pv, 'amount', amt) ORDER BY c DESC)
    FROM (
      SELECT type_code, type_name,
             count(*) FILTER (WHERE discovered_date BETWEEN p_from AND p_to) c,
             count(*) FILTER (WHERE discovered_date BETWEEN v_prev_from AND v_prev_to) pv,
             COALESCE(sum(total_amount) FILTER (WHERE discovered_date BETWEEN p_from AND p_to),0) amt
      FROM _cea_v GROUP BY 1,2 ORDER BY 3 DESC LIMIT 12
    ) t), '[]'::jsonb));

  -- resolution time buckets + status mix
  v_result := v_result || jsonb_build_object('resolution_time', jsonb_build_object(
    'avg_days', v_avg_res, 'prev_avg_days', v_avg_res_prev,
    'buckets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'ord', ord, 'count', c) ORDER BY ord)
      FROM (
        SELECT CASE
                 WHEN d <= 7 THEN '0-7 days' WHEN d <= 30 THEN '8-30 days'
                 WHEN d <= 60 THEN '31-60 days' WHEN d <= 90 THEN '61-90 days'
                 ELSE '90+ days' END bucket,
               CASE WHEN d <= 7 THEN 1 WHEN d <= 30 THEN 2 WHEN d <= 60 THEN 3 WHEN d <= 90 THEN 4 ELSE 5 END ord,
               count(*) c
        FROM (
          SELECT EXTRACT(epoch FROM (resolved_at - discovered_date::timestamptz))/86400 d
          FROM _cea_v WHERE resolved_at::date BETWEEN p_from AND p_to
        ) q GROUP BY 1,2
      ) b), '[]'::jsonb),
    'status_mix', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', status, 'count', c) ORDER BY c DESC)
      FROM (SELECT status, count(*) c FROM _cea_v WHERE discovered_date BETWEEN p_from AND p_to GROUP BY 1) s), '[]'::jsonb)
  ));

  -- C3 filing behaviour (monthly, by date_received)
  v_result := v_result || jsonb_build_object('c3_behaviour', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('b', b, 'submitted', submitted, 'posted', posted, 'pending', pending, 'nil', nil) ORDER BY b)
    FROM (
      SELECT to_char(date_trunc('month', c.date_received), 'YYYY-MM') b,
             count(*) submitted,
             count(*) FILTER (WHERE c.posting_status = 'PEN') posted,
             count(*) FILTER (WHERE c.posting_status = 'DFT') pending,
             count(*) FILTER (WHERE COALESCE(c.nil_return,false)) nil
      FROM public.cn_c3_reported c
      JOIN _cea_emp em ON em.regno = c.payer_id::text
      WHERE c.date_received BETWEEN p_from AND p_to
      GROUP BY 1
    ) t), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('c3_missing', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('period', period, 'count', c, 'estimated', est) ORDER BY period DESC)
    FROM (
      SELECT m.period::text period, count(*) c, COALESCE(sum(m.estimated_amt),0) est
      FROM public.cn_c3_missing m
      JOIN _cea_emp em ON em.regno = m.payer_id::text
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    ) t), '[]'::jsonb));

  -- payment behaviour (monthly)
  v_result := v_result || jsonb_build_object('payment_behaviour', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('b', b, 'payments', n, 'amount', amt) ORDER BY b)
    FROM (
      SELECT to_char(date_trunc('month', p.payment_date), 'YYYY-MM') b, count(*) n,
             COALESCE(sum(p.payment_amount),0) amt
      FROM public.cn_payment p
      WHERE p.payment_date BETWEEN p_from AND p_to
      GROUP BY 1
    ) t), '[]'::jsonb));

  -- arrears by period + ageing
  v_result := v_result || jsonb_build_object('arrears_trend', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('period', period, 'outstanding', outstanding, 'principal', principal,
                                        'penalty', penalty, 'interest', interest) ORDER BY period)
    FROM (
      SELECT l.period::text period,
             COALESCE(sum(l.total_outstanding),0) outstanding,
             COALESCE(sum(l.principal_outstanding),0) principal,
             COALESCE(sum(l.penalty_outstanding),0) penalty,
             COALESCE(sum(l.interest_outstanding),0) interest
      FROM public.ce_v_ledger_period_balances l
      JOIN _cea_emp em ON em.regno = l.employer_id::text
      GROUP BY 1 ORDER BY 1 DESC LIMIT 18
    ) t), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('arrears_top', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('employer_id', regno, 'employer', employer_name,
                                        'outstanding', total_outstanding) ORDER BY total_outstanding DESC)
    FROM (
      SELECT a.regno::text regno, a.employer_name, a.total_outstanding
      FROM public.ce_v_employer_arrears_summary a
      JOIN _cea_emp em ON em.regno = a.regno::text
      WHERE COALESCE(a.total_outstanding,0) > 0
      ORDER BY a.total_outstanding DESC LIMIT 10
    ) t), '[]'::jsonb));

  -- risk band distribution + migration
  v_result := v_result || jsonb_build_object('risk_bands', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('band', band, 'count', c) ORDER BY c DESC)
    FROM (
      SELECT COALESCE(rp.override_band, rp.risk_band, 'UNSCORED') band, count(*) c
      FROM public.ce_risk_profiles rp JOIN _cea_emp em ON em.regno = rp.employer_id::text
      GROUP BY 1
    ) t), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('risk_migration', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('from_band', previous_band, 'to_band', new_band,
                                        'count', c, 'direction', dir) ORDER BY c DESC)
    FROM (
      SELECT COALESCE(h.previous_band,'UNSCORED') previous_band, COALESCE(h.new_band,'UNSCORED') new_band,
             count(*) c,
             CASE WHEN h.new_score > COALESCE(h.previous_score,0) THEN 'DETERIORATED'
                  WHEN h.new_score < COALESCE(h.previous_score,0) THEN 'IMPROVED' ELSE 'STABLE' END dir
      FROM public.ce_risk_score_history h
      JOIN public.ce_risk_profiles rp ON rp.id = h.risk_profile_id
      JOIN _cea_emp em ON em.regno = rp.employer_id::text
      WHERE h.calculated_at::date BETWEEN p_from AND p_to
        AND COALESCE(h.previous_band,'') IS DISTINCT FROM COALESCE(h.new_band,'')
      GROUP BY 1,2,4
    ) t), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('risk_drivers', COALESCE((
    SELECT jsonb_build_object(
      'arrears', round(avg(rp.arrears_score)::numeric,1),
      'violation', round(avg(rp.violation_score)::numeric,1),
      'filing', round(avg(rp.filing_score)::numeric,1),
      'legal_history', round(avg(rp.legal_history_score)::numeric,1),
      'payment_behavior', round(avg(rp.payment_behavior_score)::numeric,1),
      'n', count(*))
    FROM public.ce_risk_profiles rp JOIN _cea_emp em ON em.regno = rp.employer_id::text
  ), '{}'::jsonb));

  -- enforcement / inspections / arrangements / legal
  v_result := v_result || jsonb_build_object('inspections', COALESCE((
    SELECT jsonb_build_object(
      'total', count(*),
      'completed', count(*) FILTER (WHERE i.status = 'COMPLETED'),
      'with_findings', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.ce_inspection_findings f WHERE f.inspection_id = i.id)),
      'series', COALESCE((SELECT jsonb_agg(jsonb_build_object('b', b, 'count', c) ORDER BY b)
        FROM (SELECT to_char(date_trunc('month', i2.scheduled_date), 'YYYY-MM') b, count(*) c
              FROM public.ce_inspections i2
              WHERE i2.scheduled_date BETWEEN p_from AND p_to GROUP BY 1) s), '[]'::jsonb))
    FROM public.ce_inspections i
    WHERE i.scheduled_date BETWEEN p_from AND p_to
  ), '{}'::jsonb));

  v_result := v_result || jsonb_build_object('arrangements', COALESCE((
    SELECT jsonb_build_object(
      'total', count(*), 'active', count(*) FILTER (WHERE a.status = 'ACTIVE'),
      'breached', count(*) FILTER (WHERE COALESCE(a.breach_detected,false)),
      'completed', count(*) FILTER (WHERE a.status = 'COMPLETED'),
      'debt', COALESCE(sum(a.total_debt),0), 'paid', COALESCE(sum(a.total_paid),0))
    FROM public.ce_payment_arrangements a
  ), '{}'::jsonb));

  v_result := v_result || jsonb_build_object('legal_trend', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('b', b, 'referrals', c, 'amount', amt) ORDER BY b)
    FROM (
      SELECT to_char(date_trunc('month', r.created_at), 'YYYY-MM') b, count(*) c,
             COALESCE(sum(r.grand_total),0) amt
      FROM public.ce_legal_referrals r
      WHERE r.created_at::date BETWEEN p_from AND p_to GROUP BY 1
    ) t), '[]'::jsonb));

  -- segmentation
  v_result := v_result || jsonb_build_object('zone_comparison', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('segment', seg, 'employers', emps, 'violations', vio,
                                        'resolved', res, 'amount', amt, 'rate', rate) ORDER BY vio DESC)
    FROM (
      SELECT em.zone seg, count(DISTINCT em.regno) emps,
             count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) vio,
             count(v.id) FILTER (WHERE v.resolved_at::date BETWEEN p_from AND p_to) res,
             COALESCE(sum(v.total_amount) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to),0) amt,
             CASE WHEN count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) > 0
                  THEN round(count(v.id) FILTER (WHERE v.resolved_at::date BETWEEN p_from AND p_to)::numeric
                       / count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) * 100, 1) END rate
      FROM _cea_emp em LEFT JOIN _cea_v v ON v.employer_id = em.regno
      GROUP BY 1 ORDER BY 3 DESC LIMIT 15
    ) t), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('sector_comparison', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('segment', seg, 'employers', emps, 'violations', vio,
                                        'resolved', res, 'amount', amt, 'rate', rate) ORDER BY vio DESC)
    FROM (
      SELECT em.sector seg, count(DISTINCT em.regno) emps,
             count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) vio,
             count(v.id) FILTER (WHERE v.resolved_at::date BETWEEN p_from AND p_to) res,
             COALESCE(sum(v.total_amount) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to),0) amt,
             CASE WHEN count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) > 0
                  THEN round(count(v.id) FILTER (WHERE v.resolved_at::date BETWEEN p_from AND p_to)::numeric
                       / count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) * 100, 1) END rate
      FROM _cea_emp em LEFT JOIN _cea_v v ON v.employer_id = em.regno
      GROUP BY 1 ORDER BY 3 DESC LIMIT 15
    ) t), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('size_comparison', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('segment', seg, 'employers', emps, 'violations', vio,
                                        'resolved', res, 'amount', amt, 'rate', rate) ORDER BY seg)
    FROM (
      SELECT em.size_tier seg, count(DISTINCT em.regno) emps,
             count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) vio,
             count(v.id) FILTER (WHERE v.resolved_at::date BETWEEN p_from AND p_to) res,
             COALESCE(sum(v.total_amount) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to),0) amt,
             CASE WHEN count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) > 0
                  THEN round(count(v.id) FILTER (WHERE v.resolved_at::date BETWEEN p_from AND p_to)::numeric
                       / count(v.id) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) * 100, 1) END rate
      FROM _cea_emp em LEFT JOIN _cea_v v ON v.employer_id = em.regno
      GROUP BY 1
    ) t), '[]'::jsonb));

  -- watchlists
  v_result := v_result || jsonb_build_object('persistent_employers', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('employer_id', employer_id, 'employer', employer,
      'violations', vio, 'open', still_open, 'amount', amt, 'zone', zone, 'band', band) ORDER BY vio DESC)
    FROM (
      SELECT v.employer_id, max(em.name) employer, count(*) vio,
             count(*) FILTER (WHERE v.status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')) still_open,
             COALESCE(sum(v.total_amount),0) amt, max(em.zone) zone,
             max(COALESCE(rp.override_band, rp.risk_band)) band
      FROM _cea_v v
      JOIN _cea_emp em ON em.regno = v.employer_id
      LEFT JOIN public.ce_risk_profiles rp ON rp.employer_id::text = v.employer_id
      WHERE v.discovered_date BETWEEN p_from AND p_to
      GROUP BY v.employer_id HAVING count(*) > 1
      ORDER BY 3 DESC LIMIT 15
    ) t), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('improving_employers', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('employer_id', employer_id, 'employer', employer,
      'current', cur, 'previous', prev, 'change', cur - prev) ORDER BY (cur - prev))
    FROM (
      SELECT v.employer_id, max(em.name) employer,
             count(*) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to) cur,
             count(*) FILTER (WHERE v.discovered_date BETWEEN v_prev_from AND v_prev_to) prev
      FROM _cea_v v JOIN _cea_emp em ON em.regno = v.employer_id
      GROUP BY v.employer_id
      HAVING count(*) FILTER (WHERE v.discovered_date BETWEEN v_prev_from AND v_prev_to)
             > count(*) FILTER (WHERE v.discovered_date BETWEEN p_from AND p_to)
      ORDER BY 4 - 3 DESC LIMIT 10
    ) t), '[]'::jsonb));

  -- filter option catalogues
  v_result := v_result || jsonb_build_object('options', jsonb_build_object(
    'zones', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', z.office_code, 'name', z.zone_name))
                       FROM public.ce_zones z WHERE z.office_code IS NOT NULL), '[]'::jsonb),
    'violation_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', vt.code, 'name', vt.name) ORDER BY vt.name)
                       FROM public.ce_violation_types vt WHERE COALESCE(vt.is_active,true)), '[]'::jsonb),
    'sectors', COALESCE((SELECT jsonb_agg(DISTINCT sector) FROM _cea_emp WHERE sector <> 'UNCLASSIFIED'), '[]'::jsonb),
    'risk_bands', COALESCE((SELECT jsonb_agg(DISTINCT COALESCE(override_band, risk_band))
                       FROM public.ce_risk_profiles WHERE COALESCE(override_band, risk_band) IS NOT NULL), '[]'::jsonb)
  ));

  -- availability map
  v_result := v_result || jsonb_build_object('availability', jsonb_build_object(
    'violations', CASE WHEN v_new > 0 OR v_new_prev > 0 THEN 'ok' ELSE 'no_data' END,
    'c3', CASE WHEN jsonb_array_length(v_result->'c3_behaviour') > 0 THEN 'ok' ELSE 'no_data' END,
    'payments', CASE WHEN jsonb_array_length(v_result->'payment_behaviour') > 0 THEN 'ok' ELSE 'no_data' END,
    'arrears', CASE WHEN jsonb_array_length(v_result->'arrears_trend') > 0 THEN 'ok' ELSE 'no_data' END,
    'risk_migration', CASE WHEN jsonb_array_length(v_result->'risk_migration') > 0 THEN 'ok' ELSE 'insufficient_history' END,
    'inspections', CASE WHEN COALESCE((v_result->'inspections'->>'total')::int,0) > 0 THEN 'ok' ELSE 'no_data' END,
    'arrangements', CASE WHEN COALESCE((v_result->'arrangements'->>'total')::int,0) > 0 THEN 'ok' ELSE 'no_data' END,
    'legal', CASE WHEN jsonb_array_length(v_result->'legal_trend') > 0 THEN 'ok' ELSE 'no_data' END
  ));

  RETURN v_result;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ce_compliance_analytics_v1(date, date, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_compliance_analytics_v1(date, date, text, text, text, text, text) TO service_role;

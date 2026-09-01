
CREATE OR REPLACE FUNCTION public.ce_trend_analytics_v1(
  p_from date,
  p_to date,
  p_grain text DEFAULT 'month',
  p_compare text DEFAULT 'none',
  p_zone text[] DEFAULT NULL,
  p_case_type text[] DEFAULT NULL,
  p_violation_type text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  v_grain text := CASE lower(coalesce(p_grain,'month')) WHEN 'quarter' THEN 'quarter' WHEN 'year' THEN 'year' ELSE 'month' END;
  v_step interval := CASE lower(coalesce(p_grain,'month')) WHEN 'quarter' THEN interval '3 months' WHEN 'year' THEN interval '1 year' ELSE interval '1 month' END;
  v_start date := date_trunc(v_grain, p_from)::date;
  v_end   date := date_trunc(v_grain, p_to)::date;
  v_last  date;
  v_n int;
  v_off interval;
  v_ext date;
  v_terr text[];
  v_zids uuid[];
  v_vtypes uuid[];
  v_zone_on boolean := p_zone IS NOT NULL AND array_length(p_zone,1) > 0;
  v_ct_on boolean := p_case_type IS NOT NULL AND array_length(p_case_type,1) > 0;
  v_out jsonb := '{}'::jsonb;
  v_pts jsonb;
  v_hist date;
BEGIN
  IF v_end < v_start THEN v_end := v_start; END IF;
  v_last := (v_end + v_step - interval '1 day')::date;
  SELECT count(*) INTO v_n FROM generate_series(v_start, v_end, v_step);
  v_off := CASE lower(coalesce(p_compare,'none'))
             WHEN 'previous_year' THEN interval '1 year'
             WHEN 'previous_period' THEN v_n * v_step
             ELSE NULL END;
  v_ext := (v_start - coalesce(v_off, interval '0'))::date;

  IF v_zone_on THEN
    SELECT array_agg(DISTINCT territory) FILTER (WHERE territory IS NOT NULL), array_agg(DISTINCT id)
      INTO v_terr, v_zids FROM ce_zones WHERE zone_code = ANY(p_zone);
  END IF;
  IF p_violation_type IS NOT NULL AND array_length(p_violation_type,1) > 0 THEN
    SELECT array_agg(id) INTO v_vtypes FROM ce_violation_types WHERE code = ANY(p_violation_type);
  END IF;

  ------------------------------------------------------------------ cases
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_ext, v_end, v_step) gs
  ), c AS (
    SELECT opened_date, closed_date FROM ce_cases
    WHERE coalesce(is_deleted,false) = false
      AND (NOT v_zone_on OR territory = ANY(coalesce(v_terr, ARRAY[]::text[])))
      AND (NOT v_ct_on OR ce_case_type_label(case_type) = ANY(p_case_type))
  ), a AS (
    SELECT s.ps,
      (SELECT count(*) FROM c WHERE c.opened_date BETWEEN s.ps AND s.pe) created,
      (SELECT count(*) FROM c WHERE c.closed_date BETWEEN s.ps AND s.pe) closed,
      (SELECT count(*) FROM c WHERE c.opened_date <= s.pe AND (c.closed_date IS NULL OR c.closed_date > s.pe)) backlog,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (c.closed_date - c.opened_date))
         FROM c WHERE c.closed_date BETWEEN s.ps AND s.pe AND c.opened_date IS NOT NULL) med_days,
      (SELECT avg(c.closed_date - c.opened_date)
         FROM c WHERE c.closed_date BETWEEN s.ps AND s.pe AND c.opened_date IS NOT NULL) avg_days
    FROM spine s
  )
  SELECT jsonb_agg(jsonb_build_object(
           'period_start', a.ps, 'created', a.created, 'closed', a.closed, 'backlog', a.backlog,
           'ratio', CASE WHEN a.created > 0 THEN round((a.closed::numeric / a.created) * 100, 1) ELSE NULL END,
           'median_days', round(a.med_days::numeric, 1), 'avg_days', round(a.avg_days::numeric, 1),
           'prev_created', p.created, 'prev_closed', p.closed, 'prev_backlog', p.backlog
         ) ORDER BY a.ps)
    INTO v_pts
    FROM a LEFT JOIN a p ON v_off IS NOT NULL AND p.ps = (a.ps - v_off)::date
   WHERE a.ps >= v_start;
  SELECT min(opened_date) INTO v_hist FROM ce_cases WHERE coalesce(is_deleted,false) = false;
  v_out := v_out || jsonb_build_object('cases', jsonb_build_object(
    'status', CASE WHEN v_hist IS NULL THEN 'no_data' WHEN v_hist > v_start THEN 'insufficient_history' ELSE 'ok' END,
    'history_from', v_hist, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------------------ violations
  WITH spine AS (
    SELECT gs::date ps FROM generate_series(v_ext, v_end, v_step) gs
  ), op AS (
    SELECT date_trunc(v_grain, discovered_date)::date b, count(*) n, coalesce(sum(total_amount),0) amt
    FROM ce_violations
    WHERE coalesce(is_deleted,false) = false
      AND discovered_date BETWEEN v_ext AND v_last
      AND (NOT v_zone_on OR territory = ANY(coalesce(v_terr, ARRAY[]::text[])) OR zone_id = ANY(coalesce(v_zids, ARRAY[]::uuid[])))
      AND (v_vtypes IS NULL OR violation_type_id = ANY(v_vtypes))
    GROUP BY 1
  ), rs AS (
    SELECT date_trunc(v_grain, resolved_at)::date b, count(*) n
    FROM ce_violations
    WHERE coalesce(is_deleted,false) = false
      AND resolved_at::date BETWEEN v_ext AND v_last
      AND (NOT v_zone_on OR territory = ANY(coalesce(v_terr, ARRAY[]::text[])) OR zone_id = ANY(coalesce(v_zids, ARRAY[]::uuid[])))
      AND (v_vtypes IS NULL OR violation_type_id = ANY(v_vtypes))
    GROUP BY 1
  ), a AS (
    SELECT s.ps, coalesce(op.n,0) opened, coalesce(rs.n,0) resolved, coalesce(op.amt,0) amount
    FROM spine s LEFT JOIN op ON op.b = s.ps LEFT JOIN rs ON rs.b = s.ps
  )
  SELECT jsonb_agg(jsonb_build_object(
           'period_start', a.ps, 'opened', a.opened, 'resolved', a.resolved, 'amount', a.amount,
           'prev_opened', p.opened, 'prev_resolved', p.resolved
         ) ORDER BY a.ps)
    INTO v_pts
    FROM a LEFT JOIN a p ON v_off IS NOT NULL AND p.ps = (a.ps - v_off)::date
   WHERE a.ps >= v_start;
  SELECT min(discovered_date) INTO v_hist FROM ce_violations WHERE coalesce(is_deleted,false) = false;
  v_out := v_out || jsonb_build_object('violations', jsonb_build_object(
    'status', CASE WHEN v_hist IS NULL THEN 'no_data' WHEN v_hist > v_start THEN 'insufficient_history' ELSE 'ok' END,
    'history_from', v_hist, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------- violations by type
  WITH g AS (
    SELECT date_trunc(v_grain, vi.discovered_date)::date b,
           coalesce(vt.code,'UNKNOWN') tcode, coalesce(vt.name,'Unclassified') tname, count(*) n
    FROM ce_violations vi LEFT JOIN ce_violation_types vt ON vt.id = vi.violation_type_id
    WHERE coalesce(vi.is_deleted,false) = false
      AND vi.discovered_date BETWEEN v_start AND v_last
      AND (NOT v_zone_on OR vi.territory = ANY(coalesce(v_terr, ARRAY[]::text[])) OR vi.zone_id = ANY(coalesce(v_zids, ARRAY[]::uuid[])))
      AND (v_vtypes IS NULL OR vi.violation_type_id = ANY(v_vtypes))
    GROUP BY 1,2,3
  ), top AS (
    SELECT tcode, tname, sum(n) tot FROM g GROUP BY 1,2 ORDER BY 3 DESC LIMIT 8
  ), spine AS (
    SELECT gs::date ps FROM generate_series(v_start, v_end, v_step) gs
  )
  SELECT jsonb_agg(jsonb_build_object('period_start', s.ps, 'type_code', t.tcode, 'type_name', t.tname,
           'count', coalesce(g.n,0)) ORDER BY s.ps)
    INTO v_pts
    FROM spine s CROSS JOIN top t LEFT JOIN g ON g.b = s.ps AND g.tcode = t.tcode;
  v_out := v_out || jsonb_build_object('violation_types', jsonb_build_object(
    'status', CASE WHEN v_pts IS NULL THEN 'no_data' ELSE 'ok' END, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------- C3 filing compliance
  WITH spine AS (
    SELECT gs::date ps FROM generate_series(v_start, v_end, v_step) gs
  ), r AS (
    SELECT date_trunc(v_grain, period)::date b, count(*) n,
           count(*) FILTER (WHERE upper(coalesce(posting_status,'')) = 'POSTED') posted
    FROM cn_c3_reported WHERE period::date BETWEEN v_start AND v_last GROUP BY 1
  ), m AS (
    SELECT date_trunc(v_grain, period)::date b, count(*) n
    FROM cn_c3_missing WHERE period::date BETWEEN v_start AND v_last GROUP BY 1
  ), a AS (
    SELECT s.ps, coalesce(r.n,0) reported, coalesce(r.posted,0) posted, coalesce(m.n,0) missing
    FROM spine s LEFT JOIN r ON r.b = s.ps LEFT JOIN m ON m.b = s.ps
  )
  SELECT jsonb_agg(jsonb_build_object(
           'period_start', ps, 'reported', reported, 'posted', posted, 'missing', missing,
           'expected', reported + missing,
           'filing_rate', CASE WHEN reported + missing > 0 THEN round((reported::numeric/(reported+missing))*100,1) ELSE NULL END,
           'posted_rate', CASE WHEN reported > 0 THEN round((posted::numeric/reported)*100,1) ELSE NULL END
         ) ORDER BY ps) INTO v_pts FROM a;
  SELECT min(period)::date INTO v_hist FROM cn_c3_reported;
  v_out := v_out || jsonb_build_object('c3', jsonb_build_object(
    'status', CASE WHEN v_hist IS NULL THEN 'no_data' ELSE 'ok' END, 'history_from', v_hist,
    'zone_filtered', false, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------- outstanding exposure
  SELECT min(coalesce(effective_date, posted_at::date)) INTO v_hist FROM ce_employer_financial_ledger;
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_ext, v_end, v_step) gs
  ), l AS (
    SELECT coalesce(effective_date, posted_at::date) d, coalesce(debit_amount,0) - coalesce(credit_amount,0) net
    FROM ce_employer_financial_ledger
    WHERE (NOT v_zone_on OR territory = ANY(coalesce(v_terr, ARRAY[]::text[])))
  ), a AS (
    SELECT s.ps,
      CASE WHEN v_hist IS NULL OR s.pe < v_hist THEN NULL
           ELSE (SELECT coalesce(sum(net),0) FROM l WHERE l.d <= s.pe) END outstanding
    FROM spine s
  )
  SELECT jsonb_agg(jsonb_build_object('period_start', a.ps, 'outstanding', a.outstanding,
           'prev_outstanding', p.outstanding) ORDER BY a.ps)
    INTO v_pts FROM a LEFT JOIN a p ON v_off IS NOT NULL AND p.ps = (a.ps - v_off)::date
   WHERE a.ps >= v_start;
  v_out := v_out || jsonb_build_object('exposure', jsonb_build_object(
    'status', CASE WHEN v_hist IS NULL THEN 'no_data' WHEN v_hist > v_start THEN 'insufficient_history' ELSE 'ok' END,
    'history_from', v_hist, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------------------ recovery
  SELECT min(payment_date)::date INTO v_hist FROM cn_payment;
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_ext, v_end, v_step) gs
  ), pay AS (
    SELECT date_trunc(v_grain, payment_date)::date b, sum(payment_amount) amt, count(*) n
    FROM cn_payment WHERE payment_date::date BETWEEN v_ext AND v_last GROUP BY 1
  ), a AS (
    SELECT s.ps,
      CASE WHEN v_hist IS NULL OR s.pe < v_hist THEN NULL ELSE coalesce(pay.amt,0) END amount,
      CASE WHEN v_hist IS NULL OR s.pe < v_hist THEN NULL ELSE coalesce(pay.n,0) END payments
    FROM spine s LEFT JOIN pay ON pay.b = s.ps
  )
  SELECT jsonb_agg(jsonb_build_object('period_start', a.ps, 'amount', a.amount, 'payments', a.payments,
           'prev_amount', p.amount) ORDER BY a.ps)
    INTO v_pts FROM a LEFT JOIN a p ON v_off IS NOT NULL AND p.ps = (a.ps - v_off)::date
   WHERE a.ps >= v_start;
  v_out := v_out || jsonb_build_object('recovery', jsonb_build_object(
    'status', CASE WHEN v_hist IS NULL THEN 'no_data' WHEN v_hist > v_start THEN 'insufficient_history' ELSE 'ok' END,
    'history_from', v_hist, 'zone_filtered', false, 'points', coalesce(v_pts,'[]'::jsonb)));

  ---------------------------------------------------------------- enforcement
  WITH spine AS (
    SELECT gs::date ps FROM generate_series(v_start, v_end, v_step) gs
  ), n AS (
    SELECT date_trunc(v_grain, created_at)::date b,
           count(*) FILTER (WHERE upper(coalesce(notice_type,'')) LIKE '%WARNING%') warn,
           count(*) FILTER (WHERE upper(coalesce(notice_type,'')) LIKE '%DEMAND%') demand,
           count(*) FILTER (WHERE upper(coalesce(notice_type,'')) NOT LIKE '%WARNING%'
                              AND upper(coalesce(notice_type,'')) NOT LIKE '%DEMAND%') other
    FROM ce_notices WHERE created_at::date BETWEEN v_start AND v_last GROUP BY 1
  ), ar AS (
    SELECT date_trunc(v_grain, created_at)::date b, count(*) n FROM ce_payment_arrangements
    WHERE created_at::date BETWEEN v_start AND v_last GROUP BY 1
  ), br AS (
    SELECT date_trunc(v_grain, detected_at)::date b, count(*) n FROM ce_arrangement_breaches
    WHERE detected_at::date BETWEEN v_start AND v_last GROUP BY 1
  ), rf AS (
    SELECT date_trunc(v_grain, created_at)::date b, count(*) n FROM ce_legal_referrals
    WHERE created_at::date BETWEEN v_start AND v_last GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object('period_start', s.ps,
           'warning_notices', coalesce(n.warn,0), 'demand_notices', coalesce(n.demand,0),
           'other_notices', coalesce(n.other,0), 'arrangements', coalesce(ar.n,0),
           'breaches', coalesce(br.n,0), 'referrals', coalesce(rf.n,0)) ORDER BY s.ps)
    INTO v_pts
    FROM spine s LEFT JOIN n ON n.b = s.ps LEFT JOIN ar ON ar.b = s.ps
                 LEFT JOIN br ON br.b = s.ps LEFT JOIN rf ON rf.b = s.ps;
  SELECT min(created_at)::date INTO v_hist FROM ce_notices;
  v_out := v_out || jsonb_build_object('enforcement', jsonb_build_object(
    'status', CASE WHEN v_pts IS NULL THEN 'no_data' ELSE 'ok' END, 'history_from', v_hist,
    'points', coalesce(v_pts,'[]'::jsonb)));

  ---------------------------------------------------------------------- risk
  SELECT min(calculated_at)::date INTO v_hist FROM ce_risk_score_history;
  IF v_hist IS NULL THEN
    v_out := v_out || jsonb_build_object('risk', jsonb_build_object(
      'status','unavailable','reason','No historical risk-band events exist.','points','[]'::jsonb));
  ELSE
    WITH spine AS (
      SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_start, v_end, v_step) gs
      WHERE (gs + v_step - interval '1 day')::date >= v_hist
    ), snap AS (
      SELECT s.ps, upper(coalesce(h.new_band,'UNKNOWN')) band, count(*) n
      FROM spine s
      CROSS JOIN LATERAL (
        SELECT DISTINCT ON (rh.risk_profile_id) rh.new_band
        FROM ce_risk_score_history rh
        JOIN ce_risk_profiles rp ON rp.id = rh.risk_profile_id
        WHERE rh.calculated_at::date <= s.pe
          AND (NOT v_zone_on OR rp.territory = ANY(coalesce(v_terr, ARRAY[]::text[])) OR rp.zone_id = ANY(coalesce(v_zids, ARRAY[]::uuid[])))
        ORDER BY rh.risk_profile_id, rh.calculated_at DESC
      ) h
      GROUP BY s.ps, upper(coalesce(h.new_band,'UNKNOWN'))
    )
    SELECT jsonb_agg(jsonb_build_object('period_start', ps, 'band', band, 'count', n) ORDER BY ps) INTO v_pts FROM snap;
    v_out := v_out || jsonb_build_object('risk', jsonb_build_object(
      'status', CASE WHEN v_pts IS NULL THEN 'no_data' WHEN v_hist > v_start THEN 'insufficient_history' ELSE 'ok' END,
      'history_from', v_hist, 'points', coalesce(v_pts,'[]'::jsonb)));
  END IF;

  --------------------------------------------------------- case type compare
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_start, v_end, v_step) gs
  ), c AS (
    SELECT ce_case_type_label(case_type) lbl, opened_date, closed_date FROM ce_cases
    WHERE coalesce(is_deleted,false) = false
      AND (NOT v_zone_on OR territory = ANY(coalesce(v_terr, ARRAY[]::text[])))
      AND (NOT v_ct_on OR ce_case_type_label(case_type) = ANY(p_case_type))
  ), top AS (
    SELECT lbl, count(*) n FROM c WHERE opened_date BETWEEN v_start AND v_last GROUP BY 1 ORDER BY 2 DESC LIMIT 6
  )
  SELECT jsonb_agg(jsonb_build_object(
           'period_start', s.ps, 'label', t.lbl,
           'volume', (SELECT count(*) FROM c WHERE c.lbl = t.lbl AND c.opened_date BETWEEN s.ps AND s.pe),
           'resolved', (SELECT count(*) FROM c WHERE c.lbl = t.lbl AND c.closed_date BETWEEN s.ps AND s.pe),
           'median_days', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (c.closed_date - c.opened_date))::numeric,1)
                             FROM c WHERE c.lbl = t.lbl AND c.closed_date BETWEEN s.ps AND s.pe AND c.opened_date IS NOT NULL)
         ) ORDER BY s.ps) INTO v_pts
    FROM spine s CROSS JOIN top t;
  v_out := v_out || jsonb_build_object('case_types', jsonb_build_object(
    'status', CASE WHEN v_pts IS NULL THEN 'no_data' ELSE 'ok' END, 'points', coalesce(v_pts,'[]'::jsonb)));

  RETURN v_out || jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object('from', v_start, 'to', v_end, 'grain', v_grain, 'periods', v_n,
                                'compare', lower(coalesce(p_compare,'none'))),
    'filters', jsonb_build_object('zone', p_zone, 'case_type', p_case_type, 'violation_type', p_violation_type));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ce_trend_analytics_v1(date, date, text, text, text[], text[], text[]) TO authenticated, service_role;

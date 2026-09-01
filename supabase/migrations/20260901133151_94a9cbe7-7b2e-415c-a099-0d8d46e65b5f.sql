
CREATE OR REPLACE FUNCTION public.ce_case_type_label(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE upper(regexp_replace(coalesce(p_code,''), '[^a-zA-Z0-9]+', '_', 'g'))
    WHEN 'LATE_C3_SUBMISSION' THEN 'Late C3 Submission'
    WHEN 'C3_NOT_SUBMITTED' THEN 'C3 Not Submitted'
    WHEN 'C3_SUBMITTED_NO_PAYMENT' THEN 'C3 Submitted Without Payment'
    WHEN 'C3_VALIDATION_ERROR' THEN 'C3 Validation Error'
    WHEN 'FILING' THEN 'Filing Compliance'
    WHEN 'FILING_COMPLIANCE' THEN 'Filing Compliance'
    WHEN 'DECLARATION' THEN 'Declaration Integrity'
    WHEN 'DECLARATION_INTEGRITY' THEN 'Declaration Integrity'
    WHEN 'PAYMENT' THEN 'Payment Compliance'
    WHEN 'PAYMENT_COMPLIANCE' THEN 'Payment Compliance'
    WHEN 'UNDERPAYMENT' THEN 'Underpayment'
    WHEN 'ARREARS' THEN 'Arrears'
    WHEN 'ARREARS_CASE' THEN 'Arrears'
    WHEN 'ESCALATION' THEN 'Enforcement Escalation'
    WHEN 'COMPLIANCE' THEN 'General Compliance'
    WHEN 'AUDIT_REQUIRED' THEN 'Audit Required'
    WHEN 'PAYMENT_ARRANGEMENT_DEFAULT' THEN 'Arrangement Default'
    WHEN 'SCOUTING_UNREGISTERED_EMPLOYER' THEN 'Unregistered Employer'
    WHEN '' THEN 'Unclassified'
    ELSE initcap(replace(lower(regexp_replace(p_code, '[^a-zA-Z0-9]+', ' ', 'g')), '_', ' '))
  END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_case_type_label(text) TO authenticated, service_role;

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
  v_step interval := CASE v_grain WHEN 'quarter' THEN interval '3 months' WHEN 'year' THEN interval '1 year' ELSE interval '1 month' END;
  v_start date := date_trunc(v_grain, p_from)::date;
  v_end   date := date_trunc(v_grain, p_to)::date;
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
  v_status text;
BEGIN
  IF v_end < v_start THEN v_end := v_start; END IF;
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

  ------------------------------------------------------------------ case volume
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_ext, v_end, v_step) gs
  ), c AS (
    SELECT * FROM ce_cases
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
  v_status := CASE WHEN v_hist IS NULL THEN 'no_data' WHEN v_hist > v_start THEN 'insufficient_history' ELSE 'ok' END;
  v_out := v_out || jsonb_build_object('cases', jsonb_build_object(
    'status', v_status, 'history_from', v_hist, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------------------ violations
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_ext, v_end, v_step) gs
  ), v AS (
    SELECT * FROM ce_violations
    WHERE coalesce(is_deleted,false) = false
      AND (NOT v_zone_on OR territory = ANY(coalesce(v_terr, ARRAY[]::text[])) OR zone_id = ANY(coalesce(v_zids, ARRAY[]::uuid[])))
      AND (v_vtypes IS NULL OR violation_type_id = ANY(v_vtypes))
  ), a AS (
    SELECT s.ps,
      (SELECT count(*) FROM v WHERE v.discovered_date BETWEEN s.ps AND s.pe) opened,
      (SELECT count(*) FROM v WHERE v.resolved_at::date BETWEEN s.ps AND s.pe) resolved,
      (SELECT coalesce(sum(v.total_amount),0) FROM v WHERE v.discovered_date BETWEEN s.ps AND s.pe) amount
    FROM spine s
  )
  SELECT jsonb_agg(jsonb_build_object(
           'period_start', a.ps, 'opened', a.opened, 'resolved', a.resolved, 'amount', a.amount,
           'prev_opened', p.opened, 'prev_resolved', p.resolved
         ) ORDER BY a.ps)
    INTO v_pts
    FROM a LEFT JOIN a p ON v_off IS NOT NULL AND p.ps = (a.ps - v_off)::date
   WHERE a.ps >= v_start;

  SELECT min(discovered_date) INTO v_hist FROM ce_violations WHERE coalesce(is_deleted,false) = false;
  v_status := CASE WHEN v_hist IS NULL THEN 'no_data' WHEN v_hist > v_start THEN 'insufficient_history' ELSE 'ok' END;
  v_out := v_out || jsonb_build_object('violations', jsonb_build_object(
    'status', v_status, 'history_from', v_hist, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------- violations by type
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_start, v_end, v_step) gs
  ), v AS (
    SELECT vi.*, coalesce(vt.name, 'Unclassified') tname, coalesce(vt.code,'UNKNOWN') tcode
    FROM ce_violations vi LEFT JOIN ce_violation_types vt ON vt.id = vi.violation_type_id
    WHERE coalesce(vi.is_deleted,false) = false
      AND (NOT v_zone_on OR vi.territory = ANY(coalesce(v_terr, ARRAY[]::text[])) OR vi.zone_id = ANY(coalesce(v_zids, ARRAY[]::uuid[])))
      AND (v_vtypes IS NULL OR vi.violation_type_id = ANY(v_vtypes))
      AND vi.discovered_date BETWEEN v_start AND (v_end + v_step - interval '1 day')::date
  ), top AS (
    SELECT tcode, tname, count(*) n FROM v GROUP BY 1,2 ORDER BY 3 DESC LIMIT 8
  )
  SELECT jsonb_agg(x ORDER BY (x->>'period_start'))
    INTO v_pts
    FROM (
      SELECT jsonb_build_object('period_start', s.ps, 'type_code', t.tcode, 'type_name', t.tname,
               'count', (SELECT count(*) FROM v WHERE v.tcode = t.tcode AND v.discovered_date BETWEEN s.ps AND s.pe)) x
      FROM spine s CROSS JOIN top t
    ) q;
  v_out := v_out || jsonb_build_object('violation_types', jsonb_build_object(
    'status', CASE WHEN v_pts IS NULL THEN 'no_data' ELSE 'ok' END, 'points', coalesce(v_pts,'[]'::jsonb)));

  ------------------------------------------------------- C3 filing compliance
  WITH spine AS (
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_start, v_end, v_step) gs
  ), a AS (
    SELECT s.ps,
      (SELECT count(*) FROM cn_c3_reported r WHERE r.period::date BETWEEN s.ps AND s.pe) reported,
      (SELECT count(*) FROM cn_c3_reported r WHERE r.period::date BETWEEN s.ps AND s.pe AND upper(coalesce(r.posting_status,'')) = 'POSTED') posted,
      (SELECT count(*) FROM cn_c3_missing m WHERE m.period::date BETWEEN s.ps AND s.pe) missing
    FROM spine s
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
  ), a AS (
    SELECT s.ps,
      CASE WHEN v_hist IS NULL OR s.pe < v_hist THEN NULL
           ELSE (SELECT coalesce(sum(payment_amount),0) FROM cn_payment WHERE payment_date::date BETWEEN s.ps AND s.pe) END amount,
      CASE WHEN v_hist IS NULL OR s.pe < v_hist THEN NULL
           ELSE (SELECT count(*) FROM cn_payment WHERE payment_date::date BETWEEN s.ps AND s.pe) END payments
    FROM spine s
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
    SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_start, v_end, v_step) gs
  )
  SELECT jsonb_agg(jsonb_build_object(
           'period_start', s.ps,
           'warning_notices', (SELECT count(*) FROM ce_notices n WHERE n.created_at::date BETWEEN s.ps AND s.pe AND upper(coalesce(n.notice_type,'')) LIKE '%WARNING%'),
           'demand_notices', (SELECT count(*) FROM ce_notices n WHERE n.created_at::date BETWEEN s.ps AND s.pe AND upper(coalesce(n.notice_type,'')) LIKE '%DEMAND%'),
           'other_notices', (SELECT count(*) FROM ce_notices n WHERE n.created_at::date BETWEEN s.ps AND s.pe AND upper(coalesce(n.notice_type,'')) NOT LIKE '%WARNING%' AND upper(coalesce(n.notice_type,'')) NOT LIKE '%DEMAND%'),
           'arrangements', (SELECT count(*) FROM ce_payment_arrangements pa WHERE pa.created_at::date BETWEEN s.ps AND s.pe),
           'breaches', (SELECT count(*) FROM ce_arrangement_breaches b WHERE b.detected_at::date BETWEEN s.ps AND s.pe),
           'referrals', (SELECT count(*) FROM ce_legal_referrals r WHERE r.created_at::date BETWEEN s.ps AND s.pe)
         ) ORDER BY s.ps) INTO v_pts FROM spine s;
  SELECT min(created_at)::date INTO v_hist FROM ce_notices;
  v_out := v_out || jsonb_build_object('enforcement', jsonb_build_object(
    'status', CASE WHEN v_pts IS NULL THEN 'no_data' ELSE 'ok' END, 'history_from', v_hist,
    'points', coalesce(v_pts,'[]'::jsonb)));

  ---------------------------------------------------------------------- risk
  SELECT min(calculated_at)::date INTO v_hist FROM ce_risk_score_history;
  IF v_hist IS NULL THEN
    v_out := v_out || jsonb_build_object('risk', jsonb_build_object(
      'status','unavailable','reason','No historical risk-band events exist (ce_risk_score_history is empty).','points','[]'::jsonb));
  ELSE
    WITH spine AS (
      SELECT gs::date ps, (gs + v_step - interval '1 day')::date pe FROM generate_series(v_start, v_end, v_step) gs
    ), snap AS (
      SELECT s.ps, h.new_band band, count(*) n
      FROM spine s
      JOIN LATERAL (
        SELECT DISTINCT ON (rh.risk_profile_id) rh.risk_profile_id, rh.new_band
        FROM ce_risk_score_history rh
        JOIN ce_risk_profiles rp ON rp.id = rh.risk_profile_id
        WHERE rh.calculated_at::date <= s.pe
          AND (NOT v_zone_on OR rp.territory = ANY(coalesce(v_terr, ARRAY[]::text[])) OR rp.zone_id = ANY(coalesce(v_zids, ARRAY[]::uuid[])))
        ORDER BY rh.risk_profile_id, rh.calculated_at DESC
      ) h ON true
      WHERE s.pe >= v_hist
      GROUP BY s.ps, h.new_band
    )
    SELECT jsonb_agg(jsonb_build_object('period_start', ps, 'band', upper(coalesce(band,'UNKNOWN')), 'count', n) ORDER BY ps)
      INTO v_pts FROM snap;
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
    SELECT lbl, count(*) n FROM c WHERE opened_date BETWEEN v_start AND (v_end + v_step - interval '1 day')::date
    GROUP BY 1 ORDER BY 2 DESC LIMIT 6
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

CREATE INDEX IF NOT EXISTS idx_ce_cases_opened_date ON public.ce_cases(opened_date);
CREATE INDEX IF NOT EXISTS idx_ce_cases_closed_date ON public.ce_cases(closed_date);
CREATE INDEX IF NOT EXISTS idx_ce_violations_discovered_date ON public.ce_violations(discovered_date);
CREATE INDEX IF NOT EXISTS idx_ce_violations_resolved_at ON public.ce_violations(resolved_at);
CREATE INDEX IF NOT EXISTS idx_ce_notices_created_at_type ON public.ce_notices(created_at, notice_type);
CREATE INDEX IF NOT EXISTS idx_ce_risk_score_history_calculated_at ON public.ce_risk_score_history(calculated_at);
CREATE INDEX IF NOT EXISTS idx_ce_efl_effective_date ON public.ce_employer_financial_ledger(effective_date);
CREATE INDEX IF NOT EXISTS idx_cn_payment_payment_date ON public.cn_payment(payment_date);

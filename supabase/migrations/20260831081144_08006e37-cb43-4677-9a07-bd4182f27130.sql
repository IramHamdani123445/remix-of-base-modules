
CREATE OR REPLACE FUNCTION public.ce_legal_workbench_analytics(
  p_from date,
  p_to date,
  p_identities text[] DEFAULT NULL,
  p_scope_mine boolean DEFAULT false
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
  v_grain text := CASE WHEN v_days <= 45 THEN 'day' WHEN v_days <= 120 THEN 'week' ELSE 'month' END;
  v_ids text[] := COALESCE(p_identities, ARRAY[]::text[]);
  v_mine boolean := COALESCE(p_scope_mine, false);
  v_result jsonb;
BEGIN
  WITH
  cases AS (
    SELECT c.*,
           COALESCE(c.legacy_employer_name, c.legacy_primary_entity_name, c.employer_id::text) AS emp_name,
           COALESCE(c.opened_date, c.created_at::date) AS open_dt,
           (c.status_code = 'CLOSED' OR c.closed_date IS NOT NULL) AS is_closed
    FROM lg_case c
    WHERE NOT v_mine
       OR c.assigned_legal_officer_id::text = ANY(v_ids)
  ),
  open_cases AS (SELECT * FROM cases WHERE NOT is_closed),
  liab AS (
    SELECT l.lg_case_id,
           SUM(COALESCE(l.total_assessed,0)) AS assessed,
           SUM(COALESCE(l.paid,0)) AS paid,
           SUM(COALESCE(l.outstanding,0)) AS outstanding
    FROM lg_recoverable_liability l
    GROUP BY 1
  ),
  refs AS (SELECT * FROM ce_legal_referrals),
  recs AS (SELECT * FROM ce_legal_recommendations),
  hearings AS (
    SELECT h.*,
           COALESCE(h.scheduled_at::date, h.hearing_date) AS hdate
    FROM lg_hearing h
    WHERE NOT v_mine
       OR h.lg_case_id IN (SELECT id FROM cases)
  ),
  workflow AS (
    SELECT jsonb_agg(jsonb_build_object(
             'stage_code', stage_code, 'stage_name', stage_name, 'stage_order', stage_order,
             'delay_days', delay_days, 'requires_approval', requires_approval,
             'enabled', is_enabled, 'retired_at', retired_at
           ) ORDER BY stage_order) AS j
    FROM ce_escalation_stage_config
  ),
  kpi AS (
    SELECT
      (SELECT count(*) FROM recs WHERE status NOT IN ('APPROVED','REJECTED','CONVERTED','REFERRED','CANCELLED')) AS pending_recommendations,
      (SELECT count(*) FROM refs WHERE status = 'PENDING_APPROVAL' OR (approval_requested_at IS NOT NULL AND approved_at IS NULL AND status NOT IN ('REJECTED','ACCEPTED_BY_LEGAL'))) AS pending_referral_approval,
      (SELECT count(*) FROM refs WHERE status = 'SUBMITTED_TO_LEGAL') AS awaiting_legal_acceptance,
      (SELECT count(*) FROM lg_case_intake WHERE intake_status = 'PENDING_REVIEW') AS pending_legal_intake,
      (SELECT count(*) FROM open_cases) AS active_cases,
      (SELECT count(*) FROM open_cases WHERE next_action_due_date IS NOT NULL AND next_action_due_date < CURRENT_DATE) AS overdue_next_actions,
      (SELECT count(*) FROM lg_case_task t WHERE t.status NOT IN ('COMPLETED','CLOSED','CANCELLED') AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
         AND (NOT v_mine OR t.lg_case_id IN (SELECT id FROM cases))) AS overdue_tasks,
      (SELECT count(*) FROM hearings WHERE hdate BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND COALESCE(status,'SCHEDULED') NOT IN ('COMPLETED','CANCELLED')) AS hearings_30d,
      (SELECT count(*) FROM hearings WHERE hdate BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 AND COALESCE(status,'SCHEDULED') NOT IN ('COMPLETED','CANCELLED')) AS hearings_7d,
      (SELECT count(*) FROM hearings WHERE hdate = CURRENT_DATE AND COALESCE(status,'SCHEDULED') NOT IN ('COMPLETED','CANCELLED')) AS hearings_today,
      (SELECT count(*) FROM hearings WHERE hdate < CURRENT_DATE AND COALESCE(status,'SCHEDULED') NOT IN ('COMPLETED','CANCELLED')) AS hearings_overdue,
      (SELECT COALESCE(SUM(COALESCE(l.outstanding, 0)),0) FROM open_cases oc LEFT JOIN liab l ON l.lg_case_id = oc.id) AS amount_under_legal,
      (SELECT COALESCE(SUM(COALESCE(oc.claim_amount,0)),0) FROM open_cases oc) AS claim_amount_under_legal,
      (SELECT COALESCE(SUM(COALESCE(grand_total,0)),0) FROM refs WHERE status IN ('DRAFT','PENDING_APPROVAL','SUBMITTED_TO_LEGAL')) AS amount_pending_referral,
      (SELECT COALESCE(SUM(a.allocated_amount),0) FROM lg_payment_allocation a
         JOIN lg_recoverable_liability l ON l.id = a.liability_id
         WHERE COALESCE(a.payment_date, a.created_at::date) BETWEEN p_from AND p_to
           AND (NOT v_mine OR l.lg_case_id IN (SELECT id FROM cases))) AS recovered_period,
      (SELECT COALESCE(SUM(a.allocated_amount),0) FROM lg_payment_allocation a
         JOIN lg_recoverable_liability l ON l.id = a.liability_id
         WHERE COALESCE(a.payment_date, a.created_at::date) BETWEEN v_prev_from AND v_prev_to
           AND (NOT v_mine OR l.lg_case_id IN (SELECT id FROM cases))) AS recovered_prev,
      (SELECT count(*) FROM open_cases WHERE current_stage_code IN ('JUDGMENT','JUDGMENT_GRANTED','JUDGMENT_ISSUED','JUDGMENT_PENDING','CONSENT_ORDER')) AS awaiting_enforcement,
      (SELECT count(*) FROM refs WHERE COALESCE(submitted_date, created_at)::date BETWEEN p_from AND p_to) AS referrals_period,
      (SELECT count(*) FROM refs WHERE COALESCE(submitted_date, created_at)::date BETWEEN v_prev_from AND v_prev_to) AS referrals_prev,
      (SELECT count(*) FROM cases WHERE open_dt BETWEEN p_from AND p_to) AS cases_opened_period,
      (SELECT count(*) FROM cases WHERE open_dt BETWEEN v_prev_from AND v_prev_to) AS cases_opened_prev,
      (SELECT count(*) FROM cases WHERE is_closed AND COALESCE(closed_date, updated_at::date) BETWEEN p_from AND p_to) AS cases_closed_period,
      (SELECT count(*) FROM cases WHERE is_closed AND COALESCE(closed_date, updated_at::date) BETWEEN v_prev_from AND v_prev_to) AS cases_closed_prev
  ),
  buckets AS (
    SELECT generate_series(
             date_trunc(v_grain, p_from::timestamp),
             date_trunc(v_grain, p_to::timestamp),
             ('1 ' || v_grain)::interval
           )::date AS b
  ),
  trend AS (
    SELECT jsonb_agg(jsonb_build_object(
             'b', to_char(b.b, 'YYYY-MM-DD'),
             'referrals', (SELECT count(*) FROM refs r WHERE date_trunc(v_grain, COALESCE(r.submitted_date, r.created_at))::date = b.b AND COALESCE(r.submitted_date, r.created_at)::date BETWEEN p_from AND p_to),
             'opened', (SELECT count(*) FROM cases c WHERE date_trunc(v_grain, c.open_dt::timestamp)::date = b.b AND c.open_dt BETWEEN p_from AND p_to),
             'closed', (SELECT count(*) FROM cases c WHERE c.is_closed AND date_trunc(v_grain, COALESCE(c.closed_date, c.updated_at::date)::timestamp)::date = b.b AND COALESCE(c.closed_date, c.updated_at::date) BETWEEN p_from AND p_to)
           ) ORDER BY b.b) AS j
    FROM buckets b
  ),
  pipe_raw AS (
    SELECT 10 AS ord, 'COMPLIANCE' AS lane, 'RECOMMENDED' AS stage_code, 'Recommended for Legal' AS stage_name,
           count(*) AS cnt,
           AVG(EXTRACT(epoch FROM (now() - COALESCE(recommended_at, created_at)))/86400.0) AS avg_age,
           0::bigint AS overdue
    FROM recs WHERE status NOT IN ('APPROVED','REJECTED','CONVERTED','REFERRED','CANCELLED')
    UNION ALL
    SELECT 20, 'COMPLIANCE', 'AWAITING_APPROVAL', 'Awaiting Referral Approval', count(*),
           AVG(EXTRACT(epoch FROM (now() - COALESCE(approval_requested_at, created_at)))/86400.0), 0::bigint
    FROM refs WHERE status = 'PENDING_APPROVAL' OR (approval_requested_at IS NOT NULL AND approved_at IS NULL AND status NOT IN ('REJECTED','ACCEPTED_BY_LEGAL'))
    UNION ALL
    SELECT 30, 'COMPLIANCE', 'REFERRAL_PREPARED', 'Referral Prepared', count(*),
           AVG(EXTRACT(epoch FROM (now() - created_at))/86400.0), 0::bigint
    FROM refs WHERE status = 'DRAFT'
    UNION ALL
    SELECT 40, 'COMPLIANCE', 'SUBMITTED_TO_LEGAL', 'Awaiting Legal Acceptance', count(*),
           AVG(EXTRACT(epoch FROM (now() - COALESCE(submitted_date, created_at)))/86400.0), 0::bigint
    FROM refs WHERE status = 'SUBMITTED_TO_LEGAL'
    UNION ALL
    SELECT 50, 'LEGAL', 'LEGAL_INTAKE', 'Legal Intake Review', count(*),
           AVG(EXTRACT(epoch FROM (now() - COALESCE(submitted_at, created_at)))/86400.0), 0::bigint
    FROM lg_case_intake WHERE intake_status = 'PENDING_REVIEW'
    UNION ALL
    SELECT 60 + COALESCE(s.ord, 90), 'LEGAL', oc.current_stage_code,
           initcap(replace(oc.current_stage_code, '_', ' ')), count(*),
           AVG(EXTRACT(epoch FROM (now() - oc.open_dt::timestamp))/86400.0),
           count(*) FILTER (WHERE oc.next_action_due_date IS NOT NULL AND oc.next_action_due_date < CURRENT_DATE)
    FROM open_cases oc
    LEFT JOIN (VALUES
      ('REFERRAL_RECEIVED',1),('LEGAL_REVIEW',2),('INFORMATION_REQUESTED',3),('DEMAND_NOTICE',4),
      ('SETTLEMENT_NEGOTIATION',5),('PAYMENT_PLAN_NEGOTIATION',6),('CONSENT_ORDER',7),('COURT_PREPARATION',8),
      ('COURT_FILING',9),('HEARING_SCHEDULED',10),('HEARING',11),('HEARING_COMPLETED',12),
      ('JUDGMENT_PENDING',13),('JUDGMENT',14),('JUDGMENT_ISSUED',15),('JUDGMENT_GRANTED',16),
      ('ENFORCEMENT',17),('RECOVERY_MONITORING',18),('SATISFIED',19),('CLOSED',20)
    ) AS s(code, ord) ON s.code = oc.current_stage_code
    WHERE oc.current_stage_code IS NOT NULL
    GROUP BY oc.current_stage_code, s.ord
  ),
  pipeline AS (
    SELECT jsonb_agg(jsonb_build_object(
             'ord', ord, 'lane', lane, 'stage_code', stage_code, 'stage_name', stage_name,
             'count', cnt, 'avg_age_days', ROUND(COALESCE(avg_age,0)::numeric, 1), 'overdue', overdue
           ) ORDER BY ord) AS j
    FROM pipe_raw WHERE cnt > 0
  ),
  age_raw AS (
    SELECT CASE
             WHEN CURRENT_DATE - open_dt <= 30 THEN '0-30'
             WHEN CURRENT_DATE - open_dt <= 60 THEN '31-60'
             WHEN CURRENT_DATE - open_dt <= 90 THEN '61-90'
             WHEN CURRENT_DATE - open_dt <= 180 THEN '91-180'
             ELSE '180+' END AS bucket,
           CASE
             WHEN CURRENT_DATE - open_dt <= 30 THEN 1
             WHEN CURRENT_DATE - open_dt <= 60 THEN 2
             WHEN CURRENT_DATE - open_dt <= 90 THEN 3
             WHEN CURRENT_DATE - open_dt <= 180 THEN 4
             ELSE 5 END AS ord
    FROM open_cases WHERE open_dt IS NOT NULL
  ),
  ageing AS (
    SELECT jsonb_build_object(
      'buckets', COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'ord', ord, 'count', c) ORDER BY ord)
                  FROM (SELECT bucket, ord, count(*) c FROM age_raw GROUP BY 1,2) x), '[]'::jsonb),
      'avg_days', (SELECT ROUND(AVG(CURRENT_DATE - open_dt)::numeric,1) FROM open_cases WHERE open_dt IS NOT NULL),
      'median_days', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY (CURRENT_DATE - open_dt))::numeric,1) FROM open_cases WHERE open_dt IS NOT NULL),
      'oldest', (SELECT jsonb_build_object('case_no', lg_case_no, 'id', id, 'employer', emp_name, 'days', CURRENT_DATE - open_dt)
                 FROM open_cases WHERE open_dt IS NOT NULL ORDER BY open_dt ASC LIMIT 1)
    ) AS j
  ),
  timeliness AS (
    SELECT jsonb_build_object(
      'referral_to_acceptance_days', (SELECT ROUND(AVG(EXTRACT(epoch FROM (accepted_date - COALESCE(submitted_date, created_at)))/86400.0)::numeric,1)
                                      FROM refs WHERE accepted_date IS NOT NULL),
      'referral_to_acceptance_n', (SELECT count(*) FROM refs WHERE accepted_date IS NOT NULL),
      'intake_to_case_days', (SELECT ROUND(AVG(EXTRACT(epoch FROM (c.created_at - i.submitted_at))/86400.0)::numeric,1)
                              FROM lg_case_intake i JOIN cases c ON c.id = i.lg_case_id WHERE i.submitted_at IS NOT NULL),
      'intake_to_case_n', (SELECT count(*) FROM lg_case_intake i JOIN cases c ON c.id = i.lg_case_id WHERE i.submitted_at IS NOT NULL),
      'referral_to_filing_days', (SELECT ROUND(AVG(EXTRACT(epoch FROM (h.transitioned_at - c.created_at))/86400.0)::numeric,1)
                                  FROM lg_case_stage_history h JOIN cases c ON c.id = h.lg_case_id WHERE h.to_stage_code IN ('COURT_FILING','HEARING_SCHEDULED')),
      'referral_to_filing_n', (SELECT count(*) FROM lg_case_stage_history h JOIN cases c ON c.id = h.lg_case_id WHERE h.to_stage_code IN ('COURT_FILING','HEARING_SCHEDULED')),
      'past_next_action', (SELECT count(*) FROM open_cases WHERE next_action_due_date IS NOT NULL AND next_action_due_date < CURRENT_DATE),
      'no_next_action', (SELECT count(*) FROM open_cases WHERE next_action_due_date IS NULL),
      'stale_60d', (SELECT count(*) FROM open_cases WHERE updated_at < now() - interval '60 days'),
      'sla_rules_configured', (SELECT count(*) FROM legal_sla_rules WHERE COALESCE(is_active,true))
    ) AS j
  ),
  hweeks AS (
    SELECT generate_series(date_trunc('week', CURRENT_DATE::timestamp), date_trunc('week', CURRENT_DATE::timestamp) + interval '11 weeks', interval '1 week')::date AS w
  ),
  hearing_json AS (
    SELECT jsonb_build_object(
      'forecast', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'w', to_char(w, 'YYYY-MM-DD'),
            'count', (SELECT count(*) FROM hearings h WHERE h.hdate >= w AND h.hdate < w + 7 AND COALESCE(h.status,'SCHEDULED') NOT IN ('CANCELLED'))
          ) ORDER BY w) FROM hweeks), '[]'::jsonb),
      'upcoming', COALESCE((SELECT jsonb_agg(x) FROM (
            SELECT jsonb_build_object(
              'id', h.id, 'case_id', h.lg_case_id, 'case_no', c.lg_case_no,
              'employer', c.emp_name, 'court', COALESCE(h.court_name, c.court_name),
              'date', h.hdate, 'type', COALESCE(h.hearing_type_code, h.hearing_stage),
              'officer', COALESCE(h.lead_counsel_code, c.assigned_legal_officer_id::text),
              'documents_ready', h.documents_ready, 'evidence_status', h.evidence_status,
              'prep_completed', h.prep_completed
            ) AS x
            FROM hearings h LEFT JOIN cases c ON c.id = h.lg_case_id
            WHERE h.hdate >= CURRENT_DATE AND COALESCE(h.status,'SCHEDULED') NOT IN ('COMPLETED','CANCELLED')
            ORDER BY h.hdate ASC LIMIT 15) s), '[]'::jsonb),
      'past_due', COALESCE((SELECT jsonb_agg(x) FROM (
            SELECT jsonb_build_object('id', h.id, 'case_id', h.lg_case_id, 'case_no', c.lg_case_no,
                                      'employer', c.emp_name, 'date', h.hdate, 'court', COALESCE(h.court_name, c.court_name)) AS x
            FROM hearings h LEFT JOIN cases c ON c.id = h.lg_case_id
            WHERE h.hdate < CURRENT_DATE AND COALESCE(h.status,'SCHEDULED') NOT IN ('COMPLETED','CANCELLED')
            ORDER BY h.hdate DESC LIMIT 10) s2), '[]'::jsonb),
      'courts', COALESCE((SELECT jsonb_agg(jsonb_build_object('court', court, 'count', c) ORDER BY c DESC)
            FROM (SELECT COALESCE(court_name,'Unassigned') court, count(*) c FROM hearings WHERE hdate >= CURRENT_DATE GROUP BY 1) q), '[]'::jsonb)
    ) AS j
  ),
  outcomes AS (
    SELECT jsonb_build_object(
      'case_outcomes', COALESCE((SELECT jsonb_agg(jsonb_build_object('outcome', o, 'count', c) ORDER BY c DESC) FROM (
          SELECT COALESCE(closure_reason_code, closure_reason, current_stage_code, 'UNSPECIFIED') o, count(*) c
          FROM cases WHERE is_closed AND COALESCE(closed_date, updated_at::date) BETWEEN p_from AND p_to GROUP BY 1) q), '[]'::jsonb),
      'hearing_outcomes', COALESCE((SELECT jsonb_agg(jsonb_build_object('outcome', o, 'count', c) ORDER BY c DESC) FROM (
          SELECT COALESCE(outcome_code,'PENDING') o, count(*) c FROM hearings WHERE hdate BETWEEN p_from AND p_to GROUP BY 1) q2), '[]'::jsonb),
      'referral_quality', jsonb_build_object(
          'accepted', (SELECT count(*) FROM refs WHERE accepted_date IS NOT NULL),
          'returned', (SELECT count(*) FROM refs WHERE returned_at IS NOT NULL),
          'rejected', (SELECT count(*) FROM refs WHERE rejected_date IS NOT NULL),
          'in_flight', (SELECT count(*) FROM refs WHERE accepted_date IS NULL AND returned_at IS NULL AND rejected_date IS NULL)),
      'return_reasons', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', r, 'count', c) ORDER BY c DESC) FROM (
          SELECT COALESCE(NULLIF(return_reason,''), NULLIF(rejection_reason,''), 'Unspecified') r, count(*) c
          FROM refs WHERE returned_at IS NOT NULL OR rejected_date IS NOT NULL GROUP BY 1) q3), '[]'::jsonb)
    ) AS j
  ),
  recovery AS (
    SELECT jsonb_build_object(
      'assessed', (SELECT COALESCE(SUM(assessed),0) FROM liab WHERE lg_case_id IN (SELECT id FROM cases)),
      'paid', (SELECT COALESCE(SUM(paid),0) FROM liab WHERE lg_case_id IN (SELECT id FROM cases)),
      'outstanding', (SELECT COALESCE(SUM(outstanding),0) FROM liab WHERE lg_case_id IN (SELECT id FROM cases)),
      'allocations_period', (SELECT COALESCE(SUM(a.allocated_amount),0) FROM lg_payment_allocation a
          JOIN lg_recoverable_liability l ON l.id = a.liability_id
          WHERE COALESCE(a.payment_date, a.created_at::date) BETWEEN p_from AND p_to AND l.lg_case_id IN (SELECT id FROM cases)),
      'dated_allocations', (SELECT count(*) FROM lg_payment_allocation WHERE payment_date IS NOT NULL),
      'series', COALESCE((SELECT jsonb_agg(jsonb_build_object('b', to_char(b.b,'YYYY-MM-DD'),
            'recovered', (SELECT COALESCE(SUM(a.allocated_amount),0) FROM lg_payment_allocation a
                JOIN lg_recoverable_liability l ON l.id = a.liability_id
                WHERE date_trunc(v_grain, COALESCE(a.payment_date, a.created_at::date)::timestamp)::date = b.b
                  AND l.lg_case_id IN (SELECT id FROM cases)),
            'new_exposure', (SELECT COALESCE(SUM(COALESCE(l.total_assessed,0)),0) FROM lg_recoverable_liability l
                WHERE date_trunc(v_grain, l.created_at)::date = b.b AND l.lg_case_id IN (SELECT id FROM cases))
          ) ORDER BY b.b) FROM buckets b), '[]'::jsonb)
    ) AS j
  ),
  legal_arr AS (
    SELECT a.* FROM ce_payment_arrangements a
    WHERE a.id IN (SELECT payment_arrangement_id FROM lg_payment_arrangement_link WHERE payment_arrangement_id IS NOT NULL)
       OR a.case_id IN (SELECT compliance_case_id FROM cases WHERE compliance_case_id IS NOT NULL)
       OR a.case_id IN (SELECT id FROM ce_cases WHERE legal_case_id IS NOT NULL)
  ),
  arrangements AS (
    SELECT jsonb_build_object(
      'health', COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket', b, 'count', c) ORDER BY b) FROM (
          SELECT CASE
            WHEN status IN ('DEFAULTED','BREACHED') OR breach_detected THEN 'Defaulted'
            WHEN status = 'COMPLETED' THEN 'Completed'
            WHEN COALESCE(missed_payments,0) > 0 OR (next_due_date IS NOT NULL AND next_due_date < CURRENT_DATE) THEN 'At Risk'
            WHEN status = 'ACTIVE' THEN 'Current'
            ELSE 'Other' END b, count(*) c
          FROM legal_arr GROUP BY 1) q), '[]'::jsonb),
      'active', (SELECT count(*) FROM legal_arr WHERE status = 'ACTIVE'),
      'defaulted', (SELECT count(*) FROM legal_arr WHERE status IN ('DEFAULTED','BREACHED') OR breach_detected),
      'outstanding', (SELECT COALESCE(SUM(GREATEST(COALESCE(total_debt,0) - COALESCE(total_paid,0),0)),0) FROM legal_arr WHERE status IN ('ACTIVE','DEFAULTED','BREACHED')),
      'linked_via_registry', (SELECT count(*) FROM lg_payment_arrangement_link),
      'items', COALESCE((SELECT jsonb_agg(x) FROM (
          SELECT jsonb_build_object('id', id, 'number', arrangement_number, 'employer', employer_name,
                 'status', status, 'debt', total_debt, 'paid', total_paid, 'missed', missed_payments,
                 'next_due', next_due_date) AS x
          FROM legal_arr WHERE status IN ('DEFAULTED','BREACHED') OR breach_detected OR COALESCE(missed_payments,0) > 0
          ORDER BY COALESCE(total_debt,0) DESC LIMIT 8) s), '[]'::jsonb)
    ) AS j
  ),
  priority AS (
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) AS j FROM (
      SELECT jsonb_build_object(
        'case_id', oc.id, 'case_no', oc.lg_case_no, 'employer', oc.emp_name, 'employer_id', oc.employer_id,
        'priority', oc.priority_code, 'stage', oc.current_stage_code,
        'outstanding', COALESCE(l.outstanding, oc.claim_amount, 0),
        'age_days', CURRENT_DATE - oc.open_dt,
        'next_action', oc.next_action, 'next_action_due', oc.next_action_due_date,
        'overdue', (oc.next_action_due_date IS NOT NULL AND oc.next_action_due_date < CURRENT_DATE),
        'officer', oc.assigned_legal_officer_id
      ) AS x, COALESCE(l.outstanding, oc.claim_amount, 0) AS ord
      FROM open_cases oc LEFT JOIN liab l ON l.lg_case_id = oc.id
      ORDER BY ord DESC LIMIT 10
    ) s
  ),
  repeats AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'employer_id', employer_id, 'employer', employer_name, 'referrals', n,
             'accepted', acc, 'returned', ret, 'first_at', first_at, 'last_at', last_at) ORDER BY n DESC), '[]'::jsonb) AS j
    FROM (
      SELECT employer_id, MAX(employer_name) employer_name, count(*) n,
             count(*) FILTER (WHERE accepted_date IS NOT NULL) acc,
             count(*) FILTER (WHERE returned_at IS NOT NULL OR rejected_date IS NOT NULL) ret,
             MIN(created_at)::date first_at, MAX(created_at)::date last_at
      FROM refs WHERE employer_id IS NOT NULL GROUP BY employer_id HAVING count(*) > 1
      ORDER BY count(*) DESC LIMIT 10
    ) q
  ),
  attention AS (
    SELECT COALESCE(jsonb_agg(x ORDER BY prio, due NULLS LAST), '[]'::jsonb) AS j FROM (
      SELECT jsonb_build_object('kind','REFERRAL_APPROVAL','ref', referral_number,'ref_id', id,'employer', employer_name,
             'action','Referral awaiting approval','priority','High','due', NULL,
             'age_days', (CURRENT_DATE - COALESCE(approval_requested_at, created_at)::date), 'assigned', approval_requested_by,
             'link','/compliance/enforcement/legal-queue') AS x, 1 AS prio, NULL::date AS due
      FROM refs WHERE status = 'PENDING_APPROVAL'
      UNION ALL
      SELECT jsonb_build_object('kind','LEGAL_ACCEPTANCE','ref', referral_number,'ref_id', id,'employer', employer_name,
             'action','Awaiting Legal acceptance','priority','High','due', NULL,
             'age_days', (CURRENT_DATE - COALESCE(submitted_date, created_at)::date), 'assigned', legal_officer_assigned,
             'link','/compliance/enforcement/legal-queue'), 2, NULL::date
      FROM refs WHERE status = 'SUBMITTED_TO_LEGAL'
      UNION ALL
      SELECT jsonb_build_object('kind','RETURNED','ref', referral_number,'ref_id', id,'employer', employer_name,
             'action','Returned by Legal — response required','priority','Critical','due', NULL,
             'age_days', (CURRENT_DATE - COALESCE(returned_at, rejected_date, created_at)::date), 'assigned', created_by,
             'link','/compliance/legal/returned-from-legal'), 0, NULL::date
      FROM refs WHERE returned_at IS NOT NULL OR rejected_date IS NOT NULL
      UNION ALL
      SELECT jsonb_build_object('kind','NEXT_ACTION_OVERDUE','ref', lg_case_no,'ref_id', id,'employer', emp_name,
             'action', COALESCE(next_action,'Next legal action overdue'),'priority','Critical','due', next_action_due_date,
             'age_days', (CURRENT_DATE - next_action_due_date), 'assigned', assigned_legal_officer_id,
             'link','/compliance/enforcement/proceedings'), 0, next_action_due_date
      FROM open_cases WHERE next_action_due_date IS NOT NULL AND next_action_due_date < CURRENT_DATE
      UNION ALL
      SELECT jsonb_build_object('kind','HEARING_APPROACHING','ref', c.lg_case_no,'ref_id', h.lg_case_id,'employer', c.emp_name,
             'action','Hearing on ' || h.hdate,'priority','High','due', h.hdate,
             'age_days', NULL, 'assigned', c.assigned_legal_officer_id,
             'link','/compliance/enforcement/proceedings'), 1, h.hdate
      FROM hearings h LEFT JOIN cases c ON c.id = h.lg_case_id
      WHERE h.hdate BETWEEN CURRENT_DATE AND CURRENT_DATE + 14 AND COALESCE(h.status,'SCHEDULED') NOT IN ('COMPLETED','CANCELLED')
      UNION ALL
      SELECT jsonb_build_object('kind','ARRANGEMENT_DEFAULT','ref', arrangement_number,'ref_id', id,'employer', employer_name,
             'action','Legal settlement/arrangement in default','priority','Critical','due', next_due_date,
             'age_days', NULL, 'assigned', NULL,
             'link','/compliance/enforcement/breaches'), 0, next_due_date
      FROM legal_arr WHERE status IN ('DEFAULTED','BREACHED') OR breach_detected
      UNION ALL
      SELECT jsonb_build_object('kind','AWAITING_ENFORCEMENT','ref', lg_case_no,'ref_id', id,'employer', emp_name,
             'action','Judgment awaiting enforcement','priority','High','due', NULL,
             'age_days', (CURRENT_DATE - open_dt), 'assigned', assigned_legal_officer_id,
             'link','/compliance/enforcement/proceedings'), 2, NULL::date
      FROM open_cases WHERE current_stage_code IN ('JUDGMENT','JUDGMENT_GRANTED','JUDGMENT_ISSUED','JUDGMENT_PENDING','CONSENT_ORDER')
      LIMIT 60
    ) s
  ),
  off_cases AS (
    SELECT c.id, COALESCE(c.assigned_legal_officer_id::text, 'Unassigned') AS officer,
           c.is_closed, c.next_action_due_date, c.closed_date, c.updated_at
    FROM cases c
  ),
  off_hear AS (
    SELECT oc.officer, count(*) AS n
    FROM hearings h JOIN off_cases oc ON oc.id = h.lg_case_id
    WHERE h.hdate BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
    GROUP BY oc.officer
  ),
  officers AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'officer', officer, 'active', active_cases, 'overdue', overdue_actions,
             'hearings_30d', hearings30, 'closed_period', closed_period, 'outstanding', outstanding) ORDER BY active_cases DESC), '[]'::jsonb) AS j
    FROM (
      SELECT oc.officer,
             count(*) FILTER (WHERE NOT oc.is_closed) AS active_cases,
             count(*) FILTER (WHERE NOT oc.is_closed AND oc.next_action_due_date < CURRENT_DATE) AS overdue_actions,
             COALESCE(MAX(oh.n), 0) AS hearings30,
             count(*) FILTER (WHERE oc.is_closed AND COALESCE(oc.closed_date, oc.updated_at::date) BETWEEN p_from AND p_to) AS closed_period,
             COALESCE(SUM(l.outstanding) FILTER (WHERE NOT oc.is_closed), 0) AS outstanding
      FROM off_cases oc
      LEFT JOIN liab l ON l.lg_case_id = oc.id
      LEFT JOIN off_hear oh ON oh.officer = oc.officer
      GROUP BY oc.officer
    ) q
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'grain', v_grain,
    'scope', jsonb_build_object('mine', v_mine, 'identities', to_jsonb(v_ids)),
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to),
    'workflow', COALESCE((SELECT j FROM workflow), '[]'::jsonb),
    'kpis', (SELECT to_jsonb(k) FROM kpi k),
    'trend', COALESCE((SELECT j FROM trend), '[]'::jsonb),
    'pipeline', COALESCE((SELECT j FROM pipeline), '[]'::jsonb),
    'ageing', (SELECT j FROM ageing),
    'timeliness', (SELECT j FROM timeliness),
    'hearings', (SELECT j FROM hearing_json),
    'outcomes', (SELECT j FROM outcomes),
    'recovery', (SELECT j FROM recovery),
    'arrangements', (SELECT j FROM arrangements),
    'priority_matters', (SELECT j FROM priority),
    'repeats', (SELECT j FROM repeats),
    'attention', (SELECT j FROM attention),
    'officers', (SELECT j FROM officers)
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ce_legal_workbench_analytics(date, date, text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_legal_workbench_analytics(date, date, text[], boolean) TO authenticated, service_role;

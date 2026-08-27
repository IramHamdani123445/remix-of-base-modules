CREATE OR REPLACE FUNCTION public.ce_arrangement_grace_days()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT nullif(setting_value,'')::int FROM ce_settings
      WHERE setting_key = 'arrangement.grace_days_after_installment' LIMIT 1),
    (SELECT breach_grace_days FROM ce_arrangement_policies
      WHERE is_active AND policy_code = 'AP-STD-001' LIMIT 1),
    0);
$$;

CREATE OR REPLACE VIEW public.ce_v_arrangement_installment_operational AS
SELECT
  i.id                            AS installment_id,
  i.arrangement_id,
  a.arrangement_number,
  a.employer_id,
  a.employer_name,
  a.status                        AS arrangement_status,
  a.case_id,
  i.installment_number,
  i.due_date,
  i.amount                        AS scheduled_amount,
  coalesce(i.paid_amount,0)       AS paid_amount,
  greatest(coalesce(i.amount,0) - coalesce(i.paid_amount,0),0) AS outstanding_amount,
  i.paid_date,
  i.payment_reference,
  i.status                        AS stored_status,
  public.ce_arrangement_grace_days() AS grace_days,
  CASE
    WHEN i.status IN ('CANCELLED','WAIVED') THEN i.status
    WHEN coalesce(i.paid_amount,0) >= coalesce(i.amount,0) AND coalesce(i.amount,0) > 0 THEN 'PAID'
    WHEN i.due_date + public.ce_arrangement_grace_days() < current_date THEN 'OVERDUE'
    WHEN coalesce(i.paid_amount,0) > 0 THEN 'PARTIAL'
    ELSE 'PENDING'
  END                              AS effective_status,
  CASE WHEN i.due_date + public.ce_arrangement_grace_days() < current_date
         AND coalesce(i.paid_amount,0) < coalesce(i.amount,0)
       THEN current_date - (i.due_date + public.ce_arrangement_grace_days()) ELSE 0 END AS days_overdue,
  CASE WHEN i.due_date >= current_date THEN i.due_date - current_date ELSE NULL END AS days_until_due,
  (SELECT count(*) FROM core_payment_schedule_installment ci
     JOIN core_payment_allocation al ON al.installment_id = ci.id AND coalesce(al.is_reversed,false) = false
    WHERE ci.legacy_ce_installment_id = i.id)                       AS allocation_count,
  (SELECT coalesce(sum(al.allocation_amount),0) FROM core_payment_schedule_installment ci
     JOIN core_payment_allocation al ON al.installment_id = ci.id AND coalesce(al.is_reversed,false) = false
    WHERE ci.legacy_ce_installment_id = i.id AND al.allocated_to_item_id IS NOT NULL) AS allocated_amount,
  (SELECT coalesce(sum(al.allocation_amount),0) FROM core_payment_schedule_installment ci
     JOIN core_payment_allocation al ON al.installment_id = ci.id AND coalesce(al.is_reversed,false) = false
    WHERE ci.legacy_ce_installment_id = i.id AND al.allocated_to_item_id IS NULL)     AS unattributed_amount
FROM ce_installments i
JOIN ce_payment_arrangements a ON a.id = i.arrangement_id;

CREATE OR REPLACE VIEW public.ce_v_arrangement_register AS
WITH inst AS (
  SELECT arrangement_id,
         count(*)                                                        AS installments_total,
         count(*) FILTER (WHERE effective_status = 'PAID')               AS installments_paid_calc,
         count(*) FILTER (WHERE effective_status = 'PARTIAL')            AS installments_partial,
         count(*) FILTER (WHERE effective_status = 'OVERDUE')            AS overdue_count,
         coalesce(sum(outstanding_amount) FILTER (WHERE effective_status = 'OVERDUE'),0) AS past_due_amount,
         coalesce(sum(unattributed_amount),0)                            AS unattributed_amount
  FROM ce_v_arrangement_installment_operational GROUP BY arrangement_id
), nxt AS (
  SELECT DISTINCT ON (arrangement_id) arrangement_id, installment_number AS next_installment_number,
         due_date AS next_installment_due_date, outstanding_amount AS next_installment_amount
  FROM ce_v_arrangement_installment_operational
  WHERE effective_status IN ('PENDING','PARTIAL','OVERDUE')
  ORDER BY arrangement_id, due_date, installment_number
), br AS (
  SELECT arrangement_id, count(*) AS breach_count,
         count(*) FILTER (WHERE resolution IS NULL) AS unresolved_breach_count,
         max(detected_at) AS last_breach_at
  FROM ce_arrangement_breaches GROUP BY arrangement_id
), dflt AS (
  SELECT v.related_arrangement_id AS arrangement_id, min(v.id::text) AS violation_id,
         min(v.violation_number::text) AS violation_number
  FROM ce_violations v
  JOIN ce_violation_types t ON t.id = v.violation_type_id
  WHERE t.code = 'ARRANGEMENT_DEFAULT' AND v.related_arrangement_id IS NOT NULL
    AND coalesce(v.is_deleted,false) = false
  GROUP BY 1
)
SELECT
  a.id AS arrangement_id, a.arrangement_number, a.employer_id, a.employer_name,
  a.case_id, a.status, a.total_debt AS total_arranged, coalesce(a.total_paid,0) AS total_paid,
  greatest(coalesce(a.total_debt,0) - coalesce(a.total_paid,0),0) AS outstanding,
  a.installment_amount, a.number_of_installments, a.frequency, a.start_date, a.end_date,
  a.breach_detected, a.missed_payments, a.max_missed_before_breach, a.created_at,
  coalesce(i.installments_total,0)   AS installments_total,
  coalesce(i.installments_paid_calc,0) AS installments_paid,
  coalesce(i.installments_partial,0) AS installments_partial,
  coalesce(i.overdue_count,0)        AS overdue_count,
  coalesce(i.past_due_amount,0)      AS past_due_amount,
  coalesce(i.unattributed_amount,0)  AS unattributed_amount,
  n.next_installment_number, coalesce(n.next_installment_due_date, a.next_due_date) AS next_due_date,
  n.next_installment_amount,
  coalesce(b.breach_count,0) AS breach_count,
  coalesce(b.unresolved_breach_count,0) AS unresolved_breach_count,
  b.last_breach_at,
  h.health_status,
  d.violation_id AS arrangement_default_violation_id,
  d.violation_number AS arrangement_default_violation_number
FROM ce_payment_arrangements a
LEFT JOIN inst i ON i.arrangement_id = a.id
LEFT JOIN nxt  n ON n.arrangement_id = a.id
LEFT JOIN br   b ON b.arrangement_id = a.id
LEFT JOIN dflt d ON d.arrangement_id = a.id
LEFT JOIN ce_v_arrangement_health h ON h.arrangement_id = a.id;

CREATE OR REPLACE VIEW public.ce_v_arrangement_allocation_trail AS
SELECT
  al.id AS allocation_id, al.allocation_key, al.payment_date, al.receipt_id,
  al.amount_received, al.allocation_amount, al.allocation_order, al.allocation_policy,
  al.fund_type, al.is_reversed, al.reversed_at, al.reversal_reason, al.created_at,
  al.ledger_entry_id, l.posted_at AS ledger_posted_at, l.payment_reference AS ledger_payment_reference,
  l.credit_amount AS ledger_credit_amount, l.status AS ledger_status,
  ci.legacy_ce_installment_id AS installment_id, ci.installment_no AS installment_number,
  ci.due_date AS installment_due_date,
  ca.legacy_ce_arrangement_id AS arrangement_id, ca.arrangement_no AS arrangement_number,
  ca.debtor_id AS employer_id, ca.debtor_name AS employer_name,
  it.id AS item_id, it.liability_type, it.source_reference_no, it.period_from, it.period_to,
  (al.allocated_to_item_id IS NULL) AS is_unattributed
FROM core_payment_allocation al
LEFT JOIN core_payment_schedule_installment ci ON ci.id = al.installment_id
LEFT JOIN core_payment_arrangement ca ON ca.id = al.arrangement_id
LEFT JOIN core_payment_arrangement_item it ON it.id = al.allocated_to_item_id
LEFT JOIN ce_employer_financial_ledger l ON l.id = al.ledger_entry_id;

GRANT SELECT ON public.ce_v_arrangement_installment_operational TO authenticated, service_role;
GRANT SELECT ON public.ce_v_arrangement_register TO authenticated, service_role;
GRANT SELECT ON public.ce_v_arrangement_allocation_trail TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_arrangement_grace_days() TO authenticated, service_role;
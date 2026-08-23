CREATE OR REPLACE FUNCTION public.ce_employer_ledger_reconcile(p_employer_id character varying)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH rows_ AS (
    SELECT * FROM ce_employer_financial_ledger WHERE employer_id = p_employer_id
  ),
  derived AS (
    SELECT fund_type::text AS fund,
           COALESCE(SUM(debit_amount),0) d,
           COALESCE(SUM(credit_amount),0) c,
           COALESCE(SUM(debit_amount - credit_amount),0) bal
    FROM rows_ GROUP BY 1
  ),
  -- The terminal snapshot of each fund's chain: an entry whose running_balance
  -- is not the predecessor value of any other entry in the same fund.
  terminal AS (
    SELECT DISTINCT ON (l.fund_type) l.fund_type::text AS fund, l.running_balance
    FROM rows_ l
    WHERE NOT EXISTS (
      SELECT 1 FROM rows_ o
      WHERE o.fund_type = l.fund_type
        AND o.id <> l.id
        AND o.running_balance - (o.debit_amount - o.credit_amount) = l.running_balance
    )
    ORDER BY l.fund_type, l.posted_at DESC, l.id DESC
  ),
  fallback AS (
    SELECT DISTINCT ON (fund_type) fund_type::text AS fund, running_balance
    FROM rows_ ORDER BY fund_type, posted_at DESC, id DESC
  ),
  stored AS (
    SELECT f.fund, COALESCE(t.running_balance, f.running_balance) AS running_balance
    FROM fallback f LEFT JOIN terminal t ON t.fund = f.fund
  )
  SELECT jsonb_build_object(
    'employer_id', p_employer_id,
    'funds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'fund', d.fund,
        'total_debits', d.d,
        'total_credits', d.c,
        'derived_balance', d.bal,
        'stored_running_balance', s.running_balance,
        'variance', COALESCE(s.running_balance, 0) - d.bal,
        'reconciled', COALESCE(s.running_balance, 0) = d.bal
      ) ORDER BY d.fund) FROM derived d LEFT JOIN stored s ON s.fund = d.fund), '[]'::jsonb),
    'reconciled', NOT EXISTS (
      SELECT 1 FROM derived d LEFT JOIN stored s ON s.fund = d.fund
      WHERE COALESCE(s.running_balance,0) <> d.bal)
  );
$function$;
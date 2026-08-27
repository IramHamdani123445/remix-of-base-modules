DROP VIEW IF EXISTS public.ce_ledger_reversals_v;
DROP VIEW IF EXISTS public.ce_v_unobserved_payment_entries;

ALTER TABLE public.ce_employer_financial_ledger ALTER COLUMN posted_by TYPE varchar(100);
ALTER TABLE public.ce_ledger_periods ALTER COLUMN last_recalculated_by TYPE varchar(100);

CREATE VIEW public.ce_ledger_reversals_v AS
 SELECT r.id AS reversal_entry_id,
    r.employer_id,
    r.employer_name,
    r.entry_type AS reversal_entry_type,
    r.fund_type,
    r.period,
    r.debit_amount AS reversal_debit,
    r.credit_amount AS reversal_credit,
    r.description AS reversal_description,
    r.reversal_reason,
    r.posted_by AS reversed_by,
    r.posted_at AS reversed_at,
    o.id AS original_entry_id,
    o.entry_type AS original_entry_type,
    o.debit_amount AS original_debit,
    o.credit_amount AS original_credit,
    o.description AS original_description,
    o.posted_by AS original_posted_by,
    o.posted_at AS original_posted_at
   FROM ce_employer_financial_ledger r
     JOIN ce_employer_financial_ledger o ON r.reversal_of_id = o.id
  WHERE r.reversal_of_id IS NOT NULL;

CREATE VIEW public.ce_v_unobserved_payment_entries AS
 SELECT l.id AS ledger_entry_id,
    l.employer_id,
    l.employer_name,
    l.entry_type,
    l.fund_type,
    l.period,
    l.credit_amount,
    l.idempotency_key AS ledger_idempotency_key,
    l.reference_type,
    l.reference_id,
    l.description,
    l.posted_by,
    l.posted_at
   FROM ce_employer_financial_ledger l
     LEFT JOIN ce_payment_observation_log o ON o.ledger_entry_id = l.id
  WHERE (l.entry_type = ANY (ARRAY['PAYMENT_RECEIVED'::ce_ledger_entry_type, 'ARRANGEMENT_CREDIT'::ce_ledger_entry_type, 'REFUND'::ce_ledger_entry_type])) AND l.status = 'POSTED'::ce_ledger_status AND l.reversal_of_id IS NULL AND o.id IS NULL;

GRANT SELECT ON public.ce_ledger_reversals_v TO authenticated;
GRANT ALL ON public.ce_ledger_reversals_v TO service_role;
GRANT SELECT ON public.ce_v_unobserved_payment_entries TO authenticated;
GRANT ALL ON public.ce_v_unobserved_payment_entries TO service_role;
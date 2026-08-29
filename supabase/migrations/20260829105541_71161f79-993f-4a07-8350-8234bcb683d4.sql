CREATE OR REPLACE FUNCTION public.ce_recalculate_ledger_period_balances(
  p_employer_id character varying DEFAULT NULL,
  p_cause text DEFAULT 'CHECKPOINT-C-L1 balance derivation repair',
  p_dry_run boolean DEFAULT true,
  p_actor character varying DEFAULT 'SYSTEM'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_examined int := 0;
  v_drift int := 0;
  v_corrected int := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (
           WHERE lp.balance <> (lp.principal_due + lp.penalties + lp.interest
                                - lp.payments - lp.waivers + lp.adjustments - lp.write_offs))
    INTO v_examined, v_drift
  FROM ce_ledger_periods lp
  WHERE p_employer_id IS NULL OR lp.employer_id = p_employer_id;

  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT lp.employer_id, lp.period, lp.fund_type::text AS fund,
           lp.balance AS stored_balance,
           (lp.principal_due + lp.penalties + lp.interest - lp.payments
            - lp.waivers + lp.adjustments - lp.write_offs) AS derived_balance,
           (lp.principal_due + lp.penalties + lp.interest - lp.payments
            - lp.waivers + lp.adjustments - lp.write_offs) - lp.balance AS difference,
           v.principal_outstanding, v.total_outstanding
    FROM ce_ledger_periods lp
    LEFT JOIN ce_v_ledger_period_balances v
      ON v.employer_id = lp.employer_id AND v.period = lp.period AND v.fund_type = lp.fund_type
    WHERE (p_employer_id IS NULL OR lp.employer_id = p_employer_id)
      AND lp.balance <> (lp.principal_due + lp.penalties + lp.interest - lp.payments
                         - lp.waivers + lp.adjustments - lp.write_offs)
    ORDER BY lp.employer_id, lp.period
    LIMIT 50
  ) s;

  IF NOT p_dry_run THEN
    INSERT INTO ce_ledger_balance_reconciliation_log (
      run_id, employer_id, period, fund_type, balance_before, balance_after,
      components_before, components_after, cause, reconciled_by)
    SELECT v_run_id, lp.employer_id, lp.period, lp.fund_type, lp.balance,
           (lp.principal_due + lp.penalties + lp.interest - lp.payments
            - lp.waivers + lp.adjustments - lp.write_offs),
           jsonb_build_object('principal_due', lp.principal_due, 'penalties', lp.penalties,
                              'interest', lp.interest, 'payments', lp.payments,
                              'waivers', lp.waivers, 'adjustments', lp.adjustments,
                              'write_offs', lp.write_offs, 'balance', lp.balance),
           jsonb_build_object('balance', (lp.principal_due + lp.penalties + lp.interest
                                          - lp.payments - lp.waivers + lp.adjustments - lp.write_offs),
                              'principal_outstanding', v.principal_outstanding,
                              'total_outstanding', v.total_outstanding),
           p_cause, p_actor
    FROM ce_ledger_periods lp
    LEFT JOIN ce_v_ledger_period_balances v
      ON v.employer_id = lp.employer_id AND v.period = lp.period AND v.fund_type = lp.fund_type
    WHERE (p_employer_id IS NULL OR lp.employer_id = p_employer_id)
      AND lp.balance <> (lp.principal_due + lp.penalties + lp.interest - lp.payments
                         - lp.waivers + lp.adjustments - lp.write_offs);

    UPDATE ce_ledger_periods lp
    SET balance = (lp.principal_due + lp.penalties + lp.interest - lp.payments
                   - lp.waivers + lp.adjustments - lp.write_offs),
        last_recalculated_at = now(),
        last_recalculated_by = p_actor
    WHERE (p_employer_id IS NULL OR lp.employer_id = p_employer_id)
      AND lp.balance <> (lp.principal_due + lp.penalties + lp.interest - lp.payments
                         - lp.waivers + lp.adjustments - lp.write_offs);

    GET DIAGNOSTICS v_corrected = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'dry_run', p_dry_run, 'examined', v_examined,
    'drifted', v_drift, 'corrected', v_corrected, 'sample', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_recalculate_ledger_period_balances(character varying, text, boolean, character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_recalculate_ledger_period_balances(character varying, text, boolean, character varying) TO service_role;
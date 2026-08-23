CREATE OR REPLACE FUNCTION public.ce_e2e__mk_arrangement(
  p_key text, p_emp varchar, p_empname text, p_arrno varchar,
  p_amounts numeric[], p_offsets int[], p_actor text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := md5('E2E-ARR:'||p_key)::uuid; i int; v_total numeric := 0;
BEGIN
  INSERT INTO er_master(regno, name) VALUES (p_emp, p_empname) ON CONFLICT (regno) DO NOTHING;
  SELECT coalesce(sum(x),0) INTO v_total FROM unnest(p_amounts) x;

  INSERT INTO ce_payment_arrangements (
    id, arrangement_number, employer_id, employer_name, status, total_debt,
    down_payment, installment_amount, number_of_installments, frequency,
    start_date, end_date, total_paid, installments_paid, next_due_date,
    max_missed_before_breach, terms_text, created_by, updated_by)
  VALUES (
    v_id, p_arrno, p_emp, p_empname, 'DRAFT', v_total,
    0, p_amounts[1], array_length(p_amounts,1), 'MONTHLY',
    CURRENT_DATE + p_offsets[1], CURRENT_DATE + p_offsets[array_length(p_offsets,1)],
    0, 0, CURRENT_DATE + p_offsets[1], 2,
    'E2E fixture arrangement (test data)', p_actor, p_actor)
  ON CONFLICT (id) DO NOTHING;

  FOR i IN 1..array_length(p_amounts,1) LOOP
    INSERT INTO ce_installments (id, arrangement_id, installment_number, due_date, amount, paid_amount, status)
    VALUES (md5('E2E-INST:'||p_key||':'||i)::uuid, v_id, i, CURRENT_DATE + p_offsets[i], p_amounts[i], 0, 'PENDING')
    ON CONFLICT (arrangement_id, installment_number) DO NOTHING;
  END LOOP;

  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.ce_e2e__activate(p_arr_id uuid, p_items jsonb, p_actor text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_core uuid; v_status text; it jsonb; v_n int;
BEGIN
  SELECT id, status INTO v_core, v_status FROM core_payment_arrangement WHERE legacy_ce_arrangement_id = p_arr_id;
  IF v_core IS NULL THEN RETURN; END IF;

  IF v_status = 'DRAFT' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      SELECT count(*) INTO v_n FROM core_payment_arrangement_item
       WHERE arrangement_id = v_core AND liability_type = (it->>'t') AND status <> 'CANCELLED';
      IF v_n = 0 THEN
        PERFORM core_arrangement_add_item(
          v_core, it->>'t', (it->>'a')::numeric, 'COMPLIANCE', 'CASE',
          'E2E-'||(it->>'t'), 'E2E-REF-'||(it->>'t'), NULL, NULL, NULL, NULL, NULL, p_actor);
      END IF;
    END LOOP;
    PERFORM core_arrangement_set_status(v_core, 'ACTIVE', p_actor);
  END IF;

  UPDATE ce_payment_arrangements
     SET status = 'ACTIVE', approved_by = coalesce(approved_by, p_actor),
         approved_at = coalesce(approved_at, now()), updated_by = p_actor, updated_at = now()
   WHERE id = p_arr_id AND status = 'DRAFT';
END; $$;

CREATE OR REPLACE FUNCTION public.ce_e2e__pay(
  p_arr_id uuid, p_emp varchar, p_empname text, p_fund ce_fund_type,
  p_amount numeric, p_key text, p_actor text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_led uuid;
BEGIN
  SELECT id INTO v_led FROM ce_employer_financial_ledger WHERE idempotency_key = p_key;
  IF v_led IS NULL THEN
    v_led := ce_post_ledger_entry(
      p_emp, p_empname::varchar, NULL, 'PAYMENT_RECEIVED'::ce_ledger_entry_type, p_fund,
      to_char(CURRENT_DATE, 'YYYY-MM'), p_amount, 'E2E fixture payment',
      'PAYMENT_ARRANGEMENT', p_arr_id, p_key::varchar, p_actor::varchar);
  END IF;
  PERFORM ce_reconcile_ledger_payment_to_arrangement(v_led, p_actor::varchar);
  RETURN v_led;
END; $$;

CREATE OR REPLACE FUNCTION public.ce_e2e_provision_payment_arrangement_fixtures(p_actor text DEFAULT 'E2EFIX')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a_healthy uuid; a_partial uuid; a_multi uuid; a_complete uuid;
  a_default uuid; a_cured uuid; a_con1 uuid; a_con2 uuid;
  v_type uuid; v_det jsonb;
BEGIN
  a_healthy  := ce_e2e__mk_arrangement('HEALTHY','E2EPAH','E2E Healthy Employer Ltd','E2E-PA-HEALTHY',
                  ARRAY[300,300,300,300]::numeric[], ARRAY[-30,1,31,61], p_actor);
  a_partial  := ce_e2e__mk_arrangement('PARTIAL','E2EPAP','E2E Partial Employer Ltd','E2E-PA-PARTIAL',
                  ARRAY[500,500]::numeric[], ARRAY[10,40], p_actor);
  a_multi    := ce_e2e__mk_arrangement('MULTIFUND','E2EPAM','E2E Multi Fund Employer Ltd','E2E-PA-MULTIFUND',
                  ARRAY[400,400]::numeric[], ARRAY[10,40], p_actor);
  a_complete := ce_e2e__mk_arrangement('COMPLETE','E2EPAC','E2E Completed Employer Ltd','E2E-PA-COMPLETE',
                  ARRAY[300,300]::numeric[], ARRAY[-60,-30], p_actor);
  a_default  := ce_e2e__mk_arrangement('DEFAULT','E2EPAD','E2E Defaulted Employer Ltd','E2E-PA-DEFAULT',
                  ARRAY[400,400,400]::numeric[], ARRAY[-90,-60,-30], p_actor);
  a_cured    := ce_e2e__mk_arrangement('CURED','E2EPAU','E2E Cured Employer Ltd','E2E-PA-CURED',
                  ARRAY[250,250]::numeric[], ARRAY[-60,-30], p_actor);
  a_con1     := ce_e2e__mk_arrangement('CONCUR1','E2EPAN','E2E Concurrent Employer Ltd','E2E-PA-CONCUR-1',
                  ARRAY[200,200]::numeric[], ARRAY[15,45], p_actor);
  a_con2     := ce_e2e__mk_arrangement('CONCUR2','E2EPAN','E2E Concurrent Employer Ltd','E2E-PA-CONCUR-2',
                  ARRAY[150,150]::numeric[], ARRAY[20,50], p_actor);

  PERFORM core_backfill_ce_arrangements(p_actor, false);

  PERFORM ce_e2e__activate(a_healthy,  '[{"t":"SS","a":1200}]'::jsonb, p_actor);
  PERFORM ce_e2e__activate(a_partial,  '[{"t":"SS","a":1000}]'::jsonb, p_actor);
  PERFORM ce_e2e__activate(a_multi,    '[{"t":"SS","a":600},{"t":"LV","a":200}]'::jsonb, p_actor);
  PERFORM ce_e2e__activate(a_complete, '[{"t":"SS","a":600}]'::jsonb, p_actor);
  PERFORM ce_e2e__activate(a_default,  '[{"t":"SS","a":1200}]'::jsonb, p_actor);
  PERFORM ce_e2e__activate(a_cured,    '[{"t":"SS","a":500}]'::jsonb, p_actor);
  PERFORM ce_e2e__activate(a_con1,     '[{"t":"SS","a":400}]'::jsonb, p_actor);
  PERFORM ce_e2e__activate(a_con2,     '[{"t":"SS","a":300}]'::jsonb, p_actor);

  PERFORM ce_e2e__pay(a_healthy,  'E2EPAH','E2E Healthy Employer Ltd','SS'::ce_fund_type, 300, 'E2E-PAY-HEALTHY-1', p_actor);
  PERFORM ce_e2e__pay(a_partial,  'E2EPAP','E2E Partial Employer Ltd','SS'::ce_fund_type, 300, 'E2E-PAY-PARTIAL-1', p_actor);
  PERFORM ce_e2e__pay(a_multi,    'E2EPAM','E2E Multi Fund Employer Ltd','SS'::ce_fund_type, 700, 'E2E-PAY-MULTI-1', p_actor);
  PERFORM ce_e2e__pay(a_complete, 'E2EPAC','E2E Completed Employer Ltd','SS'::ce_fund_type, 600, 'E2E-PAY-COMPLETE-1', p_actor);

  v_det := ce_detect_arrangement_breaches(p_actor);

  PERFORM ce_e2e__pay(a_cured, 'E2EPAU','E2E Cured Employer Ltd','SS'::ce_fund_type, 500, 'E2E-PAY-CURED-1', p_actor);
  v_det := ce_detect_arrangement_breaches(p_actor);

  SELECT id INTO v_type FROM ce_violation_types WHERE code = 'ARRANGEMENT_DEFAULT';
  IF v_type IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ce_violations WHERE violation_number = 'E2E-VIO-ARR-DEFAULT-1') THEN
    INSERT INTO ce_violations (
      id, violation_number, employer_id, employer_name, violation_type_id, fund_type,
      status, priority, severity, summary, description, principal_amount, total_amount,
      source_type, discovered_date, discovered_by, related_arrangement_id,
      is_merged, is_deleted, created_by, created_at)
    VALUES (
      md5('E2E-VIO:ARR-DEFAULT-1')::uuid, 'E2E-VIO-ARR-DEFAULT-1', 'E2EPAD', 'E2E Defaulted Employer Ltd',
      v_type, 'SS', 'OPEN', 'HIGH', 'HIGH',
      'Payment arrangement E2E-PA-DEFAULT in default (3 missed installments)',
      'E2E fixture: arrangement defaulted after consecutive missed installments.',
      1200, 1200, 'SYSTEM', CURRENT_DATE, p_actor, a_default, false, false, p_actor, now());
  END IF;

  RETURN jsonb_build_object(
    'healthy', a_healthy, 'partial', a_partial, 'multifund', a_multi,
    'completed', a_complete, 'defaulted', a_default, 'cured', a_cured,
    'concurrent_1', a_con1, 'concurrent_2', a_con2, 'detection', v_det);
END; $$;

REVOKE ALL ON FUNCTION public.ce_e2e_provision_payment_arrangement_fixtures(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_e2e_provision_payment_arrangement_fixtures(text) TO service_role;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT l.id FROM ce_employer_financial_ledger l
    WHERE l.employer_id = 'ZZ-TEST-EMP'
      AND l.status = 'POSTED'
      AND l.entry_type = 'PAYMENT_RECEIVED'
      AND l.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM ce_employer_financial_ledger x WHERE x.reversal_of_id = l.id)
  LOOP
    PERFORM ce_reverse_ledger_entry(r.id, 'Orphaned synthetic test payment; arrangement no longer exists', 'E2ECLEAN');
  END LOOP;
END $$;

SELECT public.ce_e2e_provision_payment_arrangement_fixtures('E2EFIX');
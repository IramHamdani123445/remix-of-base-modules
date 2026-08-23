CREATE OR REPLACE VIEW public.ce_v_arrangement_health AS
SELECT pa.id AS arrangement_id,
       pa.employer_id,
       regexp_replace(pa.employer_id::text, '^EMP-'::text, ''::text) AS regno,
       pa.employer_name,
       pa.status,
       pa.total_debt,
       pa.total_paid,
       pa.installments_paid,
       pa.missed_payments,
       pa.max_missed_before_breach,
       pa.breach_detected,
       pa.next_due_date,
       COALESCE(ub.unresolved_breach_count, 0::bigint) AS unresolved_breach_count,
       CASE
         WHEN upper(pa.status::text) = 'BREACHED' THEN 'BREACHED'
         WHEN upper(pa.status::text) IN ('DRAFT','PENDING_APPROVAL','CANCELLED','TERMINATED','COMPLETED') THEN 'INACTIVE'
         WHEN COALESCE(ub.unresolved_breach_count,0) > 0
              OR COALESCE(ov.overdue_count,0) >= COALESCE(pa.max_missed_before_breach, 3) THEN 'AT_RISK'
         WHEN COALESCE(ov.overdue_count,0) > 0 THEN 'WARNING'
         WHEN upper(pa.status::text) = 'ACTIVE' THEN 'HEALTHY'
         ELSE 'INACTIVE'
       END AS health_status,
       COALESCE(ov.overdue_count, 0::bigint) AS overdue_installment_count
FROM public.ce_payment_arrangements pa
LEFT JOIN (
  SELECT arrangement_id, count(*) AS unresolved_breach_count
  FROM public.ce_arrangement_breaches
  WHERE resolved_at IS NULL
  GROUP BY arrangement_id
) ub ON ub.arrangement_id = pa.id
LEFT JOIN (
  SELECT arrangement_id, count(*) AS overdue_count
  FROM public.ce_v_arrangement_installment_operational
  WHERE effective_status::text = 'OVERDUE'
  GROUP BY arrangement_id
) ov ON ov.arrangement_id = pa.id;

CREATE OR REPLACE FUNCTION public.ce_detect_arrangement_breaches(p_actor text DEFAULT 'SYSTEM')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace int := public.ce_arrangement_grace_days();
  a RECORD; r RECORD;
  v_key text; v_overdue int; v_new int := 0; v_resolved_total int := 0; v_marked int := 0;
  v_max_missed int;
BEGIN
  FOR a IN SELECT * FROM public.ce_payment_arrangements WHERE status = 'ACTIVE' LOOP
    v_max_missed := COALESCE(a.max_missed_before_breach, 2);
    v_overdue := 0;

    FOR r IN
      SELECT * FROM public.ce_installments WHERE arrangement_id = a.id ORDER BY installment_number
    LOOP
      IF r.due_date + v_grace < CURRENT_DATE
         AND COALESCE(r.paid_amount,0) < r.amount
         AND COALESCE(r.status,'PENDING') NOT IN ('PAID','CANCELLED','WAIVED') THEN
        v_overdue := v_overdue + 1;

        UPDATE public.ce_installments
        SET status = CASE WHEN COALESCE(paid_amount,0) > 0 THEN 'PARTIAL' ELSE 'OVERDUE' END,
            is_overdue = true,
            overdue_days = GREATEST(0, CURRENT_DATE - due_date)
        WHERE id = r.id;
        v_marked := v_marked + 1;

        v_key := 'ARR:' || a.id::text || ':INST:' || r.id::text || ':MISSED_INSTALLMENT';
        INSERT INTO public.ce_arrangement_breaches (
          arrangement_id, breach_type, description, detected_by, created_by,
          installment_id, installment_number, due_date_at_breach,
          amount_outstanding_at_breach, grace_days_at_breach, occurrence_key
        ) VALUES (
          a.id, 'MISSED_INSTALLMENT',
          format('Installment %s due %s unpaid beyond %s grace day(s)', r.installment_number, r.due_date, v_grace),
          p_actor, p_actor, r.id, r.installment_number, r.due_date,
          r.amount - COALESCE(r.paid_amount,0), v_grace, v_key
        )
        ON CONFLICT (occurrence_key) WHERE occurrence_key IS NOT NULL DO NOTHING;
        IF FOUND THEN v_new := v_new + 1; END IF;
      END IF;
    END LOOP;

    IF v_overdue >= v_max_missed THEN
      UPDATE public.ce_payment_arrangements
      SET breach_detected = true,
          breach_date = COALESCE(breach_date, CURRENT_DATE),
          breach_reason = format('%s overdue installment(s)', v_overdue),
          missed_payments = v_overdue,
          updated_by = p_actor,
          updated_at = now()
      WHERE id = a.id;
    END IF;
  END LOOP;

  UPDATE public.ce_arrangement_breaches b
  SET resolution = 'CURED',
      resolved_at = now(),
      resolved_by = p_actor,
      resolution_notes = COALESCE(b.resolution_notes, 'Installment settled after breach'),
      updated_by = p_actor
  FROM public.ce_installments ci
  WHERE b.installment_id = ci.id
    AND b.resolution IS NULL
    AND (ci.status = 'PAID' OR COALESCE(ci.paid_amount,0) >= ci.amount);

  SELECT count(*) INTO v_resolved_total
  FROM public.ce_arrangement_breaches WHERE resolution IS NOT NULL;

  RETURN jsonb_build_object(
    'grace_days', v_grace,
    'new_occurrences', v_new,
    'installments_marked', v_marked,
    'resolved_total', v_resolved_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ce_detect_arrangement_breaches(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_detect_arrangement_breaches(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_detect_arrangement_breaches(text) TO service_role;

REVOKE ALL ON FUNCTION public.ce_e2e__mk_arrangement(text, varchar, text, varchar, numeric[], int[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_e2e__activate(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_e2e__pay(uuid, varchar, text, ce_fund_type, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_e2e_provision_payment_arrangement_fixtures(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_e2e__mk_arrangement(text, varchar, text, varchar, numeric[], int[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ce_e2e__activate(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ce_e2e__pay(uuid, varchar, text, ce_fund_type, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ce_e2e_provision_payment_arrangement_fixtures(text) TO service_role;

SELECT public.ce_detect_arrangement_breaches('E2EFIX');
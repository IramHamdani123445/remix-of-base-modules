ALTER TABLE public.ce_arrangement_breaches
  ADD COLUMN IF NOT EXISTS installment_id uuid REFERENCES public.ce_installments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installment_number integer,
  ADD COLUMN IF NOT EXISTS due_date_at_breach date,
  ADD COLUMN IF NOT EXISTS amount_outstanding_at_breach numeric(15,2),
  ADD COLUMN IF NOT EXISTS grace_days_at_breach integer,
  ADD COLUMN IF NOT EXISTS occurrence_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ce_arrangement_breaches_occurrence
  ON public.ce_arrangement_breaches (occurrence_key)
  WHERE occurrence_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ce_arrangement_breaches_installment
  ON public.ce_arrangement_breaches (installment_id);

CREATE OR REPLACE VIEW public.ce_v_arrangement_breach_occurrence AS
SELECT b.id AS breach_id,
       b.arrangement_id,
       a.arrangement_number,
       a.employer_id,
       a.employer_name,
       a.status AS arrangement_status,
       b.breach_type,
       b.description,
       b.detected_at,
       b.detected_by,
       b.resolution,
       b.resolved_at,
       b.resolved_by,
       b.resolution_notes,
       (b.resolution IS NOT NULL) AS is_cured,
       b.installment_id,
       COALESCE(b.installment_number, i.installment_number) AS installment_number,
       COALESCE(b.due_date_at_breach, i.due_date) AS due_date,
       b.amount_outstanding_at_breach,
       b.grace_days_at_breach,
       i.amount AS installment_amount,
       COALESCE(i.paid_amount, 0) AS installment_paid_amount,
       i.status AS installment_status,
       b.occurrence_key
FROM public.ce_arrangement_breaches b
LEFT JOIN public.ce_payment_arrangements a ON a.id = b.arrangement_id
LEFT JOIN public.ce_installments i ON i.id = b.installment_id;

GRANT SELECT ON public.ce_v_arrangement_breach_occurrence TO authenticated;
GRANT SELECT ON public.ce_v_arrangement_breach_occurrence TO service_role;

CREATE OR REPLACE FUNCTION public.ce_detect_arrangement_breaches(p_actor text DEFAULT 'SYSTEM')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace int := public.ce_arrangement_grace_days();
  a RECORD; r RECORD;
  v_key text; v_overdue int; v_new int := 0; v_cured_total int := 0; v_marked int := 0;
  v_max_missed int;
BEGIN
  FOR a IN SELECT * FROM public.ce_payment_arrangements WHERE status = 'ACTIVE' LOOP
    v_max_missed := COALESCE(a.max_missed_before_breach, 2);
    v_overdue := 0;

    FOR r IN
      SELECT * FROM public.ce_installments
      WHERE arrangement_id = a.id
      ORDER BY installment_number
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

    UPDATE public.ce_arrangement_breaches b
    SET resolution = 'CURED',
        resolved_at = now(),
        resolved_by = p_actor,
        resolution_notes = COALESCE(b.resolution_notes, 'Installment settled after breach'),
        updated_by = p_actor
    FROM public.ce_installments ci
    WHERE b.installment_id = ci.id
      AND b.arrangement_id = a.id
      AND b.resolution IS NULL
      AND (ci.status = 'PAID' OR COALESCE(ci.paid_amount,0) >= ci.amount);

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

  SELECT count(*) INTO v_cured_total
  FROM public.ce_arrangement_breaches WHERE resolution IS NOT NULL;

  RETURN jsonb_build_object(
    'grace_days', v_grace,
    'new_occurrences', v_new,
    'installments_marked', v_marked,
    'resolved_total', v_cured_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ce_detect_arrangement_breaches(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_detect_arrangement_breaches(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_detect_arrangement_breaches(text) TO service_role;
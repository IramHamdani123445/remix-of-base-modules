-- ============================================================
-- Canonical Payment Arrangement bridge — additive + idempotent
-- ============================================================

ALTER TABLE public.core_payment_arrangement
  ADD COLUMN IF NOT EXISTS coverage_status text,
  ADD COLUMN IF NOT EXISTS coverage_notes text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cpa_legacy_ce_arrangement
  ON public.core_payment_arrangement (legacy_ce_arrangement_id)
  WHERE legacy_ce_arrangement_id IS NOT NULL;

ALTER TABLE public.core_payment_schedule_installment
  ADD COLUMN IF NOT EXISTS legacy_ce_installment_id uuid,
  ADD COLUMN IF NOT EXISTS legacy_source_system text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cpsi_legacy_ce_installment
  ON public.core_payment_schedule_installment (legacy_ce_installment_id)
  WHERE legacy_ce_installment_id IS NOT NULL;

ALTER TABLE public.core_payment_arrangement_item
  ADD COLUMN IF NOT EXISTS coverage_confidence text,
  ADD COLUMN IF NOT EXISTS coverage_evidence jsonb,
  ADD COLUMN IF NOT EXISTS reconstruction_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cpai_reconstruction_key
  ON public.core_payment_arrangement_item (reconstruction_key)
  WHERE reconstruction_key IS NOT NULL;

ALTER TABLE public.core_payment_allocation
  ADD COLUMN IF NOT EXISTS ledger_entry_id uuid,
  ADD COLUMN IF NOT EXISTS allocation_key text,
  ADD COLUMN IF NOT EXISTS fund_type text,
  ADD COLUMN IF NOT EXISTS allocation_policy text,
  ADD COLUMN IF NOT EXISTS is_reversed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cpalloc_allocation_key
  ON public.core_payment_allocation (allocation_key)
  WHERE allocation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_cpalloc_ledger ON public.core_payment_allocation (ledger_entry_id);
CREATE INDEX IF NOT EXISTS ix_cpalloc_installment ON public.core_payment_allocation (installment_id);
CREATE INDEX IF NOT EXISTS ix_cpai_arrangement ON public.core_payment_arrangement_item (arrangement_id);

GRANT SELECT ON public.core_payment_arrangement, public.core_payment_arrangement_item,
  public.core_payment_schedule_installment, public.core_payment_allocation TO authenticated;
GRANT ALL ON public.core_payment_arrangement, public.core_payment_arrangement_item,
  public.core_payment_schedule_installment, public.core_payment_allocation TO service_role;

CREATE OR REPLACE FUNCTION public.core_map_ce_arrangement_status(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $fn$
  SELECT CASE upper(coalesce(p_status,''))
    WHEN 'ACTIVE' THEN 'ACTIVE'
    WHEN 'DRAFT' THEN 'DRAFT'
    WHEN 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL'
    WHEN 'APPROVED' THEN 'ACTIVE'
    WHEN 'BREACHED' THEN 'DEFAULTED'
    WHEN 'DEFAULTED' THEN 'DEFAULTED'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'TERMINATED' THEN 'CANCELLED'
    ELSE 'DRAFT'
  END
$fn$;

CREATE OR REPLACE FUNCTION public.core_map_ce_installment_status(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $fn$
  SELECT CASE upper(coalesce(p_status,''))
    WHEN 'PLANNED' THEN 'PLANNED'
    WHEN 'PENDING' THEN 'DUE'
    WHEN 'DUE' THEN 'DUE'
    WHEN 'PARTIAL' THEN 'PARTIAL'
    WHEN 'PAID' THEN 'PAID'
    WHEN 'OVERDUE' THEN 'MISSED'
    WHEN 'MISSED' THEN 'MISSED'
    WHEN 'DEFAULTED' THEN 'DEFAULTED'
    WHEN 'WAIVED' THEN 'WAIVED'
    ELSE 'PLANNED'
  END
$fn$;

CREATE OR REPLACE FUNCTION public.core_backfill_ce_arrangements(
  p_actor text DEFAULT 'SYSTEM',
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  a RECORD;
  v_core_id uuid;
  v_case RECORD;
  v_coverage text;
  v_arr_created int := 0;
  v_arr_updated int := 0;
  v_inst_created int := 0;
  v_inst_updated int := 0;
  v_items_full int := 0;
  v_items_partial int := 0;
  v_unresolved int := 0;
  v_liability text;
  v_sched numeric;
  v_report jsonb := '[]'::jsonb;
  v_diff text;
  v_existing boolean;
  v_n_before int;
  v_n_after int;
  v_case_found boolean;
BEGIN
  FOR a IN SELECT * FROM ce_payment_arrangements ORDER BY created_at LOOP
    v_case_found := false;
    IF a.case_id IS NOT NULL THEN
      SELECT * INTO v_case FROM ce_cases WHERE id = a.case_id;
      v_case_found := FOUND;
    END IF;

    IF NOT v_case_found THEN
      v_coverage := 'UNRESOLVED';
    ELSIF coalesce(v_case.total_amount,0) <> coalesce(a.total_debt,0) THEN
      v_coverage := 'UNRESOLVED';
    ELSIF coalesce(v_case.total_principal,0) + coalesce(v_case.total_penalties,0)
          + coalesce(v_case.total_interest,0) = coalesce(v_case.total_amount,0)
         AND coalesce(v_case.total_amount,0) > 0 THEN
      v_coverage := 'FULL';
    ELSE
      v_coverage := 'PARTIAL';
    END IF;

    SELECT id IS NOT NULL INTO v_existing
    FROM core_payment_arrangement WHERE legacy_ce_arrangement_id = a.id;
    v_existing := coalesce(v_existing, false);

    IF NOT p_dry_run THEN
      INSERT INTO core_payment_arrangement (
        arrangement_no, debtor_type, debtor_id, debtor_name,
        source_module_created_by, arrangement_type, status, frequency,
        start_date, end_date, total_arranged_amount, down_payment_amount,
        installment_amount, number_of_installments, total_paid,
        outstanding_balance, terms_text, legacy_ce_arrangement_id,
        coverage_status, created_by, approved_by, approved_at, created_at, updated_at
      ) VALUES (
        a.arrangement_number, 'EMPLOYER', a.employer_id, a.employer_name,
        'COMPLIANCE', 'COMPLIANCE_PLAN', core_map_ce_arrangement_status(a.status),
        CASE WHEN upper(coalesce(a.frequency,'MONTHLY')) IN ('WEEKLY','BIWEEKLY','MONTHLY')
             THEN upper(a.frequency) ELSE 'MONTHLY' END,
        a.start_date, a.end_date, coalesce(a.total_debt,0), coalesce(a.down_payment,0),
        coalesce(a.installment_amount,0), coalesce(a.number_of_installments,0),
        coalesce(a.total_paid,0), coalesce(a.total_debt,0) - coalesce(a.total_paid,0),
        a.terms_text, a.id, v_coverage, coalesce(a.created_by, p_actor),
        a.approved_by, a.approved_at, a.created_at, a.updated_at
      )
      ON CONFLICT (legacy_ce_arrangement_id) WHERE legacy_ce_arrangement_id IS NOT NULL
      DO UPDATE SET
        status = EXCLUDED.status,
        total_arranged_amount = EXCLUDED.total_arranged_amount,
        total_paid = EXCLUDED.total_paid,
        outstanding_balance = EXCLUDED.outstanding_balance,
        coverage_status = EXCLUDED.coverage_status,
        updated_at = now()
      RETURNING id INTO v_core_id;
    ELSE
      SELECT id INTO v_core_id FROM core_payment_arrangement WHERE legacy_ce_arrangement_id = a.id;
    END IF;

    IF v_existing THEN v_arr_updated := v_arr_updated + 1; ELSE v_arr_created := v_arr_created + 1; END IF;

    IF NOT p_dry_run AND v_core_id IS NOT NULL THEN
      SELECT count(*) INTO v_n_before
      FROM core_payment_schedule_installment c
      JOIN ce_installments i ON i.id = c.legacy_ce_installment_id
      WHERE i.arrangement_id = a.id;

      INSERT INTO core_payment_schedule_installment (
        arrangement_id, installment_no, due_date, due_amount, paid_amount,
        paid_date, status, notes, legacy_ce_installment_id, legacy_source_system, created_at
      )
      SELECT v_core_id, s.installment_number, s.due_date, s.amount,
             coalesce(s.paid_amount,0), s.paid_date,
             core_map_ce_installment_status(s.status),
             nullif(concat_ws(' | ',
               nullif(s.payment_reference,''),
               CASE WHEN s.is_overdue THEN 'legacy_overdue=true; overdue_days='||coalesce(s.overdue_days,0)::text END
             ),''),
             s.id, 'CE_INSTALLMENTS', s.created_at
      FROM ce_installments s
      WHERE s.arrangement_id = a.id
      ON CONFLICT (legacy_ce_installment_id) WHERE legacy_ce_installment_id IS NOT NULL
      DO UPDATE SET
        due_amount = EXCLUDED.due_amount,
        paid_amount = EXCLUDED.paid_amount,
        paid_date = EXCLUDED.paid_date,
        status = EXCLUDED.status,
        updated_at = now();

      SELECT count(*) INTO v_n_after
      FROM core_payment_schedule_installment c
      JOIN ce_installments i ON i.id = c.legacy_ce_installment_id
      WHERE i.arrangement_id = a.id;

      v_inst_created := v_inst_created + (v_n_after - v_n_before);
      v_inst_updated := v_inst_updated + v_n_before;
    END IF;

    SELECT coalesce(sum(amount),0) INTO v_sched FROM ce_installments WHERE arrangement_id = a.id;
    v_diff := CASE
      WHEN v_sched = 0 THEN 'NO_SCHEDULE'
      WHEN v_sched + coalesce(a.down_payment,0) = coalesce(a.total_debt,0) THEN 'EXACT'
      WHEN abs(v_sched + coalesce(a.down_payment,0) - coalesce(a.total_debt,0)) <= 0.05
           * coalesce(a.number_of_installments,1) THEN 'ROUNDING'
      ELSE 'DISCREPANCY'
    END;

    IF v_coverage IN ('FULL','PARTIAL') AND NOT p_dry_run AND v_core_id IS NOT NULL THEN
      v_liability := CASE WHEN coalesce(v_case.fund_type::text,'') IN ('SS','LV','PE')
                          THEN v_case.fund_type::text ELSE 'OTHER' END;
      INSERT INTO core_payment_arrangement_item (
        arrangement_id, source_module, source_record_type, source_record_id,
        source_reference_no, compliance_case_id, liability_type,
        principal_amount, penalty_amount, cost_amount,
        arranged_amount, paid_amount, outstanding_amount, status,
        coverage_confidence, coverage_evidence, reconstruction_key,
        notes, created_by
      ) VALUES (
        v_core_id, 'COMPLIANCE', 'CASE', v_case.id::text, v_case.case_number,
        v_case.id, v_liability,
        CASE WHEN v_coverage = 'FULL' THEN v_case.total_principal END,
        CASE WHEN v_coverage = 'FULL' THEN v_case.total_penalties END,
        CASE WHEN v_coverage = 'FULL' THEN v_case.total_interest END,
        coalesce(a.total_debt,0), coalesce(a.total_paid,0),
        greatest(coalesce(a.total_debt,0) - coalesce(a.total_paid,0), 0),
        CASE WHEN coalesce(a.total_paid,0) >= coalesce(a.total_debt,0) THEN 'PAID'
             WHEN coalesce(a.total_paid,0) > 0 THEN 'PARTIAL' ELSE 'OPEN' END,
        v_coverage,
        jsonb_build_object(
          'source','ce_cases',
          'case_id', v_case.id,
          'case_total_amount', v_case.total_amount,
          'case_principal', v_case.total_principal,
          'case_penalties', v_case.total_penalties,
          'case_interest', v_case.total_interest,
          'matched_on','case.total_amount = arrangement.total_debt'
        ),
        'CE-ARR:'||a.id::text||':CASE:'||v_case.id::text,
        CASE WHEN v_coverage = 'PARTIAL'
             THEN 'Component split not reconstructable: case components do not sum to case total.' END,
        p_actor
      )
      ON CONFLICT (reconstruction_key) WHERE reconstruction_key IS NOT NULL
      DO UPDATE SET
        paid_amount = EXCLUDED.paid_amount,
        outstanding_amount = EXCLUDED.outstanding_amount,
        status = EXCLUDED.status,
        updated_at = now();
    END IF;

    IF v_coverage = 'FULL' THEN v_items_full := v_items_full + 1;
    ELSIF v_coverage = 'PARTIAL' THEN v_items_partial := v_items_partial + 1;
    ELSE v_unresolved := v_unresolved + 1; END IF;

    v_report := v_report || jsonb_build_object(
      'arrangement_no', a.arrangement_number,
      'legacy_id', a.id,
      'coverage', v_coverage,
      'total_debt', a.total_debt,
      'down_payment', a.down_payment,
      'schedule_sum', v_sched,
      'amount_consistency', v_diff
    );
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'arrangements_created', v_arr_created,
    'arrangements_updated', v_arr_updated,
    'installments_created', v_inst_created,
    'installments_updated', v_inst_updated,
    'coverage_full', v_items_full,
    'coverage_partial', v_items_partial,
    'coverage_unresolved', v_unresolved,
    'detail', v_report
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.core_backfill_ce_arrangements(text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.core_backfill_ce_arrangements(text, boolean) TO service_role;
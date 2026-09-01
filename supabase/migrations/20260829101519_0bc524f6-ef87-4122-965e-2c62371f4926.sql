-- ═══════════════════════════════════════════════════════════════════════════
-- Checkpoint C — Calculation Rules, Interest, Estimated Assessment,
-- Reconciliation and Credit Allocation
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Retire CR-001, keep CR-004 disabled, configure CR-002/CR-003, add CR-008
UPDATE public.ce_calculation_rules
SET is_enabled = false,
    effective_to = COALESCE(effective_to, CURRENT_DATE),
    description = 'RETIRED (Checkpoint C): the client does not require a generic universal late-payment penalty. Fines/penalties come only from the applicable fund-specific rules CR-005 (SS), CR-006 (Levy), CR-007 (Severance).',
    parameters = COALESCE(parameters, '{}'::jsonb) || jsonb_build_object('retired', true, 'retired_reason', 'no_generic_late_payment_penalty', 'retired_at', now()),
    updated_by = 'CHECKPOINT_C',
    updated_at = now()
WHERE rule_code = 'CR-001';

UPDATE public.ce_calculation_rules
SET is_enabled = false,
    description = 'NOT ACTIVATED: the proposed under-declaration surcharge is not client-approved. Capability remains configurable but must not execute.',
    parameters = COALESCE(parameters, '{}'::jsonb) || jsonb_build_object('activated', false, 'surcharge_rate_percent', 0),
    updated_by = 'CHECKPOINT_C',
    updated_at = now()
WHERE rule_code = 'CR-004';

UPDATE public.ce_calculation_rules
SET applies_to = 'interest',
    formula_expression = 'principal × ((1 + annual_rate_percent/100/12)^months_after_grace − 1)',
    source_config = 'ce_compliance_policies',
    is_enabled = true,
    description = 'Interest on overdue contribution balances. Separate financial component — never merged into contributions, fines or penalties. Accrual anchor comes from the authoritative obligation resolver.',
    parameters = COALESCE(parameters, '{}'::jsonb) || jsonb_build_object(
      'annual_rate_percent', 5,
      'compounding_basis', jsonb_build_array('monthly_compound'),
      'minimum_interest_principal', 10,
      'accrual_start', jsonb_build_array('grace_end')
    ),
    updated_by = 'CHECKPOINT_C',
    updated_at = now()
WHERE rule_code = 'CR-002';

UPDATE public.ce_calculation_rules
SET parameters = COALESCE(parameters, '{}'::jsonb) || jsonb_build_object(
      'history_period_count', 3,
      'estimate_multiplier', 1.5,
      'minimum_history_periods', 2,
      'exclude_zero_periods', true,
      'exclude_amended_periods', false,
      'exclude_statuses', jsonb_build_array('DRAFT','REJECTED','CANCELLED')
    ),
    updated_by = 'CHECKPOINT_C',
    updated_at = now()
WHERE rule_code = 'CR-003';

INSERT INTO public.ce_calculation_rules
  (rule_code, name, description, applies_to, formula_expression, source_config, parameters, is_enabled, effective_from, created_by)
VALUES
  ('CR-008', 'Payment Allocation Policy',
   'Configurable order in which a payment settles outstanding liabilities. Client direction: contributions (oldest outstanding first), then fines/penalties; interest accounted separately. Approved partial-payment (B1) allocations are never overridden. Cross-fund transfer is OPEN and disabled.',
   'allocation',
   'apply(payment, class_order[contribution>fine>penalty], within_class=oldest_period_first, interest=separate)',
   'ce_compliance_policies',
   jsonb_build_object(
     'allocation_class_order', jsonb_build_array('contribution','fine','penalty'),
     'within_class_order', jsonb_build_array('oldest_period_first'),
     'interest_settlement', jsonb_build_array('separate'),
     'respect_partial_payment_authority', true,
     'over_payment_creates_credit', true,
     'allow_cross_fund_transfer', false
   ),
   true, CURRENT_DATE, 'CHECKPOINT_C')
ON CONFLICT DO NOTHING;

-- ── 2. Cross-fund transfer stays behind a disabled flag (Finance/CFO OPEN)
INSERT INTO public.feature_flags (flag_key, display_name, is_enabled, description)
VALUES ('compliance.calculation.crossFundTransfer', 'Cross-fund credit transfer', false,
        'OPEN — awaiting Finance/CFO approval. Cross-fund transfer of credits is disabled. Enabling requires privileged approval and is audited.')
ON CONFLICT (flag_key) DO UPDATE
  SET is_enabled = false,
      description = EXCLUDED.description;

-- ── 3. Calculation audit trail (reproducibility contract)
CREATE TABLE IF NOT EXISTS public.ce_calculation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL,
  component text NOT NULL,
  policy_version text NOT NULL,
  employer_id text,
  person_ssn text,
  wage_period text,
  fund_code text,
  principal numeric(14,2) NOT NULL DEFAULT 0,
  rate numeric(12,8),
  rate_basis text,
  period_count integer NOT NULL DEFAULT 0,
  multiplier numeric(12,4),
  compounding_basis text,
  source_periods text[] NOT NULL DEFAULT '{}',
  allocation_basis text,
  rounding text NOT NULL DEFAULT 'half_up_2',
  raw_amount numeric(18,6) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  suppressed_reason text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text UNIQUE,
  reference_type text,
  reference_id uuid,
  calculated_by text NOT NULL DEFAULT 'SYSTEM',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_calculation_audit TO authenticated;
GRANT ALL ON public.ce_calculation_audit TO service_role;
ALTER TABLE public.ce_calculation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compliance staff read calculation audit"
  ON public.ce_calculation_audit FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.violations.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.config.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.reports.operational'));
CREATE INDEX IF NOT EXISTS ce_calc_audit_employer_idx ON public.ce_calculation_audit (employer_id, wage_period);
CREATE INDEX IF NOT EXISTS ce_calc_audit_rule_idx ON public.ce_calculation_audit (rule_code, created_at DESC);

-- ── 4. Estimated assessments and their lifecycle
CREATE TABLE IF NOT EXISTS public.ce_estimated_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id text NOT NULL,
  wage_period text NOT NULL,
  fund_code text,
  status text NOT NULL DEFAULT 'RAISED'
    CHECK (status IN ('RAISED','PAID','RECONCILED','CANCELLED','EXCEPTION')),
  estimated_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  actual_amount numeric(14,2),
  difference_amount numeric(14,2),
  credit_amount numeric(14,2) NOT NULL DEFAULT 0,
  additional_liability numeric(14,2) NOT NULL DEFAULT 0,
  reconciliation_outcome text
    CHECK (reconciliation_outcome IS NULL OR reconciliation_outcome IN ('balanced','credit_due','additional_liability')),
  reconciled_at timestamptz,
  reconciled_by text,
  history_period_count integer,
  estimate_multiplier numeric(12,4),
  average_liability numeric(14,2),
  basis_periods text[] NOT NULL DEFAULT '{}',
  excluded_periods jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version text NOT NULL,
  calculation_audit_id uuid REFERENCES public.ce_calculation_audit(id),
  ledger_entry_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  created_by text NOT NULL DEFAULT 'SYSTEM',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employer_id, wage_period, fund_code)
);
GRANT SELECT ON public.ce_estimated_assessments TO authenticated;
GRANT ALL ON public.ce_estimated_assessments TO service_role;
ALTER TABLE public.ce_estimated_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compliance staff read estimated assessments"
  ON public.ce_estimated_assessments FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.violations.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.config.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.reports.operational'));

CREATE TABLE IF NOT EXISTS public.ce_estimated_assessment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.ce_estimated_assessments(id) ON DELETE CASCADE,
  person_ssn text NOT NULL,
  wage_period text NOT NULL,
  -- Canonical marker: these are NEVER employer-declared C3 data.
  record_marker text NOT NULL DEFAULT 'SYSTEM_ESTIMATED'
    CHECK (record_marker = 'SYSTEM_ESTIMATED'),
  allocation_ratio numeric(12,6) NOT NULL DEFAULT 0,
  allocated_amount numeric(14,2) NOT NULL DEFAULT 0,
  capped_amount numeric(14,2) NOT NULL DEFAULT 0,
  basis_wage_total numeric(14,2) NOT NULL DEFAULT 0,
  periods_present integer NOT NULL DEFAULT 0,
  basis_periods text[] NOT NULL DEFAULT '{}',
  calculation_audit_id uuid REFERENCES public.ce_calculation_audit(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, person_ssn)
);
GRANT SELECT ON public.ce_estimated_assessment_lines TO authenticated;
GRANT ALL ON public.ce_estimated_assessment_lines TO service_role;
ALTER TABLE public.ce_estimated_assessment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compliance staff read system-estimated lines"
  ON public.ce_estimated_assessment_lines FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.violations.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

-- ── 5. Controlled calculation exception / review queue
CREATE TABLE IF NOT EXISTS public.ce_calculation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_type text NOT NULL,
  rule_code text NOT NULL,
  employer_id text,
  person_ssn text,
  wage_period text,
  reason_code text NOT NULL,
  detail text NOT NULL,
  indicative_amount numeric(14,2) NOT NULL DEFAULT 0,
  assessment_id uuid REFERENCES public.ce_estimated_assessments(id) ON DELETE CASCADE,
  calculation_audit_id uuid REFERENCES public.ce_calculation_audit(id),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','DISMISSED')),
  resolution_note text,
  resolved_by text,
  resolved_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_calculation_exceptions TO authenticated;
GRANT ALL ON public.ce_calculation_exceptions TO service_role;
ALTER TABLE public.ce_calculation_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compliance staff read calculation exceptions"
  ON public.ce_calculation_exceptions FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.violations.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.review_flag.review')
      OR public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

-- ── 6. Interest accruals (separate component, idempotent)
CREATE TABLE IF NOT EXISTS public.ce_interest_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id text NOT NULL,
  wage_period text NOT NULL,
  fund_code text,
  as_of_date date NOT NULL,
  accrual_start_date date NOT NULL,
  principal numeric(14,2) NOT NULL DEFAULT 0,
  annual_rate_percent numeric(8,4) NOT NULL,
  compounding_basis text NOT NULL,
  elapsed_months integer NOT NULL DEFAULT 0,
  cumulative_interest numeric(14,2) NOT NULL DEFAULT 0,
  posted_interest numeric(14,2) NOT NULL DEFAULT 0,
  suppressed_reason text,
  policy_version text NOT NULL,
  calculation_audit_id uuid REFERENCES public.ce_calculation_audit(id),
  ledger_entry_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_interest_accruals TO authenticated;
GRANT ALL ON public.ce_interest_accruals TO service_role;
ALTER TABLE public.ce_interest_accruals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compliance staff read interest accruals"
  ON public.ce_interest_accruals FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.violations.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.config.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.reports.operational'));
CREATE INDEX IF NOT EXISTS ce_interest_accruals_emp_idx
  ON public.ce_interest_accruals (employer_id, wage_period, fund_code, as_of_date DESC);

-- ── 7. Configurable allocation policy
CREATE TABLE IF NOT EXISTS public.ce_allocation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL UNIQUE,
  policy_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  class_order text[] NOT NULL DEFAULT ARRAY['contribution','fine','penalty'],
  within_class text NOT NULL DEFAULT 'oldest_period_first'
    CHECK (within_class IN ('oldest_period_first','newest_period_first')),
  interest_settlement text NOT NULL DEFAULT 'separate'
    CHECK (interest_settlement IN ('separate','inline')),
  respect_partial_payment_authority boolean NOT NULL DEFAULT true,
  over_payment_creates_credit boolean NOT NULL DEFAULT true,
  allow_cross_fund_transfer boolean NOT NULL DEFAULT false,
  cross_fund_transfer_approved_by text,
  cross_fund_transfer_approved_at timestamptz,
  policy_version text NOT NULL DEFAULT 'v1',
  notes text,
  created_by text NOT NULL DEFAULT 'SYSTEM',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_allocation_policies TO authenticated;
GRANT INSERT, UPDATE ON public.ce_allocation_policies TO authenticated;
GRANT ALL ON public.ce_allocation_policies TO service_role;
ALTER TABLE public.ce_allocation_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compliance staff read allocation policy"
  ON public.ce_allocation_policies FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.violations.manage')
      OR public.ce_actor_can(auth.uid(), 'compliance.config.manage'));
CREATE POLICY "Config managers create allocation policy"
  ON public.ce_allocation_policies FOR INSERT TO authenticated
  WITH CHECK (public.ce_actor_can(auth.uid(), 'compliance.config.manage'));
CREATE POLICY "Config managers update allocation policy"
  ON public.ce_allocation_policies FOR UPDATE TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

-- Cross-fund transfer may never be silently switched on.
CREATE OR REPLACE FUNCTION public.ce_allocation_policy_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.allow_cross_fund_transfer
     AND (NEW.cross_fund_transfer_approved_by IS NULL
          OR NEW.cross_fund_transfer_approved_at IS NULL) THEN
    RAISE EXCEPTION 'Cross-fund transfer is an OPEN policy: it requires a recorded privileged approver and approval timestamp';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zz_ce_allocation_policy_guard ON public.ce_allocation_policies;
CREATE TRIGGER zz_ce_allocation_policy_guard
  BEFORE INSERT OR UPDATE ON public.ce_allocation_policies
  FOR EACH ROW EXECUTE FUNCTION public.ce_allocation_policy_guard();

INSERT INTO public.ce_allocation_policies
  (policy_code, policy_name, is_active, class_order, within_class, interest_settlement,
   respect_partial_payment_authority, over_payment_creates_credit, allow_cross_fund_transfer,
   policy_version, notes, created_by)
VALUES
  ('SKN-DEFAULT', 'St Kitts & Nevis default allocation order', true,
   ARRAY['contribution','fine','penalty'], 'oldest_period_first', 'separate',
   true, true, false, 'ckpt-c-v1',
   'Client direction: contributions oldest outstanding first, then fines/penalties; interest accounted separately. Cross-fund transfer OPEN pending Finance/CFO approval.',
   'CHECKPOINT_C')
ON CONFLICT (policy_code) DO NOTHING;

-- ── 8. Governed credit balance
ALTER TABLE public.ce_contribution_credits
  ADD COLUMN IF NOT EXISTS fund_code text,
  ADD COLUMN IF NOT EXISTS credit_type text NOT NULL DEFAULT 'OVER_CONTRIBUTION',
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS source_assessment_id uuid REFERENCES public.ce_estimated_assessments(id),
  ADD COLUMN IF NOT EXISTS calculation_audit_id uuid REFERENCES public.ce_calculation_audit(id),
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ce_contribution_credits_idem_idx
  ON public.ce_contribution_credits (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.ce_contribution_credits.credit_type IS
  'OVER_CONTRIBUTION | ESTIMATE_RECONCILIATION | ADJUSTMENT. Credits offset future liabilities; automatic cash refunds are out of scope for Checkpoint C and remain a Finance process.';

-- ── 9. updated_at maintenance
CREATE OR REPLACE FUNCTION public.ce_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ce_estimated_assessments_touch ON public.ce_estimated_assessments;
CREATE TRIGGER zz_ce_estimated_assessments_touch
  BEFORE UPDATE ON public.ce_estimated_assessments
  FOR EACH ROW EXECUTE FUNCTION public.ce_touch_updated_at();

DROP TRIGGER IF EXISTS zz_ce_calculation_exceptions_touch ON public.ce_calculation_exceptions;
CREATE TRIGGER zz_ce_calculation_exceptions_touch
  BEFORE UPDATE ON public.ce_calculation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.ce_touch_updated_at();

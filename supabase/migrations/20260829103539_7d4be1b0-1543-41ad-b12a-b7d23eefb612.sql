CREATE TABLE IF NOT EXISTS public.ce_open_business_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_code text NOT NULL UNIQUE,
  title text NOT NULL,
  rule_code text,
  status text NOT NULL DEFAULT 'OPEN',
  confirmed_basis text,
  unconfirmed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  runtime_guard text,
  raised_by text NOT NULL DEFAULT 'SYSTEM',
  decided_by text,
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_open_business_decision_status_chk
    CHECK (status IN ('OPEN','CONFIRMED','REJECTED','SUPERSEDED'))
);

GRANT SELECT, INSERT, UPDATE ON public.ce_open_business_decision TO authenticated;
GRANT ALL ON public.ce_open_business_decision TO service_role;

ALTER TABLE public.ce_open_business_decision ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Compliance staff read open business decisions"
  ON public.ce_open_business_decision FOR SELECT TO authenticated
  USING (
    public.ce_actor_can(auth.uid(), 'compliance.config.manage')
    OR public.ce_actor_can(auth.uid(), 'compliance.violations.manage')
    OR public.ce_actor_can(auth.uid(), 'compliance.reports.operational')
  );

CREATE POLICY "Compliance configuration owners record decisions"
  ON public.ce_open_business_decision FOR UPDATE TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

CREATE TRIGGER ce_open_business_decision_touch
  BEFORE UPDATE ON public.ce_open_business_decision
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ce_open_business_decision
  (decision_code, title, rule_code, status, confirmed_basis, unconfirmed_items, runtime_guard)
VALUES (
  'CR-002-RETROACTIVITY',
  'CR-002 interest: retroactivity to pre-implementation liabilities, and any accrual cap',
  'CR-002',
  'OPEN',
  '5% per annum; compounded monthly; accrues after the applicable grace period; EC$10 minimum balance',
  '["maximum accrual months","maximum interest amount / cap policy","historical interest effective (start) date","whether the 5% policy applies retrospectively to liabilities pre-dating implementation"]'::jsonb,
  'Production accruals for liabilities predating the approved interest effective date are classified INTEREST_POLICY_REVIEW_REQUIRED and are not posted. TEST/simulation may compute them, labelled as simulations.'
)
ON CONFLICT (decision_code) DO NOTHING;

ALTER TABLE public.ce_interest_accruals
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'ACCRUED',
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;

ALTER TABLE public.ce_interest_accruals
  DROP CONSTRAINT IF EXISTS ce_interest_accruals_classification_chk;
ALTER TABLE public.ce_interest_accruals
  ADD CONSTRAINT ce_interest_accruals_classification_chk
  CHECK (classification IN ('ACCRUED','SUPPRESSED','INTEREST_POLICY_REVIEW_REQUIRED','SIMULATED'));
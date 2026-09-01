ALTER TABLE public.ce_open_business_decision
  ADD COLUMN IF NOT EXISTS blocker_class TEXT NOT NULL DEFAULT 'NON_BLOCKING_PROVISIONAL',
  ADD COLUMN IF NOT EXISTS production_blocker BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_blocker BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_answer_required TEXT,
  ADD COLUMN IF NOT EXISTS current_safe_behaviour TEXT;

ALTER TABLE public.ce_open_business_decision
  DROP CONSTRAINT IF EXISTS ce_open_business_decision_blocker_class_chk;
ALTER TABLE public.ce_open_business_decision
  ADD CONSTRAINT ce_open_business_decision_blocker_class_chk
  CHECK (blocker_class IN ('PRODUCTION_BLOCKER','DEMO_BLOCKER','NON_BLOCKING_PROVISIONAL','INFORMATION_ONLY'));

UPDATE public.ce_open_business_decision SET
  blocker_class = 'PRODUCTION_BLOCKER', production_blocker = true, demo_blocker = false,
  current_safe_behaviour = 'Retrospective accruals are classified INTEREST_POLICY_REVIEW_REQUIRED and never posted in production. Forward-dated accrual from the approved effective date operates normally, so the confirmed workflow demonstrates fully.',
  client_answer_required = 'Interest effective-from date, whether 5% applies to pre-implementation liabilities, maximum accrual months, and maximum interest amount.'
WHERE decision_code = 'CR-002-RETROACTIVITY';

UPDATE public.ce_open_business_decision SET
  blocker_class = 'PRODUCTION_BLOCKER', production_blocker = true, demo_blocker = false,
  current_safe_behaviour = 'No delay is invented. Automated Warning to Demand advancement halts with DEMAND_STAGE_DELAY_NOT_CONFIGURED. TEST environments may advance the stage through a governed, clearly labelled simulation/backdate that is recorded as a simulation and never as policy.',
  client_answer_required = 'Number of days that must elapse between a Warning Notice and a Demand Notice.'
WHERE decision_code = 'D-WARNING-TO-DEMAND-DELAY';

UPDATE public.ce_open_business_decision SET
  blocker_class = 'NON_BLOCKING_PROVISIONAL', production_blocker = false, demo_blocker = false,
  current_safe_behaviour = 'Threshold formula (average of latest 3 valid monthly liabilities x 9) is confirmed and active. Breaching it raises Management review only; it can never auto-refer to Legal. Only two edge-case interpretations remain open.',
  client_answer_required = 'Treatment of employers with fewer than 3 valid periods, and whether penalties/interest count toward qualifying arrears.'
WHERE decision_code = 'D-LEGAL-ARREARS-MULTIPLIER';

UPDATE public.ce_open_business_decision SET
  blocker_class = 'NON_BLOCKING_PROVISIONAL', production_blocker = false, demo_blocker = false,
  current_safe_behaviour = 'Five-factor model is confirmed; weights 30/20/20/10/20 are active but stamped PROVISIONAL_AWAITING_CLIENT_CONFIRMATION and shown as provisional in every score surface. Risk never triggers Legal referral or any financial charge.',
  client_answer_required = 'Final percentage weight per factor, per-factor measurement windows and thresholds, and risk band cut-offs.'
WHERE decision_code = 'E-RISK-FACTOR-WEIGHTS';

GRANT SELECT ON public.ce_open_business_decision TO authenticated;
GRANT ALL ON public.ce_open_business_decision TO service_role;
ALTER TABLE public.ce_open_business_decision ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_open_decision_read" ON public.ce_open_business_decision;
CREATE POLICY "ce_open_decision_read" ON public.ce_open_business_decision
  FOR SELECT TO authenticated USING (true);
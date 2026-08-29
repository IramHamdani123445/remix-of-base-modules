-- ===========================================================
-- Checkpoint A: authoritative obligation timeline foundation
-- ===========================================================

-- 1. Compliance Policy owns the deadline BASIS (one owner, reused by
--    filing, payment and reminder logic).
ALTER TABLE public.ce_compliance_policies
  ADD COLUMN IF NOT EXISTS deadline_basis text NOT NULL DEFAULT 'calendar_month_end',
  ADD COLUMN IF NOT EXISTS reporting_offset_months integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deadline_fixed_day integer,
  ADD COLUMN IF NOT EXISTS payment_grace_period_days integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.ce_compliance_policies
    ADD CONSTRAINT ce_policy_deadline_basis_chk
    CHECK (deadline_basis IN ('calendar_month_end','fixed_day_of_month'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ce_compliance_policies
    ADD CONSTRAINT ce_policy_reporting_offset_chk
    CHECK (reporting_offset_months BETWEEN 0 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ce_compliance_policies
    ADD CONSTRAINT ce_policy_fixed_day_chk
    CHECK (
      (deadline_basis = 'calendar_month_end')
      OR (deadline_fixed_day IS NOT NULL AND deadline_fixed_day BETWEEN 1 AND 31)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ce_compliance_policies
    ADD CONSTRAINT ce_policy_payment_grace_chk
    CHECK (payment_grace_period_days BETWEEN 0 AND 365);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.ce_compliance_policies.deadline_basis IS
  'Authoritative basis for every C3 filing/payment deadline. calendar_month_end = end of the reporting month (current St Kitts regulation). fixed_day_of_month = deadline_fixed_day of the reporting month (other deployments / possible future simplification).';
COMMENT ON COLUMN public.ce_compliance_policies.reporting_offset_months IS
  'Months added to the wage period to obtain the reporting period. St Kitts = 1 (the following month is the allowed reporting/payment window).';
COMMENT ON COLUMN public.ce_compliance_policies.payment_grace_period_days IS
  'Extra days allowed after the resolved payment due date before non-payment is in breach.';
COMMENT ON COLUMN public.ce_compliance_policies.c3_submission_deadline_day IS
  'RETIRED for deadline resolution. Retained for legacy compatibility only; the authoritative filing deadline comes from deadline_basis/reporting_offset_months/deadline_fixed_day.';
COMMENT ON COLUMN public.ce_compliance_policies.payment_due_date_day IS
  'RETIRED for deadline resolution. Retained for legacy compatibility only; the authoritative payment deadline comes from deadline_basis/reporting_offset_months/deadline_fixed_day.';

-- Current St Kitts deployment values.
UPDATE public.ce_compliance_policies
   SET deadline_basis = 'calendar_month_end',
       reporting_offset_months = 1,
       deadline_fixed_day = NULL,
       c3_grace_period_days = 0,
       payment_grace_period_days = 0,
       updated_at = now()
 WHERE is_active = true;

-- 2. Reminder / notice timing configuration (single source of truth).
CREATE TABLE IF NOT EXISTS public.ce_obligation_reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL UNIQUE,
  label text NOT NULL,
  obligation_type text NOT NULL DEFAULT 'ALL'
    CHECK (obligation_type IN ('C3_FILING','CONTRIBUTION_PAYMENT','ALL')),
  is_enabled boolean NOT NULL DEFAULT true,
  offset_type text NOT NULL DEFAULT 'reporting_day_of_month'
    CHECK (offset_type IN ('reporting_day_of_month','days_before_due','days_after_due')),
  offset_value integer NOT NULL CHECK (offset_value BETWEEN 0 AND 365),
  audience text NOT NULL DEFAULT 'EMPLOYER',
  template_code text NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['email']::text[],
  consolidate_periods boolean NOT NULL DEFAULT true,
  sequence integer NOT NULL DEFAULT 1,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ce_obligation_reminder_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ce_obligation_reminder_rules TO authenticated;
GRANT ALL ON public.ce_obligation_reminder_rules TO service_role;
ALTER TABLE public.ce_obligation_reminder_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ce_obl_reminder_read ON public.ce_obligation_reminder_rules;
CREATE POLICY ce_obl_reminder_read ON public.ce_obligation_reminder_rules
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ce_obl_reminder_write ON public.ce_obligation_reminder_rules;
CREATE POLICY ce_obl_reminder_write ON public.ce_obligation_reminder_rules
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

-- Step 5 governance: same guard + history spine as every other config table.
DROP TRIGGER IF EXISTS zz_ce_config_guard ON public.ce_obligation_reminder_rules;
CREATE TRIGGER zz_ce_config_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.ce_obligation_reminder_rules
  FOR EACH ROW EXECUTE FUNCTION public.ce_config_guard_trg();
DROP TRIGGER IF EXISTS zz_ce_config_history ON public.ce_obligation_reminder_rules;
CREATE TRIGGER zz_ce_config_history AFTER INSERT OR UPDATE OR DELETE
  ON public.ce_obligation_reminder_rules
  FOR EACH ROW EXECUTE FUNCTION public.ce_config_history_trg();

-- Client-confirmed St Kitts defaults: day 3 and day 20 of the following month.
INSERT INTO public.ce_obligation_reminder_rules
  (rule_code, label, obligation_type, is_enabled, offset_type, offset_value,
   audience, template_code, channels, consolidate_periods, sequence, notes, created_by)
VALUES
  ('REM-C3-D03','First filing/payment reminder (day 3)','ALL', true,
   'reporting_day_of_month', 3, 'EMPLOYER', 'TPL-C3-REMINDER-1',
   ARRAY['email']::text[], true, 1,
   'Client-confirmed St Kitts default: 3rd day of the month following the wage month.', 'SYSTEM:checkpoint-a'),
  ('REM-C3-D20','Second filing/payment reminder (day 20)','ALL', true,
   'reporting_day_of_month', 20, 'EMPLOYER', 'TPL-C3-REMINDER-2',
   ARRAY['email']::text[], true, 2,
   'Client-confirmed St Kitts default: 20th day of the month following the wage month.', 'SYSTEM:checkpoint-a')
ON CONFLICT (rule_code) DO NOTHING;

-- 3. Authoritative obligation period register.
CREATE TABLE IF NOT EXISTS public.ce_obligation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id text NOT NULL,
  employer_name text,
  obligation_type text NOT NULL CHECK (obligation_type IN ('C3_FILING','CONTRIBUTION_PAYMENT')),
  wage_period date NOT NULL,
  reporting_period date NOT NULL,
  due_date date NOT NULL,
  grace_days integer NOT NULL DEFAULT 0,
  grace_end_date date NOT NULL,
  violation_effective_date date NOT NULL,
  deadline_basis text NOT NULL,
  reminder_schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
  filing_received_date date,
  filing_is_nil boolean NOT NULL DEFAULT false,
  filing_status text NOT NULL DEFAULT 'PENDING'
    CHECK (filing_status IN ('PENDING','FILED_ON_TIME','FILED_LATE','UNREPORTED','NOT_APPLICABLE')),
  declared_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  last_payment_date date,
  payment_status text NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('PENDING','PAID_IN_FULL','PARTIALLY_PAID','NOT_PAID','NOT_APPLICABLE')),
  is_outstanding boolean NOT NULL DEFAULT false,
  violation_id uuid,
  resolved_at timestamptz,
  resolution_reason text,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_obligation_periods_uq UNIQUE (employer_id, obligation_type, wage_period)
);

CREATE INDEX IF NOT EXISTS ce_obl_periods_outstanding_idx
  ON public.ce_obligation_periods (employer_id, is_outstanding, wage_period);
CREATE INDEX IF NOT EXISTS ce_obl_periods_due_idx
  ON public.ce_obligation_periods (due_date);

GRANT SELECT ON public.ce_obligation_periods TO authenticated;
GRANT ALL ON public.ce_obligation_periods TO service_role;
ALTER TABLE public.ce_obligation_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ce_obl_periods_read ON public.ce_obligation_periods;
CREATE POLICY ce_obl_periods_read ON public.ce_obligation_periods
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_compliance', 'view'));

-- 4. Consolidated notices + the exact periods each one covered.
CREATE TABLE IF NOT EXISTS public.ce_obligation_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_number text NOT NULL UNIQUE,
  employer_id text NOT NULL,
  employer_name text,
  reminder_rule_code text NOT NULL,
  notice_stage text NOT NULL,
  obligation_type text NOT NULL,
  audience text NOT NULL DEFAULT 'EMPLOYER',
  cycle_key text NOT NULL,
  template_code text NOT NULL,
  template_version text,
  channels text[] NOT NULL DEFAULT ARRAY['email']::text[],
  period_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  delivery_status text NOT NULL DEFAULT 'PENDING',
  delivery_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  communication_request_id uuid,
  business_event_id uuid,
  document_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_obligation_notices_cycle_uq UNIQUE (employer_id, reminder_rule_code, cycle_key)
);

CREATE TABLE IF NOT EXISTS public.ce_obligation_notice_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES public.ce_obligation_notices(id) ON DELETE CASCADE,
  obligation_period_id uuid NOT NULL REFERENCES public.ce_obligation_periods(id) ON DELETE CASCADE,
  wage_period date NOT NULL,
  obligation_type text NOT NULL,
  outstanding_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_obligation_notice_periods_uq UNIQUE (notice_id, obligation_period_id)
);

GRANT SELECT ON public.ce_obligation_notices TO authenticated;
GRANT ALL ON public.ce_obligation_notices TO service_role;
GRANT SELECT ON public.ce_obligation_notice_periods TO authenticated;
GRANT ALL ON public.ce_obligation_notice_periods TO service_role;

ALTER TABLE public.ce_obligation_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_obligation_notice_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ce_obl_notices_read ON public.ce_obligation_notices;
CREATE POLICY ce_obl_notices_read ON public.ce_obligation_notices
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_compliance', 'view'));
DROP POLICY IF EXISTS ce_obl_notice_periods_read ON public.ce_obligation_notice_periods;
CREATE POLICY ce_obl_notice_periods_read ON public.ce_obligation_notice_periods
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_compliance', 'view'));

-- updated_at maintenance
DROP TRIGGER IF EXISTS ce_obl_periods_touch ON public.ce_obligation_periods;
CREATE TRIGGER ce_obl_periods_touch BEFORE UPDATE ON public.ce_obligation_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS ce_obl_notices_touch ON public.ce_obligation_notices;
CREATE TRIGGER ce_obl_notices_touch BEFORE UPDATE ON public.ce_obligation_notices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS ce_obl_reminder_touch ON public.ce_obligation_reminder_rules;
CREATE TRIGGER ce_obl_reminder_touch BEFORE UPDATE ON public.ce_obligation_reminder_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
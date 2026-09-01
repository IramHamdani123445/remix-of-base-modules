ALTER TABLE public.bn_payment_schedule
  ADD COLUMN IF NOT EXISTS entitlement_id uuid,
  ADD COLUMN IF NOT EXISTS claim_id uuid,
  ADD COLUMN IF NOT EXISTS ssn text,
  ADD COLUMN IF NOT EXISTS claim_number text,
  ADD COLUMN IF NOT EXISTS sequence_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS frequency text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'XCD',
  ADD COLUMN IF NOT EXISTS rate_weekly numeric,
  ADD COLUMN IF NOT EXISTS rate_monthly numeric,
  ADD COLUMN IF NOT EXISTS rate_applied numeric,
  ADD COLUMN IF NOT EXISTS generation_mode text DEFAULT 'INITIAL',
  ADD COLUMN IF NOT EXISTS instruction_id uuid,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS cl_cheque_no text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by text,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS adjusted_from_id uuid,
  ADD COLUMN IF NOT EXISTS adjustment_reason text,
  ADD COLUMN IF NOT EXISTS arrears_from date,
  ADD COLUMN IF NOT EXISTS arrears_to date,
  ADD COLUMN IF NOT EXISTS arrears_periods integer,
  ADD COLUMN IF NOT EXISTS legacy_schedule_ref text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bn_payment_schedule_entitlement_id_fkey'
  ) THEN
    ALTER TABLE public.bn_payment_schedule
      ADD CONSTRAINT bn_payment_schedule_entitlement_id_fkey
      FOREIGN KEY (entitlement_id) REFERENCES public.bn_entitlement(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bn_payment_schedule_claim_id_fkey'
  ) THEN
    ALTER TABLE public.bn_payment_schedule
      ADD CONSTRAINT bn_payment_schedule_claim_id_fkey
      FOREIGN KEY (claim_id) REFERENCES public.bn_claim(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bn_payment_schedule_entitlement ON public.bn_payment_schedule(entitlement_id);
CREATE INDEX IF NOT EXISTS idx_bn_payment_schedule_claim ON public.bn_payment_schedule(claim_id);
CREATE INDEX IF NOT EXISTS idx_bn_payment_schedule_status_due ON public.bn_payment_schedule(status, due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bn_payment_schedule TO authenticated;
GRANT ALL ON public.bn_payment_schedule TO service_role;
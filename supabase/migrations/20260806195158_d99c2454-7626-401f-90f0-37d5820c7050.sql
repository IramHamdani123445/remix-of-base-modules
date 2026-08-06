-- MT7 — adjustment + approval schema extensions (additive only)

ALTER TABLE public.bn_means_adjustment
  ADD COLUMN IF NOT EXISTS adjustment_reference text,
  ADD COLUMN IF NOT EXISTS assessment_version_id uuid,
  ADD COLUMN IF NOT EXISTS calculation_id uuid,
  ADD COLUMN IF NOT EXISTS target_kind text,
  ADD COLUMN IF NOT EXISTS target_id uuid,
  ADD COLUMN IF NOT EXISTS field_or_line_code text,
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS evidence_reference text,
  ADD COLUMN IF NOT EXISTS financial_effect numeric(18,2),
  ADD COLUMN IF NOT EXISTS original_calculation_hash text,
  ADD COLUMN IF NOT EXISTS decision_reason_code text,
  ADD COLUMN IF NOT EXISTS applied_calculation_id uuid,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS application_error text,
  ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE SEQUENCE IF NOT EXISTS public.bn_means_adjustment_ref_seq;

CREATE INDEX IF NOT EXISTS ix_bn_means_adjustment_open
  ON public.bn_means_adjustment (assessment_id, status);

ALTER TABLE public.bn_means_calculation
  ADD COLUMN IF NOT EXISTS supersedes_calculation_id uuid,
  ADD COLUMN IF NOT EXISTS triggering_adjustment_id uuid,
  ADD COLUMN IF NOT EXISTS recalculation_reason text,
  ADD COLUMN IF NOT EXISTS calculation_hash text;

UPDATE public.bn_means_calculation
   SET calculation_hash = result_hash
 WHERE calculation_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_means_calculation_input
  ON public.bn_means_calculation (assessment_id, input_hash);

ALTER TABLE public.bn_means_assessment
  ADD COLUMN IF NOT EXISTS approved_calculation_id uuid,
  ADD COLUMN IF NOT EXISTS decision_reason_code text,
  ADD COLUMN IF NOT EXISTS decision_justification text,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;

GRANT SELECT ON public.bn_means_adjustment TO authenticated;
GRANT SELECT ON public.bn_means_approval TO authenticated;
GRANT ALL ON public.bn_means_adjustment TO service_role;
GRANT ALL ON public.bn_means_approval TO service_role;
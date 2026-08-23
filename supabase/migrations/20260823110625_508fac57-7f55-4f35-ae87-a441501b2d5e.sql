ALTER TABLE public.ce_legal_referrals
  DROP CONSTRAINT IF EXISTS ce_legal_referrals_status_check;

ALTER TABLE public.ce_legal_referrals
  ADD CONSTRAINT ce_legal_referrals_status_check
  CHECK (status = ANY (ARRAY[
    'DRAFT','PENDING_APPROVAL','APPROVED_FOR_SUBMISSION','SUBMITTED_TO_LEGAL',
    'ACCEPTED_BY_LEGAL','RETURNED_BY_LEGAL','REJECTED','IN_LEGAL_PROCEEDINGS','CLOSED'
  ]));

ALTER TABLE public.ce_legal_referrals
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_requested_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approval_notes text,
  ADD COLUMN IF NOT EXISTS approval_workflow_definition_id uuid,
  ADD COLUMN IF NOT EXISTS pack_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by text,
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS created_via text;

CREATE INDEX IF NOT EXISTS idx_ce_legal_referrals_status_created
  ON public.ce_legal_referrals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_legal_referrals_source_case
  ON public.ce_legal_referrals (source_case_id);
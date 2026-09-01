ALTER TABLE public.ce_inspection_evidence ALTER COLUMN inspection_id DROP NOT NULL;

ALTER TABLE public.ce_inspection_evidence
  DROP CONSTRAINT IF EXISTS ce_inspection_evidence_link_chk;

ALTER TABLE public.ce_inspection_evidence
  ADD CONSTRAINT ce_inspection_evidence_link_chk
  CHECK (inspection_id IS NOT NULL OR plan_item_id IS NOT NULL);
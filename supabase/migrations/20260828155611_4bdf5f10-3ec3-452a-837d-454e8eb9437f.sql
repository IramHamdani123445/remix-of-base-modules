ALTER TABLE public.ia_preparation_checklists ALTER COLUMN department_audit_id DROP NOT NULL;
ALTER TABLE public.ia_preparation_documents ALTER COLUMN department_audit_id DROP NOT NULL;

ALTER TABLE public.ia_preparation_checklists
  ADD CONSTRAINT ia_prep_checklists_parent_required
  CHECK (engagement_id IS NOT NULL OR department_audit_id IS NOT NULL);

ALTER TABLE public.ia_preparation_documents
  ADD CONSTRAINT ia_prep_documents_parent_required
  CHECK (engagement_id IS NOT NULL OR department_audit_id IS NOT NULL);
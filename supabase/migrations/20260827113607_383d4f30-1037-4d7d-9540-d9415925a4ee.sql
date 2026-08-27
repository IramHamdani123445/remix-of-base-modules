-- IA evidence bucket: was unreachable (no policies). Authenticated IA users only.
DROP POLICY IF EXISTS ia_evidence_read ON storage.objects;
CREATE POLICY ia_evidence_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ia-evidence' AND public.ia_is_ia_user());

DROP POLICY IF EXISTS ia_evidence_insert ON storage.objects;
CREATE POLICY ia_evidence_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ia-evidence' AND public.ia_is_ia_user());

-- Overwrite / delete of evidence requires configuration authority (closed-audit protection)
DROP POLICY IF EXISTS ia_evidence_update ON storage.objects;
CREATE POLICY ia_evidence_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'ia-evidence' AND public.ia_has('audit_configuration','configure'))
  WITH CHECK (bucket_id = 'ia-evidence' AND public.ia_has('audit_configuration','configure'));

DROP POLICY IF EXISTS ia_evidence_delete ON storage.objects;
CREATE POLICY ia_evidence_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ia-evidence' AND public.ia_has('audit_configuration','configure'));

-- ia-artifacts: keep authenticated read/upload, but stop blanket delete/overwrite
DROP POLICY IF EXISTS "Authenticated users can delete ia-artifacts" ON storage.objects;
CREATE POLICY ia_artifacts_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ia-artifacts' AND public.ia_has('audit_configuration','configure'));

DROP POLICY IF EXISTS "Authenticated users can update ia-artifacts" ON storage.objects;
CREATE POLICY ia_artifacts_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'ia-artifacts' AND public.ia_has('audit_configuration','configure'))
  WITH CHECK (bucket_id = 'ia-artifacts' AND public.ia_has('audit_configuration','configure'));

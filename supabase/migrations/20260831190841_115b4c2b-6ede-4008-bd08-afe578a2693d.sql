CREATE POLICY "Field staff can read field evidence"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ce-field-evidence' AND public.ce_field_ops_scope(auth.uid()) <> 'NONE');

CREATE POLICY "Field staff can upload field evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ce-field-evidence' AND public.ce_actor_can(auth.uid(), 'compliance.field.execute'));

CREATE POLICY "Field staff can update field evidence"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'ce-field-evidence' AND public.ce_actor_can(auth.uid(), 'compliance.field.execute'))
WITH CHECK (bucket_id = 'ce-field-evidence' AND public.ce_actor_can(auth.uid(), 'compliance.field.execute'));
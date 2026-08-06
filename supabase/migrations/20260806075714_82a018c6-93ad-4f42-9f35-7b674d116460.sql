REVOKE ALL ON public.bn_medical_provider_type FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bn_medical_review_schedule FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.bn_medical_provider_type TO authenticated;
GRANT ALL ON public.bn_medical_provider_type TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.bn_medical_review_schedule TO authenticated;
GRANT ALL ON public.bn_medical_review_schedule TO service_role;

ALTER TABLE public.bn_medical_provider_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_medical_review_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bn_medical_provider_type_read" ON public.bn_medical_provider_type;
CREATE POLICY "bn_medical_provider_type_read"
  ON public.bn_medical_provider_type
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "bn_medical_review_schedule_read" ON public.bn_medical_review_schedule;
CREATE POLICY "bn_medical_review_schedule_read"
  ON public.bn_medical_review_schedule
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "bn_medical_review_schedule_insert" ON public.bn_medical_review_schedule;
CREATE POLICY "bn_medical_review_schedule_insert"
  ON public.bn_medical_review_schedule
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "bn_medical_review_schedule_update" ON public.bn_medical_review_schedule;
CREATE POLICY "bn_medical_review_schedule_update"
  ON public.bn_medical_review_schedule
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
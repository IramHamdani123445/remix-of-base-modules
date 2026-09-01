CREATE TABLE public.ia_comms_recovery_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ia_comms_recovery_probe TO authenticated;
GRANT ALL ON public.ia_comms_recovery_probe TO service_role;
ALTER TABLE public.ia_comms_recovery_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated staff can read recovery probe evidence"
  ON public.ia_comms_recovery_probe FOR SELECT TO authenticated USING (true);
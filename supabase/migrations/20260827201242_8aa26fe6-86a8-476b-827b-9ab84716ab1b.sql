CREATE TABLE IF NOT EXISTS public.ia_escalation_cert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ia_escalation_cert_log TO authenticated;
GRANT ALL ON public.ia_escalation_cert_log TO service_role;
ALTER TABLE public.ia_escalation_cert_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ia_escalation_cert_log_read ON public.ia_escalation_cert_log;
CREATE POLICY ia_escalation_cert_log_read ON public.ia_escalation_cert_log
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
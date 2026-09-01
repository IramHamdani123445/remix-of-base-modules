CREATE TABLE IF NOT EXISTS public.ia_risk_recalc_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_id uuid REFERENCES public.ia_risk_register(id) ON DELETE CASCADE,
  trigger_reason text,
  old_inherent_score numeric,
  new_inherent_score numeric,
  old_inherent_level text,
  new_inherent_level text,
  old_residual_score numeric,
  new_residual_score numeric,
  old_residual_level text,
  new_residual_level text,
  recalculated_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ia_risk_recalc_log TO authenticated;
GRANT ALL ON public.ia_risk_recalc_log TO service_role;

ALTER TABLE public.ia_risk_recalc_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ia_risk_recalc_log_read" ON public.ia_risk_recalc_log;
CREATE POLICY "ia_risk_recalc_log_read"
ON public.ia_risk_recalc_log
FOR SELECT
TO authenticated
USING (public.ia_actor_can('risk_register', 'view'));

CREATE INDEX IF NOT EXISTS idx_ia_risk_recalc_log_risk ON public.ia_risk_recalc_log(risk_id, created_at DESC);

INSERT INTO public.ia_plan_workflow_bindings (event_type, workflow_definition_id, is_active, created_by)
SELECT 'plan_approval', 'a2000000-0000-0000-0000-000000000001'::uuid, true, 'SYSTEM'
WHERE NOT EXISTS (SELECT 1 FROM public.ia_plan_workflow_bindings WHERE event_type = 'plan_approval');

INSERT INTO public.ia_plan_workflow_bindings (event_type, workflow_definition_id, is_active, created_by)
SELECT 'plan_revision', 'a2000000-0000-0000-0000-000000000002'::uuid, true, 'SYSTEM'
WHERE NOT EXISTS (SELECT 1 FROM public.ia_plan_workflow_bindings WHERE event_type = 'plan_revision');
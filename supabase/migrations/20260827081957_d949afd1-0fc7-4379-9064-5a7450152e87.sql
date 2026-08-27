ALTER TABLE public.ia_risk_register
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.ia_departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS function_id uuid REFERENCES public.ia_department_functions(id) ON DELETE SET NULL;

ALTER TABLE public.ia_risk_register
  DROP CONSTRAINT IF EXISTS ia_risk_register_audit_universe_id_fkey;

UPDATE public.ia_risk_register r
SET department_id = r.audit_universe_id
WHERE r.department_id IS NULL
  AND r.audit_universe_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.ia_departments d WHERE d.id = r.audit_universe_id);

CREATE INDEX IF NOT EXISTS ia_risk_register_department_id_idx ON public.ia_risk_register(department_id);
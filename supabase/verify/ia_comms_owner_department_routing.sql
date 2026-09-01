-- Internal Audit — executable regression against the FINAL DEPLOYED emitter.
--
-- Proves, against the live catalogue (not source files), that:
--   1. the Internal Audit communication owner department resolves;
--   2. it is a core_department, never an ia_departments (audited) row;
--   3. the deployed emitter routes on the owner department, not on the
--      department argument it receives;
--   4. contract projection runs AFTER the audited-department merge, so extra
--      context can never poison a request with payload_schema_violation.
DO $$
DECLARE
  v_owner uuid;
  v_src text;
BEGIN
  v_owner := public.ia_comms_owner_department_id();

  IF public.ia_comms_department_domain(v_owner) <> 'core_department' THEN
    RAISE EXCEPTION 'IA communication owner department is not a core_department';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ia_departments d WHERE d.id = v_owner) THEN
    RAISE EXCEPTION 'IA communication owner department collides with an audited department';
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ia_comms_emit';

  IF position('ia_comms_owner_department_id()' in v_src) = 0 THEN
    RAISE EXCEPTION 'emitter no longer resolves the canonical communication owner department';
  END IF;

  IF v_src ~ 'omni_comms_priv_enqueue_business_event\s*\([^$]*p_department_id' THEN
    RAISE EXCEPTION 'emitter regressed to routing on the audited department argument';
  END IF;

  IF position('v_owner_dept', v_src) = 0 THEN
    RAISE EXCEPTION 'emitter does not carry an explicit owner-department routing variable';
  END IF;

  -- projection must be applied to the merged payload (audited context first)
  IF position('auditedDepartmentId' in v_src) = 0
     OR position('auditedDepartmentId' in v_src) > position('ia_comms_contract_project' in v_src) THEN
    RAISE EXCEPTION 'audited-department context is not merged before contract projection';
  END IF;
END $$;

-- ===================================================================
-- Omni-Comms — protected runtime-certification record source verifier.
-- Read-only. Fails loudly on any structural or security regression.
-- Prints: OMNI COMMS RUNTIME CERTIFICATION VERIFY OK
-- ===================================================================
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_src text;
  v_count integer;
  v_setter text := 'public.omni_comms_priv_record_runtime_certification(text,text,text,timestamptz,text)';
BEGIN
  -- 1. singleton table exists with the enumerated state constraint
  IF to_regclass('public.omni_comms_runtime_certification') IS NULL THEN
    RAISE EXCEPTION 'MISSING: public.omni_comms_runtime_certification does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.omni_comms_runtime_certification'::regclass
       AND pg_get_constraintdef(c.oid) ILIKE '%certification_state%pending%certified%failed%'
  ) THEN
    RAISE EXCEPTION 'ENUM: permitted certification states are not constrained';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.omni_comms_runtime_certification'::regclass
       AND pg_get_constraintdef(c.oid) LIKE '%[0-9a-f]{40}%'
  ) THEN
    RAISE EXCEPTION 'SHA: certified_commit is not constrained to a full 40-character sha';
  END IF;

  -- 2. exactly one row (fail-closed reader treats anything else as pending)
  SELECT count(*) INTO v_count FROM public.omni_comms_runtime_certification;
  IF v_count <> 1 THEN
    RAISE WARNING 'STATE: % rows present; posture must report pending', v_count;
  END IF;

  -- 3. RLS enabled and forced, with no policies
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.omni_comms_runtime_certification'::regclass) THEN
    RAISE EXCEPTION 'RLS: row level security is not enabled and forced';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'omni_comms_runtime_certification') THEN
    RAISE EXCEPTION 'RLS: unexpected policy present';
  END IF;

  -- 4. anon/authenticated hold no direct table privilege
  IF has_table_privilege('anon', 'public.omni_comms_runtime_certification', 'SELECT')
     OR has_table_privilege('authenticated', 'public.omni_comms_runtime_certification', 'SELECT')
     OR has_table_privilege('anon', 'public.omni_comms_runtime_certification', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.omni_comms_runtime_certification', 'UPDATE') THEN
    RAISE EXCEPTION 'GRANTS: anon or authenticated can read or write the certification record';
  END IF;

  -- 5. reader and setter are service-role only
  IF has_function_privilege('anon', 'public.omni_comms_priv_runtime_certification()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.omni_comms_priv_runtime_certification()', 'EXECUTE')
     OR has_function_privilege('anon', v_setter, 'EXECUTE')
     OR has_function_privilege('authenticated', v_setter, 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS: reader or setter is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_setter, 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS: setter is not executable by service_role';
  END IF;

  -- 6. reader fails closed
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_runtime_certification';
  IF v_src NOT LIKE '%v_count <> 1%' OR v_src NOT LIKE '%EXCEPTION WHEN OTHERS%' THEN
    RAISE EXCEPTION 'FAILCLOSED: reader does not fail closed on missing, duplicate or error state';
  END IF;
  IF v_src NOT LIKE '%^[0-9a-f]{40}$%' THEN
    RAISE EXCEPTION 'SHA: reader does not validate the certified commit';
  END IF;

  -- 7. setter enforces the certified preconditions and stays in scope
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_record_runtime_certification';
  IF v_src NOT LIKE '%22023%' THEN
    RAISE EXCEPTION 'VALIDATION: setter does not reject malformed records with SQLSTATE 22023';
  END IF;
  IF v_src NOT LIKE '%v_deployed <> v_commit%' THEN
    RAISE EXCEPTION 'VALIDATION: setter does not require deployed-revision equality';
  END IF;
  IF v_src NOT LIKE '%non_production%' THEN
    RAISE EXCEPTION 'VALIDATION: setter does not require a non_production environment';
  END IF;
  IF v_src ~* '(omni_comms_runtime_environment|dispatch_job|delivery_attempt|omni_comms_provider|omni_comms_message|feature|comm_hub)' THEN
    RAISE EXCEPTION 'SCOPE: setter touches environment, delivery, provider, feature or legacy state';
  END IF;

  -- 8. posture reads certification ONLY from the protected record
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_certification_posture';
  IF v_src LIKE '%omni_comms.certification_state%' OR v_src LIKE '%omni_comms.certified_commit%' THEN
    RAISE EXCEPTION 'GUC: posture still reads certification GUCs';
  END IF;
  IF v_src NOT LIKE '%omni_comms_priv_runtime_certification()%' THEN
    RAISE EXCEPTION 'SOURCE: posture does not read the protected certification record';
  END IF;
  IF v_src NOT LIKE '%omni_comms_priv_runtime_environment()%' THEN
    RAISE EXCEPTION 'SOURCE: posture no longer reads the runtime environment record';
  END IF;

  RAISE NOTICE 'OMNI COMMS RUNTIME CERTIFICATION VERIFY OK';
END;
$$;

-- Live delivery must remain disabled throughout this change.
DO $$
DECLARE
  v_jobs integer := 0;
  v_attempts integer := 0;
BEGIN
  IF to_regclass('public.omni_comms_dispatch_job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.omni_comms_dispatch_job' INTO v_jobs;
  END IF;
  IF to_regclass('public.omni_comms_delivery_attempt') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.omni_comms_delivery_attempt' INTO v_attempts;
  END IF;
  IF v_jobs <> 0 OR v_attempts <> 0 THEN
    RAISE EXCEPTION 'DELIVERY: % dispatch jobs and % delivery attempts exist', v_jobs, v_attempts;
  END IF;
END;
$$;

SELECT 'OMNI COMMS RUNTIME CERTIFICATION VERIFY OK' AS marker;

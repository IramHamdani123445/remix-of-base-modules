-- ===================================================================
-- Omni-Comms — Gate 3 Path 2 runtime-environment source verifier.
-- Read-only. Fails loudly on any structural or security regression.
-- Prints: OMNI COMMS RUNTIME ENVIRONMENT VERIFY OK
-- ===================================================================
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_src text;
  v_acl text;
  v_count integer;
BEGIN
  -- 1. singleton table exists with the enumerated check constraint
  IF to_regclass('public.omni_comms_runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'MISSING: public.omni_comms_runtime_environment does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.omni_comms_runtime_environment'::regclass
       AND pg_get_constraintdef(c.oid) ILIKE '%environment%unknown%non_production%production%'
  ) THEN
    RAISE EXCEPTION 'ENUM: permitted environment values are not constrained';
  END IF;

  -- 2. exactly one row (fail-closed reader treats anything else as unknown)
  SELECT count(*) INTO v_count FROM public.omni_comms_runtime_environment;
  IF v_count <> 1 THEN
    RAISE WARNING 'STATE: % rows present; posture must report unknown', v_count;
  END IF;

  -- 3. RLS enabled and forced, with no policies
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.omni_comms_runtime_environment'::regclass) THEN
    RAISE EXCEPTION 'RLS: row level security is not enabled and forced';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'omni_comms_runtime_environment') THEN
    RAISE EXCEPTION 'RLS: unexpected policy present';
  END IF;

  -- 4. anon/authenticated hold no direct table privilege
  IF has_table_privilege('anon', 'public.omni_comms_runtime_environment', 'SELECT')
     OR has_table_privilege('authenticated', 'public.omni_comms_runtime_environment', 'SELECT')
     OR has_table_privilege('anon', 'public.omni_comms_runtime_environment', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.omni_comms_runtime_environment', 'UPDATE') THEN
    RAISE EXCEPTION 'GRANTS: anon or authenticated can read or write the environment record';
  END IF;

  -- 5. setter is service-role only
  IF has_function_privilege('anon', 'public.omni_comms_priv_set_runtime_environment(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.omni_comms_priv_set_runtime_environment(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS: setter is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.omni_comms_priv_set_runtime_environment(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS: setter is not executable by service_role';
  END IF;

  -- 6. setter validates the enumeration and creates no other state
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_set_runtime_environment';
  IF v_src NOT LIKE '%NOT IN (''unknown'', ''non_production'', ''production'')%' THEN
    RAISE EXCEPTION 'VALIDATION: setter does not reject values outside the enumeration';
  END IF;
  IF v_src ~* '(certification_state|certified_commit|dispatch_job|delivery_attempt|omni_comms_provider|omni_comms_message)' THEN
    RAISE EXCEPTION 'SCOPE: setter touches certification, delivery or provider state';
  END IF;

  -- 7. posture reads the environment ONLY from the configuration record
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_certification_posture';
  IF v_src LIKE '%omni_comms.environment%' THEN
    RAISE EXCEPTION 'GUC: posture still reads the omni_comms.environment setting';
  END IF;
  IF v_src NOT LIKE '%omni_comms_priv_runtime_environment()%' THEN
    RAISE EXCEPTION 'SOURCE: posture does not read the runtime environment record';
  END IF;
  IF v_src NOT LIKE '%^[0-9a-f]{40}$%' THEN
    RAISE EXCEPTION 'SHA: posture no longer enforces a full 40-character certified commit';
  END IF;

  -- 8. reader fails closed
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_runtime_environment';
  IF v_src NOT LIKE '%v_count <> 1%' OR v_src NOT LIKE '%EXCEPTION WHEN OTHERS%' THEN
    RAISE EXCEPTION 'FAILCLOSED: reader does not fail closed on missing, duplicate or error state';
  END IF;

  RAISE NOTICE 'OMNI COMMS RUNTIME ENVIRONMENT VERIFY OK';
END;
$$;

SELECT 'OMNI COMMS RUNTIME ENVIRONMENT VERIFY OK' AS marker;

-- =====================================================================
-- BN Award Suspension — effective grant verifier.
--
-- Raises on the first violation. Silence plus the PASS marker is the only
-- accepted outcome. Unlike an aclexplode-only check, the assertions below
-- use has_*_privilege(), so inherited and PUBLIC-default access is caught.
-- =====================================================================
\set ON_ERROR_STOP on

DO $verify$
DECLARE
  r     record;
  v_bad text[] := '{}';
BEGIN
  -- 1. anon may not touch a suspension table at all, and authenticated may
  --    read only: every change must go through the governed commands.
  FOR r IN
    SELECT c.relname, role_name, priv
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated']) AS role_name
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (c.relname LIKE 'bn\_award\_suspension\_%'
            OR c.relname = 'bn_award_suspension_event')
       AND has_table_privilege(role_name, c.oid, priv)
       AND NOT (role_name = 'authenticated' AND priv = 'SELECT')
  LOOP
    v_bad := v_bad || format('TABLE %s: %s has %s', r.relname, r.role_name, r.priv);
  END LOOP;

  -- 2. Private helpers are system-internal; SECURITY DEFINER commands reach
  --    them as the owner, so no browser role needs EXECUTE.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, role_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND p.proname LIKE '\_bn\_susp\_%'
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  LOOP
    v_bad := v_bad || format('PRIVATE %s: %s has EXECUTE', r.sig, r.role_name);
  END LOOP;

  -- 3. Scheduler-only surfaces must never be callable from a browser.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, role_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND p.proname IN ('bn_award_suspension_due_for_execution_v1',
                         'bn_award_suspension_execute_scheduled_v1')
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  LOOP
    v_bad := v_bad || format('SCHEDULER %s: %s has EXECUTE', r.sig, r.role_name);
  END LOOP;

  -- 4. Anonymous visitors may not invoke any suspension/reinstatement command.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'bn\_award\_suspension\_%'
            OR p.proname LIKE 'bn\_award\_reinstatement\_%')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    v_bad := v_bad || format('ANON %s: has EXECUTE', r.sig);
  END LOOP;

  -- 5. Every operator command must be reachable by authenticated callers,
  --    otherwise the module is unusable no matter what permissions say.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('bn_award_suspension_propose_v1',
                         'bn_award_suspension_approve_v1',
                         'bn_award_suspension_reject_v1',
                         'bn_award_suspension_withdraw_v1',
                         'bn_award_suspension_execute_v1',
                         'bn_award_reinstatement_propose_v1',
                         'bn_award_reinstatement_approve_v1',
                         'bn_award_reinstatement_reject_v1',
                         'bn_award_reinstatement_withdraw_v1',
                         'bn_award_reinstatement_execute_v1')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    v_bad := v_bad || format('MISSING %s: authenticated lacks EXECUTE', r.sig);
  END LOOP;

  -- 6. Every command must be SECURITY DEFINER with a pinned search_path,
  --    and must include `extensions` where pgcrypto lives.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig, p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'bn\_award\_suspension\_%'
            OR p.proname LIKE 'bn\_award\_reinstatement\_%'
            OR p.proname LIKE '\_bn\_susp\_%')
  LOOP
    IF NOT r.prosecdef THEN
      v_bad := v_bad || format('SECDEF %s: not SECURITY DEFINER', r.sig);
    END IF;
    IF r.proconfig IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      v_bad := v_bad || format('SEARCHPATH %s: search_path not pinned', r.sig);
    ELSIF r.prosrc ~ '[^.a-z_]digest\('
      AND NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE '%extensions%') THEN
      v_bad := v_bad || format('SEARCHPATH %s: uses digest() but cannot resolve it', r.sig);
    END IF;
  END LOOP;

  -- 7. The approval area the resolver reads must exist, or the module can
  --    never be configured.
  IF NOT EXISTS (SELECT 1 FROM public.bn_policy_area WHERE code = 'award_suspension') THEN
    v_bad := v_bad || 'CONFIG: bn_policy_area is missing the award_suspension area';
  END IF;

  -- 8. Every permission the commands check must exist in the action catalogue.
  FOR r IN
    SELECT a.action
      FROM unnest(ARRAY['view','propose','approve','withdraw','execute',
                        'resume_propose','resume_approve','resume_execute',
                        'view_payment_impact']) AS a(action)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.module_actions ma
         JOIN public.app_modules m ON m.id = ma.module_id
        WHERE m.name = 'bn_award_suspension' AND ma.action_name = a.action)
  LOOP
    v_bad := v_bad || format('CATALOGUE: action %s is not registered', r.action);
  END LOOP;

  -- 9. Dark launch must still hold on a freshly built database.
  IF (SELECT actions_enabled FROM public.app_modules WHERE name = 'bn_award_suspension') THEN
    v_bad := v_bad || 'GATE: bn_award_suspension is activated on this database';
  END IF;

  IF array_length(v_bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'BN_SUSP_GRANTS_RESULT: FAIL\n  %',
      array_to_string(v_bad, E'\n  ');
  END IF;

  RAISE NOTICE 'BN_SUSP_GRANTS_RESULT: PASS';
END
$verify$;

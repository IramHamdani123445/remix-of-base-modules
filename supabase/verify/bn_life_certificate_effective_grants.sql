-- =====================================================================
-- BN Life Certificates — effective grant verifier
-- Expect ZERO rows from every query below.
-- =====================================================================

-- 1. No direct table privileges for anon / authenticated / PUBLIC.
SELECT c.relname, a.grantee, a.privilege_type
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) x
  JOIN LATERAL (SELECT pg_get_userbyid(x.grantee) AS grantee, x.privilege_type) a ON true
 WHERE c.relname LIKE 'bn_life_certificate%'
   AND c.relkind = 'r'
   AND a.grantee IN ('anon','authenticated','public');

-- 2. Private helpers must not be executable by browser roles (pg_proc.proacl).
SELECT p.proname, pg_get_userbyid(x.grantee) AS grantee
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(p.proacl) x
 WHERE p.proname LIKE '\_bn\_lc\_%'
   AND pg_get_userbyid(x.grantee) IN ('anon','authenticated','public');

-- 3. Scheduler-only surfaces must not be executable by browser roles.
SELECT p.proname, pg_get_userbyid(x.grantee) AS grantee
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(p.proacl) x
 WHERE p.proname IN ('bn_life_certificate_due_milestones_v1',
                     'bn_life_certificate_record_milestone_failure_v1')
   AND pg_get_userbyid(x.grantee) IN ('anon','authenticated','public');

-- 4. The retired due-feed name must no longer exist.
SELECT proname FROM pg_proc WHERE proname = 'bn_life_certificate_due_for_milestone_v1';

-- 5. The milestone command must not accept a caller-supplied as-of date.
SELECT proname, pg_get_function_arguments(oid)
  FROM pg_proc
 WHERE proname = 'bn_life_certificate_mark_milestone_v1'
   AND pg_get_function_arguments(oid) LIKE '%p_as_of%';

-- =====================================================================
-- 6. EFFECTIVE privilege verification (fails loudly, not silently).
--    aclexplode only reports explicit ACL entries; the checks below use
--    has_*_privilege so inherited or PUBLIC-default access is caught too.
-- =====================================================================
DO $verify$
DECLARE r record; v_bad text[] := '{}';
BEGIN
  -- 6a. No browser role may touch any Life Certificate or BN communication
  --     dispatch table directly, in any way.
  FOR r IN
    SELECT c.relname, role_name, priv
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated']) AS role_name
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (c.relname LIKE 'bn_life_certificate%' OR c.relname = 'bn_communication_dispatch')
       AND has_table_privilege(role_name, c.oid, priv)
  LOOP
    v_bad := v_bad || format('TABLE %s: %s has %s', r.relname, r.role_name, r.priv);
  END LOOP;

  -- 6b. Private helpers and scheduler / adapter surfaces must be unreachable
  --     from anon and authenticated, including via PUBLIC EXECUTE defaults.
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, role_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND (p.proname LIKE '\_bn\_lc\_%'
            OR p.proname LIKE 'bn_communication_adapter\_%'
            OR p.proname IN ('bn_life_certificate_due_milestones_v1',
                             'bn_life_certificate_record_milestone_failure_v1'))
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  LOOP
    v_bad := v_bad || format('FUNCTION %s(%s): %s has EXECUTE', r.proname, r.args, r.role_name);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'UNSAFE EFFECTIVE PRIVILEGES: %', array_to_string(v_bad, E'\n');
  END IF;

  RAISE NOTICE 'Effective privilege verification passed.';
END $verify$;

-- 7. Every Life Certificate mutation command must carry the record-scope guard.
DO $scope$
DECLARE
  v_bad text[] := ARRAY[]::text[];
  r     record;
BEGIN
  FOR r IN
    SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname ~ '^bn_life_certificate_(verify|reject|request_resubmission|waive|defer|escalate_to_suspension|propose_reinstatement|receive)_v1$'
       AND position('_bn_lc_require_record' in pg_get_functiondef(p.oid)) = 0
  LOOP
    v_bad := v_bad || format('FUNCTION %s is missing the record-scope guard', r.proname);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'MISSING RECORD-SCOPE GUARD: %', array_to_string(v_bad, E'\n');
  END IF;

  RAISE NOTICE 'Record-scope guard verification passed.';
END $scope$;

-- 8. Dark-launch state must hold in the target database.
DO $dark$
DECLARE v_enabled boolean;
BEGIN
  SELECT actions_enabled INTO v_enabled
    FROM public.app_modules WHERE name = 'bn_life_certificate';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bn_life_certificate module is not registered in app_modules';
  END IF;

  IF COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'bn_life_certificate actions_enabled is TRUE — module must stay dark-launched';
  END IF;

  RAISE NOTICE 'Life Certificate dark-launch verification passed.';
END $dark$;

-- 9. Single authoritative result marker for CI.
DO $marker$
BEGIN
  RAISE NOTICE 'BN_LC_GRANTS_RESULT: PASS';
END $marker$;


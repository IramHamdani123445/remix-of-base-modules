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

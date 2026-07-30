-- Omni-Comms — Phase 4 Guided Configuration Setup Wizard: read-only verifier.
--
-- Proves the single bounded aggregate RPC exists with the correct security
-- posture, grants and behaviour. Performs NO writes.

\echo '== 1. Function exists, is SECURITY DEFINER, owned by postgres, search_path pinned =='
SELECT p.proname,
       p.prosecdef                                   AS security_definer,
       pg_get_userbyid(p.proowner)                   AS owner,
       p.proconfig                                   AS config,
       pg_get_function_identity_arguments(p.oid)     AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'omni_comms_setup_readiness';

\echo '== 2. Volatility must be STABLE (read-only) =='
SELECT p.proname,
       CASE p.provolatile WHEN 's' THEN 'stable'
                          WHEN 'i' THEN 'immutable'
                          ELSE 'volatile' END AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'omni_comms_setup_readiness';

\echo '== 3. EXECUTE grants: authenticated only; PUBLIC and anon must be absent =='
SELECT p.proname, a.grantee, a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) ax
JOIN LATERAL (
  SELECT COALESCE(pg_get_userbyid(NULLIF(ax.grantee, 0)), 'PUBLIC') AS grantee,
         ax.privilege_type
) a ON TRUE
WHERE n.nspname = 'public'
  AND p.proname = 'omni_comms_setup_readiness'
ORDER BY a.grantee;

\echo '== 4. Body must not mutate: no INSERT/UPDATE/DELETE/TRUNCATE/net calls =='
SELECT p.proname,
       (p.prosrc ~* '\minsert\s+into\m')  AS has_insert,
       (p.prosrc ~* '\mupdate\s+\w')      AS has_update,
       (p.prosrc ~* '\mdelete\s+from\m')  AS has_delete,
       (p.prosrc ~* '\mtruncate\m')       AS has_truncate,
       (p.prosrc ~* 'net\.http')          AS has_http,
       (p.prosrc ~* 'secret_ref')         AS references_secret_ref
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'omni_comms_setup_readiness';

\echo '== 5. Capability enforcement present in the body =='
SELECT p.proname,
       (p.prosrc ~* 'omni_comms_priv_require_capability')      AS enforces_capability,
       (p.prosrc ~* 'omni_comms\.view')                        AS checks_view_capability,
       (p.prosrc ~* 'view_sensitive_content')                  AS gates_sensitive_content,
       (p.prosrc ~* 'omni_comms_priv_verify_department_ownership') AS verifies_department
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'omni_comms_setup_readiness';

\echo '== 6. Permanent route ceiling: no new Omni-Comms admin route registered =='
SELECT COUNT(*) AS omni_comms_menu_routes
FROM app_modules
WHERE route LIKE '/admin/omnichannel-communications%';

\echo '== 7. Setup Wizard must NOT have introduced a new database object =='
SELECT c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'omni_comms_setup%'
ORDER BY c.relname;

\echo '== Verifier complete. Expected: security_definer=t, owner=postgres, stable,'
\echo '   grants=authenticated only, all mutation flags false, capability flags true,'
\echo '   seven menu routes, zero omni_comms_setup* relations. =='

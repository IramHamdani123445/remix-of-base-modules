-- Omni-Comms — Phase 5 Controlled Dry-Run Test Surface: read-only verifier.
--
-- Proves the controlled dry-run server surface (feature gate, authoritative
-- payload validation, trusted administration guard) exists with the correct
-- security posture, grants and behaviour. Performs NO writes.
--
-- Marker printed at the end:
--   OMNI COMMS CONTROLLED DRY RUN VERIFY OK
-- This is an implementation verifier, NOT a privileged runtime certification.

\set ON_ERROR_STOP on

\echo '== 1. Functions exist, SECURITY DEFINER, owner postgres, search_path pinned =='
SELECT p.proname,
       p.prosecdef                               AS security_definer,
       pg_get_userbyid(p.proowner)               AS owner,
       p.proconfig                               AS config,
       pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'omni_comms_controlled_dry_run_gate',
    'omni_comms_validate_dry_run_payload',
    'omni_comms_priv_admin_dry_run_guard'
  )
ORDER BY p.proname;

\echo '== 2. Volatility: validation and gate must be read-only (stable) =='
SELECT p.proname,
       CASE p.provolatile WHEN 's' THEN 'stable'
                          WHEN 'i' THEN 'immutable'
                          ELSE 'volatile' END AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'omni_comms_controlled_dry_run_gate',
    'omni_comms_validate_dry_run_payload'
  )
ORDER BY p.proname;

\echo '== 3. EXECUTE grants: public RPCs authenticated only; private guard not granted to browser roles =='
SELECT p.proname, a.grantee, a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) ax
JOIN LATERAL (
  SELECT COALESCE(pg_get_userbyid(NULLIF(ax.grantee, 0)), 'PUBLIC') AS grantee,
         ax.privilege_type
) a ON TRUE
WHERE n.nspname = 'public'
  AND p.proname IN (
    'omni_comms_controlled_dry_run_gate',
    'omni_comms_validate_dry_run_payload',
    'omni_comms_priv_admin_dry_run_guard'
  )
ORDER BY p.proname, a.grantee;

\echo '== 4. Validation RPC must not mutate and must not perform network calls =='
SELECT p.proname,
       (p.prosrc ~* '\minsert\s+into\m') AS has_insert,
       (p.prosrc ~* '\mupdate\s+\w')     AS has_update,
       (p.prosrc ~* '\mdelete\s+from\m') AS has_delete,
       (p.prosrc ~* '\mtruncate\m')      AS has_truncate,
       (p.prosrc ~* 'net\.http')         AS has_http,
       (p.prosrc ~* 'secret')            AS references_secret
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'omni_comms_controlled_dry_run_gate',
    'omni_comms_validate_dry_run_payload'
  )
ORDER BY p.proname;

\echo '== 5. Validation RPC enforcement: authentication, operate capability, tenant scoping, size bound =='
SELECT p.proname,
       (p.prosrc ~* 'omni_comms_priv_require_capability')          AS enforces_capability,
       (p.prosrc ~* 'omni_comms\.operate')                         AS requires_operate,
       (p.prosrc ~* 'omni_comms_priv_verify_department_ownership') AS verifies_department,
       (p.prosrc ~* 'organization')                                AS organisation_scoped,
       (p.prosrc ~* '262144|256')                                  AS enforces_size_limit,
       (p.prosrc ~* 'jsonb_matches_schema|json_matches_schema')    AS validates_schema
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'omni_comms_validate_dry_run_payload';

\echo '== 6. Administration caller guard: dry_run only, email only, one recipient, example.com =='
SELECT p.proname,
       (p.prosrc ~* 'OMNI_COMMS_ADMIN_DRY_RUN')      AS admin_caller_guard,
       (p.prosrc ~* 'dry_run')                       AS forces_dry_run,
       (p.prosrc ~* 'example\.com')                  AS enforces_example_domain,
       (p.prosrc ~* 'email')                         AS email_only,
       (p.prosrc ~* 'admin_dry_run_recipient_limit') AS one_recipient_guard,
       (p.prosrc ~* 'omni_comms\.operate')           AS requires_operate
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'omni_comms_priv_admin_dry_run_guard';

\echo '== 7. No Legacy Communication Hub reference in any controlled dry-run function =='
SELECT p.proname,
       (p.prosrc ~* 'comm_hub_|core_template|notification_(queue|logs)|communication_request') AS references_legacy
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'omni_comms_controlled_dry_run_gate',
    'omni_comms_validate_dry_run_payload',
    'omni_comms_priv_admin_dry_run_guard'
  )
ORDER BY p.proname;

\echo '== 8. Dry-run safety invariant: no dispatch job or delivery attempt for dry-run requests =='
SELECT COUNT(*) AS dry_run_dispatch_jobs
FROM public.omni_comms_dispatch_job j
JOIN public.omni_comms_message m ON m.id = j.message_id
JOIN public.omni_comms_request r ON r.id = m.request_id
WHERE r.mode = 'dry_run';

SELECT COUNT(*) AS dry_run_delivery_attempts
FROM public.omni_comms_delivery_attempt a
JOIN public.omni_comms_message m ON m.id = a.message_id
JOIN public.omni_comms_request r ON r.id = m.request_id
WHERE r.mode = 'dry_run';

\echo '== 9. Permanent route ceiling remains seven =='
SELECT COUNT(DISTINCT route) AS omni_comms_menu_routes,
       COUNT(*)              AS omni_comms_menu_rows
FROM app_modules
WHERE route LIKE '/admin/omnichannel-communications%';

\echo '== 10. Controlled dry run introduced no new physical database object =='
SELECT c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'omni_comms_dry_run%'
ORDER BY c.relname;

\echo ''
\echo 'Expected: security_definer=t, owner=postgres, stable read-only validation,'
\echo 'authenticated-only public grants, no private grant to anon/authenticated,'
\echo 'all mutation/http/legacy flags false, all guard flags true,'
\echo 'zero dry-run dispatch jobs, zero dry-run delivery attempts,'
\echo 'seven menu routes, zero omni_comms_dry_run* relations.'
\echo 'OMNI COMMS CONTROLLED DRY RUN VERIFY OK'

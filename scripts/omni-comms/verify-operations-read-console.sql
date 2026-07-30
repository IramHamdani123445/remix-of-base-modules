-- Omni-Comms — Phase 2 read-only Operations console verifier.
-- Run with: psql -f scripts/omni-comms/verify-operations-read-console.sql
-- Every check must return ok = true.

\echo '== 1. Operations read RPCs exist and are SECURITY DEFINER =='
SELECT p.proname,
       p.prosecdef AS security_definer,
       p.provolatile IN ('s','i') AS read_only_volatility,
       p.prosecdef AS ok
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'omni_comms_ops_summary',
    'omni_comms_ops_request_list',
    'omni_comms_ops_request_detail',
    'omni_comms_ops_message_content',
    'omni_comms_diagnostics'
  )
ORDER BY p.proname;

\echo '== 2. No anon / PUBLIC EXECUTE on the operations read surface =='
SELECT p.proname,
       NOT (
         has_function_privilege('anon', p.oid, 'EXECUTE')
         OR array_to_string(coalesce(p.proacl, '{}'), ',') LIKE '%=X/%'
            AND array_to_string(coalesce(p.proacl, '{}'), ',') LIKE '%,=X%'
       ) AS ok
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'omni_comms_ops%'
ORDER BY p.proname;

\echo '== 3. Masking helpers exist and are private =='
SELECT p.proname,
       NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS ok
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'omni_comms_priv_mask_email',
    'omni_comms_priv_mask_phone',
    'omni_comms_priv_mask_reference'
  )
ORDER BY p.proname;

\echo '== 4. Runtime tables remain service_role-only for direct access =='
SELECT c.relname,
       NOT has_table_privilege('authenticated', c.oid, 'SELECT') AS ok
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'omni_comms_request',
    'omni_comms_recipient',
    'omni_comms_message',
    'omni_comms_dispatch_job',
    'omni_comms_delivery_attempt',
    'omni_comms_message_event',
    'omni_comms_event_route'
  )
ORDER BY c.relname;

\echo '== 5. No runnable dispatch jobs and no delivery attempts exist =='
SELECT 'runnable_jobs' AS check_name,
       count(*) AS observed,
       count(*) = 0 AS ok
FROM public.omni_comms_dispatch_job
WHERE is_runnable IS TRUE
UNION ALL
SELECT 'delivery_attempts', count(*), count(*) = 0
FROM public.omni_comms_delivery_attempt;

\echo '== 6. Message event sequences are unique per request =='
SELECT count(*) AS duplicate_sequences,
       count(*) = 0 AS ok
FROM (
  SELECT request_id, event_sequence
  FROM public.omni_comms_message_event
  GROUP BY request_id, event_sequence
  HAVING count(*) > 1
) d;

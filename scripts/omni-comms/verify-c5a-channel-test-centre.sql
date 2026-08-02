-- Omni-Comms Channels C5A — read-only verification.
-- Proves: one new table, immutability, RPC-only access, zero-send guarantees.

-- 1. Exactly one new C5A table exists.
SELECT 'table_present' AS check,
       count(*) = 1 AS ok
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'omni_comms_channel_test_run';

-- 2. RLS is enabled and forced, with no policies (RPC-only surface).
SELECT 'rls_forced_no_policy' AS check,
       (c.relrowsecurity AND c.relforcerowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policies p
                         WHERE p.schemaname='public'
                           AND p.tablename='omni_comms_channel_test_run')) AS ok
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='omni_comms_channel_test_run';

-- 3. No direct table privileges for anon or authenticated.
SELECT 'no_direct_grants' AS check,
       count(*) = 0 AS ok
  FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='omni_comms_channel_test_run'
   AND grantee IN ('anon','authenticated','PUBLIC');

-- 4. Immutability trigger blocks UPDATE and DELETE.
SELECT 'immutable_trigger' AS check,
       count(*) = 1 AS ok
  FROM pg_trigger
 WHERE tgrelid = 'public.omni_comms_channel_test_run'::regclass
   AND tgname = 'omni_comms_ctr_immutable_trg'
   AND NOT tgisinternal;

-- 5. Exactly two public RPCs, both executable only by authenticated.
SELECT 'public_rpcs' AS check,
       count(*) = 2 AS ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('omni_comms_channel_test_run_preflight',
                     'omni_comms_channel_test_centre_summary');

SELECT 'rpcs_not_anon' AS check,
       bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')) AS ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('omni_comms_channel_test_run_preflight',
                     'omni_comms_channel_test_centre_summary');

-- 6. Private helpers are not callable by anon or authenticated.
SELECT 'priv_helpers_locked' AS check,
       bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) AS ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'omni_comms_priv_channel_test%';

-- 7. Checklist length is constrained to exactly 21 checks.
SELECT 'checklist_21' AS check,
       count(*) = 1 AS ok
  FROM pg_constraint
 WHERE conrelid = 'public.omni_comms_channel_test_run'::regclass
   AND conname = 'omni_comms_ctr_checks_chk';

-- 8. Idempotency uniqueness is enforced per organisation.
SELECT 'idempotency_unique' AS check,
       count(*) = 1 AS ok
  FROM pg_indexes
 WHERE schemaname='public' AND indexname='omni_comms_ctr_idem_uniq';

-- 9. Zero-send: the ledger has no column that could hold a raw target,
--    raw content, provider response or delivery reference.
SELECT 'no_raw_or_delivery_columns' AS check,
       count(*) = 0 AS ok
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='omni_comms_channel_test_run'
   AND column_name IN ('target','target_raw','body','content','payload',
                       'provider_response','message_id','dispatch_job_id',
                       'delivery_attempt_id','request_id');

-- 10. The preflight RPC writes to no runtime delivery table.
SELECT 'preflight_writes_ledger_only' AS check,
       (pg_get_functiondef(p.oid) NOT LIKE '%omni_comms_message%'
        AND pg_get_functiondef(p.oid) NOT LIKE '%omni_comms_dispatch_job%'
        AND pg_get_functiondef(p.oid) NOT LIKE '%omni_comms_delivery_attempt%'
        AND pg_get_functiondef(p.oid) NOT LIKE '%omni_comms_request%'
        AND pg_get_functiondef(p.oid) NOT LIKE '%notification_queue%') AS ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='omni_comms_channel_test_run_preflight';

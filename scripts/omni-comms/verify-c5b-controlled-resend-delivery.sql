-- Omni-Comms C5B Closure — verification (read-only).
-- Proves retry safety and evidence integrity for controlled Resend test delivery.
-- Safe to run at any time: this script performs no writes.

\echo '== 1. Attempt ledger exists =='
SELECT to_regclass('public.omni_comms_channel_test_delivery_attempt') AS attempt_ledger;

\echo '== 2. Attempt ledger columns =='
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'omni_comms_channel_test_delivery_attempt'
ORDER BY ordinal_position;

\echo '== 3. Delivery retry-safety columns (claim token, idempotency key, payload hash) =='
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'omni_comms_channel_test_delivery'
  AND column_name IN (
    'claim_token', 'claimed_at', 'attempt_count',
    'provider_idempotency_key', 'provider_payload_hash', 'target_hash'
  )
ORDER BY column_name;

\echo '== 4. Approval window / volume / interval controls =='
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'omni_comms_channel_setting'
  AND column_name IN (
    'controlled_test_delivery_enabled',
    'controlled_test_recipients',
    'controlled_test_approval_expires_at',
    'controlled_test_max_deliveries',
    'controlled_test_min_interval_seconds'
  )
ORDER BY column_name;

\echo '== 5. Callback hardening: unique provider event and message identifiers =='
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'omni_comms_channel_test_delivery',
    'omni_comms_channel_test_delivery_event',
    'omni_comms_channel_test_delivery_attempt'
  )
ORDER BY tablename, indexname;

\echo '== 6. Constraints (terminal states, event allowlist, signature verification) =='
SELECT rel.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname IN (
    'omni_comms_channel_test_delivery',
    'omni_comms_channel_test_delivery_event',
    'omni_comms_channel_test_delivery_attempt'
  )
  AND con.contype = 'c'
ORDER BY rel.relname, con.conname;

\echo '== 7. Delivery RPCs and private helpers =='
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'omni_comms%channel_test_delivery%'
ORDER BY p.proname;

\echo '== 8. Effective policy resolver present =='
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'omni_comms_priv_channel_test_effective_policy';

\echo '== 9. Private helpers are not executable by anon/authenticated =='
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'omni_comms_priv_channel_test%'
ORDER BY p.proname;

\echo '== 10. Live delivery must remain disabled everywhere =='
SELECT count(*) AS live_delivery_enabled_rows
FROM public.omni_comms_channel_setting
WHERE live_delivery_enabled IS TRUE;

\echo '== 11. No delivery may exceed the bounded attempt count =='
SELECT d.id, count(a.id) AS attempts
FROM public.omni_comms_channel_test_delivery d
LEFT JOIN public.omni_comms_channel_test_delivery_attempt a ON a.delivery_id = d.id
GROUP BY d.id
HAVING count(a.id) > 3;

\echo '== 12. Every dispatched delivery carries a persistent provider idempotency key =='
SELECT count(*) AS deliveries_missing_idempotency_key
FROM public.omni_comms_channel_test_delivery
WHERE status <> 'pending'
  AND (provider_idempotency_key IS NULL OR provider_idempotency_key = '');

\echo '== 13. Callback evidence is signature verified =='
SELECT count(*) AS unverified_callback_rows
FROM public.omni_comms_channel_test_delivery_event
WHERE signature_verified IS NOT TRUE;

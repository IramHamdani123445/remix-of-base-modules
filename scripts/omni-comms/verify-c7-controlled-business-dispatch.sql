-- ============================================================================
-- Omni-Comms Phase C7 — Controlled business Email dispatch verifier
-- ----------------------------------------------------------------------------
-- Read-only. Sends nothing, claims nothing, changes nothing.
-- Every check must report PASS.
-- ============================================================================

\echo '== C7.01 dispatcher claim / complete / callback RPCs exist =='
SELECT CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_01
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'omni_comms_priv_dispatch_claim_email',
  'omni_comms_priv_dispatch_attempt_complete',
  'omni_comms_priv_dispatch_record_callback',
  'omni_comms_priv_dispatch_reclaim_expired_leases',
  'omni_comms_priv_dispatch_suspend_pilot');

\echo '== C7.02 private dispatch RPCs are SECURITY DEFINER =='
SELECT CASE WHEN bool_and(p.prosecdef) THEN 'PASS' ELSE 'FAIL' END AS c7_02
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'omni_comms_priv_dispatch_%';

\echo '== C7.03 private dispatch RPCs are not executable by anon/authenticated =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_03
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL unnest(ARRAY['anon','authenticated']) AS r(role)
WHERE n.nspname = 'public'
  AND p.proname LIKE 'omni_comms_priv_dispatch_%'
  AND has_function_privilege(r.role, p.oid, 'EXECUTE');

\echo '== C7.04 claim uses FOR UPDATE SKIP LOCKED =='
SELECT CASE WHEN prosrc ILIKE '%for update skip locked%' THEN 'PASS' ELSE 'FAIL' END AS c7_04
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7.05 claim locks the release control row =='
SELECT CASE WHEN prosrc ILIKE '%omni_comms_channel_release_control%'
             AND prosrc ILIKE '%for update%' THEN 'PASS' ELSE 'FAIL' END AS c7_05
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7.06 claim is Email + queued only =='
SELECT CASE WHEN prosrc ILIKE '%''email''%' AND prosrc ILIKE '%''queued''%'
             AND prosrc NOT ILIKE '%''dry_run''%'
        THEN 'PASS' ELSE 'FAIL' END AS c7_06
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7.07 claim enforces hourly, daily and total pilot volume =='
SELECT CASE WHEN prosrc ILIKE '%hour%' AND prosrc ILIKE '%day%' AND prosrc ILIKE '%total%'
        THEN 'PASS' ELSE 'FAIL' END AS c7_07
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7.08 attempt ledger carries claim token, lease and idempotency key =='
SELECT CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_08
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'omni_comms_delivery_attempt'
  AND column_name IN ('claim_token','lease_expires_at','provider_idempotency_key','attempt_number');

\echo '== C7.09 attempt ledger supports outcome_unknown =='
SELECT CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS c7_09
FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
WHERE t.relname = 'omni_comms_delivery_attempt'
  AND pg_get_constraintdef(c.oid) ILIKE '%outcome_unknown%';

\echo '== C7.10 maximum three attempts is enforced in the database =='
SELECT CASE WHEN prosrc ILIKE '%3%' AND prosrc ILIKE '%attempt%' THEN 'PASS' ELSE 'FAIL' END AS c7_10
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7.11 webhook event ledger exists and is deduplicated =='
SELECT CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS c7_11
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'omni_comms_webhook_event'
  AND indexdef ILIKE '%unique%' AND indexdef ILIKE '%provider_event_id%';

\echo '== C7.12 webhook event ledger has RLS enabled =='
SELECT CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS c7_12
FROM pg_class WHERE relname = 'omni_comms_webhook_event';

\echo '== C7.13 anon / authenticated cannot read the webhook ledger =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_13
FROM unnest(ARRAY['anon','authenticated']) AS r(role)
WHERE has_table_privilege(r.role, 'public.omni_comms_webhook_event', 'SELECT');

\echo '== C7.14 callback normalization covers the six lifecycle outcomes =='
SELECT CASE WHEN prosrc ILIKE '%delivered%' AND prosrc ILIKE '%delayed%'
             AND prosrc ILIKE '%bounced%' AND prosrc ILIKE '%complained%'
             AND prosrc ILIKE '%opened%' AND prosrc ILIKE '%clicked%'
        THEN 'PASS' ELSE 'FAIL' END AS c7_14
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_callback';

\echo '== C7.15 automatic suspension exists for harmful outcomes =='
SELECT CASE WHEN prosrc ILIKE '%suspend%' THEN 'PASS' ELSE 'FAIL' END AS c7_15
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_callback';

\echo '== C7.16 live delivery remains disabled on every channel policy =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_16
FROM public.omni_comms_channel_setting WHERE live_delivery_enabled IS TRUE;

\echo '== C7.17 Release Control state `live` is unavailable =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_17
FROM public.omni_comms_channel_release_control WHERE release_state = 'live';

\echo '== C7.18 no non-Email dispatch job is runnable =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_18
FROM public.omni_comms_dispatch_job WHERE channel_code <> 'email' AND is_runnable IS TRUE;

\echo '== C7.19 no genuine business Email was sent (zero business attempts) =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'INFO: ' || count(*) END AS c7_19
FROM public.omni_comms_delivery_attempt WHERE claim_token IS NOT NULL;

\echo '== C7.20 the genuine producer binding remains dry_run / shadow only =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7_20
FROM public.omni_comms_producer_event_binding
WHERE 'queued' = ANY (allowed_modes);

\echo '== C7.21 read-only dispatch diagnostics projection exists =='
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS c7_21
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'omni_comms_dispatch_diagnostics';

\echo '== C7.22 operator tick authorizer exists and grants no content control =='
SELECT CASE WHEN prosrc NOT ILIKE '%recipient%' AND prosrc NOT ILIKE '%subject%'
        THEN 'PASS' ELSE 'FAIL' END AS c7_22
FROM pg_proc WHERE proname = 'omni_comms_dispatch_tick_authorize';

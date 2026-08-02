-- ============================================================================
-- Omni-Comms Phase C7 CLOSURE CORRECTION verifier
-- ----------------------------------------------------------------------------
-- Read-only. Sends nothing, claims nothing, changes nothing.
-- Every check must report PASS.
-- ============================================================================

\echo '== C7C.01 claim RPC carries the tenant scope and execution-context arguments =='
SELECT CASE WHEN to_regprocedure('public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)') IS NOT NULL
             AND to_regprocedure('public.omni_comms_priv_dispatch_claim_email(text,integer,text,text)') IS NULL
        THEN 'PASS' ELSE 'FAIL' END AS c7c_01;

\echo '== C7C.02 claim uses the canonical C5A recipient normaliser =='
SELECT CASE WHEN prosrc ILIKE '%omni_comms_priv_channel_test_normalize_target%'
             AND prosrc NOT ILIKE '%digest(v_recipient%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_02
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7C.03 claim never rewrites the rendering-time release snapshot =='
SELECT CASE WHEN prosrc NOT ILIKE '%release_fingerprint_at_decision =%'
             AND prosrc ILIKE '%release_snapshot_stale%'
             AND prosrc ILIKE '%release_snapshot_missing%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_03
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7C.04 claim resolves the EXACT persisted identity / account binding =='
SELECT CASE WHEN prosrc ILIKE '%provider_account_id = v_job.msg_provider_account_id%'
             AND prosrc ILIKE '%resolution_snapshot_incomplete%'
             AND prosrc NOT ILIKE '%ORDER BY coalesce(priority, 100)%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_04
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7C.05 claim scans wider than the claim budget (starvation resistance) =='
SELECT CASE WHEN prosrc ILIKE '%v_scan_limit%' AND prosrc ILIKE '%EXIT WHEN v_claimed >= v_limit%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_05
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7C.06 an operator tick without scopes claims nothing =='
SELECT CASE WHEN prosrc ILIKE '%operator_scope_required%' THEN 'PASS' ELSE 'FAIL' END AS c7c_06
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7C.07 operator authorisation projects tenant scopes =='
SELECT CASE WHEN to_regprocedure('public.omni_comms_priv_dispatch_operator_scopes(uuid)') IS NOT NULL
             AND (SELECT prosrc FROM pg_proc WHERE proname='omni_comms_dispatch_tick_authorize') ILIKE '%scopes%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_07;

\echo '== C7C.08 the scope projection is not executable by anon / authenticated =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7c_08
FROM unnest(ARRAY['anon','authenticated']) AS r(role)
WHERE has_function_privilege(r.role, 'public.omni_comms_priv_dispatch_operator_scopes(uuid)', 'EXECUTE');

\echo '== C7C.09 the scheduler entry point is service-role only =='
SELECT CASE WHEN to_regprocedure('public.omni_comms_priv_dispatch_scheduler_tick(text,integer,text,text)') IS NOT NULL
             AND NOT has_function_privilege('authenticated','public.omni_comms_priv_dispatch_scheduler_tick(text,integer,text,text)','EXECUTE')
             AND NOT has_function_privilege('anon','public.omni_comms_priv_dispatch_scheduler_tick(text,integer,text,text)','EXECUTE')
        THEN 'PASS' ELSE 'FAIL' END AS c7c_09;

\echo '== C7C.10 provider payload fingerprint gate exists and is service-role only =='
SELECT CASE WHEN to_regprocedure('public.omni_comms_priv_dispatch_record_payload_hash(uuid,text,text)') IS NOT NULL
             AND NOT has_function_privilege('authenticated','public.omni_comms_priv_dispatch_record_payload_hash(uuid,text,text)','EXECUTE')
        THEN 'PASS' ELSE 'FAIL' END AS c7c_10;

\echo '== C7C.11 a changed payload under the same idempotency key is refused =='
SELECT CASE WHEN prosrc ILIKE '%provider_payload_changed_for_idempotency_key%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_11
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_payload_hash';

\echo '== C7C.12 delivery attempts carry the payload fingerprint and claim-time evidence =='
SELECT CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7c_12
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'omni_comms_delivery_attempt'
  AND column_name IN ('provider_payload_hash','release_expires_at_claim',
                      'deployed_revision_at_claim','claim_decision_snapshot',
                      'reconciliation_state');

\echo '== C7C.13 terminal delivery-attempt evidence is immutable and undeletable =='
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS c7c_13
FROM pg_trigger
WHERE tgname = 'omni_comms_delivery_attempt_immutable_trg' AND NOT tgisinternal;

\echo '== C7C.14 an outcome_unknown attempt can only be resolved by reconciliation =='
SELECT CASE WHEN prosrc ILIKE '%omni_comms.reconciliation%' THEN 'PASS' ELSE 'FAIL' END AS c7c_14
FROM pg_proc WHERE proname = 'omni_comms_priv_delivery_attempt_immutable';

\echo '== C7C.15 one provider reference can belong to only one business attempt =='
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS c7c_15
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'omni_comms_delivery_attempt'
  AND indexname = 'omni_comms_delivery_attempt_provider_msg_uq';

\echo '== C7C.16 acceptance without a provider reference is not acceptance =='
SELECT CASE WHEN prosrc ILIKE '%provider_acceptance_reference_missing%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_16
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_attempt_complete';

\echo '== C7C.17 an exhausted uncertain attempt does not assert failure =='
SELECT CASE WHEN prosrc ILIKE '%reconciliation_required%'
             AND prosrc ILIKE '%reconciliation_state%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_17
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_attempt_complete';

\echo '== C7C.18 completion evidence is sanitised (no raw provider body) =='
SELECT CASE WHEN prosrc ILIKE '%jsonb_strip_nulls%'
             AND prosrc NOT ILIKE '%safe_response_metadata = coalesce(p_provider_response%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_18
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_attempt_complete';

\echo '== C7C.19 an ambiguous provider reference never mutates delivery evidence =='
SELECT CASE WHEN prosrc ILIKE '%callback_ambiguous%' AND prosrc ILIKE '%v_matches > 1%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_19
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_callback';

\echo '== C7C.20 a verified callback resolves an uncertain attempt =='
SELECT CASE WHEN prosrc ILIKE '%reconciliation_resolved%' THEN 'PASS' ELSE 'FAIL' END AS c7c_20
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_callback';

\echo '== C7C.21 request aggregate recalculation exists and is service-role only =='
SELECT CASE WHEN to_regprocedure('public.omni_comms_priv_dispatch_recalculate_request(uuid)') IS NOT NULL
             AND NOT has_function_privilege('authenticated','public.omni_comms_priv_dispatch_recalculate_request(uuid)','EXECUTE')
        THEN 'PASS' ELSE 'FAIL' END AS c7c_21;

\echo '== C7C.22 is_runnable is a derived invariant, never a stored decision =='
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'omni_comms_dispatch_job'
            AND c.conname = 'omni_comms_dispatch_job_runnable_chk')
        AND EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgname = 'omni_comms_dispatch_job_runnable_trg' AND NOT tgisinternal)
        THEN 'PASS' ELSE 'FAIL' END AS c7c_22;

\echo '== C7C.23 no runnable job exists outside the ready state =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7c_23
FROM public.omni_comms_dispatch_job WHERE is_runnable IS TRUE AND status <> 'ready';

\echo '== C7C.24 prerequisite check 32 is a truthful dispatcher check =='
SELECT CASE WHEN prosrc ILIKE '%business_dispatch_dispatcher_installed%'
             AND prosrc NOT ILIKE '%business_dispatch_not_implemented_c6%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_24
FROM pg_proc WHERE proname = 'omni_comms_priv_channel_release_prerequisites';

\echo '== C7C.25 the decision oracle reports business dispatch truthfully =='
SELECT CASE WHEN prosrc ILIKE '%''business_dispatch_enabled'', (v_allowed%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_25
FROM pg_proc WHERE proname = 'omni_comms_priv_channel_release_decision';

\echo '== C7C.26 dispatcher diagnostics are tenant scoped =='
SELECT CASE WHEN prosrc ILIKE '%omni_comms_priv_require_tenant_access%'
        THEN 'PASS' ELSE 'FAIL' END AS c7c_26
FROM pg_proc WHERE proname = 'omni_comms_dispatch_diagnostics';

-- ============================================================================
-- Protected invariants — unchanged by the closure correction
-- ============================================================================

\echo '== C7C.27 live delivery remains disabled on every channel policy =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7c_27
FROM public.omni_comms_channel_setting WHERE live_delivery_enabled IS TRUE;

\echo '== C7C.28 Release Control state `live` is unavailable =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7c_28
FROM public.omni_comms_channel_release_control WHERE release_state = 'live';

\echo '== C7C.29 the genuine producer binding remains dry_run / shadow only =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7c_29
FROM public.omni_comms_producer_event_binding
WHERE 'queued' = ANY (allowed_modes);

\echo '== C7C.30 no non-Email dispatch job is runnable =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7c_30
FROM public.omni_comms_dispatch_job WHERE channel <> 'email' AND is_runnable IS TRUE;

\echo '== C7C.31 no genuine business Email was sent =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'INFO: ' || count(*) END AS c7c_31
FROM public.omni_comms_delivery_attempt WHERE provider_idempotency_key IS NOT NULL;

\echo '== C7C.32 C5B controlled test delivery remains intact =='
SELECT CASE WHEN to_regclass('public.omni_comms_channel_test_delivery') IS NOT NULL
             AND to_regclass('public.omni_comms_channel_test_delivery_attempt') IS NOT NULL
        THEN 'PASS' ELSE 'FAIL' END AS c7c_32;

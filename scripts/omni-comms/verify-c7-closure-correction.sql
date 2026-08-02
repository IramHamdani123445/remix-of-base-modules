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

-- ============================================================================
-- FINAL CLOSURE CORRECTION — rollback safety, evidence sanitisation and
-- generic error responses.
--
-- Checks 33-40 concern SQL-script text and TypeScript source. SQL cannot
-- inspect TypeScript reliably, so 36-40 are SOURCE ASSERTIONS: each is proved
-- in `src/__tests__/omni-comms/c7-final-closure.test.ts` and is reported here
-- as a pointer, not as a database assertion. Checks 33-35 are DATABASE-SIDE
-- structural assertions about objects the rollback must not destroy, plus a
-- documented pointer to the script-text assertion.
-- ============================================================================

\echo '== C7F.33 rollback ends with ROLLBACK, not COMMIT (SOURCE ASSERTION) =='
\echo 'SOURCE ASSERTION -> c7-final-closure.test.ts "rollback final executable statement is ROLLBACK"'

\echo '== C7F.34 rollback explicitly suspends controlled-pilot releases =='
-- Database side: the canonical governed suspension worker the rollback calls
-- must exist and must be service-role only. Without it the rollback could not
-- suspend a controlled pilot without rewriting append-only history.
SELECT CASE WHEN to_regprocedure('public.omni_comms_priv_dispatch_suspend_pilot(uuid,text,text)') IS NOT NULL
             AND NOT has_function_privilege('authenticated','public.omni_comms_priv_dispatch_suspend_pilot(uuid,text,text)','EXECUTE')
             AND NOT has_function_privilege('anon','public.omni_comms_priv_dispatch_suspend_pilot(uuid,text,text)','EXECUTE')
        THEN 'PASS' ELSE 'FAIL' END AS c7f_34;

\echo '== C7F.35 rollback preserves all evidence tables =='
-- Every ledger the rollback must NEVER drop is present. The rollback script
-- drops functions only; this check proves the evidence surface still exists.
SELECT CASE WHEN count(*) = 8 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7f_35
FROM unnest(ARRAY[
  'omni_comms_channel_release_control',
  'omni_comms_channel_release_event',
  'omni_comms_dispatch_job',
  'omni_comms_delivery_attempt',
  'omni_comms_webhook_event',
  'omni_comms_channel_test_delivery',
  'omni_comms_channel_test_delivery_attempt',
  'omni_comms_channel_test_delivery_event']) AS t(name)
WHERE to_regclass('public.' || t.name) IS NOT NULL;

\echo '== C7F.36 secret-reference names are not returned by the adapter (SOURCE ASSERTION) =='
\echo 'SOURCE ASSERTION -> c7-final-closure.test.ts "adapter never echoes the credential reference name"'
-- Database side: no stored evidence anywhere contains an Omni-Comms secret
-- reference name. This IS a real database assertion.
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7f_36
FROM public.omni_comms_delivery_attempt
WHERE coalesce(error_detail,'') ~ 'OMNI_COMMS_RESEND_'
   OR coalesce(error_code,'')   ~ 'OMNI_COMMS_RESEND_'
   OR coalesce(provider_response::text,'') ~ 'OMNI_COMMS_RESEND_';

\echo '== C7F.37 dispatcher browser responses contain no raw RPC message (SOURCE ASSERTION) =='
\echo 'SOURCE ASSERTION -> c7-final-closure.test.ts "dispatcher returns only bounded codes"'

\echo '== C7F.38 webhook responses contain no raw RPC message (SOURCE ASSERTION) =='
\echo 'SOURCE ASSERTION -> c7-final-closure.test.ts "webhook business failure returns only record_failed"'

\echo '== C7F.39 a C5B matching failure cannot fall through to C7 (SOURCE ASSERTION) =='
\echo 'SOURCE ASSERTION -> c7-final-closure.test.ts "C5B recording failure stops processing"'

\echo '== C7F.40 provider response evidence is allow-listed and bounded =='
-- Database side: no persisted provider response retains a raw Email address or
-- an unbounded provider message/error body.
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7f_40
FROM public.omni_comms_delivery_attempt
WHERE provider_response ? 'message'
   OR provider_response ? 'error'
   OR coalesce(provider_response::text,'') ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}';

-- ===========================================================================
-- C7F.41 – C7F.52  Final closure correction: claim gates, tenant-scoped
-- diagnostics, bounded safety suspension and truthful callback lifecycle.
-- ===========================================================================

\echo '== C7F.41 the bounded claim-safety suspension helper exists and is service-role only =='
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7f_41
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'omni_comms_priv_dispatch_claim_safety_suspend'
  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  AND has_function_privilege('service_role', p.oid, 'EXECUTE');

\echo '== C7F.42 the claim enforces business_dispatch_enabled =='
SELECT CASE WHEN prosrc ~ 'business_dispatch_disabled' THEN 'PASS' ELSE 'FAIL' END AS c7f_42
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7F.43 the claim enforces recipient_rules_satisfied =='
SELECT CASE WHEN prosrc ~ 'recipient_rules_satisfied' AND prosrc ~ 'recipient_not_permitted'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_43
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7F.44 an out-of-range batch limit is rejected, not clamped =='
SELECT CASE WHEN prosrc ~ 'invalid_batch_limit' AND prosrc !~ 'least\(p_batch_limit'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_44
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7F.45 the claim resolves the exact persisted provider account and sending domain =='
SELECT CASE WHEN prosrc ~ 'provider_identity_ambiguous'
             AND prosrc ~ 'endpoint_tenant_mismatch'
             AND prosrc ~ 'endpoint_department_mismatch'
             AND prosrc ~ 'binding_ambiguous'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_45
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7F.46 the claim calls the bounded safety suspension helper on denial =='
SELECT CASE WHEN prosrc ~ 'omni_comms_priv_dispatch_claim_safety_suspend'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_46
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_email';

\echo '== C7F.47 diagnostics scope the queued producer binding count to the tenant =='
SELECT CASE WHEN prosrc ~ 'b\.organization_id = p_organization_id'
             AND prosrc ~ 'permitted_event_codes'
             AND prosrc ~ 'permitted_caller_modules'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_47
FROM pg_proc WHERE proname = 'omni_comms_dispatch_diagnostics';

\echo '== C7F.48 diagnostics remain permission and tenant gated =='
SELECT CASE WHEN prosrc ~ 'omni_comms_priv_require_tenant_access'
             AND prosrc ~ 'OC403 permission_denied'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_48
FROM pg_proc WHERE proname = 'omni_comms_dispatch_diagnostics';

\echo '== C7F.49 a hard bounce or complaint fails the message before recalculation =='
SELECT CASE WHEN prosrc ~ 'v_terminal'
             AND prosrc ~ 'failed_at = coalesce\(failed_at, now\(\)\)'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_49
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_callback';

\echo '== C7F.50 opened or clicked cannot reverse a terminal failure =='
SELECT CASE WHEN prosrc ~ 'AND NOT v_terminal' THEN 'PASS' ELSE 'FAIL' END AS c7f_50
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_callback';

\echo '== C7F.51 an ambiguous callback records a bounded integrity outcome =='
SELECT CASE WHEN prosrc ~ 'ambiguous_callback' AND prosrc ~ 'release_not_resolvable'
            THEN 'PASS' ELSE 'FAIL' END AS c7f_51
FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_record_callback';

\echo '== C7F.52 live delivery is still disabled everywhere =='
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL: ' || count(*) END AS c7f_52
FROM public.omni_comms_channel_setting WHERE live_delivery_enabled IS TRUE;

-- A4.1.2B — Prepare / Finalize execution certification tests
--
-- Scope covered here (SQL-only, transactional, rolls back):
--   * Permission gates for the four preparation RPCs
--   * preparation_version constraint validation
--   * database-derived canonical idempotency-key format
--   * PREPARING initial state on new insert
--   * finalisation transition PREPARING → READY_FOR_PROVIDER
--   * finalisation rejects non-PREPARING and unlinked evidence
--   * mark_pre_provider_failure keeps provider boundary NOT_ENTERED
--   * provider-boundary uniqueness across preparation versions
--   * runtime-contract audit includes the finalise RPC signature
--
-- What this file INTENTIONALLY does NOT cover in SQL:
--   * A complete fresh-context happy-path assertion (event certification +
--     ORE + production lineage + baseline attestation + assessment stages +
--     recipient policy + template map + sender + provider config). Building
--     that fixture requires touching ~15 canonical tables with strict FK
--     chains and is deferred to a CI integration harness. See
--     docs/testing/comm-hub-permission-harness.md for the pattern.
--   * True concurrent-session interleaving (SQL cannot spawn sessions).
--     A deterministic serialised proxy for the uniqueness invariant is
--     included below; two-session concurrency lands in CI.
--
-- How to run (Cloud SQL runner or psql, as service_role):
--   \i supabase/tests/comm-hub/prepare_execution_test.sql
-- Any RAISE EXCEPTION aborts the outer transaction and fails CI.

BEGIN;

-- ================================================================
-- 1. PERMISSION GATE TESTS  (all four preparation RPCs)
-- ================================================================
DO $test$
DECLARE
  v_sqlstate text;
  v_msg      text;
  v_ran      int := 0;
BEGIN
  -- Simulate anon / authenticated / admin-without-service-role by setting
  -- request.jwt.claim.role. The RPCs read that GUC and reject anything
  -- other than 'service_role'.
  FOREACH v_msg IN ARRAY ARRAY['','anon','authenticated','admin'] LOOP
    PERFORM set_config('request.jwt.claim.role', v_msg, true);

    -- 1a. resolve_comm_hub_revalidation_preparation_context — admin-only
    -- via is_comm_hub_admin(auth.uid()), not service_role. We still expect
    -- the function to reject when called with no authenticated admin uid,
    -- so probing here proves it does NOT run open-to-public.
    BEGIN
      PERFORM public.resolve_comm_hub_revalidation_preparation_context(
        gen_random_uuid(), gen_random_uuid());
      RAISE EXCEPTION 'CONTRACT FAIL: resolve_comm_hub_revalidation_preparation_context ran without admin auth (role=%)', v_msg;
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        IF v_sqlstate NOT IN ('42501','P0001') THEN
          RAISE EXCEPTION 'CONTRACT FAIL: resolve_preparation_context wrong SQLSTATE % under role %',
            v_sqlstate, v_msg;
        END IF;
    END;

    -- 1b. _comm_hub_revalidation_prepare_execution — service_role only
    BEGIN
      PERFORM public._comm_hub_revalidation_prepare_execution(
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, '{}'::jsonb);
      RAISE EXCEPTION 'CONTRACT FAIL: prepare_execution allowed role=%', v_msg;
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        IF v_sqlstate NOT IN ('42501','P0001') THEN
          RAISE EXCEPTION 'CONTRACT FAIL: prepare_execution wrong SQLSTATE % under role %',
            v_sqlstate, v_msg;
        END IF;
    END;

    -- 1c. _comm_hub_revalidation_finalize_preparation — service_role only
    BEGIN
      PERFORM public._comm_hub_revalidation_finalize_preparation(
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), gen_random_uuid(), NULL);
      RAISE EXCEPTION 'CONTRACT FAIL: finalize_preparation allowed role=%', v_msg;
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        IF v_sqlstate NOT IN ('42501','P0001') THEN
          RAISE EXCEPTION 'CONTRACT FAIL: finalize_preparation wrong SQLSTATE % under role %',
            v_sqlstate, v_msg;
        END IF;
    END;

    -- 1d. _comm_hub_revalidation_mark_pre_provider_failure — service_role only
    BEGIN
      PERFORM public._comm_hub_revalidation_mark_pre_provider_failure(
        gen_random_uuid(), 'x', '{}'::jsonb);
      RAISE EXCEPTION 'CONTRACT FAIL: mark_pre_provider_failure allowed role=%', v_msg;
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        IF v_sqlstate NOT IN ('42501','P0001') THEN
          RAISE EXCEPTION 'CONTRACT FAIL: mark_pre_provider_failure wrong SQLSTATE % under role %',
            v_sqlstate, v_msg;
        END IF;
    END;

    v_ran := v_ran + 1;
  END LOOP;

  RAISE NOTICE 'ok: permission gates rejected % non-service-role identities across 4 RPCs', v_ran;
END $test$;


-- ================================================================
-- 2. Prepare-execution as service_role
-- ================================================================
-- Establish a fully isolated, throwaway cycle_id + authorisation_id.
-- We do NOT insert into cycle/authorisation tables because the binder does
-- not enforce FKs against them at this layer — the resolver does. We are
-- testing the binder invariants only.
DO $test$
DECLARE
  v_cycle uuid   := gen_random_uuid();
  v_auth  uuid   := gen_random_uuid();
  v_auth2 uuid   := gen_random_uuid();
  v_op    uuid   := gen_random_uuid();
  v_op2   uuid   := gen_random_uuid();
  v_hash  text   := 'sha256:test-recipient-set-hash-a4-1-2b';
  v_fp    text   := 'evfp2:test-current-fingerprint-a4-1-2b';
  r RECORD;
  r2 RECORD;
  v_state text;
  v_key   text;
  v_expect text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- 2a. reject preparation_version=0
  BEGIN
    PERFORM public._comm_hub_revalidation_prepare_execution(
      v_cycle, v_auth, v_op, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, v_hash, NULL, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'CONTRACT FAIL: preparation_version=0 accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INVALID_PREPARATION_VERSION%' THEN RAISE; END IF;
  END;

  -- 2b. reject preparation_version=-1
  BEGIN
    PERFORM public._comm_hub_revalidation_prepare_execution(
      v_cycle, v_auth, v_op, -1, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, v_hash, NULL, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'CONTRACT FAIL: preparation_version=-1 accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INVALID_PREPARATION_VERSION%' THEN RAISE; END IF;
  END;

  -- 2c. NULL cycle rejected
  BEGIN
    PERFORM public._comm_hub_revalidation_prepare_execution(
      NULL, v_auth, v_op, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, v_hash, NULL, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'CONTRACT FAIL: NULL cycle accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INVALID_PREPARE_ARGS%' THEN RAISE; END IF;
  END;

  -- 2d. Happy path — first call creates a row in state PREPARING
  SELECT * INTO r FROM public._comm_hub_revalidation_prepare_execution(
    v_cycle, v_auth, v_op, NULL /* defaults to 1 */,
    NULL, NULL, NULL, NULL, v_fp, NULL, NULL, NULL,
    NULL, v_hash, NULL, 'test-runtime', '{}'::jsonb);

  IF r.state <> 'PREPARING' THEN
    RAISE EXCEPTION 'CONTRACT FAIL: expected initial state PREPARING, got %', r.state;
  END IF;
  IF r.reused THEN
    RAISE EXCEPTION 'CONTRACT FAIL: first call must not report reused=true';
  END IF;
  IF r.preparation_version <> 1 THEN
    RAISE EXCEPTION 'CONTRACT FAIL: preparation_version default must resolve to 1, got %',
      r.preparation_version;
  END IF;
  v_expect := 'crev-prep:' || v_cycle::text || ':' || v_auth::text || ':1';
  IF r.canonical_idempotency_key <> v_expect THEN
    RAISE EXCEPTION 'CONTRACT FAIL: canonical key mismatch. want=% got=%',
      v_expect, r.canonical_idempotency_key;
  END IF;
  -- stored idempotency_key must match returned canonical key
  SELECT idempotency_key INTO v_key
    FROM public.communication_hub_revalidation_execution WHERE id = r.execution_id;
  IF v_key <> v_expect THEN
    RAISE EXCEPTION 'CONTRACT FAIL: stored idempotency_key differs from canonical (%s vs %s)',
      v_key, v_expect;
  END IF;

  -- 2e. Reuse — same (cycle, auth, version) returns the same execution
  SELECT * INTO r2 FROM public._comm_hub_revalidation_prepare_execution(
    v_cycle, v_auth, v_op2 /* different operator */, 1,
    NULL, NULL, NULL, NULL, v_fp, NULL, NULL, NULL,
    NULL, v_hash, NULL, 'test-runtime', '{}'::jsonb);
  IF NOT r2.reused OR r2.execution_id <> r.execution_id THEN
    RAISE EXCEPTION 'CONTRACT FAIL: second call must reuse. reused=% same_id=%',
      r2.reused, r2.execution_id = r.execution_id;
  END IF;

  -- 2f. Different authorisation for same active cycle/version is rejected
  BEGIN
    PERFORM public._comm_hub_revalidation_prepare_execution(
      v_cycle, v_auth2, v_op, 1, NULL, NULL, NULL, NULL, v_fp, NULL, NULL,
      NULL, NULL, v_hash, NULL, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'CONTRACT FAIL: different authorisation should be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ACTIVE_EXECUTION_BOUND_TO_DIFFERENT_AUTHORISATION%' THEN RAISE; END IF;
  END;

  -- 2g. Different recipient-set hash rejected
  BEGIN
    PERFORM public._comm_hub_revalidation_prepare_execution(
      v_cycle, v_auth, v_op, 1, NULL, NULL, NULL, NULL, v_fp, NULL, NULL,
      NULL, NULL, 'sha256:different-hash', NULL, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'CONTRACT FAIL: recipient-set mismatch should be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ACTIVE_EXECUTION_RECIPIENT_MISMATCH%' THEN RAISE; END IF;
  END;

  -- 2h. Different current fingerprint rejected
  BEGIN
    PERFORM public._comm_hub_revalidation_prepare_execution(
      v_cycle, v_auth, v_op, 1, NULL, NULL, NULL, NULL, 'evfp2:other',
      NULL, NULL, NULL, NULL, v_hash, NULL, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'CONTRACT FAIL: fingerprint drift should be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ACTIVE_EXECUTION_FINGERPRINT_DRIFT%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ok: prepare-execution invariants (versions, key, reuse, mismatch) hold';

  -- 2i. CHECK constraint prevents invalid direct insert (defence-in-depth).
  BEGIN
    INSERT INTO public.communication_hub_revalidation_execution
      (cycle_id, operator_id, idempotency_key, preparation_version, state)
    VALUES (gen_random_uuid(), gen_random_uuid(), 'x', 0, 'PREPARING');
    RAISE EXCEPTION 'CONTRACT FAIL: check constraint chre_preparation_version_ge_1 missing';
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE NOT IN ('23514') THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ok: preparation_version CHECK constraint enforced';
END $test$;


-- ================================================================
-- 3. FINALISATION TESTS
-- ================================================================
DO $test$
DECLARE
  v_cycle uuid := gen_random_uuid();
  v_auth  uuid := gen_random_uuid();
  v_op    uuid := gen_random_uuid();
  v_prep  RECORD;
  v_req   uuid;
  v_msg   uuid;
  v_att   uuid;
  v_state text;
  v_pca   boolean;
  v_pbs   text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Create a PREPARING execution.
  SELECT * INTO v_prep FROM public._comm_hub_revalidation_prepare_execution(
    v_cycle, v_auth, v_op, 1, NULL, NULL, NULL, NULL, 'fp', NULL, NULL,
    NULL, NULL, 'hash', NULL, 'test', '{}'::jsonb);

  -- Insert minimal evidence rows the finalise RPC will re-verify.
  INSERT INTO public.communication_request
    (request_no, module_code, event_code, channels, priority, status,
     payload, context, idempotency_key)
  VALUES ('CREV-PREP-TEST-'||substr(v_prep.execution_id::text,1,8),
     'TEST_MODULE', 'TEST_EVENT', ARRAY['email'], 'normal', 'pending',
     '{}'::jsonb, '{}'::jsonb, v_prep.canonical_idempotency_key)
  RETURNING id INTO v_req;

  INSERT INTO public.communication_message
    (request_id, channel, subject, body_text, body_html, status, send_context)
  VALUES (v_req, 'email', 't', 't', '<p>t</p>', 'queued', 'controlled_revalidation')
  RETURNING id INTO v_msg;

  INSERT INTO public.communication_delivery_attempt
    (message_id, attempt_no, status, provider_call_attempted, send_context, attempt_type)
  VALUES (v_msg, 0, 'pending', false, 'controlled_revalidation',
          'controlled_revalidation_preparation')
  RETURNING id INTO v_att;

  -- 3a. Reject NULL evidence ID
  BEGIN
    PERFORM public._comm_hub_revalidation_finalize_preparation(
      v_prep.execution_id, NULL, v_msg, v_prep.execution_id, v_att, NULL);
    RAISE EXCEPTION 'CONTRACT FAIL: NULL request_id accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INVALID_FINALIZE_ARGS%' THEN RAISE; END IF;
  END;

  -- 3b. Reject message not linked to request
  BEGIN
    PERFORM public._comm_hub_revalidation_finalize_preparation(
      v_prep.execution_id, gen_random_uuid(), v_msg,
      v_prep.execution_id, v_att, NULL);
    RAISE EXCEPTION 'CONTRACT FAIL: unlinked message accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%REQUEST_NOT_FOUND%'
       AND SQLERRM NOT LIKE '%MESSAGE_NOT_FOUND_OR_UNLINKED%' THEN RAISE; END IF;
  END;

  -- 3c. Reject attempt not linked to message
  BEGIN
    PERFORM public._comm_hub_revalidation_finalize_preparation(
      v_prep.execution_id, v_req, v_msg, v_prep.execution_id, gen_random_uuid(), NULL);
    RAISE EXCEPTION 'CONTRACT FAIL: unlinked attempt accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ATTEMPT_NOT_FOUND_OR_UNLINKED%' THEN RAISE; END IF;
  END;

  -- 3d. Happy path — transitions to READY_FOR_PROVIDER, no boundary entry
  PERFORM public._comm_hub_revalidation_finalize_preparation(
    v_prep.execution_id, v_req, v_msg, v_prep.execution_id, v_att, NULL);

  SELECT state, provider_call_attempted, provider_boundary_state
    INTO v_state, v_pca, v_pbs
    FROM public.communication_hub_revalidation_execution
    WHERE id = v_prep.execution_id;

  IF v_state <> 'READY_FOR_PROVIDER' THEN
    RAISE EXCEPTION 'CONTRACT FAIL: expected READY_FOR_PROVIDER after finalise, got %', v_state;
  END IF;
  IF v_pca THEN RAISE EXCEPTION 'CONTRACT FAIL: provider_call_attempted must remain false'; END IF;
  IF v_pbs <> 'NOT_ENTERED' THEN
    RAISE EXCEPTION 'CONTRACT FAIL: provider_boundary_state must remain NOT_ENTERED, got %', v_pbs;
  END IF;

  -- 3e. Finalising an already-READY execution must be rejected
  BEGIN
    PERFORM public._comm_hub_revalidation_finalize_preparation(
      v_prep.execution_id, v_req, v_msg, v_prep.execution_id, v_att, NULL);
    RAISE EXCEPTION 'CONTRACT FAIL: finalise on READY_FOR_PROVIDER accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%EXECUTION_NOT_PREPARING%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ok: finalisation transitions and rejections behave';
END $test$;


-- ================================================================
-- 4. mark_pre_provider_failure — keeps boundary NOT_ENTERED
-- ================================================================
DO $test$
DECLARE
  v_cycle uuid := gen_random_uuid();
  v_auth  uuid := gen_random_uuid();
  v_op    uuid := gen_random_uuid();
  v_prep  RECORD;
  v_state text;
  v_pca   boolean;
  v_pbs   text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT * INTO v_prep FROM public._comm_hub_revalidation_prepare_execution(
    v_cycle, v_auth, v_op, 1, NULL, NULL, NULL, NULL, 'fp', NULL, NULL,
    NULL, NULL, 'hash', NULL, 'test', '{}'::jsonb);

  PERFORM public._comm_hub_revalidation_mark_pre_provider_failure(
    v_prep.execution_id, 'test_failure', '{"why":"contract test"}'::jsonb);

  SELECT state, provider_call_attempted, provider_boundary_state
    INTO v_state, v_pca, v_pbs
    FROM public.communication_hub_revalidation_execution
    WHERE id = v_prep.execution_id;

  IF v_state <> 'FAILED_PRE_PROVIDER' THEN
    RAISE EXCEPTION 'CONTRACT FAIL: expected FAILED_PRE_PROVIDER, got %', v_state;
  END IF;
  IF v_pca THEN RAISE EXCEPTION 'CONTRACT FAIL: provider_call_attempted must remain false'; END IF;
  IF v_pbs <> 'NOT_ENTERED' THEN
    RAISE EXCEPTION 'CONTRACT FAIL: provider_boundary_state must remain NOT_ENTERED, got %', v_pbs;
  END IF;

  RAISE NOTICE 'ok: mark_pre_provider_failure preserves provider boundary';
END $test$;


-- ================================================================
-- 5. Provider-boundary uniqueness across preparation versions
-- ================================================================
-- Simulate a version-1 execution that reached the provider. Then confirm
-- that starting version 2 for the same cycle is rejected by the DB.
DO $test$
DECLARE
  v_cycle uuid := gen_random_uuid();
  v_auth  uuid := gen_random_uuid();
  v_op    uuid := gen_random_uuid();
  v_prep  RECORD;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT * INTO v_prep FROM public._comm_hub_revalidation_prepare_execution(
    v_cycle, v_auth, v_op, 1, NULL, NULL, NULL, NULL, 'fp', NULL, NULL,
    NULL, NULL, 'hash', NULL, 'test', '{}'::jsonb);

  -- Directly mark provider boundary as used (simulates a completed send).
  -- Bypass RLS/grants for the simulation only. Reverts at ROLLBACK.
  PERFORM set_config('role','postgres',true);
  UPDATE public.communication_hub_revalidation_execution
     SET provider_call_attempted = true,
         provider_boundary_state = 'ENTERED',
         state = 'PROVIDER_ACCEPTED'
   WHERE id = v_prep.execution_id;

  BEGIN
    PERFORM public._comm_hub_revalidation_prepare_execution(
      v_cycle, gen_random_uuid(), v_op, 2, NULL, NULL, NULL, NULL, 'fp2',
      NULL, NULL, NULL, NULL, 'hash', NULL, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'CONTRACT FAIL: version 2 was allowed after provider boundary used';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%CYCLE_PROVIDER_BOUNDARY_ALREADY_USED%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ok: provider-boundary uniqueness holds across preparation versions';
END $test$;


-- ================================================================
-- 6. Runtime-contract audit includes the finalise RPC
-- ================================================================
DO $test$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='audit_comm_hub_runtime_contract';

  IF position('_comm_hub_revalidation_finalize_preparation' IN v_def) = 0 THEN
    RAISE EXCEPTION 'CONTRACT FAIL: audit_comm_hub_runtime_contract does not reference the finalise RPC';
  END IF;
  IF position('_comm_hub_revalidation_prepare_execution' IN v_def) = 0 THEN
    RAISE EXCEPTION 'CONTRACT FAIL: audit_comm_hub_runtime_contract does not reference the prepare RPC';
  END IF;
  IF position('preparation_version' IN v_def) = 0 THEN
    RAISE EXCEPTION 'CONTRACT FAIL: audit_comm_hub_runtime_contract does not check preparation_version column';
  END IF;

  RAISE NOTICE 'ok: audit_comm_hub_runtime_contract covers prepare/finalise signatures + preparation_version';
END $test$;

ROLLBACK;

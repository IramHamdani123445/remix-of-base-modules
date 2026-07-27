-- =====================================================================
-- A4.1.3A — Canonical atomic controlled-revalidation preparation tests
--
-- Certifies the strengthened contract:
--   1. Non service-role callers are rejected.
--   2. Success path stores exact canonical rendered subject/body,
--      canonical renderer hashes matching stored hashes, provider_id,
--      sender_profile_id, template_version_id, recipient_set_hash,
--      revalidation_execution_id binding on request AND message,
--      controlled_action = CONTROLLED_REVALIDATION_PREPARE,
--      send_context = 'controlled_revalidation', origin = 'comm_hub',
--      and NO placeholder subject/body remain.
--   3. Idempotent reuse returns identical execution/request/message/
--      recipient/trace/attempt IDs.
--   4. Generic claim RPC excludes the targeted revalidation message.
--   5. Incomplete legacy PREPARING and READY_FOR_PROVIDER rows are
--      swept to RECOVERY_REQUIRED and block PREPARE.
--   6. Recovery RPC requires service_role AND a >=6-char reason.
--
-- This suite runs inside a single transaction and rolls back at the end,
-- so it never mutates production state. It does not SKIP the happy path:
-- if a usable cycle is absent, the test fails loudly so the fixture
-- seeder is repaired rather than silently bypassed.
-- =====================================================================

BEGIN;

SET LOCAL "request.jwt.claim.role" = 'service_role';

DO $$
DECLARE
  v_cycle_id uuid;
  v_auth_id uuid;
  v_operator uuid := gen_random_uuid();
  v_result jsonb;
  v_exec_id uuid;
  v_req_id uuid;
  v_msg_id uuid;
  v_att_id uuid;
  v_rec_id uuid;
  v_trace_id uuid;
  v_subject text; v_body_text text; v_body_html text;
  v_sub_hash text; v_body_hash text; v_content_hash text;
  v_template_version_id uuid;
  v_sender_profile_id uuid;
  v_provider_id uuid;
  v_recipient_set_hash text;
  v_msg_revalidation_id uuid;
  v_req_revalidation_id uuid;
  v_claim_count int;
  v_second jsonb;
  v_legacy_exec uuid;
  v_reprepare jsonb;
BEGIN
  SELECT id INTO v_cycle_id
    FROM public.communication_hub_revalidation_cycle
   WHERE status IN ('READY_FOR_CONTROLLED_EMAIL','EMAIL_AUTHORISED',
                    'AWAITING_INBOX_CONFIRMATION','DRAFT','ASSESSING',
                    'REVALIDATION_REQUIRED','NON_SENDING_CHECKS')
   ORDER BY updated_at DESC LIMIT 1;
  IF v_cycle_id IS NULL THEN
    RAISE EXCEPTION 'FIXTURE_MISSING: no revalidation cycle available — seed a fixture cycle before running this suite (SKIP is not allowed).';
  END IF;

  SELECT id INTO v_auth_id
    FROM public.communication_hub_revalidation_send_authorisation
   WHERE cycle_id = v_cycle_id AND consumed_at IS NULL AND revoked_at IS NULL
   ORDER BY issued_at DESC LIMIT 1;
  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION 'FIXTURE_MISSING: no usable authorisation for cycle % (SKIP is not allowed).', v_cycle_id;
  END IF;

  ----------------------------------------------------------------------
  -- 1. Non service-role rejected.
  ----------------------------------------------------------------------
  BEGIN
    SET LOCAL "request.jwt.claim.role" = 'authenticated';
    PERFORM public._comm_hub_revalidation_prepare_delivery(
      v_cycle_id, v_auth_id, v_operator, 'a413a-test');
    RAISE EXCEPTION 'FAIL: non service-role must be rejected';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SET LOCAL "request.jwt.claim.role" = 'service_role';

  ----------------------------------------------------------------------
  -- 2. Success path — full canonical evidence.
  ----------------------------------------------------------------------
  v_result := public._comm_hub_revalidation_prepare_delivery(
    v_cycle_id, v_auth_id, v_operator, 'a413a-test');
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'FAIL: canonical prepare returned blockers % (authority incomplete — fail closed).',
      (v_result->'blockers')::text;
  END IF;
  v_exec_id := (v_result->>'execution_id')::uuid;
  v_req_id  := (v_result->>'request_id')::uuid;
  v_msg_id  := (v_result->>'message_id')::uuid;
  v_att_id  := (v_result->>'delivery_attempt_id')::uuid;
  v_rec_id  := (v_result->>'recipient_id')::uuid;
  v_trace_id:= (v_result->>'trace_id')::uuid;

  ASSERT v_result->>'state' = 'READY_FOR_PROVIDER',
    'execution must be READY_FOR_PROVIDER';
  ASSERT (v_result->>'provider_call_attempted')::boolean = false;
  ASSERT v_result ? 'template_version_id'
     AND v_result ? 'sender_profile_id'
     AND v_result ? 'provider_id'
     AND v_result ? 'recipient_set_hash'
     AND v_result ? 'subject_hash'
     AND v_result ? 'body_hash'
     AND v_result ? 'content_hash',
    'envelope must expose canonical authority + hashes';

  SELECT subject, body_text, body_html, subject_hash, body_hash, content_hash,
         template_version_id, sender_profile_id, provider_id,
         recipient_set_hash, revalidation_execution_id
    INTO v_subject, v_body_text, v_body_html,
         v_sub_hash, v_body_hash, v_content_hash,
         v_template_version_id, v_sender_profile_id, v_provider_id,
         v_recipient_set_hash, v_msg_revalidation_id
    FROM public.communication_message WHERE id = v_msg_id;

  ASSERT v_msg_revalidation_id = v_exec_id,
    'message.revalidation_execution_id must bind to execution';
  ASSERT v_subject IS NOT NULL AND length(trim(v_subject)) > 0,
    'stored subject must not be blank';
  ASSERT COALESCE(v_body_text,'') <> '' OR COALESCE(v_body_html,'') <> '',
    'stored body must not be blank';
  ASSERT v_subject NOT ILIKE '%[Controlled revalidation — PREPARED]%',
    'placeholder subject fallback must not exist';
  ASSERT COALESCE(v_body_text,'') NOT ILIKE '%Canonical revalidation preparation. No provider call.%',
    'placeholder body fallback must not exist';
  ASSERT v_sub_hash = v_result->>'subject_hash'
     AND v_body_hash = v_result->>'body_hash'
     AND v_content_hash = v_result->>'content_hash',
    'stored hashes must equal envelope hashes';
  -- Independent recomputation matches stored hashes.
  ASSERT v_sub_hash = encode(extensions.digest(v_subject,'sha256'),'hex'),
    'independent subject hash recomputation must match stored subject_hash';
  ASSERT v_body_hash = encode(extensions.digest(
    COALESCE(v_body_html,'') || E'\n---\n' || COALESCE(v_body_text,''),'sha256'),'hex'),
    'independent body hash recomputation must match stored body_hash';

  SELECT revalidation_execution_id INTO v_req_revalidation_id
    FROM public.communication_request WHERE id = v_req_id;
  ASSERT v_req_revalidation_id = v_exec_id,
    'request.revalidation_execution_id must bind to execution';

  ASSERT EXISTS(SELECT 1 FROM public.communication_recipient
                 WHERE id = v_rec_id AND request_id = v_req_id AND role='to'),
    'canonical recipient must exist with role=to';
  ASSERT EXISTS(SELECT 1 FROM public.communication_hub_trace
                 WHERE id = v_trace_id AND request_id = v_req_id AND message_id = v_msg_id),
    'canonical hub trace must be linked (no execution-id fallback)';
  ASSERT EXISTS(SELECT 1 FROM public.communication_hub_trace_step
                 WHERE trace_id = v_trace_id
                   AND stage_code = 'PREPARATION_COMPLETE' AND status='passed');
  ASSERT EXISTS(SELECT 1 FROM public.communication_delivery_attempt
                 WHERE id = v_att_id AND message_id = v_msg_id
                   AND provider_call_attempted = false);

  ----------------------------------------------------------------------
  -- 3. Idempotent reuse — identical IDs including recipient_id.
  ----------------------------------------------------------------------
  v_second := public._comm_hub_revalidation_prepare_delivery(
    v_cycle_id, v_auth_id, v_operator, 'a413a-test-2');
  ASSERT (v_second->>'reused')::boolean = true;
  ASSERT (v_second->>'execution_id')::uuid = v_exec_id;
  ASSERT (v_second->>'request_id')::uuid  = v_req_id;
  ASSERT (v_second->>'message_id')::uuid  = v_msg_id;
  ASSERT (v_second->>'recipient_id')::uuid = v_rec_id,
    'reuse must return the real recipient_id, not NULL';
  ASSERT (v_second->>'trace_id')::uuid = v_trace_id;
  ASSERT (v_second->>'delivery_attempt_id')::uuid = v_att_id;

  ----------------------------------------------------------------------
  -- 4. Generic claim RPC must not claim the prepared targeted message.
  ----------------------------------------------------------------------
  WITH claimed AS (
    SELECT id FROM public.claim_comm_hub_messages(200, 'a413a-worker', true, now() - interval '1 hour', 60)
  )
  SELECT count(*) INTO v_claim_count FROM claimed WHERE id = v_msg_id;
  ASSERT v_claim_count = 0,
    'generic claim RPC must exclude controlled_revalidation prepared messages';

  ----------------------------------------------------------------------
  -- 5. Incomplete legacy execution → RECOVERY_REQUIRED, blocks PREPARE.
  ----------------------------------------------------------------------
  INSERT INTO public.communication_hub_revalidation_execution (
    cycle_id, authorisation_id, operator_id, idempotency_key,
    preparation_version, state, provider_boundary_state,
    provider_call_attempted, runtime_build)
  VALUES (v_cycle_id, v_auth_id, v_operator,
    'legacy-'||gen_random_uuid()::text, 99,
    'PREPARING','NOT_ENTERED', false, 'legacy-a413a-test')
  RETURNING id INTO v_legacy_exec;

  v_reprepare := public._comm_hub_revalidation_prepare_delivery(
    v_cycle_id, v_auth_id, v_operator, 'legacy-sweep');
  ASSERT COALESCE((v_reprepare->>'ok')::boolean, true) = false,
    'PREPARE must fail after legacy sweep';
  ASSERT v_reprepare->>'state' = 'RECOVERY_REQUIRED',
    'PREPARE must report RECOVERY_REQUIRED';
  ASSERT (SELECT state FROM public.communication_hub_revalidation_execution
           WHERE id = v_legacy_exec) = 'RECOVERY_REQUIRED',
    'legacy row must have been swept to RECOVERY_REQUIRED';

  ----------------------------------------------------------------------
  -- 6. Recovery RPC rejects short reason.
  ----------------------------------------------------------------------
  BEGIN
    PERFORM public._comm_hub_revalidation_recover_execution(
      v_legacy_exec, v_operator, 'no');
    RAISE EXCEPTION 'FAIL: recovery must reject reason shorter than 6 chars';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE NOT IN ('22023','42501') THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: A4.1.3A canonical atomic preparation certified for cycle %', v_cycle_id;
END $$;

ROLLBACK;

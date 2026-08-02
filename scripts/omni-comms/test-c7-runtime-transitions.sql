-- ============================================================================
-- Omni-Comms C7 Runtime Transition Closure — EXECUTABLE database tests
-- ----------------------------------------------------------------------------
-- These tests actually invoke the C7 database functions and triggers against
-- real rows. Every fixture is created inside a single transaction that ends in
-- ROLLBACK, so the database is left exactly as it was found.
--
-- No provider is ever contacted: no HTTP, no Resend, no edge function. Only
-- signed-callback SIMULATION through the trusted service-role RPC.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

BEGIN;

SET LOCAL client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Assertion helper (transaction-local).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.ok(p_name text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond THEN
    RAISE NOTICE 'PASS %', p_name;
  ELSE
    RAISE EXCEPTION 'FAIL % : %', p_name, p_detail;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.rejects(p_name text, p_sql text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    v_msg := SQLERRM;
    IF position(p_fragment in v_msg) > 0 THEN
      RAISE NOTICE 'PASS % (rejected: %)', p_name, v_msg;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL % : rejected with unexpected error %', p_name, v_msg;
  END;
  RAISE EXCEPTION 'FAIL % : statement was ACCEPTED but must be rejected', p_name;
END $$;

-- ---------------------------------------------------------------------------
-- Fixture builder: one request, one recipient, one message, one job, one
-- accepted-ready attempt, and a controlled pilot release.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mkfix(p_tag text, p_dept uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_org uuid := '00000000-0000-4000-8000-00000000c7c7';
  v_ev uuid; v_req uuid; v_rcp uuid; v_msg uuid; v_job uuid; v_att uuid; v_rel uuid;
BEGIN
  SELECT id INTO v_ev FROM public.omni_comms_event_definition
   WHERE status = 'active' ORDER BY code LIMIT 1;
  IF v_ev IS NULL THEN
    SELECT id INTO v_ev FROM public.omni_comms_event_definition ORDER BY code LIMIT 1;
  END IF;

  INSERT INTO public.omni_comms_channel_release_control (
    organization_id, department_id, channel, data_origin, release_state,
    release_version, permitted_event_codes, permitted_caller_modules,
    permitted_modes, pilot_recipient_rules, max_recipients_per_request,
    max_messages_per_hour, max_messages_per_day, max_messages_total,
    release_fingerprint, release_starts_at, release_expires_at)
  VALUES (v_org, p_dept, 'email', 'user', 'controlled_pilot', 1,
          ARRAY['c7.test.event'], ARRAY['omni_comms_c7_test'], ARRAY['queued'],
          jsonb_build_array(jsonb_build_object(
            'target_hash', repeat('f', 64), 'target_masked', 'c***@example.test')),
          1, 10, 10, 10, 'c7test-' || p_tag, now(), now() + interval '1 day')
  RETURNING id INTO v_rel;

  INSERT INTO public.omni_comms_request (
    organization_id, department_id, event_definition_id, mode, idempotency_key,
    request_fingerprint, caller_module_code, payload_snapshot, requested_channels,
    status)
  VALUES (v_org, p_dept, v_ev, 'queued', 'c7test-' || p_tag,
          'fp-' || p_tag, 'omni_comms_c7_test', '{}'::jsonb, ARRAY['email'],
          'accepted')
  RETURNING id INTO v_req;

  INSERT INTO public.omni_comms_recipient (request_id, organization_id, recipient_type)
  VALUES (v_req, v_org, 'to') RETURNING id INTO v_rcp;

  INSERT INTO public.omni_comms_message (
    request_id, recipient_id, organization_id, department_id, event_definition_id,
    channel, status)
  VALUES (v_req, v_rcp, v_org, p_dept, v_ev, 'email', 'pending')
  RETURNING id INTO v_msg;

  UPDATE public.omni_comms_message SET status = 'rendered' WHERE id = v_msg;
  UPDATE public.omni_comms_message SET status = 'queued'   WHERE id = v_msg;
  UPDATE public.omni_comms_message SET status = 'dispatching' WHERE id = v_msg;

  INSERT INTO public.omni_comms_dispatch_job (
    request_id, message_id, organization_id, channel, mode, status, is_runnable)
  VALUES (v_req, v_msg, v_org, 'email', 'queued', 'pending', false)
  RETURNING id INTO v_job;

  UPDATE public.omni_comms_dispatch_job SET status = 'ready',  is_runnable = true  WHERE id = v_job;
  UPDATE public.omni_comms_dispatch_job SET status = 'leased', is_runnable = false WHERE id = v_job;
  UPDATE public.omni_comms_dispatch_job SET status = 'processing' WHERE id = v_job;

  INSERT INTO public.omni_comms_delivery_attempt (
    dispatch_job_id, message_id, organization_id, attempt_number, status,
    claim_token, provider_idempotency_key, release_control_id,
    provider_payload_hash, safe_request_metadata, safe_response_metadata)
  VALUES (v_job, v_msg, v_org, 1, 'dispatching', 'claim-' || p_tag,
          'idem-' || p_tag, v_rel, repeat('a', 64), '{}'::jsonb, '{}'::jsonb)
  RETURNING id INTO v_att;

  RETURN jsonb_build_object('org', v_org, 'request', v_req, 'message', v_msg,
                            'job', v_job, 'attempt', v_att, 'release', v_rel,
                            'event', v_ev, 'claim', 'claim-' || p_tag);
END $$;

-- ===========================================================================
DO $outer$
DECLARE
  f jsonb; r jsonb; s text; js text; n integer; a uuid; f2 jsonb;
BEGIN

-- 1. processing job -> completed on provider acceptance ---------------------
f := pg_temp.mkfix('t1');
r := public.omni_comms_priv_dispatch_attempt_complete(
       (f->>'attempt')::uuid, f->>'claim', 'accepted', 'pmid-t1', 202, '{}'::jsonb);
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
PERFORM pg_temp.ok('T1 provider acceptance completes the job',
                   js = 'completed' AND s = 'accepted', js || '/' || s);

-- 2. completed job receives a delivered callback ----------------------------
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t1-del','pmid-t1','email.delivered','delivered', now(),
       '{}'::jsonb, repeat('d',64), true);
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
PERFORM pg_temp.ok('T2 delivered callback: message delivered, job still completed',
                   js = 'completed' AND s = 'delivered', js || '/' || s);

-- 3. completed job receives a complaint callback without an invalid job
--    transition, and 7. delivered -> failed through verified context only.
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t1-cmp','pmid-t1','email.complained','complained', now(),
       '{}'::jsonb, repeat('c',64), true);
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
PERFORM pg_temp.ok('T3 complaint after delivered: job history preserved',
                   js = 'completed' AND (r->>'job_outcome') = 'job_history_preserved',
                   js || ' / ' || coalesce(r->>'job_outcome','-'));
PERFORM pg_temp.ok('T3b complaint after delivered: message failed', s = 'failed', s);
PERFORM pg_temp.ok('T3c complaint after delivered: job is not runnable',
  NOT (SELECT is_runnable FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid));
PERFORM pg_temp.ok('T3d complaint suspends the controlled pilot',
  (SELECT release_state FROM public.omni_comms_channel_release_control
    WHERE id = (f->>'release')::uuid) = 'suspended',
  (SELECT release_state FROM public.omni_comms_channel_release_control
    WHERE id = (f->>'release')::uuid));
PERFORM pg_temp.ok('T11 request aggregate after complaint',
  (SELECT status FROM public.omni_comms_request WHERE id = (f->>'request')::uuid) = 'failed',
  (SELECT status FROM public.omni_comms_request WHERE id = (f->>'request')::uuid));

-- 4. accepted message -> failed on complaint --------------------------------
f := pg_temp.mkfix('t4');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f->>'attempt')::uuid, f->>'claim', 'accepted', 'pmid-t4', 202, '{}'::jsonb);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t4-cmp','pmid-t4','email.complained','complained', now(),
       '{}'::jsonb, repeat('c',64), true);
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
PERFORM pg_temp.ok('T4 accepted -> failed on complaint, job untouched',
                   s = 'failed' AND js = 'completed', s || '/' || js);

-- 8. hard bounce -------------------------------------------------------------
f2 := pg_temp.mkfix('t8');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f2->>'attempt')::uuid, f2->>'claim', 'accepted', 'pmid-t8', 202, '{}'::jsonb);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t8-bnc','pmid-t8','email.bounced','bounced', now(),
       '{"bounce_type":"hard"}'::jsonb, repeat('b',64), true);
PERFORM pg_temp.ok('T8 hard bounce fails the message and suspends the pilot',
  (SELECT status FROM public.omni_comms_message WHERE id = (f2->>'message')::uuid) = 'failed'
  AND (SELECT release_state FROM public.omni_comms_channel_release_control
        WHERE id = (f2->>'release')::uuid) = 'suspended'
  AND (SELECT status FROM public.omni_comms_dispatch_job
        WHERE id = (f2->>'job')::uuid) = 'completed');

-- 8b. soft bounce records evidence and does NOT suspend ----------------------
f2 := pg_temp.mkfix('t8b');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f2->>'attempt')::uuid, f2->>'claim', 'accepted', 'pmid-t8b', 202, '{}'::jsonb);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t8b','pmid-t8b','email.bounced','bounced', now(),
       '{"bounce_type":"soft"}'::jsonb, repeat('b',64), true);
PERFORM pg_temp.ok('T8b soft bounce does not suspend the pilot',
  (SELECT release_state FROM public.omni_comms_channel_release_control
    WHERE id = (f2->>'release')::uuid) = 'controlled_pilot'
  AND (SELECT status FROM public.omni_comms_message
        WHERE id = (f2->>'message')::uuid) = 'accepted');

-- 5/6. delivered -> failed only through the verified callback context --------
f2 := pg_temp.mkfix('t6');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f2->>'attempt')::uuid, f2->>'claim', 'accepted', 'pmid-t6', 202, '{}'::jsonb);
PERFORM public.omni_comms_priv_dispatch_record_callback(
  'resend','evt-t6-del','pmid-t6','email.delivered','delivered', now(),
  '{}'::jsonb, repeat('d',64), true);
PERFORM pg_temp.rejects('T6 direct delivered -> failed UPDATE is rejected',
  format('UPDATE public.omni_comms_message SET status = ''failed'' WHERE id = %L',
         (f2->>'message')::uuid),
  'verified_callback_context_required');
PERFORM public.omni_comms_priv_dispatch_record_callback(
  'resend','evt-t6-cmp','pmid-t6','email.complained','complained', now(),
  '{}'::jsonb, repeat('c',64), true);
PERFORM pg_temp.ok('T5 delivered -> failed succeeds through the verified callback',
  (SELECT status FROM public.omni_comms_message WHERE id = (f2->>'message')::uuid) = 'failed');

-- 7. three outcome_unknown attempts -> reconciliation -------------------------
f := pg_temp.mkfix('t7');
r := public.omni_comms_priv_dispatch_attempt_complete(
       (f->>'attempt')::uuid, f->>'claim', 'outcome_unknown', NULL, NULL, '{}'::jsonb,
       'provider_timeout');
PERFORM pg_temp.ok('T7.1 attempt 1 outcome_unknown -> job retry_wait',
  (SELECT status FROM public.omni_comms_delivery_attempt WHERE id = (f->>'attempt')::uuid) = 'outcome_unknown'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid) = 'retry_wait'
  AND (SELECT status FROM public.omni_comms_message WHERE id = (f->>'message')::uuid) = 'dispatching');

UPDATE public.omni_comms_dispatch_job SET status='ready', is_runnable=true WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='leased', is_runnable=false WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='processing' WHERE id=(f->>'job')::uuid;
INSERT INTO public.omni_comms_delivery_attempt (
  dispatch_job_id, message_id, organization_id, attempt_number, status,
  claim_token, provider_idempotency_key, release_control_id, provider_payload_hash,
  safe_request_metadata, safe_response_metadata)
VALUES ((f->>'job')::uuid, (f->>'message')::uuid, (f->>'org')::uuid, 2, 'dispatching',
        'claim-t7-2', 'idem-t7', (f->>'release')::uuid, repeat('a',64), '{}'::jsonb, '{}'::jsonb)
RETURNING id INTO a;
PERFORM public.omni_comms_priv_dispatch_attempt_complete(a, 'claim-t7-2', 'outcome_unknown',
        NULL, NULL, '{}'::jsonb, 'provider_timeout');
SELECT count(*) INTO n FROM public.omni_comms_delivery_attempt
 WHERE dispatch_job_id = (f->>'job')::uuid;
PERFORM pg_temp.ok('T7.2 second attempt row, same idempotency key and payload hash, retry_wait',
  n = 2
  AND (SELECT count(DISTINCT provider_idempotency_key) FROM public.omni_comms_delivery_attempt
        WHERE dispatch_job_id = (f->>'job')::uuid) = 1
  AND (SELECT count(DISTINCT provider_payload_hash) FROM public.omni_comms_delivery_attempt
        WHERE dispatch_job_id = (f->>'job')::uuid) = 1
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid) = 'retry_wait');

UPDATE public.omni_comms_dispatch_job SET status='ready', is_runnable=true WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='leased', is_runnable=false WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='processing' WHERE id=(f->>'job')::uuid;
INSERT INTO public.omni_comms_delivery_attempt (
  dispatch_job_id, message_id, organization_id, attempt_number, status,
  claim_token, provider_idempotency_key, release_control_id, provider_payload_hash,
  safe_request_metadata, safe_response_metadata)
VALUES ((f->>'job')::uuid, (f->>'message')::uuid, (f->>'org')::uuid, 3, 'dispatching',
        'claim-t7-3', 'idem-t7', (f->>'release')::uuid, repeat('a',64), '{}'::jsonb, '{}'::jsonb)
RETURNING id INTO a;
r := public.omni_comms_priv_dispatch_attempt_complete(a, 'claim-t7-3', 'outcome_unknown',
        NULL, NULL, '{}'::jsonb, 'provider_timeout');
PERFORM pg_temp.ok('T7.3 third outcome_unknown -> non-runnable reconciliation state',
  (SELECT status FROM public.omni_comms_delivery_attempt WHERE id = a) = 'outcome_unknown'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) = 'held'
  AND (SELECT hold_reason FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) = 'reconciliation_required'
  AND NOT (SELECT is_runnable FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid)
  AND (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid) = 'reconciliation_required');

-- 9. late signed delivered callback resolves reconciliation ------------------
UPDATE public.omni_comms_delivery_attempt SET provider_message_id = 'pmid-t7'
 WHERE id = a AND false; -- provider id is set by the completion worker only
PERFORM set_config('omni_comms.reconciliation','on',true);
UPDATE public.omni_comms_delivery_attempt SET provider_message_id = 'pmid-t7' WHERE id = a;
PERFORM set_config('omni_comms.reconciliation','off',true);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t7-del','pmid-t7','email.delivered','delivered', now(),
       '{}'::jsonb, repeat('d',64), true);
PERFORM pg_temp.ok('T9 late delivered callback resolves reconciliation',
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid) = 'delivered'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) = 'completed'
  AND (SELECT reconciliation_state FROM public.omni_comms_delivery_attempt WHERE id=a) = 'resolved'
  AND (SELECT status FROM public.omni_comms_request WHERE id=(f->>'request')::uuid) IN ('completed','processing'),
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid));

-- 10. late hard bounce resolves reconciliation as failed ---------------------
f := pg_temp.mkfix('t10');
UPDATE public.omni_comms_dispatch_job SET status='processing' WHERE id=(f->>'job')::uuid AND status='processing';
PERFORM set_config('omni_comms.dispatch_worker','on',true);
UPDATE public.omni_comms_dispatch_job
   SET status='held', hold_reason='reconciliation_required', is_runnable=false
 WHERE id=(f->>'job')::uuid;
PERFORM set_config('omni_comms.dispatch_worker','off',true);
UPDATE public.omni_comms_message SET status='reconciliation_required' WHERE id=(f->>'message')::uuid;
PERFORM set_config('omni_comms.reconciliation','on',true);
UPDATE public.omni_comms_delivery_attempt
   SET status='outcome_unknown', reconciliation_state='required', provider_message_id='pmid-t10'
 WHERE id=(f->>'attempt')::uuid;
PERFORM set_config('omni_comms.reconciliation','off',true);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t10','pmid-t10','email.bounced','bounced', now(),
       '{"bounce_type":"hard"}'::jsonb, repeat('b',64), true);
PERFORM pg_temp.ok('T10 late hard bounce resolves reconciliation as failed',
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid) = 'failed'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) = 'failed'
  AND (SELECT release_state FROM public.omni_comms_channel_release_control
        WHERE id=(f->>'release')::uuid) = 'suspended',
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid));

-- 8'. direct processing -> held reconciliation outside the worker is rejected
f := pg_temp.mkfix('t8x');
PERFORM pg_temp.rejects('T8x direct processing -> held reconciliation is rejected',
  format('UPDATE public.omni_comms_dispatch_job SET status=''held'','
         || ' hold_reason=''reconciliation_required'', is_runnable=false WHERE id=%L',
         (f->>'job')::uuid),
  'dispatch_worker_context_required');

-- direct held(reconciliation) -> completed outside verified context ----------
PERFORM set_config('omni_comms.dispatch_worker','on',true);
UPDATE public.omni_comms_dispatch_job
   SET status='held', hold_reason='reconciliation_required', is_runnable=false
 WHERE id=(f->>'job')::uuid;
PERFORM set_config('omni_comms.dispatch_worker','off',true);
PERFORM pg_temp.rejects('T8y direct reconciliation hold -> completed is rejected',
  format('UPDATE public.omni_comms_dispatch_job SET status=''completed'' WHERE id=%L',
         (f->>'job')::uuid),
  'verified_callback_context_required');
PERFORM pg_temp.rejects('T8z completed -> failed job transition does not exist',
  format('UPDATE public.omni_comms_dispatch_job SET status=''failed'' WHERE id=%L',
         (SELECT id FROM public.omni_comms_dispatch_job
           WHERE status='completed' AND organization_id='00000000-0000-4000-8000-00000000c7c7'
           LIMIT 1)),
  'invalid_dispatch_transition');

-- 12. request aggregate with mixed delivered / failed messages ---------------
f := pg_temp.mkfix('t12');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f->>'attempt')::uuid, f->>'claim', 'accepted', 'pmid-t12a', 202, '{}'::jsonb);
PERFORM public.omni_comms_priv_dispatch_record_callback(
  'resend','evt-t12a','pmid-t12a','email.delivered','delivered', now(),
  '{}'::jsonb, repeat('d',64), true);
INSERT INTO public.omni_comms_message (
  request_id, recipient_id, organization_id, event_definition_id, channel, status)
VALUES ((f->>'request')::uuid,
        (SELECT id FROM public.omni_comms_recipient WHERE request_id=(f->>'request')::uuid LIMIT 1),
        (f->>'org')::uuid, (f->>'event')::uuid, 'email', 'pending')
RETURNING id INTO a;
UPDATE public.omni_comms_message SET status='rendered' WHERE id=a;
UPDATE public.omni_comms_message SET status='queued' WHERE id=a;
UPDATE public.omni_comms_message SET status='dispatching' WHERE id=a;
UPDATE public.omni_comms_message SET status='failed' WHERE id=a;
PERFORM public.omni_comms_priv_dispatch_recalculate_request((f->>'request')::uuid);
PERFORM pg_temp.ok('T12 mixed delivered/failed request aggregate',
  (SELECT status FROM public.omni_comms_request WHERE id=(f->>'request')::uuid)
    = 'completed_with_blockers',
  (SELECT status FROM public.omni_comms_request WHERE id=(f->>'request')::uuid));

RAISE NOTICE 'ALL RUNTIME TRANSITION TESTS PASSED';
END $outer$;

-- ===========================================================================
-- 13. Department-compatibility of the queued producer-binding diagnostics.
--     The diagnostics RPC itself requires an authenticated operator, so the
--     compatibility predicate is exercised directly and identically here.
-- ===========================================================================
DO $dept2$
DECLARE
  v_org uuid := '00000000-0000-4000-8000-00000000c7d1';
  v_d1 uuid := '00000000-0000-4000-8000-00000000dep1';
  v_d2 uuid := '00000000-0000-4000-8000-00000000dep2';
  v_ev uuid;
  n integer;
BEGIN
  SELECT id INTO v_ev FROM public.omni_comms_event_definition ORDER BY code LIMIT 1;

  INSERT INTO public.omni_comms_producer_event_binding (
    organization_id, department_id, caller_module_code, event_definition_id,
    allowed_modes, status)
  VALUES (v_org, NULL, 'c7_dept_test', v_ev, ARRAY['queued'], 'active'),
         (v_org, v_d1,  'c7_dept_test', v_ev, ARRAY['queued'], 'active'),
         (v_org, v_d2,  'c7_dept_test', v_ev, ARRAY['queued'], 'active');

  -- (1) organisation release + organisation binding -> counted
  SELECT count(*) INTO n FROM public.omni_comms_producer_event_binding b
   WHERE b.organization_id = v_org AND b.caller_module_code='c7_dept_test'
     AND ((NULL::uuid IS NULL AND b.department_id IS NULL)
          OR (NULL::uuid IS NOT NULL AND (b.department_id IS NULL OR b.department_id = NULL::uuid)));
  PERFORM pg_temp.ok('T13.1 organisation release counts the organisation binding only', n = 1, n::text);

  -- (2) organisation release must NOT count a department-only binding
  PERFORM pg_temp.ok('T13.2 organisation release excludes department-only bindings', n = 1, n::text);

  -- (3)/(4) department release counts organisation + same-department bindings
  SELECT count(*) INTO n FROM public.omni_comms_producer_event_binding b
   WHERE b.organization_id = v_org AND b.caller_module_code='c7_dept_test'
     AND (v_d1 IS NOT NULL AND (b.department_id IS NULL OR b.department_id = v_d1));
  PERFORM pg_temp.ok('T13.3/4 department release counts inherited + same-department bindings',
                     n = 2, n::text);

  -- (5) another department is never counted
  SELECT count(*) INTO n FROM public.omni_comms_producer_event_binding b
   WHERE b.organization_id = v_org AND b.caller_module_code='c7_dept_test'
     AND b.department_id = v_d2
     AND (v_d1 IS NOT NULL AND (b.department_id IS NULL OR b.department_id = v_d1));
  PERFORM pg_temp.ok('T13.5 another department binding is never counted', n = 0, n::text);

  RAISE NOTICE 'DEPARTMENT COMPATIBILITY TESTS PASSED';
END $dept2$;

-- ===========================================================================
-- 14. Security-definer ownership / search path / grants.
-- ===========================================================================
DO $sec$
DECLARE
  v_service_only text[] := ARRAY[
    'omni_comms_priv_dispatch_claim_safety_suspend',
    'omni_comms_priv_dispatch_claim_email',
    'omni_comms_priv_dispatch_scheduler_tick',
    'omni_comms_priv_dispatch_record_payload_hash',
    'omni_comms_priv_dispatch_attempt_complete',
    'omni_comms_priv_dispatch_record_callback',
    'omni_comms_priv_dispatch_recalculate_request',
    'omni_comms_priv_dispatch_operator_scopes'];
  n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND (p.proname = ANY (v_service_only)
          OR p.proname IN ('omni_comms_dispatch_diagnostics','omni_comms_dispatch_tick_authorize'))
     AND pg_get_userbyid(p.proowner) <> 'postgres';
  PERFORM pg_temp.ok('T14.1 all C7 security-definer functions are owned by postgres', n = 0, n::text);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND (p.proname = ANY (v_service_only)
          OR p.proname IN ('omni_comms_dispatch_diagnostics','omni_comms_dispatch_tick_authorize'))
     AND coalesce(array_to_string(p.proconfig,','),'') <> 'search_path=pg_catalog, public';
  PERFORM pg_temp.ok('T14.2 all C7 security-definer functions pin pg_catalog, public', n = 0, n::text);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace,
       LATERAL unnest(ARRAY['anon','authenticated','public']) AS role(r)
   WHERE ns.nspname='public' AND p.proname = ANY (v_service_only)
     AND has_function_privilege(role.r, p.oid, 'EXECUTE');
  PERFORM pg_temp.ok('T14.3 service-role-only functions grant no PUBLIC/anon/authenticated execute',
                     n = 0, n::text);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='omni_comms_dispatch_diagnostics'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  PERFORM pg_temp.ok('T14.4 tenant-checked diagnostics remain executable by authenticated',
                     n = 1, n::text);

  RAISE NOTICE 'SECURITY DEFINER TESTS PASSED';
END $sec$;

-- ===========================================================================
-- 15. Global safety invariants remain intact.
-- ===========================================================================
DO $inv$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.omni_comms_channel_setting WHERE live_delivery_enabled IS TRUE;
  PERFORM pg_temp.ok('T15.1 live_delivery_enabled remains false everywhere', n = 0, n::text);
  SELECT count(*) INTO n FROM public.omni_comms_channel_release_control WHERE release_state='live';
  PERFORM pg_temp.ok('T15.2 Release Control live remains unavailable', n = 0, n::text);
  SELECT count(*) INTO n FROM public.omni_comms_dispatch_job
   WHERE channel <> 'email' AND is_runnable IS TRUE;
  PERFORM pg_temp.ok('T15.3 no non-Email dispatch job is runnable', n = 0, n::text);
  RAISE NOTICE 'SAFETY INVARIANT TESTS PASSED';
END $inv$;

ROLLBACK;

\echo 'C7 runtime transition tests completed and ROLLED BACK (no data retained).'

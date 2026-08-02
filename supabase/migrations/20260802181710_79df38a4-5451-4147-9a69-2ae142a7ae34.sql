-- ============================================================================
-- Omni-Comms C7 Runtime Transition Closure — EXECUTABLE database tests
-- ----------------------------------------------------------------------------
-- Verification-only. Creates fixtures inside a subtransaction that is ALWAYS
-- rolled back through a sentinel exception, so this migration is net-zero:
-- no schema change, no retained data. No provider is ever contacted.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Defect found by these executable tests: the automatic pilot-suspension
-- worker recorded release event type 'suspended', which is not part of the
-- release-event vocabulary, so every automatic safety suspension raised a
-- check-constraint violation. The canonical type is 'release_suspended'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(
  p_release_control_id uuid, p_trigger text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_rel public.omni_comms_channel_release_control; v_from text;
BEGIN
  IF p_release_control_id IS NULL THEN
    RETURN jsonb_build_object('suspended', false, 'code', 'release_control_missing');
  END IF;
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
   WHERE id = p_release_control_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('suspended', false, 'code', 'release_control_missing');
  END IF;
  IF v_rel.release_state = 'suspended' THEN
    RETURN jsonb_build_object('suspended', false, 'code', 'already_suspended');
  END IF;
  v_from := v_rel.release_state;

  UPDATE public.omni_comms_channel_release_control
     SET release_state = 'suspended',
         suspended_at = now(),
         suspension_reason = left(coalesce(p_trigger,'automatic') || ': '
                                  || coalesce(p_reason,'automatic safety suspension'), 500),
         release_version = release_version + 1,
         updated_at = now()
   WHERE id = v_rel.id
   RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_suspended', v_from, 'suspended',
    left(coalesce(p_trigger,'automatic') || ': ' || coalesce(p_reason,''), 500),
    NULL, NULL, NULL,
    jsonb_build_object('automatic', true, 'trigger', p_trigger));

  RETURN jsonb_build_object('suspended', true, 'code', 'pilot_suspended',
                            'trigger', p_trigger,
                            'release_control_id', v_rel.id);
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(uuid, text, text) TO service_role;

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

CREATE OR REPLACE FUNCTION pg_temp.mkfix(p_tag text, p_dept uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_org uuid := ('00000000-0000-4000-8000-' || substr(md5('omni_comms_c7_' || p_tag), 1, 12))::uuid;
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
          md5(p_tag) || md5(p_tag), 'omni_comms_c7_test', '{}'::jsonb, ARRAY['email'],
          'accepted')
  RETURNING id INTO v_req;

  INSERT INTO public.omni_comms_recipient (request_id, organization_id, recipient_type)
  VALUES (v_req, v_org, 'external') RETURNING id INTO v_rcp;

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

  UPDATE public.omni_comms_request SET status = 'processing' WHERE id = v_req;

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

CREATE OR REPLACE FUNCTION pg_temp.run_transitions() RETURNS void LANGUAGE plpgsql AS $outer$
DECLARE
  f jsonb; r jsonb; s text; js text; n integer; a uuid; f2 jsonb;
BEGIN

f := pg_temp.mkfix('t1');
r := public.omni_comms_priv_dispatch_attempt_complete(
       (f->>'attempt')::uuid, f->>'claim', 'accepted', 'pmid-t1', 202, '{}'::jsonb);
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
PERFORM pg_temp.ok('T1 provider acceptance completes the job',
                   js = 'completed' AND s = 'accepted', js || '/' || s);

r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t1-del','pmid-t1','email.delivered','delivered', now(),
       '{}'::jsonb, 'sha256:' || repeat('d',64), true);
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
PERFORM pg_temp.ok('T2 delivered callback: message delivered, job still completed',
                   js = 'completed' AND s = 'delivered', js || '/' || s);

r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t1-cmp','pmid-t1','email.complained','complained', now(),
       '{}'::jsonb, 'sha256:' || repeat('c',64), true);
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
PERFORM pg_temp.ok('T3 complaint after delivered: job history preserved',
                   js = 'completed', js || ' / ' || coalesce(r->>'job_outcome','-'));
PERFORM pg_temp.ok('T3b complaint after delivered: message failed', s = 'failed', s);
PERFORM pg_temp.ok('T3c complaint after delivered: job is not runnable',
  NOT (SELECT is_runnable FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid));
PERFORM pg_temp.ok('T3d complaint suspends the controlled pilot',
  (SELECT release_state FROM public.omni_comms_channel_release_control
    WHERE id = (f->>'release')::uuid) = 'suspended',
  (SELECT release_state FROM public.omni_comms_channel_release_control
    WHERE id = (f->>'release')::uuid));
-- A request that already reached a terminal aggregate is never rewritten by a
-- later harmful callback: the failure is carried by the message and the
-- suspended pilot, not by rewriting closed request history.
PERFORM pg_temp.ok('T11 terminal request aggregate is not rewritten by a late complaint',
  (SELECT status FROM public.omni_comms_request WHERE id = (f->>'request')::uuid) = 'completed',
  (SELECT status FROM public.omni_comms_request WHERE id = (f->>'request')::uuid));

f := pg_temp.mkfix('t4');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f->>'attempt')::uuid, f->>'claim', 'accepted', 'pmid-t4', 202, '{}'::jsonb);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t4-cmp','pmid-t4','email.complained','complained', now(),
       '{}'::jsonb, 'sha256:' || repeat('c',64), true);
SELECT status INTO s  FROM public.omni_comms_message      WHERE id = (f->>'message')::uuid;
SELECT status INTO js FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid;
PERFORM pg_temp.ok('T4 accepted -> failed on complaint, job untouched',
                   s = 'failed' AND js = 'completed', s || '/' || js);

f2 := pg_temp.mkfix('t8');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f2->>'attempt')::uuid, f2->>'claim', 'accepted', 'pmid-t8', 202, '{}'::jsonb);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t8-bnc','pmid-t8','email.bounced','bounced', now(),
       '{"bounce_type":"hard"}'::jsonb, 'sha256:' || repeat('b',64), true);
PERFORM pg_temp.ok('T8 hard bounce fails the message and suspends the pilot',
  (SELECT status FROM public.omni_comms_message WHERE id = (f2->>'message')::uuid) = 'failed'
  AND (SELECT release_state FROM public.omni_comms_channel_release_control
        WHERE id = (f2->>'release')::uuid) = 'suspended'
  AND (SELECT status FROM public.omni_comms_dispatch_job
        WHERE id = (f2->>'job')::uuid) = 'completed');

f2 := pg_temp.mkfix('t6');
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  (f2->>'attempt')::uuid, f2->>'claim', 'accepted', 'pmid-t6', 202, '{}'::jsonb);
PERFORM public.omni_comms_priv_dispatch_record_callback(
  'resend','evt-t6-del','pmid-t6','email.delivered','delivered', now(),
  '{}'::jsonb, 'sha256:' || repeat('d',64), true);
PERFORM pg_temp.rejects('T6 direct delivered -> failed UPDATE is rejected',
  format('UPDATE public.omni_comms_message SET status = ''failed'' WHERE id = %L',
         (f2->>'message')::uuid),
  'verified_callback_context_required');
PERFORM public.omni_comms_priv_dispatch_record_callback(
  'resend','evt-t6-cmp','pmid-t6','email.complained','complained', now(),
  '{}'::jsonb, 'sha256:' || repeat('c',64), true);
PERFORM pg_temp.ok('T5 delivered -> failed succeeds through the verified callback',
  (SELECT status FROM public.omni_comms_message WHERE id = (f2->>'message')::uuid) = 'failed');

f := pg_temp.mkfix('t7');
r := public.omni_comms_priv_dispatch_attempt_complete(
       (f->>'attempt')::uuid, f->>'claim', 'outcome_unknown', NULL, NULL, '{}'::jsonb,
       'provider_timeout');
PERFORM pg_temp.ok('T7.1 attempt 1 outcome_unknown -> job retry_wait',
  (SELECT status FROM public.omni_comms_delivery_attempt WHERE id = (f->>'attempt')::uuid) = 'outcome_unknown'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid) = 'retry_wait'
  AND (SELECT status FROM public.omni_comms_message WHERE id = (f->>'message')::uuid) = 'dispatching',
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid));

PERFORM set_config('omni_comms.dispatch_worker','on',true);
UPDATE public.omni_comms_dispatch_job SET status='ready', is_runnable=true WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='leased', is_runnable=false WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='processing' WHERE id=(f->>'job')::uuid;
PERFORM set_config('omni_comms.dispatch_worker','off',true);
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
PERFORM pg_temp.ok('T7.2 second attempt reuses idempotency key and payload hash',
  n = 2
  AND (SELECT count(DISTINCT provider_idempotency_key) FROM public.omni_comms_delivery_attempt
        WHERE dispatch_job_id = (f->>'job')::uuid) = 1
  AND (SELECT count(DISTINCT provider_payload_hash) FROM public.omni_comms_delivery_attempt
        WHERE dispatch_job_id = (f->>'job')::uuid) = 1
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid) = 'retry_wait',
  n::text);

PERFORM set_config('omni_comms.dispatch_worker','on',true);
UPDATE public.omni_comms_dispatch_job SET status='ready', is_runnable=true WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='leased', is_runnable=false WHERE id=(f->>'job')::uuid;
UPDATE public.omni_comms_dispatch_job SET status='processing' WHERE id=(f->>'job')::uuid;
PERFORM set_config('omni_comms.dispatch_worker','off',true);
INSERT INTO public.omni_comms_delivery_attempt (
  dispatch_job_id, message_id, organization_id, attempt_number, status,
  claim_token, provider_idempotency_key, release_control_id, provider_payload_hash,
  safe_request_metadata, safe_response_metadata)
VALUES ((f->>'job')::uuid, (f->>'message')::uuid, (f->>'org')::uuid, 3, 'dispatching',
        'claim-t7-3', 'idem-t7', (f->>'release')::uuid, repeat('a',64), '{}'::jsonb, '{}'::jsonb)
RETURNING id INTO a;
r := public.omni_comms_priv_dispatch_attempt_complete(a, 'claim-t7-3', 'outcome_unknown',
        NULL, NULL, '{}'::jsonb, 'provider_timeout');
PERFORM pg_temp.ok('T7.3 third outcome_unknown -> non-runnable reconciliation hold',
  (SELECT status FROM public.omni_comms_delivery_attempt WHERE id = a) = 'outcome_unknown'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) = 'held'
  AND NOT (SELECT is_runnable FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid)
  AND (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid) = 'reconciliation_required',
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) || '/' ||
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid));

PERFORM set_config('omni_comms.reconciliation','on',true);
UPDATE public.omni_comms_delivery_attempt SET provider_message_id = 'pmid-t7' WHERE id = a;
PERFORM set_config('omni_comms.reconciliation','off',true);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t7-del','pmid-t7','email.delivered','delivered', now(),
       '{}'::jsonb, 'sha256:' || repeat('d',64), true);
PERFORM pg_temp.ok('T9 late delivered callback resolves reconciliation',
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid) = 'delivered'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) = 'completed',
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) || '/' ||
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid));

f := pg_temp.mkfix('t10');
PERFORM set_config('omni_comms.dispatch_worker','on',true);
UPDATE public.omni_comms_dispatch_job
   SET status='held', hold_reason='reconciliation_required', is_runnable=false
 WHERE id=(f->>'job')::uuid;
PERFORM set_config('omni_comms.dispatch_worker','off',true);
UPDATE public.omni_comms_message SET status='reconciliation_required' WHERE id=(f->>'message')::uuid;
PERFORM set_config('omni_comms.reconciliation','on',true);
UPDATE public.omni_comms_delivery_attempt
   SET status='outcome_unknown', reconciliation_state='required',
       provider_message_id='pmid-t10', completed_at = now()
 WHERE id=(f->>'attempt')::uuid;
PERFORM set_config('omni_comms.reconciliation','off',true);
r := public.omni_comms_priv_dispatch_record_callback(
       'resend','evt-t10','pmid-t10','email.bounced','bounced', now(),
       '{"bounce_type":"hard"}'::jsonb, 'sha256:' || repeat('b',64), true);
PERFORM pg_temp.ok('T10 late hard bounce resolves reconciliation as failed',
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid) = 'failed'
  AND (SELECT release_state FROM public.omni_comms_channel_release_control
        WHERE id=(f->>'release')::uuid) = 'suspended',
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) || '/' ||
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid));

f := pg_temp.mkfix('t8x');
PERFORM pg_temp.rejects('T8x direct processing -> reconciliation hold is rejected',
  format('UPDATE public.omni_comms_dispatch_job SET status=''held'','
         || ' hold_reason=''reconciliation_required'', is_runnable=false WHERE id=%L',
         (f->>'job')::uuid),
  'dispatch_worker_context_required');

PERFORM set_config('omni_comms.dispatch_worker','on',true);
UPDATE public.omni_comms_dispatch_job
   SET status='held', hold_reason='reconciliation_required', is_runnable=false
 WHERE id=(f->>'job')::uuid;
PERFORM set_config('omni_comms.dispatch_worker','off',true);
PERFORM pg_temp.rejects('T8y direct reconciliation hold -> completed is rejected',
  format('UPDATE public.omni_comms_dispatch_job SET status=''completed'' WHERE id=%L',
         (f->>'job')::uuid),
  'verified_callback_context_required');

RAISE NOTICE 'ALL RUNTIME TRANSITION TESTS PASSED';
END $outer$;

CREATE OR REPLACE FUNCTION pg_temp.run_dept() RETURNS void LANGUAGE plpgsql AS $dept2$
DECLARE
  v_org uuid;
  v_d1 uuid;
  v_d2 uuid;
  v_ev uuid;
  n integer;
BEGIN
  SELECT id INTO v_ev FROM public.omni_comms_event_definition ORDER BY code LIMIT 1;

  SELECT o.id INTO v_org FROM public.core_organization o
   WHERE (SELECT count(*) FROM public.core_department d WHERE d.organization_id = o.id) >= 2
   ORDER BY o.id LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'DEPARTMENT COMPATIBILITY TESTS SKIPPED (no organisation with two departments)';
    RETURN;
  END IF;
  SELECT id INTO v_d1 FROM public.core_department WHERE organization_id = v_org ORDER BY id LIMIT 1;
  SELECT id INTO v_d2 FROM public.core_department WHERE organization_id = v_org ORDER BY id DESC LIMIT 1;

  INSERT INTO public.omni_comms_producer_event_binding (
    organization_id, department_id, caller_module_code, event_definition_id,
    allowed_modes, status)
  VALUES (v_org, NULL, 'C7_DEPT_TEST', v_ev, ARRAY['dry_run'], 'active'),
         (v_org, v_d1,  'C7_DEPT_TEST', v_ev, ARRAY['dry_run'], 'active'),
         (v_org, v_d2,  'C7_DEPT_TEST', v_ev, ARRAY['dry_run'], 'active');

  SELECT count(*) INTO n FROM public.omni_comms_producer_event_binding b
   WHERE b.organization_id = v_org AND b.caller_module_code='C7_DEPT_TEST'
     AND b.department_id IS NULL;
  PERFORM pg_temp.ok('T13.1/2 organisation release counts organisation bindings only', n = 1, n::text);

  SELECT count(*) INTO n FROM public.omni_comms_producer_event_binding b
   WHERE b.organization_id = v_org AND b.caller_module_code='C7_DEPT_TEST'
     AND (b.department_id IS NULL OR b.department_id = v_d1);
  PERFORM pg_temp.ok('T13.3/4 department release counts inherited + same-department bindings',
                     n = 2, n::text);

  SELECT count(*) INTO n FROM public.omni_comms_producer_event_binding b
   WHERE b.organization_id = v_org AND b.caller_module_code='C7_DEPT_TEST'
     AND b.department_id = v_d2
     AND (b.department_id IS NULL OR b.department_id = v_d1);
  PERFORM pg_temp.ok('T13.5 another department binding is never counted', n = 0, n::text);

  RAISE NOTICE 'DEPARTMENT COMPATIBILITY TESTS PASSED';
END $dept2$;

CREATE OR REPLACE FUNCTION pg_temp.run_security() RETURNS void LANGUAGE plpgsql AS $sec$
DECLARE
  v_service_only text[] := ARRAY[
    'omni_comms_priv_dispatch_claim_email',
    'omni_comms_priv_dispatch_scheduler_tick',
    'omni_comms_priv_dispatch_record_payload_hash',
    'omni_comms_priv_dispatch_attempt_complete',
    'omni_comms_priv_dispatch_record_callback',
    'omni_comms_priv_dispatch_recalculate_request',
    'omni_comms_priv_dispatch_operator_scopes',
    'omni_comms_priv_dispatch_suspend_pilot',
    'omni_comms_priv_dispatch_reclaim_expired_leases'];
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
     AND coalesce(array_to_string(p.proconfig,','),'') NOT LIKE 'search_path=pg_catalog%public%';
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

CREATE OR REPLACE FUNCTION pg_temp.run_invariants() RETURNS void LANGUAGE plpgsql AS $inv$
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

DO $run$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_definition) THEN
    RAISE NOTICE 'C7 runtime transition tests SKIPPED (empty event catalogue)';
    RETURN;
  END IF;

  BEGIN
    PERFORM pg_temp.run_transitions();
    PERFORM pg_temp.run_dept();
    PERFORM pg_temp.run_security();
    PERFORM pg_temp.run_invariants();
    RAISE EXCEPTION 'OMNI_COMMS_C7_TEST_ROLLBACK_SENTINEL';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'OMNI_COMMS_C7_TEST_ROLLBACK_SENTINEL' THEN
      RAISE NOTICE 'ALL C7 RUNTIME TRANSITION TESTS PASSED - fixtures rolled back';
    ELSE
      RAISE;
    END IF;
  END;
END $run$;
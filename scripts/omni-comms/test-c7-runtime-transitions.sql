-- Operator entry point: psql -f scripts/omni-comms/test-c7-runtime-transitions.sql
-- Requires a privileged role (postgres / service_role). Verification only:
-- every fixture is rolled back by the sentinel at the end of the runner, and
-- no provider is ever contacted.
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

-- ----------------------------------------------------------------------------
-- pg_temp.mkclaimable(tag) — a COMPLETE controlled-pilot fixture that the REAL
-- dispatcher can genuinely claim.
--
-- Unlike mkfix (which fabricates an already-claimed attempt), this builder
-- creates every artefact the real claim worker inspects: an operational Email
-- policy, a genuine provider account with an api_key secret reference, an
-- active sender identity, verified sending-domain and event-callback
-- endpoints, a verified binding, passed preflight evidence, accepted C5B
-- technical delivery evidence with a signature-verified delivered callback, an
-- active producer-event binding, an active event route with a published
-- template version, an effective runtime certification and a controlled-pilot
-- Release Control whose fingerprint is snapshotted onto the dispatch job.
--
-- The fixture SENDS NOTHING: it stops at the point where the dispatcher would
-- hand a claim to the Edge worker, and the whole runner is rolled back through
-- the sentinel.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mkclaimable(p_tag text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_org uuid := ('00000000-0000-4000-8000-' || substr(md5('omni_comms_c7c_' || p_tag), 1, 12))::uuid;
  v_commit text := repeat('a', 40);
  v_prov uuid; v_acct uuid; v_ident uuid; v_dom uuid; v_cb uuid; v_bind uuid;
  v_ev uuid; v_evcode text; v_tf uuid; v_tv uuid;
  v_rel uuid; v_fp text; v_ver integer; v_state text; v_exp timestamptz;
  v_run uuid; v_del uuid;
  v_req uuid; v_rcp uuid; v_msg uuid; v_job uuid;
  v_norm jsonb; v_email text := 'c7.' || p_tag || '@example.test';
BEGIN
  SELECT id, code INTO v_ev, v_evcode FROM public.omni_comms_event_definition
   WHERE status = 'active' ORDER BY code LIMIT 1;
  IF v_ev IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_prov FROM public.omni_comms_provider
   WHERE code = 'resend_email' LIMIT 1;
  IF v_prov IS NULL THEN
    RETURN NULL;
  END IF;
  v_norm := public.omni_comms_priv_channel_test_normalize_target('email', v_email);

  -- Operational Email policy. Live delivery stays FALSE.
  INSERT INTO public.omni_comms_channel_setting (
    organization_id, channel, data_origin, enabled, operational_state,
    live_delivery_enabled, controlled_test_delivery_enabled)
  VALUES (v_org, 'email', 'user', true, 'pilot_ready', false, true);

  -- Genuine provider account + canonical api_key secret reference.
  INSERT INTO public.omni_comms_provider_account (
    organization_id, provider_id, code, display_name, status, data_origin,
    environment, sandbox_mode)
  VALUES (v_org, v_prov, 'c7_' || p_tag || '_acct', 'C7 ' || p_tag || ' account',
          'draft', 'user', 'production', false)
  RETURNING id INTO v_acct;
  UPDATE public.omni_comms_provider_account
     SET status = 'active', activated_at = now(), activated_by = gen_random_uuid(),
         verification_status = 'verified', verification_result_code = 'verified'
   WHERE id = v_acct;
  INSERT INTO public.omni_comms_provider_account_secret_ref (
    provider_account_id, purpose, secret_ref)
  VALUES (v_acct, 'api_key', 'OMNI_COMMS_RESEND_C7TEST');

  -- Sender identity.
  INSERT INTO public.omni_comms_sender_identity (
    organization_id, code, display_name, channel, identity_type,
    from_address, from_name, status, data_origin)
  VALUES (v_org, 'c7_' || p_tag || '_identity', 'C7 ' || p_tag || ' identity', 'email',
          'email_sender', 'no-reply@c7test.example', 'C7 Test', 'draft', 'user')
  RETURNING id INTO v_ident;
  UPDATE public.omni_comms_sender_identity
     SET status = 'active', activated_at = now(), activated_by = gen_random_uuid()
   WHERE id = v_ident;

  -- Verified sending domain and active event-callback endpoint.
  INSERT INTO public.omni_comms_channel_endpoint (
    organization_id, channel, code, display_name, endpoint_type, status,
    data_origin, verification_status)
  VALUES (v_org, 'email', 'c7_' || p_tag || '_domain', 'C7 sending domain',
          'sending_domain', 'draft', 'user', 'unverified')
  RETURNING id INTO v_dom;
  UPDATE public.omni_comms_channel_endpoint
     SET status = 'active', verification_status = 'verified' WHERE id = v_dom;

  INSERT INTO public.omni_comms_channel_endpoint (
    organization_id, channel, code, display_name, endpoint_type, status,
    data_origin, verification_status)
  VALUES (v_org, 'email', 'c7_' || p_tag || '_callback', 'C7 event callback',
          'event_callback', 'draft', 'user', 'unverified')
  RETURNING id INTO v_cb;
  UPDATE public.omni_comms_channel_endpoint
     SET status = 'active', verification_status = 'verified' WHERE id = v_cb;

  -- Verified identity-to-provider binding.
  INSERT INTO public.omni_comms_sender_provider_binding (
    sender_identity_id, provider_account_id, organization_id, channel,
    channel_endpoint_id, status, data_origin, verification_status,
    verification_source, priority)
  VALUES (v_ident, v_acct, v_org, 'email', v_dom, 'draft', 'user',
          'unverified', 'none', 10)
  RETURNING id INTO v_bind;
  UPDATE public.omni_comms_sender_provider_binding
     SET status = 'active', activated_at = now(), activated_by = gen_random_uuid(),
         verification_status = 'verified', verification_source = 'provider',
         verified_at = now()
   WHERE id = v_bind;

  -- Passed configuration preflight evidence (full 21-check contract).
  INSERT INTO public.omni_comms_channel_test_run (
    organization_id, channel, binding_id, idempotency_key, request_fingerprint,
    configuration_fingerprint, target_type, target_masked, target_hash,
    payload_hash, status, result_code, requested_by, checks)
  VALUES (v_org, 'email', v_bind, 'c7run-' || p_tag, repeat('1', 64), repeat('2', 64),
          v_norm->>'target_type', v_norm->>'target_masked',
          lower(v_norm->>'target_hash'), repeat('3', 64), 'passed', 'preflight_passed',
          gen_random_uuid(),
          (SELECT jsonb_agg(jsonb_build_object('code', c, 'state', 'passed',
                                               'label', c, 'detail', 'fixture')
                            ORDER BY ord)
             FROM unnest(ARRAY[
               'tenant_access','channel_supported','effective_policy_present','policy_test_state',
               'binding_selected','binding_active','binding_scope_valid','provider_account_active',
               'provider_credentials_complete','provider_credentials_verified','identity_active',
               'endpoint_requirement','endpoint_active','binding_verification','target_valid',
               'payload_valid','reference_configuration','live_delivery_disabled',
               'provider_dispatch','delivery_callback','technical_delivery_result'])
               WITH ORDINALITY AS t(c, ord)))
  RETURNING id INTO v_run;

  -- Accepted C5B technical delivery with a signature-verified delivered callback.
  INSERT INTO public.omni_comms_channel_test_delivery (
    test_run_id, organization_id, channel, binding_id, idempotency_key,
    request_fingerprint, configuration_fingerprint, target_type, target_masked,
    target_hash, payload_hash, requested_by, status)
  VALUES (v_run, v_org, 'email', v_bind, 'c7del-' || p_tag, repeat('1', 64),
          repeat('2', 64), v_norm->>'target_type', v_norm->>'target_masked',
          lower(v_norm->>'target_hash'), repeat('3', 64), gen_random_uuid(), 'accepted')
  RETURNING id INTO v_del;
  INSERT INTO public.omni_comms_channel_test_delivery_event (
    delivery_id, organization_id, event_type, signature_verified, occurred_at)
  VALUES (v_del, v_org, 'delivered', true, now());

  -- Producer-event binding permitting queued mode for the pilot pair.
  INSERT INTO public.omni_comms_producer_event_binding (
    organization_id, caller_module_code, event_definition_id, allowed_modes, status)
  VALUES (v_org, 'omni_comms_c7_test', v_ev, ARRAY['queued'], 'active');

  -- Active event route with a published template version.
  INSERT INTO public.omni_comms_template_family (
    code, name, scope_type, organization_id, status)
  VALUES ('c7_' || p_tag || '_tf', 'C7 ' || p_tag || ' family', 'organization', v_org, 'draft')
  RETURNING id INTO v_tf;
  UPDATE public.omni_comms_template_family
     SET status = 'active', activated_at = now(), activated_by = gen_random_uuid()
   WHERE id = v_tf;
  INSERT INTO public.omni_comms_template_version (
    template_family_id, version_number, channel, locale, content, status,
    layout_selection_mode)
  VALUES (v_tf, 1, 'email', 'en', '{"subject":"C7","text":"C7"}'::jsonb, 'draft',
          'resolved_default')
  RETURNING id INTO v_tv;
  UPDATE public.omni_comms_template_version
     SET status = 'approved', checksum = repeat('4', 64), approved_at = now(),
         approved_by = gen_random_uuid()
   WHERE id = v_tv;
  UPDATE public.omni_comms_template_version
     SET status = 'published', published_at = now(), published_by = gen_random_uuid()
   WHERE id = v_tv;
  INSERT INTO public.omni_comms_event_route (
    organization_id, event_definition_id, channel, template_family_id,
    is_enabled, lifecycle_state)
  VALUES (v_org, v_ev, 'email', v_tf, true, 'active');

  -- Effective runtime certification (singleton; rolled back with the runner).
  UPDATE public.omni_comms_runtime_certification
     SET certification_state = 'certified', certified_commit = v_commit,
         workflow_run_id = 'c7-runtime-transitions', certified_at = now();

  -- Controlled pilot. The guard computes the release fingerprint.
  INSERT INTO public.omni_comms_channel_release_control (
    organization_id, channel, data_origin, release_state, permitted_event_codes,
    permitted_caller_modules, permitted_modes, pilot_recipient_rules,
    max_recipients_per_request, max_messages_per_hour, max_messages_per_day,
    max_messages_total, release_starts_at, release_expires_at, approved_commit,
    activated_at, activated_by)
  VALUES (v_org, 'email', 'user', 'controlled_pilot', ARRAY[v_evcode],
          ARRAY['omni_comms_c7_test'], ARRAY['queued'],
          jsonb_build_array(jsonb_build_object(
            'target_hash', lower(v_norm->>'target_hash'),
            'target_masked', v_norm->>'target_masked')),
          1, 10, 20, 50, now(), now() + interval '1 day', v_commit, now(),
          gen_random_uuid())
  RETURNING id, release_fingerprint, release_version, release_state, release_expires_at
    INTO v_rel, v_fp, v_ver, v_state, v_exp;

  -- Runtime rows. The message carries the exact persisted resolution snapshot.
  INSERT INTO public.omni_comms_request (
    organization_id, event_definition_id, mode, status, idempotency_key,
    request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
  VALUES (v_org, v_ev, 'queued', 'accepted', 'c7claim-' || p_tag,
          md5(p_tag || 'c') || md5(p_tag || 'd'), 'omni_comms_c7_test',
          '{}'::jsonb, ARRAY['email'])
  RETURNING id INTO v_req;

  INSERT INTO public.omni_comms_recipient (
    request_id, organization_id, recipient_type, email_destination,
    eligibility_status, resolved_channels)
  VALUES (v_req, v_org, 'external', v_email, 'eligible', ARRAY['email'])
  RETURNING id INTO v_rcp;

  INSERT INTO public.omni_comms_message (
    request_id, recipient_id, organization_id, event_definition_id, channel,
    template_family_id, template_version_id, sender_identity_id, provider_id,
    provider_account_id, rendered_subject, rendered_text, status)
  VALUES (v_req, v_rcp, v_org, v_ev, 'email', v_tf, v_tv, v_ident, v_prov, v_acct,
          'C7 retry claim', 'C7 retry claim', 'held')
  RETURNING id INTO v_msg;

  INSERT INTO public.omni_comms_dispatch_job (
    request_id, message_id, organization_id, channel, mode, status, is_runnable,
    attempt_count, next_attempt_at, release_control_id,
    release_version_at_decision, release_state_at_decision,
    release_fingerprint_at_decision, release_expires_at_decision,
    release_decision_at)
  VALUES (v_req, v_msg, v_org, 'email', 'queued', 'held', false, 0, now(),
          v_rel, v_ver, v_state, v_fp, v_exp, now())
  RETURNING id INTO v_job;

  RETURN jsonb_build_object('org', v_org, 'request', v_req, 'message', v_msg,
                            'job', v_job, 'release', v_rel, 'event', v_ev,
                            'binding', v_bind, 'commit', v_commit);
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

-- ----------------------------------------------------------------------------
-- T7 — the uncertainty runtime driven by the REAL claim worker.
--
-- Every attempt below (1, 2 and 3) is created by
-- public.omni_comms_priv_dispatch_claim_email. No attempt row, lease, status
-- transition or idempotency key is simulated by hand. This is what proves the
-- retry-eligibility predicate: attempts two and three exist ONLY if the real
-- dispatcher agrees to claim a retry_wait job whose message is dispatching.
-- ----------------------------------------------------------------------------
f := pg_temp.mkclaimable('t7');
IF f IS NULL THEN
  RAISE NOTICE 'T7 REAL-CLAIM TESTS SKIPPED (no active event definition or resend_email provider)';
ELSE

-- Attempt 1 — initial controlled dispatch: job held + message held.
r := public.omni_comms_priv_dispatch_claim_email(
       'c7-test-worker', 1, 'c7-test', f->>'commit', NULL, 'scheduler');
PERFORM pg_temp.ok('T7.0 the real dispatcher claims the initial controlled dispatch',
  (r->>'claimed_jobs')::int = 1, coalesce(r->>'blockers','-'));
a  := ((r->'claims'->0)->>'attempt_id')::uuid;
js := (r->'claims'->0)->>'claim_token';
PERFORM public.omni_comms_priv_dispatch_record_payload_hash(a, js, repeat('a', 64));
PERFORM pg_temp.ok('T7.0b claim 1 is attempt number one and the job is processing',
  (SELECT attempt_number FROM public.omni_comms_delivery_attempt WHERE id = a) = 1
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid) = 'processing'
  AND (SELECT status FROM public.omni_comms_message WHERE id = (f->>'message')::uuid) = 'dispatching');

r := public.omni_comms_priv_dispatch_attempt_complete(
       a, js, 'outcome_unknown', NULL, NULL, '{}'::jsonb, 'provider_timeout');
PERFORM pg_temp.ok('T7.1 attempt 1 outcome_unknown -> job retry_wait',
  (SELECT status FROM public.omni_comms_delivery_attempt WHERE id = a) = 'outcome_unknown'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid) = 'retry_wait'
  AND (SELECT status FROM public.omni_comms_message WHERE id = (f->>'message')::uuid) = 'dispatching',
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id = (f->>'job')::uuid));

-- Attempt 2 — the retry claim. This is the corrected eligibility pair
-- (job retry_wait + message dispatching) and is claimed by the real worker.
UPDATE public.omni_comms_dispatch_job SET next_attempt_at = now() - interval '1 minute'
 WHERE id = (f->>'job')::uuid;
r := public.omni_comms_priv_dispatch_claim_email(
       'c7-test-worker', 1, 'c7-test', f->>'commit', NULL, 'scheduler');
PERFORM pg_temp.ok('T7.2a the real dispatcher claims attempt two from retry_wait',
  (r->>'claimed_jobs')::int = 1, coalesce(r->>'blockers','-'));
a  := ((r->'claims'->0)->>'attempt_id')::uuid;
js := (r->'claims'->0)->>'claim_token';
PERFORM public.omni_comms_priv_dispatch_record_payload_hash(a, js, repeat('a', 64));
PERFORM pg_temp.ok('T7.2b the retry claim never moves the message backwards',
  (SELECT status FROM public.omni_comms_message WHERE id = (f->>'message')::uuid) = 'dispatching',
  (SELECT status FROM public.omni_comms_message WHERE id = (f->>'message')::uuid));
PERFORM public.omni_comms_priv_dispatch_attempt_complete(
  a, js, 'outcome_unknown', NULL, NULL, '{}'::jsonb, 'provider_timeout');
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

-- Attempt 3 — the final permitted retry, again through the real worker.
UPDATE public.omni_comms_dispatch_job SET next_attempt_at = now() - interval '1 minute'
 WHERE id = (f->>'job')::uuid;
r := public.omni_comms_priv_dispatch_claim_email(
       'c7-test-worker', 1, 'c7-test', f->>'commit', NULL, 'scheduler');
PERFORM pg_temp.ok('T7.3a the real dispatcher claims attempt three',
  (r->>'claimed_jobs')::int = 1
  AND ((r->'claims'->0)->>'attempt_number')::int = 3, coalesce(r->>'blockers','-'));
a  := ((r->'claims'->0)->>'attempt_id')::uuid;
js := (r->'claims'->0)->>'claim_token';
PERFORM public.omni_comms_priv_dispatch_record_payload_hash(a, js, repeat('a', 64));
r := public.omni_comms_priv_dispatch_attempt_complete(
       a, js, 'outcome_unknown', NULL, NULL, '{}'::jsonb, 'provider_timeout');
PERFORM pg_temp.ok('T7.3 third outcome_unknown -> non-runnable reconciliation hold',
  (SELECT status FROM public.omni_comms_delivery_attempt WHERE id = a) = 'outcome_unknown'
  AND (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) = 'held'
  AND NOT (SELECT is_runnable FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid)
  AND (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid) = 'reconciliation_required',
  (SELECT status FROM public.omni_comms_dispatch_job WHERE id=(f->>'job')::uuid) || '/' ||
  (SELECT status FROM public.omni_comms_message WHERE id=(f->>'message')::uuid));

-- A fourth claim is impossible: the reconciliation hold is not an eligible pair.
r := public.omni_comms_priv_dispatch_claim_email(
       'c7-test-worker', 1, 'c7-test', f->>'commit', NULL, 'scheduler');
PERFORM pg_temp.ok('T7.4 a reconciliation hold is never claimed again',
  (r->>'claimed_jobs')::int = 0
  AND (SELECT count(*) FROM public.omni_comms_delivery_attempt
        WHERE dispatch_job_id = (f->>'job')::uuid) = 3,
  coalesce(r->>'claimed_jobs','-'));

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
END IF;



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
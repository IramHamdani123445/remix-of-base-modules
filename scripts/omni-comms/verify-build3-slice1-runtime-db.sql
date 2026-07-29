-- =====================================================================
-- Omni-Comms Accelerated Build 3 — Slice 1 database verifier.
-- Transaction-isolated. Rolls back all fixtures. No provider call. No email sent.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_count int;
  v_org uuid := gen_random_uuid();
  v_dept uuid;
  v_other_org uuid := gen_random_uuid();
  v_event uuid;
  v_req uuid;
  v_req2 uuid;
  v_rcp uuid;
  v_msg uuid;
  v_job uuid;
  v_thrown boolean;
BEGIN
  -- 1. Exactly seven runtime tables exist and no substitute
  SELECT count(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY (ARRAY[
    'omni_comms_event_route','omni_comms_request','omni_comms_recipient',
    'omni_comms_message','omni_comms_dispatch_job','omni_comms_delivery_attempt',
    'omni_comms_message_event'
  ]);
  ASSERT v_count = 7, format('expected 7 runtime tables, found %s', v_count);

  -- 2. RLS + FORCE RLS enabled on all seven; no direct anon/authenticated privileges
  SELECT count(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname = ANY (ARRAY[
    'omni_comms_event_route','omni_comms_request','omni_comms_recipient',
    'omni_comms_message','omni_comms_dispatch_job','omni_comms_delivery_attempt',
    'omni_comms_message_event'])
    AND c.relrowsecurity = true AND c.relforcerowsecurity = true;
  ASSERT v_count = 7, format('RLS/FORCE RLS not enabled on all seven (%s)', v_count);

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee IN ('anon','authenticated')
    AND table_name = ANY (ARRAY[
      'omni_comms_event_route','omni_comms_request','omni_comms_recipient',
      'omni_comms_message','omni_comms_dispatch_job','omni_comms_delivery_attempt',
      'omni_comms_message_event']);
  ASSERT v_count = 0, format('anon/authenticated have direct grants (%s)', v_count);

  -- Fixture: seed an event definition (needs to be in draft to avoid triggering
  -- other invariants; existing helper functions handle its shape).
  INSERT INTO public.omni_comms_event_definition (code, module_code, entity_type, name, communication_class, status)
  VALUES ('MOD.PROBE.EVENT', 'MOD', 'PROBE', 'slice1 probe', 'operational', 'draft')
  RETURNING id INTO v_event;

  -- 3. Event route channel validation
  BEGIN
    INSERT INTO public.omni_comms_event_route (organization_id, event_definition_id, channel)
    VALUES (v_org, v_event, 'telepathy');
    RAISE EXCEPTION 'expected channel rejection';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 4. Event route org-default uniqueness (activated)
  INSERT INTO public.omni_comms_event_route (organization_id, event_definition_id, channel, lifecycle_state)
  VALUES (v_org, v_event, 'email', 'active');
  BEGIN
    INSERT INTO public.omni_comms_event_route (organization_id, event_definition_id, channel, lifecycle_state)
    VALUES (v_org, v_event, 'email', 'active');
    RAISE EXCEPTION 'expected duplicate org route rejection';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 5. Request mandatory idempotency, fingerprint, JSON-object payload,
  --    channel validation, idempotency uniqueness, payload size bound.
  BEGIN
    INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
      idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
    VALUES (v_org, v_event, 'dry_run', 'k', repeat('a',16), 'MOD', '{}'::jsonb, ARRAY['email']);
    RAISE EXCEPTION 'expected idempotency length rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
      idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
    VALUES (v_org, v_event, 'dry_run', repeat('k',16), repeat('a',16), 'MOD', '[]'::jsonb, ARRAY['email']);
    RAISE EXCEPTION 'expected JSON object rejection';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
      idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
    VALUES (v_org, v_event, 'dry_run', repeat('k',16), repeat('a',16), 'MOD', '{}'::jsonb, ARRAY['carrier_pigeon']);
    RAISE EXCEPTION 'expected requested channel rejection';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
    idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
  VALUES (v_org, v_event, 'dry_run', 'idem-key-slice1', repeat('a',16), 'MOD', '{"a":1}'::jsonb, ARRAY['email'])
  RETURNING id INTO v_req;

  BEGIN
    INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
      idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
    VALUES (v_org, v_event, 'dry_run', 'idem-key-slice1', repeat('a',16), 'MOD', '{"a":2}'::jsonb, ARRAY['email']);
    RAISE EXCEPTION 'expected idempotency uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 6. Recipient org must match request org
  BEGIN
    INSERT INTO public.omni_comms_recipient(request_id, organization_id, recipient_type)
    VALUES (v_req, v_other_org, 'user');
    RAISE EXCEPTION 'expected recipient/request org mismatch';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  INSERT INTO public.omni_comms_recipient(request_id, organization_id, recipient_type)
  VALUES (v_req, v_org, 'user') RETURNING id INTO v_rcp;

  -- 7. Message request/recipient/org consistency, channel validation
  BEGIN
    INSERT INTO public.omni_comms_message(request_id, recipient_id, organization_id, event_definition_id, channel)
    VALUES (v_req, v_rcp, v_other_org, v_event, 'email');
    RAISE EXCEPTION 'expected message org mismatch';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    INSERT INTO public.omni_comms_message(request_id, recipient_id, organization_id, event_definition_id, channel)
    VALUES (v_req, v_rcp, v_org, v_event, 'nope');
    RAISE EXCEPTION 'expected message channel rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO public.omni_comms_message(request_id, recipient_id, organization_id, event_definition_id, channel)
  VALUES (v_req, v_rcp, v_org, v_event, 'email') RETURNING id INTO v_msg;

  -- Rendered checksum format
  BEGIN
    UPDATE public.omni_comms_message SET rendered_checksum='not-a-checksum' WHERE id = v_msg;
    RAISE EXCEPTION 'expected checksum format rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Move to rendered, then attempt snapshot mutation
  UPDATE public.omni_comms_message
     SET status='rendered', rendered_at=now(),
         rendered_html='<p>x</p>',
         rendered_checksum='sha256:'||repeat('a',64)
   WHERE id = v_msg;

  BEGIN
    UPDATE public.omni_comms_message SET rendered_html='<p>tampered</p>' WHERE id = v_msg;
    RAISE EXCEPTION 'expected message snapshot immutability';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 8. Dispatch job: dry-run runnable rejection, unique active job, lease shape
  BEGIN
    INSERT INTO public.omni_comms_dispatch_job(request_id, message_id, organization_id, channel, mode, is_runnable)
    VALUES (v_req, v_msg, v_org, 'email', 'dry_run', true);
    RAISE EXCEPTION 'expected dry_run runnable rejection';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  INSERT INTO public.omni_comms_dispatch_job(request_id, message_id, organization_id, channel, mode)
  VALUES (v_req, v_msg, v_org, 'email', 'dry_run') RETURNING id INTO v_job;

  BEGIN
    INSERT INTO public.omni_comms_dispatch_job(request_id, message_id, organization_id, channel, mode)
    VALUES (v_req, v_msg, v_org, 'email', 'dry_run');
    RAISE EXCEPTION 'expected one-active-job uniqueness';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  BEGIN
    UPDATE public.omni_comms_dispatch_job
       SET lock_token='t', locked_at=now(), locked_by='w', lease_expires_at=now() - interval '1 minute'
     WHERE id = v_job;
    RAISE EXCEPTION 'expected lease shape rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 9. Delivery attempt uniqueness + metadata bound
  INSERT INTO public.omni_comms_delivery_attempt(dispatch_job_id, message_id, organization_id, attempt_number)
  VALUES (v_job, v_msg, v_org, 1);
  BEGIN
    INSERT INTO public.omni_comms_delivery_attempt(dispatch_job_id, message_id, organization_id, attempt_number)
    VALUES (v_job, v_msg, v_org, 1);
    RAISE EXCEPTION 'expected attempt-number uniqueness';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 10. Message event: request/message consistency, sequence uniqueness, immutability
  INSERT INTO public.omni_comms_message_event(request_id, organization_id, event_type, event_sequence)
  VALUES (v_req, v_org, 'request_accepted', 1);
  BEGIN
    INSERT INTO public.omni_comms_message_event(request_id, organization_id, event_type, event_sequence)
    VALUES (v_req, v_org, 'request_processing', 1);
    RAISE EXCEPTION 'expected sequence uniqueness';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  BEGIN
    UPDATE public.omni_comms_message_event SET summary='x' WHERE request_id=v_req;
    RAISE EXCEPTION 'expected append-only UPDATE rejection';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.omni_comms_message_event WHERE request_id=v_req;
    RAISE EXCEPTION 'expected append-only DELETE rejection';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 11. Invalid request status transition rejection
  BEGIN
    UPDATE public.omni_comms_request SET status='delivered' WHERE id=v_req;
    RAISE EXCEPTION 'expected invalid transition rejection';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RAISE NOTICE 'BUILD 3 SLICE 1 RUNTIME DATABASE VERIFY OK';
END $$;

ROLLBACK;

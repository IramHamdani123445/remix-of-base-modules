CREATE OR REPLACE FUNCTION public.omni_comms_priv_slice1_verify()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_event uuid;
  v_req uuid;
  v_rcp uuid;
  v_msg uuid;
  v_job uuid;
BEGIN
  -- All fixture work happens inside a savepoint that we always roll back.
  BEGIN
    INSERT INTO public.omni_comms_event_definition (code, module_code, entity_type, name, communication_class, status)
    VALUES ('MOD.PROBE.EVENT', 'MOD', 'PROBE', 'slice1 probe', 'operational', 'draft')
    RETURNING id INTO v_event;

    -- Channel validation
    BEGIN
      INSERT INTO public.omni_comms_event_route (organization_id, event_definition_id, channel)
      VALUES (v_org, v_event, 'telepathy');
      RAISE EXCEPTION 'FAIL route channel not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; WHEN check_violation THEN NULL; END;

    -- Org-default uniqueness
    INSERT INTO public.omni_comms_event_route (organization_id, event_definition_id, channel, lifecycle_state)
    VALUES (v_org, v_event, 'email', 'active');
    BEGIN
      INSERT INTO public.omni_comms_event_route (organization_id, event_definition_id, channel, lifecycle_state)
      VALUES (v_org, v_event, 'email', 'active');
      RAISE EXCEPTION 'FAIL duplicate route not rejected';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    -- Request bounds and JSON object shape
    BEGIN
      INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
        idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
      VALUES (v_org, v_event, 'dry_run', 'k', repeat('a',16), 'MOD', '{}'::jsonb, ARRAY['email']);
      RAISE EXCEPTION 'FAIL idempotency length not rejected';
    EXCEPTION WHEN check_violation THEN NULL; END;

    BEGIN
      INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
        idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
      VALUES (v_org, v_event, 'dry_run', repeat('k',16), repeat('a',16), 'MOD', '[]'::jsonb, ARRAY['email']);
      RAISE EXCEPTION 'FAIL non-object payload not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    BEGIN
      INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
        idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
      VALUES (v_org, v_event, 'dry_run', repeat('k',16), repeat('a',16), 'MOD', '{}'::jsonb, ARRAY['carrier_pigeon']);
      RAISE EXCEPTION 'FAIL invalid requested channel not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
      idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
    VALUES (v_org, v_event, 'dry_run', 'idem-key-slice1', repeat('a',16), 'MOD', '{"a":1}'::jsonb, ARRAY['email'])
    RETURNING id INTO v_req;

    BEGIN
      INSERT INTO public.omni_comms_request(organization_id, event_definition_id, mode,
        idempotency_key, request_fingerprint, caller_module_code, payload_snapshot, requested_channels)
      VALUES (v_org, v_event, 'dry_run', 'idem-key-slice1', repeat('a',16), 'MOD', '{"a":2}'::jsonb, ARRAY['email']);
      RAISE EXCEPTION 'FAIL idempotency uniqueness not enforced';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    -- Recipient org mismatch
    BEGIN
      INSERT INTO public.omni_comms_recipient(request_id, organization_id, recipient_type)
      VALUES (v_req, v_other_org, 'user');
      RAISE EXCEPTION 'FAIL recipient org mismatch not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    INSERT INTO public.omni_comms_recipient(request_id, organization_id, recipient_type)
    VALUES (v_req, v_org, 'user') RETURNING id INTO v_rcp;

    -- Message org mismatch and channel validation
    BEGIN
      INSERT INTO public.omni_comms_message(request_id, recipient_id, organization_id, event_definition_id, channel)
      VALUES (v_req, v_rcp, v_other_org, v_event, 'email');
      RAISE EXCEPTION 'FAIL message org mismatch not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    BEGIN
      INSERT INTO public.omni_comms_message(request_id, recipient_id, organization_id, event_definition_id, channel)
      VALUES (v_req, v_rcp, v_org, v_event, 'nope');
      RAISE EXCEPTION 'FAIL message channel not rejected';
    EXCEPTION WHEN check_violation THEN NULL; END;

    INSERT INTO public.omni_comms_message(request_id, recipient_id, organization_id, event_definition_id, channel)
    VALUES (v_req, v_rcp, v_org, v_event, 'email') RETURNING id INTO v_msg;

    -- Checksum format
    BEGIN
      UPDATE public.omni_comms_message SET rendered_checksum='not-a-checksum' WHERE id = v_msg;
      RAISE EXCEPTION 'FAIL checksum format not rejected';
    EXCEPTION WHEN check_violation THEN NULL; END;

    -- Move to rendered and try snapshot mutation
    UPDATE public.omni_comms_message
       SET status='rendered', rendered_at=now(), rendered_html='<p>x</p>',
           rendered_checksum='sha256:'||repeat('a',64)
     WHERE id = v_msg;

    BEGIN
      UPDATE public.omni_comms_message SET rendered_html='<p>tampered</p>' WHERE id = v_msg;
      RAISE EXCEPTION 'FAIL message snapshot mutable';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    -- Dispatch dry-run runnable
    BEGIN
      INSERT INTO public.omni_comms_dispatch_job(request_id, message_id, organization_id, channel, mode, is_runnable)
      VALUES (v_req, v_msg, v_org, 'email', 'dry_run', true);
      RAISE EXCEPTION 'FAIL dry_run runnable not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    INSERT INTO public.omni_comms_dispatch_job(request_id, message_id, organization_id, channel, mode)
    VALUES (v_req, v_msg, v_org, 'email', 'dry_run') RETURNING id INTO v_job;

    BEGIN
      INSERT INTO public.omni_comms_dispatch_job(request_id, message_id, organization_id, channel, mode)
      VALUES (v_req, v_msg, v_org, 'email', 'dry_run');
      RAISE EXCEPTION 'FAIL one-active-job not enforced';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
      UPDATE public.omni_comms_dispatch_job
         SET lock_token='t', locked_at=now(), locked_by='w', lease_expires_at=now() - interval '1 minute'
       WHERE id = v_job;
      RAISE EXCEPTION 'FAIL lease shape not rejected';
    EXCEPTION WHEN check_violation THEN NULL; END;

    -- Delivery attempt uniqueness
    INSERT INTO public.omni_comms_delivery_attempt(dispatch_job_id, message_id, organization_id, attempt_number)
    VALUES (v_job, v_msg, v_org, 1);
    BEGIN
      INSERT INTO public.omni_comms_delivery_attempt(dispatch_job_id, message_id, organization_id, attempt_number)
      VALUES (v_job, v_msg, v_org, 1);
      RAISE EXCEPTION 'FAIL attempt uniqueness not enforced';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    -- Message event sequence and append-only
    INSERT INTO public.omni_comms_message_event(request_id, organization_id, event_type, event_sequence)
    VALUES (v_req, v_org, 'request_accepted', 1);
    BEGIN
      INSERT INTO public.omni_comms_message_event(request_id, organization_id, event_type, event_sequence)
      VALUES (v_req, v_org, 'request_processing', 1);
      RAISE EXCEPTION 'FAIL event sequence not unique';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
      UPDATE public.omni_comms_message_event SET summary='x' WHERE request_id=v_req;
      RAISE EXCEPTION 'FAIL event UPDATE not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    BEGIN
      DELETE FROM public.omni_comms_message_event WHERE request_id=v_req;
      RAISE EXCEPTION 'FAIL event DELETE not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    -- Invalid request transition
    BEGIN
      UPDATE public.omni_comms_request SET status='completed' WHERE id=v_req;
      RAISE EXCEPTION 'FAIL invalid request transition not rejected';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;

    -- Always roll back the fixture work
    RAISE EXCEPTION 'SLICE1_PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'SLICE1_PROBE_ROLLBACK' THEN
      RETURN 'BUILD 3 SLICE 1 RUNTIME DATABASE VERIFY OK';
    END IF;
    RAISE;
  END;
END;
$fn$;

ALTER FUNCTION public.omni_comms_priv_slice1_verify() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_slice1_verify() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_slice1_verify() TO authenticated;
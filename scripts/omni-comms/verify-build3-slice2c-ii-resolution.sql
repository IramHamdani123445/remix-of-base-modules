-- ============================================================================
-- Omni-Comms — Slice 2c-ii Batch A verifier (database only).
-- Proves: aggregate snapshot security & shape, finalize_resolution atomicity,
-- department-over-organisation route precedence, blocked-request persistence,
-- replay does not duplicate recipients/events, no messages/dispatch/attempts.
-- Fixtures wrapped in a transaction and rolled back. Ordinary trigger
-- enforcement bypassed only for synthetic lifecycle setup via
-- SET LOCAL session_replication_role = 'replica'; RPC calls run with
-- enforcement re-enabled so validate triggers on recipient/message_event
-- exercise the real path.
-- Print "BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK" only on full success.
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on

BEGIN;

-- 1) All new RPCs exist, SECURITY DEFINER, owned by postgres, restricted search_path.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef AS sec_def,
           pg_get_userbyid(p.proowner) AS owner,
           coalesce(array_to_string(p.proconfig,','), '') AS cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'omni_comms_priv_runtime_resolution_snapshot',
        'omni_comms_priv_finalize_resolution',
        'omni_comms_priv_load_persisted_resolution',
        'omni_comms_priv_next_event_sequence',
        'omni_comms_priv_send_communication')
  LOOP
    IF NOT r.sec_def THEN RAISE EXCEPTION '% not SECURITY DEFINER', r.proname; END IF;
    IF r.owner <> 'postgres' THEN RAISE EXCEPTION '% owner=%', r.proname, r.owner; END IF;
    IF position('search_path' in r.cfg)=0 THEN RAISE EXCEPTION '% missing search_path: %', r.proname, r.cfg; END IF;
  END LOOP;
END $$;

-- 2) Grants: revoked from PUBLIC/anon/authenticated, granted to service_role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'omni_comms_priv_runtime_resolution_snapshot',
        'omni_comms_priv_finalize_resolution',
        'omni_comms_priv_load_persisted_resolution',
        'omni_comms_priv_next_event_sequence')
  LOOP
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% missing service_role EXECUTE', r.proname; END IF;
    IF has_function_privilege('public', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% executable by PUBLIC', r.proname; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% executable by anon', r.proname; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% executable by authenticated', r.proname; END IF;
  END LOOP;
END $$;

-- 3) Snapshot: dept-over-org precedence + org fallback + channel filter.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_dept uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_route_org uuid;
  v_route_dept uuid;
  v_snap jsonb;
  v_routes jsonb;
BEGIN
  SET LOCAL session_replication_role = 'replica';

  INSERT INTO public.omni_comms_event_definition
    (id, code, module_code, entity_type, name, communication_class, status)
  VALUES (v_event, '__verify_2cii_ev', 'VERIFY', 'entity', 'verify', 'transactional', 'active');

  INSERT INTO public.omni_comms_event_contract
    (event_definition_id, version_number, json_schema, checksum, status, published_at)
  VALUES (v_event, 1,
          '{"type":"object","properties":{"x":{"type":"string"}},"required":["x"]}'::jsonb,
          'abc', 'published', now());

  INSERT INTO public.omni_comms_event_route
    (organization_id, department_id, event_definition_id, channel, is_required, is_enabled,
     priority, lifecycle_state, activated_at)
  VALUES (v_org, NULL, v_event, 'email', true, true, 100, 'active', now())
  RETURNING id INTO v_route_org;

  INSERT INTO public.omni_comms_event_route
    (organization_id, department_id, event_definition_id, channel, is_required, is_enabled,
     priority, lifecycle_state, activated_at)
  VALUES (v_org, v_dept, v_event, 'email', true, true, 50, 'active', now())
  RETURNING id INTO v_route_dept;

  SET LOCAL session_replication_role = 'origin';

  v_snap := public.omni_comms_priv_runtime_resolution_snapshot(
    gen_random_uuid(), v_org, v_dept, '__verify_2cii_ev', ARRAY['email']::text[]);
  IF v_snap IS NULL THEN RAISE EXCEPTION 'snapshot null'; END IF;
  IF v_snap->'event'->>'code' <> '__verify_2cii_ev' THEN RAISE EXCEPTION 'event mismatch'; END IF;
  IF jsonb_array_length(v_snap->'event_contracts') < 1 THEN RAISE EXCEPTION 'no contract'; END IF;
  v_routes := v_snap->'routes';
  IF jsonb_array_length(v_routes) <> 1 THEN
    RAISE EXCEPTION 'expected 1 route, got %: %', jsonb_array_length(v_routes), v_routes; END IF;
  IF (v_routes->0->>'id')::uuid <> v_route_dept THEN
    RAISE EXCEPTION 'dept precedence failed, winner=%', v_routes->0->>'id'; END IF;

  v_snap := public.omni_comms_priv_runtime_resolution_snapshot(
    gen_random_uuid(), v_org, NULL, '__verify_2cii_ev', ARRAY['email']::text[]);
  v_routes := v_snap->'routes';
  IF jsonb_array_length(v_routes) <> 1 OR (v_routes->0->>'id')::uuid <> v_route_org THEN
    RAISE EXCEPTION 'org fallback failed: %', v_routes; END IF;

  v_snap := public.omni_comms_priv_runtime_resolution_snapshot(
    gen_random_uuid(), v_org, v_dept, '__verify_2cii_ev', ARRAY['sms']::text[]);
  IF jsonb_array_length(v_snap->'routes') <> 0 THEN
    RAISE EXCEPTION 'sms filter should be empty: %', v_snap->'routes'; END IF;
END $$;

-- 4) Finalize: recipients persist, events append, no messages/jobs/attempts.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_send jsonb; v_req_id uuid;
  v_fin jsonb; v_replay jsonb;
  n int;
BEGIN
  SET LOCAL session_replication_role = 'replica';
  INSERT INTO public.omni_comms_event_definition
    (id, code, module_code, entity_type, name, communication_class, status)
  VALUES (v_event, '__verify_2cii_fin', 'VERIFY', 'entity', 'verify', 'transactional', 'active');
  SET LOCAL session_replication_role = 'origin';

  v_send := public.omni_comms_priv_send_communication(
    v_actor, v_org, NULL, '__verify_2cii_fin', 'dry_run',
    'verify-key-12345678', 'VERIFY', NULL, NULL, NULL,
    repeat('a',64), '{"x":"y"}'::jsonb, ARRAY['email']::text[]);
  v_req_id := (v_send->>'request_id')::uuid;
  IF v_req_id IS NULL THEN RAISE EXCEPTION 'no request_id: %', v_send; END IF;

  v_fin := public.omni_comms_priv_finalize_resolution(
    v_actor, v_req_id, v_org,
    jsonb_build_object('snapshot_at', now()),
    jsonb_build_array(
      jsonb_build_object(
        'recipient_type','person','recipient_reference','r1',
        'email_destination','a@example.com','eligibility_status','eligible',
        'resolved_channels', jsonb_build_array('email'),
        'blockers','[]'::jsonb,
        'per_recipient_snapshot', jsonb_build_object('note','ok')),
      jsonb_build_object(
        'recipient_type','person','recipient_reference','r2',
        'eligibility_status','invalid','resolved_channels','[]'::jsonb,
        'blockers', jsonb_build_array('recipient_destination_missing'))),
    ARRAY[]::text[], 'processing');
  IF v_fin->>'status' <> 'processing' THEN RAISE EXCEPTION 'status=%', v_fin->>'status'; END IF;
  IF (v_fin->>'replayed')::bool THEN RAISE EXCEPTION 'unexpected replay'; END IF;
  IF jsonb_array_length(v_fin->'recipients') <> 2 THEN RAISE EXCEPTION 'recipient count'; END IF;

  SELECT count(*) INTO n FROM public.omni_comms_recipient WHERE request_id=v_req_id;
  IF n<>2 THEN RAISE EXCEPTION 'recipient rows=%', n; END IF;
  SELECT count(*) INTO n FROM public.omni_comms_message_event WHERE request_id=v_req_id;
  IF n<>4 THEN RAISE EXCEPTION 'event rows=%', n; END IF;
  SELECT count(*) INTO n FROM public.omni_comms_message WHERE request_id=v_req_id;
  IF n<>0 THEN RAISE EXCEPTION 'messages=%', n; END IF;
  SELECT count(*) INTO n FROM public.omni_comms_dispatch_job WHERE request_id=v_req_id;
  IF n<>0 THEN RAISE EXCEPTION 'jobs=%', n; END IF;
  SELECT count(*) INTO n FROM public.omni_comms_delivery_attempt WHERE organization_id=v_org;
  IF n<>0 THEN RAISE EXCEPTION 'attempts=%', n; END IF;

  -- Replay
  v_replay := public.omni_comms_priv_finalize_resolution(
    v_actor, v_req_id, v_org, jsonb_build_object('snapshot_at', now()),
    jsonb_build_array(jsonb_build_object('recipient_type','person','recipient_reference','r3',
      'eligibility_status','eligible','resolved_channels', jsonb_build_array('email'),
      'blockers','[]'::jsonb)),
    ARRAY[]::text[], 'processing');
  IF NOT (v_replay->>'replayed')::bool THEN RAISE EXCEPTION 'expected replay'; END IF;

  SELECT count(*) INTO n FROM public.omni_comms_recipient WHERE request_id=v_req_id;
  IF n<>2 THEN RAISE EXCEPTION 'replay changed recipient count to %', n; END IF;
  SELECT count(*) INTO n FROM public.omni_comms_message_event WHERE request_id=v_req_id;
  IF n<>4 THEN RAISE EXCEPTION 'replay changed event count to %', n; END IF;

  v_replay := public.omni_comms_priv_load_persisted_resolution(v_actor, v_req_id, v_org);
  IF jsonb_array_length(v_replay->'recipients') <> 2 THEN
    RAISE EXCEPTION 'load_persisted wrong count'; END IF;
END $$;

-- 5) Blocked-request persistence: finalize with status='blocked'.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_send jsonb; v_req_id uuid; v_fin jsonb;
  s text; n int;
BEGIN
  SET LOCAL session_replication_role = 'replica';
  INSERT INTO public.omni_comms_event_definition
    (id, code, module_code, entity_type, name, communication_class, status)
  VALUES (v_event, '__verify_2cii_blk', 'VERIFY', 'entity', 'verify', 'transactional', 'active');
  SET LOCAL session_replication_role = 'origin';

  v_send := public.omni_comms_priv_send_communication(
    v_actor, v_org, NULL, '__verify_2cii_blk', 'dry_run',
    'verify-blk-12345678', 'VERIFY', NULL, NULL, NULL,
    repeat('b',64), '{"x":"y"}'::jsonb, ARRAY['email']::text[]);
  v_req_id := (v_send->>'request_id')::uuid;

  v_fin := public.omni_comms_priv_finalize_resolution(
    v_actor, v_req_id, v_org, jsonb_build_object('snapshot_at', now()),
    '[]'::jsonb, ARRAY['event_route_missing']::text[], 'blocked');
  IF v_fin->>'status' <> 'blocked' THEN RAISE EXCEPTION 'expected blocked, got %', v_fin->>'status'; END IF;

  SELECT status INTO s FROM public.omni_comms_request WHERE id=v_req_id;
  IF s <> 'blocked' THEN RAISE EXCEPTION 'req status=%', s; END IF;
  SELECT count(*) INTO n FROM public.omni_comms_message WHERE request_id=v_req_id;
  IF n<>0 THEN RAISE EXCEPTION 'blocked req produced messages'; END IF;
  SELECT count(*) INTO n FROM public.omni_comms_dispatch_job WHERE request_id=v_req_id;
  IF n<>0 THEN RAISE EXCEPTION 'blocked req produced jobs'; END IF;
END $$;

-- 6) Input rejection.
DO $$
DECLARE v_ok bool;
BEGIN
  v_ok:=false;
  BEGIN PERFORM public.omni_comms_priv_runtime_resolution_snapshot(
    gen_random_uuid(), NULL, NULL, 'x', NULL);
  EXCEPTION WHEN OTHERS THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'null org accepted'; END IF;

  v_ok:=false;
  BEGIN PERFORM public.omni_comms_priv_runtime_resolution_snapshot(
    NULL, gen_random_uuid(), NULL, 'x', NULL);
  EXCEPTION WHEN OTHERS THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'null actor accepted'; END IF;
END $$;

ROLLBACK;

SELECT 'BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK' AS result;

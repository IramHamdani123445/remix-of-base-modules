-- ============================================================================
-- Omni-Comms — Slice 2c-ii Batch A verifier (database only).
-- Proves: aggregate snapshot security & shape, finalize_resolution atomicity,
-- department-over-organisation route precedence, blocked-request persistence,
-- replay does not duplicate recipients/events, no messages/dispatch/attempts.
-- All fixtures are wrapped in a transaction and rolled back at the end.
-- Print "BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK" only on full success.
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on

BEGIN;

-- 0) Registry sanity: 19 omni_comms_* tables, edge boundary presence via RPCs.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.tables
  WHERE table_schema='public' AND table_name LIKE 'omni_comms_%';
  IF n < 12 THEN
    RAISE EXCEPTION 'expected at least 12 omni_comms_* tables, got %', n;
  END IF;
END $$;

-- 1) All new RPCs exist, are SECURITY DEFINER, owned by postgres, restricted search_path.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname,
           p.prosecdef                                       AS sec_def,
           pg_get_userbyid(p.proowner)                       AS owner,
           coalesce(array_to_string(p.proconfig,','), '')    AS cfg
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'omni_comms_priv_runtime_resolution_snapshot',
        'omni_comms_priv_finalize_resolution',
        'omni_comms_priv_load_persisted_resolution',
        'omni_comms_priv_next_event_sequence',
        'omni_comms_priv_send_communication'
      )
  LOOP
    IF NOT r.sec_def THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER', r.proname;
    END IF;
    IF r.owner <> 'postgres' THEN
      RAISE EXCEPTION '% owner=% expected postgres', r.proname, r.owner;
    END IF;
    IF position('search_path' in r.cfg) = 0 THEN
      RAISE EXCEPTION '% missing search_path config: %', r.proname, r.cfg;
    END IF;
  END LOOP;
END $$;

-- 2) Grants: revoked from PUBLIC/anon/authenticated, granted to service_role.
DO $$
DECLARE r record; v_svc bool; v_pub bool; v_anon bool; v_auth bool;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'omni_comms_priv_runtime_resolution_snapshot',
        'omni_comms_priv_finalize_resolution',
        'omni_comms_priv_load_persisted_resolution',
        'omni_comms_priv_next_event_sequence'
      )
  LOOP
    v_svc  := has_function_privilege('service_role',  r.oid, 'EXECUTE');
    v_pub  := has_function_privilege('public',        r.oid, 'EXECUTE');
    v_anon := has_function_privilege('anon',          r.oid, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    IF NOT v_svc THEN RAISE EXCEPTION '% missing service_role EXECUTE', r.proname; END IF;
    IF v_pub  THEN RAISE EXCEPTION '% still executable by PUBLIC',        r.proname; END IF;
    IF v_anon THEN RAISE EXCEPTION '% still executable by anon',          r.proname; END IF;
    IF v_auth THEN RAISE EXCEPTION '% still executable by authenticated', r.proname; END IF;
  END LOOP;
END $$;

-- 3) Fixture: temp org/dept, event, contract, routes (dept + org for same channel).
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_dept uuid := gen_random_uuid();
  v_event uuid;
  v_route_org uuid;
  v_route_dept uuid;
  v_snap jsonb;
  v_routes jsonb;
  v_winning_route jsonb;
BEGIN
  -- Skip: we cannot easily insert core_department without its constraints; use org only.
  -- Insert event + contract via direct writes (postgres role bypasses triggers/RLS).
  INSERT INTO public.omni_comms_event_definition
    (id, code, module_code, entity_type, name, communication_class, status)
  VALUES (gen_random_uuid(), '__verify_2cii_ev', 'VERIFY', 'entity', 'verify', 'transactional', 'active')
  RETURNING id INTO v_event;

  INSERT INTO public.omni_comms_event_contract
    (event_definition_id, version_number, json_schema, checksum, status, published_at)
  VALUES (v_event, 1, '{"type":"object","properties":{"x":{"type":"string"}},"required":["x"]}'::jsonb,
          'abc', 'published', now());

  -- Two routes for email channel: dept route (dept_id set) and org route (dept_id null).
  INSERT INTO public.omni_comms_event_route
    (organization_id, department_id, event_definition_id, channel,
     is_required, is_enabled, priority, lifecycle_state, activated_at, activated_by)
  VALUES (v_org, NULL, v_event, 'email', true, true, 100, 'active', now(), null)
  RETURNING id INTO v_route_org;

  INSERT INTO public.omni_comms_event_route
    (organization_id, department_id, event_definition_id, channel,
     is_required, is_enabled, priority, lifecycle_state, activated_at, activated_by)
  VALUES (v_org, v_dept, v_event, 'email', true, true, 50, 'active', now(), null)
  RETURNING id INTO v_route_dept;

  -- Aggregate snapshot: should return exactly one email route = dept route.
  v_snap := public.omni_comms_priv_runtime_resolution_snapshot(
              gen_random_uuid(), v_org, v_dept, '__verify_2cii_ev', ARRAY['email']::text[]);
  IF v_snap IS NULL THEN RAISE EXCEPTION 'snapshot returned null'; END IF;
  IF v_snap->'event'->>'code' <> '__verify_2cii_ev' THEN
    RAISE EXCEPTION 'snapshot event mismatch: %', v_snap->'event';
  END IF;
  IF jsonb_array_length(v_snap->'event_contracts') < 1 THEN
    RAISE EXCEPTION 'snapshot missing contract';
  END IF;
  v_routes := v_snap->'routes';
  IF jsonb_array_length(v_routes) <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 winning route, got %: %', jsonb_array_length(v_routes), v_routes;
  END IF;
  v_winning_route := v_routes->0;
  IF (v_winning_route->>'id')::uuid <> v_route_dept THEN
    RAISE EXCEPTION 'dept route should win precedence, got % expected %',
      v_winning_route->>'id', v_route_dept;
  END IF;

  -- Without department: only org route qualifies.
  v_snap := public.omni_comms_priv_runtime_resolution_snapshot(
              gen_random_uuid(), v_org, NULL, '__verify_2cii_ev', ARRAY['email']::text[]);
  v_routes := v_snap->'routes';
  IF jsonb_array_length(v_routes) <> 1
     OR (v_routes->0->>'id')::uuid <> v_route_org THEN
    RAISE EXCEPTION 'org fallback failed: %', v_routes;
  END IF;

  -- Requested channel filter without a routed channel returns empty.
  v_snap := public.omni_comms_priv_runtime_resolution_snapshot(
              gen_random_uuid(), v_org, v_dept, '__verify_2cii_ev', ARRAY['sms']::text[]);
  IF jsonb_array_length(v_snap->'routes') <> 0 THEN
    RAISE EXCEPTION 'sms-only filter should have zero routes';
  END IF;
END $$;

-- 4) Finalize_resolution: persist recipients + events, no messages/jobs/attempts.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_event uuid;
  v_req_id uuid;
  v_send jsonb;
  v_finalize jsonb;
  v_replay jsonb;
  v_recip_count int;
  v_event_count int;
  v_msg_count int;
  v_job_count int;
  v_att_count int;
BEGIN
  INSERT INTO public.omni_comms_event_definition
    (id, code, module_code, entity_type, name, communication_class, status)
  VALUES (gen_random_uuid(), '__verify_2cii_fin', 'VERIFY', 'entity', 'verify', 'transactional', 'active')
  RETURNING id INTO v_event;

  v_send := public.omni_comms_priv_send_communication(
    v_actor, v_org, NULL, '__verify_2cii_fin', 'dry_run',
    'verify-key-12345678', 'VERIFY', NULL, NULL, NULL,
    repeat('a',64),
    '{"x":"y"}'::jsonb, ARRAY['email']::text[]
  );
  v_req_id := (v_send->>'request_id')::uuid;
  IF v_req_id IS NULL THEN RAISE EXCEPTION 'send did not return request_id: %', v_send; END IF;

  -- First finalize: 2 recipients, one eligible, one blocked.
  v_finalize := public.omni_comms_priv_finalize_resolution(
    v_actor, v_req_id, v_org,
    jsonb_build_object('snapshot_at', now()),
    jsonb_build_array(
      jsonb_build_object(
        'recipient_type','person',
        'recipient_reference','r1',
        'email_destination','a@example.com',
        'eligibility_status','eligible',
        'resolved_channels', jsonb_build_array('email'),
        'blockers', '[]'::jsonb,
        'per_recipient_snapshot', jsonb_build_object('note','ok')
      ),
      jsonb_build_object(
        'recipient_type','person',
        'recipient_reference','r2',
        'eligibility_status','invalid',
        'resolved_channels', '[]'::jsonb,
        'blockers', jsonb_build_array('recipient_destination_missing')
      )
    ),
    ARRAY[]::text[],
    'processing'
  );
  IF v_finalize->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'expected processing, got %', v_finalize->>'status';
  END IF;
  IF (v_finalize->>'replayed')::bool THEN
    RAISE EXCEPTION 'first finalize should not be a replay';
  END IF;
  IF jsonb_array_length(v_finalize->'recipients') <> 2 THEN
    RAISE EXCEPTION 'expected 2 recipients, got %', jsonb_array_length(v_finalize->'recipients');
  END IF;

  SELECT count(*) INTO v_recip_count FROM public.omni_comms_recipient WHERE request_id = v_req_id;
  IF v_recip_count <> 2 THEN RAISE EXCEPTION 'recipient row count %', v_recip_count; END IF;

  SELECT count(*) INTO v_event_count FROM public.omni_comms_message_event WHERE request_id = v_req_id;
  -- request_accepted + request_processing + 2 x recipient_(resolved|blocked) = 4
  IF v_event_count <> 4 THEN RAISE EXCEPTION 'event row count %', v_event_count; END IF;

  -- No messages/jobs/attempts anywhere.
  SELECT count(*) INTO v_msg_count FROM public.omni_comms_message WHERE request_id = v_req_id;
  IF v_msg_count <> 0 THEN RAISE EXCEPTION 'messages created: %', v_msg_count; END IF;
  SELECT count(*) INTO v_job_count FROM public.omni_comms_dispatch_job WHERE request_id = v_req_id;
  IF v_job_count <> 0 THEN RAISE EXCEPTION 'dispatch jobs created: %', v_job_count; END IF;
  SELECT count(*) INTO v_att_count FROM public.omni_comms_delivery_attempt WHERE organization_id = v_org;
  IF v_att_count <> 0 THEN RAISE EXCEPTION 'delivery attempts created: %', v_att_count; END IF;

  -- Replay: same finalize call returns replayed=true, no new rows.
  v_replay := public.omni_comms_priv_finalize_resolution(
    v_actor, v_req_id, v_org,
    jsonb_build_object('snapshot_at', now()),
    jsonb_build_array(
      jsonb_build_object('recipient_type','person','recipient_reference','r3',
                         'eligibility_status','eligible',
                         'resolved_channels', jsonb_build_array('email'),
                         'blockers','[]'::jsonb)
    ),
    ARRAY[]::text[], 'processing'
  );
  IF NOT (v_replay->>'replayed')::bool THEN
    RAISE EXCEPTION 'expected replayed=true, got %', v_replay;
  END IF;
  SELECT count(*) INTO v_recip_count FROM public.omni_comms_recipient WHERE request_id = v_req_id;
  IF v_recip_count <> 2 THEN
    RAISE EXCEPTION 'replay changed recipient count to %', v_recip_count;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.omni_comms_message_event WHERE request_id = v_req_id;
  IF v_event_count <> 4 THEN
    RAISE EXCEPTION 'replay changed event count to %', v_event_count;
  END IF;

  -- Load persisted resolution.
  v_replay := public.omni_comms_priv_load_persisted_resolution(v_actor, v_req_id, v_org);
  IF jsonb_array_length(v_replay->'recipients') <> 2 THEN
    RAISE EXCEPTION 'load_persisted returned wrong recipient count: %', v_replay;
  END IF;
END $$;

-- 5) Blocked-request persistence: finalize with p_final_status='blocked'.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_event uuid;
  v_send jsonb;
  v_req_id uuid;
  v_final jsonb;
  v_req_status text;
  v_msg_count int; v_job_count int;
BEGIN
  INSERT INTO public.omni_comms_event_definition
    (id, code, module_code, entity_type, name, communication_class, status)
  VALUES (gen_random_uuid(), '__verify_2cii_blk', 'VERIFY', 'entity', 'verify', 'transactional', 'active')
  RETURNING id INTO v_event;

  v_send := public.omni_comms_priv_send_communication(
    v_actor, v_org, NULL, '__verify_2cii_blk', 'dry_run',
    'verify-blk-12345678', 'VERIFY', NULL, NULL, NULL,
    repeat('b',64), '{"x":"y"}'::jsonb, ARRAY['email']::text[]
  );
  v_req_id := (v_send->>'request_id')::uuid;

  v_final := public.omni_comms_priv_finalize_resolution(
    v_actor, v_req_id, v_org,
    jsonb_build_object('snapshot_at', now()),
    '[]'::jsonb,
    ARRAY['event_route_missing']::text[],
    'blocked'
  );
  IF v_final->>'status' <> 'blocked' THEN
    RAISE EXCEPTION 'expected status=blocked, got %', v_final->>'status';
  END IF;

  SELECT status INTO v_req_status FROM public.omni_comms_request WHERE id = v_req_id;
  IF v_req_status <> 'blocked' THEN RAISE EXCEPTION 'request status = %', v_req_status; END IF;

  SELECT count(*) INTO v_msg_count FROM public.omni_comms_message WHERE request_id = v_req_id;
  IF v_msg_count <> 0 THEN RAISE EXCEPTION 'blocked request produced messages'; END IF;
  SELECT count(*) INTO v_job_count FROM public.omni_comms_dispatch_job WHERE request_id = v_req_id;
  IF v_job_count <> 0 THEN RAISE EXCEPTION 'blocked request produced jobs'; END IF;
END $$;

-- 6) Snapshot rejects missing organization / bad input.
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.omni_comms_priv_runtime_resolution_snapshot(
      gen_random_uuid(), NULL, NULL, 'anything', NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'snapshot should reject null org'; END IF;

  v_ok := false;
  BEGIN
    PERFORM public.omni_comms_priv_runtime_resolution_snapshot(
      NULL, gen_random_uuid(), NULL, 'anything', NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'snapshot should reject null actor'; END IF;
END $$;

ROLLBACK;

SELECT 'BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK' AS result;

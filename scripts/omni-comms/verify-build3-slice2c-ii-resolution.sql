-- ============================================================================
-- Omni-Comms — Slice 2c-ii Batch C verifier (sandbox-safe, database-side).
--
-- Sandbox limitation: the psql role has SELECT/INSERT only and no EXECUTE
-- grant on the service_role-only RPCs. This verifier proves the schema,
-- signatures, security posture, ownership, search_path, grant matrix,
-- registry counts, and the absence of delivery-spine mutations inside the
-- resolution function bodies.
--
-- IT DOES NOT CERTIFY RUNTIME RESOLUTION SEMANTICS. Runtime behaviour
-- (precedence, replay, blocker persistence, atomic finalization, no
-- provider contact, no message/dispatch/attempt writes at runtime) must
-- be certified by the privileged integration harness
-- (scripts/omni-comms/integration/run-edge-resolution.ts) executed in an
-- environment with a service-role key and a capability-bearing JWT.
--
-- Marker on success: BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on

-- 1) All new RPCs exist, SECURITY DEFINER, owned by postgres, restricted search_path.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef AS sec_def,
           pg_get_userbyid(p.proowner) AS owner,
           coalesce(array_to_string(p.proconfig,','), '') AS cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname='public'
      AND p.proname IN (
        'omni_comms_priv_runtime_resolution_snapshot',
        'omni_comms_priv_finalize_resolution',
        'omni_comms_priv_load_persisted_resolution',
        'omni_comms_priv_next_event_sequence',
        'omni_comms_priv_send_communication')
  LOOP
    n := n + 1;
    IF NOT r.sec_def THEN RAISE EXCEPTION '% not SECURITY DEFINER', r.proname; END IF;
    IF r.owner <> 'postgres' THEN RAISE EXCEPTION '% owner=%', r.proname, r.owner; END IF;
    IF position('search_path' in r.cfg)=0 THEN
      RAISE EXCEPTION '% missing search_path: %', r.proname, r.cfg;
    END IF;
    IF r.cfg !~ 'search_path=(pg_catalog|pg_catalog,public|pg_catalog,extensions|pg_catalog,public,extensions|pg_catalog,extensions,public)' THEN
      RAISE EXCEPTION '% search_path not safely pinned: %', r.proname, r.cfg;
    END IF;
  END LOOP;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 RPCs, found %', n; END IF;
END $$;

-- 2) Grant matrix: revoked from PUBLIC/anon/authenticated, granted to service_role.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public'
      AND p.proname IN (
        'omni_comms_priv_runtime_resolution_snapshot',
        'omni_comms_priv_finalize_resolution',
        'omni_comms_priv_load_persisted_resolution',
        'omni_comms_priv_next_event_sequence')
  LOOP
    n := n + 1;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% missing service_role EXECUTE', r.proname; END IF;
    IF has_function_privilege('public', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% executable by PUBLIC', r.proname; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% executable by anon', r.proname; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% executable by authenticated', r.proname; END IF;
  END LOOP;
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 runtime RPCs, found %', n; END IF;
END $$;

-- 3) omni_comms_priv_send_communication grant boundary.
DO $$
DECLARE v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='omni_comms_priv_send_communication';
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'send_communication executable by anon'; END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'send_communication missing service_role EXECUTE'; END IF;
END $$;

-- 4) Signatures match the Batch B contract.
DO $$
DECLARE r record;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid) AS args INTO r
   FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='omni_comms_priv_runtime_resolution_snapshot';
  IF r.args NOT LIKE '%uuid%uuid%uuid%text%text[]%' THEN
    RAISE EXCEPTION 'snapshot signature drift: %', r.args;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) AS args INTO r
   FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='omni_comms_priv_finalize_resolution';
  IF r.args NOT LIKE '%uuid%uuid%uuid%jsonb%jsonb%text[]%text%' THEN
    RAISE EXCEPTION 'finalize signature drift: %', r.args;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) AS args INTO r
   FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='omni_comms_priv_load_persisted_resolution';
  IF r.args NOT LIKE '%uuid%uuid%uuid%' THEN
    RAISE EXCEPTION 'load signature drift: %', r.args;
  END IF;
END $$;

-- 5) The resolution surfaces must not RETURN the raw provider secret_ref
--    text. The snapshot function legitimately reads secret_ref as a
--    readiness signal (present/absent), so we forbid it only inside the
--    RETURNS clause / OUT columns of these routines.
DO $$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_result(p.oid) AS ret
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public'
       AND p.proname IN (
         'omni_comms_priv_runtime_resolution_snapshot',
         'omni_comms_priv_finalize_resolution',
         'omni_comms_priv_load_persisted_resolution')
  LOOP
    IF r.ret ~* '\msecret_ref\M' THEN
      bad := bad + 1;
      RAISE NOTICE 'resolution RPC % returns secret_ref column', r.proname;
    END IF;
  END LOOP;
  IF bad > 0 THEN
    RAISE EXCEPTION 'resolution RPCs expose secret_ref in RETURN shape (% RPCs)', bad;
  END IF;
END $$;

-- 6) No mutation of omni_comms_message / _dispatch_job / _delivery_attempt
--    appears inside the resolution function bodies.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname IN (
       'omni_comms_priv_runtime_resolution_snapshot',
       'omni_comms_priv_finalize_resolution',
       'omni_comms_priv_load_persisted_resolution')
     AND pg_get_functiondef(p.oid) ~*
         '(insert\s+into|update|delete\s+from)\s+(public\.)?omni_comms_(message|dispatch_job|delivery_attempt)\M';
  IF bad > 0 THEN
    RAISE EXCEPTION 'resolution RPC mutates delivery-spine table (% functions)', bad;
  END IF;
END $$;

-- 7) Registry-count expectations (defence in depth against schema drift).
DO $$
DECLARE tables_n int; runtime_n int;
BEGIN
  SELECT count(*) INTO tables_n FROM information_schema.tables
   WHERE table_schema='public' AND table_name LIKE 'omni_comms_%';
  IF tables_n < 19 THEN
    RAISE EXCEPTION 'expected at least 19 omni_comms_* tables, found %', tables_n;
  END IF;

  SELECT count(*) INTO runtime_n FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN (
       'omni_comms_batch','omni_comms_request','omni_comms_recipient',
       'omni_comms_message','omni_comms_dispatch_job',
       'omni_comms_delivery_attempt','omni_comms_message_event');
  IF runtime_n <> 7 THEN
    RAISE EXCEPTION 'expected 7 runtime tables, found %', runtime_n;
  END IF;
END $$;

SELECT 'BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK' AS result;
-- NOTE: This marker certifies schema, signatures, grants and security posture
-- only. It does not certify runtime resolution semantics; runtime behaviour
-- must be certified by the privileged integration harness.

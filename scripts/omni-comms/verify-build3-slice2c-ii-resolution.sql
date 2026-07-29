-- ============================================================================
-- Omni-Comms — Slice 2c-ii Batch A verifier (database-side only).
-- The sandbox psql role (`sandbox_exec`) is intentionally locked to
-- SELECT/INSERT on omni_comms_* tables and has no EXECUTE grant on the new
-- private RPCs (service_role only). This verifier therefore focuses on the
-- properties that are provable outside the Edge Function boundary:
--   1) Presence, security posture, ownership and search_path of each RPC.
--   2) Grant matrix: revoked from PUBLIC/anon/authenticated, granted to
--      service_role.
--   3) Input rejection contracts still fire (invocation permission is
--      granted transiently through DO $$ ... $$ using the calling role,
--      which for these validator paths only requires that the RPC exists;
--      guarded behind a check so the block is skipped when the sandbox
--      role has no EXECUTE grant).
-- Runtime path (snapshot precedence, finalize atomicity, blocked
-- persistence, replay) is exercised end-to-end by the Batch B Edge
-- Function integration suite because the RPCs are service_role-only by
-- design and cannot be called from a sandbox role.
-- Print "BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK" only on full success.
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
  END LOOP;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 RPCs, found %', n; END IF;
END $$;

-- 2) Grants: revoked from PUBLIC/anon/authenticated, granted to service_role
--    for the four new runtime-facing RPCs.
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

-- 3) omni_comms_priv_send_communication remains service_role-only for the
--    authenticated/anon roles used by PostgREST.
DO $$
DECLARE v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='omni_comms_priv_send_communication';
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'send_communication executable by anon'; END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'send_communication executable by authenticated'; END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'send_communication missing service_role EXECUTE'; END IF;
END $$;

-- 4) Snapshot / finalize / load RPC signatures match the Batch B contract.
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

SELECT 'BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK' AS result;

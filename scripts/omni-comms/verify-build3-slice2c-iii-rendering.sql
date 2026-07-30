-- ============================================================================
-- Omni-Comms — Accelerated Build 3, Slice 2c-iii verifier (sandbox-safe).
--
-- Proves the DATABASE-SIDE contract for deterministic rendering, immutable
-- message snapshots, the message-event timeline and held (non-runnable)
-- dispatch jobs:
--   * both trusted rendering RPCs exist, are SECURITY DEFINER, owned by
--     postgres and carry a restricted search_path;
--   * EXECUTE is granted to service_role ONLY (never PUBLIC/anon/authenticated);
--   * the load RPC is read-only (STABLE, no mutation statements in the body);
--   * the persistence RPC never writes a delivery attempt and never creates a
--     runnable dispatch job;
--   * message / dispatch_job / message_event remain service_role-only with RLS
--     enabled and forced.
--
-- IT DOES NOT CERTIFY RUNTIME SEMANTICS. Real rendering output, mode-aware
-- behaviour, replay and timeline ordering against the deployed Edge Function
-- must be certified by the privileged integration harness
-- (scripts/omni-comms/integration/run-edge-resolution.ts).
--
-- Marker on success: BUILD 3 SLICE 2C-III RENDERING VERIFY OK
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on

-- 1) Both RPCs exist with the required security posture.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           p.prosecdef AS sec_def,
           p.provolatile AS vol,
           pg_get_userbyid(p.proowner) AS owner,
           coalesce(array_to_string(p.proconfig, ','), '') AS cfg
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN (
        'omni_comms_priv_load_render_context',
        'omni_comms_priv_persist_rendered_messages')
  LOOP
    n := n + 1;
    IF NOT r.sec_def THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER', r.proname;
    END IF;
    IF r.owner <> 'postgres' THEN
      RAISE EXCEPTION '% is owned by % (expected postgres)', r.proname, r.owner;
    END IF;
    IF position('search_path=' in r.cfg) = 0 THEN
      RAISE EXCEPTION '% has no pinned search_path', r.proname;
    END IF;
  END LOOP;

  IF n <> 2 THEN
    RAISE EXCEPTION 'expected 2 Slice 2c-iii rendering RPCs, found %', n;
  END IF;
END $$;

-- 2) The render-context loader must be read-only (STABLE).
DO $$
DECLARE v char;
BEGIN
  SELECT p.provolatile INTO v
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname = 'omni_comms_priv_load_render_context';

  IF v <> 's' THEN
    RAISE EXCEPTION 'omni_comms_priv_load_render_context must be STABLE (found %)', v;
  END IF;
END $$;

-- 3) EXECUTE is granted to service_role only.
DO $$
DECLARE r record; acl text;
BEGIN
  FOR r IN
    SELECT p.proname, coalesce(array_to_string(p.proacl, ','), '') AS acl
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN (
        'omni_comms_priv_load_render_context',
        'omni_comms_priv_persist_rendered_messages')
  LOOP
    acl := r.acl;
    IF acl = '' THEN
      RAISE EXCEPTION '% has a default (PUBLIC-executable) ACL', r.proname;
    END IF;
    IF position('=X/' in acl) > 0 AND position('anon=X' in acl) > 0 THEN
      RAISE EXCEPTION '% grants EXECUTE to anon', r.proname;
    END IF;
    IF position('authenticated=X' in acl) > 0 THEN
      RAISE EXCEPTION '% grants EXECUTE to authenticated', r.proname;
    END IF;
    IF position('service_role=X' in acl) = 0 THEN
      RAISE EXCEPTION '% does not grant EXECUTE to service_role', r.proname;
    END IF;
  END LOOP;
END $$;

-- 4) The persistence RPC must never write a delivery attempt and must never
--    create a runnable dispatch job.
DO $$
DECLARE body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname = 'omni_comms_priv_persist_rendered_messages';

  IF body IS NULL THEN
    RAISE EXCEPTION 'omni_comms_priv_persist_rendered_messages not found';
  END IF;

  IF body ~* 'insert\s+into\s+public\.omni_comms_delivery_attempt' THEN
    RAISE EXCEPTION 'persistence RPC writes omni_comms_delivery_attempt (forbidden in Slice 2c-iii)';
  END IF;

  IF body !~* 'runnable_job_forbidden' THEN
    RAISE EXCEPTION 'persistence RPC lacks the runnable_job_forbidden guard';
  END IF;

  IF body !~* 'dry_run_jobs_forbidden' THEN
    RAISE EXCEPTION 'persistence RPC lacks the dry_run_jobs_forbidden guard';
  END IF;
END $$;

-- 5) The render-context loader must not mutate anything.
DO $$
DECLARE body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname = 'omni_comms_priv_load_render_context';

  IF body ~* '(insert\s+into|update\s+public\.|delete\s+from)\s*' THEN
    RAISE EXCEPTION 'omni_comms_priv_load_render_context contains a mutation statement';
  END IF;
END $$;

-- 6) Runtime spine tables keep RLS enabled + forced and remain service_role-only.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
           coalesce(array_to_string(c.relacl, ','), '') AS acl
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relname IN (
        'omni_comms_message',
        'omni_comms_dispatch_job',
        'omni_comms_message_event')
  LOOP
    n := n + 1;
    IF NOT r.relrowsecurity THEN
      RAISE EXCEPTION '% does not have RLS enabled', r.relname;
    END IF;
    IF NOT r.relforcerowsecurity THEN
      RAISE EXCEPTION '% does not FORCE RLS', r.relname;
    END IF;
    IF position('anon=' in r.acl) > 0 THEN
      RAISE EXCEPTION '% grants privileges to anon', r.relname;
    END IF;
    IF position('authenticated=' in r.acl) > 0 THEN
      RAISE EXCEPTION '% grants privileges to authenticated', r.relname;
    END IF;
  END LOOP;

  IF n <> 3 THEN
    RAISE EXCEPTION 'expected 3 runtime spine tables, found %', n;
  END IF;
END $$;

-- 7) No runnable dispatch job may exist in this build.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM public.omni_comms_dispatch_job
  WHERE status <> 'held';

  IF bad > 0 THEN
    RAISE EXCEPTION '% dispatch job(s) are not held — Slice 2c-iii forbids runnable jobs', bad;
  END IF;
END $$;

-- 8) No delivery attempt may exist in this build.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.omni_comms_delivery_attempt;
  IF bad > 0 THEN
    RAISE EXCEPTION '% delivery attempt row(s) exist — no provider contact is permitted', bad;
  END IF;
END $$;

SELECT 'BUILD 3 SLICE 2C-III RENDERING VERIFY OK' AS result;

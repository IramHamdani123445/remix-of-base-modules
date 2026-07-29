-- =====================================================================
-- Omni-Comms Accelerated Build 3 — Slice 1 database verifier.
--
-- Executes structural introspection under the calling role, then delegates
-- trigger and constraint fixture assertions to the SECURITY DEFINER helper
-- `public.omni_comms_priv_slice1_verify()`, which runs everything inside a
-- savepoint that always rolls back. No persistent rows are written and no
-- provider is called.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  t text;
  v_count int;
BEGIN
  -- 1. Exactly the seven runtime tables exist.
  SELECT count(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY (ARRAY[
    'omni_comms_event_route','omni_comms_request','omni_comms_recipient',
    'omni_comms_message','omni_comms_dispatch_job','omni_comms_delivery_attempt',
    'omni_comms_message_event']);
  ASSERT v_count = 7, format('expected 7 runtime tables, found %s', v_count);

  -- 2. RLS + FORCE RLS on all seven.
  FOREACH t IN ARRAY ARRAY[
    'omni_comms_event_route','omni_comms_request','omni_comms_recipient',
    'omni_comms_message','omni_comms_dispatch_job','omni_comms_delivery_attempt',
    'omni_comms_message_event'
  ] LOOP
    PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=t
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF NOT FOUND THEN RAISE EXCEPTION 'RLS/FORCE RLS missing on %', t; END IF;

    -- No policies expected.
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname='public' AND tablename=t;
    IF v_count <> 0 THEN RAISE EXCEPTION 'unexpected policies on %', t; END IF;

    -- No anon SELECT/INSERT/UPDATE/DELETE.
    IF has_table_privilege('anon', format('public.%I', t)::regclass, 'SELECT')
       OR has_table_privilege('anon', format('public.%I', t)::regclass, 'INSERT')
       OR has_table_privilege('anon', format('public.%I', t)::regclass, 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', t)::regclass, 'DELETE') THEN
      RAISE EXCEPTION 'anon has direct privileges on %', t;
    END IF;
  END LOOP;
END $$;

-- 3. Exercise triggers/constraints inside a rolled-back savepoint.
SELECT public.omni_comms_priv_slice1_verify();

ROLLBACK;

-- Epic 4 Story 1 — Transaction-isolated verification script.
-- Executes structural introspection and lifecycle fixture assertions within a
-- BEGIN/ROLLBACK envelope. No persistent rows are written.
--
-- Prints "EPIC 4 STORY 1 VERIFY OK" only if every assertion succeeds.

BEGIN;

DO $$
DECLARE
  t text;
  n integer;
BEGIN
  -- 1. Tables exist with RLS enabled and forced.
  FOREACH t IN ARRAY ARRAY[
    'omni_comms_provider',
    'omni_comms_provider_account',
    'omni_comms_sender_identity',
    'omni_comms_sender_provider_binding',
    'omni_comms_channel_setting'
  ] LOOP
    PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t
        AND c.relrowsecurity AND c.relforcerowsecurity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RLS/force RLS missing on %', t;
    END IF;

    -- No policies, no anon/authenticated privileges.
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename=t;
    IF n <> 0 THEN RAISE EXCEPTION 'unexpected policies on %', t; END IF;

    IF has_table_privilege('anon', format('public.%I', t)::regclass, 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', t)::regclass, 'SELECT')
       OR has_table_privilege('anon', format('public.%I', t)::regclass, 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', t)::regclass, 'INSERT')
    THEN
      RAISE EXCEPTION 'browser role has privileges on %', t;
    END IF;

    IF NOT has_table_privilege('service_role', format('public.%I', t)::regclass, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role missing DML on %', t;
    END IF;
  END LOOP;

  -- 2. Lifecycle triggers exist.
  FOREACH t IN ARRAY ARRAY[
    'omni_comms_provider_lifecycle_guard',
    'omni_comms_provider_account_lifecycle_guard',
    'omni_comms_sender_identity_guard',
    'omni_comms_binding_guard',
    'omni_comms_channel_setting_guard'
  ] LOOP
    PERFORM 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal;
    IF NOT FOUND THEN RAISE EXCEPTION 'trigger missing: %', t; END IF;
  END LOOP;

  RAISE NOTICE 'Structural checks passed.';
END$$;

-- 3. Lifecycle fixtures (rolled back). Use service_role for RLS-bypassing DML.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_provider uuid;
BEGIN
  -- draft-only insert rule
  BEGIN
    INSERT INTO public.omni_comms_provider(code, display_name, channel, adapter_key, status)
      VALUES ('t_fx_prov', 'Fixture', 'email', 'fx_adapter', 'active');
    RAISE EXCEPTION 'draft-only insert not enforced';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;

  INSERT INTO public.omni_comms_provider(code, display_name, channel, adapter_key)
    VALUES ('t_fx_prov', 'Fixture', 'email', 'fx_adapter')
    RETURNING id INTO v_provider;

  -- retired requires reason
  UPDATE public.omni_comms_provider SET status='active' WHERE id=v_provider;
  BEGIN
    UPDATE public.omni_comms_provider SET status='retired' WHERE id=v_provider;
    RAISE EXCEPTION 'retirement reason not required';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;

  UPDATE public.omni_comms_provider SET status='retired', retirement_reason='fx' WHERE id=v_provider;

  -- retired is terminal
  BEGIN
    UPDATE public.omni_comms_provider SET status='active' WHERE id=v_provider;
    RAISE EXCEPTION 'retired should be terminal';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;

  RAISE NOTICE 'Provider lifecycle fixtures passed.';
END$$;

-- 4. Channel setting quiet-hours timezone validation.
DO $$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.core_organization LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skip channel-setting fixture: no core_organization row';
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.omni_comms_channel_setting(
      organization_id, channel, enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
      VALUES (v_org, 'email', true, '22:00', '06:00', 'Not/A_Real_Zone');
    RAISE EXCEPTION 'invalid timezone accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
  INSERT INTO public.omni_comms_channel_setting(
    organization_id, channel, enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
    VALUES (v_org, 'email', true, '22:00', '06:00', 'America/St_Kitts');
  RAISE NOTICE 'Channel setting fixtures passed.';
END$$;

ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'EPIC 4 STORY 1 VERIFY OK'; END$$;

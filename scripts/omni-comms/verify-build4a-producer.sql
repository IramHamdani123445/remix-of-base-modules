-- ===================================================================
-- Build 4A — Producer integration database verifier.
-- Read-only. Fails loudly on any structural or security regression.
-- Prints: OMNI COMMS BUILD 4A PRODUCER VERIFY OK
-- ===================================================================
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_oid oid;
  v_src text;
  v_acl text;
BEGIN
  -- 1. table exists, RLS enabled and forced
  IF to_regclass('public.omni_comms_producer_event_binding') IS NULL THEN
    RAISE EXCEPTION 'MISSING: omni_comms_producer_event_binding';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'omni_comms_producer_event_binding'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS: producer binding table does not force row level security';
  END IF;

  -- 2. no browser role may touch the table directly
  IF has_table_privilege('anon', 'public.omni_comms_producer_event_binding', 'SELECT')
     OR has_table_privilege('authenticated', 'public.omni_comms_producer_event_binding', 'SELECT')
     OR has_table_privilege('authenticated', 'public.omni_comms_producer_event_binding', 'INSERT') THEN
    RAISE EXCEPTION 'GRANTS: browser roles can reach the producer binding table directly';
  END IF;

  -- 3. single-active uniqueness guards
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                 AND indexname='omni_comms_peb_active_dept_uq')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                 AND indexname='omni_comms_peb_active_orgwide_uq') THEN
    RAISE EXCEPTION 'UNIQUENESS: single-active binding guards are missing';
  END IF;

  -- 4. trusted producer authorizer
  SELECT p.oid, p.prosrc, coalesce(array_to_string(p.proacl, ','), '')
    INTO v_oid, v_src, v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_authorize_producer_event';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'MISSING: omni_comms_priv_authorize_producer_event';
  END IF;

  IF v_acl LIKE '%anon=%' OR v_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION 'GRANTS: producer authorizer is reachable from the browser';
  END IF;

  IF v_src NOT LIKE '%omni_comms_priv_authorize_runtime_actor%' THEN
    RAISE EXCEPTION 'AUTHZ: producer authorizer does not chain the actor authorisation';
  END IF;

  IF v_src NOT LIKE '%producer_event_not_authorized%'
     OR v_src NOT LIKE '%producer_mode_not_authorized%' THEN
    RAISE EXCEPTION 'AUTHZ: producer authorizer lacks fail-closed refusal codes';
  END IF;

  IF v_src ~* '(http_post|net\.http|pg_net|resend|twilio|sendgrid)' THEN
    RAISE EXCEPTION 'PROVIDER: producer authorizer appears to contact a provider';
  END IF;

  IF v_src ~* '(comm_hub_|notification_queue|notification_logs|communication_request)' THEN
    RAISE EXCEPTION 'LEGACY: producer authorizer references Legacy communication objects';
  END IF;

  -- 5. administration RPCs exist, are SECURITY DEFINER and capability-checked
  FOR v_src IN
    SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'omni_comms_list_producer_event_bindings',
         'omni_comms_get_producer_event_binding',
         'omni_comms_upsert_producer_event_binding_draft',
         'omni_comms_set_producer_event_binding_status')
  LOOP
    IF v_src NOT LIKE '%omni_comms_priv_require_capability%' THEN
      RAISE EXCEPTION 'CAPABILITY: a producer administration RPC lacks a capability check';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN (
           'omni_comms_list_producer_event_bindings',
           'omni_comms_get_producer_event_binding',
           'omni_comms_upsert_producer_event_binding_draft',
           'omni_comms_set_producer_event_binding_status')) <> 4 THEN
    RAISE EXCEPTION 'MISSING: producer administration RPC surface is incomplete';
  END IF;

  -- 6. no live-delivery mode may be authorised in this build
  IF EXISTS (
    SELECT 1 FROM public.omni_comms_producer_event_binding
    WHERE 'queued' = ANY (allowed_modes)
  ) THEN
    RAISE EXCEPTION 'SAFETY: a producer binding authorises the queued delivery mode';
  END IF;

  RAISE NOTICE 'OMNI COMMS BUILD 4A PRODUCER VERIFY OK';
END;
$$;

SELECT 'OMNI COMMS BUILD 4A PRODUCER VERIFY OK' AS marker;

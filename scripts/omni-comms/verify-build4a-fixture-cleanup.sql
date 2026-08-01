-- ===================================================================
-- Build 4A — certification fixture cleanup verifier.
-- Read-only. Fails loudly if any certification fixture, temporary
-- authorization assignment or injected fault mechanism survives a run.
--
-- Usage:
--   psql "$DB" -v cert_org='<uuid>' -v cert_foreign_org='<uuid>' \
--        -v cert_namespace='<NS>' \
--        -f scripts/omni-comms/verify-build4a-fixture-cleanup.sql
--
-- Prints: OMNI COMMS BUILD 4A FIXTURE CLEANUP OK
-- ===================================================================
\set ON_ERROR_STOP on
\if :{?cert_foreign_org}
\else
\set cert_foreign_org :cert_org
\endif

DO $$
DECLARE
  v_org     uuid := :'cert_org';
  v_foreign uuid := :'cert_foreign_org';
  v_ns      text := :'cert_namespace';
  v_orgs    uuid[];
  v_n       bigint;
  v_tbl     text;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'INPUT: cert_org is required';
  END IF;
  IF v_ns IS NULL OR btrim(v_ns) = '' THEN
    RAISE EXCEPTION 'INPUT: cert_namespace is required';
  END IF;

  v_orgs := ARRAY[v_org] || CASE
              WHEN v_foreign IS NOT NULL AND v_foreign <> v_org THEN ARRAY[v_foreign]
              ELSE ARRAY[]::uuid[]
            END;

  -- Every certification organisation must be a namespaced fixture tenant.
  IF EXISTS (
    SELECT 1 FROM public.core_organization
     WHERE id = ANY(v_orgs) AND org_code NOT LIKE v_ns || '%'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.core_organization
     WHERE id = v_org AND org_code LIKE v_ns || '%'
  ) THEN
    RAISE EXCEPTION 'SCOPE: a certification organisation is not inside the certification namespace';
  END IF;

  -- 1. no Build 4A or runtime rows may remain for any certification tenant
  FOREACH v_tbl IN ARRAY ARRAY[
    'omni_comms_producer_event_binding',
    'omni_comms_event_route',
    'omni_comms_template_family',
    'omni_comms_sender_identity',
    'omni_comms_request',
    'omni_comms_message',
    'omni_comms_message_event',
    'omni_comms_dispatch_job',
    'omni_comms_delivery_attempt'
  ] LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE organization_id = ANY($1)', v_tbl
    ) INTO v_n USING v_orgs;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'CLEANUP: % certification rows remain in %', v_n, v_tbl;
    END IF;
  END LOOP;

  -- 2. no certification department fixtures may remain
  SELECT count(*) INTO v_n FROM public.core_department WHERE organization_id = ANY(v_orgs);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CLEANUP: % certification department fixtures remain', v_n;
  END IF;

  -- 3. no injected fault mechanism may remain anywhere — trigger OR function,
  --    for this run identifier or any interrupted previous run.
  SELECT count(*) INTO v_n
    FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgname LIKE 'omni\_comms\_cert\_fault\_%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SAFETY: % injected certification fault trigger(s) remain', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'omni\_comms\_cert\_fault\_%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SAFETY: % injected certification fault function(s) remain', v_n;
  END IF;

  -- 4. certification identities must never hold lingering authorization
  SELECT count(*) INTO v_n
    FROM public.core_staff_assignments a
   WHERE a.organization_id = ANY(v_orgs);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CLEANUP: % certification authorization assignment(s) remain', v_n;
  END IF;

  -- 5. the real pilot tenant must be untouched by certification namespacing
  SELECT count(*) INTO v_n
    FROM public.omni_comms_producer_event_binding b
    JOIN public.core_organization o ON o.id = b.organization_id
   WHERE o.org_code <> 'SKN-SSB'
     AND o.org_code LIKE v_ns || '%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CLEANUP: % namespaced producer bindings remain', v_n;
  END IF;

  RAISE NOTICE 'OMNI COMMS BUILD 4A FIXTURE CLEANUP OK';
END;
$$;

SELECT 'OMNI COMMS BUILD 4A FIXTURE CLEANUP OK' AS marker;

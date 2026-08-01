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

  -- 7. AUTHORIZER GRANTS: trusted runtime only.
  IF NOT has_function_privilege('service_role',
        'public.omni_comms_priv_authorize_producer_event(uuid,uuid,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AUTHORIZER GRANTS: service_role cannot execute the producer authorizer';
  END IF;

  IF has_function_privilege('anon',
        'public.omni_comms_priv_authorize_producer_event(uuid,uuid,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AUTHORIZER GRANTS: anon can execute the producer authorizer';
  END IF;

  IF has_function_privilege('authenticated',
        'public.omni_comms_priv_authorize_producer_event(uuid,uuid,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AUTHORIZER GRANTS: authenticated can execute the producer authorizer';
  END IF;

  SELECT coalesce(array_to_string(p.proacl, ','), '') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_authorize_producer_event';

  IF v_acl = '' OR v_acl LIKE '%=X/%' AND v_acl ~ '(^|,)=X' THEN
    RAISE EXCEPTION 'AUTHORIZER GRANTS: PUBLIC retains execute on the producer authorizer';
  END IF;

  -- 8. the request table records the trusted binding, immutably
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='omni_comms_request'
       AND column_name='producer_event_binding_id' AND data_type='uuid'
  ) THEN
    RAISE EXCEPTION 'MISSING: omni_comms_request.producer_event_binding_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'omni_comms_request_producer_event_binding_fkey'
  ) THEN
    RAISE EXCEPTION 'MISSING: producer binding foreign key on omni_comms_request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'omni_comms_request_binding_immutable_trg' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'IMMUTABILITY: producer binding on a request is not protected';
  END IF;

  -- 9. the send RPC accepts the binding and is service_role-only
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='omni_comms_priv_send_communication'
       AND pg_get_function_arguments(p.oid) LIKE '%p_producer_event_binding_id uuid%'
  ) THEN
    RAISE EXCEPTION 'MISSING: send RPC does not accept the trusted producer binding';
  END IF;

  IF has_function_privilege('authenticated',
        'public.omni_comms_priv_send_communication(uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text[],uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
        'public.omni_comms_priv_send_communication(uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text[],uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANTS: browser roles can execute the send RPC';
  END IF;

  -- 10. tenant authorisation on every producer administration RPC
  FOR v_src IN
    SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'omni_comms_list_producer_event_bindings',
         'omni_comms_get_producer_event_binding',
         'omni_comms_upsert_producer_event_binding_draft',
         'omni_comms_set_producer_event_binding_status')
  LOOP
    IF v_src NOT LIKE '%omni_comms_priv_require_tenant_access%' THEN
      RAISE EXCEPTION 'TENANCY: a producer administration RPC lacks organisation/department authorisation';
    END IF;
  END LOOP;

  -- 11. the pilot event, contract, template, layout, route and binding exist
  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_event_definition
     WHERE code = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'PILOT: the application-submitted event is not active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_event_contract c
      JOIN public.omni_comms_event_definition e ON e.id = c.event_definition_id
     WHERE e.code = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED'
       AND c.status = 'published'
       AND c.json_schema -> 'properties' ? 'reference'
       AND c.json_schema -> 'properties' ? 'subjectName'
       AND c.json_schema -> 'properties' ? 'submissionStatus'
       AND c.json_schema -> 'properties' ? 'submittedAt'
  ) THEN
    RAISE EXCEPTION 'PILOT: the published contract does not use the agreed vocabulary';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_template_version tv
      JOIN public.omni_comms_template_family tf ON tf.id = tv.template_family_id
     WHERE tf.code = 'pilot_registration_employer_application_submitted'
       AND tf.status = 'active'
       AND tv.channel = 'email'
       AND tv.status = 'published'
       AND tv.layout_selection_mode = 'pinned'
       AND tv.layout_id IS NOT NULL
       AND tv.pinned_layout_version_id IS NOT NULL
       AND tv.content ->> 'subject' LIKE '%{{payload.reference}}%'
       AND tv.content ->> 'text' LIKE '%{{payload.subjectName}}%'
       AND tv.content ->> 'text' LIKE '%{{payload.submissionStatus}}%'
       AND tv.content ->> 'text' LIKE '%{{payload.submittedAt}}%'
  ) THEN
    RAISE EXCEPTION 'PILOT: the published email template is missing or misaligned';
  END IF;

  -- receipt-only wording
  IF EXISTS (
    SELECT 1 FROM public.omni_comms_template_version tv
      JOIN public.omni_comms_template_family tf ON tf.id = tv.template_family_id
     WHERE tf.code = 'pilot_registration_employer_application_submitted'
       AND (lower(tv.content ->> 'text') ~ '(approved|registration is complete|now active|effective date has been established)'
            OR lower(tv.content ->> 'html') ~ '(approved|registration is complete|now active|effective date has been established)'
            OR lower(tv.content ->> 'subject') ~ '(approved|complete|active)')
  ) THEN
    RAISE EXCEPTION 'PILOT: the acknowledgement implies approval, completion or activation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_event_route r
      JOIN public.omni_comms_event_definition e ON e.id = r.event_definition_id
     WHERE e.code = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED'
       AND r.channel = 'email' AND r.lifecycle_state = 'active' AND r.is_enabled
  ) THEN
    RAISE EXCEPTION 'PILOT: no active email route for the application-submitted event';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_producer_event_binding b
      JOIN public.omni_comms_event_definition e ON e.id = b.event_definition_id
     WHERE e.code = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED'
       AND b.caller_module_code = 'EMPLOYER_REGISTRATION'
       AND b.status = 'active'
  ) THEN
    RAISE EXCEPTION 'PILOT: the application-submitted producer binding is not active';
  END IF;

  -- 12. the completed-registration event must NOT be producible on submission
  IF EXISTS (
    SELECT 1 FROM public.omni_comms_producer_event_binding b
      JOIN public.omni_comms_event_definition e ON e.id = b.event_definition_id
     WHERE e.code = 'REGISTRATION.EMPLOYER.REGISTERED'
       AND b.caller_module_code = 'EMPLOYER_REGISTRATION'
       AND b.status <> 'retired'
  ) THEN
    RAISE EXCEPTION 'PILOT: employer registration may still emit the completed-registration event';
  END IF;

  -- 13. bootstrap operation is present and non-production guarded
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_priv_bootstrap_employer_registration_pilot';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'MISSING: employer registration pilot bootstrap';
  END IF;
  IF v_src NOT LIKE '%omni_comms_priv_pilot_assert_non_production%' THEN
    RAISE EXCEPTION 'SAFETY: the pilot bootstrap is not restricted to non-production';
  END IF;

  RAISE NOTICE 'OMNI COMMS BUILD 4A PRODUCER VERIFY OK';
END;
$$;

SELECT 'OMNI COMMS BUILD 4A PRODUCER VERIFY OK' AS marker;

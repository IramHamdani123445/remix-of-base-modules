-- ===================================================================
-- Omni-Comms — Phase 3 Live Health Diagnostics database verifier.
-- Read-only. Fails loudly on any structural or security regression.
-- Prints: OMNI COMMS HEALTH LIVE DIAGNOSTICS VERIFY OK
-- ===================================================================
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_fns text[] := ARRAY[
    'omni_comms_health_summary',
    'omni_comms_health_catalogue',
    'omni_comms_health_runtime',
    'omni_comms_health_permissions'
  ];
  v_fn text;
  v_oid oid;
  v_src text;
  v_cfg text[];
  v_acl text;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    SELECT p.oid, p.prosrc, p.proconfig, coalesce(array_to_string(p.proacl, ','), '')
      INTO v_oid, v_src, v_cfg, v_acl
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;

    -- 1. exists
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'MISSING: public.% does not exist', v_fn;
    END IF;

    -- 2. owner is postgres
    IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_oid) <> 'postgres' THEN
      RAISE EXCEPTION 'OWNER: public.% is not owned by postgres', v_fn;
    END IF;

    -- 3. SECURITY DEFINER
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'SECDEF: public.% is not SECURITY DEFINER', v_fn;
    END IF;

    -- 4. safe pinned search path
    IF v_cfg IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%pg_catalog%'
    ) THEN
      RAISE EXCEPTION 'SEARCH_PATH: public.% has no safe pinned search_path', v_fn;
    END IF;

    -- 5. PUBLIC and anon revoked, authenticated granted
    IF v_acl = '' THEN
      RAISE EXCEPTION 'GRANTS: public.% still carries default PUBLIC EXECUTE', v_fn;
    END IF;
    IF v_acl LIKE '%=X/%' AND v_acl ~ '(^|,)=X/' THEN
      RAISE EXCEPTION 'GRANTS: public.% grants EXECUTE to PUBLIC', v_fn;
    END IF;
    IF v_acl LIKE '%anon=%' THEN
      RAISE EXCEPTION 'GRANTS: public.% grants EXECUTE to anon', v_fn;
    END IF;
    IF v_acl NOT LIKE '%authenticated=X%' THEN
      RAISE EXCEPTION 'GRANTS: public.% does not grant EXECUTE to authenticated', v_fn;
    END IF;

    -- 6. omni_comms.view capability check present
    IF v_src NOT LIKE '%omni_comms_priv_require_capability(''view'')%' THEN
      RAISE EXCEPTION 'CAPABILITY: public.% does not require the omni_comms.view capability', v_fn;
    END IF;

    -- 7. organisation scope mandatory
    IF v_src NOT LIKE '%p_organization_id IS NULL%' THEN
      RAISE EXCEPTION 'SCOPE: public.% does not enforce a mandatory organisation scope', v_fn;
    END IF;

    -- 8. department ownership validated when supplied
    IF v_src NOT LIKE '%omni_comms_priv_verify_department_ownership%' THEN
      RAISE EXCEPTION 'SCOPE: public.% does not validate department ownership', v_fn;
    END IF;

    -- 9. no mutation
    IF v_src ~* '(^|[^a-z_])(insert\s+into|update\s+public\.|delete\s+from|truncate)([^a-z_]|$)' THEN
      RAISE EXCEPTION 'MUTATION: public.% contains a mutating statement', v_fn;
    END IF;

    -- 10. no provider call / no HTTP
    IF v_src ~* '(http_post|net\.http|pg_net|extensions\.http|resend|twilio|sendgrid)' THEN
      RAISE EXCEPTION 'PROVIDER: public.% appears to contact a provider', v_fn;
    END IF;

    -- 11. no secret return fields
    -- Reading a credential-presence flag is allowed; RETURNING one is not.
    IF v_src ~* '''(secret_ref|api_key|access_token|authorization)''\s*,\s*(v_|p_|\(|coalesce|e->)' THEN
      RAISE EXCEPTION 'SECRET: public.% returns secret metadata', v_fn;
    END IF;

    -- 12. no Legacy references
    IF v_src ~* '(comm_hub_|core_template_version_channel|notification_queue|notification_logs|communication_request|communication_message)' THEN
      RAISE EXCEPTION 'LEGACY: public.% references Legacy communication objects', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'OMNI COMMS HEALTH LIVE DIAGNOSTICS VERIFY OK';
END;
$$;

-- Registry ceilings are asserted in TypeScript (routeRegistry / objectRegistry)
-- and re-asserted here as a data-independent reminder of the fixed counts.
SELECT 'permanent_admin_routes'::text AS ceiling, 7 AS expected
UNION ALL
SELECT 'logical_database_objects', 19;

SELECT 'OMNI COMMS HEALTH LIVE DIAGNOSTICS VERIFY OK' AS marker;

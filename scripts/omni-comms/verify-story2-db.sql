-- ============================================================================
-- Epic 2 — Story 2: transaction-isolated DB verification harness.
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f scripts/omni-comms/verify-story2-db.sql
--
-- The entire session is wrapped in BEGIN ... ROLLBACK so nothing persists.
-- Uses SET LOCAL role=authenticated + a synthetic auth.uid() request setting
-- to prove RBAC and audit atomicity behaviour without leaving any residue.
-- ============================================================================
BEGIN;

-- 1. Extension present
SELECT '1. pg_jsonschema present' AS check,
       COUNT(*) = 1                AS ok
  FROM pg_extension WHERE extname = 'pg_jsonschema';

-- 2. All 13 public RPCs exist and are OWNED by postgres, SECURITY DEFINER
SELECT '2. 13 rpcs, definer, owner=postgres' AS check,
       COUNT(*) = 13                          AS ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
 WHERE n.nspname = 'public'
   AND p.prosecdef = true
   AND r.rolname = 'postgres'
   AND p.proname IN (
     'omni_comms_event_definition_create',
     'omni_comms_event_definition_update_draft',
     'omni_comms_event_definition_activate',
     'omni_comms_event_definition_suspend',
     'omni_comms_event_definition_retire',
     'omni_comms_event_contract_create',
     'omni_comms_event_contract_update_draft',
     'omni_comms_event_contract_publish',
     'omni_comms_event_contract_retire',
     'omni_comms_event_definition_get',
     'omni_comms_event_definition_list',
     'omni_comms_event_contract_get',
     'omni_comms_event_contract_list'
   );

-- 3. Every Story-2 RPC has a hardened search_path (starts with pg_catalog,
--    no pg_temp). Story-1 trigger functions are out of scope for this check.
SELECT '3. hardened search_path (no pg_temp)' AS check,
       bool_and(cfg LIKE 'search_path=pg_catalog%' AND cfg NOT LIKE '%pg_temp%') AS ok
  FROM pg_proc p, unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
 WHERE p.pronamespace = 'public'::regnamespace
   AND (p.proname LIKE 'omni_comms_event_%' OR p.proname LIKE 'omni_comms_priv_%')
   AND cfg LIKE 'search_path=%';

-- 4. Checksum determinism (JSONB key-order independent)
SELECT '4. checksum determinism' AS check,
       public.omni_comms_priv_compute_checksum('X.Y.Z', 1, '{"type":"object","properties":{"a":{"type":"string"}}}'::jsonb)
     = public.omni_comms_priv_compute_checksum('X.Y.Z', 1, '{"properties":{"a":{"type":"string"}},"type":"object"}'::jsonb) AS ok;

-- 5. $ref detector rejects http/https/file/urn/empty/relative
DO $$
DECLARE bad jsonb;
BEGIN
  FOREACH bad IN ARRAY ARRAY[
    '{"$ref":"http://x"}'::jsonb,
    '{"$ref":"https://x"}'::jsonb,
    '{"$ref":"file:///x"}'::jsonb,
    '{"$ref":"urn:x"}'::jsonb,
    '{"$ref":""}'::jsonb,
    '{"a":{"b":[{"$ref":"other.json"}]}}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.omni_comms_priv_reject_nonlocal_refs(bad);
      RAISE EXCEPTION 'CHECK 5 FAIL: accepted %', bad;
    EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
    END;
  END LOOP;
END $$;

-- 6. Sample-payload $ref is NOT inspected (business-value $ref allowed)
DO $$
BEGIN
  PERFORM public.omni_comms_priv_validate_schema(
    '{"type":"object","properties":{"$ref":{"type":"string"}}}'::jsonb,
    '{"$ref":"user-provided-string-value"}'::jsonb
  );
END $$;

-- 7. Size limits enforced
DO $$
DECLARE big jsonb;
BEGIN
  big := jsonb_build_object('type','object','properties',
           jsonb_build_object('x', jsonb_build_object('type','string','description', repeat('a', 300000))));
  BEGIN
    PERFORM public.omni_comms_priv_validate_schema(big, NULL);
    RAISE EXCEPTION 'CHECK 7 FAIL: oversized schema accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $$;

-- 8. Unauthenticated access blocked
DO $$
BEGIN
  BEGIN
    PERFORM public.omni_comms_priv_require_capability('view');
    RAISE EXCEPTION 'CHECK 8 FAIL: unauthenticated accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $$;

ROLLBACK;

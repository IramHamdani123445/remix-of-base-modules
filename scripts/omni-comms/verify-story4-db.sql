-- scripts/omni-comms/verify-story4-db.sql
-- Epic 2 — Story 4 final introspection script for the Event Catalogue.
-- Runs read-only checks + isolated behavior fixtures inside a rolled-back
-- transaction. Run only against the approved local/test database.
--
-- Usage:
--   psql "$LOCAL_DB_URL" -f scripts/omni-comms/verify-story4-db.sql
--
-- No persistent rows are written.

\set ON_ERROR_STOP on
\pset pager off

\echo === 1. Approved tables exist with expected columns ===
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('omni_comms_event_definition','omni_comms_event_contract')
ORDER BY table_name, ordinal_position;

\echo === 2. Only two Epic 2 business tables exist under the omni_comms prefix ===
SELECT tablename
FROM pg_tables
WHERE schemaname='public' AND tablename LIKE 'omni_comms_%'
ORDER BY tablename;

\echo === 3. Constraints, PKs, FKs, CHECKs, UNIQUEs ===
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('public.omni_comms_event_definition'::regclass,
                   'public.omni_comms_event_contract'::regclass)
ORDER BY conrelid::regclass::text, contype, conname;

\echo === 4. Indexes ===
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('omni_comms_event_definition','omni_comms_event_contract')
ORDER BY tablename, indexname;

\echo === 5. Triggers ===
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid IN ('public.omni_comms_event_definition'::regclass,
                  'public.omni_comms_event_contract'::regclass)
  AND NOT tgisinternal
ORDER BY tgname;

\echo === 6. RLS enabled and owner ===
SELECT c.relname, c.relrowsecurity AS rls, r.rolname AS owner
FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
WHERE c.relnamespace='public'::regnamespace
  AND c.relname IN ('omni_comms_event_definition','omni_comms_event_contract');

\echo === 7. Role BYPASSRLS flags ===
SELECT rolname, rolbypassrls
FROM pg_roles
WHERE rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY rolname;

\echo === 8. Direct table grants (must show no anon/authenticated) ===
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('omni_comms_event_definition','omni_comms_event_contract')
ORDER BY table_name, grantee, privilege_type;

\echo === 9. Function inventory: SECURITY DEFINER, owner, search_path ===
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       r.rolname AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_roles r ON r.oid=p.proowner
WHERE n.nspname='public' AND p.proname LIKE 'omni_comms%'
ORDER BY p.proname;

\echo === 10. Function ACLs (anon must be absent; authenticated only on the 13 public RPCs) ===
SELECT p.proname, array_to_string(p.proacl, ',') AS acl
FROM pg_proc p
WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'omni_comms%'
ORDER BY p.proname;

\echo === 11. Extensions ===
SELECT extname, extversion, n.nspname AS schema
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
WHERE extname IN ('pg_jsonschema','pgcrypto')
ORDER BY extname;

\echo === 12. Behavior fixtures (isolated + rolled back) ===
BEGIN;
SAVEPOINT s0;

-- 12a. Non-local $ref must be rejected.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.omni_comms_priv_reject_nonlocal_refs(
      '{"$ref":"https://example.com/schema.json"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: non-local $ref not rejected'; END IF;
  RAISE NOTICE 'PASS: non-local $ref rejected';
END $$;

-- 12b. Local $ref is accepted.
DO $$
BEGIN
  PERFORM public.omni_comms_priv_reject_nonlocal_refs(
    '{"$ref":"#/definitions/Thing","definitions":{"Thing":{"type":"string"}}}'::jsonb);
  RAISE NOTICE 'PASS: local $ref accepted';
END $$;

-- 12c. Checksum is deterministic and independent of key insertion order.
DO $$
DECLARE a text; b text;
BEGIN
  a := public.omni_comms_priv_compute_checksum(
    'MOD.ENT.ACT', 1,
    '{"type":"object","properties":{"x":{"type":"string"},"y":{"type":"integer"}}}'::jsonb);
  b := public.omni_comms_priv_compute_checksum(
    'MOD.ENT.ACT', 1,
    '{"properties":{"y":{"type":"integer"},"x":{"type":"string"}},"type":"object"}'::jsonb);
  IF a IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'FAIL: checksum not order-independent (% vs %)', a, b;
  END IF;
  IF a !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'FAIL: checksum shape %', a;
  END IF;
  RAISE NOTICE 'PASS: checksum deterministic (%)', a;
END $$;

-- 12d. Reason enforcement.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.omni_comms_priv_normalize_reason(NULL, true);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: required reason not enforced'; END IF;
  RAISE NOTICE 'PASS: required reason enforced';
END $$;

-- 12e. Reason length bound (2,000 chars).
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.omni_comms_priv_normalize_reason(repeat('x', 2100), true);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: reason length bound not enforced'; END IF;
  RAISE NOTICE 'PASS: reason length bound enforced';
END $$;

-- 12f. ILIKE escaper.
DO $$
DECLARE e text;
BEGIN
  e := public.omni_comms_priv_escape_ilike('a%b_c\d');
  IF e NOT LIKE '%\\%%' OR e NOT LIKE '%\\_%' OR e NOT LIKE '%\\\\%' THEN
    RAISE EXCEPTION 'FAIL: ILIKE escaper output = %', e;
  END IF;
  RAISE NOTICE 'PASS: ILIKE escaper escaped %, _, backslash';
END $$;

ROLLBACK TO SAVEPOINT s0;
ROLLBACK;

\echo === verify-story4-db.sql complete ===

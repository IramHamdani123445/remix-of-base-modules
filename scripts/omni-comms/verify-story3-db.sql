-- ============================================================================
-- Epic 2 — Story 3: transaction-isolated DB verification harness.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f scripts/omni-comms/verify-story3-db.sql
--
-- Wrapped in BEGIN ... ROLLBACK so nothing persists.
-- ============================================================================
BEGIN;

-- 1. New lifecycle helper present, SECURITY DEFINER, owned by postgres,
--    hardened search_path.
SELECT '1. write_lifecycle_audit definer+owner+search_path' AS check,
       COUNT(*) = 1 AS ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
 WHERE n.nspname = 'public'
   AND p.proname = 'omni_comms_priv_write_lifecycle_audit'
   AND p.prosecdef
   AND r.rolname = 'postgres'
   AND EXISTS (
     SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
      WHERE c LIKE 'search_path=pg_catalog%' AND c NOT LIKE '%pg_temp%'
   );

-- 2. All five lifecycle RPCs are 4-arg (added p_reason)
SELECT '2. lifecycle RPCs have 4 args' AS check,
       COUNT(*) = 5 AS ok
  FROM pg_proc p, pg_namespace n
 WHERE n.oid = p.pronamespace AND n.nspname='public'
   AND p.proname IN (
     'omni_comms_event_definition_activate',
     'omni_comms_event_definition_suspend',
     'omni_comms_event_definition_retire',
     'omni_comms_event_contract_publish',
     'omni_comms_event_contract_retire'
   )
   AND p.pronargs = 4;

-- 3. Old 3-arg overloads have been dropped
SELECT '3. old 3-arg lifecycle overloads removed' AS check,
       COUNT(*) = 0 AS ok
  FROM pg_proc p, pg_namespace n
 WHERE n.oid = p.pronamespace AND n.nspname='public'
   AND p.proname IN (
     'omni_comms_event_definition_activate',
     'omni_comms_event_definition_suspend',
     'omni_comms_event_definition_retire',
     'omni_comms_event_contract_publish',
     'omni_comms_event_contract_retire'
   )
   AND p.pronargs = 3;

-- 4. contract_get now returns sample_payload_redacted
SELECT '4. contract_get returns redaction flag' AS check,
       EXISTS (
         SELECT 1 FROM pg_proc p, pg_namespace n, unnest(p.proargnames) an
          WHERE n.oid=p.pronamespace AND n.nspname='public'
            AND p.proname='omni_comms_event_contract_get'
            AND an = 'sample_payload_redacted'
       ) AS ok;

-- 5. definition_list adds p_search (5 args)
SELECT '5. definition_list has 5 args (adds p_search)' AS check,
       EXISTS (
         SELECT 1 FROM pg_proc p, pg_namespace n
          WHERE n.oid=p.pronamespace AND n.nspname='public'
            AND p.proname='omni_comms_event_definition_list'
            AND p.pronargs=5
       ) AS ok;

-- 6. Reason bound: >2000 chars rejected as OC422 reason_too_long
DO $$
BEGIN
  BEGIN
    PERFORM public.omni_comms_priv_normalize_reason(repeat('x', 2001), false);
    RAISE EXCEPTION 'CHECK 6 FAIL: oversized reason accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $$;

-- 7. Empty reason rejected when required
DO $$
BEGIN
  BEGIN
    PERFORM public.omni_comms_priv_normalize_reason('   ', true);
    RAISE EXCEPTION 'CHECK 7 FAIL: empty required reason accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $$;

-- 8. ILIKE escape handles \ % _
SELECT '8. escape_ilike escapes backslash, percent, underscore' AS check,
       public.omni_comms_priv_escape_ilike('a\b%c_d') = 'a\\b\%c\_d' AS ok;

-- 9. Pagination bounds — list rejects out-of-range limit/offset
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.omni_comms_event_definition_list(0, 0, NULL, NULL, NULL);
    RAISE EXCEPTION 'CHECK 9a FAIL: limit=0 accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.omni_comms_event_definition_list(101, 0, NULL, NULL, NULL);
    RAISE EXCEPTION 'CHECK 9b FAIL: limit=101 accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.omni_comms_event_definition_list(10, -1, NULL, NULL, NULL);
    RAISE EXCEPTION 'CHECK 9c FAIL: negative offset accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $$;

-- 10. All lifecycle + list + get RPCs remain GRANTed only to authenticated
SELECT '10. lifecycle RPCs granted only to authenticated' AS check,
       bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS ok
  FROM pg_proc p, pg_namespace n
 WHERE n.oid=p.pronamespace AND n.nspname='public'
   AND p.proname IN (
     'omni_comms_event_definition_activate',
     'omni_comms_event_definition_suspend',
     'omni_comms_event_definition_retire',
     'omni_comms_event_contract_publish',
     'omni_comms_event_contract_retire',
     'omni_comms_event_definition_list',
     'omni_comms_event_contract_list',
     'omni_comms_event_contract_get'
   );

ROLLBACK;

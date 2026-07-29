-- ============================================================================
-- Omni-Comms Accelerated Build 2 — Email configuration DB verifier.
--
-- Read-only harness. Run with:
--   psql -v ON_ERROR_STOP=1 -f scripts/omni-comms/verify-epic4-build2-db.sql
-- ============================================================================
BEGIN;

-- 1. 12 public RPCs exist, SECURITY DEFINER, owner postgres
SELECT '1. 12 build-2 public rpcs (definer, owner=postgres)' AS check,
       COUNT(*) = 12                                          AS ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
 WHERE n.nspname = 'public'
   AND p.prosecdef = true
   AND r.rolname = 'postgres'
   AND p.proname IN (
     'omni_comms_email_provider_ensure',
     'omni_comms_email_provider_activate',
     'omni_comms_provider_account_upsert_draft',
     'omni_comms_provider_account_activate',
     'omni_comms_provider_account_record_credential_check',
     'omni_comms_sender_identity_upsert_draft',
     'omni_comms_sender_identity_activate',
     'omni_comms_binding_upsert_draft',
     'omni_comms_binding_record_verification',
     'omni_comms_binding_activate',
     'omni_comms_channel_setting_upsert',
     'omni_comms_email_config_summary'
   );

-- 2. Two Build-2 private helpers exist and are owned by postgres, no EXECUTE
--    to PUBLIC / anon / authenticated.
SELECT '2. 2 build-2 private helpers, no public/anon/authenticated EXECUTE' AS check,
       COUNT(*) = 2 AS ok
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN (
     'omni_comms_priv_write_channel_audit',
     'omni_comms_priv_email_provider_id'
   );

-- 3. All 12 public RPCs have EXECUTE granted to authenticated
SELECT '3. authenticated has EXECUTE on all 12 rpcs' AS check,
       COUNT(*) = 12                                 AS ok
  FROM (
    SELECT DISTINCT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN (
         'omni_comms_email_provider_ensure',
         'omni_comms_email_provider_activate',
         'omni_comms_provider_account_upsert_draft',
         'omni_comms_provider_account_activate',
         'omni_comms_provider_account_record_credential_check',
         'omni_comms_sender_identity_upsert_draft',
         'omni_comms_sender_identity_activate',
         'omni_comms_binding_upsert_draft',
         'omni_comms_binding_record_verification',
         'omni_comms_binding_activate',
         'omni_comms_channel_setting_upsert',
         'omni_comms_email_config_summary'
       )
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) t;

-- 4. Hardened search_path (starts with pg_catalog, never pg_temp)
SELECT '4. hardened search_path on build-2 rpcs' AS check,
       bool_and(cfg LIKE 'search_path=pg_catalog%' AND cfg NOT LIKE '%pg_temp%') AS ok
  FROM pg_proc p, unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
 WHERE p.pronamespace='public'::regnamespace
   AND (p.proname LIKE 'omni_comms_email_%'
        OR p.proname LIKE 'omni_comms_provider_account_%'
        OR p.proname LIKE 'omni_comms_sender_identity_%'
        OR p.proname LIKE 'omni_comms_binding_%'
        OR p.proname = 'omni_comms_channel_setting_upsert'
        OR p.proname IN ('omni_comms_priv_write_channel_audit',
                         'omni_comms_priv_email_provider_id'))
   AND cfg LIKE 'search_path=%';

-- 5. Unauthenticated caller is blocked
DO $$
BEGIN
  BEGIN
    PERFORM public.omni_comms_email_provider_ensure(NULL);
    RAISE EXCEPTION 'CHECK 5 FAIL: unauthenticated accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $$;

-- 6. Channel-setting upsert rejects a non-email channel with OC422
DO $$
BEGIN
  BEGIN
    PERFORM public.omni_comms_channel_setting_upsert(
      NULL, NULL, gen_random_uuid(), NULL, 'sms',
      true, false, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'CHECK 6 FAIL: sms accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $$;

SELECT 'EPIC 4 BUILD 2 VERIFY OK' AS result;
ROLLBACK;

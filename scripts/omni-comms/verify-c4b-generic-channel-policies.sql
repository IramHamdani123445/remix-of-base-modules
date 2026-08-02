-- ============================================================
-- Omni-Comms C4B verifier — Generic Channel Policies
-- Read-only. Proves schema, safety and grant invariants.
-- Usage: psql -f scripts/omni-comms/verify-c4b-generic-channel-policies.sql
-- ============================================================
\set ON_ERROR_STOP on

-- 1. All C4B columns exist
SELECT 'columns' AS check,
       count(*) AS found, 12 AS expected,
       (count(*) = 12) AS pass
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='omni_comms_channel_setting'
   AND column_name IN ('data_origin','operational_state','department_override_enabled',
     'per_day_limit','max_recipients_per_request','retry_profile','request_timeout_seconds',
     'retention_days','cost_currency','daily_cost_limit_minor','per_message_cost_limit_minor',
     'channel_policy_config');

-- 2. Compatibility columns retained
SELECT 'compat_columns' AS check,
       (count(*) = 2) AS pass
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='omni_comms_channel_setting'
   AND column_name IN ('enabled','live_delivery_enabled');

-- 3. Bounded constraints exist
SELECT 'constraints' AS check, count(*) AS found, (count(*) >= 17) AS pass
  FROM pg_constraint
 WHERE conrelid='public.omni_comms_channel_setting'::regclass
   AND conname LIKE 'omni_comms_channel_setting_%chk';

-- 4. No policy has live delivery enabled
SELECT 'no_live_delivery' AS check,
       count(*) AS offending, (count(*) = 0) AS pass
  FROM public.omni_comms_channel_setting WHERE live_delivery_enabled;

-- 5. enabled mirrors operational_state
SELECT 'enabled_mirror' AS check,
       count(*) AS offending, (count(*) = 0) AS pass
  FROM public.omni_comms_channel_setting
 WHERE enabled <> (operational_state <> 'disabled');

-- 6. Genuine / reference partial unique indexes exist
SELECT 'unique_indexes' AS check, count(*) AS found, (count(*) = 4) AS pass
  FROM pg_indexes
 WHERE schemaname='public' AND tablename='omni_comms_channel_setting'
   AND indexname IN ('omni_comms_channel_setting_org_genuine_uk',
                     'omni_comms_channel_setting_dept_genuine_uk',
                     'omni_comms_channel_setting_org_reference_uk',
                     'omni_comms_channel_setting_dept_reference_uk');

-- 7. No duplicate genuine scope records
SELECT 'no_duplicate_genuine_org' AS check, count(*) AS offending, (count(*) = 0) AS pass
  FROM (SELECT organization_id, channel FROM public.omni_comms_channel_setting
         WHERE department_id IS NULL AND data_origin <> 'reference_seed'
         GROUP BY 1,2 HAVING count(*) > 1) d;

SELECT 'no_duplicate_genuine_dept' AS check, count(*) AS offending, (count(*) = 0) AS pass
  FROM (SELECT organization_id, department_id, channel FROM public.omni_comms_channel_setting
         WHERE department_id IS NOT NULL AND data_origin <> 'reference_seed'
         GROUP BY 1,2,3 HAVING count(*) > 1) d;

-- 8. Private workers are not executable by anon/authenticated
SELECT 'private_workers_locked' AS check,
       count(*) AS offending, (count(*) = 0) AS pass
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('omni_comms_priv_channel_policy_upsert',
                     'omni_comms_priv_normalize_channel_policy',
                     'omni_comms_priv_channel_policy_json')
   AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     OR has_function_privilege('anon', p.oid, 'EXECUTE'));

-- 9. Public RPC grants are correct
SELECT 'public_rpc_grants' AS check,
       count(*) AS granted, (count(*) = 2) AS pass
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('omni_comms_channel_policy_summary','omni_comms_channel_policy_upsert')
   AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');

-- 10. Direct table access remains denied to anon/authenticated
SELECT 'table_access_denied' AS check,
       (NOT has_table_privilege('authenticated','public.omni_comms_channel_setting','SELECT')
        AND NOT has_table_privilege('anon','public.omni_comms_channel_setting','SELECT')) AS pass;

-- 11. No runtime delivery rows were created by C4B
SELECT 'no_runtime_rows' AS check,
       (SELECT count(*) FROM public.omni_comms_dispatch_job) AS dispatch_jobs,
       (SELECT count(*) FROM public.omni_comms_delivery_attempt) AS delivery_attempts,
       ((SELECT count(*) FROM public.omni_comms_delivery_attempt) = 0) AS pass;

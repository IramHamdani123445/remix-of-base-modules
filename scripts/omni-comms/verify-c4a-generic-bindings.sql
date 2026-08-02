-- Omni-Comms Channels C4A — database verification.
-- Read-only. Every query must return the stated expectation.

\echo '== 1. C4A binding columns exist =='
SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'omni_comms_sender_provider_binding'
   AND column_name IN ('organization_id','department_id','channel','channel_endpoint_id',
                       'data_origin','verification_source','verification_result_code',
                       'verification_detail','verification_checked_at','disabled_at','disabled_by')
 ORDER BY column_name;
-- expect: 11 rows; organization_id and channel are NOT NULL.

\echo '== 2. every binding carries organisation, channel and origin =='
SELECT count(*) AS unclassified
  FROM public.omni_comms_sender_provider_binding
 WHERE organization_id IS NULL OR channel IS NULL OR data_origin IS NULL;
-- expect: 0

\echo '== 3. binding organisation/channel always match identity and provider =='
SELECT count(*) AS mismatched
  FROM public.omni_comms_sender_provider_binding b
  JOIN public.omni_comms_sender_identity i ON i.id = b.sender_identity_id
  JOIN public.omni_comms_provider_account a ON a.id = b.provider_account_id
  JOIN public.omni_comms_provider p ON p.id = a.provider_id
 WHERE b.organization_id <> i.organization_id
    OR b.organization_id <> a.organization_id
    OR b.channel <> i.channel
    OR b.channel <> p.channel;
-- expect: 0

\echo '== 4. reference bindings are classified from either side =='
SELECT count(*) AS misclassified
  FROM public.omni_comms_sender_provider_binding b
  JOIN public.omni_comms_sender_identity i ON i.id = b.sender_identity_id
  JOIN public.omni_comms_provider_account a ON a.id = b.provider_account_id
 WHERE (i.data_origin = 'reference_seed' OR a.data_origin = 'reference_seed')
   AND b.data_origin <> 'reference_seed';
-- expect: 0

\echo '== 5. verification evidence always has a source =='
SELECT count(*) AS unsourced
  FROM public.omni_comms_sender_provider_binding
 WHERE (verification_status IN ('verified','failed') AND verification_source = 'none')
    OR (verification_status IN ('unverified','pending') AND verification_source <> 'none');
-- expect: 0

\echo '== 6. pre-C4A manual evidence is labelled legacy_manual, never provider =='
SELECT verification_source, count(*)
  FROM public.omni_comms_sender_provider_binding
 GROUP BY verification_source ORDER BY 1;
-- expect: no historical row reports source 'provider' or 'service'.

\echo '== 7. uniqueness rules =='
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'omni_comms_sender_provider_binding'
 ORDER BY indexname;
-- expect: omni_comms_binding_combination_uk and omni_comms_binding_scope_priority_uk present,
--         omni_comms_binding_unique_pair_uk absent.

\echo '== 8. no duplicate active/draft priority inside one scope =='
SELECT organization_id, channel, sender_identity_id, department_id, priority, count(*)
  FROM public.omni_comms_sender_provider_binding
 WHERE status IN ('draft','active')
 GROUP BY 1,2,3,4,5 HAVING count(*) > 1;
-- expect: 0 rows

\echo '== 9. C4A functions exist with the expected security posture =='
SELECT p.proname, p.prosecdef, p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('omni_comms_channel_binding_summary',
                     'omni_comms_channel_binding_upsert_draft',
                     'omni_comms_channel_binding_set_lifecycle',
                     'omni_comms_priv_channel_binding_upsert',
                     'omni_comms_priv_channel_binding_lifecycle',
                     'omni_comms_priv_record_binding_verification',
                     'omni_comms_priv_validate_binding',
                     'omni_comms_priv_binding_endpoint_requirement')
 ORDER BY p.proname;
-- expect: 8 rows; all except the IMMUTABLE requirement helper are SECURITY DEFINER
--         with search_path pinned.

\echo '== 10. private workers are service_role only =='
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('omni_comms_priv_channel_binding_upsert',
                     'omni_comms_priv_channel_binding_lifecycle',
                     'omni_comms_priv_record_binding_verification',
                     'omni_comms_priv_validate_binding',
                     'omni_comms_priv_binding_endpoint_requirement',
                     'omni_comms_binding_record_verification')
 ORDER BY p.proname;
-- expect: authenticated_exec = false and anon_exec = false for every row.
--         Manual verification via omni_comms_binding_record_verification is removed.

\echo '== 11. public C4A RPCs are reachable by authenticated staff only =='
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('omni_comms_channel_binding_summary',
                     'omni_comms_channel_binding_upsert_draft',
                     'omni_comms_channel_binding_set_lifecycle')
 ORDER BY p.proname;
-- expect: authenticated_exec = true, anon_exec = false.

\echo '== 12. binding table itself is not reachable through the Data API =='
SELECT has_table_privilege('anon','public.omni_comms_sender_provider_binding','SELECT') AS anon_select,
       has_table_privilege('authenticated','public.omni_comms_sender_provider_binding','SELECT') AS auth_select;
-- expect: false, false

\echo '== 13. no runtime object was created or written by C4A =='
SELECT count(*) AS c4a_runtime_rows
  FROM public.omni_comms_request
 WHERE created_at > now() - interval '1 day'
   AND correlation_id LIKE 'c4a%';
-- expect: 0

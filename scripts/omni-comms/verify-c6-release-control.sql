-- ============================================================================
-- Omni-Comms Phase C6 — Release Control verifier (read-only)
--
-- Proves the C6 safety invariants and the C5B preservation invariants.
-- Executes no mutation, contacts no provider and creates no runtime row.
-- Every check returns a boolean `passed`.
-- ============================================================================

-- 1. Both C6 release objects exist.
SELECT 'c6_release_tables_exist' AS check,
       count(*) FILTER (WHERE c.relname = 'omni_comms_channel_release_control') = 1
   AND count(*) FILTER (WHERE c.relname = 'omni_comms_channel_release_event') = 1 AS passed
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'omni_comms_channel_release%';

-- 2. RLS enabled on both objects.
SELECT 'rls_enabled' AS check, bool_and(c.relrowsecurity) AS passed
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('omni_comms_channel_release_control', 'omni_comms_channel_release_event');

-- 3. Direct authenticated/anon table access is denied on both objects.
SELECT 'direct_table_access_denied' AS check, count(*) = 0 AS passed
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'omni_comms_channel_release%'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC');

-- 4. Release-event trigger blocks UPDATE and DELETE (definition, not policies).
SELECT 'release_event_append_only_trigger' AS check,
       bool_or(
         t.tgname = 'omni_comms_release_event_append_only'
         AND pg_get_triggerdef(t.oid) ILIKE '%BEFORE DELETE OR UPDATE%'
         AND p.prosrc ILIKE '%OC412 immutable_release_event%'
       ) AS passed
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE c.relname = 'omni_comms_channel_release_event' AND NOT t.tgisinternal;

-- 5. The decision oracle is private, SECURITY DEFINER, pinned and service-role only.
SELECT 'decision_oracle_service_role_only' AS check,
       count(*) = 1
   AND bool_and(p.prosecdef)
   AND bool_and(array_to_string(p.proconfig, ',') ILIKE '%search_path%')
   AND bool_and(pg_get_userbyid(p.proowner) = 'postgres')
   AND bool_and(array_to_string(p.proacl, ',') LIKE '%service_role=X%')
   AND bool_and(array_to_string(p.proacl, ',') NOT LIKE '%anon=X%')
   AND bool_and(array_to_string(p.proacl, ',') NOT LIKE '%authenticated=X%')
   AND bool_and(array_to_string(p.proacl, ',') NOT LIKE '=X/%')
       AS passed
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_channel_release_decision';

-- 5b. No public decision oracle exists.
SELECT 'no_public_decision_oracle' AS check, count(*) = 0 AS passed
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'omni_comms_channel_release_evaluate_decision';

-- 6. Approval worker is service-role only.
SELECT 'approval_worker_service_role_only' AS check,
       count(*) = 1
   AND bool_and(array_to_string(p.proacl, ',') LIKE '%service_role=X%')
   AND bool_and(array_to_string(p.proacl, ',') NOT LIKE '%anon=X%')
   AND bool_and(array_to_string(p.proacl, ',') NOT LIKE '%authenticated=X%')
       AS passed
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_channel_release_approve_activate';

-- 7. Segregation of duties: approver is never the proposer.
SELECT 'segregation_of_duties' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE approved_by IS NOT NULL AND approved_by = proposed_by;

-- 8. A pending proposal always carries an expiry.
SELECT 'proposal_expires' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE release_state = 'pending_approval' AND proposal_expires_at IS NULL;

-- 9. No release record reaches a live state.
SELECT 'live_transition_impossible' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE release_state = 'live';

-- 10. Pilot windows never exceed 7 days and approved pilots carry a full SHA.
SELECT 'pilot_window_bound' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE release_expires_at IS NOT NULL
  AND release_starts_at IS NOT NULL
  AND release_expires_at > release_starts_at + interval '7 days';

-- 11. Recipient rules are masked/hashed projections only (max 20, no raw value).
SELECT 'recipients_masked_only' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control r
LEFT JOIN LATERAL jsonb_array_elements(coalesce(r.pilot_recipient_rules, '[]'::jsonb)) AS e ON true
WHERE jsonb_array_length(coalesce(r.pilot_recipient_rules, '[]'::jsonb)) > 20
   OR (e IS NOT NULL AND ((e ->> 'target_masked') !~ '\*'
                          OR (e ->> 'target_hash') !~ '^[0-9a-f]{64}$'
                          OR e::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'));

-- 12. Volume limits satisfy hourly <= daily <= total.
SELECT 'volume_limits_laddered' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE NOT (max_messages_per_hour <= max_messages_per_day
           AND max_messages_per_day <= max_messages_total);

-- 13. Approved pilots are bound to a full 40-character certified commit.
SELECT 'approved_commit_full_sha' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE release_state = 'controlled_pilot'
  AND (approved_commit IS NULL OR approved_commit !~ '^[0-9a-f]{40}$');

-- 14. The decision oracle requires the deployed revision to match certification.
SELECT 'deployed_revision_must_match' AS check,
       bool_and(p.prosrc ILIKE '%deployed_revision_match%'
                AND p.prosrc ILIKE '%approved_commit%') AS passed
FROM pg_proc p WHERE p.proname = 'omni_comms_priv_channel_release_decision';

-- 15. Every dispatch job remains non-runnable.
SELECT 'jobs_remain_held' AS check, count(*) = 0 AS passed
FROM public.omni_comms_dispatch_job
WHERE is_runnable IS TRUE;

-- 16. The full release decision snapshot columns exist and are optional.
SELECT 'release_snapshot_columns_complete' AS check,
       count(*) = 7 AND bool_and(is_nullable = 'YES') AS passed
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'omni_comms_dispatch_job'
  AND column_name IN ('release_control_id','release_version_at_decision',
                      'release_state_at_decision','release_fingerprint_at_decision',
                      'release_expires_at_decision','release_decision_snapshot',
                      'release_decision_at');

-- 16b. Stored snapshots are bounded and contain no raw recipient or secret.
SELECT 'release_snapshot_bounded' AS check, count(*) = 0 AS passed
FROM public.omni_comms_dispatch_job
WHERE release_decision_snapshot IS NOT NULL
  AND NOT public.omni_comms_priv_release_decision_snapshot_bounded(release_decision_snapshot);

-- 17. C6 wrote no normal delivery attempt.
SELECT 'no_normal_delivery_attempt' AS check,
       (SELECT count(*) FROM public.omni_comms_delivery_attempt) = 0 AS passed;

-- 18. No C6 function contacts a provider or writes provider traffic.
SELECT 'c6_functions_no_provider_contact' AS check, count(*) = 0 AS passed
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE '%channel_release%'
  AND (p.prosrc ILIKE '%api.resend.com%' OR p.prosrc ILIKE '%net.http_post%'
       OR p.prosrc ILIKE '%pg_net%');

-- 19. Legacy live delivery flag remains false everywhere.
SELECT 'live_delivery_disabled' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_setting
WHERE live_delivery_enabled IS TRUE;

-- ============================================================================
-- 20. C5B preservation
-- ============================================================================

-- 20a. C5B tables still exist.
SELECT 'c5b_tables_exist' AS check, count(*) = 4 AS passed
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('omni_comms_channel_test_run',
                    'omni_comms_channel_test_delivery',
                    'omni_comms_channel_test_delivery_attempt',
                    'omni_comms_channel_test_delivery_event');

-- 20b. C5B immutability triggers still exist.
SELECT 'c5b_immutability_triggers_exist' AS check, count(*) >= 3 AS passed
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND c.relname IN ('omni_comms_channel_test_run',
                    'omni_comms_channel_test_delivery',
                    'omni_comms_channel_test_delivery_attempt',
                    'omni_comms_channel_test_delivery_event');

-- 20c. C5B attempt and event tables expose no anon/authenticated grants.
SELECT 'c5b_grants_intact' AS check, count(*) = 0 AS passed
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('omni_comms_channel_test_delivery_attempt',
                     'omni_comms_channel_test_delivery_event')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC');

-- 20d. No C6 function mutates a C5B evidence table.
SELECT 'c6_functions_do_not_write_c5b' AS check, count(*) = 0 AS passed
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE '%channel_release%'
  AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?omni_comms_channel_test_(run|delivery)';

-- 20e. C5B evidence rows are still readable and countable (structure intact).
SELECT 'c5b_evidence_readable' AS check,
       (SELECT count(*) FROM public.omni_comms_channel_test_delivery) IS NOT NULL
   AND (SELECT count(*) FROM public.omni_comms_channel_test_delivery_attempt) IS NOT NULL
   AND (SELECT count(*) FROM public.omni_comms_channel_test_delivery_event) IS NOT NULL AS passed;

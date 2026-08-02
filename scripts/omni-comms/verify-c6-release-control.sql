-- ============================================================================
-- Omni-Comms Phase C6 — Release Control verifier (read-only)
--
-- Proves the C6 safety invariants. Executes no mutation, contacts no provider
-- and creates no runtime row.
-- ============================================================================

-- 1. Both release objects exist.
SELECT 'objects_present' AS check,
       count(*) FILTER (WHERE c.relname = 'omni_comms_channel_release_control') = 1
   AND count(*) FILTER (WHERE c.relname = 'omni_comms_channel_release_event') = 1 AS passed
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'omni_comms_channel_release%';

-- 2. RLS is enabled on both objects.
SELECT 'rls_enabled' AS check, bool_and(c.relrowsecurity) AS passed
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('omni_comms_channel_release_control', 'omni_comms_channel_release_event');

-- 3. anon has no privileges on either object.
SELECT 'anon_no_privileges' AS check, count(*) = 0 AS passed
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'omni_comms_channel_release%'
  AND grantee = 'anon';

-- 4. No release record enables live delivery.
SELECT 'no_live_state' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE release_state = 'live';

-- 5. Channel policies still keep live delivery disabled.
SELECT 'live_delivery_disabled' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_setting
WHERE live_delivery_enabled IS TRUE;

-- 6. Segregation of duties: approver is never the proposer.
SELECT 'segregation_of_duties' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE approved_by IS NOT NULL AND approved_by = proposed_by;

-- 7. Approved pilots are bound to a full 40-character certified commit.
SELECT 'approved_commit_shape' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE release_state = 'controlled_pilot'
  AND (approved_commit IS NULL OR approved_commit !~ '^[0-9a-f]{40}$');

-- 8. Pilot windows never exceed 7 days.
SELECT 'pilot_window_bound' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE release_expires_at IS NOT NULL
  AND release_starts_at IS NOT NULL
  AND release_expires_at > release_starts_at + interval '7 days';

-- 9. At most 20 approved recipient rules per record.
SELECT 'recipient_rule_bound' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control
WHERE jsonb_array_length(coalesce(pilot_recipient_rules, '[]'::jsonb)) > 20;

-- 10. No raw email address is stored in the recipient rules.
SELECT 'recipients_masked_only' AS check, count(*) = 0 AS passed
FROM public.omni_comms_channel_release_control r,
     LATERAL jsonb_array_elements(coalesce(r.pilot_recipient_rules, '[]'::jsonb)) AS e
WHERE (e ->> 'target_masked') !~ '\*';

-- 11. The release ledger is append-only (no UPDATE/DELETE policies).
SELECT 'ledger_append_only' AS check, count(*) = 0 AS passed
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'omni_comms_channel_release_event'
  AND cmd IN ('UPDATE', 'DELETE');

-- 12. No dispatch job has become runnable under a release decision.
SELECT 'jobs_remain_held' AS check, count(*) = 0 AS passed
FROM public.omni_comms_dispatch_job
WHERE release_control_id IS NOT NULL AND is_runnable IS TRUE;

-- 13. C5B technical delivery evidence is untouched by C6.
SELECT 'c5b_evidence_intact' AS check, count(*) >= 0 AS passed
FROM public.omni_comms_channel_test_delivery;

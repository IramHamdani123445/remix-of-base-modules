# Repair auth failures, EAUTHQUERY, and stuck navigation

## Confirmed diagnosis

- Auth is currently failing at the backend boundary: recent `/token` and `/user` requests timed out after roughly 10–13 seconds, and an expired access token then produced a 403.
- This is not ordinary connection-slot exhaustion. The database currently shows about 13 of 60 connections in use, with only a small number active.
- The database is nevertheless severely delayed: `get_user_accessible_modules` took about 17.8 seconds for 762 rows, while a simple filtered scan of only 1,098 `app_modules` rows took about 956 ms. Management queries also intermittently terminate on connection timeout.
- Background workload is unhealthy at the same time: cron jobs 4, 16, 17, and 23 repeatedly report startup timeouts; the Omni-Comms dispatch call has been observed taking about 22 seconds; database logs show repeated SSL EOF and statement-timeout events.
- The navigation RPC is therefore exceeding its client-side 8-second limit. The sidebar timeout/retry UI is reporting the backend failure correctly; it is not the source of the failure.
- Relevant navigation tables have RLS disabled, matching the project's documented authorization architecture. Their effective read grants are present for authenticated access. No evidence supports changing RLS as this repair.
- The browser uses the shared generated client; navigation and auth code do not open raw database connections. Current evidence does not show an unclosed frontend connection.

## Repair plan

1. **Stabilize Lovable Cloud before changing application behavior**
   - Capture a final baseline of auth failures, active sessions, cron runtime, locks, database latency, and menu-RPC latency.
   - Temporarily suspend only the high-frequency workers that are repeatedly timing out, starting with the five-second email poller and affected Omni-Comms pollers. Preserve queue contents and delivery state; do not remove jobs or bypass the canonical sending spine.
   - Restart Lovable Cloud if auth/database calls remain unhealthy after workload isolation, then wait until database and auth probes are consistently responsive.

2. **Fix background workload amplification**
   - Replace overlapping timer behavior with bounded, non-overlapping execution: one active run per worker, short HTTP timeouts, skip-when-busy behavior, and an interval appropriate to pending work.
   - Ensure empty queues produce cheap no-op runs and that failed outbound calls cannot retain or repeatedly create database work.
   - Restore workers incrementally and verify each one does not recreate latency or connection rejection.

3. **Optimize the navigation authorization RPC**
   - Profile `is_admin`, `check_module_rollout_access`, and both admin/non-admin branches with representative users.
   - Remove repeated per-row permission/rollout evaluation where possible, deduplicate recursive results, and return only the menu rows required by the client.
   - Add or adjust indexes only where the measured execution plan demonstrates a need; retain the existing server-side role/permission model and no-RLS project rule.

4. **Harden auth and menu recovery without masking outages**
   - Keep auth refresh single-flight and prevent duplicate profile/role loads from repeated auth events.
   - Stop keying navigation cache entries by transient refresh state if that creates redundant RPC calls; explicitly invalidate once after a genuine identity/session transition instead.
   - Preserve the last successful menu during transient refreshes, use bounded retries with backoff, and avoid database-backed error logging that multiplies load while the database is already failing.

5. **Control dashboard load after login**
   - Confirm shared React Query keys are used by every dashboard consumer.
   - Sequence or defer expensive dashboard views until auth and navigation are ready, cap simultaneous reads, and optimize only the views demonstrated to be slow.
   - Re-measure the known heavy dashboard paths rather than relying on timeout increases.

6. **Regression and production proof**
   - Add focused tests for repeated auth events, expired tokens, refresh timeouts, navigation deduplication, stale-menu retention, and worker overlap prevention.
   - Verify fresh login, expired-session recovery, sidebar population, refresh/retry, and dashboard loading in the running preview.
   - Record before/after timings for auth, `get_user_accessible_modules`, dashboard queries, cron duration, and connection usage. Success means no EAUTHQUERY/504 responses, no stuck sidebar, no overlapping workers, and consistently bounded menu latency.

## Safety and scope

- No new communication system, queue, or provider configuration will be introduced.
- Queue records and delivery evidence will be preserved while workers are paused.
- No RLS conversion is planned; authorization remains in the existing server-side role and permission functions.
- Any database migration will be narrowly scoped, reversible, and based on measured query plans.

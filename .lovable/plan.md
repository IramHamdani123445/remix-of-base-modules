# Lovable Cloud Database Connectivity Recovery

## Confirmed findings

- The database is intermittently reachable: a lightweight probe succeeded, but several ordinary read queries and the connection pool timed out.
- Authentication is a downstream symptom: the latest password sign-in request waited about 105 seconds and failed because its user lookup was cancelled.
- Database logs show repeated statement timeouts, SSL connection resets, and scheduler startup timeouts across jobs 3, 4, 5, 7, 9, 16, 17, 18, and 23.
- The previous schedule migration staggered four named workers, but the current failures affect a wider group of scheduled jobs.
- Existing client safeguards already reduce amplification: broad query retries are limited and dashboard requests have an 8-second abort timeout.
- Lovable Cloud lifecycle and compact health endpoints currently return an account-permission error, so recovery must be validated through direct database, auth, and application probes.

## Recovery plan

1. **Recover database availability first**
   - Request a Lovable Cloud backend restart because database, pooler, scheduler, and auth paths are currently unhealthy.
   - Poll direct read probes until the database responds consistently rather than relying on one successful lightweight query.

2. **Inventory all scheduled workload after recovery**
   - Read the complete scheduler registry, schedules, active flags, commands, recent durations, failures, and overlaps.
   - Map the failing job IDs to their business workers and identify duplicate, sub-minute, or overlapping schedules.
   - Inspect active and idle-in-transaction sessions to find workers retaining connections.

3. **Apply a safe scheduler stabilization migration**
   - Preserve every existing business worker; do not create a parallel queue or communication system.
   - Stagger all high-frequency jobs—not only the four previously adjusted—and ensure each worker has enough time to finish before its next run.
   - Temporarily disable only a demonstrably runaway or duplicate job if it cannot be made safe immediately.
   - Keep exact prior schedules documented in the migration so the change is reversible.

4. **Correct the root workload where identified**
   - Trace any long-running worker/query to its source and add bounded execution, batch limits, idempotent locking, and cleanup so failed invocations cannot leave transactions or connections open.
   - Run GitNexus impact analysis before changing any affected function or service, and warn before any high-risk edit.
   - Avoid changing the login flow unless post-recovery evidence shows an independent login defect.

5. **Prove end-to-end recovery**
   - Verify repeated database reads and connection-pool access without timeout.
   - Verify scheduler runs complete without startup timeouts or growing overlap.
   - Perform an authenticated browser sign-in and confirm profile/bootstrap queries load successfully.
   - Check current auth/database logs for new timeouts, connection resets, and failed worker starts.
   - Run focused tests plus GitNexus change detection for any source changes.

## Success criteria

- Password sign-in completes normally on repeated attempts.
- Database and pooler probes remain responsive across multiple checks.
- No recurring scheduler startup timeout for the stabilized jobs.
- No persistent idle-in-transaction sessions created by application workers.
- Existing queues, providers, Omni-Comms workers, and business integrations remain intact.

# Cloud Test Backend — Escalation and Post-Recovery Stabilisation

## Where the project reference lives

More → Cloud → Advanced settings. The reference shown there is `xynceskeiiisiefqlgxo`. Use that value in any support request.

## Confirmed current state (re-probed just now)

- A plain `select 1` against the Test database fails with `544 Connection terminated due to connection timeout`.
- The Cloud status endpoint returns an account-privilege error, so lifecycle state cannot be read from here.
- The Cloud panel exposes no restart or pause/resume control, and the agent-side restart tool fails.

No self-serve recovery path remains. Everything below assumes support brings the instance back first.

## Step 1 — Escalate (ready-to-send text)

> **Subject: Cloud Test backend hard-down — no restart control available (project reference `xynceskeiiisiefqlgxo`)**
>
> Our Lovable Cloud Test/development backend has been unreachable for several days.
>
> Symptoms: every SQL read fails with `544 Connection terminated due to connection timeout`; the Postgres pooler rejects connections with `FATAL: (EAUTHQUERY) authentication query failed`; Auth `/token` requests time out (504/500) while `/auth/v1/health` responds; database logs show repeated statement timeouts and cron scheduler start timeouts.
>
> Blockers: the Cloud panel shows no restart and no pause/resume option, status/health endpoints return "your account does not have the necessary privileges", and automated restart fails.
>
> Request: please restart or recover the Test backend instance, and confirm whether it needs a compute or disk resize (database ~9.7 GB, ~1851 tables). Production appears healthy; only Test is affected.

## Step 2 — Verify recovery before touching anything

Repeated plain reads, a pooler connection check, and an authenticated browser sign-in that loads the dashboard. Only proceed once all three pass consistently.

## Step 3 — Inventory the real workload

Read the full scheduled-job registry with schedules, active flags, commands, recent durations and overlaps. Inspect active and idle-in-transaction sessions to identify workers holding connections. Record every existing schedule before changing it.

## Step 4 — Permanent worker stabilisation

- Single-flight execution: every recurring worker takes a Postgres advisory lock and exits immediately if a previous run is still going.
- Bounded batches with a hard per-run row cap and a wall-clock budget, so a run can never grow unbounded.
- No database transaction held across an external provider call (Resend, Twilio, print). Read work, commit, call the provider, then commit the result separately.
- Explicit provider timeouts plus bounded backoff retries, with attempts recorded on the existing delivery-attempt tables.
- Staggered schedules so no two heavy workers start in the same minute.
- Gradual restoration: bring workers back in small groups, verifying connection counts between groups.

All of this reuses the existing Omni-Comms sending spine and worker set. No parallel queue, no new communication system, no removed legacy tables.

## Step 5 — Login and dashboard resilience

- Keep the bounded retry policy and abort timeouts already added, and extend the same treatment to any remaining unbounded dashboard fetches.
- De-amplify dashboard startup so a single page load cannot issue a burst of concurrent queries.
- Surface a clear, actionable message when auth is genuinely unreachable instead of an indefinite spinner.

## Step 6 — Operational visibility

A worker-health view showing last run, duration, outcome, skip-because-locked count and current lock holders, so saturation is visible before it takes the platform down.

## Step 7 — Prove it

Repeated database and pooler probes, a scheduler cycle with no start timeouts and no growing overlap, no lingering idle-in-transaction sessions, and a real authenticated sign-in performed repeatedly. Plus the focused test suite and change detection for any source edits.

## Technical notes

- Worker locking uses `pg_try_advisory_lock` keyed per worker name; the lock is released in a guaranteed cleanup path.
- Schedule changes ship as a migration that documents the exact prior schedule inline so the change is reversible.
- Stale connection documentation is corrected to reflect runtime truth as part of the same pass.

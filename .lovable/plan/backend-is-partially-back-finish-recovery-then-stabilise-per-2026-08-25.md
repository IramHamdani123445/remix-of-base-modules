# Backend is partially back — finish recovery, then stabilise permanently

## What I measured just now (this is a change from the last few days)

- A plain `select 1` against the Test database **succeeded**.
- The scheduler registry (`cron.job`) reads fine — 14 jobs, 5 currently active.
- Auth `/token` now answers properly: three sign-in probes returned a normal `400 invalid_credentials` in 9.2s, 6.6s, then 1.8s. Auth reaching the database again is the key recovery signal, and latency is falling.
- **Still broken:** the Data API (the layer the app itself uses for reads) hangs — `app_modules` and `profiles` both timed out at 25s with no response.
- Heavier admin SQL (a `pg_stat_activity` roll-up) also still times out.
- Cloud lifecycle/health endpoints still return the account-privilege error, so state can't be read from here.

Read: the database instance is coming back up but is still saturated, and the request-serving layer has not caught up. Login may start working intermittently before the dashboard does.

## Answer to your question

Do not spend the effort on a support email yet. The condition that made support unavoidable — nothing responding at all — no longer holds. Give it a short window and re-measure; escalate only if the Data API is still hanging after that.

## Step 1 — Confirm the recovery is real, not a blip

Repeat, spaced out: plain reads, an app-table read through the Data API, and a real authenticated sign-in through the login screen in a browser. Recovery counts only when all three pass repeatedly, not once.

If the Data API is still timing out after this window, send the escalation text below.

## Step 2 — Reduce load while it stabilises

Five recurring jobs are active, including the email queue and the Omni-Comms dispatch, ingest and print workers on 5- and 10-minute cycles. While the instance is still fragile, suspend the non-essential ones and leave the nightly jobs alone. Every prior schedule is recorded in the migration so it is exactly reversible. No queue rows, delivery records or audit history are touched.

## Step 3 — Permanent worker stabilisation

- Advisory-lock single-flight: a worker exits immediately if its previous run is still going.
- Bounded batches with a hard row cap and a wall-clock budget per run.
- No database transaction held across a Resend / Twilio / print provider call — read work, commit, call the provider, record the result separately.
- Explicit provider timeouts with bounded backoff, recorded on the existing delivery-attempt tables.
- Staggered start minutes so no two heavy workers collide.
- Workers restored in small groups, verifying connection counts between groups.

This reuses the existing Omni-Comms sending spine. No parallel queue, no new communication system, no legacy tables removed.

## Step 4 — Login and dashboard resilience

Keep the bounded retries and abort timeouts already in place, extend them to remaining unbounded dashboard fetches, de-amplify dashboard startup so one page load cannot fire a burst of concurrent queries, and show a clear message when auth is genuinely unreachable instead of an endless spinner.

## Step 5 — Operational visibility

A worker-health view: last run, duration, outcome, skipped-because-locked count, current lock holders — so saturation is visible before it takes the platform down again.

## Step 6 — Prove it

Repeated database and pooler probes, a full scheduler cycle with no start timeouts and no growing overlap, no lingering idle-in-transaction sessions, repeated real authenticated sign-ins, plus the focused test suite and change detection for any source edits.

## Escalation text (only if Step 1 fails)

> **Subject: Cloud Test backend degraded — Data API unresponsive (project reference `xynceskeiiisiefqlgxo`)**
>
> Our Lovable Cloud Test backend was hard-down for several days and is now partially recovered: Auth `/token` responds and plain SQL reads succeed, but the Data API (PostgREST) still times out on ordinary table reads, and heavier queries hit connection timeouts. The Cloud panel shows no restart or pause/resume control, status/health endpoints return "your account does not have the necessary privileges", and automated restart fails.
>
> Request: please complete recovery of the Test instance and confirm whether it needs a compute or disk resize (database ~9.7 GB, ~1851 tables). Production appears healthy; only Test is affected.

## Technical notes

- Worker locking uses `pg_try_advisory_lock` keyed per worker name, released in a guaranteed cleanup path.
- Schedule changes ship as a migration documenting the exact prior schedule inline.
- Stale connection documentation is corrected to runtime truth in the same pass.

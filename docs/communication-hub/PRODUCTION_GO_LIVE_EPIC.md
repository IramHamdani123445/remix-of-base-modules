# Communication Hub — Production Go-Live Epic

Status legend: NOT_STARTED, IN_PROGRESS, CODE_COMPLETE, DEPLOYED, RUNTIME_VERIFIED, OPERATIONAL, BLOCKED.

## Overall

- Epic status: **IN_PROGRESS**
- Pilot scope: `APPEALS / APPEAL_RECEIVED_NOTICE / email`
- Protected production state (do not mutate without explicit operator action):
  - event certification: `732386ff-5efc-49b2-acf9-8a619f734214`
  - One Real Email (anchor): `39c0f243-d6df-40cd-8b45-52edf7ff2a24`
  - production lineage: `ecf8e376-e245-450f-b44b-1da5bf895722`
  - lifecycle: `LIVE_MANUAL` / `live_manual_only`
  - operating mode: `MANUAL_PRODUCTION` / automation `STANDBY`
  - `scheduler_enabled=false`, `automatic_triggers_enabled=false`,
    `retry_worker_enabled=false`, `batch_enabled=false`, `bulk_enabled=false`.

## Workstreams

| # | Workstream | Status |
|---|---|---|
| 1 | Baseline convergence | IN_PROGRESS — awaiting operator correction |
| 2 | Manual Production end-to-end | IN_PROGRESS |
| 3 | Automated Production runtime (scheduler/lease/queue) | CODE_COMPLETE (Slices A-C) — not RUNTIME_VERIFIED |
| 4 | Authoritative readiness (9 checks) | IN_PROGRESS |
| 5 | Emergency Stop | NOT_STARTED |
| 6 | Automated certification and Arm | NOT_STARTED |
| 7 | Scheduler-only canary and Stage 9 | NOT_STARTED |
| 8 | Quality, support, closure | IN_PROGRESS |

## Workstream 1 — Baseline convergence

Backend: DEPLOYED
- `_comm_hub_fingerprint_evidence_core_v2` hardened (no pg_extension probe;
  null-input rejected; canonical hash preserved).
- `diagnose_comm_hub_legacy_attestation_fingerprint` returns four booleans.
- `correct_comm_hub_legacy_baseline_attestation` supersedes the ACTIVE
  attestation and creates a new ACTIVE row storing the canonical core.
- Unique partial index `uq_clea_active_per_lineage_cert` enforces exactly one
  ACTIVE attestation per (lineage, certification).

UI: CODE_COMPLETE
- `LegacyBaselineAttestationPanel` renders diagnosis + operator-facing
  correction action. Slotted into the Go-Live page as the pre-Manual-Production
  baseline gate.

Runtime blocker: an authenticated admin must click **Correct Legacy Baseline
Attestation** once. Server then reports all four diagnosis booleans `true`,
active attestation count = 1, previous attestation status = `SUPERSEDED`, and
none of the following change: ORE id, event certification id, production
lineage, event status, operating mode, automation state, Manual observation.

## Workstream 2 — Manual Production

- Server-authoritative eligibility RPC `check_comm_hub_manual_observation_eligibility` exists but must be extended to include actual requested recipient / expected fingerprint / expected lineage / expected certification and to enforce the full 22-item predicate.
- Manual Production Edge Function must call eligibility twice (pre-intent and pre-dispatch) and bind evidence to request/message/attempt.
- Operator UI (`ManualProductionObservationPanel`) already uses a phase-driven pipeline; will be simplified once baseline convergence unblocks.
- Operator approval remains required before any real send.

## Workstream 3 — Automated Production runtime

Slices A/B/C landed:
- `comm-hub-automation-tick` Edge Function with dedicated `COMMUNICATION_HUB_SCHEDULER_SECRET`, `probe` action, and lease-driven `run` action.
- `begin_comm_hub_scheduler_tick` / `complete_comm_hub_scheduler_tick` pin Arm audit id, automation generation, readiness snapshot.
- `assert_comm_hub_queue_run_context` gates queue claims on lease + Arm identity.

Runtime evidence still required for RUNTIME_VERIFIED (probe row < 5 min old, block-before-Arm proof, heartbeat behaviour on re-Arm).

## Workstream 4 — Authoritative readiness

Nine checks scaffolded (`AUTOMATION_READINESS_CHECK_CODES`). Must return
`NOT_IMPLEMENTED` / `NOT_CONFIGURED` / `PROBE_FAILED` / `STALE` / `DRIFTED`
until each capability is proven from real runtime evidence.

## Workstream 5 — Emergency Stop

To design and land: one canonical admin action requiring typed confirmation,
reason, immutable audit; atomic disablement of dispatch/scheduler/triggers/
retry/batch/bulk; invalidation of Arm authority; blocks Manual intent and
Automated queue claims. Recovery only to MANUAL_PRODUCTION / STANDBY.

## Workstream 6 — Automated certification and Arm

Blocked on Workstream 1 completion + Workstream 4 (real readiness) +
Workstream 5 (Emergency Stop proven).

## Workstream 7 — Scheduler-only canary and Stage 9

Blocked on Workstream 6.

## Workstream 8 — Quality, support, closure

Executable tests, operator guide, support runbook, monitoring dashboard,
alert definitions, failure-recovery instructions and final acceptance report
tracked here.

## Operator actions currently required

1. Open Go-Live page. In **Baseline convergence** panel, click
   **Correct Legacy Baseline Attestation**, providing a reason and typing
   `CORRECT LEGACY BASELINE ATTESTATION`.
   Expected outcome: all four diagnosis checks green; previous attestation
   `43ed8437-…` marked `SUPERSEDED`; a new ACTIVE attestation appears storing
   the canonical `evidence_core_v2` and its `sha256-v2` fingerprint. No
   change to lifecycle, mode, automation, ORE or lineage.

## Definition of Done

Tracked verbatim from the master epic brief:
1. Manual Production end-to-end.
2. Automated Production end-to-end for pilot event.
3. Current fingerprint equals active baseline fingerprint.
4. Actual requested recipient validated.
5. Eligibility enforced pre-intent and pre-dispatch.
6. No duplicate dispatch during recovery.
7. Emergency Stop blocks both paths.
8. Automated queue execution requires current Arm + scheduler lease.
9. One scheduler-only canary reaches actual inbox.
10. Stage 9 complete.
11. Batch remains OFF.
12. Bulk remains OFF.
13. Tests pass.
14. Deployment/runtime evidence recorded.
15. Operator and support documentation complete.

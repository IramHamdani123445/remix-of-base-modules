
# Go-Live Closure — Slices A + B + C

Pilot: `APPEALS / APPEAL_RECEIVED_NOTICE / email`. Nothing in this slice sends
another email. Existing Dry Run, Controlled Stub, One Real Email and the
pending Manual Production observation evidence are preserved.

Canary (Slice F), readiness hardening (D), Stage 9 rewrite (E), Emergency Stop
(G), UI (H), tests 3–22 (I) and runtime acceptance (J) come in later slices
after each of these lands with evidence.

---

## Slice A — Manual Production finalize + evidence contract

**Migration `comm_hub_manual_prod_finalize_v1`**

1. New view `public.v_comm_hub_manual_production_evidence` joining
   `communication_hub_manual_production_observation` →
   `communication_requests` → `communication_messages` →
   `communication_delivery_attempts` → `communication_traces` →
   `notification_providers` → `communication_hub_event_certifications`.
   Columns: observation_id, request_id, message_id, delivery_attempt_id,
   trace_id, provider_id, provider_message_id, message_status,
   attempt_status, send_context, test_mode, recipient_email,
   inbox_confirmation_status, dispatched_at, event_certification_id,
   manual_prod_approved_at.

2. New RPC `get_comm_hub_manual_production_evidence(p_observation_id uuid)`
   returning the view row for the caller's org (SECURITY DEFINER, admin-only).

3. Rewrite `confirm_comm_hub_manual_production_observation` to enforce the
   full completion predicate before flipping status to `CONFIRMED`:
   event `live_manual_only`, `send_context='manual_production'`,
   `test_mode=false`, message.status ∈ (sent,delivered),
   attempt.status ∈ (success,sent,delivered), provider.kind NOT IN
   (stub,test,dry_run), provider_message_id NOT NULL, trace exists,
   `inbox_confirmation_status='CONFIRMED'`, observation.created_at >
   event_certification.manual_prod_approved_at.
   Return structured `{ok, blockers[]}`; never raise on missing rows.

4. Grants: EXECUTE on both RPCs to `authenticated`; view SELECT to
   `authenticated`.

**Client**

- `manualProductionObservationService.ts`: add
  `getManualProductionEvidence(observationId)` returning the typed contract.
- `ManualProductionObservationPanel.tsx`: after CONFIRMED, render the
  evidence block (14 fields). Show inline blockers when confirm RPC returns
  `ok=false`.

**Tests (subset of I)**

- I.1 recovery-does-not-resend (already covered — reassert).
- I.2 provider acceptance without inbox confirmation ≠ CONFIRMED.
- I.16 targeted observation works with automation disarmed.

---

## Slice B — Real scheduler worker

**Migration `comm_hub_scheduler_worker_v1`**

1. Columns on `communication_hub_control_settings`:
   `scheduler_worker_version text`,
   `last_processed_count int`,
   `last_scheduler_error jsonb`,
   `heartbeat_arm_audit_id uuid`,
   `heartbeat_automation_generation bigint`,
   `heartbeat_readiness_hash text`.
   (`last_scheduler_heartbeat_at`, `automation_generation`,
   `current_arm_audit_id` already exist.)

2. New table `comm_hub_scheduler_tick_leases` (id, started_at, expires_at,
   arm_audit_id, automation_generation, configuration_version,
   pinned_readiness_ids uuid[], readiness_hash, operating_mode,
   automation_state, status enum(RUNNING,COMPLETED,FAILED,ABANDONED),
   worker_version, processed_count, sent_count, retried_count,
   failed_count, skipped_count, error jsonb, finished_at).
   Grants: SELECT to `authenticated`, ALL to `service_role`.
   No RLS (service-role only writes).

3. RPC `begin_comm_hub_scheduler_tick(p_worker_version text)` SECURITY
   DEFINER, callable only when `has_role(auth.uid(),'service_role')` OR
   caller JWT role = service_role. Locks control-settings row `FOR UPDATE`,
   validates all 8 preconditions from Section B, inserts a lease row and
   returns `{allowed, blockers[], lease_id, current_arm_audit_id,
   automation_generation, configuration_version, pinned_readiness_ids,
   readiness_hash, operating_mode, automation_state}`.

4. RPC `complete_comm_hub_scheduler_tick(p_lease_id uuid, p_arm_audit_id
   uuid, p_automation_generation bigint, p_readiness_hash text,
   p_counts jsonb, p_error jsonb)`. Validates the lease is RUNNING and all
   pinned identifiers still equal the current control-settings values and
   the Arm audit action='ARMED'. Only then updates heartbeat columns and
   marks lease COMPLETED. On mismatch: mark ABANDONED, do not update
   heartbeat, return `{ok:false, blockers}`.

**Edge function `comm-hub-automation-tick`**

- Verifies JWT, then additionally requires `x-scheduler-secret` matching
  `COMMUNICATION_HUB_SCHEDULER_SECRET` (added via `add_secret` — dedicated,
  not the dispatch secret).
- `action=probe`: writes an `automation_readiness_results` row of kind
  `scheduler` with `{runtime_build, probe_time, worker_version}` and
  returns `{ok, runtime_build, probed_at}`. No claim, no provider.
- `action=run`: calls `begin_comm_hub_scheduler_tick`; if blocked, records
  the blockers and returns without touching the queue. On allowed, invokes
  the canonical queue runner (`comm-hub-dispatch` `operation=queue`)
  bounded by `max_batch`, aggregates counts, then calls
  `complete_comm_hub_scheduler_tick`. Errors are captured into `p_error`
  and heartbeat is not written on failure.
- Top-level try/catch → JSON + CORS + runtime build marker
  `comm-hub-automation-tick@2026-07-26-slice-b`.

**Secrets**

- `add_secret` → `COMMUNICATION_HUB_SCHEDULER_SECRET` (new).

**Client**

- No UI wiring in this slice beyond exposing probe from an
  Admin diagnostics button on `AutomatedProductionActivationPanel` labelled
  "Run scheduler probe" (writes evidence; does not arm).

**Tests**

- I.3 scheduler run blocked before Arm.
- I.4 scheduler run blocked in Manual Production.
- I.6 blocked with old Arm audit id.
- I.7 blocked with old automation generation.
- I.9 heartbeat cannot be recorded for invented Arm context.
- I.10 re-arm invalidates previous heartbeat.

---

## Slice C — Bind generic queue dispatcher to Arm context

**Edit `supabase/functions/comm-hub-dispatch/index.ts`**

- When `operation=queue` (scheduled/automatic path only — not
  `targeted`/`one_real_email`/`manual_production_observation`), require a
  `x-scheduler-lease-id` header. Before any claim, call new RPC
  `assert_comm_hub_queue_run_context(p_lease_id, p_module, p_event,
  p_channel)` returning `{allowed, blockers}`. Refuse to claim on
  disallowed.
- Predicate: mode=AUTOMATED_PRODUCTION, state=ARMED, scheduler_enabled,
  dispatch_enabled, no Emergency Stop, lease still RUNNING,
  lease.arm_audit_id = current_arm_audit_id, lease.automation_generation =
  current_automation_generation, event status=`live_cron_allowed`.

**Migration `comm_hub_queue_arm_binding_v1`**

- `assert_comm_hub_queue_run_context` RPC (SECURITY DEFINER,
  service-role-only).

**Tests**

- I.5 scheduler run blocked during Emergency Stop simulated (rollback-only
  txn setting `operating_mode='EMERGENCY_STOP'`).
- I.8 blocked run claims zero messages.

---

## Runtime evidence at end of slices A+B+C

1. Migration versions from `supabase migrations list`.
2. `comm-hub-automation-tick` deploy id + build marker.
3. `action=probe` returns ok=true; a scheduler `automation_readiness_results`
   row exists < 5 min old.
4. `begin_comm_hub_scheduler_tick` called with system NOT ARMED returns
   `allowed=false` with blocker `not_armed` (I.3).
5. Pending Manual Production observation evidence view returns the pending
   row unchanged (no second email).
6. `batch_enabled=false`, `bulk_enabled=false` re-asserted.

Slices D–J will be planned separately once A+B+C are green in runtime.

---

## Non-goals in this slice

- No canary creation (Slice F).
- No Emergency Stop RPC (Slice G).
- No changes to `get_comm_hub_go_live_completion` (Slice E).
- No readiness probe rewrites beyond the scheduler probe wiring in B (D
  hardens the other 8).
- No UI redesign of Stage 8 / 9 (Slice H).
- No canary or Stage-9-only tests (I.11–I.22, minus the ones listed above).

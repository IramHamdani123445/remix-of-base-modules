
# A4.1.3 — Atomic Canonical Controlled-Revalidation Preparation

Slice A4.1.2C (server hydration + simplified rendering) is accepted. A4.1.3 replaces the temporary split-preparation runtime (`_comm_hub_revalidation_prepare_execution` + direct Edge inserts + `_comm_hub_revalidation_finalize_preparation`) with **one atomic, canonical, no-send preparation RPC** owning all evidence in a single transaction.

**Non-negotiable invariants preserved:** four-workspace UI, server-hydrated authorisation & execution, 8-stage Operations journey, all runtime-contract gates, SEND hard stop, MANUAL_PRODUCTION mode, automation STANDBY, production anchor untouched, provider never contacted, authorisation never consumed.

---

## Deliverables

### 1. Database — canonical atomic RPC

New migration adds:

- `public._comm_hub_revalidation_prepare_delivery(p_payload jsonb) returns jsonb` — SECURITY DEFINER, service-role callable, single atomic transaction.
  - `FOR UPDATE` locks on cycle, authorisation, active execution.
  - Re-runs full fresh-authority check (cycle, auth, event certification, ORE, lineage, attestation, evidence snapshot + fingerprint, assessment fingerprint, stage completion, canonical recipient, recipient policy, template mapping/version + manifest hash, sender profile + version, provider configuration, control settings, provider-boundary approval remains false).
  - Derives canonical idempotency key server-side (`crev-prep:<cycle>:<auth>:<preparation_version>`).
  - Inner `BEGIN…EXCEPTION` sub-block creates and links, in order:
    1. `communication_request`
    2. `communication_message` (with canonical rendered subject/body + hashes, template_version_id + manifest hash, renderer code/version, payload hash, sender fields, provider id)
    3. canonical recipient snapshot row (`communication_recipient_snapshot` or the project's canonical recipient row) with masked/normalized email, policy version, recipient-set hash, decision, auth id, cycle id
    4. real `communication_delivery_trace` row (context = CONTROLLED_REVALIDATION, boundary NOT_ENTERED, provider_call_attempted=false)
    5. `communication_delivery_attempt` (status pending, provider id bound, trace_id linked)
    6. audit metadata
  - On success: `execution` transitions PREPARING → READY_FOR_PROVIDER, all foreign IDs populated on the execution row.
  - On any inner failure: rollback dependent rows (savepoint), retain execution, transition to FAILED_PRE_PROVIDER with `failure_code` + safe detail; authorisation unconsumed; `provider_boundary_state=NOT_ENTERED`.
  - Reconciliation branches:
    - No execution → create version 1.
    - READY_FOR_PROVIDER → verify linked rows exist; return same IDs with `operation_performed=REUSED`.
    - PREPARING (legacy split-path residue) → reconcile: inspect canonical key + existing preparation-owned rows; complete evidence if provably safe, else `FAILED_PRE_PROVIDER`.
    - FAILED_PRE_PROVIDER → allow retry only if authorisation usable + server-permitted, DB derives next `preparation_version`, new canonical key.
    - RECOVERY_REQUIRED → return explicit envelope; do not treat generic PREPARE as recovery.
- Adds `recipient_snapshot_id`, `trace_id`, `delivery_attempt_id`, `message_id`, `request_id`, `template_version_id`, `sender_profile_id`, `provider_id`, `template_manifest_hash`, `renderer_version` columns on `communication_hub_revalidation_execution` if not already present.
- Adds partial unique index guaranteeing one active preparation per (cycle_id, preparation_version).
- Marks `_comm_hub_revalidation_prepare_execution` and `_comm_hub_revalidation_finalize_preparation` deprecated (comment + `RAISE WARNING`) — retained service-role-only, no runtime path calls them.
- Removes execution-ID/attempt-ID trace fallback in any runtime-contract check.
- GRANT EXECUTE only to `service_role`.

### 2. Edge Function rewrite (`comm-hub-send-controlled-revalidation`)

- Keeps operator JWT verification + Comm Hub admin check.
- Calls fresh context resolver (`resolve_comm_hub_revalidation_preparation_context`) once — sole provider-configuration lookup.
- Invokes canonical application-side renderer (reuses `coreTemplateResolverService` + existing runtime renderer used by real sends — no second revalidation-only renderer) with server-authoritative inputs only.
- Passes structured render envelope (template_version_id, manifest hash, renderer code/version, subject, subject hash, text body, html body, body hash, payload hash) to atomic RPC.
- Calls `_comm_hub_revalidation_prepare_delivery` exactly once per request.
- **Removes all direct inserts** into communication_request / communication_message / recipient / trace / attempt tables.
- Removes `_comm_hub_revalidation_prepare_execution` and `_comm_hub_revalidation_finalize_preparation` calls.
- Actions:
  - `PREPARE_CONTROLLED_REVALIDATION` — create/reuse/legacy-reconcile.
  - `RETRY_CONTROLLED_REVALIDATION_PREPARATION` — only for immutable FAILED_PRE_PROVIDER.
  - `RECOVER_CONTROLLED_REVALIDATION_PREPARATION` — only for RECOVERY_REQUIRED.
  - `ACTION_SEND` continues to return `provider_boundary_not_approved`.
- Response envelope exactly as specified (action, status, operation_performed, all IDs, provider_call_attempted=false, provider_boundary_state=NOT_ENTERED, authorisation_status, blockers, warnings).

### 3. UI action matrix (`ControlledRevalidationPanel.tsx`)

Map server state → real backend operations:

- no execution → **Prepare controlled delivery** (PREPARE)
- PREPARING resumable → **Resume preparation** (PREPARE, reconciliation path)
- PREPARING non-resumable → **Recovery required** (no button — status + link to Audit)
- READY_FOR_PROVIDER → "Preparation complete — no email sent." (no button)
- FAILED_PRE_PROVIDER + retry_allowed → **Retry preparation** (RETRY)
- FAILED_PRE_PROVIDER + !retry_allowed → status only
- RECOVERY_REQUIRED → **Recover preparation** (RECOVER)
- PROVIDER_RESULT_PENDING / COMPLETE → no action

Refetches `comm-hub-operations-summary`, active authorisation, active preparation after every action. Full IDs remain in Audit only.

### 4. Tests

**SQL — `supabase/tests/comm-hub/atomic_preparation_test.sql`**
- Isolated fresh-context fixture (throwaway cycle, auth, event, template, sender, provider config).
- Happy path: single execution, request, message, recipient snapshot, real trace, attempt; READY_FOR_PROVIDER; boundary NOT_ENTERED; auth ISSUED; canonical content stored; same provider id on every row; all FK columns populated.
- Failure injection at each of: request / message / recipient / trace / attempt / execution finalisation. Prove no orphan dependent rows, execution=FAILED_PRE_PROVIDER, failure evidence retained, authorisation unconsumed.

**Idempotency & concurrency — `atomic_preparation_idempotency_test.sql`**
- Same cycle/auth → identical IDs, no new rows.
- Two `pg_background`/`dblink` sessions → exactly one active preparation, second reuses.
- Client-supplied idempotency key ignored.
- Client-supplied preparation_version ignored.
- Legacy PREPARING reconciliation deterministic.
- FAILED_PRE_PROVIDER retry → server-derived next version.
- Cycle with provider boundary entered → all preparation rejected.

**Edge — `supabase/functions/comm-hub-send-controlled-revalidation/index_test.ts` extension**
- Missing JWT rejected. Non-admin rejected. Provider resolver called once (spy count). Provider transport count=0 (no fetch to provider host). SEND still returns `provider_boundary_not_approved`. Atomic RPC called exactly once. No direct Edge inserts (query counters). Returned IDs equal RPC-returned IDs.

**UI — `src/pages/admin/communicationHub/goLive/__tests__/revalidationActionMatrix.test.tsx`**
- Each state produces the correct button/label and dispatches the correct action; refetch happens after every action; full IDs never appear on Revalidation surface.

### 5. CI & typecheck

Update `.github/workflows/comm-hub-clean-db-ci.yml`:
- Remove `|| true` from the typecheck and Vitest steps (make blocking).
- Add blocking steps: run `supabase/tests/comm-hub/atomic_preparation_test.sql`, `atomic_preparation_idempotency_test.sql`, existing `prepare_execution_test.sql`, `recipient_policy_contract_test.sql` via psql.
- Add a two-connection concurrency step using `pg_background` or parallel psql sessions.
- Add scoped Vitest run for `src/__tests__/comm-hub` + `src/pages/admin/communicationHub/**/__tests__` + `src/platform/communication-hub/__tests__` — blocking.

### 6. Explicit non-scope (A4.2)

Do **not**: invoke provider transport; consume authorisation; record provider acceptance/rejection; enable SEND; bypass baseline/attestation/pilot; change operating mode; arm automation; run canary; alter production anchor.

---

## Technical implementation notes

- Schema discovery first: `\d communication_hub_revalidation_execution`, `\d communication_request`, `\d communication_message`, canonical recipient snapshot table, `communication_delivery_trace`, `communication_delivery_attempt`. Add missing FK columns on execution via ALTER TABLE in the migration.
- Canonical rendering: locate the existing runtime renderer used by `sendCommunication.ts` / `send-transactional-email`. Reuse it — do not fork.
- Provider resolution: use whichever resolver `send-transactional-email` uses; call once inside fresh-context resolver; pass configuration id/version through to the RPC.
- Concurrency test: use `SELECT dblink(...)` from two connections opening transactions with `pg_advisory_xact_lock` on the cycle id to prove serialization.
- Failure injection: wrap the atomic RPC's inner block with a testing hook — a `SET LOCAL app.test_fail_stage = 'message'` GUC checked once per stage — so the test file can force each stage to raise.
- Deprecation of legacy RPCs: keep the functions installed (some historical PREPARING rows may need the finalize path during reconciliation — but reconciliation is now inside the atomic RPC, so runtime never calls them). Add `COMMENT ON FUNCTION … IS 'DEPRECATED: use _comm_hub_revalidation_prepare_delivery'` and `RAISE WARNING`.
- Runtime-contract check: update whatever function asserts trace exists to require a real `communication_delivery_trace` row (not execution_id / attempt_id).

## Stop point

An isolated test cycle reaches READY_FOR_PROVIDER with canonical content, canonical sender, canonical recipient, real trace, complete durable linkage, zero provider calls. Then I return the structured checklist the request specifies (commit SHA, atomic RPC name, all evidence IDs, test results, protected-state diff).

---

## Confirmation needed before I execute

This is a large, high-risk slice touching the atomic runtime that the live pilot cycle also traverses. Two questions before I start:

1. **Renderer reuse** — is it acceptable for the Edge Function to call the existing application-side renderer used by `send-transactional-email` and pass a signed render envelope to the atomic RPC (my preferred approach), or must the atomic RPC invoke a SQL renderer end-to-end?
2. **Legacy PREPARING reconciliation** — the live pilot may currently have executions in PREPARING from the split path. Reconcile them **inside** the atomic RPC (my preferred approach, as A4.1.3 §9 describes), or leave the temporary RPCs available for a manual one-off reconciliation and have the new runtime treat any legacy PREPARING as `RECOVERY_REQUIRED`?

Once you confirm, I proceed straight through: schema discovery → migration → edge rewrite → UI matrix → SQL tests → edge tests → UI tests → CI wiring → structured report.

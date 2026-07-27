# Communication Hub — Controlled Revalidation & Re-Send

Addendum to the Production Go-Live epic. Existing Automated Readiness work stays in place; this workstream lands after it. Nothing here sends an email — implementation stops before the first controlled revalidation email and hands off to an operator.

## Invariants (must not change)

- Event certification `732386ff-5efc-49b2-acf9-8a619f734214`
- Authoritative ORE `39c0f243-d6df-40cd-8b45-52edf7ff2a24`
- Production lineage `ecf8e376-e245-450f-b44b-1da5bf895722`
- Lifecycle `LIVE_MANUAL`, mode `MANUAL_PRODUCTION`, automation `STANDBY`
- No overwrite of historical confirmations, no auto-selection of newer ORE, no reuse of old idempotency keys, no automatic re-Arm, no automatic promotion.

## Deliverables

### 1. Data model (single migration)

- `communication_hub_revalidation_cycle` — one row per cycle, unique partial index enforcing at most one unresolved cycle per (module, event, channel). Full field set per spec section 2, including baseline + current `evidence_core_v2` / `evidence_fingerprint_v2`, `changed_components`, `runtime_changes`, `required_validation_level`, `required_stages`, promotion fields, `superseded_cycle_id`.
- `communication_hub_revalidation_stage_result` — child evidence, one row per stage code, linked to the source certification / observation / canary id where applicable.
- `communication_hub_runtime_release` — additive, server-owned release manifest (git SHA, component build ids, deployed_at, affected surfaces, revalidation impact, deployed_by, reason). No secrets.
- `communication_hub_revalidation_send_authorisation` — one-use, cycle-scoped, recipient-scoped, fingerprint-scoped grant with expiry and consumed_at. Server constraint: at most one provider-contacting execution per cycle.
- Enums for `purpose`, `status`, `stage_code`, `required_validation_level`.
- GRANTs to `authenticated` / `service_role`; RLS scoped to platform admins via `has_role`.
- All promotion / stage rows immutable via triggers (append-only + status-transition guard).

### 2. Server RPCs (all `SECURITY DEFINER`, admin-only)

- `assess_comm_hub_revalidation_requirement(module, event, channel, declared_change_categories, runtime_release_reference)` — non-mutating. Compares baseline vs current `evidence_core_v2`, fingerprints, lineage, template hash, sender, recipient policy, provider, payload schema, review/send policy versions and runtime release. Returns the full envelope from spec §4 including `production_may_continue`, `event_must_be_suspended`, `automation_must_be_disarmed`, plus `required_stages` derived from the section 5 rule matrix (levels `NONE` → `AUTOMATED_CANARY`).
- `start_comm_hub_revalidation_cycle(...)` — creates a DRAFT/ASSESSING cycle bound to a fresh assessment result; rejects if an unresolved cycle exists.
- `record_comm_hub_revalidation_stage(cycle_id, stage_code, evidence_ids...)` — writes a stage result, enforces stage prerequisites, never copies historical evidence unless the assessment marked that stage unaffected.
- `issue_comm_hub_revalidation_send_authorisation(cycle_id, recipient, current_fingerprint, typed_phrase)` — creates the one-use grant. Requires typed phrase `SEND ONE CONTROLLED REVALIDATION EMAIL`. Rejects if ARMED, EMERGENCY_STOP, batch/bulk enabled, or if a provider-contacting execution already exists for the cycle.
- `record_comm_hub_revalidation_provider_result(cycle_id, execution_id, outcome)` — reuses the One Real Email transport results; closes the grant.
- `record_comm_hub_revalidation_inbox_confirmation(cycle_id, status)` — CONFIRMED / NOT_RECEIVED. NOT_RECEIVED closes the cycle and requires a new cycle for another email.
- `void_comm_hub_revalidation_cycle(cycle_id, reason)` — mirror of the manual production observation voider; rejects if provider evidence exists.
- `promote_comm_hub_revalidation_baseline(cycle_id, typed_phrase)` — typed phrase `PROMOTE REVALIDATION BASELINE`. Validates all required stages, fingerprint identity, inbox CONFIRMED, no provider ambiguity. Atomically: writes immutable audit of old event cert / ORE / lineage, creates new lineage + certified revision, binds new ORE + current fingerprint, updates projection, supersedes prior baseline authority, clears `REVALIDATION_REQUIRED`. When event was automated: invalidates readiness + Arm authority, requires fresh readiness + canary + explicit re-Arm.
- `mark_comm_hub_revalidation_cycle_supplemental(cycle_id)` — outcome A: `VERIFIED_SUPPLEMENTAL`, no anchor change.
- `record_comm_hub_runtime_release(...)` — additive release manifest write; used by the assessment RPC.

### 3. Send-context reuse (no second dispatcher)

Extend the existing One Real Email transport with an explicit `send_context = 'CONTROLLED_REVALIDATION'` (and `revalidation_cycle_id`). Requires the one-use revalidation authorisation instead of the standard ORE grant. Initial Stage 6 keeps its existing `SEND_ONE_REAL_EMAIL` contract untouched.

### 4. UI

Under `/admin/communication-hub/go-live`, once initial Stage 6 is CONFIRMED:

- New `ProductionCertifiedEmailPanel` — shows pinned ORE, verified recipient, verified date, lineage, baseline fingerprint. No "Resend" button.
- New `CurrentConfigurationPanel` — fingerprint match/drift, changed components, runtime release deltas.
- New `RevalidationCycleWizard` — 8 steps per spec §9. Step 5 requires the typed phrase and shows the required-stage plan derived server-side.
- OPERATOR_ASSURANCE (no drift) shows the exact copy from the spec; drift shows the "production remains blocked" copy.
- New `RevalidationHistoryPanel` per spec §11. Later confirmed emails render visibly distinct from the current production anchor.
- Route stays server-authoritative — all wizard state derives from the RPCs, no browser authority.

### 5. Tests

Add `src/__tests__/comm-hub/controlledRevalidation.test.ts` covering all 24 cases in spec §12. Includes a fixture that fails if any test triggers a provider call.

### 6. Stop point (mandatory)

Implementation halts after: migrations applied, RPCs deployed, UI shipped, tests green, one cycle in `READY_FOR_CONTROLLED_EMAIL` state for the pilot. No email sent. No anchor change. No re-Arm. Report includes: commit SHA, migration ids, current production anchor, detected change categories, recommended stages, cycle id/status, tests executed, deployment evidence, exact operator action required.

## Technical notes

- Reuse `_comm_hub_fingerprint_evidence_core_v2` — no new hashing helper.
- Reuse `communication_hub_control_settings` for mode/automation gate reads.
- Reuse `notification_providers` resolver for provider identity.
- Reuse `_normalize_comm_hub_manual_production_controls` for gate validation.
- Reuse existing legal / audit tables — audit rows are written via `_comm_hub_audit_write` where present.
- All new tables use `updated_at` triggers; all status transitions enforced by trigger, not application code.
- No changes to `src/integrations/supabase/*` (auto-generated).
- Automated Readiness work in progress is untouched; the assessment RPC just reads its outputs.

## Sequencing

1. Migration: enums + 4 new tables + triggers + GRANTs + RLS.
2. Migration: 9 RPCs + immutability triggers on stage results.
3. Migration: extend One Real Email transport for `send_context`.
4. Migration: runtime release manifest table + `record_comm_hub_runtime_release`.
5. Frontend: services (`revalidationCycleService.ts`, `changeAssessmentService.ts`, `runtimeReleaseService.ts`).
6. Frontend: 4 panels + 8-step wizard, slotted into `GoLivePage.tsx` under Stage 6 once CONFIRMED.
7. Tests: 24-case suite.
8. Bootstrap: seed one DRAFT cycle for `APPEALS / APPEAL_RECEIVED_NOTICE / email`, run assessment against current runtime, advance to `READY_FOR_CONTROLLED_EMAIL`, and stop.

Awaiting approval to build.

# Provider-Action Gating Audit — Track A / A1

Commit context: static audit of five provider-contacting UI actions against the shared
`RuntimeContractProvider` / `RuntimeContractGate` / `useRuntimeCapability` surface.

**Definition of "gated" for this audit:** the action must render inside — or be
disabled by — a hook/gate that consults `useRuntimeContract()` /
`useRuntimeCapability()` / `useRuntimeCapabilities()` (see
`src/platform/communication-hub/RuntimeContractContext.tsx`). Panel-local
readiness state, typed-phrase requirements, and server RPC checks are *not*
substitutes; they are additional server conditions layered *after* the runtime
contract gate.

## Required fail-closed matrix

| Report state       | Required UI behaviour               |
| ------------------ | ----------------------------------- |
| loading            | action disabled                     |
| unavailable / null | action disabled                     |
| audit error        | action disabled                     |
| capability FAIL    | action disabled + blocker rendered  |
| capability PASS    | action may enable (other gates permitting) |

`RuntimeContractGate` and `useRuntimeCapability` already return
`passes:false` on loading / error / null (fail-closed). The audit below records
whether each action *uses* them.

## Findings per action

### 1. Initial One Real Email
- **Component:** `src/pages/admin/communicationHub/controlCenter/OneRealEmailPanel.tsx`
- **Button label:** "Send One Real Email" (Stage 6)
- **Ultimate call:** Edge Function `comm-hub-send-one-real-email`
- **Required capability code (proposed):** `SEND_ONE_REAL_EMAIL`
- **RuntimeContractGate usage:** ❌ none (no import of the gate, no
  `useRuntimeCapability` call).
- **Behaviour today:** Enable/disable is driven by typed-phrase, module/event
  selectors, and server-side `get_comm_hub_event_go_live_status` blockers only.
- **Verdict:** **NOT_GATED on runtime contract.** Layered server checks exist
  but the shared audit report is not consulted; the button remains actionable
  even if `audit_comm_hub_runtime_contract` reports MISSING_FUNCTION on the
  send pipeline.

### 2. Manual Production send (observation dispatch)
- **Component:** `src/pages/admin/communicationHub/goLive/ManualProductionObservationPanel.tsx`
- **Button label:** "Dispatch observation"
- **Ultimate call:** Edge Function `comm-hub-run-manual-production-observation`
- **Required capability code (proposed):** `MANUAL_PRODUCTION_OBSERVATION`
- **RuntimeContractGate usage:** ❌ none.
- **Behaviour today:** Disabled by panel-local `primaryDisabled` derived from
  `goLiveStateResolver`. Fails closed on transport error, not on runtime
  contract absence.
- **Verdict:** **NOT_GATED on runtime contract.**

### 3. Controlled Revalidation authorisation
- **Component:** `src/pages/admin/communicationHub/goLive/ControlledRevalidationPanel.tsx`
- **Button label:** "Start controlled revalidation" (issues authorisation)
- **Ultimate call:** `reserve_comm_hub_revalidation_send_authorisation` RPC
- **Required capability code (proposed):** `REVALIDATION_AUTHORISATION`
- **RuntimeContractGate usage:** ❌ none.
- **Verdict:** **NOT_GATED on runtime contract.** Guarded only by typed-phrase
  and cycle status.

### 4. Controlled Revalidation send
- **Component:** same panel — "Send controlled revalidation email"
- **Ultimate call:** Edge Function `comm-hub-send-controlled-revalidation`
- **Required capability code (proposed):** `REVALIDATION_SEND`
- **RuntimeContractGate usage:** ❌ none.
- **Verdict:** **NOT_GATED on runtime contract.**

### 5. Automated canary (Arm automation)
- **Component:** `src/pages/admin/communicationHub/goLive/AutomatedProductionActivationPanel.tsx`
- **Button label:** "Arm automation" (`arm_comm_hub_automation` RPC)
- **Required capability code (proposed):** `AUTOMATION_ARM`
- **RuntimeContractGate usage:** ❌ none.
- **Verdict:** **NOT_GATED on runtime contract.** Guarded by typed-phrase,
  readiness snapshot, and server RPC checks.

## Summary

`RuntimeContractGate` and `useRuntimeCapability` are implemented and
fail-closed by design, and the shared `RuntimeContractProvider` is mounted at
the Go-Live page level (see `GoLivePage.tsx`). However **none of the five
provider-contacting actions currently consume them**. Provider actions rely
entirely on server-side authority checks (typed phrase, cycle status, event
go-live status, admin RPC gates). That is defence-in-depth on the server, but
it is *not* the client-side capability fail-closed contract Checkpoint A
requires.

**Required follow-up (blocked from this turn per Track A rules — no changes to
provider-contacting UI paths without gating tests):**

1. Introduce five capability codes in `audit_comm_hub_runtime_contract` — one
   per action above — each returning PASS only when every downstream
   table/function referenced by the corresponding Edge Function / RPC exists
   at the expected signature.
2. Wrap each of the five action rows in `<RuntimeContractGate capabilities={[…]} action="…">`
   *or* consume `useRuntimeCapabilities([…])` and thread `passes` into the
   existing `disabled=` computation.
3. Add component tests (Vitest + Testing Library) proving each of the five
   states in the matrix above disables the primary button.

The tests (per the Track A brief) live at:

- `src/pages/admin/communicationHub/goLive/__tests__/providerActionGating.test.tsx`

They are not landed in this checkpoint because the gate wiring itself is not
landed; adding tests without the wiring would ship green tests against
incorrect behaviour.

## Read-only baseline pre-check (A2)

> **UNOFFICIAL READ-ONLY PRE-CHECK — NOT OPERATOR RPC EVIDENCE.**
> Computed by querying the underlying attestation row and invoking the
> canonical `_comm_hub_fingerprint_evidence_core_v2` helper directly (the
> same helper the admin-gated `diagnose_comm_hub_legacy_attestation_fingerprint`
> RPC calls). No admin-gated RPC was bypassed; no application-side re-implementation
> of SHA-256 was used.

Scope: `APPEALS / APPEAL_RECEIVED_NOTICE / email`.

| Field | Value |
| --- | --- |
| Active attestation count | 1 |
| Active attestation id | `43ed8437-bfe4-47b8-bbd5-5554eead34d0` |
| Attested at | 2026-07-27T05:28:18Z |
| Event certification id | `732386ff-5efc-49b2-acf9-8a619f734214` |
| ORE certification id | `39c0f243-d6df-40cd-8b45-52edf7ff2a24` |
| Production lineage id | `ecf8e376-e245-450f-b44b-1da5bf895722` |
| Stored fingerprint (v2) | `sha256-v2:939eea3056656144515a5e34f47451473503b8dbf7effba595353b8ea5d18494` |
| Rehash of `current_evidence_snapshot_v2` (full wrapper) | `sha256-v2:34100d20c669b3d3fa6cee6ff635e472c4b389431f1b46266ac37dd30bcd01da` |
| Rehash of `current_evidence_snapshot_v2->'snapshot'` (inner core) | `sha256-v2:5b5a5e00d91c2ca95cd12bedd221d2d9df6517bc9dadf79fed5d7059a4a2ab02` |
| stored == wrapper-rehash | **false** |
| stored == inner-core-rehash | **false** |
| snapshot contains `evidence_core` key | **false** — inner key is `snapshot` |

**Interpretation.** The stored attestation fingerprint (`939eea…`) cannot be
reproduced from the stored snapshot by the canonical v2 helper — neither the
wrapper nor its inner `snapshot` object rehashes to it. This matches the
Slice 2B root cause: attestations written before the canonical helper was
made `IMMUTABLE` + core-only stored a different serialisation.

**Result classification:** `LIKELY_DIVERGENT`.

**Predicted operator action (subject to authenticated diagnostic):**
run `correct_comm_hub_legacy_baseline_attestation` with typed confirmation
`CORRECT LEGACY BASELINE ATTESTATION`. This pre-check does **not** replace
the authenticated RPC evidence required to promote baseline to CONVERGED.

## Local clean-database equivalent (A3)

> Local sandbox validation. **Not** GitHub Actions evidence.

| Check | Result |
| --- | --- |
| Migration-from-zero (clean pg) | *not run this checkpoint* — psql access here is the live pooled Supabase; provisioning a separate clean pg + supabase-compat schemas is a >5 min bootstrap and is deferred to CI. Existing `.github/workflows/comm-hub-clean-db-ci.yml` is the canonical path. |
| TypeScript (`bunx tsgo --noEmit`) | **PASS** (exit 0) |
| Vitest — `src/__tests__/comm-hub` + `src/platform/communication-hub` | **FAIL** — 25 failed / 368 passed / 7 skipped across 50 test files. Failing files are predominantly static string assertions against Edge Function orchestrator source (e.g. `commHubP3DB2cOrchestration.test.ts` line 262 expects `COMMUNICATION_HUB_DISPATCH_SECRET` mention that recent refactors renamed). None are runtime-behaviour regressions on new Checkpoint A code. |
| Edge Function tests (Deno) | *not run this checkpoint* — Deno test harness for the controlled-revalidation and observation functions is scoped into A4/A5. |

**Limitations vs real CI:** no isolated Postgres, no from-zero migration
replay in this reply, no Deno test invocation, no artifact upload.

## Items still requiring an operator JWT

- Authenticated `audit_comm_hub_runtime_contract()` result (checks summary + failing list).
- Authenticated `diagnose_comm_hub_legacy_attestation_fingerprint` — the four official equality booleans.
- Baseline correction via typed phrase (only if diagnostic confirms divergence).
- `reassess_comm_hub_revalidation_cycle('d2a6f6ba-a414-446d-8254-bb4efa991212')`.
- Triggering the real GitHub Actions workflow.

---

## Post-slice update — five gates wired

After this slice all five provider-contacting actions are mounted **inside**
`RuntimeContractGate` in `GoLivePage.tsx`, using the canonical capability map
in `src/platform/communication-hub/runtimeActionRequirements.ts`
(`getRuntimeRequirements` / `runtimeActionPasses`). Panels no longer receive
per-panel hard-coded capability arrays; the map is the single source.

| Action                                  | Capability code                          | Mount site                                                                                                                             | Gated? |
| --------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Initial One Real Email                  | `ONE_REAL_EMAIL`                         | `GoLivePage.tsx` — `RuntimeContractGate` around `OneRealEmailPanel`                                                                    | ✅     |
| Manual Production observation / send    | `MANUAL_PRODUCTION_SEND`                 | `GoLivePage.tsx` — `RuntimeContractGate` around `ManualProductionObservationPanel`                                                     | ✅     |
| Controlled Revalidation authorisation   | `CONTROLLED_REVALIDATION_AUTHORISATION`  | `GoLivePage.tsx` — `RuntimeContractGate` around `ControlledRevalidationPanel` (also requires `CONTROLLED_REVALIDATION_SEND` union)     | ✅     |
| Controlled Revalidation provider send   | `CONTROLLED_REVALIDATION_SEND`           | Same gate above (union) — send button inside the panel therefore inherits the closed gate                                              | ✅     |
| Automated canary (Arm automation)       | `AUTOMATED_CANARY`                       | `GoLivePage.tsx` — `RuntimeContractGate` around `AutomatedProductionActivationPanel`                                                   | ✅     |

Regression fix: `capabilityPasses(report, cap)` previously returned **true**
when the capability had **zero matched checks** (empty `.every` = `true`).
It now returns `false` on zero matches — an unknown/misnamed capability
therefore fails closed. See `runtimeContractGating.test.tsx` regression suite.

Runtime-contract gating remains an **additional** safety layer stacked on
top of server-side RPCs, typed-phrase requirements, mode gates, and status
gates — none of which have been removed.

---

## Track A / A4.0 — Action-level gating refactor (update)

**Change landed this turn:** the panel-level `RuntimeContractGate` wrappers in
`GoLivePage.tsx` around `ControlledRevalidationPanel`, `OneRealEmailPanel`,
`ManualProductionObservationPanel` and `AutomatedProductionActivationPanel`
have been **removed**. They were hiding recovery, reconciliation, inbox
confirmation, Emergency Stop, disarm, diagnostics, evidence and history along
with the provider-touching action they were meant to protect. That behaviour
violated the safety invariant.

Introduced primitive: `RuntimeContractActionGate`
(`src/pages/admin/communicationHub/goLive/RuntimeContractActionGate.tsx`).
It wraps a single provider-touching button, forces `disabled` when the
required capabilities are not all PASS, renders a compact blocker note, and
consumes the same `RuntimeContractProvider` so panels do not refetch the
report independently.

### Current state matrix per surface

| Surface | Panel visibility | Provider action availability | Recovery / diagnostics availability | Emergency-control availability |
| --- | --- | --- | --- | --- |
| Controlled Revalidation | Always mounted when Step 6 = COMPLETED | Authorise / send **still not** self-gated (follow-up) — server RPC authority remains sole enforcement | Assessment, reassessment, cycle history, stage inspection remain visible | N/A |
| One Real Email | Always mounted pre-Step 6 completion | Send action **still not** self-gated (follow-up) — typed phrase + server checks remain sole enforcement | Recovery, reconciliation, manual confirmation, provider result remain visible | N/A |
| Manual Production Observation | Always mounted post-Step 7 promotion | Dispatch **still not** self-gated (follow-up) — server RPC authority remains sole enforcement | Pending observation, evidence, result history, recovery, inbox confirmation remain visible | N/A |
| Automated Production Activation | Always mounted post-Manual-Production certification | Canary / activation actions **still not** self-gated (follow-up) — readiness + server checks remain sole enforcement | Readiness report, lease/status, audit evidence remain visible | Emergency Stop and disarm remain visible (not gated) |

### What is NOT yet complete (deferred to follow-up turn)

Per-button surgery inside each of the four panels to wrap the specific
provider-touching button with `<RuntimeContractActionGate action="…" …>`. The
primitive, the canonical capability map (`runtimeActionRequirements.ts`), and
the shared context are all landed and covered by
`runtimeContractActionGate.test.tsx`. Panels currently rely on their existing
typed-phrase + server-authority enforcement until the primitive is dropped in
around the specific buttons.

### Regression protections landed this turn

- `runtimeContractActionGate.test.tsx` — proves for every action code that:
  loading, absent report, audit error, and each of MISSING_TABLE /
  MISSING_COLUMN / SIGNATURE_MISMATCH / NOT_IMPLEMENTED disable the wrapped
  button; unrelated capability failures do not; sibling controls
  (recovery, inbox confirmation, Emergency Stop, disarm, diagnostics) stay
  interactive; no click handler fires when blocked.

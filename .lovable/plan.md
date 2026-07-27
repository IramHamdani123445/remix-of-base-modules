## Goal

Preserve backend safety, readiness contract, and A4.1 durable preparation. Simplify operator UI by splitting one 1,445-line Operations page into four workspaces sharing a single `RuntimeContractProvider`, and wire `RuntimeContractActionGate` around actual provider-touching buttons (not panels). No provider calls, no schema changes, no mode/anchor/baseline mutations.

## Information architecture

Introduce a shared `CommunicationHubWorkspace` shell with tabs:

```text
Operations | Readiness | Revalidation | Audit & Evidence
```

Routes (added to `src/config/routes.ts` and mounted in the app router):

- `/admin/communication-hub/go-live` — Operations (simplified)
- `/admin/communication-hub/readiness` — Readiness Center
- `/admin/communication-hub/revalidation` — Revalidation workspace
- `/admin/communication-hub/audit` — Audit & Evidence

The shell mounts `RuntimeContractProvider` once at the layout level so all four tabs consume the same context — no duplicate contract fetch.

## Operations page (rewrite)

New `OperationsPage.tsx` replaces the body of `GoLivePage.tsx`. Sections in order:

1. Compact event selector (reuses `ModuleEventSelectors`).
2. Current-state header (mode, automation state, lifecycle status, anchor status, last delivery) — derived from existing `goLiveStateResolver` + shared runtime-contract context.
3. Compact readiness strip: single pill `READY | BLOCKED | ACTION_REQUIRED | PROCESSING`, blocker count, one-line summary, "Open Readiness Center" link. Derived via new presentation helper `useOperationsReadinessSummary()` — no new DB authority.
4. Next Action card — exactly one primary CTA from server-authoritative state.
5. Compact lifecycle stepper — only current stage expanded, completed collapsed with one-line summary, future collapsed.
6. Safety controls row: Emergency Stop, disarm, recovery — always visible regardless of contract status.
7. Compact Revalidation Summary card (status, reason, level, next action, provider-touched, inbox confirmed, "Open Revalidation" link).

Detailed panels (RuntimeContractCard, DiagnosticBundlePanel, GoLiveGateMonitor, LegacyBaselineAttestationPanel, full ReadinessSummary, full ControlledRevalidationPanel) are removed from Operations.

## Readiness Center

New `ReadinessCenterPage.tsx` composed of existing components in ten collapsible sections (overall, current-action, configuration, provider/sender, template/policy, baseline convergence, Manual Production, Automated Production, CI/runtime evidence, advanced diagnostics). Fingerprints and raw JSON collapsed by default behind "Advanced diagnostics".

## Revalidation workspace

New `RevalidationPage.tsx` mounts the existing `ControlledRevalidationPanel` in full, including assessment, reassessment, cycle creation, authorisation, controlled send, recovery, inbox confirmation, promotion prep, history.

## Audit & Evidence

New `AuditEvidencePage.tsx` surfaces execution IDs, request IDs, message IDs, delivery-attempt IDs, provider message IDs, event certification IDs, ORE IDs, lineage IDs, evidence fingerprints, attestation history, raw diagnostic JSON, runtime build IDs, promotion history — using existing services (`runtimeContractService`, evidence snapshot RPCs already available).

## Button-level gating

Remove any remaining panel-level `RuntimeContractGate` wraps. Wire `RuntimeContractActionGate` around exactly these buttons with a compact blocker note ("Action unavailable — N readiness requirements need attention. Open Readiness Center"):

- `ONE_REAL_EMAIL` — send button inside `OneRealEmailPanel`.
- `MANUAL_PRODUCTION_SEND` — dispatch button inside `ManualProductionObservationPanel`.
- `CONTROLLED_REVALIDATION_AUTHORISATION` — authorise button inside `ControlledRevalidationPanel`.
- `CONTROLLED_REVALIDATION_SEND` — controlled send button inside `ControlledRevalidationPanel`.
- `AUTOMATED_CANARY` — canary/activation action inside `AutomatedProductionActivationPanel`.

Diagnostics, reassessment, history, recovery, reconciliation, inbox confirmation, Emergency Stop, disarm, evidence links stay ungated. `RuntimeContractActionGate` already supports `suppressBlockerNote` for compact mode; extend it with a `variant="compact"` that shows the one-line message + link instead of the full failure list.

## Presentation-only summary

Add `src/pages/admin/communicationHub/shared/useOperationsReadinessSummary.ts` returning `{ overall_status, current_action, current_action_permitted, blocker_count, blocker_summary, readiness_link, recovery_required, inbox_confirmation_required }` — pure derivation from existing runtime-contract context + `goLiveStateResolver`. No new fetch, no new RPC.

## Tests

`src/pages/admin/communicationHub/__tests__/uiSimplification.test.tsx` — 15 tests covering: compact current-state, only current stage expanded, completed stages summarized, future collapsed, no `RuntimeContractCard` on Operations, `DiagnosticBundlePanel` on Readiness, `ControlledRevalidationPanel` on Revalidation, execution IDs on Audit, five buttons individually gated, blocked send preserves recovery/inbox/Emergency Stop/disarm, shared provider (single fetch spy), no provider action on render/navigation.

## Stop point

No provider boundary entry, no authorisation issuance, no mode change, no Arm, no canary, no baseline correction. Preserve pilot state.

## Technical details

Files created: `OperationsPage.tsx`, `ReadinessCenterPage.tsx`, `RevalidationPage.tsx`, `AuditEvidencePage.tsx`, `CommunicationHubWorkspace.tsx` (tab shell + provider), `useOperationsReadinessSummary.ts`, `uiSimplification.test.tsx`, small `RevalidationSummaryCard.tsx`, `LifecycleStepper.tsx`, `NextActionCard.tsx`, `CurrentStateHeader.tsx`, `ReadinessStrip.tsx`.

Files edited: `src/config/routes.ts` (four routes), app router (mount workspace + children), `GoLivePage.tsx` (thin wrapper delegating to `OperationsPage` under the shell for back-compat), `RuntimeContractActionGate.tsx` (add `variant="compact"` with readiness-center link), `OneRealEmailPanel.tsx`, `ManualProductionObservationPanel.tsx`, `ControlledRevalidationPanel.tsx` (two gates), `AutomatedProductionActivationPanel.tsx`.

Verification: `tsgo` typecheck + `bunx vitest run src/pages/admin/communicationHub` + existing 76 Comm Hub tests must remain green.

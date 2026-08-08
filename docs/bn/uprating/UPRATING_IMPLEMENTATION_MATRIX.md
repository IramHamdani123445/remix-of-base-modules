# BN Uprating — Implementation Matrix

Canonical catalogue: 17 commands (`src/types/bn/uprating/upratingCanonicalCommands.ts`).
Governed boundaries: `public.bn_uprating_policy_command_v1` (policy),
`public.bn_uprating_run_command_v1` (runs).

## Epic status

| Epic | Scope | Status |
| --- | --- | --- |
| Epic 0 | Module foundation, policy catalogue, version governance | **COMPLETE — CERTIFIED** |
| Epic 1 | Run creation, population snapshot, exceptions, simulation | **COMPLETE — CERTIFIED** |
| Epic 2 | Run approval and execution scheduling | NOT_STARTED |
| Epic 3 | Batch execution and retry | NOT_STARTED |
| Epic 4 | Reconciliation and rollback | NOT_STARTED |
| Epic 5 | Run closure | NOT_STARTED |

## Canonical command status

| Command | Capability | Maker-checker | Status |
| --- | --- | --- | --- |
| BN_UPRATING_CREATE_POLICY | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_CREATE_POLICY_VERSION | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_VALIDATE_POLICY | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_APPROVE_POLICY | admin | yes | IMPLEMENTED (Epic 0) |
| BN_UPRATING_CREATE_RUN | write | no | IMPLEMENTED (Epic 1) |
| BN_UPRATING_BUILD_POPULATION | decide | no | IMPLEMENTED (Epic 1) |
| BN_UPRATING_SIMULATE | decide | no | IMPLEMENTED (Epic 1) |
| BN_UPRATING_RESOLVE_EXCEPTION | decide | no | IMPLEMENTED (Epic 1) |
| BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL | decide | no | NOT_STARTED |
| BN_UPRATING_APPROVE_RUN | admin | yes | NOT_STARTED |
| BN_UPRATING_SCHEDULE_EXECUTION | admin | no | NOT_STARTED |
| BN_UPRATING_EXECUTE_BATCH | admin | yes | NOT_STARTED |
| BN_UPRATING_RETRY_FAILED | admin | no | NOT_STARTED |
| BN_UPRATING_RECONCILE_RUN | decide | no | NOT_STARTED |
| BN_UPRATING_ROLLBACK_ELIGIBLE | admin | yes | NOT_STARTED |
| BN_UPRATING_CLOSE_RUN | decide | no | NOT_STARTED |

Supporting governed lifecycle operations delivered inside the same boundaries
(not new canonical commands): `BN_UPRATING_UPDATE_POLICY_VERSION`,
`BN_UPRATING_ACTIVATE_POLICY_VERSION`, `BN_UPRATING_SUPERSEDE_POLICY_VERSION`,
`BN_UPRATING_RETIRE_POLICY_VERSION`, `BN_UPRATING_UPDATE_RUN`,
`BN_UPRATING_PARAMETERISE_RUN`.

## Epic 0 delivered surface

- Tables: `bn_uprating_policy`, `bn_uprating_policy_version`, `bn_uprating_policy_tier`,
  `bn_uprating_policy_validation`, `bn_uprating_policy_approval`, `bn_uprating_policy_event`,
  `bn_uprating_command_audit`, `bn_uprating_command_idempotency`, `bn_uprating_index_series`,
  `bn_uprating_index_observation`, `bn_uprating_reference_value` (RLS on, service-role grants).
- Reads: `bn_uprating_policy_list_v1`, `bn_uprating_policy_detail_v1`,
  `bn_uprating_policy_approval_queue_v1`, `bn_uprating_reference_data_v1`,
  `bn_uprating_policy_actions_v1`, `bn_uprating_policy_validation_readiness_v1`,
  `bn_uprating_policy_approval_readiness_v1`.
- Frontend: `/bn/uprating` policy catalogue workspace behind
  `BnModuleRouteGate moduleCode="bn_uprating" requiredAction="view"`.

## Epic 1 delivered surface (pre-execution only)

- Tables: `bn_uprating_run`, `bn_uprating_run_snapshot`, `bn_uprating_run_snapshot_item`,
  `bn_uprating_exception_policy`, `bn_uprating_run_exception`,
  `bn_uprating_run_exception_history`, `bn_uprating_simulation`,
  `bn_uprating_simulation_item`, `bn_uprating_run_event` (RLS on, service-role grants,
  no browser table access).
- Boundary: `bn_uprating_run_command_v1` — create, update, parameterise (freezes policy
  provenance including tiers and index observations), build population, resolve exception,
  simulate. Permission-gated, idempotent, optimistic-concurrency protected, fully audited.
- Reads: `bn_uprating_run_list_v1`, `bn_uprating_run_detail_v1`,
  `bn_uprating_run_population_v1`, `bn_uprating_run_exceptions_v1`,
  `bn_uprating_simulation_result_v1`, `bn_uprating_run_actions_v1`.
- Helpers: `_bn_uprating_calc_item` (deterministic per-award calculation with trace),
  `_bn_uprating_round_minor` (NONE / NEAREST_1 / NEAREST_10 / NEAREST_100 / DOWN / UP /
  HALF_EVEN), `_bn_uprating_run_event`.
- Frontend: `/bn/uprating` → "Runs & simulation" tab — run register, create-run dialog,
  run header with backend-driven actions, population, exceptions, simulation and timeline
  tabs, and the exception-resolution dialog.

### Epic 1 governance guarantees

- **Pre-execution**: no award, entitlement, payment schedule or communication is written.
- **Immutable snapshots**: rebuilding creates a new snapshot version and supersedes the
  previous one; snapshot items record the observed source row version.
- **Fail-closed exclusions**: open mortality events, unresolved appeals, active suspensions
  and operational risk restrictions exclude or flag an award using a yes/no status only —
  no confidential detail crosses the boundary, and only the last four digits of a national
  identifier are ever exposed.
- **No universal override**: `bn_uprating_exception_policy` defines the permitted
  resolutions per exception code; a justification is mandatory and history is retained.
- **Deterministic simulation**: input fingerprint over snapshot plus frozen policy
  parameters; any population or exception change marks the current simulation `STALE`.
  `FORMULA_DRIVEN` and `MANUAL_IMPORT` policy types are refused with `E_NOT_SIMULATABLE`.

## Certification evidence

- Epic 0 suite: `src/__tests__/bn/uprating/upratingEpic0Foundation.test.ts` — 59 tests green.
- Epic 1 suite: `src/__tests__/bn/uprating/upratingEpic1Run.test.ts` — 26 tests green.
- Regression: `src/__tests__/bn` — 140 files (139 passed / 1 skipped); 2798 tests: 2783 passed, 1 skipped, 14 todo, 0 failed.
- Typecheck: CLEAN (`tsgo -p tsconfig.app.json`, no errors).
- Canonical catalogue boundary: 17 commands total, 9 implemented (Epic 0 = 5, Epic 1 = 4), 8 NOT_STARTED (Epic 2+).

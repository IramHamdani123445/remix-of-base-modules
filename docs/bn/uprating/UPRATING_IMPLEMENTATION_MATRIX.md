# BN Uprating — Implementation Matrix

Canonical catalogue: 17 commands (`src/types/bn/uprating/upratingCanonicalCommands.ts`).
Governed boundaries: `public.bn_uprating_policy_command_v1` (policy),
`public.bn_uprating_run_command_v1` (runs).

## Epic status

| Epic | Scope | Status |
| --- | --- | --- |
| Epic 0 | Module foundation, policy catalogue, version governance | **COMPLETE — CERTIFIED** |
| Epic 1 | Run creation, population snapshot, exceptions, simulation | **COMPLETE — CERTIFIED** |
| Epic 2 | Run approval and execution scheduling | **COMPLETE — CERTIFIED** |
| Epic 3 | Batch execution and retry | **COMPLETE — CERTIFIED** |
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
| BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL | decide | no | IMPLEMENTED (Epic 2) |
| BN_UPRATING_APPROVE_RUN | admin | yes | IMPLEMENTED (Epic 2) |
| BN_UPRATING_SCHEDULE_EXECUTION | admin | no | IMPLEMENTED (Epic 2) |
| BN_UPRATING_EXECUTE_BATCH | admin | yes | IMPLEMENTED (Epic 3) |
| BN_UPRATING_RETRY_FAILED | admin | no | IMPLEMENTED (Epic 3) |
| BN_UPRATING_RECONCILE_RUN | decide | no | NOT_STARTED |
| BN_UPRATING_ROLLBACK_ELIGIBLE | admin | yes | NOT_STARTED |
| BN_UPRATING_CLOSE_RUN | decide | no | NOT_STARTED |

Supporting governed lifecycle operations delivered inside the same boundaries
(not new canonical commands): `BN_UPRATING_UPDATE_POLICY_VERSION`,
`BN_UPRATING_ACTIVATE_POLICY_VERSION`, `BN_UPRATING_SUPERSEDE_POLICY_VERSION`,
`BN_UPRATING_RETIRE_POLICY_VERSION`, `BN_UPRATING_UPDATE_RUN`,
`BN_UPRATING_PARAMETERISE_RUN`, `BN_UPRATING_RESCHEDULE_EXECUTION`,
`BN_UPRATING_CANCEL_EXECUTION_SCHEDULE`.

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

## Epic 2 delivered surface (approval and scheduling only)

- Tables: `bn_uprating_run_approval_package`, `bn_uprating_run_approval`,
  `bn_uprating_execution_schedule` (RLS on, service-role grants, no browser table access).
- Boundary: `bn_uprating_run_command_v1` extended with submit-for-approval, approve /
  return-for-rework, schedule, reschedule and cancel-schedule. Permission-gated, idempotent,
  optimistic-concurrency protected, drift-detecting and fully audited.
- Reads: `bn_uprating_run_approval_readiness_v1`, `bn_uprating_run_approval_v1`,
  `bn_uprating_schedule_readiness_v1`, `bn_uprating_run_approval_queue_v1`,
  `bn_uprating_scheduled_run_queue_v1`, and Epic 2 actions in `bn_uprating_run_actions_v1`.
- Frontend: submit / decision / schedule dialogs, run approval and execution-schedule
  sections, and the approval + scheduling queues on `/bn/uprating`.

### Epic 2 governance guarantees

- **Nothing executes**: no award, entitlement, payment schedule or communication is written;
  an approved run remains `APPROVED` and scheduling only records a plan.
- **Immutable package**: the snapshot, simulation, fingerprint and financial totals are frozen
  at submission; a new cycle creates a new package and supersedes the previous one.
- **Independent approval**: neither the submitter nor the officer who prepared the simulation
  may approve; a decision reason and justification are mandatory.
- **Drift protection**: approval is refused (`E_APPROVAL_STALE`) if the run, snapshot,
  simulation or input fingerprint has moved since submission.
- **Governed scheduling**: time zone, execution window, batch size, concurrency and minimum
  lead time are validated against `SCHEDULE_CONFIG`; rescheduling supersedes rather than edits.

## Epic 3 delivered surface (batch execution and retry)

- Tables: `bn_uprating_execution_session`, `bn_uprating_execution_batch`,
  `bn_uprating_execution_item` (RLS on, service-role grants, no browser table access).
- Boundary: `bn_uprating_run_command_v1` extended with `BN_UPRATING_EXECUTE_BATCH` and
  `BN_UPRATING_RETRY_FAILED`; the Epic 0–2 boundary is preserved as
  `_bn_uprating_run_command_epic2` and delegated to unchanged.
- Award target boundary: `_bn_uprating_apply_award` is the only writer to `bn_award`; it locks
  the item and award, verifies row version, award status, base amount and payment holds, closes
  the previous `bn_award_rate_history` row and writes the new `UPRATING` rate.
- Helpers: `_bn_uprating_execute_batch_items`, `_bn_uprating_rollup_session`,
  `_bn_uprating_execution_readiness`, `_bn_uprating_execution_config`.
- Reads: `bn_uprating_execution_readiness_v1`, `bn_uprating_run_execution_v1`,
  `bn_uprating_execution_items_v1`, `bn_uprating_execution_queue_v1`, plus Epic 3 actions in
  `bn_uprating_run_actions_v1`.
- Frontend: `BnUpratingExecutionSection` workbench, `BnUpratingExecuteBatchDialog`,
  `BnUpratingRetryFailedDialog` and the `BnUpratingExecutionQueue` tab on `/bn/uprating`.

### Epic 3 governance guarantees

- **Executes only what was approved**: the plan is built from the frozen simulation of the current
  approved package; the applied amount is the approved amount and nothing is recalculated.
- **Deterministic batching**: items are ordered by award reference and simulation item and sliced
  by the scheduled batch size, so the same package always produces the same batches.
- **No double application**: an item already applied in the session is skipped, retries supersede
  the prior attempt and carry the same approved figures forward.
- **Fail-closed drift handling**: `AWARD_NOT_FOUND`, `STALE_ROW_VERSION`, `AWARD_STATUS_CHANGED`
  and `BASE_AMOUNT_MISMATCH` are permanent failures; only `AWARD_PAYMENT_HELD` and
  `TRANSIENT_ERROR` are retryable, within `MAX_RETRY_ATTEMPTS`.
- **Independent execution**: the officer who submitted or simulated the run cannot execute it;
  execution is refused outside the approved schedule window or if the package has drifted.
- **Nothing else moves**: no payment, entitlement or communication is written by this epic.

## Certification evidence

- Epic 0 suite: `src/__tests__/bn/uprating/upratingEpic0Foundation.test.ts` — 59 tests green.
- Epic 1 suite: `src/__tests__/bn/uprating/upratingEpic1Run.test.ts` — 26 tests green.
- Epic 2 suite: `src/__tests__/bn/uprating/upratingEpic2Approval.test.ts` — 84 tests green.
- Epic 3 suite: `src/__tests__/bn/uprating/upratingEpic3Execution.test.ts` — green.
- Typecheck: CLEAN (`tsgo -p tsconfig.app.json`, no errors).
- Canonical catalogue boundary: 17 commands total, 14 implemented (Epic 0 = 5, Epic 1 = 4,
  Epic 2 = 3, Epic 3 = 2), 3 NOT_STARTED (Epic 4–5).


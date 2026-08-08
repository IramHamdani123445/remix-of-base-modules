# BN Uprating — Implementation Matrix

Canonical catalogue: 17 commands (`src/types/bn/uprating/upratingCanonicalCommands.ts`).
Governed boundary: `public.bn_uprating_policy_command_v1`.

## Epic status

| Epic | Scope | Status |
| --- | --- | --- |
| Epic 0 | Module foundation, policy catalogue, version governance | **COMPLETE — CERTIFIED** |
| Epic 1 | Run creation, population snapshot, simulation | NOT_STARTED |
| Epic 2+ | Execution, schedules, communications, reconciliation, rollback | NOT_STARTED |

## Canonical command status

| Command | Capability | Maker-checker | Status |
| --- | --- | --- | --- |
| BN_UPRATING_CREATE_POLICY | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_CREATE_POLICY_VERSION | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_VALIDATE_POLICY | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL | write | no | IMPLEMENTED (Epic 0) |
| BN_UPRATING_APPROVE_POLICY | admin | yes | IMPLEMENTED (Epic 0) |
| BN_UPRATING_CREATE_RUN | write | no | NOT_STARTED |
| BN_UPRATING_BUILD_POPULATION | decide | no | NOT_STARTED |
| BN_UPRATING_SIMULATE | decide | no | NOT_STARTED |
| BN_UPRATING_RESOLVE_EXCEPTION | decide | no | NOT_STARTED |
| BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL | decide | no | NOT_STARTED |
| BN_UPRATING_APPROVE_RUN | admin | yes | NOT_STARTED |
| BN_UPRATING_SCHEDULE_EXECUTION | admin | no | NOT_STARTED |
| BN_UPRATING_EXECUTE_BATCH | admin | yes | NOT_STARTED |
| BN_UPRATING_RETRY_FAILED | admin | no | NOT_STARTED |
| BN_UPRATING_RECONCILE_RUN | decide | no | NOT_STARTED |
| BN_UPRATING_ROLLBACK_ELIGIBLE | admin | yes | NOT_STARTED |
| BN_UPRATING_CLOSE_RUN | decide | no | NOT_STARTED |

Supporting governed lifecycle operations delivered inside the same boundary
(not new canonical commands): `BN_UPRATING_UPDATE_POLICY_VERSION`,
`BN_UPRATING_ACTIVATE_POLICY_VERSION`, `BN_UPRATING_SUPERSEDE_POLICY_VERSION`,
`BN_UPRATING_RETIRE_POLICY_VERSION`.

## Epic 0 delivered surface

- Tables: `bn_uprating_policy`, `bn_uprating_policy_version`, `bn_uprating_policy_tier`,
  `bn_uprating_policy_validation`, `bn_uprating_policy_approval`, `bn_uprating_policy_event`,
  `bn_uprating_command_audit`, `bn_uprating_command_idempotency`, `bn_uprating_index_series`,
  `bn_uprating_index_observation`, `bn_uprating_reference_value` (RLS on, service-role grants).
- Reads: `bn_uprating_policy_list_v1`, `bn_uprating_policy_detail_v1`,
  `bn_uprating_policy_approval_queue_v1`, `bn_uprating_reference_data_v1`,
  `bn_uprating_policy_actions_v1`, `bn_uprating_policy_validation_readiness_v1`,
  `bn_uprating_policy_approval_readiness_v1`.
- Frontend: `/bn/uprating` operational workspace (register, policy-type-aware version editor,
  validation findings, governance timeline, approval queue, decision dialogs) behind
  `BnModuleRouteGate moduleCode="bn_uprating" requiredAction="view"`.

## Certification evidence

- Suite: `src/__tests__/bn/uprating/upratingEpic0Foundation.test.ts` — 59 tests green.
- Regression: `src/__tests__/bn` — 2757 passed / 1 skipped / 14 todo.
- Typecheck: clean (`tsconfig.app.json`).
- Gates proven: canonical alignment, lifecycle state machine, single governed boundary,
  capability and rollout enforcement, optimistic concurrency, audit + idempotent replay,
  draft immutability, validation coverage for all seven policy types, tier integrity,
  effective-period conflict detection, independent approval with justification,
  effective-dated succession, backend-driven action availability, browser table-access
  boundary and scope containment (no run/simulation/execution concepts).

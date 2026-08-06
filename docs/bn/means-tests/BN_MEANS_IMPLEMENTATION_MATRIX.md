# BN Means-Test Assessments — Implementation Matrix (MT0)

Module: `bn_means_tests` · rollout_state: `internal_pilot` · actions_enabled: `false`
Classification: **IMPLEMENTATION_IN_PROGRESS** · Activation: **DARK_LAUNCHED** · External UAT: **DEFERRED**

## 1. Authoritative contract

The repository carried two competing contracts. The audit result is:

| Artefact | Verdict |
| --- | --- |
| `src/types/bn/meansTests/meansCommands.ts` (18 `BN_MEANS_*`) | **AUTHORITATIVE** |
| `src/types/bn/meansTests/meansStateMachine.ts` (full lifecycle) | **AUTHORITATIVE** |
| `src/types/bn/meansTests/meansFactContract.ts` (`means.*` bundle) | **AUTHORITATIVE** |
| `src/types/bn/meansTests/meansTestCommands.ts` (11 `BN_MT_*`) | Superseded — retained only as a reconciliation source |
| `src/types/bn/meansTests/meansTestStateMachine.ts` (pass/fail/appeal) | Superseded — no database implementation |

Evidence supporting the 18-command model as authoritative:

- `benefitsCapabilityRegistry.ts` maps all 18 `BN_MEANS_*` commands to granular
  capabilities (`verify`, `adjust_request`, `adjust_approve`, `approve`, `reassess`, `config`).
- The eligibility fact contract publishes from the assessment lifecycle
  (`ACTIVE` / `REASSESSMENT_DUE`), not from a pass/fail outcome record.
- No migration, edge function or route implemented any `BN_MT_*` command;
  there were **no** `bn_means_*` tables before this work, so there is no
  legacy data to preserve.
- No direct browser mutation of Means-Test tables existed.

## 2. Legacy command disposition

Machine-readable source: `src/types/bn/meansTests/meansLegacyReconciliation.ts`
(contract-tested for exhaustiveness).

| Legacy command | Disposition | Canonical / target |
| --- | --- | --- |
| `BN_MT_START` | ALIASED_TO_CANONICAL_COMMAND | `BN_MEANS_CREATE_ASSESSMENT` |
| `BN_MT_ATTACH_EVIDENCE` | ALIASED_TO_CANONICAL_COMMAND | `BN_MEANS_ATTACH_EVIDENCE` |
| `BN_MT_ASSESS` | ALIASED_TO_CANONICAL_COMMAND | `BN_MEANS_CALCULATE` |
| `BN_MT_PASS` | ALIASED_TO_CANONICAL_COMMAND | `BN_MEANS_APPROVE` |
| `BN_MT_FAIL` | ALIASED_TO_CANONICAL_COMMAND | `BN_MEANS_REJECT` |
| `BN_MT_LINK_APPEAL` | REPLACED_BY_GOVERNED_HANDOFF | `bn_appeals` via `bn_cross_module_handoff` |
| `BN_MT_APPLY_APPEAL_OVERTURN` | REPLACED_BY_GOVERNED_HANDOFF | `bn_appeals` → successor via `BN_MEANS_SUPERSEDE` |
| `BN_MT_ADD_LATE_EVIDENCE` | RETIRED_DUPLICATE | — |
| `BN_MT_RERUN_ELIGIBILITY` | ALIASED_TO_CANONICAL_COMMAND | `BN_MEANS_ACTIVATE` (publishes facts, requests rerun) |
| `BN_MT_CREATE_AWARD_FROM_RERUN` | REPLACED_BY_GOVERNED_HANDOFF | `bn_awards` — **direct award creation prohibited** |
| `BN_MT_CLOSE` | ALIASED_TO_CANONICAL_COMMAND | `BN_MEANS_CLOSE` |

## 3. Canonical command matrix

Legend for *Implementation*: `DONE` = database command + typed service shipped;
`PENDING` = boundary reserved, handler not yet implemented (raises
`E_COMMAND_NOT_IMPLEMENTED`).

| Business function | Canonical command | Legacy | Impl. | Database operation | Permission | Source state | Target state | Row version | Idempotency | Maker-checker | Audit event | Communication | External boundary | UI surface | Test evidence | Remaining work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create assessment | `BN_MEANS_CREATE_ASSESSMENT` | `BN_MT_START` | DONE | insert `bn_means_assessment` | `write` | — | `DRAFT` | seeded at 1 | yes | no | `CREATED` | — | — | Intake workspace | `meansIntakeContract` | — |
| Add household member | `BN_MEANS_ADD_HOUSEHOLD_MEMBER` | — | DONE | insert `bn_means_household_member` | `write` | editable | unchanged | bumped | yes | no | `FACT_RECORDED` | — | — | Household section | `meansIntakeContract` | — |
| Add income | `BN_MEANS_ADD_INCOME` | — | DONE | insert `bn_means_income_fact` (annualised) | `write` | editable | unchanged | bumped | yes | no | `FACT_RECORDED` | — | — | Income section | `meansNormalisation` | — |
| Add asset | `BN_MEANS_ADD_ASSET` | — | DONE | insert `bn_means_asset_fact` | `write` | editable | unchanged | bumped | yes | no | `FACT_RECORDED` | — | — | Assets section | `meansIntakeContract` | — |
| Claim deduction | `BN_MEANS_ADD_DEDUCTION` | — | DONE | insert `bn_means_deduction_fact` (`CLAIMED`) | `write` | editable | unchanged | bumped | yes | no | `FACT_RECORDED` | — | — | Deductions section | `meansIntakeContract` | — |
| Attach evidence | `BN_MEANS_ATTACH_EVIDENCE` | `BN_MT_ATTACH_EVIDENCE` | DONE | insert `bn_means_evidence` (DMS ref only) | `write` | pre-approval | unchanged | bumped | yes | no | `EVIDENCE_ATTACHED` | — | DMS | Evidence section | `meansIntakeContract` | — |
| Submit | `BN_MEANS_SUBMIT` | — | DONE | freeze `bn_means_assessment_version`, status → `SUBMITTED` | `write` | `DRAFT`/`INFORMATION_PENDING` | `SUBMITTED` | bumped | yes | records maker | `SUBMITTED` | `MEANS_ASSESSMENT_SUBMITTED` intent | Comm Hub façade | Submission step | `meansIntakeContract` | — |
| Verify facts | `BN_MEANS_VERIFY_INFORMATION` | — | DELIVERED (MT6) | insert `bn_means_verification` | `verify` | `SUBMITTED`/`VERIFICATION_PENDING` | `VERIFICATION_PENDING`/`CALCULATED` | bumped | yes | no | `VERIFICATION_*` | — | — | Verification panel | — | MT6 |
| Calculate | `BN_MEANS_CALCULATE` | `BN_MT_ASSESS` | DELIVERED (MT6) | insert `bn_means_calculation` + lines | `decide` | verified | `CALCULATED` | bumped | yes | no | `CALCULATED` | — | — | Calculation trace | — | MT6 |
| Request adjustment | `BN_MEANS_REQUEST_ADJUSTMENT` | — | PENDING | insert `bn_means_adjustment` | `adjust_request` | `CALCULATED`/`REVIEW_PENDING` | `REVIEW_PENDING` | bumped | yes | records maker | `ADJUSTMENT_REQUESTED` | — | — | Adjustment dialog | — | MT7 |
| Approve adjustment | `BN_MEANS_APPROVE_ADJUSTMENT` | — | PENDING | update `bn_means_adjustment` | `adjust_approve` | `REVIEW_PENDING` | `CALCULATED` | bumped | yes | **required**, self-approval denied | `ADJUSTMENT_APPROVED` | — | — | Approval dialog | — | MT7 |
| Approve assessment | `BN_MEANS_APPROVE` | `BN_MT_PASS` | PENDING | insert `bn_means_approval` | `approve` | `CALCULATED`/`APPROVAL_PENDING` | `APPROVED` | bumped | yes | **required**, self-approval denied | `APPROVED` | decision notice | Comm Hub façade | Approval dialog | — | MT7 |
| Reject assessment | `BN_MEANS_REJECT` | `BN_MT_FAIL` | PENDING | insert `bn_means_approval` | `approve` | `CALCULATED`/`APPROVAL_PENDING` | `REJECTED` | bumped | yes | **required**, self-approval denied | `REJECTED` | decision notice | Comm Hub façade | Approval dialog | — | MT7 |
| Activate | `BN_MEANS_ACTIVATE` | `BN_MT_RERUN_ELIGIBILITY` | PENDING | insert `bn_means_fact_publication` | `approve` | `APPROVED` | `ACTIVE` | bumped | yes | no | `ACTIVATED`, `FACT_PUBLISHED` | — | Eligibility engine (rerun request) | Activation action | — | MT8 |
| Schedule reassessment | `BN_MEANS_SCHEDULE_REASSESSMENT` | — | PENDING | insert `bn_means_reassessment_schedule` | `reassess` | `ACTIVE`/`REASSESSMENT_DUE` | unchanged | bumped | yes | no | `REASSESSMENT_SCHEDULED` | reminder intent | Comm Hub façade | Lifecycle panel | — | MT9 |
| Record change of circumstance | `BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE` | — | PENDING | insert `bn_means_circumstance_event` | `write` | `ACTIVE`/`REASSESSMENT_DUE` | unchanged | bumped | yes | no | `CHANGE_OF_CIRCUMSTANCE_RECORDED` | — | Risk signal via `bn_cross_module_handoff` | Lifecycle panel | — | MT9 |
| Supersede | `BN_MEANS_SUPERSEDE` | `BN_MT_APPLY_APPEAL_OVERTURN` | PENDING | successor assessment + link | `approve` | `ACTIVE`/`EXPIRED`/`REASSESSMENT_DUE` | `SUPERSEDED` | bumped | yes | no | `SUPERSEDED` | — | Eligibility rerun | Lifecycle panel | — | MT9 |
| Close | `BN_MEANS_CLOSE` | `BN_MT_CLOSE` | PENDING | status → `CLOSED` | `approve` | non-terminal | `CLOSED` | bumped | yes | no | `CLOSED` | — | — | Lifecycle panel | — | MT9 |

## 4. Delivered infrastructure

- **Domain (MT1)** — 23 tables: policy, policy version, category catalogue, assessment,
  frozen assessment version, household / income / asset / deduction facts, evidence,
  information request, verification, calculation and calculation line, adjustment,
  approval, fact publication, reassessment schedule, circumstance event,
  communication intent, event log, idempotency, maker register.
  Monetary values use `numeric(18,2)` (never binary floating point). No statutory
  values are seeded.
- **Boundary (MT2)** — `bn_means_execute_command_v1` (SECURITY DEFINER) plus
  `bn_means_check_actor_permission`, `_bn_means_action_for_command`,
  `_bn_means_maker_source`, `_bn_means_can_transition`, `_bn_means_annualise`,
  `_bn_means_event`. Browser roles hold **SELECT only** on every `bn_means_*` table.
- **Queries** — `bn_means_work_queue_v1`, `bn_means_assessment_detail_v1`,
  `bn_means_available_actions_v1`, `bn_means_benefit360_summary_v1`.
  Denied and failed reads return explicit statuses, never an empty success.
- **Services** — `src/services/bn/meansTests/meansCommandService.ts` and
  `meansQueryService.ts`.

## 5. Prohibitions in force

- No direct award creation or amendment from Means Tests.
- No second eligibility engine — activation publishes the canonical `means.*` bundle.
- No Risk/Fraud case creation — only governed handoffs.
- No document bytes, credentials or unrestricted storage paths in Means-Test tables.
- No direct browser mutation of `bn_means_*` tables.


## MT6 delivery record (verification and deterministic calculation)

**Classification:** `IMPLEMENTATION_IN_PROGRESS`, `development_access = ENABLED`
(`rollout_state = internal_pilot`, module actions enabled for development actors only).

### Verification
- `BN_MEANS_VERIFY_INFORMATION` applies to an individual fact of the frozen
  submitted version (`HOUSEHOLD`, `INCOME`, `ASSET`, `DEDUCTION`, `EVIDENCE`).
- Outcomes: `VERIFIED`, `REJECTED`, `CLARIFICATION_REQUIRED`, `NOT_APPLICABLE`,
  each carrying reason code, note, actor and timestamp.
- Declared values are never mutated by verification.

### Deterministic calculation
- `_bn_means_round` performs policy-driven decimal rounding
  (`HALF_UP`, `HALF_EVEN`, `DOWN`, …); no floating-point arithmetic.
- `_bn_means_readiness` is the single source of readiness truth:
  missing verifications, rejected facts, outstanding clarifications,
  policy configuration issues and currency mismatches.
- `BN_MEANS_CALCULATE` is refused unless readiness passes; it writes an
  immutable `bn_means_calculation` with `bn_means_calculation_line`
  explanation lines and a deterministic `input_hash`.
- `bn_means_available_actions_v1` mirrors the guard and returns
  `NOT_READY_FOR_CALCULATION` rather than allowing a doomed action.

### Surfaces
- `BnMeansVerificationPanel` — per-fact verification workspace.
- `BnMeansCalculationPanel` — backend readiness verdict, blockers, and the
  immutable calculation trace. React never recomputes readiness.
- Benefit 360 remains read-only: calculation status, provisional result,
  calculation date and pending-approval indicator only — no household,
  income, asset, deduction or verification-note detail.

### Evidence
`src/__tests__/bn/means-tests/meansMt6Surfaces.test.tsx` plus the MT4/MT5
suite — 40/40 passing.

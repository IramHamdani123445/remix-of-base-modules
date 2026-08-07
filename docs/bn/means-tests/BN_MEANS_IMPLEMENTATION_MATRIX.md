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
| Request adjustment | `BN_MEANS_REQUEST_ADJUSTMENT` | — | DELIVERED (MT7) | insert `bn_means_adjustment` | `adjust_request` | `CALCULATED`/`REVIEW_PENDING` | `REVIEW_PENDING` | bumped | yes | records maker | `ADJUSTMENT_REQUESTED` | — | — | Adjustment dialog | — | MT7 |
| Approve adjustment | `BN_MEANS_APPROVE_ADJUSTMENT` | — | DELIVERED (MT7) | update `bn_means_adjustment` | `adjust_approve` | `REVIEW_PENDING` | `CALCULATED` | bumped | yes | **required**, self-approval denied | `ADJUSTMENT_APPROVED` | — | — | Approval dialog | — | MT7 |
| Approve assessment | `BN_MEANS_APPROVE` | `BN_MT_PASS` | DELIVERED (MT7) | insert `bn_means_approval` | `approve` | `CALCULATED`/`APPROVAL_PENDING` | `APPROVED` | bumped | yes | **required**, self-approval denied | `APPROVED` | decision notice | Comm Hub façade | Approval dialog | — | MT7 |
| Reject assessment | `BN_MEANS_REJECT` | `BN_MT_FAIL` | DELIVERED (MT7) | insert `bn_means_approval` | `approve` | `CALCULATED`/`APPROVAL_PENDING` | `REJECTED` | bumped | yes | **required**, self-approval denied | `REJECTED` | decision notice | Comm Hub façade | Approval dialog | — | MT7 |
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


## MT7 delivery record (adjustments and independent approval)

### Adjustment model
- `bn_means_adjustment` is purely additive. A frozen assessment version, a
  declared fact, a verification record and an existing calculation are never
  rewritten. Every adjustment carries the target kind, target reference,
  original value, proposed treatment, reason code, structured justification,
  supporting evidence, expected financial effect and the fingerprint of the
  calculation it was raised against.
- `BN_MEANS_REQUEST_ADJUSTMENT` is refused unless a current calculation exists
  and is the latest for the frozen version (`CALCULATION_NOT_LATEST`,
  `NO_CURRENT_CALCULATION`). The assessment moves to `REVIEW_PENDING` and is
  reported as "in review — adjustment outstanding".

### Decision and recalculation
- `BN_MEANS_APPROVE_ADJUSTMENT` requires an officer other than the requester
  (`SELF_APPROVAL_DENIED`) and the adjustment's own row version.
- Approval runs `_bn_means_recalculate`, which applies the approved overlay to
  the previous calculation's facts and policy parameters and writes a **new**
  calculation with `supersedes_calculation_id`, `triggering_adjustment_id` and a
  fresh `calculation_hash`. The prior calculation remains authoritative until a
  successful recalculation exists.
- A failed application leaves the adjustment `APPROVED_PENDING_APPLICATION` with
  `application_error` shown, and approval of the assessment is blocked with
  `ADJUSTMENT_APPLICATION_PENDING`.
- Rejection records the reason and leaves the original calculation standing.

### Final approval
- `BN_MEANS_APPROVE` / `BN_MEANS_REJECT` attach to exactly one calculation
  fingerprint, require complete verification, no outstanding adjustment, an
  effective policy version and an independent checker.
- Approval does **not** activate entitlement. Activation and publication are
  decided by Eligibility (MT8). Approved assessments read
  "Approved — not yet active".
- Rejected assessments are retained in full with their evidence and decision
  history.

### Secured reads
- `bn_means_adjustments_v1` — adjustment register with requester/decider identity.
- `bn_means_approval_context_v1` — every approval figure; React recomputes nothing.
- `bn_means_queues_v1` — the five MT7 work queues.

### Surfaces
- `BnMeansAdjustmentsPanel` — register, request form and independent decision.
- `BnMeansApprovalPanel` — approval context, blockers and decision history.
- Means-Tests page — adjustment and approval queues.
- Benefit 360 — adjustment-pending, approved-not-active and rejected posture only;
  no household, income, asset or deduction detail.

### Evidence
`src/__tests__/bn/means-tests/meansMt7Surfaces.test.tsx` plus the MT4/MT5/MT6
suites — 54/54 passing.

---

## Means-Test Epic register (product delivery track)

| Epic | Scope | Status |
| --- | --- | --- |
| Epic 0 | Module entry, left navigation, admin permissions, landing experience, shared UX controls, field contract, reference-data boundary | **COMPLETE** |
| Epic 1 | Assessment initiation (guided wizard, governed person search, policy resolution, single backend initiation check) | **COMPLETE** |
| Epic 2 | Intake workspace redesign and household composition (context confirmation, household section, backend-owned readiness, duplicate detection) | **COMPLETE** |
| Epic 3 | Income assessment (member-linked income capture, governed categories and frequencies, backend annualisation, employer/contribution reference, explicit no-income declarations, backend-owned income readiness) | **COMPLETE** |
| Epic 4 | Asset assessment (owner-linked asset declaration, policy-version-controlled categories, category-driven capture, ownership and valuation context, possible-disregard flagging, explicit no-asset declarations, backend-owned asset readiness) | **COMPLETE** |

### Epic 4 — completion record

Classification: `IMPLEMENTATION_IN_PROGRESS` ·
`development_access = ENABLED` ·
`production_activation = NOT_STARTED` ·
`external_uat = NOT_STARTED`.

**Journey delivered** — completed Income → select household owner → select
asset category → capture ownership → capture valuation → record source and
effective context → flag potential disregard where applicable → resolve
duplicate or conflicting assets → declare no assets where applicable → mark
Assets complete.

**Assets section** — `BnMeansAssetSection`, `BnMeansAssetDialog` and
`BnMeansNoAssetsDialog` replace the raw fact form, reusing the visual and
interaction pattern established for Household and Income. Every asset carries
an ownership context: the owner is selected from the assessment household
(household-level assets only where policy allows it), with ownership type and
share recorded explicitly.

**Category is policy-governed** — `bn_means_asset_reference_v1` serves
categories, ownership types, valuation bases, information sources, disregard
reasons and no-asset reasons from the effective policy version
(`bn_means_policy_version.asset_rules`). Nothing is typed as a code. Form
behaviour is category-driven: institution and account reference for cash and
bank balances, address for property, registration for vehicles, business name
for business interests, and a free description where the category requires one.
The valuation basis is a choice only where the category offers one; otherwise
it is fixed by policy and shown read-only.

**Derived values are backend-owned** — the UI posts valuation amount,
currency, ownership share and basis only. The attributable value stored on the
record is derived by the assessment engine; the dialog shows a labelled
preview and never posts it.

**Disregards are flagged, never decided** — the officer may flag an asset as a
possible disregard with a governed reason. Whether a disregard applies is
decided by policy at calculation, and no disregard decision or disregarded
amount is ever posted from the browser.

**No assets is explicit** — `bn_means_no_asset_declaration` records a
per-member declaration with reason, period and provenance. A member with no
record is reported as *missing a declaration*, never as zero assets.

**Backend-owned readiness** — `bn_means_asset_readiness_v1` returns
completeness, blockers and warnings (duplicates, conflicts with a no-assets
declaration, periods outside household membership, missing declarations) and
blocks asset completion until the Income section is complete. "Mark assets
complete" is enabled only when the backend reports the section complete; a
failed or denied readiness read renders *Unavailable*, never *Complete*.

**Supporting operations added** — `BN_MEANS_CORRECT_ASSET` (versioned
replacement), `BN_MEANS_VOID_ASSET`, `BN_MEANS_DECLARE_NO_ASSETS`,
`BN_MEANS_WITHDRAW_NO_ASSETS` and `BN_MEANS_MARK_ASSETS_COMPLETE`. The
canonical business catalogue remains 21 commands; the catalogue now registers
32 entries in total.

**Epics 0–3 preserved** — no household, income, initiation or foundation
behaviour was changed; the only workspace edits replace the assets placeholder
and give the assets stage a backend-derived state.

**Evidence** — `src/__tests__/bn/means-tests/meansAssets.test.ts` (30 cases).
Means-Test suites: 213/213 passing.


### Epic 3 — completion record

Classification: `IMPLEMENTATION_IN_PROGRESS` ·
`development_access = ENABLED` ·
`production_activation = NOT_STARTED` ·
`external_uat = NOT_STARTED`.

**Journey delivered** — completed household → select household member →
select income category → identify income source → capture amount and
frequency → derive annualised value → validate dates and context → resolve
duplicates and conflicts → mark Income section complete.

**Income section** — `BnMeansIncomeSection`, `BnMeansIncomeDialog` and
`BnMeansNoIncomeDialog` replace the raw fact form. Income is always linked to
a household member of *this* assessment (household-level income only where
policy allows it). Category, frequency, basis and information source come from
`bn_means_income_reference_v1`; nothing is typed as a code. Form behaviour is
category-driven: employer lookup for employment, source name for pension and
other categories, gross/net choice only where policy offers one, and one-off
frequency only where the category permits it.

**Annualisation is backend-owned** — the UI posts declared amount, frequency
and basis only; `_bn_means_annualise` derives `normalised_annual_amount` and
the annualisation method. React never multiplies an amount.

**Reference integration** — `bn_means_employer_search_v1` (over `er_master`)
and `bn_means_income_context_v1` (contribution wages from `ip_wages`, benefit
sources reported as `NOT_IMPLEMENTED`) supply comparison context. Reference
data is offered as a starting point and never silently overwrites a
declaration; internal identifiers stay masked.

**No income is explicit** — `bn_means_no_income_declaration` records a
per-member declaration with reason and provenance. A member with no record is
reported as *missing a declaration*, never as zero income.

**Backend-owned readiness** — `bn_means_income_readiness_v1` returns
completeness, blockers and warnings (duplicates, overlaps, missing
declarations). "Mark income complete" is enabled only when the backend reports
the section complete; a failed or denied readiness read renders *Unavailable*,
never *Complete*.

**Supporting operations added** — `BN_MEANS_CORRECT_INCOME` (versioned
replacement), `BN_MEANS_VOID_INCOME`, `BN_MEANS_DECLARE_NO_INCOME`,
`BN_MEANS_WITHDRAW_NO_INCOME`, `BN_MEANS_MARK_HOUSEHOLD_COMPLETE` and
`BN_MEANS_MARK_INCOME_COMPLETE`. The canonical business catalogue remains 21
commands; the catalogue now registers 27 entries in total.

**Evidence** — `src/__tests__/bn/means-tests/meansEpic3Income.test.tsx`
(43 cases). Means-Test suites: 176/176 passing.



### Epic 2 — completion record

Classification: `IMPLEMENTATION_IN_PROGRESS` ·
`development_access = ENABLED` ·
`production_activation = NOT_STARTED` ·
`external_uat = NOT_STARTED`.

**Journey delivered** — created draft assessment → confirm assessment
context → establish household composition → resolve household validation
issues → mark household section complete → prepare for Income.

**Workspace** — the header now leads with the assessed person, assessment
reference, programme, reason and period rather than raw identifiers, and a
stage journey strip (`BnMeansStageJourney`) orients the officer. The Context
tab is a confirmation panel (`BnMeansContextPanel`) with a controlled
correction path guarded by `BN_MEANS_CORRECT_CONTEXT`; person, claim and award
links are never editable there.

**Household section** — `BnMeansHouseholdSection` plus
`BnMeansHouseholdMemberDialog` replace the previous code-typing inline form.
The officer chooses between a known person (candidate shortlist and governed
person search, identifiers always masked) and a declared member; a declared
member never receives a fabricated person identifier. Relationship, dependency
decision, dependency basis, residence-inclusion reason and information source
all come from the governed reference boundary. Dependency is an explicit
tri-state decision and is never inferred from the relationship.

**Backend-owned readiness** — completeness, blockers and warnings come from
`bn_means_household_readiness_v1`; React never computes section completeness.
"Mark household complete" is enabled only when the backend reports the section
complete and the action is present in `bn_means_available_actions_v1`.
Duplicate and overlapping membership detection is performed in the database.

**Commands added** — `BN_MEANS_UPDATE_HOUSEHOLD_MEMBER`,
`BN_MEANS_REMOVE_HOUSEHOLD_MEMBER` and `BN_MEANS_CORRECT_CONTEXT`, taking the
canonical catalogue to 21 commands, each mapped to a `bn_means_tests`
capability.

**Evidence** — `src/__tests__/bn/means-tests/meansEpic2Household.test.tsx`
(10 cases) plus the Epic 0/1 and MT4–MT7 suites: 110/110 passing.


### Epic 0 — completion record

Classification: `IMPLEMENTATION_IN_PROGRESS` ·
`development_access = ENABLED` ·
`production_activation = NOT_STARTED` ·
`external_uat = NOT_STARTED`.

**Menu registration** — exactly one `app_modules` row, `bn_means_tests`,
display name "Means-Test Assessments", route `/bn/means-tests`, parent
`benefits_management` (Benefit Management), icon `Scale`, sort order 62
alongside the other Benefits operational modules,
`is_enabled = routes_enabled = show_in_menu = true`,
`rollout_state = internal_pilot` (development access only; Test, Production
and Live remain inactive). No hard-coded sidebar entry exists — navigation is
database-driven.

**Admin permission assignment** — the `Admin` role holds all nine authoritative
module actions (`view`, `write`, `verify`, `decide`, `adjust_request`,
`adjust_approve`, `approve`, `reassess`, `config`) as explicit
`role_permissions` rows, not only through the application-level Admin bypass.
Assignment is idempotent: `module_actions` carries the
`auto_grant_admin_permission` trigger and `role_permissions` is uniquely keyed
on `(role_id, module_id, action_id)`.

**Route protection** — `BnModuleRouteGate` remains fail-closed: authenticated
user → module registered → `is_enabled` → `routes_enabled` → explicit `view`
(or Admin). The gate now also publishes the caller's full action set through
`grants` / `can(action)` so surfaces can gate on `verify`, `approve`,
`reassess` and `config` without re-reading permissions.

**Landing page** — `/bn/means-tests` opens on an operational landing page:
purpose, development-access status, the caller's access level, a twelve-stage
process journey (Assessment → … → Reassessment), work-area cards, and a
"How Means Tests work" panel written for Benefits officers. Unimplemented work
areas state "Not implemented yet" and never render a fabricated zero count.
Internal identifiers live only inside a collapsed "Technical details" panel.

**Shared UX controls** — `src/components/bn/meansTests/controls/MeansControls.tsx`:
searchable lookup (search / loading / empty / failed / denied / selected summary /
clear), governed dropdown (label vs stored value, description, inactive options,
failed loads never degraded to an empty valid list), money input (integer minor
units, no binary floating-point arithmetic, precision, negative control,
read-only derived mode), percentage input (basis-point conversion, range),
date field (bounds, accessible errors), boolean switch and decision radio group.

**Field-definition contract** — `src/types/bn/meansTests/meansFieldContract.ts`
defines control types (`TEXT`, `TEXTAREA`, `SEARCH_LOOKUP`, `SELECT`, `RADIO`,
`CHECKBOX`, `DATE`, `MONEY`, `PERCENTAGE`, `READ_ONLY`), the canonical load
states (`LOADING`, `SUCCESS`, `EMPTY`, `DENIED`, `FAILED`, `NOT_IMPLEMENTED`),
option sources, validation, conditional visibility, permission, read-only rules
and stored-vs-derived storage.

**Reference-data boundary** —
`src/services/bn/meansTests/meansReferenceDataService.ts` is the single governed
supplier of all controlled Means-Test lists, filterable by programme, policy
version, effective date, lifecycle state, permission and active status. Remotely
governed sets (benefit programmes, effective policy versions) report
`NOT_IMPLEMENTED` rather than an empty list.

**Tests** — `src/__tests__/bn/means-tests/meansEpic0Foundation.test.tsx`
(27 cases) covering navigation and permission facts, landing-page behaviour,
control state handling, reference-data governance and accessibility. The
Means-Test suite totals 81 passing tests.

**Known gaps carried into later epics**
- Benefit programme and policy-version reference reads (Epic 1).
- "My assessments", verification queue and reassessment queue backend reads.
- Activation and reassessment stages of the journey.
- Means-Test configuration screens for holders of `config`.

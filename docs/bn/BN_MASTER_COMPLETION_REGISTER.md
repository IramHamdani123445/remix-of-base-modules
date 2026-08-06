# Benefits (BN) — Master Completion Register

Compiled: 2026-08-06 · Starting HEAD `de2ff18d3f6899bc75a4ee6732dba931a2e98333`
Machine-readable twin: `docs/bn/BN_MASTER_COMPLETION_REGISTER.json`
Execution plan: `docs/bn/BN_PROGRAMME_EXECUTION_PLAN.md`

No environment was activated while compiling this register. Every BN module row in
`app_modules` still reads `actions_enabled = false` (`bn_award_suspension`,
`bn_life_certificate`, `bn_medical_review`, `bn_servicing`).

## Classification legend

| Classification | Meaning |
|---|---|
| `COMPLETE_AND_CERTIFIED` | Source complete **and** runtime evidence (clean-database harness + grant verifier) reproducibly passing in CI. |
| `SOURCE_COMPLETE_RUNTIME_PENDING` | Backend + frontend + tests exist; runtime certification not yet executed or not yet green. |
| `PARTIAL_IMPLEMENTATION` | Meaningful slices shipped, material gaps remain. |
| `CONTRACT_ONLY` | Types/contracts/specs exist; little or no executable lifecycle. |
| `BLOCKED_BY_POLICY` | Work is gated by a governance decision (dark launch, approval policy). |
| `BLOCKED_BY_INFRASTRUCTURE` | Work is gated by environment/CI/secret availability. |
| `RETIRED_OR_REDIRECT_ONLY` | Superseded surface, kept only as redirect/deprecated shim. |

### Status is recorded on three independent axes

A technically certified module is **not** downgraded because it is dark-launched.
Every module therefore carries three separate values, and no undocumented status
value (such as the retired `CERTIFIED_DARK_LAUNCHED`) may be used:

| Axis | Allowed values |
|---|---|
| `classification` | the legend above (source + runtime certification state) |
| `activation` | `DARK_LAUNCHED`, `INTERNAL_PILOT`, `TEST_ACTIVE`, `LIVE` |
| `external_uat` | `DEFERRED`, `IN_PROGRESS`, `COMPLETE` |

**Rule applied:** no module is marked `COMPLETE_AND_CERTIFIED` without reproducible
runtime evidence (clean-database harness + grant verifier passing in CI). Technically
certified modules are recorded as:

```
classification = COMPLETE_AND_CERTIFIED
activation     = DARK_LAUNCHED
external_uat   = DEFERRED
```

`CERTIFIED_DARK_LAUNCHED` is **retired** and must not reappear.


## Summary

| # | Module | Classification | Activation | External UAT | Runtime evidence |
|---|---|---|---|---|---|
| 1 | Core Claims | PARTIAL_IMPLEMENTATION | n/a (always-on surfaces) | n/a | none |
| 2 | Eligibility & Calculation | PARTIAL_IMPLEMENTATION | n/a | n/a | unit only |
| 3 | Determination & Approval | PARTIAL_IMPLEMENTATION | n/a | n/a | unit only |
| 4 | Awards | PARTIAL_IMPLEMENTATION | n/a | n/a | unit only |
| 5 | Payments | PARTIAL_IMPLEMENTATION | n/a | n/a | unit only |
| 6 | Configuration | PARTIAL_IMPLEMENTATION | n/a | n/a | unit only |
| 7 | Award Suspension | COMPLETE_AND_CERTIFIED | dark launch (`false`) | DEFERRED | **CI chain PASS**; Test-provisioning tooling ready (29/29 guards), durable Test target still required |
| 8 | Life Certificates | COMPLETE_AND_CERTIFIED | dark launch (`false`) | DEFERRED | `BN_LC_GRANTS_RESULT: PASS`, `BN_LC_HARNESS_RESULT: PASS` on the regenerated PG15 baseline |
| 9 | Medical Reviews | COMPLETE_AND_CERTIFIED | dark launch (`false`) | DEFERRED | **grants + harness + adapter postflight PASS**; architecture boundary closed (RPC-only legacy mutations); 207/207 focused suites |
| 10 | Overpayments | COMPLETE_AND_CERTIFIED | dark launch (`internal_pilot`, actions `false`) | DEFERRED | **independent CI green** — `bn-overpayment-integration.yml` run `31116272752` on `3a8b893139f5101022e0924617fbd73548e72e54`; finance/legal operations readiness `PENDING` |
| 11 | Mortality | PARTIAL_IMPLEMENTATION | n/a | n/a | none |
| 12 | Appeals | PARTIAL_IMPLEMENTATION | n/a | n/a | none |
| 13 | Survivors Processing | PARTIAL_IMPLEMENTATION | n/a | n/a | none |
| 14 | Means Tests | PARTIAL_IMPLEMENTATION | n/a | n/a | none |
| 15 | Risk Management | CONTRACT_ONLY | n/a | n/a | none |
| 16 | Uprating | CONTRACT_ONLY | n/a | n/a | none |

---

## 1. Core Claims

- **Status:** PARTIAL_IMPLEMENTATION
- **Routes:** `/bn/claims`, `/bn/claims/:id`, `/bn/intake/*`, `/bn/queue`, `/bn/workbench/*`
- **Menu:** dynamic `app_modules` driven; legacy `benefitsMenuItems.ts` deprecated (redirect only)
- **Feature flags / module flags:** `bn_servicing` (`actions_enabled=false`); no per-claim flag
- **Commands catalogued / implemented:** intake, amend, submit, assign, withdraw catalogued; core intake + amend implemented (`claimService.ts`, `claimActionRunner.ts`, `amendClaimField.ts`)
- **Query boundary:** service-layer readers (`claimWorkbenchService`, `claimWorkspaceService`) — not fully RPC-only
- **Mutation boundary:** mixed table writes + RPC; **not yet a closed command boundary**
- **Permissions:** `benefits_management`, `process_claims`
- **Workflow:** `bnWorkflowRuntimeService` / `core_workflow_*`
- **Audit:** partial (`src/services/bn/audit`)
- **Communication:** via Hub façade (`src/modules/benefits/communication`)
- **DMS / Finance / Legal / Scheduler:** DMS partial; Finance via payables; Legal via referrals; Scheduler none
- **Source tests:** unit suites under `src/__tests__/bn`
- **Database tests:** none
- **Latest CI evidence:** none module-specific
- **Controlled Test evidence:** none
- **Activation state:** always-on admin surfaces, no controlled activation gate
- **Remaining blockers:** mutation boundary not closed; no clean-database harness
- **Dependencies:** Configuration, Eligibility
- **Recommended next slice:** define claim command catalogue + RPC boundary before certification

## 2. Eligibility and Calculation

- **Status:** PARTIAL_IMPLEMENTATION
- **Routes:** `/bn/engine/*`, `/bn/config/calculation`
- **Menu:** Benefits → Settings → Calculation Setup
- **Flags:** none dedicated
- **Commands:** formula lifecycle, rate/tier/matrix tables, simulation — implemented (`calculationEngine.ts`, `formulaLifecycleService.ts`)
- **Query/Mutation boundary:** service layer; formula versions via RPC where governed
- **Permissions:** `benefits_management`
- **Workflow / Audit:** formula approval workflow; calc traces in `bn_calc_trace`
- **Communication / DMS / Finance / Legal / Scheduler:** n/a / n/a / feeds payments / n/a / n/a
- **Tests:** unit + simulation suites; **no database harness**
- **CI / Controlled Test evidence:** none
- **Blockers:** no clean-database certification of formula resolution
- **Dependencies:** Configuration
- **Next slice:** SQL harness for formula resolution and calc traces

## 3. Determination and Approval

- **Status:** PARTIAL_IMPLEMENTATION
- **Routes:** `/bn/approval/*`
- **Commands:** approve, reject, refer, delegate (`approvalConsoleService`, `approvalGuardService`, `approvalLevelService`, `delegationService`)
- **Boundaries:** approval writes governed by workflow tasks; guard service enforces maker–checker
- **Permissions:** approval-level permissions per policy area (`bn_policy_area`)
- **Audit:** workflow task audit
- **Tests:** unit only · **CI:** none
- **Blockers:** no runtime certification; policy-area coverage incomplete outside servicing modules
- **Next slice:** extend `bn_policy_area` coverage + harness

## 4. Awards

- **Status:** PARTIAL_IMPLEMENTATION
- **Routes:** `/bn/awards/*`, Award 360
- **Evidence assets:** `docs/bn/award360-*` matrices and completion register
- **Commands:** award lifecycle catalogued in the Award 360 action matrix; a subset implemented
- **Tests:** loader certification evidence (`src/test/award360`)
- **CI:** none · **Controlled Test:** none
- **Blockers:** action matrix not fully implemented; no database harness
- **Next slice:** close Award 360 action matrix gaps, then certify

## 5. Payments

- **Status:** PARTIAL_IMPLEMENTATION
- **Routes:** `/bn/payables/*`, `/bn/schedule/*`, `/bn/issue/*`, `/bn/postissue/*`
- **Specs:** `docs/BN_Payment_Issue_Specification.md`, `BN_Payment_Schedule_Specification.md`, `BN_Post_Issue_Review_Specification.md`
- **Boundaries:** schedule/issue services; finance integration through payables
- **Blockers:** no runtime certification; suspension payment-impact integration only proven inside the suspension harness
- **Next slice:** payment issue harness on clean database

## 6. Configuration

- **Status:** PARTIAL_IMPLEMENTATION
- **Routes:** `/bn/config/*` (calculation, reference data, products, country packs)
- **Assets:** `EPIC_0_3_BN_CONFIGURATION_INVENTORY.md`, `EPIC_0_3A_BN_CONFIGURATION_IMPROVEMENT_PLAN.md`
- **Boundaries:** settings resolved through the Business Module Settings Contract
- **Blockers:** reference-data seeding gaps historically broke clean-database builds; now mitigated by `20260805170000_ci_reference_data_reseed.sql`
- **Next slice:** extend the reseed migration as new reference domains land

## 7. Award Suspension  ← certified in this change set

- **Status:** COMPLETE_AND_CERTIFIED · activation `DARK_LAUNCHED` · external UAT `DEFERRED`
- **Routes (canonical, per `AppRoutes.tsx`):** `/bn/award-suspension` (console + proposal/decision surfaces). `/bn/servicing/award-suspension` is a legacy redirect only.
- **Menu:** exactly one entry under Benefit Servicing, gated on `bn_award_suspension:view`
- **Feature/module flags:** `app_modules.bn_award_suspension.actions_enabled = false` (asserted by CI postflight)
- **Commands catalogued:** 10 operator commands (`propose`, `approve`, `reject`, `withdraw`, `execute` × suspension/reinstatement)
- **Commands implemented:** 10/10, all SECURITY DEFINER with pinned `search_path`
- **Query boundary:** `authenticated` has SELECT only on suspension tables; readers in `awardSuspensionViewService.ts`
- **Mutation boundary:** RPC-only; no direct table writes from the browser (verified by grant verifier)
- **Permissions:** `view`, `propose`, `approve`, `withdraw`, `execute`, `resume_propose`, `resume_approve`, `resume_execute`, `view_payment_impact` — all registered in `module_actions`
- **Workflow:** `core_workflow_task` maker–checker with policy-area approval levels (`bn_policy_area.award_suspension`)
- **Audit:** `bn_award_suspension_event`, `bn_susp_operational_error_log`
- **Communication:** Hub façade only · **DMS:** decision letters via generated documents · **Finance:** `bn_award_suspension_payment_impact` arrears run · **Legal:** none · **Scheduler:** `*_due_for_execution_v1` / `*_execute_scheduled_v1`, closed to browser roles
- **Source tests:** 12/12 static (`test:bn-suspension-static`), 17/17 activation guard tests
- **Database tests:** `supabase/tests/bn/award_suspension_integration.sql` — journeys A/B/C, transaction rolled back
- **Latest CI evidence:** `BN_SUSP_GRANTS_RESULT: PASS`, `BN_SUSP_HARNESS_RESULT: PASS`, dark-launch postflight `actions_enabled=f`, zero fixture residue
- **Controlled Test evidence:** none — no environment activated
- **Activation state:** dark launch everywhere
- **Remaining blockers:** operator decision to stamp a Test environment marker and run `scripts/bn/activate-award-suspension-test.sh`
- **Dependencies:** Awards, Payments (arrears), Workflow, Communication Hub
- **Next slice:** controlled Test activation + UAT journeys

## 8. Life Certificates

- **Status:** COMPLETE_AND_CERTIFIED · activation `DARK_LAUNCHED` · external UAT `DEFERRED`
- **Routes (canonical):** `/bn/life-certificates` (legacy `/bn/servicing/life-certificates`, `/nbenefit/long-term/life-certificates` are redirects only)
- **Latest CI evidence:** `BN_LC_GRANTS_RESULT: PASS`, `BN_LC_HARNESS_RESULT: PASS` — recorded on main; Life Certificates are no longer "unverified"
- **Flags:** `bn_life_certificate.actions_enabled = false`
- **Commands:** 14 RPCs (issue, submit, verify, fail, escalate, link-to-suspension)
- **Boundaries:** RPC-only mutations; read views for the register
- **Permissions:** `bn_life_certificate:*` action set
- **Workflow/Audit/Communication/DMS:** obligation workflow, event log, Hub dispatch, generated certificates
- **Tests:** static/unit present; `supabase/tests/bn/life_certificate_integration.sql` and `supabase/verify/bn_life_certificate_effective_grants.sql` exist
- **CI:** `.github/workflows/bn-life-certificate-integration.yml` — **not re-executed in this change set**
- **Blockers:** certification run not reproduced against the regenerated PG15 baseline
- **Next slice:** rerun the Life Certificate workflow on the new baseline (Wave 2)

## 9. Medical Reviews

- **Status:** COMPLETE_AND_CERTIFIED · activation `DARK_LAUNCHED` · external UAT `DEFERRED`
- **Routes (canonical):** `/bn/medical-reviews`, `/bn/medical-reviews/board`, `/bn/medical-reviews/legacy-scheduler` (legacy `/bn/servicing/...` are redirects only)
- **Flags:** `bn_medical_review.actions_enabled = false`; `bn_communication_adapter_source.BN_MEDICAL_REVIEW.is_enabled = false`
- **Commands:** 50+ commands and ~20 query RPCs, mapped by `backendContract.ts`, plus the governed legacy trio
  `bn_medical_review_legacy_{schedule,record_outcome,provision}_v1`
- **Boundaries:** RPC-only. No browser role holds INSERT/UPDATE/DELETE on any Medical Review table, including the two
  legacy Award 360 tables (`bn_medical_review_schedule`, `bn_medical_provider_type`), which are now SELECT-only behind RLS.
  `src/services/bn/awardServicingService.ts`, `MedicalReviewScheduler.tsx` and `awardCreationService.ts` issue no direct writes.
- **Concurrency:** `bn_medical_review_schedule.row_version` drives optimistic concurrency (`E_STALE_ROW_VERSION`).
- **Permissions:** module action catalogue under `bn_medical_review`
- **Audit:** confidential-evidence reveal auditing implemented; every legacy command writes `_bn_mr_audit`
- **Tests:** 207/207 focused certification suites, including the static
  `src/__tests__/bn/medical_reviews_no_direct_mutation.test.ts` architecture gate
- **Certification markers:** `BN_MR_GRANTS_RESULT: PASS`, `BN_MR_HARNESS_RESULT: PASS` (68 assertions),
  `BN_MR_ADAPTER_RESULT: PASS`, module dark-launch `f`, zero fixture residue
- **CI:** `.github/workflows/bn-medical-review-integration.yml` — disposable `postgres:15`, exact-marker gating,
  both dark-launch postflights, expanded focused suites and `tsc --noEmit`
- **Blockers:** none for certification; runtime activation still requires a durable Test target
- **Next slice:** Wave 4 — Overpayment Recovery governance foundation and backend boundary

## 10. Overpayments

- **Status:** IMPLEMENTATION_COMPLETE_PENDING_CI · activation `DARK_LAUNCHED` (`internal_pilot`,
  actions disabled) · external UAT `DEFERRED`
- **Routes (canonical):** `/bn/overpayments` (component file at `src/pages/bn/servicing/OverpaymentRecovery.tsx`)
- **Surface:** `src/pages/bn/servicing/OverpaymentRecovery.tsx` — RPC-only, no direct table access
- **Forward-only migration:** `supabase/migrations/20260806150000_bn_overpayment_recovery_domain.sql`
  (24 `bn_op_*` tables, RLS on every table, 29 command RPCs + 14 query RPCs, service adapters
  revoked from browser roles, 29-row action catalogue seeded)
- **Financial invariant:** Model A signed contra events; harness asserts the 1200.00 golden balance
- **Certification markers:** `BN_OP_GRANTS_RESULT: PASS`, `BN_OP_HARNESS_RESULT: PASS`,
  dark-launch `internal_pilot:false`, zero fixture residue (catalogue excluded), catalogue count 29
- **Harness journeys:** full lifecycle, maker-checker rejection, reversal contra invariant,
  idempotent replay (no double post), finance-intent/transaction parity, appeal-hold enforcement
  rejection, closed-case rejection, and the negative security matrix
  (`E_ACTIONS_DISABLED`, `E_PERMISSION_DENIED`, `E_STALE_ROW_VERSION`, `E_SELF_APPROVAL`,
  `E_INVALID_STATE`)
- **CI:** `.github/workflows/bn-overpayment-integration.yml` — disposable `postgres:15`,
  `environment_kind = CI` marker guard, exact-marker gating, evidence upload
- **Local proof:** the entire workflow sequence was replayed on a clean PostgreSQL 15.17 instance
  from the baseline forward and returned `ALL CI STEPS GREEN ON POSTGRES 15`
- **Remaining to certify:** an independent GitHub Actions run on managed `main`. Flip to
  `COMPLETE_AND_CERTIFIED` / `DARK_LAUNCHED` / `DEFERRED` only when that run is green.
- **Dependencies:** Payments, Finance, Legal recovery

## 11. Mortality

- **Status:** PARTIAL_IMPLEMENTATION
- **Surface:** `src/pages/bn/mortality/*`, `scripts/bn/generate-mortality-command-catalog.ts`
- **Gaps:** catalogue generated but boundary/harness absent
- **Dependencies:** Award Suspension (death-triggered suspension), Survivors
- **Next slice:** command boundary + effective-grant verifier

## 12. Appeals

- **Status:** PARTIAL_IMPLEMENTATION
- **Surface:** `src/pages/bn/appeals/*`, `src/services/bn/appeals`, `docs/bn/appeals`
- **Gaps:** no runtime certification; workflow/permission wiring incomplete
- **Dependencies:** Determination, Legal
- **Next slice:** appeal lifecycle state machine + RPC boundary

## 13. Survivors Processing

- **Status:** PARTIAL_IMPLEMENTATION
- **Surface:** `src/pages/bn/servicing/SurvivorsBenefitProcessing.tsx`
- **Gaps:** relationship/entitlement rules partially modelled; no harness
- **Dependencies:** Mortality, Awards, Payments
- **Next slice:** survivor entitlement rules + boundary

## 14. Means Tests

- **Status:** PARTIAL_IMPLEMENTATION
- **Surface:** `src/pages/bn/meansTests`, `src/services/bn/meansTests`
- **Gaps:** assessment lifecycle not governed by commands; no audit contract
- **Dependencies:** Eligibility, Configuration
- **Next slice:** assessment command catalogue

## 15. Risk Management

- **Status:** CONTRACT_ONLY
- **Surface:** `src/pages/bn/risk`
- **Gaps:** rules/scoring not implemented as governed commands
- **Dependencies:** Claims, Payments, Compliance
- **Next slice:** risk rule contract + read-only scoring surface

## 16. Uprating

- **Status:** CONTRACT_ONLY
- **Surface:** `src/pages/bn/uprating`
- **Gaps:** no uprating run engine, no simulation, no harness
- **Dependencies:** Calculation, Awards, Payments
- **Next slice:** uprating run model + dry-run simulation

---

## Legacy / retired surfaces

| Surface | Status |
|---|---|
| `src/components/sidebar/menuItems/benefitsMenuItems.ts` | RETIRED_OR_REDIRECT_ONLY — deprecated static menu, superseded by `app_modules` |
| `/benefits/*` namespace | RETIRED_OR_REDIRECT_ONLY — redirects to `/bn/*` |
| `src/services/bn/_legacy` | RETIRED_OR_REDIRECT_ONLY — retained for compatibility only |

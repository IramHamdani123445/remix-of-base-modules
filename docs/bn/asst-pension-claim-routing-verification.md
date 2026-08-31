# ASST_PENSION — test claim registration and workflow routing verification

Date: 2026-08-31 · Product: `ASST_PENSION` (Assistance Pension, v1 ACTIVE)
Workflow template: `WF_NCP_Assistance_pension` · Channel: OFFLINE (staff-assisted)

## 1. Claim registered

Registered through the canonical intake transaction `submitClaimApplication`
(no direct inserts), so every guard ran.

| Field | Value |
|---|---|
| Applicant | SSN `900012`, NCPTest Tester, born 1960-06-06, **age 66** |
| Claim number | **BN-20260831-33389** |
| Claim id | `5c447692-df9b-4439-8c24-99d4d5a1acf4` |
| Channel | `STAFF_OFFLINE` → normalised `OFFLINE` |
| Readiness gate | passed |
| Communication | `BENEFITS.CLAIM.SUBMITTED` obligation recorded with the claim |
| Initial routing | **Intake Review** (`BN_INTAKE_OFFICER`), active assignment created |

Workflow engine: `BN_FALLBACK`. The template has no executable
`workflow_definition_id`, so no central workflow instance started and the claim
was assigned directly. This is expected on this platform today (no template has
an executable definition) and is not specific to your product.

## 2. Eligibility — rules do not evaluate as authored

`runClaimEligibility` produced **overall result: false** — not because the
applicant fails, but because **both rules are unevaluable**:

| Rule | Field | Actual | Expected as authored | Result |
|---|---|---|---|---|
| `AP_AGE_62` | `person.age_at_claim_date` | **66** | `BETWEEN ["62", ""]` | UNEVALUATED — "BETWEEN requires both a from and a to value" |
| `APNO_CONTRIB_PENSION` | `existing.contributory_pension_exists` | **false** | `BETWEEN ["false", ""]` | UNEVALUATED — same reason |

The facts resolve correctly (age 66 from `ip_master.dob`, no contributory
pension from `bn_award.status`). Both rules would pass if the operators were
corrected — `AP_AGE_62` to `>= 62`, `APNO_CONTRIB_PENSION` to `= false`.
An UNEVALUATED BLOCK rule blocks the claim exactly as a failure does, so as
configured today no Assistance Pension claim can clear eligibility.

Note: the rules are `governance_status = DRAFT`. That does **not** exclude them
— evaluation filters on `is_active` only.

## 3. Lifecycle routing — configured basket vs actual basket

Claim driven through each lifecycle status, re-routing at every stage:

| Status | Step used | Basket the template configures | Basket the claim actually entered | Verdict |
|---|---|---|---|---|
| INTAKE | INTAKE | Intake Review | Intake Review | correct |
| ELIGIBILITY_CHECK | ELIGIBILITY | Eligibility Review | Eligibility Review | correct |
| EVIDENCE_REVIEW | EVIDENCE_REVIEW | (template maps this to Eligibility Review) | **Document Review** | mis-routed |
| CALCULATION | CALCULATION | Calculation Review | Calculation Review | correct |
| DECISION | DECISION | **Manager Approval** | **Supervisor Approval** | mis-routed |
| APPROVED | AWARD_SETUP | **Payment Preparation** | **Award Setup** | mis-routed |
| PAYMENT_QUEUE | PAYMENT | (no step configured) | Payment Issue | outside the template |

Three of seven stages land in a basket you did not configure. The claim was
returned to INTAKE / Intake Review after the run.

**No SLA deadline was ever set** (`due_at` null at every stage). The template
stores each step's SLA in hours; routing reads a `sla_days` field that these
steps do not carry, so escalation has no deadline to watch.

## 4. Why

1. **The per-step `workbasket_id` you configured is never read.** Routing
   derives the basket from the step's role instead.
2. **The step roles are not in the role map.** The map knows `CLERK`,
   `OFFICER`, `SUPERVISOR`, `MANAGER`, `FINANCE`; the template says
   `CLAIMS_CLERK`, `CLAIMS_OFFICER`, `CLAIMS_SUPERVISOR`, `PAYMENTS_OFFICER`.
   The `assigned_role` field on each step — which holds the correct `BN_*`
   roles — is not read either, so routing falls through to a step-name default.
3. **Step names and step codes are two vocabularies.** Routing matches on
   `step`; this template puts the routing-recognised names
   (`MEANS_TEST`, `EVIDENCE_REVIEW`, `DECISION`, `AWARD_SETUP`) in `step_code`
   and uses `VERIFICATION` / `ELIGIBILITY` / `APPROVAL` / `PAYMENT_AUTH` in
   `step`.
4. **SLA unit mismatch** — hours stored, days read.

Where routing is correct it is correct by coincidence: the step-name default
happens to name the same basket you chose.

## 5. Visibility

Each stage produced exactly one active `bn_claim_queue_assignment` with the
prior one closed, so the claim is only ever in one basket. `/bn/queue` filters
baskets by the signed-in user's role (oversight roles see all), so the claim is
visible to holders of the current basket's `assigned_role` and to no other
operational role.

## 6. Recommended fixes (not applied)

1. Resolve the basket in this order: step `workbasket_id` → step
   `assigned_role` → role map → step-name fallback; treat `step_code` as an
   alias of `step`. Fixes all four mis-routings for this and every similarly
   authored template.
2. Read the step SLA in hours as well as days so `due_at` is populated.
3. Correct the two eligibility rule operators (`>= 62`, `= false`) and promote
   them out of DRAFT.

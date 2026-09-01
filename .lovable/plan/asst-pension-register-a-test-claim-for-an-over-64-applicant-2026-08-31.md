# ASST_PENSION — register a test claim for an over-64 applicant and verify the workflow wiring

## What I found (all confirmed by reading the live configuration)

**Product**: `ASST_PENSION` — "Assistance Pension", category `NON_CONTRIBUTORY`, status ACTIVE.
Version 1 is ACTIVE, effective from 2026-08-31, no end date.

**Channels**: `OFFLINE` is enabled and carries the workflow template
`WF_NCP_Assistance_pension`. `ONLINE` is disabled and carries no template.
The template is also set on the version itself, so workflow resolution
succeeds for staff-assisted (offline) registration.

**Workflow template** `WF_NCP_Assistance_pension` — 5 steps, each with an
explicit workbasket and SLA:

| # | step | step_code | role | assigned_role | basket | SLA |
|---|------|-----------|------|---------------|--------|-----|
| 1 | INTAKE | Intake | CLAIMS_CLERK | BN_INTAKE_OFFICER | Intake Review | 24h |
| 2 | VERIFICATION | MEANS_TEST | CLAIMS_OFFICER | BN_CALCULATION_OFFICER | Calculation Review | 240h |
| 3 | ELIGIBILITY | EVIDENCE_REVIEW | CLAIMS_OFFICER | BN_ELIGIBILITY_OFFICER | Eligibility Review | 112h |
| 4 | APPROVAL | DECISION | CLAIMS_SUPERVISOR | BN_MANAGER | Manager Approval | 120h |
| 5 | PAYMENT_AUTH | AWARD_SETUP | PAYMENTS_OFFICER | BN_PAYMENT_OFFICER | Payment Preparation | 24h |

All five workbaskets exist and are active.

**Eligibility rules** on the version: two, both BLOCK-severity —
`AP_AGE_62` (age at claim date >= 62) and `APNO_CONTRIB_PENSION` (must not
already hold a contributory Age Pension). Both are `governance_status = DRAFT`.

**Candidate applicants over 64** (the only ones in the person register):
`900012` NCPTest Tester, born 1960-06-06, age 66 — has an email address;
`999001` SYNTHETIC TESTONE, age 68; `900013` LifeCert Tester, age 70
(already used by the life-certificate fixtures).

## Three real defects the wiring will hit

These are conclusions from the routing code, not guesses about behaviour —
the test claim will demonstrate each.

1. **The per-step workbaskets you configured are ignored.** The resolver
   derives the basket from the step's *role*, and never reads the
   `workbasket_id` stored on each step.
2. **The step roles on this template are not in the role map.** The map knows
   `CLERK`, `OFFICER`, `SUPERVISOR`, `MANAGER`, `FINANCE`; the template says
   `CLAIMS_CLERK`, `CLAIMS_OFFICER`, `CLAIMS_SUPERVISOR`, `PAYMENTS_OFFICER`.
   The `assigned_role` field (which does hold the correct `BN_*` roles) is
   never read either, so routing falls back to a name-based default table.
3. **Three of the five step names are not in the routing vocabulary.**
   Routing expects `EVIDENCE_REVIEW`, `CALCULATION`, `DECISION`,
   `AWARD_SETUP`, `PAYMENT`; this template spells those as `VERIFICATION`,
   `ELIGIBILITY`, `APPROVAL`, `PAYMENT_AUTH` under `step` and puts the
   expected names under `step_code`. Consequence at Decision stage: the claim
   goes to a Supervisor basket instead of your **Manager Approval** basket;
   at award stage to an Award Officer basket instead of **Payment Preparation**.

Intake (step 1) routes correctly by accident, because the fallback for the
step name `INTAKE` happens to be `BN_INTAKE_OFFICER` — the same basket you
configured.

## Plan

### 1. Register the claim (state change)
Register one claim through the canonical intake path
(`submitClaimApplication`) — not by inserting rows — so every real guard
runs: product/version resolution, channel config, eligibility pre-check,
document requirements, workbasket routing.

- SSN `900012` (age 66), product `ASST_PENSION`, channel `STAFF_OFFLINE`,
  claim date today.
- If intake blocks on a channel requirement (bank verification is required
  on this channel), report the block rather than bypassing it.

### 2. Verify and report, stage by stage
- Eligibility: confirm `AP_AGE_62` passes for a 66-year-old and that
  `APNO_CONTRIB_PENSION` evaluates (checking whether DRAFT governance status
  excludes the rules from evaluation — if it does, that is a finding).
- Routing at intake: confirm an active `bn_claim_queue_assignment` exists,
  pointing at **Intake Review**, with a 24h due date.
- Drive the claim through the lifecycle statuses and record, for each stage,
  the basket it actually lands in versus the basket the template configures.
- Confirm the claim is visible on `/bn/queue` for the matching role and
  invisible to the others.

### 3. Report — no code changes in this pass
Produce a short verdict per stage (correct / mis-routed / unrouted) with the
configured-vs-actual basket. Defect fixes are a separate, agreed change.

## Optional follow-up (only if you want it now)

Make the routing honour the template as authored — in priority order:
step's `workbasket_id` → step's `assigned_role` → existing role map → step
name fallback, and treat `step_code` as an alias of `step`. That single
change makes all five stages of this template route to the baskets you set,
and does the same for every other template authored the same way. Say the
word and I will fold it into this plan.

## Technical notes

Touched for the test only: `submitClaimApplication`
(`src/services/bn/intake/claimIntakeService.ts`),
`routeClaimToWorkbasket`, `resolveClaimWorkbasket`, `resolveProductWorkflow`.
Tables read: `bn_claim`, `bn_claim_queue_assignment`, `bn_workbasket`,
`bn_workflow_template`, `bn_product_channel_config`, `bn_eligibility_rule`,
`ip_master`. No migration, no schema change.

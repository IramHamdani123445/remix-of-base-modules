# Claim Status vs Workbasket — Analysis and Correction

## What I checked

**1. Legacy rules — clean.**
All 61 active rows in the claim transition matrix were queried. There are zero lowercase legacy tokens left (`bn_officer`, `bn_clerk`, `bn_finance`, `bn_supervisor`, `bn_manager`). Every role token now in use is either `Admin` or a canonical `BN_*` role, every one of them is held by at least one real account, and every `BN_*` token staffs an active workbasket. No legacy rule remains linked.

**2. The AWARD_SETUP-in-a-payment-queue case — reproduced.**
Claim `BN-20260831-33389` is genuinely in status `AWARD_SETUP` and genuinely sits in the **Payment Preparation** basket. Both facts are correct in isolation:

- The claim was approved, the award (entitlement) and the first payment instruction were created, and the status moved `APPROVED → AWARD_SETUP`. It has **not** yet been sent to payment — `Send to Payment` (`AWARD_SETUP → PAYMENT_QUEUE`) is still the pending action.
- Its product's workflow template (`WF_NCP_Assistance_pension`) declares a step named **"Payment Authorization"** whose routing code is `AWARD_SETUP` and whose explicit workbasket is **Payment Preparation**. So routing correctly put the AWARD_SETUP stage into that queue, exactly as configured.

## So is it okay?

Technically yes, the status shown is the true status. Operationally it is misleading, for three reasons found in the data:

1. **The template mislabels the stage.** A step called "Payment Authorization" is bound to the `AWARD_SETUP` stage code. The queue therefore reads "payment", the badge reads "Award Setup", and neither is wrong — the configuration is contradictory.
2. **That template has no `PAYMENT` step at all.** When the claim does reach `PAYMENT_QUEUE`, routing falls back to role matching, and two active baskets share the role `BN_PAYMENT_OFFICER` (Payment Preparation and Payment Issue) — the claim lands in Payment Issue by alphabetical tie-break, not by design.
3. **Nothing warns anybody.** There is no check that says "this basket's stage disagrees with the claim's status", so a mis-authored template is invisible until a user notices, as you just did.

Two further genuine mismatches exist in live data for the same reasons: `BN-20260901-19059` (SUSPENDED, sitting in Payment Issue — suspended claims deliberately keep their basket) and `BN-20260901-86375` (AWARD_SETUP, still in Intake Review — its template's steps use codes that never map to the award stage).

## Proposed correction

**A. Make the screen state both truths, so neither can mislead.**
On the claim queue row and the claim workbench header, show the stage badge and the owning basket together, e.g. `Award Setup · Payment Preparation queue`. Where they disagree with the stage the basket is meant to serve, mark the row with a quiet "stage/queue mismatch" indicator and a tooltip naming the configuring template and step.

**B. Fix the configuration, not just the display.**
Correct the `WF_NCP_Assistance_pension` template so the "Payment Authorization" step carries the `PAYMENT` stage code (its basket stays Payment Preparation), and add the missing `AWARD_SETUP` step bound to the Award Setup basket. Then re-route the affected claims so they sit where their status says. This is a configuration data change, applied through a migration and reviewable in the workflow designer afterwards.

**C. Remove the alphabetical tie-break.**
When a stage resolves by role and more than one active basket carries that role, stop picking by code order. Prefer the basket whose code matches the stage; if still ambiguous, report it as a configuration gap rather than guessing.

**D. Add a standing validation.**
Extend the existing Benefits registry/queue-health checks with a "stage vs queue" reconciliation: for every active assignment, compare the claim's status-implied stage with the basket the assignment points to, and list every disagreement with its cause (mis-coded step, missing step, duplicate role, deliberate hold). Surface it on the existing queue health panel so this class of defect is found by the system, not by a user.

## Technical notes

- Status → stage mapping: `src/services/bn/workflow/claimStatusStepMap.ts` (unchanged).
- Stage → basket resolution and the tie-break to fix: `src/services/bn/intake/claimWorkbasketResolver.ts`.
- Re-routing entry point already used by every transition: `src/services/bn/workflow/routeClaimAfterStatusChange.ts`.
- Queue row rendering: `src/pages/bn/claims/ClaimQueue.tsx` (status badge at line 164).
- Template data lives in `bn_workflow_template.steps_config`, reached from `bn_product_version.workflow_template_id`.
- Suspended and pending-info claims intentionally keep their basket; the reconciliation will classify those as expected, not as defects.

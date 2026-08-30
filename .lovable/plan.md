# Claim → Workbasket Routing: How It Works Today, and Why Claims Are Missing From the Queue

## 1. How routing is designed to work

A claim's queue is a property of its **product**, not of the claim:

```text
claim.product_version_id + channel
  -> bn_product_version_workflow (channel match -> default -> legacy bn_product_version.workflow_template_id)
  -> bn_workflow_template.steps_config[0]      e.g. { step: "INTAKE", role: "CLERK", sla_days: 2 }
  -> step role mapped to a basket role         CLERK -> BN_INTAKE_OFFICER
  -> bn_workbasket WHERE assigned_role = basket role AND is_active
       (product_category-specific basket preferred, then a general one)
  -> bn_claim_queue_assignment row (claim_id, workbasket_id, due_at = assigned_at + sla_days)
```

Claim Queue (`/bn/claims` → Claim Queue) reads only `bn_claim_queue_assignment`
(active, not completed) joined to the basket. **No assignment row = the claim
does not appear in any workbasket**, regardless of its status.

There is no "workbasket" column on the product or on the workflow mapping —
the basket is derived from the workflow's first step role. That is the only link
between "workflow assigned to product" and "which basket the claim lands in".

## 2. Live state (measured)

| Fact | Value |
|---|---|
| Claims | 64 |
| Active queue assignments | 4 |
| Claims with a workflow instance | 0 |
| Active workbaskets | 32 |
| Product versions | 70 |
| Versions with a `bn_product_version_workflow` mapping | 4 |
| Versions with legacy `workflow_template_id` | 43 |
| Workflow templates with an executable `workflow_definition_id` | **0** |

So ~60 of 64 claims sit in no basket at all, and the Claim Queue looks empty for
most baskets.

## 3. Root causes found

1. **No executable workflow definitions.** Every `bn_workflow_template` has
   `workflow_definition_id = NULL` and `is_executable = false`. The central
   engine therefore never starts, and routing always falls to the intake
   "direct assignment" fallback. That fallback works, but only for claims
   created through `claimIntakeService`.
2. **Claims created outside the intake service are never routed.** Seeded /
   RPC-created / legacy claims never call the resolver, so they have no
   assignment row and can never surface in the queue. There is no backfill and
   no repair path.
3. **Routing happens once, at intake only.** The basket is derived from
   `steps_config[0]` (always INTAKE/CLERK → BN_INTAKE_OFFICER). When a claim
   moves to ELIGIBILITY, DECISION, PAYMENT, nothing re-derives the basket from
   the corresponding step, so a claim never travels down the workflow's baskets.
   Re-assignment exists only in the post-approval orchestrator and the
   escalation runner, not on ordinary status transitions.
4. **Step-role vocabulary is narrow.** `STEP_ROLE_TO_BASKET_ROLE` maps only
   CLERK, OFFICER, SUPERVISOR, MANAGER, FINANCE. Templates also use
   `INSPECTOR`, `MEDICAL_BOARD`, `SYSTEM`, which have no basket, so those steps
   would leave a claim unrouted.
5. **Only 4 of 70 product versions have a channel workflow mapping.** The rest
   rely on the legacy version-level template; 27 versions have neither.

## 4. Proposed remediation

**A. Routing on every workflow step, not just intake**
- Add a `resolveWorkbasketForStep(productVersionId, channel, stepName)` that
  reads the step matching the claim's current status instead of always
  `steps_config[0]`.
- Call it from the claim status transition path so each transition closes the
  current `bn_claim_queue_assignment` and opens the next one with that step's
  SLA. This is what makes the claim visibly travel across baskets.

**B. Route every claim, whatever created it**
- Move the resolve-and-assign step behind a single reusable
  `routeClaimToWorkbasket(claimId)` service used by intake, transitions, and a
  repair action.
- Add a backfill (one-off run) that routes existing unassigned open claims.

**C. Close the vocabulary and configuration gaps**
- Extend the step-role → basket-role map to cover INSPECTOR and MEDICAL_BOARD
  (or create the missing baskets); `SYSTEM` steps stay unrouted by design and
  should pass through to the next human step rather than stall.
- Product Assembly: surface the resolved basket per workflow step read-only, so
  a configurator can see where claims will land before publishing.

**D. Make unrouted claims visible instead of silent**
- A "Not in any queue" panel on the Claim Queue screen listing open claims with
  no active assignment plus the recorded reason, with a Re-route action.

## 5. Technical notes

- Files involved: `src/services/bn/intake/claimWorkbasketResolver.ts`,
  `src/services/bn/intake/claimIntakeService.ts`,
  `src/services/bn/approvalLevelService.ts` (`assignClaimToWorkbasket`),
  `src/services/bn/workflow/resolveProductWorkflow.ts`,
  `src/pages/bn/claims/ClaimQueue.tsx`,
  `src/pages/bn/config/ProductCatalog.tsx`.
- Tables: `bn_claim_queue_assignment`, `bn_workbasket`,
  `bn_product_version_workflow`, `bn_workflow_template`.
- No new tables required; routing stays derived from workflow configuration.

## 6. Decision needed before building

Whether step-level re-routing should be driven by the claim's `status` mapped to
`steps_config[].step`, or whether the workflow templates should first be made
executable (`workflow_definition_id` linked) so the central engine owns routing.
The first is deliverable now; the second is the longer-term target.

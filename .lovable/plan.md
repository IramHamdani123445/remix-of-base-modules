# Benefits Claims — Workbasket, Roles and Notifications Documentation

Produce one authoritative reference explaining how a claim reaches a workbasket, how it is displayed there, how it moves to the next basket, who can see it, and what notifications fire.

## Deliverable

`docs/benefits/claims-workbaskets-roles-notifications.md` — business narrative first, technical annex last, so both operations staff and implementers can use the same document.

## Contents

### 1. Concepts
Claim, product version, workflow template and its steps, workflow step role, workbasket, queue assignment. States plainly that a claim's basket is derived from its product's workflow step — it is never a field on the claim.

### 2. How a claim reaches a basket
The resolution chain, end to end:

```text
claim.status            -> workflow step        (status -> step map)
product version+channel -> workflow template    (4-level fallback chain)
step role               -> workbasket           (category-specific, then general)
                        -> bn_claim_queue_assignment (due_at = assigned_at + SLA days)
```

Includes the channel normalisation rules (OFFLINE / ONLINE families) and the four-level template fallback, plus what happens when no workflow or no basket for the step's role exists (reported as a configuration gap, never guessed).

### 3. Status → step → basket table
A full table of every claim status, the step that owns it, the typical basket, and the disposition: routed to a step, HELD (draft, pending info, suspended — stays with the current owner), or TERMINAL (closed, denied, withdrawn — assignment closed, no new basket).

### 4. How a claim is displayed in a basket
Walkthrough of the Claim Queue screen: basket list scoped to the signed-in user's roles with live counts and overdue highlighting, auto-selection of the primary basket, the claim rows shown for the selected basket (claim number, claimant, product, status, assigned date, due date/SLA state, owning basket), the "My baskets / All baskets" toggle for oversight roles, the "Not in any queue" panel with the recorded reason and Re-route action, and each empty-state message and what it means.

### 5. How a claim moves to the next basket
Movement is a consequence of a status change, not a manual hand-off. Documents the routing outcomes (ASSIGNED, MOVED, UNCHANGED, CLOSED, HELD, UNROUTED, ERROR), that the previous assignment is closed and a new one opened with the new step's SLA, that routing is idempotent and never rolls back a committed transition, and the three entry points that trigger it: intake, every status transition, and the repair/backfill action. Includes a worked example following one claim from Intake through Eligibility, Evidence, Calculation, Decision, Award Setup and Payment to closure.

### 6. Roles and access
How basket ownership is expressed (basket role rows, with `assigned_role` as the legacy fallback), how the user's visible baskets are resolved, the role families involved (intake, eligibility, evidence/document, medical, calculation, decision/approval, award, payment, finance, oversight), the permissions required to open the queue and worklist, and the queue-access health check that detects a basket whose role cannot open the queue, with the reconcile action.

### 7. Notifications
Workbasket arrival alerts: what triggers them (a new queue assignment), who receives them (the roles that own the target basket), where they surface in the app, and how they relate to the Communication Hub — business modules never send directly; all outbound communication goes through the hub façade, which resolves template, branding, sender and channel.

### 8. Troubleshooting
Symptom → cause → action table: claim in no basket, claim stuck in the wrong basket, basket visible but empty, role cannot open the queue, step role with no basket configured, product version with no workflow mapping.

### 9. Technical annex
Tables (`bn_claim`, `bn_claim_queue_assignment`, `bn_workbasket`, `bn_workbasket_role`, `bn_workflow_template`, `bn_product_version_workflow`, `bn_product_channel_config`, `bn_product_version`), services (`routeClaimToWorkbasket`, `routeClaimAfterStatusChange`, `claimStatusStepMap`, `resolveProductWorkflow`, `claimWorkbasketResolver`, `channelNormalization`, `stageQueueReconciliation`), hooks (`useMyWorkbaskets`, `useBasketArrivalAlerts`, `useWorkbasketPermissionGaps`), RPCs and the queue screen file.

## Scope

Documentation only — no code, schema, or behaviour changes. Content is written from the current implementation, and any configuration gap it describes is stated as a gap, not as a fix.

# Claim → Workbasket Routing: Analysis and Remediation Plan (rev. 2)

## 1. How routing is designed to work

A claim's queue is a property of its **product**, not of the claim:

```text
claim.product_version_id + channel
  -> workflow template resolution (fallback chain, see 4A)
  -> bn_workflow_template.steps_config[n]   e.g. { step: "INTAKE", role: "CLERK", sla_days: 2 }
  -> step role mapped to a basket role      CLERK -> BN_INTAKE_OFFICER
  -> bn_workbasket WHERE assigned_role = basket role AND is_active
       (product_category-specific basket preferred, then a general one)
  -> bn_claim_queue_assignment (claim_id, workbasket_id, due_at = assigned_at + sla_days)
```

The Claim Queue screen is **`/bn/queue`** (`ClaimQueue.tsx`) and reads only
`bn_claim_queue_assignment` (active, not completed) joined to the basket.
**No assignment row = the claim appears in no workbasket**, whatever its status.

`/bn/claims` is `ClaimWorklist` — a status list with no workbasket column.
Showing claims by basket there is a separate change and is **not** in this plan.

There is no "workbasket" column on the product or on the workflow mapping — the
basket is derived from the workflow step's role. That derivation is the only
link between "workflow assigned to product" and "which basket the claim lands in".

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
| Versions with neither | 27 |
| `bn_product_channel_config` rows carrying a `workflow_template_id` | 54 of 95 |
| Workflow templates with an executable `workflow_definition_id` | **0 of 45** |
| Baskets for MEDICAL / INSPECTOR roles | **0** |

## 3. Root causes

1. **The table the Product Editor writes to is never read.**
   `bn_product_channel_config.workflow_template_id` (54 rows) is what the
   Application Channels tab saves; `resolveProductWorkflow` never references
   that table. This is why "I set the workflow template and nothing happened".
2. **Three channel vocabularies that do not match.**
   Intake passes `STAFF_OFFLINE`; `bn_product_channel_config` holds `OFFLINE`
   (51) / `ONLINE` (44); `bn_product_version_workflow` holds `ONLINE_PORTAL` (4);
   template `channel_code` is always null. Channel-specific matching therefore
   never fires — the four mapped versions survive only via `is_default`.
3. **Claims created outside `claimIntakeService` are never routed** — no
   assignment row, no backfill, no repair path.
4. **Routing happens once, at intake.** Always `steps_config[0]`. A claim never
   moves through the workflow's later baskets. Re-assignment exists only in the
   post-approval orchestrator and the escalation runner.
5. **Step-role vocabulary is narrow** — CLERK, OFFICER, SUPERVISOR, MANAGER,
   FINANCE only. `INSPECTOR` and `MEDICAL_BOARD` steps route nowhere, and no
   basket exists for either role, so mapping them today would move the failure
   rather than fix it.
6. **No executable workflow definitions** (0 of 45), so the central engine owns
   nothing. Status-driven routing proceeds now; the engine is a later swap.

## 4. Remediation

### A. Channel normalisation — first, everything depends on it
One exported function, used at every point a channel is compared. Derived from
values actually present, no new vocabulary invented:

```text
STAFF_OFFLINE, OFFLINE, STAFF_ASSISTED, COUNTER, WALK_IN -> OFFLINE
ONLINE, ONLINE_PORTAL, PORTAL, SELF_SERVICE              -> ONLINE
```

No call site re-spells the mapping. Test asserts every distinct `channel_code`
in the three tables, plus every channel string intake passes, normalises to a
known value.

### B. Workflow resolution fallback chain
`resolveProductWorkflow` gains `bn_product_channel_config` and normalised
channel matching, in this order:

1. `bn_product_version_workflow` — channel match, active, within effective dates
2. `bn_product_channel_config.workflow_template_id` for that channel — **new**
3. `bn_product_version_workflow` where `is_default = true`
4. `bn_product_version.workflow_template_id` (legacy)

Returns **which source answered**, surfaced in the intake result and the
"Not in any queue" panel.

### C. One routing service
`routeClaimToWorkbasket(claimId)` becomes the single entry point, used by
intake, status transitions and the repair action. When the central engine
becomes real, only this service changes.

### D. Status → step mapping and step-level re-routing
An **explicit** status → step table, not a name comparison — only three of the
two vocabularies' values overlap, and new claims currently carry status
`INTAKE`, which appears in neither list. The mapping covers all 16 claim
statuses plus `INTAKE`. A status that maps to nothing leaves the claim in its
**current** basket and records the reason; it is never dropped out of every
queue. Each transition closes the active assignment and opens the next with
that step's SLA.

### E. Role / basket gap made visible, not papered over
No map entries are added for `INSPECTOR` or `MEDICAL_BOARD` while no basket
carries those roles. The resolver reports three distinct findings:
"no workflow for this product/channel", "this step's role has no basket
configured", and "routed". Creating the baskets is a configuration decision
that can proceed in parallel.

### F. "Not in any queue" panel
On `/bn/queue`: open claims with no active assignment, the recorded reason, the
resolution source, and a Re-route action.

### G. Backfill — last
Routes existing unassigned open claims, only once A–D are proven. No undo, so it
does not run earlier.

## 5. Sequence

```text
0. Channel normalisation (A) + channel-config fallback (B)
1. routeClaimToWorkbasket, used by intake and transitions (C)
2. Status -> step mapping and step-level re-routing (D)
3. "Not in any queue" panel (F)
4. Backfill (G)
E (basket/role configuration) runs in parallel
```

## 6. Constraints

- **No database migration.** No changes to `bn_product.category`,
  `bn_product_channel_config` data, or any existing claim.
- The 27 product versions with no workflow mapping are a **configuration gap** —
  reported, never defaulted.
- No new tables; routing stays derived from workflow configuration.

## 7. Files involved

`src/services/bn/workflow/resolveProductWorkflow.ts`,
`src/services/bn/intake/claimWorkbasketResolver.ts`,
`src/services/bn/intake/claimIntakeService.ts`,
`src/services/bn/approvalLevelService.ts` (`assignClaimToWorkbasket`),
`src/pages/bn/claims/ClaimQueue.tsx`, `src/pages/bn/claims/ClaimRegistration.tsx`.
Tables read: `bn_claim_queue_assignment`, `bn_workbasket`,
`bn_product_version_workflow`, `bn_product_channel_config`,
`bn_product_version`, `bn_workflow_template`.

## 8. Verification to report back

- `npx tsc --noEmit` exits 0
- Full suite shows **24 failing test files and no more** (existing baseline)
- Unit tests: channel normaliser, every listed value
- Unit tests: status → step mapping, all 16 statuses plus `INTAKE`
- Post-change count of how many of the 64 claims resolve to a basket, how many
  do not, and the reason for each that does not

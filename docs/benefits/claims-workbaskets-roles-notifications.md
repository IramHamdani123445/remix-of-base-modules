# Benefit Claims — Workbaskets, Roles and Notifications

How a benefit claim reaches a workbasket, how it is displayed there, how it moves to the
next basket, who can see it, and what notifications fire.

Audience: Benefits operations staff (sections 1–8) and the implementation team
(section 9, technical annex).

---

## 1. Concepts

| Term | Meaning |
|---|---|
| **Claim** | One benefit application (`bn_claim`), with a lifecycle **status** and a **product version**. |
| **Product version** | The versioned benefit product the claim was filed against. It owns the workflow. |
| **Workflow template** | The ordered list of **steps** a claim of that product passes through (`steps_config`). |
| **Step** | One stage of work — INTAKE, ELIGIBILITY, EVIDENCE_REVIEW, CALCULATION, DECISION, AWARD_SETUP, PAYMENT, and so on. A step names a **role**, optionally an explicit workbasket, and an SLA. |
| **Workbasket** | An officer queue (`bn_workbasket`), owned by one or more BN roles, optionally restricted to a product category. |
| **Queue assignment** | The row that actually puts a claim in a basket (`bn_claim_queue_assignment`), with a priority and a due date. |

**A claim's basket is derived, never stored on the claim.** There is no "workbasket"
field on the claim or on the product. The basket is worked out each time from the
claim's status, its product's workflow, and the role that staffs the step.

**No queue assignment = the claim appears in no basket**, whatever its status. Such
claims are listed in the "Not in any queue" panel on the Claim Queue screen, never
silently lost.

---

## 2. How a claim reaches a basket

```text
claim.status              -> workflow step        (status -> step map)
product version + channel -> workflow template    (4-level fallback chain)
step                      -> workbasket           (explicit basket, else role, else stage role)
                          -> bn_claim_queue_assignment
                             (due_at = assigned_at + step SLA)
```

### 2.1 Channel normalisation

Channels are spelled differently in intake, in channel configuration and in the workflow
mapping, so every comparison is normalised first to one of two values:

| Normalised | Accepted spellings |
|---|---|
| **OFFLINE** | OFFLINE, STAFF_OFFLINE, STAFF_ASSISTED, ASSISTED_COUNTER, COUNTER, WALK_IN, BACK_OFFICE_ENTRY, MIGRATED_LEGACY |
| **ONLINE** | ONLINE, ONLINE_PORTAL, PORTAL, SELF_SERVICE, PUBLIC_ONLINE |

An unrecognised channel is reported as a gap; it is never guessed.

### 2.2 Workflow template fallback chain

The first of these that answers wins, and the answer records **which source** answered:

1. **Channel mapping** — `bn_product_version_workflow` row matching the normalised
   channel, active and within its effective dates.
2. **Channel configuration** — the workflow template set on the product version's
   Application Channels tab for that channel.
3. **Default mapping** — `bn_product_version_workflow` row marked as default.
4. **Legacy** — workflow template set directly on the product version.

If none answers: *"no workflow template is mapped to this product version and channel"* —
a configuration gap, reported on the claim, not defaulted.

### 2.3 Step → workbasket

For the step that owns the claim, in order:

1. **The step names a workbasket explicitly** (`workbasket_id` on the step). Most
   precise; used whenever present and the basket is still active.
2. **The step names a role.** A `BN_*` role is used as-is; a generic workflow role is
   translated: CLERK → BN_INTAKE_OFFICER, OFFICER → BN_ELIGIBILITY_OFFICER,
   SUPERVISOR → BN_SUPERVISOR, MANAGER → BN_MANAGER, FINANCE → BN_PAYMENT_OFFICER.
3. **The step name itself implies an owner**, used when the template does not declare
   that step: INTAKE and EMPLOYER_VERIFY → BN_INTAKE_OFFICER, ELIGIBILITY and MEANS_TEST
   → BN_ELIGIBILITY_OFFICER, EVIDENCE_REVIEW → BN_DOCUMENT_OFFICER, CALCULATION →
   BN_CALCULATION_OFFICER, DECISION → BN_SUPERVISOR, AWARD_SETUP → BN_AWARD_OFFICER,
   PAYMENT → BN_PAYMENT_OFFICER.

Among the active baskets carrying that role, a basket restricted to the claim's product
category is preferred, then a general basket. If several baskets share the role and none
names the stage (for example BN_PAYMENT_OFFICER staffs both Payment Preparation and
Payment Issue), the ambiguity is **reported** — *"name the workbasket explicitly on this
workflow step"* — rather than resolved by guesswork.

### 2.4 Due date

`due_at` = assignment time + the step's SLA (`sla_days`, or `sla_hours` for templates
authored in the designer). A step with no SLA produces an assignment with no due date,
and the escalation runner then has nothing to watch.

---

## 3. Status → step → basket

| Claim status | Disposition | Step | Typical basket owner |
|---|---|---|---|
| DRAFT | HOLD — not yet submitted | — | — |
| SUBMITTED | Routed | INTAKE | BN_INTAKE_OFFICER |
| INTAKE | Routed | INTAKE | BN_INTAKE_OFFICER |
| INTAKE_REVIEW | Routed | INTAKE | BN_INTAKE_OFFICER |
| ELIGIBILITY_CHECK | Routed | ELIGIBILITY | BN_ELIGIBILITY_OFFICER |
| EVIDENCE_REVIEW | Routed | EVIDENCE_REVIEW | BN_DOCUMENT_OFFICER |
| CALCULATION | Routed | CALCULATION | BN_CALCULATION_OFFICER |
| DECISION | Routed | DECISION | BN_SUPERVISOR |
| APPROVED | Routed | AWARD_SETUP | BN_AWARD_OFFICER |
| AWARD_SETUP | Routed | AWARD_SETUP | BN_AWARD_OFFICER |
| PAYMENT_QUEUE | Routed | PAYMENT | BN_PAYMENT_OFFICER |
| IN_PAYMENT | Routed | PAYMENT | BN_PAYMENT_OFFICER |
| PENDING_INFO | HOLD — waiting on information | — | stays with current owner |
| SUSPENDED | HOLD — suspended | — | stays with current owner |
| APPROVED_CLOSED | TERMINAL — closed | — | assignment closed |
| CLOSED | TERMINAL — closed | — | assignment closed |
| DENIED | TERMINAL — denied | — | assignment closed |
| WITHDRAWN | TERMINAL — withdrawn | — | assignment closed |

Three dispositions, and the difference matters:

- **Routed** — a step owns the claim; the claim moves to that step's basket.
- **HOLD** — no step owns it right now. The claim **keeps its current basket** and the
  reason is recorded. It is never dropped out of every queue.
- **TERMINAL** — the claim is finished. The active assignment is closed and no new one
  is opened; the claim leaves the queues.

An unrecognised status HOLDs, with the reason *"claim status X is not mapped to a
workflow step"*. It is never treated as an error and never unroutes the claim.

---

## 4. How a claim is displayed in a basket

Screen: **Benefit Management → Claim Queue** (`/bn/queue`).

### Basket list (left)

- Lists the workbaskets the signed-in user serves through their effective roles
  (direct, bundle and delegated).
- Each basket shows a **live count** of active, uncompleted assignments, with overdue
  items highlighted, and a badge for unread **new arrival** alerts.
- **My baskets / All baskets** toggle appears only for oversight roles
  (BN_SUPERVISOR, BN_MANAGER, BN_DIRECTOR, BN_CONFIG_ADMIN, Admin).
- On load a basket is selected automatically: the user's primary basket if it holds
  work, otherwise the first basket that holds work, otherwise the primary or first
  basket. The claim list is therefore populated immediately after sign-in.
- Opening a basket clears that basket's unread arrival alerts for this user.

### Claim rows (right)

| Column | Content |
|---|---|
| Claim | Claim number, linking to the claim file |
| SSN | Claimant social security number |
| Status | Status badge, plus a line reading *"<STAGE> stage · <Basket> queue"*, or *"Parked with current owner"* for a HOLD status, or *"No stage owns this claim"* |
| Priority | P1–P9; P1–P2 shown as critical, P3–P4 as elevated |
| Due | Due date, shown in red with a warning marker when overdue; the whole row is tinted when overdue |
| Assigned To | The officer who picked the claim, or *Unassigned* |
| Actions | **Pick** (take ownership), **Release** (return to the basket, owner only), and open-claim |

**Stage / queue mismatch.** Status (lifecycle stage) and basket (officer queue) are two
different truths. When the owning basket does not serve the stage the status implies, the
row is marked *Stage / queue mismatch* rather than the disagreement being hidden — it
means the workflow step for that stage names the wrong queue, or declares no step at all.

### Other panels

- **My Assigned Claims** — claims this user has picked, across baskets.
- **Not in any queue** — open claims with no active assignment, each with the recorded
  reason and a **Re-route** action.

### Empty states and what they mean

| Message | Meaning |
|---|---|
| "Select a workbasket to view claims" | No basket selected yet. |
| "No claims currently in <basket>" | The basket is correctly configured and simply empty. |
| "No workbasket is configured for your role (<roles>)" | The user's roles exist but no active basket carries them — a configuration gap. |
| "You hold no benefits role, so no workbasket is assigned to you" | The user has no BN role at all. |
| "You have no personal workbasket — switch to All baskets…" | Oversight user with no basket of their own. |

---

## 5. How a claim moves to the next basket

**Movement is a consequence of a status change, not a manual hand-off.** No one drags a
claim between baskets; an officer completes their work, the claim's status changes, and
routing re-derives the owning basket from the new status.

Every status change calls the router immediately after the transition commits. The router:

1. Reads the claim's status, product version, channel and category.
2. Reads the assignment currently in force, if any.
3. Maps status → step → basket (section 2).
4. Closes the stale assignment and opens the new one, with the new step's SLA.

### Outcomes

| Outcome | Meaning |
|---|---|
| **ASSIGNED** | The claim had no assignment; one was created. |
| **MOVED** | Closed the previous assignment and opened one in the new basket. |
| **UNCHANGED** | Already in the right basket; nothing written. |
| **CLOSED** | Terminal status; the open assignment was closed and none opened. |
| **HELD** | Deliberately left where it is (draft, pending info, suspended). |
| **UNROUTED** | Configuration gap — reported with a reason, never guessed. |
| **ERROR** | Something failed; the claim keeps whatever assignment it had. |

Two properties are guaranteed:

- **Routing never fails a business transition.** The status change is already committed
  when routing runs. The worst acceptable outcome is a claim that stays in its previous
  basket and is listed in "Not in any queue" — never a transition that appears to have
  failed or rolled back.
- **Routing is idempotent.** A claim already in the right basket is left untouched, so it
  is safe to call on every transition and to re-run over the whole population.

### The three entry points

1. **Intake** — when a claim is submitted.
2. **Every status transition** — the standard path.
3. **Repair / backfill** — the Re-route action on the "Not in any queue" panel, and the
   maintenance script, both of which produce exactly the same result as the other two.

### Worked example

A sickness benefit claim filed at the counter (channel STAFF_OFFLINE → OFFLINE):

| # | Status after the officer's action | Step | Basket | Assignment |
|---|---|---|---|---|
| 1 | SUBMITTED | INTAKE | Intake Review (BN_INTAKE_OFFICER) | ASSIGNED, due = now + intake SLA |
| 2 | ELIGIBILITY_CHECK | ELIGIBILITY | Eligibility Review (BN_ELIGIBILITY_OFFICER) | MOVED |
| 3 | PENDING_INFO (documents requested) | — | stays in Eligibility Review | HELD |
| 4 | EVIDENCE_REVIEW (documents received) | EVIDENCE_REVIEW | Document Review (BN_DOCUMENT_OFFICER) | MOVED |
| 5 | CALCULATION | CALCULATION | Calculation (BN_CALCULATION_OFFICER) | MOVED |
| 6 | DECISION | DECISION | Decision / Approval (BN_SUPERVISOR) | MOVED |
| 7 | APPROVED | AWARD_SETUP | Award Setup (BN_AWARD_OFFICER) | MOVED |
| 8 | PAYMENT_QUEUE | PAYMENT | Payment Preparation (BN_PAYMENT_OFFICER) | MOVED |
| 9 | IN_PAYMENT | PAYMENT | Payment Issue (BN_PAYMENT_OFFICER) | MOVED |
| 10 | APPROVED_CLOSED | — | — | CLOSED — leaves all queues |

At each move the officers who staff the receiving basket get an arrival notification
(section 7).

---

## 6. Roles and access

### Who owns a basket

- Preferred: **basket role rows** (`bn_workbasket_role`) — a basket may be owned by
  several roles.
- Legacy fallback: the basket's single `assigned_role`, used only when the basket has no
  role rows, so older baskets are not silently invisible.

### Which baskets a user sees

Resolved from the user's **effective roles** — direct role grants, role bundles and
active delegations — matched against the basket's owning roles. Oversight roles can
additionally switch to **All baskets**.

### Role families

| Family | Typical roles |
|---|---|
| Intake | BN_INTAKE_OFFICER |
| Eligibility / means | BN_ELIGIBILITY_OFFICER |
| Evidence / documents | BN_DOCUMENT_OFFICER |
| Calculation | BN_CALCULATION_OFFICER |
| Decision / approval | BN_SUPERVISOR, BN_MANAGER |
| Award | BN_AWARD_OFFICER |
| Payment / finance | BN_PAYMENT_OFFICER, BN_FINANCE_SUPERVISOR |
| Oversight | BN_SUPERVISOR, BN_MANAGER, BN_DIRECTOR, BN_CONFIG_ADMIN, Admin |

Medical and inspection steps (MEDICAL_REVIEW / INSPECTOR / MEDICAL_BOARD) have no basket
in the catalogue today. Claims reaching those steps are reported as a configuration gap
rather than routed to an approximate basket; creating those baskets is a configuration
decision.

### Permissions

- **`bn_claim_queue` — view** is required to open the Claim Queue.
- **`bn_claim_worklist` — view** is required for the claim list.

Every role that owns an active basket must hold both, otherwise its basket exists but
nobody can open it.

### Queue access health check

**Benefits → Configuration → Workbasket Configuration** carries a *Queue Access Health*
panel:

- Green when every active basket role can open the queue.
- Otherwise a table of gaps: role, basket, missing module, and whether the role exists at
  all (a basket pointing at a non-existent role is a configuration error).
- **Reconcile access** grants the missing view permissions for basket-owning roles. It
  only ever grants view access, and never revokes anything, so no role gains authority
  beyond seeing its own basket.

The same check is reported as a finding by the Benefits configuration validation, so a
newly created basket with an ungranted role is caught at configuration time rather than
becoming an invisible queue.

---

## 7. Notifications

### Workbasket arrival alerts

**Trigger.** Creating an active queue assignment — that is, any ASSIGNED or MOVED
outcome — fires the database trigger on `bn_claim_queue_assignment`. Nothing needs to be
called from the UI, so a claim routed by intake, by a transition or by the repair action
all notify identically.

**Recipients.** Every user holding a role that owns the target basket (basket role rows,
falling back to `assigned_role` when the basket has none). The **actor who caused the
move is excluded** — you are not notified about work you just handed on. One notification
per user per assignment; a repeat write cannot duplicate it.

**Content.** Each basket can carry its own wording (`notify_title`, `notify_body`,
`notify_action_label`) using the tokens `{claim_number}`, `{benefit}`, `{status}`,
`{step}`, `{basket_name}`, `{basket_code}`, `{due_date}`, `{priority}`. Without custom
wording the default is *"Action required in <basket>"* with the claim number, benefit,
status and due date. Priority is **critical** when already overdue, **high** at priority
8 or above, otherwise **normal**.

**Where they surface.** In the notification bell and the user inbox, deep-linking to the
claim with its basket and step, and as an unread-arrival badge on the basket in the Claim
Queue. Opening the basket marks its arrivals read.

**Safety.** The trigger never blocks routing: any failure is logged as a warning and the
assignment still succeeds.

### Relationship to the Communication Hub

Arrival alerts are **internal in-app notifications to staff**. All *outbound*
communication to claimants and employers — email, SMS, WhatsApp, print — goes through the
Communication Hub façade. Benefits never chooses a template, sender or channel and never
enqueues or dispatches directly; the Hub resolves template, version, branding,
letterhead, signature, sender identity, approval requirement, queueing, dispatch, retry
and logging.

---

## 8. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Claim appears in no basket | No workflow mapped to the product version + channel; or the step's role has no active basket | Open **Not in any queue** on `/bn/queue`, read the recorded reason, fix the configuration, then **Re-route** |
| Claim stuck in the previous basket | Status is a HOLD (draft, pending info, suspended) — expected; or a transition wrote a status not in the mapping | Check the status; the row shows *Parked with current owner* or *No stage owns this claim* |
| Row shows *Stage / queue mismatch* | The workflow step for that stage names a basket that does not serve it, or the template omits the step | Correct the step's workbasket / role on the workflow template, then re-route the claim |
| Basket is listed but always empty | No claim currently maps to that step, or the routing prefers a category-specific basket | Compare the basket's role and product category against the workflow steps in use |
| Role cannot open the Claim Queue | Role lacks `bn_claim_queue` / `bn_claim_worklist` view | Workbasket Configuration → Queue Access Health → **Reconcile access** |
| Reported "role has no matching workbasket role" | Step role outside the mapped vocabulary (for example INSPECTOR, MEDICAL_BOARD) | Create a basket for that role, or set the step's role to a staffed BN role |
| Reported "shared by N active workbaskets" | Several baskets share the step's role and none names the stage | Name the workbasket explicitly on the workflow step |
| Product version with no workflow mapping | Configuration gap — never defaulted | Map a workflow template on the product version or its Application Channels tab |

---

## 9. Technical annex

### Tables

| Table | Role in routing |
|---|---|
| `bn_claim` | Status, product version, application channel |
| `bn_claim_queue_assignment` | The assignment: claim, workbasket, priority, `due_at`, `is_active`, `completed_at`, `picked_at`, `assigned_to` |
| `bn_workbasket` | Basket catalogue: `basket_code`, `basket_name`, `assigned_role`, `product_category`, `is_active`, `notify_title`, `notify_body`, `notify_action_label` |
| `bn_workbasket_role` | Multi-role basket ownership |
| `bn_workflow_template` | `steps_config` — step, role, `workbasket_id`, `sla_days` / `sla_hours` |
| `bn_product_version_workflow` | Channel and default workflow mappings |
| `bn_product_channel_config` | Workflow template set on the Application Channels tab |
| `bn_product_version` | Legacy version-level `workflow_template_id` |
| `in_app_notifications` | Arrival alerts, type `BN_WORKBASKET_ARRIVAL` |
| `v_bn_user_effective_roles` | Effective role resolution for visibility and notification fan-out |

### Services and hooks

| Module | Responsibility |
|---|---|
| `src/services/bn/workflow/routeClaimToWorkbasket.ts` | The single routing entry point; returns the outcome and reason |
| `src/services/bn/workflow/routeClaimAfterStatusChange.ts` | Wrapper called after every status write; can never fail a transition |
| `src/services/bn/workflow/claimStatusStepMap.ts` | Status → step / HOLD / TERMINAL |
| `src/services/bn/workflow/resolveProductWorkflow.ts` | Four-level template fallback chain and its source label |
| `src/services/bn/intake/claimWorkbasketResolver.ts` | Step → basket, step-role and step-name maps, SLA and `due_at` |
| `src/services/bn/workflow/channelNormalization.ts` | ONLINE / OFFLINE normalisation |
| `src/services/bn/workflow/stageBasketExpectation.ts` | Which basket serves which stage; ambiguity detection |
| `src/services/bn/workflow/stageQueueReconciliation.ts` | Stage vs queue agreement reporting |
| `src/services/bn/workbasketRoleService.ts` | `fetchWorkbasketsForUser`, with `assigned_role` fallback |
| `src/hooks/bn/useMyWorkbaskets.ts` | Role-scoped basket list |
| `src/hooks/bn/useBnWorkbasket.ts` | `useBasketClaimCounts` — live per-basket counts |
| `src/hooks/bn/useBasketArrivalAlerts.ts` | Unread arrival counts and clear-on-open |
| `src/hooks/bn/useWorkbasketPermissionGaps.ts` | Queue access gaps and reconcile |
| `src/pages/bn/claims/ClaimQueue.tsx` | The Claim Queue screen |
| `scripts/bn/repair-claim-workbasket-routing.ts` | Backfill / repair over the population |

### Database functions

| Function | Purpose |
|---|---|
| `bn_workbaskets_for_user(p_user_id)` | Baskets visible via direct, bundle and delegated roles |
| `bn_workbasket_permission_gaps()` | One row per basket role lacking queue access; zero rows is healthy |
| `bn_sync_workbasket_queue_permissions()` | Grants the missing view permissions; grant-only, audited |
| `bn_notify_workbasket_arrival()` / trigger `zz_bn_claim_queue_assignment_notify` | Arrival notification fan-out on assignment insert |
| `bn_render_workbasket_notification(template, tokens)` | Token substitution for basket-specific wording |

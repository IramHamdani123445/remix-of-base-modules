# Claims and Workbaskets in Benefit Management

A reference for how a benefit claim travels through workbaskets, who owns it at each stage, and how officers are notified.

Everything here describes **what is implemented today**. Table names, column names, functions and file paths were verified against the live database and the current code before being written down. Where behaviour is a known gap, it is stated as a gap rather than as an intention.

---

## 1. How to read this

Two readers are addressed:

| Reader | Cares about |
| --- | --- |
| **Configurator** — sets up products, workflow templates, workbaskets, roles | Sections 2, 4, 6, 7, 8 and the "Configurator" notes |
| **Officer** — works claims daily | Sections 3, 5, 6, 9, 10, 11 |

Paragraphs that only matter to one reader are marked **Configurator:** or **Officer:**.

Every subsection that describes something that can go wrong ends with a **Check this yourself** query. All of them are read-only `SELECT`s and can be run from the SQL console.

---

## 2. The workbasket catalogue

A workbasket is a named queue owned by a role. The catalogue is one table.

### 2.1 `bn_workbasket`

| Column | Meaning |
| --- | --- |
| `id` | Primary key; what a workflow step or an assignment points at. |
| `basket_code` | Stable machine code, e.g. `BN_INTAKE_REVIEW`. Used in deep links and in stage-matching. |
| `basket_name` | Display name shown in the queue screen, e.g. `Intake Review`. |
| `description` | Free text for configurators. Not used by routing. |
| `assigned_role` | **The single role routing uses.** A step that resolves to this role routes here. Also the role the permission-sync helpers grant screen access to. |
| `product_category` | Optional restriction, e.g. `SHORT_TERM`, `LEGAL`. When a product declares a category, baskets in that category are preferred over general (null-category) ones. |
| `country_code` | Jurisdiction tag. Not used by claim routing today. |
| `priority_rules` | JSON placeholder for priority scoring. Not consumed by the routing service today. |
| `max_capacity` | Advisory ceiling on concurrent items. **Gap: routing does not enforce it** — a basket over capacity still receives claims. |
| `is_active` | Inactive baskets are invisible to routing and to `bn_workbaskets_for_user`. A step pointing at an inactive basket falls through to role-based resolution. |
| `supervisor_role` | Role treated as supervising the basket. Used by escalation configuration, not by routing. |
| `manager_role` | Role treated as managing the basket. Same scope as above. |
| `allow_auto_reassign` | Flag for automated reassignment behaviour. |
| `escalation_target_basket_id` | Basket an overdue item escalates into. Read by the escalation runner, not by claim routing. |
| `default_escalation_policy_id` | Escalation policy applied when the item has no policy of its own. |
| `notify_title`, `notify_body`, `notify_action_label` | Arrival-notification templates for this basket (section 6). |
| `entered_by`, `entered_at`, `modified_by`, `modified_at` | Audit columns. |

### 2.2 `bn_workbasket_role` vs `assigned_role`

They answer two different questions.

| | `bn_workbasket.assigned_role` | `bn_workbasket_role` |
| --- | --- | --- |
| Cardinality | Exactly one role per basket | Many roles per basket (`workbasket_id`, `role_name`, `is_primary`) |
| Used by | **Routing** — `resolveClaimWorkbasket` matches a step's role against this column | **Visibility** — `bn_workbaskets_for_user(p_user_id)` joins here |
| Used by | Permission sync (`bn_sync_workbasket_queue_permissions`) | Notification fan-out (`bn_notify_workbasket_arrival`) |

So: a claim is *routed* by `assigned_role`, but the set of people who *see* the basket and get *notified* comes from `bn_workbasket_role` — with `assigned_role` used as a fallback when a basket has no `bn_workbasket_role` rows at all.

**Configurator:** if you add a role to `bn_workbasket_role` but not to `assigned_role`, that role sees and is notified about the basket but nothing routes to it by that role name.

**Check this yourself** — baskets whose role list does not include their own routing role:

```sql
SELECT w.basket_code, w.assigned_role
FROM bn_workbasket w
WHERE w.is_active
  AND w.assigned_role IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bn_workbasket_role r
    WHERE r.workbasket_id = w.id AND r.role_name = w.assigned_role);
```

### 2.3 The live claim-processing baskets

| `basket_code` | `basket_name` | `assigned_role` |
| --- | --- | --- |
| `BN_INTAKE_REVIEW` | Intake Review | `BN_INTAKE_OFFICER` |
| `BN_ELIGIBILITY_REVIEW` | Eligibility Review | `BN_ELIGIBILITY_OFFICER` |
| `BN_ELIGIBILITY_OVERRIDE_REVIEW` | Eligibility Override Review | `BN_SENIOR_ELIGIBILITY_OFFICER` |
| `BN_DOCUMENT_REVIEW` | Document Review | `BN_DOCUMENT_OFFICER` |
| `BN_CALCULATION_REVIEW` | Calculation Review | `BN_CALCULATION_OFFICER` |
| `BN_CLAIM_RECOMMENDATION` | Claim Recommendation | `BN_CLAIMS_OFFICER` |
| `BN_SUPERVISOR_APPROVAL` | Supervisor Approval | `BN_SUPERVISOR` |
| `BN_MANAGER_APPROVAL` | Manager Approval | `BN_MANAGER` |
| `BN_DIRECTOR_APPROVAL` | Director Approval | `BN_DIRECTOR` |
| `BN_AWARD_SETUP` | Award Setup | `BN_AWARD_OFFICER` |
| `BN_PAYMENT_PREPARATION` | Payment Preparation | `BN_PAYMENT_OFFICER` |
| `BN_PAYMENT_ISSUE` | Payment Issue | `BN_PAYMENT_OFFICER` |
| `BN_PAYMENT_APPROVAL` | Payment Approval | `BN_FINANCE_SUPERVISOR` |

Other baskets exist in the same table for product governance, rule authoring and Legal; they are not claim-processing queues.

Note that `BN_PAYMENT_PREPARATION` and `BN_PAYMENT_ISSUE` **share one role**. Section 4.5 explains how that ambiguity is handled.

---

## 3. The claim lifecycle at a glance

```text
   claim.status                 workflow step             workbasket                assignment row
  ──────────────               ──────────────           ─────────────          ─────────────────────
   bn_claim.status   ──(1)──▶   steps_config    ──(2)──▶  bn_workbasket  ──(3)──▶ bn_claim_queue_assignment
                                 entry                     (is_active)              is_active = true
                                                                                    assigned_to = NULL
                                                                                    due_at = SLA
        │                             │                         │                          │
        │ (1) stepForClaimStatus      │ (2) resolveClaimWorkbasket                         │ (4) trigger
        │     STEP / HOLD / TERMINAL  │     step.workbasket_id                             ▼
        │                             │     → assigned_role / role            zz_bn_claim_queue_assignment_notify
        │                             │     → STEP_ROLE_TO_BASKET_ROLE                     │
        │                             │     → STEP_NAME_TO_BASKET_ROLE                     ▼
        │                             │                                          in_app_notifications
        ▼                                                                        BN_WORKBASKET_ARRIVAL
   every status write calls routeClaimAfterStatusChange()
```

Flow in words:

1. The claim's **status** decides which workflow **step** owns it now.
2. The product's workflow **template** says who owns that step, which resolves to a **workbasket**.
3. The old assignment is closed and a new one is opened — in one operation.
4. A database trigger notifies everyone holding the basket's roles.

---

## 4. How a claim reaches a basket

### 4.1 Status → step (`claimStatusStepMap.stepForClaimStatus`)

`src/services/bn/workflow/claimStatusStepMap.ts` returns one of three outcomes:

| Outcome | Meaning | Effect on the queue |
| --- | --- | --- |
| `STEP` | A workflow step owns the claim; route to that step's basket. | Assignment is created or moved. |
| `HOLD` | No step owns the claim right now. | The claim **keeps its current basket**; the reason is recorded. It is never dropped out of every queue. |
| `TERMINAL` | The claim is finished. | Any active assignment is closed; no new one is opened. |

The mapping as implemented:

| Status | Outcome | Step / reason |
| --- | --- | --- |
| `DRAFT` | HOLD | still a draft, not submitted |
| `SUBMITTED` | STEP | `INTAKE` |
| `INTAKE` | STEP | `INTAKE` (written by `bn_submit_claim_application`; not referenced by any transition rule) |
| `INTAKE_REVIEW` | STEP | `INTAKE` |
| `ELIGIBILITY_CHECK` | STEP | `ELIGIBILITY` |
| `EVIDENCE_REVIEW` | STEP | `EVIDENCE_REVIEW` |
| `CALCULATION` | STEP | `CALCULATION` |
| `DECISION` | STEP | `DECISION` |
| `APPROVED` | STEP | `AWARD_SETUP` |
| `AWARD_SETUP` | STEP | `AWARD_SETUP` |
| `PAYMENT_QUEUE` | STEP | `PAYMENT` |
| `IN_PAYMENT` | STEP | `PAYMENT` |
| `PENDING_INFO` | HOLD | waiting on information, stays with its current owner |
| `SUSPENDED` | HOLD | suspended, stays with its current owner |
| `APPROVED_CLOSED`, `CLOSED` | TERMINAL | closed |
| `DENIED` | TERMINAL | denied |
| `WITHDRAWN` | TERMINAL | withdrawn |

An **unrecognised status HOLDs** — it never silently unroutes a claim.

### 4.2 Product + channel → workflow template (`resolveProductWorkflow`)

Resolution order, first match wins:

| Order | Source | Where it is configured |
| --- | --- | --- |
| 1 | `bn_product_version_workflow` row whose `channel_code` matches, `is_active`, within `effective_from` / `effective_to` | Product version workflow mapping |
| 2 | `bn_product_channel_config.workflow_template_id` for that channel | Product Editor → Application Channels tab |
| 3 | `bn_product_version_workflow` row with `is_default = true` | Default mapping |
| 4 | `bn_product_version.workflow_template_id` | Legacy product-level fallback |

Channel codes are compared through `normalizeChannelCode` (`src/services/bn/workflow/channelNormalization.ts`) because the three tables spell channels differently; a raw string comparison would never match.

If none of the four match, routing reports *"no workflow template is mapped to this product version and channel"* and the claim is left where it is.

**Check this yourself** — product versions with no legacy fallback template (they must be covered by mapping or channel config):

```sql
SELECT pv.id, pv.workflow_template_id
FROM bn_product_version pv
WHERE pv.workflow_template_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM bn_product_version_workflow w
                  WHERE w.product_version_id = pv.id AND w.is_active);
```

### 4.3 Two step vocabularies in `bn_workflow_template.steps_config`

`steps_config` is JSON. Two generations of authoring wrote it, and both are read:

| Concept | Seeded templates | Editor-built templates (Workflow Template Editor) |
| --- | --- | --- |
| Step name | `step` | `step_code` / `step_name` |
| Owning role | `role` (generic, e.g. `CLERK`) | `assigned_role` (BN role, e.g. `BN_INTAKE_OFFICER`) |
| Explicit basket | *not present* | `workbasket_id` |
| SLA | `sla_days` | `sla_hours` |

The code matches a step by **any** of `step`, `step_code`, `step_name` (`stepAliases` / `stepByName`), and prefers `assigned_role` over `role`.

### 4.4 Step → workbasket: resolution order in `resolveClaimWorkbasket`

`src/services/bn/intake/claimWorkbasketResolver.ts`, in order:

| # | Rule | Result `source` |
| --- | --- | --- |
| 1 | The step names its own `workbasket_id`, and that basket exists and is not inactive. | `STEP_WORKBASKET` |
| 2 | The step's `assigned_role` / `role` — used as-is if it already starts with `BN_`. | `STEP_ASSIGNED_ROLE` |
| 3 | `STEP_ROLE_TO_BASKET_ROLE` — maps a generic step role to a BN basket role. | `STEP_ASSIGNED_ROLE` / `WORKFLOW_FIRST_STEP` |
| 4 | `STEP_NAME_TO_BASKET_ROLE` — **hardcoded fallback keyed by the step name**, used when the template does not declare that step. | `WORKFLOW_FIRST_STEP` |
| — | Nothing matched. | `NONE` with a `reason` |

`STEP_ROLE_TO_BASKET_ROLE` (step role → basket role):

| Step role | Basket role |
| --- | --- |
| `CLERK` | `BN_INTAKE_OFFICER` |
| `OFFICER` | `BN_ELIGIBILITY_OFFICER` |
| `SUPERVISOR` | `BN_SUPERVISOR` |
| `MANAGER` | `BN_MANAGER` |
| `FINANCE` | `BN_PAYMENT_OFFICER` |

The table is deliberately narrow. `SYSTEM` steps have no human queue; `INSPECTOR` and `MEDICAL_BOARD` have no basket in the catalogue, and are reported as configuration gaps rather than routed to an approximate basket.

`STEP_NAME_TO_BASKET_ROLE` (step name → basket role) — **the hardcoded fallback**:

| Step | Basket role |
| --- | --- |
| `INTAKE` | `BN_INTAKE_OFFICER` |
| `EMPLOYER_VERIFY` | `BN_INTAKE_OFFICER` |
| `ELIGIBILITY` | `BN_ELIGIBILITY_OFFICER` |
| `EVIDENCE_REVIEW` | `BN_DOCUMENT_OFFICER` |
| `MEANS_TEST` | `BN_ELIGIBILITY_OFFICER` |
| `CALCULATION` | `BN_CALCULATION_OFFICER` |
| `DECISION` | `BN_SUPERVISOR` |
| `AWARD_SETUP` | `BN_AWARD_OFFICER` |
| `PAYMENT` | `BN_PAYMENT_OFFICER` |

**Be explicit about this:** most seeded templates declare only the `INTAKE` step. When a claim reaches ELIGIBILITY, CALCULATION, DECISION, AWARD_SETUP or PAYMENT and the template does not declare that step, **this hardcoded table answers instead of the template**. Such an assignment has **no SLA** — the step it came from does not exist, so there is no `sla_days` or `sla_hours` to read, and `due_at` is `NULL`. Escalation has nothing to watch on those claims.

**Configurator:** to get real SLAs and explicit ownership, declare every step in the template with a `workbasket_id` and an `sla_hours` (or `sla_days`).

### 4.5 Choosing between baskets that share a role

Candidate baskets are filtered to `assigned_role = <resolved role>` and `is_active = true`, then narrowed:

1. baskets matching the product's `product_category`, else
2. baskets with no `product_category`, else
3. all candidates.

If more than one survives, `pickBasketForStage` (`src/services/bn/workflow/stageBasketExpectation.ts`) prefers the basket whose `basket_code` names the stage. If the stage names none — the `BN_PAYMENT_PREPARATION` / `BN_PAYMENT_ISSUE` case — routing **reports the ambiguity instead of guessing**, and asks that the step name the basket explicitly.

### 4.6 How `due_at` is derived

| Step declares | `due_at` |
| --- | --- |
| `sla_days = n` | `assigned_at + n days` |
| `sla_hours = n` (and no `sla_days`) | `assigned_at + n hours` |
| neither, or the step is not declared at all | `NULL` |

`sla_days` wins when both are present. `slaDays` in the result is reported as `hours / 24` when only hours are given.

---

## 5. Assignment records

### 5.1 `bn_claim_queue_assignment`

| Column | Meaning |
| --- | --- |
| `id` | Primary key. Carried into the notification metadata as `assignment_id`. |
| `claim_id` | The claim. |
| `workbasket_id` | The basket that owns it. |
| `assigned_to` | The officer who picked it, or `NULL` for an unclaimed item. |
| `assigned_at` | When the claim entered this basket. |
| `priority` | Numeric priority; `>= 8` raises the arrival notification to `high`. |
| `due_at` | SLA deadline from section 4.6. A past `due_at` raises the notification to `critical`. |
| `picked_at` | When an officer took ownership. |
| `completed_at` | Set when the assignment is closed. |
| `is_active` | `true` for exactly one row per claim at a time. |

### 5.2 One active basket, always

`assignClaimToWorkbasket` (`src/services/bn/approvalLevelService.ts`) **closes the old assignment and opens the new one in the same operation** — the previous row gets `is_active = false` and `completed_at = now()` before the new row is inserted. A claim therefore never counts in two baskets at once, and basket counts always sum to the number of live claims.

Routing calls it with `{ assignedTo: null, dueAt: <step SLA> }`.

### 5.3 Unclaimed vs picked

| | Unclaimed | Picked |
| --- | --- | --- |
| `assigned_to` | `NULL` | the officer's user id |
| `picked_at` | `NULL` | timestamp |
| Who sees it | **everyone holding a role on the basket** | still in the basket, but shown as owned |
| Purpose | a shared pool of work | prevents two officers working the same claim |

**Officer:** a newly routed claim is always unclaimed. Picking it is what tells colleagues you have it.

**Check this yourself** — any claim active in more than one basket (should return zero rows):

```sql
SELECT claim_id, count(*)
FROM bn_claim_queue_assignment
WHERE is_active
GROUP BY claim_id
HAVING count(*) > 1;
```

---

## 6. Routing on every status change

### 6.1 `routeClaimAfterStatusChange`

`src/services/bn/workflow/routeClaimAfterStatusChange.ts` is the hook every claim status writer calls immediately after a successful status update. Its only job is to make routing **non-blocking**:

- The status transition is already committed when routing runs.
- A routing gap — a product with no workflow, a step whose role has no basket, a shared-role ambiguity — is caught, logged with `console.warn`, and returned as a reason.
- **A routing failure never rolls back or fails a valid business transition.** The worst acceptable outcome is a claim that stays in its previous basket and is reported by the queue's "Not in any queue" panel.

Called from:

| Caller | When |
| --- | --- |
| `src/hooks/useWorkflowActions.ts` | any action button on the claim screen |
| `src/services/bn/decisionEngine.ts` | approve / deny |
| `src/services/bn/determinationService.ts` | determination outcomes |
| `src/services/bn/approvalConsoleService.ts` | approval console decisions |
| `src/services/bn/entitlementService.ts`, `CreateEntitlementDialog.tsx` | entitlement creation |
| `src/services/bn/postApprovalOrchestrator.ts` | post-approval orchestration |
| `src/services/bn/postIssueService.ts` | after payment issue |
| `src/services/bn/intake/claimIntakeService.ts` | first assignment at intake |

### 6.2 Routing outcomes

`routeClaimToWorkbasket` returns one of:

| Outcome | Meaning |
| --- | --- |
| `ASSIGNED` | The claim had no active assignment and now has one. |
| `MOVED` | The claim moved from one basket to another. |
| `UNCHANGED` | Already in the correct basket — idempotent, nothing written. |
| `HELD` | Status maps to HOLD; current basket kept. |
| `CLOSED` | Status is TERMINAL; the active assignment was closed. |
| `UNROUTED` | No basket could be resolved; reason recorded. |
| `ERROR` | Read/write failure; reason recorded. |

Because `UNCHANGED` is a first-class outcome, routing is safe to call on every transition and safe to re-run over the whole population.

### 6.3 The repair sweep

`scripts/bn/repair-claim-workbasket-routing.ts` re-routes the most recent 1,000 claims through the **same** service the UI uses (`routeClaims`), then prints a per-outcome summary and lists every `UNROUTED` / `ERROR` claim with its reason.

Run it when:

- workflow templates, step roles or basket roles have been reconfigured;
- a batch of claims shows the "Stage / queue mismatch" warning;
- claims were created or transitioned by a script that bypassed the UI;
- after adding a basket that a previously unmapped step should route to.

```bash
bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
    ./scripts/bn/repair-claim-workbasket-routing.ts
```

It writes nothing that normal operation would not write, so it is safe to re-run.

---

## 7. Roles and access — three separate things

These are constantly confused. They are independent, and a claim only reaches a working officer when **all three** line up.

| # | Thing | Where it lives | Decides |
| --- | --- | --- | --- |
| 1 | **Workflow step role** | `bn_workflow_template.steps_config[].role` / `assigned_role` | which basket role the step maps to |
| 2 | **Basket role** | `bn_workbasket.assigned_role` (+ `bn_workbasket_role`) | who sees the basket and who is notified |
| 3 | **Module permission** | `app_modules` (`bn_claim_queue`, `bn_claim_worklist`) + `module_actions.action_name = 'view'` + `role_permissions.is_granted` | who can open the screen at all |

**Holding a basket's role is not enough.** A role can own `BN_INTAKE_REVIEW` and still see nothing, because opening `/bn/queue` requires `bn_claim_queue` view permission for that role.

### 7.1 Permission diagnostics and reconciliation

Two database functions manage #3, and they **derive grants from the workbasket catalogue** rather than from a hand-maintained list.

`bn_workbasket_permission_gaps()` — read-only. Returns `assigned_role`, `basket_code`, `basket_name`, `missing_module`, `role_exists` for every active basket role that lacks a granted `view` on `bn_claim_queue` or `bn_claim_worklist`. `role_exists = false` means the basket names a role that does not exist in `roles` at all.

```sql
SELECT * FROM bn_workbasket_permission_gaps();
```

`bn_sync_workbasket_queue_permissions()` — admin-only (`is_admin(auth.uid())`, otherwise `42501`). Inserts the missing `role_permissions` rows for both modules and returns `granted_role`, `granted_module`, `granted_action` for everything it granted. Idempotent (`ON CONFLICT DO NOTHING`).

```sql
SELECT * FROM bn_sync_workbasket_queue_permissions();
```

**Configurator:** after adding a workbasket or changing its `assigned_role`, run the gaps function, then the sync function.

### 7.2 How the Claim Queue decides scope

`src/pages/bn/claims/ClaimQueue.tsx`:

| Piece | Role |
| --- | --- |
| `useMyEffectiveRoles` | the signed-in user's effective roles (`v_bn_user_effective_roles`) |
| `useMyWorkbaskets` → `fetchWorkbasketsForUser` → RPC `bn_workbaskets_for_user(p_user_id)` | the baskets the user personally holds |
| `useBnWorkbaskets` | the whole active catalogue, for the "All baskets" scope |

`bn_workbaskets_for_user` joins `bn_workbasket` → `bn_workbasket_role` → `v_bn_user_effective_roles` and returns `workbasket_id`, `basket_code`, `basket_name`, `role_name`, `is_primary` for active baskets only.

**The oversight rule.** A user counts as oversight when any effective role is one of `BN_SUPERVISOR`, `BN_MANAGER`, `BN_DIRECTOR`, `BN_CONFIG_ADMIN`, or contains `ADMIN`, `SUPERVISOR`, `MANAGER` or `DIRECTOR`. Oversight users get the **All baskets** scope over the whole catalogue; an oversight user with no basket of their own opens on that scope by default, with the hint *"You have no personal workbasket — switch to All baskets to work on behalf of any role."*

**Check this yourself** — the baskets a given user can see:

```sql
SELECT * FROM bn_workbaskets_for_user('<user-uuid>');
```

---

## 8. Notifications

### 8.1 The arrival path, end to end

```text
INSERT/UPDATE on bn_claim_queue_assignment
        │
        ▼  trigger zz_bn_claim_queue_assignment_notify
   bn_notify_workbasket_arrival()
        │  is_active = true AND completed_at IS NULL   (otherwise: no-op)
        │  read bn_workbasket (notify_* fields), bn_claim, bn_product.benefit_name
        │  render tokens → title / body / action label / link / priority
        ▼
   INSERT INTO in_app_notifications  (one row per recipient user)
        │  recipients = v_bn_user_effective_roles matching bn_workbasket_role roles
        │               (falls back to bn_workbasket.assigned_role when no role rows)
        ▼
   useBasketArrivalAlerts → unread badge per basket in /bn/queue
```

### 8.2 When it fires

Only for a **new active assignment**: the function returns immediately unless `NEW.is_active = true` **and** `NEW.completed_at IS NULL`. Closing an assignment therefore notifies nobody. It also returns quietly if the basket or the claim cannot be read.

### 8.3 How the message is composed

Tokens available to the templates, built from the claim, the basket and the assignment:

`claim_number`, `benefit`, `status`, `step`, `basket_name`, `basket_code`, `due_date` (`DD Mon YYYY`), `priority`.

| Field | Source | When blank |
| --- | --- | --- |
| Title | `bn_workbasket.notify_title` rendered by `bn_render_workbasket_notification` | `Action required in <basket_name>` |
| Body | `bn_workbasket.notify_body` rendered the same way | `<claim_number> — <benefit> · <status>`; and if `due_at` is set, ` · Due <DD Mon YYYY>` is appended in **both** cases |
| Action label | `bn_workbasket.notify_action_label` | `Open claim` |

Priority is computed, not configured: `critical` when `due_at < now()`, `high` when `priority >= 8`, otherwise `normal`.

The link is `/bn/claims/<claim_id>?basket=<basket_code>&step=<status>`.

### 8.4 The row written into `in_app_notifications`

| Column | Value |
| --- | --- |
| `user_id` | one row per distinct recipient user |
| `title`, `body`, `link`, `action_label` | as composed above |
| `module` | `BENEFITS` |
| `notification_type` | `BN_WORKBASKET_ARRIVAL` |
| `priority` | `critical` / `high` / `normal` |
| `source` | `legacy` |
| `related_record_id` | the claim id |
| `is_read` | defaults to false; set to true when cleared |
| `metadata` | `assignment_id`, `origin` (`benefits.workbasket`), `claim_id`, `claim_number`, `workbasket_id`, `basket_code`, `basket_name`, `status`, `step`, `role_name`, `severity` |

Recipients are resolved as: every user in `v_bn_user_effective_roles` whose `role_name` is in `bn_workbasket_role` for this basket, **union** `bn_workbasket.assigned_role` when the basket has no `bn_workbasket_role` rows — deduplicated with `DISTINCT ON (user_id)`, so a user holding two matching roles gets one notification.

### 8.5 `useBasketArrivalAlerts`

`src/hooks/bn/useBasketArrivalAlerts.ts` reads the current user's unread `BN_WORKBASKET_ARRIVAL` rows (up to 500) and counts them **per basket** by reading `metadata.workbasket_id`, producing the unread badge next to each basket in the queue. It refetches every 60 seconds.

`useClearBasketArrivalAlerts` sets `is_read = true` and `read_at = now()` for that user's unread arrival alerts whose `metadata` contains the opened `workbasket_id` — so opening a basket clears exactly that basket's badge, and no other.

**Configurator:** the three `notify_*` fields are edited in **`src/pages/bn/config/WorkbasketConfig.tsx`** (Benefits → Configuration → Workbaskets). Leaving them blank is safe — the defaults in 8.3 apply.

**Check this yourself** — the last arrival alerts for a claim:

```sql
SELECT n.user_id, n.title, n.priority, n.is_read, n.created_at,
       n.metadata->>'basket_code' AS basket
FROM in_app_notifications n
WHERE n.notification_type = 'BN_WORKBASKET_ARRIVAL'
  AND n.related_record_id = '<claim-uuid>'
ORDER BY n.created_at DESC;
```

---

## 9. The claim lifecycle, stage by stage

Actions come from `bn_claim_transition_rule`. **Button labels come from `action_label`, not from code** — renaming a label in that table renames the button.

Rule columns that matter:

| Column | Effect |
| --- | --- |
| `from_status` / `to_status` | which transition the rule describes |
| `action_code` | machine code (`SUBMIT`, `VERIFY`, `APPROVE`, …) |
| `action_label` | the text shown on the button |
| `allowed_roles` | roles permitted to press it |
| `requires_maker_checker` | a second, different user must confirm |
| `requires_evidence_complete` | blocked until required evidence is complete |
| `requires_calculation` | blocked until a calculation exists |
| `requires_eligibility_pass` | blocked until eligibility passed |
| `next_workbasket_id` | optional basket named by the rule |
| `product_category`, `country_code`, `min_override_level`, `sort_order`, `is_active` | scoping and ordering |

### 9.1 Stage table

| Status | Step (4.1) | Basket | Main actions — `action_label` (`action_code` → `to_status`) | Roles allowed |
| --- | --- | --- | --- | --- |
| `DRAFT` | — (HOLD) | none yet | Submit Claim (`SUBMIT` → SUBMITTED); Withdraw Claim (`WITHDRAW` → WITHDRAWN) | `BN_INTAKE_OFFICER`, `BN_DOCUMENT_OFFICER`, `BN_CLAIMS_OFFICER`, `BN_ELIGIBILITY_OFFICER`, `BN_AWARD_OFFICER`, `Admin` |
| `SUBMITTED` | `INTAKE` | Intake Review | Begin Intake Review (`VERIFY` → INTAKE_REVIEW); Start Review (`START_REVIEW` → INTAKE_REVIEW) | `BN_ELIGIBILITY_OFFICER`, `BN_SENIOR_ELIGIBILITY_OFFICER`, `BN_CLAIMS_OFFICER`, `BN_AWARD_OFFICER`, `BN_SUPERVISOR`, `Admin` |
| `INTAKE_REVIEW` | `INTAKE` | Intake Review | Move to Eligibility (`VERIFY` → ELIGIBILITY_CHECK); Check Eligibility (`CHECK_ELIGIBILITY` → ELIGIBILITY_CHECK); Send Back (`SEND_BACK`) | same as above |
| `ELIGIBILITY_CHECK` | `ELIGIBILITY` | Eligibility Review | Move to Evidence Review (`VERIFY`, **requires eligibility pass**); Request Evidence (`REQUEST_EVIDENCE` → EVIDENCE_REVIEW); Run Calculation (`RUN_CALCULATION` → CALCULATION, **requires eligibility pass**); Request Information / Request Info (→ PENDING_INFO); Escalate; Send Back; Suspend | officers as above; Suspend restricted to `BN_SUPERVISOR`, `BN_MANAGER`, `BN_SENIOR_ELIGIBILITY_OFFICER`, `BN_DIRECTOR`, `Admin` |
| `EVIDENCE_REVIEW` | `EVIDENCE_REVIEW` | Document Review | Move to Calculation (`VERIFY`, **requires evidence complete**); Run Calculation; Request Information / Request Info; Escalate; Send Back; Suspend | as above |
| `CALCULATION` | `CALCULATION` | Calculation Review | Move to Decision (`VERIFY` → DECISION, **requires calculation**) | officers as above |
| `DECISION` | `DECISION` | Supervisor Approval | **Approve Claim** (`APPROVE` → APPROVED — requires calculation **and** eligibility pass **and** evidence complete **and** maker-checker); **Deny Claim** (`DENY` → DENIED — maker-checker); Escalate; Suspend | `BN_SUPERVISOR`, `BN_MANAGER`, `BN_SENIOR_ELIGIBILITY_OFFICER`, `BN_DIRECTOR`, `Admin` |
| `APPROVED` | `AWARD_SETUP` | Award Setup | Begin Award Setup (`VERIFY` → AWARD_SETUP) | officers + `BN_SUPERVISOR`, `Admin` |
| `AWARD_SETUP` | `AWARD_SETUP` | Award Setup | Send to Payment (`VERIFY` → PAYMENT_QUEUE) | officers + `BN_PAYMENT_OFFICER`, `BN_FINANCE_SUPERVISOR`, `BN_SUPERVISOR`, `Admin` |
| `PAYMENT_QUEUE` | `PAYMENT` | Payment Preparation / Payment Issue (see 4.5) | **Begin Payment** (`VERIFY` → IN_PAYMENT) | `BN_PAYMENT_OFFICER`, `BN_FINANCE_SUPERVISOR`, `BN_SENIOR_ELIGIBILITY_OFFICER`, `BN_SUPERVISOR`, `Admin` |
| `IN_PAYMENT` | `PAYMENT` | payment baskets | Suspend Payments (`SUSPEND` → SUSPENDED); Discontinue Benefit (`DISCONTINUE` → CLOSED, maker-checker); Disallow Benefit (`DISALLOW` → CLOSED, maker-checker) | `BN_SUPERVISOR`, `BN_MANAGER`, `BN_DIRECTOR`, `BN_SENIOR_ELIGIBILITY_OFFICER`, `Admin`; Disallow is `BN_MANAGER`/`BN_DIRECTOR`/`Admin` only |
| `PENDING_INFO` | — (HOLD) | **unchanged** — stays with the officer who requested the information | resume actions defined by rules from `PENDING_INFO` | as configured |
| `SUSPENDED` | — (HOLD) | **unchanged** | reinstate / close actions from `SUSPENDED` | supervisory roles |
| `CLOSED` | — (TERMINAL) | none — active assignment closed | — | — |
| `DENIED` | — (TERMINAL) | none — active assignment closed | Reopen Claim (`REOPEN` → INTAKE_REVIEW); Close (`CLOSE` → CLOSED) | Reopen: `BN_MANAGER`, `BN_DIRECTOR`, `Admin` |
| `WITHDRAWN` | — (TERMINAL) | none — active assignment closed | — | — |

Note `INTAKE` (as distinct from `INTAKE_REVIEW`) is written by `bn_submit_claim_application` and routes to the Intake step, but **no transition rule references it** — a known gap: such claims are routed correctly but have no action buttons until they are moved to `SUBMITTED` / `INTAKE_REVIEW`.

**Check this yourself** — the exact, current action set for a status:

```sql
SELECT from_status, to_status, action_code, action_label, allowed_roles,
       requires_maker_checker, requires_evidence_complete,
       requires_calculation, requires_eligibility_pass
FROM bn_claim_transition_rule
WHERE is_active AND from_status = 'DECISION'
ORDER BY sort_order;
```

---

## 10. After approval

Approval does not move money. The chain is:

```text
APPROVED ──▶ bn_entitlement ──▶ bn_payment_instruction ──▶ bn_payment_batch ──▶ issue
             (what is owed)      (what to pay, to whom)     (grouped run)        (money)
```

| Object | What it is |
| --- | --- |
| `bn_entitlement` | The award: what the claimant is entitled to, from when, at what rate. Created after approval (`entitlementService.ts`, `CreateEntitlementDialog.tsx`). |
| `bn_payment_instruction` | A concrete instruction derived from an entitlement — amount, payee, method, period. |
| `bn_payment_batch` | A grouping of instructions for a payment run. |
| Issue | The step that actually disburses; `postIssueService.ts` re-routes the claim afterwards. |

Two things to be plain about:

1. **"Begin Payment" issues no money.** The `PAYMENT_QUEUE → IN_PAYMENT` rule changes the claim's status and re-routes it to the payment step. Nothing is disbursed by pressing it.
2. **The Payables Queue is a control point, not the payment step.** It exists so finance can review what is about to be paid. Disbursement happens through instructions and batches, not from the claim queue.

---

## 11. When a claim goes wrong

### 11.1 Claim shows no owner

*Cause:* routing returned `UNROUTED` — no workflow template for the product/channel, a step role with no basket, or a shared-role ambiguity (4.5). The status change still succeeded (6.1).

```sql
SELECT c.id, c.claim_number, c.status
FROM bn_claim c
WHERE NOT EXISTS (
  SELECT 1 FROM bn_claim_queue_assignment a
  WHERE a.claim_id = c.id AND a.is_active)
  AND c.status NOT IN ('DRAFT','CLOSED','DENIED','WITHDRAWN','APPROVED_CLOSED');
```

*Fix:* configure the missing template/step/basket, then run the repair sweep (6.3).

### 11.2 Claim sits in Intake Review after its status moved on

*Cause:* the status change did not run routing (a script or an older code path), or routing returned `UNROUTED`/`HELD`.

```sql
SELECT c.claim_number, c.status, w.basket_code, a.assigned_at
FROM bn_claim c
JOIN bn_claim_queue_assignment a ON a.claim_id = c.id AND a.is_active
JOIN bn_workbasket w ON w.id = a.workbasket_id
WHERE c.status NOT IN ('DRAFT','SUBMITTED','INTAKE','INTAKE_REVIEW','PENDING_INFO','SUSPENDED')
  AND w.basket_code = 'BN_INTAKE_REVIEW';
```

*Fix:* the repair sweep. The queue also surfaces these as a "Stage / queue mismatch".

### 11.3 Claim is in a basket but the officer cannot see the queue

*Cause:* the role holds the basket (thing #2) but not `bn_claim_queue` view permission (thing #3) — see section 7.

```sql
SELECT * FROM bn_workbasket_permission_gaps();
```

*Fix:* `SELECT * FROM bn_sync_workbasket_queue_permissions();` as an administrator. If `role_exists = false`, the basket names a role that does not exist — correct `assigned_role` first.

A second possibility: the user's roles are not on `bn_workbasket_role` for that basket, so it never appears in their list —

```sql
SELECT * FROM bn_workbaskets_for_user('<user-uuid>');
```

### 11.4 The basket named on a step is inactive or missing

*Cause:* `steps_config[].workbasket_id` points at a deleted or deactivated basket. Routing falls through to role-based resolution (4.4 step 2), so claims silently land somewhere else — or nowhere.

```sql
SELECT t.template_code, s->>'step_code' AS step, s->>'workbasket_id' AS basket_id
FROM bn_workflow_template t
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(t.steps_config) = 'array'
       THEN t.steps_config ELSE t.steps_config->'steps' END) s
WHERE s ? 'workbasket_id'
  AND NOT EXISTS (
    SELECT 1 FROM bn_workbasket w
    WHERE w.id = (s->>'workbasket_id')::uuid AND w.is_active);
```

### 11.5 `due_at` is null

*Cause:* either the step declares no `sla_days` / `sla_hours`, or — more commonly — the template does not declare the step at all and the hardcoded fallback table answered (4.4). Fallback assignments have **no SLA**, so escalation ignores them.

```sql
SELECT c.claim_number, c.status, w.basket_code, a.assigned_at
FROM bn_claim_queue_assignment a
JOIN bn_claim c ON c.id = a.claim_id
JOIN bn_workbasket w ON w.id = a.workbasket_id
WHERE a.is_active AND a.due_at IS NULL
ORDER BY a.assigned_at DESC;
```

*Fix:* declare the step in the product's workflow template with an `sla_hours` (or `sla_days`) and a `workbasket_id`, then re-route the affected claims.

---

## 12. Technical annex

### 12.1 Tables

| Table | Role in this flow |
| --- | --- |
| `bn_claim` | the claim, incl. `status`, `claim_number`, `product_id`, `product_version_id` |
| `bn_workbasket` | the basket catalogue |
| `bn_workbasket_role` | roles that can see / be notified about a basket |
| `bn_claim_queue_assignment` | who owns the claim now |
| `bn_claim_transition_rule` | allowed actions, labels, role gates, preconditions |
| `bn_workflow_template` | `steps_config`, `sla_config`, `escalation_config` |
| `bn_product_version_workflow` | product version + channel → template |
| `bn_product_channel_config` | channel configuration incl. `workflow_template_id` |
| `bn_product_version` | legacy `workflow_template_id` fallback |
| `bn_entitlement`, `bn_payment_instruction`, `bn_payment_batch` | post-approval chain |
| `in_app_notifications` | arrival alerts |
| `app_modules`, `module_actions`, `role_permissions`, `roles` | screen access |
| `v_bn_user_effective_roles` | user → effective roles |

### 12.2 Database functions and triggers

| Object | Purpose |
| --- | --- |
| `zz_bn_claim_queue_assignment_notify` (trigger on `bn_claim_queue_assignment`) | fires the arrival notification |
| `bn_notify_workbasket_arrival()` | composes and inserts the notification rows |
| `bn_render_workbasket_notification(text, jsonb)` | token substitution in the notify templates |
| `bn_workbaskets_for_user(p_user_id uuid)` | baskets visible to a user |
| `bn_workbasket_permission_gaps()` | roles missing queue view permission |
| `bn_sync_workbasket_queue_permissions()` | grants them (admin only) |
| `bn_submit_claim_application` | submission entry point; writes status `INTAKE` |

### 12.3 Code

| File | Purpose |
| --- | --- |
| `src/services/bn/workflow/claimStatusStepMap.ts` | status → step (STEP / HOLD / TERMINAL) |
| `src/services/bn/workflow/resolveProductWorkflow.ts` | product + channel → template |
| `src/services/bn/workflow/channelNormalization.ts` | channel code normalisation |
| `src/services/bn/intake/claimWorkbasketResolver.ts` | step → workbasket, SLA, fallback tables |
| `src/services/bn/workflow/stageBasketExpectation.ts` | `pickBasketForStage` for shared-role baskets |
| `src/services/bn/workflow/routeClaimToWorkbasket.ts` | the routing operation and its outcomes |
| `src/services/bn/workflow/routeClaimAfterStatusChange.ts` | non-blocking wrapper called after each transition |
| `src/services/bn/workflow/stageQueueReconciliation.ts` | stage vs queue mismatch reporting |
| `src/services/bn/approvalLevelService.ts` | `assignClaimToWorkbasket` (close old, open new) |
| `src/services/bn/workbasketRoleService.ts` | `fetchWorkbasketsForUser` |
| `src/hooks/bn/useBasketArrivalAlerts.ts` | unread arrival badges and clearing |
| `src/hooks/useWorkflowActions.ts` | action buttons driven by transition rules |
| `src/pages/bn/claims/ClaimQueue.tsx` | the queue screen and its scope rules |
| `src/pages/bn/config/WorkbasketConfig.tsx` | basket catalogue and notify templates |
| `src/pages/bn/config/WorkflowTemplateEditor.tsx` | authors `step_code` / `assigned_role` / `sla_hours` / `workbasket_id` |
| `scripts/bn/repair-claim-workbasket-routing.ts` | bulk re-route |
| `src/__tests__/bn/workflow/claimWorkbasketRouting.test.ts` | routing regression tests |

### 12.4 Known gaps, stated plainly

1. **Undeclared steps fall back to a hardcoded table** (`STEP_NAME_TO_BASKET_ROLE`), and those assignments get **no `due_at`**, so escalation never sees them.
2. **`max_capacity` is not enforced** by routing.
3. **`priority_rules` is not consumed** by routing; assignment `priority` is set by callers.
4. **Shared-role baskets** (`BN_PAYMENT_PREPARATION` / `BN_PAYMENT_ISSUE`) are reported as ambiguous rather than auto-selected unless the step names the basket.
5. **Status `INTAKE`** is written by `bn_submit_claim_application` but has no transition rules.
6. **Notification recipients are role-based, not assignment-based** — a picked claim still notified the whole role at the moment it arrived.

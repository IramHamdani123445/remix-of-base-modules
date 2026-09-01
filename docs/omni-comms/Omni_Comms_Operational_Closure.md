# Omni-Comms Operational Closure — My Tasks, Legacy Notification Migration Readiness

Date: 2026-08-30 · Environment: TEST · Status: reported and partially remediated

---

## Phase 1 — The "33 Waiting to Send" concern

### 1.1 Live dispatch reconciliation

| Measure | Value |
| --- | --- |
| Held dispatch jobs (total) | 33 (13 Email, 20 In-App) |
| Permanently held historical | 30 (`historical_job_not_authorized`) |
| Actionable holds | 3 (`recipient_not_allowlisted`) |
| Email jobs since activation | 11 completed, 1 held |
| Delivery attempts accepted by provider | 28 (with provider message id) |
| Provider callbacks recorded as delivered | 28 |
| Attempts with unknown outcome | 2 |

Activation record: environment `TEST`, certified revision `03fcd61c…`, activated `2026-08-29 20:46 UTC`.

**Verdict: there is no stuck delivery queue.** 30 of the 33 held jobs are business
events that were recorded *before* dispatch was switched on. They are audit
evidence and are intentionally never delivered. Only 3 jobs are actionable, and
all 3 are blocked on the same cause: the recipient address is not on the
allowlist (two are deliberate certification test addresses).

### 1.2 Root cause of the misleading figure

`omni_comms_priv_business_event_status` returned `waiting_to_send` for **any**
held job, with no regard for why it was held. A permanently held historical
record therefore appeared, in business language, as work still queued to go out.

### 1.3 Remediation applied

* The status function now consults the canonical hold classification
  (`omni_comms_hold_classification`) and returns a new status
  `not_sent_historical` when **every** held job for the event is permanently
  historical. Mixed cases still report `waiting_to_send`, so nothing actionable
  is ever hidden.
* Business vocabulary: `Historical record — no delivery`, with the explanatory
  hint "Recorded before delivery was switched on. Kept as audit evidence only."
* Activity filters: a new **Historical (not sent)** chip; historical records are
  excluded from **Waiting** and from **Needs attention**.
* Operations summary: the single "Held dispatch jobs" counter is split into
  **Held — action required** and **Held — historical record**.
* A dedicated card on the Activity page states the historical count in plain
  English and confirms no action is required.

Effect on the live figures: business events reporting "Waiting to send" fell
from **13 to 1**; **12** now correctly report as historical records.

### 1.4 Header badge

No change required. `OmniCommsHeaderShortcut` already counts only actionable
holds, failures and exhausted retries via `omni_comms_ops_attention_summary`;
permanent historical outcomes were already excluded.

---

## Phase 2 & 3 — My Communications

Confirmed unchanged and correct:

* Reads run only through `omni_comms_in_app_list_my_communications` and
  `omni_comms_in_app_my_unread_count`, both scoped server-side by `auth.uid()`.
  No user identity is sent from the browser, so a crafted request cannot fetch
  another user's inbox.
* Writes run only through `omni_comms_in_app_record_engagement` /
  `…_bulk`. There is no direct-table fallback.
* Direct `select` on `in_app_notifications` is refused (`42501`) for ordinary
  users; the governed RPC path works.
* Current inbox state: 22 Omni in-app communications, 21 unread, 1 read with a
  recorded `callback_opened` engagement event.

---

## Phase 4 — My Tasks

`/my-tasks` is now a **read-only personal projection**. It never approves,
rejects, assigns or mutates: every item opens on the module screen that owns
it, so each module's maker/checker rules, authorisation and audit trail stay
authoritative.

Header now carries three deliberately separate indicators:

| Indicator | Answers | Source |
| --- | --- | --- |
| My Communications (messages icon) | "What must I read?" | Omni in-app unread count |
| My Tasks (list icon) | "What must I decide?" | Workflow approvals scoped to the user |
| Omni-Comms (radio icon, admins) | "What must an operator fix?" | Actionable attention summary |

### 4.1 Task-source inventory

| Source | Module | Table / hook | Ownership rule | Route |
| --- | --- | --- | --- | --- |
| Workflow engine | Platform | `workflow_tasks` + `workflow_steps`, `useMyPendingApprovals` | assigned user / role / designation / step approver config | `/workflow/my-tasks` |
| Secured approvals | Platform admin | `workflow_tasks` | admin/role | `/admin/workflow-secured-approvals` |
| BN workbaskets | Benefits | `workbasketService`, `useMyWorkbaskets` | effective roles | `/bn/approval/workbaskets` |
| BN claim queue | Benefits | `claimWorkbenchService` | workbasket routing | `/bn/claims` |
| BN appeals | Benefits | `BnAppealMyWorkPage` | module gate | `/bn/appeals/my-work` |
| Compliance work queue | Compliance | 8 `ce_*` tables + `workflow_tasks` | `assigned_to_user_id` / officer code | `/compliance/my-work-queue` |
| Review flags | Compliance | `reviewFlag.ts` | role/queue | `/compliance/violations/review-flags` |
| Legal tasks | Legal | `lgAssignmentService` | assigned officer | `/legal/workbench?tab=my-work` |
| Audit action centre | Internal Audit | action register | assignment | `/audit/action-centre` |

**Finding — not one engine.** The platform workflow engine coexists with
BN, Compliance, Legal and Audit stacks that each implement their own
assignment model. Even inside the generic engine, `useMyPendingApprovals`
(client-side scoping, with a blanket admin override) and `useMyWorkflowTasks`
(assumes RLS scopes it) disagree. My Tasks therefore projects the workflow
engine directly and links out to the module queues rather than re-deriving
another module's visibility rules — re-deriving them would risk widening
access.

**Open risk (recommended next):** `useMyPendingApprovals` pulls all
Pending/InProgress `workflow_tasks` and filters in the browser. Scoping should
move server-side into a governed RPC.

### 4.2 Defect fixed

The notification bell's "Pending Approvals" banner pointed at
`/workflow/approvals`, a route that does not exist. It now opens `/my-tasks`.

---

## Phase 5 & 6 — Legacy notification producer register

Only `omni_comms_priv_dispatch_deliver_in_app` (and the gate-approval helper)
tag notifications with an Omni `source`. Every other live producer writes
legacy rows.

| Producer | Trigger | Status | Migration target |
| --- | --- | --- | --- |
| `workflow-process-notifications` | Workflow step entry/result | ACTIVE — widest fan-in (~9 call sites) | `PLATFORM.WORKFLOW.STEP.*` events |
| `meeting-api-handler` | Meeting scheduled | ACTIVE | `PLATFORM.MEETING.SCHEDULED` |
| `dispatch-core-document` (INAPP branch) | Document dispatch | ACTIVE | Omni in-app channel |
| `bnCommunicationAdapter` | BN claim lifecycle | ACTIVE | already has a correct server-side sibling (`bn-communication-adapter`) |
| `legalReferralUnifiedService` / `…CollaborationService` | Referral info-request response | ACTIVE (duplicated — de-duplicate first) | `LEGAL.REFERRAL.*` |
| `workflow-notify-approvers` | Approval step entry | ACTIVE (via meeting handler) | fold into the workflow event above |
| `workflow-notify-requester` | Workflow completion | DORMANT — no caller found | retire |
| `send-email-campaign`, `process-pending-notifications` | Bulk/queued | DORMANT / superseded | retire |

Legacy volume still resident: 1,050 `in_app_notifications` rows across 6 users.

---

## Phase 7 — Omni bypass debt

Nine bypass instances feed three non-certified send paths:

| Entry point | Callers | Risk |
| --- | --- | --- |
| `send-notification` (direct Resend) | gate approvals, BN notification integration, audit communication service, `ce-audit-communication-dispatch` cron, applications review, admin test send | High |
| `send-email-campaign` (Resend + raw SMTP, own provider config) | admin campaign screens | High |
| `send-scheduled-legal-report` (independent Resend credential via connector gateway) | pg_cron every 5 minutes | High |

None of these routes through the certified adapters, so their sends carry no
Omni provider governance, release control or delivery evidence. The admin
"send test email" action is the cheapest fix: point it at the existing
certified `omni-comms-test-delivery` function.

---

## Phases 8–10 — Legacy bell retirement strategy

1. **Now (done).** Three separate header indicators with non-overlapping
   meanings; the bell's broken approvals link repaired.
2. **Next.** Migrate the top three active producers (workflow, meetings,
   core-document dispatch) to Omni business events. Each new notification then
   appears in My Communications, and its bell entry becomes a duplicate.
3. **Then.** Move workflow-approval counting out of the bell entirely — it is
   task work, and My Tasks now owns it.
4. **Finally.** With the bell carrying only historical legacy rows, retire it
   and keep `in_app_notifications` read-only as an archive. No legacy table or
   screen is removed before its Omni replacement is live.

---

## Verification

* Typecheck clean (`tsgo`, app project).
* Omni-Comms suite: 2,333 tests, all passing after the status-vocabulary change.
* Live SQL re-run of the business-event status projection confirms the corrected
  distribution (1 waiting, 12 historical, 29 provider-accepted, 55 needs
  configuration, 83 no communication configured).

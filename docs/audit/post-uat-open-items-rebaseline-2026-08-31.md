# Internal Audit — Post-UAT Consolidated Remediation Wave

## Phase 0 — Current-Truth Rebase (2026-08-31)

Every post-UAT item was re-verified against live code and the live database before
any change was made. The already-certified lifecycle was **not** rebuilt.

| Ref | Item | Verified state at rebase |
|-----|------|--------------------------|
| IA-POST-UAT-01 | Recommended Actions are dead buttons | **CONFIRMED OPEN** — `deriveNextActions` returned label/description/icon with no `onClick`; `AuditOverviewTab` passed no handler. |
| IA-POST-UAT-02 | Follow-Up governance | **PARTIALLY CLOSED** — governed RPCs `ia_followup_schedule` / `ia_followup_record_outcome` already exist and key off canonical `action_id`. UI still uses direct CRUD. |
| IA-POST-UAT-03 | Traceability chain | OPEN — evidence chain is described in free text, not linked. |
| IA-POST-UAT-04 | Working-paper attachments | **CONFIRMED OPEN** — `AuditWorkingPapersTab` renders an "Attach File" input that `handleCreate` ignores. Private bucket `audit-attachments` exists and is the correct target. |
| IA-POST-UAT-05 | Risk propagation | OPEN — no governed `ia_save_risk_assessment`; logic sits client-side in `RiskAssessment.tsx`. |
| IA-POST-UAT-06 | Risk Register reachability | **CLOSED THIS WAVE** — page and route existed but were unreachable from navigation. |
| IA-POST-UAT-08 | Fiscal year | OPEN — `AnnualPlanForm` hard-codes `new Date().getFullYear()`; no platform fiscal master. |
| UAT-DEF-06 | Engagements plan-status filter defaulted to a single status | **ALREADY CLOSED** — default is `All Plans`; no change required. |
| IA-POST-UAT-11 | UX fixes | OPEN — `EngagementDetail` shows a generic "Audit not found" for what is an authorisation boundary. |

## Closed in this wave

### IA-POST-UAT-01 — Recommended Actions are now real commands

`NextAction` now carries a mandatory `actionKey` (`LAUNCH_AUDIT`, `BEGIN_FIELDWORK`,
`DOCUMENT_FINDINGS`, `REQUEST_MANAGEMENT_RESPONSES`, `FOLLOW_UP_OVERDUE_ACTIONS`,
`CLOSE_AUDIT`). `AuditOverviewTab` supplies a single `dispatchRecommendedAction`
resolver that routes each key to the canonical governed surface — launch goes to the
Preparation tab where `LaunchReadinessPanel` calls `ia_launch_engagement`, closure goes
to the Closure tab, and so on.

Three structural guarantees now hold:

- **No dead buttons.** A recommendation with no resolvable handler renders as a
  dashed informational row, not as a clickable control.
- **No recommendations on terminal audits.** `Closed`, `Closed – Actions Pending`,
  `Cancelled` and `Archived` short-circuit to an empty list, so a closed audit can no
  longer advertise "Begin Fieldwork".
- **Persona-correct recommendations.** Execution recommendations are gated on
  `execute_audit_activities` and action follow-up on `progress_audit_actions` /
  `manage_audit_followups`, alongside the existing launch/close gates. A Management
  Respondent no longer sees auditor-side prompts.

The panel performs no mutation itself; it only navigates to the surface that owns the
governed command. Server-side authorisation remains the enforcement point.

### IA-POST-UAT-06A — Risk Register reachable

`RiskRegister` was implemented and routed at `/audit/risk-register` but absent from
`auditRouteConfig` and the sidebar, so it was only reachable by typing the URL. It is
now registered under a `FEATURE_AUDIT_RISK_REGISTER` flag and appears in Risk
Management **above** Risk Assessment, matching the business sequence: the Register is
the standing risk universe, the Assessment is the periodic evaluation of it.

## Verification

Typecheck and build clean.

## Wave 2 — IA-POST-UAT-04 and IA-POST-UAT-02

Baseline at start of wave: HEAD `0a4b6b44fd`, clean working tree, TEST environment.
IA-POST-UAT-01 and IA-POST-UAT-06A re-verified as still closed and untouched.

**Deferred reconciliation point:** Risk Register route/sidebar access is gated on
`configure_audit_system` while the canonical capability map names
`manage_risk_register`. Deliberately NOT changed here — carried to
**IA-POST-UAT-07 Permission Registry Reconciliation**.

### IA-POST-UAT-04 — Working Paper attachments (CLOSED)

**Root cause.** `AuditWorkingPapersTab` rendered an "Attach File" input, but
`handleCreate` never read the input ref. The file was silently discarded while the
success toast implied the paper — and its attachment — had been saved.

**Implementation.** No new bucket, no fourth attachment architecture. The existing
private bucket `audit-attachments` and the existing evidence-record convention
(used by Activities, Responses and Queries) are reused:

```
Working Paper (ia_working_papers.evidence_ids[])
  → ia_evidence row (original name, stored name, mime, size, uploader, object path)
    → private bucket audit-attachments  (working-papers/<engagement>/<paper>/<stamp>_<safe-name>)
```

A canonical helper `src/lib/audit/auditAttachmentUpload.ts` now owns validation
(MIME + extension + 20 MB ceiling + zero-byte rejection), file-name sanitation,
collision-safe path construction, upload and orphan cleanup, so the UI cannot drift
from the policy. Reads go exclusively through `auditFileAccess` (short-lived signed
URL for View, authenticated SDK stream for Download). Only the object path is
persisted — never a public or signed URL.

Multiple attachments per working paper are supported (the canonical
`evidence_ids[]` relationship is already many-valued).

**Atomicity.** The working paper row is created first; each upload and each metadata
insert is checked. Any failure removes the uploaded objects, deletes the inserted
evidence rows and deletes the working paper row, then surfaces the real error. No
success state is ever shown for a discarded file.

**Retention.** File-level deletion was deliberately NOT added. The existing Trash
icon deletes the working-paper row only. Governed evidence detach/retention remains
an open gap and is recorded for a later governance wave.

**Tests.** `src/components/audit/execution/__tests__/auditRemediationWave2.test.ts`
covers valid PDF/XLSX/image, unsupported extension, invalid MIME, oversized,
zero-byte, path-traversal sanitation and collision safety. Bucket privacy verified
directly (`storage.buckets.public = false` for `audit-attachments`).

### IA-POST-UAT-02 — Follow-Up UI convergence (CLOSED)

**Backend already existed.** `ia_followup_schedule` and `ia_followup_record_outcome`
were already governed, action-linked and event-logging. No new RPC was created.

**UI convergence.** `AuditFollowUpsTab` no longer uses `useIAFollowUpMutations()`.
"Add Follow-up" (generic create with a free Status dropdown) is replaced by
**Schedule Follow-Up**, which selects an eligible corrective action from the current
engagement — terminal actions excluded — and shows the derived finding, owner,
target date, action status and verification state before calling
`useIaFollowUpSchedule()`. Outcomes are recorded through
`useIaFollowUpRecordOutcome()` using only the canonical vocabulary
(In Verification / Implemented / Partially Implemented / Not Implemented / Reopened),
with the server's notes requirement mirrored client-side. Derived states
(Resolved / Closed / Overdue) can no longer be set from the UI. Finding, department
and responsible party are derived from the action, so an inconsistent
"Finding A + Action B" pairing is no longer expressible.

Because both paths now write through the same command, the Engagement Follow-Up tab
and the Action Centre follow-up queue share one truth; no duplicate record path
remains in the UI. Communication remains command-owned — no second producer added.

### IA-POST-UAT-01 hardening

The recommended-action dispatcher moved from a `switch` with a `default` to an
exhaustive `Record<NextActionKey, string>` in
`src/components/audit/execution/recommendedActionDispatch.ts`, with a test asserting
both directions. A new key without a dispatcher now fails typecheck.

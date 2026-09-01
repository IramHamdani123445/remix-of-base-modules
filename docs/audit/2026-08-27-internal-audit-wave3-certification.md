# Internal Audit — Wave 3 Certification Evidence

Date: 2026-08-27
Scope: user-operable lifecycle, action management, follow-up, work queues, cross-year continuity.
Spine: `ia_audit_engagements` (ADR-01).

---

## Defects found and closed this wave

| Ref | Defect | Impact | Resolution |
|-----|--------|--------|------------|
| IA-W3-D01 | `ia_check_engagement_completeness` wrote `execution_gate_status` back onto the engagement row, and it was called from the **BEFORE UPDATE** closure trigger | Postgres aborted every closure with `tuple to be updated was already modified by an operation triggered by the current command` — **no engagement could ever be closed** | Split into read-only `ia_evaluate_engagement_completeness()` (used by the trigger, which now sets `NEW.execution_gate_status` in-row) and the recording wrapper retained for explicit UI refresh. Granted to `authenticated` + `service_role` only. |
| IA-W3-D02 | `ia_action_extensions.approved_by` was `NOT NULL` while `ia_action_request_extension` inserts the request before any approver exists | **Extension requests were impossible** (`23502`) | Column made nullable; approver is populated at approval time. |
| IA-W3-D03 | Elevated finding transitions (`Confirmed`/`Released`) require engagement access; a reviewer outside the engagement team silently returned `IA_FORBIDDEN` | Prior-year engagement stalled at `Under Review` | Confirmed as correct segregation-of-duties behaviour; certification driven with an authorised reviewer. No code change. |

---

## Certification fixtures (`W3-A` … `W3-E`)

| Code | Purpose | End state |
|------|---------|-----------|
| W3-A | Full happy path | Engagement **Closed**; finding Closed; action Closed; report issued; QA cleared; 1 follow-up; 23 audit events |
| W3-B | Overdue management response | Finding **Released** 30 days ago, no response |
| W3-C | Awaiting audit verification with pending extension | Action **Verification Required**, 1 extension `Requested` |
| W3-D | Disputed finding, returned action | Response `Rejected` → `Escalated`; action **Returned** to management |
| W3-E | Cross-year carry-forward | Prior-year engagement, action **In Progress** past target, 1 extension, 1 overdue follow-up |

Every state was reached exclusively through the governed `ia_*` commands under role impersonation
(lead auditor, second auditor/reviewer, management respondent, admin). No direct lifecycle-column writes.

---

## Work queue proof

All zero-argument Action Centre read models return live rows under lead, management and admin personas:

- `ia_q_hia_attention` — surfaces `Actions Seriously Overdue` (W3-E), `Audits Awaiting QA` (W3-B…E) and `Audits Not Started on Time`, each with a deep link and required action.
- `ia_q_my_audit_work`, `ia_q_management_actions`, `ia_q_qa_queue` — populated for their respective personas.

Parameterised queues (verification, follow-up, extension approval, cross-year) are driven from the same
fixtures via the Action Centre tabs.

---

## Carried forward

- GAP-14: IA notifications still bypass the Omni-Comms façade (`ia_auto_notification_log`).
- RLS policy coverage for the 89 tables flagged `RLS enabled, no policy` outside the IA estate.
- Print / PDF / Excel export certification of the Action Centre queues.

## WAVE 3 RESULT: PASS (lifecycle, actions, follow-up, queues, cross-year)

## Wave 3.1 — Output & Reconciliation Certification

Reconciliation (Admin persona, server-side): 12/12 assertions passed across register
populations, single filters (open only, overdue, status, severity) and metric tiles.

Defects fixed:
- IA-W31-D01 `ia_register_findings` had no combined High/Critical predicate — added (`high_critical`).
- IA-W31-D02 Registers could not be scoped by Function or Engagement — filters added and surfaced in the UI.
- IA-W31-D03 Print/PDF output only covered the visible page — replaced with
  `ActionCentrePrintView`, which renders the full filtered population plus applied-filter metadata.

Delivered:
- Metric tiles are now drill-downs: each applies the same server filter that produced the number.
- Action Register shows plan year, originating finding, original vs current target date, extensions,
  evidence state and overdue days. Findings Register shows function area and management position.
- CSV/Excel/PDF exports carry title, generation timestamp, applied filters and record count.
- Engagement-scoped "Audit action summary" print view (findings → actions → follow-ups).

WAVE 3.1 OUTPUT CERTIFICATION: PASS
WAVE 3 FULLY CERTIFIED
READY FOR WAVE 4 OMNI-COMMS

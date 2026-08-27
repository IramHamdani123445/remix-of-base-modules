# Internal Audit — Wave 2: Complete Executable Audit Lifecycle

Date: 2026-08-27
Scope: Wave 2 only. Builds on Wave 0 (architecture freeze) and Wave 1 (trust, security, canonical foundation).
Spine: `ia_audit_engagements` (ADR-01). `department_audit_id` receives no new operational writes.

---

## Part A — Wave 1 carried items

| Ref | Item | Outcome |
|-----|------|---------|
| IA-W1-D01 | Storage isolation: any IA user could read any engagement's artefacts | CLOSED — `ia_can_access_audit_object(bucket, path)` added and enforced in `storage.objects` policies for `ia-artifacts`, `ia-evidence`, `audit-attachments`. Objects are keyed by engagement; access requires `ia_can_access_engagement()`. |
| IA-W1-D02 | Orphaned lead-auditor references on `ia_audit_engagements` | CLOSED — orphans repaired, FK to `ia_auditor_profiles` enforced. |
| IA-W1-D03 | Legacy spine still read/written by four UI surfaces | CLOSED — `AuditActivitiesTab`, `useAuditDataExtended2`, `AuditHistoryTimeline`, `AuditPreparation` now read and write `engagement_id`. |
| IA-W2-D04 | `trg_ia_action_status_notify` inserted `responsible_person` (a person's *name*) into `recipient_user_id uuid` — **every action insert/update failed** | CLOSED — trigger rewritten to populate `recipient_name`. This defect had made Action Tracking entirely unusable. |
| IA-W2-D05 | `ia_can_issue_report` raised `malformed array literal` whenever it had any blocking reason — the report issuance gate could never actually block, it only crashed | CLOSED — array concatenation corrected; the gate now returns its reason list. |

---

## Lifecycle schema

Added to the canonical spine:

- `ia_audit_engagements` — preparation status/completion, closure disposition fields.
- `ia_activities` — `owner_auditor_id`, `reviewer_auditor_id`, planned/actual hours, review outcome.
- `ia_control_tests` — `conclusion`, `no_finding_rationale`.
- `ia_findings` — `lifecycle_status`, `severity`.
- `ia_action_tracking` — original/current target date.

New tables (all RLS-classified, granted to `authenticated` + `service_role`, no `anon`):

- `ia_finding_severity_history` — every severity change with justification and actor.
- `ia_report_versions` — versioned report content, **immutable once issued**.
- `ia_action_extensions` — every target-date extension with reason and approver.

---

## Governed commands

Fourteen `SECURITY DEFINER` RPCs. Each one checks permission + engagement access, enforces its gate, and writes to the immutable `ia_audit_event` store. No UI writes lifecycle columns directly.

| Stage | Command | Gate enforced |
|-------|---------|---------------|
| Preparation | `ia_complete_preparation` | Scope, programme, team and opening communication present |
| Fieldwork | `ia_assign_activity` / `ia_complete_activity` / `ia_review_activity` | Owner required before completion; **reviewer ≠ owner** |
| Control testing | `ia_conclude_control_test` | Ineffective result requires a finding or a written no-finding rationale |
| Findings | `ia_transition_finding` | Draft → Under Review → Confirmed → Released → Responded → Closed; **confirmer ≠ author**; withdrawal requires reason |
| Findings | `ia_change_finding_severity` | Justification mandatory; full history retained |
| Responses | `ia_record_management_response` | Finding must be Released; rejection requires rationale |
| Responses | `ia_review_management_response` | Reviewer must be IA, not the responder |
| Actions | `ia_extend_action_target` | Reason + approver; original target preserved |
| Actions | `ia_close_action` | Closure notes required; evidence linkable |
| QA | `ia_start_quality_review` / `ia_conclude_quality_review` | **Lead auditor cannot clear their own engagement** |
| Reporting | `ia_create_report_version` / `ia_issue_report` | Issuance gate (evidence, working papers, findings, responses, draft-finding discussion, exit meeting); issued versions immutable |
| Closure | `ia_evaluate_engagement_closure_v2` | Strict readiness across all of the above |

---

## UI wiring

- `src/hooks/useAuditLifecycleCommands.ts` — typed React Query hooks for all fourteen commands plus readiness/history queries; failures surface the server's reason list to the operator.
- `FindingLifecycleControls` — governed transition buttons, severity change with mandatory justification, and severity history, inside the Findings tab.
- `AuditClosureTab` — new **Lifecycle Readiness** card driven by `ia_evaluate_engagement_closure_v2`, listing exactly what still blocks closure.

---

## Regression evidence

`supabase/tests/sql/internal-audit-wave2-lifecycle.sql` — 30 assertions driving one complete engagement from preparation to closure, with role impersonation for every segregation-of-duties check.

Latest run:

```
NOTICE:  WAVE 2 LIFECYCLE SUITE: all assertions passed (engagement a4021f08-…)
```

Fixtures are tagged `WAVE2-TEST`; the suite is designed to be rolled back, and the run above was cleaned up afterwards. Recorded `ia_audit_event` rows are immutable by design and intentionally retained.

---

## Not in Wave 2 (carried to Wave 3)

- Omni-Comms migration of IA notifications: `ia_auto_notification_log` and the IA triggers still bypass the communication façade (GAP-14). Wave 2 repaired the defect but did not re-platform the channel.
- Bulk/portfolio-level QA sampling and thematic analysis.
- RLS policy coverage for the 89 tables flagged `RLS enabled, no policy` outside the IA estate.

---

## WAVE 2 RESULT: PASS

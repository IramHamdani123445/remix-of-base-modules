# Internal Audit — Demo / UAT Readiness and Open Defect Register

Date: 2026-08-29
Basis: UI-first walkthrough of the running application with five authenticated certification personas, reconciled against the database.

## 1. Readiness summary

| Area | Verdict |
| --- | --- |
| Annual planning (create, submit, approve, close, carry forward) | Ready |
| Engagement execution (RCM, activities, control tests, evidence, working papers) | Ready |
| Findings, management responses, disputes and escalation | Ready |
| Corrective actions, verification, follow-up, post-closure monitoring | Ready |
| Closure and cross-year lineage | Ready |
| Governed communications (In-App, Email) | Ready — content rendering gap (DEF-S1B-38) |
| Registers and exports (Excel / CSV / PDF / DOCX / Print) | Ready — one count reconciliation to confirm (DEF-S1B-42) |
| Quality Reviewer persona | **Blocked for demo** (DEF-S1B-32) |
| Management Respondent persona | **Blocked for demo** (DEF-S1B-33), view scoping to tighten (DEF-S1B-34) |
| Reporting pack (Engagement Summary, Overdue Actions, Plan Slippage) | Not demo-ready (DEF-S1B-37) |

## 2. Open defect register

| ID | Severity | Area | Observed | Expected |
| --- | --- | --- | --- | --- |
| DEF-S1B-32 | High | Access scoping | Quality Reviewer opening ENG-2027-002 sees "Audit not found". | A reviewer assigned to an engagement's quality review can open it read-only with the Quality Review tab active. |
| DEF-S1B-33 | High | Navigation | Management Respondent sidebar renders "No modules assigned"; no Internal Audit navigation at all. | A management module group with Findings Requiring Response, My Corrective Actions and Follow-Up. |
| DEF-S1B-34 | High | View scoping | Management Respondent can open the full auditor workspace (Programme / RCM, Working Papers, Evidence, Quality Review tabs). | Management sees only findings addressed to them, their responses, their actions and follow-ups. |
| DEF-S1B-35 | Medium | Entitlement UI | "Create Annual Plan", "New Audit", "Submit" and `/audit/config` render for QA, Team Member and Management personas; the backend correctly denies the action. | Unentitled controls and routes are hidden, not merely denied on submit. |
| DEF-S1B-36 | Medium | Discoverability | `/audit/audits` defaults to "Approved plans", so 2027 engagements under the now-closed plan show a count of 0 for Lead Auditor and Team Member. | Default scope includes engagements the user is assigned to, regardless of plan status. |
| DEF-S1B-37 | Medium | Reporting | Engagement Summary renders placeholder data; Overdue Actions count does not match the Action Centre; Plan Slippage has no data linkage. | Reports read the same governed read models as the Action Centre. |
| DEF-S1B-38 | Medium | Communications UX | In-app notifications show a generic "Notification / Info" title with no subject, body or deep link. | Subject and summary from the rendered Omni-Comms message, with a link to the audit object. |
| DEF-S1B-42 | Medium | Reporting reconciliation | Action Register CSV export returned 5 data rows while the register tab badge showed 6. | Export row count equals the filtered register count. |
| DEF-S1B-39 | Low | Presentation | Closed engagements still display "3 finding(s) have no supporting evidence attached." | Evidence banners suppressed or historicised once an engagement is closed. |
| DEF-S1B-40 | Low | Navigation consistency | Sidebar groups (Execution, Reporting, Risk, Reference) appear on some audit routes and not on the dashboard. | One stable Internal Audit navigation model across all audit routes. |
| DEF-S1B-41 | Low | Console hygiene | React Fragment prop warning from `AuditLifecycleStepper`. | No console warnings during the demo path. |

## 3. Recommended sequencing before the business demo

1. DEF-S1B-32 and DEF-S1B-33 — required to demonstrate the QA and Management personas.
2. DEF-S1B-34 and DEF-S1B-35 — required for a credible segregation-of-duties story.
3. DEF-S1B-36, DEF-S1B-37, DEF-S1B-42 — required if reports and registers are shown.
4. DEF-S1B-38, DEF-S1B-39, DEF-S1B-40, DEF-S1B-41 — cosmetic; can follow the demo.

No lifecycle or platform development is required. All open items are presentation, navigation, scoping or reporting-linkage defects.

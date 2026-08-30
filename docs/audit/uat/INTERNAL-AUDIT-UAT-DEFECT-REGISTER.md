# Internal Audit UAT — Defect Register

Document ID: IA-UAT-DEF-001
Version: 1.0
Date: 2026-08-31
Pass: UAT First Pass (no development performed during execution)

## Summary

| Severity | Open | Notes |
| --- | --- | --- |
| Blocker | 1 | UAT-DEF-01 |
| Critical | 1 | UAT-DEF-02 |
| High | 2 | UAT-DEF-03, UAT-DEF-04 |
| Medium | 3 | UAT-DEF-05, UAT-DEF-06, UAT-DEF-07 |
| Low | 1 | UAT-DEF-08 |

## Defects

### UAT-DEF-01 — Audit System Administrator sees no reference data (Blocker)
Persona: Audit System Administrator
Route: `/audit/departments`, `/audit/functions`, `/audit/config`
Expected: The administrator maintains audit reference data; department master lists the active SSB departments.
Observed: Department Master renders with Total 0 / High 0 / Medium 0 / Low 0 and "No departments found",
while the same data is visible to the Lead Auditor. Business Functions and Configuration are likewise empty.
Impact: The entire administration area (UAT-B) cannot be exercised by the persona that owns it.
Diagnosis: row-level scoping for audit reference tables does not include the administrator role.

### UAT-DEF-02 — Management Respondent sees the full auditor workspace (Critical)
Persona: Management Respondent — Compliance
Route: `/audit/audits/{engagement}` for an engagement of their own department (ENG-2029-009)
Expected: The auditee sees only their response surface — findings addressed to them, their responses,
their corrective actions and the issued report.
Observed: The complete internal auditor workspace is rendered: Preparation, Programme / RCM, Activities,
Control Tests, Evidence, Working Papers, Quality Review, Closure and Timeline tabs, the lifecycle stepper,
internal warnings ("1 finding(s) have no supporting evidence attached"), the Audit Progress panel and a
"Begin Fieldwork" recommended action.
Impact: Audit strategy, untested work in progress and unissued findings are disclosed to the audited party.
This is a confidentiality and independence breach and an audit-standards non-conformance.

### UAT-DEF-03 — Unentitled controls rendered for non-owning personas (High)
Personas: Lead Auditor, Quality Reviewer, Management Respondent
Routes: `/audit/config`, `/audit/departments`
Expected: Configuration and reference-data maintenance is reachable only by the Audit System Administrator;
other personas receive an access-denied page.
Observed: These routes load for Lead Auditor and Quality Reviewer, and administrative controls such as
"Add Department" and "Recalculate Risk" are rendered. The data layer blocks writes, but the UI advertises
capability the persona does not hold.
Impact: Misleading entitlement surface; testers cannot distinguish an entitlement failure from a data failure.

### UAT-DEF-04 — Engagement Summary reporting shows zero (High)
Persona: Head of Internal Audit
Route: Reporting / Engagement Summary
Expected: Counts reconcile to the 2029 portfolio held in the database.
Observed: The summary reports 0 engagements although engagements, findings and actions exist and are
visible in the Audits list and the Action Centre.
Impact: Board and committee reporting cannot be relied upon. Previously raised as DEF-S1B-37; still open.

### UAT-DEF-05 — Cross-department access returns a generic "Audit not found" (Medium)
Persona: Management Respondent — Compliance opening a Benefits engagement
Expected: An explicit "You are not authorised to view this audit" message.
Observed: "Audit not found — The requested audit could not be found."
Impact: No data leak (scoping holds), but the message misrepresents an authorisation outcome as a
missing record and will generate false support calls.

### UAT-DEF-06 — Audits list default filter hides engagements of closed plans (Medium)
Persona: Lead Auditor, Head of Internal Audit
Route: `/audit/audits`
Observed: The list defaults to approved plans only, so 2027 engagements are absent until the filter is cleared.
Impact: Historical engagements appear missing to business users. Previously raised as DEF-S1B-36.

### UAT-DEF-07 — Sidebar navigation collapses between routes (Medium)
Personas: All
Observed: The Internal Audit navigation tree collapses to its top-level entry after certain route changes,
requiring re-expansion on each step.
Impact: Slows every persona journey; repeatedly reported by testers as the main usability irritation.

### UAT-DEF-08 — React Fragment prop warning on the lifecycle stepper (Low)
Component: `AuditLifecycleStepper`
Observed: "Invalid prop supplied to React.Fragment" console warnings on every engagement workspace load.
Impact: Console noise only; no functional effect.

## Verified as resolved during this pass

| Reference | Result |
| --- | --- |
| DEF-S1B-32 Quality Reviewer cannot open engagements | Resolved — Quality Reviewer opens the engagement workspace and the Quality Review tab |
| SEC-001 Plan approval restricted to Head of Internal Audit | Confirmed — denied for Lead Auditor, Quality Reviewer and Administrator |
| Anonymous access | Confirmed — all `/audit/*` routes redirect to `/login` |
| Department scoping for Management Respondents | Confirmed — only own-department audits are listed |

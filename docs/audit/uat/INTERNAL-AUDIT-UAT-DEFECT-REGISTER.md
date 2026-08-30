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

---

## Remediation Wave 1 — Closure Evidence (retest 2026-08-30)

Scope: UAT-DEF-01 / 02 / 03 / 04 only. No UAT data rebuilt; certified business lifecycle
and Omni-Comms routing untouched.

| Defect | Root cause | Fix | Retest evidence | Result |
|---|---|---|---|---|
| UAT-DEF-01 Audit Admin sees no reference data | `ia_is_ia_user()` excluded `IA_AUDIT_ADMIN`; role lacked `configure` entitlements | Added `ia_is_audit_admin()`, widened `ia_is_ia_user()`, granted admin entitlements | `audit.admin` → `/audit/departments` renders Department Master, 10 departments, Add/Export/Recalculate available | PASS |
| UAT-DEF-02 Management sees auditor-private workspace | `EngagementDetail` rendered all tabs regardless of persona | Persona gating via `useInternalAuditPersona`; management limited to Overview / Findings / Responses / Actions / Timeline | `audit.mgmt.benefits` → ENG-2029-002 shows only the 5 permitted tabs; no Programme/Activities/Evidence/Working Papers/Quality/Closure | PASS |
| UAT-DEF-03 Admin controls advertised to unentitled users | Administration routes not entitlement-gated | `AuditEntitlementGate` applied to `/audit/config`, `/audit/departments`, `/audit/functions`, `/audit/auditors` | `audit.lead` denied on all 4 admin routes; `/audit/audits` still accessible | PASS |
| UAT-DEF-04 Engagement Summary counts zero | PostgREST embed on `annual_plan_id` (no FK) failed the whole request (PGRST200) | Removed embed; fiscal year resolved with a second `ia_annual_plans` read | `audit.hia` → Engagement Summary shows 57 engagements, 7 closed, 50 in flight, 11 with high/critical findings, plan years populated | PASS |

Targeted retest: **100% PASS (4/4)**
RLS/entitlement regression check: internal-audit-only tables still closed to management respondents.
Build/typecheck: clean.

**READY FOR FINAL BUSINESS UAT SIGN-OFF: YES**

---

## Final closure status (2026-08-31)

| Defect | Severity | Status | Disposition |
|---|---|---|---|
| UAT-DEF-01 | Blocker | CLOSED | Retested — administrator reference data restored |
| UAT-DEF-02 | Critical | CLOSED | Retested — auditor-private tabs hidden from management |
| UAT-DEF-03 | High | CLOSED | Retested — administration routes entitlement-gated |
| UAT-DEF-04 | High | CLOSED | Retested — Engagement Summary reconciles to 57 engagements |
| UAT-DEF-05 | Medium | OPEN — DEFERRED | POST-UAT UX BACKLOG. Re-verified at closure: scoping holds, no data disclosed; message wording only |
| UAT-DEF-06 | Medium | OPEN — DEFERRED | POST-UAT USABILITY BACKLOG. Data reachable once the plan filter is cleared |
| UAT-DEF-07 | Medium | OPEN — DEFERRED | POST-UAT USABILITY BACKLOG. Navigation reachable; no data impact |
| UAT-DEF-08 | Low | OPEN — DEFERRED | TECHNICAL CLEANUP BACKLOG. Console warning only |

No Blocker, Critical or High defect remains open. Closure position recorded in
`INTERNAL-AUDIT-UAT-FINAL-SIGNOFF.md`.

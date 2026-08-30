# Compliance & Enforcement — Persona UI Certification (real logins)

Environment: TEST (`non_production`) · Executed: 2026-08-30 (UTC) · Method: Playwright against the running app, real sign-in per persona with the changed password `CompUAT@2026`.

Supersedes the `BLOCKED_TEST_AUTH` note in `Compliance_Final_Scenario_Certification.md` — per-persona UI certification is now achieved.

## 1. Login results

| # | Persona | Email | Role | Login |
|---|---|---|---|:-:|
| 1 | Compliance Admin | `mipl.student+compliance.admin@gmail.com` | `ComplianceAdmin` | PASS |
| 2 | Compliance Manager | `mipl.student+compliance.manager@gmail.com` | `ComplianceHead` | PASS |
| 3 | Compliance Officer | `mipl.student+compliance.officer@gmail.com` | `ComplianceInspector` | PASS |
| 4 | Compliance Supervisor | `mipl.student+compliance.supervisor@gmail.com` | `SeniorInspector` | PASS |
| 5 | Field Inspector | `mipl.student+field.inspector@gmail.com` | `ComplianceInspector` | PASS |
| 6 | Finance | `mipl.student+finance@gmail.com` | `ComplianceFinanceUser` | PASS |
| 7 | Legal | `mipl.student+legal@gmail.com` | `ComplianceLegalOfficer` | PASS |
| 8 | Reports Viewer | `mipl.student+reports.viewer@gmail.com` | `ComplianceReportsViewer` | PASS |
| 9 | Restricted | `mipl.student+restricted@gmail.com` | `ReadOnly` | PASS (all compliance routes denied, as designed) |

## 2. Route access matrix outcome

47 route expectations were evaluated across the nine personas. Result: **43 PASS**, 0 unauthorised access, 4 observations (below). No persona obtained access to a screen its approved matrix denies.

Highlights:
- Restricted: 3/3 denials confirmed (`/compliance/dashboard`, `/compliance/violations`, `/compliance/reports`).
- Legal: legal queue, recommendation queue, proceedings, legal dashboard and Reports all render; `/compliance/arrangements/new` and rule engine denied.
- Reports Viewer: Reports hub, Arrears report and Dashboard render read-only; rule engine denied.
- Finance: arrangements register, installments due, breaches, payment allocation and Arrears report render; violations, cases and rule engine denied.
- Officer / Supervisor / Field Inspector: violations, cases, notices, field execution, approval inbox and pending review all render.

## 3. Defects fixed during this certification

| ID | Defect | Fix |
|---|---|---|
| DEF-PER-01 | 58 legacy compliance routes (e.g. `/compliance/settings/*`, `/compliance/audit-planning/*`, `/compliance/legal/*`) had no `app_modules` row, so every non-admin persona fell closed. | `COMPLIANCE_ROUTE_ALIASES` + `canonicalizeCompliancePath` in `src/lib/compliance/accessResolution.ts` canonicalise the alias to the registered route before permission evaluation. Routing and rendering untouched. |
| DEF-PER-02 | Hub/index routes (`/compliance/reports`, `/compliance/arrangements`) have no own module row, denying users who could view their children. | Hub-descendant rule: a hub renders when the user can view at least one registered descendant module; otherwise still fail-closed. |
| DEF-PER-03 | `ComplianceFinanceUser`, `ComplianceLegalOfficer`, `ComplianceReportsViewer` were granted the route-less container modules (`ce_dashboards`, `compliance_reports`) but not the route-bearing `compliance_dashboard` / `cer_rpt_arrears`. | Additive migration granting `view` on those two modules to the three new UAT roles only. No existing role, module or action modified. |
| DEF-PER-04 | `/compliance/dashboard/legal` had no registry row. | Alias to the registered `/compliance/workbench/legal` (`ce_legal_dashboard`). |

## 4. Observations (no code change; require a client decision)

- **OB-1 — Rule Engine visible to Manager / Officer / Supervisor / Field Inspector.** `/compliance/settings/rule-engine` resolves to `cer_adm_rules`, on which the pre-existing roles `ComplianceHead`, `ComplianceInspector` and `SeniorInspector` already hold `view`. The verification checklist expects Administration to be Admin-only. The approved plan (§3.1) forbids modifying existing roles' grants, so this was left as-is. Revoking `cer_adm_rules.view` from those three roles closes it if the client confirms.
- **OB-2 — `/admin/users` renders "Page not found" instead of "Access Denied"** for every compliance persona. Access is effectively denied (no user administration is reachable); only the message differs.
- **OB-3 — `/compliance/dashboard` redirects to `/compliance/workbench/manager`.** Finance therefore lands on the manager workbench and is denied, even though the matrix grants Finance a "Dashboard". Finance's working landing page is `/compliance/my-work-queue`. A role-aware landing redirect would resolve it; not changed here as it is business behaviour.
- **OB-4 — Password state.** All nine accounts have completed the forced first-login change; the active UAT password is the tester-set value, not the seeded temporary secret.

## 5. Verdict

**COMPLIANCE PERSONA UI CERTIFICATION: PASS** — nine real logins, no unauthorised access, four defects fixed, four observations recorded for client decision.

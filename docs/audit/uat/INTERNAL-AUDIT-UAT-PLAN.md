# Internal Audit Module — Formal User Acceptance Test Plan

Document ID: IA-UAT-PLAN-001
Version: 1.0
Date: 2026-08-31
Environment: TEST (Lovable preview instance, live database)
Baseline HEAD: bb1b0a41c38616665e1be04b91b8d2047f2d9568

## 1. Purpose

Formal business-user acceptance testing of the Internal Audit module. UAT validates that the
delivered module supports the Internal Audit function end to end — annual planning, engagement
execution, findings and management response, corrective action tracking, quality review, reporting,
closure and carry-forward — with correct segregation of duties for every persona.

## 2. Scope

In scope:
- Annual planning, plan approval, engagement launch and preparation
- Programme / Risk Control Matrix, activities, control testing
- Evidence, working papers, findings and recommendations
- Management responses, corrective actions, follow-up verification
- Quality review, report issuance, engagement closure, plan closure and carry-forward
- Action Centre registers, exports, dashboards
- Reference data: departments, business functions, auditor profiles, configuration
- Security: authentication, route entitlement, department scoping, segregation of duties
- Communications emitted through the Omni-Comms façade
- Documentation: role-based user manuals and the in-app manuals page

Out of scope:
- Provider-level email/SMS delivery infrastructure (certified separately under Omni-Comms)
- Other business modules (Benefits, Compliance, Legal, Finance) except as audited departments

## 3. Personas under test

| Persona | Account | Business responsibility |
| --- | --- | --- |
| Audit System Administrator | audit.admin@mishainfotech.com | Reference data, configuration, no audit judgement |
| Head of Internal Audit (HIA) | audit.hia@mishainfotech.com | Plan approval, closure, board reporting |
| Lead Auditor | audit.lead@mishainfotech.com | Engagement launch, programme, issuance |
| Audit Team Member 1 | audit.auditor1@mishainfotech.com | Fieldwork, evidence, working papers, findings |
| Audit Team Member 2 | audit.auditor2@mishainfotech.com | Fieldwork on a second engagement |
| Quality Reviewer | audit.qa@mishainfotech.com | Independent quality review sign-off |
| Management Respondent — Benefits | audit.mgmt.benefits@mishainfotech.com | Responses and corrective actions (Benefits only) |
| Management Respondent — Compliance | audit.mgmt.compliance@mishainfotech.com | Responses and corrective actions (Compliance only) |
| Management Respondent — Finance | audit.mgmt.finance@mishainfotech.com | Responses and corrective actions (Finance only) |

## 4. Test case pack

108 formal cases are held in:
- `docs/audit/uat/INTERNAL-AUDIT-UAT-CASES.csv` (machine-readable execution sheet)
- `docs/audit/uat/INTERNAL-AUDIT-UAT-CASES.md` (business-readable)

Case groups: UAT-A Access & Security, UAT-B Reference Data, UAT-C Planning & Approval,
UAT-D Engagement Execution, UAT-E Findings & Responses, UAT-F Actions & Follow-up,
UAT-G Quality Review, Reporting & Closure, UAT-H Registers, Exports & Dashboards,
UAT-I Communications & Documentation.

## 5. Entry criteria

- All nine personas active with audit roles assigned — MET
- 2027 (closed), 2028 (approved) and 2029 (in-flight) portfolios seeded — MET
- Module deployed at the stated baseline HEAD — MET
- Communications restricted to certification recipients — MET

## 6. Exit criteria

- 100% of cases executed
- Zero open Blocker or Critical defects
- Every High defect either fixed and retested, or accepted in writing by the audit sponsor
- Traceability matrix complete: each case mapped to a business requirement and result

## 7. Execution method

Real UI, real personas, real sessions. Each persona is signed in with its own session; navigation
and business actions are performed through the application UI. Evidence is captured as full-page
screenshots per persona per route, retained under the UAT evidence folder. No development changes
are made during the first pass; defects are recorded and triaged after the pass completes.

## 8. Severity definitions

| Severity | Definition |
| --- | --- |
| Blocker | Business process cannot be completed; no workaround |
| Critical | Confidentiality, integrity or segregation-of-duties breach |
| High | Material function incorrect; workaround exists but is not acceptable long term |
| Medium | Function works but is misleading, incomplete or inefficient |
| Low | Cosmetic or wording issue |

## 9. Deliverables

1. This plan
2. UAT case pack (CSV + MD)
3. Defect register — `INTERNAL-AUDIT-UAT-DEFECT-REGISTER.md`
4. Traceability matrix — `INTERNAL-AUDIT-UAT-TRACEABILITY.md`
5. Execution report and recommendation — `INTERNAL-AUDIT-UAT-EXECUTION-REPORT.md`

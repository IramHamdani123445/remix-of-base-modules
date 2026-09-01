# Internal Audit — Stage 1B Final Business Certification

Date: 2026-08-29
Scope: Internal Audit business lifecycle (planning → engagement → findings → responses → actions → follow-up → closure → cross-year), validated through the UI on the TEST instance.
Nature: Business certification. No new lifecycle development was performed for this consolidation.

## 1. Certified business state

| Item | State |
| --- | --- |
| 2027 Risk-Based Annual Internal Audit Plan | Closed (v2), 22 engagements with terminal dispositions |
| 2028 Risk-Based Annual Internal Audit Plan | Approved (v2), carry-forward lineage from 2027 |
| ENG-2027-001 | Closed — clean audit journey (E2E-1) |
| ENG-2027-002 | Closed — high-risk audit with findings, responses, corrective actions (E2E-2) |
| ENG-2027-003 | Closed — disputed finding, escalation, retained with disagreement (E2E-3) |
| ENG-2027-004 | Closed – Actions Pending, post-closure monitoring and follow-up completed (E2E-4 / E2E-5) |
| Omni-Comms delivery | Certified revision in force; In-App and Email delivery proven for Internal Audit events |

## 2. End-to-end journeys certified

| Journey | Evidence |
| --- | --- |
| E2E-1 Clean audit | `docs/audit/2027-e2e1-clean-audit-journey-eng-2027-001.md` |
| E2E-2 High-risk with findings and actions | `docs/audit/2027-e2e2-high-risk-audit-journey-eng-2027-002.md` |
| E2E-3 Disputed finding and escalation | `docs/audit/2027-e2e3-disputed-finding-journey-eng-2027-003.md` |
| E2E-4 Closed – Actions Pending and escalation ladder | `docs/audit/2027-e2e4-actions-pending-closure-eng-2027-004.md` |
| E2E-5 Cross-year closeout and 2028 lineage | `docs/audit/2027-e2e5-cross-year-plan-closeout-followup.md` |
| Omni-Comms delivery certification | `docs/audit/2026-08-28-internal-audit-wave4-delivery-certified.md` |

## 3. UI-first validation performed for this consolidation

Personas exercised against the running application with real authenticated sessions:

| Persona | Account | Result |
| --- | --- | --- |
| Head of Internal Audit | w4-cert-hia@certification.invalid | Dashboard KPIs reconcile with the database (6 plans, 3 closed/active split, 10 departments). Plan portfolio, approval and closure surfaces reachable. |
| Lead Auditor | w4-cert-lead@certification.invalid | Engagement workspace, lifecycle stepper, fieldwork and findings usable. Plan approval correctly denied. |
| Audit Team Member | w4-cert-auditor@certification.invalid | Engagement workspace fully populated (6 activities, 6 control tests, 9 evidence items, 6 working papers, 3 findings). Action Centre "My Audit Work" = 6. In-app notifications delivered. |
| Quality Reviewer | w4-cert-qa@certification.invalid | Action Centre and plan portfolio reachable; **cannot open reviewed engagements** (DEF-S1B-32). |
| Management Respondent | w4-cert-mgmt-benefits@certification.invalid | Management Actions queue = 1, scoped findings visible; navigation and view-scoping defects recorded (DEF-S1B-33, DEF-S1B-34). |

Exports: Action Register export menu offers Excel, CSV, PDF, DOCX and Print. Excel and CSV downloads succeed and carry the governed column set (Action, Description, Audit, Plan year, Department, Finding, Severity, Owner, Original target, Current target, Extensions, Progress, Evidence, Status, Overdue days).

## 4. Lifecycle defects remediated during Stage 1B

DEF-S1B-11 and DEF-S1B-14 through DEF-S1B-31 were raised and closed during E2E-1 to E2E-5. They covered QA segregation of duties, preparation dependencies, issuance thresholds, stage normalisation, action permissions, QA rework locking, management-response versioning and resubmission, escalation mapping, corrective-action evidence enforcement, carry-forward lineage, immutable closure history and terminal-state logic. Each is evidenced in the corresponding E2E document.

## 5. Certification verdict

**Business lifecycle: CERTIFIED.** Planning, execution, findings, management response, corrective action, follow-up, closure, cross-year carry-forward and governed communications all operate end to end with a complete audit trail.

**Demo / UAT readiness: CERTIFIED WITH CONDITIONS.** The remaining open items are presentation, navigation and view-scoping defects (DEF-S1B-32 to DEF-S1B-42) documented in `docs/audit/2027-internal-audit-demo-uat-readiness.md`. Two of them (DEF-S1B-32, DEF-S1B-33) should be fixed before a Quality Reviewer or Management persona is demonstrated live.

# Internal Audit Module — Final Business UAT Closure & Sign-Off

Document ID: IA-UAT-SIGNOFF-001
Version: 1.0
Date: 2026-08-31
Environment: TEST instance, live database, real persona sessions
Repository HEAD at closure: `998f46dd53` (Remediated UAT defects 1-4)
Functional development during closure: none (verification and documentation only)

---

## 1. Scope of this closure

This report consolidates the three UAT activities into a single acceptance position:

| Activity | Reference | Outcome |
| --- | --- | --- |
| First pass (108 cases, 9 personas, 30 areas) | IA-UAT-RPT-001 | 96 pass / 12 not passed — CONDITIONAL |
| Remediation Wave 1 (UAT-DEF-01…04) | IA-UAT-DEF-001 | 4/4 defects closed with retest evidence |
| Targeted retest, security regression and smoke verification | this report | No regression detected |

No UAT data was rebuilt. The certified business lifecycle, Omni-Comms routing and Internal Audit
communications remain as previously accepted.

---

## 2. Final case reconciliation (108 cases)

| Result | Cases | % |
| --- | --- | --- |
| PASS (first pass) | 96 | 88.9% |
| PASS AFTER REMEDIATION | 9 | 8.3% |
| **Total passing** | **105** | **97.2%** |
| FAIL (DEFERRED — accepted to post-UAT backlog) | 3 | 2.8% |
| Blocked at closure | 0 | 0% |

Per-case results are recorded in `INTERNAL-AUDIT-UAT-CASES.csv` (Result / Defect ID / Tester /
Execution Date columns).

Cases converted to PASS by Remediation Wave 1:

| Case | Defect | Retest evidence |
| --- | --- | --- |
| IA-UAT-ADM-001…004, IA-UAT-UNV-003 | UAT-DEF-01 | `audit.admin` renders Department Master (10 departments), Business Functions, Configuration and maintenance controls |
| IA-UAT-LGN-005, IA-UAT-SEC-006 | UAT-DEF-02 | `audit.mgmt.benefits` sees only Overview / Findings / Responses / Actions / Timeline on an own-department engagement |
| IA-UAT-RPT-003, IA-UAT-REG-001 | UAT-DEF-04 | Engagement Summary reports 57 engagements with plan years, severity and closure counts populated |

Cases remaining open (deferred):

| Case | Defect | Severity | Disposition |
| --- | --- | --- | --- |
| IA-UAT-SEC-008 | UAT-DEF-05 generic "Audit not found" on cross-department access | Medium | POST-UAT UX BACKLOG — scoping holds, message wording only |
| IA-UAT-SCH2-002 | UAT-DEF-06 audits list defaults to approved plans | Medium | POST-UAT USABILITY BACKLOG — data reachable after clearing the filter |
| IA-UAT-USM-001 | UAT-DEF-07 sidebar tree collapses between routes | Medium | POST-UAT USABILITY BACKLOG — navigation reachable, no data impact |

UAT-DEF-08 (React Fragment console warning on `AuditLifecycleStepper`) is recorded against no case and
is assigned to TECHNICAL CLEANUP BACKLOG.

---

## 3. Security and segregation-of-duties regression (non-mutating, re-run at closure)

| Check | Persona | Result |
| --- | --- | --- |
| Annual plan approval restricted to Head of Internal Audit | `audit.admin` on `/audit/plan-approval` | DENIED — PASS |
| Administrator retains reference-data ownership | `audit.admin` on `/audit/config` | Rendered with maintenance controls — PASS |
| Cross-department engagement access | `audit.mgmt.benefits` opening a Compliance engagement | No data disclosed ("Audit not found") — PASS with UAT-DEF-05 |
| Auditor-private surfaces hidden from management | `audit.mgmt.benefits` on own-department engagement | 5 permitted tabs only — PASS |
| Administration routes gated for auditors | `audit.lead` on admin routes | DENIED — PASS |
| Anonymous access | unauthenticated on `/audit/dashboard`, `/audit/audits`, `/audit/reports/engagement-summary` | Redirected to `/login` — PASS |

No RLS or entitlement regression was observed against the remediated build.

---

## 4. Reporting smoke verification (Head of Internal Audit)

| Report | Observed | Result |
| --- | --- | --- |
| Engagement Summary | 57 engagements, plan years, closure and severity counts | PASS |
| Overdue Actions & Aging | 19 actions in scope, 2 overdue, 1 critical/high overdue, 10 open, aging chart and detail table | PASS |
| Plan Slippage | Renders with plan/engagement data | PASS |
| Carry-Forward Aging | Renders with carry-forward population | PASS |

No console errors were raised on the reporting routes.

---

## 5. Business process smoke verification (record evidence, live TEST database)

| Lifecycle stage | Records |
| --- | --- |
| Annual plans (approved / closed) | 7 (4 approved, 1 closed) |
| Engagements | 57 — 9 planned, 4 in progress, 17 notified, 4 closed, 1 closed with actions pending, 17 carried forward |
| Activities / control tests | 18 / 13 |
| Evidence / working papers | 27 / 18 |
| Findings | 22 |
| Management responses | 23 |
| Corrective actions tracked | 19 |
| Quality reviews | 7 |
| Audit reports | 11 |
| Follow-ups | 6 |
| Plan carry-forwards | 17 |
| Internal Audit communications (Omni-Comms requests) | 18 — 11 completed, 1 dispatching, 6 legacy pre-remediation failures already accounted for in the communication recovery acceptance |

The end-to-end chain — plan → approval → engagement → preparation → programme → fieldwork → evidence →
findings → management response → corrective action → follow-up → quality review → report → closure →
carry-forward — is represented by live records for each stage.

---

## 6. User manual alignment

The role manuals (`docs/audit/user-manual/`, published at `/audit/user-manuals`) were checked against
the remediated entitlement model. The Management Respondent manual documents only the response surface
(overview, findings, responses, actions, timeline) and does not instruct the auditee to use programme,
fieldwork, evidence, working paper, quality review or closure functions. Manual content and enforced
visibility are aligned; no manual re-issue is required for Remediation Wave 1.

---

## 7. Residual risk assessment

| Risk | Rating | Rationale |
| --- | --- | --- |
| Confidentiality / independence breach | Low | Auditor-private surfaces are persona-gated and re-verified at closure |
| Unauthorised configuration change | Low | Administration routes entitlement-gated; data layer refuses writes for non-owners |
| Board / committee reporting reliability | Low | Reporting counts reconcile to the live portfolio |
| User experience friction (DEF-05/06/07) | Medium — accepted | Cosmetic and navigational; no data loss, no authorisation weakness |
| Console warning (DEF-08) | Low — accepted | No functional effect |

---

## 8. Acceptance decision

**APPROVED WITH CONDITIONS.**

Conditions:
1. UAT-DEF-05, UAT-DEF-06 and UAT-DEF-07 are scheduled into the first post-go-live usability release.
2. UAT-DEF-08 is scheduled into technical cleanup.
3. No further functional change is made to the Internal Audit module without a targeted regression of
   the security checks in section 3.

---

## 9. Sign-off matrix

| Role | Name | Responsibility | Date | Signature |
| --- | --- | --- | --- | --- |
| Head of Internal Audit | _________________ | Business owner acceptance | __________ | __________ |
| Lead Auditor | _________________ | Operational readiness | __________ | __________ |
| Quality Reviewer | _________________ | Quality assurance conformance | __________ | __________ |
| Audit System Administrator | _________________ | Reference data and configuration readiness | __________ | __________ |
| Management Respondent (representative) | _________________ | Auditee experience acceptance | __________ | __________ |
| Platform / Delivery Lead | _________________ | Technical delivery and defect disposition | __________ | __________ |

---

## 10. Document set

| Document | Path |
| --- | --- |
| UAT Plan | `docs/audit/uat/INTERNAL-AUDIT-UAT-PLAN.md` |
| UAT Case Pack (narrative) | `docs/audit/uat/INTERNAL-AUDIT-UAT-CASES.md` |
| UAT Case Pack (results) | `docs/audit/uat/INTERNAL-AUDIT-UAT-CASES.csv` |
| First Pass Execution Report | `docs/audit/uat/INTERNAL-AUDIT-UAT-EXECUTION-REPORT.md` |
| Defect Register | `docs/audit/uat/INTERNAL-AUDIT-UAT-DEFECT-REGISTER.md` |
| Traceability Matrix | `docs/audit/uat/INTERNAL-AUDIT-UAT-TRACEABILITY.md` |
| Final Closure & Sign-Off (this document) | `docs/audit/uat/INTERNAL-AUDIT-UAT-FINAL-SIGNOFF.md` |
| Role User Manuals | `docs/audit/user-manual/`, `/audit/user-manuals` |

# Internal Audit Module — UAT Execution Report (First Pass)

Document ID: IA-UAT-RPT-001
Version: 1.0
Date: 2026-08-31
Environment: TEST instance, live database
Baseline HEAD: bb1b0a41c38616665e1be04b91b8d2047f2d9568
Development performed during execution: none

## 1. Execution summary

| Metric | Value |
| --- | --- |
| Cases in pack | 108 |
| Cases executed | 108 |
| Passed | 96 |
| Failed | 8 |
| Blocked | 4 (administration cases blocked by UAT-DEF-01) |
| Personas exercised | 9 of 9, each with its own real session |
| Functional areas covered | 30 |

## 2. Results by area

| Area | Cases | Pass | Fail / Blocked | Verdict |
| --- | --- | --- | --- | --- |
| UAT-A Access & Security | 18 | 15 | 3 | Conditional — one Critical |
| UAT-B Reference Data | 12 | 7 | 5 | Fail — Blocker |
| UAT-C Planning & Approval | 14 | 14 | 0 | Pass |
| UAT-D Engagement Execution | 18 | 18 | 0 | Pass |
| UAT-E Findings & Responses | 12 | 12 | 0 | Pass |
| UAT-F Actions & Follow-up | 11 | 11 | 0 | Pass |
| UAT-G Quality Review, Reporting & Closure | 12 | 11 | 1 | Conditional |
| UAT-H Registers, Exports & Dashboards | 8 | 6 | 2 | Conditional |
| UAT-I Communications & Documentation | 3 | 2 | 1 | Conditional |

## 3. What the business can rely on today

The audit lifecycle itself is sound. Across nine real persona sessions the module carried engagements
from an approved annual plan through preparation, programme and risk-control definition, fieldwork,
evidence, working papers, findings, management response, corrective action, follow-up verification,
quality review, report issuance, engagement closure, annual plan closure and carry-forward into the
successor plan. Segregation of duties held where it matters most: plan approval was refused for the
Lead Auditor, Quality Reviewer and Administrator; anonymous users were redirected to sign-in on every
audit route; and Management Respondents saw only their own department's audits.

Two previously reported blockers are confirmed fixed: the Quality Reviewer can now open engagement
workspaces and record review outcomes, and management-response routing reaches the correct department.

## 4. What prevents unconditional acceptance

Two findings must be cleared before sign-off.

**UAT-DEF-01 (Blocker).** The Audit System Administrator — the persona that owns reference data —
sees an empty Department Master, empty Business Functions and empty Configuration, while the same
records are visible to auditors. The administration half of the module is therefore untestable and
unusable by its intended owner.

**UAT-DEF-02 (Critical).** A Management Respondent opening an audit of their own department is shown
the complete internal auditor workspace: preparation, programme and risk-control matrix, control tests,
evidence, working papers, quality review, closure, the lifecycle progress panel, internal data-quality
warnings and a "Begin Fieldwork" action. Audit strategy and unissued work in progress are disclosed to
the audited party. This breaches audit confidentiality and independence and cannot be accepted.

Beyond these, two High defects affect trust in the module: engagement summary reporting returns zero
against a populated portfolio (UAT-DEF-04), and administrative controls are rendered for personas that
do not hold the entitlement (UAT-DEF-03).

## 5. Recommendation

**Conditional acceptance — not approved for production release.**

Required before sign-off:
1. Fix UAT-DEF-01 and UAT-DEF-02 and retest the affected cases in full.
2. Fix UAT-DEF-03 and UAT-DEF-04, or obtain written sponsor acceptance with a dated remediation plan.
3. Medium and Low defects (UAT-DEF-05 through UAT-DEF-08) may be scheduled into the next release.

A second pass limited to UAT-A, UAT-B, UAT-G reporting and UAT-H is sufficient to close this UAT,
provided no code outside those areas changes.

## 6. Evidence

Full-page screenshots were captured for every persona and route exercised and are retained with the
UAT record. Supporting documents: `INTERNAL-AUDIT-UAT-PLAN.md`, `INTERNAL-AUDIT-UAT-CASES.csv`,
`INTERNAL-AUDIT-UAT-CASES.md`, `INTERNAL-AUDIT-UAT-DEFECT-REGISTER.md`,
`INTERNAL-AUDIT-UAT-TRACEABILITY.md`.

## 7. Sign-off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Head of Internal Audit | | | |
| Audit Sponsor | | | |
| Delivery Lead | | | |

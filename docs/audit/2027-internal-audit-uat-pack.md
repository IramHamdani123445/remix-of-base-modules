# Internal Audit — UAT Pack (Stage 1B)

Date: 2026-08-29
Environment: TEST instance. All communications are governed by Omni-Comms and restricted to certification recipients.

## 1. Test accounts

| Persona | Account | Use for |
| --- | --- | --- |
| Head of Internal Audit | w4-cert-hia@certification.invalid | Planning, approval, closure, board reporting |
| Lead Auditor | w4-cert-lead@certification.invalid | Engagement launch, RCM, fieldwork, issuance |
| Audit Team Member | w4-cert-auditor@certification.invalid | Control testing, evidence, working papers, findings |
| Quality Reviewer | w4-cert-qa@certification.invalid | Quality review, rework, satisfactory sign-off |
| Management Respondent | w4-cert-mgmt-benefits@certification.invalid | Management responses, corrective actions, evidence submission |

## 2. Reference data already in place

| Object | Reference |
| --- | --- |
| 2027 Annual Plan | Closed, 22 engagements |
| 2028 Annual Plan | Approved, carry-forward engagements from 2027 |
| ENG-2027-001 | Clean audit, closed effective |
| ENG-2027-002 | 3 findings (Critical / High / Medium), responses and corrective actions |
| ENG-2027-003 | Disputed critical finding, retained with disagreement |
| ENG-2027-004 | Closed – Actions Pending, follow-up implemented |

## 3. UAT scripts

### UAT-01 Annual planning and approval (HIA)
1. Open Internal Audit → Annual Plans.
2. Create a plan for a new fiscal year, add engagements from the audit universe, submit for approval.
3. Approve as the Head of Internal Audit and confirm the plan status moves to Approved with an approver and date.
   Expected: version increments, approval recorded, plan appears in Active Plan Progress on the dashboard.

### UAT-02 Engagement launch and preparation (Lead Auditor)
1. Open the engagement workspace from Audits (clear the "Approved plans" filter if the engagement's plan is closed — see DEF-S1B-36).
2. Complete Preparation, then Programme / RCM.
   Expected: the lifecycle stepper advances only when preparation dependencies are satisfied.

### UAT-03 Fieldwork and findings (Team Member)
1. Record control test results, attach evidence, create working papers.
2. Raise a finding with severity and recommendation.
   Expected: finding appears in the Action Centre "Findings" tab and in the engagement Findings tab.

### UAT-04 Management response and corrective action (Management)
1. Open Action Centre → Management Actions.
2. Submit a management response (accepted / partially accepted / rejected) and create a corrective action with an owner and target date.
   Expected: response versioning is recorded; a rejected response can be returned for clarification and resubmitted.

### UAT-05 Quality review and issuance (Quality Reviewer, Lead Auditor)
1. Quality Reviewer opens the engagement's Quality Review tab and records the outcome (satisfactory / rework).
2. Lead Auditor issues the report once QA is satisfactory.
   Expected: issuance is blocked while QA is outstanding or in rework.
   Note: blocked by DEF-S1B-32 until the reviewer scoping fix ships.

### UAT-06 Closure and post-closure monitoring (HIA)
1. Close the engagement. With open actions the outcome must be "Closed – Actions Pending".
2. Verify due-soon, overdue and escalation notifications reach the action owner.
   Expected: reminders emit through Omni-Comms and stop once the action is verified.

### UAT-07 Follow-up and cross-year carry-forward (HIA, Management)
1. Management submits implementation evidence; Internal Audit verifies independently.
2. Close the annual plan and confirm outstanding engagements are promoted into the next-year plan.
   Expected: lineage links are visible on the successor plan; closure history is immutable.

### UAT-08 Registers, exports and dashboard reconciliation (any persona)
1. Open Action Centre; apply the Overdue only / High-critical filters.
2. Export the Action Register as CSV and as Excel.
   Expected: exported row count equals the filtered on-screen count (confirm against DEF-S1B-42).

## 4. Known limitations to brief testers on

Refer to `docs/audit/2027-internal-audit-demo-uat-readiness.md`. In particular: Quality Reviewer engagement access (DEF-S1B-32), Management navigation and view scoping (DEF-S1B-33 / DEF-S1B-34), unentitled controls still rendered (DEF-S1B-35), default audit list filter (DEF-S1B-36), reporting pack data linkage (DEF-S1B-37) and generic in-app notification titles (DEF-S1B-38).

## 5. Defect reporting during UAT

Record each issue with persona, route, engagement or action reference, expected vs observed behaviour, and a screenshot. Continue the `DEF-S1B-nn` sequence from DEF-S1B-43.

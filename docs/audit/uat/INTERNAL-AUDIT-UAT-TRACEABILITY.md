# Internal Audit UAT — Requirement Traceability Matrix

Document ID: IA-UAT-TRC-001
Version: 1.0
Date: 2026-08-31

Each business requirement is mapped to its UAT case group, the persona that owns it, the first-pass
result and any defect raised. Case-level detail is in `INTERNAL-AUDIT-UAT-CASES.csv`.

| Req | Business requirement | Case group | Owning persona | Result | Defect |
| --- | --- | --- | --- | --- | --- |
| R-01 | Only authenticated users reach Internal Audit | UAT-A | All | Pass | — |
| R-02 | Plan approval restricted to the Head of Internal Audit | UAT-A | HIA | Pass | — |
| R-03 | Configuration restricted to the Audit System Administrator | UAT-A | Administrator | Fail | UAT-DEF-03 |
| R-04 | Management Respondents see only their own department | UAT-A | Management | Pass | — |
| R-05 | Auditee must not see internal audit working material | UAT-A | Management | Fail | UAT-DEF-02 |
| R-06 | Department master maintainable by the administrator | UAT-B | Administrator | Blocked | UAT-DEF-01 |
| R-07 | Business functions maintainable | UAT-B | Administrator | Blocked | UAT-DEF-01 |
| R-08 | Auditor profiles and capacity maintainable | UAT-B | Administrator | Pass | — |
| R-09 | Audit universe and risk assessment maintained | UAT-B | HIA | Pass | — |
| R-10 | Annual plan creation and submission | UAT-C | HIA | Pass | — |
| R-11 | Plan approval with approver and date recorded | UAT-C | HIA | Pass | — |
| R-12 | Engagement launch from an approved plan | UAT-D | Lead Auditor | Pass | — |
| R-13 | Preparation and notification to the audited department | UAT-D | Lead Auditor | Pass | — |
| R-14 | Programme / Risk Control Matrix definition | UAT-D | Lead Auditor | Pass | — |
| R-15 | Activities and control testing recorded | UAT-D | Team Member | Pass | — |
| R-16 | Evidence capture with integrity validation | UAT-D | Team Member | Pass | — |
| R-17 | Working papers linked to activities | UAT-D | Team Member | Pass | — |
| R-18 | Findings raised with severity and recommendation | UAT-E | Team Member | Pass | — |
| R-19 | Management response with accept / partial / reject | UAT-E | Management | Pass | — |
| R-20 | Response returned for clarification and resubmitted | UAT-E | Lead Auditor, Management | Pass | — |
| R-21 | Corrective actions with owner and target date | UAT-F | Management | Pass | — |
| R-22 | Independent follow-up verification by Internal Audit | UAT-F | HIA | Pass | — |
| R-23 | Due-soon, overdue and escalation reminders | UAT-F | Management | Pass | — |
| R-24 | Quality review sign-off or rework | UAT-G | Quality Reviewer | Pass | — |
| R-25 | Report issuance blocked until quality review is satisfactory | UAT-G | Lead Auditor | Pass | — |
| R-26 | Engagement closure, including Closed – Actions Pending | UAT-G | HIA | Pass | — |
| R-27 | Annual plan closure with per-engagement disposition | UAT-G | HIA | Pass | — |
| R-28 | Carry-forward into the successor plan with lineage | UAT-G | HIA | Pass | — |
| R-29 | Committee and engagement summary reporting | UAT-H | HIA | Fail | UAT-DEF-04 |
| R-30 | Action Centre registers and filters | UAT-H | All audit roles | Pass | — |
| R-31 | Register export matches the filtered view | UAT-H | All audit roles | Pass | — |
| R-32 | Executive dashboard reconciles to underlying records | UAT-H | HIA | Pass | — |
| R-33 | Historical engagements discoverable from the audits list | UAT-H | Lead Auditor | Fail | UAT-DEF-06 |
| R-34 | All notifications emitted through the Omni-Comms façade | UAT-I | All | Pass | — |
| R-35 | Role-based user manuals available and downloadable in-app | UAT-I | All | Pass | — |
| R-36 | Navigation usable throughout a persona journey | UAT-I | All | Fail | UAT-DEF-07 |

Coverage: 36 requirements, 108 executed cases, 30 functional areas. Six requirements failed or were
blocked; all are recorded in the defect register with a named severity.

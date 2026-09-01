# Internal Audit — Stage 1B / E2E-1: Clean Audit Journey (ENG-2027-001)

Environment: TEST (`platform_environment_marker = TEST`, runtime classified `non_production`).
Engagement: `b82c446a-a0b2-43f4-b026-3f3d6fecfe1b` — ENG-2027-001, Administration → Procurement & Purchasing, 2027 approved risk-based plan.

## Outcome

Complete, governed, no-findings audit lifecycle executed end to end and closed:
Launch → Preparation → RCM → Fieldwork → Reporting → Independent QA → Issuance → Closure.

Final state: `status = Closed`, `execution_status = Closed`, report `IAR-2027-001` **Issued** (version 1), 0 findings, 0 open actions.

## Personas and segregation of duties

| Persona | Role on engagement |
|---|---|
| `w4-cert-lead@certification.invalid` | Lead Auditor |
| `w4-cert-qa@certification.invalid` | Independent Quality Reviewer |
| `w4-cert-auditor@certification.invalid` | Team Member |

Negative tests (all correctly refused and logged):
- Team member attempting to launch the audit → `IA_FORBIDDEN`.
- Team member attempting to jump execution status → refused.
- Lead attempting to clear quality assurance on their own engagement → `IA_SOD_VIOLATION`.
- Report issuance before QA clearance → `IA_QA_NOT_CLEARED`.
- Quality reviewer attempting to issue the report → `IA_FORBIDDEN`.

## Journey evidence

- Preparation: `ENGAGEMENT_NOTIFICATION` and `ENTRANCE_MEETING` stages recorded, 5 checklist items completed, 2 preparation documents filed; premature completion correctly blocked.
- Risk-Control Matrix: 3 risks / 4 key controls for Procurement & Purchasing.
- Fieldwork: 4 activities executed, 4 evidence items, 4 working papers, 4 control tests concluded **Effective**, zero exceptions; all activities lead-reviewed.
- Communication: `DRAFT_FINDING_DISCUSSION` and `EXIT_MEETING` recorded with the auditee.
- Reporting: report drafted with objective, scope, methodology, executive summary, conclusion; version 1 created with content hash; independent QA cleared (`Satisfactory`); report issued; engagement closed.
- 25 immutable `ia_audit_event` entries cover every lifecycle step with actor and source command.

## Defects found and remediated this pass

**DEF-S1B-16 — Quality assurance was unreachable.**
`ia_start_quality_review` stamped the *starter* (normally the lead) as the reviewer, and engagement access ignored the engagement's named independent reviewer. The lead was then blocked by segregation of duties and the real reviewer had no access, so no audit could ever clear QA.
Fix: quality reviews now default to the engagement's independent reviewer (optional explicit `p_reviewer_id`), a review can no longer be assigned to the engagement's own lead, and the named reviewer is granted engagement access.

**DEF-S1B-17 — Report issuance gate silently unenforced.**
`ia_can_issue_report` ran as invoker, so row-level security hid the gate configuration and the evidence/working-paper rows; it always reported zero counts and skipped every threshold. Fix: the check now runs with definer rights behind an access guard and reports true counts. Verified: 4 evidence items, 4 working papers. The `report_issuance` gate is now configured and active (min 1 evidence, min 1 working paper, management responses required for any raised finding; clean audits with no findings remain valid).

Earlier defects closed on the way into this journey: DEF-S1B-11/12 (ungoverned launch and status transitions), DEF-S1B-14 (legacy department-audit dependency on preparation records), DEF-S1B-15 (overloaded communication-stage command).

## Next

E2E-2 — High-Risk journey with findings, management responses and action tracking.

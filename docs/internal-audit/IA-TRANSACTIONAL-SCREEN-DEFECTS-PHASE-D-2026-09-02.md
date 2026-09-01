# Internal Audit — Phase D Transactional Defect Register (2026-09-02)

Baseline: `132f8e06ab1d70a2295fa291c5af80602639f03a` (accepted Phase C baseline, confirmed as current HEAD before testing).

All defects below were found by executing real business transactions with real persona sessions against the live backend. Every fix was re-tested by re-running the originating batch.

| ID | Severity | Area | Defect | Business impact | Status | Verified by |
|---|---|---|---|---|---|---|
| DEF-D-001 | Medium | Audit Universe → Department Master | Two active departments could be created with the same name and office code. | Duplicate audit universe entries, split audit history, double counting in coverage reporting. | **Fixed** — unique rule on active department name within an office (inactive/historical rows unaffected). | D-A-004, D-A-007 |
| DEF-D-002 | Medium | Audit Universe → Functions | An auditable function could be moved to a different department at any time, including after it carried risk assessments and audits. | Audit history silently migrates between departments; department-level assurance coverage becomes untrue. | **Fixed** — reparenting blocked once the function has risk, audit or register history; allowed while it has none. | D-A-011, D-A-011b |
| DEF-D-003 | High | Risk → Risk Register | "Recalculate all risks" always failed: the routine wrote to automatically calculated score columns, and its history table did not exist at all. | Risk configuration changes were never propagated to existing risks. | **Fixed** — recalculation now updates risk levels only; recalculation history table created with read access limited to users who may view the risk register. | D-B-016, D-B-019 |
| DEF-D-004 | Medium | Risk → Risk Register | Inherent and residual **risk level** were never populated (score computed, level always empty). | Risk bands (Low/Medium/High/Critical) missing across the register, matrix and planning inputs. | **Fixed** — levels derived on every create/edit from the configured classification bands. | D-B-003, D-B-006 |
| DEF-D-005 | High | Risk → Risk Assessment | Overall risk score stayed at 0 and risk level stayed "Medium" no matter what impact, likelihood, control effectiveness, velocity, regulatory and reputational scores were entered. | Risk-based planning consumed meaningless scores; every assessment looked identical. | **Fixed** — overall score and level recalculated automatically on create and edit; propagation into engagement risk resolution verified. | D-B-010, D-B-011, D-B-014, D-B-015 |
| DEF-D-006 | Critical | Annual Plan → Submission | No annual plan could be submitted for approval: the approval workflow routing table was empty and had no configuration surface. | The entire annual plan approval lifecycle (submit → review → approve → revise) was unusable. | **Fixed** — plan approval and plan revision workflows registered against their events. | D-C-015, D-C-021, D-C-022 |
| DEF-D-007 | High | Annual Plan → Revision | Revising an approved plan always failed (amendment history written to non-existent columns, and current values could not be read). | Approved plans could never be amended; no amendment audit trail. | **Fixed** — amendment history records changed field, old/new value, reason, requester and material/administrative classification; material changes correctly re-enter approval. | D-C-026, D-C-027 |
| DEF-D-008 | High (security) | Annual Plan → Plan Header | Any signed-in business user, including auditee management outside Internal Audit, could create an annual audit plan header, and the preparer name was taken from the request rather than the session. | Unauthorised creation of statutory plans; unreliable preparer attribution, undermining segregation of duties on approval. | **Fixed** — creation requires audit-plan create/edit capability; preparer derived from the signed-in user; creation event logged. | D-C-001, D-C-002 |

## Governance behaviours confirmed (no defect)

- Unauthorised direct API writes to `ia_departments`, `ia_department_functions`, `ia_risk_register` and `ia_risk_assessments` are refused by row-level security (`403`), not by UI hiding alone.
- Filtered updates that a persona may not see return an empty result set rather than silently changing data — verified by post-state checks (D-A-018, D-B-013, D-B-017).
- Segregation of duties holds: the plan preparer cannot decide their own plan (D-C-017).
- Mandatory reason enforced on return/reject (D-C-018) and on plan revision.
- Status-driven locking holds in both directions: portfolio frozen on submission and after approval (D-C-016, D-C-024), editable again after a return (D-C-020).
- Invalid transitions rejected with a business-readable message (D-C-023).

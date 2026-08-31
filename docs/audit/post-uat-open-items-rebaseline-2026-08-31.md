# Internal Audit — Post-UAT Consolidated Remediation Wave

## Phase 0 — Current-Truth Rebase (2026-08-31)

Every post-UAT item was re-verified against live code and the live database before
any change was made. The already-certified lifecycle was **not** rebuilt.

| Ref | Item | Verified state at rebase |
|-----|------|--------------------------|
| IA-POST-UAT-01 | Recommended Actions are dead buttons | **CONFIRMED OPEN** — `deriveNextActions` returned label/description/icon with no `onClick`; `AuditOverviewTab` passed no handler. |
| IA-POST-UAT-02 | Follow-Up governance | **PARTIALLY CLOSED** — governed RPCs `ia_followup_schedule` / `ia_followup_record_outcome` already exist and key off canonical `action_id`. UI still uses direct CRUD. |
| IA-POST-UAT-03 | Traceability chain | OPEN — evidence chain is described in free text, not linked. |
| IA-POST-UAT-04 | Working-paper attachments | **CONFIRMED OPEN** — `AuditWorkingPapersTab` renders an "Attach File" input that `handleCreate` ignores. Private bucket `audit-attachments` exists and is the correct target. |
| IA-POST-UAT-05 | Risk propagation | OPEN — no governed `ia_save_risk_assessment`; logic sits client-side in `RiskAssessment.tsx`. |
| IA-POST-UAT-06 | Risk Register reachability | **CLOSED THIS WAVE** — page and route existed but were unreachable from navigation. |
| IA-POST-UAT-08 | Fiscal year | OPEN — `AnnualPlanForm` hard-codes `new Date().getFullYear()`; no platform fiscal master. |
| UAT-DEF-06 | Engagements plan-status filter defaulted to a single status | **ALREADY CLOSED** — default is `All Plans`; no change required. |
| IA-POST-UAT-11 | UX fixes | OPEN — `EngagementDetail` shows a generic "Audit not found" for what is an authorisation boundary. |

## Closed in this wave

### IA-POST-UAT-01 — Recommended Actions are now real commands

`NextAction` now carries a mandatory `actionKey` (`LAUNCH_AUDIT`, `BEGIN_FIELDWORK`,
`DOCUMENT_FINDINGS`, `REQUEST_MANAGEMENT_RESPONSES`, `FOLLOW_UP_OVERDUE_ACTIONS`,
`CLOSE_AUDIT`). `AuditOverviewTab` supplies a single `dispatchRecommendedAction`
resolver that routes each key to the canonical governed surface — launch goes to the
Preparation tab where `LaunchReadinessPanel` calls `ia_launch_engagement`, closure goes
to the Closure tab, and so on.

Three structural guarantees now hold:

- **No dead buttons.** A recommendation with no resolvable handler renders as a
  dashed informational row, not as a clickable control.
- **No recommendations on terminal audits.** `Closed`, `Closed – Actions Pending`,
  `Cancelled` and `Archived` short-circuit to an empty list, so a closed audit can no
  longer advertise "Begin Fieldwork".
- **Persona-correct recommendations.** Execution recommendations are gated on
  `execute_audit_activities` and action follow-up on `progress_audit_actions` /
  `manage_audit_followups`, alongside the existing launch/close gates. A Management
  Respondent no longer sees auditor-side prompts.

The panel performs no mutation itself; it only navigates to the surface that owns the
governed command. Server-side authorisation remains the enforcement point.

### IA-POST-UAT-06A — Risk Register reachable

`RiskRegister` was implemented and routed at `/audit/risk-register` but absent from
`auditRouteConfig` and the sidebar, so it was only reachable by typing the URL. It is
now registered under a `FEATURE_AUDIT_RISK_REGISTER` flag and appears in Risk
Management **above** Risk Assessment, matching the business sequence: the Register is
the standing risk universe, the Assessment is the periodic evaluation of it.

## Verification

Typecheck and build clean.

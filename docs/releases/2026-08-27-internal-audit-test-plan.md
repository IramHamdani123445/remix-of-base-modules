# Internal Audit Module — Release Notes & Test Plan
Date: 2026-08-27

## What changed

### Phase 1 — Foundation
- 19 Internal Audit permissions and 5 IA roles registered in the permission catalogue.
- `ia_risk_register` repointed to `department_id` / `function_id` (previously free-text), and the Risk Register screen now reads departments from `ia_departments`.
- Action tracking status changes are persisted (previously inert).

### Phase 2 — Lifecycle & closure
- `ia_evaluate_engagement_closure` / `ia_close_engagement`: server-governed engagement closure. Blocks closure until activities are complete, no draft findings remain, management responses exist, the report is issued, and quality review is signed off.
- `ia_evaluate_plan_closure` / `ia_close_annual_plan`: annual plan closure with per-engagement disposition (Closed / Cancelled / Carried Forward) and a generated closure summary.
- New closure workspaces: `AuditClosureTab` (engagement) and `PlanClosurePanel` (annual plan).

### Phase 3 — Progress, recommendations, documents
- `ia_engagement_progress`: real lifecycle progress derived on the server; replaces the old heuristic progress bar in the Overview tab.
- `ia_create_action_from_recommendation`: one-click, governed conversion of a finding recommendation into a tracked action.
- `ia_link_action_evidence` plus new `recommendation_id` / `evidence_ids` columns on `ia_action_tracking`: audit actions can be linked to evidence documents; the actions table shows a document count.

### Phase 4 — Master data & certification
- Audit universe seeded with one auditable entity per active department (risk category, scores, materiality and audit frequency derived from the department risk rating). Re-runnable without duplicates.

## Manual test plan

| # | Area | Steps | Expected |
|---|------|-------|----------|
| 1 | Audit universe | Open Internal Audit → Audit Universe | One active entity per department, with risk category and frequency |
| 2 | Risk register | Create a risk against a universe entity, pick a department | Saves; department shown from the department list, not free text |
| 3 | Permissions | Sign in as a user without `close_audit_actions` | Verify/Close options rejected with a clear message |
| 4 | Progress | Open an engagement → Overview | Progress panel lists lifecycle stages with server-derived completion |
| 5 | Recommendation → action | Findings tab: add a recommendation, then Actions tab | Recommendation card appears; "Create action" produces a tracked action linked to the recommendation |
| 6 | Evidence linking | Actions tab → update an action → select documents | Document count updates in the actions table after save |
| 7 | Engagement closure | Closure tab on an incomplete engagement | Blockers listed; Close disabled until all are cleared |
| 8 | Engagement closure (happy path) | Complete activities, findings, responses, report, QA sign-off, then close | Engagement closes, final rating recorded, closure event logged |
| 9 | Plan closure | Annual plan with mixed engagement states → Closure panel | Requires a disposition for every engagement; closure summary generated |
| 10 | Audit trail | After closing an engagement and a plan | Closure events visible in the audit timeline |

## Known limitations
- The audit universe seed covers departments only; process- and system-level entities must be added manually.
- Follow-up scheduling remains manual (no automatic re-audit date rollover from `next_audit_due`).

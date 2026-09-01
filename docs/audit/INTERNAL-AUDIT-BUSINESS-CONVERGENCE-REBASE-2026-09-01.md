# Internal Audit — Consolidated Business Convergence Wave

**Baseline date:** 2026-09-01
**Scope:** Annual Plan portfolio, prior audit history, corrective-action continuity, follow-up governance, access management.

---

## Phase 0 — Current truth (established before any change)

### Annual Plan lifecycle

| Concern | Canonical source (server) | Consumed by |
| --- | --- | --- |
| Readiness | `ia_annual_plan_readiness(plan_id)` | Plan register, plan workspace, submission command |
| Submission | `ia_start_plan_approval_workflow(plan_id, submitted_by, is_revision)` | `useSubmitAnnualPlanWorkflow` |
| Alternate submission (legacy) | `ia_submit_annual_plan(plan_id, notes)` | not called from the UI |
| Add / change audits in a plan | `ia_persist_plan_engagements(plan_id, engagements, actor)` | `EngagementBuilder` |
| Remove an audit from a plan | `ia_remove_plan_engagement(plan_id, engagement_id, actor, reason)` | `EngagementBuilder` |
| Decision | `ia_decide_annual_plan` | Plan approval screen |
| Revision | `ia_start_annual_plan_revision_workflow`, `ia_apply_plan_revision` | `PlanRevisionDialog` |
| Closure / reopen | `ia_close_annual_plan`, `ia_reopen_annual_plan`, `ia_evaluate_plan_closure` | `PlanClosurePanel` |

### Divergences found at baseline (all remediated in this wave)

1. **Duplicate readiness logic.** The register and the workspace evaluated readiness in TypeScript
   (`getAnnualPlanReadinessChecks`) while the submit command evaluated it again in SQL. A plan could show
   "ready" and still be refused by the server.
2. **Duplicate submission pipeline.** The client ran its own team-availability check, then called the
   workflow starter, then wrote directly to `ia_audit_engagements` to reset approval stamps — work the
   server should own atomically.
3. **Unauthenticated submission gate.** `ia_start_plan_approval_workflow` had no permission check; only
   the unused `ia_submit_annual_plan` enforced `audit_plans:submit`.
4. **Partial governed persistence.** Adding an audit went through the governed command; editing and
   removing an audit wrote straight to the table, bypassing plan-status gating and the change log.
5. **Lossy governed update.** The governed command only wrote a subset of fields, which is why the UI
   bypassed it for edits (effort, quarter, reviewer, objectives and deliverables were dropped).
6. **Inconsistent active filter.** `is_active = true` (workspace) vs `COALESCE(is_active, true)` (server
   readiness and snapshots): audits with a null flag were invisible in the UI but counted by the server.
7. **Status regression on edit.** Saving the plan header always wrote `status = 'Draft'`, silently moving a
   `Changes Requested` or `Rejected` plan backwards outside the workflow.

### Already converged at baseline (no change required)

- Corrective-action follow-up continuity: `ia_follow_ups` carries `action_id`, `finding_id` and
  `engagement_id`; scheduling and outcomes run only through `ia_followup_schedule` and
  `ia_followup_record_outcome` (`useAuditActionCentre`, `AuditFollowUpsTab`).
- Plan closure readiness, carry-forward acceptance and engagement execution gates are server-owned.

---

## Phase 1 — Changes applied in this wave

### Server

- `ia_persist_plan_engagements` is now the complete governed upsert for plan audits: effort (days,
  hours, budget), quarter/month scheduling, reviewer and team, objectives, methodology, criteria,
  inclusion rationale and reason codes, deliverables, auditee contacts, dependencies and scheduling
  notes. Fields that are not supplied are left untouched; adding and changing remain restricted to
  Draft and Revision plans.
- `ia_remove_plan_engagement` added: deactivates instead of deleting, refuses on non-Draft/Revision
  plans, refuses once the audit has been launched or has moved past preparation, and writes an
  `engagement_removed` entry to `ia_plan_change_log` with actor and reason.
- `ia_start_plan_approval_workflow` is now the single governed submission command. It enforces
  `audit_plans:submit`, runs `ia_annual_plan_readiness` server-side and returns the exact blockers,
  keeps the existing conflict/version/workflow behaviour, locks the plan, clears stale approval
  comments, resets engagement approval stamps, records an `ia_approval_actions` entry and emits a
  `PLAN_SUBMITTED` event.
- Execute privilege on the new command is restricted to `authenticated` and `service_role`.

### Client

- `useAuditAnnualPlanFlow`: readiness is read from the server for both a single plan
  (`useAnnualPlanReadiness`) and the register (`useAuditAnnualPlanReadinessMap`); submission is a single
  RPC call with no parallel validation and no direct table writes; server blockers surface in the toast.
- `AuditPlanDetail`: the submit gate uses server readiness; the checklist still shows granular guidance and
  appends any server blocker not already represented.
- `EngagementBuilder`: edit and remove now call the governed commands; readiness and change-log caches are
  invalidated on every mutation.
- `AnnualPlanForm`: lifecycle status is written only at creation, so editing plan content can no longer
  move a plan backwards.
- `useIAPlanEngagements`: null active flags are treated as active, matching the server.

---

## Verification

- TypeScript project check: clean.
- Build: OK.
- Security linter: no new findings (anon-executable definer functions returned to the baseline count
  after the execute privilege was tightened).

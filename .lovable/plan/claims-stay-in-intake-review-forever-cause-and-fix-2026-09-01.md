# Claims stay in Intake Review forever — cause and fix

## What I confirmed

Claim BN-20260901-19059 (`e32765fe…`) is `status = DECISION`, channel `STAFF_OFFLINE`, and has exactly one queue assignment: **Intake Review**, `assigned_at 2026-09-01 07:52:15`, still `is_active = true`, `completed_at` empty. Its only two events are `CLAIM_SUBMITTED → INTAKE` and `SUBMITTED_FOR_DECISION → DECISION`.

The routing service itself is fine. `routeClaimToWorkbasket` already maps status → workflow step → workbasket, closes the stale assignment and opens the new one, and is idempotent.

**The problem is who calls it.** Only three places do:
1. intake (`claimIntakeService`),
2. `claimWorkbenchService.executeClaimAction`,
3. the manual "Re-route" action on the queue screen.

Every other code path that changes a claim's status writes the status directly and never routes:

- `postApprovalOrchestrator.submitClaimForDecision` — the exact action you used ("Submit for decision" in the workbench Next Step panel). It updates `bn_claim.status` to `DECISION` and inserts the event; no routing call.
- `postApprovalOrchestrator.approveClaim` / `orchestrateApproval` — routes **only** when a `bn_claim_transition_rule` happens to declare `nextWorkbasketId`; otherwise nothing.
- `determinationService` (RECOMMEND / APPROVE_READY / DISALLOW_READY / REQUEST_EVIDENCE)
- `decisionEngine`, `approvalConsoleService`
- `entitlementService` and `CreateEntitlementDialog` (AWARD_SETUP)
- `postIssueService`
- `useWorkflowActions` (central engine end-state write-back)

That is why the second claim's five transitions (DECISION → APPROVED → PAYMENT_QUEUE → IN_PAYMENT → CLOSED) also left it parked in Intake Review, still active even though the claim is closed.

## A second, separate defect this exposes

For this product the resolver would not land the claim in the basket you configured anyway. The template `WF_NCP_Assistance_pension` authors each step as:

```text
step = APPROVAL, step_code = DECISION, assigned_role = BN_MANAGER,
workbasket_id = 6b1bab36…  (Manager Approval)
```

The resolver matches only on `step`, and falls back to a hard-coded role table. So a `DECISION` status resolves via the fallback to `BN_SUPERVISOR`, not to the **Manager Approval** basket you set on the step. The same mismatch affects Verification, Eligibility and Payment Authorization — four of five steps. The step's own `workbasket_id` and `assigned_role` are never read.

## Fix

### 1. Route on every status change (root cause)
Introduce one internal helper that all status-writing services call immediately after a successful status update — non-blocking, so a routing gap can never roll back a legitimate transition. Wire it into: `submitClaimForDecision`, `approveClaim`/`orchestrateApproval`/`denyClaim`, `determinationService`, `decisionEngine`, `approvalConsoleService`, `entitlementService`, `CreateEntitlementDialog`, `postIssueService`, and the `bn_claim` branch of `useWorkflowActions`. Each transition then closes the old assignment and opens the correct one, and terminal statuses (CLOSED / DENIED / WITHDRAWN) close the assignment instead of leaving it active.

### 2. Honour the template as authored (routing precision)
Resolve a step's basket in this priority order:
1. the step's own `workbasket_id`,
2. the step's `assigned_role` matched against `bn_workbasket.assigned_role`,
3. the existing step-role map,
4. the existing step-name fallback.

Also treat `step_code` / `step_name` as aliases of `step` when matching a target step, and read `sla_hours` as well as `sla_days` for `due_at` (this template uses hours only, so assignments currently get no deadline).

### 3. Repair the existing claims
Run the existing re-route sweep over open claims so the current population lands in the right baskets, and close active assignments on claims that are already terminal. This uses the same `Route` action already on the queue screen — no new bulk mechanism.

## Verification

- BN-20260901-19059 moves out of Intake Review into **Manager Approval** with a 120-hour due date.
- The five-transition claim ends with no active assignment (it is CLOSED).
- Drive one claim through all five stages and confirm each stage lands in the basket the template names, with the step's SLA.
- `/bn/queue` shows non-zero counts on Calculation, Eligibility, Manager Approval and Payment Preparation.
- Typecheck clean, existing routing unit tests still pass, plus new tests for step-level basket precedence and `sla_hours`.

## Technical notes

Files: `src/services/bn/postApprovalOrchestrator.ts`, `determinationService.ts`, `decisionEngine.ts`, `approvalConsoleService.ts`, `entitlementService.ts`, `postIssueService.ts`, `src/hooks/useWorkflowActions.ts`, `src/components/bn/entitlement/CreateEntitlementDialog.tsx`, `src/services/bn/intake/claimWorkbasketResolver.ts`, `src/services/bn/workflow/routeClaimToWorkbasket.ts`.

No schema migration. No changes to workflow templates, workbaskets or product configuration — the fix makes the code read the configuration that already exists.

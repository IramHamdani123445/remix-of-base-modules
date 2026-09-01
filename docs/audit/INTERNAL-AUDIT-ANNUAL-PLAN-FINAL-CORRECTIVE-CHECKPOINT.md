# Internal Audit — Annual Plan Convergence Final Corrective Checkpoint

**Baseline HEAD:** 5a9293ca8854924fc262684c39708600ab9b03b2
**Scope:** status contract, server-side authorization, actor identity, edit surface, plan header governance.
**Explicitly out of scope:** Prior Audit History, Access Matrix.

---

## 1. Working-copy status contract (single definition)

`public.ia_plan_working_copy_statuses()` is now the only definition of "editable plan":

```
Draft | Rejected | Changes Requested | Amendment Pending
```

It is used by:

| Command | Previous contract | Now |
| --- | --- | --- |
| `ia_persist_plan_engagements` | `Draft`, `Revision` | working-copy statuses |
| `ia_remove_plan_engagement` | `Draft`, `Revision` | working-copy statuses |
| `ia_update_annual_plan_working_copy` (new) | n/a | working-copy statuses |
| `ia_start_plan_approval_workflow` | already the same four | unchanged |

`Revision` was a stale value: no plan has ever held it and no other Internal Audit
command produces it. It has been dropped rather than propagated.

Approved / Submitted / Closed plans are refused with `IA_PLAN_NOT_EDITABLE` and a
message naming the current status. Amendment of an approved plan continues to run
through the revision workflow, which moves the plan into `Amendment Pending` — and is
therefore editable again by the same single contract.

## 2. Server-side authorization

`public.ia_can_edit_plan_portfolio(_creating boolean)` grants portfolio maintenance to a
caller holding **either** `audit_plans:edit` **or** `audit_engagements:create` / `:edit`
(create vs. edit chosen by the operation). This covers both real personas:

- `IA_HEAD_OF_INTERNAL_AUDIT` — holds `audit_plans:edit`, not the engagement actions.
- `IA_LEAD_AUDITOR` — holds both.
- `IA_TEAM_MEMBER`, `IA_QUALITY_REVIEWER`, `Auditor`, `Audit Manager`, management personas —
  hold `view` only and are refused with `IA_PERMISSION_DENIED`.

`ia_update_annual_plan_working_copy` requires `audit_plans:edit`.
`ia_start_plan_approval_workflow` continues to require `audit_plans:submit`.

Anonymous callers (`auth.uid() IS NULL`) are refused before any work happens, and
`EXECUTE` is revoked from `PUBLIC` and `anon` on all four commands.

## 3. Actor identity

`p_created_by` / `p_actor` are retained for wire compatibility but are **ignored**. Every
command derives the actor from `ia_actor_label()` (which resolves `auth.uid()`), falling
back to the raw `auth.uid()`. Change-log rows, `updated_by` and event payloads can no
longer be attributed to a spoofed identity.

## 4. Ownership and integrity

Updating or removing an audit now resolves the row first and returns:

- `IA_ENGAGEMENT_NOT_FOUND` — no such audit.
- `IA_ENGAGEMENT_PLAN_MISMATCH` — the audit belongs to a different annual plan.
- `IA_ENGAGEMENT_PROTECTED` — the audit has been launched or has moved past preparation.

Previously a mismatched id silently updated nothing.

## 5. Edit surface

The plan workspace (`/audit/audit-plans/:id`) is the single editing surface. The register's
Edit action now navigates to the workspace instead of opening a parallel header modal, and
that duplicate modal has been removed from the register. The remaining header form is
titled "Edit Plan Details" and is reached from the workspace.

## 6. Governed plan header updates

`useIAAnnualPlanMutations().update` no longer writes to `ia_annual_plans` directly. It
calls `ia_update_annual_plan_working_copy`, which:

- accepts only plan **content** fields (title, fiscal year, owner, objective, scope,
  methodology, assumptions, effort/capacity figures, constraints, department/function, …);
- refuses `status`, `submitted_*`, `approved_*`, `rejected_*`, `current_version_number`,
  `workflow_instance_id`, `is_locked`, `closed_*`, `closure_summary`, `revision_count`,
  `approval_comments` with `IA_FIELD_NOT_EDITABLE` and the offending field list;
- stamps `updated_by` / `updated_at`, writes a `plan_details_updated` change-log row and
  emits a `PLAN_DETAILS_UPDATED` event.

A plan header edit can therefore no longer move a plan backwards or forwards in its
lifecycle.

## 7. Legacy command retirement

`ia_submit_annual_plan` is now a thin compatibility wrapper that delegates to
`ia_start_plan_approval_workflow` (attaching the caller's notes to the recorded approval
action) and returns `canonical_command: "ia_start_plan_approval_workflow"`. There is a
single submission implementation.

---

## Verification

- Anonymous REST call to `ia_update_annual_plan_working_copy` with `{"status":"Approved"}`
  → HTTP 401, `42501 permission denied for function` (no execution, no status change).
- `EXECUTE` on all four governed commands is denied to `PUBLIC` / `anon`; granted to
  `authenticated` and `service_role` only.
- TypeScript project check: clean. Build: OK.

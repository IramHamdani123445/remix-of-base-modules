# Internal Audit — Access Management Guide

## Internal Audit has no user-management system of its own

Internal Audit consumes **central identity** end to end:

```text
Authentication User → profiles.id → user_roles → roles
→ role_permissions → app_modules → module_actions
```

Audit-specific business scope is then applied through Internal Audit's own
business data — not through a parallel permission registry:

- `ia_auditors` — auditor registration, auditor role, seniority, employment status
- Department scope — `ia_departments.head_profile_id`
- Engagement assignment — `lead_auditor_id`, `reviewer_id`
- Management / office-holder assignment where applicable

There is deliberately **no `ia_users` table and no second permission registry**.

## Access Matrix

Internal Audit → Configuration → **Access Matrix** (`/audit/access-matrix`)

A read / explain / audit screen — never an editing surface. Columns:

User · Email · Active · IA Role(s) · IA Auditor Record · Auditor Role ·
Department scope · Effective IA capabilities · Active engagement assignments ·
Lead assignments · Reviewer assignments · Management scope · Potential SoD
conflicts.

Selecting a user shows Identity, all effective central role assignments, the IA
capabilities inherited through those roles, audit context (auditor status,
assignments, department management scope) and detected SoD conflicts.

Backed by `ia_access_matrix()`, which requires
`audit_configuration:configure`, `internal_audit_configuration:view`, or the
central Admin role.

## Administration happens centrally

The screen links out to:

- **Open Central User Management** → `/admin/users`
- **Open Roles & Permissions** → `/admin/roles`

No permission-editing controls are duplicated inside Internal Audit. IA continues
to manage legitimate audit business context — auditor registration, employment
status and engagement assignment — through its existing governed screens.

## Segregation of duties

`ia_access_matrix` reports these potential conflicts:

| Code | Meaning |
| --- | --- |
| `PLAN_PREPARER_AND_APPROVER` | Holds plan create/edit/submit **and** plan approval |
| `LEAD_AND_QUALITY_REVIEWER` | Leads live engagements **and** holds quality-review approval |
| `AUDITOR_AND_MANAGEMENT_SAME_SCOPE` | Audits a department they head |
| `ADMIN_AND_BUSINESS_APPROVER` | Configures the module **and** approves plans |
| `ACTION_OWNER_AND_VERIFIER` | Owns and verifies the same corrective action |

These are **informational warnings**. Transaction-level segregation of duties
remains enforced by the governed server commands (`ia_cmd_guard`,
`ia_actor_can`), not by this screen.

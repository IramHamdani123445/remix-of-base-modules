# Internal Audit — Permission Reconciliation

## What is reconciled

`INTERNAL_AUDIT_PERMISSION_MAP` (`src/hooks/useInternalAuditPermissions.ts`) is
the single source of UI capability gates. Every entry is flattened into
`{ capability, module, action }` and reconciled against the registry by
`ia_permission_reconciliation(p_expected jsonb)`:

- `app_modules` — module exists and is enabled
- `module_actions` — action exists and is enabled
- `role_permissions` — which roles actually hold the grant
- route gates — `src/config/auditRouteConfig.ts` + `AuditEntitlementGate`
- UI capability gates — `useInternalAuditPermissions().can()/has()`
- server command gates — `ia_actor_can` / `ia_cmd_guard` inside each command

## Classification

| Status | Meaning |
| --- | --- |
| `PASS` | Registered, enabled and granted to at least one role |
| `MISSING` | Module or action absent from the registry |
| `MISMATCHED` | Registered but module or action disabled |
| `UNUSED` | Registered and enabled but granted to no role |
| `OVER-BROAD` | Registry action reachable by roles beyond the intended persona (reviewed from the `roles_granted` column) |

The Access Matrix screen also lists **registry-only** actions: IA module actions
that exist in the registry but are not consumed by any IA screen.

Live results are read from the **Permission Reconciliation** tab at
`/audit/access-matrix` rather than pinned in this document, so the reconciliation
never goes stale.

## Plan portfolio permissions (intentional design)

Portfolio maintenance is granted through
`ia_can_edit_plan_portfolio(_creating boolean)`, which accepts **either**
`audit_plans:edit` **or** `audit_engagements:create` / `:edit`.

| Persona | Expected effective access |
| --- | --- |
| Head of Internal Audit | Plan editing (holds `audit_plans:edit`) |
| Lead Auditor | Plan and engagement maintenance (holds both) |
| Audit Team Member | No plan portfolio governance unless explicitly granted |
| Quality Reviewer | No plan portfolio edit from the QA role alone |
| Management Respondent | No plan portfolio modification |
| Audit Admin | Configuration only — does **not** imply HIA business authority |

Plan submission requires `audit_plans:submit`; approval and rejection require
`plan_approval:approve` / `:reject`.

### Documented intentional exceptions

1. Central **Admin** passes every IA gate by design (platform break-glass).
2. Lead Auditor may maintain the portfolio without `audit_plans:edit`, via the
   engagement actions — deliberate, so leads can shape their own engagements
   inside a draft plan without gaining plan-lifecycle authority.
3. Audit Admin can read the Access Matrix through
   `audit_configuration:configure`; that grant is read-only and confers no
   business approval authority.

# Rule Version Governance — single approval and publishing authority

Goal: `/bn/config/rules-admin` becomes the only place a benefit product version is approved and published, with the decision enforced in the database by the authenticated user's granted role — not in React.

Work proceeds phase by phase, stopping for your confirmation after each phase.

## Verified before planning

Live data checked now (Test backend):

- `bn_product_version.status` distinct values: `ACTIVE` (26), `DRAFT` (22), `ARCHIVED` (6), `PENDING_APPROVAL` (1). No lowercase or `PENDING_REVIEW`/`PUBLISHED` rows exist yet, so the Phase 1 migration is a constraint-and-code cleanup rather than a data rescue — but the mapping step stays in, because the lowercase writers are still live code.
- `bn_approval_policy.approval_role` values in use: `BN_DIRECTOR` (stage `CONFIG_APPROVE`, 27 rows), `BN_SUPERVISOR` (stage `CONFIG_REVIEW`, 27), `ADMIN` (no stage, 9), and **273 rows with a NULL approval_role** — those levels can never be satisfied by a role check and must be resolved before Phase 4 enforcement.
- `user_roles.role` holds both enum-style names (`Admin`, `Supervisor`, `Clerk`, …) and free-text BN roles (`BN_DIRECTOR`, `BN_SUPERVISOR`, `BN_CONFIG_ADMIN`, `BN_PRODUCT_APPROVER`, `BN_RULE_LEGAL_APPROVER`, …). Note `ADMIN` in the policy table does not match `Admin` in `user_roles` — a case/spelling mismatch that would silently deny.
- Roughly 70 source files reference `bn_product_version`; the write-capable ones are enumerated in Phase 9 before RLS is switched on.

## Phase 1 — One vocabulary

Canonical lifecycle: `DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> ARCHIVED`. Reject returns to `DRAFT`. `APPROVED` is only ever set by the system when the last configured level signs.

- Rewrite `rulesAdminService.ts` to the five states; fix `effective_date`/`expiry_date`/`change_notes` to the real `effective_from`/`effective_to` (and drop the non-existent change-notes write).
- Fix the `RuleVersionStatus` type; align `productApprovalService.ts`.
- Migration: report distinct values first (shown above; re-run at migration time), map any legacy value (`draft`,`pending`,`approved`,`active`,`PENDING_REVIEW`,`PUBLISHED`,`RETIRED`) to canonical, then add the `CHECK` constraint. You see the distinct list before it runs.

## Phase 2 — Fold the Approval Console into Governance

- Move the approval inbox out of `ProductApprovalConsole.tsx` into a "Pending Approval" tab in `RulesAdministration.tsx`: version list, configured chain, approval history, Approve / Reject / Publish.
- Keep the existing diff and simulate panels beside it so the approver can compare against the current ACTIVE version first.
- Redirect `/bn/config/product-approvals` to the new tab; add the tab to the sidebar under BN Config. Gate on `bn.config.rules`, not `bn.claims.workbench`.

## Phase 3 — Close the bypass

`VersionHistoryTab.tsx` may only SUBMIT a draft and show approval status read-only. Its `APPROVE -> ACTIVE` mapping and all direct status writes are removed. Every APPROVE / REJECT / PUBLISH routes through the Phase 4 RPC.

## Phase 4 — One authenticated, role-checked entry point

`bn_record_version_decision(_version_id uuid, _action text, _comment text, _reason_code text)` — SECURITY DEFINER, no user parameter. Resolves the approver from `auth.uid()` and looks up the user code. Before any write it:

1. re-derives the next pending level from chain + history, ignoring anything the caller suggests;
2. confirms the caller holds that level's `approval_role`;
3. refuses self-approval when the author is the approver and `self_approval_allowed` is false;
4. enforces `requires_justification`, `requires_reason_code`, `requires_document`;
5. rejects illegal transitions (SUBMIT only from DRAFT; APPROVE/REJECT only from PENDING_APPROVAL; PUBLISH only from APPROVED);
6. sets `APPROVED` automatically when the last level signs.

Writes the `bn_version_approval` row and the status change in one transaction, and snapshots the approver's full name and role title as they were at that moment.

### Second and third writers to the approval ledger (must be closed in Phase 4)

You are right that "one entry point" is not currently true. A mechanical scan of write calls finds three writers to `bn_version_approval`, not one:

- `productApprovalService` — the known one.
- `governance/approvalRoutingService.ts` (`submitForApproval`) — maps a config entity's governance class to an approval role and **inserts a `SUBMIT` row directly**, with `performed_by` taken from its caller, `from_status: 'DRAFT'`, `to_status: 'IN_REVIEW'` (a sixth status vocabulary), plus a bare-insert fallback "tolerating column drift" that writes an approval row with no version, no action context and no role. It routes generic BN config entities (not only product versions) and sets `product_version_id` when one is supplied.
  **Verdict: it must route through the new RPC** for anything carrying a `product_version_id` — same derived level, same role check, same `auth.uid()` actor, and `IN_REVIEW` folded into `PENDING_APPROVAL`. Its non-version config-entity path can keep a ledger row, but only via the RPC (or an RPC sibling) so `performed_by` is never client-supplied, and the silent bare-insert fallback is deleted — a fallback that drops the role and the target is worse than a failure.
- `configService.createVersionApproval` — a thin generic `insert(approval)` pass-through with no validation at all. It is a bypass by construction and is removed or re-pointed at the RPC in Phase 4.


## Phase 5 — Reconcile the role namespaces

- Produce the full match/mismatch report between `user_roles.role` and `bn_approval_policy.approval_role` (already partly visible: `ADMIN` vs `Admin`, plus 273 NULL roles).
- Add a text-based `has_bn_role(_user_id uuid, _role text)` alongside the enum `has_role`, so both namespaces are checkable.
- Add an FK or validating trigger so `approval_role` must be a real role; make the Approval Policies editor a dropdown.
- Delete the hardcoded `['BN_DIRECTOR','BN_CONFIG_ADMIN','admin']` publish check — publish rights come from a `CONFIG_PUBLISH` policy row like every other level.

## Phase 6 — Publishing

- Publish calls `assertSafeToPublish` (`publishGateService.ts`) and refuses on errors.
- Same transaction archives the product's current ACTIVE version and sets its `effective_to`.
- Reject overlapping `effective_from`/`effective_to` ranges per product.
- Fix `awardCreationService` to select the ACTIVE version whose effective range contains the claim date, not the highest version number.

## Phase 7 — Chain must exist before submit

On version creation, copy the previous version's `CONFIG_PUBLISH` rows so a new version is never chainless. SUBMIT is blocked with a clear message when no chain exists.

## Phase 8 — Per-stage scoping

Use the existing `stage_code` (`ELIGIBILITY`, `CALCULATION`, `TIMELINE`, `DOCUMENTS`) to scope each level. Each approver sees only their stage's diff against the current ACTIVE version, and that scoped diff is stored in `bn_version_approval.rule_diff_snapshot`. A level with no `stage_code` keeps whole-version behaviour. No status columns are added to rule tables.

## Phase 9 — Enforce in the database (last, with prior notice)

The earlier writer list was name-matched and wrong. Regenerated mechanically (scan for `.from('<table>') … .update/.insert/.upsert/.delete`):

| Table | Actual writers |
| --- | --- |
| `bn_product_version` | `productApprovalService`, `rulesAdminService`, `productService`, `canvasSyncService`, `components/bn/config/CalculationBuilder.tsx`, `components/bn/config-builder/useBuilderCanvas.ts` |
| `bn_version_approval` | `productApprovalService`, `configService`, `governance/approvalRoutingService` |

`CalculationBuilder` (writes calculation config onto the version) and `useBuilderCanvas` (writes `builder_canvas`) are legitimate non-status writers and must keep working. `postApprovalOrchestrator`, `productAcceptanceService`, `approvalConsoleService`, `countryPackageService` and `migrateLegacyPolicies` only read these tables — dropped from the list.

Enforcement mechanism, corrected: **RLS filters rows, not columns**, so an RLS policy cannot deny an UPDATE of `status` alone. This matters because `useUpdateBnProductVersion` (`n()` in `useBnProduct.ts`) is shared by `VersionHistoryTab` (writes status — must be blocked), `ScreenTemplateTab` and `WorkflowTab` (write config fields — must keep working). A blanket UPDATE deny breaks the latter two.

So enforcement uses, in order:

1. `REVOKE UPDATE (status) ON bn_product_version FROM authenticated, anon;` — column-level, surgical, leaves other columns writable.
2. A `BEFORE UPDATE` trigger comparing `OLD.status` to `NEW.status` and raising unless the Phase 4 RPC set a transaction-local marker — belt-and-braces, and it also catches writes arriving through any SECURITY DEFINER path that bypasses the grant.
3. `bn_version_approval`: `REVOKE INSERT/UPDATE/DELETE` from app roles once all three writers route through the RPC; reads stay open.

RLS itself is enabled on both tables only for read scoping, not as the status guard. This project's standing rule is RLS-off (`docs/ARCHITECTURE-NO-RLS-RULE.md`) — the grant/trigger route above stays within that rule, so RLS enablement is optional and I will confirm with you before turning it on rather than assuming the exception.


## Constraints honoured

No new tables. No UI redesign beyond moving the approval panel into Governance. Stop for confirmation after each phase.

## Verification per phase

RBAC tests, persona tests, navigation and route tests, permission and scope tests, breadcrumb coverage, typecheck, production build. Server-side enforcement is proven with direct RPC tests (wrong role, self-approval, illegal transition, missing justification) — not only menu visibility.

## Closing deliverable

A table of every call site changed, with its old and new status values.

# Product Version Governance — shareable flow doc + explicit approve permission

Two pieces of work, both scoped to Benefits configuration governance.

## 1. Shareable governance document

New file `docs/benefits/product-version-governance-flow.md` containing:

- The lifecycle diagram (DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE, plus reject / return-to-draft / archive paths) as a Mermaid flowchart.
- Where each action happens: Product Catalog / Product Editor for authoring, Rule Version Governance (`/bn/config/rules-admin`) for approve, reject, return-to-draft and publish.
- The readiness gate: which checks block submit, approve and publish (eligibility rules, screen template, workflow template, active formula binding, cross-tab conflict errors).
- Maker-checker rule: the approver must not be the person who created the version.
- Role table: who can view, author, submit, approve, publish.
- What publishing does: closes the previous active version at D-1, activates the new one, promotes the product to ACTIVE so Claim Registration can use it.
- Audit trail entries written at each transition.

Documentation only — no behaviour change.

## 2. Explicit `approve` permission for benefits configuration

Today approval rights are implicit: anyone with edit on `bn_configuration` who is not the version's author can approve and publish. This makes an approver a role-granted right instead.

- Add an `approve` action to the `bn_configuration` module and grant it to the roles that should hold it (Admin, BN_CONFIG_ADMIN). Authoring-only roles keep edit without approve; BN_AUDITOR stays view-only.
- Rule Version Governance gates the Approve, Reject and Publish controls on that permission; users without it see the version read-only with an explanatory note rather than disabled-looking buttons.
- The service layer refuses approve / reject / publish when the caller lacks the permission, so the rule holds even if the UI is bypassed.
- Maker-checker stays exactly as it is — the new permission is an additional requirement, not a replacement.
- Submit for approval and return-to-draft remain on the existing edit permission.

## Technical notes

- Migration: insert the `approve` action row for the `bn_configuration` module and the matching `role_permissions` grants; idempotent so re-running is safe.
- `src/pages/bn/config/RulesAdministration.tsx` — wrap the approve/reject/publish actions in the permission check; keep the readiness cell and return-to-draft as they are.
- `src/services/bn/rulesAdminService.ts` — `approveVersion`, `rejectVersion` and `publishVersion` verify the permission before acting and return a clear error otherwise; existing audit entries unchanged.
- No changes to the readiness gate, publish routine or product promotion logic.

## Verification

- A user with edit but not approve: can author and submit, sees no Approve/Reject/Publish, and a direct service call is refused.
- A user with approve who authored the version: still blocked by maker-checker.
- A second user with approve: approves, then publishes; previous version archived at D-1, product becomes ACTIVE, benefit selectable in Claim Registration.
- The document renders with a working diagram and matches the observed behaviour.

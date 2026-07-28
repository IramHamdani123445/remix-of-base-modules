# Accelerated Build 1 — Shared Communication Assets & Layouts

## Scope
Implements the smallest safe delivery of Organisation-owned shared
communication assets, immutable published versions, immutable published
layout versions, an organisation/department assignment table, and additive
template-version layout selection. Adds no provider, worker, queue,
webhook or send implementation.

## Four new shared ERP tables
- `public.core_comm_asset` — organisation-owned asset master (draft/active/retired).
- `public.core_comm_asset_version` — immutable published versions of an asset.
- `public.core_template_layout_version` — immutable published versions of an email layout, with validated slot schema.
- `public.core_comm_assignment` — organisation defaults and department overrides for layout and asset slots.

## Additive columns on `omni_comms_template_version`
- `layout_selection_mode` (`resolved_default` | `pinned`)
- `layout_id` (FK `core_template_layout`)
- `pinned_layout_version_id` (FK `core_template_layout_version`)

Trigger enforces: editable only while draft, required before approval/publication,
pinned requires an exact layout + version pair.

## Neutral helper
- `public.core_priv_verify_department_ownership(uuid,uuid)` — canonical shared helper.
- `public.omni_comms_priv_verify_department_ownership(uuid,uuid)` — original signature preserved; body now delegates to the neutral helper.

## RPC surface (exactly 12)
1. `core_comm_asset_list_active(organization_id, asset_type)` — omni_comms.view
2. `core_comm_asset_get(id)` — omni_comms.view
3. `core_template_layout_list_active(layout_kind)` — omni_comms.view
4. `core_template_layout_version_get(id)` — omni_comms.view
5. `core_comm_assignment_list(organization_id, department_id, output_channel)` — omni_comms.view
6. `core_comm_assignment_upsert_org_default(...)` — omni_comms.configure
7. `core_comm_assignment_upsert_dept_override(...)` — omni_comms.configure
8. `core_comm_assignment_reset_dept_override(...)` — omni_comms.configure
9. `omni_comms_template_version_set_layout_selection(...)` — omni_comms.author_templates
10. `omni_comms_resolve_render_manifest(template_version_id, organization_id, department_id)` — omni_comms.view
11. `core_comm_pilot_migration_dry_run(...)` — omni_comms.configure
12. `core_comm_pilot_migration_apply(...)` — omni_comms.configure

All RPCs are `SECURITY DEFINER`, `SET search_path = pg_catalog, public`,
owned by `postgres`, revoke `PUBLIC/anon` and grant `authenticated` only.

## Private helpers
- `core_priv_asset_lifecycle_guard()`
- `core_priv_asset_version_guard()`
- `core_priv_layout_version_guard()`
- `core_priv_assignment_guard()`
- `omni_comms_priv_template_version_layout_guard()`
- `core_priv_verify_department_ownership()` (neutral)

## RLS / grants
- The four new tables all have `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- All privileges revoked from `PUBLIC`, `anon`, `authenticated`.
- Only `service_role` receives direct grants; browser access flows exclusively through the 12 RPCs.

## Compatibility debt (documented)
- `public.core_template_layout` retains its **current** RLS state during Build 1 because existing Legacy/shared readers depend on direct access. Omni-Comms code does not read this table directly; it reads only through `core_template_layout_list_active` and `core_comm_assignment_list`. Debt: move `core_template_layout` fully behind the shared service boundary in a later build.

## Storage-bucket allow-list
Deployed approved buckets inspected: `app-assets`, `audit-assets`, `audit-attachments`, `audit-signatures`, `bn-evidence`, `bn-external-tasks`, `comm-assets`, `core-documents`, `employer-documents`, `er-dms`, `ia-artifacts`, `ia-evidence`, `ip-dms`, `ip-documents`, `legal-contract-docs`, `legal-documents`, `legal-referrals`. Build 1 pilot assets are HTML-only and introduce no new storage-bucket dependency; the asset-version trigger rejects any `storage_bucket` value not present in `storage.buckets`.

## Pilot migration
`core_comm_pilot_migration_dry_run` and `core_comm_pilot_migration_apply`
are parameterised and idempotent. Callers must supply organisation and
department IDs together with explicit source rows (letterhead, org
signature, footer, department signature, email layout). Dry-run returns
source metadata, destination codes and an ambiguity verdict. Apply is
one transaction and safe to re-run — asset masters and versions use
`ON CONFLICT DO UPDATE / DO NOTHING` and assignments use the upsert
RPCs.

## Verifier
`scripts/omni-comms/verify-build1-shared-assets.sql` runs inside a
`BEGIN … ROLLBACK`, checks the four tables (existence, `FORCE RLS`, absence
of `anon/authenticated` grants), the three additive template-version
columns, the neutral helper, and the 12 SECURITY DEFINER RPCs. Emits
`BUILD 1 SHARED ASSETS AND LAYOUTS VERIFY OK` on success.

## Rollback
`scripts/omni-comms/rollback/build1-shared-assets-rollback.sql` documents
a dependency-safe reversal that drops the 12 RPCs, the four new tables,
the additive columns, and the private helpers, restores the original
Omni-Comms department-ownership helper body, and finally drops the
neutral helper. It does not touch Legacy tables, Epic 1–3 artefacts,
`public.core_audit_log`, navigation, or Admin permissions.

## Registry
- Omni-Comms 19-object ceiling is unchanged. The four new tables are
  shared ERP objects under `public.core_*` and intentionally are not
  registered in `objectRegistry.ts`.
- Channels admin route remains `Placeholder`.
- No provider, worker, queue, webhook or send implementation was introduced.

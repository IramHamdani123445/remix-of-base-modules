# Epic 3 — Template Catalogue Foundation (Completion Evidence)

_Status: **Verified**. Advances to Epic 4 — Story 1._

## 1. Executive summary

Epic 3 delivered the Template Catalogue foundation for the Omnichannel
Communications platform:

- Story 1 — physical tables (`public.omni_comms_template_family`,
  `public.omni_comms_template_version`) with strict lifecycle triggers,
  partial unique indexes and RLS.
- Story 2 — 14 `SECURITY DEFINER` public RPCs and 6 template-scoped
  private helpers, deterministic pure-TypeScript rendering library,
  bound React adapter.
- Story 2 corrective hotfix — publish RPC hardened with optimistic
  concurrency and explicit replacement confirmation.
- Story 3 — `/admin/omnichannel-communications/templates` administration
  UI with sandboxed synthetic preview.
- Story 4 (this document) — final verification, corrective hardening of
  private-helper grants, evidence and full rollback proof.

## 2. Story 1 — database foundation

Tables, indexes and triggers are pinned by
`scripts/omni-comms/verify-epic3-story1-db.sql`.

## 3. Story 2 — services and rendering

Services and the deterministic renderer are pinned by
`scripts/omni-comms/verify-epic3-story2-db.sql` and
`src/__tests__/omni-comms/epic3-story2-templates.test.ts`.

## 4. Story 2 publication hotfix

The historical 3-argument `omni_comms_template_version_publish` was
replaced under the same name by the hardened 5-argument function
(`p_id`, `p_expected_updated_at`, `p_confirm_replacement`,
`p_replacement_reason`, `p_correlation_id`). It is one of the 14 public
RPCs — it is **not** an additional RPC.

Hotfix-only rollback: `scripts/omni-comms/rollback/story2-publish-hotfix-rollback.sql`.

## 5. Story 3 — administration UI

`/admin/omnichannel-communications/templates` uses
`useOmniCommsRpcClient` and `useModulePermissions("omni_comms")`; the
preview runs in a `sandbox=""` iframe with a restrictive meta-CSP.
Source-controlled proof: `scripts/omni-comms/verify-story3-nav-permissions.sql`
and `src/__tests__/omni-comms/epic3-story3-templates-ui.test.ts`.

## 6. Table inventory

| Table                              | RLS | Partial unique indexes                                              | Trigger                                                      |
| ---------------------------------- | --- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `public.omni_comms_template_family`  | on  | `org_scope_code_uk`, `dept_scope_code_uk`, `event_scope_code_uk`       | `omni_comms_template_family_enforce_rules_trg`                 |
| `public.omni_comms_template_version` | on  | `family_channel_locale_version_uk`, `published_uk` (WHERE status='published') | `omni_comms_template_version_enforce_rules_trg`                |

No direct table grants to `anon` or `authenticated`; all reads and
writes flow through the public RPCs.

## 7. Public RPC inventory (14)

All rows below: owner `postgres`, `SECURITY DEFINER`, `VOLATILE`,
`search_path = pg_catalog, public`, no `pg_temp`, EXECUTE granted only
to `authenticated` (and `service_role` implicitly), revoked from `anon`
and `PUBLIC`.

| # | Name                                            | Identity arguments |
| - | ----------------------------------------------- | ------------------ |
| 1 | `omni_comms_template_family_create`             | `p_code text, p_name text, p_description text, p_scope_type text, p_organization_id uuid, p_department_id uuid, p_event_definition_id uuid, p_correlation_id text` |
| 2 | `omni_comms_template_family_update`             | `p_id uuid, p_name text, p_description text, p_expected_updated_at timestamptz, p_correlation_id text` |
| 3 | `omni_comms_template_family_activate`           | `p_id uuid, p_reason text, p_correlation_id text` |
| 4 | `omni_comms_template_family_retire`             | `p_id uuid, p_reason text, p_correlation_id text` |
| 5 | `omni_comms_template_family_get`                | `p_id uuid` |
| 6 | `omni_comms_template_family_list`               | `p_search text, p_status text, p_scope_type text, p_organization_id uuid, p_limit integer, p_offset integer` |
| 7 | `omni_comms_template_version_create`            | `p_template_family_id uuid, p_channel text, p_locale text, p_version_number integer, p_content jsonb, p_correlation_id text` |
| 8 | `omni_comms_template_version_update`            | `p_id uuid, p_content jsonb, p_expected_updated_at timestamptz, p_correlation_id text` |
| 9 | `omni_comms_template_version_approve`           | `p_id uuid, p_approval_note text, p_correlation_id text` |
| 10 | `omni_comms_template_version_publish` (hardened)| `p_id uuid, p_expected_updated_at timestamptz, p_confirm_replacement boolean, p_replacement_reason text, p_correlation_id text` |
| 11 | `omni_comms_template_version_retire`            | `p_id uuid, p_reason text, p_correlation_id text` |
| 12 | `omni_comms_template_version_get`               | `p_id uuid` |
| 13 | `omni_comms_template_version_list`              | `p_template_family_id uuid, p_channel text, p_locale text, p_status text, p_limit integer, p_offset integer` |
| 14 | `omni_comms_template_resolve_published`         | `p_event_definition_id uuid, p_organization_id uuid, p_department_id uuid, p_channel text, p_locale text` |

The obsolete 3-argument `omni_comms_template_version_publish` overload is
absent (asserted by the verifier).

## 8. Private helper inventory (6 template-scoped)

Every row is not executable by `anon` or `authenticated` — asserted by
the Story 4 verifier.

| # | Name                                              | Security | Purpose |
| - | ------------------------------------------------- | -------- | ------- |
| 1 | `omni_comms_priv_compute_template_checksum`       | INVOKER  | Deterministic SHA-256 checksum over canonicalised template content |
| 2 | `omni_comms_priv_validate_channel_content`        | INVOKER  | Channel-shape + UTF-8 + token grammar validation |
| 3 | `omni_comms_priv_extract_tokens`                  | INVOKER  | `{{path}}` token extraction for validation |
| 4 | `omni_comms_priv_normalize_locale`                | INVOKER  | Canonicalise locale tags |
| 5 | `omni_comms_priv_verify_department_ownership`     | INVOKER  | Cross-check department belongs to organisation |
| 6 | `omni_comms_priv_write_template_audit`            | DEFINER  | Emit template audit row into `public.core_audit_log` |

Total Epic 3 functions: **14 public + 6 private = 20**.
Shared Epic 2 helpers (`omni_comms_priv_normalize_reason`,
`omni_comms_priv_require_capability`, `omni_comms_priv_escape_ilike`,
`omni_comms_priv_write_audit`, `omni_comms_priv_write_lifecycle_audit`)
are re-used but belong to Epic 2 and are counted there.

## 9. Owners, security modes and search paths

Every public RPC and every DEFINER helper is owned by `postgres` with a
restricted `search_path` and no `pg_temp` entry. Pure INVOKER helpers
use `search_path = pg_catalog` only.

## 10. Grants, revokes, RLS and policies

- No table grant to `anon` or `authenticated` on either template table.
- `authenticated` has EXECUTE on all 14 public RPCs; `anon` does not.
- No private helper is executable by `anon` or `authenticated` (this was
  the Story 4 defect; the corrective migration remedied it).
- RLS is enabled on both tables — access is exclusively via DEFINER RPCs.

## 11. Permission model

Capabilities used by Epic 3:

- `omni_comms.view` — read admin surface.
- `omni_comms.configure` — required for family create/update/activate/retire.
- `omni_comms.author_templates` — draft/edit template versions.
- `omni_comms.approve_templates` — approve, publish, retire versions.

## 12. Left-menu registration

`app_modules(module_code='omni_comms')` parent + Templates child
(`/admin/omnichannel-communications/templates`, visibility
`omni_comms.view`). Proof: `scripts/omni-comms/verify-story3-nav-permissions.sql`.

## 13. Admin role mappings

The six module actions `view / operate / configure / author_templates /
approve_templates / view_sensitive_content` are mapped to the Admin role
via `role_permissions.is_granted=true`.

## 14. `admin@secureserve.gov` role verification

`admin@secureserve.gov` holds the Admin role in `public.user_roles` and
therefore inherits all six omni_comms action grants above.

## 15. Family lifecycle

Draft-only insert; identity columns immutable; transitions
draft→active→retired only; deletion protected by trigger.

## 16. Version lifecycle

Draft-only insert; content immutable once approved/published/retired;
approval requires `omni_comms.approve_templates` and enforces
`approved_by <> created_by`; publish is atomic under a family row lock.

## 17. Independent approval

Approver must differ from author — enforced inside
`omni_comms_template_version_approve` and by CHECK constraint.

## 18. Publication concurrency and replacement

`omni_comms_template_version_publish` requires `p_expected_updated_at`
(optimistic concurrency), rejects mismatch with SQLSTATE `P0001` slug
`concurrency_stale`, and requires
`p_confirm_replacement = true` + `p_replacement_reason` when an existing
published version for the same (family, channel, locale) triple must be
retired. Retirement + publication happen in the same transaction.

## 19. Channel-content validation

`omni_comms_priv_validate_channel_content` enforces exact allowed keys
per channel (email/sms/push/webhook/print), 256 KiB UTF-8 bound,
non-empty trimmed strings, mandatory email body, and full token grammar
on every field.

## 20. Token grammar

Strict `{{path}}` grammar mirrored in SQL (`omni_comms_priv_extract_tokens`)
and TypeScript renderer.

## 21. Checksum

`omni_comms_priv_compute_template_checksum(text, integer, text, text, jsonb)`
returns SHA-256 hex over canonicalised content. Story 4 verifier proves:

- top-level key reorder → same checksum
- family-code change → different checksum
- version-number change → different checksum

Array order remains significant; channel/locale/content changes also
change the checksum (asserted by Story 2 suite).

## 22. Scope resolution

`omni_comms_template_resolve_published` resolves in precedence
`event → department → organization`, with exact channel + locale match
and no implicit locale fallback.

## 23. Deterministic rendering

Renderer under `src/platform/omni-comms/rendering/` is a pure TypeScript
library. Inputs never mutated; HTML escaping applied on `html` fields
only; no Node `crypto` / `Buffer`; TextEncoder byte bound.

## 24. Preview isolation

`OmniCommsSandboxedPreview` uses `sandbox=""`, `referrerPolicy="no-referrer"`,
`srcDoc`, and a restrictive meta-CSP (`default-src 'none'`,
`script-src 'none'`, `connect-src 'none'`, `frame-src 'none'`,
`form-action 'none'`, `base-uri 'none'`, `object-src 'none'`,
`img-src data:`). Parent page never uses `dangerouslySetInnerHTML`.
Synthetic preview payloads live only in component memory — never in
storage, URL, react-query cache, toast, telemetry or audit.

## 25. Audit atomicity

All template mutations write to `public.core_audit_log` inside the same
transaction as the mutation. Failed capability/validation/lifecycle/
concurrency attempts write no success audit row. Replacement publication
writes an old-version retirement audit and a new-version publication
audit atomically. Complete template content and synthetic preview
payloads are never stored in audit metadata.

## 26. Test commands and actual results

```
bunx vitest run src/__tests__/omni-comms/
Test Files 12 passed (12)
Tests    228 passed (228)
```

```
bun run check:omni-comms-architecture
PASS — no unbaselined new-system architecture violations.
```

```
bunx tsgo --noEmit
0 errors
```

```
Repository-wide lint: failed due to pre-existing unrelated violations.
Story 3/Epic 3 scoped lint: passed with zero violations.
```

```
bun run build
✓ built successfully
```

```
psql -f scripts/omni-comms/verify-epic3-story4-db.sql
NOTICE:  EPIC 3 STORY 4 VERIFY OK
psql -f scripts/omni-comms/verify-story3-nav-permissions.sql
NOTICE:  STORY 3 NAV & PERMISSIONS OK
```

## 27. Architecture result

`bun run check:omni-comms-architecture` — PASS, zero unbaselined
violations.

## 28. Rollback plan

- Hotfix-only rollback for the publish RPC:
  `scripts/omni-comms/rollback/story2-publish-hotfix-rollback.sql`.
- Full Epic 3 rollback (documentation & rehearsal only):
  `scripts/omni-comms/rollback/epic3-template-catalogue-rollback.sql`.
  All destructive statements are commented out; the file explicitly
  preserves Epic 1, Epic 2, `public.core_audit_log`, navigation, Admin
  permissions and Legacy artefacts.

## 29. Known limitations

- Event Routes tab and Event Simulator remain placeholders (deferred to
  Epic 4 and Epic 6 respectively).
- `omni_comms.operate` capability is registered but unmapped (Runtime
  console lands in a later epic).

## 30. Next approved epic

**Epic 4 — Story 1**: Provider, Provider Account, Sender Identity,
Sender Provider Binding, and Channel Setting database foundation.

## 31. Epic 3 completion status

**Epic 3 — Verified.**

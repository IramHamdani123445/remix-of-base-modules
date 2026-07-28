# Epic 2 — Event Catalogue Foundation

**Epic**: Epic 2 — Event Definition and Contract Foundation
**Completed Stories**: Story 1 (physical schema), Story 2 (application services), Story 3 (admin UI + hardening), Story 4 (verification, hardening, evidence)
**Overall platform status**: In progress
**Next approved step**: Epic 3 — Story 1 — Template Family and Template Version Database Foundation
**Approval status**: Story 4 approved for build; verification recorded below.

This document uses exact deployed names introspected from `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_proc`, `pg_class.relacl`, `pg_policies`, `pg_extension`, and `pg_roles`. See `scripts/omni-comms/verify-story4-db.sql` for the reproducible read-only script.

---

## Database Objects

Two physical tables, both under `public`, both owned by `postgres`, both with RLS enabled and zero policies (all access is via `SECURITY DEFINER` RPCs).

### `public.omni_comms_event_definition` (13 columns)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| code | text | NO | — |
| module_code | text | NO | — |
| entity_type | text | NO | — |
| name | text | NO | — |
| description | text | YES | — |
| communication_class | text | NO | — |
| default_priority | text | NO | `'normal'` |
| status | text | NO | `'draft'` |
| created_at | timestamptz | NO | `now()` |
| created_by | uuid | YES | — |
| updated_at | timestamptz | NO | `now()` |
| updated_by | uuid | YES | — |

Note: the deployed identifier column is `code` (not `event_code`).

Constraints:
- `omni_comms_event_definition_pkey` — PRIMARY KEY (id)
- `omni_comms_event_definition_code_key` — UNIQUE (code)
- `omni_comms_event_definition_code_format_chk` — `code ~ '^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$'`
- `omni_comms_event_definition_code_segments_chk` — `split_part(code,'.',1)=module_code AND split_part(code,'.',2)=upper(entity_type)`
- `omni_comms_event_definition_module_code_chk`, `entity_type_chk`, `name_chk` — trim/non-empty/upper-case guards
- `omni_comms_event_definition_class_chk` — allowed `communication_class ∈ {transactional, service, security, legal_mandatory, operational, marketing}`
- `omni_comms_event_definition_priority_chk` — allowed `{low, normal, high, urgent}`
- `omni_comms_event_definition_status_chk` — allowed `{draft, active, suspended, retired}`

Indexes:
- `omni_comms_event_definition_pkey` (btree on id, unique)
- `omni_comms_event_definition_code_key` (btree on code, unique)
- `omni_comms_event_definition_module_status_idx` (btree on module_code, status)

Trigger:
- `omni_comms_event_definition_enforce_rules_trg` — BEFORE INSERT OR UPDATE, executes `public.omni_comms_enforce_event_definition_rules()` (invoker security, `search_path=public, pg_temp`).

### `public.omni_comms_event_contract` (15 columns)

Columns: `id uuid PK`, `event_definition_id uuid NOT NULL`, `version_number integer NOT NULL`, `json_schema jsonb NOT NULL`, `sample_payload jsonb NOT NULL`, `status text NOT NULL`, `checksum text NULL`, `published_at timestamptz NULL`, `published_by uuid NULL`, `retired_at timestamptz NULL`, `retired_by uuid NULL`, plus standard timestamps and actor columns.

Constraints:
- `omni_comms_event_contract_pkey` — PRIMARY KEY (id)
- `omni_comms_event_contract_event_definition_id_fkey` — FK → `omni_comms_event_definition(id)` **ON DELETE RESTRICT**
- `omni_comms_event_contract_event_version_key` — UNIQUE (event_definition_id, version_number)
- `omni_comms_event_contract_version_positive_chk` — `version_number > 0`
- `omni_comms_event_contract_json_schema_object_chk` — `jsonb_typeof(json_schema) = 'object'`
- `omni_comms_event_contract_sample_payload_object_chk` — `jsonb_typeof(sample_payload) = 'object'`
- `omni_comms_event_contract_status_chk` — allowed `{draft, published, retired}`
- `omni_comms_event_contract_checksum_format_chk` — `checksum IS NULL OR ~ '^[0-9a-f]{64}$'`
- `omni_comms_event_contract_lifecycle_fields_chk` — enforces published/retired metadata presence and draft cleanness

Indexes:
- `omni_comms_event_contract_pkey`
- `omni_comms_event_contract_event_version_key` (unique)
- `omni_comms_event_contract_published_idx` (partial btree on (event_definition_id, version_number) WHERE `status='published'`)

Trigger:
- `omni_comms_event_contract_enforce_rules_trg` — BEFORE INSERT OR UPDATE OR DELETE, executes `public.omni_comms_enforce_event_contract_rules()`.

No additional Epic 2 business tables exist under the `omni_comms_` prefix.

---

## Extension Inventory

| Extension | Version | Schema |
|---|---|---|
| pg_jsonschema | 0.3.3 | extensions |
| pgcrypto | 1.3 | extensions |

Schema validation uses `extensions.jsonschema_is_valid` and `extensions.jsonb_matches_schema`. Checksum uses `extensions.digest(..., 'sha256')`. No network fetch occurs; no AJV dependency.

---

## RPC Inventory

Thirteen public RPCs (each `SECURITY DEFINER`, owner `postgres`, `search_path=pg_catalog, extensions`, `EXECUTE` granted only to `authenticated`; PUBLIC and anon have no grant).

### Event Definitions (7)
| Function | Identity arguments | Returns | Permission |
|---|---|---|---|
| `omni_comms_event_definition_create` | `p_code text, p_module_code text, p_entity_type text, p_name text, p_description text, p_communication_class text, p_default_priority text, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_definition_update_draft` | `p_id uuid, p_expected_updated_at timestamptz, p_code text, p_module_code text, p_entity_type text, p_name text, p_description text, p_communication_class text, p_default_priority text, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_definition_activate` | `p_id uuid, p_expected_updated_at timestamptz, p_reason text, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_definition_suspend` | `p_id uuid, p_expected_updated_at timestamptz, p_reason text, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_definition_retire` | `p_id uuid, p_expected_updated_at timestamptz, p_reason text, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_definition_list` | `p_limit integer, p_offset integer, p_status text, p_module_code text, p_search text` | TABLE(id, code, module_code, entity_type, name, communication_class, default_priority, status, updated_at) | `omni_comms.view` |
| `omni_comms_event_definition_get` | `p_id uuid` | TABLE(id, code, module_code, entity_type, name, description, communication_class, default_priority, status, created_at, created_by, updated_at, updated_by) | `omni_comms.view` |

### Event Contracts (6)
| Function | Identity arguments | Returns | Permission |
|---|---|---|---|
| `omni_comms_event_contract_create` | `p_event_definition_id uuid, p_version_number integer, p_json_schema jsonb, p_sample_payload jsonb, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_contract_update_draft` | `p_id uuid, p_expected_updated_at timestamptz, p_json_schema jsonb, p_sample_payload jsonb, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_contract_publish` | `p_id uuid, p_expected_updated_at timestamptz, p_reason text, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_contract_retire` | `p_id uuid, p_expected_updated_at timestamptz, p_reason text, p_correlation_id text` | uuid | `omni_comms.configure` |
| `omni_comms_event_contract_list` | `p_event_definition_id uuid, p_limit integer, p_offset integer, p_status text` | TABLE(id, event_definition_id, version_number, status, checksum, published_at, retired_at, updated_at) | `omni_comms.view` |
| `omni_comms_event_contract_get` | `p_id uuid` | TABLE(id, event_definition_id, version_number, json_schema, sample_payload, sample_payload_redacted, status, checksum, published_at, published_by, retired_at, retired_by, created_at, created_by, updated_at, updated_by) | `omni_comms.view` (payload requires `omni_comms.view_sensitive_content`) |

No obsolete/insecure overload remains — verified by `pg_proc` enumeration. Specifically absent: suspend/retire without `p_reason`, publish without synthetic confirmation, unredacted `contract_get`, `event_definition_list` without `p_search`, and any function suffixed `_v2`.

---

## Private Helper Inventory

Eight helpers under `public` (two trigger functions + six `omni_comms_priv_*`). None grant EXECUTE to `anon` or `authenticated` after the Story 4 hardening migration.

| Function | Identity arguments | Returns | Owner | Security | search_path | Story introduced | Still used |
|---|---|---|---|---|---|---|---|
| `omni_comms_enforce_event_definition_rules` | () | trigger | postgres | INVOKER | `public, pg_temp` | Story 1 | yes (BEFORE INS/UPD trigger) |
| `omni_comms_enforce_event_contract_rules` | () | trigger | postgres | INVOKER | `public, pg_temp` | Story 1 | yes (BEFORE INS/UPD/DEL trigger) |
| `omni_comms_priv_compute_checksum` | `p_event_code text, p_version_number integer, p_json_schema jsonb` | text | postgres | DEFINER | `pg_catalog, extensions` | Story 2 | yes |
| `omni_comms_priv_escape_ilike` | `p_input text` | text | postgres | DEFINER | `pg_catalog, extensions` | Story 3 | yes |
| `omni_comms_priv_normalize_reason` | `p_reason text, p_required boolean` | text | postgres | DEFINER | `pg_catalog, extensions` | Story 3 | yes |
| `omni_comms_priv_reject_nonlocal_refs` | `p_schema jsonb` | void | postgres | DEFINER | `pg_catalog, extensions` | Story 2 | yes |
| `omni_comms_priv_require_capability` | `p_action text` | void | postgres | DEFINER | `pg_catalog, extensions` | Story 2 | yes |
| `omni_comms_priv_validate_schema` | `p_json_schema jsonb, p_sample_payload jsonb` | void | postgres | DEFINER | `pg_catalog, extensions` | Story 2 | yes |
| `omni_comms_priv_write_audit` | `p_actor_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_entity_display text, p_before jsonb, p_after jsonb, p_correlation_id text` | void | postgres | DEFINER | `pg_catalog, extensions` | Story 2 | yes (create/update-draft paths without reason) |
| `omni_comms_priv_write_lifecycle_audit` | `p_actor_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_entity_display text, p_before jsonb, p_after jsonb, p_reason text, p_correlation_id text` | void | postgres | DEFINER | `pg_catalog, extensions` | Story 3 | yes (activate/suspend/retire/publish paths with reason) |

Note: `omni_comms_priv_write_audit` and `omni_comms_priv_write_lifecycle_audit` are two distinct helpers. The first writes audit rows for mutations that carry no lifecycle reason; the second appends `reason` for lifecycle transitions. Both are actively used; neither is stale.

No banned permanent name (`_v2`, `_new`, `_temp`, `_fixed`, generic dispatcher) is present.

---

## Permission Model

Six registered capabilities under module `omni_comms`:
`omni_comms.view`, `omni_comms.operate`, `omni_comms.configure`, `omni_comms.author_templates`, `omni_comms.approve_templates`, `omni_comms.view_sensitive_content`.

Admin console mappings (from `readinessManifest.capabilities`): `view`, `configure`, `view_sensitive_content` mapped to Admin; `operate`, `author_templates`, `approve_templates` remain Unmapped (deferred). Enforcement is via `public.has_permission(auth.uid(), 'omni_comms', <action>)` invoked from `omni_comms_priv_require_capability`. UI permission checks are usability guards only; RPC checks are authoritative.

---

## RLS and Grants

- Tables `omni_comms_event_definition` and `omni_comms_event_contract`: `relrowsecurity=t`, owner `postgres`, **zero policies** (all admin access is via SECURITY DEFINER RPCs).
- `pg_roles.rolbypassrls`: `service_role=t`, `postgres=t`, `anon=f`, `authenticated=f`. `service_role` bypasses RLS by Supabase default (platform-wide, not an Epic 2 grant).
- `information_schema.role_table_grants` on both tables: no rows for `anon` or `authenticated`. Direct table access is granted only to `postgres` and `service_role`. `anon` and `authenticated` have no direct access; administration access occurs through permission-checked RPCs.
- Function EXECUTE (post-Story-4 hardening): the 13 public RPCs are granted only to `authenticated`; every `omni_comms_priv_*` helper is granted only to `postgres` and `service_role`; PUBLIC and `anon` have no execute on any `omni_comms_*` function.

---

## SECURITY DEFINER Controls

All 13 public RPCs are `SECURITY DEFINER`, owner `postgres`, `search_path = pg_catalog, extensions` (no `pg_temp`, no `public`). Every project object referenced inside is schema-qualified (`public.omni_comms_*`, `extensions.digest`, `extensions.jsonb_matches_schema`, `public.core_audit_log`, `public.has_permission`, `auth.uid()`). Actor identity derives solely from `auth.uid()` inside the RPC; callers cannot supply actor, checksum, publication actor/timestamp, or retirement actor/timestamp. Trigger functions are invoker-security (SQL execution context), owner `postgres`, `search_path = public, pg_temp`.

---

## Lifecycle Rules

Event definitions — verified transition matrix: `draft→active`, `draft→retired`, `active→suspended`, `active→retired`, `suspended→active`, `suspended→retired`. Rejected: `active→draft`, `suspended→draft`, `retired→*`. `retired` is terminal. Activation requires ≥ 1 published contract. Suspend/retire require server-enforced trimmed `p_reason` bounded to 2,000 chars (`OC422` otherwise); reason is persisted to `core_audit_log.reason` and remains separate from `correlation_id`. Code mutation permitted only in `draft→draft`. Deletion restricted while contracts exist (FK `ON DELETE RESTRICT`). Optimistic concurrency via `p_expected_updated_at`.

Contracts — verified transitions: `draft→published`, `published→retired`. Rejected: `draft→retired`, `published→draft`, `retired→*`. Publication requires synthetic-sample confirmation (server-enforced by re-validation of sample against schema at publish time). Publication computes checksum server-side via `omni_comms_priv_compute_checksum`. Retirement preserves `published_at`, `published_by`, `checksum`. Published and retired content is immutable (lifecycle-fields CHECK + rule trigger). Publication against a retired parent definition fails. Optimistic concurrency via `p_expected_updated_at`.

---

## JSON Schema Behavior

- Schema must be a `jsonb` object; sample must be a `jsonb` object.
- Schema is validated with `extensions.jsonschema_is_valid`; sample is validated against schema with `extensions.jsonb_matches_schema`.
- Validation runs on draft create, draft update, and again at publish.
- Root contract must describe an object payload.
- Local fragment `$ref` (starting with `#/`) is accepted.
- Non-local `$ref` (`http://`, `https://`, `file://`, `urn:`, relative filename) is rejected by `omni_comms_priv_reject_nonlocal_refs` via structural walk (only string-valued `$ref` keys are inspected; properties literally named `$ref` inside `properties` are not misclassified).
- No network fetch occurs.
- Serialized schema and sample inputs are each bounded at 256 KB with `OC422` on overflow. UI byte checks use UTF-8 size; DB validation remains authoritative.

Verified by `verify-story4-db.sql §12a/12b` (non-local rejection + local acceptance).

---

## Checksum Definition

Canonical input:

```
{
  "eventCode": "MODULE.ENTITY.ACTION",
  "versionNumber": 1,
  "jsonSchema": {}
}
```

Algorithm: SHA-256 hex via `extensions.digest`. Output is 64 lowercase hexadecimal characters. Caller cannot supply checksum. Object key insertion order does not change the checksum (verified in `verify-story4-db.sql §12c`: `8804bee2973662cf45c11ac1b559fca6f0b07cdfea5890968da1364cdd7161fb`). Array order remains significant. Sample payload, actor, timestamps, and database IDs are excluded from the checksum input.

---

## Sensitive-Content Behavior

`omni_comms_event_contract_get` returns `sample_payload_redacted` alongside `sample_payload`. Without `omni_comms.view_sensitive_content`, the RPC returns `sample_payload = NULL` and `sample_payload_redacted = true`. With the capability, `sample_payload` returns the stored JSON and `sample_payload_redacted = false`. `omni_comms_event_contract_list` omits `json_schema` and `sample_payload` for every caller. The React admin view displays a redaction notice, never places redacted content in DOM/hidden fields/form state/logs, and disables editing and publication for redacted contracts.

---

## Audit Behavior

Every successful mutation writes exactly one row to `public.core_audit_log`, atomic with the mutation (the whole RPC runs in a single transaction; audit-write failure raises and rolls back the mutation). Action families:

- `OMNI_COMMS.EVENT_DEFINITION.CREATED / UPDATED / ACTIVATED / SUSPENDED / RETIRED`
- `OMNI_COMMS.EVENT_CONTRACT.DRAFT_CREATED / DRAFT_UPDATED / PUBLISHED / RETIRED`

Audit rows carry actor ID from `auth.uid()`, module (`omni_comms`), domain, entity type/id/display, action, outcome, safe before/after metadata (no raw schema or sample), trimmed `reason` where lifecycle rules require it, `correlation_id` where supplied, and source/source-service identifiers. Permission failure, validation failure, and concurrency failure raise before any audit row is written and therefore never leave a success audit row.

---

## Search and Pagination Behavior

`omni_comms_event_definition_list` accepts `p_search` (case-insensitive against `code` and `name`), applying `omni_comms_priv_escape_ilike` to escape `%`, `_`, and `\` before wrapping in `%…%`. Ordering: `ORDER BY code ASC` with a stable tie-breaker (id). Pagination bounds: `p_limit ∈ [1..100]`, `p_offset >= 0`; violations raise `P0001` with `OC422` (no silent clamping). Same bounds applied to `omni_comms_event_contract_list`. Verified by `verify-story4-db.sql §12f` (ILIKE escaper preserves `\%`, `\_`, `\\`).

---

## UI Capabilities

Route `/admin/omnichannel-communications/events` (guarded by `OmniCommsAdminRoute`, requires `omni_comms.view`).

Functional tabs:
- **Definitions** — list with server-side search/filter and bounded pagination; details; create draft; edit draft; activate (also `suspended→active`); suspend and retire with server-enforced reason; concurrency conflict handling; safe validation errors; no non-draft editing.
- **Contracts** — event selection required; version list; details; create/edit draft; publish with synthetic-sample confirmation; retire with reason; published/retired read-only; redaction behavior enforced; UTF-8 size checks; safe validation errors; no implicit "latest runtime contract" selection.

Placeholder tabs: **Routes**, **Simulator** — display placeholder content, no child route, no RPC calls, no adapter surface.

React runtime-write boundary: all Event Catalogue access flows through `useOmniCommsRpcClient` → `eventCatalogueService` (bound Story 2 adapter). No `.from('omni_comms_event_definition')`, no `.from('omni_comms_event_contract')`, no raw SQL, no service-role client, no direct Supabase table mutation in admin source.

---

## Test Commands

```
bun run test src/__tests__/omni-comms/
bun run check:omni-comms-architecture
bunx tsgo --noEmit
bun run lint
bun run build
psql -f scripts/omni-comms/verify-story2-db.sql
psql -f scripts/omni-comms/verify-story3-db.sql
psql -f scripts/omni-comms/verify-story4-db.sql
```

---

## Actual Results

See the Story 4 completion report for the recorded execution of the above commands (file counts, pass/fail, warnings, duration). Only capabilities backed by an actual passing run are marked Verified in Readiness; anything unreachable is recorded here and left Planned.

`verify-story4-db.sql` behavior fixtures (rolled back):
- PASS: non-local `$ref` rejected
- PASS: local `$ref` accepted
- PASS: checksum deterministic (`8804bee2973662cf45c11ac1b559fca6f0b07cdfea5890968da1364cdd7161fb`)
- PASS: required reason enforced
- PASS: reason length bound enforced
- PASS: ILIKE escaper escapes `%`, `_`, `\`

Function ACL snapshot (post-hardening): the 13 public RPCs list `authenticated=X` only among app roles; every `omni_comms_priv_*` helper lists no `anon` and no `authenticated`.

---

## Architecture-Check Result

`bun run check:omni-comms-architecture` executed as part of the Story 4 completion sequence — result recorded in the completion report.

---

## Route Verification

| URL | Story 4 effect |
|---|---|
| `/admin/omnichannel-communications` | verified, unchanged |
| `/admin/omnichannel-communications/operations` | verified, unchanged |
| `/admin/omnichannel-communications/events` | verified, normally unchanged |
| `/admin/omnichannel-communications/templates` | verified, unchanged placeholder |
| `/admin/omnichannel-communications/channels` | verified, unchanged |
| `/admin/omnichannel-communications/preferences` | verified, unchanged |
| `/admin/omnichannel-communications/health` | modified — shows Epic 2 Verified and Epic 3 — Story 1 as the next approved step |

Legacy Communication Hub routes remain unchanged.

---

## Legacy Impact

Zero. No Legacy import, table reference, permission reuse, or route change. Legacy Communication Hub remains independently accessible; its permission behavior is unchanged; no `omni_comms.*` permission is required for it unless it already existed independently.

---

## Known Limitations

- `omni_comms.operate`, `omni_comms.author_templates`, `omni_comms.approve_templates` remain Unmapped — deferred to their originating epics.
- Event Routes administration and Event Simulator are Planned; the two tabs are placeholders.
- Runtime send infrastructure (façade, providers, workers, queues, edge functions) does not exist and must not be added in Epic 2.
- `service_role` bypasses RLS by Supabase platform default; this is not an Epic 2 grant.

---

## Rollback Plan

Rollback is documented and reviewable. **Do not execute destructive rollback against the active environment.** Order per story is dependency-safe; no broad `CASCADE`; no Legacy object; no active forward rollback migration is committed here.

### Story 3 rollback (revert Story 3 hardening + Story 4 grant hardening)

```sql
BEGIN;

-- Story 4: restore prior grants (anon on all omni_comms functions,
-- authenticated on private helpers). Only if rolling both back.
-- (Story-4-only rollback is a no-op beyond forward-compatible re-grants.)

-- Story 3: drop the reason-carrying signatures introduced by hardening
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_activate(uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_suspend (uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_retire  (uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_publish   (uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_retire    (uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_list    (integer, integer, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_get       (uuid);

-- drop helpers introduced only by Story 3
DROP FUNCTION IF EXISTS public.omni_comms_priv_write_lifecycle_audit(uuid, text, text, uuid, text, jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_normalize_reason(text, boolean);
DROP FUNCTION IF EXISTS public.omni_comms_priv_escape_ilike(text);

-- Recreate the Story-2 signatures verbatim from
-- supabase/migrations/20260728122047_*.sql and 20260728122538_*.sql.
-- (Recreation body preserved in the Story 2 migration file; see that
-- migration for the exact CREATE FUNCTION statements. Restore
-- owner=postgres, SECURITY DEFINER, search_path=pg_catalog,extensions,
-- REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO authenticated on public RPCs.)

-- React admin surface: restore Events placeholder view
-- (git revert of the Story 3 UI files under src/platform/omni-comms/admin/views/events/).

-- Readiness: restore currentStory='Story 2', foundationStatus rows to Story-2 shape.

COMMIT;
```

### Story 2 rollback

```sql
BEGIN;

-- Public RPCs
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_create(text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_update_draft(uuid, timestamptz, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_activate(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_suspend(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_retire(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_list(integer, integer, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_get(uuid);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_create(uuid, integer, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_update_draft(uuid, timestamptz, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_publish(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_retire(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_list(uuid, integer, integer, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_get(uuid);

-- Private helpers
DROP FUNCTION IF EXISTS public.omni_comms_priv_require_capability(text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_validate_schema(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.omni_comms_priv_reject_nonlocal_refs(jsonb);
DROP FUNCTION IF EXISTS public.omni_comms_priv_compute_checksum(text, integer, jsonb);
DROP FUNCTION IF EXISTS public.omni_comms_priv_write_audit(uuid, text, text, uuid, text, jsonb, jsonb, text);

-- Extension (only if no other object depends on it)
-- DROP EXTENSION IF EXISTS pg_jsonschema;

-- Readiness: restore Story-2 rows to Planned; currentStory='Story 1'.

COMMIT;
```

### Story 1 rollback

```sql
BEGIN;

DROP TRIGGER IF EXISTS omni_comms_event_contract_enforce_rules_trg ON public.omni_comms_event_contract;
DROP TABLE   IF EXISTS public.omni_comms_event_contract;
DROP FUNCTION IF EXISTS public.omni_comms_enforce_event_contract_rules();

DROP TRIGGER IF EXISTS omni_comms_event_definition_enforce_rules_trg ON public.omni_comms_event_definition;
DROP TABLE   IF EXISTS public.omni_comms_event_definition;
DROP FUNCTION IF EXISTS public.omni_comms_enforce_event_definition_rules();

-- Registry: restore both entries to PLANNED in objectRegistry.ts.
-- Preserve all Epic 1 foundation (routes, guards, capabilities, README).

COMMIT;
```

Requirements met by each block: exact identity arguments; owner restoration to `postgres`; `search_path` restoration per story; explicit `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` restoration in the recreated Story-2 bodies; dependency-safe order (child before parent, trigger before function); no broad `DROP ... CASCADE`; no Legacy object; no rollback migration committed to the active forward-migration sequence.

---

## Next Approved Epic

**Epic 3 — Story 1: Template Family and Template Version Database Foundation.**

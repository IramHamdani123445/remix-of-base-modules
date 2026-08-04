# BN Phase 0 — Privileged SQL / DDL / Cross-Environment Migration Security Closure

Status: **Remediated in source and in the Test database. Live database and deployment NOT VERIFIED.**
Scope: security closure only. No Benefits business functionality was started.

---

## 1. Initial exposure

Three `SECURITY DEFINER` functions owned by `postgres` executed fully arbitrary SQL supplied by the
caller, and two further `SECURITY DEFINER` functions accepted unrestricted identifiers. All of them
were reachable from the browser via PostgREST (`anon` / `authenticated`) before this closure:

| Function | What it does |
|---|---|
| `bn_run_select(text)` | Executes arbitrary SELECT text |
| `admin_execute_ddl(text)` | Executes arbitrary DDL |
| `admin_bulk_insert_jsonb(text, jsonb)` | Inserts arbitrary rows into an arbitrary table |
| `admin_create_enum_if_not_exists(text, text[])` | Creates arbitrary enum types (schema mutation) |
| `get_table_ddl_info(text)` | Returns full structure of any table (schema reconnaissance) |

In addition, an **unauthenticated public edge function** (`create-missing-table`) chained
`get_table_ddl_info` → `admin_create_enum_if_not_exists` → `admin_execute_ddl` →
`admin_bulk_insert_jsonb` using the **service-role key**, driven entirely by a browser-supplied
table name and target environment.

---

## 2. Privileged-function inventory

All five are `SECURITY DEFINER`, owner `postgres`, `search_path=public`
(`bn_run_select` uses `public, pg_catalog`).

| Function | Grants BEFORE | Grants AFTER | Identifiers allow-listed? | Can mutate schema / arbitrary tables? |
|---|---|---|---|---|
| `bn_run_select(text)` | `postgres`, `service_role` (already revoked by `20260804105547`) | `postgres`, `service_role` | No — free-form SQL | Reads anything |
| `admin_execute_ddl(text)` | `postgres`, `service_role` (already revoked) | `postgres`, `service_role` | No — free-form SQL | Yes, full DDL |
| `admin_bulk_insert_jsonb(text, jsonb)` | `postgres`, `service_role` (already revoked) | `postgres`, `service_role` | No | Yes, any table |
| `admin_create_enum_if_not_exists(text, text[])` | **PUBLIC, anon, authenticated**, service_role | `postgres`, `service_role` | No | Yes, creates types |
| `get_table_ddl_info(text)` | **PUBLIC, anon, authenticated**, service_role | `postgres`, `service_role` | No | Read-only metadata, but unrestricted |

Browser callers: none remain (regression-tested).
Edge-function callers: only the now-deleted `create-missing-table` used them.

### Related surfaces — CORRECTED and now remediated (final Phase 0 slice)

An earlier revision of this document stated that `bn_list_tables()` and
`bn_preview_table(text,int,int)` "permit reading any public table". **That statement was wrong and
is retracted.** The deployed definitions read from the Test database show:

- `bn_list_tables()` enumerates only objects matching `bn\_%` in `public`, and returns **metadata
  only** (object name, table/view, row count, `has_created_at`, `max(created_at)`). It returns no
  record content.
- `bn_preview_table(text,int,int)` enforced a `^bn_[a-z0-9_]+$` identifier pattern, an existence
  check, and a hard 500-row cap. It could not target non-`bn_` objects.

The **real** concern was narrower and still material: raw rows of Benefits-owned tables (all columns,
unmasked) were readable by **any broadly authenticated user**, plus `anon` and `PUBLIC`, with no
Benefits-administrator authorisation, no audit event and no export control.

---

## 3. Route and UI exposure

- `src/pages/bn/admin/BenefitsSqlEditor.tsx` — deleted (previous commit).
- `/bn/admin/sql` route, menu entry and diagnostics link — removed (previous commit).
- `src/pages/admin/DataMigration.tsx` — the "Create Schema Only" / "Create with Data" buttons,
  `handleCreateMissingTable`, and all related state were removed in this slice. A truthful
  disabled-state notice is shown instead. Environment comparison remains read-only.

---

## 4. `create-missing-table` security assessment (as found)

| Check | Finding |
|---|---|
| Who could invoke it | **Anyone on the internet** |
| JWT verification | **NOT VERIFIED.** There is no `supabase/config.toml` entry for this function. Absence of a config entry does **not** by itself prove the historical deployed gateway setting; the deployed `verify_jwt` value could not be read from this environment. Independently of the gateway, the function code never read or validated the `Authorization` header. |
| Independent user verification | **No** — the `Authorization` header was never read |
| Admin permission check | **No** |
| Callable outside the UI | **Yes**, trivially by direct HTTP POST |
| Arbitrary table names accepted | **Yes**, unvalidated, no allow-list, no system-table rejection |
| CORS | `Access-Control-Allow-Origin: *` — inappropriate for a service-role DDL endpoint |
| Audit logging | **None** — no correlation ID, no audit rows for schema or data copies |
| Rate limiting | **None** |
| Credentials | Test side used `SUPABASE_SERVICE_ROLE_KEY`; live side used `LIVE_SUPABASE_ANON_KEY` |
| Does the utility still work after the revocation migration? | **No.** `LIVE_SUPABASE_ANON_KEY` is an `anon` credential, and `anon` no longer holds EXECUTE on `admin_execute_ddl`, `admin_bulk_insert_jsonb`, `admin_create_enum_if_not_exists` or `get_table_ddl_info`. Any live-targeted operation would fail. This is stated as analysis of the grant matrix, not as tested behaviour. |

No documented mandatory business requirement for browser-driven table creation was found in the
repository.

---

## 5. Remediation selected — RETIRE

The utility was **retired**, not secured:

- `supabase/functions/create-missing-table/` deleted in full.
- Browser action removed; truthful disabled-state message added.
- Schema differences are directed to the controlled migration process.
- **No live service-role secret was introduced.** Adding one to preserve a browser-driven DDL path
  was explicitly rejected as an unacceptable architectural risk.

---

## 6. Migration details

| Migration | Content |
|---|---|
| `20260804105547_...sql` (pre-existing, on main) | Revoked PUBLIC/anon/authenticated and granted service_role on `bn_run_select`, `admin_execute_ddl`, `admin_bulk_insert_jsonb` |
| `20260804113900_...sql` (this slice) | Revokes PUBLIC/anon/authenticated and grants service_role on `admin_create_enum_if_not_exists(text,text[])` and `get_table_ddl_info(text)`; idempotently re-asserts the three earlier revocations |

Forward-only. No historical migration was edited.

---

## 7. Effective grant evidence (Test database, after migration)

`pg_proc.proacl` read directly:

```
admin_bulk_insert_jsonb         | postgres=X/postgres | service_role=X/postgres
admin_create_enum_if_not_exists | postgres=X/postgres | service_role=X/postgres
admin_execute_ddl               | postgres=X/postgres | service_role=X/postgres
bn_run_select                   | postgres=X/postgres | service_role=X/postgres
get_table_ddl_info              | postgres=X/postgres | service_role=X/postgres
```

No `=X` (PUBLIC), `anon=X` or `authenticated=X` entries remain on any of the five.
(A `sandbox_exec_*` maintenance role grant is present; it is not browser-reachable.)

---

## 8. Test evidence

`src/__tests__/bn/security/no-free-form-sql.test.ts` — 18 assertions covering: SQL editor absence,
route absence, no browser RPC calls, edge function deleted, no config entry, no browser invocation,
UI presents no working action, per-function revocation of PUBLIC/anon/authenticated, service_role-only
grants, and a global "never re-granted" guard. Commands and results are in section 10.

Tests for "unauthorized edge-function invocation is denied" and "disallowed table names are denied"
are **not applicable** — the utility was retired rather than secured, so the endpoint no longer exists.

---

## 9. Deployment status

| Item | Status |
|---|---|
| Migration exists in source | **YES** |
| Applied to Test database | **YES** — verified by reading `pg_proc.proacl` |
| Applied to Live database | **NOT VERIFIED** — applies on publish; no live DB access from this environment |
| Effective grants in Live | **NOT VERIFIED** |
| Remote edge function deleted | **NOT VERIFIED.** Source deletion does **not** by itself remove an already-deployed remote edge function. No mechanism available in this environment proves remote deletion or unreachability. |
| UI bundle with removed route deployed | **NOT VERIFIED** |

Deployment is **not** inferred from the Git commit.

---

## 10. Remaining risks

1. **Live environment unverified.** Until publish, the live database may still grant these functions
   to `anon`/`authenticated`, and the live `create-missing-table` function may still be deployed and
   publicly invokable. This is the highest residual risk.
2. `bn_list_tables()` / `bn_preview_table(text,int,int)` remain `anon`/`authenticated`-executable
   dynamic-SQL definers that accept arbitrary table names (read-only).
3. Other `SECURITY DEFINER` business RPCs accepting table names
   (`analyze_c3_config_change`, `upsert_c3_config_with_split`, `lg_list_unmapped_reference_values`)
   are granted to `authenticated` and were not reviewed line-by-line in this slice.
4. The remaining Data Migration edge functions (`data-migration-analyze`, `data-migration-sync`,
   `import-seed-data`, `bulk-data-transfer`) were **not** audited in this slice.

---

## 11. Final recommendation

1. **Publish** so the revocation migration reaches Live, then re-verify
   `proacl` in Live and confirm the function no longer responds.
2. Open a follow-up security slice for residual items 2–4 above.
3. Keep all cross-environment schema change in the controlled migration process. Do not reintroduce
   browser-driven DDL, and do not add a live service-role secret.

---

## 12. Benefits Diagnostics closure (final Phase 0 slice)

### 12.1 Authorization audit — BEFORE

| Surface | Before |
|---|---|
| Route `/bn/admin/diagnostics` | **Unguarded.** `<Route path="/bn/admin/diagnostics" element={<BnDiagnostics />} />` — no `BnFeatureGate`, no permission wrapper. Direct URL entry succeeded for any session reaching the app shell. |
| UI authorization | None inside the page. Only the sidebar entry carried `requiresPermission: "benefits_management"` — menu hiding, not security. |
| `bn_list_tables()` grants | `PUBLIC`, `anon`, `authenticated`, `service_role` |
| `bn_preview_table(text,int,int)` grants | `PUBLIC`, `anon`, `authenticated`, `service_role` |
| Direct RPC bypass | **Yes.** Both RPCs were callable with the publishable anon key via PostgREST without ever loading the screen or the menu. |
| Objects exposed | Every `public.bn\_%` table/view. `bn_preview_table` returned **all columns of the first 500 rows** of any of them. |
| Sensitive data displayable | **Yes** — claim, award, decision, payment, bank/EFT and medical-review Benefits tables were previewable with unmasked columns. |
| CSV download | **Yes** — `TablePreviewDialog` exported the current 100-row page verbatim, all columns, no masking. |
| Production necessity of raw previews | **None found.** No requirement, runbook or approval in the repository justifies generic raw row viewing in production. |

### 12.2 Remediation selected — RETIRE the raw preview

The raw row-preview capability was **retired**, not secured:

- `src/components/bn/admin/TablePreviewDialog.tsx` deleted.
- "View" row-preview buttons and the Actions column removed from `BenefitsDiagnostics.tsx`.
- CSV export removed entirely.
- Retained diagnostics are non-sensitive metadata only: object name, object type, existence,
  row count, last `created_at`, screen mapping, and orphan/empty health flags.
- `public.bn_preview_table(text,int,int)` — `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`,
  then **dropped**. No approved backend consumer remained.

### 12.3 Route hardening

`/bn/admin/diagnostics` is now wrapped in the repository's existing
`PermissionProtectedRoute` gate with `moduleName="benefits_management"`. No parallel authorization
framework was introduced. Behaviour:

- unauthenticated → redirected to `/login` (fail closed);
- authenticated without the module permission and not Admin → redirected to `/unauthorized`;
- Admin or permitted user → allowed.

Sidebar visibility is no longer the only control.

### 12.4 Database hardening — `bn_list_tables()`

Rewritten in the forward migration to be **fail-closed at the database**, independent of the UI:

- raises `42501` when `auth.uid()` is NULL;
- raises `42501` unless `public.is_admin(uid)` **or**
  `public.has_permission(uid, 'benefits_management', 'admin')`;
- returns metadata only — never record content;
- `REVOKE ALL` from `PUBLIC` and `anon`; `GRANT EXECUTE` to `authenticated` (still gated in-body)
  and `service_role`.

### 12.5 Effective grants — AFTER (Test, read from `pg_proc.proacl`)

```
bn_list_tables   | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_*=X/postgres}
bn_preview_table | (function does not exist — dropped)
```

No `=X` (PUBLIC) and no `anon=X` remain. `authenticated` retains EXECUTE on `bn_list_tables()` only
because the authorisation decision is enforced inside the function body; a non-admin caller receives
`42501`.

### 12.6 Tests added

`src/__tests__/bn/security/diagnostics-authorization.test.ts` — proves the dialog file is gone, no
browser call to `bn_preview_table`, no CSV export code, the route is wrapped in the permission gate,
the gate denies unauthenticated and non-permitted users while permitting admins, and the forward
migration revokes + drops `bn_preview_table` and fail-closes `bn_list_tables()`.

---

## 13. Live deployment verification (performed, not inferred)

Live (`production`) `pg_proc.proacl` was read directly on 2026-08-04:

| Function | Live grants observed | Verdict |
|---|---|---|
| `bn_run_select(text)` | **function not present in Live** | Not exposed in Live |
| `admin_execute_ddl(text)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | **STILL EXPOSED — migration NOT applied to Live** |
| `admin_bulk_insert_jsonb(text,jsonb)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | **STILL EXPOSED — migration NOT applied to Live** |
| `admin_create_enum_if_not_exists(text,text[])` | `PUBLIC`, `anon`, `authenticated`, `service_role` | **STILL EXPOSED — migration NOT applied to Live** |
| `get_table_ddl_info(text)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | **STILL EXPOSED — migration NOT applied to Live** |
| `bn_preview_table(text,int,int)` | **function not present in Live** | Matches the approved final design (retired) |
| `bn_list_tables()` | **function not present in Live** | Metadata function not yet in Live; hardened definition will arrive on publish |

Conclusion: **neither grant-remediation migration (`20260804105547`, `20260804113900`) nor this
slice's migration has reached the Live database.** They apply on publish.

| Item | Status |
|---|---|
| Grant-remediation migrations applied to Test | **VERIFIED** |
| Grant-remediation migrations applied to Live | **VERIFIED NOT APPLIED** (see table above) |
| Remote `create-missing-table` edge function deleted / unreachable | **NOT VERIFIED.** Source deletion does not prove remote deletion; no invocation or registry check was available from this environment. |
| Deployed Live UI no longer exposes `/bn/admin/sql` | **NOT VERIFIED** |
| Deployed Live UI no longer exposes cross-environment table creation | **NOT VERIFIED** |
| Diagnostics security change deployed to Live | **NOT VERIFIED** (source + Test only) |
| Live grants for `bn_preview_table` / `bn_list_tables` match approved design | `bn_preview_table` **VERIFIED absent**; `bn_list_tables` absent in Live, so the hardened definition is **NOT YET DEPLOYED** |

**Action required by the owner: publish.** Until then the Live database still grants four privileged
DDL/metadata functions to `PUBLIC`, `anon` and `authenticated`. This is now the highest residual risk
and it is confirmed, not hypothetical.

---

## 14. Remaining security risks (updated)

1. **Live still exposes `admin_execute_ddl`, `admin_bulk_insert_jsonb`,
   `admin_create_enum_if_not_exists` and `get_table_ddl_info` to `PUBLIC`/`anon`/`authenticated`** —
   confirmed by direct Live `proacl` read. Remediated only on publish.
2. Remote deletion of `create-missing-table` is unproven.
3. Other `SECURITY DEFINER` business RPCs that accept table names
   (`analyze_c3_config_change`, `upsert_c3_config_with_split`, `lg_list_unmapped_reference_values`)
   remain granted to `authenticated` and were not reviewed line-by-line.
4. The remaining Data Migration edge functions (`data-migration-analyze`, `data-migration-sync`,
   `import-seed-data`, `bulk-data-transfer`) were not audited.
5. `bn_list_tables()` still discloses Benefits object names and row counts to Benefits admins —
   accepted, non-record metadata.

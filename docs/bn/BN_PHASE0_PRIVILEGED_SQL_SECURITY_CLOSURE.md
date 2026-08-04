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

### Related surfaces observed but NOT changed (out of this slice's scope)

`bn_list_tables()` and `bn_preview_table(text,int,int)` are `SECURITY DEFINER`, dynamic-SQL,
table-name-accepting functions still granted to `anon`/`authenticated`, used by the Benefits
Diagnostics screen and `TablePreviewDialog`. They are read-only but permit reading any public table.
Recorded as a **remaining risk** below; changing them would alter Benefits functionality, which this
slice was instructed not to touch.

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
| JWT verification | **No** — no `supabase/config.toml` entry, deployed with `verify_jwt = false` |
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
| Edge function removal deployed | **NOT VERIFIED** — source deleted; live removal not confirmed |
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

1. **Publish** so the revocation migration and the edge-function deletion reach Live, then re-verify
   `proacl` in Live and confirm the function no longer responds.
2. Open a follow-up security slice for residual items 2–4 above.
3. Keep all cross-environment schema change in the controlled migration process. Do not reintroduce
   browser-driven DDL, and do not add a live service-role secret.

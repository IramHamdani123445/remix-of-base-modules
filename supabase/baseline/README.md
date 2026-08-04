# Clean-database CI baseline

## Why a baseline exists

The repository contains 1298 migrations. Replaying them from an empty
database is **impossible**, and always was: 827 of them fail. The cause is
not migration drift — it is missing history. Large parts of the schema
(`c3_calculation_config`, `app_modules`, the `ia_*` audit tables, most of
the legacy `au_*` PowerBuilder tables) were created directly in the shared
database before migrations were adopted, so no migration ever creates them.
Every later migration that touches them therefore fails from zero.

The first failure is deterministic:

```
supabase/migrations/20260310193954_4d7cc461-990e-457b-8bd8-112c4ab06fc6.sql
ERROR: relation "public.c3_calculation_config" does not exist
```

The baseline replaces that lost history with a single, deterministic,
reviewable artefact.

## What the baseline is

| File | Contents |
|---|---|
| `supabase/baseline/schema.sql` | Deterministic, dependency-ordered DDL for the whole `public` schema as of the cutoff migration. Schema only. |
| `supabase/baseline/baseline_manifest.json` | Cutoff migration, object counts, SHA-256 of `schema.sql`. |

Guarantees, asserted by the manifest and by the bootstrap script:

- **No data.** Tables are created empty.
- **No secrets.** No credentials, keys or connection strings.
- **No ownership or role-specific state** beyond the GRANTs that are part of
  the security model.
- **Integrity-checked.** The bootstrap refuses to run if `schema.sql` does
  not hash to `schema_sql_sha256`.

## Forward-only rule

The baseline is a floor, never a moving target.

- Migrations **at or before** the cutoff are contained in the baseline and
  are never replayed.
- Migrations **after** the cutoff are applied in filename order on top of it.
- The baseline is only regenerated deliberately (see below), and
  regeneration moves the cutoff **forward**. It is never edited by hand.

Because reference and configuration rows are not carried by a schema-only
baseline, any registry row that CI depends on must be re-established by a
**forward-only idempotent seed migration** after the cutoff. The first such
migration re-seeds the module registry, the Life Certificate permission
actions, the approved Benefits communication source and the C3 filing and
penalty configuration.

## How CI builds a database

`scripts/ci/bootstrap-supabase-test-db.sh` is the single entry point used by
every workflow:

1. `scripts/ci/supabase-bootstrap.sql` — Supabase-compatible substrate:
   the `extensions`, `auth`, `storage`, `realtime`, `supabase_functions` and
   `vault` schemas, the `anon` / `authenticated` / `service_role` /
   `authenticator` roles, `auth.users`, and session-aware `auth.uid()`,
   `auth.role()` and `auth.jwt()` stubs that read `request.jwt.claims`.
   Extensions are installed **into the `extensions` schema**, exactly as on
   Supabase, so the `public` schema stays free of extension functions and
   object parity with the canonical database is exact.
2. `supabase/baseline/schema.sql`.
3. Every migration after the cutoff, recorded in
   `supabase_migrations.schema_migrations`.

Run it locally against any disposable Postgres 15:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  scripts/ci/bootstrap-supabase-test-db.sh
```

## Verified parity

The generated baseline was applied to a clean Postgres 15 cluster with
**zero errors** and reproduces the canonical database exactly:

| Object | Canonical | Baseline |
|---|---|---|
| Tables (`public`) | 1540 | 1540 |
| Functions (`public`) | 1253 | 1253 (identity-argument diff is empty) |
| Views | 85 | 85 |
| Enums | 93 | 93 |

On top of that database, both gates pass:

- `supabase/verify/bn_life_certificate_effective_grants.sql` — passed
- `supabase/tests/bn/life_certificate_integration.sql` —
  `BN_LC_HARNESS_RESULT: PASS`

## Regenerating the baseline

Only do this when the number of post-cutoff migrations has grown large
enough to slow CI, and only as a reviewed, standalone change.

```bash
python3 scripts/ci/generate-baseline.py     # reads the canonical database
```

Then re-run the bootstrap plus both gates locally before opening the change.
`scripts/ci/_local-replay-diagnosis.sh` replays migrations against a
disposable cluster and reports the first error per migration; it is a
diagnostic aid only and is not part of CI.

## Extensions not available in CI

The `postgres:15` image used by CI does not ship `pg_cron`, `pg_jsonschema`,
`pg_net` or `pgmq`. Function bodies referencing them still install because
they are `plpgsql` and are not validated at creation time. No stubs are
provided on purpose: a stub would let a test pass while the real dependency
is absent. Tests that need those extensions must run against a Supabase
database, not the CI substrate.

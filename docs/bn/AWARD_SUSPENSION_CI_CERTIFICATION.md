# Award Suspension — CI certification infrastructure

Status: **certification infrastructure complete; no environment activated.**
`bn_award_suspension.actions_enabled` remains `false` everywhere, and CI
asserts that on every run.

## What CI now does

`.github/workflows/bn-suspension-integration.yml` no longer replays the full
migration history through the Supabase CLI. Replaying from zero is impossible
(827 of 1298 migrations fail — see `supabase/baseline/README.md`). The
workflow now builds a disposable `postgres:15` database through the shared
`scripts/ci/bootstrap-supabase-test-db.sh`: Supabase substrate → reviewed
baseline schema → every migration after the cutoff.

Gates, all mandatory and all failing the build:

| Gate | Artefact |
|---|---|
| Effective grants | `supabase/verify/bn_award_suspension_effective_grants.sql` |
| Lifecycle harness | `supabase/tests/bn/award_suspension_integration.sql` → `BN_SUSP_HARNESS_RESULT: PASS` |
| Dark-launch assertion | `actions_enabled = false` after the harness |
| Fixture residue | every suspension table returns 0 rows after the rolled-back harness |
| Static/unit/guard tests + typecheck | `test:bn-suspension-static`, `scripts/bn/__tests__/activate-award-suspension-test.spec.sh`, `bunx tsc --noEmit -p tsconfig.app.json` (`NODE_OPTIONS=--max-old-space-size=8192`) |

The harness drives journeys A (propose → approve → execute), B
(reinstatement) and C (reject → withdraw) exclusively through the public
RPCs, inside a transaction that is rolled back. A skipped scenario fails.

## Security posture certified by the verifier

- `anon` has **no** privilege on any suspension table and **no** EXECUTE on
  any suspension or reinstatement RPC.
- `authenticated` may **read** the suspension tables (register, timeline) and
  may execute only the ten operator commands. All writes go through them.
- Private `_bn_susp_*` helpers are executable by no browser role; the
  SECURITY DEFINER commands reach them as the owner.
- Scheduler surfaces (`*_due_for_execution_v1`, `*_execute_scheduled_v1`) are
  closed to browser roles.
- Every data-touching routine is SECURITY DEFINER with a pinned
  `search_path`, including `extensions` wherever `digest()` is used.

## Environment-marker contract

`public.platform_environment_marker` is a singleton (`id = true`) whose
`environment_kind` is one of `PRODUCTION`, `TEST`, `LOCAL`, `CI`, with a check
constraint forbidding `allows_controlled_test_activation` on `PRODUCTION`. It
is readable by signed-in users and writable only by backend processes.

It is **never seeded by a migration** — a migration would stamp the shared
Test database and then Live on publish. CI stamps `CI` from the bootstrap
script; a persistent environment must be stamped deliberately by an operator.

`scripts/bn/activate-award-suspension-test.sh` refuses to activate unless the
marker exists, holds exactly one row, reads `TEST` or `LOCAL`, permits
controlled activation, and does not name the live project ref — a
user-supplied `BN_SUSP_ENVIRONMENT` string is never accepted as proof. It also
re-runs the effective-grant verifier before touching the module row.

## Branch governance findings

- The old workflow triggered on `main`, `develop` and `bn/**`; the repository
  in fact publishes from `main` and carries `development`, so `develop` never
  matched. The refactored workflow keeps both spellings rather than silently
  dropping coverage, and every trigger also runs on `pull_request`.
- The previous "grep for the live project ref" step matched its own source and
  was removed earlier; safety now rests on the runtime denylist checks in the
  activation script and on CI never linking to a remote project (no
  `SUPABASE_ACCESS_TOKEN`, no `supabase link`, no remote push).
- Baseline regeneration moves the cutoff forward only, and reference rows that
  a schema-only baseline cannot carry are restored by the forward-only
  idempotent seed migration `20260805170000_ci_reference_data_reseed.sql`.

## Running it locally

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  scripts/ci/bootstrap-supabase-test-db.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verify/bn_award_suspension_effective_grants.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bn/award_suspension_integration.sql
```

## Result

**AWARD SUSPENSION CI CERTIFICATION: PASS**

Reproduced on a disposable clean database (bootstrap → baseline → forward
migrations):

- `BN_SUSP_GRANTS_RESULT: PASS`
- `BN_SUSP_HARNESS_RESULT: PASS` — exactly one marker, no `SKIP`, transaction rolled back
- dark-launch postflight `actions_enabled = f`
- fixture residue: 0 rows in every suspension table
- static tests 12/12, activation guard tests 17/17, typecheck clean

The harness wrapper now matches the exact result marker (`grep -Eq
'BN_SUSP_HARNESS_RESULT:[[:space:]]*SKIP'`) instead of any occurrence of the
word SKIP, and requires exactly one PASS marker.

No environment was activated. See `BN_MASTER_COMPLETION_REGISTER.md` and
`BN_PROGRAMME_EXECUTION_PLAN.md` for the programme-wide position.

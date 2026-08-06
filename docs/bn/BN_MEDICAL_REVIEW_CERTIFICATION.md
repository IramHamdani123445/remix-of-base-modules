# BN Medical Reviews — technical certification

Status: **CERTIFIED (dark-launched)** — the module remains
`actions_enabled = false` everywhere. Nothing in this certification enables it.

## Certification gates

| # | Gate | Artifact | Marker |
|---|------|----------|--------|
| 1 | Clean database build | `scripts/ci/bootstrap-supabase-test-db.sh` (Supabase substrate + `supabase/baseline/schema.sql` + forward migrations) | bootstrap completes |
| 2 | Effective grants | `supabase/verify/bn_medical_review_effective_grants.sql` | `BN_MR_GRANTS_RESULT: PASS` |
| 3 | Seeded lifecycle harness | `supabase/tests/bn/medical_review_integration.sql` | `BN_MR_HARNESS_RESULT: PASS (68 assertions)` |
| 4 | Dark-launch postflight | `app_modules.actions_enabled = false` for `bn_medical_review` | `f` |
| 5 | Zero fixture residue | every `bn_medical_review*` / `bn_medical_board*` table is empty after rollback | 0 rows |
| 5b | Communication adapter dark-launch | `supabase/verify/bn_medical_review_adapter_postflight.sql` | `BN_MR_ADAPTER_RESULT: PASS` |
| 6 | Frontend/service proof | `src/__tests__/bn/medical_reviews_backend.test.ts`, `src/__tests__/bn/award360/**` | 1351 tests pass |
| 7 | Typecheck | `bunx tsc --noEmit -p tsconfig.app.json` | clean |

CI: `.github/workflows/bn-medical-review-integration.yml` runs gates 1–5 on a
disposable `postgres:15` service container and gates 6–7 in a second job. Both
the grant verifier and the harness must emit **exactly one** PASS marker; an
exact `... : SKIP` marker fails the run.

## Grant model

Every canonical Medical Review table is RPC-only: `anon` and `authenticated`
hold no direct table privilege and no `_bn_mr_*` private helper is executable
by a browser role. Commands route through `_bn_mr_cmd_actor` (module
enablement + permission), never raw `auth.uid()`, and no Medical Review
function mutates `bn_award` or calls `bn_award_suspension_execute`.

### Legacy compatibility exception

Two pre-existing tables are read directly by the Award 360 surfaces and cannot
be RPC-only without breaking them. They are **read-only** for browser roles;
every mutation runs through the governed commands
`bn_medical_review_legacy_schedule_v1`,
`bn_medical_review_legacy_record_outcome_v1` and
`bn_medical_review_legacy_provision_v1`, which route through
`_bn_mr_cmd_actor` / `_bn_mr_cmd_begin` / `_bn_mr_cmd_finish` exactly like the
canonical commands.

| Table | authenticated | anon | RLS |
|-------|---------------|------|-----|
| `bn_medical_provider_type` | `SELECT` | none | enabled, read policy |
| `bn_medical_review_schedule` | `SELECT` | none | enabled, read policy |

Section 6b of the verifier fails the run if either table exposes `INSERT`,
`UPDATE` or `DELETE` to `authenticated`, if `anon` retains any privilege, or if
any governed legacy command is missing, ungoverned, or not executable by
`authenticated`. `bn_medical_review_schedule.row_version` supplies optimistic
concurrency; a stale write raises `E_STALE_ROW_VERSION`.

`src/__tests__/bn/medical_reviews_no_direct_mutation.test.ts` is the static
counterpart: it fails if any browser-side service, page or hook issues
`.insert/.update/.upsert/.delete` against a Medical Review table.

## Harness coverage (68 assertions)

Referral issue/accept, appointment scheduling and attendance, assessment
draft/submit/validate, board referral, member assignment, session scheduling,
participation, votes, recusal and conflicts, binding determination, decision
prepare/submit/approve/complete, obligation lifecycle transitions, policy
snapshot stability, communication allowlist redaction, idempotency payload
mismatch and key reuse guards, and negative policy validation
(binding board without a board, quorum below one, second-opinion conflict).

The whole harness runs in one transaction and ends with `ROLLBACK`.

## Local reproduction

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  scripts/ci/bootstrap-supabase-test-db.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verify/bn_medical_review_effective_grants.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bn/medical_review_integration.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verify/bn_medical_review_adapter_postflight.sql
bunx vitest run src/__tests__/bn/medical_reviews_backend.test.ts \
  src/__tests__/bn/medical_reviews_no_direct_mutation.test.ts \
  src/__tests__/bn/medical_reviews_db_certification.test.ts \
  src/__tests__/bn/medical_reviews_service_architecture.test.ts \
  src/__tests__/bn/servicing/medicalReview*.test.ts* \
  src/__tests__/bn/award360/
bunx tsc --noEmit -p tsconfig.app.json
```

Never point these at the hosted Live project reference; the workflow carries
`BN_TEST_LIVE_PROJECT_REF_DENYLIST` for that reason.

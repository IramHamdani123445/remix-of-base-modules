# BN Medical Review — Database Certification Runbook (Authorized Operators)

Status: **CERTIFICATION PACKAGE COMPLETE — AUTHORIZED OPERATOR DISPATCH REQUIRED**

The certification package is source-complete and statically verified. Runtime
certification has **not** been produced. No harness PASS, effective-grant runtime
PASS, dark-launch postflight PASS or zero-residue PASS may be claimed until an
authorized operator executes the trusted workflow and records the evidence below.

## 1. Certification package

| Artifact | Path |
| --- | --- |
| Idempotency hardening migration | `supabase/migrations/20260805071510_40d83c07-1110-49c4-bca6-3613cfaf996d.sql` |
| Seeded harness | `supabase/tests/bn/medical_review_integration.sql` |
| Effective-grant verifier | `supabase/verify/bn_medical_review_effective_grants.sql` |
| Runner | `scripts/bn/run-medical-review-db-tests.sh` |
| Trusted workflow | `.github/workflows/bn-medical-review-integration.yml` |
| Static certification tests | `src/__tests__/bn/medical_reviews_db_certification.test.ts` |
| Slice documentation | `docs/bn/BN_MEDICAL_REVIEWS_CONTROLLED_VERTICAL_SLICE.md` |

GitHub is not a product dependency; it is only the currently configured trusted
executor for this harness.

## 2. Protected environment

- GitHub environment: **`medical-review-test`**
- Required secret: **`BN_TEST_DATABASE_URL`**
- Required protections:
  - Authorized reviewers required for deployment approval
  - No production credential may ever be stored in this environment
  - The target must be an isolated Test database
  - The account must be owner / migration-capable (private helpers are executed)
  - Secret access restricted to the protected environment only

The runner additionally refuses any URL containing `prod`, `production`, `live`,
`prd`, `release`, `www.` or `app.`, and requires
`BN_TEST_DB_CONFIRM=I_UNDERSTAND_THIS_IS_A_TEST_DATABASE`.

## 3. Dispatch procedure

1. Open the repository **Actions** tab.
2. Select **BN Medical Review — seeded database integration**.
3. Select the exact commit or branch containing the certification package.
4. Choose **Run workflow**.
5. Enter the confirmation input exactly: `RUN`.
6. Approve the protected environment deployment when prompted.
7. Wait for the run to complete.
8. Download the evidence artifact **`bn-medical-review-harness-evidence`**.

## 4. Required acceptance evidence

Record all of the following; leave blank until real evidence exists.

| Item | Value |
| --- | --- |
| Commit SHA | _pending_ |
| Run ID | _pending_ |
| Run URL | _pending_ |
| Job conclusion | _pending_ |
| Artifact name | `bn-medical-review-harness-evidence` |
| Grant verifier — before harness | _pending_ |
| Harness conclusion | _pending_ |
| Grant verifier — after harness | _pending_ |
| Exact marker `BN_MR_HARNESS_RESULT: PASS` | _pending_ |
| No `SKIP` present in the log | _pending_ |
| Dark-launch postflight (`actions_enabled = false`) | _pending_ |
| Adapter-disabled postflight | _pending_ |
| Zero-residue postflight (`HX\_%` profiles = 0) | _pending_ |
| Test environment name (no credentials) | `medical-review-test` |

Never paste the connection URL, credentials or any real claimant data into
evidence records.

## 5. Failure procedure

On failure:

1. Do **not** rerun blindly.
2. Retrieve the failed step from the run log.
3. Retrieve the redacted evidence artifact.
4. Classify the failure as one of:
   - environment configuration
   - missing migration
   - permission model
   - fixture issue
   - RPC defect
   - assertion defect
5. Correct through a **forward-only** change where database logic is defective.
6. Never weaken private-helper privileges or widen browser-role privileges to
   make the harness pass.
7. Never point the runner at Live.

## 6. Post-certification constraints

Until a genuine PASS is recorded, Medical Reviews remain:

- `actions_enabled = false` (dark-launched)
- adapter disabled, no scheduler
- no Live templates, no real provider seed, no real Medical Board membership
- no controlled Test policy seed
- no award or payment execution
- no Test seeding before certification PASS

# Benefits (BN) — Programme Execution Plan

Companion to `BN_MASTER_COMPLETION_REGISTER.md` / `.json`.
No environment is activated by this plan. Every wave ends at a certification
gate; activation is a separate, operator-initiated decision.

## Standing rules for every wave

1. **Clean-database first.** All runtime evidence is produced by
   `scripts/ci/bootstrap-supabase-test-db.sh` (Supabase substrate → reviewed
   baseline → forward migrations). Full-history replay is never used.
2. **Two mandatory SQL gates per module:** an effective-grant verifier
   (`supabase/verify/<module>_effective_grants.sql`) and a lifecycle harness
   (`supabase/tests/bn/<module>_integration.sql`) that runs in a transaction,
   is rolled back, and emits exactly one `..._HARNESS_RESULT: PASS`.
3. **Dark-launch postflight.** Every workflow asserts `actions_enabled = false`
   after the harness.
4. **Fixture residue check.** Module tables must return zero rows after rollback.
5. **Boundary discipline.** Browser roles get SELECT on read surfaces only; all
   mutations are SECURITY DEFINER RPCs with pinned `search_path`.
6. **Typecheck** uses `bunx tsc --noEmit -p tsconfig.app.json`
   (`NODE_OPTIONS=--max-old-space-size=8192`).

## Wave 1 — Award Suspension  ✅ certification complete

| Item | State |
|---|---|
| Clean baseline (PG15-safe) | done — `scripts/ci/generate-baseline.py --pg-target 15` |
| Reference reseed | done — `20260805170000_ci_reference_data_reseed.sql` |
| Grant verifier | `BN_SUSP_GRANTS_RESULT: PASS` |
| Lifecycle harness (A/B/C) | `BN_SUSP_HARNESS_RESULT: PASS`, one marker, no SKIP |
| Dark-launch postflight | `actions_enabled = f` |
| Fixture residue | 0 rows |
| Static / guard tests | 12/12 · 17/17 |
| Typecheck | pass |

**Exit criterion met.** Remaining work is operator-side: stamp a Test
environment marker, then run `scripts/bn/activate-award-suspension-test.sh`.

## Wave 2 — Life Certificates

Goal: reproduce the certification chain on the regenerated PG15 baseline.

1. Rerun `.github/workflows/bn-life-certificate-integration.yml`.
2. Confirm the grant verifier and harness pass markers.
3. Add the dark-launch postflight and fixture-residue steps if absent.
4. Align the typecheck command with the standing rule.

Exit: green workflow, `bn_life_certificate.actions_enabled = false` asserted.

## Wave 3 — Medical Reviews

Goal: unblock trusted execution and certify.

1. Run the certification workflow in an environment holding the required
   database credentials (sandbox cannot).
2. Confirm contract parity tests, harness PASS, and grant verifier PASS.
3. Record evidence in the register.

Exit: green workflow with dark launch intact.

## Wave 4 — Mortality and Survivors Processing

Shared death-event spine; certify together.

1. Command catalogue + policy area for mortality events.
2. RPC boundary for survivor entitlement determination.
3. Grant verifier + harness covering: death registered → award suspended →
   survivor entitlement created.

## Wave 5 — Overpayments and Recovery

1. Governance foundation (policy area, permissions, module row).
2. Command boundary for raise → schedule → recover → write-off.
3. Harness with finance and legal hand-off assertions.

## Wave 6 — Appeals

1. Appeal lifecycle state machine and RPC boundary.
2. Link to Determination and Legal referral surfaces.
3. Harness for lodge → hear → decide → implement.

## Wave 7 — Payments certification

1. Payment schedule and issue harness on clean database.
2. Post-issue review assertions, including suspension arrears interaction.

## Wave 8 — Core Claims, Eligibility, Determination, Awards

Close the mutation boundary module by module, then certify:
Claims → Eligibility/Calculation → Determination/Approval → Awards.

## Wave 9 — Means Tests

Assessment command catalogue, audit contract, harness.

## Wave 10 — Risk Management and Uprating

Contract-only today. Build the run/scoring engines, then certify last because
both depend on Calculation, Awards and Payments being certified first.

## Dependency order (condensed)

```
Configuration
  └─ Eligibility/Calculation
       └─ Determination/Approval
            └─ Awards
                 ├─ Payments ──────────── Overpayments
                 └─ Award Suspension (W1) ── Life Certificates (W2)
                                          └─ Medical Reviews (W3)
Mortality ── Survivors (W4)
Appeals (W6)   Means Tests (W9)   Risk / Uprating (W10)
```

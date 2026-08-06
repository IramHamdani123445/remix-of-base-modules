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

## Wave 2 — Life Certificates  ✅ certification complete

`BN_LC_GRANTS_RESULT: PASS` · `BN_LC_HARNESS_RESULT: PASS` on the regenerated
PG15 baseline. `classification = COMPLETE_AND_CERTIFIED`,
`activation = DARK_LAUNCHED`, `external_uat = DEFERRED`.
Canonical route `/bn/life-certificates`.

## Wave 3 — Medical Reviews  ✅ certification complete

`BN_MR_GRANTS_RESULT: PASS` · `BN_MR_HARNESS_RESULT: PASS` ·
`BN_MR_ADAPTER_RESULT: PASS`; legacy-table mutation boundary closed (RPC-only).
`classification = COMPLETE_AND_CERTIFIED`, `activation = DARK_LAUNCHED`,
`external_uat = DEFERRED`. Canonical routes `/bn/medical-reviews`,
`/bn/medical-reviews/board`, `/bn/medical-reviews/legacy-scheduler`.

## Wave 4 — Mortality (in progress; Survivors out of scope for this programme)

Death-event spine. Survivors is integrated **only** through the governed
handoff boundary — no Survivors implementation in this programme.

1. ✅ 26-command catalogue reconciled against real backend execution.
2. ✅ Governed entry point `bn_mortality_execute_command_v2`: dark-launch +
   permission gate, idempotent replay, maker-checker with self-approval
   prohibition, DMS evidence, governed handoffs, closure gate. v1 revoked
   from browser roles.
3. ✅ Shared `bn_cross_module_handoff` register (Overpayments, Survivors,
   Funeral Grant, Legal).
4. ⏳ Operational UI closure + Benefit 360 card.
5. ⏳ Grant verifier + seeded harness covering: death registered →
   provisional hold → verified → impact approved → award terminated →
   payment-after-death → Overpayment handoff → closure gate → rollback.

## Wave 5 — Overpayments and Recovery  ✅ certification complete

Independent GitHub certification: `bn-overpayment-integration.yml`
run `31116272752`, commit `3a8b893139f5101022e0924617fbd73548e72e54`,
conclusion `success`. `classification = COMPLETE_AND_CERTIFIED`,
`activation = DARK_LAUNCHED`, `external_uat = DEFERRED`,
`finance_legal_operations_readiness = PENDING`.


Canonical route `/bn/overpayments`. Matrix:
`docs/bn/BN_OVERPAYMENT_IMPLEMENTATION_MATRIX.md`.

`BN_OP_GRANT_RESULT=PASS` · `BN_OP_HARNESS_RESULT=PASS` (one marker, no SKIP) ·
dark-launch postflight `internal_pilot:false` · fixture residue 0 · 63/63 vitest.
B3–B15 all closed: governed domain model, 29-command catalogue, secured
versioned command boundary, granular permissions, grant verifier, finance
posting-intent outbox, appeal/mortality/legal boundaries, communication safety,
query boundary and UI conversion (`setOverpaymentRecoveryPlan` retired),
seeded harness, zero-residue gate and the PG15 GitHub workflow.
`classification = COMPLETE_AND_CERTIFIED`, `activation = DARK_LAUNCHED`,
`external_uat = DEFERRED`.

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

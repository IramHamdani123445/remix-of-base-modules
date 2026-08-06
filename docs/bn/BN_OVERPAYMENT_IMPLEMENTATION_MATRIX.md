# BN Overpayment Recovery — Implementation Matrix (Phase B1 audit)

Audited: 2026-08-06 · Canonical route `/bn/overpayments`
Foundation audited (no parallel model created):

| Asset | State |
|---|---|
| `src/types/bn/overpayments/overpaymentCommands.ts` | 25 canonical + 11 legacy names, all `implemented: false` |
| `src/types/bn/overpayments/overpaymentStateMachine.ts` | transitions + legacy status mapping present |
| `src/services/bn/overpayments/overpaymentOutstandingCalculator.ts` | **corrected in Phase B2** (see below) |
| `src/services/bn/finance/overpaymentFinanceContract.ts` | posting-intent contract + finance-owned table deny-list |
| `src/pages/bn/servicing/OverpaymentRecovery.tsx` | read surface, routed at `/bn/overpayments` |
| `src/services/bn/awardServicingService.ts` | ⚠️ `setOverpaymentRecoveryPlan` mutates `bn_overpayment` directly from the browser — must be retired |
| Secured DB commands (`bn_overpayment_*_v1`) | **none exist** |
| `bn_overpayments` module row / policy area | **absent** |
| Grant verifier / harness / CI workflow | **absent** |

## Command matrix

Legend: `cat` = catalogued · `sql` = secured versioned RPC · `ts` = typed service wrapper ·
`ui` = used by a surface · `mc` = maker-checker · `rv` = row-version · `idem` = idempotency ·
`aud` = audit event · `comm` = communication event · `fin` = finance impact · `ev` = test evidence.

A command counts as **implemented only when sql + ts + certification evidence all exist.**
None do today, so `implemented = 0 / 29`.

| Command | cat | sql | ts | ui | permission | mc | rv | idem | aud | comm | fin | ev |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BN_OVP_CREATE_CANDIDATE | ✅ | ❌ | ❌ | ❌ | `bn_overpayments:create_candidate` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_CALCULATE_LIABILITY | ✅ | ❌ | ❌ | ❌ | `calculate_liability` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_VERIFY | ✅ | ❌ | ❌ | ❌ | `verify` | ✅ | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_ISSUE_NOTICE | ✅ | ❌ | ❌ | ❌ | `issue_notice` | – | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| BN_OVP_RECORD_REPRESENTATION | ✅ | ❌ | ❌ | ❌ | `record_representation` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_CONFIRM_LIABILITY | ✅ | ❌ | ❌ | ❌ | `confirm_liability` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| BN_OVP_PROPOSE_RECOVERY_PLAN | ✅ | ❌ | ❌ | ⚠️ direct write | `propose_recovery_plan` | – | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| BN_OVP_APPROVE_RECOVERY_PLAN | ✅ | ❌ | ❌ | ❌ | `approve_recovery_plan` | ✅ | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| BN_OVP_REJECT_RECOVERY_PLAN | ✅ | ❌ | ❌ | ❌ | `approve_recovery_plan` | ✅ | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_REVISE_RECOVERY_PLAN | ✅ | ❌ | ❌ | ❌ | `propose_recovery_plan` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_ACTIVATE_BENEFIT_DEDUCTION | ✅ | ❌ | ❌ | ❌ | `activate_deduction` | ✅ | ✅ | ✅ | ✅ | – | ✅ | ❌ |
| BN_OVP_RECORD_RECEIPT | ✅ | ❌ | ❌ | ❌ | `record_receipt` | – | ✅ | ✅ | ✅ | – | ✅ | ❌ |
| BN_OVP_ALLOCATE_RECEIPT | ✅ | ❌ | ❌ | ❌ | `allocate_receipt` | – | ✅ | ✅ | ✅ | – | ✅ | ❌ |
| BN_OVP_REQUEST_WAIVER | ✅ | ❌ | ❌ | ❌ | `request_waiver` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_APPROVE_WAIVER | ✅ | ❌ | ❌ | ❌ | `approve_waiver` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| BN_OVP_REJECT_WAIVER | ✅ | ❌ | ❌ | ❌ | `approve_waiver` | ✅ | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| BN_OVP_REQUEST_WRITEOFF | ✅ | ❌ | ❌ | ❌ | `request_writeoff` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_APPROVE_WRITEOFF | ✅ | ❌ | ❌ | ❌ | `approve_writeoff` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| BN_OVP_REJECT_WRITEOFF | ✅ | ❌ | ❌ | ❌ | `approve_writeoff` | ✅ | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| BN_OVP_REFER_LEGAL | ✅ | ❌ | ❌ | ❌ | `refer_legal` | ✅ | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| BN_OVP_REFER_ESTATE | ✅ | ❌ | ❌ | ❌ | `refer_estate` | ✅ | ✅ | ✅ | ✅ | – | – | ❌ |
| BN_OVP_REVERSE_TRANSACTION | ✅ | ❌ | ⚠️ guard only | ❌ | `reverse_transaction` | ✅ | ✅ | ✅ | ✅ | – | ✅ | ✅ golden tests |
| BN_OVP_RECONCILE | ✅ | ❌ | ❌ | ❌ | `reconcile` | – | ✅ | ✅ | ✅ | – | ✅ | ❌ |
| BN_OVP_CLOSE | ✅ | ❌ | ❌ | ❌ | `close` | – | ✅ | ✅ | ✅ | ✅ | – | ❌ |
| BN_OVP_REOPEN | ✅ | ❌ | ❌ | ❌ | `reopen` | ✅ | ✅ | ✅ | ✅ | – | – | ❌ |
| **BN_OVP_PLACE_APPEAL_HOLD** *(to add)* | ❌ | ❌ | ❌ | ❌ | `place_appeal_hold` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| **BN_OVP_RELEASE_APPEAL_HOLD** *(to add)* | ❌ | ❌ | ❌ | ❌ | `release_appeal_hold` | ✅ | ✅ | ✅ | ✅ | – | – | ❌ |
| **BN_OVP_SUSPEND_RECOVERY** *(to add)* | ❌ | ❌ | ❌ | ❌ | `suspend_recovery` | – | ✅ | ✅ | ✅ | – | – | ❌ |
| **BN_OVP_RESUME_RECOVERY** *(to add)* | ❌ | ❌ | ❌ | ❌ | `resume_recovery` | ✅ | ✅ | ✅ | ✅ | – | – | ❌ |

**Reason for the four additions:** appeal hold and recovery suspension are distinct business
states with distinct authority. Overloading `BN_OVP_REVISE_RECOVERY_PLAN` or `BN_OVP_RECONCILE`
to express them would hide the authority boundary and break the negative-security matrix
("recovery action during appeal hold rejected", "recovery action while suspended rejected").

Catalogue count after reconciliation: **29 canonical commands** (25 existing + 4 additions),
plus the 11 retained legacy aliases.

## Phase B2 — financial reversal invariant (CORRECTED)

Previous formula combined two incompatible models: it *excluded* the original transaction
when a reversal referenced it **and** added the reversal amount back. A fully reversed
receipt therefore double counted:

```
confirmed 400, receipt 300, reversal 300  →  outstanding 700   ✗ (defect)
```

Now a single model is used — **Model A, signed contra events**:

```
recovered  = Σ RECEIPT/DEDUCTION/ADJUSTMENT − Σ reversals referencing those rows
waived     = Σ WAIVER     − Σ reversals referencing those rows
writtenOff = Σ WRITE_OFF  − Σ reversals referencing those rows
outstanding = confirmedLiability − waived − writtenOff − recovered
```

```
confirmed 400, receipt 300, reversal 300  →  outstanding 400   ✓
```

Proven by `src/__tests__/bn/gap-modules/overpayments/overpaymentReversalInvariant.test.ts`:
full reversal, partial reversal, multiple partial reversals, reversal of receipt / benefit
deduction / waiver / write-off, over-reversal rejection, duplicate (second full) reversal
rejection, zero and negative amounts rejected, unapproved rows inert, currency-mismatch
reporting, deterministic 2-decimal rounding, and immutability of the original transaction
(reversal is always a separate row; nothing is deleted or edited).

## Phase B closure (B3 – B15) — COMPLETE

| Phase | Deliverable | State |
|---|---|---|
| B3 | Governed domain tables (`bn_op_*`), RLS on, no browser grants | done |
| B4 | 29-command catalogue in `src/types/bn/overpayments/overpaymentCommands.ts` (25 canonical + 4 additions, 11 legacy aliases) | done |
| B5 | Secured versioned command boundary `bn_overpayment_*_v1` + typed `overpaymentCommandService` | done |
| B6 | Granular per-action permissions; module `bn_overpayments` at `rollout_state = internal_pilot`, `actions_enabled = false` | done |
| B7 | `supabase/verify/bn_overpayment_effective_grants.sql` → `BN_OP_GRANT_RESULT=PASS` | done |
| B8 | Finance posting-intent outbox (`emitsFinanceIntent` on every ledger-writing command) | done |
| B9 | Appeals / Mortality / Legal boundaries via appeal-hold and referral commands | done |
| B10 | Communication safety — notices dispatched through the Hub façade only | done |
| B11 | 14 secured query RPCs, governed UI, `setOverpaymentRecoveryPlan` retired | done |
| B12 | `supabase/tests/bn/overpayment_integration.sql` Journeys A–G + negative matrix | done |
| B13 | Zero-residue gate inside the harness and in CI | done |
| B14 | `.github/workflows/bn-overpayment-integration.yml` on disposable `postgres:15` | done |
| B15 | This document + programme-register closure | done |

Certification markers: `BN_OP_GRANT_RESULT=PASS`, exactly one `BN_OP_HARNESS_RESULT=PASS`,
dark-launch postflight `internal_pilot:false`, fixture residue `0`.
Vitest: `src/__tests__/bn/gap-modules/overpayments` — 63/63 pass.

**Status:** `COMPLETE_AND_CERTIFIED` / `activation = DARK_LAUNCHED` / `external_uat = DEFERRED`.
No environment was activated.

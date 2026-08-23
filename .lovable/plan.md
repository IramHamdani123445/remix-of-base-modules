# Payment Arrangements — Discovery and Implementation Plan

## What discovery found

Two arrangement models already exist in the database:

| Model | State | Covered liability | Installments | Allocation |
|---|---|---|---|---|
| `ce_payment_arrangements` (Compliance) | **Live** — 16 arrangements, 106 installments, 2 policies, breach + health view | **None** (only a single `total_debt` number) | `ce_installments` | via ledger `arrangement_id` / `installment_id` + `ce_payment_allocations` (0 rows) |
| `core_payment_arrangement` (Enterprise) | Empty (0 rows) — schema only | `core_payment_arrangement_item` (per liability, period, principal/penalty/cost, source module + record) | `core_payment_schedule_installment` | `core_payment_allocation` (arrangement → installment → item, ordered) |

Working RPCs already in place: `ce_reconcile_ledger_payment_to_arrangement`, `ce_recalculate_arrangement_summary`, `ce_evaluate_arrangement_breaches`, `ce_breach_check_arrangements`, `ce_allocate_employer_payment`, plus the four ledger read RPCs from the passbook work.

Crucially, `core_payment_arrangement.legacy_ce_arrangement_id` already exists — the enterprise model was designed to absorb the Compliance one. **No structural conflict**: the covered-liability, installment and allocation traceability the request asks for is fully expressible in the existing `core_payment_*` family. Nothing new competing needs to be created.

## Decision

Adopt `core_payment_arrangement` + `_item` + `core_payment_schedule_installment` + `core_payment_allocation` as the single canonical arrangement model. `ce_payment_arrangements` stays as the live Compliance operational surface, mirrored into the canonical tables through the existing `legacy_ce_arrangement_id` bridge — no second arrangement model is introduced, and no live Compliance data is dropped or renamed.

## Implementation

1. **Bridge migration (additive only)**
   - Backfill `core_payment_arrangement` from the 16 live `ce_payment_arrangements` rows (status, amounts, dates, approval), keyed by `legacy_ce_arrangement_id`; unique index on that column.
   - Backfill `core_payment_schedule_installment` from the 106 `ce_installments` rows, keeping `ce_installments.id` traceable.
   - Grants for `authenticated` / `service_role` on any table touched.
   - Immutability/consistency guard: item `outstanding_amount = arranged_amount - paid_amount` maintained server-side; allocation rows never updated in place.

2. **Covered-liability capture**
   - `core_arrangement_add_item(...)` RPC to attach a liability (violation / C3 period / penalty / legal action) to an arrangement, with period range and principal/penalty/cost split, validating that the sum of `arranged_amount` equals the arrangement's `total_arranged_amount`.
   - Rebuild of `total_debt` remains the Compliance-side display value; canonical truth is the item sum.

3. **Allocation traceability**
   - Extend the existing `ce_reconcile_ledger_payment_to_arrangement` path so every installment payment also writes `core_payment_allocation` rows (installment → item, oldest-liability-first, ordered), and rolls `paid_amount` / `outstanding_amount` up the item chain.
   - Ledger stays the money source of truth; allocations are attributions, never new balances.

4. **Read RPCs**
   - `core_arrangement_detail(p_arrangement_id)` — header, covered liabilities with paid/outstanding, schedule, allocation trail.
   - `core_arrangement_liability_coverage(p_employer_id)` — which liabilities are under arrangement vs open (feeds "amount under arrangement" already shown on the passbook KPI).

5. **UI**
   - New `ArrangementCoveragePanel` inside the existing Employer 360 arrangement area: covered liabilities table, schedule table, and per-installment allocation drill-down. No new top-level route, no parallel arrangement screen.

6. **Verification**
   - SQL regression tests: item-sum equals arranged total; allocation total never exceeds installment paid amount; reconciliation is idempotent on repeated ledger entry submission.
   - Reconcile the 16 backfilled arrangements and report zero variance.

## Not doing

- No new arrangement, installment or plan tables.
- No changes to `bema_*`, `lg_*` or `compliance_payment_plans` models.
- No rewrite of the breach engine or the ledger posting path.

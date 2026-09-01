# Fix Claim Queue access by deriving it from workbasket ownership

## Confirmed on live data

- 27 active workbaskets, 21 distinct `assigned_role` values.
- After the earlier BN_MANAGER grant, the verification query still returns **18 roles** with no `bn_claim_queue` access, including `BN_PAYMENT_OFFICER`, `BN_AWARD_OFFICER`, `BN_DIRECTOR`, `BN_FINANCE_SUPERVISOR`, the three legal roles, and the six roles that hold `bn_claim_worklist` only.
- `bn_claim_queue` is currently granted to Admin, BN_CLAIMS_OFFICER, BN_INTAKE_OFFICER, BN_MANAGER. `benefits_management` is granted to Admin alone. Your correction is accurate: the 9-role list belongs to `bn_claim_worklist`.

## Approach: derive, never enumerate

No role names appear anywhere in the fix. Everything is driven by the query `select distinct assigned_role from bn_workbasket where is_active`.

### 1. Reconciliation function (database)

`bn_sync_workbasket_queue_permissions()` — SECURITY DEFINER, admin-gated:

- For every active `bn_workbasket.assigned_role` that matches a row in `roles`, insert the missing `role_permissions` rows for module `bn_claim_queue`, action `view` (idempotent, `is_granted = true`, no-op when already present).
- Also covers `bn_claim_worklist` view, so basket owners can both list claims and open their own basket — this removes the six-role asymmetry.
- Returns the rows it created, and writes an audit entry through the existing audit infrastructure.
- Never revokes anything; grants only.

Run it once in the same migration to close today's 18-role gap.

### 2. Drift detection (database)

`bn_workbasket_permission_gaps()` — read-only, returns one row per active basket role lacking queue access:
`assigned_role`, `basket_code`, `basket_name`, `missing_module` (`bn_claim_queue` / `bn_claim_worklist`), `role_exists` (false flags a basket pointing at a role that does not exist at all).

Zero rows is the healthy state and is exactly your verification query, generalised.

### 3. Configuration check in the UI

On **Benefits → Configuration → Workbasket Configuration** (`src/pages/bn/config/WorkbasketConfig.tsx`), add a *Queue Access Health* panel:

- Green "All basket roles can open the Claim Queue" when the gap function is empty.
- Otherwise a table of gaps (role, basket, missing module) with a **Reconcile access** button for admins that calls the sync function and refetches.
- Mirror the same summary card on **Benefit Configuration Validation** so it is caught during config review.

New hook `useWorkbasketPermissionGaps` next to the existing workbasket hooks; no new tables, no new permission model.

### 4. Prevent silent recurrence

Add the gap check to the existing Benefits registry validation service (`bnRegistryValidationService.ts`) so a newly created workbasket with an ungranted role is reported as a configuration finding rather than becoming an invisible queue.

## Verification

- Your query returns 0 rows.
- `bn_workbasket_permission_gaps()` returns 0 rows.
- Sign-in as a payment-side role shows the Claim Queue menu and the post-approval baskets (APPROVED, AWARD_SETUP, PAYMENT_QUEUE, IN_PAYMENT) are reachable.
- Insert a test workbasket with an unmapped role → the health panel flags it; reconcile clears it.

## Notes

Grants are view-level only; create/edit/delete stay with the roles that already hold them, so no role gains authority beyond seeing its own basket.

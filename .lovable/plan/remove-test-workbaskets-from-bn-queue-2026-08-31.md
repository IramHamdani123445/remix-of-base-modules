# Remove test workbaskets from /bn/queue

## What I found (measured, live data)

Five test workbaskets are active in `bn_workbasket` and appear in the queue list:

| Basket | Code | Roles | Open claim assignments |
|---|---|---|---|
| Test | WB-0004 | BN_AWARD_OFFICER, BN_PRODUCT_APPROVER | **3 open (4 total)** |
| Test_007 | WB-0002 | BN_DOCUMENT_OFFICER (role row missing) | 0 |
| Test_007 (duplicate) | WB-00055 | BN_DOCUMENT_OFFICER (role row missing) | 0 |
| Test_008 | WB-0001 | BN_DOCUMENT_OFFICER | 0 |
| TESTTTT | WB-0003 | BN_DOCUMENT_OFFICER | 0 |

All other baskets are legitimate business baskets (Intake Review, Eligibility Review, Payment Approval, Legal baskets, etc.) — those stay untouched.

## Change

1. **Re-route the 3 open assignments in "Test" first.** Deactivating the basket alone would strand those claims (they would hold an active assignment to a basket nobody sees, and the "Not in any queue" panel only shows claims with *no* assignment). Each open assignment is closed (`completed_at` set, reason recorded) and the claim is re-routed through the existing `routeClaimToWorkbasket` service so it lands in its proper basket for its current status.
2. **Deactivate the five test baskets** — set `is_active = false` on WB-0001, WB-0002, WB-0003, WB-0004, WB-00055 via one SQL update. Deactivation, not deletion: queue history and audit trail stay intact, and the change is reversible.
3. Result: `/bn/queue` shows only the 28 real business baskets; the test entries disappear from both "My baskets" and "All baskets" (both lists already filter on active baskets).

## Not in scope

- No frontend changes — the screen already filters on active baskets.
- No changes to any other basket, role rows, or claims beyond the 3 re-routed assignments.

## Verification

- `bn_workbasket` query confirms the five test baskets are `is_active = false`.
- The 3 claims from "Test" each have a new active assignment in a real basket (report which basket each landed in).
- Reload `/bn/queue` as the admin: Test, Test_007 (x2), Test_008, TESTTTT no longer appear.

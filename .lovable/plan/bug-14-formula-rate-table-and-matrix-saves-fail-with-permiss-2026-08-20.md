# BUG-14 — Formula, rate table and matrix saves fail with "permission denied for function _bn_calc_in_boundary"

## Confirmed root cause

In `supabase/migrations/20260808171018_...sql`:

- `_bn_calc_guard_formula_version()` (line 560) and `_bn_calc_guard_rate_table_row()` (line 593) are declared **without** `SECURITY DEFINER`, so they execute with the *caller's* privileges.
- Their very first statement is `IF public._bn_calc_in_boundary() THEN ...`.
- Line 619 revokes EXECUTE on `_bn_calc_in_boundary()` from `PUBLIC, anon, authenticated`.

So every client write to `bn_formula_version` / `bn_rate_table_row` aborts at that first statement with `42501`, before any immutability rule is evaluated. Your reading is correct: the immutability rule has never actually executed — approved logic has been protected only by the permission error.

A second, quieter defect: the boundary signal is the GUC `bn.calc_boundary = 'on'`, and `set_config()` is executable by every role. Any authenticated user could have set that flag themselves and bypassed the guard entirely once the permission error was removed. Fixing only the privilege bug would leave that open, so the fix addresses both.

## Chosen approach and why

1. **Make the two guard trigger functions `SECURITY DEFINER` with a pinned `search_path`.**
   Trigger functions do not need EXECUTE to be granted to the writing role, so this restores the boundary check without touching any grant. `_bn_calc_in_boundary()` / `_bn_calc_boundary_enter()` stay revoked from `PUBLIC`, `anon`, `authenticated` exactly as today.

2. **Replace the forgeable `'on'` flag with an unforgeable per-transaction token.**
   - A new single-row internal table holds a boundary secret, with no grants to any client role.
   - `_bn_calc_boundary_enter()` becomes `SECURITY DEFINER` and sets `bn.calc_boundary` to `encode(hmac(txid::text, secret))`.
   - `_bn_calc_in_boundary()` becomes `SECURITY DEFINER` and returns true only when the GUC matches the recomputed token for the current transaction.
   - A client can still call `set_config` but cannot compute a valid token, and cannot read the secret. Boundary entry remains possible only from the three governed RPCs.

3. **No other behaviour changes.** The three RPCs (`bn_calc_config_save_formula_version_v1`, `bn_calc_config_save_rate_table_row_v1`, `bn_calc_config_delete_rate_table_row_v1`) keep their existing `authenticated` grants and their existing business checks; the UI already calls them.

Rejected alternatives: granting EXECUTE on the helpers (explicitly forbidden, and lets a user assert their own write is governed); removing the guards (weakens immutability); moving the check into the RPCs only (leaves direct table writes ungoverned).

## Front-end follow-up

Confirm the three save/delete paths actually route through the RPCs rather than PostgREST table writes:
- Formula Library → Edit Formula Version dialog
- Calculation Setup → Rate Tables row save/delete
- Calculation Setup → Matrix Tables row save/delete

Any path still issuing a direct `PATCH`/`POST` on `bn_formula_version` or `bn_rate_table_row` will now correctly hit the *business* immutability message for non-DRAFT rows, and will be repointed at the RPC where it is a legitimate DRAFT edit. Errors raised as `BN_CALC_IMMUTABLE_*` will be surfaced as the intended business message, not a raw SQL error.

## About the build-pipeline assertion you couldn't find

It does exist: `supabase/verify/bn_eligibility_calculation_effective_grants.sql`, sections 3 and 4 (lines 62–81) — section 3 fails if `anon` can execute any boundary or internal helper, section 4 fails if `authenticated` can execute `_bn_calc_in_boundary`, `_bn_calc_boundary_enter` or the other internal helpers. It runs in the GitHub Actions job `.github/workflows/bn-eligibility-calculation-integration.yml` ("Effective-grant verifier" step).

It was necessary but not sufficient — it never checked that the guards could actually *run*. The plan extends it with:
- an assertion that both guard trigger functions are `SECURITY DEFINER` with a pinned `search_path`;
- runtime assertions in `supabase/tests/bn/eligibility_calculation_integration.sql` that, as `authenticated`:
  - a DRAFT formula version saves via the RPC,
  - editing an ACTIVE version's expression/steps/output/rounding raises `BN_CALC_IMMUTABLE_FORMULA_VERSION` (not `42501`),
  - deleting a non-DRAFT version is refused with the business message,
  - DRAFT rate-table rows save and delete, non-DRAFT ones are refused with the business message,
  - a forged `set_config('bn.calc_boundary', ...)` does **not** bypass the guard,
  - direct calls to `_bn_calc_in_boundary()` and `_bn_calc_boundary_enter()` are still denied.

## Technical change list

| File | Change |
|---|---|
| new migration | boundary secret table (no client grants); `_bn_calc_boundary_enter()` / `_bn_calc_in_boundary()` → `SECURITY DEFINER`, token-based; `_bn_calc_guard_formula_version()` / `_bn_calc_guard_rate_table_row()` → `SECURITY DEFINER`; re-apply the existing `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on all four |
| `supabase/verify/bn_eligibility_calculation_effective_grants.sql` | add guard-function `SECURITY DEFINER` + pinned-search_path assertion; keep existing revoke assertions |
| `supabase/tests/bn/eligibility_calculation_integration.sql` | add the DRAFT-succeeds / non-DRAFT-refused / forged-token / helper-denied journeys |
| BN config UI + services | ensure formula version, rate-table row and matrix row saves/deletes call the governed RPCs and render `BN_CALC_IMMUTABLE_*` as business messages |

## Acceptance mapping

Every row of your acceptance table is covered by the runtime assertions above, executed as `authenticated` against a clean database in CI.

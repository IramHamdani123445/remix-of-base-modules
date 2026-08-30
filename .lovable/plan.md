# Role-aware Claim Queue: claims appear automatically for the logged-in role

## What I checked

- Routing itself now works: a claim moves basket-by-basket as its status changes
  (proved end-to-end last turn on BN-20260606-01469).
- Role data exists and is complete enough:
  - `v_bn_user_effective_roles` — 83 rows, 19 distinct `BN_*` roles, one user per role.
  - `bn_workbasket_role` — 43 rows; every active basket has at least one role row
    **except `Test_007`**, which has none (it still carries `assigned_role = BN_DOCUMENT_OFFICER`).
  - RPC `bn_workbaskets_for_user(p_user_id)` already returns the baskets a user can
    see via direct, bundle and delegated roles, wrapped by
    `fetchWorkbasketsForUser` / `useMyWorkbaskets`.

## The actual gap

`/bn/queue` (`ClaimQueue.tsx`) calls `useBnWorkbaskets()` — **every active basket, for
everyone** — and shows claims only after the user manually clicks a basket. So when
an Eligibility Officer logs in they see 32 baskets, no counts, and an empty right-hand
pane until they guess which one is theirs. Nothing is filtered by the logged-in role,
and nothing is selected automatically. `MyBenefitsWorkbench` already does the
role-scoped thing; the Claim Queue never adopted it.

## Change

### 1. Queue lists the user's baskets first
`ClaimQueue` switches from `useBnWorkbaskets()` to `useMyWorkbaskets()` (the existing
RPC). A "My baskets / All baskets" toggle stays available; **All baskets** is shown only
to users holding an oversight role (`BN_SUPERVISOR`, `BN_MANAGER`, `BN_DIRECTOR`,
`BN_CONFIG_ADMIN`), read from `useMyEffectiveRoles()`.

### 2. Auto-select on load
On first load select the user's primary basket (`is_primary`), or the first basket that
has claims when the primary is empty. The claim list renders immediately after login —
no clicking.

### 3. Live counts per basket
One grouped count query over `bn_claim_queue_assignment` (active, not completed) for the
visible basket ids, rendered as a badge on each basket button, with overdue items
highlighted. Without counts the user still can't tell where their work is.

### 4. Empty and no-role states
- User has roles but no basket carries them → "No workbasket is configured for your role
  (<roles>)", naming the roles, rather than an empty list.
- User's basket exists but holds nothing → "No claims currently in <basket>".

### 5. Basket-role hygiene
`Test_007` has no `bn_workbasket_role` row, so it is invisible to the RPC even though its
`assigned_role` is set. The basket-visibility helper falls back to `assigned_role` when a
basket has no role rows, so legacy baskets are not silently lost. No data migration.

## Not in scope

- No change to routing, status→step mapping, or the workbasket resolver.
- No new tables, no RLS or permission change — visibility only, on top of the existing RPC.
- The INSPECTOR / MEDICAL_BOARD basket gap stays a configuration decision.

## Technical detail

Files: `src/pages/bn/claims/ClaimQueue.tsx` (role-scoped list, auto-select, counts,
empty states), `src/hooks/bn/useBnWorkbasket.ts` (new `useBasketClaimCounts`),
`src/services/bn/workbasketRoleService.ts` (`assigned_role` fallback for
role-less baskets). Reused as-is: `useMyWorkbaskets`, `useMyEffectiveRoles`,
`bn_workbaskets_for_user`.

## Verification

- Log in as the `BN_ELIGIBILITY_OFFICER` user and confirm Eligibility Review is selected
  on load with its claim visible, and that no other role's baskets are listed.
- Repeat for `BN_INTAKE_OFFICER` and `BN_DOCUMENT_OFFICER`.
- Confirm a supervisor can still switch to All baskets.
- Unit tests for basket-count grouping and the oversight-role check; typecheck clean.

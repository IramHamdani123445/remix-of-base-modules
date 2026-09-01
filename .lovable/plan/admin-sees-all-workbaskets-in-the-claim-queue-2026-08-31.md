# Admin sees all workbaskets in the Claim Queue

## What's happening

`/bn/queue` decides who may look beyond their own baskets from a hardcoded list:

```
OVERSIGHT_ROLES = ['BN_SUPERVISOR', 'BN_MANAGER', 'BN_DIRECTOR', 'BN_CONFIG_ADMIN']
```

Your effective roles (Admin, Clerk, FinanceManager, IP Registration Officer,
LEGAL_ADMIN, Supervisor) contain none of those exact strings, so:

- the "All baskets" toggle is hidden,
- the scope stays on "My baskets",
- and because no `bn_workbasket_role` row carries any of your roles, the panel shows
  "No workbasket is configured for your roles (...)".

So this is a role-name matching gap in the queue screen, not missing basket data.

## Change (frontend only, `src/pages/bn/claims/ClaimQueue.tsx`)

1. **Recognise administrator and supervisor roles generically.** Replace the exact-match
   list with a case-insensitive check that treats a role as oversight when it is one of
   the existing `BN_*` roles *or* its name contains `ADMIN`, `SUPERVISOR`, `MANAGER`, or
   `DIRECTOR`. This covers `Admin`, `LEGAL_ADMIN`, `Supervisor`, `FinanceManager`.
2. **Default admins to "All baskets".** When the user holds an oversight role and has no
   baskets of their own, the queue opens on the All-baskets scope and auto-selects the
   first basket holding work — the admin immediately sees every basket and its claims.
   The "My baskets / All baskets" toggle remains, so an admin who also owns baskets can
   switch back.
3. **Clearer empty state.** For an oversight user with no personal baskets, the message
   becomes "You have no personal workbasket — showing all workbaskets." instead of the
   current "No workbasket is configured for your roles (...)".

Working on behalf of a role (pick/release claims in any basket) already works once the
basket is visible — picking uses the user code, not a role check.

## Not in scope

- No database, RLS, permission or `bn_workbasket_role` changes.
- No change to routing, counts, or the workbasket resolver.

## Verification

- Sign in with your admin account, open `/bn/queue`: All baskets is active, every active
  basket is listed with counts, first basket with work is selected.
- An officer account (e.g. `BN_ELIGIBILITY_OFFICER`) still sees only their own basket and
  no All-baskets toggle.

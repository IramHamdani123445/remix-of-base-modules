# Fix: "authenticated user_code is required" when saving a formula version

## What happens today

On `/bn/config/formulas`, the "Edit Formula Version" dialog reads the operator's
`user_code` from the in-memory auth profile only:

```ts
requireUserCode(profile?.user_code, 'save formula version')
```

If that profile object is not populated at the moment Save is clicked, the guard
throws and the toast shown is
`Cannot perform "save formula version" — authenticated user_code is required for BN audit.`

Checked against the live backend:

- All 51 `profiles` rows have a non-empty `user_code` (including the account used
  for testing), so this is not missing data.
- `authenticated` holds SELECT on `profiles`, `user_roles` and
  `bn_formula_version`, and none of them have row security enabled, so it is not
  a grant/RLS block.

That leaves the client-side identity read as the failing link — the dialog depends
on a single in-memory value that can be null (initial load race, a profile fetch
that failed earlier in the session, or a token refresh while the dialog is open).
The exact trigger is not yet confirmed, so step 1 below confirms it before the fix
is declared done.

Other BN screens already avoid this by resolving the code asynchronously from the
session (`getCurrentUserCode()`), e.g. `FundingSourceAccountManager`.

## Plan

1. **Confirm the trigger.** Reproduce the save on `/bn/config/formulas` in the
   browser while logged in, and inspect whether the auth profile is null and
   whether the profile fetch logged an error. This tells us whether the profile
   fetch is failing outright (needs a retry fix too) or is just transiently unset.

2. **Make identity resolution resilient in the formula version editor.**
   In `src/components/bn/config/FormulaVersionEditor.tsx`, replace the direct
   `profile?.user_code` read with: use the profile value when present, otherwise
   fall back to the canonical async resolver
   `getCurrentUserCode()` (`src/services/bn/audit/getCurrentUserCode.ts`, which
   reads the session and the `profiles` row and caches per user id). Only throw
   `MissingUserCodeError` when both are empty — the audit guard stays intact, no
   "SYSTEM" fallback is introduced.

3. **Apply the same fix to the sibling BN config editors on the same route family**,
   which share the identical fragile pattern:
   - `src/components/bn/config/RateTableHeaderForm.tsx`
   - `src/pages/bn/config/RateTableEditor.tsx`
   - `src/pages/bn/config/BindingEditor.tsx`

4. **Add a small shared helper** (e.g. `resolveBnUserCode(profileUserCode, action)`
   next to `requireUserCode`) so the four call sites use one implementation, and
   cover it with unit tests: profile present, profile missing but session resolves,
   both missing (throws), forbidden values still rejected.

5. **Verify.** Run the BN unit tests, then re-run the save on a DRAFT formula
   version in the browser and confirm the row updates with a real `modified_by`.

## Technical notes

- No database migration and no RLS/grant change is needed — those were checked and
  are correct.
- `requireUserCode`'s forbidden-value list (`SYSTEM`, `CURRENT_USER`, `ANONYMOUS`,
  `UNKNOWN`) and the fail-loud behaviour are preserved; the change only widens
  where a legitimate `user_code` can be read from.
- Save remains blocked for non-DRAFT versions (existing read-only rule unchanged).

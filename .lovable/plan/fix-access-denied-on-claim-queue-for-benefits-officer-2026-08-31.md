# Fix "Access Denied" on Claim Queue for Benefits Officer

## What is happening (verified)

`benefits.officer@mishainfotech.com` holds the five BN officer roles
(`BN_INTAKE_OFFICER`, `BN_DOCUMENT_OFFICER`, `BN_ELIGIBILITY_OFFICER`,
`BN_CALCULATION_OFFICER`, `BN_CLAIMS_OFFICER`) and has 23 granted permissions,
including `bn_claim_queue: view/create/edit/delete`.

The Claim Queue screen guards itself with a different module name:

```
ClaimQueue.tsx  ->  <PermissionWrapper moduleName="benefits_management">
```

The officer has **zero** permissions on `benefits_management`, so the wrapper
renders Access Denied even though the canonical module for `/bn/queue` —
`bn_claim_queue` — is granted.

Same class of defect found on neighbouring screens:

| Screen | Guard used | Exists in app_modules | Officer granted |
|---|---|---|---|
| `/bn/queue` ClaimQueue | `benefits_management` | yes (no route) | no |
| `/bn/claims` ClaimWorklist / Enhanced | `bn_claims` | **no such module** | n/a |
| `/bn/intake/register` ClaimRegistration | `bn_claims` | **no such module** | n/a |
| `/bn/workbench` MyBenefitsWorkbench | `benefits_management` | yes | no |

A guard naming a non-existent module can never resolve a grant, so those pages
deny every non-admin user too.

## Change (frontend only)

Point each screen's `PermissionWrapper` at the module registered for its own
route:

1. `src/pages/bn/claims/ClaimQueue.tsx` → `bn_claim_queue`
2. `src/pages/bn/claims/ClaimWorklist.tsx` and `ClaimWorklistEnhanced.tsx` → `bn_claim_worklist`
3. `src/pages/bn/intake/ClaimRegistration.tsx` → `bn_register_claim`
4. `src/pages/bn/workbench/MyBenefitsWorkbench.tsx` → `bn_claim_worklist`
   (the officer-facing worklist module; no separate workbench module exists)

No database, RLS, role or permission-grant change. Admin users are unaffected
(the wrapper already short-circuits for admins). Screens that legitimately are
Benefits-administration surfaces (config, reason codes, transition matrix,
delegations, role bundles, workbasket config) keep `benefits_management`.

## Verification

- Sign in as `benefits.officer@mishainfotech.com`, open `/bn/queue`: the queue
  renders with the officer's seven baskets and live counts, no Access Denied.
- Same account: `/bn/claims`, `/bn/intake/register`, `/bn/workbench` all render.
- Sign in as an account without `bn_claim_queue` view: still Access Denied.
- Admin (`benefits.admin@`) keeps the All-baskets oversight view.

## Not in scope

- No change to workbasket routing, counts or the oversight-role logic.
- The wider permission-registry reconciliation (guards across all BN config
  screens) is noted but left alone.

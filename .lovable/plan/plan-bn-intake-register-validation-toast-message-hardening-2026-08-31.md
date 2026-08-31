# Plan — /bn/intake/register Validation & Toast Message Hardening

Audit result: most of the screen already follows the dynamic shadcn/sonner pattern (central field registry, inline destructive errors, `showBlockerToast` for step refusals, dynamic success/routing toasts). Four real gaps remain; this plan closes only those.

## Changes — all in `src/pages/bn/intake/ClaimRegistration.tsx`

1. **Render orphan submit errors inline**
   `fieldErrors.product` ("Select a benefit") and `fieldErrors.version` ("No active product version resolved") are collected on submit but never displayed on the screen — they only appear inside a toast. Add inline rendering: a destructive `Alert` at the top of the Review & Submit step listing all current `errors`, so the officer sees exactly what is missing where they stand.

2. **Navigate to the offending step on submit validation failure**
   When submit validation fails, jump the wizard back to the first step that owns a failing field (ssn → step 1, product → step 3, version → step 5, contact fields → Internal Options) in addition to the existing summary toast, so the error is visible in context rather than only in a disappearing toast.

3. **Friendly submit-failure toast**
   Replace raw `toast.error('Failed to register claim', { description: e?.message })` with a guarded message: use `showBlockerToast`-style splitting so multi-line server messages stay readable, and keep a generic fallback when the error carries no usable message. No secrets/technical dumps in the title.

4. **Success toast next-step guidance**
   Add a short description to the `Claim X registered` success toast (e.g. "Opened the claim — routing status shown below."), keeping all existing dynamic routing/eligibility toasts unchanged.

## Out of scope
- No changes to `fieldValidationRegistry`, `showBlockerToast`, eligibility wording, audit calls, or the intake mutation payload.
- No backend changes.

## Verification
- Typecheck + build via harness.
- Playwright pass on `/bn/intake/register`: submit with empty form shows inline review alert + navigates to the failing step; invalid phone/email show inline registry messages; success path shows claim number toast.

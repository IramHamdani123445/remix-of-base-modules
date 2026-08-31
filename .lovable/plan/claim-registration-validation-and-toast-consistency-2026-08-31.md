# Claim Registration — Validation and Toast Consistency

Screen: Benefit Management → Claim Registration (`/bn/intake/register`).

## What the review found

Toast messages are already dynamic (claim number, workbasket name, routing summary, database error text) and use the standard `sonner` variants, so the messaging behaviour is broadly correct. Three gaps remain:

1. **Field errors are stored but never shown.** The screen keeps an `errors` map and writes `SSN is required` into it on lookup, but no field renders it. The officer sees nothing happen when SSN is blank.
2. **Contact Phone and Contact Email are unvalidated.** They are plain inputs with no format check and no max length, while the project has a central validation framework (`validateField` with `ip.contact_phone` / `ip.contact_email` rules) that every other form uses.
3. **Submit-time toasts are used for field problems.** Missing benefit, missing version and missing SSN are raised as bare error toasts with terse text (`Select a benefit.`, `SSN is required.`) instead of inline field errors plus a single summary toast, which is the pattern used elsewhere in the app.

## Changes

- Render the stored SSN error inline under the SSN input using the standard style (`border-destructive` on the input, `text-xs text-destructive mt-1` below it).
- Wire Contact Phone and Contact Email to the central registry: validate on change and on submit via `validateField('ip.contact_phone', …)` and `validateField('ip.contact_email', …)`, apply the registry max lengths, and render inline errors in the same style.
- On submit, collect all field problems into the `errors` map, render them inline, and show one summary toast (`Please check the form for valid information!`) rather than several one-line error toasts. Genuine backend failures keep their existing dedicated toast with the server description.
- Keep the existing dynamic success/routing/eligibility toasts unchanged — those are correct.

## Technical notes

- Single file: `src/pages/bn/intake/ClaimRegistration.tsx`. Presentation and validation only; no change to the intake mutation, routing, eligibility or audit logic.
- Reuses `src/lib/fieldValidationRegistry.ts`; no new validation helpers and no new rule keys unless a contact field limit is missing, in which case the existing `IP_MASTER_FIELDS` entry is used as-is.

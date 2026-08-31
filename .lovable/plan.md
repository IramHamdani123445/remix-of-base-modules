# Make Account Number Mandatory at Claim Registration

Screen: Benefit Management → Claim Registration (`/bn/intake/register`) → Step 9 "Banking / Payment".

## Current behaviour

The payment form only checks the account number when the officer presses "Save payment details", and it does so with a single combined toast ("Please select bank, branch and complete account number and holder name"). There is no required marker, no inline error under the field, and the wizard's Next button on the banking step does not require an account number — it only blocks when the product policy says payment details are required at application and no profile exists at all.

## Changes

1. **Mark the field required** — add the `*` required marker on Bank, Branch, Account number and Account holder name labels when the method is EFT, so the officer sees it before typing.
2. **Inline validation on the account number** — validate on blur/change and on save: empty (with no existing saved account) shows `Account number is required` under the input with the standard destructive style (`border-destructive` on the input, `text-xs text-destructive mt-1` below). Keep digits-only/length enforcement consistent with the existing masking behaviour.
3. **Save gate** — replace the single combined toast with per-field inline errors plus one summary toast ("Please check the payment details for valid information!"), so the officer is told exactly which field is missing.
4. **Wizard gate on step 9** — when the resolved method is EFT and payment details are not hidden by product policy, block "Next" until an account number exists (either freshly entered and saved, or already present on the active profile), with the existing blocker-toast wording pattern used elsewhere in the wizard.

## Scope notes

- Files: `src/components/bn/payment/PaymentDetailsSection.tsx` (field-level requirement and inline errors) and `src/pages/bn/intake/ClaimRegistration.tsx` (step-9 Next gate only).
- Presentation and validation only — no change to `paymentProfileService`, the payment policy resolution, the intake mutation, or audit logging.
- Non-EFT methods (Cheque, etc.) are unaffected; their existing rules stay as-is.

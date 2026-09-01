# Fix: "Send to Payment" disabled for the Payments officer

## What is happening (verified)

The "Send to Payment" button comes from the claim transition rule engine, not from a menu permission.

- The rule (`AWARD_SETUP → PAYMENT_QUEUE`, label "Send to Payment") allows exactly these roles: `bn_officer`, `bn_supervisor`, `Admin`.
- `benefits.payment@mishainfotech.com` holds one role: `BN_PAYMENT_OFFICER`.
- The engine compares role strings exactly (`userRoles.includes(r)`), with an `Admin` bypass. So the admin account passes and the payments officer falls into "Insufficient role permissions" — the button renders disabled with that tooltip.

This is a vocabulary mismatch, not a one-off. Every active transition rule uses the legacy lowercase set `bn_clerk, bn_officer, bn_supervisor, bn_manager, bn_finance, Admin`, while the actual assigned roles are the canonical uppercase set (`BN_CLAIMS_OFFICER`, `BN_SUPERVISOR`, `BN_MANAGER`, `BN_PAYMENT_OFFICER`, `BN_FINANCE_SUPERVISOR`, …). Today only Admin can act on any claim transition; the same defect also blocks "Begin Payment" (`PAYMENT_QUEUE → IN_PAYMENT`, allows `bn_finance`).

## Proposed fix

1. **Canonical role mapping (data)** — migration that rewrites `allowed_roles` on every active `bn_claim_transition_rule` from the legacy tokens to the canonical role names actually issued to users:
   - `bn_clerk` → `BN_INTAKE_OFFICER`, `BN_DOCUMENT_OFFICER`
   - `bn_officer` → `BN_CLAIMS_OFFICER`, `BN_ELIGIBILITY_OFFICER`, `BN_AWARD_OFFICER`
   - `bn_supervisor` → `BN_SUPERVISOR`, `BN_SENIOR_ELIGIBILITY_OFFICER`
   - `bn_manager` → `BN_MANAGER`, `BN_DIRECTOR`
   - `bn_finance` → `BN_PAYMENT_OFFICER`, `BN_FINANCE_SUPERVISOR`
   - `Admin` retained.
   The payment-facing rules ("Send to Payment", "Begin Payment") additionally get `BN_PAYMENT_OFFICER` explicitly, which is the behaviour you asked for.

2. **Case-insensitive, alias-tolerant matching (code)** — in `getAvailableTransitions` (`src/services/bn/decisionEngine.ts`), compare roles case-insensitively and resolve legacy aliases through a single shared map, so any rule still carrying old tokens keeps working and no future rule silently locks everyone out except Admin.

3. **Clearer denial message** — when a rule is blocked purely on roles, show which roles are permitted in the tooltip instead of the generic "Insufficient role permissions".

4. **Server-side parity check** — `executeTransition` currently trusts the client-side role gate. Add the same role validation on execution so hiding/enabling the button is not the only control.

## Confirm before I build

Send to Payment should be actionable by: Payments officer + Supervisor + Admin (my assumption), or a different set?

## Technical notes

- Files: `src/services/bn/decisionEngine.ts`, `src/components/bn/claim/ClaimDecisionPanel.tsx`, one migration against `bn_claim_transition_rule`.
- No change to `NextStepGuidance` (its buttons gate on user code, not roles).
- Role source stays `user_roles` via `SupabaseAuthContext`; no new role storage.

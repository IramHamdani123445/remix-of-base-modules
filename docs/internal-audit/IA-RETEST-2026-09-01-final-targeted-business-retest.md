# Internal Audit — Final Targeted Business Retest (post DEFECT-IA-RETEST-001 fix)

Date: 2026-09-01
Scope: Re-run of the targeted business retest after the corrective fix to
`public.ia_sensitive_capability_policy()`.
Mode: read-only verification (no new development, no business data mutated).

## 1. Security closure verifier — PASSED

`supabase/verify/ia_business_convergence_security_closure.sql` now completes and emits
`ia_business_convergence_security_closure: PASSED`.

Evidence:
- `ia_sensitive_capability_policy` ACL = `service_role=X/postgres` only.
  Direct execution as `authenticated` → `42501 permission denied`.
- `ia_prior_action_reference` is not client-readable. Direct `SELECT` as `authenticated`
  → `42501 permission denied for table ia_prior_action_reference`.
- `ia_annual_plan_portfolio_summary`, `ia_annual_plan_coverage`,
  `ia_annual_plan_version_diff` are capability-gated on `ia_can_view_annual_plan`
  and delegate to their private `*_core` helpers.
- `ia_permission_reconciliation` classifies OVER-BROAD from the policy catalogue.

## 2. Permission reconciliation (as IA Admin)

25 sensitive capabilities evaluated:

| Result | Count |
|---|---|
| PASS | 19 |
| MISSING (registry gap) | 4 |
| MISMATCHED (registry disabled) | 2 |
| **OVER-BROAD** | **0** |

No over-broad grants exist — the security objective of the closure is met.

Registry observations (LOW, not security defects — no grants are wider than policy):
- `action_tracking.verify` — MISSING_ACTION in the module registry.
- `audit_risk_assessment.create|edit|approve` — MISSING_MODULE in the registry.
- `quality_review.create|approve` — registry entry DISABLED while grants exist for
  `Admin`, `IA_HEAD_OF_INTERNAL_AUDIT`, `IA_QUALITY_REVIEWER` (all expected roles;
  no unexpected roles).

## 3. Portfolio read-model access proof

| Persona | `ia_can_view_annual_plan` | Portfolio / Coverage / Version-diff |
|---|---|---|
| IA Admin (`62c928c3…`) | true | data objects returned |
| Non-IA user (`johngrow@yopmail.com`) | false | `{"success": false, "code": "IA_FORBIDDEN"}` for all three |

Fail-closed behaviour confirmed: unauthorised callers receive a governed refusal
envelope, never audit data.

## 4. Business estate integrity (live counts)

| Area | Value |
|---|---|
| IA roles | 6 |
| Annual plans | Draft=6, Approved=4, Closed=2 |
| Editable working-copy statuses | Draft, Rejected, Changes Requested, Amendment Pending |
| Audit engagements | 61 |
| Findings | 22 |
| Management responses | 23 |
| Action tracking records | 19 |
| Follow-ups | 6 |
| Audit reports | 11 |
| Plan versions | 4 |
| Plan carry-forward rows | 18 |
| Access-matrix users evaluated | 21 |

Annual-plan lifecycle, prior-audit continuity (carry-forward), corrective-action
continuity, follow-up governance and user/access management all report populated,
consistent state.

## 5. Regression gates

- TypeScript typecheck: PASS (0 errors).
- Production build: PASS.
- Unit/integration suite: 6874 passed, 31 failed, all failures confined to
  Communication-Hub P3 runtime harnesses (`src/platform/communication-hub/__tests__/…`,
  `src/__tests__/comm-hub/…`). No Internal Audit test failed. These are pre-existing
  and outside this retest's scope.

## Verdict

**Internal Audit targeted business retest: PASSED.**
DEFECT-IA-RETEST-001 is closed. No new defects raised. Two low-severity registry
completeness observations recorded above for the next configuration housekeeping pass.

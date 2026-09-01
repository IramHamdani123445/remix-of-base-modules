# DEFECT IA-RETEST-001 — Security Closure Verifier FAILS at gate 1

Status: OPEN — recorded, NOT fixed (retest halted for review per instruction)
Raised: 2026-09-01
Severity: HIGH (acceptance gate blocker; low direct data-exposure risk)
Scope: Internal Audit — Business Convergence Security Closure

## Context

- Repository: miplnoida/remix-of-base-modules
- Current HEAD: 546ae18f560bc6736d4d53dfa97434b2d13c24b4
- Referenced security closure commit: e51ee1d342b1c1f211b55392b1cf7a82d80db888
- Verifier: `supabase/verify/ia_business_convergence_security_closure.sql`

## Exact verifier result

```
psql:supabase/verify/ia_business_convergence_security_closure.sql:59: ERROR:
  private helper ia_sensitive_capability_policy is client-executable:
  postgres=X/postgres authenticated=X/postgres service_role=X/postgres
  sandbox_exec_xynceskeiiisiefqlgxo=X/postgres
CONTEXT: PL/pgSQL function inline_code_block line 41 at RAISE
```

Result: **FAILED** (`ia_business_convergence_security_closure: PASSED` was NOT emitted).

Gates that did pass before the failure point:
- `ia_prior_action_reference` is NOT directly reachable by `anon`/`authenticated`.
- `ia_annual_plan_portfolio_summary`, `ia_annual_plan_coverage`,
  `ia_annual_plan_version_diff` are all gated on `ia_can_view_annual_plan` and
  delegate to their `_core` helpers.

## Root cause

Two authored artefacts contradict each other:

- Migration `supabase/migrations/20260901092657_c776373d-16d9-4e83-8bf9-5852eb789153.sql`
  lines 134-135 deliberately grants execute:
  ```sql
  REVOKE ALL ON FUNCTION public.ia_sensitive_capability_policy() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.ia_sensitive_capability_policy() TO authenticated, service_role;
  ```
- The verifier classifies `ia_sensitive_capability_policy` in the same private-helper
  set as the `*_core` portfolio helpers and therefore requires that NO `authenticated`
  grant exists.

The function returns a static policy catalogue (module name, action name, intended
roles). It exposes no audit business data, so the practical exposure risk is low; the
defect is a governance/contract mismatch that blocks the acceptance gate.

## Candidate resolutions (NOT applied — awaiting review)

1. Revoke `EXECUTE ... FROM authenticated` (keep `service_role` only) and confirm no
   client path calls it directly — `ia_permission_reconciliation` is SECURITY DEFINER
   so it would continue to work.
2. Amend the verifier to treat `ia_sensitive_capability_policy` as an intentionally
   `authenticated`-readable reference policy and keep the strict private-helper check
   for the three `*_core` helpers only.

Option 1 is the conservative closure-preserving choice; option 2 changes the accepted
security contract and would need explicit sign-off.

## Retest status

Sections 2–13 of the targeted business retest were NOT executed. Instruction
"If a genuine defect is found: record it first and STOP for review before fixing"
applies, and section 1 is a hard prerequisite for the remaining acceptance sections.

/**
 * Benefits role vocabulary bridge.
 *
 * Claim transition rules were originally authored with a lowercase legacy
 * role vocabulary (`bn_officer`, `bn_finance`, …) while the roles actually
 * issued in `user_roles` are the canonical uppercase names
 * (`BN_CLAIMS_OFFICER`, `BN_PAYMENT_OFFICER`, …). Comparing the two with a
 * plain `includes()` locked every non-Admin account out of every action.
 *
 * The data has been remapped, but rules may still be authored (or imported)
 * with legacy tokens, so matching resolves aliases here as well. This module
 * is the single source of truth for that mapping.
 */

/** Legacy rule token → canonical roles that satisfy it. */
export const BN_LEGACY_ROLE_ALIASES: Record<string, string[]> = {
  bn_clerk: ['BN_INTAKE_OFFICER', 'BN_DOCUMENT_OFFICER'],
  bn_officer: ['BN_CLAIMS_OFFICER', 'BN_ELIGIBILITY_OFFICER', 'BN_AWARD_OFFICER'],
  bn_supervisor: ['BN_SUPERVISOR', 'BN_SENIOR_ELIGIBILITY_OFFICER'],
  bn_manager: ['BN_MANAGER', 'BN_DIRECTOR'],
  bn_finance: ['BN_PAYMENT_OFFICER', 'BN_FINANCE_SUPERVISOR'],
};

const norm = (value: string) => value.trim().toLowerCase();

/** True when the user holds an Admin-equivalent role. */
export function isBnAdminRole(userRoles: readonly string[]): boolean {
  return userRoles.some((r) => norm(r) === 'admin');
}

/**
 * Expand a rule's `allowed_roles` into the canonical role set that grants it,
 * resolving legacy aliases. Comparison is case-insensitive.
 */
export function expandAllowedRoles(allowedRoles: readonly string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const token of allowedRoles ?? []) {
    const alias = BN_LEGACY_ROLE_ALIASES[norm(token)];
    if (alias) alias.forEach((a) => out.add(a));
    else out.add(token);
  }
  return Array.from(out);
}

/** Case-insensitive, alias-tolerant role check with an Admin bypass. */
export function userHoldsAllowedRole(
  userRoles: readonly string[],
  allowedRoles: readonly string[] | null | undefined,
): boolean {
  if (isBnAdminRole(userRoles)) return true;
  const held = new Set(userRoles.map(norm));
  return expandAllowedRoles(allowedRoles).some((r) => held.has(norm(r)));
}

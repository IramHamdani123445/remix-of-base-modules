/**
 * Omni-Comms — canonical presentation scope model (pure, no I/O).
 *
 * This is the browser-side mirror of the database functions
 * `omni_comms_priv_scope_level` / `omni_comms_priv_scope_rank` and of the
 * candidate-matching rule inside `omni_comms_resolve_presentation`.
 *
 * The DATABASE remains authoritative at runtime. This module exists so the
 * administrator surfaces (Branding & Layouts → Defaults & Overrides) can
 * explain a resolution and so the inheritance contract is unit-testable.
 *
 * Specificity (most specific wins):
 *   department × module × event
 *   module × event
 *   department × module
 *   department            (legacy, module-agnostic)
 *   module
 *   organisation
 */

export const PRESENTATION_SCOPE_LEVELS = [
  'department_module_event',
  'module_event',
  'department_module',
  'department',
  'module',
  'organization',
] as const;

export type PresentationScopeLevel = (typeof PRESENTATION_SCOPE_LEVELS)[number];

/** Resolution source for a single resolved property. */
export type PresentationSource = PresentationScopeLevel | 'pinned' | 'unresolved';

export interface PresentationScopeKeys {
  moduleCode?: string | null;
  departmentId?: string | null;
  eventCode?: string | null;
}

export interface PresentationContext extends PresentationScopeKeys {
  organizationId: string;
  outputChannel: string;
  locale?: string | null;
}

export interface PresentationCandidate<TValue = string> extends PresentationScopeKeys {
  /** Property this candidate configures: `layout` or an asset slot code. */
  property: string;
  value: TValue;
  /** Tie-break within a scope level: most recently updated wins. */
  updatedAt?: string | null;
}

export interface ResolvedProperty<TValue = string> {
  property: string;
  value: TValue | null;
  source: PresentationSource;
  /** The candidate that won, when one did. */
  candidate: PresentationCandidate<TValue> | null;
}

const RANKS: Record<PresentationScopeLevel, number> = {
  department_module_event: 60,
  module_event: 50,
  department_module: 40,
  department: 30,
  module: 20,
  organization: 10,
};

export function scopeLevel(keys: PresentationScopeKeys): PresentationScopeLevel {
  const hasModule = !!keys.moduleCode;
  const hasDept = !!keys.departmentId;
  const hasEvent = !!keys.eventCode;
  if (hasEvent && hasDept) return 'department_module_event';
  if (hasEvent) return 'module_event';
  if (hasDept && hasModule) return 'department_module';
  if (hasDept) return 'department';
  if (hasModule) return 'module';
  return 'organization';
}

export function scopeRank(keys: PresentationScopeKeys): number {
  return RANKS[scopeLevel(keys)];
}

/** Human label used by the administrator surfaces. */
export function scopeLabel(level: PresentationSource): string {
  switch (level) {
    case 'department_module_event':
      return 'Department × Module × Event';
    case 'module_event':
      return 'Module × Event';
    case 'department_module':
      return 'Department × Module';
    case 'department':
      return 'Department';
    case 'module':
      return 'Module';
    case 'organization':
      return 'Organisation';
    case 'pinned':
      return 'Governed pin';
    default:
      return 'Not configured';
  }
}

/**
 * A candidate applies when every scope key it declares is satisfied by the
 * request context. Keys are additive filters — never OR'd. A Claims×Benefits
 * override therefore can never apply to a Legal communication.
 */
export function candidateApplies(
  candidate: PresentationScopeKeys,
  ctx: PresentationScopeKeys,
): boolean {
  if (candidate.moduleCode && candidate.moduleCode !== ctx.moduleCode) return false;
  if (candidate.departmentId && candidate.departmentId !== ctx.departmentId) return false;
  if (candidate.eventCode && candidate.eventCode !== ctx.eventCode) return false;
  return true;
}

/** Resolve one property (layout or a single asset slot) independently. */
export function resolveProperty<TValue = string>(
  property: string,
  candidates: readonly PresentationCandidate<TValue>[],
  ctx: PresentationScopeKeys,
  options: { pinnedValue?: TValue | null } = {},
): ResolvedProperty<TValue> {
  if (options.pinnedValue != null) {
    return { property, value: options.pinnedValue, source: 'pinned', candidate: null };
  }
  const applicable = candidates
    .filter((c) => c.property === property && candidateApplies(c, ctx))
    .sort((a, b) => {
      const byRank = scopeRank(b) - scopeRank(a);
      if (byRank !== 0) return byRank;
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    });
  const winner = applicable[0];
  return winner
    ? { property, value: winner.value, source: scopeLevel(winner), candidate: winner }
    : { property, value: null, source: 'unresolved', candidate: null };
}

/**
 * Resolve every requested property independently — per-property inheritance.
 * Each property may legitimately win at a different scope level.
 */
export function resolvePresentation<TValue = string>(
  properties: readonly string[],
  candidates: readonly PresentationCandidate<TValue>[],
  ctx: PresentationScopeKeys,
  pinned: Readonly<Record<string, TValue | null | undefined>> = {},
): ResolvedProperty<TValue>[] {
  return properties.map((p) =>
    resolveProperty(p, candidates, ctx, { pinnedValue: pinned[p] ?? null }),
  );
}

/** Scope combinations the database accepts. Events always belong to a module. */
export function isValidScopeCombination(keys: PresentationScopeKeys): boolean {
  if (keys.eventCode && !keys.moduleCode) return false;
  return true;
}

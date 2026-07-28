/**
 * Omni-Comms — Architecture baseline.
 *
 * Precise, source-controlled record of pre-existing repository violations
 * OUTSIDE the new system. Baselining is evidence of technical debt, not
 * approval. Every entry must have an exact path, exact rule id, exact
 * evidence and a reason. No wildcards. No new-system paths.
 *
 * Story 4 initial state: empty. Repository scan found no provider SDK
 * imports, no `omni_comms_*` migrations, and Rules 1/2/4 are scoped to the
 * new system which is clean.
 */
import type {
  ArchitectureBaselineEntry,
  ArchitectureRuleId,
} from './architectureCheck.types';
import { NEW_SYSTEM_ROOTS } from './architecturePolicy';

export const OMNI_COMMS_ARCHITECTURE_BASELINE: readonly ArchitectureBaselineEntry[] = [];

const VALID_RULE_IDS: ReadonlySet<ArchitectureRuleId> = new Set<ArchitectureRuleId>([
  'OMNI_LEGACY_IMPORT',
  'OMNI_LEGACY_TABLE_REFERENCE',
  'OMNI_PROVIDER_IMPORT_BOUNDARY',
  'OMNI_REACT_RUNTIME_WRITE',
  'OMNI_MIGRATION_OBJECT_REGISTRY',
  'OMNI_ROUTE_REGISTRY',
  'OMNI_INTEGRATION_REGISTRY',
  'OMNI_QUEUE_REGISTRY',
  'OMNI_SEND_FACADE_BOUNDARY',
  'OMNI_PERMANENT_NAME_POLICY',
]);

const WILDCARD_TOKENS = ['*', '?', '[', ']', '**'];

export interface BaselineValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateBaseline(
  entries: readonly ArchitectureBaselineEntry[],
): BaselineValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const [i, e] of entries.entries()) {
    const where = `entry[${i}] (${e.ruleId ?? '?'} @ ${e.filePath ?? '?'})`;

    if (!e.ruleId || !VALID_RULE_IDS.has(e.ruleId)) {
      errors.push(`${where}: invalid or missing ruleId`);
    }
    if (!e.filePath || typeof e.filePath !== 'string') {
      errors.push(`${where}: missing filePath`);
    } else {
      const p = e.filePath.replace(/\\/g, '/');
      if (WILDCARD_TOKENS.some((t) => p.includes(t))) {
        errors.push(`${where}: wildcard paths are not allowed`);
      }
      if (p.endsWith('/')) {
        errors.push(`${where}: directory-wide exemptions are not allowed`);
      }
      if (NEW_SYSTEM_ROOTS.some((root) => p.startsWith(root))) {
        errors.push(`${where}: baseline may not cover new-system paths`);
      }
    }
    if (!e.evidence || !e.evidence.trim()) {
      errors.push(`${where}: evidence is required`);
    }
    if (!e.reason || !e.reason.trim()) {
      errors.push(`${where}: reason is required`);
    }

    const key = `${e.ruleId}::${e.filePath}::${e.evidence}`;
    if (seen.has(key)) errors.push(`${where}: duplicate entry`);
    seen.add(key);
  }

  return { ok: errors.length === 0, errors };
}

/** Returns a stable key for a violation for baseline matching. */
export function baselineKey(v: {
  ruleId: ArchitectureRuleId;
  filePath: string;
  evidence?: string;
}): string {
  return `${v.ruleId}::${v.filePath}::${v.evidence ?? ''}`;
}

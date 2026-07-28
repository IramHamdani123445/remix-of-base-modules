/**
 * Rule 3 — OMNI_PROVIDER_IMPORT_BOUNDARY.
 *
 * Provider SDKs may be imported ONLY from
 * src/platform/omni-comms/adapters/providers/**. Scans repository-wide.
 * Existing repo-wide debt may be baselined precisely; the new-system scope
 * remains zero-tolerance.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import {
  PROVIDER_SDK_PACKAGES,
  isInProviderAdapterRoot,
} from '../architecturePolicy';

const IMPORT_RE =
  /(?:import\s+[^'"`;]*?from\s*|import\s*|export\s+(?:\*|\{[^}]*\})\s+from\s*|require\s*\(\s*|import\s*\(\s*)['"`]([^'"`]+)['"`]/g;

function matchesProvider(spec: string): string | null {
  for (const pkg of PROVIDER_SDK_PACKAGES) {
    if (pkg.endsWith('/')) {
      if (spec === pkg.slice(0, -1) || spec.startsWith(pkg)) return pkg;
    } else if (spec === pkg || spec.startsWith(`${pkg}/`)) {
      return pkg;
    }
  }
  return null;
}

export function checkProviderImports(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const f of scan.files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.filePath)) continue;
    if (isInProviderAdapterRoot(f.filePath)) continue;

    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(f.content)) !== null) {
      const spec = m[1];
      const hit = matchesProvider(spec);
      if (hit) {
        out.push({
          ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0].trim(),
          message: `Provider SDK "${hit.replace(/\/$/, '')}" imported outside src/platform/omni-comms/adapters/providers/**.`,
          remediation:
            'Move transport-specific logic into an Omni-Comms provider adapter under src/platform/omni-comms/adapters/providers/ or into an omni-comms-* edge function.',
          baselineStatus: 'not_baselined',
        });
      }
    }
  }
  return out;
}

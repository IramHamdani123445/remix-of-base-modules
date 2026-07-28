/**
 * Rule 1 — OMNI_LEGACY_IMPORT.
 *
 * Rejects any import inside the new-system roots that resolves into verified
 * Legacy Communication Hub code. Detects static, dynamic, `require`, and
 * re-export forms. Relative paths are resolved against the file's directory
 * and matched against the verified Legacy roots.
 */
import path from 'node:path';
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import {
  LEGACY_IMPORT_PATTERNS,
  isInNewSystem,
  isRuleMetadataFile,
} from '../architecturePolicy';

const IMPORT_RE =
  /(?:import\s+[^'"`;]*?from\s*|import\s*|export\s+(?:\*|\{[^}]*\})\s+from\s*|require\s*\(\s*|import\s*\(\s*)['"`]([^'"`]+)['"`]/g;

function resolveRelative(fromFile: string, spec: string): string {
  const dir = path.posix.dirname(fromFile.replace(/\\/g, '/'));
  return path.posix.normalize(path.posix.join(dir, spec));
}

function matchesLegacy(spec: string): string | null {
  for (const pat of LEGACY_IMPORT_PATTERNS) {
    if (spec === pat || spec.startsWith(pat)) return pat;
  }
  return null;
}

export function checkLegacyImports(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!isInNewSystem(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.filePath)) continue;

    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(f.content)) !== null) {
      const raw = m[1];
      const spec = raw.startsWith('.') ? resolveRelative(f.filePath, raw) : raw;
      const hit = matchesLegacy(spec);
      if (hit) {
        out.push({
          ruleId: 'OMNI_LEGACY_IMPORT',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0].trim(),
          message: `New-system file imports from verified Legacy Communication Hub path "${hit}".`,
          remediation:
            'Remove the Legacy import. Reuse shared ERP services (organization, department, auth, permissions, audit, document storage, shared UI) instead.',
          baselineStatus: 'not_baselined',
        });
      }
    }
  }
  return out;
}

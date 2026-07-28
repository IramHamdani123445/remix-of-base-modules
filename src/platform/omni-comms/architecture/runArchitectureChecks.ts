/**
 * Omni-Comms — Architecture check orchestrator.
 *
 * Deterministic, pure runner. Callers may inject a pre-built `RepositoryScan`
 * and baseline (used by tests). When not injected, it walks the repository
 * from the given `repoRoot` (defaults to process.cwd()) once and reuses the
 * result across the ten rule modules.
 */
import fs from 'node:fs';
import path from 'node:path';

import type {
  ArchitectureBaselineEntry,
  ArchitectureCheckSummary,
  ArchitectureViolation,
  RepositoryScan,
  ScannedFile,
} from './architectureCheck.types';
import {
  FUNCTIONS_DIR,
  MIGRATIONS_DIR,
  ROUTE_REGISTRATION_FILE,
  SCAN_EXCLUDE_DIRS,
  SCAN_INCLUDE_SUFFIXES,
} from './architecturePolicy';
import {
  OMNI_COMMS_ARCHITECTURE_BASELINE,
  baselineKey,
  validateBaseline,
} from './architectureBaseline';

import { checkLegacyImports } from './checks/checkLegacyImports';
import { checkLegacyTableReferences } from './checks/checkLegacyTableReferences';
import { checkProviderImports } from './checks/checkProviderImports';
import { checkReactRuntimeWrites } from './checks/checkReactRuntimeWrites';
import { checkMigrationRegistry } from './checks/checkMigrationRegistry';
import { checkRouteRegistry } from './checks/checkRouteRegistry';
import { checkIntegrationRegistry } from './checks/checkIntegrationRegistry';
import { checkQueueRegistry } from './checks/checkQueueRegistry';
import { checkFacadeBoundary } from './checks/checkFacadeBoundary';
import { checkPermanentNames } from './checks/checkPermanentNames';

export interface RunArchitectureChecksOptions {
  repoRoot?: string;
  scan?: RepositoryScan;
  baseline?: readonly ArchitectureBaselineEntry[];
}

const CHECKS = [
  checkLegacyImports,
  checkLegacyTableReferences,
  checkProviderImports,
  checkReactRuntimeWrites,
  checkMigrationRegistry,
  checkRouteRegistry,
  checkIntegrationRegistry,
  checkQueueRegistry,
  checkFacadeBoundary,
  checkPermanentNames,
] as const;

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function walkFs(root: string, sub: string, acc: string[]): void {
  const abs = path.join(root, sub);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.git')) continue;
    if (SCAN_EXCLUDE_DIRS.includes(e.name)) continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walkFs(root, rel, acc);
    } else if (e.isFile()) {
      if (SCAN_INCLUDE_SUFFIXES.some((s) => e.name.endsWith(s))) acc.push(rel);
    }
  }
}

export function buildRepositoryScan(repoRoot: string): RepositoryScan {
  const files: ScannedFile[] = [];
  const relPaths: string[] = [];
  for (const top of ['src', 'supabase', 'scripts', '.github']) {
    walkFs(repoRoot, top, relPaths);
  }
  for (const rel of relPaths.sort()) {
    try {
      const content = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      files.push({ filePath: toPosix(rel), content });
    } catch {
      /* unreadable */
    }
  }

  const routeAbs = path.join(repoRoot, ROUTE_REGISTRATION_FILE);
  const routeSource: ScannedFile | null = fs.existsSync(routeAbs)
    ? { filePath: ROUTE_REGISTRATION_FILE, content: fs.readFileSync(routeAbs, 'utf8') }
    : null;

  const migrations: ScannedFile[] = [];
  const migAbs = path.join(repoRoot, MIGRATIONS_DIR);
  if (fs.existsSync(migAbs)) {
    for (const f of fs.readdirSync(migAbs).sort()) {
      if (!f.endsWith('.sql')) continue;
      const rel = `${MIGRATIONS_DIR}/${f}`;
      migrations.push({ filePath: rel, content: fs.readFileSync(path.join(migAbs, f), 'utf8') });
    }
  }

  const edgeFunctionDirs: string[] = [];
  const fnAbs = path.join(repoRoot, FUNCTIONS_DIR);
  if (fs.existsSync(fnAbs)) {
    for (const d of fs.readdirSync(fnAbs, { withFileTypes: true })) {
      if (d.isDirectory()) edgeFunctionDirs.push(d.name);
    }
  }

  let dependencies: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    /* no package.json */
  }

  return { files, routeSource, migrations, edgeFunctionDirs: edgeFunctionDirs.sort(), dependencies };
}

function sortViolations(a: ArchitectureViolation, b: ArchitectureViolation): number {
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  return (a.evidence ?? '').localeCompare(b.evidence ?? '');
}

export function runArchitectureChecks(
  opts: RunArchitectureChecksOptions = {},
): ArchitectureCheckSummary {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const scan = opts.scan ?? buildRepositoryScan(repoRoot);
  const baseline = opts.baseline ?? OMNI_COMMS_ARCHITECTURE_BASELINE;

  const baselineResult = validateBaseline(baseline);
  const invalidBaselineViolations: ArchitectureViolation[] = baselineResult.ok
    ? []
    : baselineResult.errors.map((err) => ({
        ruleId: 'OMNI_PERMANENT_NAME_POLICY', // placeholder rule for reporting only
        severity: 'error' as const,
        filePath: 'src/platform/omni-comms/architecture/architectureBaseline.ts',
        evidence: err,
        message: `Invalid baseline: ${err}`,
        remediation:
          'Fix the baseline entry — every entry needs exact ruleId, path, evidence and reason; no wildcards; no new-system paths.',
        baselineStatus: 'not_baselined' as const,
      }));

  const raw: ArchitectureViolation[] = [];
  for (const check of CHECKS) raw.push(...check(scan));

  const baselineIndex = new Map(baseline.map((b) => [baselineKey(b), b] as const));
  const matched = new Set<string>();

  const annotated: ArchitectureViolation[] = raw.map((v) => {
    const key = baselineKey(v);
    if (baselineIndex.has(key)) {
      matched.add(key);
      return { ...v, baselineStatus: 'existing_baseline' as const };
    }
    return v;
  });

  const stale: ArchitectureViolation[] = [];
  for (const [key, entry] of baselineIndex) {
    if (matched.has(key)) continue;
    stale.push({
      ruleId: entry.ruleId,
      severity: 'error',
      filePath: entry.filePath,
      evidence: entry.evidence,
      message: 'Baseline entry no longer matches any active violation.',
      remediation:
        'Remove the stale baseline entry. If the file changed intentionally, delete the entry; do not keep dormant entries.',
      baselineStatus: 'stale_baseline',
    });
  }

  const failing = [
    ...annotated.filter((v) => v.baselineStatus === 'not_baselined'),
    ...stale,
    ...invalidBaselineViolations,
  ].sort(sortViolations);

  const all = [...annotated, ...stale, ...invalidBaselineViolations].sort(sortViolations);

  return {
    passed: failing.length === 0,
    checkedFiles: scan.files.length,
    violations: all,
    activeBaselineEntries: matched.size,
    staleBaselineEntries: stale.length,
  };
}

export function formatViolations(vs: readonly ArchitectureViolation[]): string {
  if (vs.length === 0) return '';
  return vs
    .map(
      (v) =>
        `[${v.ruleId}]\nFile: ${v.filePath}\nEvidence: ${v.evidence ?? '(n/a)'}\nReason: ${v.message}\nRemediation: ${v.remediation}\nBaseline: ${v.baselineStatus}`,
    )
    .join('\n\n');
}

/**
 * Rule 2 — OMNI_LEGACY_TABLE_REFERENCE.
 *
 * Rejects references from new-system code to verified Legacy communication
 * tables. Detects `.from('table')`, SQL string literals, RPC wrappers and
 * migration references. README prose and test descriptions are ignored via
 * a filename filter (only .ts/.tsx/.js/.jsx/.sql are scanned).
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import {
  LEGACY_COMMUNICATION_TABLES,
  isInNewSystem,
  isRuleMetadataFile,
} from '../architecturePolicy';

function scanFile(
  file: { filePath: string; content: string },
): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const table of LEGACY_COMMUNICATION_TABLES) {
    // .from('table') / .from("table") / .from(`table`)
    const fromRe = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`, 'g');
    // Quoted table name in SQL / RPC contexts (word-bounded).
    const quotedRe = new RegExp(`['"\`]${table}['"\`]`, 'g');
    // Raw SQL: FROM/INTO/UPDATE/JOIN/TABLE <table>
    const sqlRe = new RegExp(
      `\\b(?:from|into|update|join|table)\\s+(?:public\\.)?${table}\\b`,
      'gi',
    );

    for (const re of [fromRe, sqlRe, quotedRe]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(file.content)) !== null) {
        out.push({
          ruleId: 'OMNI_LEGACY_TABLE_REFERENCE',
          severity: 'error',
          filePath: file.filePath,
          evidence: m[0],
          message: `New-system file references verified Legacy communication table "${table}".`,
          remediation:
            'Do not read or write Legacy communication tables from Omni-Comms code. Model the concern on the approved omni_comms_* catalogue instead.',
          baselineStatus: 'not_baselined',
        });
        break; // one evidence per table per file is enough
      }
      if (out.length && out[out.length - 1].evidence?.includes(table)) break;
    }
  }
  return out;
}

export function checkLegacyTableReferences(
  scan: RepositoryScan,
): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!isInNewSystem(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|sql)$/.test(f.filePath)) continue;
    out.push(...scanFile(f));
  }
  return out;
}

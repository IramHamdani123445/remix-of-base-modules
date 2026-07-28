/**
 * Rule 9 — OMNI_SEND_FACADE_BOUNDARY.
 *
 * Current expectation: zero new-system send façades. Epic 7 will
 * deliberately relax this to allow exactly one approved façade — that
 * change is out of scope here.
 *
 * Detects:
 *  - a file named `sendCommunication.ts` (or `.tsx`) anywhere under
 *    src/platform/omni-comms/**
 *  - an exported symbol named `sendCommunication` or `sendOmniCommunication`
 *    from any file in the new-system roots
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { isInNewSystem, isRuleMetadataFile } from '../architecturePolicy';

const FORBIDDEN_EXPORT_RE =
  /\bexport\s+(?:async\s+)?(?:const|function|let|var|class)\s+(sendCommunication|sendOmniCommunication)\b|\bexport\s*\{\s*[^}]*\b(sendCommunication|sendOmniCommunication)\b/g;

const FORBIDDEN_FILE_BASENAMES = new Set([
  'sendCommunication.ts',
  'sendCommunication.tsx',
  'sendOmniCommunication.ts',
  'sendOmniCommunication.tsx',
]);

export function checkFacadeBoundary(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!isInNewSystem(f.filePath)) continue;
    const base = f.filePath.split('/').pop() ?? '';
    if (FORBIDDEN_FILE_BASENAMES.has(base)) {
      out.push({
        ruleId: 'OMNI_SEND_FACADE_BOUNDARY',
        severity: 'error',
        filePath: f.filePath,
        evidence: base,
        message: `Send façade file "${base}" is not authorised in Epic 1.`,
        remediation:
          'Remove the file. The sendCommunication façade is introduced under Epic 7 only.',
        baselineStatus: 'not_baselined',
      });
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;

    FORBIDDEN_EXPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FORBIDDEN_EXPORT_RE.exec(f.content)) !== null) {
      out.push({
        ruleId: 'OMNI_SEND_FACADE_BOUNDARY',
        severity: 'error',
        filePath: f.filePath,
        evidence: m[0].trim(),
        message: `Send façade export detected in "${f.filePath}".`,
        remediation:
          'Do not export sendCommunication / sendOmniCommunication before Epic 7. Delete the export.',
        baselineStatus: 'not_baselined',
      });
    }
  }
  return out;
}

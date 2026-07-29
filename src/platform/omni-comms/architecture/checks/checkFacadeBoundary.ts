/**
 * Rule 9 — OMNI_SEND_FACADE_BOUNDARY.
 *
 * Milestone note: the authorised send-façade milestone moved from the
 * original Epic 7 roadmap to Accelerated Build 3 — Slice 2. Exactly ONE
 * canonical façade is now permitted:
 *
 *   file:   src/platform/omni-comms/sendCommunication.ts
 *   export: sendCommunication
 *
 * Everything else remains prohibited:
 *  - a second file named sendCommunication.ts / .tsx anywhere else under
 *    the new-system roots;
 *  - a second file exporting the symbol `sendCommunication`
 *    from anywhere in the new-system roots other than the canonical file;
 *  - any file exporting an alias such as `sendOmniCommunication`,
 *    `dispatchCommunication`, or `queueCommunication` (these attempt to
 *    bypass the canonical façade);
 *  - direct provider SDK imports inside the canonical façade file
 *    (providers must only be reached via the trusted runtime service, and
 *    the façade must not import them);
 *  - business-module imports (src/modules/**) of internal runtime
 *    services (src/platform/omni-comms/runtime/**); business callers must
 *    import ONLY the canonical façade file.
 *
 * Legacy Communication Hub façades remain out of scope for this rule and
 * continue to be governed by the Legacy-import rule.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import {
  isInNewSystem,
  isRuleMetadataFile,
  PROVIDER_SDK_PACKAGES,
} from '../architecturePolicy';

const CANONICAL_FACADE_PATH = 'src/platform/omni-comms/sendCommunication.ts';
const CANONICAL_EXPORT = 'sendCommunication';

/** Alias exports that attempt to bypass the canonical façade. Always forbidden. */
const FORBIDDEN_ALIAS_EXPORTS = [
  'sendOmniCommunication',
  'dispatchCommunication',
  'queueCommunication',
] as const;

const FORBIDDEN_FILE_BASENAMES = new Set([
  'sendCommunication.tsx',
  'sendOmniCommunication.ts',
  'sendOmniCommunication.tsx',
  'dispatchCommunication.ts',
  'dispatchCommunication.tsx',
  'queueCommunication.ts',
  'queueCommunication.tsx',
]);

const RUNTIME_INTERNALS_RE =
  /(?:from\s+['"](?:@\/platform\/omni-comms\/runtime|src\/platform\/omni-comms\/runtime)(?:\/[^'"]*)?['"])|(?:import\s*\(\s*['"](?:@\/platform\/omni-comms\/runtime|src\/platform\/omni-comms\/runtime)(?:\/[^'"]*)?['"]\s*\))/g;

function scanExports(
  content: string,
  symbol: string,
): RegExpExecArray[] {
  const decl = new RegExp(
    String.raw`\bexport\s+(?:async\s+)?(?:const|function|let|var|class)\s+${symbol}\b`,
    'g',
  );
  const named = new RegExp(
    String.raw`\bexport\s*(?:type\s*)?\{\s*[^}]*\b${symbol}\b[^}]*\}`,
    'g',
  );
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = decl.exec(content)) !== null) out.push(m);
  while ((m = named.exec(content)) !== null) out.push(m);
  return out;
}

function scanProviderImports(content: string): string[] {
  const hits: string[] = [];
  for (const pkg of PROVIDER_SDK_PACKAGES) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // scoped prefix (`@scope/`) OR exact/submodule match
    const pattern = pkg.endsWith('/')
      ? new RegExp(
          String.raw`\bfrom\s+['"]${escaped}[^'"]+['"]|\brequire\(\s*['"]${escaped}[^'"]+['"]\s*\)`,
          'g',
        )
      : new RegExp(
          String.raw`\bfrom\s+['"]${escaped}(?:\/[^'"]*)?['"]|\brequire\(\s*['"]${escaped}(?:\/[^'"]*)?['"]\s*\)`,
          'g',
        );
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) hits.push(m[0]);
  }
  return hits;
}

export function checkFacadeBoundary(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];

  // 1) Enforce at most one canonical façade file: any file under the
  //    new-system roots whose basename matches a forbidden alias file, OR
  //    a second `sendCommunication.ts` outside the canonical path.
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
        message: `Forbidden alias façade file "${base}".`,
        remediation:
          'Delete the alias file. Only the canonical façade at ' +
          `${CANONICAL_FACADE_PATH} is permitted.`,
        baselineStatus: 'not_baselined',
      });
      continue;
    }

    if (base === 'sendCommunication.ts' && f.filePath !== CANONICAL_FACADE_PATH) {
      out.push({
        ruleId: 'OMNI_SEND_FACADE_BOUNDARY',
        severity: 'error',
        filePath: f.filePath,
        evidence: base,
        message: `Second sendCommunication.ts file at "${f.filePath}".`,
        remediation:
          `The canonical façade lives at ${CANONICAL_FACADE_PATH}. Remove this duplicate.`,
        baselineStatus: 'not_baselined',
      });
    }
  }

  // 2) Enforce at most one export named `sendCommunication` across the
  //    new-system roots — and only inside the canonical file.
  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!isInNewSystem(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;

    const canonicalHits = scanExports(f.content, CANONICAL_EXPORT);
    if (canonicalHits.length > 0 && f.filePath !== CANONICAL_FACADE_PATH) {
      for (const m of canonicalHits) {
        out.push({
          ruleId: 'OMNI_SEND_FACADE_BOUNDARY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0].trim(),
          message: `Second sendCommunication export detected in "${f.filePath}".`,
          remediation:
            `Only the canonical façade at ${CANONICAL_FACADE_PATH} may export sendCommunication.`,
          baselineStatus: 'not_baselined',
        });
      }
    }

    for (const alias of FORBIDDEN_ALIAS_EXPORTS) {
      for (const m of scanExports(f.content, alias)) {
        out.push({
          ruleId: 'OMNI_SEND_FACADE_BOUNDARY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0].trim(),
          message: `Forbidden façade alias export "${alias}" in "${f.filePath}".`,
          remediation:
            `Remove the alias. Business callers must use the canonical ${CANONICAL_EXPORT}() façade only.`,
          baselineStatus: 'not_baselined',
        });
      }
    }
  }

  // 3) Canonical façade must not import provider SDKs.
  const canonical = scan.files.find((f) => f.filePath === CANONICAL_FACADE_PATH);
  if (canonical) {
    for (const evidence of scanProviderImports(canonical.content)) {
      out.push({
        ruleId: 'OMNI_SEND_FACADE_BOUNDARY',
        severity: 'error',
        filePath: canonical.filePath,
        evidence: evidence.trim(),
        message: `Canonical façade must not import provider SDKs.`,
        remediation:
          'Providers may only be invoked inside adapters under src/platform/omni-comms/adapters/providers/. The façade delegates to the trusted runtime service.',
        baselineStatus: 'not_baselined',
      });
    }
  }

  // 4) Business modules must not import runtime internals directly.
  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!f.filePath.startsWith('src/modules/')) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;

    RUNTIME_INTERNALS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RUNTIME_INTERNALS_RE.exec(f.content)) !== null) {
      out.push({
        ruleId: 'OMNI_SEND_FACADE_BOUNDARY',
        severity: 'error',
        filePath: f.filePath,
        evidence: m[0].trim(),
        message: `Business module imports Omni-Comms runtime internals directly.`,
        remediation:
          `Business callers must import only ${CANONICAL_FACADE_PATH} (sendCommunication). Runtime internals are not part of the public contract.`,
        baselineStatus: 'not_baselined',
      });
    }
  }

  return out;
}

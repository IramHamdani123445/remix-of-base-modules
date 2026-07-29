/**
 * Rule 11 — OMNI_RESOLVER_RUNTIME_BOUNDARY.
 *
 * The Slice 2c-ii Batch B resolver package lives under
 *   supabase/functions/omni-comms-runtime/resolution/**
 * and is the ONLY authorised location for those modules. Their internal
 * runtime types (AggregateSnapshot, RuntimeResolutionResult, ChannelResolution,
 * etc.) must never leak into React/browser code, business modules, or the
 * publisher-facing service layer.
 *
 * Rule scope:
 *  - No file under src/ may import from
 *    supabase/functions/omni-comms-runtime/resolution.
 *  - No file under src/ may re-export the internal runtime symbols.
 *  - The browser transport must not call the SECURITY DEFINER RPCs
 *    omni_comms_priv_runtime_resolution_snapshot,
 *    omni_comms_priv_finalize_resolution,
 *    omni_comms_priv_load_persisted_resolution,
 *    or omni_comms_priv_next_event_sequence directly. Those are
 *    service_role-only and reachable only through the trusted Edge Function.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { isRuleMetadataFile } from '../architecturePolicy';

const RESOLVER_IMPORT_RE =
  /from\s+['"](?:[^'"]*\/)?supabase\/functions\/omni-comms-runtime\/resolution(?:\/[^'"]*)?['"]/g;

const FORBIDDEN_RPC_NAMES = [
  'omni_comms_priv_runtime_resolution_snapshot',
  'omni_comms_priv_finalize_resolution',
  'omni_comms_priv_load_persisted_resolution',
  'omni_comms_priv_next_event_sequence',
];

function isBrowserOrServiceFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  return p.startsWith('src/') && !p.startsWith('src/__tests__/');
}

export function checkResolverBoundary(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!isBrowserOrServiceFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;

    let m: RegExpExecArray | null;
    RESOLVER_IMPORT_RE.lastIndex = 0;
    while ((m = RESOLVER_IMPORT_RE.exec(f.content)) !== null) {
      out.push({
        ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
        severity: 'error',
        filePath: f.filePath,
        evidence: m[0],
        message: 'src/** may not import the omni-comms-runtime resolution package.',
        remediation:
          'The resolver modules are Edge-Function-only. Call the trusted omni-comms-runtime Edge Function through the canonical façade instead.',
        baselineStatus: 'not_baselined',
      });
    }

    for (const rpc of FORBIDDEN_RPC_NAMES) {
      const rpcRe = new RegExp(
        String.raw`\.rpc\s*\(\s*['"\`]${rpc}['"\`]`,
        'g',
      );
      let rm: RegExpExecArray | null;
      while ((rm = rpcRe.exec(f.content)) !== null) {
        out.push({
          ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
          severity: 'error',
          filePath: f.filePath,
          evidence: rm[0],
          message: `Browser code may not call service_role-only RPC "${rpc}" directly.`,
          remediation:
            'Route resolution / finalization through the omni-comms-runtime Edge Function; these RPCs are executable only by service_role.',
          baselineStatus: 'not_baselined',
        });
      }
    }
  }
  return out;
}

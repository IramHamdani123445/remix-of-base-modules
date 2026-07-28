/**
 * Rule 10 — OMNI_PERMANENT_NAME_POLICY.
 *
 * Forbidden segments (advanced/new/next/v2/pilot/controlled/rehearsal/
 * standby/phase) must not appear as underscore- or hyphen-separated segments
 * inside permanent Omni-Comms names — DB objects (omni_comms_*), integrations
 * (omni-comms-*), queues (omni-comms.*), or admin routes.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { OMNI_COMMS_OBJECT_REGISTRY } from '../../registry/objectRegistry';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '../../registry/integrationRegistry';
import { OMNI_COMMS_QUEUE_REGISTRY } from '../../registry/queueRegistry';
import { OMNI_COMMS_ROUTE_REGISTRY } from '../../registry/routeRegistry';
import { FORBIDDEN_NAME_SEGMENTS, FUNCTIONS_DIR } from '../architecturePolicy';

const SEG_RE = new RegExp(
  `(?:^|[_\\-\\./])(${FORBIDDEN_NAME_SEGMENTS.join('|')})(?:$|[_\\-\\./])`,
  'i',
);

function violates(name: string): string | null {
  const m = SEG_RE.exec(name);
  return m ? m[1].toLowerCase() : null;
}

export function checkPermanentNames(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];

  const push = (
    ruleId: 'OMNI_PERMANENT_NAME_POLICY',
    filePath: string,
    evidence: string,
    seg: string,
    kind: string,
  ) => {
    out.push({
      ruleId,
      severity: 'error',
      filePath,
      evidence,
      message: `${kind} name "${evidence}" contains forbidden segment "${seg}".`,
      remediation:
        'Rename the object. Forbidden segments: advanced, new, next, v2, pilot, controlled, rehearsal, standby, phase.',
      baselineStatus: 'not_baselined',
    });
  };

  for (const o of OMNI_COMMS_OBJECT_REGISTRY) {
    const s = violates(o.name);
    if (s) push('OMNI_PERMANENT_NAME_POLICY', 'src/platform/omni-comms/registry/objectRegistry.ts', o.name, s, 'DB object');
  }
  for (const i of OMNI_COMMS_INTEGRATION_REGISTRY) {
    const s = violates(i.name);
    if (s) push('OMNI_PERMANENT_NAME_POLICY', 'src/platform/omni-comms/registry/integrationRegistry.ts', i.name, s, 'Integration');
  }
  for (const q of OMNI_COMMS_QUEUE_REGISTRY) {
    const s = violates(q.name);
    if (s) push('OMNI_PERMANENT_NAME_POLICY', 'src/platform/omni-comms/registry/queueRegistry.ts', q.name, s, 'Queue');
  }
  for (const r of OMNI_COMMS_ROUTE_REGISTRY) {
    const s = violates(r.path);
    if (s) push('OMNI_PERMANENT_NAME_POLICY', 'src/platform/omni-comms/registry/routeRegistry.ts', r.path, s, 'Route');
  }

  // Physical edge-function directory names.
  for (const dir of scan.edgeFunctionDirs) {
    if (!dir.startsWith('omni-comms-')) continue;
    const s = violates(dir);
    if (s) push('OMNI_PERMANENT_NAME_POLICY', `${FUNCTIONS_DIR}/${dir}`, dir, s, 'Edge function');
  }

  return out;
}

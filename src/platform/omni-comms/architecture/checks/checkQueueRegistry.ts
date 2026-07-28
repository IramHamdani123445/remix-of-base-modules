/**
 * Rule 8 — OMNI_QUEUE_REGISTRY.
 *
 * Scans source + config for `omni-comms.*` queue names and enforces that
 * each is Reserved in queueRegistry.ts and has no physical usage. Rendering
 * queues are prohibited outright.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { OMNI_COMMS_QUEUE_REGISTRY } from '../../registry/queueRegistry';
import { PROHIBITED_QUEUE_NAMES } from '../architecturePolicy';
import { isInNewSystem } from '../architecturePolicy';

const QUEUE_NAME_RE = /['"`](omni-comms\.[a-z][a-z0-9._-]*)['"`]/g;

// Files that may reference queue names in this story (registry + tests + docs):
// treat *reads* inside the registry file itself as declarations, not usage.
function isRegistryDeclaration(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  return (
    p === 'src/platform/omni-comms/registry/queueRegistry.ts' ||
    p === 'src/platform/omni-comms/architecture/architecturePolicy.ts'
  );
}

function looksLikeUsage(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (isRegistryDeclaration(p)) return false;
  if (p.endsWith('.md')) return false;
  if (p.startsWith('src/__tests__/')) return false;
  if (p.startsWith('src/platform/omni-comms/architecture/')) return false; // this rule module
  if (p.startsWith('src/platform/omni-comms/admin/')) return false; // display-only in Readiness
  return true;
}

export function checkQueueRegistry(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  const approved = new Map(OMNI_COMMS_QUEUE_REGISTRY.map((q) => [q.name, q] as const));

  for (const f of scan.files) {
    if (!/\.(ts|tsx|js|jsx|json|yml|yaml|toml|sql)$/.test(f.filePath)) continue;
    QUEUE_NAME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUEUE_NAME_RE.exec(f.content)) !== null) {
      const name = m[1];

      if (PROHIBITED_QUEUE_NAMES.includes(name)) {
        out.push({
          ruleId: 'OMNI_QUEUE_REGISTRY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0],
          message: `Prohibited rendering queue "${name}".`,
          remediation:
            'Rendering must not have its own queue. Remove the name and route rendering through the application layer.',
          baselineStatus: 'not_baselined',
        });
        continue;
      }

      const entry = approved.get(name);
      if (!entry) {
        out.push({
          ruleId: 'OMNI_QUEUE_REGISTRY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0],
          message: `Unregistered omni-comms queue "${name}".`,
          remediation:
            'Add the queue to src/platform/omni-comms/registry/queueRegistry.ts before referencing it in code or configuration.',
          baselineStatus: 'not_baselined',
        });
      } else if (looksLikeUsage(f.filePath) && (!isInNewSystem(f.filePath) || f.filePath !== 'src/platform/omni-comms/registry/queueRegistry.ts')) {
        out.push({
          ruleId: 'OMNI_QUEUE_REGISTRY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0],
          message: `Physical usage of reserved queue "${name}".`,
          remediation:
            'Queues remain Reserved until explicitly approved. Remove the physical publish/subscribe reference.',
          baselineStatus: 'not_baselined',
        });
      }
    }
  }
  return out;
}

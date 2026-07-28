/**
 * Rule 7 — OMNI_INTEGRATION_REGISTRY.
 *
 * Every `omni-comms-*` edge-function directory under supabase/functions must
 * exist as a Reserved integration in integrationRegistry.ts, and no physical
 * implementation is allowed while status is Reserved. Prohibited names
 * (omni-comms-render, omni-comms-admin-*) fire regardless.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '../../registry/integrationRegistry';
import { PROHIBITED_INTEGRATION_NAMES, FUNCTIONS_DIR } from '../architecturePolicy';

export function checkIntegrationRegistry(
  scan: RepositoryScan,
): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  const reserved = new Map(
    OMNI_COMMS_INTEGRATION_REGISTRY.filter((i) => i.kind === 'edge_function').map(
      (i) => [i.name, i] as const,
    ),
  );

  for (const dir of scan.edgeFunctionDirs) {
    if (!dir.startsWith('omni-comms-')) continue;
    const filePath = `${FUNCTIONS_DIR}/${dir}`;

    if (PROHIBITED_INTEGRATION_NAMES.includes(dir) || dir.startsWith('omni-comms-admin-')) {
      out.push({
        ruleId: 'OMNI_INTEGRATION_REGISTRY',
        severity: 'error',
        filePath,
        evidence: dir,
        message: `Prohibited omni-comms edge function "${dir}".`,
        remediation:
          'Rendering is an application service (not an edge function). Admin-scoped edge functions require explicit later approval.',
        baselineStatus: 'not_baselined',
      });
      continue;
    }

    const entry = reserved.get(dir);
    if (!entry) {
      out.push({
        ruleId: 'OMNI_INTEGRATION_REGISTRY',
        severity: 'error',
        filePath,
        evidence: dir,
        message: `Unregistered omni-comms edge function "${dir}".`,
        remediation:
          'Add the integration to src/platform/omni-comms/registry/integrationRegistry.ts before creating an implementation.',
        baselineStatus: 'not_baselined',
      });
    } else if (entry.status === 'Reserved') {
      out.push({
        ruleId: 'OMNI_INTEGRATION_REGISTRY',
        severity: 'error',
        filePath,
        evidence: dir,
        message: `Physical implementation exists for reserved integration "${dir}".`,
        remediation:
          'Do not create physical implementations while status is Reserved. Update the registry status only after architecture approval.',
        baselineStatus: 'not_baselined',
      });
    }
  }
  return out;
}

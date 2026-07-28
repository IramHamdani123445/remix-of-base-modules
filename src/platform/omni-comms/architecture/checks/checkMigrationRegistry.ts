/**
 * Rule 5 — OMNI_MIGRATION_OBJECT_REGISTRY.
 *
 * Every omni_comms_* table created by a migration must exist as an ACTIVE
 * entry in the object registry. Deferred objects must never be created.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { OMNI_COMMS_OBJECT_REGISTRY } from '../../registry/objectRegistry';
import { OMNI_COMMS_DEFERRED_OBJECTS } from '../../registry/deferredObjects';

const CREATE_TABLE_RE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(omni_comms_[a-z0-9_]+)"?/gi;

export function checkMigrationRegistry(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  const registered = new Set(OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name));
  const deferred = new Set(OMNI_COMMS_DEFERRED_OBJECTS.map((d) => d.proposedName));

  for (const f of scan.migrations) {
    CREATE_TABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_TABLE_RE.exec(f.content)) !== null) {
      const name = m[1].toLowerCase();
      if (deferred.has(name)) {
        out.push({
          ruleId: 'OMNI_MIGRATION_OBJECT_REGISTRY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0],
          message: `Migration creates deferred object "${name}".`,
          remediation:
            'Deferred objects rely on shared platform infrastructure and must not be created. Remove the CREATE TABLE statement.',
          baselineStatus: 'not_baselined',
        });
      } else if (!registered.has(name)) {
        out.push({
          ruleId: 'OMNI_MIGRATION_OBJECT_REGISTRY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0],
          message: `Migration creates unregistered object "${name}".`,
          remediation:
            'Add the object to src/platform/omni-comms/registry/objectRegistry.ts with the approved epic and write authority before creating the table.',
          baselineStatus: 'not_baselined',
        });
      }
    }
  }
  return out;
}

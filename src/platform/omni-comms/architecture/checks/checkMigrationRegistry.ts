/**
 * Rule 5 — OMNI_MIGRATION_OBJECT_REGISTRY.
 *
 * Every omni_comms_* table created by a migration must exist as an ACTIVE
 * entry in the object registry. Deferred objects must never be created.
 *
 * A declared TRANSIENT artefact is the single narrow exception: it is exempt
 * from the object registry only when the migration history itself proves it is
 * dropped and never left behind. An undeclared unregistered table, or a
 * declared artefact whose DROP cannot be proven, is still a violation.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { OMNI_COMMS_OBJECT_REGISTRY } from '../../registry/objectRegistry';
import { OMNI_COMMS_DEFERRED_OBJECTS } from '../../registry/deferredObjects';
import { OMNI_COMMS_TRANSIENT_MIGRATION_ARTEFACTS } from '../../registry/transientArtefacts';

const CREATE_TABLE_RE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(omni_comms_[a-z0-9_]+)"?/gi;

function dropRe(name: string): RegExp {
  return new RegExp(
    `drop\\s+table\\s+(?:if\\s+exists\\s+)?(?:"?public"?\\.)?"?${name}"?`,
    'i',
  );
}

export function checkMigrationRegistry(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  const registered = new Set(OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name));
  const deferred = new Set(OMNI_COMMS_DEFERRED_OBJECTS.map((d) => d.proposedName));
  const transient = new Set(
    OMNI_COMMS_TRANSIENT_MIGRATION_ARTEFACTS.map((t) => t.name),
  );

  // Chronological order — migration file names are timestamp-prefixed.
  const ordered = [...scan.migrations].sort((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );

  /** Net effect of the whole migration history for a transient artefact. */
  const netPresent = (name: string): boolean => {
    const re = dropRe(name);
    let present = false;
    for (const f of ordered) {
      CREATE_TABLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      let created = false;
      while ((m = CREATE_TABLE_RE.exec(f.content)) !== null) {
        if (m[1].toLowerCase() === name) created = true;
      }
      if (created) present = true;
      if (re.test(f.content)) present = false;
    }
    return present;
  };

  const unprovenTransient = new Set(
    [...transient].filter((name) => netPresent(name)),
  );

  for (const f of ordered) {
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
      } else if (transient.has(name)) {
        if (unprovenTransient.has(name)) {
          out.push({
            ruleId: 'OMNI_MIGRATION_OBJECT_REGISTRY',
            severity: 'error',
            filePath: f.filePath,
            evidence: m[0],
            message: `Transient artefact "${name}" is declared but is never dropped; it survives the migration history as an ungoverned table.`,
            remediation:
              'Add a DROP TABLE for the artefact in the same migration wave, or register it as a permanent object in objectRegistry.ts with an approved epic and write authority.',
            baselineStatus: 'not_baselined',
          });
        }
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


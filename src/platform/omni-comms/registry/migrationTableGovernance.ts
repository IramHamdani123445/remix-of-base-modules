/**
 * Single source of truth for "which omni_comms_* table may a migration create".
 *
 * Three governance suites previously re-implemented this rule independently,
 * which is why one transient probe artefact turned four suites red at once.
 * They now share this helper.
 */
import { OMNI_COMMS_OBJECT_REGISTRY } from './objectRegistry';
import { OMNI_COMMS_TRANSIENT_MIGRATION_ARTEFACTS } from './transientArtefacts';

/**
 * Permanent AVAILABLE objects plus declared transient artefacts.
 *
 * Transient artefacts are still proven to be dropped by
 * `checkMigrationRegistry`; this set only stops the create statement itself
 * from being reported as an ungoverned permanent object.
 */
export function allowedMigrationTableNames(): Set<string> {
  return new Set([
    ...OMNI_COMMS_OBJECT_REGISTRY.filter((o) => o.status === 'AVAILABLE').map(
      (o) => o.name,
    ),
    ...OMNI_COMMS_TRANSIENT_MIGRATION_ARTEFACTS.map((t) => t.name),
  ]);
}

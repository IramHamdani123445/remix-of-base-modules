/**
 * Omni-Comms — declared TRANSIENT migration artefacts.
 *
 * The object registry governs PERSISTENT database objects. A migration wave is
 * occasionally forced to materialise a short-lived probe table in order to
 * assert a prerequisite, and drops it again inside the same wave. Such an
 * object is not a governed platform object and must never be added to
 * `objectRegistry.ts` — doing so would grant it permanent standing it does not
 * have, and would let a genuinely unregistered table hide behind a "tmp" name.
 *
 * Declaring an object here is NOT sufficient on its own. The architecture check
 * additionally proves, from the migration files themselves, that:
 *   1. every declared artefact is dropped by a migration at or after the one
 *      that creates it, and
 *   2. the net effect across the whole migration history is "absent".
 *
 * An undeclared unregistered CREATE TABLE, or a declared artefact without a
 * proven DROP, remains a hard architecture violation.
 */
export interface TransientMigrationArtefact {
  /** Exact object name as written in the migration. */
  readonly name: string;
  /** Why the artefact had to exist at all. */
  readonly rationale: string;
  /** Migration wave that introduced and removed it. */
  readonly wave: string;
}

export const OMNI_COMMS_TRANSIENT_MIGRATION_ARTEFACTS:
  ReadonlyArray<TransientMigrationArtefact> = [
  {
    name: 'omni_comms_tmp_prereq_probe',
    rationale:
      'Short-lived prerequisite probe used while proving channel prerequisites during the 2026-08-28 dispatch-prerequisite wave. Created and dropped inside the same wave; never part of the platform contract.',
    wave: '2026-08-28 dispatch prerequisite proof',
  },
];

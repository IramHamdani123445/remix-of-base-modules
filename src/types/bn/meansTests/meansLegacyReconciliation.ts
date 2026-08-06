/**
 * BN Means-Test — MT0 contract reconciliation.
 *
 * The repository previously carried two competing Means-Test contracts:
 *   • `meansCommands.ts`        — 18 canonical `BN_MEANS_*` commands (authoritative)
 *   • `meansTestCommands.ts`    — 11 legacy `BN_MT_*` commands (superseded)
 *
 * The canonical 18-command assessment model is authoritative: it is the
 * model registered in `benefitsCapabilityRegistry`, the model the
 * eligibility fact contract (`meansFactContract.ts`) publishes from, and
 * the model implemented by `bn_means_execute_command_v1`.
 *
 * This module is the single place where every legacy command is classified.
 * Contract tests assert the classification stays exhaustive so that no
 * second Means-Test module can re-emerge.
 */
import type { BnMeansCommandName } from './meansCommands';
import type { BnMeansTestCommandName } from './meansTestCommands';

export type BnMeansLegacyDisposition =
  | 'ALIASED_TO_CANONICAL_COMMAND'
  | 'REPLACED_BY_GOVERNED_HANDOFF'
  | 'RETIRED_DUPLICATE'
  | 'RETAINED_WITH_JUSTIFICATION';

export interface BnMeansLegacyReconciliationEntry {
  readonly legacyCommand: BnMeansTestCommandName;
  readonly disposition: BnMeansLegacyDisposition;
  /** Canonical replacement, when the disposition is an alias. */
  readonly canonicalCommand?: BnMeansCommandName;
  /** Target module when the behaviour moves to a governed handoff. */
  readonly handoffTargetModule?: string;
  readonly rationale: string;
}

export const BN_MEANS_LEGACY_RECONCILIATION: readonly BnMeansLegacyReconciliationEntry[] = [
  {
    legacyCommand: 'BN_MT_START',
    disposition: 'ALIASED_TO_CANONICAL_COMMAND',
    canonicalCommand: 'BN_MEANS_CREATE_ASSESSMENT',
    rationale: 'Assessment creation with full policy/currency/effective-period context.',
  },
  {
    legacyCommand: 'BN_MT_ATTACH_EVIDENCE',
    disposition: 'ALIASED_TO_CANONICAL_COMMAND',
    canonicalCommand: 'BN_MEANS_ATTACH_EVIDENCE',
    rationale: 'Identical intent; canonical form stores governed document references only.',
  },
  {
    legacyCommand: 'BN_MT_ASSESS',
    disposition: 'ALIASED_TO_CANONICAL_COMMAND',
    canonicalCommand: 'BN_MEANS_CALCULATE',
    rationale: 'Assessment is the deterministic calculation step in the canonical model.',
  },
  {
    legacyCommand: 'BN_MT_PASS',
    disposition: 'ALIASED_TO_CANONICAL_COMMAND',
    canonicalCommand: 'BN_MEANS_APPROVE',
    rationale: 'Pass is an approval decision; result PASS is produced by the calculation.',
  },
  {
    legacyCommand: 'BN_MT_FAIL',
    disposition: 'ALIASED_TO_CANONICAL_COMMAND',
    canonicalCommand: 'BN_MEANS_REJECT',
    rationale: 'Fail is a rejection decision under maker-checker.',
  },
  {
    legacyCommand: 'BN_MT_LINK_APPEAL',
    disposition: 'REPLACED_BY_GOVERNED_HANDOFF',
    handoffTargetModule: 'bn_appeals',
    rationale: 'Appeal linkage is raised through bn_cross_module_handoff; Appeals owns the appeal.',
  },
  {
    legacyCommand: 'BN_MT_APPLY_APPEAL_OVERTURN',
    disposition: 'REPLACED_BY_GOVERNED_HANDOFF',
    handoffTargetModule: 'bn_appeals',
    rationale:
      'An overturn is applied by creating a successor assessment (BN_MEANS_SUPERSEDE) from an Appeals handoff.',
  },
  {
    legacyCommand: 'BN_MT_ADD_LATE_EVIDENCE',
    disposition: 'RETIRED_DUPLICATE',
    rationale: 'Duplicate of BN_MEANS_ATTACH_EVIDENCE; lateness is a property of the evidence record.',
  },
  {
    legacyCommand: 'BN_MT_RERUN_ELIGIBILITY',
    disposition: 'ALIASED_TO_CANONICAL_COMMAND',
    canonicalCommand: 'BN_MEANS_ACTIVATE',
    rationale:
      'Activation publishes the versioned means.* fact bundle and requests an Eligibility rerun; Means Tests never runs a second engine.',
  },
  {
    legacyCommand: 'BN_MT_CREATE_AWARD_FROM_RERUN',
    disposition: 'REPLACED_BY_GOVERNED_HANDOFF',
    handoffTargetModule: 'bn_awards',
    rationale:
      'PROHIBITED as direct award creation. Means Tests may only raise an Award Review proposal; the Award module owns creation and amendment.',
  },
  {
    legacyCommand: 'BN_MT_CLOSE',
    disposition: 'ALIASED_TO_CANONICAL_COMMAND',
    canonicalCommand: 'BN_MEANS_CLOSE',
    rationale: 'Closure with structured justification in the canonical lifecycle.',
  },
];

/** Legacy commands that must never be implemented as direct mutations. */
export const BN_MEANS_PROHIBITED_LEGACY_COMMANDS: readonly BnMeansTestCommandName[] = [
  'BN_MT_CREATE_AWARD_FROM_RERUN',
];

export function getLegacyDisposition(
  legacy: BnMeansTestCommandName,
): BnMeansLegacyReconciliationEntry | undefined {
  return BN_MEANS_LEGACY_RECONCILIATION.find((e) => e.legacyCommand === legacy);
}

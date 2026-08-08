/**
 * BN Uprating — Canonical command catalogue (Slice 1).
 *
 * 17 canonical commands per the Uprating & Indexation epic. Distinct verb
 * suffixes so the legacy `BN_UPR_*` catalogue can coexist without name
 * collisions.
 */
import type { BnGapCapability } from '@/services/bn/commands/benefitsCapabilityRegistry';

export type BnUpratingCanonicalCommandName =
  | 'BN_UPRATING_CREATE_POLICY'
  | 'BN_UPRATING_CREATE_POLICY_VERSION'
  | 'BN_UPRATING_VALIDATE_POLICY'
  | 'BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL'
  | 'BN_UPRATING_APPROVE_POLICY'
  | 'BN_UPRATING_CREATE_RUN'
  | 'BN_UPRATING_BUILD_POPULATION'
  | 'BN_UPRATING_SIMULATE'
  | 'BN_UPRATING_RESOLVE_EXCEPTION'
  | 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL'
  | 'BN_UPRATING_APPROVE_RUN'
  | 'BN_UPRATING_SCHEDULE_EXECUTION'
  | 'BN_UPRATING_EXECUTE_BATCH'
  | 'BN_UPRATING_RETRY_FAILED'
  | 'BN_UPRATING_RECONCILE_RUN'
  | 'BN_UPRATING_ROLLBACK_ELIGIBLE'
  | 'BN_UPRATING_CLOSE_RUN';

export interface BnUpratingCanonicalCommandSpec {
  readonly command: BnUpratingCanonicalCommandName;
  readonly capability: BnGapCapability;
  readonly requiresMakerChecker: boolean;
  readonly transactional: boolean;
  readonly requiresJustification: boolean;
  readonly implemented: boolean;
}

export const BN_UPRATING_CANONICAL_COMMANDS: readonly BnUpratingCanonicalCommandSpec[] = [
  { command: 'BN_UPRATING_CREATE_POLICY',              capability: 'bn_uprating:write',  requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_CREATE_POLICY_VERSION',      capability: 'bn_uprating:write',  requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_VALIDATE_POLICY',            capability: 'bn_uprating:write',  requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL', capability: 'bn_uprating:write',  requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_APPROVE_POLICY',             capability: 'bn_uprating:admin',  requiresMakerChecker: true,  transactional: false, requiresJustification: true,  implemented: true },
  { command: 'BN_UPRATING_CREATE_RUN',                 capability: 'bn_uprating:write',  requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_BUILD_POPULATION',           capability: 'bn_uprating:decide', requiresMakerChecker: false, transactional: true,  requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_SIMULATE',                   capability: 'bn_uprating:decide', requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_RESOLVE_EXCEPTION',          capability: 'bn_uprating:decide', requiresMakerChecker: false, transactional: false, requiresJustification: true,  implemented: true },

  { command: 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL',    capability: 'bn_uprating:decide', requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_APPROVE_RUN',                capability: 'bn_uprating:admin',  requiresMakerChecker: true,  transactional: false, requiresJustification: true,  implemented: true },
  { command: 'BN_UPRATING_SCHEDULE_EXECUTION',         capability: 'bn_uprating:admin',  requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },

  { command: 'BN_UPRATING_EXECUTE_BATCH',              capability: 'bn_uprating:admin',  requiresMakerChecker: true,  transactional: true,  requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_RETRY_FAILED',               capability: 'bn_uprating:admin',  requiresMakerChecker: false, transactional: true,  requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_RECONCILE_RUN',              capability: 'bn_uprating:decide', requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
  { command: 'BN_UPRATING_ROLLBACK_ELIGIBLE',          capability: 'bn_uprating:admin',  requiresMakerChecker: true,  transactional: true,  requiresJustification: true,  implemented: true },

  { command: 'BN_UPRATING_CLOSE_RUN',                  capability: 'bn_uprating:decide', requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true },
] as const;

export function getUpratingCanonicalCommandSpec(
  command: BnUpratingCanonicalCommandName,
): BnUpratingCanonicalCommandSpec {
  const spec = BN_UPRATING_CANONICAL_COMMANDS.find((c) => c.command === command);
  if (!spec) throw new Error(`Unknown canonical BN_UPRATING command: ${command}`);
  return spec;
}

/**
 * BN Mortality — CANONICAL COMMAND CATALOGUE (single source of truth).
 *
 * BN-MORT-UI-1D §D: This is the ONE authoritative source of every field
 * describing a Mortality command. Both the browser catalogue
 * (`mortalityCommands.ts`) and the generated edge-function catalogue
 * (`supabase/functions/bn-benefits-query/_generated_command_catalog.ts`)
 * derive from this file.
 *
 * NEVER edit the generated edge file by hand — run
 * `scripts/bn/generate-mortality-command-catalog.ts` to regenerate it.
 * A parity test (`mortalityCommandCatalogParity.test.ts`) fails the
 * build if the two go out of sync.
 */

/** Event statuses used by the state machine (see MORTALITY_COMMAND_TRANSITION_MATRIX). */
export type BnMortalityStatus =
  | 'DRAFT' | 'REPORTED' | 'VERIFICATION_PENDING' | 'PROVISIONALLY_HELD'
  | 'CONFLICT' | 'VERIFIED' | 'REJECTED' | 'CANCELLED' | 'DUPLICATE'
  | 'IMPACT_REVIEW' | 'APPROVAL_PENDING' | 'CONFIRMED' | 'FOLLOW_ON_PROCESSING'
  | 'COMPLETED' | 'CLOSED' | 'REVERSED';

/** Data-readiness predicates the availability calculator understands. */
export type BnMortalityDataRequirement =
  | 'matchedIp'
  | 'verified'
  | 'impactPrepared'
  | 'impactApproved'
  | 'terminated'
  | 'referral';

/**
 * Maker-source: the command whose actor is the "maker" for maker-checker
 * separation. Used to derive `makerUserId`, `makerStep`, `makerSourceCommand`,
 * and `makerOccurredAt` in the action-availability DTO.
 */
export type BnMortalityMakerSource =
  | 'BN_MORTALITY_REGISTER_REPORT'      // fallback / event creator
  | 'BN_MORTALITY_SUBMIT_FOR_VERIFICATION'
  | 'BN_MORTALITY_PREPARE_IMPACT'
  | 'BN_MORTALITY_SUBMIT_IMPACT'
  | 'BN_MORTALITY_CONFIRM_VERIFICATION'
  | 'BN_MORTALITY_APPROVE_IMPACT';

/** Integration codes managed in `bn_mortality_integration_readiness`. */
export type BnMortalityIntegrationCode =
  | 'awards' | 'dms' | 'overpayments' | 'survivor' | 'funeral' | 'legal';

export interface BnMortalityCanonicalCommand {
  readonly command: string;
  readonly capability: string;
  readonly implemented: boolean;
  readonly blocker?: string;
  readonly requiresMakerChecker: boolean;
  readonly requiresJustification: boolean;
  readonly transactional: boolean;
  readonly validFrom: readonly BnMortalityStatus[];
  readonly makerSource?: BnMortalityMakerSource;
  readonly integrationRequired?: BnMortalityIntegrationCode;
  readonly dataRequires?: readonly BnMortalityDataRequirement[];
}


export const MORTALITY_COMMAND_CATALOG: readonly BnMortalityCanonicalCommand[] = [
  { command: 'BN_MORTALITY_DRAFT_SAVE', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['DRAFT'] },
  { command: 'BN_MORTALITY_REGISTER_REPORT', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['DRAFT', 'REPORTED'] },
  { command: 'BN_MORTALITY_CANCEL', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: true, transactional: false, validFrom: ['DRAFT', 'REPORTED'] },
  { command: 'BN_MORTALITY_MATCH_PERSON', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: true, validFrom: ['DRAFT', 'REPORTED', 'VERIFICATION_PENDING', 'CONFLICT'] },
  { command: 'BN_MORTALITY_MARK_DUPLICATE', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: true, transactional: false, validFrom: ['DRAFT', 'REPORTED', 'VERIFICATION_PENDING', 'CONFLICT'] },
  { command: 'BN_MORTALITY_ASSIGN', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['DRAFT', 'REPORTED', 'VERIFICATION_PENDING', 'CONFLICT', 'PROVISIONALLY_HELD', 'IMPACT_REVIEW', 'APPROVAL_PENDING', 'VERIFIED', 'CONFIRMED', 'FOLLOW_ON_PROCESSING'] },
  { command: 'BN_MORTALITY_ATTACH_EVIDENCE', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['DRAFT', 'REPORTED', 'VERIFICATION_PENDING', 'CONFLICT', 'PROVISIONALLY_HELD', 'IMPACT_REVIEW', 'APPROVAL_PENDING', 'VERIFIED', 'CONFIRMED', 'FOLLOW_ON_PROCESSING'], integrationRequired: 'dms' },
  { command: 'BN_MORTALITY_SUBMIT_FOR_VERIFICATION', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['DRAFT', 'REPORTED'], dataRequires: ['matchedIp'] },
  { command: 'BN_MORTALITY_PLACE_PROVISIONAL_HOLD', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: false, requiresJustification: true, transactional: true, validFrom: ['REPORTED', 'VERIFICATION_PENDING', 'CONFLICT', 'IMPACT_REVIEW', 'APPROVAL_PENDING'], integrationRequired: 'awards' },
  { command: 'BN_MORTALITY_RELEASE_HOLD', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: false, requiresJustification: true, transactional: true, validFrom: ['PROVISIONALLY_HELD'], integrationRequired: 'awards' },
  { command: 'BN_MORTALITY_RECORD_CONFLICT', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: true, transactional: false, validFrom: ['VERIFICATION_PENDING', 'PROVISIONALLY_HELD'] },
  { command: 'BN_MORTALITY_RESOLVE_CONFLICT', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: false, requiresJustification: true, transactional: false, validFrom: ['CONFLICT'] },
  { command: 'BN_MORTALITY_CONFIRM_VERIFICATION', capability: 'bn_mortality:verify', implemented: true, requiresMakerChecker: true, requiresJustification: false, transactional: true, validFrom: ['VERIFICATION_PENDING', 'PROVISIONALLY_HELD'], makerSource: 'BN_MORTALITY_SUBMIT_FOR_VERIFICATION' },
  { command: 'BN_MORTALITY_REJECT_REPORT', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: true, requiresJustification: true, transactional: false, validFrom: ['VERIFICATION_PENDING', 'CONFLICT', 'PROVISIONALLY_HELD'], makerSource: 'BN_MORTALITY_SUBMIT_FOR_VERIFICATION' },
  { command: 'BN_MORTALITY_PREPARE_IMPACT', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: true, validFrom: ['VERIFIED', 'IMPACT_REVIEW'], dataRequires: ['matchedIp', 'verified'] },
  { command: 'BN_MORTALITY_SUBMIT_IMPACT', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['IMPACT_REVIEW'], dataRequires: ['impactPrepared'] },
  { command: 'BN_MORTALITY_RETURN_IMPACT', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: false, requiresJustification: true, transactional: false, validFrom: ['APPROVAL_PENDING'] },
  { command: 'BN_MORTALITY_APPROVE_IMPACT', capability: 'bn_mortality:approve_impact', implemented: true, requiresMakerChecker: true, requiresJustification: false, transactional: true, validFrom: ['APPROVAL_PENDING'], makerSource: 'BN_MORTALITY_SUBMIT_IMPACT' },
  { command: 'BN_MORTALITY_TERMINATE_AWARD', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: true, requiresJustification: true, transactional: true, validFrom: ['CONFIRMED', 'FOLLOW_ON_PROCESSING'], makerSource: 'BN_MORTALITY_APPROVE_IMPACT', integrationRequired: 'awards', dataRequires: ['impactApproved'] },
  { command: 'BN_MORTALITY_CREATE_PAD_OVERPAYMENT', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: true, requiresJustification: true, transactional: true, validFrom: ['CONFIRMED', 'FOLLOW_ON_PROCESSING'], integrationRequired: 'overpayments', dataRequires: ['terminated'] },
  { command: 'BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['CONFIRMED', 'FOLLOW_ON_PROCESSING'], integrationRequired: 'survivor' },
  { command: 'BN_MORTALITY_INITIATE_FUNERAL_GRANT', capability: 'bn_mortality:write', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['CONFIRMED', 'FOLLOW_ON_PROCESSING'], integrationRequired: 'funeral' },
  { command: 'BN_MORTALITY_COMPLETE_FOLLOWON', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['FOLLOW_ON_PROCESSING'], dataRequires: ['referral'] },
  { command: 'BN_MORTALITY_REFER_LEGAL', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: true, requiresJustification: true, transactional: false, validFrom: ['CONFIRMED', 'FOLLOW_ON_PROCESSING'], integrationRequired: 'legal' },
  { command: 'BN_MORTALITY_REVERSE_CONFIRMATION', capability: 'bn_mortality:reverse', implemented: true, requiresMakerChecker: true, requiresJustification: true, transactional: true, validFrom: ['VERIFIED', 'CONFIRMED', 'FOLLOW_ON_PROCESSING', 'COMPLETED'], makerSource: 'BN_MORTALITY_CONFIRM_VERIFICATION' },
  { command: 'BN_MORTALITY_CLOSE_EVENT', capability: 'bn_mortality:decide', implemented: true, requiresMakerChecker: false, requiresJustification: false, transactional: false, validFrom: ['COMPLETED', 'REJECTED', 'REVERSED'] },
] as const;

/** Number of canonical commands the system must always expose. */
export const MORTALITY_COMMAND_COUNT = MORTALITY_COMMAND_CATALOG.length;

/** Serialisable form used by the generator to emit the mirrored edge artifact. */
export function serializeCatalogForGeneration(): string {
  return JSON.stringify(MORTALITY_COMMAND_CATALOG, null, 2);
}

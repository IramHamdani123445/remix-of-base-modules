/**
 * BN Means-Test — Command catalogue (18 canonical commands).
 *
 * Slice 1 of the Means-Test Assessment epic.
 *
 * Every mutation to a means-test record must flow through one of these
 * commands via the Gap Command Pipeline. Direct table inserts from the
 * browser are prohibited (enforced by the gap-modules architecture guard).
 */

import type { BnGapCapability } from '@/services/bn/commands/benefitsCapabilityRegistry';

export type BnMeansCommandName =
  | 'BN_MEANS_CREATE_ASSESSMENT'
  | 'BN_MEANS_ADD_HOUSEHOLD_MEMBER'
  | 'BN_MEANS_UPDATE_HOUSEHOLD_MEMBER'
  | 'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER'
  | 'BN_MEANS_CORRECT_CONTEXT'
  | 'BN_MEANS_ADD_INCOME'
  // EPIC 3 — governed supporting operations for the canonical income function.
  // `BN_MEANS_ADD_INCOME` remains the business command; these maintain drafts.
  | 'BN_MEANS_CORRECT_INCOME'
  | 'BN_MEANS_VOID_INCOME'
  | 'BN_MEANS_DECLARE_NO_INCOME'
  | 'BN_MEANS_WITHDRAW_NO_INCOME'
  | 'BN_MEANS_MARK_HOUSEHOLD_COMPLETE'
  | 'BN_MEANS_MARK_INCOME_COMPLETE'
  | 'BN_MEANS_ADD_ASSET'
  // EPIC 4 — governed supporting operations for asset declaration.
  | 'BN_MEANS_CORRECT_ASSET'
  | 'BN_MEANS_VOID_ASSET'
  | 'BN_MEANS_DECLARE_NO_ASSETS'
  | 'BN_MEANS_WITHDRAW_NO_ASSETS'
  | 'BN_MEANS_MARK_ASSETS_COMPLETE'
  | 'BN_MEANS_ADD_DEDUCTION'
  // EPIC 5 — governed supporting operations for deductions and disregards.
  | 'BN_MEANS_CORRECT_DEDUCTION'
  | 'BN_MEANS_VOID_DEDUCTION'
  | 'BN_MEANS_DECLARE_NO_DEDUCTIONS'
  | 'BN_MEANS_WITHDRAW_NO_DEDUCTIONS'
  | 'BN_MEANS_MARK_DEDUCTIONS_COMPLETE'
  | 'BN_MEANS_ATTACH_EVIDENCE'
  // EPIC 6 — governed supporting operations for evidence and information
  // requests. `BN_MEANS_ATTACH_EVIDENCE` remains the canonical business
  // command; these maintain the link register and the request register.
  | 'BN_MEANS_UNLINK_EVIDENCE'
  | 'BN_MEANS_RECORD_EVIDENCE_USABILITY'
  | 'BN_MEANS_REQUEST_INFORMATION'
  | 'BN_MEANS_RECORD_INFORMATION_RESPONSE'
  | 'BN_MEANS_CLOSE_INFORMATION_REQUEST'
  | 'BN_MEANS_MARK_EVIDENCE_COMPLETE'
  | 'BN_MEANS_REOPEN_EVIDENCE'
  | 'BN_MEANS_SUBMIT'
  | 'BN_MEANS_VERIFY_INFORMATION'
  // EPIC 8 — verification and clarification against the frozen version.
  | 'BN_MEANS_CLAIM_VERIFICATION_WORK'
  | 'BN_MEANS_RELEASE_VERIFICATION_WORK'
  | 'BN_MEANS_RECORD_VERIFICATION_DECISION'
  | 'BN_MEANS_RECORD_CLARIFICATION_RESPONSE'
  | 'BN_MEANS_CANCEL_CLARIFICATION'
  | 'BN_MEANS_REOPEN_VERIFICATION_FACT'
  | 'BN_MEANS_COMPLETE_VERIFICATION'
  | 'BN_MEANS_CALCULATE'
  | 'BN_MEANS_REQUEST_ADJUSTMENT'
  | 'BN_MEANS_APPROVE_ADJUSTMENT'
  | 'BN_MEANS_APPROVE'
  | 'BN_MEANS_REJECT'
  | 'BN_MEANS_ACTIVATE'
  | 'BN_MEANS_SCHEDULE_REASSESSMENT'
  | 'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE'
  | 'BN_MEANS_SUPERSEDE'
  | 'BN_MEANS_CLOSE';

export interface BnMeansCommandSpec {
  readonly command: BnMeansCommandName;
  readonly capability: BnGapCapability;
  readonly requiresMakerChecker: boolean;
  readonly transactional: boolean;
  /** Publishes canonical `means.*` facts into the eligibility engine. */
  readonly publishesFacts: boolean;
  /** Publishes a Communication Hub event via the sending façade. */
  readonly emitsCommunication: boolean;
  /** Self-approval denied — the requester cannot also approve. */
  readonly forbidsSelfApproval: boolean;
  /** Requires structured justification captured on the record. */
  readonly requiresJustification: boolean;
  /** Set true once server RPC + edge handler ship (Slice 3). */
  readonly implemented: boolean;
}

const S = (
  command: BnMeansCommandName,
  capability: BnGapCapability,
  opts: Partial<Omit<BnMeansCommandSpec, 'command' | 'capability'>> = {},
): BnMeansCommandSpec => ({
  command,
  capability,
  requiresMakerChecker: opts.requiresMakerChecker ?? false,
  transactional: opts.transactional ?? true,
  publishesFacts: opts.publishesFacts ?? false,
  emitsCommunication: opts.emitsCommunication ?? false,
  forbidsSelfApproval: opts.forbidsSelfApproval ?? false,
  requiresJustification: opts.requiresJustification ?? false,
  implemented: opts.implemented ?? false,
});

export const BN_MEANS_COMMANDS: readonly BnMeansCommandSpec[] = [
  // Authoring
  S('BN_MEANS_CREATE_ASSESSMENT',       'bn_means_tests:write'),
  S('BN_MEANS_ADD_HOUSEHOLD_MEMBER',    'bn_means_tests:write'),
  S('BN_MEANS_UPDATE_HOUSEHOLD_MEMBER', 'bn_means_tests:write'),
  S('BN_MEANS_REMOVE_HOUSEHOLD_MEMBER', 'bn_means_tests:write'),
  S('BN_MEANS_CORRECT_CONTEXT',         'bn_means_tests:write', { requiresJustification: true }),
  S('BN_MEANS_ADD_INCOME',              'bn_means_tests:write', { implemented: true }),
  // EPIC 3 supporting operations — versioned fact replacement and section state.
  S('BN_MEANS_CORRECT_INCOME',          'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_VOID_INCOME',             'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_DECLARE_NO_INCOME',       'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_WITHDRAW_NO_INCOME',      'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_MARK_HOUSEHOLD_COMPLETE', 'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_MARK_INCOME_COMPLETE',    'bn_means_tests:write', { implemented: true }),

  S('BN_MEANS_ADD_ASSET',               'bn_means_tests:write', { implemented: true }),
  // EPIC 4 supporting operations — versioned asset facts and section state.
  S('BN_MEANS_CORRECT_ASSET',           'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_VOID_ASSET',              'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_DECLARE_NO_ASSETS',       'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_WITHDRAW_NO_ASSETS',      'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_MARK_ASSETS_COMPLETE',    'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_ADD_DEDUCTION',           'bn_means_tests:write', { implemented: true }),
  // EPIC 5 supporting operations — versioned claims and section state.
  S('BN_MEANS_CORRECT_DEDUCTION',       'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_VOID_DEDUCTION',          'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_DECLARE_NO_DEDUCTIONS',   'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_WITHDRAW_NO_DEDUCTIONS',  'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_MARK_DEDUCTIONS_COMPLETE','bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_ATTACH_EVIDENCE',         'bn_means_tests:write', { implemented: true }),
  // EPIC 6 supporting operations — evidence link register and information requests.
  S('BN_MEANS_UNLINK_EVIDENCE',            'bn_means_tests:write', { implemented: true, requiresJustification: true }),
  S('BN_MEANS_RECORD_EVIDENCE_USABILITY',  'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_REQUEST_INFORMATION',        'bn_means_tests:write', { implemented: true, emitsCommunication: true }),
  S('BN_MEANS_RECORD_INFORMATION_RESPONSE','bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_CLOSE_INFORMATION_REQUEST',  'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_MARK_EVIDENCE_COMPLETE',     'bn_means_tests:write', { implemented: true }),
  S('BN_MEANS_REOPEN_EVIDENCE',            'bn_means_tests:write', { implemented: true }),

  // Submission & verification
  S('BN_MEANS_SUBMIT',                  'bn_means_tests:write',   { emitsCommunication: true }),
  S('BN_MEANS_VERIFY_INFORMATION',      'bn_means_tests:verify'),
  // EPIC 8 supporting operations — verification work, decisions, clarification.
  S('BN_MEANS_CLAIM_VERIFICATION_WORK',       'bn_means_tests:verify', { implemented: true }),
  S('BN_MEANS_RELEASE_VERIFICATION_WORK',     'bn_means_tests:verify', { implemented: true }),
  S('BN_MEANS_RECORD_VERIFICATION_DECISION',  'bn_means_tests:verify', { implemented: true, forbidsSelfApproval: true }),
  S('BN_MEANS_RECORD_CLARIFICATION_RESPONSE', 'bn_means_tests:verify', { implemented: true }),
  S('BN_MEANS_CANCEL_CLARIFICATION',          'bn_means_tests:verify', { implemented: true, requiresJustification: true }),
  S('BN_MEANS_REOPEN_VERIFICATION_FACT',      'bn_means_tests:verify', { implemented: true, requiresJustification: true }),
  S('BN_MEANS_COMPLETE_VERIFICATION',         'bn_means_tests:verify', { implemented: true, forbidsSelfApproval: true }),

  // Calculation & adjustment
  S('BN_MEANS_CALCULATE',               'bn_means_tests:decide'),
  S('BN_MEANS_REQUEST_ADJUSTMENT',      'bn_means_tests:adjust_request', { requiresJustification: true }),
  S('BN_MEANS_APPROVE_ADJUSTMENT',      'bn_means_tests:adjust_approve', { requiresMakerChecker: true, forbidsSelfApproval: true, requiresJustification: true }),

  // Approval
  S('BN_MEANS_APPROVE',                 'bn_means_tests:approve', { requiresMakerChecker: true, forbidsSelfApproval: true, emitsCommunication: true }),
  S('BN_MEANS_REJECT',                  'bn_means_tests:approve', { requiresMakerChecker: true, forbidsSelfApproval: true, requiresJustification: true, emitsCommunication: true }),

  // Activation & lifecycle
  S('BN_MEANS_ACTIVATE',                'bn_means_tests:approve', { publishesFacts: true }),
  S('BN_MEANS_SCHEDULE_REASSESSMENT',   'bn_means_tests:reassess'),
  S('BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE', 'bn_means_tests:write', { requiresJustification: true }),
  S('BN_MEANS_SUPERSEDE',               'bn_means_tests:approve', { publishesFacts: true, requiresJustification: true }),
  S('BN_MEANS_CLOSE',                   'bn_means_tests:approve', { requiresJustification: true }),
] as const;

const _lookup: Readonly<Record<BnMeansCommandName, BnMeansCommandSpec>> =
  Object.freeze(
    Object.fromEntries(BN_MEANS_COMMANDS.map((c) => [c.command, c])),
  ) as Record<BnMeansCommandName, BnMeansCommandSpec>;

export function getMeansCommandSpec(
  name: BnMeansCommandName,
): BnMeansCommandSpec | undefined {
  return _lookup[name];
}

/**
 * BN Overpayments — Canonical command catalogue (29 commands).
 *
 * Phase B4 reconciled the catalogue from 25 to 29 canonical commands by adding
 * the appeal-hold and recovery-suspension pairs:
 *
 *   BN_OVP_PLACE_APPEAL_HOLD / BN_OVP_RELEASE_APPEAL_HOLD
 *   BN_OVP_SUSPEND_RECOVERY  / BN_OVP_RESUME_RECOVERY
 *
 * Legacy names are retained for compatibility with pre-existing hooks only.
 * New code and UI MUST use the canonical names.
 *
 * Every mutation to an overpayment record must flow through the secured,
 * versioned RPC recorded in `rpc` below. Direct table writes from the browser
 * are prohibited and enforced by the architecture guard test.
 */

import type { BnGapCapability } from '@/services/bn/commands/benefitsCapabilityRegistry';

// ── Legacy names retained for compatibility with existing hooks ─────────
export type BnOverpaymentLegacyCommandName =
  | 'BN_OVP_ASSESS'
  | 'BN_OVP_NOTIFY'
  | 'BN_OVP_DISPUTE_OPEN'
  | 'BN_OVP_RECALCULATE'
  | 'BN_OVP_PROPOSE_ARRANGEMENT'
  | 'BN_OVP_ACTIVATE_ARRANGEMENT'
  | 'BN_OVP_RECORD_INSTALMENT'
  | 'BN_OVP_MARK_BREACHED'
  | 'BN_OVP_WRITE_OFF'
  | 'BN_OVP_REFER_LEGAL'
  | 'BN_OVP_CLOSE';

// ── Canonical 29-command catalogue ──────────────────────────────────────
export type BnOverpaymentCanonicalCommandName =
  | 'BN_OVP_CREATE_CANDIDATE'
  | 'BN_OVP_CALCULATE_LIABILITY'
  | 'BN_OVP_VERIFY'
  | 'BN_OVP_ISSUE_NOTICE'
  | 'BN_OVP_RECORD_REPRESENTATION'
  | 'BN_OVP_CONFIRM_LIABILITY'
  | 'BN_OVP_PROPOSE_RECOVERY_PLAN'
  | 'BN_OVP_APPROVE_RECOVERY_PLAN'
  | 'BN_OVP_REJECT_RECOVERY_PLAN'
  | 'BN_OVP_REVISE_RECOVERY_PLAN'
  | 'BN_OVP_ACTIVATE_BENEFIT_DEDUCTION'
  | 'BN_OVP_RECORD_RECEIPT'
  | 'BN_OVP_ALLOCATE_RECEIPT'
  | 'BN_OVP_REQUEST_WAIVER'
  | 'BN_OVP_APPROVE_WAIVER'
  | 'BN_OVP_REJECT_WAIVER'
  | 'BN_OVP_REQUEST_WRITEOFF'
  | 'BN_OVP_APPROVE_WRITEOFF'
  | 'BN_OVP_REJECT_WRITEOFF'
  | 'BN_OVP_REFER_LEGAL'
  | 'BN_OVP_REFER_ESTATE'
  | 'BN_OVP_REVERSE_TRANSACTION'
  | 'BN_OVP_RECONCILE'
  | 'BN_OVP_CLOSE'
  | 'BN_OVP_REOPEN'
  | 'BN_OVP_PLACE_APPEAL_HOLD'
  | 'BN_OVP_RELEASE_APPEAL_HOLD'
  | 'BN_OVP_SUSPEND_RECOVERY'
  | 'BN_OVP_RESUME_RECOVERY';

export type BnOverpaymentCommandName =
  | BnOverpaymentCanonicalCommandName
  | BnOverpaymentLegacyCommandName;

/** Legacy → canonical alias map (compatibility only). */
export const BN_OVERPAYMENT_LEGACY_ALIASES: Readonly<
  Partial<Record<BnOverpaymentLegacyCommandName, BnOverpaymentCanonicalCommandName>>
> = Object.freeze({
  BN_OVP_ASSESS: 'BN_OVP_CALCULATE_LIABILITY',
  BN_OVP_NOTIFY: 'BN_OVP_ISSUE_NOTICE',
  BN_OVP_DISPUTE_OPEN: 'BN_OVP_RECORD_REPRESENTATION',
  BN_OVP_RECALCULATE: 'BN_OVP_CALCULATE_LIABILITY',
  BN_OVP_PROPOSE_ARRANGEMENT: 'BN_OVP_PROPOSE_RECOVERY_PLAN',
  BN_OVP_ACTIVATE_ARRANGEMENT: 'BN_OVP_ACTIVATE_BENEFIT_DEDUCTION',
  BN_OVP_RECORD_INSTALMENT: 'BN_OVP_RECORD_RECEIPT',
  BN_OVP_WRITE_OFF: 'BN_OVP_APPROVE_WRITEOFF',
  BN_OVP_REFER_LEGAL: 'BN_OVP_REFER_LEGAL',
  BN_OVP_CLOSE: 'BN_OVP_CLOSE',
} as const);

/** Granular Overpayment action codes (B6). Mirrors bn_op_action_definition. */
export type BnOverpaymentAction =
  | 'view'
  | 'create_candidate'
  | 'calculate_liability'
  | 'verify'
  | 'issue_notice'
  | 'record_representation'
  | 'confirm_liability'
  | 'propose_recovery_plan'
  | 'approve_recovery_plan'
  | 'activate_deduction'
  | 'record_receipt'
  | 'allocate_receipt'
  | 'request_waiver'
  | 'approve_waiver'
  | 'request_writeoff'
  | 'approve_writeoff'
  | 'place_appeal_hold'
  | 'release_appeal_hold'
  | 'suspend_recovery'
  | 'resume_recovery'
  | 'refer_legal'
  | 'refer_estate'
  | 'reverse_transaction'
  | 'reconcile'
  | 'close'
  | 'reopen'
  | 'view_financial_detail'
  | 'audit'
  | 'admin';

export const BN_OVERPAYMENT_ACTIONS: readonly BnOverpaymentAction[] = [
  'view', 'create_candidate', 'calculate_liability', 'verify', 'issue_notice',
  'record_representation', 'confirm_liability', 'propose_recovery_plan',
  'approve_recovery_plan', 'activate_deduction', 'record_receipt', 'allocate_receipt',
  'request_waiver', 'approve_waiver', 'request_writeoff', 'approve_writeoff',
  'place_appeal_hold', 'release_appeal_hold', 'suspend_recovery', 'resume_recovery',
  'refer_legal', 'refer_estate', 'reverse_transaction', 'reconcile', 'close',
  'reopen', 'view_financial_detail', 'audit', 'admin',
] as const;

export type BnOverpaymentCaseStatus =
  | 'CANDIDATE' | 'CALCULATED' | 'VERIFIED' | 'NOTICE_ISSUED' | 'REPRESENTATION'
  | 'LIABILITY_CONFIRMED' | 'PLAN_PROPOSED' | 'PLAN_APPROVED' | 'IN_RECOVERY'
  | 'SUSPENDED' | 'ON_APPEAL_HOLD' | 'RECONCILED' | 'CLOSED' | 'CANCELLED';

export interface BnOverpaymentCommandSpec {
  readonly command: BnOverpaymentCommandName;
  readonly capability: BnGapCapability;
  /** Secured versioned database RPC that implements this command. */
  readonly rpc: string;
  /** Granular permission enforced server side (never broad benefits_management). */
  readonly action: BnOverpaymentAction;
  /** Valid source states; `null` means the command creates the record. */
  readonly sourceStates: readonly BnOverpaymentCaseStatus[] | null;
  /** Resulting case state; `null` means the case state is unchanged. */
  readonly resultState: BnOverpaymentCaseStatus | null;
  readonly requiresMakerChecker: boolean;
  readonly transactional: boolean;
  /** Emits a signed contra event on `bn_op_recovery_transaction` (Model A). */
  readonly writesLedger: boolean;
  /** Creates a communication intent through the Benefits façade. */
  readonly emitsCommunication: boolean;
  /** Creates a Finance posting intent (outbox), never a direct ledger write. */
  readonly emitsFinanceIntent: boolean;
  /** Creates or updates a Legal/Estate referral through the referral façade. */
  readonly emitsLegalEffect: boolean;
  /** Self-approval (same actor as the maker) is denied. */
  readonly forbidsSelfApproval: boolean;
  /** Caller must supply the current row version. */
  readonly requiresRowVersion: boolean;
  /** Caller must supply an idempotency key. */
  readonly requiresIdempotencyKey: boolean;
  /** Audit event code written to bn_op_event. */
  readonly auditEvent: string;
  /** True only when SQL command + typed service + certification evidence exist. */
  readonly implemented: boolean;
}

type SpecOpts = Partial<Omit<BnOverpaymentCommandSpec, 'command' | 'capability' | 'rpc' | 'action' | 'auditEvent'>>;

const S = (
  command: BnOverpaymentCanonicalCommandName,
  capability: BnGapCapability,
  rpc: string,
  action: BnOverpaymentAction,
  auditEvent: string,
  opts: SpecOpts = {},
): BnOverpaymentCommandSpec => ({
  command,
  capability,
  rpc,
  action,
  auditEvent,
  sourceStates: opts.sourceStates ?? null,
  resultState: opts.resultState ?? null,
  requiresMakerChecker: opts.requiresMakerChecker ?? false,
  transactional: opts.transactional ?? true,
  writesLedger: opts.writesLedger ?? false,
  emitsCommunication: opts.emitsCommunication ?? false,
  emitsFinanceIntent: opts.emitsFinanceIntent ?? false,
  emitsLegalEffect: opts.emitsLegalEffect ?? false,
  forbidsSelfApproval: opts.forbidsSelfApproval ?? false,
  requiresRowVersion: opts.requiresRowVersion ?? true,
  requiresIdempotencyKey: opts.requiresIdempotencyKey ?? true,
  implemented: opts.implemented ?? true,
});

export const BN_OVERPAYMENT_COMMANDS: readonly BnOverpaymentCommandSpec[] = [
  // Detection & verification
  S('BN_OVP_CREATE_CANDIDATE', 'bn_overpayments:write',
    'bn_overpayment_create_candidate_v1', 'create_candidate', 'CASE_CREATED',
    { sourceStates: null, resultState: 'CANDIDATE', requiresRowVersion: false }),
  S('BN_OVP_CALCULATE_LIABILITY', 'bn_overpayments:write',
    'bn_overpayment_calculate_liability_v1', 'calculate_liability', 'LIABILITY_CALCULATED',
    { sourceStates: ['CANDIDATE', 'CALCULATED', 'REPRESENTATION'], resultState: 'CALCULATED' }),
  S('BN_OVP_VERIFY', 'bn_overpayments:decide',
    'bn_overpayment_verify_v1', 'verify', 'CASE_VERIFIED',
    { sourceStates: ['CALCULATED'], resultState: 'VERIFIED',
      requiresMakerChecker: true, forbidsSelfApproval: true }),

  // Notice & representation
  S('BN_OVP_ISSUE_NOTICE', 'bn_overpayments:decide',
    'bn_overpayment_issue_notice_v1', 'issue_notice', 'NOTICE_ISSUED',
    { sourceStates: ['VERIFIED'], resultState: 'NOTICE_ISSUED', emitsCommunication: true }),
  S('BN_OVP_RECORD_REPRESENTATION', 'bn_overpayments:write',
    'bn_overpayment_record_representation_v1', 'record_representation', 'REPRESENTATION_RECORDED',
    { sourceStates: ['NOTICE_ISSUED', 'REPRESENTATION'], resultState: 'REPRESENTATION' }),
  S('BN_OVP_CONFIRM_LIABILITY', 'bn_overpayments:decide',
    'bn_overpayment_confirm_liability_v1', 'confirm_liability', 'LIABILITY_CONFIRMED',
    { sourceStates: ['VERIFIED', 'NOTICE_ISSUED', 'REPRESENTATION'], resultState: 'LIABILITY_CONFIRMED',
      requiresMakerChecker: true, forbidsSelfApproval: true, writesLedger: true,
      emitsFinanceIntent: true, emitsCommunication: true }),

  // Recovery plan
  S('BN_OVP_PROPOSE_RECOVERY_PLAN', 'bn_overpayments:write',
    'bn_overpayment_propose_recovery_plan_v1', 'propose_recovery_plan', 'PLAN_PROPOSED',
    { sourceStates: ['LIABILITY_CONFIRMED', 'PLAN_PROPOSED', 'IN_RECOVERY'], resultState: 'PLAN_PROPOSED' }),
  S('BN_OVP_APPROVE_RECOVERY_PLAN', 'bn_overpayments:decide',
    'bn_overpayment_approve_recovery_plan_v1', 'approve_recovery_plan', 'PLAN_APPROVED',
    { sourceStates: ['PLAN_PROPOSED'], resultState: 'PLAN_APPROVED',
      requiresMakerChecker: true, forbidsSelfApproval: true, emitsCommunication: true }),
  S('BN_OVP_REJECT_RECOVERY_PLAN', 'bn_overpayments:decide',
    'bn_overpayment_reject_recovery_plan_v1', 'approve_recovery_plan', 'PLAN_REJECTED',
    { sourceStates: ['PLAN_PROPOSED'], resultState: 'LIABILITY_CONFIRMED',
      requiresMakerChecker: true, forbidsSelfApproval: true }),
  S('BN_OVP_REVISE_RECOVERY_PLAN', 'bn_overpayments:write',
    'bn_overpayment_revise_recovery_plan_v1', 'propose_recovery_plan', 'PLAN_REVISED',
    { sourceStates: ['PLAN_PROPOSED', 'LIABILITY_CONFIRMED'], resultState: 'PLAN_PROPOSED' }),
  S('BN_OVP_ACTIVATE_BENEFIT_DEDUCTION', 'bn_overpayments:decide',
    'bn_overpayment_activate_benefit_deduction_v1', 'activate_deduction', 'DEDUCTION_ACTIVATED',
    { sourceStates: ['PLAN_APPROVED', 'IN_RECOVERY'], resultState: 'IN_RECOVERY',
      requiresMakerChecker: true }),

  // Receipts & allocation (finance boundary)
  S('BN_OVP_RECORD_RECEIPT', 'bn_overpayments:write',
    'bn_overpayment_record_receipt_v1', 'record_receipt', 'RECEIPT_RECORDED',
    { sourceStates: ['LIABILITY_CONFIRMED', 'PLAN_PROPOSED', 'PLAN_APPROVED', 'IN_RECOVERY', 'ON_APPEAL_HOLD'],
      writesLedger: true, emitsFinanceIntent: true }),
  S('BN_OVP_ALLOCATE_RECEIPT', 'bn_overpayments:write',
    'bn_overpayment_allocate_receipt_v1', 'allocate_receipt', 'RECEIPT_ALLOCATED',
    { requiresRowVersion: false, writesLedger: true, emitsFinanceIntent: true }),

  // Waiver
  S('BN_OVP_REQUEST_WAIVER', 'bn_overpayments:write',
    'bn_overpayment_request_waiver_v1', 'request_waiver', 'WAIVER_REQUESTED'),
  S('BN_OVP_APPROVE_WAIVER', 'bn_overpayments:admin',
    'bn_overpayment_approve_waiver_v1', 'approve_waiver', 'WAIVER_APPROVED',
    { requiresMakerChecker: true, forbidsSelfApproval: true, writesLedger: true,
      emitsFinanceIntent: true, emitsCommunication: true }),
  S('BN_OVP_REJECT_WAIVER', 'bn_overpayments:admin',
    'bn_overpayment_reject_waiver_v1', 'approve_waiver', 'WAIVER_REJECTED',
    { requiresMakerChecker: true, forbidsSelfApproval: true }),

  // Write-off
  S('BN_OVP_REQUEST_WRITEOFF', 'bn_overpayments:write',
    'bn_overpayment_request_writeoff_v1', 'request_writeoff', 'WRITEOFF_REQUESTED'),
  S('BN_OVP_APPROVE_WRITEOFF', 'bn_overpayments:admin',
    'bn_overpayment_approve_writeoff_v1', 'approve_writeoff', 'WRITEOFF_APPROVED',
    { requiresMakerChecker: true, forbidsSelfApproval: true, writesLedger: true,
      emitsFinanceIntent: true }),
  S('BN_OVP_REJECT_WRITEOFF', 'bn_overpayments:admin',
    'bn_overpayment_reject_writeoff_v1', 'approve_writeoff', 'WRITEOFF_REJECTED',
    { requiresMakerChecker: true, forbidsSelfApproval: true }),

  // Referrals
  S('BN_OVP_REFER_LEGAL', 'bn_overpayments:decide',
    'bn_overpayment_refer_legal_v1', 'refer_legal', 'LEGAL_REFERRED',
    { requiresMakerChecker: true, emitsLegalEffect: true }),
  S('BN_OVP_REFER_ESTATE', 'bn_overpayments:decide',
    'bn_overpayment_refer_estate_v1', 'refer_estate', 'ESTATE_REFERRED',
    { requiresMakerChecker: true, emitsLegalEffect: true }),

  // Adjustment & closure
  S('BN_OVP_REVERSE_TRANSACTION', 'bn_overpayments:admin',
    'bn_overpayment_reverse_transaction_v1', 'reverse_transaction', 'TRANSACTION_REVERSED',
    { requiresMakerChecker: true, forbidsSelfApproval: true, writesLedger: true,
      emitsFinanceIntent: true, requiresRowVersion: false }),
  S('BN_OVP_RECONCILE', 'bn_overpayments:decide',
    'bn_overpayment_reconcile_v1', 'reconcile', 'RECONCILED',
    { resultState: 'RECONCILED', requiresRowVersion: false }),
  S('BN_OVP_CLOSE', 'bn_overpayments:decide',
    'bn_overpayment_close_v1', 'close', 'CASE_CLOSED', { resultState: 'CLOSED' }),
  S('BN_OVP_REOPEN', 'bn_overpayments:admin',
    'bn_overpayment_reopen_v1', 'reopen', 'CASE_REOPENED',
    { sourceStates: ['CLOSED'], resultState: 'LIABILITY_CONFIRMED' }),

  // Appeal hold & recovery suspension (B4 additions)
  S('BN_OVP_PLACE_APPEAL_HOLD', 'bn_overpayments:decide',
    'bn_overpayment_place_appeal_hold_v1', 'place_appeal_hold', 'APPEAL_HOLD_PLACED',
    { resultState: 'ON_APPEAL_HOLD' }),
  S('BN_OVP_RELEASE_APPEAL_HOLD', 'bn_overpayments:decide',
    'bn_overpayment_release_appeal_hold_v1', 'release_appeal_hold', 'APPEAL_HOLD_RELEASED',
    { sourceStates: ['ON_APPEAL_HOLD'] }),
  S('BN_OVP_SUSPEND_RECOVERY', 'bn_overpayments:decide',
    'bn_overpayment_suspend_recovery_v1', 'suspend_recovery', 'RECOVERY_SUSPENDED',
    { resultState: 'SUSPENDED' }),
  S('BN_OVP_RESUME_RECOVERY', 'bn_overpayments:decide',
    'bn_overpayment_resume_recovery_v1', 'resume_recovery', 'RECOVERY_RESUMED',
    { sourceStates: ['SUSPENDED'] }),
] as const;

/** Canonical command count — asserted by the catalogue parity test. */
export const BN_OVERPAYMENT_CANONICAL_COMMAND_COUNT = 29;

const _lookup: Readonly<Record<string, BnOverpaymentCommandSpec>> = Object.freeze(
  Object.fromEntries(BN_OVERPAYMENT_COMMANDS.map((c) => [c.command, c])),
);

export function getOverpaymentCommandSpec(
  name: BnOverpaymentCommandName,
): BnOverpaymentCommandSpec | undefined {
  const direct = _lookup[name];
  if (direct) return direct;
  const alias = BN_OVERPAYMENT_LEGACY_ALIASES[name as BnOverpaymentLegacyCommandName];
  return alias ? _lookup[alias] : undefined;
}

/** Stable server error codes surfaced by the command boundary (B5). */
export const BN_OVERPAYMENT_ERROR_CODES = [
  'E_UNAUTHENTICATED',
  'E_ACTIONS_DISABLED',
  'E_PERMISSION_DENIED',
  'E_RECORD_SCOPE',
  'E_INVALID_STATE',
  'E_STALE_ROW_VERSION',
  'E_IDEMPOTENCY_KEY_REUSED',
  'E_IDEMPOTENCY_PAYLOAD_MISMATCH',
  'E_SELF_APPROVAL',
  'E_AMOUNT_INVALID',
  'E_CURRENCY_MISMATCH',
  'E_OVER_REVERSAL',
  'E_APPEAL_HOLD',
  'E_RECOVERY_SUSPENDED',
  'E_CASE_CLOSED',
] as const;

export type BnOverpaymentErrorCode = (typeof BN_OVERPAYMENT_ERROR_CODES)[number];

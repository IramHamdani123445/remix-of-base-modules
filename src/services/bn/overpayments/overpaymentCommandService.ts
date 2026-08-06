/**
 * BN Overpayments — typed command service (Phase B5 / B11).
 *
 * The ONLY browser-side path that mutates Overpayment state. Every function
 * calls a secured, versioned `bn_overpayment_*_v1` RPC. No direct table
 * insert/update/upsert/delete is permitted anywhere in this module — the
 * architecture guard test enforces that.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  BN_OVERPAYMENT_ERROR_CODES,
  type BnOverpaymentErrorCode,
} from '@/types/bn/overpayments/overpaymentCommands';

export interface BnOverpaymentCommandEnvelope {
  ok: true;
  command: string;
  case_id: string;
  status: string;
  row_version: number;
  outstanding_amount: number;
  currency: string;
  data: Record<string, unknown>;
}

export class BnOverpaymentCommandError extends Error {
  readonly code: BnOverpaymentErrorCode | 'E_UNKNOWN';
  constructor(message: string, code: BnOverpaymentErrorCode | 'E_UNKNOWN') {
    super(message);
    this.name = 'BnOverpaymentCommandError';
    this.code = code;
  }
}

export function parseOverpaymentError(message: string): BnOverpaymentErrorCode | 'E_UNKNOWN' {
  for (const code of BN_OVERPAYMENT_ERROR_CODES) {
    if (message.includes(code)) return code;
  }
  return 'E_UNKNOWN';
}

/** Deterministic idempotency key for a command + case + payload discriminator. */
export function overpaymentIdempotencyKey(
  command: string,
  caseId: string | null,
  discriminator: string,
): string {
  return `${command}:${caseId ?? 'NEW'}:${discriminator}`;
}

async function call(
  rpc: string,
  args: Record<string, unknown>,
): Promise<BnOverpaymentCommandEnvelope> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(rpc, args);
  if (error) {
    throw new BnOverpaymentCommandError(error.message, parseOverpaymentError(error.message));
  }
  return data as BnOverpaymentCommandEnvelope;
}

export const overpaymentCommandService = {
  createCandidate: (p: {
    awardId: string | null; reasonCode: string; periodFrom?: string | null;
    periodTo?: string | null; currency?: string; detectionSource?: string;
    idempotencyKey: string;
  }) => call('bn_overpayment_create_candidate_v1', {
    p_award_id: p.awardId, p_reason_code: p.reasonCode,
    p_period_from: p.periodFrom ?? null, p_period_to: p.periodTo ?? null,
    p_currency: p.currency ?? 'XCD', p_detection_source: p.detectionSource ?? 'MANUAL',
    p_idempotency_key: p.idempotencyKey,
  }),

  calculateLiability: (p: {
    caseId: string; rowVersion: number; grossAmount: number; currency?: string;
    methodCode?: string; basis?: Record<string, unknown>; idempotencyKey: string;
  }) => call('bn_overpayment_calculate_liability_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_gross_amount: p.grossAmount,
    p_currency: p.currency ?? null, p_method_code: p.methodCode ?? 'MANUAL',
    p_basis: p.basis ?? {}, p_idempotency_key: p.idempotencyKey,
  }),

  verify: (p: { caseId: string; rowVersion: number; note?: string; idempotencyKey: string }) =>
    call('bn_overpayment_verify_v1', {
      p_case_id: p.caseId, p_row_version: p.rowVersion,
      p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  issueNotice: (p: { caseId: string; rowVersion: number; recipientRef?: string; idempotencyKey: string }) =>
    call('bn_overpayment_issue_notice_v1', {
      p_case_id: p.caseId, p_row_version: p.rowVersion,
      p_recipient_ref: p.recipientRef ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  recordRepresentation: (p: {
    caseId: string; rowVersion: number; summary: string; channel?: string; idempotencyKey: string;
  }) => call('bn_overpayment_record_representation_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_summary: p.summary,
    p_channel: p.channel ?? 'WRITTEN', p_idempotency_key: p.idempotencyKey,
  }),

  confirmLiability: (p: { caseId: string; rowVersion: number; note?: string; idempotencyKey: string }) =>
    call('bn_overpayment_confirm_liability_v1', {
      p_case_id: p.caseId, p_row_version: p.rowVersion,
      p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  proposeRecoveryPlan: (p: {
    caseId: string; rowVersion: number; totalAmount: number; instalmentAmount: number;
    frequencyCode?: string; methodCode?: string; startDate?: string | null;
    currency?: string; idempotencyKey: string;
  }) => call('bn_overpayment_propose_recovery_plan_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_total_amount: p.totalAmount,
    p_instalment_amount: p.instalmentAmount, p_frequency_code: p.frequencyCode ?? 'MONTHLY',
    p_method_code: p.methodCode ?? 'BENEFIT_DEDUCTION', p_start_date: p.startDate ?? null,
    p_currency: p.currency ?? null, p_idempotency_key: p.idempotencyKey,
  }),

  approveRecoveryPlan: (p: { caseId: string; planId: string; planRowVersion: number; idempotencyKey: string }) =>
    call('bn_overpayment_approve_recovery_plan_v1', {
      p_case_id: p.caseId, p_plan_id: p.planId,
      p_plan_row_version: p.planRowVersion, p_idempotency_key: p.idempotencyKey,
    }),

  rejectRecoveryPlan: (p: {
    caseId: string; planId: string; planRowVersion: number; reason?: string; idempotencyKey: string;
  }) => call('bn_overpayment_reject_recovery_plan_v1', {
    p_case_id: p.caseId, p_plan_id: p.planId, p_plan_row_version: p.planRowVersion,
    p_reason: p.reason ?? null, p_idempotency_key: p.idempotencyKey,
  }),

  reviseRecoveryPlan: (p: {
    caseId: string; planId: string; planRowVersion: number; instalmentAmount: number; idempotencyKey: string;
  }) => call('bn_overpayment_revise_recovery_plan_v1', {
    p_case_id: p.caseId, p_plan_id: p.planId, p_plan_row_version: p.planRowVersion,
    p_instalment_amount: p.instalmentAmount, p_idempotency_key: p.idempotencyKey,
  }),

  activateBenefitDeduction: (p: {
    caseId: string; planId: string; rowVersion: number; amountPerCycle: number;
    currency?: string; idempotencyKey: string;
  }) => call('bn_overpayment_activate_benefit_deduction_v1', {
    p_case_id: p.caseId, p_plan_id: p.planId, p_row_version: p.rowVersion,
    p_amount_per_cycle: p.amountPerCycle, p_currency: p.currency ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  recordReceipt: (p: {
    caseId: string; rowVersion: number; amount: number; currency?: string;
    sourceReference?: string; idempotencyKey: string;
  }) => call('bn_overpayment_record_receipt_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_amount: p.amount,
    p_currency: p.currency ?? null, p_source_reference: p.sourceReference ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  allocateReceipt: (p: {
    caseId: string; transactionId: string; instalmentId?: string | null; amount: number;
    currency?: string; idempotencyKey: string;
  }) => call('bn_overpayment_allocate_receipt_v1', {
    p_case_id: p.caseId, p_transaction_id: p.transactionId,
    p_instalment_id: p.instalmentId ?? null, p_amount: p.amount,
    p_currency: p.currency ?? null, p_idempotency_key: p.idempotencyKey,
  }),

  requestWaiver: (p: {
    caseId: string; rowVersion: number; amount?: number | null; isFull?: boolean;
    groundCode: string; justification?: string; currency?: string; idempotencyKey: string;
  }) => call('bn_overpayment_request_waiver_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_amount: p.amount ?? null,
    p_is_full: p.isFull ?? false, p_ground_code: p.groundCode,
    p_justification: p.justification ?? null, p_currency: p.currency ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  approveWaiver: (p: { caseId: string; waiverId: string; rowVersion: number; note?: string; idempotencyKey: string }) =>
    call('bn_overpayment_approve_waiver_v1', {
      p_case_id: p.caseId, p_waiver_id: p.waiverId, p_row_version: p.rowVersion,
      p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  rejectWaiver: (p: { caseId: string; waiverId: string; rowVersion: number; note?: string; idempotencyKey: string }) =>
    call('bn_overpayment_reject_waiver_v1', {
      p_case_id: p.caseId, p_waiver_id: p.waiverId, p_row_version: p.rowVersion,
      p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  requestWriteoff: (p: {
    caseId: string; rowVersion: number; amount?: number | null; isFull?: boolean;
    groundCode: string; justification?: string; currency?: string; idempotencyKey: string;
  }) => call('bn_overpayment_request_writeoff_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_amount: p.amount ?? null,
    p_is_full: p.isFull ?? false, p_ground_code: p.groundCode,
    p_justification: p.justification ?? null, p_currency: p.currency ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  approveWriteoff: (p: { caseId: string; writeoffId: string; rowVersion: number; note?: string; idempotencyKey: string }) =>
    call('bn_overpayment_approve_writeoff_v1', {
      p_case_id: p.caseId, p_writeoff_id: p.writeoffId, p_row_version: p.rowVersion,
      p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  rejectWriteoff: (p: { caseId: string; writeoffId: string; rowVersion: number; note?: string; idempotencyKey: string }) =>
    call('bn_overpayment_reject_writeoff_v1', {
      p_case_id: p.caseId, p_writeoff_id: p.writeoffId, p_row_version: p.rowVersion,
      p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  referLegal: (p: {
    caseId: string; rowVersion: number; amount: number; currency?: string;
    externalCaseRef?: string | null; idempotencyKey: string;
  }) => call('bn_overpayment_refer_legal_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_amount: p.amount,
    p_currency: p.currency ?? null, p_external_case_ref: p.externalCaseRef ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  referEstate: (p: {
    caseId: string; rowVersion: number; amount: number; currency?: string;
    deceasedReference?: string | null; idempotencyKey: string;
  }) => call('bn_overpayment_refer_estate_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion, p_amount: p.amount,
    p_currency: p.currency ?? null, p_deceased_reference: p.deceasedReference ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  reverseTransaction: (p: {
    caseId: string; transactionId: string; amount?: number | null; currency?: string;
    reason?: string; idempotencyKey: string;
  }) => call('bn_overpayment_reverse_transaction_v1', {
    p_case_id: p.caseId, p_transaction_id: p.transactionId, p_amount: p.amount ?? null,
    p_currency: p.currency ?? null, p_reason: p.reason ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  reconcile: (p: {
    caseId: string; financeBalance: number; currency?: string; note?: string; idempotencyKey: string;
  }) => call('bn_overpayment_reconcile_v1', {
    p_case_id: p.caseId, p_finance_balance: p.financeBalance,
    p_currency: p.currency ?? null, p_note: p.note ?? null, p_idempotency_key: p.idempotencyKey,
  }),

  close: (p: { caseId: string; rowVersion: number; reason?: string; idempotencyKey: string }) =>
    call('bn_overpayment_close_v1', {
      p_case_id: p.caseId, p_row_version: p.rowVersion,
      p_reason: p.reason ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  reopen: (p: { caseId: string; rowVersion: number; reason?: string; idempotencyKey: string }) =>
    call('bn_overpayment_reopen_v1', {
      p_case_id: p.caseId, p_row_version: p.rowVersion,
      p_reason: p.reason ?? null, p_idempotency_key: p.idempotencyKey,
    }),

  placeAppealHold: (p: {
    caseId: string; rowVersion: number; appealReference?: string | null;
    reason?: string; idempotencyKey: string;
  }) => call('bn_overpayment_place_appeal_hold_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion,
    p_appeal_reference: p.appealReference ?? null, p_reason: p.reason ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  releaseAppealHold: (p: {
    caseId: string; holdId: string; rowVersion: number; appealOutcome: string; idempotencyKey: string;
  }) => call('bn_overpayment_release_appeal_hold_v1', {
    p_case_id: p.caseId, p_hold_id: p.holdId, p_row_version: p.rowVersion,
    p_appeal_outcome: p.appealOutcome, p_idempotency_key: p.idempotencyKey,
  }),

  suspendRecovery: (p: {
    caseId: string; rowVersion: number; reasonCode?: string; reason?: string; idempotencyKey: string;
  }) => call('bn_overpayment_suspend_recovery_v1', {
    p_case_id: p.caseId, p_row_version: p.rowVersion,
    p_reason_code: p.reasonCode ?? 'HARDSHIP', p_reason: p.reason ?? null,
    p_idempotency_key: p.idempotencyKey,
  }),

  resumeRecovery: (p: { caseId: string; suspensionId: string; rowVersion: number; idempotencyKey: string }) =>
    call('bn_overpayment_resume_recovery_v1', {
      p_case_id: p.caseId, p_suspension_id: p.suspensionId,
      p_row_version: p.rowVersion, p_idempotency_key: p.idempotencyKey,
    }),
} as const;

export type BnOverpaymentCommandService = typeof overpaymentCommandService;

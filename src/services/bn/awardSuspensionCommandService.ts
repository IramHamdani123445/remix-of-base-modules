/**
 * BN Award Suspension — Execution & Reinstatement command service.
 *
 * The ONLY browser entry point for operational award-suspension mutations.
 * Every function here calls a versioned, SECURITY DEFINER server command.
 * Nothing in this file writes to `bn_award`, `bn_payment_*`,
 * `bn_award_status_event` or any communication table directly, and the legacy
 * `awardServicingService.updateAwardStatus()` browser mutation must never be
 * imported by award-suspension code.
 */
import { supabase } from '@/integrations/supabase/client';

// The generated Supabase types are regenerated on migration; these RPCs are
// invoked through a narrow untyped bridge so the service stays compilable.
const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc(name, args);

export type SuspensionCommandErrorCode =
  | 'E_FEATURE_DISABLED'
  | 'E_UNAUTHENTICATED'
  | 'E_FORBIDDEN'
  | 'E_SUSPENSION_NOT_FOUND'
  | 'E_AWARD_NOT_FOUND'
  | 'E_AWARD_NOT_ELIGIBLE'
  | 'E_AWARD_ALREADY_SUSPENDED'
  | 'E_AWARD_NOT_SUSPENDED'
  | 'E_NO_ACTIVE_SUSPENSION'
  | 'E_INVALID_STATE'
  | 'E_NOT_DUE'
  | 'E_STALE_ROW_VERSION'
  | 'E_SELF_APPROVAL_FORBIDDEN'
  | 'E_CONFLICTING_OPEN_CASE'
  | 'E_INVALID_EFFECTIVE_DATE'
  | 'E_INVALID_REASON_CODE'
  | 'E_NARRATIVE_REQUIRED'
  | 'E_REASON_REQUIRED'
  | 'E_ONLY_PROPOSED_MAY_WITHDRAW'
  | 'E_UNKNOWN';

export class SuspensionCommandError extends Error {
  readonly code: SuspensionCommandErrorCode;
  constructor(code: SuspensionCommandErrorCode, message: string) {
    super(message);
    this.name = 'SuspensionCommandError';
    this.code = code;
  }
}

const KNOWN_CODES: SuspensionCommandErrorCode[] = [
  'E_FEATURE_DISABLED', 'E_UNAUTHENTICATED', 'E_FORBIDDEN', 'E_SUSPENSION_NOT_FOUND',
  'E_AWARD_NOT_FOUND', 'E_AWARD_NOT_ELIGIBLE', 'E_AWARD_ALREADY_SUSPENDED',
  'E_AWARD_NOT_SUSPENDED', 'E_NO_ACTIVE_SUSPENSION', 'E_INVALID_STATE', 'E_NOT_DUE',
  'E_STALE_ROW_VERSION', 'E_SELF_APPROVAL_FORBIDDEN', 'E_CONFLICTING_OPEN_CASE',
  'E_INVALID_EFFECTIVE_DATE', 'E_INVALID_REASON_CODE', 'E_NARRATIVE_REQUIRED',
  'E_REASON_REQUIRED', 'E_ONLY_PROPOSED_MAY_WITHDRAW',
];

export const SUSPENSION_ERROR_MESSAGES: Record<SuspensionCommandErrorCode, string> = {
  E_FEATURE_DISABLED: 'Award suspension actions are currently disabled for this environment.',
  E_UNAUTHENTICATED: 'You must be signed in to perform this action.',
  E_FORBIDDEN: 'You do not have permission to perform this action.',
  E_SUSPENSION_NOT_FOUND: 'The suspension case could not be found.',
  E_AWARD_NOT_FOUND: 'The award could not be found.',
  E_AWARD_NOT_ELIGIBLE: 'This award is not in a state that allows suspension.',
  E_AWARD_ALREADY_SUSPENDED: 'This award is already suspended.',
  E_AWARD_NOT_SUSPENDED: 'This award is not suspended, so it cannot be reinstated.',
  E_NO_ACTIVE_SUSPENSION: 'There is no active suspension to reinstate.',
  E_INVALID_STATE: 'The case is not in a state that allows this action.',
  E_NOT_DUE: 'The effective date has not been reached yet.',
  E_STALE_ROW_VERSION: 'This case changed since it was loaded. Refresh and try again.',
  E_SELF_APPROVAL_FORBIDDEN: 'Maker-checker: you cannot action a case you proposed.',
  E_CONFLICTING_OPEN_CASE: 'Another open case already exists for this award.',
  E_INVALID_EFFECTIVE_DATE: 'The effective date is not valid for this award.',
  E_INVALID_REASON_CODE: 'The selected reason code is not valid.',
  E_NARRATIVE_REQUIRED: 'A narrative is required.',
  E_REASON_REQUIRED: 'A reason code is required.',
  E_ONLY_PROPOSED_MAY_WITHDRAW: 'Only a proposed case may be withdrawn.',
  E_UNKNOWN: 'The command could not be completed.',
};

export function toCommandError(message: string | null | undefined): SuspensionCommandError {
  const raw = message ?? '';
  const code = KNOWN_CODES.find((c) => raw.includes(c)) ?? 'E_UNKNOWN';
  return new SuspensionCommandError(code, SUSPENSION_ERROR_MESSAGES[code]);
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw toCommandError(error.message);
  return data as T;
}

export const newCorrelationId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const newIdempotencyKey = newCorrelationId;

// ---------------------------------------------------------------- types

export interface PaymentImpactItem {
  record_type: 'PAYMENT_SCHEDULE' | 'PAYMENT_INSTRUCTION' | 'BATCH_ITEM';
  record_id: string;
  action: 'HELD' | 'EXCEPTION_RAISED' | 'NO_ACTION' | 'RELEASED' | 'RETAINED' | 'ARREARS_CREATED';
  reason: string;
  amount: number | null;
  due_date: string | null;
}

export interface PaymentImpactPreview {
  held_count: number;
  exception_count: number;
  no_action_count: number;
  items: PaymentImpactItem[];
  effective_from: string | null;
  applied: boolean;
}

export interface ArrearsResult {
  status: 'CALCULATED' | 'NO_ARREARS' | 'REVIEW_REQUIRED';
  calc_version: string;
  period_from: string;
  period_to: string;
  period_days: number;
  frequency: string | null;
  rate: number;
  units: number;
  currency: string;
  gross_payable: number;
  already_paid: number;
  deductions: number;
  net_arrears: number;
  notes: string | null;
  calculated_at: string;
}

export interface ExecutionResult {
  suspension_id: string;
  status: string;
  execution_status: string;
  award_status: string;
  row_version: number;
  payment_impact: Omit<PaymentImpactPreview, 'items'>;
}

export interface ReinstatementResult {
  reinstatement_id: string;
  status: string;
  row_version: number;
  award_status?: string;
  arrears?: ArrearsResult;
  payment_release?: { released_count: number; retained_count: number };
  arrears_instruction_id?: string | null;
}

// ---------------------------------------------------------------- commands

export const previewSuspensionPaymentImpact = (suspensionId: string) =>
  call<PaymentImpactPreview>('bn_award_suspension_preview_payment_impact_v1', {
    p_suspension_id: suspensionId,
  });

export const executeSuspension = (input: {
  suspensionId: string;
  expectedRowVersion: number;
  narrative?: string | null;
  idempotencyKey?: string;
  correlationId?: string;
}) =>
  call<ExecutionResult>('bn_award_suspension_execute_v1', {
    p_suspension_id: input.suspensionId,
    p_expected_row_version: input.expectedRowVersion,
    p_narrative: input.narrative ?? null,
    p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
    p_correlation_id: input.correlationId ?? newCorrelationId(),
  });

export const proposeReinstatement = (input: {
  suspensionId: string;
  reasonCode: string;
  effectiveFrom: string;
  narrative: string;
  idempotencyKey?: string;
  correlationId?: string;
}) =>
  call<ReinstatementResult>('bn_award_reinstatement_propose_v1', {
    p_suspension_id: input.suspensionId,
    p_reason_code: input.reasonCode,
    p_effective_from: input.effectiveFrom,
    p_narrative: input.narrative,
    p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
    p_correlation_id: input.correlationId ?? newCorrelationId(),
  });

export const approveReinstatement = (input: {
  reinstatementId: string;
  taskId?: string | null;
  narrative?: string | null;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}) =>
  call<ReinstatementResult>('bn_award_reinstatement_approve_v1', {
    p_reinstatement_id: input.reinstatementId,
    p_task_id: input.taskId ?? null,
    p_narrative: input.narrative ?? null,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
    p_correlation_id: input.correlationId ?? newCorrelationId(),
  });

export const rejectReinstatement = (input: {
  reinstatementId: string;
  taskId?: string | null;
  reasonCode: string;
  narrative?: string | null;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}) =>
  call<ReinstatementResult>('bn_award_reinstatement_reject_v1', {
    p_reinstatement_id: input.reinstatementId,
    p_task_id: input.taskId ?? null,
    p_reason_code: input.reasonCode,
    p_narrative: input.narrative ?? null,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
    p_correlation_id: input.correlationId ?? newCorrelationId(),
  });

export const withdrawReinstatement = (input: {
  reinstatementId: string;
  narrative?: string | null;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}) =>
  call<ReinstatementResult>('bn_award_reinstatement_withdraw_v1', {
    p_reinstatement_id: input.reinstatementId,
    p_narrative: input.narrative ?? null,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
    p_correlation_id: input.correlationId ?? newCorrelationId(),
  });

export const previewReinstatementArrears = (reinstatementId: string) =>
  call<ArrearsResult>('bn_award_reinstatement_calculate_arrears_v1', {
    p_reinstatement_id: reinstatementId,
  });

export const executeReinstatement = (input: {
  reinstatementId: string;
  expectedRowVersion: number;
  narrative?: string | null;
  idempotencyKey?: string;
  correlationId?: string;
}) =>
  call<ReinstatementResult>('bn_award_reinstatement_execute_v1', {
    p_reinstatement_id: input.reinstatementId,
    p_expected_row_version: input.expectedRowVersion,
    p_narrative: input.narrative ?? null,
    p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
    p_correlation_id: input.correlationId ?? newCorrelationId(),
  });

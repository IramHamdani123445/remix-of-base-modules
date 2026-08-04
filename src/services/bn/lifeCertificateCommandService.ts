/**
 * BN Life Certificates — command service.
 *
 * The ONLY browser entry point for Life Certificate mutations. Every function
 * calls a versioned SECURITY DEFINER server command. Nothing here writes to
 * `bn_life_certificate`, `bn_award`, `bn_award_suspension_event`, payment
 * tables or any communication table directly, and the legacy
 * `awardServicingService` browser mutations must never be imported by Life
 * Certificate code.
 *
 * Award state, payment holds and arrears remain owned by the Award Suspension
 * boundary — Life Certificates only ever create *proposals* through it.
 */
import { supabase } from '@/integrations/supabase/client';

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc(name, args);

export type LifeCertificateErrorCode =
  | 'E_FEATURE_DISABLED'
  | 'E_UNAUTHENTICATED'
  | 'E_FORBIDDEN'
  | 'E_OBLIGATION_NOT_FOUND'
  | 'E_AWARD_NOT_FOUND'
  | 'E_AWARD_NOT_ELIGIBLE'
  | 'E_AWARD_NOT_SUSPENDED'
  | 'E_POLICY_NOT_FOUND'
  | 'E_INVALID_STATE'
  | 'E_INVALID_MILESTONE'
  | 'E_NOT_OVERDUE'
  | 'E_NOT_ESCALATABLE'
  | 'E_NOT_VERIFIED'
  | 'E_NOT_DUE'
  | 'E_STALE_ROW_VERSION'
  | 'E_SELF_APPROVAL_FORBIDDEN'
  | 'E_CONFLICTING_OPEN_CASE'
  | 'E_NO_ACTIVE_SUSPENSION'
  | 'E_EVIDENCE_REQUIRED'
  | 'E_EVIDENCE_NOT_FOUND'
  | 'E_EVIDENCE_WRONG_CLAIMANT'
  | 'E_EVIDENCE_ALREADY_USED'
  | 'E_EVIDENCE_TYPE_NOT_ACCEPTED'
  | 'E_INVALID_CERTIFICATE_DATE'
  | 'E_CERTIFICATE_EXPIRED'
  | 'E_ISSUING_AUTHORITY_NOT_ACCEPTED'
  | 'E_INVALID_REASON_CODE'
  | 'E_INVALID_EFFECTIVE_DATE'
  | 'E_REASON_REQUIRED'
  | 'E_NARRATIVE_REQUIRED'
  | 'E_IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'E_MILESTONE_NOT_DUE'
  | 'E_RECORD_FORBIDDEN'
  | 'E_SEARCH_TOO_SHORT'
  | 'E_INVALID_AWARD_REFERENCE'
  | 'E_EVIDENCE_SUPERSEDED'
  | 'E_UNKNOWN';

export const LIFE_CERTIFICATE_ERROR_MESSAGES: Record<LifeCertificateErrorCode, string> = {
  E_FEATURE_DISABLED: 'Life Certificate actions are currently disabled for this environment (dark launch).',
  E_UNAUTHENTICATED: 'You must be signed in to perform this action.',
  E_FORBIDDEN: 'You do not have permission to perform this action.',
  E_OBLIGATION_NOT_FOUND: 'The life certificate obligation could not be found.',
  E_AWARD_NOT_FOUND: 'The related award could not be found.',
  E_AWARD_NOT_ELIGIBLE: 'The award is not in a state that allows this action.',
  E_AWARD_NOT_SUSPENDED: 'The award is not suspended, so reinstatement cannot be proposed.',
  E_POLICY_NOT_FOUND: 'No active life certificate policy is effective for that date.',
  E_INVALID_STATE: 'The obligation is not in a state that allows this action.',
  E_INVALID_MILESTONE: 'That scheduler milestone is not recognised.',
  E_NOT_OVERDUE: 'Only an overdue obligation can be escalated for suspension.',
  E_NOT_ESCALATABLE: 'A verified, waived or deferred obligation cannot be escalated.',
  E_NOT_VERIFIED: 'The certificate must be verified before reinstatement can be proposed.',
  E_NOT_DUE: 'The escalation date has not been reached yet.',
  E_STALE_ROW_VERSION: 'This obligation changed since it was loaded. Refresh and try again.',
  E_SELF_APPROVAL_FORBIDDEN: 'Maker-checker: you cannot verify a certificate you recorded.',
  E_CONFLICTING_OPEN_CASE: 'Another open case already exists for this award.',
  E_NO_ACTIVE_SUSPENSION: 'There is no active suspension linked to this obligation.',
  E_EVIDENCE_REQUIRED: 'Evidence must be linked before this action.',
  E_EVIDENCE_NOT_FOUND: 'The selected document could not be found.',
  E_EVIDENCE_WRONG_CLAIMANT: 'The selected document does not belong to this claimant.',
  E_EVIDENCE_ALREADY_USED: 'That document is already linked to another life certificate.',
  E_EVIDENCE_TYPE_NOT_ACCEPTED: 'That evidence type is not accepted under the applicable policy.',
  E_INVALID_CERTIFICATE_DATE: 'The certificate date is not valid.',
  E_CERTIFICATE_EXPIRED: 'The certificate is outside the permitted validity period.',
  E_ISSUING_AUTHORITY_NOT_ACCEPTED: 'The issuing authority is not acceptable under the applicable policy.',
  E_INVALID_REASON_CODE: 'The selected reason code is not valid.',
  E_INVALID_EFFECTIVE_DATE: 'The selected date is not valid.',
  E_REASON_REQUIRED: 'A reason code is required.',
  E_NARRATIVE_REQUIRED: 'A narrative is required.',
  E_IDEMPOTENCY_PAYLOAD_MISMATCH: 'This action changed since it was prepared. Refresh and try again.',
  E_MILESTONE_NOT_DUE: 'That milestone is not yet due for this obligation.',
  E_RECORD_FORBIDDEN: 'This record is outside your assigned office, workbasket or caseload.',
  E_SEARCH_TOO_SHORT: 'Enter at least 4 characters to search.',
  E_INVALID_AWARD_REFERENCE: 'The award reference in the link is not valid.',
  E_EVIDENCE_SUPERSEDED: 'That document version has been superseded and cannot be used as evidence.',
  E_UNKNOWN: 'The command could not be completed.',
};

const KNOWN_CODES = Object.keys(LIFE_CERTIFICATE_ERROR_MESSAGES) as LifeCertificateErrorCode[];

export class LifeCertificateCommandError extends Error {
  readonly code: LifeCertificateErrorCode;
  constructor(code: LifeCertificateErrorCode, message: string) {
    super(message);
    this.name = 'LifeCertificateCommandError';
    this.code = code;
  }
}

export function describeLifeCertificateFailure(code: string | null | undefined): string {
  const known = KNOWN_CODES.find((c) => (code ?? '').includes(c));
  return LIFE_CERTIFICATE_ERROR_MESSAGES[known ?? 'E_UNKNOWN'];
}

function toCommandError(message: string): LifeCertificateCommandError {
  const known = KNOWN_CODES.find((c) => message.includes(c)) ?? 'E_UNKNOWN';
  return new LifeCertificateCommandError(known, LIFE_CERTIFICATE_ERROR_MESSAGES[known]);
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw toCommandError(error.message ?? '');
  return data as T;
}

export interface LifeCertificateCommandResult {
  status: string;
  life_certificate_id?: string;
  row_version?: number;
  correlation_id?: string;
  [key: string]: unknown;
}

export interface GenerateObligationsResult extends LifeCertificateCommandResult {
  policy_code: string;
  policy_version: number;
  obligation_period: string;
  eligible: number;
  created: number;
  skipped_existing: number;
  batch_limit: number;
}

/** Maximum obligations a single controlled backfill batch may create. */
export const LIFE_CERTIFICATE_MAX_BATCH = 200;

export function generateObligations(input: {
  policyCode?: string;
  asOf?: string;
  limit?: number;
  preview: boolean;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<GenerateObligationsResult> {
  return call('bn_life_certificate_generate_obligations_v1', {
    p_policy_code: input.policyCode ?? 'BN_LIFE_CERT_DEFAULT',
    p_as_of: input.asOf ?? null,
    p_limit: Math.min(input.limit ?? 200, LIFE_CERTIFICATE_MAX_BATCH),
    p_preview: input.preview,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export type LifeCertificateChannel =
  | 'IN_PERSON'
  | 'PORTAL'
  | 'EMAIL_INTAKE'
  | 'EMBASSY'
  | 'AUTHORISED_AUTHORITY'
  | 'INTERNAL_UPLOAD'
  | 'POST';

export function recordReceipt(input: {
  lifeCertificateId: string;
  receivedDate: string;
  documentId: string;
  evidenceType: string;
  issuingAuthority?: string | null;
  certificateDate: string;
  channel: LifeCertificateChannel;
  narrative?: string | null;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_receive_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_received_date: input.receivedDate,
    p_document_id: input.documentId,
    p_evidence_type: input.evidenceType,
    p_issuing_authority: input.issuingAuthority ?? null,
    p_certificate_date: input.certificateDate,
    p_received_channel: input.channel,
    p_narrative: input.narrative ?? null,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function verifyCertificate(input: {
  lifeCertificateId: string;
  narrative?: string | null;
  checklist?: Record<string, boolean>;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_verify_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_narrative: input.narrative ?? null,
    p_checklist: input.checklist ?? {},
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function rejectCertificate(input: {
  lifeCertificateId: string;
  reasonCode: string;
  narrative: string;
  resubmissionDueDate?: string | null;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_reject_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_reason_code: input.reasonCode,
    p_narrative: input.narrative,
    p_resubmission_due_date: input.resubmissionDueDate ?? null,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function requestResubmission(input: {
  lifeCertificateId: string;
  narrative: string;
  resubmissionDueDate: string;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_request_resubmission_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_narrative: input.narrative,
    p_resubmission_due_date: input.resubmissionDueDate,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function waiveObligation(input: {
  lifeCertificateId: string;
  reasonCode: string;
  narrative: string;
  effectiveFrom: string;
  expiresOn: string;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_waive_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_reason_code: input.reasonCode,
    p_narrative: input.narrative,
    p_effective_from: input.effectiveFrom,
    p_expires_on: input.expiresOn,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function deferObligation(input: {
  lifeCertificateId: string;
  reasonCode: string;
  narrative: string;
  deferredTo: string;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_defer_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_reason_code: input.reasonCode,
    p_narrative: input.narrative,
    p_deferred_to: input.deferredTo,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export type LifeCertificateMilestone = 'DUE' | 'GRACE' | 'OVERDUE' | `REMINDER_${number}`;

/**
 * Marks a scheduler milestone. The server is the date authority: no `as_of` is
 * accepted, and the command independently revalidates that the milestone is due
 * against the persisted obligation dates in the policy timezone.
 */
export function markMilestone(input: {
  lifeCertificateId: string;
  milestone: LifeCertificateMilestone;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_mark_milestone_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_milestone: input.milestone,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

/** Manual recovery for obligations parked after five failed scheduler attempts. */
export function clearMilestoneAttempts(input: {
  lifeCertificateId: string;
  milestone?: string;
}): Promise<LifeCertificateCommandResult> {
  return call('bn_life_certificate_clear_milestone_attempts_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_milestone: input.milestone ?? null,
  });
}

/**
 * Creates an Award Suspension PROPOSAL for an overdue obligation. The award is
 * never suspended here — approval and execution stay inside Award Suspension.
 */
export function escalateToSuspension(input: {
  lifeCertificateId: string;
  narrative: string;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult & { suspension_id?: string }> {
  return call('bn_life_certificate_escalate_to_suspension_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_narrative: input.narrative,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

/**
 * Creates a reinstatement PROPOSAL through the Award Suspension boundary. Hold
 * release, arrears and payment outcomes remain owned by Award Suspension.
 */
export function proposeReinstatement(input: {
  lifeCertificateId: string;
  narrative: string;
  effectiveFrom?: string | null;
  expectedRowVersion: number;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<LifeCertificateCommandResult & { reinstatement_id?: string }> {
  return call('bn_life_certificate_propose_reinstatement_v1', {
    p_life_certificate_id: input.lifeCertificateId,
    p_narrative: input.narrative,
    p_effective_from: input.effectiveFrom ?? null,
    p_expected_row_version: input.expectedRowVersion,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

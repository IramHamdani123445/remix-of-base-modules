/**
 * BN Medical Reviews — typed error model.
 *
 * The backend commands and secured queries raise stable `E_*` codes. This
 * module is the ONLY place that turns a raw PostgREST/PostgreSQL message into
 * a user-facing string, so no raw SQL text ever reaches the UI.
 */

export type MedicalReviewErrorCode =
  | 'E_UNAUTHENTICATED'
  | 'E_FEATURE_DISABLED'
  | 'E_FORBIDDEN'
  | 'E_RECORD_FORBIDDEN'
  | 'E_NOT_FOUND'
  | 'E_VERSION_CONFLICT'
  | 'E_INVALID_STATE_TRANSITION'
  | 'E_STATE_TERMINAL'
  | 'E_SEARCH_TERM_TOO_SHORT'
  | 'E_PROVIDER_NOT_ACTIVE'
  | 'E_PROVIDER_NOT_VERIFIED'
  | 'E_PROVIDER_LICENCE_EXPIRED'
  | 'E_PROVIDER_SPECIALTY_MISMATCH'
  | 'E_PROVIDER_CONFLICT_RESTRICTED'
  | 'E_MAKER_CHECKER_REQUIRED'
  | 'E_SELF_APPROVAL_FORBIDDEN'
  | 'E_QUORUM_NOT_MET'
  | 'E_MEMBER_RECUSED'
  | 'E_BINDING_MEDICAL_DETERMINATION'
  | 'E_POLICY_INVALID'
  | 'E_BOARD_REQUIRED'
  | 'E_IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'E_INVALID_AWARD_REFERENCE'
  | 'E_REASON_REQUIRED'
  | 'E_TRANSPORT'
  | 'E_UNKNOWN';

/**
 * Controlled UI states. Screens branch on these rather than on raw codes so
 * that new backend codes degrade to a safe, explainable state.
 */
export type MedicalReviewUiState =
  | 'PERMISSION_DENIED'
  | 'RECORD_UNAVAILABLE'
  | 'STALE_RECORD'
  | 'INVALID_ACTION'
  | 'CONFIGURATION_REQUIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'BOARD_QUORUM_INCOMPLETE'
  | 'READ_ONLY'
  | 'MANUAL_INTERVENTION';

interface ErrorDescriptor {
  message: string;
  uiState: MedicalReviewUiState;
}

export const MEDICAL_REVIEW_ERRORS: Record<MedicalReviewErrorCode, ErrorDescriptor> = {
  E_UNAUTHENTICATED: {
    message: 'You must be signed in to continue.',
    uiState: 'PERMISSION_DENIED',
  },
  E_FEATURE_DISABLED: {
    message:
      'Medical Reviews is currently available in read-only dark-launch mode. Operational actions are disabled.',
    uiState: 'READ_ONLY',
  },
  E_FORBIDDEN: {
    message: 'You do not have permission to perform this action.',
    uiState: 'PERMISSION_DENIED',
  },
  E_RECORD_FORBIDDEN: {
    message: 'This record is outside your assigned office, workbasket, Board or caseload.',
    uiState: 'RECORD_UNAVAILABLE',
  },
  E_NOT_FOUND: {
    message: 'The requested record could not be found.',
    uiState: 'RECORD_UNAVAILABLE',
  },
  E_VERSION_CONFLICT: {
    message: 'Another user changed this record since it was loaded. Review the current values and resubmit.',
    uiState: 'STALE_RECORD',
  },
  E_INVALID_STATE_TRANSITION: {
    message: 'That action is not valid for the current state of this record.',
    uiState: 'INVALID_ACTION',
  },
  E_STATE_TERMINAL: {
    message: 'This record is closed. Reopening requires a separately authorised correction.',
    uiState: 'INVALID_ACTION',
  },
  E_SEARCH_TERM_TOO_SHORT: {
    message: 'Enter at least 3 characters to search.',
    uiState: 'INVALID_ACTION',
  },
  E_PROVIDER_NOT_ACTIVE: {
    message: 'The selected medical provider is not active.',
    uiState: 'PROVIDER_UNAVAILABLE',
  },
  E_PROVIDER_NOT_VERIFIED: {
    message: 'The selected medical provider has not been credential-verified.',
    uiState: 'PROVIDER_UNAVAILABLE',
  },
  E_PROVIDER_LICENCE_EXPIRED: {
    message: "The selected provider's licence or registration has expired.",
    uiState: 'PROVIDER_UNAVAILABLE',
  },
  E_PROVIDER_SPECIALTY_MISMATCH: {
    message: 'The selected provider does not hold the specialty required by this review.',
    uiState: 'PROVIDER_UNAVAILABLE',
  },
  E_PROVIDER_CONFLICT_RESTRICTED: {
    message: 'The selected provider has a declared conflict of interest for this case.',
    uiState: 'PROVIDER_UNAVAILABLE',
  },
  E_MAKER_CHECKER_REQUIRED: {
    message: 'A separate approver is required before this decision can proceed.',
    uiState: 'MANUAL_INTERVENTION',
  },
  E_SELF_APPROVAL_FORBIDDEN: {
    message: 'Maker-checker: you cannot approve a decision you prepared.',
    uiState: 'MANUAL_INTERVENTION',
  },
  E_QUORUM_NOT_MET: {
    message: 'The Medical Board quorum has not been met for this session.',
    uiState: 'BOARD_QUORUM_INCOMPLETE',
  },
  E_MEMBER_RECUSED: {
    message: 'You have been recused from this case and cannot participate or view newly released evidence.',
    uiState: 'RECORD_UNAVAILABLE',
  },
  E_BINDING_MEDICAL_DETERMINATION: {
    message: 'A binding Medical Board determination applies and cannot be overridden administratively.',
    uiState: 'INVALID_ACTION',
  },
  E_POLICY_INVALID: {
    message: 'The applicable Medical Review policy is incomplete or invalid. Configuration is required.',
    uiState: 'CONFIGURATION_REQUIRED',
  },
  E_BOARD_REQUIRED: {
    message: 'A Medical Board determination is required before this step.',
    uiState: 'CONFIGURATION_REQUIRED',
  },
  E_IDEMPOTENCY_PAYLOAD_MISMATCH: {
    message: 'This action changed since it was prepared. Refresh and try again.',
    uiState: 'STALE_RECORD',
  },
  E_INVALID_AWARD_REFERENCE: {
    message: 'The award reference in the link is not valid.',
    uiState: 'RECORD_UNAVAILABLE',
  },
  E_REASON_REQUIRED: {
    message: 'A reason is required for this action.',
    uiState: 'INVALID_ACTION',
  },
  E_TRANSPORT: {
    message: 'The service could not be reached. Check your connection and try again.',
    uiState: 'MANUAL_INTERVENTION',
  },
  E_UNKNOWN: {
    message: 'The request could not be completed.',
    uiState: 'MANUAL_INTERVENTION',
  },
};

const KNOWN_CODES = Object.keys(MEDICAL_REVIEW_ERRORS) as MedicalReviewErrorCode[];

/**
 * Longest-match first so `E_STATE_TERMINAL` is not shadowed by a shorter code.
 */
const MATCH_ORDER = [...KNOWN_CODES].sort((a, b) => b.length - a.length);

export function toMedicalReviewErrorCode(raw: string | null | undefined): MedicalReviewErrorCode {
  const text = raw ?? '';
  return MATCH_ORDER.find((code) => text.includes(code)) ?? 'E_UNKNOWN';
}

export class MedicalReviewError extends Error {
  readonly code: MedicalReviewErrorCode;
  readonly uiState: MedicalReviewUiState;

  constructor(code: MedicalReviewErrorCode) {
    super(MEDICAL_REVIEW_ERRORS[code].message);
    this.name = 'MedicalReviewError';
    this.code = code;
    this.uiState = MEDICAL_REVIEW_ERRORS[code].uiState;
  }
}

/** Never surfaces raw database text. */
export function mapMedicalReviewError(raw: string | null | undefined): MedicalReviewError {
  return new MedicalReviewError(toMedicalReviewErrorCode(raw));
}

export function describeMedicalReviewFailure(err: unknown): string {
  if (err instanceof MedicalReviewError) return err.message;
  return MEDICAL_REVIEW_ERRORS.E_UNKNOWN.message;
}

export function medicalReviewUiState(err: unknown): MedicalReviewUiState {
  return err instanceof MedicalReviewError ? err.uiState : 'MANUAL_INTERVENTION';
}

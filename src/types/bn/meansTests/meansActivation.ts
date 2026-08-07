/**
 * MEANS-TEST EPIC 11 — Activation and Eligibility integration contract.
 *
 * These types mirror, one-for-one, the JSON returned by the governed
 * backend reads `bn_means_activation_context_v1` and
 * `bn_means_activation_readiness_v1`. React never derives activation
 * readiness, never re-computes the fact bundle and never decides whether
 * a retry is available — the backend owns all of it.
 */

/** Fact-publication lifecycle as recorded on `bn_means_fact_publication`. */
export type BnMeansFactPublicationStatus =
  | 'NOT_PUBLISHED'
  | 'PENDING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'SUPERSEDED';

/** Eligibility rerun posture reported by the cross-module hand-off. */
export type BnMeansEligibilityStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'UNAVAILABLE';

/** Backend-decided activation state. Never inferred in the browser. */
export type BnMeansActivationState =
  | 'READY'
  | 'BLOCKED'
  | 'ALREADY_ACTIVE'
  | 'FAILED';

/** Canonical `means.*` fact keys published into the eligibility engine. */
export interface BnMeansActivationFactBundle {
  readonly 'means.assessment_id': string;
  readonly 'means.assessment_status': string;
  readonly 'means.policy_version': string;
  readonly 'means.assessable_income': number | string;
  readonly 'means.assessable_assets': number | string;
  readonly 'means.household_size': number;
  readonly 'means.threshold': number | string;
  readonly 'means.excess_amount': number | string;
  readonly 'means.passed': boolean;
  readonly 'means.valid_until': string | null;
  readonly 'means.reassessment_due': string | null;
}

export interface BnMeansActivationBlocker {
  readonly code: string;
  readonly message: string;
}

export interface BnMeansActivationReadiness {
  readonly state: BnMeansActivationState;
  readonly can_activate: boolean;
  readonly blockers: readonly BnMeansActivationBlocker[];
  readonly warnings: readonly BnMeansActivationBlocker[];
  readonly reason_codes: readonly string[];
  readonly snapshot_hash_valid?: boolean;
  readonly calculation_hash_valid?: boolean;
  readonly fact_publication_ready?: boolean;
  readonly eligibility_boundary_available?: boolean;
  readonly valid_from?: string | null;
  readonly valid_until?: string | null;
  readonly reassessment_due?: string | null;
  readonly existing_publication?: {
    readonly publication_id: string;
    readonly publication_reference: string | null;
    readonly publication_version: number | null;
    readonly bundle_hash: string | null;
    readonly status: BnMeansFactPublicationStatus;
    readonly published_at: string | null;
  } | null;
  readonly existing_eligibility_request?: {
    readonly handoff_id: string;
    readonly status: string | null;
    readonly target_reference: string | null;
  } | null;
}

export interface BnMeansActivationAssessment {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_id: number | null;
  readonly person_label: string;
  readonly benefit_programme: string;
  readonly effective_from: string;
  readonly currency_code: string;
  readonly status: string;
  readonly result: string | null;
  readonly row_version: number;
  readonly claim_id: string | null;
  readonly award_id: string | null;
  readonly activated_at: string | null;
  readonly policy_version_id: string | null;
  readonly policy_version_label: string | null;
}

export interface BnMeansActivationApproval {
  readonly approval_id: string;
  readonly decision: string;
  readonly decision_reason: string | null;
  readonly justification: string | null;
  readonly calculation_id: string | null;
  readonly decided_at: string | null;
  readonly decided_by_label: string | null;
}

export interface BnMeansActivationCalculation {
  readonly calculation_id: string;
  readonly sequence_no: number;
  readonly currency_code: string;
  readonly household_size: number;
  readonly assessable_income: number | string;
  readonly assessable_assets: number | string;
  readonly approved_deductions: number | string | null;
  readonly threshold_amount: number | string | null;
  readonly excess_amount: number | string | null;
  readonly shortfall_amount: number | string | null;
  readonly result: string;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly reassessment_due: string | null;
  readonly calculation_hash: string | null;
  readonly assessment_version_id: string | null;
}

export interface BnMeansActivationPublication {
  readonly publication_id: string;
  readonly publication_reference: string | null;
  readonly publication_version: number | null;
  readonly status: BnMeansFactPublicationStatus;
  readonly bundle_hash: string | null;
  readonly fact_bundle: BnMeansActivationFactBundle | null;
  readonly published_at: string | null;
  readonly published_by_label: string | null;
  readonly retry_count: number | null;
  readonly failure_code: string | null;
  readonly failure_detail: string | null;
  readonly correlation_id: string | null;
}

export interface BnMeansActivationEligibility {
  readonly status: BnMeansEligibilityStatus;
  readonly request_id: string | null;
  readonly request_status: string | null;
  readonly requested_at: string | null;
  readonly completed_at: string | null;
  readonly result_reference: string | null;
  readonly determination_status: string | null;
  readonly failure_code: string | null;
  readonly failure_detail: string | null;
  /** Backend-owned. The UI must not decide when a retry is offered. */
  readonly retry_available: boolean;
}

export interface BnMeansActivationAwardReview {
  readonly handoff_id: string;
  readonly status: string | null;
  readonly reason_code: string | null;
  readonly target_reference: string | null;
  readonly created_at: string | null;
}

export interface BnMeansActivationHistoryEntry {
  readonly event_code: string;
  readonly command_name: string | null;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly occurred_at: string;
  readonly actor_label: string | null;
}

export interface BnMeansActivationContext {
  readonly assessment: BnMeansActivationAssessment;
  readonly approval: BnMeansActivationApproval | null;
  readonly approved_calculation: BnMeansActivationCalculation | null;
  readonly readiness: BnMeansActivationReadiness;
  readonly fact_preview: BnMeansActivationFactBundle | null;
  readonly publication: BnMeansActivationPublication | null;
  readonly eligibility: BnMeansActivationEligibility;
  readonly award_review: BnMeansActivationAwardReview | null;
  readonly history: readonly BnMeansActivationHistoryEntry[];
}

/** Privacy-safe activation posture surfaced on Benefit/Award 360. */
export interface BnMeansBenefit360ActivationPosture {
  readonly fact_publication_status: BnMeansFactPublicationStatus;
  readonly eligibility_status: BnMeansEligibilityStatus;
  readonly determination_status: string | null;
  readonly award_review_required: boolean;
}

/** Governed activation commands (all served by the activation boundary). */
export const BN_MEANS_ACTIVATION_COMMANDS = [
  'BN_MEANS_ACTIVATE',
  'BN_MEANS_RETRY_FACT_PUBLICATION',
  'BN_MEANS_RETRY_ELIGIBILITY_REQUEST',
  'BN_MEANS_REFRESH_ELIGIBILITY_RESULT',
] as const;

export type BnMeansActivationCommand = (typeof BN_MEANS_ACTIVATION_COMMANDS)[number];

/** Human wording for every backend blocker/reason code in this epic. */
export const BN_MEANS_ACTIVATION_REASON_LABELS: Record<string, string> = {
  NOT_FOUND: 'This assessment could not be found.',
  ALREADY_ACTIVE: 'This assessment is already active.',
  APPEAL_IN_PROGRESS: 'An appeal is in progress, so activation is held.',
  ASSESSMENT_NOT_APPROVED: 'The assessment has not been approved.',
  APPROVED_CALCULATION_STALE: 'The approved calculation is no longer the current calculation.',
  APPROVAL_CALCULATION_MISMATCH: 'The approval was recorded against a different calculation.',
  FROZEN_VERSION_TAMPERED: 'The submitted version no longer matches its recorded hash.',
  CALCULATION_HASH_MISMATCH: 'The calculation no longer matches its recorded hash.',
  VERIFICATION_NO_LONGER_VALID: 'Verification is no longer valid for this version.',
  OPEN_ADJUSTMENT_EXISTS: 'An adjustment is still open and must be decided first.',
  POLICY_RETIRED: 'The bound policy version has been retired.',
  FACT_PUBLICATION_NOT_READY: 'The canonical means facts cannot yet be published.',
  APPROVED_CALCULATION_MISSING: 'There is no approved calculation to publish.',
  VALIDITY_DATES_MISSING: 'Validity dates are missing on the approved calculation.',
};

export function activationReasonLabel(code: string): string {
  return BN_MEANS_ACTIVATION_REASON_LABELS[code] ?? code.replace(/_/g, ' ').toLowerCase();
}

/** Presentation tone for the eligibility posture chip. */
export function eligibilityTone(
  status: BnMeansEligibilityStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'COMPLETED':
      return 'default';
    case 'FAILED':
    case 'UNAVAILABLE':
      return 'destructive';
    case 'PENDING':
    case 'PROCESSING':
      return 'secondary';
    default:
      return 'outline';
  }
}

export function eligibilityStatusLabel(status: BnMeansEligibilityStatus): string {
  switch (status) {
    case 'NOT_REQUESTED': return 'Not requested';
    case 'PENDING':       return 'Requested';
    case 'PROCESSING':    return 'In progress';
    case 'COMPLETED':     return 'Completed';
    case 'FAILED':        return 'Failed';
    case 'UNAVAILABLE':   return 'Unavailable';
    default:              return String(status);
  }
}

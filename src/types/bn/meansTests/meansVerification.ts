/**
 * MEANS-TEST EPIC 8 — Verification and Clarification contracts.
 *
 * Verification always works against the FROZEN submitted version. Nothing in
 * this module edits a declared value: it records decisions, clarification
 * requests and responses. Every state rule, reason list and allowed action
 * originates from the governed backend; React only renders what it is told.
 */

export type BnMeansVerificationOutcomeCode =
  | 'VERIFIED'
  | 'REJECTED'
  | 'CLARIFICATION_REQUIRED'
  | 'NOT_APPLICABLE';

export type BnMeansVerificationWorkStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'CLARIFICATION_PENDING'
  | 'COMPLETED'
  | 'CANCELLED';

export type BnMeansVerificationFactKind =
  | 'ASSESSMENT'
  | 'HOUSEHOLD'
  | 'INCOME'
  | 'ASSET'
  | 'DEDUCTION'
  | 'EVIDENCE';

/** Commands served by the governed verification boundary. */
export const BN_MEANS_VERIFICATION_COMMANDS = [
  'BN_MEANS_CLAIM_VERIFICATION_WORK',
  'BN_MEANS_RELEASE_VERIFICATION_WORK',
  'BN_MEANS_RECORD_VERIFICATION_DECISION',
  'BN_MEANS_RECORD_CLARIFICATION_RESPONSE',
  'BN_MEANS_CANCEL_CLARIFICATION',
  'BN_MEANS_REOPEN_VERIFICATION_FACT',
  'BN_MEANS_COMPLETE_VERIFICATION',
] as const;

export type BnMeansVerificationCommand = (typeof BN_MEANS_VERIFICATION_COMMANDS)[number];

export interface BnMeansReferenceOption {
  readonly code: string;
  readonly label: string;
  readonly description?: string;
  readonly requires_reason?: boolean;
  readonly requires_clarification?: boolean;
}

export interface BnMeansVerificationReference {
  readonly outcomes: readonly BnMeansReferenceOption[];
  readonly reject_reasons: readonly BnMeansReferenceOption[];
  readonly clarification_reasons: readonly BnMeansReferenceOption[];
  readonly not_applicable_reasons: readonly BnMeansReferenceOption[];
  readonly reopen_reasons: readonly BnMeansReferenceOption[];
  readonly recipient_kinds: readonly BnMeansReferenceOption[];
  readonly response_kinds: readonly BnMeansReferenceOption[];
  readonly fact_kinds: readonly BnMeansReferenceOption[];
}

export interface BnMeansVerificationEvidenceItem {
  readonly link_id: string;
  readonly requirement_code: string;
  readonly document_title: string;
  readonly document_type_code: string | null;
  readonly document_source: string;
  readonly evidence_type: string;
  readonly document_date: string | null;
  readonly period_from: string | null;
  readonly period_to: string | null;
  readonly expiry_date: string | null;
  readonly usability_status: string;
  readonly usability_reason_code: string | null;
  readonly usability_note: string | null;
  readonly usable: boolean;
  readonly linked_at: string;
}

export interface BnMeansClarificationResponse {
  readonly response_id: string;
  readonly response_kind: string;
  readonly note: string | null;
  readonly evidence_link_id: string | null;
  readonly recorded_at: string;
  readonly recorded_by: string | null;
}

export interface BnMeansClarification {
  readonly request_id: string;
  readonly request_reference: string | null;
  readonly request_type: string;
  readonly reason_code: string | null;
  readonly information_required: string | null;
  readonly details: string | null;
  readonly recipient_kind: string | null;
  readonly recipient_label: string | null;
  readonly status: string;
  readonly is_blocking: boolean;
  readonly due_date: string | null;
  readonly overdue: boolean;
  readonly requested_at: string;
  readonly requested_by: string | null;
  readonly response_summary: string | null;
  readonly closed_at: string | null;
  readonly responses: readonly BnMeansClarificationResponse[];
}

export interface BnMeansVerificationDecisionRecord {
  readonly verification_id: string;
  readonly outcome: BnMeansVerificationOutcomeCode;
  readonly reason_code: string | null;
  readonly notes: string | null;
  readonly verified_by: string | null;
  readonly verified_at: string;
  readonly review_round: number;
}

export interface BnMeansVerificationFactCard {
  readonly work_id: string;
  readonly fact_kind: BnMeansVerificationFactKind;
  readonly fact_ref_id: string | null;
  readonly fact_summary: string | null;
  readonly priority: string;
  readonly status: BnMeansVerificationWorkStatus;
  readonly outcome: BnMeansVerificationOutcomeCode | null;
  readonly outcome_reason_code: string | null;
  readonly outcome_note: string | null;
  readonly decided_at: string | null;
  readonly decided_by: string | null;
  readonly claimed_by: string | null;
  readonly claimed_at: string | null;
  readonly claimed_by_me: boolean;
  readonly review_round: number;
  readonly declared: Record<string, unknown> | null;
  readonly evidence: readonly BnMeansVerificationEvidenceItem[];
  readonly clarification: BnMeansClarification | null;
  readonly allowed_actions: readonly BnMeansVerificationCommand[];
  readonly decision_history: readonly BnMeansVerificationDecisionRecord[];
}

export interface BnMeansVerificationReadiness {
  readonly assessment_id: string;
  readonly assessment_version_id: string | null;
  readonly version_no: number | null;
  readonly frozen_at: string | null;
  readonly snapshot_hash_valid: boolean;
  readonly status: string;
  readonly verification_complete: boolean;
  readonly verification_marked_complete: boolean;
  readonly verification_outcome: string | null;
  readonly section_status: string;
  readonly total_work: number;
  readonly pending_work: number;
  readonly in_progress_work: number;
  readonly clarification_pending_work: number;
  readonly completed_work: number;
  readonly cancelled_work: number;
  readonly verified_facts: number;
  readonly rejected_facts: number;
  readonly not_applicable_facts: number;
  readonly open_clarification_requests: number;
  readonly warnings: readonly { code: string; message: string }[];
  readonly blockers: readonly { code: string; message: string }[];
  readonly reason_codes: readonly string[];
}

export interface BnMeansFrozenVersionHeader {
  readonly assessment_version_id: string;
  readonly version_no: number;
  readonly frozen_at: string;
  readonly frozen_by: string | null;
  readonly snapshot_hash: string;
  readonly snapshot_hash_valid: boolean;
}

export interface BnMeansVerificationWorkspace {
  readonly assessment: {
    readonly assessment_id: string;
    readonly assessment_reference: string;
    readonly benefit_programme: string;
    readonly assessment_reason: string;
    readonly status: string;
    readonly currency_code: string;
    readonly effective_from: string;
    readonly effective_to: string | null;
    readonly row_version: number;
  };
  readonly frozen_version: BnMeansFrozenVersionHeader | null;
  readonly actor: {
    readonly can_verify: boolean;
    readonly is_submitter: boolean;
    readonly denied_reason: string | null;
  };
  readonly facts: readonly BnMeansVerificationFactCard[];
  readonly readiness: BnMeansVerificationReadiness;
  readonly reference: BnMeansVerificationReference;
}

export interface BnMeansVerificationQueueRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_id: number | null;
  readonly benefit_programme: string;
  readonly assessment_reason: string;
  readonly status: string;
  readonly currency_code: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly assessment_version_id: string;
  readonly version_no: number;
  readonly frozen_at: string;
  readonly frozen_by: string | null;
  readonly total_work: number;
  readonly pending_work: number;
  readonly in_progress_work: number;
  readonly clarification_work: number;
  readonly completed_work: number;
  readonly my_work: number;
  readonly top_priority: string | null;
  readonly oldest_work_at: string;
}

export type BnMeansVerificationQueueScope =
  | 'OUTSTANDING'
  | 'UNASSIGNED'
  | 'MINE'
  | 'CLARIFICATION'
  | 'COMPLETED'
  | 'ALL';

export const BN_MEANS_VERIFICATION_QUEUE_SCOPES: readonly {
  readonly code: BnMeansVerificationQueueScope;
  readonly label: string;
  readonly description: string;
}[] = [
  { code: 'OUTSTANDING', label: 'Outstanding', description: 'Submitted assessments with facts still to decide.' },
  { code: 'UNASSIGNED', label: 'Unclaimed', description: 'Facts nobody has picked up yet.' },
  { code: 'MINE', label: 'My work', description: 'Facts you have claimed.' },
  { code: 'CLARIFICATION', label: 'Awaiting clarification', description: 'Facts waiting on a response.' },
  { code: 'COMPLETED', label: 'Fully decided', description: 'Every fact has a decision.' },
  { code: 'ALL', label: 'All', description: 'Every submitted assessment with verification work.' },
];

/** Officer-facing wording for a work item state. */
export const BN_MEANS_WORK_STATUS_LABEL: Readonly<Record<BnMeansVerificationWorkStatus, string>> = {
  PENDING: 'Not started',
  IN_PROGRESS: 'Being reviewed',
  CLARIFICATION_PENDING: 'Awaiting clarification',
  COMPLETED: 'Decided',
  CANCELLED: 'Cancelled',
};

export const BN_MEANS_OUTCOME_LABEL: Readonly<Record<BnMeansVerificationOutcomeCode, string>> = {
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  CLARIFICATION_REQUIRED: 'Clarification requested',
  NOT_APPLICABLE: 'Not applicable',
};

export const BN_MEANS_FACT_KIND_LABEL: Readonly<Record<BnMeansVerificationFactKind, string>> = {
  ASSESSMENT: 'Assessment context',
  HOUSEHOLD: 'Household member',
  INCOME: 'Income',
  ASSET: 'Asset',
  DEDUCTION: 'Deduction or disregard',
  EVIDENCE: 'Evidence item',
};

/**
 * Post-submission processing journey. Verification is the only stage Epic 8
 * makes actionable; the later stages are shown for orientation only.
 */
export type BnMeansProcessingStageState = 'COMPLETE' | 'CURRENT' | 'PENDING' | 'BLOCKED';

export interface BnMeansProcessingStage {
  readonly key: string;
  readonly label: string;
  readonly state: BnMeansProcessingStageState;
  readonly hint: string;
}

/**
 * Derives the post-submission journey from backend-owned readiness only.
 * A missing or failed readiness read is never presented as progress.
 */
export function resolveProcessingJourney(
  readiness: BnMeansVerificationReadiness | null,
  readinessUnavailable: boolean,
  assessmentStatus: string,
): readonly BnMeansProcessingStage[] {
  const calculated = ['CALCULATED', 'REVIEW_PENDING', 'APPROVAL_PENDING', 'APPROVED', 'ACTIVE'].includes(
    assessmentStatus,
  );
  const approved = ['APPROVED', 'ACTIVE'].includes(assessmentStatus);
  const active = assessmentStatus === 'ACTIVE';

  const verificationState: BnMeansProcessingStageState = readinessUnavailable
    ? 'BLOCKED'
    : readiness?.verification_marked_complete || calculated
      ? 'COMPLETE'
      : (readiness?.blockers.length ?? 0) > 0
        ? readiness && readiness.completed_work > 0
          ? 'CURRENT'
          : 'CURRENT'
        : 'CURRENT';

  const verificationHint = readinessUnavailable
    ? 'Verification readiness is unavailable'
    : readiness
      ? readiness.verification_marked_complete
        ? 'Verification complete'
        : `${readiness.pending_work + readiness.in_progress_work} to decide, ${
            readiness.clarification_pending_work
          } awaiting clarification`
      : 'Independent check of each submitted fact';

  return [
    { key: 'submitted', label: 'Submitted', state: 'COMPLETE', hint: 'Declaration frozen' },
    { key: 'verification', label: 'Verification', state: verificationState, hint: verificationHint },
    {
      key: 'calculation',
      label: 'Calculation',
      state: calculated ? 'COMPLETE' : verificationState === 'COMPLETE' ? 'CURRENT' : 'PENDING',
      hint: calculated ? 'Assessed means calculated' : 'Runs once verification is complete',
    },
    {
      key: 'approval',
      label: 'Approval',
      state: approved ? 'COMPLETE' : calculated ? 'CURRENT' : 'PENDING',
      hint: 'Independent approval decision',
    },
    {
      key: 'activation',
      label: 'Activation',
      state: active ? 'COMPLETE' : approved ? 'CURRENT' : 'PENDING',
      hint: 'Result published to Eligibility',
    },
  ];
}

/** True when the outcome requires a reason code before it may be submitted. */
export function outcomeRequiresReason(
  reference: BnMeansVerificationReference | null,
  outcome: string,
): boolean {
  const option = reference?.outcomes.find((o) => o.code === outcome);
  return Boolean(option?.requires_reason);
}

/** True when the outcome must also raise a clarification request. */
export function outcomeRequiresClarification(
  reference: BnMeansVerificationReference | null,
  outcome: string,
): boolean {
  const option = reference?.outcomes.find((o) => o.code === outcome);
  return Boolean(option?.requires_clarification);
}

/** The reason list that applies to one outcome. */
export function reasonOptionsForOutcome(
  reference: BnMeansVerificationReference | null,
  outcome: string,
): readonly BnMeansReferenceOption[] {
  if (!reference) return [];
  switch (outcome) {
    case 'REJECTED':
      return reference.reject_reasons;
    case 'CLARIFICATION_REQUIRED':
      return reference.clarification_reasons;
    case 'NOT_APPLICABLE':
      return reference.not_applicable_reasons;
    default:
      return [];
  }
}

/** Business-readable rendering of a frozen declared element. */
export function describeDeclaredFact(
  kind: BnMeansVerificationFactKind,
  declared: Record<string, unknown> | null,
): readonly { label: string; value: string }[] {
  if (!declared) return [];
  const text = (key: string) => {
    const raw = declared[key];
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    if (typeof raw === 'object') return null;
    return String(raw);
  };
  const pair = (label: string, key: string) => {
    const value = text(key);
    return value ? { label, value } : null;
  };
  const rows: (({ label: string; value: string }) | null)[] = (() => {
    switch (kind) {
      case 'HOUSEHOLD':
        return [
          pair('Relationship', 'relationship_code'),
          pair('Dependant', 'is_dependant'),
          pair('Shares residence', 'shares_residence'),
          pair('From', 'member_from'),
          pair('To', 'member_to'),
        ];
      case 'INCOME':
        return [
          pair('Category', 'category_code'),
          pair('Source', 'source_name'),
          pair('Declared amount', 'declared_amount'),
          pair('Frequency', 'declared_frequency'),
          pair('Annualised', 'normalised_annual_amount'),
          pair('From', 'effective_from'),
          pair('To', 'effective_to'),
        ];
      case 'ASSET':
        return [
          pair('Category', 'category_code'),
          pair('Description', 'description'),
          pair('Valuation', 'valuation_amount'),
          pair('Ownership share', 'ownership_share'),
          pair('Valued on', 'valuation_date'),
        ];
      case 'DEDUCTION':
        return [
          pair('Category', 'category_code'),
          pair('Claimed amount', 'claimed_amount'),
          pair('Annualised', 'normalised_annual_amount'),
          pair('From', 'effective_from'),
          pair('To', 'effective_to'),
        ];
      case 'EVIDENCE':
        return [
          pair('Evidence type', 'evidence_type'),
          pair('Status', 'status'),
          pair('Received', 'received_at'),
        ];
      default:
        return [pair('Reference', 'assessment_reference'), pair('Status', 'status')];
    }
  })();
  return rows.filter((r): r is { label: string; value: string } => r !== null);
}

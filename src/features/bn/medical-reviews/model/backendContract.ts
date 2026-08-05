/**
 * BN Medical Reviews — canonical backend contract (single source of truth).
 *
 * Every lifecycle state, controlled value and command payload key in this file
 * is derived from the applied forward-only migrations:
 *
 *  - `20260804220344_*.sql` — table CHECK constraints (states, controlled values)
 *  - `20260805032453_*.sql` — `_bn_mr_terminal` / `_bn_mr_transition_allowed`
 *  - `20260805033121_*.sql` — command RPC payload keys and validations
 *
 * Components MUST NOT carry raw status strings. They import from here.
 * The backend remains authoritative: this module exists so the UI cannot
 * offer, or submit, a value the database would reject.
 */

/* ==================================================================== */
/* 1. Canonical lifecycle states                                        */
/* ==================================================================== */

export const OBLIGATION_STATES = [
  'NOT_DUE',
  'NOTICE_READY',
  'NOTICE_SENT',
  'DUE',
  'IN_PROGRESS',
  'AWAITING_PROVIDER',
  'AWAITING_REPORT',
  'AWAITING_BOARD',
  'AWAITING_ADMINISTRATIVE_DECISION',
  'COMPLETED',
  'DEFERRED',
  'OVERDUE',
  'MANUAL_INTERVENTION',
  'CLOSED',
] as const;

export const REFERRAL_STATES = [
  'DRAFT',
  'PROVIDER_SELECTION_REQUIRED',
  'PROVIDER_ASSIGNED',
  'ISSUED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'REASSIGNMENT_REQUIRED',
  'ASSESSMENT_IN_PROGRESS',
  'REPORT_SUBMITTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export const APPOINTMENT_STATES = [
  'NOT_REQUIRED',
  'PENDING',
  'SCHEDULED',
  'RESCHEDULED',
  'ATTENDED',
  'CLAIMANT_NO_SHOW',
  'PROVIDER_CANCELLED',
  'CANCELLED',
] as const;

export const ASSESSMENT_STATES = [
  'NOT_STARTED',
  'DRAFT',
  'SUBMITTED',
  'CLARIFICATION_REQUIRED',
  'ADDENDUM_REQUIRED',
  'VALIDATED',
  'REJECTED_INCOMPLETE',
  'LOCKED',
] as const;

export const BOARD_CASE_STATES = [
  'REFERRED',
  'SCHEDULED',
  'MEMBERS_ASSIGNED',
  'EVIDENCE_REQUESTED',
  'IN_SESSION',
  'DETERMINED',
  'DEFERRED',
  'CANCELLED',
] as const;

export const BOARD_SESSION_STATES = ['SCHEDULED', 'HELD', 'ADJOURNED', 'CANCELLED'] as const;

export const DECISION_STATES = [
  'NOT_READY',
  'READY',
  'PENDING_APPROVAL',
  'APPROVED',
  'RETURNED',
  'COMPLETED',
] as const;

export const PROPOSAL_STATES = [
  'PROPOSED',
  'ACCEPTED',
  'EXECUTED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type ObligationState = (typeof OBLIGATION_STATES)[number];
export type ReferralState = (typeof REFERRAL_STATES)[number];
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];
export type AssessmentState = (typeof ASSESSMENT_STATES)[number];
export type BoardCaseState = (typeof BOARD_CASE_STATES)[number];
export type BoardSessionState = (typeof BOARD_SESSION_STATES)[number];
export type DecisionState = (typeof DECISION_STATES)[number];
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/**
 * Frontend-only sentinel meaning "this entity does not exist yet".
 * It is NEVER a database status and is NEVER sent to an RPC.
 */
export const NO_RECORD = '__NO_RECORD__' as const;
export type NoRecord = typeof NO_RECORD;

export const LIFECYCLE_STATES = {
  OBLIGATION: OBLIGATION_STATES,
  REFERRAL: REFERRAL_STATES,
  APPOINTMENT: APPOINTMENT_STATES,
  ASSESSMENT: ASSESSMENT_STATES,
  BOARD_CASE: BOARD_CASE_STATES,
  BOARD_SESSION: BOARD_SESSION_STATES,
  DECISION: DECISION_STATES,
  PROPOSAL: PROPOSAL_STATES,
} as const;

export type MedicalReviewEntity = keyof typeof LIFECYCLE_STATES;

/** Mirrors `_bn_mr_terminal`. */
export const TERMINAL_STATES: Record<MedicalReviewEntity, readonly string[]> = {
  OBLIGATION: ['COMPLETED', 'CLOSED'],
  REFERRAL: ['COMPLETED', 'CANCELLED'],
  APPOINTMENT: ['ATTENDED', 'CANCELLED', 'NOT_REQUIRED'],
  ASSESSMENT: ['LOCKED'],
  BOARD_CASE: ['DETERMINED', 'CANCELLED'],
  BOARD_SESSION: ['HELD', 'CANCELLED'],
  DECISION: ['COMPLETED'],
  PROPOSAL: ['EXECUTED', 'REJECTED', 'WITHDRAWN'],
};

export function isTerminalState(entity: MedicalReviewEntity, state: string | null): boolean {
  return !!state && TERMINAL_STATES[entity].includes(state);
}

export function isCanonicalState(entity: MedicalReviewEntity, state: string | null): boolean {
  return !!state && (LIFECYCLE_STATES[entity] as readonly string[]).includes(state);
}

/** Human labels — every canonical state has one. */
export const STATE_LABELS: Record<MedicalReviewEntity, Record<string, string>> = {
  OBLIGATION: {
    NOT_DUE: 'Not yet due',
    NOTICE_READY: 'Notice ready',
    NOTICE_SENT: 'Notice sent',
    DUE: 'Due',
    IN_PROGRESS: 'In progress',
    AWAITING_PROVIDER: 'Awaiting provider',
    AWAITING_REPORT: 'Awaiting report',
    AWAITING_BOARD: 'Awaiting Medical Board',
    AWAITING_ADMINISTRATIVE_DECISION: 'Awaiting administrative decision',
    COMPLETED: 'Completed',
    DEFERRED: 'Deferred',
    OVERDUE: 'Overdue',
    MANUAL_INTERVENTION: 'Manual intervention',
    CLOSED: 'Closed',
  },
  REFERRAL: {
    DRAFT: 'Draft',
    PROVIDER_SELECTION_REQUIRED: 'Provider selection required',
    PROVIDER_ASSIGNED: 'Provider assigned',
    ISSUED: 'Issued',
    ACCEPTED: 'Accepted',
    DECLINED: 'Declined',
    EXPIRED: 'Expired',
    REASSIGNMENT_REQUIRED: 'Reassignment required',
    ASSESSMENT_IN_PROGRESS: 'Assessment in progress',
    REPORT_SUBMITTED: 'Report submitted',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  },
  APPOINTMENT: {
    NOT_REQUIRED: 'Not required',
    PENDING: 'Pending',
    SCHEDULED: 'Scheduled',
    RESCHEDULED: 'Rescheduled',
    ATTENDED: 'Attended',
    CLAIMANT_NO_SHOW: 'Claimant did not attend',
    PROVIDER_CANCELLED: 'Provider cancelled',
    CANCELLED: 'Cancelled',
  },
  ASSESSMENT: {
    NOT_STARTED: 'Not started',
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    CLARIFICATION_REQUIRED: 'Clarification required',
    ADDENDUM_REQUIRED: 'Addendum required',
    VALIDATED: 'Validated',
    REJECTED_INCOMPLETE: 'Rejected — incomplete',
    LOCKED: 'Locked',
  },
  BOARD_CASE: {
    REFERRED: 'Referred',
    SCHEDULED: 'Scheduled',
    MEMBERS_ASSIGNED: 'Members assigned',
    EVIDENCE_REQUESTED: 'Evidence requested',
    IN_SESSION: 'In session',
    DETERMINED: 'Determined',
    DEFERRED: 'Deferred',
    CANCELLED: 'Cancelled',
  },
  BOARD_SESSION: {
    SCHEDULED: 'Scheduled',
    HELD: 'Held',
    ADJOURNED: 'Adjourned',
    CANCELLED: 'Cancelled',
  },
  DECISION: {
    NOT_READY: 'Not ready',
    READY: 'Ready',
    PENDING_APPROVAL: 'Pending approval',
    APPROVED: 'Approved',
    RETURNED: 'Returned',
    COMPLETED: 'Completed',
  },
  PROPOSAL: {
    PROPOSED: 'Proposed',
    ACCEPTED: 'Accepted',
    EXECUTED: 'Executed',
    REJECTED: 'Rejected',
    WITHDRAWN: 'Withdrawn',
  },
};

export function stateLabel(entity: MedicalReviewEntity, state: string | null): string {
  if (!state) return '—';
  return STATE_LABELS[entity][state] ?? state;
}

/* ==================================================================== */
/* 2. Canonical controlled values                                       */
/* ==================================================================== */

export const MEDICAL_OUTCOME_CODES = [
  'INCAPACITY_CONTINUES',
  'TEMPORARY_INCAPACITY',
  'PERMANENT_INCAPACITY',
  'FIT_FOR_WORK',
  'FIT_WITH_RESTRICTIONS',
  'IMPAIRMENT_PERCENTAGE_RECORDED',
  'INSUFFICIENT_EVIDENCE',
  'SPECIALIST_REVIEW_REQUIRED',
  'SECOND_OPINION_RECOMMENDED',
  'UNABLE_TO_ASSESS',
  'CLAIMANT_DID_NOT_ATTEND',
] as const;

export const INCAPACITY_NATURE_CODES = ['TEMPORARY', 'PERMANENT', 'INDETERMINATE'] as const;

export const BOARD_DETERMINATION_OUTCOME_CODES = [
  'MEDICAL_OPINION_ACCEPTED',
  'MEDICAL_OPINION_NOT_ACCEPTED',
  'FURTHER_EVIDENCE_REQUIRED',
  'SPECIALIST_ASSESSMENT_REQUIRED',
  'SECOND_OPINION_REQUIRED',
  'TEMPORARY_INCAPACITY_CONFIRMED',
  'PERMANENT_INCAPACITY_CONFIRMED',
  'IMPAIRMENT_PERCENTAGE_DETERMINED',
  'REVIEW_DEFERRED',
  'CONFLICTING_EVIDENCE_UNRESOLVED',
  'NEXT_REVIEW_RECOMMENDED',
] as const;

export const DECISION_OUTCOME_CODE_VALUES = [
  'BENEFIT_CONTINUES',
  'BENEFIT_CONTINUES_UNTIL_DATE',
  'TEMPORARY_CONTINUATION',
  'PERMANENT_CONTINUATION',
  'NEXT_REVIEW_REQUIRED',
  'MORE_MEDICAL_EVIDENCE_REQUIRED',
  'SECOND_OPINION_REQUIRED',
  'MEDICAL_BOARD_REQUIRED',
  'NON_COMPLIANCE_REVIEW',
  'BENEFIT_NO_LONGER_MEDICALLY_SUPPORTED',
  'SUSPENSION_PROPOSAL_REQUIRED',
  'REINSTATEMENT_PROPOSAL_REQUIRED',
  'ADMINISTRATIVE_CLOSURE',
] as const;

export const NON_ATTENDANCE_CATEGORY_CODES = [
  'CLAIMANT_NO_SHOW',
  'PROVIDER_CANCELLATION',
  'FAILED_NOTICE_DELIVERY',
  'REASONABLE_RESCHEDULING_REQUEST',
  'MEDICAL_EMERGENCY',
  'TRAVEL_OR_ACCESSIBILITY',
  'ADMINISTRATIVE_SCHEDULING_ERROR',
] as const;

export const BOARD_ATTENDANCE_STATUS_CODES = [
  'EXPECTED',
  'PRESENT',
  'ABSENT',
  'APOLOGIES',
  'WITHDRAWN',
] as const;

export const BOARD_VOTE_CODES = ['FOR', 'AGAINST', 'ABSTAIN'] as const;

export const APPOINTMENT_RESPONSIBILITY_CODES = [
  'SOCIAL_SECURITY',
  'PROVIDER',
  'CLAIMANT',
  'SHARED',
  'NOT_APPLICABLE',
] as const;

export const EVIDENCE_RELEASE_SCOPES = [
  'NONE',
  'FUNCTIONAL_SUMMARY_ONLY',
  'CASE_EVIDENCE',
  'FULL_CLINICAL',
] as const;

export const BOARD_MEETING_MODES = ['IN_PERSON', 'VIRTUAL', 'HYBRID'] as const;

/** `reasonable_cause_outcome` is free of a CHECK constraint; the UI still restricts it. */
export const REASONABLE_CAUSE_OUTCOME_CODES = [
  'REASONABLE_CAUSE_ACCEPTED',
  'REASONABLE_CAUSE_REJECTED',
  'FURTHER_INFORMATION_REQUIRED',
] as const;

export type AppointmentResponsibility = (typeof APPOINTMENT_RESPONSIBILITY_CODES)[number];

/* ==================================================================== */
/* 3. Assessment DTO — exact `p_fields` contract                         */
/* ==================================================================== */

/** UI (camelCase) shape captured by the provider assessment form. */
export interface AssessmentFormValues {
  examinationDate?: string | null;
  identityVerification?: string | null;
  attendance?: string | null;
  functionalLimitations?: unknown;
  workCapacityOpinion?: string | null;
  expectedDurationMonths?: number | string | null;
  incapacityNature?: string | null;
  prognosisCategory?: string | null;
  impairmentPercentage?: number | string | null;
  furtherEvidenceRequired?: boolean | null;
  specialistRequired?: boolean | null;
  recommendedNextReviewDate?: string | null;
  medicalOutcome?: string | null;
  clinicalNarrative?: string | null;
  evidenceReviewed?: unknown;
  conflictDeclared?: boolean | null;
  conflictDetails?: string | null;
  providerDeclarationComplete?: boolean | null;
}

/** Exact backend column/JSON keys accepted by `p_fields`. */
export const ASSESSMENT_FIELD_KEYS = [
  'examination_date',
  'identity_verification_method',
  'attendance_result',
  'functional_limitations',
  'work_capacity_opinion',
  'expected_duration_months',
  'incapacity_nature',
  'prognosis_category',
  'impairment_percentage',
  'further_evidence_required',
  'specialist_required',
  'recommended_next_review_date',
  'medical_outcome',
  'clinical_narrative',
  'evidence_reviewed',
  'conflict_declared',
  'conflict_details',
  'provider_declaration_complete',
] as const;

export type AssessmentFieldKey = (typeof ASSESSMENT_FIELD_KEYS)[number];

export class MedicalReviewContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MedicalReviewContractError';
  }
}

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

function requireEnum(value: unknown, allowed: readonly string[], field: string): string | null {
  if (isBlank(value)) return null;
  const v = String(value);
  if (!allowed.includes(v)) {
    throw new MedicalReviewContractError(
      'E_INVALID_CONTROLLED_VALUE',
      `${field} received "${v}", which the backend does not accept.`,
    );
  }
  return v;
}

function toInteger(value: unknown, field: string): number | null {
  if (isBlank(value)) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new MedicalReviewContractError(
      'E_INVALID_NUMBER',
      `${field} must be an integer number of months.`,
    );
  }
  return n;
}

function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === 'YES' || value === 'true') return true;
  return false;
}

function toJsonData(value: unknown, fallback: unknown): unknown {
  if (isBlank(value)) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        /* fall through to the structured wrapper */
      }
    }
    return { narrative: trimmed };
  }
  return fallback;
}

/**
 * Maps the provider assessment form to the exact `p_fields` JSON contract.
 * Unknown UI keys are discarded — they can never reach the command service.
 */
export function toAssessmentFieldsDto(
  values: AssessmentFormValues,
): Record<AssessmentFieldKey, unknown> {
  const impairmentRaw = values.impairmentPercentage;
  let impairment: number | null = null;
  if (!isBlank(impairmentRaw)) {
    const n = typeof impairmentRaw === 'number' ? impairmentRaw : Number(impairmentRaw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new MedicalReviewContractError(
        'E_INVALID_IMPAIRMENT',
        'Impairment percentage must be between 0 and 100.',
      );
    }
    impairment = n;
  }

  const conflictDeclared = toBoolean(values.conflictDeclared);
  const conflictDetails = isBlank(values.conflictDetails) ? null : String(values.conflictDetails);
  if (conflictDeclared && !conflictDetails) {
    throw new MedicalReviewContractError(
      'E_CONFLICT_DETAILS_REQUIRED',
      'Conflict details are required when a conflict of interest is declared.',
    );
  }

  return {
    examination_date: isBlank(values.examinationDate) ? null : String(values.examinationDate),
    identity_verification_method: isBlank(values.identityVerification)
      ? null
      : String(values.identityVerification),
    attendance_result: isBlank(values.attendance) ? null : String(values.attendance),
    functional_limitations: toJsonData(values.functionalLimitations, {}),
    work_capacity_opinion: isBlank(values.workCapacityOpinion)
      ? null
      : String(values.workCapacityOpinion),
    expected_duration_months: toInteger(values.expectedDurationMonths, 'Expected duration'),
    incapacity_nature: requireEnum(
      values.incapacityNature,
      INCAPACITY_NATURE_CODES,
      'Nature of incapacity',
    ),
    prognosis_category: isBlank(values.prognosisCategory) ? null : String(values.prognosisCategory),
    impairment_percentage: impairment,
    further_evidence_required: toBoolean(values.furtherEvidenceRequired),
    specialist_required: toBoolean(values.specialistRequired),
    recommended_next_review_date: isBlank(values.recommendedNextReviewDate)
      ? null
      : String(values.recommendedNextReviewDate),
    medical_outcome: requireEnum(values.medicalOutcome, MEDICAL_OUTCOME_CODES, 'Medical outcome'),
    clinical_narrative: isBlank(values.clinicalNarrative) ? null : String(values.clinicalNarrative),
    evidence_reviewed: toJsonData(values.evidenceReviewed, []),
    conflict_declared: conflictDeclared,
    conflict_details: conflictDetails,
    provider_declaration_complete: toBoolean(values.providerDeclarationComplete),
  };
}

/** Addendum content uses the same clinical field names the backend stores. */
export const ADDENDUM_FIELD_KEYS = [
  'addendum_narrative',
  'medical_outcome',
  'impairment_percentage',
] as const;

export function toAddendumDto(values: Record<string, unknown>): Record<string, unknown> {
  const narrative = isBlank(values.addendumNarrative) ? null : String(values.addendumNarrative);
  if (!narrative) {
    throw new MedicalReviewContractError(
      'E_ADDENDUM_REQUIRED',
      'The addendum narrative is required.',
    );
  }
  return {
    addendum_narrative: narrative,
    medical_outcome: requireEnum(values.medicalOutcome, MEDICAL_OUTCOME_CODES, 'Medical outcome'),
    impairment_percentage: isBlank(values.impairmentPercentage)
      ? null
      : Number(values.impairmentPercentage),
  };
}

/* ==================================================================== */
/* 4. Other command DTO adapters                                        */
/* ==================================================================== */

export function toNonAttendanceDto(values: Record<string, unknown>) {
  const category = requireEnum(
    values.category,
    NON_ATTENDANCE_CATEGORY_CODES,
    'Non-attendance cause',
  );
  if (!category) {
    throw new MedicalReviewContractError('E_CATEGORY_REQUIRED', 'A non-attendance cause is required.');
  }
  return {
    category,
    notes: isBlank(values.notes) ? '' : String(values.notes),
  };
}

export function toReasonableCauseDto(values: Record<string, unknown>) {
  const outcome = requireEnum(
    values.outcome,
    REASONABLE_CAUSE_OUTCOME_CODES,
    'Reasonable-cause outcome',
  );
  if (!outcome) {
    throw new MedicalReviewContractError('E_OUTCOME_REQUIRED', 'An outcome is required.');
  }
  return { outcome };
}

export function toBoardDeterminationDto(values: Record<string, unknown>) {
  const outcomeCode = requireEnum(
    values.outcomeCode,
    BOARD_DETERMINATION_OUTCOME_CODES,
    'Determination outcome',
  );
  if (!outcomeCode) {
    throw new MedicalReviewContractError(
      'E_OUTCOME_REQUIRED',
      'A Board determination outcome is required.',
    );
  }
  const summary = isBlank(values.determinationSummary) ? '' : String(values.determinationSummary);
  if (!summary) {
    throw new MedicalReviewContractError(
      'E_SUMMARY_REQUIRED',
      'A determination summary is required.',
    );
  }
  let impairment: number | null = null;
  if (!isBlank(values.impairmentPercentage)) {
    const n = Number(values.impairmentPercentage);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new MedicalReviewContractError(
        'E_INVALID_IMPAIRMENT',
        'Impairment percentage must be between 0 and 100.',
      );
    }
    impairment = n;
  }
  return { outcomeCode, determinationSummary: summary, impairmentPercentage: impairment };
}

export function toBoardVoteDto(values: Record<string, unknown>) {
  const vote = requireEnum(values.vote, BOARD_VOTE_CODES, 'Vote');
  const voteOutcomeCode = requireEnum(
    values.voteOutcomeCode,
    BOARD_DETERMINATION_OUTCOME_CODES,
    'Medical outcome voted for',
  );
  if (!vote || !voteOutcomeCode) {
    throw new MedicalReviewContractError('E_VOTE_REQUIRED', 'A vote and an outcome are required.');
  }
  return { vote, voteOutcomeCode, voteReason: String(values.voteReason ?? '') };
}

export function toBoardParticipationDto(values: Record<string, unknown>) {
  const attendanceStatus = requireEnum(
    values.attendanceStatus,
    BOARD_ATTENDANCE_STATUS_CODES,
    'Attendance',
  );
  if (!attendanceStatus) {
    throw new MedicalReviewContractError(
      'E_ATTENDANCE_REQUIRED',
      'An attendance status is required.',
    );
  }
  return { attendanceStatus };
}

export function toDecisionDto(values: Record<string, unknown>) {
  const outcomeCode = requireEnum(
    values.outcomeCode,
    DECISION_OUTCOME_CODE_VALUES,
    'Administrative outcome',
  );
  if (!outcomeCode) {
    throw new MedicalReviewContractError(
      'E_OUTCOME_REQUIRED',
      'An administrative outcome is required.',
    );
  }
  const accepted = values.medicalRecommendationAccepted === true;
  const departureReason = isBlank(values.departureReason) ? null : String(values.departureReason);
  if (!accepted && !departureReason) {
    throw new MedicalReviewContractError(
      'E_DEPARTURE_REASON_REQUIRED',
      'A departure reason is required when the medical recommendation is not accepted.',
    );
  }
  return {
    outcomeCode,
    medicalRecommendationAccepted: accepted,
    departureReason,
    effectiveDate: isBlank(values.effectiveDate) ? null : String(values.effectiveDate),
    nextReviewDate: isBlank(values.nextReviewDate) ? null : String(values.nextReviewDate),
    reasonCode: isBlank(values.reasonCode) ? null : String(values.reasonCode),
    reasonNarrative: isBlank(values.reasonNarrative) ? '' : String(values.reasonNarrative),
  };
}

export function toDeferReviewDto(values: Record<string, unknown>) {
  const deferredUntil = isBlank(values.deferredUntil) ? null : String(values.deferredUntil);
  const reason = isBlank(values.reason) ? null : String(values.reason);
  if (!deferredUntil) {
    throw new MedicalReviewContractError(
      'E_DEFERRED_UNTIL_REQUIRED',
      'A deferred-until date is required.',
    );
  }
  if (!reason) {
    throw new MedicalReviewContractError('E_REASON_REQUIRED', 'A reason is required to defer.');
  }
  return { deferredUntil, reason };
}

export function toAppointmentDto(values: Record<string, unknown>) {
  const scheduledAt = isBlank(values.scheduledAt) ? null : String(values.scheduledAt);
  if (!scheduledAt) {
    throw new MedicalReviewContractError(
      'E_SCHEDULED_AT_REQUIRED',
      'An appointment date and time is required.',
    );
  }
  return {
    scheduledAt,
    locationReference: isBlank(values.locationReference) ? null : String(values.locationReference),
  };
}

export function toProposalDto(values: Record<string, unknown>) {
  const reason = isBlank(values.reason) ? null : String(values.reason);
  if (!reason) {
    throw new MedicalReviewContractError(
      'E_REASON_REQUIRED',
      'A reason is required to raise a proposal.',
    );
  }
  return { reason };
}

export function toPolicyDto(values: Record<string, unknown>) {
  const policyId = isBlank(values.policyId) ? null : String(values.policyId);
  if (!policyId) {
    throw new MedicalReviewContractError('E_POLICY_REQUIRED', 'A policy must be selected.');
  }
  return { policyId, reason: isBlank(values.reason) ? null : String(values.reason) };
}

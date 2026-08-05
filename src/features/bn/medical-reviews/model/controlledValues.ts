/**
 * BN Medical Reviews — controlled values for the operational forms.
 *
 * Every option below is derived from `backendContract.ts`, which mirrors the
 * database CHECK constraints and RPC validations. Friendly labels are UI-only;
 * the submitted value is always the canonical backend code.
 *
 * Fields with no database constraint (identity verification, attendance
 * result, work capacity, prognosis, evidence type, reason code) are still
 * restricted here so the operational forms stay comparable.
 */
import {
  BOARD_ATTENDANCE_STATUS_CODES,
  BOARD_DETERMINATION_OUTCOME_CODES,
  BOARD_MEETING_MODES,
  BOARD_VOTE_CODES,
  DECISION_OUTCOME_CODE_VALUES,
  INCAPACITY_NATURE_CODES,
  MEDICAL_OUTCOME_CODES,
  NON_ATTENDANCE_CATEGORY_CODES,
  REASONABLE_CAUSE_OUTCOME_CODES,
} from './backendContract';

export interface Option {
  value: string;
  label: string;
}

const opts = (...values: [string, string][]): Option[] =>
  values.map(([value, label]) => ({ value, label }));

/** Builds options from a canonical code list plus a label map. */
function fromCodes(codes: readonly string[], labels: Record<string, string>): Option[] {
  return codes.map((value) => ({ value, label: labels[value] ?? value }));
}

/* -------------------- Appointment -------------------- */

export const NON_ATTENDANCE_CATEGORIES = fromCodes(NON_ATTENDANCE_CATEGORY_CODES, {
  CLAIMANT_NO_SHOW: 'Claimant — did not attend',
  PROVIDER_CANCELLATION: 'Provider — cancelled',
  FAILED_NOTICE_DELIVERY: 'Administrative — notice was not delivered',
  REASONABLE_RESCHEDULING_REQUEST: 'Claimant — reasonable rescheduling request',
  MEDICAL_EMERGENCY: 'Claimant — medical emergency',
  TRAVEL_OR_ACCESSIBILITY: 'Claimant — travel or accessibility barrier',
  ADMINISTRATIVE_SCHEDULING_ERROR: 'Administrative — scheduling error',
});

export const REASONABLE_CAUSE_OUTCOMES = fromCodes(REASONABLE_CAUSE_OUTCOME_CODES, {
  REASONABLE_CAUSE_ACCEPTED: 'Reasonable cause accepted',
  REASONABLE_CAUSE_REJECTED: 'Reasonable cause rejected',
  FURTHER_INFORMATION_REQUIRED: 'Further information required',
});

/* -------------------- Medical Board -------------------- */

export const MEETING_MODES = fromCodes(BOARD_MEETING_MODES, {
  IN_PERSON: 'In person',
  VIRTUAL: 'Virtual',
  HYBRID: 'Hybrid',
});

export const BOARD_ATTENDANCE_STATUSES = fromCodes(BOARD_ATTENDANCE_STATUS_CODES, {
  EXPECTED: 'Expected',
  PRESENT: 'Present',
  ABSENT: 'Absent',
  APOLOGIES: 'Apologies',
  WITHDRAWN: 'Withdrawn',
});

export const BOARD_VOTES = fromCodes(BOARD_VOTE_CODES, {
  FOR: 'For',
  AGAINST: 'Against',
  ABSTAIN: 'Abstain',
});

export const BOARD_OUTCOME_CODES = fromCodes(BOARD_DETERMINATION_OUTCOME_CODES, {
  MEDICAL_OPINION_ACCEPTED: 'Medical opinion accepted',
  MEDICAL_OPINION_NOT_ACCEPTED: 'Medical opinion not accepted',
  FURTHER_EVIDENCE_REQUIRED: 'Further evidence required',
  SPECIALIST_ASSESSMENT_REQUIRED: 'Specialist assessment required',
  SECOND_OPINION_REQUIRED: 'Second opinion required',
  TEMPORARY_INCAPACITY_CONFIRMED: 'Temporary incapacity confirmed',
  PERMANENT_INCAPACITY_CONFIRMED: 'Permanent incapacity confirmed',
  IMPAIRMENT_PERCENTAGE_DETERMINED: 'Impairment percentage determined',
  REVIEW_DEFERRED: 'Review deferred',
  CONFLICTING_EVIDENCE_UNRESOLVED: 'Conflicting evidence unresolved',
  NEXT_REVIEW_RECOMMENDED: 'Next review recommended',
});

/* -------------------- Administrative decision -------------------- */

export const DECISION_OUTCOME_CODES = fromCodes(DECISION_OUTCOME_CODE_VALUES, {
  BENEFIT_CONTINUES: 'Benefit continues',
  BENEFIT_CONTINUES_UNTIL_DATE: 'Benefit continues until a stated date',
  TEMPORARY_CONTINUATION: 'Temporary continuation',
  PERMANENT_CONTINUATION: 'Permanent continuation',
  NEXT_REVIEW_REQUIRED: 'Next review required',
  MORE_MEDICAL_EVIDENCE_REQUIRED: 'More medical evidence required',
  SECOND_OPINION_REQUIRED: 'Second opinion required',
  MEDICAL_BOARD_REQUIRED: 'Medical Board required',
  NON_COMPLIANCE_REVIEW: 'Non-compliance review',
  BENEFIT_NO_LONGER_MEDICALLY_SUPPORTED: 'Benefit no longer medically supported',
  SUSPENSION_PROPOSAL_REQUIRED: 'Suspension proposal required',
  REINSTATEMENT_PROPOSAL_REQUIRED: 'Reinstatement proposal required',
  ADMINISTRATIVE_CLOSURE: 'Administrative closure',
});

/** Narrative reason codes — audited, not constrained by the schema. */
export const DECISION_REASON_CODES = opts(
  ['MEDICAL_EVIDENCE_SUPPORTS', 'Medical evidence supports continuation'],
  ['MEDICAL_EVIDENCE_CONTRADICTS', 'Medical evidence does not support continuation'],
  ['NON_COMPLIANCE', 'Non-compliance with the review obligation'],
  ['BOARD_DETERMINATION_APPLIED', 'Board determination applied'],
  ['ADMINISTRATIVE_CORRECTION', 'Administrative correction'],
);

export const EVIDENCE_TYPES = opts(
  ['SPECIALIST_REPORT', 'Specialist report'],
  ['IMAGING', 'Imaging'],
  ['LAB_RESULTS', 'Laboratory results'],
  ['TREATMENT_HISTORY', 'Treatment history'],
  ['FUNCTIONAL_ASSESSMENT', 'Functional assessment'],
);

/* -------------------- Provider structured assessment -------------------- */

export const IDENTITY_VERIFICATION_METHODS = opts(
  ['PHOTO_ID', 'Photo identification'],
  ['SS_CARD', 'Social Security card'],
  ['KNOWN_PATIENT', 'Known patient of the practice'],
  ['NOT_VERIFIED', 'Not verified'],
);

export const ATTENDANCE_OUTCOMES = opts(
  ['ATTENDED', 'Attended'],
  ['ATTENDED_LATE', 'Attended late'],
  ['DID_NOT_ATTEND', 'Did not attend'],
);

export const WORK_CAPACITY_OPINIONS = opts(
  ['NO_CAPACITY', 'No capacity for any work'],
  ['LIMITED_CAPACITY', 'Limited capacity'],
  ['CAPACITY_WITH_ADJUSTMENTS', 'Capacity with adjustments'],
  ['FULL_CAPACITY', 'Full capacity'],
);

export const INCAPACITY_NATURES = fromCodes(INCAPACITY_NATURE_CODES, {
  TEMPORARY: 'Temporary',
  PERMANENT: 'Permanent',
  INDETERMINATE: 'Indeterminate',
});

export const PROGNOSIS_CATEGORIES = opts(
  ['IMPROVING', 'Improving'],
  ['STABLE', 'Stable'],
  ['DETERIORATING', 'Deteriorating'],
  ['UNCERTAIN', 'Uncertain'],
);

export const MEDICAL_OUTCOMES = fromCodes(MEDICAL_OUTCOME_CODES, {
  INCAPACITY_CONTINUES: 'Incapacity continues',
  TEMPORARY_INCAPACITY: 'Temporary incapacity',
  PERMANENT_INCAPACITY: 'Permanent incapacity',
  FIT_FOR_WORK: 'Fit for work',
  FIT_WITH_RESTRICTIONS: 'Fit with restrictions',
  IMPAIRMENT_PERCENTAGE_RECORDED: 'Impairment percentage recorded',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
  SPECIALIST_REVIEW_REQUIRED: 'Specialist review required',
  SECOND_OPINION_RECOMMENDED: 'Second opinion recommended',
  UNABLE_TO_ASSESS: 'Unable to assess',
  CLAIMANT_DID_NOT_ATTEND: 'Claimant did not attend',
});

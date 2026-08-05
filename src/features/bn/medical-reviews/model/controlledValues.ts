/**
 * BN Medical Reviews — controlled values for the operational forms.
 *
 * These mirror the values the backend commands accept. Free text is only
 * permitted where the command genuinely stores narrative.
 */

export interface Option {
  value: string;
  label: string;
}

const opts = (...values: [string, string][]): Option[] =>
  values.map(([value, label]) => ({ value, label }));

/** Non-attendance must distinguish claimant, provider and administrative cause. */
export const NON_ATTENDANCE_CATEGORIES = opts(
  ['CLAIMANT_NO_SHOW', 'Claimant — did not attend'],
  ['CLAIMANT_CANCELLED', 'Claimant — cancelled'],
  ['CLAIMANT_LATE', 'Claimant — arrived outside the appointment window'],
  ['PROVIDER_UNAVAILABLE', 'Provider — unavailable'],
  ['PROVIDER_CANCELLED', 'Provider — cancelled'],
  ['ADMIN_ERROR', 'Administrative — scheduling or notification error'],
  ['ADMIN_RESCHEDULED', 'Administrative — rescheduled by Social Security'],
);

export const REASONABLE_CAUSE_OUTCOMES = opts(
  ['REASONABLE_CAUSE_ACCEPTED', 'Reasonable cause accepted'],
  ['REASONABLE_CAUSE_REJECTED', 'Reasonable cause rejected'],
  ['REASONABLE_CAUSE_PENDING', 'Further information required'],
);

export const MEETING_MODES = opts(
  ['IN_PERSON', 'In person'],
  ['VIRTUAL', 'Virtual'],
  ['HYBRID', 'Hybrid'],
);

export const BOARD_ATTENDANCE_STATUSES = opts(
  ['PRESENT', 'Present'],
  ['ABSENT', 'Absent'],
  ['APOLOGIES', 'Apologies'],
  ['LATE', 'Joined late'],
);

export const BOARD_VOTES = opts(
  ['FOR', 'For'],
  ['AGAINST', 'Against'],
  ['ABSTAIN', 'Abstain'],
);

export const BOARD_OUTCOME_CODES = opts(
  ['INCAPACITY_CONTINUES', 'Incapacity continues'],
  ['INCAPACITY_CEASED', 'Incapacity ceased'],
  ['PARTIAL_CAPACITY', 'Partial capacity'],
  ['FURTHER_EVIDENCE_REQUIRED', 'Further evidence required'],
  ['INCONCLUSIVE', 'Inconclusive'],
);

export const DECISION_OUTCOME_CODES = opts(
  ['REVIEW_SATISFIED', 'Review satisfied — award continues'],
  ['CONTINUE_WITH_REVIEW', 'Continue with a further review'],
  ['RECOMMEND_SUSPENSION', 'Recommend suspension'],
  ['RECOMMEND_REINSTATEMENT', 'Recommend reinstatement'],
  ['CLOSE_NO_ACTION', 'Close — no further action'],
);

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

export const EXPECTED_DURATIONS = opts(
  ['LESS_THAN_3_MONTHS', 'Less than 3 months'],
  ['THREE_TO_6_MONTHS', '3 to 6 months'],
  ['SIX_TO_12_MONTHS', '6 to 12 months'],
  ['MORE_THAN_12_MONTHS', 'More than 12 months'],
  ['PERMANENT', 'Permanent'],
);

export const INCAPACITY_NATURES = opts(
  ['TEMPORARY_TOTAL', 'Temporary total'],
  ['TEMPORARY_PARTIAL', 'Temporary partial'],
  ['PERMANENT_TOTAL', 'Permanent total'],
  ['PERMANENT_PARTIAL', 'Permanent partial'],
);

export const PROGNOSIS_CATEGORIES = opts(
  ['IMPROVING', 'Improving'],
  ['STABLE', 'Stable'],
  ['DETERIORATING', 'Deteriorating'],
  ['UNCERTAIN', 'Uncertain'],
);

export const MEDICAL_OUTCOMES = opts(
  ['INCAPACITY_CONTINUES', 'Incapacity continues'],
  ['INCAPACITY_CEASED', 'Incapacity ceased'],
  ['PARTIAL_RECOVERY', 'Partial recovery'],
  ['FURTHER_REVIEW_REQUIRED', 'Further review required'],
);

export const YES_NO = opts(['YES', 'Yes'], ['NO', 'No']);

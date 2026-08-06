/**
 * BN Means-Test MT7 — adjustment and approval contracts.
 *
 * Pure types and presentation labels. No lifecycle decision is taken
 * here: availability always comes from `bn_means_available_actions_v1`.
 */

export type BnMeansAdjustmentTargetKind =
  | 'CALCULATION_LINE'
  | 'INCOME_TREATMENT'
  | 'ASSET_TREATMENT'
  | 'DEDUCTION_TREATMENT'
  | 'POLICY_PARAMETER_APPLICATION'
  | 'VALIDITY_PERIOD'
  | 'REASSESSMENT_DATE';

export const BN_MEANS_ADJUSTMENT_TARGET_KINDS: readonly BnMeansAdjustmentTargetKind[] = [
  'CALCULATION_LINE',
  'INCOME_TREATMENT',
  'ASSET_TREATMENT',
  'DEDUCTION_TREATMENT',
  'POLICY_PARAMETER_APPLICATION',
  'VALIDITY_PERIOD',
  'REASSESSMENT_DATE',
];

/** Monetary targets require a currency on the request. */
export const BN_MEANS_MONETARY_TARGET_KINDS: readonly BnMeansAdjustmentTargetKind[] = [
  'CALCULATION_LINE',
  'INCOME_TREATMENT',
  'ASSET_TREATMENT',
  'DEDUCTION_TREATMENT',
  'POLICY_PARAMETER_APPLICATION',
];

/** Targets whose correction must cite supporting evidence. */
export const BN_MEANS_EVIDENCE_REQUIRED_TARGET_KINDS: readonly BnMeansAdjustmentTargetKind[] = [
  'INCOME_TREATMENT',
  'ASSET_TREATMENT',
  'DEDUCTION_TREATMENT',
];

export type BnMeansAdjustmentStatus =
  | 'REQUESTED'
  | 'APPROVED_PENDING_APPLICATION'
  | 'APPROVED'
  | 'REJECTED';

export interface BnMeansAdjustmentRow {
  readonly adjustment_id: string;
  readonly adjustment_reference: string | null;
  readonly assessment_id: string;
  readonly assessment_version_id: string | null;
  readonly calculation_id: string | null;
  readonly original_calculation_hash: string | null;
  readonly target_kind: string | null;
  readonly target_id: string | null;
  readonly field_or_line_code: string | null;
  readonly original_value: unknown;
  readonly proposed_value: unknown;
  readonly currency_code: string | null;
  readonly financial_effect: number | null;
  readonly reason_code: string | null;
  readonly justification: string | null;
  readonly evidence_id: string | null;
  readonly evidence_reference: string | null;
  readonly status: string;
  readonly requested_by: string | null;
  readonly requested_at: string | null;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
  readonly decision_reason_code: string | null;
  readonly decision_note: string | null;
  readonly applied_calculation_id: string | null;
  readonly applied_at: string | null;
  readonly application_error: string | null;
  readonly row_version: number;
  readonly resulting_result: string | null;
  readonly resulting_calculation_hash: string | null;
  readonly resulting_excess_amount: number | null;
  readonly is_requester: boolean;
}

export interface BnMeansApprovalDecisionRow {
  readonly approval_id: string;
  readonly decision: string;
  readonly decision_reason: string | null;
  readonly justification: string | null;
  readonly calculation_id: string | null;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
}

export interface BnMeansApprovalContext {
  readonly assessment_id: string;
  readonly assessment_reference: string | null;
  readonly status: string;
  readonly row_version: number;
  readonly currency_code: string;
  readonly assessment_version_id: string | null;
  readonly assessment_version_no: number | null;
  readonly policy_version_id: string | null;
  readonly verification_missing: number;
  readonly verification_clarification: number;
  readonly verification_complete: boolean;
  readonly calculation_id: string | null;
  readonly calculation_hash: string | null;
  readonly input_hash: string | null;
  readonly calculated_at: string | null;
  readonly result: string | null;
  readonly assessable_income: number | null;
  readonly assessable_assets: number | null;
  readonly approved_deductions: number | null;
  readonly threshold_amount: number | null;
  readonly excess_amount: number | null;
  readonly household_size: number | null;
  readonly warnings: readonly Record<string, unknown>[];
  readonly supersedes_calculation_id: string | null;
  readonly triggering_adjustment_id: string | null;
  readonly previous_result: string | null;
  readonly previous_excess_amount: number | null;
  readonly previous_assessable_income: number | null;
  readonly previous_calculation_hash: string | null;
  readonly open_adjustments: number;
  readonly adjustments_pending_application: number;
  readonly maker_user_id: string | null;
  readonly proposed_checker_user_id: string | null;
  readonly actor_is_maker: boolean;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly reassessment_due: string | null;
  readonly approved_calculation_id: string | null;
  readonly approved_at: string | null;
  readonly decided_at: string | null;
  readonly decision_reason_code: string | null;
  readonly checker_user_id: string | null;
  readonly decisions: readonly BnMeansApprovalDecisionRow[];
}

export type BnMeansQueueCode =
  | 'ADJUSTMENTS_AWAITING_DECISION'
  | 'ADJUSTMENTS_AWAITING_RECALCULATION'
  | 'ASSESSMENTS_AWAITING_APPROVAL'
  | 'ASSESSMENTS_RETURNED_TO_REVIEW'
  | 'ASSESSMENTS_REJECTED';

export const BN_MEANS_QUEUES: readonly { code: BnMeansQueueCode; label: string; description: string }[] = [
  {
    code: 'ADJUSTMENTS_AWAITING_DECISION',
    label: 'Adjustments awaiting decision',
    description: 'Requested corrections waiting for an independent checker.',
  },
  {
    code: 'ADJUSTMENTS_AWAITING_RECALCULATION',
    label: 'Approved adjustments awaiting recalculation',
    description: 'Approved corrections whose recalculation has not yet succeeded.',
  },
  {
    code: 'ASSESSMENTS_AWAITING_APPROVAL',
    label: 'Assessments awaiting approval',
    description: 'Calculated assessments pending an independent approval decision.',
  },
  {
    code: 'ASSESSMENTS_RETURNED_TO_REVIEW',
    label: 'Assessments returned to review',
    description: 'Assessments held in review while an adjustment is outstanding.',
  },
  {
    code: 'ASSESSMENTS_REJECTED',
    label: 'Rejected assessments',
    description: 'Rejected assessments retained with their full evidence history.',
  },
];

/** Canonical denial reasons rendered verbatim from the backend. */
export const BN_MEANS_REASON_LABEL: Record<string, string> = {
  ACTIONS_DISABLED: 'Actions are disabled while the module is in internal pilot',
  PERMISSION_DENIED: 'You do not hold the required permission',
  INVALID_STATE: 'Not available in the current status',
  NOT_READY_FOR_CALCULATION: 'Outstanding verification blockers prevent calculation',
  NO_CURRENT_CALCULATION: 'No current calculation exists for this assessment',
  CALCULATION_NOT_LATEST: 'The calculation is not the latest for the frozen version',
  OPEN_ADJUSTMENT_EXISTS: 'An adjustment request is still awaiting decision',
  ADJUSTMENT_APPLICATION_PENDING: 'An approved adjustment has not yet been applied',
  MAKER_CHECKER_REQUIRED: 'A separate officer must have performed the preceding step',
  SELF_APPROVAL_DENIED: 'You cannot decide your own submission or adjustment',
  POLICY_NO_LONGER_EFFECTIVE: 'The policy version is no longer effective for this assessment',
  CALCULATION_HASH_MISMATCH: 'The calculation changed — reload before deciding',
  APPROVAL_ALREADY_RECORDED: 'An approval decision has already been recorded',
  REJECTION_ALREADY_RECORDED: 'A rejection decision has already been recorded',
  STALE_ROW_VERSION: 'The record changed — reload before continuing',
  NOT_IMPLEMENTED: 'This step is not yet available',
  MISSING_REQUIRED_INFORMATION: 'Required information is missing',
  MISSING_EVIDENCE: 'Required evidence has not been attached',
  EVIDENCE_REFERENCE_REQUIRED: 'A supporting evidence reference is required',
  JUSTIFICATION_REQUIRED: 'A structured justification is required',
  REASON_CODE_REQUIRED: 'A reason code is required',
  DUPLICATE_OPEN_ADJUSTMENT: 'An open adjustment already targets the same item',
  ADJUSTMENT_ALREADY_DECIDED: 'This adjustment has already been decided',
  STALE_ADJUSTMENT_VERSION: 'The adjustment changed — reload before deciding',
  POLICY_VERSION_CHANGE_DENIED:
    'A policy-version change requires a controlled recalculation or successor assessment',
  VERIFICATION_INCOMPLETE: 'Verification is not complete for the frozen version',
  TARGET_KIND_INVALID: 'That adjustment target is not supported',
  CURRENCY_REQUIRED: 'A currency is required for a monetary adjustment',
  CURRENCY_MISMATCH: 'Currency does not match the assessment',
  VERSION_OWNERSHIP_MISMATCH: 'The reference does not belong to the current frozen version',
  ALREADY_SUBMITTED: 'The assessment has already been submitted',
  POLICY_NOT_EFFECTIVE: 'The selected policy version is not effective',
};

export const BN_MEANS_ADJUSTMENT_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested — awaiting independent decision',
  APPROVED_PENDING_APPLICATION: 'Approved — recalculation pending',
  APPROVED: 'Approved and applied',
  REJECTED: 'Rejected — original calculation stands',
};

/** Assessment status wording required by MT7. */
export function meansStatusLabel(status: string, hasCalculation: boolean): string {
  if (status === 'APPROVED') return 'Approved — not yet active';
  if (status === 'CALCULATED' && hasCalculation) return 'Calculated — pending approval';
  if (status === 'REVIEW_PENDING') return 'In review — adjustment outstanding';
  return status;
}

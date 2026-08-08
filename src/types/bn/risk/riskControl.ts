/**
 * BN Risk / Fraud — EPIC 3 control recommendation and independent approval.
 *
 * Every shape below mirrors the governed SQL boundary exactly:
 *   `bn_risk_recommendation_readiness_v1`
 *   `bn_risk_control_approval_readiness_v1`
 *   `bn_risk_control_approval_queue_v1`
 *   `bn_risk_recommendation_history_v1`
 *   `bn_risk_control_command_v1`
 *
 * The browser never chooses a control, never maps a score or band onto a
 * control, never derives readiness and never executes anything. A control
 * recommendation is a human judgement recorded against the assessment
 * evidence; approval only authorises the control for later governed
 * execution in a future epic.
 */

/** Canonical Epic 3 commands. */
export const BN_RISK_CONTROL_COMMANDS = [
  'BN_RISK_RECOMMEND_CONTROL',
  'BN_RISK_APPROVE_CONTROL',
] as const;

/** Supporting operations the decision workflow needs (clearly classified). */
export const BN_RISK_CONTROL_SUPPORTING_OPERATIONS = [
  'BN_RISK_OP_WITHDRAW_RECOMMENDATION',
] as const;

export type BnRiskControlCommand =
  | (typeof BN_RISK_CONTROL_COMMANDS)[number]
  | (typeof BN_RISK_CONTROL_SUPPORTING_OPERATIONS)[number];

/** Backend-supported approval decisions. No other decision code exists. */
export const BN_RISK_CONTROL_DECISIONS = ['APPROVE', 'REJECT', 'RETURN_FOR_REVIEW'] as const;
export type BnRiskControlDecision = (typeof BN_RISK_CONTROL_DECISIONS)[number];

/** Governed control metadata — the catalogue is backend reference data. */
export interface BnRiskControlType {
  readonly control_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly control_class: string;
  readonly is_benefit_affecting: boolean;
  readonly requires_independent_approval: boolean;
  readonly requires_justification: boolean;
  readonly requires_effective_period: boolean;
  readonly requires_target: boolean;
  readonly allowed_target_types: readonly string[];
  readonly requires_supporting_evidence: boolean;
  readonly execution_owner: string | null;
  readonly execution_boundary: string | null;
  readonly is_active: boolean;
  readonly sort_order: number;
}

export interface BnRiskReasonOption {
  readonly code: string;
  readonly label: string;
  readonly description?: string | null;
  readonly nature?: string | null;
}

export interface BnRiskRecommendationScoreBinding {
  readonly score_id: string | null;
  readonly score: number | null;
  readonly version_no: number | null;
  readonly band_code: string | null;
  readonly band_label: string | null;
  readonly rule_set_code: string | null;
  readonly rule_set_version_no: number | null;
  readonly is_stale: boolean;
}

export interface BnRiskRecommendationFactorOption {
  readonly factor_id: string;
  readonly factor_reference: string | null;
  readonly label: string | null;
  readonly direction_code: string | null;
  readonly summary: string | null;
}

export interface BnRiskRecommendationEvidenceOption {
  readonly evidence_link_id: string;
  readonly label: string | null;
  readonly usability_code: string | null;
}

/** `bn_risk_recommendation_readiness_v1`. */
export interface BnRiskRecommendationReadiness {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly can_recommend: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly has_pending_recommendation: boolean;
  readonly pending_recommendation_id: string | null;
  readonly score: BnRiskRecommendationScoreBinding;
  readonly control_options: readonly BnRiskControlType[];
  readonly reason_options: readonly BnRiskReasonOption[];
  readonly supporting_factors: readonly BnRiskRecommendationFactorOption[];
  readonly supporting_evidence: readonly BnRiskRecommendationEvidenceOption[];
}

/** Backend-owned recommendation status values. */
export type BnRiskRecommendationStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'WITHDRAWN';

/** Backend-owned execution state — approval never means executed. */
export type BnRiskControlExecutionState =
  | 'NOT_AUTHORISED'
  | 'AUTHORISED_PENDING_EXECUTION'
  | 'NOT_APPLICABLE';

/** Section state for the recommendation surface. */
export type BnRiskRecommendationSectionState =
  | 'NO_RECOMMENDATION'
  | 'READY'
  | 'BLOCKED'
  | 'PENDING_APPROVAL'
  | 'RETURNED'
  | 'REJECTED'
  | 'APPROVED'
  | 'STALE'
  | 'DENIED'
  | 'FAILED';

/** Section state for the approval surface (mirrors readiness `state`). */
export type BnRiskApprovalSectionState =
  | 'NO_PENDING_DECISION'
  | 'PENDING_APPROVAL'
  | 'READY_TO_DECIDE'
  | 'SELF_APPROVAL_DENIED'
  | 'STALE'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'DENIED'
  | 'FAILED';

/** One immutable `bn_risk_recommendation` row. */
export interface BnRiskRecommendation {
  readonly recommendation_id: string;
  readonly recommendation_reference: string;
  readonly assessment_id: string;
  readonly cycle_no: number;
  readonly assessment_row_version: number;
  readonly score_id: string | null;
  readonly score_version_no: number | null;
  readonly score: number | null;
  readonly band_code: string | null;
  readonly band_label: string | null;
  readonly rule_set_code: string | null;
  readonly rule_set_version_no: number | null;
  readonly input_fingerprint: string | null;
  readonly control_code: string;
  readonly control_label: string | null;
  readonly control_class: string | null;
  readonly is_benefit_affecting: boolean;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly target_reference: string | null;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly justification: string | null;
  readonly requested_effective_from: string | null;
  readonly requested_effective_to: string | null;
  readonly scope_note: string | null;
  readonly supporting_factor_ids: readonly string[];
  readonly supporting_evidence_ids: readonly string[];
  readonly recommended_by_user_id: string;
  readonly recommended_by_name: string | null;
  readonly recommended_at: string;
  readonly status: BnRiskRecommendationStatus;
  readonly execution_state: BnRiskControlExecutionState;
  readonly decision: BnRiskControlDecision | null;
  readonly decided_at: string | null;
  readonly decided_by_name: string | null;
  readonly row_version: number;
}

export interface BnRiskRecommendationDecisionRecord {
  readonly decision_id: string;
  readonly recommendation_id: string;
  readonly assessment_id: string;
  readonly decision: BnRiskControlDecision;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly decision_notes: string | null;
  readonly decided_by_name: string | null;
  readonly decided_at: string;
  readonly resulting_assessment_status: string | null;
}

export interface BnRiskRecommendationCycle {
  readonly recommendation: BnRiskRecommendation;
  readonly decisions: readonly BnRiskRecommendationDecisionRecord[];
}

/** `bn_risk_recommendation_history_v1`. */
export interface BnRiskRecommendationHistory {
  readonly assessment_id: string;
  readonly current: BnRiskRecommendation | null;
  readonly cycles: readonly BnRiskRecommendationCycle[];
}

export interface BnRiskControlDecisionOption {
  readonly decision: BnRiskControlDecision;
  readonly label: string;
}

/** `bn_risk_control_approval_readiness_v1`. */
export interface BnRiskControlApprovalReadiness {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly state: BnRiskApprovalSectionState;
  readonly can_decide: boolean;
  readonly can_approve: boolean;
  readonly can_reject: boolean;
  readonly can_return: boolean;
  readonly is_self_recommendation: boolean;
  readonly is_stale: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly recommendation_id: string | null;
  readonly recommendation_row_version: number | null;
  readonly decision_options: readonly BnRiskControlDecisionOption[];
  readonly reason_options: readonly BnRiskReasonOption[];
}

/** One row of `bn_risk_control_approval_queue_v1`. */
export interface BnRiskControlApprovalQueueRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_name: string | null;
  readonly person_ssn_masked: string | null;
  readonly programme_context: string | null;
  readonly recommended_at: string;
  readonly recommended_by_name: string | null;
  readonly is_own_recommendation: boolean;
  readonly decision_age_days: number;
  readonly assigned_team_code: string | null;
  readonly action_required: string;
  readonly action_label: string;
  readonly control_code: string | null;
  readonly control_label: string | null;
  readonly is_benefit_affecting: boolean | null;
  readonly recommendation_id: string;
}

export interface BnRiskControlApprovalQueue {
  readonly rows: readonly BnRiskControlApprovalQueueRow[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly can_decide: boolean;
}

export interface BnRiskControlCommandResult {
  readonly status: 'EXECUTED' | 'REPLAYED' | 'FAILED';
  readonly data: Record<string, unknown> | null;
  readonly assessmentId?: string;
  readonly assessmentStatus?: string;
  readonly recommendationId?: string;
  readonly decision?: BnRiskControlDecision;
  readonly executionState?: BnRiskControlExecutionState;
  readonly entityVersion?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly correlationId: string;
}

/**
 * Plain-language execution position. Approval authorises a control; it never
 * places a hold, changes an award, creates an overpayment or opens a referral.
 */
export function controlExecutionNotice(
  status: BnRiskRecommendationStatus,
  executionState: BnRiskControlExecutionState,
): string {
  if (status === 'PENDING_APPROVAL') return 'Recommended — not executed';
  if (status === 'APPROVED' && executionState === 'AUTHORISED_PENDING_EXECUTION') {
    return 'Approved — awaiting governed execution';
  }
  if (status === 'APPROVED') return 'Approved — no execution required';
  if (status === 'REJECTED') return 'Rejected — control not authorised';
  if (status === 'RETURNED') return 'Returned for review — control not authorised';
  return 'Withdrawn — control not authorised';
}

/**
 * BN Risk / Fraud — EPIC 6 structured rule feedback.
 *
 * Every shape mirrors the governed SQL boundary exactly:
 *   `bn_risk_rule_feedback_readiness_v1`
 *   `bn_risk_rule_feedback_command_v1`
 *
 * Feedback is an observation for later human policy review. It never changes a
 * scoring rule, weight, threshold, band or configuration version, and it never
 * rescores a case. A scoring change is a separate, versioned and authorised
 * act performed on the scoring-configuration surface.
 *
 * Feedback is also immutable: a correction is recorded as a superseding record
 * and the previous record is retained with its author and timestamp.
 */

/** The canonical Epic 6 command. */
export const BN_RISK_FEEDBACK_COMMANDS = ['BN_RISK_UPDATE_RULE_FEEDBACK'] as const;

/**
 * Supporting operation. Deliberately not a new canonical command: correcting
 * feedback records a superseding entry, it never edits what was recorded.
 */
export const BN_RISK_FEEDBACK_SUPPORTING_OPERATIONS = [
  'BN_RISK_OP_CORRECT_RULE_FEEDBACK',
] as const;

export type BnRiskFeedbackCommand =
  | (typeof BN_RISK_FEEDBACK_COMMANDS)[number]
  | (typeof BN_RISK_FEEDBACK_SUPPORTING_OPERATIONS)[number];

/** Backend-owned readiness state for the feedback surface. */
export type BnRiskFeedbackSectionState =
  | 'DENIED'
  | 'NOT_ELIGIBLE'
  | 'READY'
  | 'BLOCKED'
  | 'FAILED_TO_LOAD';

/** What the feedback is about. */
export type BnRiskFeedbackTargetKind = 'RULE' | 'SIGNAL' | 'FACTOR' | 'ASSESSMENT';

/** The governed meaning of the feedback, used for aggregate policy review. */
export type BnRiskFeedbackClassification =
  | 'USEFUL'
  | 'FALSE_POSITIVE'
  | 'DUPLICATE'
  | 'SENSITIVITY'
  | 'CONTEXT'
  | 'EVIDENCE'
  | 'CONTROL'
  | 'OUTCOME'
  | 'OTHER';

export type BnRiskFeedbackSentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface BnRiskFeedbackTypeOption {
  readonly feedback_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly target_kind: BnRiskFeedbackTargetKind;
  readonly classification: BnRiskFeedbackClassification;
  readonly sentiment: BnRiskFeedbackSentiment;
  readonly requires_reason: boolean;
  readonly requires_notes: boolean;
}

export interface BnRiskFeedbackReferenceOption {
  readonly domain: string;
  readonly code: string;
  readonly label: string;
  readonly description: string | null;
}

/**
 * A rule that actually contributed to the score this assessment was given.
 * Feedback is always attached to the rule version that produced the score, not
 * to whatever the rule looks like today.
 */
export interface BnRiskFeedbackRuleOption {
  readonly rule_id: string | null;
  readonly rule_code: string | null;
  readonly rule_name: string | null;
  readonly contribution_id: string | null;
  readonly contribution: number | null;
  readonly outcome: string | null;
  readonly direction_code: string | null;
  readonly direction_label: string | null;
  readonly factor_id: string | null;
  readonly factor_type_code: string | null;
  readonly rule_set_id: string | null;
  readonly rule_set_code: string | null;
  readonly rule_set_version_no: number | null;
  readonly score_id: string | null;
  readonly score_version_no: number | null;
}

export interface BnRiskFeedbackSignalOption {
  readonly signal_id: string;
  readonly signal_reference: string | null;
  readonly source_module: string | null;
  readonly category_code: string | null;
  readonly rule_code: string | null;
  readonly status: string | null;
}

export interface BnRiskFeedbackFactorOption {
  readonly factor_id: string;
  readonly factor_type_code: string | null;
  readonly factor_type_label: string | null;
  readonly direction_code: string | null;
}

/** The exact scoring version the feedback relates to. */
export interface BnRiskFeedbackScoringProvenance {
  readonly score_id: string;
  readonly score_version_no: number | null;
  readonly score: number | null;
  readonly band_code: string | null;
  readonly band_label: string | null;
  readonly rule_set_id: string | null;
  readonly rule_set_code: string | null;
  readonly rule_set_version_no: number | null;
  readonly rule_set_name: string | null;
  readonly input_fingerprint: string | null;
  readonly calculated_at: string | null;
}

export interface BnRiskFeedbackOutcomeContext {
  readonly outcome_id: string;
  readonly outcome_code: string | null;
  readonly outcome_label: string | null;
  readonly finding_classification: string | null;
  readonly is_fraud_related: boolean | null;
  readonly recorded_at: string | null;
}

export interface BnRiskFeedbackRecord {
  readonly feedback_id: string;
  readonly feedback_reference: string;
  readonly sequence_no: number;
  readonly target_kind: BnRiskFeedbackTargetKind;
  readonly target_label: string | null;
  readonly rule_code: string | null;
  readonly rule_name: string | null;
  readonly rule_set_code: string | null;
  readonly rule_set_version_no: number | null;
  readonly score_version_no: number | null;
  readonly signal_id: string | null;
  readonly factor_id: string | null;
  readonly feedback_code: string;
  readonly feedback_label: string;
  readonly classification: BnRiskFeedbackClassification;
  readonly sentiment: BnRiskFeedbackSentiment;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly notes: string | null;
  readonly status: 'CURRENT' | 'SUPERSEDED';
  readonly supersedes_feedback_id: string | null;
  readonly superseded_by_feedback_id: string | null;
  readonly correction_reason_label: string | null;
  readonly recorded_by_name: string | null;
  readonly recorded_at: string;
}

export interface BnRiskFeedbackReadinessV1 {
  readonly assessment_id: string;
  readonly assessment_reference: string | null;
  readonly assessment_status: string;
  readonly state: BnRiskFeedbackSectionState;
  readonly can_record_feedback: boolean;
  readonly can_correct_feedback: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly scoring_provenance: BnRiskFeedbackScoringProvenance | null;
  readonly outcome_context: BnRiskFeedbackOutcomeContext | null;
  readonly eligible_rules: readonly BnRiskFeedbackRuleOption[];
  readonly eligible_signals: readonly BnRiskFeedbackSignalOption[];
  readonly eligible_factors: readonly BnRiskFeedbackFactorOption[];
  readonly feedback_catalogue: readonly BnRiskFeedbackTypeOption[];
  readonly reason_catalogue: readonly BnRiskFeedbackReferenceOption[];
  readonly correction_reason_catalogue: readonly BnRiskFeedbackReferenceOption[];
  readonly existing_feedback: readonly BnRiskFeedbackRecord[];
  readonly requires_reopen_for_feedback: boolean;
  /** Always `NONE`. Recording feedback has no scoring effect, by contract. */
  readonly scoring_effect: 'NONE';
}

export interface BnRiskFeedbackCommandResult {
  readonly status: 'EXECUTED' | 'REPLAYED' | 'FAILED';
  readonly data: Record<string, unknown> | null;
  readonly feedbackId?: string;
  readonly scoringEffect?: string;
  readonly businessMessage?: string | null;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly correlationId: string;
}

/** Plain-language label for a governed classification. */
export function feedbackClassificationLabel(
  classification: BnRiskFeedbackClassification | string | null,
): string {
  switch (classification) {
    case 'USEFUL': return 'Useful';
    case 'FALSE_POSITIVE': return 'False positive';
    case 'DUPLICATE': return 'Duplicate or noise';
    case 'SENSITIVITY': return 'Sensitivity concern';
    case 'CONTEXT': return 'Context';
    case 'EVIDENCE': return 'Evidence';
    case 'CONTROL': return 'Control';
    case 'OUTCOME': return 'Outcome';
    case 'OTHER': return 'Other observation';
    default: return 'Not classified';
  }
}

export function feedbackTargetLabel(kind: BnRiskFeedbackTargetKind | string): string {
  switch (kind) {
    case 'RULE': return 'Scoring rule';
    case 'SIGNAL': return 'Signal';
    case 'FACTOR': return 'Factor';
    case 'ASSESSMENT': return 'Assessment';
    default: return 'Target';
  }
}

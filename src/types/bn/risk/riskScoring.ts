/**
 * BN Risk / Fraud — EPIC 2 scoring, explanation and configuration contract.
 *
 * Every shape below mirrors the governed SQL boundary exactly:
 *   `bn_risk_scoring_readiness_v1`
 *   `bn_risk_score_detail_v1`
 *   `bn_risk_review_readiness_v1`
 *   `bn_risk_scoring_configuration_v1`
 *   `bn_risk_scoring_command_v1`
 *   `bn_risk_scoring_config_command_v1`
 *
 * The browser NEVER computes a score, a band, a contribution, a threshold or
 * a weight. Everything displayed is a value the backend calculated and
 * recorded immutably. The score scale, band labels, rules and thresholds are
 * whatever the in-force configuration says they are — nothing about them is
 * hard-coded here.
 */

/** Governed scoring commands (`bn_risk_scoring_command_v1`). */
export const BN_RISK_SCORING_COMMANDS = [
  'CALCULATE_SCORE',
  'RECALCULATE_SCORE',
  'COMPLETE_SCORING_REVIEW',
] as const;

export type BnRiskScoringCommand = (typeof BN_RISK_SCORING_COMMANDS)[number];

/** Governed configuration commands (`bn_risk_scoring_config_command_v1`). */
export const BN_RISK_SCORING_CONFIG_COMMANDS = [
  'CREATE_RULE_SET_DRAFT',
  'CREATE_NEW_VERSION',
  'UPSERT_RULE',
  'DELETE_RULE',
  'UPSERT_BAND',
  'DELETE_BAND',
  'VALIDATE_RULE_SET',
  'ACTIVATE_RULE_SET',
  'RETIRE_RULE_SET',
] as const;

export type BnRiskScoringConfigCommand = (typeof BN_RISK_SCORING_CONFIG_COMMANDS)[number];

/** Scoring-stage actions exposed by `bn_risk_assessment_actions_v1`. */
export type BnRiskScoringActionCode = BnRiskScoringCommand;

export interface BnRiskScoringAvailableAction {
  readonly action: BnRiskScoringActionCode;
  readonly label: string;
  readonly command: BnRiskScoringCommand;
  readonly enabled: boolean;
}

/** All scoring actions the backend currently permits for one assessment. */
export interface BnRiskScoringAvailableActions {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly row_version: number;
  readonly actions: readonly BnRiskScoringAvailableAction[];
  readonly notice: string | null;
}

/** Backend-owned state of scoring for an assessment. */
export type BnRiskScoreState =
  | 'CONFIGURATION_REQUIRED'
  | 'BLOCKED'
  | 'READY_TO_SCORE'
  | 'SCORED'
  | 'STALE';

/** Summary of the configuration the backend would score with. */
export interface BnRiskScoringConfigurationSummary {
  readonly rule_set_id: string;
  readonly rule_set_code: string;
  readonly name: string;
  readonly version_no: number;
  readonly status: string;
  readonly score_scale_min: number;
  readonly score_scale_max: number;
  readonly score_scale_label: string | null;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly rule_count: number;
  readonly band_count: number;
}

/** `bn_risk_scoring_readiness_v1`. */
export interface BnRiskScoringReadiness {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly can_score: boolean;
  readonly score_state: BnRiskScoreState;
  readonly has_score: boolean;
  readonly is_stale: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly input_fingerprint: string | null;
  readonly active_factor_count: number;
  readonly outstanding_evidence_count: number;
  readonly open_blocking_request_count: number;
  readonly configuration: BnRiskScoringConfigurationSummary | null;
}

/** Outcome the backend recorded for a single rule/factor evaluation. */
export type BnRiskContributionOutcome = 'MATCHED' | 'NOT_MATCHED' | 'CAPPED' | 'SKIPPED';

/** One immutable line of `bn_risk_score_contribution`. */
export interface BnRiskScoreContribution {
  readonly contribution_id: string;
  readonly sequence_no: number;
  readonly rule_id: string | null;
  readonly rule_code: string | null;
  readonly rule_name: string | null;
  readonly factor_id: string | null;
  readonly factor_reference: string | null;
  readonly factor_type_code: string | null;
  readonly factor_type_label: string | null;
  readonly direction_code: string | null;
  readonly direction_label: string | null;
  readonly operator: string | null;
  /** Observed value or context the backend evaluated. */
  readonly evaluated_input: string | null;
  /** Business-readable rendering of the configured comparison. */
  readonly comparison_display: string | null;
  readonly outcome: BnRiskContributionOutcome;
  /** Applied contribution — already capped by the backend where relevant. */
  readonly contribution: number;
  /** Backend plain-language reason. Never reconstructed in the browser. */
  readonly explanation: string | null;
}

/** The immutable score record the backend produced. */
export interface BnRiskScoreResult {
  readonly score_id: string;
  readonly version_no: number;
  readonly score: number;
  readonly score_scale_min: number;
  readonly score_scale_max: number;
  readonly band_code: string | null;
  readonly band_label: string | null;
  readonly rule_set_id: string;
  readonly rule_set_code: string;
  readonly rule_set_name: string | null;
  readonly rule_set_version_no: number;
  readonly input_fingerprint: string | null;
  readonly assessment_row_version: number | null;
  readonly calculated_at: string;
  readonly calculated_by_name: string | null;
  readonly matched_rule_count: number;
  readonly contribution_count: number;
  readonly supersedes_score_id: string | null;
  readonly recalculation_reason: string | null;
  readonly correlation_id: string | null;
  readonly status: string;
  readonly is_stale: boolean;
}

export interface BnRiskScoreHistoryEntry {
  readonly score_id: string;
  readonly version_no: number;
  readonly score: number;
  readonly band_code: string | null;
  readonly band_label: string | null;
  readonly rule_set_code: string;
  readonly rule_set_version_no: number;
  readonly calculated_at: string;
  readonly calculated_by_name: string | null;
  readonly status: string;
  readonly recalculation_reason: string | null;
  readonly input_fingerprint: string | null;
  readonly supersedes_score_id: string | null;
}

/** `bn_risk_score_detail_v1`. */
export interface BnRiskScoreDetail {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly scoring_review_completed_at: string | null;
  readonly current_score: BnRiskScoreResult | null;
  readonly contributions: readonly BnRiskScoreContribution[];
  readonly history: readonly BnRiskScoreHistoryEntry[];
}

/** Non-identifying counts the backend returns for the review summary. */
export interface BnRiskReviewSummary {
  readonly linked_signal_count: number;
  readonly active_factor_count: number;
  readonly increasing_factor_count: number;
  readonly reducing_factor_count: number;
  readonly usable_evidence_count: number;
  readonly open_request_count: number;
  readonly score: number | null;
  readonly band_label: string | null;
  readonly is_stale: boolean;
}

/** `bn_risk_review_readiness_v1`. */
export interface BnRiskReviewReadiness {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly can_complete_review: boolean;
  readonly review_completed: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly summary: BnRiskReviewSummary;
}

/** One configured rule inside a scoring configuration version. */
export interface BnRiskScoringRule {
  readonly rule_id: string;
  readonly rule_code: string;
  readonly name: string;
  readonly description: string | null;
  readonly factor_type_code: string | null;
  readonly factor_type_label: string | null;
  readonly direction_code: string | null;
  readonly operator: string;
  readonly operator_label: string | null;
  readonly comparison_numeric: number | null;
  readonly comparison_code: string | null;
  readonly requires_usable_evidence: boolean;
  readonly contribution: number;
  readonly max_contribution: number | null;
  readonly explanation_template: string | null;
  readonly sort_order: number;
  readonly is_enabled: boolean;
}

/** One configured band inside a scoring configuration version. */
export interface BnRiskScoringBand {
  readonly band_id: string;
  readonly band_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly min_score: number;
  readonly max_score: number;
  readonly review_priority: string | null;
  readonly sort_order: number;
}

export interface BnRiskScoringConfigurationEvent {
  readonly event_code: string;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly justification: string | null;
  readonly created_at: string;
  readonly actor_name: string | null;
}

export interface BnRiskScoringConfigurationValidation {
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

/** One row of the configuration list. */
export interface BnRiskScoringConfigurationVersion {
  readonly rule_set_id: string;
  readonly rule_set_code: string;
  readonly version_no: number;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly status_label: string;
  readonly score_scale_min: number;
  readonly score_scale_max: number;
  readonly score_scale_label: string | null;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly rule_count: number;
  readonly band_count: number;
  readonly is_effective: boolean;
  readonly score_count: number;
  readonly row_version: number;
  readonly created_at: string;
  readonly activated_at: string | null;
}

/** Full detail of one configuration version. */
export interface BnRiskScoringConfigurationDetail {
  readonly rule_set_id: string;
  readonly rule_set_code: string;
  readonly version_no: number;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly score_scale_min: number;
  readonly score_scale_max: number;
  readonly score_scale_label: string | null;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly row_version: number;
  readonly is_editable: boolean;
  readonly validation: BnRiskScoringConfigurationValidation;
  readonly rules: readonly BnRiskScoringRule[];
  readonly bands: readonly BnRiskScoringBand[];
  readonly history: readonly BnRiskScoringConfigurationEvent[];
}

export interface BnRiskScoringReferenceOption {
  readonly code: string;
  readonly label: string;
}

export interface BnRiskScoringFactorTypeOption {
  readonly factor_type_code: string;
  readonly label: string;
  readonly value_kind: string;
  readonly value_domain: string | null;
  readonly default_direction_code: string | null;
}

/** `bn_risk_scoring_configuration_v1`. */
export interface BnRiskScoringConfiguration {
  readonly can_administer: boolean;
  readonly rule_sets: readonly BnRiskScoringConfigurationVersion[];
  readonly detail: BnRiskScoringConfigurationDetail | null;
  readonly factor_types: readonly BnRiskScoringFactorTypeOption[];
  readonly operators: readonly BnRiskScoringReferenceOption[];
  readonly directions: readonly BnRiskScoringReferenceOption[];
}

/** Result envelope returned by both scoring command RPCs. */
export interface BnRiskScoringCommandResult {
  readonly status: 'EXECUTED' | 'REPLAYED' | 'FAILED';
  readonly data: Record<string, unknown> | null;
  readonly assessmentId?: string;
  readonly assessmentStatus?: string;
  readonly ruleSetId?: string;
  readonly scoreId?: string;
  readonly versionNo?: number;
  readonly entityVersion?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly correlationId: string;
}

/** Direction grouping used purely for presentation — no arithmetic. */
export type BnRiskContributionGroup = 'INCREASES' | 'REDUCES' | 'NEUTRAL';

export function groupRiskContribution(
  contribution: BnRiskScoreContribution,
): BnRiskContributionGroup {
  if (contribution.outcome === 'NOT_MATCHED' || contribution.outcome === 'SKIPPED') {
    return 'NEUTRAL';
  }
  if (contribution.contribution > 0) return 'INCREASES';
  if (contribution.contribution < 0) return 'REDUCES';
  return 'NEUTRAL';
}

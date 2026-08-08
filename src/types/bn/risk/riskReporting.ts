/**
 * BN Risk / Fraud — EPIC 6 operational and reporting read shapes.
 *
 * Mirrors the governed SQL boundary exactly:
 *   `bn_risk_operational_metrics_v1`
 *   `bn_risk_outcome_metrics_v1`
 *   `bn_risk_rule_feedback_metrics_v1`
 *
 * Every figure is produced by the backend. The browser never aggregates,
 * never derives a rate, never infers a service-level breach and never renders
 * a failed read as a zero. Reports are aggregate only: no claimant identity,
 * narrative or individual score explanation appears in a report.
 */

export type BnRiskReportPeriodCode =
  | 'TODAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'QUARTER'
  | 'CUSTOM';

export interface BnRiskReportPeriod {
  readonly period: BnRiskReportPeriodCode;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** Deep-link target for an operational card. */
export type BnRiskOperationsQueueKey =
  | 'signals'
  | 'assessments'
  | 'control-decisions'
  | 'control-execution'
  | 'outcomes';

export interface BnRiskOperationsCard {
  readonly key: string;
  readonly label: string;
  readonly queue_key: BnRiskOperationsQueueKey;
  readonly value: number;
}

export interface BnRiskFunnelStage {
  readonly stage: string;
  readonly label: string;
  readonly value: number;
}

export interface BnRiskNamedCount {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

export interface BnRiskSignalMetrics {
  readonly generated: number;
  readonly manual: number;
  readonly triaged: number;
  readonly dismissed: number;
  readonly by_source: readonly BnRiskNamedCount[];
  readonly by_category: readonly BnRiskNamedCount[];
  readonly by_triage: readonly BnRiskNamedCount[];
}

/**
 * Ageing is published with its definition. Where no governed service-level
 * policy exists the backend says so, and age is shown without breach wording.
 */
export interface BnRiskAgeingMetrics {
  readonly definition: string;
  readonly signal_age_days: number;
  readonly assessment_age_days: number;
  readonly awaiting_information_days: number;
  readonly awaiting_approval_days: number;
  readonly execution_age_days: number;
  readonly closure_age_days: number;
  readonly sla_configured: boolean;
  readonly sla_note: string;
}

export interface BnRiskTrendPoint {
  readonly bucket: string;
  readonly signals: number;
  readonly assessments: number;
}

export interface BnRiskOperationalMetrics {
  readonly period: BnRiskReportPeriod;
  readonly cards: readonly BnRiskOperationsCard[];
  readonly funnel: readonly BnRiskFunnelStage[];
  readonly signals: BnRiskSignalMetrics;
  readonly ageing: BnRiskAgeingMetrics;
  readonly trend: readonly BnRiskTrendPoint[];
  readonly privacy_note: string;
}

export interface BnRiskOutcomeBreakdown extends BnRiskNamedCount {
  readonly outcome_class?: string | null;
  readonly is_fraud_related?: boolean | null;
}

export interface BnRiskFindingBreakdown extends BnRiskNamedCount {
  readonly is_error: boolean;
  readonly is_data_issue: boolean;
  readonly is_referral: boolean;
}

export interface BnRiskControlMetrics {
  readonly recommended: number;
  readonly approved: number;
  readonly rejected: number;
  readonly returned: number;
  readonly by_control_class: readonly BnRiskNamedCount[];
}

export interface BnRiskExecutionMetrics {
  readonly executed: number;
  readonly failed: number;
  readonly rejected_by_target: number;
  readonly pending: number;
  readonly retries: number;
  readonly by_target_module: readonly BnRiskNamedCount[];
}

export interface BnRiskMakerCheckerMetrics {
  readonly awaiting_decision: number;
  readonly turnaround_days: number;
  readonly returned_rate: number;
  readonly note: string;
}

export interface BnRiskOutcomeMetrics {
  readonly period: BnRiskReportPeriod;
  readonly totals: {
    readonly outcomes_recorded: number;
    readonly assessments_closed: number;
    readonly assessments_reopened: number;
    readonly fraud_related: number;
  };
  readonly by_outcome: readonly BnRiskOutcomeBreakdown[];
  readonly by_finding: readonly BnRiskFindingBreakdown[];
  readonly controls: BnRiskControlMetrics;
  readonly executions: BnRiskExecutionMetrics;
  readonly maker_checker: BnRiskMakerCheckerMetrics;
  readonly score_bands: readonly BnRiskNamedCount[];
  readonly score_bands_visible: boolean;
  readonly interpretation_note: string;
}

/** Version-aware rule effectiveness. Rule versions are never combined. */
export interface BnRiskRuleEffectivenessRow {
  readonly rule_set_code: string | null;
  readonly rule_set_version_no: number | null;
  readonly rule_code: string | null;
  readonly rule_name: string | null;
  readonly evaluations: number;
  readonly matches: number;
  readonly match_rate: number;
  readonly cases_matched: number;
  readonly total_contribution: number;
  readonly feedback_total: number;
  readonly false_positive_feedback: number;
  readonly useful_feedback: number;
  readonly sensitivity_feedback: number;
  readonly false_positive_feedback_rate: number | null;
  readonly useful_feedback_rate: number | null;
  readonly outcome_distribution: readonly BnRiskNamedCount[];
  readonly evidence_note: string;
}

export interface BnRiskFeedbackMetrics {
  readonly period: BnRiskReportPeriod;
  readonly totals: {
    readonly feedback_recorded: number;
    readonly feedback_current: number;
    readonly feedback_corrected: number;
    readonly cases_reviewed: number;
    readonly signal_feedback: number;
    readonly factor_feedback: number;
  };
  readonly by_classification: readonly BnRiskNamedCount[];
  readonly rules: readonly BnRiskRuleEffectivenessRow[];
  readonly governance_note: string;
}

export const BN_RISK_REPORT_PERIODS: ReadonlyArray<{
  code: BnRiskReportPeriodCode;
  label: string;
}> = [
  { code: 'TODAY', label: 'Today' },
  { code: 'LAST_7_DAYS', label: 'Last 7 days' },
  { code: 'LAST_30_DAYS', label: 'Last 30 days' },
  { code: 'QUARTER', label: 'Current quarter' },
];

/**
 * BN Risk / Fraud — EPIC 5 outcome recording, completion, closure and
 * exceptional reopening.
 *
 * Every shape mirrors the governed SQL boundary exactly:
 *   `bn_risk_outcome_readiness_v1`
 *   `bn_risk_closure_readiness_v1`
 *   `bn_risk_outcome_command_v1`
 *   `bn_risk_outcome_queue_v1`
 *
 * An outcome records what happened. It never rewrites the factors, evidence,
 * score, recommendation, approval or execution history that produced it, and
 * it never asserts a legal or criminal conclusion. The browser never derives
 * readiness, never chooses an outcome for the officer, never edits a recorded
 * outcome and never reverses anything in an owning domain.
 */

/** Canonical Epic 5 commands. */
export const BN_RISK_OUTCOME_COMMANDS = [
  'BN_RISK_RECORD_OUTCOME',
  'BN_RISK_CLOSE_ASSESSMENT',
  'BN_RISK_REOPEN_ASSESSMENT',
] as const;

/**
 * Outcome supporting operation. Deliberately not a new canonical command: a
 * correction is recorded as a superseding outcome, never as an edit.
 */
export const BN_RISK_OUTCOME_SUPPORTING_OPERATIONS = [
  'BN_RISK_OP_CORRECT_OUTCOME',
] as const;

export type BnRiskOutcomeCommand =
  | (typeof BN_RISK_OUTCOME_COMMANDS)[number]
  | (typeof BN_RISK_OUTCOME_SUPPORTING_OPERATIONS)[number];

/** Backend-owned readiness state for the outcome surface. */
export type BnRiskOutcomeSectionState =
  | 'NOT_READY'
  | 'READY'
  | 'BLOCKED'
  | 'OUTCOME_RECORDED'
  | 'COMPLETED'
  | 'DENIED'
  | 'FAILED_TO_LOAD';

/** Backend-owned readiness state for the closure surface. */
export type BnRiskClosureSectionState =
  | 'OUTCOME_NOT_READY'
  | 'OUTCOME_BLOCKED'
  | 'READY_FOR_CLOSURE'
  | 'ALREADY_CLOSED'
  | 'DENIED'
  | 'FAILED_TO_LOAD';

/**
 * What the assessment concluded. Neutral, error and data-quality outcomes are
 * first-class: a risk assessment is never forced towards a fraud finding.
 */
export type BnRiskOutcomeClass =
  | 'NO_ISSUE'
  | 'ERROR'
  | 'DATA_ISSUE'
  | 'FRAUD_REFERRAL'
  | 'CONTROL_COMPLETED'
  | 'EXTERNAL_CONTINUING'
  | 'INDETERMINATE'
  | 'OTHER';

/** The governed finding. `SUSPECTED_FRAUD_REFERRED` is a referral, not proof. */
export type BnRiskFindingClassification =
  | 'LEGITIMATE_ACTIVITY'
  | 'CONCERN_NOT_SUBSTANTIATED'
  | 'SYSTEM_ERROR'
  | 'STAFF_ERROR'
  | 'DATA_INCONSISTENCY'
  | 'SUSPECTED_FRAUD_REFERRED'
  | 'CONTROL_APPLIED'
  | 'EXTERNAL_REVIEW_CONTINUING'
  | 'NOT_DETERMINED'
  | 'OTHER';

/** One row of the governed outcome catalogue (`bn_risk_outcome_type`). */
export interface BnRiskOutcomeTypeOption {
  readonly outcome_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly outcome_class: BnRiskOutcomeClass;
  readonly finding_classification: BnRiskFindingClassification;
  readonly is_fraud_related: boolean;
  readonly requires_reason: boolean;
  readonly requires_justification: boolean;
  readonly requires_external_reference: boolean;
  readonly requires_settled_controls: boolean;
  readonly allows_unresolved_control: boolean;
  readonly permits_closure: boolean;
}

/** One approved control and the position its execution reached. */
export interface BnRiskOutcomeControlFact {
  readonly recommendation_id: string;
  readonly recommendation_reference: string | null;
  readonly control_code: string;
  readonly control_label: string | null;
  readonly control_class: string | null;
  readonly is_benefit_affecting: boolean;
  readonly approved_at: string | null;
  readonly execution_id: string | null;
  readonly execution_reference: string | null;
  readonly execution_status: string;
  readonly execution_status_label: string | null;
  readonly target_module: string | null;
  readonly target_business_reference: string | null;
  readonly target_operation_reference: string | null;
  readonly failure_code: string | null;
  readonly failure_summary: string | null;
  readonly is_retryable: boolean;
  readonly attempt_no: number | null;
}

/** The current, immutable outcome record. */
export interface BnRiskRecordedOutcome {
  readonly outcome_id: string;
  readonly outcome_reference: string;
  readonly outcome_code: string;
  readonly outcome_label: string;
  readonly outcome_class: BnRiskOutcomeClass;
  readonly finding_classification: BnRiskFindingClassification;
  readonly is_fraud_related: boolean;
  readonly disposition_code: string | null;
  readonly disposition_label: string | null;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  /** Suppressed unless the backend publishes restricted detail to the caller. */
  readonly justification: string | null;
  readonly unresolved_control_disposition: string | null;
  readonly financial_impact_module: string | null;
  readonly financial_impact_reference: string | null;
  readonly external_outcome_reference: string | null;
  readonly external_outcome_summary: string | null;
  readonly control_execution_summary: readonly BnRiskOutcomeControlFact[];
  readonly referral_summary: readonly BnRiskOutcomeControlFact[];
  readonly supporting_factor_ids: readonly string[];
  readonly supporting_evidence_ids: readonly string[];
  readonly recorded_by_name: string | null;
  readonly recorded_at: string;
  readonly sequence_no: number;
  readonly phase_no: number;
  readonly status: 'CURRENT' | 'SUPERSEDED' | 'HISTORICAL_AFTER_REOPEN';
  readonly supersedes_outcome_id: string | null;
  readonly assessment_row_version: number;
  readonly row_version: number;
}

/** A retained outcome version. Corrections supersede; nothing is deleted. */
export interface BnRiskOutcomeHistoryEntry {
  readonly outcome_id: string;
  readonly outcome_reference: string;
  readonly outcome_code: string;
  readonly outcome_label: string;
  readonly finding_classification: BnRiskFindingClassification;
  readonly status: 'CURRENT' | 'SUPERSEDED' | 'HISTORICAL_AFTER_REOPEN';
  readonly sequence_no: number;
  readonly phase_no: number;
  readonly recorded_by_name: string | null;
  readonly recorded_at: string;
  readonly correction_reason_label: string | null;
  readonly superseded_at: string | null;
}

/** The closure record, including any later reopening. Always retained. */
export interface BnRiskClosureRecord {
  readonly closure_id: string;
  readonly phase_no: number;
  readonly outcome_code: string;
  readonly outcome_label: string;
  readonly closure_reason_code: string | null;
  readonly closure_reason_label: string | null;
  readonly closure_note: string | null;
  readonly closed_by_name: string | null;
  readonly closed_at: string;
  readonly status: 'CLOSED' | 'REOPENED';
  readonly reopened_at: string | null;
  readonly reopened_by_name: string | null;
  readonly reopen_reason_code?: string | null;
  readonly reopen_reason_label: string | null;
  readonly reopen_destination_status: string | null;
}

/** `bn_risk_outcome_readiness_v1`. */
export interface BnRiskOutcomeReadinessV1 {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly phase_no: number;
  readonly state: BnRiskOutcomeSectionState;
  readonly can_record_outcome: boolean;
  readonly can_correct_outcome: boolean;
  readonly available_actions: readonly ('RECORD_OUTCOME' | 'CORRECT_OUTCOME')[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly outstanding_controls: readonly BnRiskOutcomeControlFact[];
  readonly outstanding_referrals: readonly BnRiskOutcomeControlFact[];
  readonly execution_summary: readonly BnRiskOutcomeControlFact[];
  readonly failed_executions: number;
  readonly pending_attempts: number;
  readonly requires_unresolved_control_disposition: boolean;
  readonly all_controls_executed: boolean;
  readonly all_referrals_settled: boolean;
  readonly ready_for_outcome: boolean;
  readonly outcome_catalogue: readonly BnRiskOutcomeTypeOption[];
  readonly current_outcome: BnRiskRecordedOutcome | null;
  readonly outcome_history: readonly BnRiskOutcomeHistoryEntry[];
  readonly closure: BnRiskClosureRecord | null;
  readonly restricted_detail_visible: boolean;
}

/** `bn_risk_closure_readiness_v1`. */
export interface BnRiskClosureReadiness {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly state: BnRiskClosureSectionState;
  readonly can_close: boolean;
  /** Reopening is exceptional and needs the Risk admin capability. */
  readonly can_reopen: boolean;
  readonly reopen_requires_capability: string;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly outcome: {
    readonly outcome_id: string;
    readonly outcome_code: string;
    readonly outcome_label: string;
    readonly finding_classification: BnRiskFindingClassification;
    readonly recorded_by_name: string | null;
    readonly recorded_at: string;
  } | null;
  readonly closure: BnRiskClosureRecord | null;
  readonly reopen_count: number;
  readonly available_actions: readonly ('CLOSE' | 'REOPEN')[];
}

export type BnRiskOutcomeQueueBucket =
  | 'READY_FOR_OUTCOME'
  | 'OUTCOME_BLOCKED'
  | 'READY_TO_CLOSE'
  | 'CLOSED'
  | 'REOPENED';

export interface BnRiskOutcomeQueueRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_name: string | null;
  readonly person_masked_identifier: string | null;
  readonly assessment_status: string;
  readonly bucket: BnRiskOutcomeQueueBucket;
  readonly stage_label: string;
  readonly action_required: string;
  /** Only populated when the caller holds restricted Risk permission. */
  readonly outcome_code: string | null;
  readonly outcome_label: string | null;
  readonly finding_classification: BnRiskFindingClassification | null;
  readonly outcome_recorded_at: string | null;
  readonly closed_at: string | null;
  readonly closed_by_name: string | null;
  readonly reopen_count: number;
  readonly assigned_owner_name: string | null;
  readonly assigned_team_code: string | null;
  readonly age_days: number;
}

export interface BnRiskOutcomeQueue {
  readonly rows: readonly BnRiskOutcomeQueueRow[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly bucket_counts: Record<string, number>;
  readonly restricted_detail_visible: boolean;
}

export interface BnRiskOutcomeCommandResult {
  readonly status: 'EXECUTED' | 'REPLAYED' | 'FAILED';
  readonly data: Record<string, unknown> | null;
  readonly outcomeId?: string;
  readonly closureId?: string;
  readonly assessmentStatus?: string;
  readonly entityVersion?: number;
  readonly businessMessage?: string | null;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly correlationId: string;
}

/** Business-readable finding wording. Never states a proven fraud finding. */
export function findingClassificationLabel(
  finding: BnRiskFindingClassification,
): string {
  switch (finding) {
    case 'LEGITIMATE_ACTIVITY': return 'Legitimate activity';
    case 'CONCERN_NOT_SUBSTANTIATED': return 'Concern not substantiated';
    case 'SYSTEM_ERROR': return 'System or configuration error';
    case 'STAFF_ERROR': return 'Staff processing error';
    case 'DATA_INCONSISTENCY': return 'Information inconsistency';
    case 'SUSPECTED_FRAUD_REFERRED': return 'Suspected fraud — referred for consideration';
    case 'CONTROL_APPLIED': return 'Control applied by the owning domain';
    case 'EXTERNAL_REVIEW_CONTINUING': return 'External review continuing';
    case 'NOT_DETERMINED': return 'Not determined';
    default: return 'Other governed outcome';
  }
}

export function outcomeQueueBucketLabel(bucket: BnRiskOutcomeQueueBucket): string {
  switch (bucket) {
    case 'READY_FOR_OUTCOME': return 'Ready for outcome';
    case 'OUTCOME_BLOCKED': return 'Outcome blocked';
    case 'READY_TO_CLOSE': return 'Ready to close';
    case 'CLOSED': return 'Closed';
    default: return 'Reopened';
  }
}

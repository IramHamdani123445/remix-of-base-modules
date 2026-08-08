/**
 * BN Risk / Fraud — EPIC 4 approved control execution and governed handoffs.
 *
 * Every shape mirrors the governed SQL boundary exactly:
 *   `bn_risk_control_execution_readiness_v1`
 *   `bn_risk_control_execution_queue_v1`
 *   `bn_risk_control_execution_command_v1`
 *   `bn_risk_outcome_readiness_v1`
 *
 * Risk decides that an approved control should be executed; the owning domain
 * executes its own business action through the shared governed handoff spine;
 * Risk records the returned reference and status. The browser never chooses a
 * control, never derives readiness, never writes a target-domain record and
 * never converts a target failure into a success.
 */

/** Canonical Epic 4 commands (named in the 18-command catalogue). */
export const BN_RISK_EXECUTION_COMMANDS = [
  'BN_RISK_PLACE_PAYMENT_HOLD',
  'BN_RISK_REQUEST_ENH_VERIFICATION',
  'BN_RISK_REFER_TO_LEGAL',
  'BN_RISK_REFER_TO_INVESTIGATION',
] as const;

/**
 * Control-execution support operations. These are deliberately *not* new
 * canonical commands: they execute approved controls that have no dedicated
 * canonical command, and they service retry / status refresh.
 */
export const BN_RISK_EXECUTION_SUPPORTING_OPERATIONS = [
  'BN_RISK_OP_EXECUTE_CONTROL',
  'BN_RISK_OP_RETRY_CONTROL_EXECUTION',
  'BN_RISK_OP_REFRESH_CONTROL_EXECUTION',
] as const;

export type BnRiskExecutionCommand =
  | (typeof BN_RISK_EXECUTION_COMMANDS)[number]
  | (typeof BN_RISK_EXECUTION_SUPPORTING_OPERATIONS)[number];

/** Backend-owned execution status. Requested is never the same as completed. */
export type BnRiskExecutionStatus =
  | 'NOT_STARTED'
  | 'READY'
  | 'PENDING'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED_BY_TARGET'
  | 'RETRY_PENDING'
  | 'CANCELLED';

/** Backend-owned readiness state for the execution surface. */
export type BnRiskExecutionSectionState =
  | 'NO_APPROVED_CONTROL'
  | 'READY'
  | 'BLOCKED'
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYABLE'
  | 'NON_RETRYABLE'
  | 'REJECTED_BY_TARGET'
  | 'CONTROL_EXECUTION_BLOCKED'
  | 'STALE'
  | 'DENIED'
  | 'UNAVAILABLE'
  | 'FAILED_TO_LOAD';

/** How the owning domain is reached. Risk never writes target tables. */
export type BnRiskExecutionBoundaryKind =
  | 'CROSS_MODULE_HANDOFF'
  | 'RISK_INTERNAL'
  | 'UNAVAILABLE';

export type BnRiskExecutionClass =
  | 'PAYMENT_CONTROL'
  | 'VERIFICATION'
  | 'REFERRAL'
  | 'FINANCIAL_REVIEW'
  | 'PROFILE_CONTROL'
  | 'REMEDIATION'
  | 'MONITORING'
  | 'NO_EXTERNAL_CONTROL';

/** The governed action the backend publishes for this execution position. */
export type BnRiskExecutionAvailableAction =
  | 'EXECUTE'
  | 'RETRY'
  | 'REFRESH'
  | 'NONE';

/** One row of the target-ownership map (`bn_risk_control_target_boundary`). */
export interface BnRiskExecutionTarget {
  readonly control_code: string;
  readonly control_label: string | null;
  readonly execution_class: BnRiskExecutionClass;
  readonly boundary_kind: BnRiskExecutionBoundaryKind;
  /** Owning domain, e.g. `Payments`. Risk is never the owner of a benefit action. */
  readonly execution_owner: string | null;
  readonly target_module: string | null;
  readonly handoff_type: string | null;
  readonly is_asynchronous: boolean;
  readonly requires_confirmation: boolean;
  /** Populated only when `boundary_kind = 'UNAVAILABLE'`. */
  readonly missing_capability: string | null;
}

/** One immutable `bn_risk_control_execution` attempt. Attempts never merge. */
export interface BnRiskControlExecutionAttempt {
  readonly execution_id: string;
  readonly execution_reference: string;
  readonly assessment_id: string;
  readonly recommendation_id: string;
  readonly decision_id: string | null;
  readonly control_code: string;
  readonly control_label: string | null;
  readonly command_name: string;
  readonly execution_class: BnRiskExecutionClass;
  readonly target_module: string | null;
  readonly target_type: string | null;
  readonly target_business_reference: string | null;
  readonly target_internal_reference: string | null;
  readonly target_operation_reference: string | null;
  readonly target_correlation_reference: string | null;
  readonly target_status: string | null;
  readonly status: BnRiskExecutionStatus;
  readonly attempt_no: number;
  readonly requested_by_name: string | null;
  readonly requested_at: string;
  readonly accepted_at: string | null;
  readonly completed_at: string | null;
  readonly failed_at: string | null;
  readonly failure_code: string | null;
  readonly failure_summary: string | null;
  readonly is_retryable: boolean;
  readonly retries_execution_id: string | null;
  readonly row_version: number;
}

/** Business-readable execution history entry for the assessment timeline. */
export interface BnRiskExecutionHistoryEntry {
  readonly event_code: string;
  readonly label: string;
  readonly occurred_at: string;
  readonly actor_name: string | null;
  readonly attempt_no: number | null;
}

/** The approved recommendation this execution is bound to. */
export interface BnRiskExecutionApprovalProvenance {
  readonly recommendation_id: string;
  readonly recommendation_reference: string;
  readonly control_code: string;
  readonly control_label: string | null;
  readonly is_benefit_affecting: boolean;
  readonly approved_reason_code: string | null;
  readonly approved_reason_label: string | null;
  readonly approved_justification: string | null;
  readonly approved_by_name: string | null;
  readonly approved_at: string | null;
  readonly recommended_by_name: string | null;
  readonly decision_id: string | null;
  /** Approved parameters — the executor may never change these. */
  readonly target_type: string | null;
  readonly target_reference: string | null;
  readonly requested_effective_from: string | null;
  readonly requested_effective_to: string | null;
  readonly scope_note: string | null;
  /** Score provenance is retained for traceability only; it authorises nothing. */
  readonly score_id: string | null;
  readonly score_version_no: number | null;
  readonly rule_set_code: string | null;
  readonly rule_set_version_no: number | null;
}

/** `bn_risk_control_execution_readiness_v1`. */
export interface BnRiskControlExecutionReadiness {
  readonly assessment_id: string;
  readonly assessment_status: string;
  readonly assessment_row_version: number;
  readonly state: BnRiskExecutionSectionState;
  readonly can_execute: boolean;
  readonly available_action: BnRiskExecutionAvailableAction;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly approval: BnRiskExecutionApprovalProvenance | null;
  readonly target: BnRiskExecutionTarget | null;
  readonly command_name: BnRiskExecutionCommand | null;
  /** Backend-declared operational fields the executor may supply, if any. */
  readonly required_parameters: readonly string[];
  readonly permitted_runtime_fields: readonly string[];
  readonly current_execution: BnRiskControlExecutionAttempt | null;
  readonly attempts: readonly BnRiskControlExecutionAttempt[];
  readonly history: readonly BnRiskExecutionHistoryEntry[];
  readonly is_retryable: boolean;
  readonly execution_status: BnRiskExecutionStatus;
  readonly status_label: string;
  readonly restricted_detail_visible: boolean;
}

/** One row of `bn_risk_control_execution_queue_v1`. */
export interface BnRiskControlExecutionQueueRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_name: string | null;
  readonly person_masked_identifier: string | null;
  readonly current_stage: string;
  readonly execution_status: BnRiskExecutionStatus;
  readonly execution_status_label: string;
  readonly target_module: string | null;
  readonly approved_at: string | null;
  readonly age_days: number;
  readonly assigned_owner_name: string | null;
  readonly assigned_team_code: string | null;
  readonly action_required: string;
  /** Only populated when the caller holds restricted Risk permission. */
  readonly control_code: string | null;
  readonly control_label: string | null;
}

export type BnRiskExecutionQueueBucket =
  | 'AWAITING_EXECUTION'
  | 'IN_PROGRESS'
  | 'FAILED'
  | 'RETRY_AVAILABLE'
  | 'REFERRAL_PENDING'
  | 'REJECTED_BY_TARGET'
  | 'AWAITING_OUTCOME';

export interface BnRiskControlExecutionQueue {
  readonly rows: readonly BnRiskControlExecutionQueueRow[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly bucket_counts: Record<string, number>;
  readonly restricted_detail_visible: boolean;
}

/** `bn_risk_outcome_readiness_v1` — a read only; Epic 5 owns outcome recording. */
export interface BnRiskOutcomeReadiness {
  readonly assessment_id: string;
  readonly all_controls_executed: boolean;
  readonly all_referrals_settled: boolean;
  readonly pending_attempts: number;
  readonly failed_attempts: number;
  readonly ready_for_outcome: boolean;
  readonly blockers: readonly string[];
}

export interface BnRiskExecutionCommandResult {
  readonly status: 'EXECUTED' | 'REPLAYED' | 'FAILED';
  readonly data: Record<string, unknown> | null;
  readonly executionId?: string;
  readonly executionStatus?: BnRiskExecutionStatus;
  readonly targetReference?: string | null;
  readonly targetStatus?: string | null;
  readonly attemptNo?: number;
  readonly isRetryable?: boolean;
  readonly reasonCode?: string | null;
  readonly businessMessage?: string | null;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly correlationId: string;
}

/** Business-readable execution status. Never optimistic. */
export function executionStatusLabel(status: BnRiskExecutionStatus): string {
  switch (status) {
    case 'NOT_STARTED': return 'Not started';
    case 'READY': return 'Ready to execute';
    case 'PENDING': return 'Requested — awaiting the owning domain';
    case 'ACCEPTED': return 'Accepted by the owning domain';
    case 'PROCESSING': return 'Being processed by the owning domain';
    case 'COMPLETED': return 'Completed by the owning domain';
    case 'FAILED': return 'Execution failed';
    case 'REJECTED_BY_TARGET': return 'Rejected by the owning domain';
    case 'RETRY_PENDING': return 'Retry requested';
    case 'CANCELLED': return 'Cancelled';
    default: return 'Unknown';
  }
}

/**
 * Payment-hold wording. "Payment stopped" is never shown: only the Payments
 * domain can confirm that a hold is active.
 */
export function paymentHoldStatusLabel(status: BnRiskExecutionStatus): string {
  switch (status) {
    case 'PENDING': return 'Hold requested';
    case 'ACCEPTED': return 'Hold accepted';
    case 'PROCESSING': return 'Hold accepted — being applied by Payments';
    case 'COMPLETED': return 'Hold active';
    case 'REJECTED_BY_TARGET': return 'Hold request rejected';
    case 'FAILED': return 'Hold failed';
    case 'RETRY_PENDING': return 'Hold retry requested';
    case 'CANCELLED': return 'Hold request cancelled';
    default: return 'Hold not requested';
  }
}

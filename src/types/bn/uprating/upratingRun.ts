/**
 * BN Uprating — Epic 1 run, population snapshot, exception and simulation
 * contracts.
 *
 * Epic 1 is strictly pre-execution: nothing in this module mutates an award,
 * an entitlement, a payment schedule or a communication. Runs may only be
 * created, parameterised, snapshotted, exception-resolved and simulated.
 */

export type BnUpratingRunStatusCode =
  | 'DRAFT'
  | 'PARAMETERISED'
  | 'ELIGIBILITY_SNAPSHOT'
  | 'EXCLUSIONS_APPLIED'
  | 'DRY_RUN'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED';

export type BnUpratingRunCommandName =
  | 'BN_UPRATING_CREATE_RUN'
  | 'BN_UPRATING_UPDATE_RUN'
  | 'BN_UPRATING_PARAMETERISE_RUN'
  | 'BN_UPRATING_BUILD_POPULATION'
  | 'BN_UPRATING_RESOLVE_EXCEPTION'
  | 'BN_UPRATING_SIMULATE'
  | 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL'
  | 'BN_UPRATING_APPROVE_RUN'
  | 'BN_UPRATING_SCHEDULE_EXECUTION'
  | 'BN_UPRATING_RESCHEDULE_EXECUTION'
  | 'BN_UPRATING_CANCEL_EXECUTION_SCHEDULE'
  | 'BN_UPRATING_EXECUTE_BATCH'
  | 'BN_UPRATING_RETRY_FAILED';

/** Commands in this boundary that are canonical Epic 1 commands. */
export const BN_UPRATING_EPIC1_CANONICAL_COMMANDS = [
  'BN_UPRATING_CREATE_RUN',
  'BN_UPRATING_BUILD_POPULATION',
  'BN_UPRATING_SIMULATE',
  'BN_UPRATING_RESOLVE_EXCEPTION',
] as const;

/** Canonical Epic 2 commands (approval and execution scheduling). */
export const BN_UPRATING_EPIC2_CANONICAL_COMMANDS = [
  'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL',
  'BN_UPRATING_APPROVE_RUN',
  'BN_UPRATING_SCHEDULE_EXECUTION',
] as const;

/** Canonical Epic 3 commands (batch execution and failed-item retry). */
export const BN_UPRATING_EPIC3_CANONICAL_COMMANDS = [
  'BN_UPRATING_EXECUTE_BATCH',
  'BN_UPRATING_RETRY_FAILED',
] as const;

/** Supporting lifecycle operations delivered inside the same boundary. */
export const BN_UPRATING_RUN_SUPPORTING_OPERATIONS = [
  'BN_UPRATING_UPDATE_RUN',
  'BN_UPRATING_PARAMETERISE_RUN',
  'BN_UPRATING_RESCHEDULE_EXECUTION',
  'BN_UPRATING_CANCEL_EXECUTION_SCHEDULE',
] as const;

export const BN_UPRATING_RUN_BOUNDARY_RPC = 'bn_uprating_run_command_v1' as const;

export const BN_UPRATING_RUN_READ_SERVICES = [
  'bn_uprating_run_list_v1',
  'bn_uprating_run_detail_v1',
  'bn_uprating_run_population_v1',
  'bn_uprating_run_exceptions_v1',
  'bn_uprating_simulation_result_v1',
  'bn_uprating_run_actions_v1',
  'bn_uprating_run_approval_readiness_v1',
  'bn_uprating_run_approval_v1',
  'bn_uprating_run_approval_queue_v1',
  'bn_uprating_execution_schedule_readiness_v1',
  'bn_uprating_scheduled_run_queue_v1',
  'bn_uprating_execution_readiness_v1',
  'bn_uprating_run_execution_v1',
  'bn_uprating_execution_items_v1',
  'bn_uprating_execution_queue_v1',
] as const;


export type BnUpratingEligibilityStatus = 'ELIGIBLE' | 'EXCLUDED' | 'DEFERRED';
export type BnUpratingItemExceptionStatus = 'NONE' | 'OPEN' | 'BLOCKING' | 'RESOLVED';
export type BnUpratingSimulationState = 'NONE' | 'CURRENT' | 'STALE';

export type BnUpratingExclusionReasonCode =
  | 'PENDING_MORTALITY'
  | 'UNRESOLVED_APPEAL'
  | 'PAYMENT_HELD'
  | 'RISK_INVESTIGATION'
  | 'MANUAL_EXCLUSION';

export type BnUpratingExceptionResolutionCode =
  | 'EXCLUDE'
  | 'CONFIRM_ELIGIBLE'
  | 'CORRECTED_AT_SOURCE'
  | 'DEFER'
  | 'ACCEPT_EXCEPTION';

export interface BnUpratingRunListRow {
  readonly run_id: string;
  readonly run_reference: string;
  readonly run_name: string | null;
  readonly status: BnUpratingRunStatusCode;
  readonly status_label: string | null;
  readonly country_code: string | null;
  readonly target_effective_date: string;
  readonly policy_id: string;
  readonly policy_code: string;
  readonly policy_name: string;
  readonly policy_version_id: string;
  readonly version_reference: string | null;
  readonly frozen_policy_type: string | null;
  readonly frozen_rounding_mode: string | null;
  readonly simulation_state: BnUpratingSimulationState;
  readonly current_snapshot_version: number | null;
  readonly current_simulation_version: number | null;
  readonly row_version: number;
  readonly created_by_name: string | null;
  readonly created_at: string;
  readonly total_items: number | null;
  readonly eligible_items: number | null;
  readonly excluded_items: number | null;
  readonly exception_items: number | null;
  readonly blocking_exception_items: number | null;
  readonly delta_total_minor: number | null;
  readonly proposed_total_minor: number | null;
  readonly current_total_minor: number | null;
}

export interface BnUpratingRunRecord extends BnUpratingRunListRow {
  readonly scope_product_id: string | null;
  readonly scope_product_code: string | null;
  readonly scope_product_name: string | null;
  readonly scope_award_type_code: string | null;
  readonly scope_award_component_code: string | null;
  readonly scope_payment_frequency: string | null;
  readonly scope_description: string | null;
  readonly frozen_percentage_bp: number | null;
  readonly frozen_fixed_amount_minor: number | null;
  readonly frozen_index_value: number | null;
  readonly frozen_index_base_value: number | null;
  readonly frozen_tiers: unknown;
  readonly frozen_applicability: Record<string, unknown> | null;
  readonly parameterised_at: string | null;
  readonly current_snapshot_id: string | null;
  readonly current_simulation_id: string | null;
  readonly input_fingerprint: string | null;
  readonly policy_version_status: string | null;
  readonly policy_effective_from: string | null;
  readonly policy_effective_to: string | null;
}

export interface BnUpratingSnapshotSummary {
  readonly snapshot_id: string;
  readonly snapshot_version: number;
  readonly status: 'CURRENT' | 'SUPERSEDED';
  readonly total_items: number;
  readonly eligible_items: number;
  readonly excluded_items: number;
  readonly exception_items: number;
  readonly blocking_exception_items: number;
  readonly current_total_minor: number;
  readonly snapshot_fingerprint: string | null;
  readonly taken_by_name: string | null;
  readonly taken_at: string;
  readonly selection_criteria: Record<string, unknown> | null;
}

export interface BnUpratingSimulationSummary {
  readonly simulation_id: string;
  readonly simulation_version: number;
  readonly status: 'CURRENT' | 'SUPERSEDED' | 'STALE';
  readonly snapshot_id: string;
  readonly input_fingerprint: string;
  readonly policy_type: string;
  readonly rounding_mode: string;
  readonly simulated_items: number;
  readonly failed_items: number;
  readonly increase_count: number;
  readonly no_change_count: number;
  readonly decrease_count: number;
  readonly current_total_minor: number;
  readonly proposed_total_minor: number;
  readonly delta_total_minor: number;
  readonly exception_total: number;
  readonly simulated_by_name: string | null;
  readonly simulated_at: string;
  readonly provenance: Record<string, unknown> | null;
}

export interface BnUpratingRunEvent {
  readonly event_id: string;
  readonly event_code: string;
  readonly event_label: string;
  readonly detail: string | null;
  readonly previous_status: string | null;
  readonly new_status: string | null;
  readonly actor_name: string | null;
  readonly occurred_at: string;
}

export interface BnUpratingSimulationHistoryRow {
  readonly simulation_id: string;
  readonly simulation_version: number;
  readonly status: string;
  readonly simulated_at: string;
  readonly simulated_by_name: string | null;
  readonly delta_total_minor: number;
  readonly input_fingerprint: string;
}

export interface BnUpratingRunDetail {
  readonly run: BnUpratingRunRecord;
  readonly snapshot: BnUpratingSnapshotSummary | null;
  readonly simulation: BnUpratingSimulationSummary | null;
  readonly simulation_history: readonly BnUpratingSimulationHistoryRow[];
  readonly events: readonly BnUpratingRunEvent[];
}

export interface BnUpratingPopulationRow {
  readonly snapshot_item_id: string;
  readonly award_reference: string;
  /** Last four digits only — no full identifier is ever exposed. */
  readonly person_reference: string | null;
  readonly product_code: string | null;
  readonly product_name: string | null;
  readonly product_version_id: string | null;
  readonly award_type_code: string | null;
  readonly award_component_code: string | null;
  readonly award_status: string | null;
  readonly base_amount_minor: number | null;
  readonly currency_code: string | null;
  readonly payment_frequency: string | null;
  readonly award_start_date: string | null;
  readonly award_end_date: string | null;
  readonly source_row_version: number | null;
  readonly eligibility_status: BnUpratingEligibilityStatus;
  readonly exclusion_reason_code: BnUpratingExclusionReasonCode | null;
  readonly exclusion_reason_label: string | null;
  readonly exception_status: BnUpratingItemExceptionStatus;
  readonly inclusion_explanation: string | null;
}

export interface BnUpratingExceptionHistoryRow {
  readonly sequence_no: number;
  readonly action_code: string;
  readonly resolution_code: string | null;
  readonly justification: string | null;
  readonly actor_name: string | null;
  readonly occurred_at: string;
}

export interface BnUpratingExceptionRow {
  readonly exception_id: string;
  readonly snapshot_item_id: string;
  readonly award_reference: string;
  readonly exception_code: string;
  readonly exception_label: string | null;
  readonly severity: string;
  readonly is_blocking: boolean;
  readonly owning_domain: string;
  readonly business_explanation: string;
  readonly detected_at: string;
  readonly resolution_status: 'OPEN' | 'RESOLVED';
  readonly resolution_code: string | null;
  readonly resolution_label: string | null;
  readonly justification: string | null;
  readonly resolved_by_name: string | null;
  readonly resolved_at: string | null;
  readonly row_version: number;
  readonly allowed_resolutions: readonly string[];
  readonly requires_source_correction: boolean;
  readonly history: readonly BnUpratingExceptionHistoryRow[];
}

export interface BnUpratingSimulationItemRow {
  readonly simulation_item_id: string;
  readonly award_reference: string;
  readonly award_component_code: string | null;
  readonly base_amount_minor: number;
  readonly policy_method: string;
  readonly unrounded_amount_minor: number;
  readonly rounding_mode: string;
  readonly proposed_amount_minor: number;
  readonly delta_amount_minor: number;
  readonly applied_percentage_bp: number | null;
  readonly applied_fixed_amount_minor: number | null;
  readonly applied_factor: number | null;
  readonly matched_tier_sequence: number | null;
  readonly calculation_status: 'CALCULATED' | 'FAILED' | 'SKIPPED';
  readonly exception_status: BnUpratingItemExceptionStatus;
  readonly calculation_trace: readonly Record<string, unknown>[];
  readonly input_fingerprint: string;
}

export interface BnUpratingRunAction {
  readonly command: BnUpratingRunCommandName;
  readonly label: string;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface BnUpratingRunActionsResult {
  readonly run_id: string;
  readonly status: BnUpratingRunStatusCode;
  readonly row_version: number;
  readonly simulation_state: BnUpratingSimulationState;
  readonly blocking_exceptions: number;
  readonly actions: readonly BnUpratingRunAction[];
}

/** Governed run transitions across Epic 0-3. */
export const BN_UPRATING_EPIC1_RUN_TRANSITIONS: Readonly<
  Record<BnUpratingRunStatusCode, readonly BnUpratingRunStatusCode[]>
> = {
  DRAFT: ['PARAMETERISED'],
  PARAMETERISED: ['ELIGIBILITY_SNAPSHOT', 'EXCLUSIONS_APPLIED'],
  ELIGIBILITY_SNAPSHOT: ['EXCLUSIONS_APPLIED', 'DRY_RUN', 'ELIGIBILITY_SNAPSHOT'],
  EXCLUSIONS_APPLIED: ['ELIGIBILITY_SNAPSHOT', 'EXCLUSIONS_APPLIED', 'DRY_RUN'],
  DRY_RUN: ['ELIGIBILITY_SNAPSHOT', 'EXCLUSIONS_APPLIED', 'DRY_RUN', 'AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['APPROVED', 'DRY_RUN'],
  APPROVED: ['EXECUTING'],
  EXECUTING: ['EXECUTING', 'COMPLETED', 'PARTIAL', 'FAILED'],
  PARTIAL: ['EXECUTING'],
  COMPLETED: [],
  FAILED: [],
};

/** Alias used by Epic 2 surfaces — the same governed transition map. */
export const BN_UPRATING_RUN_TRANSITIONS_TO_EPIC2 = BN_UPRATING_EPIC1_RUN_TRANSITIONS;

export function canUpratingEpic1Transition(
  from: BnUpratingRunStatusCode,
  to: BnUpratingRunStatusCode,
): boolean {
  return BN_UPRATING_EPIC1_RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses in which the pre-approval preparation steps remain available. */
export const BN_UPRATING_PRE_APPROVAL_STATUSES: readonly BnUpratingRunStatusCode[] = [
  'DRAFT',
  'PARAMETERISED',
  'ELIGIBILITY_SNAPSHOT',
  'EXCLUSIONS_APPLIED',
  'DRY_RUN',
];

// ---------------------------------------------------------------------------
// Epic 2 — approval package, approval cycle and execution schedule contracts
// ---------------------------------------------------------------------------

export type BnUpratingApprovalStatus = 'PENDING' | 'APPROVED' | 'RETURNED';
export type BnUpratingApprovalDecision = 'APPROVE' | 'RETURN_FOR_REWORK';
export type BnUpratingPackageStatus = 'CURRENT' | 'APPROVED' | 'HISTORICAL' | 'SUPERSEDED';
export type BnUpratingScheduleStatus = 'PLANNED' | 'DUE' | 'SUPERSEDED' | 'CANCELLED';

export interface BnUpratingReadinessItem {
  readonly code: string;
  readonly message: string;
}

export interface BnUpratingApprovalReadiness {
  readonly run_id: string;
  readonly run_reference: string;
  readonly status: BnUpratingRunStatusCode;
  readonly row_version: number;
  readonly can_submit: boolean;
  readonly blockers: readonly BnUpratingReadinessItem[];
  readonly warnings: readonly BnUpratingReadinessItem[];
  readonly current_snapshot_version: number | null;
  readonly current_simulation_version: number | null;
  readonly simulation_fingerprint: string | null;
  readonly available_action: 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL' | null;
  readonly population_summary: {
    readonly total_items: number;
    readonly included_count: number;
    readonly excluded_count: number;
  };
  readonly exception_summary: {
    readonly exception_items: number;
    readonly open_exceptions: number;
    readonly unresolved_blocking: number;
  };
  readonly financial_summary: {
    readonly simulated_current_total_minor: number;
    readonly simulated_proposed_total_minor: number;
    readonly simulated_change_minor: number;
    readonly failed_items: number;
  };
}

export interface BnUpratingApprovalPackage {
  readonly package_id: string;
  readonly run_id: string;
  readonly cycle_no: number;
  readonly run_row_version: number;
  readonly policy_version_reference: string | null;
  readonly frozen_policy_type: string | null;
  readonly target_effective_date: string;
  readonly scope_description: string | null;
  readonly snapshot_version: number;
  readonly snapshot_fingerprint: string | null;
  readonly simulation_version: number;
  readonly input_fingerprint: string;
  readonly population_total: number;
  readonly included_count: number;
  readonly excluded_count: number;
  readonly exception_count: number;
  readonly unresolved_blocking_count: number;
  readonly failed_item_count: number;
  readonly current_total_minor: number;
  readonly proposed_total_minor: number;
  readonly delta_total_minor: number;
  readonly status: BnUpratingPackageStatus;
  readonly submitted_by: string;
  readonly submitted_by_name: string | null;
  readonly submitted_at: string;
}

export interface BnUpratingApprovalCycle {
  readonly approval_id: string;
  readonly package_id: string;
  readonly cycle_no: number;
  readonly status: BnUpratingApprovalStatus;
  readonly submitted_by: string;
  readonly submitted_by_name: string | null;
  readonly submitted_at: string;
  readonly submission_note: string | null;
  readonly decision: BnUpratingApprovalDecision | null;
  readonly decision_reason: string | null;
  readonly justification: string | null;
  readonly decided_by_name: string | null;
  readonly decided_at: string | null;
  readonly row_version: number;
}

export interface BnUpratingExecutionSchedule {
  readonly schedule_id: string;
  readonly run_id: string;
  readonly approval_id: string;
  readonly package_id: string;
  readonly schedule_version: number;
  readonly status: BnUpratingScheduleStatus;
  readonly planned_execution_at: string;
  readonly time_zone: string;
  readonly window_start_at: string | null;
  readonly window_end_at: string | null;
  readonly batch_size: number | null;
  readonly max_concurrent_batches: number | null;
  readonly batch_strategy: string | null;
  readonly notes: string | null;
  readonly supersedes_schedule_id: string | null;
  readonly cancelled_reason: string | null;
  readonly cancelled_at: string | null;
  readonly cancelled_by_name: string | null;
  readonly created_by_name: string | null;
  readonly created_at: string;
  readonly row_version: number;
}

export interface BnUpratingRunApprovalView {
  readonly run_id: string;
  readonly run_reference: string;
  readonly status: BnUpratingRunStatusCode;
  readonly row_version: number;
  readonly current_package: BnUpratingApprovalPackage | null;
  readonly cycles: readonly BnUpratingApprovalCycle[];
  readonly schedules: readonly BnUpratingExecutionSchedule[];
  readonly approval_readiness: BnUpratingApprovalReadiness;
}

export interface BnUpratingScheduleConfiguration {
  readonly DEFAULT_TIME_ZONE?: string;
  readonly DEFAULT_BATCH_SIZE?: string;
  readonly MIN_BATCH_SIZE?: string;
  readonly MAX_BATCH_SIZE?: string;
  readonly DEFAULT_MAX_CONCURRENT_BATCHES?: string;
  readonly MAX_CONCURRENT_BATCHES?: string;
  readonly MIN_LEAD_MINUTES?: string;
}

export interface BnUpratingScheduleReadiness {
  readonly run_id: string;
  readonly run_reference: string;
  readonly status: BnUpratingRunStatusCode;
  readonly row_version: number;
  readonly can_schedule: boolean;
  readonly blockers: readonly BnUpratingReadinessItem[];
  readonly warnings: readonly BnUpratingReadinessItem[];
  readonly approved_package: {
    readonly package_id: string;
    readonly cycle_no: number;
    readonly snapshot_version: number;
    readonly simulation_version: number;
    readonly input_fingerprint: string;
    readonly target_effective_date: string;
    readonly included_count: number;
    readonly excluded_count: number;
    readonly simulated_current_total_minor: number;
    readonly simulated_proposed_total_minor: number;
    readonly simulated_change_minor: number;
    readonly approved_by_name: string | null;
    readonly approved_at: string | null;
  } | null;
  readonly current_schedule: BnUpratingExecutionSchedule | null;
  readonly allowed_scheduling_fields: Record<string, boolean>;
  readonly configuration: BnUpratingScheduleConfiguration;
  readonly available_actions: readonly BnUpratingRunCommandName[];
}

export interface BnUpratingApprovalQueueRow {
  readonly approval_id: string;
  readonly package_id: string;
  readonly cycle_no: number;
  readonly run_id: string;
  readonly run_reference: string;
  readonly run_name: string | null;
  readonly policy_code: string;
  readonly policy_name: string;
  readonly policy_version_reference: string | null;
  readonly target_effective_date: string;
  readonly population_total: number;
  readonly included_count: number;
  readonly excluded_count: number;
  readonly exception_count: number;
  readonly unresolved_blocking_count: number;
  readonly simulated_current_total_minor: number;
  readonly simulated_proposed_total_minor: number;
  readonly simulated_change_minor: number;
  readonly submitted_by: string;
  readonly submitted_by_name: string | null;
  readonly submitted_at: string;
  readonly age_hours: number;
  readonly action_required: string;
}

export interface BnUpratingScheduledRunRow {
  readonly run_id: string;
  readonly run_reference: string;
  readonly run_name: string | null;
  readonly target_effective_date: string;
  readonly approved_at: string | null;
  readonly approved_by_name: string | null;
  readonly schedule_id: string | null;
  readonly schedule_version: number | null;
  readonly planned_execution_at: string | null;
  readonly time_zone: string | null;
  readonly schedule_status: string;
  readonly queue_state: 'APPROVED_NOT_SCHEDULED' | 'SCHEDULED' | 'DUE';
}

// ---------------------------------------------------------------------------
// Epic 3 — batch execution and failed-item retry contracts.
//
// Execution applies exactly what was approved. Nothing on this surface
// recalculates an amount: every value below originates from the frozen
// approval package and its simulation items.
// ---------------------------------------------------------------------------

export type BnUpratingExecutionSessionStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIAL';

export type BnUpratingExecutionBatchStatus = 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

export type BnUpratingExecutionBatchKind = 'PRIMARY' | 'RETRY';

export type BnUpratingExecutionItemStatus =
  | 'PENDING'
  | 'APPLIED'
  | 'FAILED'
  | 'SKIPPED'
  | 'SUPERSEDED';

export type BnUpratingExecutionFailureCode =
  | 'AWARD_NOT_FOUND'
  | 'STALE_ROW_VERSION'
  | 'AWARD_STATUS_CHANGED'
  | 'AWARD_PAYMENT_HELD'
  | 'BASE_AMOUNT_MISMATCH'
  | 'TRANSIENT_ERROR';

/** Failure codes that may be retried; everything else must be fixed at source. */
export const BN_UPRATING_RETRYABLE_FAILURE_CODES: readonly BnUpratingExecutionFailureCode[] = [
  'AWARD_PAYMENT_HELD',
  'TRANSIENT_ERROR',
];

export function isUpratingFailureRetryable(
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  return (BN_UPRATING_RETRYABLE_FAILURE_CODES as readonly string[]).includes(code);
}

export interface BnUpratingExecutionSession {
  readonly session_id: string;
  readonly status: BnUpratingExecutionSessionStatus;
  readonly batch_size: number;
  readonly planned_item_count: number;
  readonly planned_batch_count: number;
  readonly completed_batch_count: number;
  readonly applied_item_count: number;
  readonly failed_item_count: number;
  readonly skipped_item_count: number;
  readonly approved_delta_total_minor: number;
  readonly applied_delta_total_minor: number;
  readonly target_effective_date: string;
  readonly input_fingerprint: string;
  readonly started_by_name: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly row_version: number;
  readonly planned_execution_at: string | null;
  readonly time_zone: string | null;
}

export interface BnUpratingExecutionBatch {
  readonly batch_id: string;
  readonly batch_no: number;
  readonly batch_kind: BnUpratingExecutionBatchKind;
  readonly status: BnUpratingExecutionBatchStatus;
  readonly item_count: number;
  readonly applied_count: number;
  readonly failed_count: number;
  readonly skipped_count: number;
  readonly applied_delta_minor: number;
  readonly executed_by_name: string | null;
  readonly executed_at: string | null;
}

export interface BnUpratingExecutionFailureSummaryRow {
  readonly failure_code: string | null;
  readonly label: string | null;
  readonly count: number;
  readonly retryable: boolean;
}

export interface BnUpratingRunExecutionView {
  readonly run_id: string;
  readonly run_reference: string;
  readonly run_status: BnUpratingRunStatusCode;
  readonly has_session: boolean;
  readonly session: BnUpratingExecutionSession | null;
  readonly batches: readonly BnUpratingExecutionBatch[];
  readonly failure_summary: readonly BnUpratingExecutionFailureSummaryRow[];
}

export interface BnUpratingExecutionItemRow {
  readonly execution_item_id: string;
  readonly batch_id: string;
  readonly batch_no: number;
  readonly batch_kind: BnUpratingExecutionBatchKind;
  readonly award_reference: string;
  readonly award_component_code: string | null;
  readonly attempt_no: number;
  readonly status: BnUpratingExecutionItemStatus;
  readonly status_label: string | null;
  readonly approved_base_amount_minor: number;
  readonly approved_amount_minor: number;
  readonly approved_delta_minor: number;
  readonly applied_amount_minor: number | null;
  readonly applied_delta_minor: number | null;
  readonly expected_row_version: number | null;
  readonly observed_row_version: number | null;
  readonly applied_row_version: number | null;
  readonly failure_code: string | null;
  readonly failure_label: string | null;
  readonly failure_reason: string | null;
  readonly is_retryable: boolean;
  readonly applied_at: string | null;
}

export interface BnUpratingExecutionReadiness {
  readonly run_id: string;
  readonly run_reference: string;
  readonly status: BnUpratingRunStatusCode;
  readonly row_version: number;
  readonly can_execute: boolean;
  readonly can_retry: boolean;
  readonly blockers: readonly BnUpratingReadinessItem[];
  readonly warnings: readonly BnUpratingReadinessItem[];
  readonly has_session: boolean;
  readonly session_status: BnUpratingExecutionSessionStatus | null;
  readonly pending_batches: number;
  readonly retryable_failures: number;
  readonly permanent_failures: number;
  readonly planned_item_count: number;
  readonly planned_batch_count: number | null;
  readonly schedule_id: string | null;
  readonly planned_execution_at: string | null;
  readonly batch_size: number | null;
  readonly approved_delta_total_minor: number;
}

export interface BnUpratingExecutionQueueRow {
  readonly run_id: string;
  readonly run_reference: string;
  readonly run_name: string | null;
  readonly status: BnUpratingRunStatusCode;
  readonly status_label: string | null;
  readonly target_effective_date: string;
  readonly planned_item_count: number;
  readonly applied_item_count: number;
  readonly failed_item_count: number;
  readonly planned_batch_count: number;
  readonly completed_batch_count: number;
  readonly applied_delta_total_minor: number;
  readonly approved_delta_total_minor: number;
  readonly planned_execution_at: string | null;
  readonly execution_started_at: string | null;
  readonly execution_completed_at: string | null;
}

/** Run statuses in which execution has begun and preparation is locked. */
export const BN_UPRATING_EXECUTION_STATUSES: readonly BnUpratingRunStatusCode[] = [
  'EXECUTING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
];

export function upratingExecutionProgressPercent(
  session: BnUpratingExecutionSession | null | undefined,
): number {
  if (!session || session.planned_item_count <= 0) return 0;
  const done = session.applied_item_count + session.failed_item_count + session.skipped_item_count;
  return Math.min(100, Math.round((done / session.planned_item_count) * 100));
}


/** Policy methods that cannot be simulated deterministically in Epic 1. */
export const BN_UPRATING_NON_SIMULATABLE_POLICY_TYPES = [
  'FORMULA_DRIVEN',
  'MANUAL_IMPORT',
] as const;

export function isUpratingPolicyTypeSimulatable(policyType: string | null | undefined): boolean {
  if (!policyType) return false;
  return !(BN_UPRATING_NON_SIMULATABLE_POLICY_TYPES as readonly string[]).includes(policyType);
}

export function formatMinor(
  amountMinor: number | null | undefined,
  currency = 'XCD',
): string {
  const value = (amountMinor ?? 0) / 100;
  return `${currency} ${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

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
  | 'DRY_RUN';

export type BnUpratingRunCommandName =
  | 'BN_UPRATING_CREATE_RUN'
  | 'BN_UPRATING_UPDATE_RUN'
  | 'BN_UPRATING_PARAMETERISE_RUN'
  | 'BN_UPRATING_BUILD_POPULATION'
  | 'BN_UPRATING_RESOLVE_EXCEPTION'
  | 'BN_UPRATING_SIMULATE';

/** Commands in this boundary that are canonical Epic 1 commands. */
export const BN_UPRATING_EPIC1_CANONICAL_COMMANDS = [
  'BN_UPRATING_CREATE_RUN',
  'BN_UPRATING_BUILD_POPULATION',
  'BN_UPRATING_SIMULATE',
  'BN_UPRATING_RESOLVE_EXCEPTION',
] as const;

/** Supporting lifecycle operations delivered inside the same boundary. */
export const BN_UPRATING_RUN_SUPPORTING_OPERATIONS = [
  'BN_UPRATING_UPDATE_RUN',
  'BN_UPRATING_PARAMETERISE_RUN',
] as const;

export const BN_UPRATING_RUN_BOUNDARY_RPC = 'bn_uprating_run_command_v1' as const;

export const BN_UPRATING_RUN_READ_SERVICES = [
  'bn_uprating_run_list_v1',
  'bn_uprating_run_detail_v1',
  'bn_uprating_run_population_v1',
  'bn_uprating_run_exceptions_v1',
  'bn_uprating_simulation_result_v1',
  'bn_uprating_run_actions_v1',
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

/** Run statuses reachable in Epic 1 (execution states arrive in Epic 2+). */
export const BN_UPRATING_EPIC1_RUN_TRANSITIONS: Readonly<
  Record<BnUpratingRunStatusCode, readonly BnUpratingRunStatusCode[]>
> = {
  DRAFT: ['PARAMETERISED'],
  PARAMETERISED: ['ELIGIBILITY_SNAPSHOT', 'EXCLUSIONS_APPLIED'],
  ELIGIBILITY_SNAPSHOT: ['EXCLUSIONS_APPLIED', 'DRY_RUN', 'ELIGIBILITY_SNAPSHOT'],
  EXCLUSIONS_APPLIED: ['ELIGIBILITY_SNAPSHOT', 'EXCLUSIONS_APPLIED', 'DRY_RUN'],
  DRY_RUN: ['ELIGIBILITY_SNAPSHOT', 'EXCLUSIONS_APPLIED', 'DRY_RUN'],
};

export function canUpratingEpic1Transition(
  from: BnUpratingRunStatusCode,
  to: BnUpratingRunStatusCode,
): boolean {
  return BN_UPRATING_EPIC1_RUN_TRANSITIONS[from]?.includes(to) ?? false;
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

/**
 * BN Uprating — Policy catalogue and version governance types (Epic 0).
 *
 * These types describe the governed policy catalogue only. No run, population,
 * simulation, execution, payment, communication or reconciliation concept is
 * modelled here — those belong to later Uprating epics.
 */
import type { BnUpratingPolicyType, BnUpratingRoundingMode } from './upratingPolicyTypes';
import type { BnUpratingPolicyStatus } from './upratingPolicyStateMachine';

/** Commands implemented by Epic 0 (canonical + governed lifecycle operations). */
export type BnUpratingPolicyCommandName =
  | 'BN_UPRATING_CREATE_POLICY'
  | 'BN_UPRATING_CREATE_POLICY_VERSION'
  | 'BN_UPRATING_UPDATE_POLICY_VERSION'
  | 'BN_UPRATING_VALIDATE_POLICY'
  | 'BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL'
  | 'BN_UPRATING_APPROVE_POLICY'
  | 'BN_UPRATING_ACTIVATE_POLICY_VERSION'
  | 'BN_UPRATING_SUPERSEDE_POLICY_VERSION'
  | 'BN_UPRATING_RETIRE_POLICY_VERSION';

export type BnUpratingApprovalDecision = 'APPROVE' | 'RETURN_TO_DRAFT' | 'REJECT';

export type BnUpratingValidationStatus = 'NOT_VALIDATED' | 'VALID' | 'INVALID';

export type BnUpratingPolicyAction =
  | 'edit_draft'
  | 'validate'
  | 'submit_for_approval'
  | 'create_version'
  | 'approve'
  | 'return'
  | 'reject'
  | 'activate'
  | 'supersede'
  | 'retire';

export interface BnUpratingValidationFinding {
  readonly code: string;
  readonly field?: string | null;
  readonly message: string;
}

export interface BnUpratingReferenceOption {
  readonly code: string;
  readonly label: string;
  readonly description?: string | null;
}

export interface BnUpratingIndexSeriesOption {
  readonly index_series_id: string;
  readonly series_code: string;
  readonly series_name: string;
  readonly unit?: string | null;
}

export interface BnUpratingProductOption {
  readonly id: string;
  readonly code?: string | null;
  readonly label: string;
}

export interface BnUpratingFormulaVersionOption {
  readonly id: string;
  readonly template_id?: string | null;
  readonly label: string;
  readonly governance_status?: string | null;
  readonly is_active?: boolean | null;
}

export interface BnUpratingReferenceData {
  readonly reference: Record<string, readonly BnUpratingReferenceOption[]>;
  readonly index_series: readonly BnUpratingIndexSeriesOption[];
  readonly products: readonly BnUpratingProductOption[];
  readonly formula_versions: readonly BnUpratingFormulaVersionOption[];
}

export interface BnUpratingPolicyTier {
  readonly tier_id?: string;
  readonly sequence_no: number;
  readonly lower_bound_minor: number;
  readonly upper_bound_minor: number | null;
  readonly percentage_bp: number | null;
  readonly fixed_amount_minor: number | null;
}

export interface BnUpratingPolicyApprovalRecord {
  readonly approval_id: string;
  readonly sequence_no: number;
  readonly decision: BnUpratingApprovalDecision;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly justification: string;
  readonly decided_by: string;
  readonly decided_by_name: string | null;
  readonly decided_at: string;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
}

export interface BnUpratingPolicyVersion {
  readonly policy_version_id: string;
  readonly policy_id: string;
  readonly version_no: number;
  readonly version_reference: string;
  readonly status: BnUpratingPolicyStatus;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly policy_type: BnUpratingPolicyType;
  readonly rounding_mode: BnUpratingRoundingMode;
  readonly percentage_bp: number | null;
  readonly fixed_amount_minor: number | null;
  readonly currency_code: string | null;
  readonly index_series_id: string | null;
  readonly index_reference_period: string | null;
  readonly index_base_period: string | null;
  readonly formula_template_id: string | null;
  readonly formula_version_id: string | null;
  readonly manual_source_code: string | null;
  readonly manual_source_description: string | null;
  readonly country_code: string | null;
  readonly product_id: string | null;
  readonly award_type_code: string | null;
  readonly award_component_code: string | null;
  readonly payment_frequency: string | null;
  readonly legal_reference_id: string | null;
  readonly source_reference: string | null;
  readonly validation_status: BnUpratingValidationStatus;
  readonly validation_errors: readonly BnUpratingValidationFinding[];
  readonly validation_warnings: readonly BnUpratingValidationFinding[];
  readonly validated_at: string | null;
  readonly validated_by_name: string | null;
  readonly submitted_by: string | null;
  readonly submitted_by_name: string | null;
  readonly submitted_at: string | null;
  readonly approval_decision: BnUpratingApprovalDecision | null;
  readonly approved_by: string | null;
  readonly approved_by_name: string | null;
  readonly approved_at: string | null;
  readonly decision_reason_code: string | null;
  readonly decision_justification: string | null;
  readonly activated_at: string | null;
  readonly superseded_at: string | null;
  readonly retired_at: string | null;
  readonly retirement_reason_code: string | null;
  readonly row_version: number;
  readonly created_by: string | null;
  readonly created_by_name: string | null;
  readonly created_at: string;
  readonly tiers: readonly BnUpratingPolicyTier[];
  readonly approvals: readonly BnUpratingPolicyApprovalRecord[];
}

export interface BnUpratingPolicy {
  readonly policy_id: string;
  readonly policy_code: string;
  readonly policy_name: string;
  readonly description: string | null;
  readonly country_code: string | null;
  readonly product_id: string | null;
  readonly award_component_code: string | null;
  readonly policy_type: BnUpratingPolicyType;
  readonly owner_name: string | null;
  readonly status: 'ACTIVE' | 'CLOSED';
  readonly created_by_name: string | null;
  readonly created_at: string;
}

export interface BnUpratingPolicyListRow extends BnUpratingPolicy {
  readonly active_version: {
    readonly policy_version_id: string;
    readonly version_no: number;
    readonly version_reference: string;
    readonly status: BnUpratingPolicyStatus;
    readonly effective_from: string | null;
    readonly effective_to: string | null;
    readonly validation_status: BnUpratingValidationStatus;
  } | null;
  readonly version_count: number;
  readonly open_version_count: number;
}

export interface BnUpratingPolicyDetail {
  readonly policy: BnUpratingPolicy;
  readonly versions: readonly BnUpratingPolicyVersion[];
  readonly events: readonly BnUpratingPolicyEvent[];
}

export interface BnUpratingPolicyEvent {
  readonly event_id: string;
  readonly policy_version_id: string | null;
  readonly event_code: string;
  readonly event_label: string;
  readonly detail: string | null;
  readonly previous_status: string | null;
  readonly new_status: string | null;
  readonly actor_name: string | null;
  readonly occurred_at: string;
}

export interface BnUpratingApprovalQueueRow {
  readonly policy_version_id: string;
  readonly policy_id: string;
  readonly policy_code: string;
  readonly policy_name: string;
  readonly version_no: number;
  readonly version_reference: string;
  readonly status: BnUpratingPolicyStatus;
  readonly policy_type: BnUpratingPolicyType;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly submitted_at: string | null;
  readonly submitted_by_name: string | null;
  readonly row_version: number;
  readonly can_decide: boolean;
}

export interface BnUpratingActionsResult {
  readonly policy_version_id: string;
  readonly status: BnUpratingPolicyStatus;
  readonly validation_status: BnUpratingValidationStatus;
  readonly row_version: number;
  readonly actions: readonly BnUpratingPolicyAction[];
}

export interface BnUpratingReadiness {
  readonly can_validate?: boolean;
  readonly can_decide?: boolean;
  readonly blockers: readonly string[];
  readonly status: BnUpratingPolicyStatus;
  readonly validation_status?: BnUpratingValidationStatus;
  readonly requires_justification?: boolean;
  readonly independent?: boolean;
}

export interface BnUpratingQueryResult<T> {
  readonly status: 'OK' | 'ERROR';
  readonly code?: string | null;
  readonly message?: string | null;
  readonly data: T | null;
}

export interface BnUpratingCommandResult {
  readonly status: 'OK' | 'REPLAYED' | 'ERROR';
  readonly code?: string | null;
  readonly message?: string | null;
  readonly data: Record<string, unknown> | null;
}

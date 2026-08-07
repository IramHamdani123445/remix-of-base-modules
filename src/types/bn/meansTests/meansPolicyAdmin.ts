/**
 * MEANS-TEST — Policy Configuration contract.
 *
 * Mirrors the governed backend reads `bn_means_policy_admin_list_v1`,
 * `bn_means_policy_admin_detail_v1` and `bn_means_policy_validation_v1`,
 * and the single mutation boundary `bn_means_policy_command_v1`.
 *
 * React never decides whether a policy version may be activated: the
 * backend validation gate owns that decision and returns the blockers.
 */

export const BN_MEANS_POLICY_COMMANDS = [
  'CREATE_POLICY',
  'UPDATE_DRAFT_POLICY',
  'ACTIVATE_POLICY',
  'RETIRE_POLICY',
  'CREATE_POLICY_VERSION',
  'UPDATE_DRAFT_VERSION',
  'UPSERT_CATEGORY',
  'DELETE_CATEGORY',
  'VALIDATE_VERSION',
  'ACTIVATE_VERSION',
  'SUPERSEDE_VERSION',
  'RETIRE_VERSION',
] as const;

export type BnMeansPolicyCommand = (typeof BN_MEANS_POLICY_COMMANDS)[number];

export type BnMeansPolicyStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type BnMeansPolicyVersionStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';
export type BnMeansPolicyValidationState = 'NOT_VALIDATED' | 'READY' | 'BLOCKED';
export type BnMeansCategoryKind = 'INCOME' | 'ASSET' | 'DEDUCTION';

export interface BnMeansPolicyFinding {
  readonly code: string;
  readonly message: string;
  readonly parameter?: string;
}

export interface BnMeansPolicyValidationReport {
  readonly policy_version_id?: string;
  readonly policy_id?: string;
  readonly benefit_programme?: string;
  readonly can_activate: boolean;
  readonly reason_codes: readonly string[];
  readonly blockers: readonly BnMeansPolicyFinding[];
  readonly warnings: readonly BnMeansPolicyFinding[];
  readonly evaluated_at?: string;
  readonly actor_can_configure?: boolean;
}

export interface BnMeansPolicyListRow {
  readonly policy_id: string;
  readonly policy_code: string;
  readonly policy_name: string;
  readonly benefit_programme: string;
  readonly programme_label: string;
  readonly authority_reference: string | null;
  readonly policy_status: BnMeansPolicyStatus;
  readonly policy_row_version: number;
  readonly policy_version_id: string | null;
  readonly version_label: string | null;
  readonly version_status: BnMeansPolicyVersionStatus | null;
  readonly validation_state: BnMeansPolicyValidationState | null;
  readonly validated_at: string | null;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly currency_code: string | null;
  readonly row_version: number | null;
  readonly assessment_count: number;
  readonly is_in_force: boolean;
}

export interface BnMeansProgrammeOption {
  readonly code: string;
  readonly label: string;
}

export interface BnMeansPolicyList {
  readonly rows: readonly BnMeansPolicyListRow[];
  readonly can_configure: boolean;
  readonly summary: {
    readonly programmes: number;
    readonly policies: number;
    readonly in_force: number;
    readonly requires_configuration: number;
  };
  readonly programme_catalogue: readonly BnMeansProgrammeOption[];
}

export interface BnMeansPolicyCategory {
  readonly category_id: string;
  readonly category_kind: BnMeansCategoryKind;
  readonly category_code: string;
  readonly category_name: string;
  readonly is_assessable: boolean;
  readonly requires_evidence: boolean;
  readonly disregard_rule: Record<string, unknown>;
  readonly display_order: number;
}

export interface BnMeansPolicyVersionDetail {
  readonly policy_version_id: string;
  readonly version_label: string;
  readonly status: BnMeansPolicyVersionStatus;
  readonly validation_state: BnMeansPolicyValidationState;
  readonly validated_at: string | null;
  readonly validation_report: BnMeansPolicyValidationReport | Record<string, never>;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly currency_code: string;
  readonly rounding_method: string;
  readonly rounding_scale: number;
  readonly validity_months: number | null;
  readonly reassessment_months: number | null;
  readonly authority_reference: string | null;
  readonly household_rules: Record<string, unknown>;
  readonly income_rules: Record<string, unknown>;
  readonly asset_rules: Record<string, unknown>;
  readonly deduction_rules: Record<string, unknown>;
  readonly decision_rules: Record<string, unknown>;
  readonly threshold_parameters: Record<string, unknown>;
  readonly required_evidence: readonly string[];
  readonly row_version: number;
  readonly superseded_by: string | null;
  readonly assessment_count: number;
  readonly categories: readonly BnMeansPolicyCategory[];
}

export interface BnMeansPolicyDetail {
  readonly policy: {
    readonly policy_id: string;
    readonly policy_code: string;
    readonly policy_name: string;
    readonly benefit_programme: string;
    readonly programme_label: string;
    readonly authority_reference: string | null;
    readonly status: BnMeansPolicyStatus;
    readonly row_version: number;
  };
  readonly versions: readonly BnMeansPolicyVersionDetail[];
  readonly can_configure: boolean;
}

/** The business fields an officer edits on a draft version. */
export interface BnMeansPolicyVersionForm {
  version_label: string;
  effective_from: string;
  effective_to: string;
  currency_code: string;
  rounding_method: string;
  rounding_scale: number;
  validity_months: string;
  reassessment_months: string;
  authority_reference: string;
  threshold_basis: string;
  income_threshold: string;
  per_member_increment: string;
  disregard: string;
  asset_threshold: string;
  count_spouse: boolean;
  count_dependants: boolean;
  required_evidence: readonly string[];
}

export const BN_MEANS_ROUNDING_METHODS = ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] as const;
export const BN_MEANS_THRESHOLD_BASES = ['ANNUAL', 'MONTHLY', 'WEEKLY'] as const;

/** Human wording for the backend's structured configuration failures. */
export const BN_MEANS_POLICY_ERROR_TEXT: Record<string, string> = {
  PERMISSION_DENIED: 'You do not hold the Means-Test configuration permission.',
  ACTIONS_DISABLED: 'Means-Test actions are currently disabled for this environment.',
  UNAUTHENTICATED: 'Your session has expired. Sign in again to continue.',
  STALE_ROW_VERSION: 'Someone else changed this policy while you were editing. Reload and try again.',
  DUPLICATE_POLICY_CODE: 'A policy with this code already exists.',
  DUPLICATE_VERSION_LABEL: 'This policy already has a version with that label.',
  PROGRAMME_UNKNOWN: 'The selected benefit programme is not a registered benefit product.',
  VERSION_NOT_EDITABLE: 'Only a draft version can be edited. Create a new version instead.',
  ACTIVATION_BLOCKED: 'This version cannot be activated until every blocker below is resolved.',
  MISSING_REQUIRED_INFORMATION: 'Some required information is missing.',
  INVALID_STATE: 'That action is not available in the current state.',
  NOT_FOUND: 'The record could not be found.',
  ENTITY_REQUIRED: 'A policy or version must be selected first.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'This action was already submitted with different information.',
  UNKNOWN: 'The configuration change could not be completed.',
};

/** Plain-language wording for validation blockers and warnings. */
export const BN_MEANS_POLICY_FINDING_TEXT: Record<string, string> = {
  VERSION_NOT_ACTIVATABLE: 'Only a draft version can be activated.',
  OVERLAPPING_ACTIVE_VERSION: 'Another active version already covers this programme for the same period.',
  THRESHOLD_PARAMETER_MISSING: 'An income threshold must be configured.',
  POLICY_PARAMETER_MISSING: 'An income threshold must be configured.',
  NO_CATEGORIES: 'No categories are configured; the governed default catalogue will apply.',
  NO_REQUIRED_EVIDENCE: 'No evidence requirements are configured.',
  NO_REVIEW_PERIOD: 'Neither a validity nor a reassessment period is configured.',
};

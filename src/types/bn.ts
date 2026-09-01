// ============================================================
// Benefit Management Module - Types
// ============================================================

// --- Enums ---

export type BnClaimStatus =
  | 'DRAFT' | 'SUBMITTED' | 'INTAKE_REVIEW' | 'ELIGIBILITY_CHECK'
  | 'EVIDENCE_REVIEW' | 'CALCULATION' | 'DECISION' | 'APPROVED'
  | 'DENIED' | 'AWARD_SETUP' | 'PAYMENT_QUEUE' | 'IN_PAYMENT'
  | 'SUSPENDED' | 'CLOSED' | 'PENDING_INFO' | 'WITHDRAWN';

export type BnProductStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type BnProductCategory = 'SHORT_TERM' | 'LONG_TERM' | 'NON_CONTRIBUTORY' | 'GRANT' | 'PENSION' | 'INJURY' | 'SURVIVOR' | 'ASSISTANCE';
export type BnPaymentType = 'PERIODIC' | 'LUMP_SUM' | 'BOTH';
export type BnClaimPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type BnClaimSource = 'WALK_IN' | 'PAPER' | 'ONLINE' | 'LEGACY';

// --- Reference / Core ---

export interface BnCountry {
  country_code: string;
  country_name: string;
  currency_code: string;
  currency_symbol: string | null;
  fiscal_year_start_month: number;
  contribution_ceiling_weekly: number | null;
  contribution_ceiling_annual: number | null;
  default_retirement_age: number;
  parameters: Record<string, unknown>;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string;
}

export interface BnScheme {
  id: string;
  scheme_code: string;
  scheme_name: string;
  description: string | null;
  country_code: string;
  governing_legislation: string | null;
  status: string;
  sort_order: number;
  entered_by: string | null;
  modified_by: string | null;
  entered_at: string;
  modified_at: string;
}

export interface BnBranch {
  id: string;
  scheme_id: string;
  branch_code: string;
  branch_name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

// --- Product Catalog ---

export interface BnProduct {
  id: string;
  scheme_id: string | null;
  branch_id: string | null;
  benefit_code: string;
  benefit_name: string;
  description: string | null;
  category: string;
  branch: string;
  payment_type: string;
  country_code: string;
  status: BnProductStatus;
  sort_order: number;
  entered_by: string | null;
  modified_by: string | null;
  entered_at: string;
  modified_at: string;
}

export interface BnProductVersion {
  id: string;
  product_id: string;
  version_number: number;
  effective_from: string;
  effective_to: string | null;
  description: string | null;
  eligibility_config: Record<string, unknown>;
  calculation_config: Record<string, unknown>;
  timeline_config: Record<string, unknown>;
  workflow_template_id: string | null;
  document_profile_id: string | null;
  screen_template_id: string | null;
  workflow_scheme: string | null;
  requires_employer_verification: boolean;
  requires_medical_board_review: boolean;
  requires_means_test: boolean;
  max_concurrent_claims: number;
  status: BnProductStatus;
  entered_by: string | null;
  modified_by: string | null;
  entered_at: string;
  modified_at: string;
}

// --- Configuration ---

export interface BnRuleGroup {
  id: string;
  group_code: string;
  group_name: string;
  description: string | null;
  country_code: string | null;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnEligibilityRule {
  id: string;
  product_version_id: string;
  rule_group_id: string | null;
  rule_code: string;
  rule_name: string;
  rule_type: string;
  rule_group: string;
  rule_definition: Record<string, unknown>;
  data_source: string | null;
  fail_message: string | null;
  fail_action: string;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  // Phase 2 — Rule Builder redesign
  group_code: string | null;
  severity: 'BLOCK' | 'WARN' | 'BLOCKING' | 'REFER' | 'WARNING' | 'INFO';
  overrideable: boolean;
  override_policy_code: string | null;
  fact_key: string | null;
  // Phase 3 — Typed rule engine
  rule_kind?: 'LITERAL' | 'FACT_TO_FACT' | 'DATE_DIFFERENCE' | 'DOCUMENT_STATUS' | 'EXISTS' | 'CROSS_PRODUCT' | 'DERIVED_FACT' | 'CONDITIONAL' | null;
  start_fact_key?: string | null;
  end_fact_key?: string | null;
  fallback_end_fact_key?: string | null;
  compare_fact_key?: string | null;
  document_type_code?: string | null;
  required_status?: string | null;
  existence_check_code?: string | null;
  unit?: 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS' | null;
  reason_code_group?: string | null;
  conditional_when?: Record<string, unknown> | null;
  message_template?: string | null;
  /** Read by legalReadinessService.ts's publish gate — never exposed in any
   *  UI before this, so a rule could never actually clear "Legal/coverage"
   *  no matter how many times its bn_rule_catalogue mirror was approved
   *  (a separate table the publish gate never reads). */
  legislative_reference?: string | null;
  confidence_status?: 'DRAFT' | 'NEEDS_LEGAL_CONFIRMATION' | 'CONFIRMED' | null;
}

export interface BnFormulaTemplate {
  id: string;
  template_code: string;
  template_name: string;
  description: string | null;
  formula_expression: string;
  input_variables: unknown[];
  output_type: string;
  country_code: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  variable_bindings?: Record<string, { source: string; ref: string; refId?: string; displayName?: string }>;
  validation_status?: string;
  last_validation_at?: string | null;
  validation_errors?: unknown[];
  governance_status?: string;
  modified_by?: string | null;
}

export interface BnCalculationRule {
  id: string;
  product_version_id: string;
  formula_template_id: string | null;
  rule_code: string;
  rule_name: string;
  calc_type: string;
  formula_definition: Record<string, unknown>;
  variables: unknown[];
  limits: Record<string, unknown>;
  rounding_rule: string;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnTimelineRule {
  id: string;
  product_version_id: string;
  rule_code: string;
  rule_name: string;
  timeline_type: string;
  days_value: number | null;
  weeks_value: number | null;
  months_value: number | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnDocumentProfile {
  id: string;
  profile_code: string;
  profile_name: string;
  description: string | null;
  country_code: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnDocumentRule {
  id: string;
  product_id: string;
  product_version_id?: string | null;
  document_profile_id: string | null;
  document_type_code: string;
  document_name: string;
  description: string | null;
  is_mandatory: boolean;
  stage: string;
  allowed_extensions: string[] | null;
  max_file_size_mb: number;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  // Channel-aware fields (added for online/offline support)
  channel_code?: 'ONLINE' | 'OFFLINE' | 'BOTH';
  public_visible?: boolean;
  internal_visible?: boolean;
  blocks_submission?: boolean;
  blocks_decision?: boolean;
  blocks_payment?: boolean;
  condition_json?: Record<string, unknown>;
}

export type BnChannelCode = 'ONLINE' | 'OFFLINE';

export interface BnProductChannelConfig {
  id: string;
  product_id: string;
  product_version_id: string;
  channel_code: BnChannelCode;
  is_enabled: boolean;
  screen_template_id: string | null;
  workflow_template_id: string | null;
  workflow_definition_id: string | null;
  document_profile_id: string | null;
  default_source: string | null;
  allow_save_draft: boolean;
  allow_upload_later: boolean;
  requires_identity_verification: boolean;
  requires_email_or_phone_otp: boolean;
  requires_staff_review_before_acceptance: boolean;
  blocks_submission_if_documents_missing: boolean;
  blocks_submission_if_precheck_fails: boolean;
  confirmation_template_id: string | null;
  correction_allowed: boolean;
  correction_deadline_days: number | null;
  metadata: Record<string, unknown>;
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string;
}

export interface BnWorkflowTemplate {
  id: string;
  template_code: string;
  template_name: string;
  description: string | null;
  workflow_definition_id: string | null;
  steps_config: unknown[];
  sla_config: Record<string, unknown>;
  escalation_config: Record<string, unknown>;
  country_code: string | null;
  is_active: boolean;
  channel_code?: string | null;
  is_executable?: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnProductVersionWorkflow {
  id: string;
  product_version_id: string;
  channel_code: string;
  workflow_template_id: string;
  is_default: boolean;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface BnScreenTemplate {
  id: string;
  template_code: string;
  template_name: string;
  description: string | null;
  sections: unknown[];
  layout_type: string;
  country_code: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnFieldMetadata {
  id: string;
  screen_template_id: string;
  field_code: string;
  field_label: string;
  field_type: string;
  section_code: string;
  is_required: boolean;
  validation_rules: Record<string, unknown>;
  options_source: string | null;
  default_value: string | null;
  help_text: string | null;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnInteractionRule {
  id: string;
  primary_product_id: string;
  related_product_id: string;
  interaction_type: string;
  rule_definition: Record<string, unknown>;
  effective_from: string;
  effective_to: string | null;
  description: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnOverridePolicy {
  id: string;
  product_id: string | null;
  override_target: string;
  field_path: string;
  allowed_role: string | null;
  allowed_role_id: string | null;
  allowed_role_code: string | null;
  allowed_permission_key: string | null;
  override_level: number | null;
  metadata: Record<string, unknown>;
  requires_justification: boolean;
  requires_maker_checker: boolean;
  max_override_amount: number | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnVersionApproval {
  id: string;
  product_version_id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  comments: string | null;
  performed_by: string;
  performed_at: string;
}

// --- Claim ---

export interface BnClaim {
  id: string;
  claim_number: string | null;
  ssn: string;
  product_id: string;
  product_version_id: string | null;
  employer_regno: string | null;
  status: BnClaimStatus;
  priority: string;
  claim_date: string;
  submission_date: string | null;
  decision_date: string | null;
  source: string;
  legacy_claim_ref: string | null;
  workflow_instance_id: string | null;
  assigned_to: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  bank_account: string | null;
  bank_routing_number: string | null;
  declaration: boolean;
  digital_signature: string | null;
  entered_by: string | null;
  modified_by: string | null;
  entered_at: string;
  modified_at: string;
  bn_product?: BnProduct;
}

export interface BnClaimDetail {
  id: string;
  claim_id: string;
  detail_json: Record<string, unknown>;
  entered_by: string | null;
  modified_by: string | null;
  entered_at: string;
  modified_at: string;
}

export interface BnClaimDocument {
  id: string;
  claim_id: string;
  document_type_code: string;
  document_name: string | null;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  notes: string | null;
  entered_by: string | null;
  entered_at: string;
}

export interface BnClaimEvent {
  id: string;
  claim_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  notes: string | null;
  performed_by: string;
  performed_at: string;
  metadata: Record<string, unknown>;
}

export interface BnClaimEligibility {
  id: string;
  claim_id: string;
  product_version_id: string | null;
  check_date: string;
  overall_result: boolean;
  rule_results: BnEligibilityRuleResult[];
  contribution_summary: Record<string, unknown>;
  override_applied: boolean;
  override_by: string | null;
  override_reason: string | null;
  entered_by: string | null;
  entered_at: string;
}

export interface BnEligibilityRuleResult {
  rule_code: string;
  rule_name: string;
  passed: boolean;
  actual_value: unknown;
  required_value: unknown;
  message: string;
}

export interface BnClaimCalculation {
  id: string;
  claim_id: string;
  product_version_id: string | null;
  calc_date: string;
  weekly_rate: number | null;
  monthly_rate: number | null;
  lump_sum: number | null;
  calculation_steps: BnCalculationStep[];
  variables_used: Record<string, unknown>;
  override_applied: boolean;
  override_by: string | null;
  override_reason: string | null;
  entered_by: string | null;
  entered_at: string;
}

export interface BnCalculationStep {
  step_number: number;
  description: string;
  formula: string;
  inputs: Record<string, unknown>;
  result: number;
}

export interface BnClaimNote {
  id: string;
  claim_id: string;
  note_type: string;
  subject: string | null;
  body: string;
  is_internal: boolean;
  entered_by: string;
  entered_at: string;
}

// --- Contribution Summary (from RPC) ---

export interface BnContributionSummary {
  total_weeks: number;
  total_wages: number;
  avg_weekly_wages: number;
}

// --- Status display helpers ---

export const BN_CLAIM_STATUS_LABELS: Record<BnClaimStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  INTAKE_REVIEW: 'Intake Review',
  ELIGIBILITY_CHECK: 'Eligibility Check',
  EVIDENCE_REVIEW: 'Evidence Review',
  CALCULATION: 'Calculation',
  DECISION: 'Decision',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  AWARD_SETUP: 'Award Setup',
  PAYMENT_QUEUE: 'Payment Queue',
  IN_PAYMENT: 'In Payment',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
  PENDING_INFO: 'Pending Info',
  WITHDRAWN: 'Withdrawn',
};

export const BN_PRODUCT_STATUS_LABELS: Record<BnProductStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved — awaiting publish',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  ARCHIVED: 'Archived',
};

export const BN_CATEGORY_LABELS: Record<string, string> = {
  SHORT_TERM: 'Short-Term',
  LONG_TERM: 'Long-Term',
  NON_CONTRIBUTORY: 'Non-Contributory',
  GRANT: 'Grant',
  PENSION: 'Pension',
  INJURY: 'Employment Injury',
  SURVIVOR: 'Survivor',
  ASSISTANCE: 'Assistance',
};

export const BN_RULE_TYPES = [
  { value: 'CONTRIBUTION', label: 'Contribution Check' },
  { value: 'AGE', label: 'Age Requirement' },
  { value: 'EMPLOYMENT', label: 'Employment Status' },
  { value: 'RESIDENCY', label: 'Residency' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'INCOME', label: 'Income/Means Test' },
  { value: 'CUSTOM', label: 'Custom Rule' },
];

export const BN_CALC_TYPES = [
  { value: 'FORMULA', label: 'Formula' },
  { value: 'TIER_TABLE', label: 'Tier/Rate Table' },
  { value: 'FLAT_RATE', label: 'Flat Rate' },
  { value: 'PERCENTAGE', label: 'Percentage' },
  { value: 'LOOKUP', label: 'Lookup Table' },
];

export const BN_TIMELINE_TYPES = [
  { value: 'WAITING_PERIOD', label: 'Waiting Period' },
  { value: 'MAX_DURATION', label: 'Maximum Duration' },
  { value: 'FILING_DEADLINE', label: 'Filing Deadline' },
  { value: 'REVIEW_INTERVAL', label: 'Review Interval' },
];

export const BN_FAIL_ACTIONS = [
  { value: 'REJECT', label: 'Reject Claim' },
  { value: 'WARN', label: 'Warning Only' },
  { value: 'REFER', label: 'Refer for Review' },
];

export const BN_INTERACTION_TYPES = [
  { value: 'SUSPENDS', label: 'Suspends' },
  { value: 'BLOCKS', label: 'Blocks' },
  { value: 'OFFSETS', label: 'Offsets' },
  { value: 'SUPPLEMENTS', label: 'Supplements' },
  { value: 'REPLACES', label: 'Replaces' },
];

export const BN_OVERRIDE_TARGETS = [
  { value: 'ELIGIBILITY', label: 'Eligibility' },
  { value: 'CALCULATION', label: 'Calculation' },
  { value: 'TIMELINE', label: 'Timeline' },
  { value: 'PAYMENT', label: 'Payment' },
];

// --- Decision Engine Types ---

export type BnActionCode =
  | 'SUBMIT' | 'VERIFY' | 'APPROVE' | 'DENY' | 'SUSPEND'
  | 'SEND_BACK' | 'ESCALATE' | 'HOLD' | 'RELEASE' | 'REOPEN'
  | 'DISCONTINUE' | 'DISALLOW' | 'WITHDRAW';

export const BN_ACTION_LABELS: Record<BnActionCode, string> = {
  SUBMIT: 'Submit',
  VERIFY: 'Verify / Advance',
  APPROVE: 'Approve',
  DENY: 'Deny',
  SUSPEND: 'Suspend',
  SEND_BACK: 'Send Back',
  ESCALATE: 'Escalate',
  HOLD: 'Hold',
  RELEASE: 'Release',
  REOPEN: 'Reopen',
  DISCONTINUE: 'Discontinue',
  DISALLOW: 'Disallow',
  WITHDRAW: 'Withdraw',
};

export const BN_ACTION_VARIANTS: Record<string, 'default' | 'destructive' | 'outline' | 'secondary'> = {
  SUBMIT: 'default',
  VERIFY: 'default',
  APPROVE: 'default',
  DENY: 'destructive',
  SUSPEND: 'destructive',
  SEND_BACK: 'outline',
  ESCALATE: 'secondary',
  HOLD: 'outline',
  RELEASE: 'default',
  REOPEN: 'secondary',
  DISCONTINUE: 'destructive',
  DISALLOW: 'destructive',
  WITHDRAW: 'outline',
};

export interface BnClaimStatusDef {
  id: string;
  status_code: string;
  status_label: string;
  status_group: string;
  is_terminal: boolean;
  requires_effective_date: boolean;
  display_order: number;
  color_code: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnClaimTransitionRule {
  id: string;
  from_status: string;
  to_status: string;
  action_code: string;
  action_label: string;
  allowed_roles: string[];
  product_category: string | null;
  country_code: string | null;
  requires_reason: boolean;
  requires_narrative: boolean;
  requires_maker_checker: boolean;
  requires_evidence_complete: boolean;
  requires_eligibility_pass: boolean;
  requires_calculation: boolean;
  min_override_level: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface BnReasonCode {
  id: string;
  reason_code: string;
  reason_label: string;
  reason_category: string;
  applicable_actions: string[];
  requires_narrative: boolean;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnClaimDecision {
  id: string;
  claim_id: string;
  transition_rule_id: string | null;
  action_code: string;
  from_status: string;
  to_status: string;
  reason_code_id: string | null;
  narrative: string | null;
  effective_date: string | null;
  override_id: string | null;
  workflow_instance_id: string | null;
  workflow_task_id: string | null;
  evidence_snapshot: Record<string, unknown>;
  eligibility_snapshot_id: string | null;
  calculation_snapshot_id: string | null;
  performed_by: string;
  performed_at: string;
  ip_address: string | null;
  // Joined
  reason_code?: BnReasonCode;
}

export interface BnWorkbasket {
  id: string;
  basket_code: string;
  basket_name: string;
  description: string | null;
  assigned_role: string;
  product_category: string | null;
  country_code: string | null;
  priority_rules: Record<string, unknown>;
  max_capacity: number | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  // SLA / escalation linkage
  default_escalation_policy_id?: string | null;
  supervisor_role?: string | null;
  manager_role?: string | null;
  allow_auto_reassign?: boolean;
  escalation_target_basket_id?: string | null;
}

export interface BnClaimQueueAssignment {
  id: string;
  claim_id: string;
  workbasket_id: string;
  assigned_to: string | null;
  assigned_at: string;
  priority: number;
  due_at: string | null;
  picked_at: string | null;
  completed_at: string | null;
  is_active: boolean;
  // Joined
  bn_claim?: BnClaim;
  bn_workbasket?: BnWorkbasket;
}

export interface BnEscalationPolicy {
  id: string;
  policy_code: string;
  policy_name: string;
  description?: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  applies_to_entity_type: string;
  calendar_code?: string | null;
  use_business_hours: boolean;
  warning_before_hours?: number | null;
  due_after_hours?: number | null;
  breach_after_hours?: number | null;
  escalation_target_role: string;
  escalation_target_user?: string | null;
  escalation_target_basket_id: string | null;
  auto_reassign: boolean;
  create_escalation_task: boolean;
  notify_assignee: boolean;
  notify_supervisor: boolean;
  notify_target_role: boolean;
  notification_template_id: string | null;
  notification_template_code?: string | null;
  repeat_interval_hours?: number | null;
  max_repeat_count?: number | null;
  severity: string;
  product_category: string | null;
  country_code: string | null;
  is_active: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
  entered_by: string | null;
  entered_at: string;
  levels?: BnEscalationPolicyLevel[];
}

export interface BnEscalationPolicyLevel {
  id: string;
  policy_id: string;
  level_no: number;
  trigger_after_hours: number;
  target_role: string;
  target_user?: string | null;
  severity: string;
  action_type: string;
  notification_template_code?: string | null;
  auto_reassign: boolean;
  repeat_interval_hours?: number | null;
  max_repeat_count?: number | null;
  is_active: boolean;
  entered_by?: string | null;
  entered_at?: string;
  modified_by?: string | null;
  modified_at?: string;
}

export interface BnEscalationEvent {
  id: string;
  claim_id: string;
  policy_id: string;
  trigger_reason: string;
  escalated_from_user: string | null;
  escalated_to_role: string;
  escalated_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
}

export interface BnAvailableAction {
  rule: BnClaimTransitionRule;
  blocked: boolean;
  blockedReason: string | null;
}

// ── Evidence & Documents ──

export interface BnServiceDocType {
  id: string;
  type_code: string;
  type_name: string;
  category: string;
  default_expiry_days: number | null;
  requires_witness: boolean;
  description: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string;
  // Document Library linkage (optional) — central enterprise master
  document_library_id: string | null;
  // Benefits-specific verification metadata
  requires_verification: boolean;
  verification_level: string | null;
  periodic_renewal: boolean;
  // Computed/joined fields (not stored on row)
  document_library_name?: string | null;
  used_by_products_count?: number;
  used_by_workflows_count?: number;
}

export interface BnDocRequirement {
  id: string;
  product_version_id: string | null;
  product_id: string | null;
  document_type_code: string;
  stage: string;
  requirement_level: string;
  allowed_extensions: string[];
  max_file_size_mb: number;
  expiry_days: number | null;
  requires_notarization: boolean;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string;
}

export interface BnClaimEvidence {
  id: string;
  claim_id: string;
  requirement_id: string | null;
  document_type_code: string;
  document_name: string;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  storage_bucket: string | null;
  checksum_sha256: string | null;
  source: string;
  status: string;
  status_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  waived_by: string | null;
  waived_at: string | null;
  waiver_reason: string | null;
  waiver_authority_level: number | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string;
}

export interface BnEvidenceAudit {
  id: string;
  evidence_id: string;
  claim_id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  performed_by: string;
  performed_at: string;
  // Joined
  bn_claim_evidence?: { document_name: string; document_type_code: string };
}

export interface BnEvidenceChecklist {
  id: string;
  claim_id: string;
  requirement_id: string;
  evidence_id: string | null;
  status: string;
  is_blocking: boolean;
  entered_at: string;
  modified_at: string;
  // Joined
  bn_doc_requirement?: BnDocRequirement;
  bn_claim_evidence?: BnClaimEvidence;
}

export const BN_EVIDENCE_STATUSES = ['RECEIVED', 'VERIFIED', 'REJECTED', 'WAIVED', 'PENDING_INFO', 'EXPIRED'] as const;
export const BN_EVIDENCE_ACTIONS = ['UPLOAD', 'VERIFY', 'REJECT', 'WAIVE', 'REQUEST_INFO', 'EXPIRE', 'REPLACE', 'DELETE'] as const;
export const BN_DOC_CATEGORIES = ['IDENTITY', 'FINANCIAL', 'MEDICAL', 'RELATIONSHIP', 'EMPLOYMENT', 'PERIODIC'] as const;
export const BN_REQUIREMENT_LEVELS = ['MANDATORY', 'OPTIONAL', 'WAIVABLE'] as const;
export const BN_EVIDENCE_STAGES = ['INTAKE', 'EVIDENCE_REVIEW', 'DECISION', 'POST_AWARD', 'PERIODIC_REVIEW'] as const;

// ── Multi-Country Platform Types ──

export interface BnCountryIdRule {
  id: string;
  country_code: string;
  id_type: string;
  id_label: string;
  format_pattern: string;
  format_mask: string;
  digit_length: number;
  has_check_digit: boolean;
  check_digit_algorithm: string | null;
  example_value: string | null;
  is_primary: boolean;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnCountryAddressField {
  id: string;
  country_code: string;
  field_code: string;
  field_label: string;
  field_type: string;
  is_required: boolean;
  options_source: string | null;
  validation_pattern: string | null;
  sort_order: number;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnCountryParticipantType {
  id: string;
  country_code: string;
  type_code: string;
  type_name: string;
  participant_role: string;
  min_age: number | null;
  max_age: number | null;
  /** @deprecated Use requires_identity_verification */
  requires_id: boolean;
  /** @deprecated Use requires_relationship_or_authority_proof */
  requires_relationship_proof: boolean;
  // Verification intent (staged — no Document Library dependency)
  requires_identity_verification: boolean;
  requires_relationship_or_authority_proof: boolean;
  role_category: string | null;
  relationship_category: string | null;
  authority_category: string | null;
  online_access_allowed: boolean;
  can_register_online: boolean;
  can_apply_for_self: boolean;
  can_apply_for_others: boolean;
  can_be_added_by_claimant: boolean;
  can_receive_communication: boolean;
  can_receive_payment: boolean;
  requires_email_verification: boolean;
  requires_phone_verification: boolean;
  requires_ssn_link: boolean;
  requires_officer_review: boolean;
  // Optional suggested-proof hints (linked to Document Library later)
  proof_requirement_code: string | null;
  suggested_document_category: string | null;
  suggested_document_label: string | null;
  allowed_products: string[] | null;
  sort_order: number;
  is_active: boolean;
  // Lifecycle
  lifecycle_status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  retired_at: string | null;
  retired_by: string | null;
  retired_reason: string | null;
  entered_by: string | null;
  entered_at: string;
}

export interface BnParticipantTypeUsage {
  country_code: string;
  type_code: string;
  product_version_count: number;
  active_product_count: number;
  historical_claim_count: number;
}

export interface BnCountryPaymentConfig {
  id: string;
  country_code: string;
  payment_method: string;
  method_label: string;
  is_default: boolean;
  requires_bank_account: boolean;
  requires_mobile_number: boolean;
  processing_days: number;
  cut_off_day: number | null;
  payment_cycle: string;
  calendar_config: Record<string, unknown>;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
  // Capability / governance
  is_method_enabled?: boolean | null;
  default_priority?: number | null;
  allow_third_party_payee?: boolean | null;
  allow_provider_direct_pay?: boolean | null;
  // EFT / bank file format
  bank_file_format?: string | null;
  header_record_format?: string | null;
  detail_record_format?: string | null;
  trailer_record_format?: string | null;
  file_date_format?: string | null;
  account_number_rule?: string | null;
  routing_number_rule?: string | null;
  file_naming_convention?: string | null;
  bank_code?: string | null;
  bank_validation_rule_set?: Record<string, unknown> | null;
  // Cheque
  cheque_stock_required?: boolean | null;
  cheque_format_template_id?: string | null;
  // Method-specific extensible config (cash / mobile / card / money order / wire / cheque extras)
  method_config?: Record<string, any> | null;
}

export interface BnCountryLegalRef {
  id: string;
  country_code: string;
  ref_code: string;
  ref_title: string;
  ref_section: string | null;
  ref_url: string | null;
  applicable_products: string[] | null;
  effective_from: string;
  effective_to: string | null;
  version_number: number;
  supersedes_id: string | null;
  notes: string | null;
  is_active: boolean;
  entered_by: string | null;
  entered_at: string;
}

export interface BnCountryPack {
  country: BnCountry;
  idRules: BnCountryIdRule[];
  addressModel: BnCountryAddressField[];
  participantTypes: BnCountryParticipantType[];
  paymentConfig: BnCountryPaymentConfig[];
  legalRefs: BnCountryLegalRef[];
  schemes: BnScheme[];
  products: BnProduct[];
  docTypes: BnServiceDocType[];
  reasonCodes: BnReasonCode[];
}

export const BN_PARTICIPANT_ROLES = ['CLAIMANT', 'BENEFICIARY', 'EMPLOYER', 'WITNESS', 'GUARANTOR'] as const;
export const BN_ID_TYPES = ['SSN', 'NATIONAL_ID', 'TAX_ID', 'PASSPORT'] as const;
export const BN_ADDRESS_FIELD_TYPES = ['TEXT', 'SELECT', 'POSTAL'] as const;
export const BN_PAYMENT_METHODS = ['EFT', 'CHEQUE', 'CASH', 'MOBILE_MONEY'] as const;
export const BN_PAYMENT_CYCLES = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'] as const;

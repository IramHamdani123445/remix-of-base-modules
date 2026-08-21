/**
 * AW360-WAVE-1-C1 Slice B — Award 360 table-aware schema contract.
 *
 * Derived from the live public-schema inspection captured in
 * `award360.live-schema.json`. Do NOT hand-edit column lists — regenerate
 * with `scripts/generate-award360-schema-contract.ts` or update the JSON
 * snapshot when a migration ships.
 */

/**
 * AW360-WAVE-1-C1 Slice B.1a §6 — executable scope rules.
 *
 * A rule is one of:
 *   - `filter`  a single filter on `column`; when `expectedValue` is set, the
 *               query must have called that filter with that exact literal.
 *   - `allOf`   every sub-rule must be satisfied by the query.
 *   - `anyOf`   at least one sub-rule must be satisfied.
 *
 * Rules are checked at query terminal (`then`/`maybeSingle`/`single`) using
 * the actual filters the loader issued.
 */
export type Award360ScopeRule =
  | {
      kind: 'filter';
      method?: 'eq' | 'in' | 'is' | 'contains' | 'not';
      column: string;
      expectedValue?: unknown;
    }
  | { kind: 'allOf'; rules: readonly Award360ScopeRule[] }
  | { kind: 'anyOf'; rules: readonly Award360ScopeRule[] };

export interface Award360TableContract {
  allowedColumns: readonly string[];
  /** Legacy informational scope (retained for docs and drift matrix). */
  requiredScope?: { column: string; description: string };
  /**
   * Executable scope rule enforced by the recorder at query completion.
   * When absent, the recorder falls back to a simple filter on
   * `requiredScope.column`.
   */
  scopeRule?: Award360ScopeRule;
  /**
   * AW360-WAVE-1-C1 Sub-batch B2-b.1a §3 — loader-specific scope override.
   * Resolution precedence when a query completes:
   *   1. `scopeRuleByLoader[record.loaderName]`
   *   2. `scopeRule`
   *   3. filter on `requiredScope.column`
   * When `record.loaderName` is null or has no override, resolution falls
   * back normally to step 2 and then step 3.
   */
  scopeRuleByLoader?: Readonly<Record<string, Award360ScopeRule>>;
  allowedOrderColumns?: readonly string[];
  allowedContainmentColumns?: readonly string[];
  sensitiveColumns?: readonly string[];
  loaders?: readonly string[];
}

const bn_approval_policy: Award360TableContract = {
  allowedColumns: [
    'id', 'product_version_id', 'policy_area', 'action_code', 'is_enabled',
    'requires_reason_code', 'requires_justification', 'requires_document', 'requires_supervisor_approval', 'self_approval_allowed',
    'audit_required', 'non_waivable', 'approval_role', 'approval_workbasket_id', 'reason_code_group',
    'allowed_statuses', 'blocked_statuses', 'allowed_rule_codes', 'blocked_rule_codes', 'max_override_amount',
    'max_override_percent', 'expiry_status', 'notes', 'created_at', 'updated_at',
    'created_by', 'updated_by', 'level', 'min_amount', 'max_amount',
    'next_level_workbasket_id', 'stage_code', 'stage_sequence', 'restricted_action',
  ],
  requiredScope: { column: 'product_version_id', description: "Product-version approval policies" },
};

const bn_award: Award360TableContract = {
  allowedColumns: [
    'id', 'award_number', 'bn_claim_id', 'bn_product_id', 'ssn',
    'benefit_code', 'award_type', 'status', 'start_date', 'end_date',
    'base_amount', 'currency', 'frequency', 'next_review_date', 'notes',
    'metadata', 'entered_by', 'entered_at', 'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'id', description: "Award primary key" },
};

const bn_award_beneficiary: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'beneficiary_ssn', 'full_name', 'relationship',
    'share_percent', 'share_amount', 'start_date', 'end_date', 'status',
    'bank_acct', 'bank_code', 'notes', 'entered_by', 'entered_at',
    'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'bn_award_id', description: "Canonical Award FK (never award_id)" },
  // AW360-WAVE-1-C1 Stage D1 — detail loader scopes by primary key.
  scopeRuleByLoader: {
    getAwardBeneficiaryDetail: { kind: 'filter', method: 'eq', column: 'id' },
  },
  allowedOrderColumns: ['start_date', 'entered_at'],
};

const bn_award_rate_history: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'effective_from', 'effective_to', 'rate_amount',
    'currency', 'change_reason', 'reference_doc', 'entered_by', 'entered_at',
    'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'bn_award_id', description: "Award rate-history audit scope" },
  allowedOrderColumns: ['effective_from'],
};

const bn_award_status_event: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'from_status', 'to_status', 'event_date',
    'reason_code', 'remarks', 'entered_by', 'entered_at',
  ],
  requiredScope: { column: 'bn_award_id', description: "Award status-event audit scope" },
  // AW360-WAVE-1-C1 Slice B.1a — real loader (`loadAwardAuditSources`)
  // orders by `event_date`; `entered_at` remains valid for other callers.
  allowedOrderColumns: ['event_date', 'entered_at'],
};

const bn_award_suspension_event: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'suspension_type', 'suspended_from', 'suspended_to',
    'reason_code', 'reason_text', 'resumed_at', 'resumed_by', 'status',
    'entered_by', 'entered_at', 'modified_by', 'modified_at', 'proposed_by_user_id',
    'workflow_instance_id', 'correlation_id', 'row_version',
  ],
  requiredScope: { column: 'bn_award_id', description: "Award suspension scope" },
  allowedOrderColumns: ['entered_at'],
};

// BUG-011 — resolves bn_product.branch_id to a readable name.
const bn_branch: Award360TableContract = {
  allowedColumns: [
    'id', 'scheme_id', 'branch_code', 'branch_name', 'description',
    'is_active', 'sort_order', 'entered_by', 'entered_at',
  ],
  requiredScope: { column: 'id', description: "Branch primary key" },
};

const bn_claim: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_number', 'ssn', 'product_id', 'product_version_id',
    'employer_regno', 'status', 'priority', 'claim_date', 'submission_date',
    'decision_date', 'source', 'legacy_claim_ref', 'workflow_instance_id', 'assigned_to',
    'contact_phone', 'contact_email', 'bank_account', 'bank_routing_number', 'declaration',
    'digital_signature', 'entered_by', 'modified_by', 'entered_at', 'modified_at',
    'legacy_benefit_type', 'channel_code', 'submitted_via', 'screen_template_id', 'workflow_definition_id',
    'channel_config_id', 'application_channel', 'eligibility_stale', 'calculation_stale', 'reported_date',
    'sickness_start_date', 'last_worked_date', 'death_date', 'expected_confinement_date', 'country_config_package_id',
    'lg_referral_id', 'lg_referral_no', 'lg_intake_id', 'lg_intake_no', 'lg_case_id',
    'lg_case_no',
  ],
  requiredScope: { column: 'id', description: "Claim primary key" },
  // Sub-batch B2-a — related-claims lookups from the Pensioner deep view
  // scope by canonical SSN. Either scope key must be present.
  scopeRule: {
    kind: 'anyOf',
    rules: [
      { kind: 'filter', column: 'id' },
      { kind: 'filter', column: 'ssn' },
    ],
  },
  // AW360-WAVE-1-C1 Sub-batch B2-b.1a §3 — loader-specific overrides.
  // Certified loaders whose bn_claim access is scoped exactly:
  //   • getAwardPensionerDeep → related-claims lookup by SSN
  //   • getAwardClaim         → linked claim summary by id
  //   • getAwardProduct       → linked claim (for product version) by id
  // Reserved (pendingExecution) — do NOT remove pending status; the
  // rules simply pre-declare the expected scope so the executable
  // certification can adopt them without contract churn:
  //   • getAwardClaimDeep     → eq(id)
  //   • getAwardProductDeep   → eq(id)
  scopeRuleByLoader: {
    getAwardPensionerDeep: { kind: 'filter', method: 'eq', column: 'ssn' },
    getAwardClaim: { kind: 'filter', method: 'eq', column: 'id' },
    getAwardProduct: { kind: 'filter', method: 'eq', column: 'id' },
    getAwardClaimDeep: { kind: 'filter', method: 'eq', column: 'id' },
    getAwardProductDeep: { kind: 'filter', method: 'eq', column: 'id' },
  },
  allowedOrderColumns: ['claim_date', 'submission_date', 'decision_date', 'entered_at'],
};

const bn_claim_calculation: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'product_version_id', 'calc_date', 'weekly_rate',
    'monthly_rate', 'lump_sum', 'daily_rate', 'annual_rate', 'average_weekly_wage',
    'total_contributions', 'qualifying_weeks', 'formula_code', 'formula_version', 'inputs',
    'outputs', 'override_applied', 'override_by', 'override_reason', 'entered_by',
    'entered_at',
  ],
  requiredScope: { column: 'claim_id', description: "Claim calculation" },
  // AW360-WAVE-1-C1 Sub-batch B2-b.3a — Claim Deep order contract.
  allowedOrderColumns: ['calc_date', 'entered_at'],
};

const bn_claim_decision: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'transition_rule_id', 'action_code', 'from_status',
    'to_status', 'reason_code_id', 'narrative', 'effective_date', 'override_id',
    'workflow_instance_id', 'workflow_task_id', 'evidence_snapshot', 'eligibility_snapshot_id', 'calculation_snapshot_id',
    'performed_by', 'performed_at', 'ip_address',
  ],
  requiredScope: { column: 'claim_id', description: "Claim decision" },
  allowedOrderColumns: ['performed_at', 'effective_date'],
};

const bn_claim_eligibility: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'product_version_id', 'check_date', 'overall_result',
    'rule_results', 'contribution_summary', 'override_applied', 'override_by', 'override_reason',
    'entered_by', 'entered_at',
  ],
  requiredScope: { column: 'claim_id', description: "Claim eligibility results" },
  allowedOrderColumns: ['check_date', 'entered_at'],
};

const bn_claim_event: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'event_type', 'from_status', 'to_status',
    'notes', 'performed_by', 'performed_at', 'metadata',
  ],
  requiredScope: { column: 'claim_id', description: "Claim event timeline" },
  allowedOrderColumns: ['performed_at'],
};

const bn_claim_evidence: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'requirement_id', 'document_type_code', 'document_name',
    'file_name', 'file_path', 'file_size', 'mime_type', 'storage_bucket',
    'checksum_sha256', 'source', 'status', 'status_reason', 'verified_by',
    'verified_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'waived_by',
    'waived_at', 'waiver_reason', 'waiver_authority_level', 'expires_at', 'metadata',
    'entered_by', 'entered_at', 'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'claim_id', description: "Claim evidence rows" },
};

const bn_claim_note: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'subject', 'body', 'is_internal',
    'entered_by', 'entered_at',
  ],
  requiredScope: { column: 'claim_id', description: "Claim notes" },
  allowedOrderColumns: ['entered_at'],
};

const bn_claim_queue_assignment: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'workbasket_id', 'assigned_to', 'assigned_at',
    'priority', 'due_at', 'picked_at', 'completed_at', 'is_active',
  ],
  requiredScope: { column: 'claim_id', description: "Claim workbasket assignment" },
  allowedOrderColumns: ['assigned_at'],
};

const bn_comm_mapping: Award360TableContract = {
  allowedColumns: [
    'id', 'event_code', 'bn_product_version_id', 'workflow_step_id', 'channel',
    'recipient_type', 'template_id', 'is_required', 'fallback_priority', 'active',
    'created_at', 'updated_at', 'created_by', 'delivery_method',
  ],
  requiredScope: { column: 'bn_product_version_id', description: 'Product-version comm mappings' },
};

const bn_communication_log: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'event_code', 'channel', 'recipient_type',
    'recipient_address', 'template_id', 'subject', 'status', 'provider_message_id',
    'letter_id', 'workflow_step_id', 'error_message', 'retry_count', 'last_retry_at',
    'context', 'created_by', 'created_at', 'updated_at', 'delivery_method',
  ],
  requiredScope: { column: 'claim_id', description: "Award\u2192Claim scoping; award_id is stored in context JSONB" },
  // AW360-WAVE-1-C1 Slice B.1a §6 — Award scoping is either by resolved
  // claim_id OR by JSONB containment on the context payload. Both routes
  // are legitimate; the loader may issue either or both.
  scopeRule: {
    kind: 'anyOf',
    rules: [
      { kind: 'filter', method: 'eq', column: 'claim_id' },
      { kind: 'filter', method: 'contains', column: 'context' },
    ],
  },
  // AW360-WAVE-1-C1 Stage D2 — detail loader scopes by primary key.
  scopeRuleByLoader: {
    getAwardCommunicationDetail: { kind: 'filter', method: 'eq', column: 'id' },
  },
  allowedOrderColumns: ['created_at'],
  allowedContainmentColumns: ['context'],
};

const bn_doc_requirement: Award360TableContract = {
  allowedColumns: [
    'id', 'product_version_id', 'product_id', 'document_type_code', 'stage',
    'requirement_level', 'allowed_extensions', 'max_file_size_mb', 'expiry_days', 'requires_notarization',
    'description', 'sort_order', 'is_active', 'entered_by', 'entered_at',
    'modified_by', 'modified_at', 'channel_code', 'public_visible', 'internal_visible',
    'blocks_submission', 'blocks_decision', 'blocks_payment', 'condition_json', 'source_note',
    'verification_status', 'applies_to_applicant_type', 'upload_mode',
  ],
  requiredScope: { column: 'product_version_id', description: "Product-version baseline documents" },
};

const bn_eligibility_rule: Award360TableContract = {
  allowedColumns: [
    'id', 'product_version_id', 'rule_group_id', 'rule_code', 'rule_name',
    'rule_type', 'rule_group', 'rule_definition', 'data_source', 'fail_message',
    'fail_action', 'sort_order', 'is_active', 'entered_by', 'entered_at',
    'group_code', 'severity', 'overrideable', 'override_policy_code', 'fact_key',
    'rule_kind', 'start_fact_key', 'end_fact_key', 'fallback_end_fact_key', 'compare_fact_key',
    'document_type_code', 'required_status', 'existence_check_code', 'unit', 'reason_code_group',
    'conditional_when', 'message_template', 'catalogue_rule_code', 'catalogue_rule_version', 'override_reason',
    'statutory_basis', 'legislative_reference', 'source_name', 'source_section', 'source_document',
    'source_url', 'confidence_status', 'effective_from', 'effective_to', 'configured_by',
    'approved_by', 'approved_at', 'catalogue_rule_id', 'rule_category', 'source_rule_group_id',
    'source_rule_group_code', 'governance_status', 'legal_reference', 'legal_notes', 'jurisdiction_country',
    'effective_date', 'legal_approver_comment', 'legal_approved_by', 'legal_approved_at', 'technical_validated_by',
    'technical_validated_at', 'governance_updated_by', 'governance_updated_at',
  ],
  requiredScope: { column: 'product_version_id', description: "Product-version eligibility rules" },
};

const bn_letter: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'event_code', 'template_id', 'recipient_type',
    'recipient_name', 'recipient_address_snapshot', 'subject', 'body_html', 'merge_context',
    'pdf_storage_path', 'status', 'generated_at', 'approved_at', 'printed_at',
    'dispatched_at', 'delivered_at', 'returned_at', 'cancelled_at', 'created_by',
    'approved_by', 'printed_by', 'dispatched_by', 'notes', 'created_at',
    'updated_at', 'rendered_subject', 'rendered_body_html', 'rendered_body_text', 'template_version_id',
    'template_version_no', 'reference_number', 'department_code', 'document_type', 'issued_by_office',
    'issued_office_code', 'issued_department_code',
  ],
  requiredScope: { column: 'claim_id', description: "Award/claim generated letters" },
  // AW360-WAVE-1-C1 Stage D2 — letter enrichment and detail lookups scope
  // by primary-key id (via bn_communication_log.letter_id).
  scopeRuleByLoader: {
    getAwardCommunicationDetail: { kind: 'filter', method: 'eq', column: 'id' },
    listAwardCommunicationsPaged: { kind: 'filter', method: 'in', column: 'id' },
  },
};

const bn_life_certificate: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'required_for_period', 'due_date', 'submitted_date',
    'verified_date', 'verified_by', 'status', 'document_ref', 'verification_method',
    'remarks', 'entered_by', 'entered_at', 'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'bn_award_id', description: "Award life-certificate scope" },
  allowedOrderColumns: ['due_date', 'entered_at'],
};

const bn_medical_review_schedule: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'review_type', 'scheduled_date', 'completed_date',
    'outcome', 'examining_provider', 'next_review_date', 'status', 'remarks',
    'entered_by', 'entered_at', 'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'bn_award_id', description: "Award medical-review scope" },
  // AW360-WAVE-1-C1 Stage D1 — detail loader scopes by primary key.
  scopeRuleByLoader: {
    getAwardMedicalReviewDetail: { kind: 'filter', method: 'eq', column: 'id' },
  },
  allowedOrderColumns: ['scheduled_date', 'entered_at'],
  sensitiveColumns: ['examining_provider', 'outcome', 'remarks'],
};

const bn_overpayment: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'detected_date', 'period_from', 'period_to',
    'original_amount', 'recovered_amount', 'outstanding_amount', 'recovery_method', 'recovery_status',
    'reason_code', 'remarks', 'entered_by', 'entered_at', 'modified_by',
    'modified_at',
  ],
  requiredScope: { column: 'bn_award_id', description: "Award overpayment scope" },
  // AW360-WAVE-1-C1 Stage D1 — detail loader (if invoked) scopes by primary key.
  scopeRuleByLoader: {
    getAwardOverpaymentDetail: { kind: 'filter', method: 'eq', column: 'id' },
  },
  allowedOrderColumns: ['detected_date', 'entered_at'],
};

const bn_override_request: Award360TableContract = {
  allowedColumns: [
    'id', 'claim_id', 'product_version_id', 'policy_area', 'action_code',
    'target_entity_type', 'target_entity_id', 'rule_code', 'current_value', 'requested_value',
    'reason_code', 'justification', 'supporting_document_id', 'status', 'requested_by',
    'requested_at', 'reviewed_by', 'reviewed_at', 'review_decision', 'review_notes',
    'applied_at', 'applied_by', 'expires_at', 'policy_id', 'correlation_id',
    'created_at', 'updated_at', 'revoked_by', 'revoked_at', 'revocation_reason',
  ],
  requiredScope: { column: 'claim_id', description: "Claim override requests" },
};

const bn_payment_instruction: Award360TableContract = {
  allowedColumns: [
    'id', 'award_id', 'claim_id', 'ssn', 'amount',
    'currency', 'payment_method', 'bank_code', 'account_number', 'due_date',
    'frequency', 'description', 'status', 'paid_date', 'payment_reference',
    'cancel_reason', 'created_at', 'updated_at', 'entitlement_id', 'batch_id',
    'office_code', 'beneficiary_name', 'period_start', 'period_end', 'instruction_type',
    'modified_by', 'modified_at', 'hold_reason', 'hold_by', 'hold_at',
    'cancelled_by', 'cancelled_at', 'exception_code', 'exception_detail', 'exception_at',
    'reissue_reason', 'original_instruction_id', 'payment_type', 'validation_status', 'validated_at',
    'validated_by', 'validation_errors', 'bank_account_snapshot', 'cheque_address_snapshot', 'payee_id',
    'payee_name', 'payment_profile_id',
  ],
  requiredScope: { column: 'award_id', description: "Legacy payment-instruction Award key" },
  // AW360-WAVE-1-C1 Stage D1 — Schedule detail loader looks up payment
  // instructions by primary key (via bn_payment_instruction_id).
  scopeRuleByLoader: {
    getAwardScheduleDetail: { kind: 'filter', method: 'eq', column: 'id' },
  },
  allowedOrderColumns: ['paid_date', 'due_date'],
};

const bn_payment_profile: Award360TableContract = {
  allowedColumns: [
    'id', 'person_ssn', 'payee_id', 'payment_method', 'bank_name',
    'bank_code', 'branch_name', 'branch_code', 'account_number_masked', 'account_number_token',
    'account_holder_name', 'account_holder_relationship', 'account_type', 'payment_currency', 'postal_address_snapshot',
    'verification_status', 'verified_by', 'verified_at', 'active', 'effective_from',
    'effective_to', 'notes', 'entered_by', 'entered_at', 'modified_by',
    'modified_at', 'created_at', 'updated_at',
  ],
  requiredScope: { column: 'person_ssn', description: "Award holder payment profile" },
  // AW360-WAVE-1-C1 Sub-batch B2-b.1a §2 — explicit allow-list.
  // Only `effective_from` is used by certified loaders (getAwardPensionerDeep).
  allowedOrderColumns: ['effective_from'],
};

const bn_payment_profile_change_request: Award360TableContract = {
  allowedColumns: [
    'id', 'profile_id', 'person_ssn', 'claim_id', 'entitlement_id',
    'requested_by', 'channel', 'old_profile_snapshot', 'new_profile_snapshot', 'status',
    'reason', 'proof_document_ids', 'approved_by', 'approved_at', 'rejected_reason',
    'created_at', 'updated_at',
  ],
  requiredScope: { column: 'person_ssn', description: "Payment profile change requests" },
  // AW360-WAVE-1-C1 Sub-batch B2-b.1a §2 — explicit allow-list.
  allowedOrderColumns: ['created_at'],
};

const bn_payment_schedule: Award360TableContract = {
  allowedColumns: [
    'id', 'bn_award_id', 'schedule_period', 'due_date', 'gross_amount',
    'net_amount', 'deductions', 'status', 'payment_method', 'payment_ref',
    'paid_at', 'bn_payment_instruction_id', 'notes', 'entered_by', 'entered_at',
    'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'bn_award_id', description: "Award payment schedule scope" },
  // AW360-WAVE-1-C1 Stage D1 — detail loader scopes by primary key.
  scopeRuleByLoader: {
    getAwardScheduleDetail: { kind: 'filter', method: 'eq', column: 'id' },
    getAwardOverpaymentDetail: { kind: 'filter', method: 'eq', column: 'bn_award_id' },
  },
  allowedOrderColumns: ['due_date', 'entered_at'],
};

const bn_product: Award360TableContract = {
  allowedColumns: [
    'id', 'scheme_id', 'branch_id', 'benefit_code', 'benefit_name',
    'description', 'category', 'branch', 'payment_type', 'country_code',
    'status', 'sort_order', 'entered_by', 'modified_by', 'entered_at',
    'modified_at',
  ],
  requiredScope: { column: 'id', description: "Product primary key" },
};

const bn_product_formula_binding: Award360TableContract = {
  allowedColumns: [
    'id', 'product_id', 'product_version_id', 'formula_template_id', 'formula_version_id',
    'calculation_stage', 'sequence_no', 'output_variable', 'rounding_rule', 'cap_min',
    'cap_max', 'is_active', 'notes', 'entered_by', 'entered_at',
    'modified_by', 'updated_at', 'step_mapping_json',
  ],
  requiredScope: { column: 'product_version_id', description: "Product-version formulas" },
};

const bn_product_version: Award360TableContract = {
  allowedColumns: [
    'id', 'product_id', 'version_number', 'effective_from', 'effective_to',
    'description', 'eligibility_config', 'calculation_config', 'timeline_config', 'workflow_template_id',
    'document_profile_id', 'screen_template_id', 'workflow_scheme', 'requires_employer_verification', 'requires_medical_board_review',
    'requires_means_test', 'max_concurrent_claims', 'status', 'entered_by', 'modified_by',
    'entered_at', 'modified_at', 'benefit_duration_type', 'award_creation_rule', 'payment_frequency',
    'review_policy', 'life_certificate_policy', 'medical_review_policy', 'survivor_beneficiary_policy', 'builder_canvas',
    'builder_canvas_updated_at', 'builder_canvas_updated_by', 'allow_eligibility_override', 'override_requires_supervisor', 'override_requires_document',
    'override_allowed_rule_codes', 'override_blocked_rule_codes', 'default_workbasket_id', 'intake_workbasket_id', 'eligibility_workbasket_id',
    'calculation_workbasket_id', 'decision_workbasket_id', 'payment_workbasket_id', 'escalation_policy_id', 'external_task_policy',
    'formula_template_id', 'formula_parameter_values', 'cap_rules', 'rounding_rule', 'effective_date_rule',
    'calculation_config_legacy',
  ],
  requiredScope: { column: 'id', description: "Product version primary key" },
};

// BUG-011 — resolves bn_product.scheme_id to a readable name.
const bn_scheme: Award360TableContract = {
  allowedColumns: [
    'id', 'country_code', 'scheme_code', 'scheme_name', 'description',
    'governing_legislation', 'sort_order', 'status',
    'entered_by', 'entered_at', 'modified_by', 'modified_at',
  ],
  requiredScope: { column: 'id', description: "Scheme primary key" },
};

const core_audit_log: Award360TableContract = {
  allowedColumns: [
    'id', 'event_time', 'event_code', 'event_name', 'event_category',
    'severity', 'risk_level', 'actor_user_id', 'actor_name', 'actor_email',
    'actor_role_summary', 'module_code', 'domain_code', 'entity_type', 'entity_id',
    'entity_display_name', 'action', 'outcome', 'before_value', 'after_value',
    'changed_fields', 'reason', 'notes', 'ip_address', 'user_agent',
    'session_id', 'correlation_id', 'request_id', 'source', 'source_route',
    'source_component', 'source_service', 'contains_pii', 'contains_financial_data', 'contains_health_data',
    'metadata', 'is_system_generated', 'is_sensitive', 'created_at',
  ],
  requiredScope: { column: 'entity_id', description: "entity_type='bn_award' + entity_id=:awardId" },
  // AW360-WAVE-1-C1 Slice B.1a §6 — composite Award audit scope.
  // A filter on entity_id alone is NOT sufficient; entity_type must also
  // be pinned to the literal 'bn_award' so entries for other entities do
  // not leak into the Award audit timeline.
  scopeRule: {
    kind: 'allOf',
    rules: [
      { kind: 'filter', method: 'eq', column: 'entity_type', expectedValue: 'bn_award' },
      { kind: 'filter', method: 'eq', column: 'entity_id' },
    ],
  },
  // Real loader (`loadAwardAuditSources`) orders by `event_time`.
  allowedOrderColumns: ['event_time', 'created_at'],
};

const core_workflow_task: Award360TableContract = {
  allowedColumns: [
    'id', 'workflow_instance_id', 'task_code', 'task_name', 'task_description',
    'step_code', 'step_name', 'assigned_to_user_id', 'assigned_to_role_key', 'assigned_to_permission_key',
    'assigned_to_office_code', 'assigned_to_department_id', 'task_status', 'priority', 'due_at',
    'claimed_by', 'claimed_at', 'completed_by', 'completed_at', 'outcome',
    'comments', 'metadata', 'is_active', 'created_at', 'updated_at',
  ],
  requiredScope: { column: 'workflow_instance_id', description: "Suspension-driven workflow scope" },
};

const ip_depend: Award360TableContract = {
  allowedColumns: [
    'ssn', 'depend_id', 'depend_ssn', 'surname', 'firstname',
    'middle_name', 'dob', 'sex', 'relation', 'depend_addr1',
    'depend_addr2', 'school_child', 'invalid', 'date_modified', 'userid',
    'tran_code', 'status', 'date_of_death',
  ],
  requiredScope: { column: 'ssn', description: "Award holder SSN \u2192 dependants" },
  sensitiveColumns: ['ssn', 'firstname', 'surname'],
};

const ip_master: Award360TableContract = {
  allowedColumns: [
    'id', 'unique_uuid', 'application_id', 'ssn', 'middle_name',
    'alias', 'marital_status', 'date_married', 'birth_place', 'nationality',
    'telephone', 'mobile', 'application_date', 'place_of_residence', 'citizenship',
    'marital_doc_type', 'birth_doc_type', 'death_doc_type', 'name_doc_type', 'status',
    'created_by', 'created_at', 'updated_by', 'updated_at', 'verified_by',
    'date_verified', 'rejected_by', 'date_rejected', 'rejection_reason', 'surname',
    'firstname', 'previous_name', 'sex', 'dob', 'resident_addr1',
    'resident_addr2', 'district', 'mail_addr1', 'mail_addr2', 'date_of_residency',
    'spouse_name', 'spouse_addr1', 'spouse_addr2', 'father_name', 'mother_name',
    'beneficiary', 'ben_addr1', 'ben_addr2', 'contact', 'contact_relation',
    'contact_addr1', 'contact_addr2', 'phone', 'work_permit', 'primary_occup',
    'self_ref_no', 'asp_num', 'npf', 'date_died', 'verify_birth_code',
    'verify_name_code', 'verify_marital_code', 'verify_death_code', 'witness_name', 'date_witnessed',
    'ip_signature', 'temp_card_date', 'perm_card_date', 'card_expiration', 'old_card_attached',
    'date_card_recvd', 'termination_date', 'termination_code', 'date_modified', 'userid',
    'tran_code', 'date_of_entry', 'email_addr', 'name_prefix', 'name_suffix',
    'entered_by', 'deb_crd_amount', 'vol_contrib', 'delivery_zone', 'citizenship_flag',
    'heightfeet', 'heightinches', 'eyecolor', 'photo_location', 'signature_location',
    'phone_mobile', 'spouse_ssn', 'spouse_dob', 'contact_phone', 'contact_mobile',
    'contact_email', 'work_permit_expiration', 'ip_code', 'registration_date', 'submitted_by',
    'submitted_at', 'application_reference_number', 'application_remarks', 'second_middle_name', 'employer_name',
    'employer_address', 'employer_phone', 'employer_town', 'temp_ssn', 'photo',
  ],
  requiredScope: { column: 'ssn', description: "Award holder SSN" },
  sensitiveColumns: ['ssn', 'firstname', 'surname'],
};

export const AWARD360_SCHEMA_CONTRACT = {
  bn_approval_policy,
  bn_award,
  bn_award_beneficiary,
  bn_award_rate_history,
  bn_award_status_event,
  bn_award_suspension_event,
  bn_branch,
  bn_claim,
  bn_claim_calculation,
  bn_claim_decision,
  bn_claim_eligibility,
  bn_claim_event,
  bn_claim_evidence,
  bn_claim_note,
  bn_claim_queue_assignment,
  bn_comm_mapping,
  bn_communication_log,
  bn_doc_requirement,
  bn_eligibility_rule,
  bn_letter,
  bn_life_certificate,
  bn_medical_review_schedule,
  bn_overpayment,
  bn_override_request,
  bn_payment_instruction,
  bn_payment_profile,
  bn_payment_profile_change_request,
  bn_payment_schedule,
  bn_product,
  bn_product_formula_binding,
  bn_product_version,
  bn_scheme,
  core_audit_log,
  core_workflow_task,
  ip_depend,
  ip_master,
} as const;

export type Award360TableName = keyof typeof AWARD360_SCHEMA_CONTRACT;

export const HISTORICAL_FORBIDDEN_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  bn_award_suspension_event: ['event_status', 'created_at', 'proposed_by'],
  bn_payment_instruction: ['paid_at', 'instruction_number', 'scheduled_date'],
  bn_payment_schedule: ['next_run_date', 'last_run_date'],
  bn_communication_log: ['template_code', 'award_id'],
  bn_overpayment: ['award_id', 'overpayment_reference', 'total_amount'],
  bn_claim: ['bn_product_version_id', 'assigned_officer', 'workbasket_id'],
  bn_claim_eligibility: ['override_id'],
  bn_product: ['product_code'],
  ip_master: ['residency_status', 'is_deceased'],
  ip_depend: ['dependant_name', 'verified'],
} as const;

/**
 * AW360-WAVE-1-C1 Slice B.1 §4 — pure Markdown renderer for the
 * query matrix. B2-b.1b: the `Loaders` column is now sourced from a
 * derived map (see `award360LoaderEvidence.ts`) rather than a hand-edited
 * per-table field. Passing an empty map yields "—" for every row, so
 * older callers keep working.
 */
export function renderAward360QueryMatrixMarkdown(
  liveSchemaMeta = '',
  loadersByTable: Readonly<Record<string, readonly string[]>> = {},
): string {
  const lines: string[] = [];
  lines.push('# Award 360 — Query Matrix (generated)');
  lines.push('');
  lines.push('<!--');
  lines.push('This document is generated from `src/services/bn/awards/award360SchemaContract.ts`.');
  lines.push('Do not edit table rows manually. Regenerate with:');
  lines.push('  bunx tsx scripts/generate-award360-query-matrix.ts');
  lines.push('-->');
  lines.push('');
  if (liveSchemaMeta) {
    lines.push(liveSchemaMeta);
    lines.push('');
  }
  lines.push(
    'Loader evidence is derived from mocked execution of real production loaders. It is CODE_COMPLETE evidence, not deployed runtime verification.',
  );
  lines.push('');
  lines.push('## Table contracts');
  lines.push('');
  lines.push('| Table | Allowed columns | Scope | Order columns | Containment | Sensitive | Loaders |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [table, contract] of Object.entries(AWARD360_SCHEMA_CONTRACT)) {
    const cols = contract.allowedColumns.join(', ');
    const scope = contract.requiredScope
      ? `\`${contract.requiredScope.column}\` — ${contract.requiredScope.description}`
      : '—';
    const order = contract.allowedOrderColumns?.join(', ') ?? '—';
    const contain = contract.allowedContainmentColumns?.join(', ') ?? '—';
    const sens = contract.sensitiveColumns?.join(', ') ?? '—';
    const derived = loadersByTable[table];
    const loaders = derived && derived.length
      ? [...derived].sort().join(', ')
      : contract.loaders?.join(', ') ?? '—';
    lines.push(`| \`${table}\` | ${cols} | ${scope} | ${order} | ${contain} | ${sens} | ${loaders} |`);
  }
  lines.push('');
  lines.push('## Historical forbidden columns (regression guard)');
  lines.push('');
  lines.push('| Table | Never selected |');
  lines.push('| --- | --- |');
  for (const [table, cols] of Object.entries(HISTORICAL_FORBIDDEN_COLUMNS)) {
    lines.push(`| \`${table}\` | ${cols.join(', ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}


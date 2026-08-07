/**
 * BN Risk / Fraud — EPIC 1 assessment, factor and evidence contract.
 *
 * Every shape below mirrors the governed SQL boundary exactly
 * (`bn_risk_assessment_command_v1`, `bn_risk_assessment_detail_v1`,
 * `bn_risk_assessment_queue_v1`, `bn_risk_assessment_readiness_v1`,
 * `bn_risk_assessment_creation_readiness_v1`, `bn_risk_factor_catalogue_v1`,
 * `bn_risk_evidence_search_v1`, `bn_risk_signal_assessment_links_v1`).
 *
 * Epic 1 stops at "ready for review". Nothing here scores, recommends or
 * applies a control: those commands belong to Epic 2 and later.
 */

/** Commands the Epic 1 surfaces may issue. */
export const BN_RISK_EPIC1_COMMANDS = [
  'BN_RISK_CREATE_ASSESSMENT',
  'BN_RISK_ADD_FACTOR',
  'BN_RISK_REQUEST_EVIDENCE',
  'BN_RISK_OP_CORRECT_FACTOR',
  'BN_RISK_OP_VOID_FACTOR',
  'BN_RISK_OP_LINK_EVIDENCE',
  'BN_RISK_OP_UNLINK_EVIDENCE',
  'BN_RISK_OP_RECORD_EVIDENCE_USABILITY',
  'BN_RISK_OP_RECORD_REQUEST_RESPONSE',
  'BN_RISK_OP_CLOSE_REQUEST',
  'BN_RISK_OP_ADD_SIGNAL',
  'BN_RISK_OP_ASSIGN_ASSESSMENT',
  'BN_RISK_OP_COMPLETE_INFORMATION_GATHERING',
  'BN_RISK_OP_RECORD_COMMUNICATION_RESULT',
] as const;

export type BnRiskAssessmentCommand = (typeof BN_RISK_EPIC1_COMMANDS)[number];

export type BnRiskAssessmentStatusCode =
  | 'DRAFT'
  | 'OPEN'
  | 'INFORMATION_PENDING'
  | 'REVIEW'
  | 'RECOMMENDATION'
  | 'APPROVAL_PENDING'
  | 'REFERRED'
  | 'CONTROL_ACTION'
  | 'COMPLETED'
  | 'CLOSED';

export type BnRiskFactorValueKind = 'AMOUNT' | 'DATE' | 'TRISTATE' | 'TEXT' | 'DECISION';

export type BnRiskAssessmentActionCode =
  | 'ADD_FACTOR'
  | 'CORRECT_FACTOR'
  | 'VOID_FACTOR'
  | 'LINK_EVIDENCE'
  | 'RECORD_EVIDENCE_USABILITY'
  | 'REQUEST_EVIDENCE'
  | 'RECORD_RESPONSE'
  | 'CLOSE_REQUEST'
  | 'ADD_SIGNAL'
  | 'COMPLETE_INFORMATION_GATHERING';

export interface BnRiskAssessmentAction {
  readonly action: BnRiskAssessmentActionCode;
  readonly label: string;
  readonly command: BnRiskAssessmentCommand;
  readonly enabled: boolean;
}

export interface BnRiskAssessmentActions {
  readonly assessment_id: string;
  readonly assessment_status: BnRiskAssessmentStatusCode;
  readonly row_version: number;
  readonly actions: readonly BnRiskAssessmentAction[];
  readonly notice: string | null;
}

/** `bn_risk_assessment_creation_readiness_v1` — can a signal open an assessment. */
export interface BnRiskAssessmentCreationReadiness {
  readonly signal_id: string;
  readonly signal_reference: string;
  readonly signal_status: string;
  readonly category_code: string;
  readonly person_id: number | null;
  readonly can_create: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly existing_assessment_id: string | null;
  readonly existing_assessment_reference: string | null;
}

/** `bn_risk_assessment_readiness_v1` — can information gathering be closed. */
export interface BnRiskAssessmentReadiness {
  readonly assessment_id: string;
  readonly assessment_status: BnRiskAssessmentStatusCode;
  readonly can_review: boolean;
  readonly stage_note: string;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly active_factor_count: number;
  readonly linked_signal_count: number;
  readonly outstanding_evidence_count: number;
  readonly open_blocking_request_count: number;
  readonly evidence_required_factor_count: number;
  readonly information_gathering_complete: boolean;
}

export interface BnRiskAssessmentQueueRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_id: number | null;
  readonly person_name: string | null;
  readonly person_masked_identifier: string | null;
  readonly primary_category_label: string;
  readonly linked_signal_count: number;
  readonly status: BnRiskAssessmentStatusCode;
  readonly status_label: string;
  readonly opened_at: string;
  readonly age_days: number;
  readonly assigned_owner_name: string | null;
  readonly assigned_team_code: string | null;
  readonly outstanding_information: number;
  readonly action_required: string;
}

export interface BnRiskAssessmentQueueFilters {
  readonly status?: BnRiskAssessmentStatusCode;
  readonly ownership?: 'ALL' | 'MINE' | 'UNASSIGNED';
  readonly search?: string;
}

export interface BnRiskAssessmentQueue {
  readonly rows: readonly BnRiskAssessmentQueueRow[];
  readonly total_count: number;
  readonly page: number;
  readonly page_size: number;
  readonly status_counts: Record<string, number>;
}

export interface BnRiskAssessmentHeader {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly status: BnRiskAssessmentStatusCode;
  readonly status_label: string;
  readonly summary: string | null;
  readonly opened_at: string;
  readonly opened_by_name: string | null;
  readonly person_id: number | null;
  readonly person_name: string | null;
  readonly person_masked_identifier: string | null;
  readonly primary_category_code: string;
  readonly primary_category_label: string;
  readonly claim_reference: string | null;
  readonly award_reference: string | null;
  readonly means_assessment_reference: string | null;
  readonly assigned_owner_name: string | null;
  readonly assigned_team_code: string | null;
  readonly linked_signal_count: number;
  readonly information_gathering_complete: boolean;
  readonly row_version: number;
}

export interface BnRiskAssessmentContext {
  readonly source_module: string | null;
  readonly source_reference: string | null;
  readonly signal_reference: string | null;
  readonly signal_detected_at: string | null;
  readonly signal_category_code: string | null;
}

export interface BnRiskAssessmentSignalRow {
  readonly signal_id: string;
  readonly signal_reference: string;
  readonly role_code: 'PRIMARY' | 'RELATED' | 'SUPPORTING';
  readonly status: string;
  readonly summary: string;
  readonly detected_at: string;
  readonly source_module: string;
  readonly source_reference: string | null;
  readonly category_code: string;
  readonly category_label: string;
}

export interface BnRiskFactorRow {
  readonly factor_id: string;
  readonly factor_reference: string;
  readonly factor_type_code: string;
  readonly factor_type_label: string;
  readonly value_kind: BnRiskFactorValueKind;
  readonly direction_code: string;
  readonly direction_label: string;
  readonly materiality_code: string | null;
  readonly provenance_code: string;
  readonly provenance_label: string;
  readonly provenance_reference: string | null;
  readonly signal_id: string | null;
  readonly subject_kind: string | null;
  readonly subject_reference: string | null;
  readonly value_numeric: string | null;
  readonly value_date: string | null;
  readonly value_code: string | null;
  readonly value_text: string | null;
  readonly observed_on: string | null;
  readonly evidence_requirement_code: 'REQUIRED' | 'OPTIONAL' | 'NOT_REQUIRED';
  readonly evidence_satisfied: boolean;
  readonly reason: string | null;
  readonly notes: string | null;
  readonly status: 'ACTIVE' | 'SUPERSEDED' | 'VOID';
  readonly supersedes_factor_id: string | null;
  readonly superseded_by_factor_id: string | null;
  readonly correction_reason: string | null;
  readonly void_reason_code: string | null;
  readonly void_justification: string | null;
  readonly factor_version: number;
  readonly created_at: string;
  readonly created_by_name: string | null;
}

export interface BnRiskEvidenceRow {
  readonly evidence_link_id: string;
  readonly document_id: string;
  readonly document_reference: string | null;
  readonly document_title: string | null;
  readonly document_type_code: string | null;
  readonly document_source: string | null;
  readonly received_on: string | null;
  readonly scope_code: 'ASSESSMENT' | 'FACTOR' | 'SIGNAL';
  readonly factor_id: string | null;
  readonly signal_id: string | null;
  readonly usability_code: string;
  readonly usability_label: string;
  readonly usability_reason: string | null;
  readonly status: 'LINKED' | 'UNLINKED';
  readonly created_at: string;
}

export interface BnRiskInformationRequestRow {
  readonly request_id: string;
  readonly request_reference: string;
  readonly request_type_code: string;
  readonly request_type_label: string;
  readonly recipient_kind: string;
  readonly recipient_name: string | null;
  readonly required_information: string;
  readonly reason: string | null;
  readonly due_on: string | null;
  readonly is_blocking: boolean;
  readonly channel_code: string | null;
  readonly status: 'REQUESTED' | 'SENT' | 'RESPONSE_RECEIVED' | 'RESOLVED' | 'CANCELLED';
  readonly status_label: string;
  readonly communication_status: string;
  readonly communication_detail: string | null;
  readonly response_received_at: string | null;
  readonly response_outcome_code: string | null;
  readonly response_summary: string | null;
  readonly resolved_at: string | null;
  readonly factor_id: string | null;
  readonly signal_id: string | null;
  readonly created_at: string;
  readonly row_version: number;
}

export interface BnRiskAssessmentHistoryEntry {
  readonly event_code: string;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly reason_code: string | null;
  readonly justification: string | null;
  readonly actor_name: string | null;
  readonly actor_source: string | null;
  readonly created_at: string;
  readonly detail: Record<string, unknown>;
}

export interface BnRiskAssessmentDetail {
  readonly header: BnRiskAssessmentHeader;
  readonly context: BnRiskAssessmentContext;
  readonly signals: readonly BnRiskAssessmentSignalRow[];
  readonly factors: readonly BnRiskFactorRow[];
  readonly evidence: readonly BnRiskEvidenceRow[];
  readonly requests: readonly BnRiskInformationRequestRow[];
  readonly history: readonly BnRiskAssessmentHistoryEntry[];
  readonly notes: readonly {
    readonly note_id: string;
    readonly note_kind: 'GENERAL' | 'RESTRICTED';
    readonly body: string;
    readonly created_at: string;
  }[];
  readonly restricted_notes_visible: boolean;
  readonly readiness: BnRiskAssessmentReadiness;
  readonly technical: {
    readonly assessment_id: string;
    readonly primary_signal_id: string | null;
    readonly claim_id: string | null;
    readonly award_id: string | null;
    readonly payment_id: string | null;
    readonly means_assessment_id: string | null;
    readonly correlation_id: string | null;
    readonly row_version: number;
  };
}

/** `bn_risk_factor_catalogue_v1` — governed factor types for this assessment. */
export interface BnRiskFactorTypeOption {
  readonly factor_type_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly value_kind: BnRiskFactorValueKind;
  readonly value_domain: string | null;
  readonly default_direction_code: string;
  readonly evidence_requirement_code: 'REQUIRED' | 'OPTIONAL' | 'NOT_REQUIRED';
  readonly requires_reason: boolean;
  readonly is_contextual: boolean;
}

export interface BnRiskFactorCatalogue {
  readonly assessment_id: string;
  readonly context_categories: readonly string[];
  readonly factor_types: readonly BnRiskFactorTypeOption[];
}

/** `bn_risk_evidence_search_v1` — official documents already held by the Board. */
export interface BnRiskEvidenceCandidate {
  readonly document_id: string;
  readonly document_reference: string | null;
  readonly document_title: string | null;
  readonly document_type_code: string | null;
  readonly document_source: string | null;
  readonly received_on: string | null;
  readonly business_context: string | null;
  readonly already_linked: boolean;
}

/** `bn_risk_signal_assessment_links_v1` — signal → assessment navigation. */
export interface BnRiskSignalAssessmentLink {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly role_code: 'PRIMARY' | 'RELATED' | 'SUPPORTING';
  readonly status: BnRiskAssessmentStatusCode;
  readonly status_label: string;
}

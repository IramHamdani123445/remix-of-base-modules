/**
 * BN Risk / Fraud — EPIC 0 signal intake, triage and linking contract.
 *
 * These types mirror the governed SQL boundary exactly. Nothing in the UI
 * may invent labels, statuses or reason codes: every controlled value is
 * served by `bn_risk_reference_data_v1`.
 */

/** Commands implemented by Epic 0. The remaining 13 canonical commands
 *  stay registered but unimplemented until later epics. */
export const BN_RISK_EPIC0_COMMANDS = [
  'BN_RISK_GENERATE_SIGNAL',
  'BN_RISK_REGISTER_MANUAL_SIGNAL',
  'BN_RISK_TRIAGE_SIGNAL',
  'BN_RISK_LINK_SIGNALS',
  'BN_RISK_DISMISS_SIGNAL',
] as const;

export type BnRiskEpic0Command = (typeof BN_RISK_EPIC0_COMMANDS)[number];

export type BnRiskSignalStatusCode =
  | 'NEW'
  | 'TRIAGED'
  | 'LINKED'
  | 'UNDER_REVIEW'
  | 'CONFIRMED'
  | 'DISMISSED'
  | 'ACTIONED'
  | 'CLOSED';

/** Reference domains served by `bn_risk_reference_data_v1`. */
export type BnRiskReferenceDomain =
  | 'CATEGORY'
  | 'SOURCE_MODULE'
  | 'SIGNAL_STATUS'
  | 'TRIAGE_PRIORITY'
  | 'TRIAGE_CLASSIFICATION'
  | 'TRIAGE_ROUTE'
  | 'DISMISSAL_REASON'
  | 'LINK_TYPE'
  // Epic 1 — assessment, factor, evidence and information-request domains.
  | 'ASSESSMENT_STATUS'
  | 'SIGNAL_ROLE'
  | 'FACTOR_DIRECTION'
  | 'FACTOR_MATERIALITY'
  | 'FACTOR_PROVENANCE'
  | 'FACTOR_STATUS'
  | 'FACTOR_VOID_REASON'
  | 'EVIDENCE_REQUIREMENT'
  | 'EVIDENCE_SCOPE'
  | 'EVIDENCE_USABILITY'
  | 'REQUEST_TYPE'
  | 'REQUEST_CHANNEL'
  | 'REQUEST_RECIPIENT_KIND'
  | 'REQUEST_STATUS'
  | 'RESPONSE_OUTCOME';

export interface BnRiskReferenceItem {
  readonly code: string;
  readonly label: string;
  readonly description: string | null;
  readonly nature: string | null;
}

export type BnRiskReferenceData = Partial<
  Record<BnRiskReferenceDomain, readonly BnRiskReferenceItem[]>
>;

export interface BnRiskSignalRow {
  readonly signal_id: string;
  readonly signal_reference: string;
  readonly person_id: number | null;
  readonly person_name: string | null;
  readonly person_masked_identifier: string | null;
  readonly source_module: string;
  readonly source_module_label: string;
  readonly category_code: string;
  readonly category_label: string;
  readonly category_nature: string | null;
  readonly detected_at: string;
  readonly observed_on: string | null;
  readonly priority_code: string | null;
  readonly priority_label: string | null;
  readonly status: BnRiskSignalStatusCode;
  readonly status_label: string;
  readonly linked_signal_count: number;
  readonly triage_owner_user_id: string | null;
  readonly age_days: number;
  readonly summary: string;
  readonly action_required: string;
  readonly row_version: number;
}

export interface BnRiskSignalQueueFilters {
  readonly status?: BnRiskSignalStatusCode;
  readonly category_code?: string;
  readonly source_module?: string;
  readonly priority_code?: string;
  readonly detected_from?: string;
  readonly detected_to?: string;
  readonly ownership?: 'ALL' | 'MINE' | 'UNASSIGNED';
  readonly search?: string;
}

export interface BnRiskSignalQueue {
  readonly rows: readonly BnRiskSignalRow[];
  readonly total_count: number;
  readonly page: number;
  readonly page_size: number;
  readonly status_counts: Record<string, number>;
}

export interface BnRiskSignalHistoryEntry {
  readonly event_code: string;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly reason_code: string | null;
  readonly justification: string | null;
  readonly actor_source: string | null;
  readonly created_at: string;
  readonly detail: Record<string, unknown>;
}

export interface BnRiskSignalDetail {
  readonly summary: BnRiskSignalRow;
  readonly source: {
    readonly source_module: string;
    readonly source_module_label: string;
    readonly source_event_code: string | null;
    readonly source_reference: string | null;
    readonly rule_code: string | null;
    readonly observation: string;
    readonly created_by_source: string;
  };
  readonly context: {
    readonly claim_id: string | null;
    readonly award_id: string | null;
    readonly payment_id: string | null;
    readonly means_assessment_id: string | null;
    readonly means_assessment_reference: string | null;
    readonly claim_reference: string | null;
    readonly award_reference: string | null;
    readonly evidence_reference: string | null;
  };
  readonly facts: Record<string, unknown>;
  readonly triage: {
    readonly priority_code: string | null;
    readonly classification_code: string | null;
    readonly route_code: string | null;
    readonly owner_user_id: string | null;
    readonly triaged_at: string | null;
    readonly notes: string | null;
  };
  readonly dismissal: {
    readonly reason_code: string | null;
    readonly justification: string | null;
    readonly dismissed_at: string | null;
  };
  readonly related_signals: readonly BnRiskSignalRow[];
  readonly history: readonly BnRiskSignalHistoryEntry[];
  readonly notes: readonly {
    readonly note_id: string;
    readonly note_kind: 'GENERAL' | 'RESTRICTED';
    readonly body: string;
    readonly created_at: string;
  }[];
  readonly restricted_notes_visible: boolean;
  readonly technical: {
    readonly signal_id: string;
    readonly source_record_id: string | null;
    readonly dedupe_key: string;
    readonly correlation_id: string | null;
    readonly row_version: number;
    readonly category_code: string;
  };
}

export interface BnRiskAvailableAction {
  readonly action: 'TRIAGE' | 'LINK' | 'DISMISS';
  readonly label: string;
  readonly command: BnRiskEpic0Command;
  readonly enabled: boolean;
}

export interface BnRiskAvailableActions {
  readonly signal_id: string;
  readonly signal_status: BnRiskSignalStatusCode;
  readonly row_version: number;
  readonly actions: readonly BnRiskAvailableAction[];
  readonly notice: string | null;
}

export interface BnRiskPersonOption {
  readonly person_id: number;
  readonly full_name: string;
  readonly masked_identifier: string | null;
  readonly date_of_birth: string | null;
  readonly is_deceased: boolean;
}

/**
 * Privacy-safe Benefit 360 projection. Deliberately carries no category,
 * rule, evidence or narrative detail — only whether a review is live, the
 * stage it has reached and the reference an authorised officer can quote.
 */
export interface BnRiskPersonSafeSummary {
  readonly person_id: number;
  readonly review_state:
    | 'NO_ACTIVE_REVIEW'
    | 'REVIEW_IN_PROGRESS'
    | 'AWAITING_INFORMATION'
    | 'ACTION_REQUIRED';
  readonly review_state_label: string;
  readonly stage_label?: string | null;
  readonly assessment_id?: string | null;
  readonly assessment_reference?: string | null;
}

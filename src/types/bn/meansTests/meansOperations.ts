/**
 * BN Means-Test — EPIC 13 operational queues and reporting contract.
 *
 * The queue taxonomy, row shape, counts and report codes are owned by the
 * backend (`bn_means_operational_*_v1`). React never derives queue
 * membership, ageing, overdue state or action wording locally — every value
 * below is rendered exactly as the governed query returned it.
 */

/** Closed queue taxonomy — must mirror `bn_means_operational_queue_v1`. */
export const BN_MEANS_OPERATIONAL_QUEUES = [
  'MY_WORK',
  'TEAM_WORK',
  'DRAFTS_IN_PROGRESS',
  'AWAITING_INFORMATION',
  'INFORMATION_REQUEST_OPEN',
  'INFORMATION_REQUEST_DUE_SOON',
  'INFORMATION_REQUEST_OVERDUE',
  'INFORMATION_RESPONSE_RECEIVED',
  'AWAITING_VERIFICATION',
  'VERIFICATION_CLARIFICATION',
  'VERIFICATION_FAILED',
  'ADJUSTMENTS_AWAITING_DECISION',
  'ADJUSTMENTS_AWAITING_RECALCULATION',
  'ASSESSMENTS_AWAITING_APPROVAL',
  'APPROVED_NOT_ACTIVE',
  'ACTIVATION_INTEGRATION_PENDING',
  'ACTIVATION_INTEGRATION_FAILED',
  'REASSESSMENT_DUE_SOON',
  'REASSESSMENT_DUE',
  'REASSESSMENT_OVERDUE',
  'SUCCESSOR_IN_PROGRESS',
  'RETURNED_TO_REVIEW',
  'REJECTED',
  'CLOSED_OR_SUPERSEDED',
  'SEARCH',
] as const;

export type BnMeansOperationalQueueCode = (typeof BN_MEANS_OPERATIONAL_QUEUES)[number];

export const BN_MEANS_OPERATIONAL_QUEUE_LABEL: Record<BnMeansOperationalQueueCode, string> = {
  MY_WORK: 'My work',
  TEAM_WORK: 'Team work',
  DRAFTS_IN_PROGRESS: 'Drafts in progress',
  AWAITING_INFORMATION: 'Awaiting information',
  INFORMATION_REQUEST_OPEN: 'Information requests — open',
  INFORMATION_REQUEST_DUE_SOON: 'Information requests — due soon',
  INFORMATION_REQUEST_OVERDUE: 'Information requests — overdue',
  INFORMATION_RESPONSE_RECEIVED: 'Information responses received',
  AWAITING_VERIFICATION: 'Awaiting verification',
  VERIFICATION_CLARIFICATION: 'Verification clarification',
  VERIFICATION_FAILED: 'Verification failed',
  ADJUSTMENTS_AWAITING_DECISION: 'Adjustments awaiting decision',
  ADJUSTMENTS_AWAITING_RECALCULATION: 'Adjustments awaiting recalculation',
  ASSESSMENTS_AWAITING_APPROVAL: 'Assessments awaiting approval',
  APPROVED_NOT_ACTIVE: 'Approved, not yet active',
  ACTIVATION_INTEGRATION_PENDING: 'Activation integration pending',
  ACTIVATION_INTEGRATION_FAILED: 'Activation integration failed',
  REASSESSMENT_DUE_SOON: 'Reassessment due soon',
  REASSESSMENT_DUE: 'Reassessment due',
  REASSESSMENT_OVERDUE: 'Reassessment overdue',
  SUCCESSOR_IN_PROGRESS: 'Successor in progress',
  RETURNED_TO_REVIEW: 'Returned to review',
  REJECTED: 'Rejected',
  CLOSED_OR_SUPERSEDED: 'Closed or superseded',
  SEARCH: 'Search all assessments',
};

/** Queue groupings used by the operational navigation. */
export interface BnMeansQueueGroup {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly queues: readonly BnMeansOperationalQueueCode[];
}

export const BN_MEANS_QUEUE_GROUPS: readonly BnMeansQueueGroup[] = [
  {
    code: 'WORK',
    label: 'Case work',
    description: 'Assessments owned by you or by the team and still in progress.',
    queues: ['MY_WORK', 'TEAM_WORK', 'DRAFTS_IN_PROGRESS', 'RETURNED_TO_REVIEW'],
  },
  {
    code: 'INFORMATION',
    label: 'Information requests',
    description: 'Outstanding information the claimant or a third party must supply.',
    queues: [
      'AWAITING_INFORMATION',
      'INFORMATION_REQUEST_OPEN',
      'INFORMATION_REQUEST_DUE_SOON',
      'INFORMATION_REQUEST_OVERDUE',
      'INFORMATION_RESPONSE_RECEIVED',
    ],
  },
  {
    code: 'VERIFICATION',
    label: 'Verification',
    description: 'Declared facts awaiting a verification outcome or clarification.',
    queues: ['AWAITING_VERIFICATION', 'VERIFICATION_CLARIFICATION', 'VERIFICATION_FAILED'],
  },
  {
    code: 'DECISION',
    label: 'Adjustments and approval',
    description: 'Independent decision work: adjustments, recalculation and approval.',
    queues: [
      'ADJUSTMENTS_AWAITING_DECISION',
      'ADJUSTMENTS_AWAITING_RECALCULATION',
      'ASSESSMENTS_AWAITING_APPROVAL',
    ],
  },
  {
    code: 'ACTIVATION',
    label: 'Activation and integration',
    description: 'Approved results being published to Eligibility, including failures.',
    queues: ['APPROVED_NOT_ACTIVE', 'ACTIVATION_INTEGRATION_PENDING', 'ACTIVATION_INTEGRATION_FAILED'],
  },
  {
    code: 'LIFECYCLE',
    label: 'Reassessment',
    description: 'Active assessments approaching or past their reassessment date.',
    queues: ['REASSESSMENT_DUE_SOON', 'REASSESSMENT_DUE', 'REASSESSMENT_OVERDUE', 'SUCCESSOR_IN_PROGRESS'],
  },
  {
    code: 'CLOSED',
    label: 'Closed work',
    description: 'Rejected, closed and superseded assessments retained for reference.',
    queues: ['REJECTED', 'CLOSED_OR_SUPERSEDED'],
  },
];

export type BnMeansQueueRowKind = 'ASSESSMENT' | 'INFORMATION_REQUEST' | 'INTEGRATION';

export type BnMeansQueueSort = 'OLDEST' | 'NEWEST' | 'DUE_SOONEST' | 'SUBMITTED' | 'REFERENCE';

export const BN_MEANS_QUEUE_SORTS: readonly { value: BnMeansQueueSort; label: string }[] = [
  { value: 'OLDEST', label: 'Oldest first' },
  { value: 'NEWEST', label: 'Newest first' },
  { value: 'DUE_SOONEST', label: 'Due soonest' },
  { value: 'SUBMITTED', label: 'Submitted first' },
  { value: 'REFERENCE', label: 'Reference' },
];

export interface BnMeansOperationalFilters {
  readonly search?: string;
  readonly benefit_programme?: string;
  readonly status?: string;
  readonly result?: string;
  readonly assessment_reason?: string;
  /** `ME` resolves server-side to the calling actor. */
  readonly assigned_to?: string;
  readonly created_from?: string;
  readonly created_to?: string;
  readonly effective_from?: string;
  readonly effective_to?: string;
  readonly reassessment_due_before?: string;
  readonly retryable?: string;
}

/**
 * One operational row. The union of the three row families is intentionally
 * flat: every field is optional except the identity fields the backend always
 * emits, so a single table can render any queue without re-deriving meaning.
 */
export interface BnMeansOperationalRow {
  readonly row_kind: BnMeansQueueRowKind;
  readonly record_id: string;
  readonly record_reference: string | null;
  readonly queue_code: string;
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_label: string;
  readonly person_masked_identifier: string | null;
  readonly benefit_programme: string | null;
  readonly assessment_status: string;
  readonly status_label: string;
  readonly action_required: string | null;
  readonly deep_link_section: string | null;
  readonly assigned_to: string | null;
  readonly assigned_to_label?: string | null;
  readonly is_mine: boolean | null;
  readonly age_days?: number | null;
  readonly days_overdue?: number | null;
  readonly is_read_only?: boolean | null;
  readonly row_version?: number | null;
  // Assessment family
  readonly assessment_reason?: string | null;
  readonly result?: string | null;
  readonly created_at?: string | null;
  readonly submitted_at?: string | null;
  readonly approved_at?: string | null;
  readonly activated_at?: string | null;
  readonly updated_at?: string | null;
  readonly effective_from?: string | null;
  readonly valid_until?: string | null;
  readonly reassessment_due?: string | null;
  readonly days_to_reassessment?: number | null;
  readonly open_information_requests?: number | null;
  readonly overdue_information_requests?: number | null;
  readonly open_adjustments?: number | null;
  readonly pending_recalculations?: number | null;
  readonly clarifications?: number | null;
  readonly predecessor_reference?: string | null;
  readonly successor_assessment_id?: string | null;
  readonly successor_reference?: string | null;
  // Information-request family
  readonly request_type?: string | null;
  readonly requirement_code?: string | null;
  readonly information_required?: string | null;
  readonly request_status?: string | null;
  readonly request_status_label?: string | null;
  readonly origin_stage?: string | null;
  readonly requested_at?: string | null;
  readonly due_date?: string | null;
  readonly responded_at?: string | null;
  readonly communication_status?: string | null;
  // Integration family
  readonly integration_step?: string | null;
  readonly publication_status?: string | null;
  readonly eligibility_status?: string | null;
  readonly determination_status?: string | null;
  readonly failure_code?: string | null;
  readonly failure_summary?: string | null;
  readonly failed_at?: string | null;
  readonly retry_count?: number | null;
  readonly retryable?: boolean | null;
  readonly technical?: Record<string, unknown> | null;
}

export interface BnMeansOperationalQueuePage {
  readonly queue_code: string;
  readonly rows: readonly BnMeansOperationalRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: string;
}

/** A per-queue count. A failed count is never shown as zero. */
export interface BnMeansQueueCount {
  readonly status: 'OK' | 'DENIED' | 'FAILED';
  readonly count: number | null;
}

export interface BnMeansConfigurationHealth {
  readonly status: string;
  readonly active_policies: number;
  readonly draft_versions: number;
  readonly policies_without_active_version: number;
}

export interface BnMeansOperationalCounts {
  readonly counts: Record<string, BnMeansQueueCount>;
  readonly configuration_health: BnMeansConfigurationHealth;
  readonly generated_at: string;
}

export const BN_MEANS_REPORT_CODES = [
  'STAGE_DISTRIBUTION',
  'VOLUMES',
  'AGEING',
  'REASSESSMENT',
  'INFORMATION_REQUESTS',
  'INTEGRATION',
  'OUTCOMES',
] as const;

export type BnMeansReportCode = (typeof BN_MEANS_REPORT_CODES)[number];

export const BN_MEANS_REPORT_LABEL: Record<BnMeansReportCode, string> = {
  STAGE_DISTRIBUTION: 'Assessments by stage',
  VOLUMES: 'Processing volumes',
  AGEING: 'Ageing of open work',
  REASSESSMENT: 'Reassessment position',
  INFORMATION_REQUESTS: 'Information requests',
  INTEGRATION: 'Eligibility integration',
  OUTCOMES: 'Assessment outcomes',
};

export const BN_MEANS_REPORT_DESCRIPTION: Record<BnMeansReportCode, string> = {
  STAGE_DISTRIBUTION: 'Where every assessment currently sits in the process.',
  VOLUMES: 'Work completed in the selected period.',
  AGEING: 'How long open assessments have been waiting.',
  REASSESSMENT: 'Active assessments due, overdue or already superseded.',
  INFORMATION_REQUESTS: 'Outstanding and fulfilled information requests.',
  INTEGRATION: 'Publication of approved results to Eligibility.',
  OUTCOMES: 'Decided results in the selected period.',
};

export interface BnMeansReportRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface BnMeansReport {
  readonly report_code: string;
  readonly rows: readonly BnMeansReportRow[];
  readonly period_from: string;
  readonly period_to: string;
  readonly benefit_programme: string | null;
  readonly generated_at: string;
}

export interface BnMeansReportFilters {
  readonly date_from?: string;
  readonly date_to?: string;
  readonly benefit_programme?: string;
}

export type BnMeansAssignAction = 'CLAIM' | 'RELEASE' | 'REASSIGN';

export interface BnMeansAssignResult {
  readonly assessment_id: string;
  readonly assigned_to: string | null;
  readonly action: BnMeansAssignAction;
}

export function meansQueueLabel(code: string): string {
  return BN_MEANS_OPERATIONAL_QUEUE_LABEL[code as BnMeansOperationalQueueCode] ?? code;
}

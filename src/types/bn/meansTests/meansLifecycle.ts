/**
 * MEANS-TEST EPIC 12 — Reassessment and Change of Circumstances contract.
 *
 * These types mirror, one-for-one, the JSON returned by the governed
 * backend reads `bn_means_lifecycle_context_v1` and
 * `bn_means_reassessment_queue_v1`. React never decides whether a
 * reassessment is due, whether a successor may be created, whether
 * carried-forward information may be reused, or whether an assessment may
 * be superseded or closed — the backend owns every one of those decisions.
 */

/** Post-activation lifecycle commands served by the lifecycle boundary. */
export const BN_MEANS_LIFECYCLE_COMMANDS = [
  'BN_MEANS_SCHEDULE_REASSESSMENT',
  'BN_MEANS_CANCEL_REASSESSMENT',
  'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE',
  'BN_MEANS_CREATE_SUCCESSOR',
  'BN_MEANS_CONFIRM_CARRIED_FORWARD',
  'BN_MEANS_SUPERSEDE',
  'BN_MEANS_CLOSE',
] as const;

export type BnMeansLifecycleCommand = (typeof BN_MEANS_LIFECYCLE_COMMANDS)[number];

export type BnMeansScheduleStatus = 'SCHEDULED' | 'DUE' | 'COMPLETED' | 'CANCELLED';
export type BnMeansScheduleSource = 'POLICY' | 'MANUAL' | 'CHANGE_OF_CIRCUMSTANCE' | 'APPEAL';
export type BnMeansMateriality = 'MATERIAL' | 'NON_MATERIAL' | 'UNASSESSED';
export type BnMeansCircumstanceOutcome =
  | 'RECORDED'
  | 'REASSESSMENT_SCHEDULED'
  | 'SUCCESSOR_CREATED'
  | 'NO_ACTION';

/** Reassessment queue buckets — computed by the backend, never in React. */
export type BnMeansReassessmentBucket =
  | 'EXPIRED'
  | 'OVERDUE'
  | 'DUE_SOON'
  | 'CHANGE_REPORTED'
  | 'SCHEDULED';

export type BnMeansCarryForwardSection = 'HOUSEHOLD' | 'INCOME' | 'ASSETS' | 'DEDUCTIONS';

export interface BnMeansReferenceOption {
  readonly code: string;
  readonly label: string;
  readonly default_materiality?: BnMeansMateriality;
}

export interface BnMeansLifecycleReference {
  readonly change_types: readonly BnMeansReferenceOption[];
  readonly materiality_options: readonly BnMeansReferenceOption[];
  readonly reported_channels: readonly BnMeansReferenceOption[];
  readonly reassessment_reasons: readonly BnMeansReferenceOption[];
  readonly closure_reasons: readonly BnMeansReferenceOption[];
  readonly carry_forward_sections: readonly BnMeansReferenceOption[];
}

export interface BnMeansLifecycleValidity {
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly activated_at: string | null;
  readonly reassessment_due: string | null;
  readonly days_to_expiry: number | null;
  readonly days_to_reassessment: number | null;
  readonly is_expired: boolean;
}

export interface BnMeansLifecycleClosure {
  readonly closure_reason_code: string | null;
  readonly closure_justification: string | null;
  readonly closed_at: string | null;
  readonly superseded_at: string | null;
}

export interface BnMeansLifecycleLink {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly status: string;
  readonly effective_from: string | null;
  readonly valid_until?: string | null;
  readonly carried_forward_confirmed_at?: string | null;
}

export interface BnMeansCarriedForwardSectionState {
  readonly section_code: BnMeansCarryForwardSection;
  readonly pending: number;
  readonly confirmed: number;
}

export interface BnMeansCarriedForwardState {
  readonly is_successor: boolean;
  readonly confirmed_at: string | null;
  readonly sections: readonly BnMeansCarriedForwardSectionState[];
}

export interface BnMeansReassessmentSchedule {
  readonly schedule_id: string;
  readonly due_date: string;
  readonly reason_code: string | null;
  readonly status: BnMeansScheduleStatus;
  readonly source: BnMeansScheduleSource;
  readonly justification: string | null;
  readonly successor_assessment_id: string | null;
  readonly circumstance_id: string | null;
  readonly completed_at: string | null;
  readonly cancelled_at: string | null;
  readonly created_at: string;
}

export interface BnMeansCircumstanceEvent {
  readonly circumstance_id: string;
  readonly change_type: string;
  readonly category_code: string | null;
  readonly reported_on: string;
  readonly effective_date: string;
  readonly materiality: BnMeansMateriality;
  readonly outcome: BnMeansCircumstanceOutcome;
  readonly reported_channel: string | null;
  readonly justification: string | null;
  readonly details: Record<string, unknown>;
  readonly successor_assessment_id: string | null;
  readonly schedule_id: string | null;
  readonly created_at: string;
}

export interface BnMeansLifecycleHistoryEntry {
  readonly event_id: string;
  readonly event_code: string;
  readonly command_name: string | null;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly reason_code: string | null;
  readonly justification: string | null;
  readonly created_at: string;
}

export interface BnMeansLifecycleAction {
  readonly command: BnMeansLifecycleCommand;
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly row_version: number;
}

export interface BnMeansLifecycleContext {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly status: string;
  readonly result: string | null;
  readonly row_version: number;
  readonly benefit_programme: string;
  readonly assessment_reason: string;
  readonly validity: BnMeansLifecycleValidity;
  readonly closure: BnMeansLifecycleClosure;
  readonly predecessor: BnMeansLifecycleLink | null;
  readonly successor: BnMeansLifecycleLink | null;
  readonly carried_forward: BnMeansCarriedForwardState;
  readonly schedules: readonly BnMeansReassessmentSchedule[];
  readonly circumstances: readonly BnMeansCircumstanceEvent[];
  readonly history: readonly BnMeansLifecycleHistoryEntry[];
  readonly reference: BnMeansLifecycleReference;
  readonly available_actions: readonly BnMeansLifecycleAction[];
}

export interface BnMeansReassessmentQueueRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_id: number | null;
  readonly benefit_programme: string;
  readonly status: string;
  readonly bucket: BnMeansReassessmentBucket;
  readonly valid_until: string | null;
  readonly reassessment_due: string | null;
  readonly days_to_reassessment: number | null;
  readonly open_material_changes: number;
  readonly open_schedules: number;
  readonly successor_assessment_id: string | null;
  readonly row_version: number;
  readonly updated_at: string;
}

export interface BnMeansReassessmentQueue {
  readonly rows: readonly BnMeansReassessmentQueueRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly bucket: BnMeansReassessmentBucket | 'ALL';
}

export interface BnMeansReassessmentQueueFilters {
  readonly bucket?: BnMeansReassessmentBucket | 'ALL';
  readonly benefit_programme?: string;
  readonly assigned_to?: string;
  readonly due_before?: string;
  readonly search?: string;
}

/** Human wording for every lifecycle refusal reason raised by the backend. */
export const BN_MEANS_LIFECYCLE_REASON_LABELS: Record<string, string> = {
  ACTIONS_DISABLED: 'Actions are disabled for this module.',
  PERMISSION_DENIED: 'You do not have permission for this action.',
  INVALID_STATE: 'The assessment is not in a state that allows this action.',
  NO_OPEN_SCHEDULE: 'There is no open reassessment to cancel.',
  SUCCESSOR_EXISTS: 'A successor assessment already exists.',
  SUCCESSOR_REQUIRED: 'A successor assessment must exist before superseding.',
  SUCCESSOR_NOT_ACTIVE: 'The successor assessment is not active yet.',
  NOT_A_SUCCESSOR: 'This assessment does not carry information forward.',
  NOTHING_TO_CONFIRM: 'There is no carried-forward information awaiting confirmation.',
};

export function lifecycleReasonLabel(code: string | null): string {
  if (!code) return '';
  return BN_MEANS_LIFECYCLE_REASON_LABELS[code] ?? code.replace(/_/g, ' ').toLowerCase();
}

export function scheduleStatusTone(
  status: BnMeansScheduleStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'DUE':       return 'destructive';
    case 'SCHEDULED': return 'secondary';
    case 'COMPLETED': return 'default';
    default:          return 'outline';
  }
}

export function bucketLabel(bucket: BnMeansReassessmentBucket | 'ALL'): string {
  switch (bucket) {
    case 'EXPIRED':         return 'Expired';
    case 'OVERDUE':         return 'Overdue';
    case 'DUE_SOON':        return 'Due soon';
    case 'CHANGE_REPORTED': return 'Change reported';
    case 'SCHEDULED':       return 'Scheduled';
    default:                return 'All';
  }
}

export function bucketTone(
  bucket: BnMeansReassessmentBucket,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (bucket) {
    case 'EXPIRED':
    case 'OVERDUE':
      return 'destructive';
    case 'DUE_SOON':
    case 'CHANGE_REPORTED':
      return 'secondary';
    default:
      return 'outline';
  }
}

export function materialityLabel(materiality: BnMeansMateriality): string {
  switch (materiality) {
    case 'MATERIAL':     return 'Material';
    case 'NON_MATERIAL': return 'Not material';
    default:             return 'Not assessed';
  }
}

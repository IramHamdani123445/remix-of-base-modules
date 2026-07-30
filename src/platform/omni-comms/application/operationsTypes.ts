/**
 * Omni-Comms Operations — read-only view types.
 *
 * These mirror the JSON returned by the `omni_comms_ops_*` SECURITY DEFINER
 * read RPCs. Nothing here describes a mutation: the Operations console is
 * strictly observational in this phase.
 */
import type { OmniCommsChannel } from './eventRouteService';

export type RequestStatus =
  | 'accepted' | 'processing' | 'completed' | 'completed_with_blockers'
  | 'blocked' | 'failed';

export type RequestMode = 'dry_run' | 'shadow' | 'queued';

export type RecipientEligibility =
  | 'eligible' | 'partially_eligible' | 'blocked' | 'invalid';

export interface OpsSummary {
  organization_id: string;
  department_id: string | null;
  since: string;
  requests: number;
  recipients: number;
  messages: number;
  held_jobs: number;
  runnable_jobs: number;
  delivery_attempts: number;
  blocked_requests: number;
  completed_dry_runs: number;
  processing_requests: number;
  failed_requests: number;
  requests_by_status: Record<string, number>;
  requests_by_mode: Record<string, number>;
  last_request_at: string | null;
  generated_at: string;
}

export interface OpsRequestListItem {
  id: string;
  created_at: string;
  event_code: string | null;
  mode: RequestMode;
  status: RequestStatus;
  caller_module_code: string;
  caller_entity_type: string | null;
  department_id: string | null;
  correlation_id: string | null;
  recipient_count: number;
  message_count: number;
  held_job_count: number;
  blocker_count: number;
}

export interface OpsRequestPage {
  items: OpsRequestListItem[];
  total: number;
  limit: number;
  offset: number;
  generated_at: string;
}

export interface OpsRequestHeader {
  id: string;
  organization_id: string;
  department_id: string | null;
  status: RequestStatus;
  mode: RequestMode;
  event_definition_id: string | null;
  event_code: string | null;
  event_name: string | null;
  caller_module_code: string;
  caller_entity_type: string | null;
  caller_entity_id: string | null;
  correlation_id: string | null;
  idempotency_key: string;
  idempotency_scope: string | null;
  request_fingerprint: string | null;
  requested_channels: string[] | null;
  blockers: unknown;
  payload_snapshot: unknown;
  payload_redacted: boolean;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
}

export interface OpsRecipient {
  id: string;
  recipient_type: string;
  recipient_reference: string | null;
  display_name: string | null;
  email_destination: string | null;
  phone_destination: string | null;
  push_destination: string | null;
  locale: string | null;
  eligibility_status: RecipientEligibility | string;
  resolved_channels: string[] | null;
  blockers: unknown;
  resolution_snapshot: unknown;
  destinations_masked: boolean;
  created_at: string;
}

export interface OpsMessage {
  id: string;
  recipient_id: string | null;
  channel: OmniCommsChannel;
  status: string;
  event_route_id: string | null;
  template_family_id: string | null;
  template_version_id: string | null;
  template_family_code: string | null;
  template_version_number: number | null;
  layout_id: string | null;
  layout_version_id: string | null;
  sender_identity_id: string | null;
  sender_identity_code: string | null;
  provider_id: string | null;
  provider_account_id: string | null;
  resolved_asset_manifest: unknown;
  channel_setting_snapshot: unknown;
  destination_snapshot: unknown;
  rendered_checksum: string | null;
  unresolved_tokens: unknown;
  unresolved_required_slots: unknown;
  blockers: unknown;
  dispatch_job_id: string | null;
  content_available: boolean;
  rendered_at: string | null;
  created_at: string;
}

export type DispatchLeaseState = 'unleased' | 'leased' | 'lease_expired';

export interface OpsDispatchJob {
  id: string;
  message_id: string | null;
  channel: OmniCommsChannel;
  mode: RequestMode;
  status: string;
  priority: number;
  is_runnable: boolean;
  hold_reason: string | null;
  scheduled_at: string | null;
  next_attempt_at: string | null;
  attempt_count: number;
  max_attempts: number;
  lease_state: DispatchLeaseState;
  locked_at: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface OpsDeliveryAttempt {
  id: string;
  dispatch_job_id: string | null;
  message_id: string | null;
  attempt_number: number;
  status: string;
  provider_id: string | null;
  provider_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  latency_ms: number | null;
  response_code: string | null;
  response_category: string | null;
  failure_category: string | null;
  is_retriable: boolean | null;
}

export interface OpsTimelineEntry {
  id: string;
  event_sequence: number;
  event_type: string;
  message_id: string | null;
  status_before: string | null;
  status_after: string | null;
  summary: string | null;
  safe_metadata: unknown;
  actor_type: string | null;
  actor_id: string | null;
  correlation_id: string | null;
  created_at: string;
}

export interface OpsTimelineWarning {
  code: 'duplicate_sequence' | 'sequence_gap' | 'missing_reference' | 'runnable_job_present' | string;
  message: string;
}

export interface OpsRequestDetail {
  request: OpsRequestHeader;
  recipients: OpsRecipient[];
  messages: OpsMessage[];
  dispatch_jobs: OpsDispatchJob[];
  delivery_attempts: OpsDeliveryAttempt[];
  timeline: OpsTimelineEntry[];
  timeline_warnings: OpsTimelineWarning[];
  can_view_sensitive: boolean;
  sensitive_visible: boolean;
  generated_at: string;
}

export interface OpsMessageContent {
  id: string;
  channel: OmniCommsChannel;
  rendered_subject: string | null;
  rendered_text: string | null;
  rendered_html: string | null;
  rendered_checksum: string | null;
  resolved_asset_manifest: unknown;
  channel_setting_snapshot: unknown;
  destination_snapshot: unknown;
  blockers: unknown;
  generated_at: string;
}

export interface OpsRequestFilters {
  departmentId?: string | null;
  mode?: RequestMode | null;
  status?: RequestStatus | null;
  eventCode?: string | null;
  callerModuleCode?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  hasBlockers?: boolean | null;
  search?: string | null;
}

export const OPS_PAGE_SIZE_DEFAULT = 25;
export const OPS_PAGE_SIZE_MAX = 100;

export const OPS_REQUEST_STATUSES: RequestStatus[] = [
  'accepted', 'processing', 'completed', 'completed_with_blockers', 'blocked', 'failed',
];

export const OPS_REQUEST_MODES: RequestMode[] = ['dry_run', 'shadow', 'queued'];

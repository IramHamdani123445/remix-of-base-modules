/**
 * Omni-Comms Operations & Diagnostics — typed RPC adapter (read-only).
 *
 * Every function here is a read. No retry, resend, cancel or suppress
 * operation exists yet; those require `omni_comms.operate` and a future
 * story. Sensitive content is redacted server-side unless the caller holds
 * `omni_comms.view_sensitive_content`.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import type { OmniCommsChannel } from './eventRouteService';

export type RequestStatus =
  | 'accepted' | 'processing' | 'completed' | 'completed_with_blockers'
  | 'blocked' | 'failed';

export type RequestMode = 'dry_run' | 'shadow' | 'queued';

export interface OpsSummary {
  since: string;
  organization_id: string | null;
  department_id: string | null;
  requests_by_status: Record<string, number>;
  messages_by_status: Record<string, number>;
  dispatch_jobs_by_status: Record<string, number>;
  delivery_attempts_by_status: Record<string, number>;
  generated_at: string;
}

export interface OpsRequestListItem {
  id: string;
  created_at: string;
  status: RequestStatus;
  mode: RequestMode;
  event_code: string | null;
  caller_module_code: string;
  caller_entity_type: string | null;
  caller_entity_id: string | null;
  correlation_id: string | null;
  requested_channels: string[] | null;
  blocker_count: number;
  message_count: number;
}

export interface OpsRecipient {
  id: string;
  recipient_type: string;
  display_name: string | null;
  email_destination: string | null;
  phone_destination: string | null;
  locale: string | null;
  eligibility_status: string;
  resolved_channels: string[] | null;
  blockers: unknown;
}

export interface OpsMessage {
  id: string;
  recipient_id: string | null;
  channel: OmniCommsChannel;
  status: string;
  template_version_id: string | null;
  rendered_checksum: string | null;
  rendered_subject: string | null;
  rendered_html: string | null;
  rendered_text: string | null;
  content_redacted: boolean;
  unresolved_tokens: unknown;
  unresolved_required_slots: unknown;
  blockers: unknown;
  created_at: string;
}

export interface OpsDispatchJob {
  id: string;
  message_id: string | null;
  channel: OmniCommsChannel;
  mode: RequestMode;
  status: string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  is_runnable: boolean;
  hold_reason: string | null;
  scheduled_at: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

export interface OpsTimelineEntry {
  id: string;
  message_id: string | null;
  event_type: string;
  event_sequence: number;
  status_before: string | null;
  status_after: string | null;
  summary: string | null;
  safe_metadata: unknown;
  actor_type: string | null;
  created_at: string;
}

export interface OpsRequestDetail {
  request: {
    id: string;
    organization_id: string;
    department_id: string | null;
    status: RequestStatus;
    mode: RequestMode;
    event_definition_id: string | null;
    event_code: string | null;
    caller_module_code: string;
    caller_entity_type: string | null;
    caller_entity_id: string | null;
    correlation_id: string | null;
    idempotency_key: string;
    requested_channels: string[] | null;
    blockers: unknown;
    payload_snapshot: unknown;
    payload_redacted: boolean;
    created_at: string;
    completed_at: string | null;
  };
  recipients: OpsRecipient[];
  messages: OpsMessage[];
  dispatch_jobs: OpsDispatchJob[];
  timeline: OpsTimelineEntry[];
  sensitive_visible: boolean;
  generated_at: string;
}

export interface DiagnosticsCheck {
  id: string;
  label: string;
  ok: boolean;
}

export interface OmniCommsDiagnostics {
  organization_id: string | null;
  catalogue: {
    event_definitions_total: number;
    event_definitions_active: number;
    event_contracts_total: number;
    event_contracts_published: number;
  };
  content: {
    template_families: number;
    template_versions: number;
    template_versions_published: number;
  };
  channels: {
    providers_active: number;
    provider_accounts_active: number;
    sender_identities_active: number;
    bindings_verified: number;
    channel_settings_enabled: number;
    event_routes_active: number;
  };
  runtime: {
    requests_24h: number;
    requests_blocked_24h: number;
    messages_24h: number;
    jobs_held: number;
    jobs_pending: number;
    last_request_at: string | null;
  };
  checks: DiagnosticsCheck[];
  generated_at: string;
}

export function getOpsSummary(
  client: OmniCommsRpcClient,
  input: { organizationId?: string | null; departmentId?: string | null; sinceHours?: number },
): Promise<OpsSummary> {
  return callOmniCommsRpc<OpsSummary>(client, 'omni_comms_ops_summary', {
    p_organization_id: input.organizationId ?? null,
    p_department_id: input.departmentId ?? null,
    p_since_hours: input.sinceHours ?? 168,
  });
}

export function listOpsRequests(
  client: OmniCommsRpcClient,
  input: {
    organizationId?: string | null;
    departmentId?: string | null;
    status?: RequestStatus | null;
    mode?: RequestMode | null;
    search?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<OpsRequestListItem[]> {
  return callOmniCommsRpc<OpsRequestListItem[]>(client, 'omni_comms_ops_request_list', {
    p_organization_id: input.organizationId ?? null,
    p_department_id: input.departmentId ?? null,
    p_status: input.status ?? null,
    p_mode: input.mode ?? null,
    p_search: input.search ?? null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
}

export function getOpsRequestDetail(
  client: OmniCommsRpcClient,
  requestId: string,
): Promise<OpsRequestDetail> {
  return callOmniCommsRpc<OpsRequestDetail>(client, 'omni_comms_ops_request_detail', {
    p_request_id: requestId,
  });
}

export function getDiagnostics(
  client: OmniCommsRpcClient,
  organizationId?: string | null,
): Promise<OmniCommsDiagnostics> {
  return callOmniCommsRpc<OmniCommsDiagnostics>(client, 'omni_comms_diagnostics', {
    p_organization_id: organizationId ?? null,
  });
}

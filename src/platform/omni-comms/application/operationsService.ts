/**
 * Omni-Comms Operations & Diagnostics — typed read-only RPC adapter.
 *
 * Every function here is a read executed through the bound Omni-Comms RPC
 * client. There is no retry, resend, cancel or suppress operation: those are
 * deliberately not implemented in this phase. The adapter never imports the
 * browser Supabase singleton and never touches runtime tables with `.from()`.
 * Sensitive content is masked server-side unless the caller both holds
 * `omni_comms.view_sensitive_content` and explicitly requests disclosure.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import {
  OPS_PAGE_SIZE_DEFAULT,
  OPS_PAGE_SIZE_MAX,
  type OpsMessageContent,
  type OpsRequestDetail,
  type OpsRequestFilters,
  type OpsRequestPage,
  type OpsSummary,
} from './operationsTypes';

export * from './operationsTypes';

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

function clampLimit(limit?: number): number {
  const n = Number.isFinite(limit) ? Number(limit) : OPS_PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(Math.trunc(n), 1), OPS_PAGE_SIZE_MAX);
}

function clampOffset(offset?: number): number {
  const n = Number.isFinite(offset) ? Number(offset) : 0;
  return Math.max(Math.trunc(n), 0);
}

export function getOpsSummary(
  client: OmniCommsRpcClient,
  input: { organizationId: string; departmentId?: string | null; sinceHours?: number },
): Promise<OpsSummary> {
  return callOmniCommsRpc<OpsSummary>(client, 'omni_comms_ops_summary', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_since_hours: input.sinceHours ?? 720,
  });
}

export function listOpsRequests(
  client: OmniCommsRpcClient,
  input: OpsRequestFilters & {
    organizationId: string;
    limit?: number;
    offset?: number;
  },
): Promise<OpsRequestPage> {
  return callOmniCommsRpc<OpsRequestPage>(client, 'omni_comms_ops_request_list', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_mode: input.mode ?? null,
    p_status: input.status ?? null,
    p_event_code: input.eventCode ?? null,
    p_caller_module_code: input.callerModuleCode ?? null,
    p_date_from: input.dateFrom ?? null,
    p_date_to: input.dateTo ?? null,
    p_has_blockers: input.hasBlockers ?? null,
    p_search: input.search ?? null,
    p_limit: clampLimit(input.limit),
    p_offset: clampOffset(input.offset),
  });
}

export function getOpsRequestDetail(
  client: OmniCommsRpcClient,
  input: { requestId: string; organizationId: string; revealSensitive?: boolean },
): Promise<OpsRequestDetail> {
  return callOmniCommsRpc<OpsRequestDetail>(client, 'omni_comms_ops_request_detail', {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_reveal_sensitive: input.revealSensitive ?? false,
  });
}

export function getOpsMessageContent(
  client: OmniCommsRpcClient,
  input: { messageId: string; organizationId: string; revealSensitive?: boolean },
): Promise<OpsMessageContent> {
  return callOmniCommsRpc<OpsMessageContent>(client, 'omni_comms_ops_message_content', {
    p_message_id: input.messageId,
    p_organization_id: input.organizationId,
    p_reveal_sensitive: input.revealSensitive ?? true,
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

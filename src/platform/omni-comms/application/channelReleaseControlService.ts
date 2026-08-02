/**
 * Omni-Comms C6 — typed adapter over the bounded Release Control RPCs.
 *
 * Boundaries (permanent):
 *   - Uses the bound Omni-Comms RPC client only; never the browser Supabase
 *     singleton and never a direct table query (both release tables deny
 *     direct authenticated access).
 *   - No provider SDK, no provider fetch, no sendCommunication, no runtime
 *     delivery writes. This module governs release state and nothing else.
 *   - Approval/activation is NOT available here: it is performed only by the
 *     trusted `omni-comms-release-control` Edge boundary, which reads the
 *     deployed revision server-side.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';
import type {
  ChannelReleaseControl,
  ChannelReleaseControlSummary,
  ReleaseBasicState,
  UpsertReleaseConfigurationInput,
} from './channelReleaseControlTypes';

export interface GetReleaseControlSummaryInput {
  organizationId: string;
  departmentId?: string | null;
  /** C6 supports Email only. */
  channel: 'email';
  historyLimit?: number;
}

export function getChannelReleaseControlSummary(
  client: OmniCommsRpcClient,
  input: GetReleaseControlSummaryInput,
): Promise<ChannelReleaseControlSummary> {
  return callOmniCommsRpc<ChannelReleaseControlSummary>(
    client,
    'omni_comms_channel_release_control_summary',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_history_limit: input.historyLimit ?? 25,
    },
  );
}

export function upsertChannelReleaseConfiguration(
  client: OmniCommsRpcClient,
  input: UpsertReleaseConfigurationInput,
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_upsert_configuration',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_permitted_event_codes: input.permittedEventCodes,
      p_permitted_caller_modules: input.permittedCallerModules,
      p_permitted_modes: input.permittedModes,
      p_recipient_input: input.recipientInput,
      p_max_recipients_per_request: input.maxRecipientsPerRequest,
      p_max_messages_per_hour: input.maxMessagesPerHour,
      p_max_messages_per_day: input.maxMessagesPerDay,
      p_max_messages_total: input.maxMessagesTotal,
      p_release_starts_at: input.releaseStartsAt ?? null,
      p_release_expires_at: input.releaseExpiresAt ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setChannelReleaseBasicState(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    targetState: ReleaseBasicState;
    reason?: string | null;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_set_basic_state',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_target_state: input.targetState,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function proposeControlledPilot(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    reason: string;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_propose_pilot',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: input.reason,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function cancelReleaseProposal(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    reason?: string | null;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_cancel_proposal',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function suspendChannelRelease(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    reason: string;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_suspend',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: input.reason,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

/**
 * Approve and activate a controlled pilot through the trusted Edge boundary.
 * The deployed revision is read server-side; the browser cannot supply it.
 * This function contacts no provider and sends nothing.
 */
export const RELEASE_CONTROL_EDGE_FUNCTION = 'omni-comms-release-control';

export interface ApproveActivateInput {
  releaseControlId: string;
  expectedUpdatedAt: string;
  expectedFingerprint: string;
  approvalNote?: string | null;
  correlationId?: string | null;
}

export function buildApproveActivateBody(input: ApproveActivateInput) {
  return {
    action: 'approve_activate' as const,
    releaseControlId: input.releaseControlId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    expectedFingerprint: input.expectedFingerprint,
    approvalNote: input.approvalNote ?? null,
    correlationId: input.correlationId ?? null,
  };
}

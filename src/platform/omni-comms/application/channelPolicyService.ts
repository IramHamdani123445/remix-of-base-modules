/**
 * Omni-Comms C4B — typed adapter over the generic channel-policy RPCs.
 *
 * Boundaries (permanent):
 *   - Uses the bound Omni-Comms RPC client only; never the browser Supabase
 *     singleton and never a direct table query.
 *   - No provider SDK, no fetch, no sendCommunication, no runtime records.
 *   - Reads and writes administration records only; it enforces nothing.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  ChannelPolicySummary,
  PolicyChannel,
  UpsertChannelPolicyInput,
} from './channelPolicyTypes';

export interface GetChannelPolicySummaryInput {
  organizationId: string;
  departmentId?: string | null;
  channel: PolicyChannel;
  /**
   * Reference records are excluded by default. The production UI must always
   * leave this false; only an authorised non-production reference view may
   * request them, and the server additionally requires omni_comms.configure.
   */
  includeReference?: boolean;
}

export function getChannelPolicySummary(
  client: OmniCommsRpcClient,
  input: GetChannelPolicySummaryInput,
): Promise<ChannelPolicySummary> {
  return callOmniCommsRpc<ChannelPolicySummary>(
    client,
    'omni_comms_channel_policy_summary',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_include_reference: input.includeReference ?? false,
    },
  );
}

export function upsertChannelPolicy(
  client: OmniCommsRpcClient,
  input: UpsertChannelPolicyInput,
): Promise<string> {
  const common = input.common;
  return callOmniCommsRpc<string>(client, 'omni_comms_channel_policy_upsert', {
    p_id: input.id ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_channel: input.channel,
    p_common_policy: {
      operational_state: common.operational_state,
      department_override_enabled: common.department_override_enabled ?? true,
      per_minute_limit: common.per_minute_limit ?? null,
      per_day_limit: common.per_day_limit ?? null,
      max_recipients_per_request: common.max_recipients_per_request ?? null,
      quiet_hours_start: common.quiet_hours_start ?? null,
      quiet_hours_end: common.quiet_hours_end ?? null,
      quiet_hours_timezone: common.quiet_hours_timezone ?? null,
      retry_profile: common.retry_profile ?? 'none',
      request_timeout_seconds: common.request_timeout_seconds ?? null,
      retention_days: common.retention_days ?? null,
      cost_currency: common.cost_currency ?? null,
      daily_cost_limit_minor: common.daily_cost_limit_minor ?? null,
      per_message_cost_limit_minor: common.per_message_cost_limit_minor ?? null,
    },
    p_channel_policy_config: input.channelPolicyConfig ?? {},
    p_correlation_id: input.correlationId ?? null,
  });
}

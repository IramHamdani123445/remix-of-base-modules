/**
 * Omni-Comms C3A — typed adapter over the generic channel-identity RPCs.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *   - Never imports a provider SDK, never calls sendCommunication, never
 *     creates a request, message, dispatch job or delivery attempt.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  ChannelIdentitySummary,
  OmniCommsIdentityChannel,
  SetChannelIdentityLifecycleInput,
  UpsertChannelIdentityInput,
} from './channelIdentityTypes';

export function getChannelIdentitySummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel: OmniCommsIdentityChannel,
  departmentId: string | null = null,
  includeReference = false,
): Promise<ChannelIdentitySummary> {
  return callOmniCommsRpc<ChannelIdentitySummary>(
    client,
    'omni_comms_channel_identity_summary',
    {
      p_organization_id: organizationId,
      p_department_id: departmentId,
      p_channel: channel,
      p_include_reference: includeReference,
    },
  );
}

export function upsertChannelIdentityDraft(
  client: OmniCommsRpcClient,
  input: UpsertChannelIdentityInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_identity_upsert_draft',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_code: input.code,
      p_display_name: input.displayName,
      p_identity_type: input.identityType,
      p_identity_config: input.identityConfig,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setChannelIdentityLifecycle(
  client: OmniCommsRpcClient,
  input: SetChannelIdentityLifecycleInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_identity_set_lifecycle',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_action: input.action,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

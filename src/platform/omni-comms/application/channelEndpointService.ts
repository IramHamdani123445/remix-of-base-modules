/**
 * Omni-Comms C3B — typed adapter over the generic channel-endpoint RPCs.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *   - Never imports a provider SDK, never calls sendCommunication, never
 *     performs a DNS lookup, never fetches an endpoint URL, and never creates
 *     a request, message, dispatch job or delivery attempt.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  ChannelEndpointSummary,
  OmniCommsEndpointChannel,
  SetChannelEndpointLifecycleInput,
  UpsertChannelEndpointInput,
} from './channelEndpointTypes';

export function getChannelEndpointSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel: OmniCommsEndpointChannel,
  departmentId: string | null = null,
  includeReference = false,
): Promise<ChannelEndpointSummary> {
  return callOmniCommsRpc<ChannelEndpointSummary>(
    client,
    'omni_comms_channel_endpoint_summary',
    {
      p_organization_id: organizationId,
      p_department_id: departmentId,
      p_channel: channel,
      p_include_reference: includeReference,
    },
  );
}

export function upsertChannelEndpointDraft(
  client: OmniCommsRpcClient,
  input: UpsertChannelEndpointInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_endpoint_upsert_draft',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_provider_account_id: input.providerAccountId ?? null,
      p_code: input.code,
      p_display_name: input.displayName,
      p_endpoint_type: input.endpointType,
      p_endpoint_config: input.endpointConfig,
      p_secret_refs: input.secretRefs ?? {},
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setChannelEndpointLifecycle(
  client: OmniCommsRpcClient,
  input: SetChannelEndpointLifecycleInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_endpoint_set_lifecycle',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_action: input.action,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

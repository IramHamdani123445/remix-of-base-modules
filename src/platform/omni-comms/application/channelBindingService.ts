/**
 * Omni-Comms C4A — typed adapter over the generic channel-binding RPCs.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *   - Never imports a provider SDK, never calls sendCommunication, never
 *     creates a request, message, dispatch job or delivery attempt.
 *   - Exposes NO way for an administrator to record binding verification;
 *     that worker is service-role only.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  ChannelBindingSummary,
  OmniCommsBindingChannel,
  SetChannelBindingLifecycleInput,
  UpsertChannelBindingInput,
} from './channelBindingTypes';

export function getChannelBindingSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel: OmniCommsBindingChannel,
  departmentId: string | null = null,
  includeReference = false,
): Promise<ChannelBindingSummary> {
  return callOmniCommsRpc<ChannelBindingSummary>(
    client,
    'omni_comms_channel_binding_summary',
    {
      p_organization_id: organizationId,
      p_department_id: departmentId,
      p_channel: channel,
      p_include_reference: includeReference,
    },
  );
}

export function upsertChannelBindingDraft(
  client: OmniCommsRpcClient,
  input: UpsertChannelBindingInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_binding_upsert_draft',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_sender_identity_id: input.senderIdentityId,
      p_provider_account_id: input.providerAccountId,
      p_channel_endpoint_id: input.channelEndpointId ?? null,
      p_priority: input.priority,
      p_external_sender_ref: input.externalSenderRef ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setChannelBindingLifecycle(
  client: OmniCommsRpcClient,
  input: SetChannelBindingLifecycleInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_binding_set_lifecycle',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_action: input.action,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

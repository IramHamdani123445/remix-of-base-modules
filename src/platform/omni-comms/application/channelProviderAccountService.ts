/**
 * Omni-Comms C2 — typed adapter over the generic provider-account RPCs.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *   - Never imports a provider SDK, resolves an Edge secret or sends a message.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  ChannelProviderAccountSummary,
  SetChannelProviderAccountLifecycleInput,
  UpsertChannelProviderAccountInput,
} from './channelProviderAccountTypes';
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';

export function getChannelProviderAccountSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel: OmniCommsChannel,
  includeReference = false,
): Promise<ChannelProviderAccountSummary> {
  return callOmniCommsRpc<ChannelProviderAccountSummary>(
    client,
    'omni_comms_channel_provider_account_summary',
    {
      p_organization_id: organizationId,
      p_channel: channel,
      p_include_reference: includeReference,
    },
  );
}

export function upsertChannelProviderAccountDraft(
  client: OmniCommsRpcClient,
  input: UpsertChannelProviderAccountInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_provider_account_upsert_draft',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_channel: input.channel,
      p_provider_id: input.providerId,
      p_code: input.code,
      p_display_name: input.displayName,
      p_environment: input.environment,
      p_region: input.region ?? null,
      p_provider_account_reference: input.providerAccountReference ?? null,
      p_secret_refs: input.secretRefs.map((r) => ({
        purpose: r.purpose,
        secret_ref: r.secretRef,
      })),
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setChannelProviderAccountLifecycle(
  client: OmniCommsRpcClient,
  input: SetChannelProviderAccountLifecycleInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_provider_account_set_lifecycle',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_action: input.action,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

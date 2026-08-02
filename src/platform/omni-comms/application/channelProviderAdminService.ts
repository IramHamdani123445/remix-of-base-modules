/**
 * Omni-Comms C2.1 — provider administration DTOs and service.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Only bounded SECURITY DEFINER RPCs; no direct table access.
 *   - No provider SDK, no secret value, no send behaviour.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';
import type { OmniCommsDataOrigin } from './channelProviderAccountTypes';

export interface ProviderAdminCredentialRequirement {
  id: string;
  provider_id: string;
  purpose: string;
  display_name: string;
  description: string | null;
  required: boolean;
  secret_ref_pattern: string;
  sort_order: number;
}

export interface ProviderAdminRow {
  id: string;
  code: string;
  display_name: string;
  channel: OmniCommsChannel;
  adapter_key: string;
  status: 'draft' | 'active' | 'retired';
  data_origin: OmniCommsDataOrigin;
  updated_at: string;
  activated_at: string | null;
  retired_at: string | null;
  retirement_reason: string | null;
  credential_requirements: ProviderAdminCredentialRequirement[];
  account_count: number;
}

export interface ProviderAdminSummary {
  channel: OmniCommsChannel;
  providers: ProviderAdminRow[];
  reference_included: boolean;
  generated_at: string;
}

export interface UpsertProviderInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  channel: OmniCommsChannel;
  code: string;
  displayName: string;
  adapterKey: string;
  credentialRequirements: readonly {
    purpose: string;
    displayName: string;
    description?: string | null;
    required: boolean;
    secretRefPattern: string;
  }[];
  correlationId?: string | null;
}

export interface SetProviderLifecycleInput {
  id: string;
  expectedUpdatedAt: string;
  action: 'activate' | 'retire';
  reason?: string | null;
  correlationId?: string | null;
}

export function getChannelProviderAdminSummary(
  client: OmniCommsRpcClient,
  channel: OmniCommsChannel,
  includeReference = false,
): Promise<ProviderAdminSummary> {
  return callOmniCommsRpc<ProviderAdminSummary>(
    client,
    'omni_comms_channel_provider_admin_summary',
    { p_channel: channel, p_include_reference: includeReference },
  );
}

export function upsertChannelProviderDraft(
  client: OmniCommsRpcClient,
  input: UpsertProviderInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_provider_upsert_draft',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_channel: input.channel,
      p_code: input.code,
      p_display_name: input.displayName,
      p_adapter_key: input.adapterKey,
      p_credential_requirements: input.credentialRequirements.map((r) => ({
        purpose: r.purpose,
        display_name: r.displayName,
        description: r.description ?? null,
        required: r.required,
        secret_ref_pattern: r.secretRefPattern,
      })),
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setChannelProviderLifecycle(
  client: OmniCommsRpcClient,
  input: SetProviderLifecycleInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_provider_set_lifecycle',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_action: input.action,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

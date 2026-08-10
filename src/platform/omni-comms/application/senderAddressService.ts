/**
 * Omni-Comms — Sender Addresses (Email) application service.
 *
 * Typed adapter over the bounded SECURITY DEFINER sender-address RPCs plus the
 * existing generic identity command RPCs. The screen calls only this module.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly.
 *   - Never imports a provider SDK, never sends, never creates a binding,
 *     route, request, message, dispatch job or delivery attempt.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  SenderAddressSummary,
  UpsertSenderAddressInput,
} from './senderAddressTypes';

export function getSenderAddressSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  departmentId: string | null = null,
  includeReference = false,
): Promise<SenderAddressSummary> {
  return callOmniCommsRpc<SenderAddressSummary>(
    client,
    'omni_comms_sender_address_summary',
    {
      p_organization_id: organizationId,
      p_department_id: departmentId,
      p_include_reference: includeReference,
    },
  );
}

/** Create or edit a sender. New and edited senders are always drafts. */
export function upsertSenderAddressDraft(
  client: OmniCommsRpcClient,
  input: UpsertSenderAddressInput,
): Promise<string> {
  const config: Record<string, string> = {
    from_address: input.fromAddress.trim(),
    from_name: input.displayName.trim(),
  };
  const replyTo = (input.replyToAddress ?? '').trim();
  if (replyTo) config.reply_to_address = replyTo;

  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_identity_upsert_draft',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: 'email',
      p_code: input.code,
      p_display_name: input.displayName.trim(),
      p_identity_type: 'email_sender',
      p_identity_config: config,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

/**
 * Activate (or reactivate) a sender. The backend refuses unless the address,
 * sending domain, DNS verification, provider-account association and provider
 * account are all genuinely ready — stale verification can never be reused.
 */
export function activateSenderAddress(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  correlationId: string | null = null,
): Promise<{ id: string; status: string }> {
  return callOmniCommsRpc<{ id: string; status: string }>(
    client,
    'omni_comms_sender_address_activate',
    {
      p_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_correlation_id: correlationId,
    },
  );
}

export function disableSenderAddress(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  reason: string | null = null,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_identity_set_lifecycle',
    {
      p_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_action: 'disable',
      p_reason: reason,
      p_correlation_id: null,
    },
  );
}

export function retireSenderAddress(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  reason: string,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_channel_identity_set_lifecycle',
    {
      p_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_action: 'retire',
      p_reason: reason,
      p_correlation_id: null,
    },
  );
}

/** Permanent delete. The backend performs the dependency analysis. */
export function deleteSenderAddress(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
): Promise<{ id: string; deleted: boolean }> {
  return callOmniCommsRpc<{ id: string; deleted: boolean }>(
    client,
    'omni_comms_sender_address_delete',
    {
      p_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_correlation_id: null,
    },
  );
}

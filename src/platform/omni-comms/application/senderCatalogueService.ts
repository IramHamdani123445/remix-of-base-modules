/**
 * Omni-Comms — production Email Sender Catalogue application service.
 *
 * Typed adapter over the bounded SECURITY DEFINER catalogue RPC.
 *
 * Boundaries (permanent): never imports the browser Supabase singleton, never
 * queries tables directly, never sends, never mutates an event route.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';
import type { SenderCatalogueBootstrapResult } from './senderCatalogueTypes';

export interface SenderCatalogueBootstrapInput {
  organizationId: string;
  apply?: boolean;
  channel?: string;
  domain?: string;
  correlationId?: string | null;
}

/**
 * Preview (`apply=false`) or apply-missing (`apply=true`) the production sender
 * catalogue. Applying never overwrites an existing sender and never resolves a
 * conflict automatically.
 */
export function bootstrapSenderCatalogue(
  client: OmniCommsRpcClient,
  input: SenderCatalogueBootstrapInput,
): Promise<SenderCatalogueBootstrapResult> {
  return callOmniCommsRpc<SenderCatalogueBootstrapResult>(
    client,
    'omni_comms_sender_catalogue_bootstrap',
    {
      p_organization_id: input.organizationId,
      p_apply: input.apply ?? false,
      p_channel: input.channel ?? 'email',
      p_domain: input.domain ?? 'secureserve.biz',
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

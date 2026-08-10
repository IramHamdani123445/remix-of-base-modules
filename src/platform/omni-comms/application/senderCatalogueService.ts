/**
 * Omni-Comms — production Email Sender Catalogue application service.
 *
 * Typed adapter over the bounded SECURITY DEFINER catalogue RPCs.
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

export type SenderCatalogueConflictAction =
  | 'approve_equivalent'
  | 'rename_to_catalogue_code';

export interface SenderCatalogueConflictInput {
  organizationId: string;
  senderIdentityId: string;
  catalogueSenderCode: string;
  action: SenderCatalogueConflictAction;
  expectedUpdatedAt?: string | null;
  correlationId?: string | null;
}

export interface SenderCatalogueConflictResult {
  sender_identity_id: string;
  code: string;
  catalogue_sender_code: string | null;
  action: SenderCatalogueConflictAction;
  updated_at: string;
}

/**
 * Explicit operator decision on a catalogue conflict. Never called
 * automatically by the bootstrap.
 */
export function resolveSenderCatalogueConflict(
  client: OmniCommsRpcClient,
  input: SenderCatalogueConflictInput,
): Promise<SenderCatalogueConflictResult> {
  return callOmniCommsRpc<SenderCatalogueConflictResult>(
    client,
    'omni_comms_sender_catalogue_resolve_conflict',
    {
      p_organization_id: input.organizationId,
      p_sender_identity_id: input.senderIdentityId,
      p_catalogue_sender_code: input.catalogueSenderCode,
      p_action: input.action,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

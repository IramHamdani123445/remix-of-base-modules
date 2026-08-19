/**
 * Omni-Comms — template provider registration client service.
 *
 * Provider registration is deliberately SEPARATE from message content: the
 * canonical template never carries a ContentSid or any other provider
 * identifier. This service only relays operator intent; the resulting external
 * provider status is produced server-side by reconciliation and can never be
 * asserted from the browser.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';

export type ProviderRegistrationStatus =
  | 'not_registered'
  | 'submitted'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'paused'
  | 'disabled';

export type ProviderVerificationMode = 'manually_attested' | 'provider_verified';

export interface TemplateProviderRegistration {
  id: string;
  template_version_id: string;
  provider_account_id: string;
  adapter_key: string;
  provider_template_ref: string | null;
  provider_status: ProviderRegistrationStatus;
  provider_language: string | null;
  provider_category: string | null;
  verification_mode: ProviderVerificationMode | null;
  rejection_code: string | null;
  rejection_reason: string | null;
  last_checked_at: string | null;
  last_reconciled_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  updated_at: string;
}

/** Masks a provider reference for display: never show the full identifier. */
export function maskProviderTemplateRef(ref: string | null | undefined): string {
  const value = (ref ?? '').trim();
  if (value === '') return 'Not registered';
  return `${value.slice(0, 4)}${'•'.repeat(6)}`;
}

/** Human wording that never overstates who confirmed the registration. */
export function verificationModeLabel(mode: ProviderVerificationMode | null | undefined): string {
  return mode === 'provider_verified'
    ? 'Provider-verified approval'
    : 'Manually attested provider registration';
}

export async function listTemplateProviderRegistrations(
  client: OmniCommsRpcClient,
  templateVersionId: string,
): Promise<TemplateProviderRegistration[]> {
  const result = await callOmniCommsRpc<{ items: TemplateProviderRegistration[] }>(
    client,
    'omni_comms_template_provider_registration_list',
    { p_template_version_id: templateVersionId },
  );
  return result?.items ?? [];
}

export async function upsertTemplateProviderRegistration(
  client: OmniCommsRpcClient,
  input: {
    templateVersionId: string;
    providerAccountId: string;
    providerLanguage?: string;
    providerCategory?: string;
    correlationId?: string | null;
  },
): Promise<TemplateProviderRegistration> {
  return callOmniCommsRpc<TemplateProviderRegistration>(
    client,
    'omni_comms_template_provider_registration_upsert',
    {
      p_template_version_id: input.templateVersionId,
      p_provider_account_id: input.providerAccountId,
      p_provider_language: input.providerLanguage ?? 'en',
      p_provider_category: input.providerCategory ?? 'utility',
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

/** Records that the template was submitted to the provider for approval. */
export async function submitTemplateProviderRegistration(
  client: OmniCommsRpcClient,
  registrationId: string,
  providerTemplateRef: string,
  correlationId?: string | null,
): Promise<TemplateProviderRegistration> {
  return callOmniCommsRpc<TemplateProviderRegistration>(
    client,
    'omni_comms_template_provider_registration_submit',
    {
      p_id: registrationId,
      p_provider_template_ref: providerTemplateRef,
      p_correlation_id: correlationId ?? null,
    },
  );
}

/**
 * Manual attestation. This is explicitly NOT provider verification and the UI
 * must keep the two labels distinguishable.
 */
export async function attestTemplateProviderRegistration(
  client: OmniCommsRpcClient,
  registrationId: string,
  providerTemplateRef: string,
  correlationId?: string | null,
): Promise<TemplateProviderRegistration> {
  return callOmniCommsRpc<TemplateProviderRegistration>(
    client,
    'omni_comms_template_provider_registration_attest',
    {
      p_id: registrationId,
      p_provider_template_ref: providerTemplateRef,
      p_correlation_id: correlationId ?? null,
    },
  );
}

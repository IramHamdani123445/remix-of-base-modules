/**
 * Omni-Comms C2 — generic provider-account DTOs.
 *
 * Provider-independent replacement for the email-only account model. Neutral
 * to the browser Supabase client: consumers pass a bound RPC client.
 *
 * Boundaries (permanent):
 *   - No provider SDK types here.
 *   - Only bounded secret REFERENCE names are ever modelled. A raw credential
 *     value has no representation in this module.
 *   - No sending, dispatch or runtime delivery shape is modelled.
 */
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';

export type OmniCommsDataOrigin = 'system_seed' | 'user' | 'reference_seed';

export type OmniCommsAccountEnvironment = 'sandbox' | 'staging' | 'production';

export const OMNI_COMMS_ACCOUNT_ENVIRONMENTS: readonly OmniCommsAccountEnvironment[] = [
  'sandbox',
  'staging',
  'production',
];

export type OmniCommsAccountLifecycleAction = 'activate' | 'disable' | 'retire';

/** An installed provider adapter available for the selected channel. */
export interface ChannelProviderRow {
  id: string;
  code: string;
  display_name: string;
  channel: OmniCommsChannel;
  adapter_key: string;
  status: 'draft' | 'active' | 'retired';
  data_origin: OmniCommsDataOrigin;
  updated_at: string;
}

/** A named credential purpose an installed provider requires. */
export interface ProviderCredentialRequirementRow {
  id: string;
  provider_id: string;
  purpose: string;
  display_name: string;
  description: string | null;
  required: boolean;
  secret_ref_pattern: string;
  sort_order: number;
}

/** A configured secret REFERENCE name (never a credential value). */
export interface AccountSecretRefRow {
  purpose: string;
  secret_ref: string;
}

export interface ChannelProviderAccountRow {
  id: string;
  code: string;
  display_name: string;
  provider_id: string;
  provider_adapter_key: string;
  channel: OmniCommsChannel;
  environment: OmniCommsAccountEnvironment;
  region: string | null;
  provider_account_reference: string | null;
  status: 'draft' | 'active' | 'disabled' | 'retired';
  data_origin: OmniCommsDataOrigin;
  health_state: 'unknown' | 'healthy' | 'degraded' | 'failed';
  health_checked_at: string | null;
  verification_status: 'unverified' | 'pending' | 'verified' | 'failed';
  verification_result_code: string | null;
  verification_detail: string | null;
  verification_checked_at: string | null;
  updated_at: string;
  secret_ref_purposes: AccountSecretRefRow[];
  required_credential_count: number;
  configured_credential_count: number;
}

export interface ChannelProviderAccountSummary {
  organization_id: string;
  channel: OmniCommsChannel;
  providers: ChannelProviderRow[];
  credential_requirements: ProviderCredentialRequirementRow[];
  /** Genuine (non reference) organisation accounts. */
  accounts: ChannelProviderAccountRow[];
  /** Populated only when reference data was explicitly requested. */
  reference_accounts: ChannelProviderAccountRow[];
  reference_account_count: number;
  generated_at: string;
}

export interface UpsertChannelProviderAccountInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  channel: OmniCommsChannel;
  providerId: string;
  code: string;
  displayName: string;
  environment: OmniCommsAccountEnvironment;
  region?: string | null;
  providerAccountReference?: string | null;
  /** Bounded array of { purpose, secretRef }. Reference names only. */
  secretRefs: readonly { purpose: string; secretRef: string }[];
  correlationId?: string | null;
}

export interface SetChannelProviderAccountLifecycleInput {
  id: string;
  expectedUpdatedAt: string;
  action: OmniCommsAccountLifecycleAction;
  /** Required for `retire`. */
  reason?: string | null;
  correlationId?: string | null;
}

/** Credential completeness label, e.g. "1 of 1 configured". */
export function credentialCompleteness(a: ChannelProviderAccountRow): string {
  if (a.required_credential_count === 0 && a.configured_credential_count === 0) {
    return 'No credential required';
  }
  return `${a.configured_credential_count} of ${a.required_credential_count} configured`;
}

/**
 * Credential completeness.
 *
 * An adapter that genuinely requires no external credential (an internal
 * production adapter such as the Print spool) is complete by definition; every
 * other adapter must carry all of its required credential references.
 */
export function credentialsComplete(
  a: ChannelProviderAccountRow,
  credentialFree = false,
): boolean {
  if (credentialFree) return true;
  return (
    a.required_credential_count > 0 &&
    a.configured_credential_count >= a.required_credential_count
  );
}

/** Only adapters with a real server-side verifier may offer verification. */
export const OMNI_COMMS_VERIFIABLE_ADAPTERS: readonly string[] = ['resend'];

export function verificationImplemented(adapterKey: string): boolean {
  return OMNI_COMMS_VERIFIABLE_ADAPTERS.includes(adapterKey);
}

/**
 * Canonical client mirror of the database predicate
 * `public.omni_comms_provider_credential_send_ready`.
 *
 * A Resend key created with "Sending access" authenticates successfully but
 * cannot read the domains endpoint, so the probe can never return `verified`.
 * The credential is genuine and usable for sending, therefore both the send
 * gate and this projection treat it as send-ready. Any other pending or failed
 * outcome is NOT send-ready.
 */
export function credentialSendReady(a: {
  verification_status?: string | null;
  verification_result_code?: string | null;
}): boolean {
  if (a.verification_status === 'verified') return true;
  return (
    a.verification_status === 'pending'
    && a.verification_result_code === 'restricted_api_key'
  );
}

/** True only for the sending-only ("restricted") accepted credential case. */
export function credentialRestrictedButUsable(a: {
  verification_status?: string | null;
  verification_result_code?: string | null;
}): boolean {
  return a.verification_status !== 'verified' && credentialSendReady(a);
}


export const VERIFICATION_NOT_IMPLEMENTED_MESSAGE =
  'Credential verification not implemented for this provider';

export const NO_PROVIDER_ADAPTER_MESSAGE =
  'No provider adapter is installed for this channel.';

export const SECRET_REFERENCE_HELP =
  'Enter the Edge secret reference name, not the secret value.';

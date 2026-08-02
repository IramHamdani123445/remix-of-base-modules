/**
 * Omni-Comms C4A — generic channel-binding DTOs.
 *
 * A binding declares WHICH provider account (and optionally which channel
 * endpoint) an approved channel identity is allowed to be presented through,
 * and in WHICH order when several providers serve the same channel.
 *
 * Boundaries (permanent):
 *   - No provider SDK type, credential, endpoint URL or secret value here.
 *   - No sending, dispatch, queue, retry or delivery shape is modelled.
 *   - Verification is provider/service evidence only; an administrator can
 *     never assert it, and this module never claims a binding can send.
 */
import type { OmniCommsIdentityChannel } from './channelIdentityTypes';

export type OmniCommsBindingChannel = OmniCommsIdentityChannel;

export type OmniCommsBindingStatus = 'draft' | 'active' | 'disabled' | 'retired';

export type OmniCommsBindingLifecycleAction = 'activate' | 'disable' | 'retire';

export type OmniCommsBindingDataOrigin = 'system_seed' | 'user' | 'reference_seed';

export type OmniCommsBindingVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'failed';

/**
 * Where the verification evidence came from. `legacy_manual` is historical
 * evidence recorded before C4A removed manual administrator verification.
 */
export type OmniCommsBindingVerificationSource =
  | 'none'
  | 'provider'
  | 'service'
  | 'legacy_manual';

/** Whether a channel's binding may/must reference a channel endpoint. */
export type OmniCommsBindingEndpointRequirement =
  | 'required'
  | 'optional'
  | 'forbidden';

/** Mirrors the server-side `omni_comms_priv_binding_endpoint_requirement`. */
export const OMNI_COMMS_BINDING_ENDPOINT_REQUIREMENT: Record<
  OmniCommsBindingChannel,
  OmniCommsBindingEndpointRequirement
> = {
  email: 'required',
  sms: 'optional',
  whatsapp: 'required',
  push: 'forbidden',
  in_app: 'required',
  print: 'required',
};

export function bindingEndpointRequirement(
  channel: OmniCommsBindingChannel,
): OmniCommsBindingEndpointRequirement {
  return OMNI_COMMS_BINDING_ENDPOINT_REQUIREMENT[channel] ?? 'forbidden';
}

export const BINDING_PRIORITY_MIN = 1;
export const BINDING_PRIORITY_MAX = 1000;
export const BINDING_PRIORITY_DEFAULT = 100;

/** Bounded shape for the provider-side identity reference. */
export const BINDING_EXTERNAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:@+/-]{0,127}$/;

export function isValidBindingExternalRef(value: string): boolean {
  return BINDING_EXTERNAL_REF_PATTERN.test(value.trim());
}

export function isValidBindingPriority(value: number): boolean {
  return (
    Number.isInteger(value)
    && value >= BINDING_PRIORITY_MIN
    && value <= BINDING_PRIORITY_MAX
  );
}

export interface BindingIdentityOption {
  id: string;
  code: string;
  display_name: string;
  identity_type: string | null;
  channel: OmniCommsBindingChannel;
  identity_value: string | null;
  department_id: string | null;
  department_name: string | null;
  status: string;
  data_origin: OmniCommsBindingDataOrigin;
}

export interface BindingProviderAccountOption {
  id: string;
  code: string;
  display_name: string;
  adapter_key: string | null;
  environment: string | null;
  status: string;
  verification_status: string | null;
  data_origin: OmniCommsBindingDataOrigin;
}

export interface BindingEndpointOption {
  id: string;
  code: string;
  display_name: string;
  endpoint_type: string;
  provider_account_id: string | null;
  endpoint_config: Record<string, unknown>;
  department_id: string | null;
  department_name: string | null;
  status: string;
  verification_status: string | null;
  data_origin: OmniCommsBindingDataOrigin;
}

export interface ChannelBindingRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  department_name: string | null;
  channel: OmniCommsBindingChannel;
  sender_identity_id: string;
  identity_code: string;
  identity_display_name: string;
  identity_type: string | null;
  identity_value: string | null;
  provider_account_id: string;
  provider_account_code: string;
  provider_account_display_name: string;
  adapter_key: string | null;
  channel_endpoint_id: string | null;
  endpoint_code: string | null;
  endpoint_display_name: string | null;
  endpoint_type: string | null;
  priority: number;
  external_sender_ref: string | null;
  status: OmniCommsBindingStatus;
  data_origin: OmniCommsBindingDataOrigin;
  verification_status: OmniCommsBindingVerificationStatus;
  verification_source: OmniCommsBindingVerificationSource;
  verification_result_code: string | null;
  verification_detail: string | null;
  verification_checked_at: string | null;
  verified_at: string | null;
  activated_at: string | null;
  disabled_at: string | null;
  retired_at: string | null;
  retirement_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelBindingSummary {
  organization_id: string;
  department_id: string | null;
  channel: OmniCommsBindingChannel;
  identities: BindingIdentityOption[];
  provider_accounts: BindingProviderAccountOption[];
  endpoints: BindingEndpointOption[];
  bindings: ChannelBindingRow[];
  reference_bindings: ChannelBindingRow[];
  reference_binding_count: number;
  generated_at: string;
}

export interface UpsertChannelBindingInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  channel: OmniCommsBindingChannel;
  senderIdentityId: string;
  providerAccountId: string;
  channelEndpointId?: string | null;
  priority: number;
  externalSenderRef?: string | null;
  correlationId?: string | null;
}

export interface SetChannelBindingLifecycleInput {
  id: string;
  expectedUpdatedAt: string;
  action: OmniCommsBindingLifecycleAction;
  /** Required for `retire`. */
  reason?: string | null;
  correlationId?: string | null;
}

/**
 * Permanent, non-negotiable operator statement. Activation approves the
 * configuration pairing only — it is never a provider verification and it
 * never means the channel can send.
 */
export const BINDING_ACTIVATION_MEANING =
  'Active means this identity is approved for use with this provider account. '
  + 'It does not mean the provider has verified the pairing, and it does not '
  + 'enable sending.';

/** Manual administrator verification was permanently removed in C4A. */
export const BINDING_VERIFICATION_OWNERSHIP =
  'Verification state is recorded only by the provider or a trusted '
  + 'server-side service. It cannot be set by an administrator.';

export const BINDING_PRIORITY_MEANING =
  'Priority orders same-channel providers for a future fallback capability. '
  + 'No fallback, routing or retry behaviour is implemented yet.';

export const REFERENCE_BINDING_READ_ONLY_HELP =
  'Reference binding — read-only and excluded from operational configuration.';

/** Server error slugs surfaced by the C4A workers. */
export const BINDING_REFERENCE_READ_ONLY_CODE = 'reference_binding_read_only';
export const BINDING_REFERENCE_NON_OPERATIONAL_CODE =
  'reference_binding_non_operational';
export const BINDING_MANUAL_VERIFICATION_REMOVED_CODE =
  'manual_binding_verification_removed';

/** Verification is never claimed by the configuration screen. */
export const BINDING_VERIFICATION_LABEL: Record<
  OmniCommsBindingVerificationStatus,
  string
> = {
  unverified: 'Not verified',
  pending: 'Provider verification pending',
  verified: 'Recorded as provider-verified',
  failed: 'Provider verification failed',
};

export const BINDING_VERIFICATION_SOURCE_LABEL: Record<
  OmniCommsBindingVerificationSource,
  string
> = {
  none: 'No evidence',
  provider: 'Provider',
  service: 'Trusted service',
  legacy_manual: 'Legacy manual evidence',
};

export function isReferenceBindingRow(row: ChannelBindingRow): boolean {
  return row.data_origin === 'reference_seed';
}

/** Operator-facing scope label: organisation-wide or the actual department. */
export function bindingScopeLabel(row: ChannelBindingRow): string {
  if (!row.department_id) return 'Organisation-wide';
  return row.department_name?.trim() || 'Department';
}

export function bindingEndpointLabel(row: ChannelBindingRow): string {
  if (!row.channel_endpoint_id) return '—';
  return row.endpoint_display_name?.trim() || row.endpoint_code || 'Endpoint';
}

/**
 * A binding may only be activated once its identity, account and (required)
 * endpoint are themselves operational. Mirrored server-side; the UI uses this
 * only to explain why an action is unavailable.
 */
export function bindingActivationBlockers(
  row: ChannelBindingRow,
  identity: BindingIdentityOption | undefined,
  account: BindingProviderAccountOption | undefined,
  endpoint: BindingEndpointOption | undefined,
): string[] {
  const blockers: string[] = [];
  if (row.data_origin === 'reference_seed') {
    blockers.push('Reference bindings are never operational.');
    return blockers;
  }
  if (row.status === 'retired') blockers.push('Binding is retired.');
  if (row.status === 'active') blockers.push('Binding is already active.');
  if (identity && identity.status !== 'active') {
    blockers.push('Channel identity is not active.');
  }
  if (account && account.status !== 'active') {
    blockers.push('Provider account is not active.');
  }
  const requirement = bindingEndpointRequirement(row.channel);
  if (requirement === 'required' && !row.channel_endpoint_id) {
    blockers.push('A channel endpoint is required for this channel.');
  }
  if (endpoint && endpoint.status !== 'active') {
    blockers.push('Channel endpoint is not active.');
  }
  return blockers;
}

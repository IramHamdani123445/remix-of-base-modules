/**
 * Omni-Comms C3A — generic channel identity DTOs.
 *
 * Provider-independent replacement for the Email-only sender-identity model.
 *
 * Boundaries (permanent):
 *   - No provider SDK types here.
 *   - No credential value, secret reference, endpoint or domain is modelled.
 *   - No sending, dispatch or runtime delivery shape is modelled.
 *   - An identity is NEVER represented as provider verified.
 */
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';

export type OmniCommsIdentityDataOrigin = 'system_seed' | 'user' | 'reference_seed';

export type OmniCommsIdentityStatus = 'draft' | 'active' | 'disabled' | 'retired';

export type OmniCommsIdentityLifecycleAction = 'activate' | 'disable' | 'retire';

/** Identity types supported by the C3A server-side normaliser. */
export type OmniCommsIdentityType =
  | 'email_sender'
  | 'sender_id'
  | 'originating_number'
  | 'business_number'
  | 'application'
  | 'issuing_authority';

/**
 * Channels whose value is supported by the database `channel` constraint.
 * `webhook` and `voice` remain planned and are intentionally absent.
 */
export const OMNI_COMMS_IDENTITY_CHANNELS = [
  'email',
  'sms',
  'whatsapp',
  'push',
  'in_app',
  'print',
] as const;

export type OmniCommsIdentityChannel = (typeof OMNI_COMMS_IDENTITY_CHANNELS)[number];

export function identityChannelSupported(
  channel: OmniCommsChannel | string,
): channel is OmniCommsIdentityChannel {
  return (OMNI_COMMS_IDENTITY_CHANNELS as readonly string[]).includes(channel);
}

/** Identity types offered per channel, in display order. */
export const OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL: Record<
  OmniCommsIdentityChannel,
  readonly OmniCommsIdentityType[]
> = {
  email: ['email_sender'],
  sms: ['sender_id', 'originating_number'],
  whatsapp: ['business_number'],
  push: ['application'],
  in_app: ['application'],
  print: ['issuing_authority'],
};

export const OMNI_COMMS_IDENTITY_TYPE_LABEL: Record<OmniCommsIdentityType, string> = {
  email_sender: 'Email sender',
  sender_id: 'Sender ID',
  originating_number: 'Originating number',
  business_number: 'Business number',
  application: 'Application',
  issuing_authority: 'Issuing authority',
};

export const OMNI_COMMS_SMS_MESSAGE_CLASSES = [
  'transactional',
  'promotional',
  'mixed',
] as const;

export const OMNI_COMMS_PUSH_PLATFORMS = [
  'android',
  'ios',
  'web',
  'cross_platform',
] as const;

/** Bounded, string-only identity configuration. Never a credential. */
export type ChannelIdentityConfig = Record<string, string>;

export interface ChannelIdentityRow {
  id: string;
  code: string;
  display_name: string;
  channel: OmniCommsIdentityChannel;
  identity_type: OmniCommsIdentityType | null;
  identity_config: ChannelIdentityConfig;
  department_id: string | null;
  /** C3A closure — resolved organisation department name; null when org-wide. */
  department_name: string | null;
  event_definition_id: string | null;
  status: OmniCommsIdentityStatus;
  data_origin: OmniCommsIdentityDataOrigin;
  /** Legacy Email compatibility mirrors — never authoritative. */
  from_address: string | null;
  from_name: string | null;
  reply_to_address: string | null;
  updated_at: string;
  activated_at: string | null;
  retired_at: string | null;
  retirement_reason: string | null;
}

export interface ChannelIdentitySummary {
  organization_id: string;
  department_id: string | null;
  channel: OmniCommsIdentityChannel;
  /** Genuine (non reference) organisation identities. */
  identities: ChannelIdentityRow[];
  /** Populated only for a configure-capable caller that asked for them. */
  reference_identities: ChannelIdentityRow[];
  reference_identity_count: number;
  generated_at: string;
}

export interface UpsertChannelIdentityInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  channel: OmniCommsIdentityChannel;
  code: string;
  displayName: string;
  identityType: OmniCommsIdentityType;
  identityConfig: ChannelIdentityConfig;
  correlationId?: string | null;
}

export interface SetChannelIdentityLifecycleInput {
  id: string;
  expectedUpdatedAt: string;
  action: OmniCommsIdentityLifecycleAction;
  /** Required for `retire`. */
  reason?: string | null;
  correlationId?: string | null;
}

/**
 * Permanent, non-negotiable operator statement. Activation is a configuration
 * approval only — it is never a provider, domain, telecom or WhatsApp
 * verification, and it never means the channel can send.
 */
export const IDENTITY_ACTIVATION_MEANING =
  'Active means the identity configuration is approved for provider binding. '
  + 'It does not mean the provider has verified the identity.';

export const REFERENCE_IDENTITY_READ_ONLY_HELP =
  'Reference identity — read-only and excluded from operational configuration.';

/** Server error slugs surfaced by the generic identity workers. */
export const IDENTITY_REFERENCE_READ_ONLY_CODE = 'reference_identity_read_only';
export const IDENTITY_REFERENCE_NON_OPERATIONAL_CODE =
  'reference_identity_non_operational';

/** The channel-specific primary value shown in the identity table. */
export function identityChannelValue(row: ChannelIdentityRow): string {
  const c = row.identity_config ?? {};
  switch (row.channel) {
    case 'email':
      return c.from_address ?? row.from_address ?? '—';
    case 'sms':
      return c.sender_value ?? '—';
    case 'whatsapp':
      return c.display_number ?? '—';
    case 'push':
    case 'in_app':
      return c.application_code ?? '—';
    case 'print':
      return c.issuing_authority ?? '—';
    default:
      return '—';
  }
}

/** Compact "key: value" summary of the remaining configuration fields. */
export function identityConfigSummary(row: ChannelIdentityRow): string {
/** Operator-facing scope label: organisation-wide or the actual department. */
export function identityScopeLabel(row: ChannelIdentityRow): string {
  if (!row.department_id) return 'Organisation-wide';
  return row.department_name?.trim() || 'Department';
}
}

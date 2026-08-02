/**
 * Omni-Comms C3B — generic channel endpoint DTOs.
 *
 * Provider-independent model for sending domains, callback definitions,
 * webhook definitions, internal realtime endpoints and print render services.
 *
 * Boundaries (permanent):
 *   - No provider SDK type is imported or modelled.
 *   - No credential VALUE is modelled; only bounded Edge secret reference
 *     NAMES (`OMNI_COMMS_*`).
 *   - No DNS record, no callback receiver, no dispatch/runtime shape.
 *   - An endpoint is NEVER represented as externally verified by this screen.
 */
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';

export type OmniCommsEndpointDataOrigin = 'system_seed' | 'user' | 'reference_seed';
export type OmniCommsEndpointStatus = 'draft' | 'active' | 'disabled' | 'retired';
export type OmniCommsEndpointVerification =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'failed';
export type OmniCommsEndpointLifecycleAction = 'activate' | 'disable' | 'retire';

/**
 * Channels that own an independent endpoint record in C3B.
 *
 * `push` is intentionally absent: its provider project belongs to Accounts and
 * its application metadata belongs to Identities, so a Push endpoint record
 * would be a meaningless duplicate.
 * `webhook` and `voice` are absent because the database `channel` values are
 * still not supported.
 */
export const OMNI_COMMS_ENDPOINT_CHANNELS = [
  'email',
  'sms',
  'whatsapp',
  'in_app',
  'print',
] as const;

export type OmniCommsEndpointChannel = (typeof OMNI_COMMS_ENDPOINT_CHANNELS)[number];

export function endpointChannelSupported(
  channel: OmniCommsChannel | string,
): channel is OmniCommsEndpointChannel {
  return (OMNI_COMMS_ENDPOINT_CHANNELS as readonly string[]).includes(channel);
}

export type OmniCommsEndpointType =
  | 'sending_domain'
  | 'event_callback'
  | 'delivery_callback'
  | 'inbound_callback'
  | 'business_webhook'
  | 'realtime_endpoint'
  | 'render_service';

/** Mirrors the server-side channel → endpoint-type mapping exactly. */
export const OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL: Record<
  OmniCommsEndpointChannel,
  readonly OmniCommsEndpointType[]
> = {
  email: ['sending_domain', 'event_callback'],
  sms: ['delivery_callback', 'inbound_callback'],
  whatsapp: ['business_webhook'],
  in_app: ['realtime_endpoint'],
  print: ['render_service'],
};

export const OMNI_COMMS_ENDPOINT_TYPE_LABEL: Record<OmniCommsEndpointType, string> = {
  sending_domain: 'Sending domain',
  event_callback: 'Event callback',
  delivery_callback: 'Delivery callback',
  inbound_callback: 'Inbound callback',
  business_webhook: 'Business webhook',
  realtime_endpoint: 'Realtime endpoint',
  render_service: 'Render service',
};

/** Allowed Email provider event types (server allowlist mirror). */
export const OMNI_COMMS_EMAIL_EVENT_TYPES = [
  'delivered',
  'delayed',
  'bounced',
  'complained',
  'failed',
] as const;

/** Allowed WhatsApp subscription fields (server allowlist mirror). */
export const OMNI_COMMS_WHATSAPP_SUBSCRIBED_FIELDS = [
  'messages',
  'message_template_status_update',
  'account_update',
] as const;

export const OMNI_COMMS_IN_APP_TRANSPORTS = ['database', 'realtime'] as const;
export const OMNI_COMMS_PRINT_SERVICE_MODES = ['internal', 'https'] as const;

/** Secret purposes accepted per endpoint type (server allowlist mirror). */
export const OMNI_COMMS_ENDPOINT_SECRET_PURPOSES: Record<
  OmniCommsEndpointType,
  readonly string[]
> = {
  sending_domain: [],
  event_callback: ['signing_secret'],
  delivery_callback: ['signature_secret'],
  inbound_callback: ['signature_secret'],
  business_webhook: ['verify_token'],
  realtime_endpoint: [],
  render_service: ['auth_token'],
};

/** Secret purposes that MUST be present before activation. */
export const OMNI_COMMS_ENDPOINT_REQUIRED_SECRETS: Record<
  OmniCommsEndpointType,
  readonly string[]
> = {
  sending_domain: [],
  event_callback: ['signing_secret'],
  delivery_callback: [],
  inbound_callback: [],
  business_webhook: ['verify_token'],
  realtime_endpoint: [],
  render_service: [],
};

/** Endpoint types that must reference a genuine external provider account. */
export function endpointRequiresProviderAccount(
  channel: OmniCommsEndpointChannel,
  endpointType: OmniCommsEndpointType,
  config: ChannelEndpointConfig,
): boolean {
  if (channel === 'email') {
    return endpointType === 'sending_domain' || endpointType === 'event_callback';
  }
  if (channel === 'sms') {
    return endpointType === 'delivery_callback' || endpointType === 'inbound_callback';
  }
  if (channel === 'whatsapp') return endpointType === 'business_webhook';
  if (channel === 'print') {
    return endpointType === 'render_service' && config.service_mode === 'https';
  }
  return false;
}

/** Bounded endpoint configuration: strings plus a small number of allowlists. */
export interface ChannelEndpointConfig {
  domain_name?: string;
  return_path_domain?: string;
  callback_url?: string;
  event_types?: string[];
  subscribed_fields?: string[];
  transport?: string;
  topic_prefix?: string;
  service_mode?: string;
  service_reference?: string;
  health_path?: string;
}

export interface ChannelEndpointSecretRef {
  purpose: string;
  /** Edge secret reference NAME only. Never a credential value. */
  secret_ref: string;
}

export interface ChannelEndpointRow {
  id: string;
  code: string;
  display_name: string;
  channel: OmniCommsEndpointChannel;
  endpoint_type: OmniCommsEndpointType;
  endpoint_config: ChannelEndpointConfig;
  provider_account_id: string | null;
  provider_account_code: string | null;
  provider_account_display_name: string | null;
  provider_account_status: string | null;
  provider_adapter_key: string | null;
  department_id: string | null;
  department_name: string | null;
  secret_refs: ChannelEndpointSecretRef[];
  status: OmniCommsEndpointStatus;
  data_origin: OmniCommsEndpointDataOrigin;
  verification_status: OmniCommsEndpointVerification;
  verification_result_code: string | null;
  verification_detail: string | null;
  verification_checked_at: string | null;
  updated_at: string;
  activated_at: string | null;
  retired_at: string | null;
  retirement_reason: string | null;
}

/** Genuine, non-retired provider accounts eligible for endpoint association. */
export interface EndpointProviderAccountOption {
  id: string;
  code: string;
  display_name: string;
  status: string;
  adapter_key: string | null;
  channel: string;
  data_origin: OmniCommsEndpointDataOrigin;
}

export interface ChannelEndpointSummary {
  organization_id: string;
  department_id: string | null;
  channel: OmniCommsEndpointChannel;
  provider_accounts: EndpointProviderAccountOption[];
  endpoints: ChannelEndpointRow[];
  reference_endpoints: ChannelEndpointRow[];
  reference_endpoint_count: number;
  generated_at: string;
}

export interface UpsertChannelEndpointInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  channel: OmniCommsEndpointChannel;
  providerAccountId?: string | null;
  code: string;
  displayName: string;
  endpointType: OmniCommsEndpointType;
  endpointConfig: ChannelEndpointConfig;
  /** purpose → Edge secret reference NAME. Never a credential value. */
  secretRefs?: Record<string, string>;
  correlationId?: string | null;
}

export interface SetChannelEndpointLifecycleInput {
  id: string;
  expectedUpdatedAt: string;
  action: OmniCommsEndpointLifecycleAction;
  reason?: string | null;
  correlationId?: string | null;
}

/** Permanent, truthful explanation of what "Active" means for an endpoint. */
export const ENDPOINT_ACTIVATION_MEANING =
  'Active means the configuration is approved. Verification remains provider- or '
  + 'service-controlled and has not been performed by this screen.';

export const REFERENCE_ENDPOINT_READ_ONLY_HELP =
  'Reference endpoint — read-only and excluded from operational configuration.';

/** Bounded Edge secret-reference name pattern (mirrors the DB constraint). */
export const OMNI_COMMS_SECRET_REF_PATTERN = /^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$/;

export function isValidEndpointSecretRef(value: string | null | undefined): boolean {
  return typeof value === 'string' && OMNI_COMMS_SECRET_REF_PATTERN.test(value.trim());
}

export function endpointScopeLabel(row: {
  department_id: string | null;
  department_name?: string | null;
}): string {
  if (!row.department_id) return 'Organisation-wide';
  return row.department_name?.trim() || 'Department';
}

/** Short, human-readable configuration digest. Never renders a secret value. */
export function endpointConfigSummary(row: ChannelEndpointRow): string {
  const cfg = row.endpoint_config ?? {};
  const parts: string[] = [];
  if (cfg.domain_name) parts.push(cfg.domain_name);
  if (cfg.return_path_domain) parts.push(`return-path ${cfg.return_path_domain}`);
  if (cfg.callback_url) parts.push(cfg.callback_url);
  if (cfg.event_types?.length) parts.push(cfg.event_types.join(', '));
  if (cfg.subscribed_fields?.length) parts.push(cfg.subscribed_fields.join(', '));
  if (cfg.transport) parts.push(`transport ${cfg.transport}`);
  if (cfg.topic_prefix) parts.push(`topic ${cfg.topic_prefix}`);
  if (cfg.service_mode) parts.push(`mode ${cfg.service_mode}`);
  if (cfg.service_reference) parts.push(cfg.service_reference);
  if (cfg.health_path) parts.push(`health ${cfg.health_path}`);
  return parts.length ? parts.join(' · ') : '—';
}

export function isReferenceEndpoint(row: {
  data_origin?: string | null;
}): boolean {
  return row.data_origin === 'reference_seed';
}

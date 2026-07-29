/**
 * Omni-Comms Accelerated Build 2 — email channel-management DTOs.
 *
 * Neutral to the browser Supabase client. Consumers pass a bound RPC client.
 */

export type ProviderStatus = 'draft' | 'active' | 'retired';
export type ProviderAccountStatus = 'draft' | 'active' | 'disabled' | 'retired';
export type HealthState = 'unknown' | 'healthy' | 'degraded' | 'failed';
export type SenderStatus = 'draft' | 'active' | 'retired';
export type BindingStatus = 'draft' | 'active' | 'retired';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'failed';
export type CredentialCheckResult = 'healthy' | 'degraded' | 'failed';

export interface EmailProviderRow {
  id: string;
  code: string;
  status: ProviderStatus;
  updated_at: string;
  activated_at: string | null;
}

export interface ProviderAccountRow {
  id: string;
  code: string;
  display_name: string;
  secret_ref: string;
  region: string | null;
  sandbox_mode: boolean;
  status: ProviderAccountStatus;
  health_state: HealthState;
  health_checked_at: string | null;
  updated_at: string;
}

export interface SenderIdentityRow {
  id: string;
  code: string;
  display_name: string;
  from_address: string | null;
  from_name: string | null;
  reply_to_address: string | null;
  status: SenderStatus;
  department_id: string | null;
  event_definition_id: string | null;
  updated_at: string;
}

export interface BindingRow {
  id: string;
  sender_identity_id: string;
  provider_account_id: string;
  priority: number;
  external_sender_ref: string | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  status: BindingStatus;
  updated_at: string;
}

export interface ChannelSettingRow {
  id: string;
  department_id: string | null;
  enabled: boolean;
  live_delivery_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
  per_minute_limit: number | null;
  updated_at: string;
}

export interface EmailConfigSummary {
  organization_id: string;
  provider: EmailProviderRow | null;
  provider_accounts: ProviderAccountRow[];
  sender_identities: SenderIdentityRow[];
  bindings: BindingRow[];
  channel_setting: ChannelSettingRow | null;
  email_send_ready: boolean;
  generated_at: string;
}

export interface UpsertProviderAccountInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  code: string;
  displayName: string;
  secretRef: string;
  region?: string | null;
  sandboxMode?: boolean;
  correlationId?: string | null;
}

export interface UpsertSenderIdentityInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  eventDefinitionId?: string | null;
  code: string;
  displayName: string;
  fromAddress: string;
  fromName?: string | null;
  replyToAddress?: string | null;
  correlationId?: string | null;
}

export interface UpsertBindingInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  senderIdentityId: string;
  providerAccountId: string;
  priority?: number | null;
  externalSenderRef?: string | null;
  correlationId?: string | null;
}

export interface UpsertChannelSettingInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  enabled: boolean;
  liveDeliveryEnabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
  perMinuteLimit?: number | null;
  correlationId?: string | null;
}

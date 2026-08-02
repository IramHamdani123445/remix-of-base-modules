/**
 * Omni-Comms C4B — generic Channel Policy types, constants and pure helpers.
 *
 * Boundaries (permanent for C4B):
 *   - Administration records only. Nothing in this module enforces a policy:
 *     no rate limiting, no quiet-hour suppression, no retry, no timeout, no
 *     retention deletion, no cost calculation, no delivery.
 *   - `live_delivery_enabled` is a legacy compatibility mirror only. Pilot and
 *     live activation are governed by a future Release Control feature.
 *   - No provider SDK, no fetch, no Supabase singleton.
 */

/** Channels supported by the database channel catalogue. */
export const POLICY_CHANNELS = [
  'email',
  'sms',
  'whatsapp',
  'push',
  'in_app',
  'print',
] as const;

export type PolicyChannel = (typeof POLICY_CHANNELS)[number];

/** Channels whose values are NOT supported by the DB channel constraint. */
export const POLICY_PLANNED_CHANNELS = ['webhook', 'voice'] as const;

export function isPolicyChannel(value: string): value is PolicyChannel {
  return (POLICY_CHANNELS as readonly string[]).includes(value);
}

// ─── Operational state ────────────────────────────────────────────────
export const OPERATIONAL_STATES = [
  'disabled',
  'configuration',
  'test_only',
  'pilot_ready',
] as const;

export type OperationalState = (typeof OPERATIONAL_STATES)[number];

export const OPERATIONAL_STATE_LABEL: Record<OperationalState, string> = {
  disabled: 'Disabled',
  configuration: 'Configuration',
  test_only: 'Test only',
  pilot_ready: 'Pilot ready',
};

export const OPERATIONAL_STATE_DESCRIPTION: Record<OperationalState, string> = {
  disabled: 'The channel is administratively disabled for this scope.',
  configuration:
    'Accounts, identities, endpoints, bindings and policies may be configured. '
    + 'No technical delivery is permitted.',
  test_only:
    'The policy is ready for a future controlled Test Centre. No test recipient '
    + 'allowlist exists and no test is sent.',
  pilot_ready:
    'Policy prerequisites have been reviewed for a future controlled pilot. This '
    + 'does not activate a pilot and does not allow live delivery.',
};

/** Permanent explanatory text shown on every policy surface. */
export const POLICY_STATE_NOTICE =
  'Policy state describes configuration intent only. Pilot and live activation '
  + 'are governed by Release Control and are not performed on this screen.';

export const RELIABILITY_NOTICE =
  'Configured for future runtime enforcement. No retry or provider timeout is '
  + 'implemented in C4B.';

export const RETENTION_NOTICE =
  'Configuration only. No records are deleted by this setting.';

export const COST_NOTICE =
  'Configuration only. No provider cost calculation is performed.';

export const REFERENCE_POLICY_NOTICE =
  'Reference policy — read-only and excluded from operational configuration.';

export const NO_BASELINE_NOTICE = 'No organisation baseline is configured.';

// ─── Retry profile ────────────────────────────────────────────────────
export const RETRY_PROFILES = ['none', 'conservative', 'standard'] as const;
export type RetryProfile = (typeof RETRY_PROFILES)[number];

export const RETRY_PROFILE_LABEL: Record<RetryProfile, string> = {
  none: 'None',
  conservative: 'Conservative',
  standard: 'Standard',
};

// ─── Effective source ─────────────────────────────────────────────────
export const EFFECTIVE_SOURCES = [
  'organisation_baseline',
  'department_override',
  'none',
] as const;
export type EffectivePolicySource = (typeof EFFECTIVE_SOURCES)[number];

export const EFFECTIVE_SOURCE_LABEL: Record<EffectivePolicySource, string> = {
  organisation_baseline: 'Organisation baseline',
  department_override: 'Department override',
  none: 'No policy configured',
};

// ─── Data origin ──────────────────────────────────────────────────────
export type PolicyDataOrigin = 'system_seed' | 'user' | 'reference_seed';

// ─── Channel-specific configuration ───────────────────────────────────
export interface EmailPolicyConfig {
  max_attachment_bytes?: number;
  allowed_attachment_extensions?: string[];
}
export interface SmsPolicyConfig {
  country_mode?: 'unrestricted' | 'allowlist' | 'denylist';
  country_codes?: string[];
  max_segments?: number;
  unicode_allowed?: boolean;
}
export interface WhatsAppPolicyConfig {
  country_mode?: 'unrestricted' | 'allowlist' | 'denylist';
  country_codes?: string[];
  max_media_bytes?: number;
  inbound_enabled?: boolean;
}
export interface PushPolicyConfig {
  max_ttl_seconds?: number;
  max_data_payload_bytes?: number;
}
export interface InAppPolicyConfig {
  expiry_hours?: number;
  acknowledgement_mode?: 'none' | 'read' | 'explicit';
  max_visible_per_user?: number;
}
export interface PrintPolicyConfig {
  max_document_bytes?: number;
  batch_size_limit?: number;
  archive_retention_days?: number;
}

export type ChannelPolicyConfig =
  | EmailPolicyConfig
  | SmsPolicyConfig
  | WhatsAppPolicyConfig
  | PushPolicyConfig
  | InAppPolicyConfig
  | PrintPolicyConfig;

export const COUNTRY_MODES = ['unrestricted', 'allowlist', 'denylist'] as const;
export const ACKNOWLEDGEMENT_MODES = ['none', 'read', 'explicit'] as const;

/** Allowed channel-specific keys, mirroring the server-side normaliser. */
export const CHANNEL_POLICY_KEYS: Record<PolicyChannel, readonly string[]> = {
  email: ['max_attachment_bytes', 'allowed_attachment_extensions'],
  sms: ['country_mode', 'country_codes', 'max_segments', 'unicode_allowed'],
  whatsapp: ['country_mode', 'country_codes', 'max_media_bytes', 'inbound_enabled'],
  push: ['max_ttl_seconds', 'max_data_payload_bytes'],
  in_app: ['expiry_hours', 'acknowledgement_mode', 'max_visible_per_user'],
  print: ['max_document_bytes', 'batch_size_limit', 'archive_retention_days'],
};

export const CHANNEL_POLICY_FIELD_LABEL: Record<string, string> = {
  max_attachment_bytes: 'Maximum attachment bytes',
  allowed_attachment_extensions: 'Allowed attachment extensions',
  country_mode: 'Country mode',
  country_codes: 'Country codes',
  max_segments: 'Maximum segments',
  unicode_allowed: 'Unicode allowed',
  max_media_bytes: 'Maximum media bytes',
  inbound_enabled: 'Inbound enabled (declaration only)',
  max_ttl_seconds: 'Maximum TTL seconds',
  max_data_payload_bytes: 'Maximum data payload bytes',
  expiry_hours: 'Expiry hours',
  acknowledgement_mode: 'Acknowledgement mode',
  max_visible_per_user: 'Maximum visible per user',
  max_document_bytes: 'Maximum document bytes',
  batch_size_limit: 'Batch size limit',
  archive_retention_days: 'Archive retention days',
};

/** Inclusive numeric bounds mirroring the server-side normaliser. */
export const CHANNEL_POLICY_BOUNDS: Record<string, readonly [number, number]> = {
  max_attachment_bytes: [0, 26214400],
  max_segments: [1, 10],
  max_media_bytes: [0, 16777216],
  max_ttl_seconds: [0, 2419200],
  max_data_payload_bytes: [0, 4096],
  expiry_hours: [1, 8760],
  max_visible_per_user: [1, 500],
  max_document_bytes: [1, 52428800],
  batch_size_limit: [1, 10000],
  archive_retention_days: [1, 3650],
};

export const COMMON_POLICY_BOUNDS = {
  per_minute_limit: [1, 100000] as const,
  per_day_limit: [1, 10000000] as const,
  max_recipients_per_request: [1, 100000] as const,
  request_timeout_seconds: [1, 300] as const,
  retention_days: [1, 3650] as const,
  daily_cost_limit_minor: [0, 1_000_000_000_000_000] as const,
  per_message_cost_limit_minor: [0, 1_000_000_000_000_000] as const,
};

// ─── Projections ──────────────────────────────────────────────────────
export interface ChannelPolicyRow {
  readonly id: string;
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly department_name: string | null;
  readonly channel: PolicyChannel;
  readonly operational_state: OperationalState;
  readonly department_override_enabled: boolean;
  /** Legacy compatibility mirror of operational_state. Never edited directly. */
  readonly enabled: boolean;
  /** Legacy compatibility flag. Always false; never used by readiness. */
  readonly live_delivery_enabled: boolean;
  readonly per_minute_limit: number | null;
  readonly per_day_limit: number | null;
  readonly max_recipients_per_request: number | null;
  readonly quiet_hours_start: string | null;
  readonly quiet_hours_end: string | null;
  readonly quiet_hours_timezone: string | null;
  readonly retry_profile: RetryProfile;
  readonly request_timeout_seconds: number | null;
  readonly retention_days: number | null;
  readonly cost_currency: string | null;
  readonly daily_cost_limit_minor: number | null;
  readonly per_message_cost_limit_minor: number | null;
  readonly channel_policy_config: Record<string, unknown>;
  readonly data_origin: PolicyDataOrigin;
  readonly created_at: string;
  readonly created_by: string | null;
  readonly updated_at: string;
  readonly updated_by: string | null;
}

export interface ChannelPolicySummary {
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly department_name: string | null;
  readonly channel: PolicyChannel;
  readonly organization_policy: ChannelPolicyRow | null;
  readonly department_policy: ChannelPolicyRow | null;
  readonly effective_policy: ChannelPolicyRow | null;
  readonly effective_source: EffectivePolicySource;
  readonly department_override_count: number;
  readonly reference_policies: readonly ChannelPolicyRow[];
  readonly hidden_reference_count: number;
  readonly can_configure: boolean;
  readonly generated_at: string;
}

/** Common policy payload accepted by the generic mutation RPC. */
export interface CommonPolicyInput {
  operational_state: OperationalState;
  department_override_enabled?: boolean;
  per_minute_limit?: number | null;
  per_day_limit?: number | null;
  max_recipients_per_request?: number | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_timezone?: string | null;
  retry_profile?: RetryProfile;
  request_timeout_seconds?: number | null;
  retention_days?: number | null;
  cost_currency?: string | null;
  daily_cost_limit_minor?: number | null;
  per_message_cost_limit_minor?: number | null;
}

export interface UpsertChannelPolicyInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  channel: PolicyChannel;
  common: CommonPolicyInput;
  channelPolicyConfig?: Record<string, unknown>;
  correlationId?: string | null;
}

// ─── Pure helpers ─────────────────────────────────────────────────────

/** Reference records are read-only and excluded from operational config. */
export function isReferencePolicy(
  policy: Pick<ChannelPolicyRow, 'data_origin'> | null | undefined,
): boolean {
  return policy?.data_origin === 'reference_seed';
}

export function policyScopeLabel(
  policy: Pick<ChannelPolicyRow, 'department_id' | 'department_name'> | null | undefined,
): string {
  if (!policy) return 'No scope';
  if (!policy.department_id) return 'Organisation';
  return policy.department_name
    ? `Department — ${policy.department_name}`
    : 'Department';
}

export function effectiveSourceLabel(source: EffectivePolicySource): string {
  return EFFECTIVE_SOURCE_LABEL[source] ?? EFFECTIVE_SOURCE_LABEL.none;
}

export function operationalStateAllowsConfiguration(
  state: OperationalState | null | undefined,
): boolean {
  return state === 'configuration' || state === 'test_only' || state === 'pilot_ready';
}

export interface CommonPolicyValidationIssue {
  readonly field: string;
  readonly message: string;
}

/**
 * Client-side display validation mirroring the server-side normaliser. The
 * server remains authoritative; this only improves the operator experience.
 */
export function validateCommonPolicy(
  input: CommonPolicyInput,
): CommonPolicyValidationIssue[] {
  const issues: CommonPolicyValidationIssue[] = [];
  const bounded = (
    field: keyof typeof COMMON_POLICY_BOUNDS,
    value: number | null | undefined,
  ) => {
    if (value === null || value === undefined) return;
    if (!Number.isInteger(value)) {
      issues.push({ field, message: 'Must be a whole number.' });
      return;
    }
    const [min, max] = COMMON_POLICY_BOUNDS[field];
    if (value < min || value > max) {
      issues.push({ field, message: `Must be between ${min} and ${max}.` });
    }
  };

  if (!OPERATIONAL_STATES.includes(input.operational_state)) {
    issues.push({ field: 'operational_state', message: 'Unsupported operational state.' });
  }
  if (input.retry_profile && !RETRY_PROFILES.includes(input.retry_profile)) {
    issues.push({ field: 'retry_profile', message: 'Unsupported retry profile.' });
  }

  bounded('per_minute_limit', input.per_minute_limit);
  bounded('per_day_limit', input.per_day_limit);
  bounded('max_recipients_per_request', input.max_recipients_per_request);
  bounded('request_timeout_seconds', input.request_timeout_seconds);
  bounded('retention_days', input.retention_days);
  bounded('daily_cost_limit_minor', input.daily_cost_limit_minor);
  bounded('per_message_cost_limit_minor', input.per_message_cost_limit_minor);

  if (
    input.per_day_limit != null
    && input.per_minute_limit != null
    && input.per_day_limit < input.per_minute_limit
  ) {
    issues.push({
      field: 'per_day_limit',
      message: 'Per-day limit must be greater than or equal to the per-minute limit.',
    });
  }

  const qs = input.quiet_hours_start || null;
  const qe = input.quiet_hours_end || null;
  if ((qs === null) !== (qe === null)) {
    issues.push({ field: 'quiet_hours', message: 'Quiet-hours start and end must both be set.' });
  } else if (qs && qe) {
    const shape = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!shape.test(qs) || !shape.test(qe)) {
      issues.push({ field: 'quiet_hours', message: 'Use HH:MM (24-hour).' });
    } else if (qs === qe) {
      issues.push({ field: 'quiet_hours', message: 'Start and end cannot be equal.' });
    }
    if (!input.quiet_hours_timezone) {
      issues.push({ field: 'quiet_hours_timezone', message: 'Timezone is required for quiet hours.' });
    }
  }

  if (input.cost_currency && !/^[A-Z]{3}$/.test(input.cost_currency)) {
    issues.push({ field: 'cost_currency', message: 'Use a three-letter uppercase code.' });
  }
  if (
    (input.daily_cost_limit_minor != null || input.per_message_cost_limit_minor != null)
    && !input.cost_currency
  ) {
    issues.push({ field: 'cost_currency', message: 'Currency is required when a cost ceiling is set.' });
  }
  if (
    input.daily_cost_limit_minor != null
    && input.per_message_cost_limit_minor != null
    && input.per_message_cost_limit_minor > input.daily_cost_limit_minor
  ) {
    issues.push({
      field: 'per_message_cost_limit_minor',
      message: 'Per-message ceiling cannot exceed the daily ceiling.',
    });
  }
  return issues;
}

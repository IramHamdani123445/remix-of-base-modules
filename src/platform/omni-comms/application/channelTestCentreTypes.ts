/**
 * Omni-Comms C5A — Channel Test Centre types.
 *
 * Boundaries (permanent):
 *   - C5A NEVER sends a message. No request, message, dispatch job or delivery
 *     attempt is created, and no provider is contacted.
 *   - Raw test targets and raw test payload content are never persisted or
 *     returned; only masked values, counts and one-way SHA-256 hashes.
 */
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';

/** Channels that support a technical configuration preflight in C5A. */
export const TEST_CENTRE_CHANNELS = [
  'email',
  'sms',
  'whatsapp',
  'push',
  'in_app',
  'print',
] as const;

export type TestCentreChannel = (typeof TEST_CENTRE_CHANNELS)[number];

export function isTestCentreChannel(
  channel: OmniCommsChannel | string,
): channel is TestCentreChannel {
  return (TEST_CENTRE_CHANNELS as readonly string[]).includes(channel);
}

/** Masked target kinds stored on the ledger. */
export type ChannelTestTargetType =
  | 'email_address'
  | 'phone_number'
  | 'whatsapp_number'
  | 'device_token'
  | 'user_reference'
  | 'recipient_reference';

export const TEST_TARGET_TYPE_BY_CHANNEL: Record<
  TestCentreChannel,
  ChannelTestTargetType
> = {
  email: 'email_address',
  sms: 'phone_number',
  whatsapp: 'whatsapp_number',
  push: 'device_token',
  in_app: 'user_reference',
  print: 'recipient_reference',
};

export const TEST_TARGET_LABEL_BY_CHANNEL: Record<TestCentreChannel, string> = {
  email: 'Test email address',
  sms: 'Test phone number (E.164)',
  whatsapp: 'Test WhatsApp number (E.164)',
  push: 'Test device token',
  in_app: 'Test user reference',
  print: 'Test recipient reference',
};

export type ChannelTestCheckStatus = 'passed' | 'failed' | 'skipped';

export type ChannelTestCheckCategory =
  | 'binding'
  | 'provider_account'
  | 'identity'
  | 'endpoint'
  | 'policy'
  | 'test_input';

export interface ChannelTestCheck {
  readonly code: string;
  readonly category: ChannelTestCheckCategory;
  readonly status: ChannelTestCheckStatus;
  readonly detail: string;
}

/**
 * The canonical 21-check preflight checklist, in evaluation order. The
 * database returns exactly these codes in exactly this order; the ledger
 * enforces the length and the UI renders them verbatim.
 */
export const CHANNEL_TEST_CHECK_CODES = [
  'binding_selected',
  'binding_active',
  'binding_not_reference',
  'binding_verified',
  'provider_account_present',
  'provider_account_active',
  'provider_account_not_reference',
  'provider_account_verified',
  'provider_credentials_complete',
  'identity_present',
  'identity_active',
  'identity_not_reference',
  'identity_configuration_complete',
  'endpoint_requirement_satisfied',
  'endpoint_active',
  'endpoint_verified',
  'policy_effective_present',
  'policy_state_allows_test',
  'policy_live_delivery_disabled',
  'test_target_valid',
  'test_payload_valid',
] as const;

export type ChannelTestCheckCode = (typeof CHANNEL_TEST_CHECK_CODES)[number];

export const CHANNEL_TEST_CHECK_COUNT = CHANNEL_TEST_CHECK_CODES.length;

/** Immutable ledger row projection (never contains a raw target or payload). */
export interface ChannelTestRun {
  readonly id: string;
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly channel: TestCentreChannel;
  readonly binding_id: string;
  readonly test_kind: 'configuration_preflight';
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly configuration_fingerprint: string;
  readonly target_type: ChannelTestTargetType;
  readonly target_masked: string;
  readonly target_hash: string;
  readonly payload_summary: Record<string, unknown>;
  readonly payload_hash: string;
  readonly status: 'passed' | 'failed';
  readonly result_code: 'preflight_passed' | 'preflight_failed';
  readonly checks: readonly ChannelTestCheck[];
  readonly blocker_codes: readonly string[];
  readonly correlation_id: string | null;
  readonly requested_by: string;
  readonly requested_at: string;
  readonly configuration_snapshot: Record<string, unknown> | null;
}

export interface ChannelTestCandidateBinding {
  readonly binding_id: string;
  readonly priority: number | null;
  readonly status: string;
  readonly verification_status: string | null;
  readonly department_id: string | null;
  readonly identity_code: string | null;
  readonly provider_account_code: string | null;
  readonly provider_id: string | null;
  readonly endpoint_code: string | null;
}

export interface ChannelTestCentreSummary {
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly channel: TestCentreChannel;
  readonly can_configure: boolean;
  readonly selected_binding_id: string | null;
  readonly candidate_bindings: readonly ChannelTestCandidateBinding[];
  readonly configuration_fingerprint: string | null;
  readonly latest_run: ChannelTestRun | null;
  readonly latest_run_is_stale: boolean;
  readonly history: readonly ChannelTestRun[];
  /** Always false. C5A performs no send of any kind. */
  readonly sends_message: false;
}

export interface RunChannelTestPreflightInput {
  readonly organizationId: string;
  readonly departmentId?: string | null;
  readonly channel: TestCentreChannel;
  readonly bindingId: string;
  /** Raw target — transmitted for validation only; never persisted. */
  readonly target: string;
  /** Temporary technical payload — only a summary and hash are persisted. */
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly correlationId?: string | null;
}

export interface RunChannelTestPreflightResult {
  readonly replayed: boolean;
  readonly run: ChannelTestRun;
}

/** A stored result is current only when it matches the live configuration. */
export function isTestRunCurrent(
  run: ChannelTestRun | null | undefined,
  configurationFingerprint: string | null | undefined,
): boolean {
  if (!run || !configurationFingerprint) return false;
  return run.configuration_fingerprint === configurationFingerprint;
}

/** Readiness gate: a current, passed preflight for the selected binding. */
export function hasCurrentPassedPreflight(
  summary: ChannelTestCentreSummary | null | undefined,
): boolean {
  if (!summary?.latest_run) return false;
  if (summary.latest_run_is_stale) return false;
  return summary.latest_run.status === 'passed';
}

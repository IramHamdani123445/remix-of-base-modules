/**
 * Omni-Comms C5A / C5A.1 — Channel Test Centre types.
 *
 * Boundaries (permanent):
 *   - C5A.1 NEVER sends a message. No request, message, dispatch job or
 *     delivery attempt is created, and no provider is contacted.
 *   - Raw test targets and raw test payload content are never persisted or
 *     returned; only masked values, counts and one-way SHA-256 hashes.
 *   - Secret-reference names are never returned to the browser; the
 *     configuration snapshot carries a one-way digest and a count only.
 */
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';

/** Channels that support a technical configuration preflight. */
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

/** C5A.1 check states. `not_implemented` can never count as a pass. */
export const CHANNEL_TEST_CHECK_STATES = [
  'passed',
  'failed',
  'warning',
  'not_applicable',
  'not_implemented',
] as const;

export type ChannelTestCheckState = (typeof CHANNEL_TEST_CHECK_STATES)[number];

export interface ChannelTestCheck {
  readonly code: string;
  readonly label: string;
  readonly state: ChannelTestCheckState;
  readonly detail: string;
}

/**
 * The canonical delivery-aware 21-check contract, in evaluation order. The
 * database returns exactly these codes in exactly this order; a CHECK
 * constraint enforces the contract and the UI renders it verbatim.
 */
export const CHANNEL_TEST_CHECK_CODES = [
  'tenant_access',
  'channel_supported',
  'effective_policy_present',
  'policy_test_state',
  'binding_selected',
  'binding_active',
  'binding_scope_valid',
  'provider_account_active',
  'provider_credentials_complete',
  'provider_credentials_verified',
  'identity_active',
  'endpoint_requirement',
  'endpoint_active',
  'binding_verification',
  'target_valid',
  'payload_valid',
  'reference_configuration',
  'live_delivery_disabled',
  'provider_dispatch',
  'delivery_callback',
  'technical_delivery_result',
] as const;

export type ChannelTestCheckCode = (typeof CHANNEL_TEST_CHECK_CODES)[number];

export const CHANNEL_TEST_CHECK_COUNT = CHANNEL_TEST_CHECK_CODES.length;

/**
 * Delivery evidence points. These remain `not_implemented` for the whole of
 * C5A.1 — they never fail a configuration preflight, and they must stay
 * visibly separate from a passed preflight.
 */
export const CHANNEL_TEST_DELIVERY_CHECK_CODES = [
  'provider_dispatch',
  'delivery_callback',
  'technical_delivery_result',
] as const;

export function isDeliveryCheckCode(code: string): boolean {
  return (CHANNEL_TEST_DELIVERY_CHECK_CODES as readonly string[]).includes(code);
}

/** Immutable ledger row projection (never contains a raw target or payload). */
export interface ChannelTestRun {
  readonly id: string;
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly channel: TestCentreChannel;
  readonly binding_id: string;
  /** C5A.1 direct evidence links — no snapshot parsing required. */
  readonly provider_account_id: string | null;
  readonly sender_identity_id: string | null;
  readonly channel_endpoint_id: string | null;
  readonly policy_id: string | null;
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
  readonly completed_at: string | null;
  readonly configuration_snapshot: Record<string, unknown> | null;
}

export interface ChannelTestCandidateBinding {
  readonly binding_id: string;
  readonly priority: number | null;
  readonly status: string;
  readonly verification_status: string | null;
  readonly department_id: string | null;
  readonly identity_code: string | null;
  readonly identity_display: string | null;
  readonly identity_status: string | null;
  readonly identity_data_origin: string | null;
  readonly provider_account_code: string | null;
  readonly provider_account_status: string | null;
  readonly provider_account_verification_status: string | null;
  readonly provider_environment: string | null;
  readonly provider_id: string | null;
  readonly endpoint_code: string | null;
  readonly endpoint_status: string | null;
  readonly endpoint_verification_status: string | null;
  readonly data_origin: string | null;
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
  /** Always false. C5A.1 performs no send of any kind. */
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

/** Copy shown whenever the server reports an idempotent replay. */
export const CHANNEL_TEST_REPLAY_NOTICE =
  'Existing immutable result returned — no duplicate preflight was created.';

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

/**
 * Candidate label used by the binding selector. Includes identity display
 * value, provider account, environment, endpoint, scope, priority/fallback
 * and lifecycle/verification warnings.
 */
export function describeCandidateBinding(
  b: ChannelTestCandidateBinding,
  departmentName?: string | null,
): string {
  const parts: string[] = [];
  parts.push(b.identity_display || b.identity_code || 'identity');
  parts.push(`via ${b.provider_account_code ?? 'provider account'}`);
  parts.push(b.provider_environment ?? 'environment unknown');
  if (b.endpoint_code) parts.push(`endpoint ${b.endpoint_code}`);
  parts.push(
    b.department_id
      ? `scope ${departmentName ?? 'department'}`
      : 'scope organisation',
  );
  parts.push(
    b.priority === null || b.priority === undefined
      ? 'no fallback priority'
      : b.priority === 1
        ? 'priority 1 (primary)'
        : `priority ${b.priority} (fallback)`,
  );

  const warnings: string[] = [];
  if (b.status !== 'active') warnings.push(`binding ${b.status}`);
  if (b.verification_status !== 'verified') {
    warnings.push(`binding ${b.verification_status ?? 'unverified'}`);
  }
  if (b.identity_status && b.identity_status !== 'active') {
    warnings.push(`identity ${b.identity_status}`);
  }
  if (b.provider_account_status && b.provider_account_status !== 'active') {
    warnings.push(`account ${b.provider_account_status}`);
  }
  if (
    b.provider_account_verification_status
    && b.provider_account_verification_status !== 'verified'
  ) {
    warnings.push(`account ${b.provider_account_verification_status}`);
  }
  if (b.endpoint_status && b.endpoint_status !== 'active') {
    warnings.push(`endpoint ${b.endpoint_status}`);
  }
  if (b.data_origin === 'reference_seed') warnings.push('reference record');

  return warnings.length > 0
    ? `${parts.join(' · ')} — ⚠ ${warnings.join(', ')}`
    : parts.join(' · ');
}

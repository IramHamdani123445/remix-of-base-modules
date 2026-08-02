/**
 * Omni-Comms — controlled channel test delivery types (Email / Resend).
 *
 * Boundaries (permanent):
 *   - This surface is a TECHNICAL TEST path. It never uses the
 *     sendCommunication façade, never creates an Omni-Comms request, message,
 *     dispatch job or delivery attempt, and never touches live delivery.
 *   - A provider is contacted only after the database has authorised the
 *     attempt: current passed configuration preflight, explicit operator
 *     approval, and an approved test recipient.
 *   - Raw credentials never reach the browser. Only the delivery evidence
 *     projection is returned.
 */
import type { ChannelTestTargetType, TestCentreChannel } from './channelTestCentreTypes';

export type ChannelTestDeliveryStatus =
  | 'pending'
  | 'dispatching'
  | 'accepted'
  | 'failed'
  | 'outcome_unknown';

/** C5B — one immutable record per provider dispatch attempt. */
export type ChannelTestDeliveryAttemptState =
  | 'claimed'
  | 'accepted'
  | 'failed'
  | 'outcome_unknown';

export interface ChannelTestDeliveryAttempt {
  readonly id: string;
  readonly attempt_number: number;
  readonly state: ChannelTestDeliveryAttemptState;
  readonly result_code: string | null;
  readonly provider_message_id: string | null;
  readonly provider_status_code: number | null;
  readonly error_code: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
}

/** Bounded number of provider attempts per delivery (database-enforced). */
export const MAX_DELIVERY_ATTEMPTS = 3;

export interface ChannelTestDeliveryEvent {
  readonly id: string;
  readonly event_type: string;
  readonly provider_event_id: string | null;
  readonly signature_verified: boolean;
  readonly occurred_at: string | null;
  readonly received_at: string;
  readonly payload_summary: Record<string, unknown>;
}

export interface ChannelTestDelivery {
  readonly id: string;
  readonly test_run_id: string;
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly channel: TestCentreChannel;
  readonly binding_id: string;
  readonly provider_code: string | null;
  readonly provider_account_id: string | null;
  readonly sender_identity_id: string | null;
  readonly channel_endpoint_id: string | null;
  readonly policy_id: string | null;
  readonly from_address: string | null;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly configuration_fingerprint: string;
  readonly target_type: ChannelTestTargetType;
  readonly target_masked: string;
  readonly payload_summary: Record<string, unknown>;
  readonly status: ChannelTestDeliveryStatus;
  readonly result_code: string | null;
  readonly provider_message_id: string | null;
  readonly provider_status_code: number | null;
  readonly provider_response: Record<string, unknown> | null;
  readonly error_code: string | null;
  readonly error_detail: string | null;
  readonly correlation_id: string | null;
  readonly requested_by: string;
  readonly requested_at: string;
  readonly completed_at: string | null;
  /** C5B — final wrapped provider content fingerprint. */
  readonly provider_payload_hash?: string | null;
  /** C5B — persistent provider idempotency key (`omni-test/<delivery id>`). */
  readonly provider_idempotency_key?: string | null;
  readonly attempt_count?: number;
  readonly attempts?: readonly ChannelTestDeliveryAttempt[];
  readonly events: readonly ChannelTestDeliveryEvent[];
}

export interface ChannelTestDeliveryDiagnostics {
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly channel: TestCentreChannel;
  readonly binding_id: string | null;
  readonly can_configure: boolean;
  /** C5B — execution requires the Omni-Comms operate capability. */
  readonly can_execute?: boolean;
  readonly controlled_test_delivery_enabled: boolean;
  readonly controlled_test_recipients: readonly string[];
  readonly controlled_test_approved_at: string | null;
  readonly controlled_test_approval_expires_at?: string | null;
  readonly controlled_test_approval_active?: boolean;
  readonly controlled_test_max_deliveries?: number;
  readonly controlled_test_min_interval_seconds?: number;
  readonly live_delivery_enabled: boolean;
  readonly policy_id: string | null;
  readonly deliveries: readonly ChannelTestDelivery[];
}

export interface ChannelTestDeliveryApproval {
  readonly policy_id: string;
  readonly controlled_test_delivery_enabled: boolean;
  readonly controlled_test_recipients: readonly string[];
  readonly controlled_test_approved_at: string | null;
  readonly live_delivery_enabled: boolean;
}

export interface RunChannelTestDeliveryInput {
  readonly testRunId: string;
  /** Raw target — validated against the preflight hash server-side. */
  readonly target: string;
  readonly idempotencyKey: string;
  readonly subject?: string;
  readonly bodyText?: string;
  readonly correlationId?: string | null;
}

export interface ChannelTestDeliveryResult {
  readonly replayed: boolean;
  readonly dispatched: boolean;
  readonly delivery: ChannelTestDelivery | null;
}

/** Maximum approved technical test recipients per scope (database-enforced). */
export const MAX_APPROVED_TEST_RECIPIENTS = 5;

/** Copy shown above every controlled delivery control. */
export const CONTROLLED_DELIVERY_NOTICE =
  'Provider test delivery sends one real technical email through the bound '
  + 'provider. It is available only to approved test recipients, only after a '
  + 'current configuration preflight has passed for the same recipient, and it '
  + 'never uses the live sending path.';

/** Delivery status wording used by the Test Centre and Diagnostics. */
export const DELIVERY_STATUS_LABEL: Record<ChannelTestDeliveryStatus, string> = {
  pending: 'Awaiting provider response',
  accepted: 'Accepted by provider',
  failed: 'Rejected or not sent',
};

export function isDeliveryAccepted(
  delivery: ChannelTestDelivery | null | undefined,
): boolean {
  return delivery?.status === 'accepted';
}

/** A delivery proves the current configuration only when it still matches it. */
export function isDeliveryCurrent(
  delivery: ChannelTestDelivery | null | undefined,
  configurationFingerprint: string | null | undefined,
): boolean {
  if (!delivery || !configurationFingerprint) return false;
  return delivery.configuration_fingerprint === configurationFingerprint;
}

/** Latest delivery for a binding, or null. */
export function latestDelivery(
  diagnostics: ChannelTestDeliveryDiagnostics | null | undefined,
  bindingId?: string | null,
): ChannelTestDelivery | null {
  const rows = diagnostics?.deliveries ?? [];
  const scoped = bindingId ? rows.filter((d) => d.binding_id === bindingId) : rows;
  return scoped.length > 0 ? scoped[0] : null;
}

/** Terminal callback outcome for a delivery, when the provider reported one. */
export function deliveryOutcome(
  delivery: ChannelTestDelivery | null | undefined,
): string | null {
  if (!delivery) return null;
  const order = ['complained', 'bounced', 'delivered', 'delayed', 'sent'];
  for (const type of order) {
    if (delivery.events.some((e) => e.event_type === type)) return type;
  }
  return null;
}

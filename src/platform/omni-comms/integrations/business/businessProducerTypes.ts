/**
 * Build 4A — Business producer integration layer: types and constants.
 *
 * Pure declarations. No Supabase client, no React, no provider SDK and no
 * Legacy Communication Hub reference. Business modules NEVER construct a
 * runtime payload themselves — they call a typed producer that delegates to
 * the single Omni-Comms façade.
 */

import type { OmniCommsChannel } from '../../sendCommunication';

/** Modes a business producer may request in Build 4A. `queued` is refused. */
export const BUSINESS_PRODUCER_MODES = ['dry_run', 'shadow'] as const;
export type BusinessProducerMode = (typeof BUSINESS_PRODUCER_MODES)[number];

/** Idempotency key prefix for every business producer emission. */
export const BUSINESS_PRODUCER_IDEMPOTENCY_PREFIX = 'omni-producer';

/** Bounded outcome the business caller may observe. */
export type BusinessProducerOutcome =
  | 'accepted'
  | 'replayed'
  | 'blocked'
  | 'unavailable';

export interface BusinessProducerRecipient {
  recipientType: string;
  recipientReference?: string | null;
  displayName?: string | null;
  locale?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface BusinessProducerEmission {
  /** Registered caller module code (see omni_comms_caller_module_registry). */
  moduleCode: string;
  /** Active Omni-Comms event code. */
  eventCode: string;
  organizationId: string;
  departmentId?: string | null;
  /** Durable business entity the emission belongs to. */
  entityType: string;
  entityId: string;
  /** Monotonic version so a corrected emission is not treated as a replay. */
  entityVersion: string;
  recipients: BusinessProducerRecipient[];
  payload: Record<string, unknown>;
  mode: BusinessProducerMode;
  requestedChannels?: OmniCommsChannel[];
  correlationId?: string | null;
}

export interface BusinessProducerResult {
  outcome: BusinessProducerOutcome;
  /** Bounded refusal codes; empty when the emission was accepted. */
  blockers: string[];
  requestId: string | null;
  idempotencyKey: string | null;
  mode: BusinessProducerMode;
  eventCode: string;
  /** Trusted producer binding that authorised the emission, when known. */
  producerEventBindingId?: string | null;
}

/**
 * Build 4A — Business producer integration layer: types and constants.
 *
 * Pure declarations. No Supabase client, no React, no provider SDK and no
 * Legacy Communication Hub reference. Business modules NEVER construct a
 * runtime payload themselves — they call a typed producer that delegates to
 * the single Omni-Comms façade.
 */

import type {
  OmniCommsChannel,
  SendCommunicationAttachmentInput,
  SendCommunicationRecipientInput,
} from '../../sendCommunication';

/**
 * Modes a business producer may request.
 *
 * `queued` is the production mode: the runtime resolves, renders and
 * persists a dispatch job. Whether that job runs is decided by the governed
 * delivery state of the channel — when delivery is ON the scheduler dispatches
 * it automatically; when delivery is OFF the job waits. A business caller
 * never authorises, releases or dispatches anything itself.
 */
export const BUSINESS_PRODUCER_MODES = ['dry_run', 'shadow', 'queued'] as const;
export type BusinessProducerMode = (typeof BUSINESS_PRODUCER_MODES)[number];

/** Idempotency key prefix for every business producer emission. */
export const BUSINESS_PRODUCER_IDEMPOTENCY_PREFIX = 'omni-producer';

/** Bounded outcome the business caller may observe. */
export type BusinessProducerOutcome =
  | 'accepted'
  | 'replayed'
  | 'blocked'
  | 'unavailable';

/**
 * Canonical persisted recipient vocabulary.
 *
 * This list mirrors the `omni_comms_recipient_recipient_type_check`
 * constraint exactly. A producer that invents its own business word (e.g.
 * `claimant`, `employer`) cannot be persisted, so the business meaning of a
 * recipient belongs in `recipientReference` / payload — never in this field.
 */
export const OMNI_COMMS_RECIPIENT_TYPES = [
  'user',
  'contact',
  'group',
  'external',
  'system',
  'synthetic_test',
] as const;
export type OmniCommsRecipientType = (typeof OMNI_COMMS_RECIPIENT_TYPES)[number];

export interface BusinessProducerRecipient {
  recipientType: OmniCommsRecipientType;
  /**
   * First-class SEMANTIC business role (`claimant`, `employer_contact`,
   * `case_owner`, …). A business role is NOT a persistence type: it is carried
   * alongside `recipientType`, never inside it, and communication policy — not
   * a template and not a provider — decides which role receives a channel.
   */
  recipientRole?: string | null;
  recipientReference?: string | null;
  displayName?: string | null;
  locale?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Physical postal destination — Print / Correspondence only. */
  postalAddress?: SendCommunicationRecipientInput['postalAddress'];
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
  /**
   * Trusted business resolution context. Used ONLY for configuration
   * resolution (product policy). It is never provider metadata and never
   * reaches a provider payload.
   */
  resolutionContext?: {
    productId?: string | null;
    recipientRoles?: string[];
  };
  /**
   * Pre-computed idempotency key. Supplied only by the configured-event
   * helper, which owns v2 business identity. Legacy producers leave this
   * unset and keep their v1 key.
   */
  idempotencyKeyOverride?: string | null;
  /**
   * Governed attachment references (DEF-3). A producer supplies ONLY ids that
   * were already registered through the governed attachment registry — never
   * bytes, paths, buckets or URLs. Channel policy decides whether each one is
   * carried, dropped, or blocks the message.
   */
  attachments?: SendCommunicationAttachmentInput[];
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

/**
 * Benefits → Omni-Comms generic business producer.
 *
 * The ONE entry point every Benefits domain uses to raise a communication.
 * It never contacts a provider, never touches a communication table and never
 * throws: it delegates to `emitBusinessCommunication()`, which delegates to
 * the single Omni-Comms façade `sendCommunication()`.
 *
 * Guarantees:
 *  - Only catalogued Email-capable Benefits events can be raised.
 *  - The emitted payload is exactly the token vocabulary of the published
 *    template, so rendering can never fail on a missing value and the
 *    published contract can never reject an unknown property.
 *  - The recipient is an EXTERNAL person; the semantic business role
 *    (claimant, beneficiary, debtor, …) travels in `recipientRole`, never in
 *    the persisted recipient type.
 */
import { emitBusinessCommunication } from '../emitBusinessCommunication';
import type {
  BusinessProducerMode,
  BusinessProducerResult,
} from '../businessProducerTypes';
import {
  benefitsTemplateEntry,
  buildBenefitsPayload,
} from './templates/benefitsTemplateRegistry';

export const BENEFITS_MODULE_CODE = 'BENEFITS';
export const BENEFITS_DEFAULT_MODE: BusinessProducerMode = 'queued';

export interface BenefitsCommunicationInput {
  /** Catalogue event code, e.g. `BENEFITS.AWARD.SUSPENSION.EXECUTED`. */
  eventCode: string;
  organizationId: string;
  departmentId?: string | null;
  /** Durable business entity, e.g. `bn_award`. */
  entityType: string;
  entityId: string;
  /** Monotonic business version so a corrected emission is not a replay. */
  entityVersion: string;
  /** Recipient display name (also rendered as the salutation). */
  subjectName: string;
  /** Human-facing business reference rendered in the letter footer. */
  reference: string;
  recipientEmail?: string | null;
  /**
   * Physical postal destination. When supplied the emission also requests the
   * Print channel; the Hub (not Benefits) decides whether a letter is actually
   * produced, from the configured route, policy and print release state.
   */
  recipientPostalAddress?: import('../../../sendCommunication').SendCommunicationRecipientInput['postalAddress'];
  locale?: string | null;
  /** Business values for the event's remaining template tokens. */
  values?: Record<string, unknown>;
  mode?: BusinessProducerMode;
  correlationId?: string | null;
}

export function buildBenefitsCorrelationId(
  eventCode: string,
  entityId: string,
): string {
  return `benefits:${eventCode.toLowerCase()}:${String(entityId ?? '').trim()}`;
}

export async function emitBenefitsCommunication(
  input: BenefitsCommunicationInput,
): Promise<BusinessProducerResult> {
  const entry = benefitsTemplateEntry(input.eventCode);
  const mode = input.mode ?? BENEFITS_DEFAULT_MODE;

  if (!entry) {
    return {
      outcome: 'blocked',
      blockers: ['benefits_event_not_catalogued'],
      requestId: null,
      idempotencyKey: null,
      mode,
      eventCode: input.eventCode,
    };
  }

  const payload = buildBenefitsPayload(input.eventCode, {
    ...(input.values ?? {}),
    subjectName: input.subjectName,
    reference: input.reference,
  });

  return emitBusinessCommunication({
    moduleCode: BENEFITS_MODULE_CODE,
    eventCode: entry.registeredEventCode,
    organizationId: input.organizationId,
    departmentId: input.departmentId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion: input.entityVersion,
    mode,
    requestedChannels: ['email'],
    correlationId:
      input.correlationId?.trim() ||
      buildBenefitsCorrelationId(entry.registeredEventCode, input.entityId),
    recipients: [
      {
        recipientType: 'external',
        recipientRole: entry.recipientRole,
        recipientReference: input.reference,
        displayName: input.subjectName,
        email: input.recipientEmail ?? null,
        locale: input.locale ?? null,
      },
    ],
    payload,
  });
}

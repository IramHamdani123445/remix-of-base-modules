/**
 * Benefits → Omni-Comms generic business producer.
 *
 * The ONE entry point every Benefits domain uses to raise a communication.
 * It never contacts a provider, never touches a communication table and never
 * throws: it delegates to `emitBusinessCommunication()`, which delegates to
 * the single Omni-Comms façade `sendCommunication()`.
 *
 * Guarantees:
 *  - Only events published by the BENEFITS BUSINESS EVENT CATALOGUE can be
 *    raised. That is a BUSINESS contract check, not an Email/template check:
 *    which channel (Email, SMS, Print, …) carries the event is decided by the
 *    Hub from the Communication Action and product configuration.
 *  - Business payload values are validated/normalised against the canonical
 *    business vocabulary. Channel-specific token validation happens in Omni
 *    rendering, after a channel option has been selected.
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
import {
  BENEFITS_COMMUNICATION_CATALOGUE,
  type BenefitsCommunicationEntry,
} from './benefitsCommunicationCatalogue';

const CATALOGUE_BY_EVENT = new Map<string, BenefitsCommunicationEntry>(
  BENEFITS_COMMUNICATION_CATALOGUE.filter((row) => row.eventCode).map((row) => [
    row.eventCode as string,
    row,
  ]),
);

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
  /**
   * Benefit Product identity. Supplied as a FACT so the Hub can apply
   * product-scoped Communication Actions. Benefits never queries
   * communication configuration with it.
   */
  productId?: string | null;
  /** Recipient display name (also rendered as the salutation). */
  subjectName: string;
  /** Human-facing business reference rendered in the letter footer. */
  reference: string;
  recipientEmail?: string | null;
  /** Mobile/telephone destination. Presence never means "send SMS". */
  recipientPhone?: string | null;
  /**
   * Physical postal destination. It is a DESTINATION, never a channel choice:
   * the Hub decides from configuration whether a letter is produced.
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
  const mode = input.mode ?? BENEFITS_DEFAULT_MODE;
  // Business contract check ONLY: is this a published Benefits business event?
  const templateEntry = benefitsTemplateEntry(input.eventCode);
  const registeredEventCode =
    templateEntry?.registeredEventCode ?? input.eventCode;
  const catalogued =
    CATALOGUE_BY_EVENT.get(registeredEventCode) ??
    CATALOGUE_BY_EVENT.get(input.eventCode) ??
    null;

  if (!catalogued && !templateEntry) {
    return {
      outcome: 'blocked',
      blockers: ['benefits_event_not_catalogued'],
      requestId: null,
      idempotencyKey: null,
      mode,
      eventCode: input.eventCode,
    };
  }

  const recipientRole =
    templateEntry?.recipientRole ?? catalogued?.recipientRoles?.[0] ?? 'claimant';

  // Existing Email parity is preserved: when the event has a published token
  // vocabulary we still normalise onto it. Otherwise the canonical business
  // facts travel as-is and Omni rendering validates per selected channel.
  const businessValues = {
    ...(input.values ?? {}),
    subjectName: input.subjectName,
    reference: input.reference,
  };
  const payload = templateEntry
    ? buildBenefitsPayload(input.eventCode, businessValues)
    : (businessValues as Record<string, unknown>);

  return emitBusinessCommunication({
    moduleCode: BENEFITS_MODULE_CODE,
    eventCode: registeredEventCode,
    organizationId: input.organizationId,
    departmentId: input.departmentId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion: input.entityVersion,
    mode,
    // Benefits ASKS; the Hub DECIDES. No channel is requested here: the
    // configured Communication Action, its channel options, the delivery
    // policy and the product configuration decide every delivery leg. A
    // postal address is supplied as a DESTINATION, never as a channel choice.

    correlationId:
      input.correlationId?.trim() ||
      buildBenefitsCorrelationId(registeredEventCode, input.entityId),
    recipients: [
      {
        recipientType: 'external',
        recipientRole,
        recipientReference: input.reference,
        displayName: input.subjectName,
        email: input.recipientEmail ?? null,
        phone: input.recipientPhone ?? null,
        postalAddress: input.recipientPostalAddress ?? null,
        locale: input.locale ?? null,
      },
    ],
    resolutionContext: {
      productId: input.productId ?? null,
      recipientRoles: [recipientRole],
    },
    payload: payload as Record<string, unknown>,
  });
}

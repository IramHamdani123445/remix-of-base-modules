/**
 * Controlled production pilot — Benefits Claim Registration / Intake
 * acknowledgement.
 *
 * This producer is the PERMANENT pattern, not an Email pilot. When a benefit
 * claim is successfully registered by the claim-intake transaction, the
 * claimant is acknowledged through the single Omni-Comms façade in `queued`
 * mode. The runtime — using the configured Communication Action, its channel
 * options, the delivery policy and any product override — decides which
 * channel(s) carry the obligation (Email, SMS, Print, …), renders the
 * corresponding published template version and persists the dispatch job(s)
 * under the governed delivery state of each channel. This producer names no
 * channel, template, sender or provider.
 *
 * SEMANTICS. Claim registration means the application has been received and
 * recorded. It is NOT an approval, award, payment or entitlement decision.
 * The acknowledgement must never imply assessment outcome.
 *
 * The producer is deliberately total: it never throws and never blocks the
 * claim-intake transaction.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
import { buildBenefitsPayload } from './benefits/templates/benefitsTemplateRegistry';

import type {
  BusinessProducerMode,
  BusinessProducerResult,
  OmniCommsRecipientType,
} from './businessProducerTypes';

/** Registered caller module code (see omni_comms_caller_module_registry). */
export const BENEFITS_CLAIM_INTAKE_MODULE_CODE = 'BENEFITS';

/** Active event raised when a benefit claim is successfully registered. */
export const BENEFITS_CLAIM_SUBMITTED_EVENT_CODE = 'BENEFITS.CLAIM.SUBMITTED';

/**
 * Production emission mode. `queued` produces dispatch job(s) on whichever
 * channels the Hub resolves. Release Control, not this producer, decides
 * eligibility for dispatch.
 */
export const BENEFITS_CLAIM_SUBMITTED_PILOT_MODE: BusinessProducerMode = 'queued';

/** Durable business entity the emission belongs to. */
export const BENEFITS_CLAIM_ENTITY_TYPE = 'bn_claim';

/**
 * Stable business identity of the emission. Registration is a
 * once-per-claim fact, so the version is a constant: repeating the business
 * action resolves to the SAME logical communication.
 *
 * v2 supersedes v1: v1 emissions were blocked at rendering because the
 * runtime renderer treated the canonical `content_body` body slot as an
 * asset slot. Bumping the version is the governed way to re-emit a corrected
 * communication without mutating an immutable blocked record.
 */
export const BENEFITS_CLAIM_SUBMITTED_ENTITY_VERSION = 'claim-submitted-v2';

/** Deterministic correlation-id prefix joining the business flow to the request. */
export const BENEFITS_CLAIM_SUBMITTED_CORRELATION_PREFIX =
  'benefits-claim-registered';

/**
 * Single deterministic recipient type.
 *
 * The claimant is a person outside the organisation, so the CANONICAL
 * persisted vocabulary value is `external`. The business meaning
 * (claimant of this claim) is carried by `recipientReference` and the
 * payload — never by inventing an unsupported recipient type.
 */
export const BENEFITS_CLAIM_SUBMITTED_RECIPIENT_TYPE: OmniCommsRecipientType =
  'external';

/** Semantic business role addressed by this event. */
export const BENEFITS_CLAIM_SUBMITTED_RECIPIENT_ROLE = 'claimant';

/**
 * Canonical payload vocabulary. Sourced from the SINGLE Benefits template
 * registry, so the producer, the published event contract and the published
 * Email template version can never drift apart. Values the intake
 * transaction does not know are filled with an explicit placeholder rather
 * than left missing (a missing token fails rendering).
 */
export type BenefitsClaimSubmittedPayload = Record<string, string>;

export interface BenefitsClaimSubmittedInput {
  organizationId: string;
  departmentId?: string | null;
  /** Durable claim identifier produced by the intake transaction. */
  claimId: string;
  /** Human-facing claim reference (claim number). */
  reference: string;
  /** Claimant display name. */
  subjectName: string;
  /** Benefit/claim type wording, e.g. the product code or product name. */
  claimType: string;
  /** Date the claim was received, already formatted for the claimant. */
  submittedOn?: string | null;
  /** Plain-language intake status, e.g. "Awaiting assessment". */
  claimStatus?: string | null;
  /** Benefit Product identity — a FACT used by the Hub for product-scoped
   *  Communication Actions. Benefits never resolves configuration with it. */
  productId?: string | null;
  contactEmail?: string | null;
  /** Mobile/telephone destination. Presence never means "send SMS". */
  contactPhone?: string | null;
  /** Postal destination. Presence never means "print"; it only makes Print
   *  technically possible when configuration/policy selects it. */
  postalAddress?: import('../../sendCommunication').SendCommunicationRecipientInput['postalAddress'];
  correlationId?: string | null;
}

export function buildBenefitsClaimSubmittedPayload(
  input: BenefitsClaimSubmittedInput,
): BenefitsClaimSubmittedPayload {
  return buildBenefitsPayload(BENEFITS_CLAIM_SUBMITTED_EVENT_CODE, {
    reference: input.reference,
    subjectName: input.subjectName,
    claimType: input.claimType,
    submittedOn: input.submittedOn,
    claimStatus: input.claimStatus,
  });
}


/**
 * Deterministic correlation identifier. Derived from the durable claim
 * identifier only, so every retry of the same business action joins the same
 * flow.
 */
export function buildBenefitsClaimSubmittedCorrelationId(claimId: string): string {
  return `${BENEFITS_CLAIM_SUBMITTED_CORRELATION_PREFIX}:${String(claimId ?? '').trim()}`;
}

export async function emitBenefitsClaimSubmitted(
  input: BenefitsClaimSubmittedInput,
): Promise<BusinessProducerResult> {
  return emitBusinessCommunication({
    moduleCode: BENEFITS_CLAIM_INTAKE_MODULE_CODE,
    eventCode: BENEFITS_CLAIM_SUBMITTED_EVENT_CODE,
    organizationId: input.organizationId,
    departmentId: input.departmentId ?? null,
    entityType: BENEFITS_CLAIM_ENTITY_TYPE,
    entityId: input.claimId,
    entityVersion: BENEFITS_CLAIM_SUBMITTED_ENTITY_VERSION,
    mode: BENEFITS_CLAIM_SUBMITTED_PILOT_MODE,
    // No channel is requested: the Hub decides every delivery leg from the
    // configured Communication Action, channel options, delivery policy and
    // product configuration. Destinations below are facts, not instructions.
    correlationId:
      input.correlationId?.trim() ||
      buildBenefitsClaimSubmittedCorrelationId(input.claimId),
    recipients: [
      {
        recipientType: BENEFITS_CLAIM_SUBMITTED_RECIPIENT_TYPE,
        recipientRole: BENEFITS_CLAIM_SUBMITTED_RECIPIENT_ROLE,
        recipientReference: input.reference,
        displayName: input.subjectName,
        email: input.contactEmail ?? null,
        phone: input.contactPhone ?? null,
        postalAddress: input.postalAddress ?? null,
      },
    ],
    resolutionContext: {
      productId: input.productId ?? null,
      recipientRoles: [BENEFITS_CLAIM_SUBMITTED_RECIPIENT_ROLE],
    },
    payload: buildBenefitsClaimSubmittedPayload(
      input,
    ) as unknown as Record<string, unknown>,
  });
}

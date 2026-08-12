/**
 * Controlled production pilot — Benefits Claim Registration / Intake
 * acknowledgement.
 *
 * This is the ONE wired pilot business producer. When a benefit claim is
 * successfully registered by the claim-intake transaction, the claimant is
 * acknowledged through the single Omni-Comms façade in `queued` mode: the
 * runtime resolves the recipient, renders the published Email template
 * version and persists a HELD dispatch job. A held job is not runnable —
 * only Release Control can later make it eligible — so no provider is
 * contacted and no email leaves the platform.
 *
 * SEMANTICS. Claim registration means the application has been received and
 * recorded. It is NOT an approval, award, payment or entitlement decision.
 * The acknowledgement must never imply assessment outcome.
 *
 * The producer is deliberately total: it never throws and never blocks the
 * claim-intake transaction.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
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
 * Pilot emission mode. `queued` produces a HELD (non-runnable) Email dispatch
 * job. Release Control, not this producer, decides eligibility for dispatch.
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
 * Single deterministic recipient type for the pilot.
 *
 * The claimant is a person outside the organisation, so the CANONICAL
 * persisted vocabulary value is `external`. The business meaning
 * (claimant of this claim) is carried by `recipientReference` and the
 * payload — never by inventing an unsupported recipient type.
 */
export const BENEFITS_CLAIM_SUBMITTED_RECIPIENT_TYPE: OmniCommsRecipientType =
  'external';

/**
 * Canonical payload vocabulary. Identical in the published event contract,
 * the published Email template version and every test.
 */
export interface BenefitsClaimSubmittedPayload {
  reference: string;
  subjectName: string;
  claimType: string;
}

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
  contactEmail?: string | null;
  correlationId?: string | null;
}

export function buildBenefitsClaimSubmittedPayload(
  input: BenefitsClaimSubmittedInput,
): BenefitsClaimSubmittedPayload {
  return {
    reference: input.reference,
    subjectName: input.subjectName,
    claimType: input.claimType,
  };
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
    requestedChannels: ['email'],
    correlationId:
      input.correlationId?.trim() ||
      buildBenefitsClaimSubmittedCorrelationId(input.claimId),
    recipients: [
      {
        recipientType: BENEFITS_CLAIM_SUBMITTED_RECIPIENT_TYPE,
        recipientReference: input.reference,
        displayName: input.subjectName,
        email: input.contactEmail ?? null,
      },
    ],
    payload: buildBenefitsClaimSubmittedPayload(
      input,
    ) as unknown as Record<string, unknown>,
  });
}

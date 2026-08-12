/**
 * Build 4A — Business producer: Employer Registration APPLICATION SUBMITTED
 * acknowledgement.
 *
 * DECOMMISSIONED AS THE CONTROLLED PRODUCTION PILOT. The queued Email pilot
 * has been switched to Benefits claim registration
 * (`benefitsClaimSubmittedProducer.ts`). This producer is back to `shadow`
 * mode: the runtime resolves and evaluates the emission but persists no
 * queued dispatch job, so it creates no held Email work and contacts no
 * provider. Its producer-event binding no longer authorises `queued`.
 *
 * IMPORTANT — semantics. Submitting an employer registration places the
 * record in `Pending`. It is NOT a completed registration. This producer
 * therefore raises the *application submitted* event, which acknowledges
 * receipt only. It must never imply approval, completion, activation or an
 * effective date. `REGISTRATION.EMPLOYER.REGISTERED` is reserved for the
 * actual completion/approval transition and must not be emitted here.
 *
 * The producer is deliberately total: it never throws and never blocks the
 * employer registration transaction.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
import type {
  BusinessProducerMode,
  BusinessProducerResult,
} from './businessProducerTypes';

/** Registered caller module code. */
export const EMPLOYER_REGISTRATION_MODULE_CODE = 'EMPLOYER_REGISTRATION';

/** Active event raised when an employer registration APPLICATION is submitted. */
export const EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE =
  'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';

/**
 * Completed-registration event. Declared here only so the boundary is
 * explicit and testable: the submission pilot must NEVER emit it.
 */
export const EMPLOYER_REGISTERED_EVENT_CODE = 'REGISTRATION.EMPLOYER.REGISTERED';

/**
 * Emission mode. `shadow` evaluates the emission without persisting any
 * dispatch job, so this producer creates no held Email work. The queued
 * controlled-production pilot now belongs to Benefits claim registration.
 */
export const EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE: BusinessProducerMode =
  'shadow';

/** Deterministic correlation-id prefix joining the business flow to the request. */
export const EMPLOYER_APPLICATION_SUBMITTED_CORRELATION_PREFIX =
  'employer-registration-application-submitted';

/**
 * Stable business identity of the emission. Application submission is a
 * once-per-registration fact, so the version is a constant: repeating the
 * business action resolves to the SAME logical communication.
 */
export const EMPLOYER_APPLICATION_SUBMITTED_ENTITY_VERSION =
  'application-submitted-v1';

/** Durable business entity the emission belongs to. */
export const EMPLOYER_REGISTRATION_ENTITY_TYPE = 'employer_registration';

/**
 * Canonical payload vocabulary. Identical in the published event contract,
 * the sample payload, the email template tokens and every test.
 */
export interface EmployerRegistrationApplicationSubmittedPayload {
  reference: string;
  subjectName: string;
  submissionStatus: string;
  submittedAt: string;
}

/** Status wording for an application that has been received, not assessed. */
export const EMPLOYER_APPLICATION_SUBMISSION_STATUS = 'Pending review';

export interface EmployerRegistrationApplicationSubmittedInput {
  organizationId: string;
  departmentId?: string | null;
  /** Permanent registration number produced by the submit RPC. */
  reference: string;
  /** Employer (legal) name. */
  subjectName: string;
  submittedAt: string;
  submissionStatus?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  correlationId?: string | null;
}

export function buildEmployerRegistrationApplicationSubmittedPayload(
  input: EmployerRegistrationApplicationSubmittedInput,
): EmployerRegistrationApplicationSubmittedPayload {
  return {
    reference: input.reference,
    subjectName: input.subjectName,
    submissionStatus:
      input.submissionStatus?.trim() || EMPLOYER_APPLICATION_SUBMISSION_STATUS,
    submittedAt: input.submittedAt,
  };
}

/**
 * Deterministic correlation identifier. Derived from the business reference
 * only, so every retry of the same business action joins the same flow.
 */
export function buildEmployerRegistrationApplicationSubmittedCorrelationId(
  reference: string,
): string {
  return `${EMPLOYER_APPLICATION_SUBMITTED_CORRELATION_PREFIX}:${String(reference ?? '').trim()}`;
}

export async function emitEmployerRegistrationApplicationSubmitted(
  input: EmployerRegistrationApplicationSubmittedInput,
): Promise<BusinessProducerResult> {
  return emitBusinessCommunication({
    moduleCode: EMPLOYER_REGISTRATION_MODULE_CODE,
    eventCode: EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE,
    organizationId: input.organizationId,
    departmentId: input.departmentId ?? null,
    entityType: EMPLOYER_REGISTRATION_ENTITY_TYPE,
    entityId: input.reference,
    entityVersion: EMPLOYER_APPLICATION_SUBMITTED_ENTITY_VERSION,
    mode: EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE,
    requestedChannels: ['email'],
    correlationId:
      input.correlationId?.trim() ||
      buildEmployerRegistrationApplicationSubmittedCorrelationId(input.reference),
    recipients: [
      {
        recipientType: EMPLOYER_REGISTRATION_RECIPIENT_TYPE,
        recipientReference: input.reference,
        displayName: input.subjectName,
        email: input.contactEmail ?? null,
        phone: input.contactPhone ?? null,
      },
    ],
    payload: buildEmployerRegistrationApplicationSubmittedPayload(
      input,
    ) as unknown as Record<string, unknown>,
  });
}

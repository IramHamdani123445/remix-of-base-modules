/**
 * Build 4A — Pilot business producer: Employer Registration submission.
 *
 * The ONE wired pilot action. Shadow mode only: the runtime resolves,
 * renders and records evidence, but no provider is contacted, no dispatch
 * job becomes runnable and no email leaves the platform.
 *
 * The producer is deliberately total: it never throws and never blocks the
 * employer registration transaction.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
import type { BusinessProducerResult } from './businessProducerTypes';

/** Registered caller module code. */
export const EMPLOYER_REGISTRATION_MODULE_CODE = 'EMPLOYER_REGISTRATION';
/** Active event raised when an employer registration is submitted. */
export const EMPLOYER_REGISTERED_EVENT_CODE = 'REGISTRATION.EMPLOYER.REGISTERED';
/** Durable business entity the emission belongs to. */
export const EMPLOYER_REGISTRATION_ENTITY_TYPE = 'employer_registration';

export interface EmployerRegistrationSubmittedInput {
  organizationId: string;
  departmentId?: string | null;
  /** Permanent registration number produced by the submit RPC. */
  registrationNumber: string;
  employerName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  submittedAt: string;
  correlationId?: string | null;
}

export async function emitEmployerRegistrationSubmitted(
  input: EmployerRegistrationSubmittedInput,
): Promise<BusinessProducerResult> {
  return emitBusinessCommunication({
    moduleCode: EMPLOYER_REGISTRATION_MODULE_CODE,
    eventCode: EMPLOYER_REGISTERED_EVENT_CODE,
    organizationId: input.organizationId,
    departmentId: input.departmentId ?? null,
    entityType: EMPLOYER_REGISTRATION_ENTITY_TYPE,
    entityId: input.registrationNumber,
    // Submission is a once-per-registration fact.
    entityVersion: 'submitted-v1',
    mode: 'shadow',
    requestedChannels: ['email'],
    correlationId: input.correlationId ?? null,
    recipients: [
      {
        recipientType: 'employer',
        recipientReference: input.registrationNumber,
        displayName: input.employerName,
        email: input.contactEmail ?? null,
        phone: input.contactPhone ?? null,
      },
    ],
    payload: {
      registration_number: input.registrationNumber,
      employer_name: input.employerName,
      submitted_at: input.submittedAt,
    },
  });
}

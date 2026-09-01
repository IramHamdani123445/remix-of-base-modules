/**
 * Wave 5 — Business producer: Legal communications.
 *
 * EVIDENCE, not invention. Three Legal communications already exist today and
 * each of them reached a person WITHOUT the Hub:
 *
 *   1. Legal asks the source department (Benefits / Compliance) for further
 *      information on a referral — `legalReferralUnifiedService`
 *      (`dispatchInfoRequestNotifications`).
 *   2. The source department responds and the Legal requester is told —
 *      `legalReferralUnifiedService` / `legalReferralCollaborationService`.
 *   3. A configured judicial event (order, appeal, enforcement, recovery,
 *      closure) notifies the assigned officers — `lgNotificationRuleEngine`.
 *
 * OWNERSHIP BOUNDARY. Omni owns ONLY the message informing a person. It does
 * not own the referral, the information request, the judicial matter, the
 * generated document or the case task — those remain owned by Legal and by
 * the document / workflow subsystems.
 *
 * Delivery authority is NOT widened: the bindings authorise `shadow` only, so
 * emitting here evaluates and records the communication but cannot dispatch
 * it until Legal is certified for live delivery.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
import { resolveBusinessCommunicationScope } from './businessScopeResolver';
import type {
  BusinessProducerMode,
  BusinessProducerRecipient,
  BusinessProducerResult,
} from './businessProducerTypes';

export const LEGAL_MODULE_CODE = 'LEGAL';

export const LEGAL_EVENT_CODES = {
  infoRequested: 'LEGAL.REFERRAL.INFO_REQUESTED',
  infoResponded: 'LEGAL.REFERRAL.INFO_RESPONDED',
  judicialEvent: 'LEGAL.JUDICIAL.EVENT_NOTIFIED',
} as const;

/** Evaluate-only until Legal is certified for live delivery. */
export const LEGAL_PRODUCER_MODE: BusinessProducerMode = 'shadow';

export interface LegalRecipientInput {
  /** Resolved authenticated user id when known. */
  userId?: string | null;
  displayName?: string | null;
  email?: string | null;
}

function toRecipient(
  recipient: LegalRecipientInput,
  role: string,
  fallbackReference: string,
): BusinessProducerRecipient {
  return {
    recipientType: recipient.userId ? 'user' : 'external',
    recipientRole: role,
    recipientReference: recipient.userId ?? fallbackReference,
    displayName: recipient.displayName ?? null,
    email: recipient.email ?? null,
  };
}

export interface LegalInfoRequestedInput {
  infoRequestId: string;
  legalReferralId: string;
  referralNo?: string | null;
  requestNo?: string | null;
  sourceModule?: string | null;
  sourceReferenceNo?: string | null;
  requestReason?: string | null;
  requestedItems?: string | null;
  dueDate?: string | null;
  responseLink?: string | null;
  recipient: LegalRecipientInput;
  organizationId?: string | null;
  departmentId?: string | null;
}

/** Legal has asked the source department for further information. */
export async function emitLegalInfoRequested(
  input: LegalInfoRequestedInput,
): Promise<BusinessProducerResult> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: LEGAL_MODULE_CODE,
    organizationId: input.organizationId ?? null,
    departmentId: input.departmentId ?? null,
  });

  return emitBusinessCommunication({
    moduleCode: LEGAL_MODULE_CODE,
    eventCode: LEGAL_EVENT_CODES.infoRequested,
    organizationId: scope.organizationId ?? '',
    departmentId: scope.departmentId,
    entityType: 'legal_referral_info_request',
    entityId: input.infoRequestId,
    entityVersion: 'legal-info-requested-v1',
    mode: LEGAL_PRODUCER_MODE,
    correlationId: `legal-info-request:${input.infoRequestId}`,
    recipients: [
      toRecipient(input.recipient, 'information_provider', input.infoRequestId),
    ],
    payload: {
      referralNo: input.referralNo ?? '',
      requestNo: input.requestNo ?? '',
      sourceModule: input.sourceModule ?? '',
      sourceReferenceNo: input.sourceReferenceNo ?? '',
      requestReason: input.requestReason ?? '',
      requestedItems: input.requestedItems ?? '',
      dueDate: input.dueDate ?? '',
      responseLink: input.responseLink ?? '',
      legalReferralId: input.legalReferralId,
    },
  });
}

export interface LegalInfoRespondedInput {
  infoRequestId: string;
  legalReferralId: string;
  referralNo?: string | null;
  sourceModule?: string | null;
  responseNotes?: string | null;
  reviewLink?: string | null;
  recipient: LegalRecipientInput;
  organizationId?: string | null;
  departmentId?: string | null;
}

/** The source department has supplied the information Legal requested. */
export async function emitLegalInfoResponded(
  input: LegalInfoRespondedInput,
): Promise<BusinessProducerResult> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: LEGAL_MODULE_CODE,
    organizationId: input.organizationId ?? null,
    departmentId: input.departmentId ?? null,
  });

  return emitBusinessCommunication({
    moduleCode: LEGAL_MODULE_CODE,
    eventCode: LEGAL_EVENT_CODES.infoResponded,
    organizationId: scope.organizationId ?? '',
    departmentId: scope.departmentId,
    entityType: 'legal_referral_info_request',
    entityId: input.infoRequestId,
    entityVersion: 'legal-info-responded-v1',
    mode: LEGAL_PRODUCER_MODE,
    correlationId: `legal-info-response:${input.infoRequestId}`,
    recipients: [
      toRecipient(input.recipient, 'legal_requester', input.infoRequestId),
    ],
    payload: {
      referralNo: input.referralNo ?? '',
      sourceModule: input.sourceModule ?? '',
      responseNotes: input.responseNotes ?? '',
      reviewLink: input.reviewLink ?? '',
      legalReferralId: input.legalReferralId,
    },
  });
}

export interface JudicialEventNoticeInput {
  /** Judicial matter the event belongs to (authoritative business record). */
  matterId: string;
  /** Legal rule-engine event code, e.g. ORDER_CREATED, APPEAL_FILED. */
  judicialEventCode: string;
  /** Business record the event was raised on (order, appeal, enforcement…). */
  sourceRecordId?: string | null;
  title: string;
  body?: string | null;
  priority?: string | null;
  link?: string | null;
  ruleId?: string | null;
  recipients: LegalRecipientInput[];
  organizationId?: string | null;
  departmentId?: string | null;
}

/**
 * A configured judicial event notifies the assigned officers.
 *
 * The rule engine keeps ownership of rule evaluation, document queueing and
 * case-task creation. Only the "inform a person" leg belongs to Omni.
 */
export async function emitJudicialEventNotice(
  input: JudicialEventNoticeInput,
): Promise<BusinessProducerResult> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: LEGAL_MODULE_CODE,
    organizationId: input.organizationId ?? null,
    departmentId: input.departmentId ?? null,
  });

  const entityId = input.sourceRecordId?.trim() || input.matterId;

  return emitBusinessCommunication({
    moduleCode: LEGAL_MODULE_CODE,
    eventCode: LEGAL_EVENT_CODES.judicialEvent,
    organizationId: scope.organizationId ?? '',
    departmentId: scope.departmentId,
    entityType: 'legal_judicial_event',
    entityId,
    // The judicial event code identifies WHICH event on the record, so a later
    // event on the same record is a new communication rather than a replay.
    entityVersion: `judicial:${input.judicialEventCode}-v1`,
    mode: LEGAL_PRODUCER_MODE,
    correlationId: `legal-judicial:${input.matterId}:${input.judicialEventCode}`,
    recipients: input.recipients.map((r) =>
      toRecipient(r, 'case_officer', entityId),
    ),
    payload: {
      judicialEventCode: input.judicialEventCode,
      matterId: input.matterId,
      title: input.title,
      body: input.body ?? '',
      priority: input.priority ?? '',
      link: input.link ?? '',
      ruleId: input.ruleId ?? '',
    },
  });
}

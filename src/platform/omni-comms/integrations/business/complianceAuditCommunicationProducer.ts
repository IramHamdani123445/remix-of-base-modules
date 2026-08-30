/**
 * Wave 5 — Business producer: Compliance employer audit / visit communications.
 *
 * EVIDENCE, not invention. `auditCommunicationService.send()` already issues an
 * APPROVED employer audit communication (`ce_audit_communications`) over email
 * and SMS. Before this producer it called the platform notification function
 * directly, which is a provider bypass: no Hub template resolution, no
 * branding, no governed delivery state and no Omni audit trail.
 *
 * OWNERSHIP BOUNDARY. Omni owns ONLY the act of informing a recipient. The
 * communication record, its approval state, its recipients, its rendered
 * snapshots and the per-recipient delivery ledger remain owned by Compliance.
 *
 * Delivery authority is NOT widened: the binding authorises `shadow` only, so
 * emitting evaluates and records the communication but cannot dispatch it
 * until Compliance is certified for live delivery.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
import { resolveBusinessCommunicationScope } from './businessScopeResolver';
import type {
  BusinessProducerMode,
  BusinessProducerResult,
} from './businessProducerTypes';
import type { OmniCommsChannel } from '../../sendCommunication';

export const COMPLIANCE_MODULE_CODE = 'COMPLIANCE';

export const COMPLIANCE_AUDIT_COMMUNICATION_EVENT_CODE =
  'COMPLIANCE.AUDIT.COMMUNICATION_ISSUED';

/** Evaluate-only until Compliance is certified for live delivery. */
export const COMPLIANCE_AUDIT_PRODUCER_MODE: BusinessProducerMode = 'shadow';

export interface AuditCommunicationRecipientInput {
  /** Compliance recipient row id — the durable business reference. */
  recipientId: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface AuditCommunicationIssuedInput {
  /** `ce_audit_communications.id` — the approved communication being issued. */
  communicationId: string;
  commType?: string | null;
  caseType?: string | null;
  subject?: string | null;
  emailBody?: string | null;
  smsBody?: string | null;
  channels: OmniCommsChannel[];
  recipients: AuditCommunicationRecipientInput[];
  organizationId?: string | null;
  departmentId?: string | null;
}

/** Issue an approved employer audit / visit communication through the Hub. */
export async function emitAuditCommunicationIssued(
  input: AuditCommunicationIssuedInput,
): Promise<BusinessProducerResult> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: COMPLIANCE_MODULE_CODE,
    organizationId: input.organizationId ?? null,
    departmentId: input.departmentId ?? null,
  });

  return emitBusinessCommunication({
    moduleCode: COMPLIANCE_MODULE_CODE,
    eventCode: COMPLIANCE_AUDIT_COMMUNICATION_EVENT_CODE,
    organizationId: scope.organizationId ?? '',
    departmentId: scope.departmentId,
    entityType: 'ce_audit_communication',
    entityId: input.communicationId,
    entityVersion: 'compliance-audit-communication-v1',
    mode: COMPLIANCE_AUDIT_PRODUCER_MODE,
    requestedChannels: input.channels,
    correlationId: `compliance-audit-communication:${input.communicationId}`,
    recipients: input.recipients.map((r) => ({
      // Employer-side contact recorded on the communication, not an
      // authenticated platform user.
      recipientType: 'contact' as const,
      recipientRole: 'employer_contact',
      recipientReference: r.recipientId,
      displayName: r.displayName ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
    })),
    payload: {
      commType: input.commType ?? '',
      caseType: input.caseType ?? '',
      subject: input.subject ?? '',
      emailBody: input.emailBody ?? '',
      smsBody: input.smsBody ?? '',
      communicationId: input.communicationId,
    },
  });
}

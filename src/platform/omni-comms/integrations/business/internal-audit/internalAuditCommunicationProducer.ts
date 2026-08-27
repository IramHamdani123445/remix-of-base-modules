/**
 * INTERNAL AUDIT → OMNI-COMMS business producer (Wave 4).
 *
 * The ONE entry point Internal Audit uses to raise a communication. It never
 * contacts a provider, never writes to a communication table, never chooses a
 * channel, template, sender or delivery mode, and never throws: a communication
 * failure can never break the audit transaction that raised it.
 *
 * Internal Audit supplies FACTS. Omni-Comms DECIDES what is sent.
 */
import {
  emitConfiguredBusinessEvent,
  type ConfiguredBusinessEventRecipient,
  type ConfiguredBusinessEventResult,
} from '../emitConfiguredBusinessEvent';
import {
  INTERNAL_AUDIT_MODULE_CODE,
  internalAuditEntry,
} from './internalAuditCommunicationCatalogue';
import {
  buildInternalAuditPayload,
  internalAuditTemplateEntry,
} from './templates/internalAuditTemplateRegistry';

export interface InternalAuditCommunicationInput {
  /** Catalogue event code, e.g. `INTERNAL_AUDIT.ACTION.ASSIGNED`. */
  eventCode: string;
  /** Durable audit entity id (engagement, plan, finding, action, …). */
  entityId: string;
  /**
   * Occurrence key. Required only when the same event can legitimately recur
   * for the same entity (reminders, escalations, re-issues). Defaults to
   * `default`, which makes the emission naturally idempotent.
   */
  occurrence?: string;
  /** Recipient display name, also used as the salutation. */
  recipientName: string;
  /** Human-facing audit reference rendered in the message. */
  reference: string;
  recipientEmail?: string | null;
  /** Recipient identity for in-app delivery, when the recipient is staff. */
  recipientUserId?: string | null;
  /** Business facts for the event's declared token vocabulary. */
  values?: Record<string, unknown>;
  organizationId?: string | null;
  departmentId?: string | null;
  correlationId?: string | null;
}

export function buildInternalAuditCorrelationId(
  eventCode: string,
  entityId: string,
): string {
  return `internal_audit:${eventCode.toLowerCase()}:${String(entityId ?? '').trim()}`;
}

/**
 * Raise an Internal Audit communication obligation.
 *
 * Every Internal Audit recipient is an INTERNAL staff member or an internal
 * auditee contact, so the persisted recipient audience is always `internal`.
 * The semantic business role (action owner, auditee contact, QA reviewer, …)
 * travels in the catalogue, never in the persisted recipient type.
 */
export async function emitInternalAuditCommunication(
  input: InternalAuditCommunicationInput,
): Promise<ConfiguredBusinessEventResult> {
  const eventCode = String(input?.eventCode ?? '').trim().toUpperCase();
  const catalogued = internalAuditEntry(eventCode);

  if (!catalogued) {
    return {
      outcome: 'blocked',
      blockers: ['internal_audit_event_not_catalogued'],
      requestId: null,
      idempotencyKey: null,
      mode: 'queued',
      eventCode,
      organizationId: null,
      departmentId: null,
      departmentSource: 'none',
      skippedReason: null,
    };
  }

  const templateEntry = internalAuditTemplateEntry(eventCode);
  const payload = buildInternalAuditPayload(eventCode, {
    ...(input.values ?? {}),
    subjectName: input.recipientName,
    reference: input.reference,
  });

  const recipient: ConfiguredBusinessEventRecipient = {
    reference: input.recipientUserId ?? input.reference,
    displayName: input.recipientName,
    email: input.recipientEmail ?? null,
    audience: 'internal',
  };

  return emitConfiguredBusinessEvent({
    eventCode,
    moduleCode: INTERNAL_AUDIT_MODULE_CODE,
    entity: {
      type: templateEntry?.entityType ?? catalogued.entityType,
      id: input.entityId,
      occurrence: input.occurrence?.trim() || 'default',
    },
    context: {
      organizationId: input.organizationId ?? null,
      departmentId: input.departmentId ?? null,
    },
    recipients: { [catalogued.recipientRole]: recipient },
    data: payload,
    correlationId:
      input.correlationId?.trim() ||
      buildInternalAuditCorrelationId(eventCode, input.entityId),
  });
}

/**
 * Build 4A — Business producer emission layer.
 *
 * The ONLY thing a business module is allowed to import (besides its own
 * typed producer) when it needs to raise a communication event.
 *
 * Guarantees:
 *  - Delegates to the single canonical façade `sendCommunication()`.
 *  - Never imports a provider SDK, never contacts a provider, never writes to
 *    any Omni-Comms or Legacy communication table.
 *  - `queued` mode is impossible from this layer (Build 4A is provider-free).
 *  - Deterministic idempotency key derived from
 *    (module, event, entity type, entity id, entity version, mode).
 *  - Never throws. Every controlled condition surfaces as a bounded
 *    `blockers[]` code on a non-accepted outcome, so a failed emission can
 *    never break the business transaction that raised it.
 */

import { sendCommunication } from '../../sendCommunication';
import {
  BUSINESS_PRODUCER_IDEMPOTENCY_PREFIX,
  BUSINESS_PRODUCER_MODES,
  type BusinessProducerEmission,
  type BusinessProducerResult,
} from './businessProducerTypes';

/** Bounded slug used inside the idempotency key. */
function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Deterministic idempotency key. Same business fact → same key → the runtime
 * replays instead of creating a second request.
 */
export function buildProducerIdempotencyKey(
  input: Pick<
    BusinessProducerEmission,
    'moduleCode' | 'eventCode' | 'entityType' | 'entityId' | 'entityVersion' | 'mode'
  >,
): string {
  return [
    BUSINESS_PRODUCER_IDEMPOTENCY_PREFIX,
    slug(input.moduleCode),
    slug(input.eventCode),
    slug(input.entityType),
    slug(input.entityId),
    slug(input.entityVersion),
    slug(input.mode),
  ].join(':');
}

/** Cheap, non-authoritative shape validation. The server re-validates. */
export function validateProducerEmission(input: BusinessProducerEmission): string[] {
  const blockers: string[] = [];
  if (!input || typeof input !== 'object') return ['invalid_input'];
  if (!input.moduleCode?.trim()) blockers.push('caller_module_required');
  if (!input.eventCode?.trim()) blockers.push('event_code_required');
  if (!input.organizationId?.trim()) blockers.push('organization_required');
  if (!input.entityType?.trim()) blockers.push('entity_type_required');
  if (!input.entityId?.trim()) blockers.push('entity_id_required');
  if (!input.entityVersion?.trim()) blockers.push('entity_version_required');
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    blockers.push('recipients_required');
  }
  if (
    !input.payload ||
    typeof input.payload !== 'object' ||
    Array.isArray(input.payload)
  ) {
    blockers.push('payload_invalid');
  }
  if (!BUSINESS_PRODUCER_MODES.includes(input.mode)) {
    blockers.push('producer_mode_not_available');
  }
  return blockers;
}

export async function emitBusinessCommunication(
  input: BusinessProducerEmission,
): Promise<BusinessProducerResult> {
  const mode = input?.mode;
  const eventCode = input?.eventCode ?? '';

  const blockers = validateProducerEmission(input);
  if (blockers.length > 0) {
    return {
      outcome: 'blocked',
      blockers,
      requestId: null,
      idempotencyKey: null,
      mode,
      eventCode,
    };
  }

  const idempotencyKey = buildProducerIdempotencyKey(input);

  try {
    const result = await sendCommunication({
      eventCode: input.eventCode.trim(),
      organizationId: input.organizationId,
      departmentId: input.departmentId ?? null,
      mode: input.mode,
      idempotencyKey,
      correlationId: input.correlationId ?? null,
      requestedChannels: input.requestedChannels,
      payload: input.payload,
      recipients: input.recipients.map((r) => ({
        recipientType: r.recipientType,
        recipientReference: r.recipientReference ?? null,
        displayName: r.displayName ?? null,
        locale: r.locale ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
      })),
      callerContext: {
        moduleCode: input.moduleCode,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });

    const outcome =
      result.status === 'blocked'
        ? 'blocked'
        : result.replayed
          ? 'replayed'
          : 'accepted';

    return {
      outcome,
      blockers: result.blockers ?? [],
      requestId: result.requestId || null,
      idempotencyKey: result.idempotencyKey || idempotencyKey,
      mode,
      eventCode,
    };
  } catch {
    // A transport-level failure must never surface to the business caller as
    // an exception, and must never be reported as an accepted emission.
    return {
      outcome: 'unavailable',
      blockers: ['runtime_unavailable'],
      requestId: null,
      idempotencyKey,
      mode,
      eventCode,
    };
  }
}

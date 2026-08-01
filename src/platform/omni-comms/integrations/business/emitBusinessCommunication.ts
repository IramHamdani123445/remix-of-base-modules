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
 *  - Deterministic, collision-resistant idempotency key: SHA-256 over the
 *    COMPLETE canonical identity string. No component is ever truncated, so
 *    two distinct business facts can never collapse onto one key.
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

/**
 * Identity components a producer key is derived from.
 *
 * The identity is COMPLETE: tenant (organisation + department), caller
 * module, event, business entity, entity version and mode. Two different
 * tenants raising the same business fact therefore produce two different
 * keys, and an organisation can never replay onto another organisation's
 * request row.
 */
export type ProducerIdentity = Pick<
  BusinessProducerEmission,
  | 'organizationId'
  | 'departmentId'
  | 'moduleCode'
  | 'eventCode'
  | 'entityType'
  | 'entityId'
  | 'entityVersion'
  | 'mode'
>;

/**
 * Canonical identity string. Every component is included in full and
 * unit-separated, so no component boundary can be forged by embedding the
 * separator in a value. A null/absent department is encoded as an empty
 * component so its position is never collapsed.
 */
export function buildProducerIdentityString(input: ProducerIdentity): string {
  return [
    input.organizationId,
    input.departmentId ?? '',
    input.moduleCode,
    input.eventCode,
    input.entityType,
    input.entityId,
    input.entityVersion,
    input.mode,
  ]
    .map((v) => String(v ?? '').trim())
    .join('\u001f');
}


function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Deterministic idempotency key: `omni-producer:<sha256 hex>`.
 *
 * Bounded at 76 characters (prefix + separator + 64 hex chars), well inside
 * the runtime's 8..200 constraint, and derived from the complete canonical
 * string rather than truncated slugs.
 */
export async function buildProducerIdempotencyKey(
  input: ProducerIdentity,
): Promise<string> {
  const bytes = new TextEncoder().encode(buildProducerIdentityString(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `${BUSINESS_PRODUCER_IDEMPOTENCY_PREFIX}:${toHex(digest)}`;
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

  let idempotencyKey: string | null = null;

  try {
    idempotencyKey = await buildProducerIdempotencyKey(input);

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
      producerEventBindingId: result.producerEventBindingId ?? null,
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

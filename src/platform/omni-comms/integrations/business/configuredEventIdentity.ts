/**
 * Omni-Comms — configured business event identity (v2).
 *
 * FINAL SEMANTICS.
 *
 * A business event identity describes A BUSINESS FACT, not a delivery
 * decision. Two emissions describing the same fact are the same obligation
 * however the platform is configured at the time.
 *
 * Included (business identity):
 *   organisation · module · event · entity type · entity id · occurrence
 *
 * DELIBERATELY EXCLUDED (configuration / resolution context):
 *   department · channel · provider · template · sender · delivery mode ·
 *   Release Control state · configuration revision
 *
 * Consequence: changing configuration NEVER turns the same business fact into
 * a new business event. An intentional re-send requires a new explicit
 * business occurrence supplied by the module.
 *
 * Legacy compatibility: v1 keys (`omni-producer:…`, which included department
 * and mode) are still produced by `emitBusinessCommunication` for existing
 * producers and are never rewritten. Already-persisted requests keep their
 * original key.
 */

export const CONFIGURED_EVENT_IDEMPOTENCY_PREFIX = 'omni-event-v2';

export interface ConfiguredEventIdentity {
  organizationId: string;
  moduleCode: string;
  eventCode: string;
  entityType: string;
  entityId: string;
  occurrence: string;
}

/** Unit-separated canonical identity string; no component is truncated. */
export function buildConfiguredEventIdentityString(
  input: ConfiguredEventIdentity,
): string {
  return [
    input.organizationId,
    input.moduleCode,
    input.eventCode,
    input.entityType,
    input.entityId,
    input.occurrence,
  ]
    .map((v) => String(v ?? '').trim())
    .join('\u001f');
}

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

export async function buildConfiguredEventIdempotencyKey(
  input: ConfiguredEventIdentity,
): Promise<string> {
  const bytes = new TextEncoder().encode(buildConfiguredEventIdentityString(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `${CONFIGURED_EVENT_IDEMPOTENCY_PREFIX}:${toHex(digest)}`;
}

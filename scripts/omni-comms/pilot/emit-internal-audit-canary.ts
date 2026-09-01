/**
 * Internal Audit controlled-pilot canary emission.
 *
 * Emits ONE catalogued Internal Audit communication through the canonical
 * Omni-Comms producer façade. No provider is contacted here: the emission only
 * creates the request/message/dispatch-job spine. Delivery remains subject to
 * the database dispatch-authorization gate and the pilot recipient allowlist.
 *
 * Usage:
 *   IA_CANARY_USER_ID=... IA_CANARY_EVENT=INTERNAL_AUDIT.ACTION.ASSIGNED \
 *   bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
 *       ./scripts/omni-comms/pilot/emit-internal-audit-canary.ts
 */
import { emitInternalAuditCommunication } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationProducer';

async function main() {
  const recipientUserId = process.env.IA_CANARY_USER_ID;
  if (!recipientUserId) throw new Error('IA_CANARY_USER_ID is required');

  const eventCode = process.env.IA_CANARY_EVENT ?? 'INTERNAL_AUDIT.ACTION.ASSIGNED';
  const occurrence = process.env.IA_CANARY_OCCURRENCE ?? new Date().toISOString();

  const outcome = await emitInternalAuditCommunication({
    eventCode,
    entityId: process.env.IA_CANARY_ENTITY_ID ?? 'ia-canary',
    occurrence,
    recipientName: process.env.IA_CANARY_NAME ?? 'Internal Audit Recipient',
    reference: process.env.IA_CANARY_REFERENCE ?? 'IA-CANARY',
    recipientUserId,
    recipientEmail: process.env.IA_CANARY_EMAIL ?? null,
    values: {
      recipientName: process.env.IA_CANARY_NAME ?? 'Internal Audit Recipient',
      reference: process.env.IA_CANARY_REFERENCE ?? 'IA-CANARY',
    },
  });

  console.log(JSON.stringify(outcome, null, 2));
}

main().catch((e) => {
  console.error('IA_CANARY_FAILED', e?.message ?? e);
  process.exit(1);
});

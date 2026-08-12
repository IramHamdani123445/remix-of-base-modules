/**
 * Omni-Comms Benefits controlled pilot — acknowledgement re-emission runner.
 *
 * Re-runs the EXACT acknowledgement step of the canonical Benefits
 * claim-intake transaction (`emitClaimRegisteredAcknowledgement`) for an
 * already-registered claim, without creating a second claim.
 *
 * The emission is deterministic and idempotent, so it can only ever resolve
 * to ONE logical communication for that claim. It runs in `queued` mode,
 * which persists a HELD (non-runnable) Email dispatch job: no provider is
 * contacted and no email is sent.
 *
 * Usage:
 *   PILOT_CLAIM_ID=... PILOT_CLAIM_NUMBER=... PILOT_PRODUCT_CODE=... \
 *   bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
 *       ./scripts/omni-comms/pilot/reemit-benefits-claim-ack.ts
 */
import { emitClaimRegisteredAcknowledgement } from '@/services/bn/intake/claimIntakeService';

async function main() {
  const claimId = process.env.PILOT_CLAIM_ID;
  const claimNumber = process.env.PILOT_CLAIM_NUMBER;
  const productCode = process.env.PILOT_PRODUCT_CODE ?? 'SKN-EI-MED';
  const contactEmail = process.env.PILOT_CONTACT_EMAIL ?? null;
  if (!claimId || !claimNumber) {
    throw new Error('PILOT_CLAIM_ID and PILOT_CLAIM_NUMBER are required');
  }

  const outcome = await emitClaimRegisteredAcknowledgement({
    claimId,
    claimNumber,
    productCode,
    formPayload: contactEmail ? { contact_email: contactEmail } : {},
  });

  console.log(JSON.stringify(outcome, null, 2));
}

main().catch((e) => {
  console.error('PILOT_REEMIT_FAILED', e?.message ?? e);
  process.exit(1);
});

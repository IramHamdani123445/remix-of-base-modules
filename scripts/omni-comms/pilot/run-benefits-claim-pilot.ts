/**
 * Omni-Comms Benefits controlled pilot — business producer proof runner.
 *
 * Registers EXACTLY ONE benefit claim through the canonical Benefits
 * claim-intake transaction (`submitClaimApplication`) so the deployed
 * Omni-Comms producer (`benefitsClaimSubmittedProducer`) runs unmodified.
 *
 * The producer emits in `queued` mode, which persists a HELD (non-runnable)
 * Email dispatch job. This runner NEVER invokes `omni-comms-dispatch`,
 * never contacts Resend and never sends an email.
 *
 * Usage:
 *   bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
 *       ./scripts/omni-comms/pilot/run-benefits-claim-pilot.ts
 */
import { submitClaimApplication } from '@/services/bn/intake/claimIntakeService';

const SSN = process.env.PILOT_SSN ?? '950004';
const PRODUCT_CODE = process.env.PILOT_PRODUCT_CODE ?? 'SKN-EI-MED';
const CONTACT_EMAIL = process.env.PILOT_CONTACT_EMAIL ?? 'rohit@mishainfotech.com';
const CHANNEL = 'STAFF_OFFLINE' as const;

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const result = await submitClaimApplication({
    ssn: SSN,
    productCode: PRODUCT_CODE,
    claimDate: today,
    channel: CHANNEL,
    formPayload: {
      contact_email: CONTACT_EMAIL,
      identity_verified: true,
      otp_verified: true,
      uploaded_document_codes: [],
      pilot_note: 'Omni-Comms controlled Benefits pilot — claim registration only',
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('PILOT_RUNNER_FAILED', e?.message ?? e, e?.details ?? '', e?.hint ?? '');
  process.exit(1);
});

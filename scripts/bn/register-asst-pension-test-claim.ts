/**
 * ASST_PENSION verification runner.
 *
 * Registers ONE Assistance Pension claim for an over-64 applicant through the
 * canonical Benefits intake transaction (`submitClaimApplication`), so every
 * real guard runs: readiness gate, product/version resolution, channel config,
 * workflow resolution and workbasket routing.
 *
 * Usage:
 *   bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
 *       ./scripts/bn/register-asst-pension-test-claim.ts
 */
import { submitClaimApplication } from '@/services/bn/intake/claimIntakeService';

const SSN = process.env.TEST_SSN ?? '900012';
const PRODUCT_CODE = process.env.TEST_PRODUCT_CODE ?? 'ASST_PENSION';

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const result = await submitClaimApplication({
    ssn: SSN,
    productCode: PRODUCT_CODE,
    claimDate: today,
    channel: 'STAFF_OFFLINE',
    formPayload: {
      contact_email: 'ncptest@mishainfotech.com',
      identity_verified: true,
      otp_verified: true,
      uploaded_document_codes: [],
      test_note: 'ASST_PENSION workflow routing verification',
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(
    'CLAIM_REGISTRATION_FAILED',
    e?.message ?? e,
    JSON.stringify(e?.readiness ?? e?.details ?? null),
    e?.hint ?? '',
  );
  process.exit(1);
});

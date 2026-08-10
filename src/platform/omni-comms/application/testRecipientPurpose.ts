/**
 * Omni-Comms — bounded approved-test-recipient purpose model.
 *
 * The database constrains `omni_comms_test_recipient.purpose` to exactly three
 * canonical values. This module is the single client-side source of that
 * vocabulary so an arbitrary string can never be submitted, and so the Test &
 * Verify screen never has to invent schema terminology of its own.
 *
 * Boundaries: pure constants and a type guard. No I/O, no provider contact.
 */

export const OMNI_COMMS_TEST_RECIPIENT_PURPOSES = [
  'controlled_pilot',
  'internal_test',
  'certification',
] as const;

export type TestRecipientPurpose =
  (typeof OMNI_COMMS_TEST_RECIPIENT_PURPOSES)[number];

/**
 * The canonical purpose used by the Test & Verify approved-recipient screen.
 * The operator never chooses it; the screen collects a name and an address.
 */
export const TEST_VERIFY_RECIPIENT_PURPOSE: TestRecipientPurpose = 'internal_test';

export function isTestRecipientPurpose(
  value: unknown,
): value is TestRecipientPurpose {
  return (
    typeof value === 'string'
    && (OMNI_COMMS_TEST_RECIPIENT_PURPOSES as readonly string[]).includes(value)
  );
}

export const TEST_RECIPIENT_PURPOSE_LABELS: Record<TestRecipientPurpose, string> = {
  controlled_pilot: 'Controlled pilot',
  internal_test: 'Internal test',
  certification: 'Certification',
};

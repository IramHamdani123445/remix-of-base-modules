/**
 * Build 4A — Employer Registration pilot contract vocabulary.
 *
 * ONE declaration of the pilot's payload vocabulary, shared by:
 *  - the published event contract (`omni_comms_event_contract`),
 *  - the sample payload,
 *  - the producer TypeScript input and emitted payload,
 *  - the published email template tokens,
 *  - the dry-run and shadow tests.
 *
 * The database copies are asserted against these constants by
 * `scripts/omni-comms/verify-build4a-producer.sql`, so drift fails loudly.
 *
 * Pure data. No client, no provider, no Legacy reference.
 */

export const EMPLOYER_APPLICATION_SUBMITTED_CONTRACT_VERSION = 1;

export const EMPLOYER_APPLICATION_SUBMITTED_FIELDS = [
  'reference',
  'subjectName',
  'submissionStatus',
  'submittedAt',
] as const;

export const EMPLOYER_APPLICATION_SUBMITTED_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [...EMPLOYER_APPLICATION_SUBMITTED_FIELDS],
  properties: {
    reference: { type: 'string', maxLength: 64 },
    subjectName: { type: 'string', maxLength: 160 },
    submissionStatus: { type: 'string', maxLength: 64 },
    submittedAt: { type: 'string', maxLength: 40 },
  },
} as const;

export const EMPLOYER_APPLICATION_SUBMITTED_SAMPLE = {
  reference: 'ER-004512',
  subjectName: 'Frigate Bay Retail Ltd',
  submissionStatus: 'Pending review',
  submittedAt: '2026-08-01T08:00:00.000Z',
} as const;

/**
 * The exact published email content. Receipt-only wording: it must never
 * state or imply approval, completion, activation or an effective date.
 */
export const EMPLOYER_APPLICATION_SUBMITTED_EMAIL_CONTENT = {
  subject:
    'Application received - employer registration {{payload.reference}}',
  html:
    '<p>{{payload.subjectName}},</p><p>We have received your employer registration application. Reference <strong>{{payload.reference}}</strong>, submitted on {{payload.submittedAt}}.</p><p>Current status: {{payload.submissionStatus}}. This message confirms receipt of your application only. Your application has not been assessed, no registration decision has been made, and no effective date has been set.</p><p>Social Security Board</p>',
  text:
    '{{payload.subjectName}}: we have received your employer registration application {{payload.reference}}, submitted on {{payload.submittedAt}}. Current status: {{payload.submissionStatus}}. This confirms receipt of your application only; it has not been assessed, no decision has been made and no effective date has been set.',
} as const;

/** Wording that would misrepresent a pending application as a decided one. */
export const EMPLOYER_APPLICATION_FORBIDDEN_PHRASES = [
  'approved',
  'registration is complete',
  'registration complete',
  'now active',
  'is active',
  'effective date has been established',
  'effective date is',
] as const;

export const EMPLOYER_APPLICATION_SUBMITTED_TEMPLATE_FAMILY_CODE =
  'pilot_registration_employer_application_submitted';

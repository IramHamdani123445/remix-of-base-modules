/**
 * Omni-Comms — business event vocabulary for operators.
 *
 * Normal administrators read "Claim submitted", not
 * `BENEFITS.CLAIM.SUBMITTED`. The event CODE remains the canonical identifier
 * everywhere in the platform; this module only supplies the friendly label.
 *
 * Pure metadata: no React, no RPC, no provider SDK, no send behaviour.
 */

const EXPLICIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  'BENEFITS.CLAIM.SUBMITTED': 'Claim submitted',
  'BENEFITS.CLAIM.APPROVED': 'Claim approved',
  'BENEFITS.CLAIM.REJECTED': 'Claim rejected',
  'BENEFITS.CLAIM.ACKNOWLEDGED': 'Claim acknowledged',
  'EMPLOYER.REGISTRATION.SUBMITTED': 'Employer registration submitted',
};

const humanise = (segment: string): string => {
  const words = segment.replace(/_/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Friendly label for a business event code. Unknown codes degrade to the last
 * two segments in sentence case, never to a raw dotted code.
 */
export function businessEventLabel(code: string | null | undefined): string {
  const raw = (code ?? '').trim();
  if (!raw) return 'Business event';
  const explicit = EXPLICIT_EVENT_LABELS[raw.toUpperCase()];
  if (explicit) return explicit;
  const parts = raw.split('.').filter(Boolean);
  if (parts.length <= 1) return humanise(raw);
  const tail = parts.slice(-2);
  return `${humanise(tail[0])} ${tail[1].replace(/_/g, ' ').toLowerCase()}`;
}

/** Friendly description of who receives the message for an event. */
export const RECIPIENT_SOURCE_LABEL: Readonly<Record<string, string>> = {
  claimant: 'Claimant',
  beneficiary: 'Beneficiary',
  employer: 'Employer',
  insured_person: 'Insured person',
  business_transaction: 'Business transaction contact',
};

export function recipientSourceLabel(source: string | null | undefined): string {
  const key = (source ?? '').trim().toLowerCase();
  if (!key) return 'Business transaction contact';
  return RECIPIENT_SOURCE_LABEL[key] ?? humanise(key);
}

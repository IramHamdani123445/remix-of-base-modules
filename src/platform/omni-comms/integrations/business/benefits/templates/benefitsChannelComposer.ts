/**
 * Benefits → Omni-Comms non-email channel composers.
 *
 * The SAME structured specification that produces the Email letter also
 * produces genuinely channel-native variants:
 *
 *  - print    → a formal A4 letter (date line, postal address block,
 *               reference, salutation, body, details, next steps, sign-off).
 *  - sms      → one short transactional line, hard-capped.
 *  - whatsapp → a short structured message using WhatsApp text formatting.
 *
 * Print is NEVER "the email printed": it carries a postal address block, a
 * letter reference line and a wet-signature block, and it drops all email
 * chrome (preheader, HTML buttons, unsubscribe-style footers).
 *
 * Pure functions. No Supabase client, no React, no provider SDK.
 *
 * Token grammar: `{{payload.x}}` for business values (required) and
 * `{{recipient.x?}}` for postal/display context supplied by the runtime
 * recipient snapshot (optional — never blocks a message).
 */
import type { BenefitsEmailSpec } from './benefitsEmailComposer';

export interface ComposedPrintLetter {
  subject: string;
  text: string;
  html: string;
}
export interface ComposedShortMessage {
  body: string;
}

/** Hard caps enforced by the composers (and asserted by tests). */
export const BENEFITS_SMS_MAX_CHARS = 320;
export const BENEFITS_WHATSAPP_MAX_CHARS = 1000;

const SIGN_OFF_NAME = 'Social Security Board';
const SIGN_OFF_PLACE = 'St. Kitts and Nevis';
const PRINT_CONTACT_LINE =
  'If you have a question about this letter, contact the Social Security Board and quote the reference above.';

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes narrative copy while preserving `{{...}}` tokens verbatim. */
function escKeepTokens(value: string): string {
  return value
    .split(/(\{\{\s*[A-Za-z0-9_.]+\??\s*\}\})/g)
    .map((part) => (part.startsWith('{{') ? part : esc(part)))
    .join('');
}

/** Removes token syntax so a sentence can be length-budgeted deterministically. */
function stripTokens(value: string): string {
  return value.replace(/\{\{\s*[A-Za-z0-9_.]+\??\s*\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Truncates on a word boundary, never mid-token. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

// ── Print / correspondence ──────────────────────────────────────────────────

/**
 * Formal letter variant. The postal address block is filled from the
 * recipient snapshot (`recipient.print` is the canonical newline-joined
 * postal address) and therefore adds no required payload token.
 */
export function composeBenefitsPrintLetter(spec: BenefitsEmailSpec): ComposedPrintLetter {
  const addressLinesText = [
    '{{recipient.display_name?}}',
    '{{recipient.print?}}',
  ].join('\n');

  const detailsText = spec.details
    .map((d) => `  ${d.label}: {{payload.${d.token}}}`)
    .join('\n');
  const nextStepsText = spec.nextSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');

  const text = [
    `${SIGN_OFF_NAME}`,
    `${SIGN_OFF_PLACE}`,
    '',
    addressLinesText,
    '',
    'Our reference: {{payload.reference}}',
    '',
    `Dear {{payload.subjectName}},`,
    '',
    spec.headline.toUpperCase(),
    '',
    ...spec.intro,
    '',
    detailsText,
    ...(spec.notice ? ['', spec.notice] : []),
    '',
    'What happens next',
    nextStepsText,
    '',
    spec.closing ?? 'Thank you for your co-operation.',
    '',
    'Yours faithfully,',
    '',
    '',
    'Director',
    `${SIGN_OFF_NAME}, ${SIGN_OFF_PLACE}`,
    '',
    PRINT_CONTACT_LINE,
  ].join('\n');

  const detailRowsHtml = spec.details
    .map(
      (d) =>
        `<tr><td style="padding:4px 16px 4px 0;font-size:11pt;color:#333;vertical-align:top;">${esc(
          d.label,
        )}</td><td style="padding:4px 0;font-size:11pt;font-weight:600;color:#000;">{{payload.${d.token}}}</td></tr>`,
    )
    .join('');
  const nextStepsHtml = spec.nextSteps
    .map((s) => `<li style="margin:0 0 4pt 0;font-size:11pt;line-height:16pt;">${escKeepTokens(s)}</li>`)
    .join('');
  const introHtml = spec.intro
    .map((p) => `<p style="margin:0 0 10pt 0;font-size:11pt;line-height:16pt;">${escKeepTokens(p)}</p>`)
    .join('');
  const noticeHtml = spec.notice
    ? `<p style="margin:10pt 0;padding:8pt 10pt;border:1pt solid #000;font-size:10.5pt;line-height:15pt;">${escKeepTokens(
        spec.notice,
      )}</p>`
    : '';

  const html = `<section style="font-family:Georgia,'Times New Roman',serif;color:#000;">
<div style="margin:0 0 18pt 0;font-size:11pt;line-height:15pt;">
<div>{{recipient.display_name?}}</div>
<div style="white-space:pre-line;">{{recipient.print?}}</div>
</div>
<p style="margin:0 0 12pt 0;font-size:10.5pt;">Our reference: <strong>{{payload.reference}}</strong></p>
<p style="margin:0 0 10pt 0;font-size:11pt;">Dear {{payload.subjectName}},</p>
<h1 style="margin:0 0 12pt 0;font-size:13pt;text-transform:uppercase;letter-spacing:0.5pt;">${escKeepTokens(
    spec.headline,
  )}</h1>
${introHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12pt 0;border-collapse:collapse;">
<tbody>${detailRowsHtml}</tbody>
</table>
${noticeHtml}
<h2 style="margin:14pt 0 6pt 0;font-size:11.5pt;">What happens next</h2>
<ol style="margin:0 0 12pt 18pt;padding:0;">${nextStepsHtml}</ol>
<p style="margin:12pt 0 0 0;font-size:11pt;line-height:16pt;">${escKeepTokens(
    spec.closing ?? 'Thank you for your co-operation.',
  )}</p>
<p style="margin:18pt 0 0 0;font-size:11pt;">Yours faithfully,</p>
<div style="height:42pt;"></div>
<p style="margin:0;font-size:11pt;">Director<br />${esc(SIGN_OFF_NAME)}, ${esc(SIGN_OFF_PLACE)}</p>
<p style="margin:18pt 0 0 0;font-size:9.5pt;color:#333;">${esc(PRINT_CONTACT_LINE)}</p>
</section>`;

  return { subject: stripTokens(spec.name) || spec.name, text, html };
}

// ── SMS ─────────────────────────────────────────────────────────────────────

/**
 * One transactional line. Deterministic and short: headline, reference and
 * the single most important next action.
 */
export function composeBenefitsSms(spec: BenefitsEmailSpec): ComposedShortMessage {
  const head = sentence(stripTokens(spec.headline));
  const action = sentence(stripTokens(spec.nextSteps[0] ?? ''));
  const prefix = 'SSB: ';
  const refPart = ' Ref {{payload.reference}}.';
  const budget = BENEFITS_SMS_MAX_CHARS - prefix.length - refPart.length;

  let body = head;
  if (action && body.length + 1 + action.length <= budget) body = `${body} ${action}`;
  body = clip(body, budget);

  return { body: `${prefix}${body}${refPart}` };
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

/**
 * Short structured message using WhatsApp text formatting (*bold*).
 * Details are limited to the first three labelled values so the message stays
 * readable on a phone.
 */
export function composeBenefitsWhatsApp(spec: BenefitsEmailSpec): ComposedShortMessage {
  const details = spec.details
    .slice(0, 3)
    .map((d) => `• ${d.label}: {{payload.${d.token}}}`)
    .join('\n');
  const intro = sentence(stripTokens(spec.intro[0] ?? ''));
  const nextStep = sentence(stripTokens(spec.nextSteps[0] ?? ''));

  const parts = [
    `*${stripTokens(spec.headline)}*`,
    '',
    'Dear {{payload.subjectName}},',
    clip(intro, 320),
    '',
    details,
    '',
    nextStep ? `*What happens next:* ${clip(nextStep, 200)}` : '',
    '',
    `Ref {{payload.reference}} — ${SIGN_OFF_NAME}, ${SIGN_OFF_PLACE}.`,
  ].filter((line, index, all) => !(line === '' && all[index - 1] === ''));

  const body = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body: clip(body, BENEFITS_WHATSAPP_MAX_CHARS) };
}

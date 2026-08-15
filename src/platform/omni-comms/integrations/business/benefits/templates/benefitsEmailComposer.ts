/**
 * Benefits → Omni-Comms email content composer.
 *
 * Pure functions. No Supabase client, no React, no provider SDK.
 *
 * Every Benefits email is composed from ONE structured specification so that
 * all 60+ Benefits communications share the same professional anatomy:
 * headline, salutation, purpose paragraphs, a labelled detail table, an
 * explicit "what happens next" list, an optional statutory/notice block, a
 * closing and a reference footer. Templates are therefore complete letters —
 * never one-line stubs — and remain machine-checkable.
 *
 * Token grammar: every dynamic value is a runtime payload token written as
 * `{{payload.<name>}}`. No other namespace is emitted here.
 */

export type BenefitsEmailPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface BenefitsEmailDetail {
  label: string;
  /** Payload token name (without the `payload.` prefix). */
  token: string;
}

export interface BenefitsEmailSpec {
  /** Catalogue event code (may contain 4 segments). */
  eventCode: string;
  /** Template family identity from the Benefits catalogue. */
  templateFamily: string;
  /** Semantic recipient role this letter addresses. */
  recipientRole: string;
  /** Short administrative name for the event registry. */
  name: string;
  /** Registry description (why this communication exists). */
  description: string;
  communicationClass:
    | 'transactional'
    | 'service'
    | 'security'
    | 'legal_mandatory'
    | 'operational';
  priority: BenefitsEmailPriority;
  subject: string;
  preheader: string;
  headline: string;
  /** Purpose paragraphs, in order. */
  intro: string[];
  details: BenefitsEmailDetail[];
  nextSteps: string[];
  /** Optional statutory / rights / deadline block rendered as a callout. */
  notice?: string;
  closing?: string;
  /** Extra payload tokens that are required but not referenced in details. */
  extraTokens?: string[];
}

export interface ComposedBenefitsEmail {
  subject: string;
  text: string;
  html: string;
}

const SIGN_OFF = 'Social Security Board, St. Kitts and Nevis';
const CONTACT_LINE =
  'If you have a question about this message, contact the Social Security Board and quote your reference number.';

const TOKEN_RE = /\{\{\s*payload\.([A-Za-z0-9_]+)\s*\}\}/g;

/** Standard tokens present in every Benefits letter. */
export const BENEFITS_BASE_TOKENS = ['recipientName', 'reference'] as const;

export function tokensInText(...parts: string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(part)) !== null) found.add(m[1]);
  }
  return [...found];
}

/** Complete, de-duplicated, ordered token list a spec depends on. */
export function specTokens(spec: BenefitsEmailSpec): string[] {
  const composed = composeBenefitsEmail(spec);
  const tokens = new Set<string>([
    ...BENEFITS_BASE_TOKENS,
    ...spec.details.map((d) => d.token),
    ...(spec.extraTokens ?? []),
    ...tokensInText(composed.subject, composed.text, composed.html),
  ]);
  return [...tokens].sort();
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes narrative copy while preserving `{{payload.x}}` tokens verbatim so
 * the runtime renderer can still resolve them.
 */
function escKeepTokens(value: string): string {
  return value
    .split(/(\{\{\s*payload\.[A-Za-z0-9_]+\s*\}\})/g)
    .map((part) => (part.startsWith('{{') ? part : esc(part)))
    .join('');
}

export function composeBenefitsEmail(spec: BenefitsEmailSpec): ComposedBenefitsEmail {
  const detailRowsHtml = spec.details
    .map(
      (d) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#4b5563;font-size:14px;vertical-align:top;white-space:nowrap;">${esc(
          d.label,
        )}</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">{{payload.${d.token}}}</td></tr>`,
    )
    .join('');

  const nextStepsHtml = spec.nextSteps
    .map(
      (s) =>
        `<li style="margin:0 0 6px 0;color:#374151;font-size:14px;line-height:22px;">${escKeepTokens(
          s,
        )}</li>`,
    )
    .join('');

  const introHtml = spec.intro
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;color:#374151;font-size:15px;line-height:24px;">${escKeepTokens(
          p,
        )}</p>`,
    )
    .join('');

  const noticeHtml = spec.notice
    ? `<div style="margin:20px 0;padding:14px 16px;background:#f8fafc;border-left:4px solid #0f766e;">
<p style="margin:0;color:#0f172a;font-size:14px;line-height:22px;">${escKeepTokens(
        spec.notice,
      )}</p>
</div>`
    : '';

  const html = `<h2 style="margin:0 0 6px 0;color:#0f172a;font-size:20px;line-height:28px;">${escKeepTokens(
    spec.headline,
  )}</h2>
<p style="margin:0 0 18px 0;color:#6b7280;font-size:13px;line-height:20px;">${escKeepTokens(
    spec.preheader,
  )}</p>
<p style="margin:0 0 14px 0;color:#111827;font-size:15px;line-height:24px;">Dear {{payload.recipientName}},</p>
${introHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;border-collapse:collapse;">
<tbody>${detailRowsHtml}</tbody>
</table>
${noticeHtml}
<h3 style="margin:22px 0 8px 0;color:#0f172a;font-size:15px;line-height:22px;">What happens next</h3>
<ol style="margin:0 0 16px 20px;padding:0;">${nextStepsHtml}</ol>
<p style="margin:18px 0 6px 0;color:#374151;font-size:15px;line-height:24px;">${escKeepTokens(
    spec.closing ?? 'Thank you for your co-operation.',
  )}</p>
<p style="margin:0 0 18px 0;color:#111827;font-size:15px;line-height:24px;">${esc(SIGN_OFF)}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
<p style="margin:0;color:#6b7280;font-size:12px;line-height:20px;">Reference {{payload.reference}}. ${esc(
    CONTACT_LINE,
  )}</p>`;

  const detailRowsText = spec.details
    .map((d) => `  ${d.label}: {{payload.${d.token}}}`)
    .join('\n');
  const nextStepsText = spec.nextSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');

  const text = [
    spec.headline,
    '',
    `Dear {{payload.recipientName}},`,
    '',
    ...spec.intro,
    '',
    detailRowsText,
    ...(spec.notice ? ['', spec.notice] : []),
    '',
    'What happens next',
    nextStepsText,
    '',
    spec.closing ?? 'Thank you for your co-operation.',
    SIGN_OFF,
    '',
    `Reference {{payload.reference}}. ${CONTACT_LINE}`,
  ].join('\n');

  return { subject: spec.subject, text, html };
}

/**
 * Registered platform event code.
 *
 * The event registry accepts exactly three segments
 * (`MODULE.ENTITY.EVENT`). Catalogue codes may carry a sub-domain
 * (`BENEFITS.CLAIM.EVIDENCE.REQUESTED`); the sub-domain is folded into the
 * event segment with an underscore so no business meaning is lost.
 */
export function registeredEventCode(catalogueEventCode: string): string {
  const parts = catalogueEventCode.split('.');
  if (parts.length <= 3) return catalogueEventCode;
  return [parts[0], parts[1], parts.slice(2).join('_')].join('.');
}

export function entityTypeFor(catalogueEventCode: string): string {
  return catalogueEventCode.split('.')[1].toLowerCase();
}

/** Deterministic template family code (lower snake, registry-safe). */
export function templateFamilyCode(templateFamily: string): string {
  return templateFamily.toLowerCase();
}

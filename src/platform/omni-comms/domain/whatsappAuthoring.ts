/**
 * Omni-Comms — WhatsApp authoring domain helpers.
 *
 * Pure functions. The canonical template content is provider-neutral and
 * string-only, so structured buttons are held as a compact JSON array under the
 * `buttons` key. These helpers parse and serialise that representation and
 * mirror the server validator's limits for immediate authoring feedback; the
 * SQL validator remains authoritative.
 *
 * A button carries only { label, url? }:
 *   * with a URL  → a link button
 *   * without one → a quick reply
 * Provider identifiers (ContentSid, account SIDs, registration IDs) are never
 * part of template content and never appear here.
 */

export type WhatsAppButtonType = 'quick_reply' | 'url';

export interface WhatsAppButton {
  type: WhatsAppButtonType;
  label: string;
  url?: string;
}

export const WHATSAPP_LIMITS = {
  headerMaxLength: 60,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  buttonLabelMaxLength: 25,
  maxButtons: 3,
} as const;

const HTTPS_RE = /^https:\/\/[A-Za-z0-9._~:/?#%@!$&'()*+,;=\-{}]+$/;

export function isHttpsUrl(value: string): boolean {
  return HTTPS_RE.test((value ?? '').trim());
}

/** Reads the canonical `buttons` string. Unreadable content yields no buttons. */
export function parseWhatsAppButtons(content: Record<string, string>): WhatsAppButton[] {
  const raw = (content?.buttons ?? '').trim();
  const out: WhatsAppButton[] = [];

  if (raw !== '') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const label = String((item as { label?: unknown }).label ?? '').trim();
          if (label === '') continue;
          const url = (item as { url?: unknown }).url;
          out.push(
            typeof url === 'string' && url.trim() !== ''
              ? { type: 'url', label, url: url.trim() }
              : { type: 'quick_reply', label },
          );
        }
      }
    } catch {
      /* malformed legacy content is surfaced by validation, not thrown here */
    }
  }

  // Backward compatibility only: an older single-button version stays readable.
  if (out.length === 0) {
    const legacyLabel = (content?.button_label ?? '').trim();
    const legacyUrl = (content?.button_url ?? '').trim();
    if (legacyLabel !== '' && legacyUrl !== '') {
      out.push({ type: 'url', label: legacyLabel, url: legacyUrl });
    }
  }

  return out.slice(0, WHATSAPP_LIMITS.maxButtons);
}

/** Writes buttons back into canonical string-only content. */
export function serialiseWhatsAppButtons(
  content: Record<string, string>,
  buttons: readonly WhatsAppButton[],
): Record<string, string> {
  const next = { ...content };
  const cleaned = buttons
    .map((b) => ({ label: (b.label ?? '').trim(), url: (b.url ?? '').trim() }))
    .filter((b) => b.label !== '')
    .slice(0, WHATSAPP_LIMITS.maxButtons)
    .map((b) => (b.url === '' ? { label: b.label } : { label: b.label, url: b.url }));

  next.buttons = cleaned.length === 0 ? '' : JSON.stringify(cleaned);
  // The structured model is the normal authoring path; legacy single-button
  // keys are never re-introduced once structured buttons are authored.
  if (cleaned.length > 0) {
    next.button_label = '';
    next.button_url = '';
  }
  return next;
}

/** Client-side usability checks mirroring the server contract. */
export function validateWhatsAppContent(content: Record<string, string>): string[] {
  const issues: string[] = [];
  const header = (content.header ?? '').trim();
  const body = (content.body ?? '').trim();
  const footer = (content.footer ?? '').trim();
  const media = (content.media_url ?? '').trim();

  if (body === '') issues.push('A message body is required.');
  if (body.length > WHATSAPP_LIMITS.bodyMaxLength) {
    issues.push(`The body must be ${WHATSAPP_LIMITS.bodyMaxLength} characters or fewer.`);
  }
  if (header.length > WHATSAPP_LIMITS.headerMaxLength) {
    issues.push(`The header must be ${WHATSAPP_LIMITS.headerMaxLength} characters or fewer.`);
  }
  if (footer.length > WHATSAPP_LIMITS.footerMaxLength) {
    issues.push(`The footer must be ${WHATSAPP_LIMITS.footerMaxLength} characters or fewer.`);
  }
  if (media !== '' && !isHttpsUrl(media)) {
    issues.push('Media must be a secure https link.');
  }

  const buttons = parseWhatsAppButtons(content);
  if (buttons.length > WHATSAPP_LIMITS.maxButtons) {
    issues.push(`At most ${WHATSAPP_LIMITS.maxButtons} buttons are allowed.`);
  }
  for (const button of buttons) {
    if (button.label.length > WHATSAPP_LIMITS.buttonLabelMaxLength) {
      issues.push(`Button labels must be ${WHATSAPP_LIMITS.buttonLabelMaxLength} characters or fewer.`);
    }
    if (button.type === 'url' && !isHttpsUrl(button.url ?? '')) {
      issues.push('Link buttons must use a secure https destination.');
    }
  }
  return issues;
}

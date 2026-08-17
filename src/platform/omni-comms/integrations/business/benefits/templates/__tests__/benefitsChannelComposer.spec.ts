import { describe, expect, it } from 'vitest';
import { BENEFITS_TEMPLATE_ENTRIES } from '../benefitsTemplateRegistry';
import {
  BENEFITS_SMS_MAX_CHARS,
  BENEFITS_WHATSAPP_MAX_CHARS,
} from '../benefitsChannelComposer';

describe('Benefits channel variants', () => {
  it('composes a variant for every seeded channel', () => {
    for (const entry of BENEFITS_TEMPLATE_ENTRIES) {
      expect(Object.keys(entry.variants).sort()).toEqual([
        'email',
        'print',
        'sms',
        'whatsapp',
      ]);
    }
  });

  it('print is a formal letter, never the email body', () => {
    for (const entry of BENEFITS_TEMPLATE_ENTRIES) {
      const { print, email } = entry.variants;
      expect(print.html).not.toBe(email.html);
      expect(print.text).not.toBe(email.text);
      // Postal address block + wet-signature block.
      expect(print.html).toContain('{{recipient.print?}}');
      expect(print.text).toContain('Yours faithfully,');
      // No email chrome.
      expect(print.html).not.toContain('preheader');
    }
  });

  it('short channels stay within their hard caps', () => {
    for (const entry of BENEFITS_TEMPLATE_ENTRIES) {
      expect(entry.variants.sms.body.length).toBeLessThanOrEqual(
        BENEFITS_SMS_MAX_CHARS,
      );
      expect(entry.variants.whatsapp.body.length).toBeLessThanOrEqual(
        BENEFITS_WHATSAPP_MAX_CHARS,
      );
      expect(entry.variants.sms.body).toContain('{{payload.reference}}');
    }
  });
});

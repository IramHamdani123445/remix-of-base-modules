/**
 * OMNI_BENEFITS_CHANNEL_AUTHORITY
 *
 * Business integration code ASKS for a communication; it never decides which
 * channel carries it. Channel selection, template binding, sender selection
 * and provider choice belong to the Hub (Communication Actions, channel
 * options, delivery policy and product configuration).
 *
 * This test guards that boundary in source, so a future edit cannot quietly
 * reintroduce channel decisioning into a business module.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BUSINESS_ROOT = join(
  process.cwd(),
  'src/platform/omni-comms/integrations/business',
);

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      collect(full, out);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Scope: PRODUCTION BUSINESS-EMISSION paths only. Administrative /
 * configuration UI legitimately reads communication configuration and is not
 * part of this tree.
 */
const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /requestedChannels\s*:\s*\[/,
    reason: 'a business producer must not hard-code a channel list',
  },
  {
    pattern: /provider(Code|Id|_code|_id)\b|['"](resend|twilio)['"]/i,
    reason: 'a business producer must never name a provider',
  },
  {
    pattern: /\bresolveEffectiveCommunicationPlan\b/,
    reason: 'business code must not pre-resolve the communication plan',
  },
  {
    pattern: /\bresolveProductCommunication\b/,
    reason: 'business code must not resolve product communication configuration',
  },
  {
    pattern: /\beffectiveTemplate\b\s*[:=]/,
    reason: 'business code must not select an effective template',
  },
  {
    pattern: /\beffectiveSender\b\s*[:=]/,
    reason: 'business code must not select an effective sender',
  },
  {
    pattern: /\b(plan|result)\.enabledChannels\b/,
    reason: 'business code must not test enabled channels before submission',
  },
  {
    pattern: /\b(plan|result)\.runnableChannels\b/,
    reason: 'business code must not test runnable channels before submission',
  },
  {
    pattern: /channel\s*===\s*['"](email|sms|print|whatsapp|push|in_app|webhook|voice)['"]/i,
    reason: 'business code must not branch on a specific channel',
  },
  // ── Transport facts a business producer may NEVER supply ───────────────
  {
    pattern: /\bpushDestination\b|\b(device|registration|fcm)_?[Tt]oken\b/,
    reason: 'business code must not supply a Push device token',
  },
  {
    pattern: /\bwebhook(Url|Endpoint)\b|\bendpoint_?url\b/i,
    reason: 'business code must not supply a webhook URL or endpoint',
  },
  {
    pattern: /\bsigning_?secret\b|\bwebhookSecret\b/i,
    reason: 'business code must not supply a webhook signing secret',
  },
  {
    pattern: /\boriginating_?[Nn]umber\b|\bcallerId\b|\bfrom_?[Nn]umber\b/,
    reason: 'business code must not supply a Voice originating number',
  },
  {
    pattern: /\bfirebase\b|\bmessaging_?sender_?id\b|\baccountSid\b|\bauthToken\b/i,
    reason: 'business code must not name a provider account or credential',
  },
  {
    pattern: /<Response>|<Say>|<Gather>|\bTwiML\b/i,
    reason: 'business code must not author raw TwiML',
  },
];

/** Any second resolver imported into the business tree is a violation. */
const FORBIDDEN_IMPORTS =
  /from\s+['"][^'"]*(effectiveCommunicationPlan|application\/(templateResolver|actionResolver|channelEligibility|senderResolver))[^'"]*['"]/;

describe('OMNI_BENEFITS_CHANNEL_AUTHORITY', () => {
  const files = collect(BUSINESS_ROOT);

  it('finds the business integration sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never selects channels or providers in business code', () => {
    const violations: string[] = [];
    for (const file of files) {
      // The emission layer forwards a channel list only when a caller supplies
      // one; it declares no channel of its own.
      const source = readFileSync(file, 'utf8');
      for (const { pattern, reason } of FORBIDDEN) {
        if (pattern.test(source)) {
          violations.push(`${file.replace(process.cwd(), '')}: ${reason}`);
        }
      }
      if (FORBIDDEN_IMPORTS.test(source)) {
        violations.push(
          `${file.replace(process.cwd(), '')}: business code must not import a communication resolver`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('leaves exactly one resolution authority: the canonical runtime', () => {
    const resolvers = files.filter((file) =>
      /resolveEffectiveCommunicationPlan|resolveProductCommunication/.test(
        readFileSync(file, 'utf8').replace(/^[^\n]*NOTE:[^\n]*$/gm, ''),
      ),
    );
    expect(resolvers).toEqual([]);
  });

  it('carries product identity to the runtime as a fact', () => {
    const emitter = readFileSync(
      join(BUSINESS_ROOT, 'emitConfiguredBusinessEvent.ts'),
      'utf8',
    );
    expect(emitter).toMatch(/resolutionContext:\s*\{\s*productId/);
  });
});

/**
 * Architecture guard: the canonical Benefits → Omni-Comms path must never
 * depend on the legacy BN notification runtime. Legacy assets are discovery
 * input only (§2, §53 of the Benefits closure brief).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OMNI_ROOT = 'src/platform/omni-comms';

const FORBIDDEN = [
  'bnNotificationIntegrationService',
  'bnCommunicationAdapter',
  'bnCommunicationAdapterService',
  'services/bn/communication',
  'notification_templates',
  'notification_logs',
  'notification_queue',
  'send-notification',
  'publishBnEvent',
  '@/adapters/notificationsAdapter',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

describe('Benefits Omni-Comms legacy notification guard', () => {
  it('no Omni-Comms source references the legacy BN notification runtime', () => {
    const offenders: string[] = [];
    for (const file of walk(OMNI_ROOT)) {
      if (
        file.includes('__tests__') ||
        file.includes('/architecture/') ||
        file.endsWith('benefitsCommunicationCatalogue.ts')
      )
        continue;
      const source = readFileSync(file, 'utf8');
      for (const needle of FORBIDDEN) {
        if (source.includes(needle)) offenders.push(`${file} → ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

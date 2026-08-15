/**
 * Architecture guard: the canonical Benefits → Omni-Comms path must never
 * depend on the legacy BN notification runtime. Legacy assets are discovery
 * input only (§2, §53 of the Benefits closure brief).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OMNI_ROOT = 'src/platform/omni-comms';
const BENEFITS_ACTIVE_PRODUCER_FILES = [
  'src/services/bn/communication/workflowCommunicationBridge.ts',
  'src/services/bn/communication/bnClaimOmniCommsService.ts',
  'src/components/bn/workbench/CommunicationTab.tsx',
] as const;

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

  it('active Benefits claim producers cannot call the legacy dispatcher or queue', () => {
    const offenders: string[] = [];
    for (const file of BENEFITS_ACTIVE_PRODUCER_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const needle of [
        'triggerClaimCommunication(',
        "from('notification_queue')",
        "from('notification_logs')",
        "from('bn_communication_log')",
        "from('in_app_notifications')",
        'send-notification',
        "from './bnCommunicationAdapter'",
        "from '@/services/bn/communication/bnCommunicationAdapter'",
      ]) {
        if (source.includes(needle)) offenders.push(`${file} → ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Omni-Comms C5A Closure — focused corrections.
 *
 * Proves: fail-safe rollback default, runtime-evidence registry classification,
 * explicit separation of configuration preflight from provider delivery, and
 * the permanent zero-send boundary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
  OMNI_COMMS_OBJECT_COUNT,
} from '@/platform/omni-comms/registry/objectRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';
import {
  projectEmailReadiness,
  EMAIL_CONFIGURATION_PREFLIGHT_IMPLEMENTED,
  EMAIL_PROVIDER_DELIVERY_TEST_IMPLEMENTED,
  CONFIGURATION_PREFLIGHT_STALE,
  PROVIDER_DELIVERY_TEST_DETAIL,
  EMAIL_READINESS_LABEL,
} from '@/platform/omni-comms/admin/views/channels/emailReadiness';
import type { ChannelTestCentreSummary, ChannelTestRun } from '@/platform/omni-comms/application/channelTestCentreTypes';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ROLLBACK = 'scripts/omni-comms/rollback/c5a-channel-test-centre-rollback.sql';
const READINESS = 'src/platform/omni-comms/admin/views/channels/emailReadiness.ts';
const TAB = 'src/platform/omni-comms/admin/views/channels/ChannelTestCentreTab.tsx';
const SERVICE = 'src/platform/omni-comms/application/channelTestCentreService.ts';
const TYPES = 'src/platform/omni-comms/application/channelTestCentreTypes.ts';

const passedRun = {
  status: 'passed',
  result_code: 'preflight_passed',
  configuration_fingerprint: 'fp-1',
} as unknown as ChannelTestRun;

const summary = (over: Partial<ChannelTestCentreSummary> = {}) => ({
  organization_id: 'org-1',
  department_id: null,
  channel: 'email',
  can_configure: true,
  selected_binding_id: 'bind-1',
  candidate_bindings: [],
  configuration_fingerprint: 'fp-1',
  latest_run: passedRun,
  latest_run_is_stale: false,
  history: [],
  sends_message: false,
  ...over,
} as ChannelTestCentreSummary);

const check = (s: ChannelTestCentreSummary | null | undefined, key: string) =>
  projectEmailReadiness(null, null, s).checks.find((c) => c.key === key)!;

describe('C5A closure — 1. rollback is fail-safe', () => {
  const sql = read(ROLLBACK);

  it('contains ROLLBACK;', () => {
    expect(sql).toContain('ROLLBACK;');
  });

  it('does not end with an active COMMIT;', () => {
    const active = sql
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('--'));
    expect(active.filter((l) => l === 'COMMIT;')).toHaveLength(0);
    expect(active.filter(Boolean).at(-1)).toBe('ROLLBACK;');
    expect(sql).toContain('-- COMMIT;  -- enable only after explicit approval');
  });

  it('carries the destructive-history warning', () => {
    expect(sql).toContain(
      'Executing this rollback with COMMIT permanently removes the immutable',
    );
    expect(sql).toContain('C5A preflight history.');
  });

  it('issues no statement against runtime delivery tables', () => {
    const statements = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    for (const t of [
      'omni_comms_request',
      'omni_comms_message',
      'omni_comms_dispatch_job',
      'omni_comms_delivery_attempt',
      'notification_queue',
      'notification_logs',
    ]) {
      expect(statements.includes(t), `rollback touches ${t}`).toBe(false);
    }
  });

  it('touches no other channel configuration object', () => {
    const statements = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    for (const t of [
      'omni_comms_provider_account',
      'omni_comms_sender_identity',
      'omni_comms_channel_endpoint',
      'omni_comms_sender_provider_binding',
      'omni_comms_channel_setting',
    ]) {
      expect(statements.includes(t), `rollback touches ${t}`).toBe(false);
    }
  });
});

describe('C5A closure — 2. registry classification', () => {
  const entry = OMNI_COMMS_OBJECT_REGISTRY.find(
    (o) => o.name === 'omni_comms_channel_test_run',
  );

  it('classifies the test-run ledger as runtime evidence', () => {
    expect(entry?.category).toBe('runtime');
    expect(entry?.writeAuthority).toBe('admin_rpc');
    expect(entry?.status).toBe('AVAILABLE');
    expect(entry?.introductionStory).toBe('Channels C5A — Test Centre preflight');
  });

  it('states the evidence purpose exactly', () => {
    expect(entry?.purpose).toBe(
      'Immutable configuration-preflight evidence for a selected channel binding. '
      + 'Contains masked and hashed test input only and records no provider delivery.',
    );
  });

  it('keeps the object count at exactly 28', () => {
    expect(OMNI_COMMS_OBJECT_COUNT).toBe(28);
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(28);
  });

  it('registers exactly one C5A object and keeps registries valid', () => {
    expect(
      OMNI_COMMS_OBJECT_REGISTRY.filter(
        (o) => o.introductionStory === 'Channels C5A — Test Centre preflight',
      ),
    ).toHaveLength(1);
    expect(validateOmniCommsRegistries().errors).toEqual([]);
  });
});

describe('C5A closure — 3. explicit capability flags', () => {
  it('marks configuration preflight implemented', () => {
    expect(EMAIL_CONFIGURATION_PREFLIGHT_IMPLEMENTED).toBe(true);
    expect(projectEmailReadiness(null, null, summary()).configurationPreflightImplemented)
      .toBe(true);
  });

  it('marks provider delivery test NOT implemented', () => {
    expect(EMAIL_PROVIDER_DELIVERY_TEST_IMPLEMENTED).toBe(false);
    expect(projectEmailReadiness(null, null, summary()).providerDeliveryTestImplemented)
      .toBe(false);
  });

  it('removes the ambiguous technicalTestImplemented flag entirely', () => {
    const projection = projectEmailReadiness(null, null, summary()) as unknown as Record<string, unknown>;
    expect('technicalTestImplemented' in projection).toBe(false);
    expect(read(READINESS)).not.toContain('technicalTestImplemented');
    expect(read(READINESS)).not.toContain('EMAIL_TECHNICAL_TEST_IMPLEMENTED');
  });
});

describe('C5A closure — 4. two separate Email readiness checks', () => {
  it('exposes configuration_preflight and provider_delivery_test separately', () => {
    const keys = projectEmailReadiness(null, null, summary()).checks.map((c) => c.key);
    expect(keys).toContain('configuration_preflight');
    expect(keys).toContain('provider_delivery_test');
    expect(keys).not.toContain('technical_test');
  });

  it('labels the checks truthfully', () => {
    expect(check(summary(), 'configuration_preflight').label)
      .toBe('Current configuration preflight passed');
    expect(check(summary(), 'provider_delivery_test').label).toBe('Provider delivery test');
  });

  it('lets a current passed preflight satisfy configuration preflight only', () => {
    expect(check(summary(), 'configuration_preflight').state).toBe('met');
    expect(check(summary(), 'provider_delivery_test').state).toBe('not_implemented');
  });

  it('lets a stale preflight satisfy neither check', () => {
    const stale = summary({ latest_run_is_stale: true });
    expect(check(stale, 'configuration_preflight').state).toBe('unmet');
    expect(check(stale, 'configuration_preflight').detail).toBe(CONFIGURATION_PREFLIGHT_STALE);
    expect(check(stale, 'configuration_preflight').detail)
      .toBe('Configuration changed — run preflight again.');
    expect(check(stale, 'provider_delivery_test').state).toBe('not_implemented');
  });

  it('keeps provider delivery not_implemented with the C5A explanation', () => {
    expect(check(summary(), 'provider_delivery_test').detail).toBe(PROVIDER_DELIVERY_TEST_DETAIL);
    expect(PROVIDER_DELIVERY_TEST_DETAIL).toContain('does not send an email');
    expect(PROVIDER_DELIVERY_TEST_DETAIL).toContain('not implemented in C5A');
  });

  it('never claims completion, send readiness or delivery', () => {
    const projection = projectEmailReadiness(null, null, summary());
    const text = JSON.stringify(projection) + Object.values(EMAIL_READINESS_LABEL).join(' ');
    for (const phrase of [
      'Configuration complete',
      'Technical testing complete',
      'Send ready',
      'Delivery verified',
    ]) {
      expect(text.includes(phrase), `readiness says "${phrase}"`).toBe(false);
    }
    expect(projection.explanation).toContain('Provider delivery test pending');
  });
});

describe('C5A closure — 5. zero-send boundary is unchanged', () => {
  const sources = [READINESS, TAB, SERVICE, TYPES].map((p) => [p, read(p)] as const);

  it('introduces no provider SDK', () => {
    for (const [p, src] of sources) {
      for (const pkg of ['resend', 'twilio', 'nodemailer', '@sendgrid', 'firebase']) {
        expect(src.includes(`from '${pkg}`), `${p} imports ${pkg}`).toBe(false);
      }
    }
  });

  it('introduces no fetch or provider call', () => {
    for (const [p, src] of sources) {
      expect(/\bfetch\s*\(/.test(src), `${p} performs fetch`).toBe(false);
      expect(src.includes('XMLHttpRequest'), `${p} uses XHR`).toBe(false);
    }
  });

  it('introduces no sendCommunication import or call', () => {
    for (const [p, src] of sources) {
      const code = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
        .join('\n');
      expect(code.includes('sendCommunication('), `${p} calls the send facade`).toBe(false);
      expect(code.includes("from '@/platform/omni-comms/application/sendCommunication"), `${p} imports the facade`).toBe(false);
    }
  });

  it('introduces no request/message/job/attempt write', () => {
    for (const [p, src] of sources) {
      for (const t of [
        'omni_comms_request',
        'omni_comms_message',
        'omni_comms_dispatch_job',
        'omni_comms_delivery_attempt',
        'notification_queue',
        'notification_logs',
      ]) {
        expect(src.includes(t), `${p} references ${t}`).toBe(false);
      }
    }
  });

  it('introduces no Diagnostics or Release Control behaviour', () => {
    for (const [p, src] of [[TAB, read(TAB)], [SERVICE, read(SERVICE)]] as const) {
      expect(src.includes('diagnostics'), `${p} adds diagnostics`).toBe(false);
      expect(src.includes('releaseControl'), `${p} adds release control`).toBe(false);
      expect(src.includes('release_control'), `${p} adds release control`).toBe(false);
    }
  });

  it('keeps the Test Centre safety wording', () => {
    const tab = read(TAB);
    expect(/configuration/i.test(tab)).toBe(true);
    expect(/no provider is contacted|does not contact|no provider/i.test(tab)).toBe(true);
    expect(/no message is sent|never sends|does not send/i.test(tab)).toBe(true);
    expect(tab).not.toContain('Retry delivery');
  });
});

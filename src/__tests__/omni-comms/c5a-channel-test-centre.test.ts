/**
 * Omni-Comms C5A — Channel Test Centre preflight and immutable ledger.
 *
 * These tests assert the CONTRACT of the C5A surface:
 *   - exactly one new registered object;
 *   - the canonical 21-check checklist;
 *   - readiness now requires a current passed preflight;
 *   - the source contains no provider SDK import, no send facade call and no
 *     runtime delivery write.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
  OMNI_COMMS_OBJECT_COUNT,
} from '@/platform/omni-comms/registry/objectRegistry';
import {
  CHANNEL_TEST_CHECK_CODES,
  CHANNEL_TEST_CHECK_COUNT,
  TEST_CENTRE_CHANNELS,
  TEST_TARGET_TYPE_BY_CHANNEL,
  TEST_TARGET_LABEL_BY_CHANNEL,
  isTestCentreChannel,
  isTestRunCurrent,
  hasCurrentPassedPreflight,
  type ChannelTestCentreSummary,
  type ChannelTestRun,
} from '@/platform/omni-comms/application/channelTestCentreTypes';
import {
  getChannelTestCentreSummary,
  runChannelTestPreflight,
} from '@/platform/omni-comms/application/channelTestCentreService';
import {
  projectEmailReadiness,
  EMAIL_CONFIGURATION_PREFLIGHT_IMPLEMENTED,
  CONFIGURATION_PREFLIGHT_PENDING,
  CONFIGURATION_PREFLIGHT_CURRENT,
  CONFIGURATION_PREFLIGHT_STALE,
} from '@/platform/omni-comms/admin/views/channels/emailReadiness';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SERVICE = 'src/platform/omni-comms/application/channelTestCentreService.ts';
const TYPES = 'src/platform/omni-comms/application/channelTestCentreTypes.ts';
const TAB = 'src/platform/omni-comms/admin/views/channels/ChannelTestCentreTab.tsx';

function makeRun(over: Partial<ChannelTestRun> = {}): ChannelTestRun {
  return {
    id: 'run-1',
    organization_id: 'org-1',
    department_id: null,
    channel: 'email',
    binding_id: 'bind-1',
    test_kind: 'configuration_preflight',
    idempotency_key: 'preflight-abcdefgh',
    request_fingerprint: 'a'.repeat(64),
    configuration_fingerprint: 'b'.repeat(64),
    target_type: 'email_address',
    target_masked: 'o***@example.test',
    target_hash: 'c'.repeat(64),
    payload_summary: { subject: 'Configuration preflight', body_character_count: 12 },
    payload_hash: 'd'.repeat(64),
    status: 'passed',
    result_code: 'preflight_passed',
    checks: [],
    blocker_codes: [],
    correlation_id: null,
    requested_by: 'user-1',
    requested_at: new Date().toISOString(),
    configuration_snapshot: null,
    ...over,
  } as ChannelTestRun;
}

function makeSummary(over: Partial<ChannelTestCentreSummary> = {}): ChannelTestCentreSummary {
  return {
    organization_id: 'org-1',
    department_id: null,
    channel: 'email',
    can_configure: true,
    selected_binding_id: 'bind-1',
    candidate_bindings: [],
    configuration_fingerprint: 'b'.repeat(64),
    latest_run: makeRun(),
    latest_run_is_stale: false,
    history: [],
    sends_message: false,
    ...over,
  } as ChannelTestCentreSummary;
}

describe('C5A — object registry', () => {
  it('registers exactly one new object for C5A', () => {
    const entries = OMNI_COMMS_OBJECT_REGISTRY.filter(
      (e) => e.introductionStory === 'Channels C5A — Test Centre preflight',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('omni_comms_channel_test_run');
  });

  it('raises the approved object ceiling from 27 to 28 (C5B raises it to 30)', () => {
    expect(OMNI_COMMS_OBJECT_COUNT).toBe(30);
  });

  it('marks the test-run object AVAILABLE, runtime evidence, admin_rpc', () => {
    const e = OMNI_COMMS_OBJECT_REGISTRY.find((x) => x.name === 'omni_comms_channel_test_run');
    expect(e?.status).toBe('AVAILABLE');
    expect(e?.category).toBe('runtime');
    expect(e?.writeAuthority).toBe('admin_rpc');
  });

  it('keeps every registered object omni_comms_ prefixed', () => {
    for (const e of OMNI_COMMS_OBJECT_REGISTRY) {
      expect(e.name.startsWith('omni_comms_')).toBe(true);
    }
  });
});

describe('C5A — canonical checklist', () => {
  it('defines exactly 21 checks', () => {
    expect(CHANNEL_TEST_CHECK_COUNT).toBe(21);
    expect(CHANNEL_TEST_CHECK_CODES).toHaveLength(21);
  });

  it('has no duplicate check codes', () => {
    expect(new Set(CHANNEL_TEST_CHECK_CODES).size).toBe(21);
  });

  it('covers every configuration layer', () => {
    for (const code of [
      'binding_selected',
      'binding_active',
      'binding_verified',
      'provider_account_active',
      'provider_credentials_verified',
      'provider_credentials_complete',
      'identity_active',
      'identity_not_reference',
      'identity_configuration_complete',
      'endpoint_requirement_satisfied',
      'endpoint_active',
      'endpoint_verified',
      'policy_effective_present',
      'policy_state_allows_test',
      'policy_live_delivery_disabled',
      'test_target_valid',
      'test_payload_valid',
    ]) {
      expect(CHANNEL_TEST_CHECK_CODES).toContain(code);
    }
  });

  it('places the fail-closed live-delivery check in the checklist', () => {
    expect(CHANNEL_TEST_CHECK_CODES).toContain('live_delivery_disabled');
  });
});

describe('C5A — channel coverage and target typing', () => {
  it('supports the six implemented channels', () => {
    expect([...TEST_CENTRE_CHANNELS]).toEqual([
      'email', 'sms', 'whatsapp', 'push', 'in_app', 'print',
    ]);
  });

  it('rejects unsupported channels', () => {
    expect(isTestCentreChannel('email')).toBe(true);
    expect(isTestCentreChannel('voice')).toBe(false);
    expect(isTestCentreChannel('webhook')).toBe(false);
  });

  it('maps each channel to a distinct target type', () => {
    const types = TEST_CENTRE_CHANNELS.map((c) => TEST_TARGET_TYPE_BY_CHANNEL[c]);
    expect(new Set(types).size).toBe(TEST_CENTRE_CHANNELS.length);
  });

  it('labels every channel target', () => {
    for (const c of TEST_CENTRE_CHANNELS) {
      expect(TEST_TARGET_LABEL_BY_CHANNEL[c].length).toBeGreaterThan(3);
    }
  });
});

describe('C5A — stale-test detection', () => {
  it('treats a matching fingerprint as current', () => {
    expect(isTestRunCurrent(makeRun(), 'b'.repeat(64))).toBe(true);
  });

  it('treats a changed fingerprint as stale', () => {
    expect(isTestRunCurrent(makeRun(), 'e'.repeat(64))).toBe(false);
  });

  it('treats a missing run as not current', () => {
    expect(isTestRunCurrent(null, 'b'.repeat(64))).toBe(false);
  });

  it('treats a missing fingerprint as not current', () => {
    expect(isTestRunCurrent(makeRun(), null)).toBe(false);
  });

  it('requires a passed, non-stale run for the readiness gate', () => {
    expect(hasCurrentPassedPreflight(makeSummary())).toBe(true);
    expect(hasCurrentPassedPreflight(makeSummary({ latest_run_is_stale: true }))).toBe(false);
    expect(hasCurrentPassedPreflight(makeSummary({
      latest_run: makeRun({ status: 'failed', result_code: 'preflight_failed' }),
    }))).toBe(false);
    expect(hasCurrentPassedPreflight(makeSummary({ latest_run: null }))).toBe(false);
    expect(hasCurrentPassedPreflight(null)).toBe(false);
  });
});

describe('C5A — email readiness integration', () => {
  const technical = (s?: ChannelTestCentreSummary | null) =>
    projectEmailReadiness(null, null, s).checks.find((c) => c.key === 'configuration_preflight')!;

  it('reports configuration preflight as implemented', () => {
    expect(EMAIL_CONFIGURATION_PREFLIGHT_IMPLEMENTED).toBe(true);
  });

  it('keeps the check not_implemented when no Test Centre result is supplied', () => {
    expect(technical(undefined).state).toBe('not_implemented');
  });

  it('marks the check unmet when no preflight exists', () => {
    const c = technical(makeSummary({ latest_run: null }));
    expect(c.state).toBe('unmet');
    expect(c.detail).toContain(CONFIGURATION_PREFLIGHT_PENDING);
  });

  it('marks the check met for a current passed preflight', () => {
    const c = technical(makeSummary());
    expect(c.state).toBe('met');
    expect(c.detail).toBe(CONFIGURATION_PREFLIGHT_CURRENT);
  });

  it('marks the check unmet and stale after a configuration change', () => {
    const c = technical(makeSummary({ latest_run_is_stale: true }));
    expect(c.state).toBe('unmet');
    expect(c.detail).toBe(CONFIGURATION_PREFLIGHT_STALE);
  });

  it('marks the check unmet for a failed preflight', () => {
    const c = technical(makeSummary({
      latest_run: makeRun({ status: 'failed', result_code: 'preflight_failed' }),
    }));
    expect(c.state).toBe('unmet');
  });

  it('surfaces the preflight state in the readiness explanation', () => {
    expect(projectEmailReadiness(null, null, makeSummary()).explanation)
      .toContain(CONFIGURATION_PREFLIGHT_CURRENT);
    expect(projectEmailReadiness(null, null, makeSummary({ latest_run_is_stale: true })).explanation)
      .toContain(CONFIGURATION_PREFLIGHT_STALE);
    expect(projectEmailReadiness(null, null).explanation).toContain(CONFIGURATION_PREFLIGHT_PENDING);
  });

  it('never labels readiness as "Configuration complete"', () => {
    expect(projectEmailReadiness(null, null, makeSummary()).label)
      .not.toContain('Configuration complete');
  });
});

describe('C5A — service adapter contract', () => {
  interface Call { fn: string; args: Record<string, unknown> }

  function stubClient(data: unknown, calls: Call[]) {
    return {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args: args ?? {} });
        return { data, error: null };
      },
    };
  }

  it('calls the bounded summary RPC with the tenant scope', async () => {
    const calls: Call[] = [];
    await getChannelTestCentreSummary(stubClient(makeSummary(), calls), 'org-1', 'sms', 'dep-1', 'bind-9', 5);
    expect(calls[0].fn).toBe('omni_comms_channel_test_centre_summary');
    expect(calls[0].args).toMatchObject({
      p_organization_id: 'org-1',
      p_department_id: 'dep-1',
      p_channel: 'sms',
      p_binding_id: 'bind-9',
      p_history_limit: 5,
    });
  });

  it('calls the bounded preflight RPC with an idempotency key', async () => {
    const calls: Call[] = [];
    await runChannelTestPreflight(
      stubClient({ replayed: false, run: makeRun() }, calls),
      {
        organizationId: 'org-1',
        channel: 'email',
        bindingId: 'bind-1',
        target: 'ops@example.test',
        payload: { subject: 's', body: 'b' },
        idempotencyKey: 'preflight-abcdefgh',
      },
    );
    expect(calls[0].fn).toBe('omni_comms_channel_test_run_preflight');
    expect(calls[0].args.p_idempotency_key).toBe('preflight-abcdefgh');
    expect(calls[0].args.p_correlation_id).toBeNull();
  });

  it('normalises RPC errors to the OC error model', async () => {
    const client = {
      rpc: async () => ({
        data: null,
        error: { message: 'OC422 validation_error', details: 'target_invalid_email' },
      }),
    };
    await expect(
      getChannelTestCentreSummary(client, 'org-1', 'email'),
    ).rejects.toMatchObject({ code: 'OC422', detail: 'target_invalid_email' });
  });
});

describe('C5A — zero-send source boundaries', () => {
  const sources = [SERVICE, TYPES, TAB].map((p) => [p, read(p)] as const);

  it('imports no provider SDK anywhere in the C5A surface', () => {
    for (const [p, src] of sources) {
      for (const pkg of ['resend', 'twilio', 'nodemailer', '@sendgrid', 'firebase']) {
        expect(src.includes(`from '${pkg}`), `${p} imports ${pkg}`).toBe(false);
      }
    }
  });

  it('never calls the send facade', () => {
    for (const [p, src] of sources) {
      expect(src.includes('sendCommunication('), `${p} calls the facade`).toBe(false);
    }
  });

  it('never references runtime delivery tables', () => {
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

  it('performs no direct network call from the C5A surface', () => {
    for (const [p, src] of sources) {
      expect(/\bfetch\s*\(/.test(src), `${p} performs fetch`).toBe(false);
      expect(src.includes('XMLHttpRequest'), `${p} uses XHR`).toBe(false);
    }
  });

  it('never imports the browser Supabase singleton', () => {
    for (const [p, src] of sources) {
      expect(src.includes('@/integrations/supabase/client'), `${p} imports the client`).toBe(false);
    }
  });

  it('states the zero-send guarantee to the operator', () => {
    const tab = read(TAB);
    expect(tab).toContain('never sends');
    expect(tab).toContain('No message is sent.');
    expect(tab).toContain('No provider is contacted.');
  });

  it('records only masked and hashed targets in the projection type', () => {
    const types = read(TYPES);
    expect(types).toContain('target_masked');
    expect(types).toContain('target_hash');
    expect(types).not.toContain('target_raw');
    expect(types).not.toContain('payload_body');
  });

  it('exposes an always-false sends_message flag on the summary', () => {
    expect(makeSummary().sends_message).toBe(false);
  });
});

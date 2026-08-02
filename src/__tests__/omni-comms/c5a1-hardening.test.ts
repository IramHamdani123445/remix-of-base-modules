/**
 * Omni-Comms C5A.1 — focused hardening tests.
 *
 * Verifies the delivery-aware 21-check contract, typed payload construction
 * (no raw JSON editor), idempotency retry-safety helpers, candidate labels,
 * evidence columns, and the zero-send boundary of the Test Centre surface.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHANNEL_TEST_CHECK_CODES,
  CHANNEL_TEST_CHECK_COUNT,
  CHANNEL_TEST_DELIVERY_CHECK_CODES,
  CHANNEL_TEST_CHECK_STATES,
  describeCandidateBinding,
  isDeliveryCheckCode,
  type ChannelTestCandidateBinding,
} from '@/platform/omni-comms/application/channelTestCentreTypes';
import {
  buildTestPayload,
  defaultTestContentForm,
  WHATSAPP_MAX_SAMPLE_VARIABLES,
} from '@/platform/omni-comms/admin/views/channels/channelTestContentForms';
import { newIdempotencyKey } from '@/platform/omni-comms/admin/views/channels/ChannelTestCentreTab';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const TAB = 'src/platform/omni-comms/admin/views/channels/ChannelTestCentreTab.tsx';
const FORMS = 'src/platform/omni-comms/admin/views/channels/channelTestContentForms.tsx';
const DIAG = 'src/platform/omni-comms/admin/views/channels/ChannelDiagnosticsTab.tsx';

describe('C5A.1 — delivery-aware 21-check contract', () => {
  it('has exactly 21 ordered check codes', () => {
    expect(CHANNEL_TEST_CHECK_COUNT).toBe(21);
    expect(CHANNEL_TEST_CHECK_CODES).toHaveLength(21);
    expect(new Set(CHANNEL_TEST_CHECK_CODES).size).toBe(21);
  });

  it('places the three delivery points last and marks them as delivery checks', () => {
    expect(CHANNEL_TEST_CHECK_CODES.slice(18)).toEqual([
      'provider_dispatch',
      'delivery_callback',
      'technical_delivery_result',
    ]);
    for (const c of CHANNEL_TEST_DELIVERY_CHECK_CODES) {
      expect(isDeliveryCheckCode(c)).toBe(true);
    }
    expect(isDeliveryCheckCode('binding_active')).toBe(false);
  });

  it('supports a not_implemented state that is distinct from passed', () => {
    expect(CHANNEL_TEST_CHECK_STATES).toContain('not_implemented');
    expect(CHANNEL_TEST_CHECK_STATES).toContain('warning');
    expect(CHANNEL_TEST_CHECK_STATES).toContain('not_applicable');
  });
});

describe('C5A.1 — typed test content (no raw JSON editor)', () => {
  it('emits only channel-appropriate payload keys', () => {
    const f = defaultTestContentForm('email');
    expect(Object.keys(buildTestPayload('email', f)).sort()).toEqual(['body', 'subject']);
    expect(Object.keys(buildTestPayload('sms', f))).toEqual(['text']);
    expect(Object.keys(buildTestPayload('whatsapp', f)).sort())
      .toEqual(['language_code', 'template_code', 'variables']);
    expect(Object.keys(buildTestPayload('push', f)).sort()).toEqual(['body', 'title']);
    expect(Object.keys(buildTestPayload('in_app', f)).sort()).toEqual(['body', 'title']);
    expect(Object.keys(buildTestPayload('print', f)).sort())
      .toEqual(['document_title', 'sample_text']);
  });

  it('includes the in-app deep link only when supplied', () => {
    const f = { ...defaultTestContentForm('in_app'), deepLink: ' /cases/1 ' };
    expect(buildTestPayload('in_app', f)).toMatchObject({ deep_link: '/cases/1' });
  });

  it('trims, drops blanks and caps WhatsApp sample variables', () => {
    const f = {
      ...defaultTestContentForm('whatsapp'),
      variables: [' a ', '', ...Array.from({ length: 30 }, (_, i) => `v${i}`)],
    };
    const vars = (buildTestPayload('whatsapp', f) as { variables: string[] }).variables;
    expect(vars).toHaveLength(WHATSAPP_MAX_SAMPLE_VARIABLES);
    expect(vars[0]).toBe('a');
  });

  it('renders typed fields and never a raw JSON editor', () => {
    const forms = read(FORMS);
    const tab = read(TAB);
    expect(forms).not.toMatch(/JSON\.parse/);
    expect(tab).not.toMatch(/JSON\.parse/);
    for (const id of ['email', 'sms', 'whatsapp', 'push', 'in_app', 'print']) {
      expect(forms).toContain(`omni-comms-test-content-${id}`);
    }
  });
});

describe('C5A.1 — idempotency retry safety', () => {
  it('generates distinct, bounded, safe keys', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).toMatch(/^[A-Za-z0-9._:-]+$/);
  });

  it('never regenerates the key inside the run handler', () => {
    const tab = read(TAB);
    const runBody = tab.slice(tab.indexOf('const onRun'), tab.indexOf('], [\n    client, orgId'));
    expect(runBody).not.toContain('newIdempotencyKey(');
    expect(tab).toContain('omni-comms-test-centre-new-test');
    expect(tab).toContain('CHANNEL_TEST_REPLAY_NOTICE');
  });
});

describe('C5A.1 — candidate binding labels', () => {
  const base: ChannelTestCandidateBinding = {
    binding_id: 'b1',
    priority: 1,
    status: 'active',
    verification_status: 'verified',
    department_id: null,
    identity_code: 'noreply',
    identity_display: 'noreply@ssb.kn',
    identity_status: 'active',
    identity_data_origin: 'operator',
    provider_account_code: 'resend-primary',
    provider_account_status: 'active',
    provider_account_verification_status: 'verified',
    provider_environment: 'sandbox',
    provider_id: 'p1',
    endpoint_code: 'ssb.kn',
    endpoint_status: 'active',
    endpoint_verification_status: 'verified',
    data_origin: 'operator',
  };

  it('describes a healthy primary binding without warnings', () => {
    const label = describeCandidateBinding(base);
    expect(label).toContain('noreply@ssb.kn');
    expect(label).toContain('resend-primary');
    expect(label).toContain('sandbox');
    expect(label).toContain('endpoint ssb.kn');
    expect(label).toContain('scope organisation');
    expect(label).toContain('priority 1 (primary)');
    expect(label).not.toContain('⚠');
  });

  it('surfaces fallback priority, department scope and lifecycle warnings', () => {
    const label = describeCandidateBinding(
      {
        ...base,
        priority: 2,
        department_id: 'd1',
        verification_status: 'unverified',
        identity_status: 'disabled',
        data_origin: 'reference_seed',
      },
      'Benefits',
    );
    expect(label).toContain('priority 2 (fallback)');
    expect(label).toContain('scope Benefits');
    expect(label).toContain('binding unverified');
    expect(label).toContain('identity disabled');
    expect(label).toContain('reference record');
  });
});

describe('C5A.1 — zero-send boundary and evidence surfacing', () => {
  it('never imports a provider SDK or the send facade', () => {
    for (const p of [TAB, FORMS, DIAG]) {
      const src = read(p);
      expect(src).not.toMatch(/from ['"](resend|twilio|nodemailer|firebase)/);
      expect(src).not.toMatch(/sendCommunication\(/);
    }
  });

  it('states the zero-send boundary on the Test Centre and Diagnostics', () => {
    expect(read(TAB)).toContain('No message is sent.');
    expect(read(TAB)).toContain('not proof of delivery');
    expect(read(DIAG)).toContain('nothing on');
  });

  it('renders the direct evidence columns from the ledger', () => {
    const tab = read(TAB);
    for (const f of [
      'provider_account_id',
      'sender_identity_id',
      'channel_endpoint_id',
      'policy_id',
      'completed_at',
    ]) {
      expect(tab).toContain(f);
    }
  });
});

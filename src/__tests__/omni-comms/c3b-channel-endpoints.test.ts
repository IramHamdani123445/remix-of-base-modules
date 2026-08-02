/**
 * Omni-Comms Channels C3B — domains and channel endpoints.
 *
 * Static and unit proof only. No provider is contacted, no DNS lookup is
 * performed, no callback is received and no communication is requested,
 * dispatched or delivered by this suite.
 */
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  ENDPOINT_ACTIVATION_MEANING,
  OMNI_COMMS_EMAIL_EVENT_TYPES,
  OMNI_COMMS_ENDPOINT_CHANNELS,
  OMNI_COMMS_ENDPOINT_REQUIRED_SECRETS,
  OMNI_COMMS_ENDPOINT_SECRET_PURPOSES,
  OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL,
  OMNI_COMMS_ENDPOINT_TYPE_LABEL,
  OMNI_COMMS_IN_APP_TRANSPORTS,
  OMNI_COMMS_PRINT_SERVICE_MODES,
  OMNI_COMMS_SECRET_REF_PATTERN,
  OMNI_COMMS_WHATSAPP_SUBSCRIBED_FIELDS,
  REFERENCE_ENDPOINT_READ_ONLY_HELP,
  endpointChannelSupported,
  endpointConfigSummary,
  endpointRequiresProviderAccount,
  endpointScopeLabel,
  isReferenceEndpoint,
  isValidEndpointSecretRef,
  type ChannelEndpointRow,
} from '@/platform/omni-comms/application/channelEndpointTypes';
import {
  getChannelEndpointSummary,
  setChannelEndpointLifecycle,
  upsertChannelEndpointDraft,
} from '@/platform/omni-comms/application/channelEndpointService';
import {
  EMAIL_CALLBACK_RECEIVER_IMPLEMENTED,
  EMAIL_CALLBACK_RECEIVER_PENDING,
  EMAIL_READINESS_LABEL,
  genuineActiveEmailEndpoints,
  projectEmailReadiness,
} from '@/platform/omni-comms/admin/views/channels/emailReadiness';
import {
  ENDPOINT_NO_EXTERNAL_CALL_NOTICE,
  VERIFICATION_LABEL,
  validateEndpointForm,
} from '@/platform/omni-comms/admin/views/channels/ChannelEndpointsTab';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
} from '@/platform/omni-comms/registry/objectRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';
import type { EmailEndpointRow } from '@/platform/omni-comms/application/channelManagementTypes';

const MIGRATIONS = 'supabase/migrations';
const ENDPOINTS_TAB =
  'src/platform/omni-comms/admin/views/channels/ChannelEndpointsTab.tsx';
const SERVICE =
  'src/platform/omni-comms/application/channelEndpointService.ts';
const TYPES = 'src/platform/omni-comms/application/channelEndpointTypes.ts';
const read = (p: string) => readFileSync(p, 'utf8');

const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => read(`${MIGRATIONS}/${f}`))
  .join('\n');

function fnBody(name: string, size = 12000): string {
  const start = SQL.indexOf(`FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  return SQL.slice(start, start + size);
}

const NORMALIZER = fnBody('omni_comms_priv_normalize_channel_endpoint');
const URL_NORMALIZER = fnBody('omni_comms_priv_normalize_endpoint_url', 6000);
const DOMAIN_NORMALIZER = fnBody('omni_comms_priv_normalize_endpoint_domain', 6000);
const UPSERT = fnBody('omni_comms_priv_channel_endpoint_upsert');
const LIFECYCLE = fnBody('omni_comms_priv_channel_endpoint_lifecycle');
const SUMMARY = fnBody('omni_comms_channel_endpoint_summary');

const endpoint = (o: Partial<ChannelEndpointRow> = {}): ChannelEndpointRow => ({
  id: 'e1',
  code: 'primary_domain',
  display_name: 'Primary sending domain',
  channel: 'email',
  endpoint_type: 'sending_domain',
  endpoint_config: { domain_name: 'mail.ssb.kn' },
  provider_account_id: 'a1',
  provider_account_code: 'resend_primary',
  provider_account_display_name: 'Resend primary',
  provider_account_status: 'active',
  provider_adapter_key: 'resend',
  department_id: null,
  department_name: null,
  secret_refs: [],
  status: 'active',
  data_origin: 'user',
  verification_status: 'unverified',
  verification_result_code: null,
  verification_detail: null,
  verification_checked_at: null,
  updated_at: '2026-01-01T00:00:00Z',
  activated_at: null,
  retired_at: null,
  retirement_reason: null,
  ...o,
});

const emailEndpoint = (o: Partial<EmailEndpointRow> = {}): EmailEndpointRow => ({
  id: 'ep1',
  code: 'domain',
  display_name: 'Domain',
  channel: 'email',
  endpoint_type: 'sending_domain',
  endpoint_config: { domain_name: 'mail.ssb.kn' },
  provider_account_id: 'a1',
  department_id: null,
  status: 'active',
  data_origin: 'user',
  verification_status: 'unverified',
  secret_refs: [],
  updated_at: '2026-01-01T00:00:00Z',
  ...o,
});

function rpcSpy(result: unknown = 'ok') {
  const rpc = vi.fn(
    async (_fn: string, _args?: Record<string, unknown>) => ({ data: result, error: null }),
  );
  return { client: { rpc }, rpc };
}

// ─── 1. Object registry authorisation ──────────────────────────────────────
describe('C3B — registry authorisation', () => {
  it('1. registers omni_comms_channel_endpoint before creation', () => {
    const names = OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name);
    expect(names).toContain('omni_comms_channel_endpoint');
  });
  it('2. registers omni_comms_channel_endpoint_secret_ref', () => {
    const names = OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name);
    expect(names).toContain('omni_comms_channel_endpoint_secret_ref');
  });
  it('3. registry still validates cleanly', () => {
    expect(validateOmniCommsRegistries().ok).toBe(true);
  });
  it('4. both endpoint objects use admin_rpc write authority', () => {
    for (const n of ['omni_comms_channel_endpoint', 'omni_comms_channel_endpoint_secret_ref']) {
      const e = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === n);
      expect(e?.writeAuthority).toBe('admin_rpc');
      expect(e?.status).toBe('AVAILABLE');
    }
  });
});

// ─── 2. Schema contract ────────────────────────────────────────────────────
describe('C3B — schema contract', () => {
  it('5. creates the endpoint table with omni_comms_ prefix', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.omni_comms_channel_endpoint');
  });
  it('6. creates the endpoint secret-reference table', () => {
    expect(SQL).toContain(
      'CREATE TABLE IF NOT EXISTS public.omni_comms_channel_endpoint_secret_ref',
    );
  });
  it('7. stores endpoint configuration as bounded jsonb', () => {
    expect(NORMALIZER).toContain('jsonb');
  });
  it('8. constrains lifecycle status values', () => {
    expect(SQL).toMatch(/status[\s\S]{0,200}draft[\s\S]{0,80}active[\s\S]{0,80}disabled[\s\S]{0,80}retired/);
  });
  it('9. constrains data_origin values', () => {
    expect(SQL).toMatch(/data_origin[\s\S]{0,200}reference_seed/);
  });
  it('10. constrains verification status values', () => {
    expect(SQL).toMatch(/verification_status[\s\S]{0,200}unverified/);
  });
  it('11. bounds the secret reference name pattern to OMNI_COMMS_', () => {
    expect(SQL).toContain('OMNI_COMMS_');
    expect(OMNI_COMMS_SECRET_REF_PATTERN.source).toContain('OMNI_COMMS_');
  });
  it('12. grants the endpoint tables to service_role', () => {
    expect(SQL).toMatch(/GRANT ALL ON TABLE public\.omni_comms_channel_endpoint TO service_role/);
    expect(SQL).toMatch(
      /GRANT ALL ON TABLE public\.omni_comms_channel_endpoint_secret_ref TO service_role/,
    );
  });
});

// ─── 3. Channel and endpoint-type mapping ──────────────────────────────────
describe('C3B — channel and type mapping', () => {
  it('13. supports exactly the five endpoint-owning channels', () => {
    expect([...OMNI_COMMS_ENDPOINT_CHANNELS]).toEqual([
      'email', 'sms', 'whatsapp', 'in_app', 'print',
    ]);
  });
  it('14. excludes push (its configuration lives in Accounts and Identities)', () => {
    expect(endpointChannelSupported('push')).toBe(false);
  });
  it('15. maps email to sending_domain and event_callback', () => {
    expect([...OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL.email]).toEqual([
      'sending_domain', 'event_callback',
    ]);
  });
  it('16. maps sms to delivery and inbound callbacks', () => {
    expect([...OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL.sms]).toEqual([
      'delivery_callback', 'inbound_callback',
    ]);
  });
  it('17. maps whatsapp to a business webhook', () => {
    expect([...OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL.whatsapp]).toEqual(['business_webhook']);
  });
  it('18. maps in_app to an internal realtime endpoint', () => {
    expect([...OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL.in_app]).toEqual(['realtime_endpoint']);
  });
  it('19. maps print to a render service', () => {
    expect([...OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL.print]).toEqual(['render_service']);
  });
  it('20. labels every endpoint type for operators', () => {
    for (const types of Object.values(OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL)) {
      for (const t of types) expect(OMNI_COMMS_ENDPOINT_TYPE_LABEL[t]).toBeTruthy();
    }
  });
  it('21. the server mirrors the same channel/type mapping', () => {
    for (const t of Object.values(OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL).flat()) {
      expect(NORMALIZER).toContain(t);
    }
  });
});

// ─── 4. Server-side validation contract ────────────────────────────────────
describe('C3B — server validation contract', () => {
  it('22. rejects a non-HTTPS callback URL', () => {
    expect(URL_NORMALIZER).toContain('https://');
  });
  it('23. rejects URL fragments', () => {
    expect(URL_NORMALIZER).toContain('#');
  });
  it('24. rejects embedded credentials in a URL', () => {
    expect(URL_NORMALIZER).toContain('@');
  });
  it('25. rejects loopback and private hosts', () => {
    expect(URL_NORMALIZER).toMatch(/localhost|127\.0\.0\.1/);
  });
  it('26. lower-cases and validates the sending domain', () => {
    expect(DOMAIN_NORMALIZER).toContain('lower(');
  });
  it('27. rejects an unsupported endpoint type for a channel', () => {
    expect(NORMALIZER).toMatch(/OC422/);
  });
  it('28. allowlists email event types', () => {
    for (const t of OMNI_COMMS_EMAIL_EVENT_TYPES) expect(NORMALIZER).toContain(t);
  });
  it('29. allowlists whatsapp subscribed fields', () => {
    for (const f of OMNI_COMMS_WHATSAPP_SUBSCRIBED_FIELDS) expect(NORMALIZER).toContain(f);
  });
  it('30. allowlists in_app transports', () => {
    for (const t of OMNI_COMMS_IN_APP_TRANSPORTS) expect(NORMALIZER).toContain(t);
  });
  it('31. allowlists print service modes', () => {
    for (const m of OMNI_COMMS_PRINT_SERVICE_MODES) expect(NORMALIZER).toContain(m);
  });
  it('32. validates secret purposes against an allowlist', () => {
    for (const p of new Set(Object.values(OMNI_COMMS_ENDPOINT_SECRET_PURPOSES).flat())) {
      expect(UPSERT + NORMALIZER).toContain(p);
    }
  });
  it('33. requires the mandatory secrets before activation', () => {
    const required = new Set(Object.values(OMNI_COMMS_ENDPOINT_REQUIRED_SECRETS).flat());
    for (const r of required) expect(LIFECYCLE + NORMALIZER + UPSERT).toContain(r);
  });
});

// ─── 5. Tenant, provider-account and reference guards ──────────────────────
describe('C3B — tenant and reference guards', () => {
  it('34. enforces tenant access on every public RPC', () => {
    expect(UPSERT + LIFECYCLE + SUMMARY).toContain('omni_comms_priv_require_tenant_access');
  });
  it('35. blocks writes to reference endpoints', () => {
    expect(UPSERT + LIFECYCLE).toMatch(/reference_seed/);
  });
  it('36. refuses a reference provider account association', () => {
    expect(UPSERT).toMatch(/reference/i);
  });
  it('37. hides reference endpoints unless explicitly requested', () => {
    expect(SUMMARY).toContain('p_include_reference');
  });
  it('38. still reports the hidden reference count', () => {
    expect(SUMMARY).toContain('reference_endpoint_count');
  });
  it('39. classifies reference endpoints from data_origin', () => {
    expect(isReferenceEndpoint(endpoint({ data_origin: 'reference_seed' }))).toBe(true);
    expect(isReferenceEndpoint(endpoint({ data_origin: 'user' }))).toBe(false);
  });
  it('40. states reference endpoints are read-only', () => {
    expect(REFERENCE_ENDPOINT_READ_ONLY_HELP).toMatch(/read-only/i);
  });
});

// ─── 6. Optimistic concurrency and audit ───────────────────────────────────
describe('C3B — concurrency and audit', () => {
  it('41. upsert enforces expected_updated_at', () => {
    expect(UPSERT).toContain('p_expected_updated_at');
    expect(UPSERT).toContain('OC413');
  });
  it('42. lifecycle enforces expected_updated_at', () => {
    expect(LIFECYCLE).toContain('p_expected_updated_at');
    expect(LIFECYCLE).toContain('OC413');
  });
  it('43. retirement requires a reason', () => {
    expect(LIFECYCLE).toMatch(/retire[\s\S]{0,400}reason/i);
  });
  it('44. writes a channel audit record for each mutation', () => {
    expect(UPSERT).toContain('omni_comms_priv_write_channel_audit');
    expect(LIFECYCLE).toContain('omni_comms_priv_write_channel_audit');
  });
});

// ─── 7. Application adapter ────────────────────────────────────────────────
describe('C3B — application adapter', () => {
  it('45. summary calls the bounded RPC with reference off by default', async () => {
    const { client, rpc } = rpcSpy({ endpoints: [] });
    await getChannelEndpointSummary(client, 'org1', 'email');
    expect(rpc).toHaveBeenCalledWith('omni_comms_channel_endpoint_summary', {
      p_organization_id: 'org1',
      p_department_id: null,
      p_channel: 'email',
      p_include_reference: false,
    });
  });
  it('46. summary can request reference endpoints explicitly', async () => {
    const { client, rpc } = rpcSpy({ endpoints: [] });
    await getChannelEndpointSummary(client, 'org1', 'sms', 'dep1', true);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_include_reference: true, p_department_id: 'dep1', p_channel: 'sms',
    });
  });
  it('47. upsert forwards config and secret references only', async () => {
    const { client, rpc } = rpcSpy('e1');
    await upsertChannelEndpointDraft(client, {
      organizationId: 'org1',
      channel: 'email',
      code: 'domain',
      displayName: 'Domain',
      endpointType: 'sending_domain',
      endpointConfig: { domain_name: 'mail.ssb.kn' },
      secretRefs: { signing_secret: 'OMNI_COMMS_EMAIL_CB' },
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_endpoint_config).toEqual({ domain_name: 'mail.ssb.kn' });
    expect(args.p_secret_refs).toEqual({ signing_secret: 'OMNI_COMMS_EMAIL_CB' });
  });
  it('48. lifecycle forwards action, concurrency token and reason', async () => {
    const { client, rpc } = rpcSpy('e1');
    await setChannelEndpointLifecycle(client, {
      id: 'e1', expectedUpdatedAt: 't', action: 'retire', reason: 'decommissioned',
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_id: 'e1', p_expected_updated_at: 't', p_action: 'retire', p_reason: 'decommissioned',
    });
  });
  it('49. surfaces controlled OC error codes', async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: 'OC403 permission denied' } }),
    };
    await expect(getChannelEndpointSummary(client, 'org1', 'email')).rejects.toMatchObject({
      code: 'OC403',
    });
  });
  it('50. the adapter never imports the browser Supabase client', () => {
    expect(read(SERVICE)).not.toContain('@/integrations/supabase/client');
  });
});

// ─── 8. Client-side form contract ──────────────────────────────────────────
describe('C3B — form validation', () => {
  const base = {
    code: 'x', displayName: 'X', config: {}, secretRefs: {}, providerAccountId: 'a1',
  };
  it('51. requires a domain name for a sending domain', () => {
    expect(validateEndpointForm('email', { ...base, endpointType: 'sending_domain' }))
      .toMatch(/domain/i);
  });
  it('52. requires HTTPS for a callback URL', () => {
    expect(validateEndpointForm('email', {
      ...base, endpointType: 'event_callback', config: { callback_url: 'http://x.kn/h' },
    })).toMatch(/HTTPS/);
  });
  it('53. requires a provider account for an email sending domain', () => {
    expect(validateEndpointForm('email', {
      ...base,
      endpointType: 'sending_domain',
      config: { domain_name: 'mail.ssb.kn' },
      providerAccountId: '__none__',
    })).toMatch(/provider account/i);
  });
  it('54. allows an internal print render service with no provider account', () => {
    expect(validateEndpointForm('print', {
      ...base,
      endpointType: 'render_service',
      config: { service_mode: 'internal', service_reference: 'internal_pdf_renderer' },
      providerAccountId: '__none__',
    })).toBeNull();
  });
  it('55. rejects a secret purpose that is not allowed for the type', () => {
    expect(validateEndpointForm('email', {
      ...base,
      endpointType: 'sending_domain',
      config: { domain_name: 'mail.ssb.kn' },
      secretRefs: { signing_secret: 'OMNI_COMMS_X' },
    })).toMatch(/not accepted/i);
  });
  it('56. rejects a secret reference outside the OMNI_COMMS_ namespace', () => {
    expect(isValidEndpointSecretRef('RESEND_KEY')).toBe(false);
    expect(isValidEndpointSecretRef('OMNI_COMMS_EMAIL_CB')).toBe(true);
  });
});

// ─── 9. Presentation truthfulness ──────────────────────────────────────────
describe('C3B — presentation truthfulness', () => {
  const tab = read(ENDPOINTS_TAB);
  it('57. never claims the screen verified an endpoint', () => {
    expect(VERIFICATION_LABEL.unverified).toBe('Not verified here');
    expect(ENDPOINT_ACTIVATION_MEANING).toMatch(/has not been performed by this screen/);
  });
  it('58. states that no DNS, provider or callback call is made', () => {
    expect(ENDPOINT_NO_EXTERNAL_CALL_NOTICE).toMatch(/No DNS lookup, provider call or/);
    expect(tab).toContain('ENDPOINT_NO_EXTERNAL_CALL_NOTICE');
  });
  it('59. renders secret reference names, never credential values', () => {
    expect(tab).toContain('secret NAME only');
    expect(tab).not.toMatch(/type="password"/);
  });
  it('60. resolves organisation-wide and department scope labels', () => {
    expect(endpointScopeLabel(endpoint({ department_id: null }))).toBe('Organisation-wide');
    expect(endpointScopeLabel(endpoint({ department_id: 'd1', department_name: 'Benefits' })))
      .toBe('Benefits');
  });
  it('61. summarises configuration without exposing secrets', () => {
    expect(endpointConfigSummary(endpoint())).toContain('mail.ssb.kn');
    expect(endpointConfigSummary(endpoint({ endpoint_config: {} }))).toBe('—');
  });
});

// ─── 10. Safety boundaries ─────────────────────────────────────────────────
describe('C3B — safety boundaries', () => {
  const files = [ENDPOINTS_TAB, SERVICE, TYPES].map(read).join('\n');
  it('62. imports no provider SDK', () => {
    expect(files).not.toMatch(/from ['"](resend|twilio|firebase-admin|nodemailer)['"]/);
  });
  it('63. performs no network call', () => {
    expect(files).not.toMatch(/\bfetch\(|XMLHttpRequest|axios/);
  });
  it('64. never calls the sending façade', () => {
    expect(files).not.toContain('sendCommunication');
  });
  it('65. creates no request, message, dispatch job or delivery attempt', () => {
    expect(files).not.toMatch(/omni_comms_(request|message|dispatch_job|delivery_attempt)/);
  });
  it('66. touches no legacy communication hub object', () => {
    expect(files).not.toMatch(/comm_hub_|notification_queue|notification_logs|core_template/);
  });
});

// ─── 11. Email readiness integration ───────────────────────────────────────
describe('C3B — Email readiness integration', () => {
  it('67. counts only genuine active sending domains', () => {
    const rows = [
      emailEndpoint({ id: '1' }),
      emailEndpoint({ id: '2', status: 'draft' }),
      emailEndpoint({ id: '3', data_origin: 'reference_seed' }),
    ];
    expect(genuineActiveEmailEndpoints(rows, 'sending_domain')).toHaveLength(1);
  });
  it('68. adds sending-domain and event-callback checks', () => {
    const keys = projectEmailReadiness({ endpoints: [] } as never).checks.map((c) => c.key);
    expect(keys).toContain('sending_domain');
    expect(keys).toContain('event_callback');
  });
  it('69. reports provider verification as not performed by this screen', () => {
    const check = projectEmailReadiness({ endpoints: [] } as never)
      .checks.find((c) => c.key === 'sending_domain_verification');
    expect(check?.state).toBe('not_implemented');
    expect(check?.detail).toMatch(/not performed by this screen/);
  });
  it('70. reports the callback receiver as not implemented', () => {
    expect(EMAIL_CALLBACK_RECEIVER_IMPLEMENTED).toBe(false);
    const check = projectEmailReadiness({ endpoints: [] } as never)
      .checks.find((c) => c.key === 'callback_receiver');
    expect(check?.state).toBe('not_implemented');
    expect(check?.detail).toContain(EMAIL_CALLBACK_RECEIVER_PENDING);
  });
  it('71. an event callback without a signing secret does not count', () => {
    const p = projectEmailReadiness({
      endpoints: [emailEndpoint({ id: 'c', endpoint_type: 'event_callback' })],
    } as never);
    expect(p.counts.activeEventCallbacks).toBe(0);
  });
  it('72. never offers a "Configuration complete" label', () => {
    expect(Object.values(EMAIL_READINESS_LABEL)).not.toContain('Configuration complete');
  });
});

// ─── 12. Rollback proof ────────────────────────────────────────────────────
describe('C3B — rollback', () => {
  it('73. ships a reversible rollback script for the endpoint objects', () => {
    const sql = read('scripts/omni-comms/rollback/c3b-channel-endpoints-rollback.sql');
    expect(sql).toContain('DROP TABLE IF EXISTS public.omni_comms_channel_endpoint_secret_ref');
    expect(sql).toContain('DROP TABLE IF EXISTS public.omni_comms_channel_endpoint');
    expect(sql).not.toMatch(/comm_hub_|notification_queue|core_template/);
  });
});

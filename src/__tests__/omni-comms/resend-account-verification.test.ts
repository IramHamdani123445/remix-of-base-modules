import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  runProviderVerification,
  probeResendCredential,
  statusForResult,
  detailForResult,
  SECRET_REF_PATTERN,
} from '../../../supabase/functions/omni-comms-runtime/providerVerification';

const EDGE_SRC = 'supabase/functions/omni-comms-runtime/providerVerification.ts';
const UI_SRC = 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx';
const CLIENT_SRC = 'src/platform/omni-comms/application/providerVerificationService.ts';

const OK_CTX = {
  allowed: true,
  code: 'ok',
  account_id: 'acc-1',
  account_code: 'RESEND_PRIMARY',
  secret_ref: 'OMNI_COMMS_RESEND_PRIMARY',
  status: 'draft',
  sandbox_mode: true,
  updated_at: '2026-01-01T00:00:00Z',
};

function makeAdmin(opts: {
  ctx?: unknown;
  ctxError?: unknown;
  rec?: unknown;
  recError?: unknown;
  calls?: Array<{ fn: string; args: Record<string, unknown> }>;
}) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      opts.calls?.push({ fn, args });
      if (fn === 'omni_comms_priv_provider_account_verification_context') {
        return { data: opts.ctx ?? OK_CTX, error: opts.ctxError ?? null };
      }
      return {
        data: opts.rec ?? {
          allowed: true,
          code: 'ok',
          verification_status: (args.p_status as string),
          verification_result_code: args.p_result_code,
          verification_detail: args.p_detail,
          verification_checked_at: '2026-01-02T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
        error: opts.recError ?? null,
      };
    },
  };
}

const REQ = {
  actorId: 'user-1',
  organizationId: 'org-1',
  providerAccountId: 'acc-1',
};

function fetchWithStatus(status: number): typeof fetch {
  return (async () => new Response('{}', { status })) as unknown as typeof fetch;
}

describe('Omni-Comms Step 1 — Resend credential verification', () => {
  it('denies an actor without omni_comms.configure', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ ctx: { allowed: false, code: 'permission_denied' } }),
      getSecret: () => 'x',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('permission_denied');
  });

  it('denies an actor from another organisation', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ ctx: { allowed: false, code: 'organization_access_denied' } }),
      getSecret: () => 'x',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('organization_access_denied');
  });

  it('denies a missing account', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ ctx: { allowed: false, code: 'not_found' } }),
      getSecret: () => 'x',
    });
    expect(res.status).toBe(404);
  });

  it('handles a missing secret reference as configuration_incomplete', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ ctx: { ...OK_CTX, secret_ref: 'not a ref' } }),
      getSecret: () => 'x',
    });
    expect(res.body.code).toBe('configuration_incomplete');
  });

  it('handles a missing Edge secret', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({}),
      getSecret: () => undefined,
    });
    expect(res.body.code).toBe('secret_missing');
    expect(res.body.verificationStatus).toBe('failed');
  });

  it('handles invalid credentials', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({}),
      getSecret: () => 're_test',
      fetchImpl: fetchWithStatus(401),
    });
    expect(res.body.code).toBe('invalid_credentials');
  });

  it('handles provider unavailable', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({}),
      getSecret: () => 're_test',
      fetchImpl: fetchWithStatus(503),
    });
    expect(res.body.code).toBe('provider_unavailable');
  });

  it('handles rate limiting', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({}),
      getSecret: () => 're_test',
      fetchImpl: fetchWithStatus(429),
    });
    expect(res.body.code).toBe('rate_limited');
  });

  it('persists a verified result', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ calls }),
      getSecret: () => 're_test',
      fetchImpl: fetchWithStatus(200),
    });
    expect(res.body.ok).toBe(true);
    expect(res.body.verificationStatus).toBe('verified');
    const rec = calls.find((c) => c.fn === 'omni_comms_priv_record_provider_verification');
    expect(rec?.args.p_result_code).toBe('verified');
    expect(rec?.args.p_status).toBe('verified');
  });

  it('never returns or persists API-key material', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const secret = 're_super_secret_key_value';
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ calls }),
      getSecret: () => secret,
      fetchImpl: fetchWithStatus(200),
    });
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(JSON.stringify(calls)).not.toContain(secret);
  });

  it('never logs API-key material', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secret = 're_never_logged_value';
    await runProviderVerification(REQ, {
      admin: makeAdmin({}),
      getSecret: () => secret,
      fetchImpl: fetchWithStatus(200),
    });
    const logged = [...spy.mock.calls, ...errSpy.mock.calls].flat().join(' ');
    expect(logged).not.toContain(secret);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('sends no email: the probe only performs a read-only GET', async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await probeResendCredential('re_test', fakeFetch);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('GET');
    expect(seen[0].url).toBe('https://api.resend.com/domains');
    expect(seen[0].url).not.toContain('/emails');
  });

  it('creates no delivery attempt and no dispatch job', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ calls }),
      getSecret: () => 're_test',
      fetchImpl: fetchWithStatus(200),
    });
    const fns = calls.map((c) => c.fn);
    expect(fns).toEqual([
      'omni_comms_priv_provider_account_verification_context',
      'omni_comms_priv_record_provider_verification',
    ]);
    expect(res.body.deliveryAttemptsCreated).toBe(0);
    expect(res.body.dispatchJobsCreated).toBe(0);
    expect(res.body.emailsSent).toBe(0);
  });

  it('manual health state is not treated as provider verification', () => {
    const ui = readFileSync(UI_SRC, 'utf8');
    expect(ui).toContain('not provider verified');
    expect(ui).not.toMatch(/>\s*Mark healthy\s*</);
    const edge = readFileSync(EDGE_SRC, 'utf8');
    expect(edge).not.toContain('health_state');
  });

  it('live delivery remains unavailable in this surface', () => {
    const edge = readFileSync(EDGE_SRC, 'utf8');
    expect(edge).not.toMatch(/live_delivery_enabled\s*[:=]\s*true/);
    const client = readFileSync(CLIENT_SRC, 'utf8');
    expect(client).not.toMatch(/liveDelivery(Enabled)?\s*[:=]\s*true/);
    const ui = readFileSync(UI_SRC, 'utf8');
    expect(ui).toContain('Live delivery remains unavailable');
  });

  it('exports bounded helpers', () => {
    expect(statusForResult('verified')).toBe('verified');
    expect(statusForResult('rate_limited')).toBe('failed');
    expect(detailForResult('secret_missing').length).toBeLessThanOrEqual(200);
    expect(SECRET_REF_PATTERN.test('OMNI_COMMS_RESEND_PRIMARY')).toBe(true);
    expect(SECRET_REF_PATTERN.test('lowercase')).toBe(false);
  });
});

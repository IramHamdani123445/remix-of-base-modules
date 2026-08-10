/**
 * Omni-Comms — read-only Resend sending-domain probe.
 *
 * Proves the probe is parse-only and never surfaces credential material.
 */
import { describe, expect, it } from 'vitest';
import {
  parseResendDomains,
  probeResendDomains,
} from '../../../supabase/functions/omni-comms-runtime/providerVerification.ts';

describe('parseResendDomains', () => {
  it('returns bounded name/status pairs', () => {
    expect(
      parseResendDomains({
        data: [
          { id: 'x', name: 'SecureServe.biz', status: 'Verified', region: 'us-east-1' },
          { name: '', status: 'pending' },
          null,
        ],
      }),
    ).toEqual([{ name: 'secureserve.biz', status: 'verified', region: 'us-east-1' }]);
  });

  it('returns an empty list for unexpected payloads', () => {
    expect(parseResendDomains(null)).toEqual([]);
    expect(parseResendDomains({})).toEqual([]);
  });
});

describe('probeResendDomains', () => {
  const res = (status: number, body?: unknown) =>
    ({ status, json: async () => body }) as unknown as Response;

  it('maps a rejected key to invalid_credentials without domains', async () => {
    const out = await probeResendDomains('k', (async () => res(401)) as unknown as typeof fetch);
    expect(out).toEqual({ resultCode: 'invalid_credentials', domains: [] });
  });

  it('maps rate limiting and outages without domains', async () => {
    expect((await probeResendDomains('k', (async () => res(429)) as unknown as typeof fetch)).resultCode)
      .toBe('rate_limited');
    expect((await probeResendDomains('k', (async () => res(500)) as unknown as typeof fetch)).resultCode)
      .toBe('provider_unavailable');
    expect(
      (await probeResendDomains('k', (async () => { throw new Error('net'); }) as unknown as typeof fetch))
        .resultCode,
    ).toBe('provider_unavailable');
  });

  it('reports domains only on a successful read', async () => {
    const out = await probeResendDomains(
      'k',
      (async () => res(200, { data: [{ name: 'secureserve.biz', status: 'verified' }] })) as unknown as typeof fetch,
    );
    expect(out).toEqual({
      resultCode: 'verified',
      domains: [{ name: 'secureserve.biz', status: 'verified', region: null }],
    });
  });
});

/**
 * Omni-Comms — bounded Resend credential classification.
 *
 * Proves a sending-access (restricted) key is never misreported as an invalid
 * credential, that the probe is read-only, and that no key material leaks.
 */
import { describe, expect, it } from 'vitest';
import {
  OMNI_COMMS_USER_AGENT,
  classifyResendResponse,
  readProviderErrorCode,
  resendDomainsRequest,
  probeResendCredential,
  probeResendDomains,
  statusForResult,
} from '../../../supabase/functions/omni-comms-runtime/providerVerification.ts';

function fetchOf(status: number, body: unknown, seen?: Array<{ url: string; init?: RequestInit }>) {
  return (async (url: string, init?: RequestInit) => {
    seen?.push({ url: String(url), init });
    return { status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('Resend probe request shape', () => {
  it('sends a bounded non-sensitive User-Agent and only a GET to /domains', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await resendDomainsRequest('re_secret_value', fetchOf(200, { data: [] }, seen));
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.resend.com/domains');
    expect(seen[0].init?.method).toBe('GET');
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(OMNI_COMMS_USER_AGENT);
    expect(headers.Accept).toBe('application/json');
    expect(OMNI_COMMS_USER_AGENT).not.toMatch(/@|re_/);
  });

  it('never calls a provider email send endpoint', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await probeResendCredential('re_k', fetchOf(200, { data: [] }, seen));
    await probeResendDomains('re_k', fetchOf(200, { data: [] }, seen));
    expect(seen.every((s) => !s.url.includes('/emails'))).toBe(true);
    expect(seen.every((s) => s.init?.method === 'GET')).toBe(true);
  });

  it('keeps Authorization server-side and out of the returned projection', async () => {
    const out = await resendDomainsRequest('re_super_secret', fetchOf(401, {
      name: 'invalid_api_key',
      message: 'API key is invalid',
    }));
    expect(JSON.stringify(out)).not.toContain('re_super_secret');
    expect(JSON.stringify(out)).not.toContain('Authorization');
  });
});

describe('classifyResendResponse', () => {
  it('maps 200 to verified', () => {
    expect(classifyResendResponse({ httpStatus: 200, providerErrorCode: null })).toBe('verified');
  });

  it('maps a restricted sending-only key separately from an invalid key', () => {
    expect(classifyResendResponse({ httpStatus: 401, providerErrorCode: 'restricted_api_key' }))
      .toBe('restricted_api_key');
    expect(classifyResendResponse({ httpStatus: 403, providerErrorCode: null }))
      .toBe('restricted_api_key');
    expect(statusForResult('restricted_api_key')).toBe('pending');
  });

  it('maps a genuinely invalid key to invalid_credentials', () => {
    expect(classifyResendResponse({ httpStatus: 401, providerErrorCode: 'invalid_api_key' }))
      .toBe('invalid_credentials');
    expect(classifyResendResponse({ httpStatus: 401, providerErrorCode: 'missing_api_key' }))
      .toBe('invalid_credentials');
    expect(statusForResult('invalid_credentials')).toBe('failed');
  });

  it('never labels a malformed/rejected request as an invalid credential', () => {
    expect(classifyResendResponse({ httpStatus: 422, providerErrorCode: 'validation_error' }))
      .toBe('request_rejected');
    expect(classifyResendResponse({ httpStatus: 400, providerErrorCode: null }))
      .toBe('request_rejected');
    expect(statusForResult('request_rejected')).toBe('pending');
  });

  it('maps rate limiting and outages', () => {
    expect(classifyResendResponse({ httpStatus: 429, providerErrorCode: null })).toBe('rate_limited');
    expect(classifyResendResponse({ httpStatus: 503, providerErrorCode: null }))
      .toBe('provider_unavailable');
  });
});

describe('readProviderErrorCode', () => {
  it('reads only a bounded provider error name', () => {
    expect(readProviderErrorCode({ name: 'Restricted_API_Key' })).toBe('restricted_api_key');
    expect(readProviderErrorCode({ error: { name: 'validation_error' } })).toBe('validation_error');
    expect(readProviderErrorCode({ name: 'x'.repeat(200) })).toHaveLength(64);
    expect(readProviderErrorCode({ name: 'has spaces' })).toBeNull();
    expect(readProviderErrorCode(null)).toBeNull();
  });
});

describe('probes end-to-end', () => {
  it('restricted key returns no domains and is not a failed credential', async () => {
    const out = await probeResendDomains('re_k', fetchOf(401, { name: 'restricted_api_key' }));
    expect(out).toMatchObject({ resultCode: 'restricted_api_key', domains: [], providerErrorCode: 'restricted_api_key' });
  });

  it('network failure maps to provider_unavailable', async () => {
    const failing = (async () => { throw new Error('net'); }) as unknown as typeof fetch;
    expect((await probeResendCredential('re_k', failing)).resultCode).toBe('provider_unavailable');
    expect((await probeResendDomains('re_k', failing)).resultCode).toBe('provider_unavailable');
  });
});

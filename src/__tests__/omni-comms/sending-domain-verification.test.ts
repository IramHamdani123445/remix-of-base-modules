/**
 * Omni-Comms — external sending-domain verification with server DNS evidence.
 *
 * Static and unit proof only: no provider is contacted, no DNS resolver is
 * reached (fetch is injected), and no email is sent.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  collectDnsEvidence,
  dnsValueMatches,
  expectationsAreExact,
  isSafeDnsName,
  normaliseDnsValue,
  parseExpectedDnsRecords,
  parseMxAnswer,
  runSendingDomainVerification,
  type ExpectedDnsRecord,
} from '../../../supabase/functions/omni-comms-runtime/domainDnsVerification';

import {
  resendExpectedDnsRecords,
  DOMAIN_VERIFICATION_SOURCE_LABELS,
  DOMAIN_VERIFICATION_STATUS_LABELS,
} from '@/platform/omni-comms/application/domainVerificationService';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';

const read = (p: string) => readFileSync(p, 'utf8');
const SERVICE = 'src/platform/omni-comms/application/domainVerificationService.ts';
const UI = 'src/platform/omni-comms/admin/views/channels/SendingDomainVerificationSection.tsx';
const EDGE = 'supabase/functions/omni-comms-runtime/domainDnsVerification.ts';

function dohResponder(map: Record<string, string[]>) {
  return async (url: string): Promise<Response> => {
    const name = decodeURIComponent(new URL(url).searchParams.get('name') ?? '');
    const type = new URL(url).searchParams.get('type') ?? '';
    const answers = map[`${name}|${type}`] ?? [];
    return new Response(
      JSON.stringify(answers.length ? { Answer: answers.map((d) => ({ data: d })) } : {}),
      { status: 200 },
    );
  };
}

const EXACT_FACTS = {
  spfValue: 'v=spf1 include:amazonses.com ~all',
  mxHost: 'feedback-smtp.eu-west-1.amazonses.com',
  mxPriority: 10,
  dkimSelector: 'resend',
  dkimValue: 'p=MIGfMA0GCS',
};

describe('DNS value handling', () => {
  it('normalises quoted, chunked and dot-terminated answers', () => {
    expect(normaliseDnsValue('"v=spf1 include:amazonses.com ~all"'))
      .toBe('v=spf1 include:amazonses.com ~all');
    expect(normaliseDnsValue('"p=AAA" "BBB"')).toBe('p=AAABBB');
    expect(normaliseDnsValue('10 feedback-smtp.eu-west-1.amazonses.com.'))
      .toBe('10 feedback-smtp.eu-west-1.amazonses.com');
  });

  it('matches by contains and equals, case-insensitively', () => {
    expect(dnsValueMatches('v=spf1 include:amazonses.com ~all', 'include:amazonses.com', 'contains')).toBe(true);
    expect(dnsValueMatches('v=spf1 include:other.com ~all', 'include:amazonses.com', 'contains')).toBe(false);
    expect(dnsValueMatches('"abc"', 'ABC', 'equals')).toBe(true);
    expect(dnsValueMatches('abcd', 'abc', 'equals')).toBe(false);
  });

  it('compares exact TXT values without accepting a superset', () => {
    expect(dnsValueMatches(
      '"v=spf1 include:amazonses.com ~all"',
      'v=spf1 include:amazonses.com ~all',
      'exact_txt',
    )).toBe(true);
    // A generic "contains" would have accepted this; exact matching does not.
    expect(dnsValueMatches(
      '"v=spf1 include:amazonses.com include:elsewhere.test ~all"',
      'v=spf1 include:amazonses.com ~all',
      'exact_txt',
    )).toBe(false);
  });

  it('compares MX host AND priority exactly', () => {
    expect(parseMxAnswer('10 feedback-smtp.eu-west-1.amazonses.com.'))
      .toEqual({ priority: 10, host: 'feedback-smtp.eu-west-1.amazonses.com' });
    expect(dnsValueMatches(
      '10 feedback-smtp.eu-west-1.amazonses.com.',
      'feedback-smtp.eu-west-1.amazonses.com',
      'exact_mx',
      10,
    )).toBe(true);
    expect(dnsValueMatches(
      '20 feedback-smtp.eu-west-1.amazonses.com.',
      'feedback-smtp.eu-west-1.amazonses.com',
      'exact_mx',
      10,
    )).toBe(false);
    expect(dnsValueMatches(
      '10 feedback-smtp.us-east-1.amazonses.com.',
      'feedback-smtp.eu-west-1.amazonses.com',
      'exact_mx',
      10,
    )).toBe(false);
  });

  it('accepts only plain hostnames as lookup targets', () => {
    expect(isSafeDnsName('send.secureserve.biz')).toBe(true);
    expect(isSafeDnsName('resend._domainkey.secureserve.biz')).toBe(true);
    expect(isSafeDnsName('http://evil.test/x')).toBe(false);
    expect(isSafeDnsName('169.254.169.254/latest')).toBe(false);
    expect(isSafeDnsName('')).toBe(false);
  });

  it('drops malformed expectations instead of resolving them', () => {
    const parsed = parseExpectedDnsRecords([
      { recordType: 'txt', name: 'send.example.org', expectedValue: 'include:x', matchMode: 'contains' },
      { recordType: 'TXT', name: 'http://evil.test', expectedValue: 'x' },
      { recordType: 'SRV', name: 'send.example.org', expectedValue: 'x' },
      { recordType: 'TXT', name: 'send.example.org', expectedValue: '' },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ recordType: 'TXT', required: true, matchMode: 'contains' });
  });

  it('carries the exact MX priority through parsing', () => {
    const parsed = parseExpectedDnsRecords([
      {
        recordType: 'MX',
        name: 'send.example.org',
        expectedValue: 'feedback-smtp.eu-west-1.amazonses.com',
        matchMode: 'exact_mx',
        expectedPriority: 10,
      },
    ]);
    expect(parsed[0]).toMatchObject({ matchMode: 'exact_mx', expectedPriority: 10 });
  });
});

describe('exact expectation gate', () => {
  it('builds exact expectations from provider facts only', () => {
    const records = resendExpectedDnsRecords('Example.org', EXACT_FACTS);
    expect(records.map((r) => r.matchMode)).toEqual(['exact_txt', 'exact_mx', 'exact_txt']);
    expect(records[1]).toMatchObject({ expectedPriority: 10 });
    expect(records[2].name).toBe('resend._domainkey.example.org');
    expect(expectationsAreExact(records)).toBe(true);
  });

  it('rejects legacy generic expectations as evidence', () => {
    expect(expectationsAreExact([
      {
        recordType: 'TXT',
        name: 'send.example.org',
        expectedValue: 'include:amazonses.com',
        matchMode: 'contains',
        required: true,
      },
    ])).toBe(false);
    expect(expectationsAreExact([])).toBe(false);
  });
});

describe('server-observed DNS evidence', () => {
  const expected = resendExpectedDnsRecords('example.org', EXACT_FACTS) as ExpectedDnsRecord[];

  it('verifies only when every required record matches', async () => {
    const outcome = await collectDnsEvidence(expected, dohResponder({
      'send.example.org|16': ['"v=spf1 include:amazonses.com ~all"'],
      'send.example.org|15': ['10 feedback-smtp.eu-west-1.amazonses.com.'],
      'resend._domainkey.example.org|16': ['"p=MIGfMA0GCS"'],
    }));
    expect(outcome.allMatched).toBe(true);
    expect(outcome.resultCode).toBe('verified');
    expect(outcome.expectationsExact).toBe(true);
    expect(outcome.evidence.every((e) => e.matched)).toBe(true);
  });

  it('rejects a near-miss that a generic match would have accepted', async () => {
    const outcome = await collectDnsEvidence(expected, dohResponder({
      'send.example.org|16': ['"v=spf1 include:amazonses.com include:other.test ~all"'],
      'send.example.org|15': ['20 feedback-smtp.eu-west-1.amazonses.com.'],
      'resend._domainkey.example.org|16': ['"p=SOMETHINGELSE"'],
    }));
    expect(outcome.allMatched).toBe(false);
    expect(outcome.resultCode).toBe('dns_mismatch');
  });

  it('flags generic expectations even when they all match', async () => {
    const outcome = await collectDnsEvidence(
      [{
        recordType: 'TXT',
        name: 'send.example.org',
        expectedValue: 'include:amazonses.com',
        matchMode: 'contains',
        required: true,
      }],
      dohResponder({ 'send.example.org|16': ['"v=spf1 include:amazonses.com ~all"'] }),
    );
    expect(outcome.allMatched).toBe(true);
    expect(outcome.expectationsExact).toBe(false);
    expect(outcome.detail).toMatch(/not accepted as/i);
  });

  it('reports missing records rather than assuming success', async () => {
    const outcome = await collectDnsEvidence(expected, dohResponder({
      'send.example.org|16': ['"v=spf1 include:amazonses.com ~all"'],
    }));
    expect(outcome.allMatched).toBe(false);
    expect(outcome.resultCode).toBe('dns_records_missing');
    expect(outcome.evidence.filter((e) => e.matched)).toHaveLength(1);
  });

  it('reports a mismatch distinctly from a missing record', async () => {
    const outcome = await collectDnsEvidence(expected, dohResponder({
      'send.example.org|16': ['"v=spf1 include:someoneelse.com ~all"'],
      'send.example.org|15': ['10 feedback-smtp.eu-west-1.amazonses.com.'],
      'resend._domainkey.example.org|16': ['"p=MIGfMA0GCS"'],
    }));
    expect(outcome.resultCode).toBe('dns_mismatch');
  });

  it('never claims success when the resolver is unreachable', async () => {
    const outcome = await collectDnsEvidence(expected, async () => { throw new Error('offline'); });
    expect(outcome.allMatched).toBe(false);
    expect(outcome.resultCode).toBe('dns_lookup_failed');
  });

  it('refuses to verify when no expectation was recorded', async () => {
    const outcome = await collectDnsEvidence([], dohResponder({}));
    expect(outcome.resultCode).toBe('dns_records_missing');
  });
});

describe('verification request handler', () => {
  const okCtx = {
    allowed: true,
    code: 'ok',
    domain_name: 'example.org',
    verification_source: 'external_provider_plus_dns',
    expected_dns: resendExpectedDnsRecords('example.org', EXACT_FACTS),
  };


  function admin(ctx: unknown, calls: { fn: string; args: Record<string, unknown> }[]) {
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === 'omni_comms_priv_domain_verification_context') {
          return { data: ctx, error: null };
        }
        return { data: { ok: true, status: 'verified' }, error: null };
      },
    };
  }

  it('authorises through the privileged context RPC before resolving', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const res = await runSendingDomainVerification(
      { actorId: 'u1', organizationId: 'o1', domainVerificationId: 'd1' },
      {
        admin: admin(okCtx, calls),
        fetchImpl: dohResponder({
          'send.example.org|16': ['"v=spf1 include:amazonses.com ~all"'],
          'send.example.org|15': ['10 feedback-smtp.eu-west-1.amazonses.com.'],
          'resend._domainkey.example.org|16': ['"p=MIGfMA0GCS"'],
        }),
      },
    );
    expect(calls.map((c) => c.fn)).toEqual([
      'omni_comms_priv_domain_verification_context',
      'omni_comms_priv_record_domain_verification',
    ]);
    expect(calls[1].args.p_all_matched).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('verified');
  });

  it('refuses an unauthenticated or unauthorised caller', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const anon = await runSendingDomainVerification(
      { actorId: null, organizationId: 'o1', domainVerificationId: 'd1' },
      { admin: admin(okCtx, calls), fetchImpl: dohResponder({}) },
    );
    expect(anon.status).toBe(401);
    expect(calls).toHaveLength(0);

    const denied = await runSendingDomainVerification(
      { actorId: 'u1', organizationId: 'o1', domainVerificationId: 'd1' },
      {
        admin: admin({ allowed: false, code: 'permission_denied' }, calls),
        fetchImpl: dohResponder({}),
      },
    );
    expect(denied.status).toBe(403);
    expect(calls.map((c) => c.fn)).not.toContain('omni_comms_priv_record_domain_verification');
  });
});

describe('surface boundaries', () => {
  it('never resolves DNS or contacts a provider from the browser', () => {
    const service = read(SERVICE);
    const ui = read(UI);
    for (const src of [service, ui]) {
      expect(src).not.toMatch(/dns\.google/);
      expect(src).not.toMatch(/api\.resend\.com/);
      expect(src).not.toContain('sendCommunication');
      expect(src).not.toMatch(/type=['"]password['"]/);
    }
    expect(service).toContain('/omni-comms-runtime/verify-sending-domain');
  });

  it('states plainly that an administrator claim is never verification', () => {
    const ui = read(UI);
    expect(ui).toContain('ATTESTATION_NEVER_VERIFIED_HELP');
    expect(DOMAIN_VERIFICATION_SOURCE_LABELS.external_admin_attestation)
      .toMatch(/never treated as verified/i);
    expect(DOMAIN_VERIFICATION_STATUS_LABELS.verified).toMatch(/DNS evidence/i);
  });

  it('keeps the edge module free of credential access', () => {
    const edge = read(EDGE);
    expect(edge).not.toMatch(/getSecret|secret_ref|Authorization/);
    expect(edge).not.toMatch(/api\.resend\.com/);
  });

  it('registers the new object in the Omni-Comms object registry', () => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_domain_verification');
    expect(entry).toBeDefined();
    expect(entry?.writeAuthority).toBe('admin_rpc');
  });
});

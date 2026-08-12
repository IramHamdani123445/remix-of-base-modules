/**
 * Omni-Comms — Test & Verify closure regressions.
 *
 * Locks the three defects that kept the controlled Email test from ever
 * reaching a proven callback:
 *   1. technical-test callbacks were pushed into business matching because the
 *      receiver checked a field the matching RPC does not return;
 *   2. callback evidence carried no provider account, so health was read
 *      across accounts;
 *   3. the signing secret silently fell back to an unrelated global secret,
 *      hiding a genuine mismatch.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const fn = readFileSync(
  'supabase/functions/omni-comms-webhook-resend/index.ts',
  'utf8',
);

describe('technical-test callback matching contract', () => {
  it('treats the RPC "matched" contract as a hit', () => {
    expect(fn).toContain('testRecord.matched === true');
  });

  it('still tolerates the historic "recorded" contract', () => {
    expect(fn).toContain('testRecord.recorded === true');
  });

  it('never routes an unmatched result into the channel-test scope', () => {
    expect(fn).toContain("testRecord.code !== 'unmatched'".replace(/'/g, '"'));
  });
});

describe('callback evidence attribution', () => {
  it('stamps the provider account on every recorded callback', () => {
    expect(fn).toContain('summary.provider_account_id = providerAccountId');
  });
});

describe('strict signing-secret resolution', () => {
  it('resolves through the account-scoped source RPC', () => {
    expect(fn).toContain('omni_comms_priv_resolve_webhook_signing_source');
  });

  it('does not fall back to the global secret once an account is supplied', () => {
    const body = fn.slice(
      fn.indexOf('async function resolveSigningSecret'),
      fn.indexOf('Records a bounded rejected-callback'),
    );
    const afterAccountGuard = body.slice(body.indexOf('try {'));
    expect(afterAccountGuard).not.toContain('LEGACY_SIGNING_SECRET');
  });

  it('reports the precise reason a secret could not be resolved', () => {
    expect(fn).toContain('webhook_account_missing');
    expect(fn).toContain('webhook_signing_secret_missing');
    expect(fn).toContain('webhook_signing_secret_unavailable');
    expect(fn).toContain('resolved.reason');
  });


  it('never logs or returns the secret value', () => {
    expect(fn).not.toMatch(/console\.[a-z]+\([^)]*signingSecret/);
    expect(fn).not.toMatch(/json\(\{[^}]*signingSecret/);
  });
});

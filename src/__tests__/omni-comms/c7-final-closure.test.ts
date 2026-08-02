/**
 * Omni-Comms Phase C7 FINAL Closure Correction.
 *
 * Rollback transaction safety, secret-reference sanitisation, provider
 * response sanitisation and generic browser-facing error responses.
 *
 * These tests read source and exercise pure adapter functions only. They
 * contact no provider, claim no job and mutate no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  boundedProviderCode,
  boundedProviderMessageId,
  redactProviderResponse,
  resolveSecret,
  sendResendEmail,
} from '../../../supabase/functions/_shared/omni-comms/resendAdapter';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ROLLBACK = read(
  'scripts/omni-comms/rollback/c7-controlled-business-dispatch-rollback.sql',
);
const ADAPTER = read('supabase/functions/_shared/omni-comms/resendAdapter.ts');
const DISPATCH = read('supabase/functions/omni-comms-dispatch/index.ts');
const WEBHOOK = read('supabase/functions/omni-comms-webhook-resend/index.ts');
const VERIFIER = read('scripts/omni-comms/verify-c7-closure-correction.sql');

/** Strips SQL line comments so only executable text remains. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .map((l) => (l.trimStart().startsWith('--') ? '' : l))
    .join('\n');
}

const SECRET_REF = 'OMNI_COMMS_RESEND_PILOT_KEY';

// ---------------------------------------------------------------------------
// 1-5. Rollback transaction safety
// ---------------------------------------------------------------------------
describe('C7 final closure — rollback transaction safety', () => {
  it('1. the final executable statement is ROLLBACK', () => {
    const statements = executable(ROLLBACK)
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    expect(statements[statements.length - 1].toUpperCase()).toBe('ROLLBACK');
  });

  it('2. contains no executable COMMIT', () => {
    expect(executable(ROLLBACK)).not.toMatch(/\bCOMMIT\b/i);
  });

  it('3. explicitly suspends controlled-pilot releases with a bounded reason', () => {
    expect(ROLLBACK).toContain("release_state = 'controlled_pilot'");
    expect(ROLLBACK).toContain('omni_comms_priv_dispatch_suspend_pilot');
    expect(ROLLBACK).toContain('dispatcher_rolled_back');
  });

  it('3b. suspends through the governed worker, never by rewriting history', () => {
    expect(ROLLBACK).not.toMatch(
      /UPDATE\s+public\.omni_comms_channel_release_event/i,
    );
    expect(ROLLBACK).not.toMatch(
      /DELETE\s+FROM\s+public\.omni_comms_channel_release_event/i,
    );
    // The suspension worker call must precede the DROP of that worker.
    expect(ROLLBACK.indexOf('PERFORM public.omni_comms_priv_dispatch_suspend_pilot'))
      .toBeLessThan(
        ROLLBACK.indexOf('DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_suspend_pilot'),
      );
  });

  it('4. references only real dispatch-job lease columns', () => {
    for (const col of ['lock_token', 'locked_at', 'locked_by', 'lease_expires_at']) {
      expect(ROLLBACK).toContain(col);
    }
  });

  it('4b. keeps the corrected RPC signatures', () => {
    expect(ROLLBACK).toContain(
      'omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text)',
    );
    expect(ROLLBACK).toContain(
      'omni_comms_priv_dispatch_record_payload_hash(uuid, text, text)',
    );
  });

  it('5. preserves C5B and deletes no evidence', () => {
    expect(ROLLBACK).not.toMatch(/DROP\s+TABLE/i);
    expect(ROLLBACK).not.toMatch(/DELETE\s+FROM/i);
    expect(ROLLBACK).not.toMatch(/TRUNCATE/i);
    expect(ROLLBACK).not.toMatch(/omni_comms_priv_channel_test_delivery_\w+\s*\(/);
  });

  it('5b. never enables live delivery or the live release state', () => {
    expect(ROLLBACK).not.toMatch(/live_delivery_enabled\s*=\s*true/i);
    expect(ROLLBACK).not.toMatch(/release_state\s*=\s*'live'/i);
  });
});

// ---------------------------------------------------------------------------
// 6-7. Secret-reference sanitisation
// ---------------------------------------------------------------------------
describe('C7 final closure — secret-reference sanitisation', () => {
  const originalDeno = (globalThis as Record<string, unknown>).Deno;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).Deno = { env: { get: () => '' } };
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).Deno = originalDeno;
    vi.restoreAllMocks();
  });

  it('6. a missing-credential result never contains the reference name', () => {
    const result = resolveSecret(SECRET_REF);
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).not.toContain(SECRET_REF);
    expect(text).not.toContain('OMNI_COMMS_RESEND_');
    expect(result).toMatchObject({
      errorCode: 'credential_missing',
      detail: 'The configured provider credential is unavailable.',
    });
  });

  it('7. an invalid reference is never echoed back', () => {
    const supplied = 'SOME_OTHER_SECRET_NAME_1234';
    const result = resolveSecret(supplied);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(supplied);
    expect(result).toMatchObject({ errorCode: 'secret_reference_invalid' });
  });

  it('7b. only the three bounded credential codes exist', () => {
    const codes = [...ADAPTER.matchAll(/errorCode: "(credential_[a-z_]+|secret_[a-z_]+)"/g)]
      .map((m) => m[1]);
    expect(new Set(codes)).toEqual(
      new Set(['secret_reference_invalid', 'credential_missing', 'credential_resolution_failed']),
    );
  });

  it('7c. the adapter never interpolates the reference into a message', () => {
    expect(ADAPTER).not.toMatch(/\$\{secretRef\}/);
    expect(ADAPTER).not.toMatch(/\$\{input\.secretRef\}/);
  });

  it('7d. a full send result carries no reference name', async () => {
    const result = await sendResendEmail({
      secretRef: SECRET_REF,
      fromAddress: 'noreply@example.test',
      to: 'someone@example.test',
      subject: 's',
      text: 't',
      idempotencyKey: 'k',
    });
    expect(JSON.stringify(result)).not.toContain('OMNI_COMMS_RESEND_');
    expect(result.errorCode).toBe('credential_missing');
  });
});

// ---------------------------------------------------------------------------
// 8-9. Provider response sanitisation
// ---------------------------------------------------------------------------
describe('C7 final closure — provider response sanitisation', () => {
  it('8. provider text containing an Email address is not persisted', () => {
    const redacted = redactProviderResponse({
      name: 'validation_error',
      message: 'The recipient claimant.person@example.test was rejected.',
      error: 'claimant.person@example.test is suppressed',
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toMatch(/@example\.test/);
    expect(text).not.toContain('claimant.person');
    expect(redacted).toMatchObject({
      provider_code: 'validation_error',
      message_present: true,
      error_present: true,
    });
    expect(redacted).not.toHaveProperty('message');
    expect(redacted).not.toHaveProperty('error');
  });

  it('9. a long provider message is dropped, not truncated-and-kept', () => {
    const redacted = redactProviderResponse({ message: 'x'.repeat(5000) });
    expect(JSON.stringify(redacted)).not.toContain('xxxx');
  });

  it('9b. secret-like values are never retained', () => {
    const redacted = redactProviderResponse({
      message: 're_live_51H8sK9AbCdEfGhIjKlMnOpQr',
      name: 're_live_51H8sK9AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghijklmnopqrstuvwxyz',
    });
    expect(JSON.stringify(redacted)).not.toContain('re_live_');
  });

  it('9c. the complete provider body is never retained', () => {
    const redacted = redactProviderResponse({
      id: 'abc-123',
      statusCode: 422,
      unexpected: { deep: 'value' },
      headers: { authorization: 'Bearer secret' },
    });
    expect(Object.keys(redacted).sort()).toEqual(['id', 'statusCode']);
  });

  it('9d. only allow-listed bounded provider codes survive', () => {
    expect(boundedProviderCode('rate_limit_exceeded')).toBe('rate_limit_exceeded');
    expect(boundedProviderCode('a'.repeat(65))).toBeNull();
    expect(boundedProviderCode('has space')).toBeNull();
    expect(boundedProviderMessageId('a'.repeat(200))).toBeNull();
    expect(boundedProviderMessageId('4ef9a417-02e9-4d39-ad75-9611e0fcc33c')).toBe(
      '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
    );
  });

  it('9e. error detail is a bounded classification, never provider text', () => {
    expect(ADAPTER).toContain('The provider outcome is uncertain.');
    expect(ADAPTER).toContain('The provider rejected the request.');
    expect(ADAPTER).not.toMatch(/errorDetail:.*redacted\.message/);
    expect(ADAPTER).not.toMatch(/errorDetail: detail/);
    expect(ADAPTER).not.toMatch(/e\.message/);
  });
});

// ---------------------------------------------------------------------------
// 10-12. Dispatcher generic error responses
// ---------------------------------------------------------------------------
describe('C7 final closure — dispatcher generic error responses', () => {
  it('10. an authorization failure returns a generic bounded code', () => {
    expect(DISPATCH).toContain('detail: "authorization_failed"');
    expect(DISPATCH).not.toContain('auth.error.message');
  });

  it('11. a claim failure returns a generic bounded code', () => {
    expect(DISPATCH).toContain('detail: "dispatch_claim_failed"');
    expect(DISPATCH).not.toContain('claimed.error.message');
  });

  it('12. no RPC `.message` is ever returned or logged', () => {
    expect(DISPATCH).not.toMatch(/\.error\.message/);
    expect(DISPATCH).not.toMatch(/error\?\.message/);
  });

  it('12b. bounded codes are validated before being surfaced', () => {
    expect(DISPATCH).toContain('const BOUNDED_CODE =');
    expect(DISPATCH).toContain('BOUNDED_CODE.test');
  });

  it('12c. logs carry only a correlation reference and a bounded code', () => {
    expect(DISPATCH).toContain('evidence_record_failed correlation=');
    expect(DISPATCH).not.toMatch(/console\.\w+\([^)]*recipient/i);
    expect(DISPATCH).not.toMatch(/console\.\w+\([^)]*subject/i);
    expect(DISPATCH).not.toMatch(/console\.\w+\([^)]*secret/i);
  });
});

// ---------------------------------------------------------------------------
// 13-15. Webhook generic errors and the C5B-first boundary
// ---------------------------------------------------------------------------
describe('C7 final closure — webhook error boundary', () => {
  it('13. a business recording failure returns only record_failed', () => {
    expect(WEBHOOK).toContain('json({ error: "record_failed" }, 500)');
    expect(WEBHOOK).not.toContain('business.error.message');
    expect(WEBHOOK).not.toMatch(/detail: business\.error/);
  });

  it('14. a C5B recording failure stops processing', () => {
    const idx = WEBHOOK.indexOf('if (testError) {');
    const block = WEBHOOK.slice(idx, idx + 700);
    expect(block).toContain('return json({ error: "record_failed" }, 500);');
  });

  it('15. the C5B failure return precedes any C7 business matching', () => {
    const failReturn = WEBHOOK.indexOf('if (testError) {');
    const businessCall = WEBHOOK.indexOf('omni_comms_priv_dispatch_record_callback');
    expect(failReturn).toBeGreaterThan(-1);
    expect(failReturn).toBeLessThan(businessCall);
  });

  it('15b. no raw RPC message reaches a webhook response or log', () => {
    expect(WEBHOOK).not.toMatch(/\.error\.message/);
    expect(WEBHOOK).not.toMatch(/testError\.message/);
  });
});

// ---------------------------------------------------------------------------
// 16. Protected C7 posture is unchanged
// ---------------------------------------------------------------------------
describe('C7 final closure — protected posture unchanged', () => {
  it('16. the dispatcher still reports the protected posture', () => {
    expect(DISPATCH).toContain('live_delivery_enabled: false');
    expect(DISPATCH).toContain('release_live_state_available: false');
    expect(DISPATCH).toContain('const DISPATCHABLE_CHANNEL = "email"');
    expect(DISPATCH).toContain('mode: "queued"');
  });

  it('16b. no provider SDK import was introduced', () => {
    for (const src of [ADAPTER, DISPATCH, WEBHOOK]) {
      expect(src).not.toMatch(/npm:resend|resend-node|twilio|@sendgrid/i);
    }
  });

  it('16c. the closure verifier carries checks 33-40', () => {
    for (const id of ['C7F.33', 'C7F.34', 'C7F.35', 'C7F.36', 'C7F.37', 'C7F.38', 'C7F.39', 'C7F.40']) {
      expect(VERIFIER).toContain(id);
    }
    expect(VERIFIER).toContain('SOURCE ASSERTION');
  });
});

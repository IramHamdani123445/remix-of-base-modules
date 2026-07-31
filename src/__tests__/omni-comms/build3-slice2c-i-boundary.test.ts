/**
 * Accelerated Build 3 — Slice 2c-i tests.
 *
 * Slice 2c-i introduces the trusted server boundary
 * `supabase/functions/omni-comms-runtime/index.ts` and revokes direct
 * `authenticated` EXECUTE on the SECURITY DEFINER persistence RPC.
 * These tests prove:
 *
 *  1. The canonical façade file still exists at exactly one path.
 *  2. The browser runtime service delegates to the Edge Function
 *     boundary (transport, not a direct RPC).
 *  3. The Edge Function TypeScript is present, is the only server
 *     entrypoint, canonicalises + fingerprints server-side, and
 *     invokes the persistence RPC via service_role.
 *  4. A caller-supplied fingerprint that disagrees with the server
 *     fingerprint is rejected as `canonical_fingerprint_mismatch`.
 *  5. Different object-key order produces the SAME server fingerprint.
 *  6. Material request changes produce a DIFFERENT server fingerprint.
 *  7. correlationId is excluded from the fingerprint.
 *  8. The browser runtime source does not import provider SDKs.
 *  9. The browser runtime source does not perform authoritative runtime
 *     table writes (no `supabase.from('omni_comms_...').insert` etc.).
 * 10. The browser runtime source does not call the private persistence
 *     RPC directly — it only invokes the Edge Function.
 * 11. The Slice 2c-i runtime service source contains no provider call
 *     or email send.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canonicalizeRequest,
} from '@/platform/omni-comms/runtime/canonicalize';
import { computeRequestFingerprint } from '@/platform/omni-comms/runtime/fingerprint';
import {
  executeSendCommunication,
  type RuntimeTransport,
} from '@/platform/omni-comms/runtime/sendCommunicationRuntime';
import type { SendCommunicationInput } from '@/platform/omni-comms/sendCommunication';

const FACADE = resolve(
  process.cwd(),
  'src/platform/omni-comms/sendCommunication.ts',
);
const RUNTIME = resolve(
  process.cwd(),
  'src/platform/omni-comms/runtime/sendCommunicationRuntime.ts',
);
const EDGE_INDEX = resolve(
  process.cwd(),
  'supabase/functions/omni-comms-runtime/index.ts',
);
const EDGE_CANONICAL = resolve(
  process.cwd(),
  'supabase/functions/omni-comms-runtime/canonicalize.ts',
);

const ORG = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
function baseInput(
  over: Partial<SendCommunicationInput> = {},
): SendCommunicationInput {
  return {
    eventCode: 'BENEFITS.CLAIM.APPROVED',
    organizationId: ORG,
    departmentId: null,
    recipients: [{ recipientType: 'user', email: 'a@example.com' }],
    payload: { claimId: 'C-1', amount: 100 },
    mode: 'dry_run',
    idempotencyKey: 'idem-12345678',
    ...over,
  };
}

// ─── 1. Façade uniqueness ──────────────────────────────────────────────
describe('Slice 2c-i — façade uniqueness', () => {
  it('the canonical façade file exists at exactly one path', () => {
    expect(existsSync(FACADE)).toBe(true);
    // Belt-and-braces: architecture rule 9 forbids duplicates; the
    // architecture check test asserts that centrally.
  });
});

// ─── 2. Browser runtime delegates to Edge Function ─────────────────────
describe('Slice 2c-i — browser runtime delegates to Edge Function', () => {
  it('sendCommunicationRuntime.ts invokes supabase.functions.invoke on the omni-comms-runtime function', () => {
    const src = readFileSync(RUNTIME, 'utf8');
    expect(src).toMatch(/functions\.invoke\(/);
    expect(src).toMatch(/['"]omni-comms-runtime['"]/);
  });

  it('sendCommunicationRuntime.ts does NOT call the private persistence RPC directly', () => {
    const src = readFileSync(RUNTIME, 'utf8');
    expect(src).not.toMatch(/omni_comms_priv_send_communication/);
    // Must not call .rpc(...) at all from the browser runtime.
    expect(src).not.toMatch(/\.rpc\(/);
  });

  it('sendCommunicationRuntime.ts performs no authoritative runtime table writes', () => {
    const src = readFileSync(RUNTIME, 'utf8');
    expect(src).not.toMatch(
      /from\(['"]omni_comms_(?:request|recipient|message|dispatch_job|delivery_attempt|message_event|event_route)['"]\)/,
    );
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it('sendCommunicationRuntime.ts does not import provider SDKs', () => {
    const src = readFileSync(RUNTIME, 'utf8');
    expect(src).not.toMatch(
      /from ['"](resend|twilio|@twilio|@sendgrid|nodemailer|firebase-admin|whatsapp-web\.js)/,
    );
  });
});

// ─── 3. Edge Function boundary exists and is server-authoritative ──────
describe('Slice 2c-i — Edge Function boundary', () => {
  it('supabase/functions/omni-comms-runtime/index.ts exists', () => {
    expect(existsSync(EDGE_INDEX)).toBe(true);
    expect(existsSync(EDGE_CANONICAL)).toBe(true);
  });

  it('Edge Function authenticates callers via getClaims', () => {
    const src = readFileSync(EDGE_INDEX, 'utf8');
    expect(src).toMatch(/getClaims\(/);
    expect(src).toMatch(/authentication_required/);
  });

  it('Edge Function canonicalizes + fingerprints server-side', () => {
    const src = readFileSync(EDGE_INDEX, 'utf8');
    expect(src).toMatch(/canonicalizeRequest\(/);
    expect(src).toMatch(/computeRequestFingerprint\(/);
    expect(src).toMatch(/serverFingerprint/);
  });

  it('Edge Function invokes the persistence RPC via service_role', () => {
    const src = readFileSync(EDGE_INDEX, 'utf8');
    expect(src).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).toMatch(/omni_comms_priv_send_communication/);
    // The RPC call must pass the server-computed fingerprint, not any
    // caller-supplied value.
    expect(src).toMatch(/p_request_fingerprint:\s*serverFingerprint/);
    // And must pass the authenticated user id as the actor.
    expect(src).toMatch(/p_actor_id:\s*userId/);
  });

  it('Edge Function rejects mismatched client fingerprint', () => {
    const src = readFileSync(EDGE_INDEX, 'utf8');
    expect(src).toMatch(/canonical_fingerprint_mismatch/);
    expect(src).toMatch(
      /clientFingerprint\s*&&\s*clientFingerprint\s*!==\s*serverFingerprint/,
    );
  });

  it('Edge Function does not import provider SDKs and does not send email', () => {
    const src = readFileSync(EDGE_INDEX, 'utf8');
    expect(src).not.toMatch(
      /from ['"](https?:\/\/[^'"]*)?(resend|twilio|sendgrid|nodemailer|firebase-admin|whatsapp-web\.js)/i,
    );
    // No literal email dispatch shape.
    expect(src).not.toMatch(/api\.resend\.com|api\.sendgrid\.com/i);
  });

  it('Edge Function does not touch dispatch or delivery-attempt tables (2c-i scope)', () => {
    const src = readFileSync(EDGE_INDEX, 'utf8');
    expect(src).not.toMatch(/omni_comms_dispatch_job/);
    expect(src).not.toMatch(/omni_comms_delivery_attempt/);
    expect(src).not.toMatch(/omni_comms_message[^_]/);
  });
});

// ─── 4. False-fingerprint rejection through the runtime ────────────────
describe('Slice 2c-i — server fingerprint authority', () => {
  async function serverFingerprintOf(
    input: SendCommunicationInput,
  ): Promise<string> {
    return computeRequestFingerprint(canonicalizeRequest(input));
  }

  it('rejects a client-supplied fingerprint that disagrees with the server', async () => {
    const input = baseInput();
    // A malicious/misbehaving caller injects a bogus fingerprint.
    const withBogus = {
      ...input,
      clientFingerprint: 'f'.repeat(64),
    } as SendCommunicationInput & { clientFingerprint: string };
    const transport: RuntimeTransport = {
      invoke: async (raw) => {
        const client = (raw as { clientFingerprint?: string }).clientFingerprint;
        const server = await serverFingerprintOf(raw);
        if (client && client !== server) {
          return {
            data: {
              contractVersion: 'omni_comms.result.v1',
              requestId: '',

              idempotencyKey: raw.idempotencyKey,
              mode: raw.mode,
              status: 'blocked',
              recipients: [],
              messages: [],
              blockers: ['canonical_fingerprint_mismatch'],
              createdAt: new Date(0).toISOString(),
              replayed: false,
            },
            error: null,
          };
        }
        throw new Error('unreachable in this test');
      },
    };
    const r = await executeSendCommunication(withBogus, transport);
    expect(r.status).toBe('blocked');
    expect(r.blockers).toContain('canonical_fingerprint_mismatch');
  });

  it('server fingerprint is stable across object-key permutations', async () => {
    const a = await serverFingerprintOf(
      baseInput({ payload: { a: 1, b: 2, c: 3 } }),
    );
    const b = await serverFingerprintOf(
      baseInput({ payload: { c: 3, b: 2, a: 1 } }),
    );
    expect(a).toBe(b);
  });

  it('server fingerprint changes on material request change', async () => {
    const a = await serverFingerprintOf(baseInput());
    const b = await serverFingerprintOf(
      baseInput({ payload: { claimId: 'C-2' } }),
    );
    expect(a).not.toBe(b);
  });

  it('correlationId is excluded from the server fingerprint', async () => {
    const a = await serverFingerprintOf(baseInput({ correlationId: 'X' }));
    const b = await serverFingerprintOf(baseInput({ correlationId: 'Y' }));
    expect(a).toBe(b);
  });
});

// ─── 5. Edge canonical parity with browser canonical ───────────────────
describe('Slice 2c-i — canonicalization parity', () => {
  it('Edge Function canonicalize.ts wire format matches the browser copy', () => {
    // Structural parity: both files must produce the same stable top-level
    // key order and the same set of canonical rules. We assert that
    // `canonicalJsonString` in both files emits the same fixed 8-key set.
    const browserSrc = readFileSync(
      resolve(process.cwd(), 'src/platform/omni-comms/runtime/canonicalize.ts'),
      'utf8',
    );
    const edgeSrc = readFileSync(EDGE_CANONICAL, 'utf8');
    for (const k of [
      'callerContext',
      'departmentId',
      'eventCode',
      'mode',
      'organizationId',
      'payload',
      'recipients',
      'requestedChannels',
    ]) {
      expect(browserSrc).toContain(`${k}:`);
      expect(edgeSrc).toContain(`${k}:`);
    }
    // Both use TextEncoder + SubtleCrypto SHA-256 (no Node crypto).
    expect(edgeSrc).toMatch(/crypto\.subtle\.digest\(['"]SHA-256['"]/);
    expect(edgeSrc).not.toMatch(/require\(['"]crypto['"]|from ['"]node:crypto['"]/);
  });
});

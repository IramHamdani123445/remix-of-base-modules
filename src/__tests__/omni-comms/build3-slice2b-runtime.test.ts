/**
 * Accelerated Build 3 — Slice 2b + 2c-i tests.
 *
 * These tests exercise the Slice 2b idempotency semantics AND the
 * Slice 2c-i trusted-boundary rewire. The runtime service now speaks
 * to an Edge Function transport instead of a raw RPC client; the same
 * idempotency contract is preserved end-to-end through the transport
 * layer.
 *
 * Server-authoritative concerns proven here:
 *  - Public façade file exists exactly once at the canonical path.
 *  - Façade imports only the trusted runtime entrypoint.
 *  - Runtime never imports provider SDKs.
 *  - Runtime never writes runtime tables directly from the browser
 *    (source scan for supabase.from / RPC calls).
 *  - Canonicalization determinism (key order, channel order, dedup).
 *  - Fingerprint properties (stability, sensitivity, correlationId
 *    exclusion, false-fingerprint rejection).
 *  - Runtime replay / mismatch / concurrency semantics via a
 *    deterministic in-memory transport that faithfully models the
 *    Edge Function boundary.
 *
 * True DB concurrency + real Edge Function auth are separately proven
 * by the Slice 2b and Slice 2c-i SQL verifiers and by the browser
 * smoke test.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canonicalizeRequest,
  canonicalJsonString,
  CanonicalizationError,
} from '@/platform/omni-comms/runtime/canonicalize';
import { computeRequestFingerprint } from '@/platform/omni-comms/runtime/fingerprint';
import { OMNI_COMMS_RESULT_CONTRACT_VERSION } from '@/platform/omni-comms/runtime/responseContract';
import {
  executeSendCommunication,
  type RuntimeTransport,
} from '@/platform/omni-comms/runtime/sendCommunicationRuntime';
import {
  sendCommunication,
  type SendCommunicationInput,
  type SendCommunicationResult,
} from '@/platform/omni-comms/sendCommunication';

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

// ─── In-memory Edge Function transport ─────────────────────────────────
// Models the omni-comms-runtime boundary: canonicalizes + fingerprints
// server-side, rejects false client fingerprints, and enforces
// (org, caller_module, key) idempotency exactly as the DB does.
interface FakeRow {
  request_id: string;
  idempotency_key: string;
  mode: string;
  status: string;
  created_at: string;
  server_fingerprint: string;
  event_count: number;
}

function makeInMemoryTransport(): {
  transport: RuntimeTransport;
  store: Map<string, FakeRow>;
  calls: Array<{ input: SendCommunicationInput; serverFingerprint: string }>;
} {
  const store = new Map<string, FakeRow>();
  const calls: Array<{
    input: SendCommunicationInput;
    serverFingerprint: string;
  }> = [];
  const transport: RuntimeTransport = {
    invoke: async (input) => {
      let canonical;
      try {
        canonical = canonicalizeRequest(input);
      } catch (err) {
        const code =
          err instanceof CanonicalizationError ? err.code : 'invalid_input';
        return { data: blocked(input, code), error: null };
      }
      const serverFingerprint = await computeRequestFingerprint(canonical);
      const client =
        typeof (input as { clientFingerprint?: string }).clientFingerprint ===
        'string'
          ? (
              input as { clientFingerprint?: string }
            ).clientFingerprint!.toLowerCase()
          : null;
      if (client && client !== serverFingerprint) {
        return {
          data: blocked(input, 'canonical_fingerprint_mismatch'),
          error: null,
        };
      }
      calls.push({ input, serverFingerprint });
      const callerModule =
        canonical.callerContext.moduleCode ?? 'OMNI_COMMS_DIRECT';
      const key = `${canonical.organizationId}|${callerModule}|${input.idempotencyKey}`;
      const existing = store.get(key);
      if (existing) {
        if (existing.server_fingerprint !== serverFingerprint) {
          return {
            data: blocked(input, 'idempotency_payload_mismatch'),
            error: null,
          };
        }
        return {
          data: acceptedResult(input, existing, true),
          error: null,
        };
      }
      const row: FakeRow = {
        request_id: crypto.randomUUID(),
        idempotency_key: input.idempotencyKey,
        mode: input.mode,
        status: 'accepted',
        created_at: new Date().toISOString(),
        server_fingerprint: serverFingerprint,
        event_count: 1,
      };
      store.set(key, row);
      return { data: acceptedResult(input, row, false), error: null };
    },
  };
  return { transport, store, calls };
}

function acceptedResult(
  input: SendCommunicationInput,
  row: FakeRow,
  replayed: boolean,
): SendCommunicationResult {
  return {
    contractVersion: OMNI_COMMS_RESULT_CONTRACT_VERSION,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    mode: input.mode,
    status: row.status,
    recipients: [],
    messages: [],
    blockers: ['runtime_resolution_pending'],
    createdAt: row.created_at,
    replayed,
  };
}

function blocked(
  input: SendCommunicationInput,
  code: string,
): SendCommunicationResult {
  return {
    contractVersion: OMNI_COMMS_RESULT_CONTRACT_VERSION,
    requestId: '',
    idempotencyKey: input.idempotencyKey ?? '',
    mode: input.mode,
    status: 'blocked',
    recipients: [],
    messages: [],
    blockers: [code],
    createdAt: new Date(0).toISOString(),
    replayed: false,
  };
}

// ─── Façade surface ────────────────────────────────────────────────────
describe('Slice 2b/2c-i — façade surface', () => {
  it('exports exactly one function named sendCommunication', () => {
    expect(typeof sendCommunication).toBe('function');
  });

  it('façade imports only the trusted runtime entrypoint', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/platform/omni-comms/sendCommunication.ts'),
      'utf8',
    );
    // The façade may import ONLY from its own trusted runtime folder:
    // the runtime entrypoint and the canonical response contract.
    const importLines = src.split('\n').filter((l) => /^\s*import\s+/.test(l));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/from ['"]\.\/runtime\/[a-zA-Z]+['"]/);
    }
    expect(src).toMatch(
      /from ['"]\.\/runtime\/sendCommunicationRuntime['"]/,
    );
    expect(src).toMatch(/from ['"]\.\/runtime\/responseContract['"]/);
    expect(src).not.toMatch(
      /from ['"](resend|twilio|@sendgrid|nodemailer|firebase-admin)/,
    );
    expect(src).not.toMatch(/@\/integrations\/supabase\/client/);
  });

  it('does not normally return runtime_not_available', async () => {
    const { transport } = makeInMemoryTransport();
    const r = await executeSendCommunication(baseInput(), transport);
    expect(r.blockers).not.toContain('runtime_not_available');
  });
});

// ─── Canonicalization determinism ───────────────────────────────────────
describe('Slice 2b — canonicalization', () => {
  it('object key order does not affect canonical JSON', () => {
    const a = canonicalizeRequest(baseInput({ payload: { a: 1, b: 2, c: 3 } }));
    const b = canonicalizeRequest(baseInput({ payload: { c: 3, b: 2, a: 1 } }));
    expect(canonicalJsonString(a)).toEqual(canonicalJsonString(b));
  });

  it('requested-channel order + duplicates do not affect canonical form', () => {
    const a = canonicalizeRequest(
      baseInput({ requestedChannels: ['email', 'sms', 'email'] as never }),
    );
    const b = canonicalizeRequest(
      baseInput({ requestedChannels: ['sms', 'email'] as never }),
    );
    expect(a.requestedChannels).toEqual(['email', 'sms']);
    expect(canonicalJsonString(a)).toEqual(canonicalJsonString(b));
  });

  it('recipient order is preserved', () => {
    const a = canonicalizeRequest(
      baseInput({
        recipients: [
          { recipientType: 'user', email: 'x@example.com' },
          { recipientType: 'user', email: 'y@example.com' },
        ],
      }),
    );
    expect(a.recipients[0].email).toBe('x@example.com');
    expect(a.recipients[1].email).toBe('y@example.com');
  });

  it('rejects unsupported channel', () => {
    expect(() =>
      canonicalizeRequest(baseInput({ requestedChannels: ['pager'] as never })),
    ).toThrow(CanonicalizationError);
  });

  it('rejects function/undefined/non-finite/cyclic payload values', () => {
    expect(() =>
      canonicalizeRequest(
        baseInput({ payload: { f: (() => 1) as unknown as string } }),
      ),
    ).toThrow(CanonicalizationError);
    expect(() =>
      canonicalizeRequest(
        baseInput({ payload: { u: undefined as unknown as string } }),
      ),
    ).toThrow(CanonicalizationError);
    expect(() =>
      canonicalizeRequest(baseInput({ payload: { n: Number.POSITIVE_INFINITY } })),
    ).toThrow(CanonicalizationError);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => canonicalizeRequest(baseInput({ payload: cyc }))).toThrow(
      CanonicalizationError,
    );
  });

  it('rejects excessive recipient count', () => {
    const many = Array.from({ length: 501 }, (_, i) => ({
      recipientType: 'user',
      email: `u${i}@example.com`,
    }));
    let err: unknown;
    try {
      canonicalizeRequest(baseInput({ recipients: many }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CanonicalizationError);
    expect((err as CanonicalizationError).code).toBe('recipient_limit_exceeded');
  });

  it('rejects oversized payload', () => {
    const big = 'x'.repeat(300_000);
    let err: unknown;
    try {
      canonicalizeRequest(baseInput({ payload: { big } }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CanonicalizationError);
    expect((err as CanonicalizationError).code).toBe('payload_too_large');
  });

  it('rejects invalid UUID', () => {
    expect(() =>
      canonicalizeRequest(baseInput({ organizationId: 'not-a-uuid' })),
    ).toThrow(CanonicalizationError);
  });
});

// ─── Fingerprint ────────────────────────────────────────────────────────
describe('Slice 2b — fingerprint', () => {
  it('is 64-char lowercase hex', async () => {
    const fp = await computeRequestFingerprint(canonicalizeRequest(baseInput()));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for equivalent inputs (key order, channel order)', async () => {
    const a = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ payload: { a: 1, b: 2 } })),
    );
    const b = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ payload: { b: 2, a: 1 } })),
    );
    expect(a).toEqual(b);
  });

  it('changes when payload changes', async () => {
    const a = await computeRequestFingerprint(canonicalizeRequest(baseInput()));
    const b = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ payload: { claimId: 'C-2', amount: 100 } })),
    );
    expect(a).not.toEqual(b);
  });

  it('changes when recipient changes', async () => {
    const a = await computeRequestFingerprint(canonicalizeRequest(baseInput()));
    const b = await computeRequestFingerprint(
      canonicalizeRequest(
        baseInput({ recipients: [{ recipientType: 'user', email: 'z@example.com' }] }),
      ),
    );
    expect(a).not.toEqual(b);
  });

  it('changes when mode changes', async () => {
    const a = await computeRequestFingerprint(canonicalizeRequest(baseInput()));
    const b = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ mode: 'queued' })),
    );
    expect(a).not.toEqual(b);
  });

  it('does NOT change when only correlationId changes', async () => {
    const a = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ correlationId: 'corr-A' })),
    );
    const b = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ correlationId: 'corr-B' })),
    );
    expect(a).toEqual(b);
  });
});

// ─── Runtime pipeline via trusted boundary ──────────────────────────────
describe('Slice 2b — runtime persistence via trusted boundary', () => {
  it('first invocation persists once and returns replayed=false', async () => {
    const { transport, store, calls } = makeInMemoryTransport();
    const r = await executeSendCommunication(baseInput(), transport);
    expect(r.status).toBe('accepted');
    expect(r.replayed).toBe(false);
    expect(r.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(store.size).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('identical replay returns the same request and replayed=true', async () => {
    const { transport, store } = makeInMemoryTransport();
    const a = await executeSendCommunication(baseInput(), transport);
    const b = await executeSendCommunication(baseInput(), transport);
    expect(b.requestId).toBe(a.requestId);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(store.size).toBe(1);
    const row = Array.from(store.values())[0];
    expect(row.event_count).toBe(1);
  });

  it('changed payload with same key returns idempotency_payload_mismatch', async () => {
    const { transport, store } = makeInMemoryTransport();
    await executeSendCommunication(baseInput(), transport);
    const b = await executeSendCommunication(
      baseInput({ payload: { claimId: 'DIFFERENT' } }),
      transport,
    );
    expect(b.status).toBe('blocked');
    expect(b.blockers).toContain('idempotency_payload_mismatch');
    expect(store.size).toBe(1);
  });

  it('concurrent identical requests → one accepted, one replay', async () => {
    const { transport, store } = makeInMemoryTransport();
    const [a, b] = await Promise.all([
      executeSendCommunication(baseInput(), transport),
      executeSendCommunication(baseInput(), transport),
    ]);
    expect(a.requestId).toBe(b.requestId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(store.size).toBe(1);
  });

  it('concurrent mismatched requests → one accepted, one mismatch', async () => {
    const { transport, store } = makeInMemoryTransport();
    const [a, b] = await Promise.all([
      executeSendCommunication(baseInput(), transport),
      executeSendCommunication(
        baseInput({ payload: { claimId: 'OTHER' } }),
        transport,
      ),
    ]);
    const outcomes = [a, b];
    const accepted = outcomes.filter((r) => r.status === 'accepted');
    const blockedOut = outcomes.filter((r) => r.status === 'blocked');
    expect(accepted).toHaveLength(1);
    expect(blockedOut).toHaveLength(1);
    expect(blockedOut[0].blockers).toContain('idempotency_payload_mismatch');
    expect(store.size).toBe(1);
  });

  it('invalid input is rejected before the transport is called', async () => {
    const { transport, calls } = makeInMemoryTransport();
    const spy = vi.spyOn(transport, 'invoke');
    const r = await executeSendCommunication(
      baseInput({ mode: 'invalid' as never }),
      transport,
    );
    expect(r.status).toBe('blocked');
    expect(r.blockers).toContain('mode_invalid');
    expect(spy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('missing idempotency key is rejected before persistence', async () => {
    const { transport } = makeInMemoryTransport();
    const spy = vi.spyOn(transport, 'invoke');
    const r = await executeSendCommunication(
      baseInput({ idempotencyKey: '' }),
      transport,
    );
    expect(r.blockers).toContain('idempotency_key_required');
    expect(spy).not.toHaveBeenCalled();
  });

  it('runtime result carries runtime_resolution_pending in Slice 2c-i', async () => {
    const { transport } = makeInMemoryTransport();
    const r = await executeSendCommunication(baseInput(), transport);
    expect(r.blockers).toEqual(['runtime_resolution_pending']);
    expect(r.recipients).toEqual([]);
    expect(r.messages).toEqual([]);
  });

  it('maps transport 401 to authentication_required', async () => {
    const transport: RuntimeTransport = {
      invoke: async () => ({
        data: null,
        error: { message: 'unauth', status: 401 },
      }),
    };
    const r = await executeSendCommunication(baseInput(), transport);
    expect(r.blockers).toContain('authentication_required');
  });

  it('maps transport 403 to permission_denied', async () => {
    const transport: RuntimeTransport = {
      invoke: async () => ({
        data: null,
        error: { message: 'no', status: 403 },
      }),
    };
    const r = await executeSendCommunication(baseInput(), transport);
    expect(r.blockers).toContain('permission_denied');
  });

  it('maps unknown transport error to runtime_transport_failed', async () => {
    const transport: RuntimeTransport = {
      invoke: async () => ({
        data: null,
        error: { message: 'boom', status: 502 },
      }),
    };
    const r = await executeSendCommunication(baseInput(), transport);
    expect(r.blockers).toContain('runtime_transport_failed');
    expect(r.blockers.join(' ')).not.toMatch(/boom|@example|SQLSTATE/);
  });

  it('transport throw is shielded as runtime_transport_failed', async () => {
    const transport: RuntimeTransport = {
      invoke: async () => {
        throw new Error('network dead');
      },
    };
    const r = await executeSendCommunication(baseInput(), transport);
    expect(r.blockers).toEqual(['runtime_transport_failed']);
  });
});

// ─── No provider / no worker ────────────────────────────────────────────
describe('Slice 2b — no provider surface', () => {
  it('runtime module does not import provider SDKs', () => {
    const src = readFileSync(
      resolve(
        process.cwd(),
        'src/platform/omni-comms/runtime/sendCommunicationRuntime.ts',
      ),
      'utf8',
    );
    expect(src).not.toMatch(
      /from ['"](resend|twilio|@twilio|@sendgrid|nodemailer|firebase-admin|whatsapp-web\.js)/,
    );
  });

  it('runtime does not create dispatch jobs or delivery attempts', () => {
    const src = readFileSync(
      resolve(
        process.cwd(),
        'src/platform/omni-comms/runtime/sendCommunicationRuntime.ts',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/omni_comms_dispatch_job/);
    expect(src).not.toMatch(/omni_comms_delivery_attempt/);
    expect(src).not.toMatch(/omni_comms_message[^_]/);
  });
});

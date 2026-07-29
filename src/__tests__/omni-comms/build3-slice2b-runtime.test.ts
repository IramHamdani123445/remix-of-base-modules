/**
 * Accelerated Build 3 — Slice 2b tests.
 *
 * Contract for these tests (per the Slice 2b build spec):
 *  - Exactly one approved façade file exists.
 *  - The façade export no longer normally returns runtime_not_available.
 *  - The façade calls only the trusted runtime entrypoint.
 *  - Invalid input is rejected before persistence (RPC never called).
 *  - Canonicalization is deterministic (key order, channel order).
 *  - Fingerprint changes iff material input changes; correlationId
 *    is EXCLUDED from the fingerprint.
 *  - First invocation → row inserted + one request_accepted event.
 *  - Identical replay → same request, no new event, replayed=true.
 *  - Payload mismatch → idempotency_payload_mismatch blocker.
 *  - Concurrent identical requests → one accepted, one replay.
 *  - Concurrent mismatch → one accepted, one mismatch.
 *  - No provider adapter is imported.
 *  - No dispatch job / delivery attempt / message row is created here.
 *
 * The Vitest suite exercises the canonicalization, fingerprint and
 * runtime service with a deterministic in-process fake RPC. True DB
 * concurrency is separately proven by
 * scripts/omni-comms/verify-build3-slice2b-idempotency.sql.
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
import {
  executeSendCommunication,
  type RuntimeRpcClient,
} from '@/platform/omni-comms/runtime/sendCommunicationRuntime';
import {
  sendCommunication,
  type SendCommunicationInput,
} from '@/platform/omni-comms/sendCommunication';

// ─── Fixtures ──────────────────────────────────────────────────────────
const ORG = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const DEPT = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

function baseInput(over: Partial<SendCommunicationInput> = {}): SendCommunicationInput {
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

interface FakeRow {
  request_id: string;
  idempotency_key: string;
  mode: string;
  status: string;
  created_at: string;
  request_fingerprint: string;
  event_count: number;
}

function makeInMemoryRpc(): {
  client: RuntimeRpcClient;
  store: Map<string, FakeRow>;
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const store = new Map<string, FakeRow>();
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: RuntimeRpcClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn !== 'omni_comms_priv_send_communication') {
        return { data: null, error: { message: 'OC500 unknown_rpc' } };
      }
      const key = `${args.p_organization_id}|${args.p_caller_module_code}|${args.p_idempotency_key}`;
      const fp = String(args.p_request_fingerprint);
      const existing = store.get(key);
      if (existing) {
        if (existing.request_fingerprint !== fp) {
          return { data: null, error: { message: 'OC409 idempotency_payload_mismatch' } };
        }
        return {
          data: {
            request_id: existing.request_id,
            idempotency_key: existing.idempotency_key,
            mode: existing.mode,
            status: existing.status,
            created_at: existing.created_at,
            replayed: true,
          },
          error: null,
        };
      }
      const row: FakeRow = {
        request_id: crypto.randomUUID(),
        idempotency_key: String(args.p_idempotency_key),
        mode: String(args.p_mode),
        status: 'accepted',
        created_at: new Date().toISOString(),
        request_fingerprint: fp,
        event_count: 1, // request_accepted appended once
      };
      store.set(key, row);
      return {
        data: {
          request_id: row.request_id,
          idempotency_key: row.idempotency_key,
          mode: row.mode,
          status: row.status,
          created_at: row.created_at,
          replayed: false,
        },
        error: null,
      };
    },
  };
  return { client, store, calls };
}

// ─── Façade surface ────────────────────────────────────────────────────
describe('Slice 2b — façade surface', () => {
  it('exports exactly one function named sendCommunication', () => {
    // Importing via ESM binding proves the export exists and is a function.
    expect(typeof sendCommunication).toBe('function');
  });

  it('façade source imports only the trusted runtime entrypoint', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/platform/omni-comms/sendCommunication.ts'),
      'utf8',
    );
    const importLines = src
      .split('\n')
      .filter((l) => /^\s*import\s+/.test(l));
    // Exactly one import line — the trusted runtime.
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(
      /from ['"]\.\/runtime\/sendCommunicationRuntime['"]/,
    );
    // No provider SDK imports.
    expect(src).not.toMatch(/from ['"](resend|twilio|@sendgrid|nodemailer|firebase-admin)/);
    // No direct supabase client import in the façade.
    expect(src).not.toMatch(/@\/integrations\/supabase\/client/);
  });

  it('does not normally return runtime_not_available', async () => {
    // Uses the default supabase client — RPC will error in test env, but
    // the mapped code must NOT be runtime_not_available (which is gone).
    const result = await sendCommunication(baseInput());
    expect(result.blockers).not.toContain('runtime_not_available');
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

  it('recipient order is preserved (semantic order)', () => {
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
      canonicalizeRequest(baseInput({ payload: { f: (() => 1) as unknown as string } })),
    ).toThrow(CanonicalizationError);
    expect(() =>
      canonicalizeRequest(baseInput({ payload: { u: undefined as unknown as string } })),
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
    expect(() => canonicalizeRequest(baseInput({ recipients: many }))).toThrow(
      /recipient_limit_exceeded/,
    );
  });

  it('rejects oversized payload', () => {
    const big = 'x'.repeat(300_000);
    expect(() => canonicalizeRequest(baseInput({ payload: { big } }))).toThrow(
      /payload_too_large/,
    );
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

  it('does NOT change when only correlationId changes (documented policy)', async () => {
    const a = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ correlationId: 'corr-A' })),
    );
    const b = await computeRequestFingerprint(
      canonicalizeRequest(baseInput({ correlationId: 'corr-B' })),
    );
    expect(a).toEqual(b);
  });
});

// ─── Runtime pipeline ───────────────────────────────────────────────────
describe('Slice 2b — runtime persistence', () => {
  it('first invocation persists once and returns replayed=false', async () => {
    const { client, store, calls } = makeInMemoryRpc();
    const r = await executeSendCommunication(baseInput(), client);
    expect(r.status).toBe('accepted');
    expect(r.replayed).toBe(false);
    expect(r.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(store.size).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('identical replay returns the same request and replayed=true', async () => {
    const { client, store } = makeInMemoryRpc();
    const a = await executeSendCommunication(baseInput(), client);
    const b = await executeSendCommunication(baseInput(), client);
    expect(b.requestId).toBe(a.requestId);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(store.size).toBe(1);
    // No additional request_accepted event was appended (event_count stays 1).
    const row = Array.from(store.values())[0];
    expect(row.event_count).toBe(1);
  });

  it('changed payload with same key returns idempotency_payload_mismatch', async () => {
    const { client, store } = makeInMemoryRpc();
    await executeSendCommunication(baseInput(), client);
    const b = await executeSendCommunication(
      baseInput({ payload: { claimId: 'DIFFERENT' } }),
      client,
    );
    expect(b.status).toBe('blocked');
    expect(b.blockers).toContain('idempotency_payload_mismatch');
    expect(store.size).toBe(1); // original unchanged, no new row
  });

  it('concurrent identical requests → one accepted, one replay', async () => {
    const { client, store } = makeInMemoryRpc();
    const [a, b] = await Promise.all([
      executeSendCommunication(baseInput(), client),
      executeSendCommunication(baseInput(), client),
    ]);
    expect(a.requestId).toBe(b.requestId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(store.size).toBe(1);
  });

  it('concurrent mismatched requests → one accepted, one mismatch', async () => {
    const { client, store } = makeInMemoryRpc();
    const [a, b] = await Promise.all([
      executeSendCommunication(baseInput(), client),
      executeSendCommunication(
        baseInput({ payload: { claimId: 'OTHER' } }),
        client,
      ),
    ]);
    const outcomes = [a, b];
    const accepted = outcomes.filter((r) => r.status === 'accepted');
    const blocked = outcomes.filter((r) => r.status === 'blocked');
    expect(accepted).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].blockers).toContain('idempotency_payload_mismatch');
    expect(store.size).toBe(1);
  });

  it('invalid input is rejected before the RPC is called', async () => {
    const { client, calls } = makeInMemoryRpc();
    const spy = vi.spyOn(client, 'rpc');
    const r = await executeSendCommunication(baseInput({ mode: 'invalid' as never }), client);
    expect(r.status).toBe('blocked');
    expect(r.blockers).toContain('mode_invalid');
    expect(spy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('missing idempotency key is rejected before persistence', async () => {
    const { client } = makeInMemoryRpc();
    const spy = vi.spyOn(client, 'rpc');
    const r = await executeSendCommunication(baseInput({ idempotencyKey: '' }), client);
    expect(r.blockers).toContain('idempotency_key_required');
    expect(spy).not.toHaveBeenCalled();
  });

  it('runtime result carries runtime_resolution_pending in Slice 2b', async () => {
    const { client } = makeInMemoryRpc();
    const r = await executeSendCommunication(baseInput(), client);
    expect(r.blockers).toEqual(['runtime_resolution_pending']);
    expect(r.recipients).toEqual([]);
    expect(r.messages).toEqual([]);
  });

  it('maps RPC OC401 to authentication_required', async () => {
    const client: RuntimeRpcClient = {
      rpc: async () => ({ data: null, error: { message: 'OC401 authentication_required' } }),
    };
    const r = await executeSendCommunication(baseInput(), client);
    expect(r.blockers).toContain('authentication_required');
  });

  it('maps unknown RPC error to runtime_persistence_failed', async () => {
    const client: RuntimeRpcClient = {
      rpc: async () => ({ data: null, error: { message: 'boom' } }),
    };
    const r = await executeSendCommunication(baseInput(), client);
    expect(r.blockers).toContain('runtime_persistence_failed');
    // No SQLSTATE, no stack, no recipient destination leaked.
    expect(r.blockers.join(' ')).not.toMatch(/boom|@example|SQLSTATE/);
  });
});

// ─── No provider / no worker ────────────────────────────────────────────
describe('Slice 2b — no provider surface', () => {
  it('runtime module does not import provider SDKs', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/platform/omni-comms/runtime/sendCommunicationRuntime.ts'),
      'utf8',
    );
    expect(src).not.toMatch(
      /from ['"](resend|twilio|@twilio|@sendgrid|nodemailer|firebase-admin|whatsapp-web\.js)/,
    );
  });

  it('runtime does not create dispatch jobs or delivery attempts', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/platform/omni-comms/runtime/sendCommunicationRuntime.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/omni_comms_dispatch_job/);
    expect(src).not.toMatch(/omni_comms_delivery_attempt/);
    expect(src).not.toMatch(/omni_comms_message[^_]/);
  });
});

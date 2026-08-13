/**
 * Omni-Comms — business-event handoff ownership.
 *
 * The outbox tracks ONE fact: did the business event hand off to Omni-Comms?
 * It must never mirror communication-delivery state, and must never resubmit
 * an event whose request already materialised.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyRuntimeOutcome } from '../../../supabase/functions/_shared/omniCommsIngestClassification';

const outcome = (o: Partial<Parameters<typeof classifyRuntimeOutcome>[0]>) =>
  classifyRuntimeOutcome({
    ok: true,
    httpStatus: 200,
    status: null,
    requestId: null,
    blockers: [],
    ...o,
  });

const REQ = 'b07386bf-5f1a-46c6-9281-25ee3332ef04';

describe('durable request means the handoff is complete', () => {
  for (const status of [
    'received',
    'accepted',
    'queued',
    'processing',
    'completed',
    'completed_with_blockers',
    'replayed',
  ]) {
    it(`treats runtime status "${status}" with a request id as processed`, () => {
      const r = outcome({ ok: true, status, requestId: REQ });
      expect(r.status).toBe('processed');
      expect(r.blockerCode).toBeNull();
    });
  }

  it('treats a completed request returned on a non-2xx replay as processed', () => {
    const r = outcome({ ok: false, httpStatus: 409, status: 'completed', requestId: REQ });
    expect(r.status).toBe('processed');
  });

  it('treats a blocked request WITH a durable id as a completed handoff', () => {
    const r = outcome({
      ok: false,
      httpStatus: 422,
      status: 'blocked',
      requestId: REQ,
      blockers: ['channels_required'],
    });
    expect(r.status).toBe('processed');
    expect(r.blockerCode).toBeNull();
  });
});

describe('no durable request', () => {
  it('is terminal when communication is configured off', () => {
    const r = outcome({
      ok: false,
      httpStatus: 200,
      status: 'blocked',
      blockers: ['no_communication_configured'],
    });
    expect(r.status).toBe('no_communication_configured');
    expect(r.blockerCode).toBe('no_communication_configured');
  });

  it('retries a transient runtime 5xx', () => {
    const r = outcome({ ok: false, httpStatus: 503, status: null });
    expect(r.status).toBe('retry');
    expect(r.blockerCode).toBe('runtime_unavailable');
  });

  it('retries a rate-limited runtime', () => {
    expect(outcome({ ok: false, httpStatus: 429 }).status).toBe('retry');
  });

  it('retries a network failure (no HTTP status)', () => {
    expect(outcome({ ok: false, httpStatus: 0 }).status).toBe('retry');
  });

  it('blocks a definite refusal with no request', () => {
    const r = outcome({ ok: false, httpStatus: 422, blockers: ['event_not_active'] });
    expect(r.status).toBe('blocked');
    expect(r.blockerCode).toBe('event_not_active');
  });
});

describe('worker uses the shared grammar', () => {
  const worker = readFileSync(
    'supabase/functions/omni-comms-business-event-ingest/index.ts',
    'utf8',
  );

  it('imports the shared classifier rather than re-implementing it', () => {
    expect(worker).toContain('_shared/omniCommsIngestClassification.ts');
    expect(worker).toContain('classifyRuntimeOutcome(');
  });

  it('no longer treats only accepted/queued as success', () => {
    expect(worker).not.toContain('body.status === "accepted" || body.status === "queued"');
  });
});

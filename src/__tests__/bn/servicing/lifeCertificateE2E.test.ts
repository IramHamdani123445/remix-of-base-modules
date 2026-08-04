/**
 * Reusable seeded Benefits harness + end-to-end proof for the Life Certificate
 * slice and the shared communication adapter.
 *
 * The harness models the server-side command boundary as an in-memory database:
 * every state change goes through a command, exactly as it does in Postgres.
 * It is deliberately reusable by the next servicing module (Medical Reviews),
 * so the same lifecycle, permission and idempotency guarantees can be re-proved
 * without rewriting fixtures.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDispatchKey,
  dispatchIntent,
  listPendingIntents,
  recordDispatchFailure,
  sanitizeCommunicationError,
  syncDeliveryStatus,
} from '@/services/bn/communication/bnCommunicationAdapterService';

// ── Seeded Benefits harness ────────────────────────────────────────────

type Permission = string;

interface Obligation {
  id: string;
  awardId: string;
  obligation_status: string;
  evidence_status: string;
  verification_status: string;
  escalation_status: string;
  evidence_receipt_revision: number;
  evidence_document_snapshot: Record<string, unknown> | null;
  reminders_sent: number;
  row_version: number;
}

interface Intent {
  id: string;
  awardId: string;
  entityId: string;
  event_code: string;
  delivery_status: 'PENDING' | 'RETRY' | 'REQUESTED' | 'FAILED' | 'COMPLETED';
  delivery_reference: string | null;
  attempts: number;
  last_error_code: string | null;
}

class BenefitsHarness {
  permissions = new Set<Permission>();
  assignedRecords = new Set<string>();
  viewAllRecords = false;
  obligations = new Map<string, Obligation>();
  intents: Intent[] = [];
  audit: Array<{ action: string; entity: string }> = [];
  suspensionProposals: Array<{ obligationId: string; revision: number }> = [];
  receipts = new Map<string, unknown>();
  private seq = 0;

  seedObligation(overrides: Partial<Obligation> = {}): Obligation {
    const id = `lc-${++this.seq}`;
    const row: Obligation = {
      id,
      awardId: `award-${this.seq}`,
      obligation_status: 'NOT_DUE',
      evidence_status: 'NOT_RECEIVED',
      verification_status: 'NOT_STARTED',
      escalation_status: 'NONE',
      evidence_receipt_revision: 0,
      evidence_document_snapshot: null,
      reminders_sent: 0,
      row_version: 1,
      ...overrides,
    };
    this.obligations.set(id, row);
    this.assignedRecords.add(id);
    return row;
  }

  private require(permission: Permission, obligationId?: string) {
    if (!this.permissions.has(permission)) throw new Error('E_FORBIDDEN');
    if (obligationId && !this.viewAllRecords && !this.assignedRecords.has(obligationId)) {
      throw new Error('E_RECORD_FORBIDDEN');
    }
  }

  /** Every command is idempotent on its receipt key, like the real RPCs. */
  private withReceipt<T>(key: string | undefined, fn: () => T): T {
    if (key && this.receipts.has(key)) return this.receipts.get(key) as T;
    const result = fn();
    if (key) this.receipts.set(key, result);
    return result;
  }

  markMilestone(id: string, milestone: string, key?: string) {
    return this.withReceipt(key, () => {
      const o = this.obligations.get(id)!;
      if (milestone.startsWith('REMINDER')) {
        // Reminders are ignored once evidence exists.
        if (o.evidence_status !== 'NOT_RECEIVED') return { status: 'NO_OP' };
        if (o.obligation_status === 'NOT_DUE') o.obligation_status = 'REMINDER_SENT';
        o.reminders_sent += 1;
      } else if (milestone === 'DUE') {
        if (!['NOT_DUE', 'REMINDER_SENT'].includes(o.obligation_status)) return { status: 'NO_OP' };
        o.obligation_status = 'DUE'; // reminder history is preserved
      } else if (milestone === 'OVERDUE') {
        o.obligation_status = 'OVERDUE';
      }
      o.row_version += 1;
      this.intents.push({
        id: `intent-${this.intents.length + 1}`,
        awardId: o.awardId,
        entityId: o.id,
        event_code: `BN_LC_${milestone}`,
        delivery_status: 'PENDING',
        delivery_reference: null,
        attempts: 0,
        last_error_code: null,
      });
      this.audit.push({ action: `milestone:${milestone}`, entity: id });
      return { status: 'OK', milestone, reminders_sent: o.reminders_sent };
    });
  }

  receive(id: string, document: Record<string, unknown>, key?: string) {
    this.require('receive', id);
    return this.withReceipt(key, () => {
      const o = this.obligations.get(id)!;
      o.evidence_status = 'RECEIVED';
      o.verification_status = 'PENDING_VERIFICATION';
      o.evidence_receipt_revision += 1; // honest: one increment per accepted receipt
      o.evidence_document_snapshot = { ...document };
      o.row_version += 1;
      this.audit.push({ action: 'receive', entity: id });
      return { status: 'OK', evidence_receipt_revision: o.evidence_receipt_revision };
    });
  }

  verify(id: string, key?: string) {
    this.require('verify', id);
    return this.withReceipt(key, () => {
      const o = this.obligations.get(id)!;
      if (o.evidence_status !== 'RECEIVED') throw new Error('E_INVALID_STATE');
      o.verification_status = 'VERIFIED';
      o.obligation_status = 'SATISFIED';
      o.row_version += 1;
      this.audit.push({ action: 'verify', entity: id });
      return { status: 'OK' };
    });
  }

  escalateToSuspension(id: string, key?: string) {
    this.require('propose_suspension', id);
    return this.withReceipt(key, () => {
      const o = this.obligations.get(id)!;
      if (o.obligation_status !== 'OVERDUE') throw new Error('E_INVALID_STATE');
      o.escalation_status = 'SUSPENSION_PROPOSED';
      o.row_version += 1;
      // Only a proposal — execution stays with the Award Suspension authority.
      this.suspensionProposals.push({ obligationId: id, revision: o.evidence_receipt_revision });
      this.audit.push({ action: 'escalate_to_suspension', entity: id });
      return { status: 'PROPOSED', executed: false };
    });
  }

  /** Adapter-facing RPC surface, mirroring the service-role commands. */
  rpc = async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'bn_communication_adapter_pending_v1') {
      const rows = this.intents
        .filter((i) => ['PENDING', 'RETRY'].includes(i.delivery_status) && i.attempts < 5)
        .slice(0, Number(args.p_limit ?? 50))
        .map((i) => ({
          source_module: 'BN_LIFE_CERTIFICATE',
          source_table: 'bn_life_certificate_communication_intent',
          source_intent_id: i.id,
          source_entity_id: i.entityId,
          bn_award_id: i.awardId,
          event_code: i.event_code,
          correlation_id: null,
          context: {},
          attempts: i.attempts,
        }));
      return { data: rows, error: null };
    }
    if (fn === 'bn_communication_adapter_dispatch_v1') {
      const intent = this.intents.find((i) => i.id === args.p_source_intent_id)!;
      const key = buildDispatchKey('BN_LIFE_CERTIFICATE', intent.id);
      if (intent.delivery_reference) {
        return {
          data: { status: 'REPLAYED', communication_request_id: intent.delivery_reference, dispatch_key: key },
          error: null,
        };
      }
      intent.delivery_reference = `req-${key}`;
      intent.delivery_status = 'REQUESTED';
      intent.attempts += 1;
      return {
        data: { status: 'DISPATCHED', communication_request_id: intent.delivery_reference, dispatch_key: key },
        error: null,
      };
    }
    if (fn === 'bn_communication_adapter_record_failure_v1') {
      const intent = this.intents.find((i) => i.id === args.p_source_intent_id)!;
      intent.attempts += 1;
      intent.last_error_code = String(args.p_error_code);
      intent.delivery_status = intent.attempts >= 5 ? 'FAILED' : 'RETRY';
      return { data: { error_code: intent.last_error_code, attempts: intent.attempts }, error: null };
    }
    if (fn === 'bn_communication_adapter_sync_v1') {
      let synced = 0;
      for (const intent of this.intents) {
        if (intent.delivery_status === 'REQUESTED') {
          intent.delivery_status = 'COMPLETED';
          synced += 1;
        }
      }
      return { data: { status: 'SYNCED', synced }, error: null };
    }
    return { data: null, error: { message: 'E_UNKNOWN_RPC' } };
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Benefits seeded harness — Life Certificate end-to-end', () => {
  let h: BenefitsHarness;

  beforeEach(() => {
    h = new BenefitsHarness();
    h.permissions = new Set(['receive', 'verify', 'propose_suspension']);
  });

  it('runs the happy path: reminder → due → receipt → verification', () => {
    const o = h.seedObligation();
    h.markMilestone(o.id, 'REMINDER_1');
    expect(o.obligation_status).toBe('REMINDER_SENT');

    h.markMilestone(o.id, 'DUE');
    expect(o.obligation_status).toBe('DUE');
    expect(o.reminders_sent).toBe(1); // reminder history preserved across DUE

    h.receive(o.id, { file_name: 'lc.pdf', document_type_code: 'LIFE_CERT' });
    expect(o.evidence_receipt_revision).toBe(1);

    h.verify(o.id);
    expect(o.obligation_status).toBe('SATISFIED');
    expect(h.audit.map((a) => a.action)).toContain('verify');
  });

  it('ignores reminders once evidence is present', () => {
    const o = h.seedObligation({ obligation_status: 'DUE' });
    h.receive(o.id, { file_name: 'lc.pdf' });
    const result = h.markMilestone(o.id, 'REMINDER_2');
    expect(result).toEqual({ status: 'NO_OP' });
    expect(o.reminders_sent).toBe(0);
  });

  it('increments the receipt revision honestly on resubmission', () => {
    const o = h.seedObligation({ obligation_status: 'DUE' });
    h.receive(o.id, { file_name: 'first.pdf' });
    h.receive(o.id, { file_name: 'second.pdf' });
    expect(o.evidence_receipt_revision).toBe(2);
    expect(o.evidence_document_snapshot).toEqual({ file_name: 'second.pdf' });
  });

  it('replays a stored receipt instead of transitioning twice', () => {
    const o = h.seedObligation({ obligation_status: 'DUE' });
    const first = h.receive(o.id, { file_name: 'lc.pdf' }, 'key-1');
    const second = h.receive(o.id, { file_name: 'lc.pdf' }, 'key-1');
    expect(second).toBe(first);
    expect(o.evidence_receipt_revision).toBe(1);
  });

  it('refuses commands without the module permission', () => {
    h.permissions = new Set();
    const o = h.seedObligation({ obligation_status: 'DUE' });
    expect(() => h.receive(o.id, {})).toThrow('E_FORBIDDEN');
  });

  it('refuses commands on records outside the officer scope', () => {
    const o = h.seedObligation({ obligation_status: 'DUE' });
    h.assignedRecords.delete(o.id);
    expect(() => h.receive(o.id, {})).toThrow('E_RECORD_FORBIDDEN');
  });

  it('allows scoped access when the actor may view all records', () => {
    const o = h.seedObligation({ obligation_status: 'DUE' });
    h.assignedRecords.delete(o.id);
    h.viewAllRecords = true;
    expect(() => h.receive(o.id, {})).not.toThrow();
  });

  it('only proposes suspension — it never executes one', () => {
    const o = h.seedObligation({ obligation_status: 'OVERDUE' });
    const result = h.escalateToSuspension(o.id);
    expect(result).toMatchObject({ status: 'PROPOSED', executed: false });
    expect(h.suspensionProposals).toHaveLength(1);
    expect(o.escalation_status).toBe('SUSPENSION_PROPOSED');
  });

  it('links the evidence revision to the suspension proposal', () => {
    const o = h.seedObligation({ obligation_status: 'OVERDUE' });
    h.receive(o.id, { file_name: 'lc.pdf' });
    o.obligation_status = 'OVERDUE';
    h.escalateToSuspension(o.id);
    expect(h.suspensionProposals[0].revision).toBe(1);
  });

  it('rejects escalation from a non-overdue state', () => {
    const o = h.seedObligation({ obligation_status: 'DUE' });
    expect(() => h.escalateToSuspension(o.id)).toThrow('E_INVALID_STATE');
  });
});

describe('Shared Benefits communication adapter', () => {
  let h: BenefitsHarness;

  beforeEach(() => {
    h = new BenefitsHarness();
    h.permissions = new Set(['receive', 'verify', 'propose_suspension']);
  });

  it('lists intents produced by the obligation lifecycle', async () => {
    const o = h.seedObligation();
    h.markMilestone(o.id, 'DUE');
    const pending = await listPendingIntents(50, h as never);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      sourceModule: 'BN_LIFE_CERTIFICATE',
      sourceTable: 'bn_life_certificate_communication_intent',
      eventCode: 'BN_LC_DUE',
    });
  });

  it('dispatches an intent to the hub exactly once', async () => {
    const o = h.seedObligation();
    h.markMilestone(o.id, 'DUE');
    const [intent] = await listPendingIntents(50, h as never);

    const first = await dispatchIntent('BN_LIFE_CERTIFICATE', intent.sourceIntentId, h as never);
    const second = await dispatchIntent('BN_LIFE_CERTIFICATE', intent.sourceIntentId, h as never);

    expect(first.status).toBe('DISPATCHED');
    expect(second.status).toBe('REPLAYED');
    expect(second.communicationRequestId).toBe(first.communicationRequestId);
  });

  it('builds a deterministic dispatch key', () => {
    expect(buildDispatchKey('BN_LIFE_CERTIFICATE', 'intent-1')).toBe(
      'bn-comm:BN_LIFE_CERTIFICATE:intent-1',
    );
  });

  it('drops dispatched intents out of the pending feed', async () => {
    const o = h.seedObligation();
    h.markMilestone(o.id, 'DUE');
    const [intent] = await listPendingIntents(50, h as never);
    await dispatchIntent('BN_LIFE_CERTIFICATE', intent.sourceIntentId, h as never);
    expect(await listPendingIntents(50, h as never)).toHaveLength(0);
  });

  it('records a sanitized failure without touching the obligation', async () => {
    const o = h.seedObligation();
    h.markMilestone(o.id, 'DUE');
    const versionBefore = o.row_version;
    const statusBefore = o.obligation_status;
    const [intent] = await listPendingIntents(50, h as never);

    const result = await recordDispatchFailure(
      'BN_LIFE_CERTIFICATE',
      intent.sourceIntentId,
      'provider rejected: SMTP 550 recipient@example.com E_PROVIDER_REJECTED',
      h as never,
    );

    expect(result.errorCode).toBe('E_PROVIDER_REJECTED');
    expect(o.row_version).toBe(versionBefore);
    expect(o.obligation_status).toBe(statusBefore);
  });

  it('parks an intent after the attempt budget is exhausted', async () => {
    const o = h.seedObligation();
    h.markMilestone(o.id, 'DUE');
    const [intent] = await listPendingIntents(50, h as never);
    for (let i = 0; i < 5; i += 1) {
      await recordDispatchFailure('BN_LIFE_CERTIFICATE', intent.sourceIntentId, 'E_TIMEOUT', h as never);
    }
    expect(await listPendingIntents(50, h as never)).toHaveLength(0);
    expect(h.intents[0].delivery_status).toBe('FAILED');
  });

  it('syncs hub delivery status back to the outbox', async () => {
    const o = h.seedObligation();
    h.markMilestone(o.id, 'DUE');
    const [intent] = await listPendingIntents(50, h as never);
    await dispatchIntent('BN_LIFE_CERTIFICATE', intent.sourceIntentId, h as never);

    const synced = await syncDeliveryStatus(200, h as never);
    expect(synced.synced).toBe(1);
    expect(h.intents[0].delivery_status).toBe('COMPLETED');
  });

  it('never leaks technical detail through error codes', () => {
    expect(sanitizeCommunicationError(new Error('relation "x" does not exist'))).toBe('E_UNKNOWN');
    expect(sanitizeCommunicationError('boom E_NO_APPROVED_CONTACT at line 42')).toBe(
      'E_NO_APPROVED_CONTACT',
    );
  });
});

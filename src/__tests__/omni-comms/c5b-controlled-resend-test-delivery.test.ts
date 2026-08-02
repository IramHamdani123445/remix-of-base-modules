/**
 * Omni-Comms C5B Closure — retry-safe controlled Resend test delivery.
 *
 * These tests prove the safety and evidence-integrity contract of the closure
 * without contacting any provider: bounded attempts, persistent provider
 * idempotency, transport-uncertainty handling, approval windows, callback
 * verification, registry registration and fail-safe rollback.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MAX_APPROVED_TEST_RECIPIENTS,
  MAX_DELIVERY_ATTEMPTS,
  deliveryOutcome,
  hasVerifiedCallbackEvidence,
  isApprovalActive,
  isDeliveryCurrent,
  isDeliveryRetryable,
  latestDelivery,
  type ChannelTestDelivery,
  type ChannelTestDeliveryDiagnostics,
} from '@/platform/omni-comms/application/channelTestDeliveryTypes';
import {
  deliveryBlockReason,
  newDeliveryIdempotencyKey,
  DELIVERY_SAFETY_BULLETS,
} from '@/platform/omni-comms/admin/views/channels/ChannelTestDeliveryCard';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
  OMNI_COMMS_OBJECT_COUNT,
} from '@/platform/omni-comms/registry/objectRegistry';

const FINGERPRINT = 'a'.repeat(40);

function delivery(patch: Partial<ChannelTestDelivery> = {}): ChannelTestDelivery {
  return {
    id: 'd1',
    binding_id: 'b1',
    status: 'accepted',
    target_masked: 'q***@example.com',
    from_address: 'no-reply@example.com',
    provider_code: 'resend',
    provider_message_id: 'msg-1',
    provider_status_code: 200,
    result_code: 'accepted',
    error_code: null,
    error_detail: null,
    requested_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T00:00:05.000Z',
    configuration_fingerprint: FINGERPRINT,
    events: [],
    ...patch,
  } as ChannelTestDelivery;
}

function diagnostics(
  patch: Partial<ChannelTestDeliveryDiagnostics> = {},
): ChannelTestDeliveryDiagnostics {
  return {
    controlled_test_delivery_enabled: true,
    controlled_test_recipients: ['qa.mailbox@example.com'],
    controlled_test_approval_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    live_delivery_enabled: false,
    can_configure: true,
    can_execute: true,
    deliveries: [],
    ...patch,
  } as ChannelTestDeliveryDiagnostics;
}

const passedRun = { id: 'r1', status: 'passed' } as never;

describe('C5B — bounded, retry-safe provider attempts', () => {
  it('permits at most three provider attempts per delivery', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(3);
  });

  it('allows a safe retry only when the transport outcome is unknown', () => {
    expect(isDeliveryRetryable(delivery({ status: 'outcome_unknown', attempt_count: 1 }))).toBe(true);
    expect(isDeliveryRetryable(delivery({ status: 'accepted', attempt_count: 1 }))).toBe(false);
    expect(isDeliveryRetryable(delivery({ status: 'failed', attempt_count: 1 }))).toBe(false);
    expect(isDeliveryRetryable(null)).toBe(false);
  });

  it('refuses a retry once the bounded attempt count is exhausted', () => {
    expect(
      isDeliveryRetryable(
        delivery({ status: 'outcome_unknown', attempt_count: MAX_DELIVERY_ATTEMPTS }),
      ),
    ).toBe(false);
  });

  it('blocks the operator when every permitted attempt has been used', () => {
    const reason = deliveryBlockReason({
      canConfigure: true,
      canExecute: true,
      approvalEnabled: true,
      approvalActive: true,
      approvedRecipients: ['qa.mailbox@example.com'],
      target: 'qa.mailbox@example.com',
      run: passedRun,
      runIsCurrent: true,
      attemptsExhausted: true,
    });
    expect(reason).toContain(String(MAX_DELIVERY_ATTEMPTS));
  });

  it('produces a bounded, provider-safe idempotency key', () => {
    const key = newDeliveryIdempotencyKey();
    expect(key.startsWith('test-delivery-')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(newDeliveryIdempotencyKey()).not.toBe(key);
  });
});

describe('C5B — approval window, volume and permissions', () => {
  it('treats an expired approval as inactive', () => {
    expect(
      isApprovalActive(
        diagnostics({
          controlled_test_approval_expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      ),
    ).toBe(false);
  });

  it('treats an approval with no expiry as inactive', () => {
    expect(isApprovalActive(diagnostics({ controlled_test_approval_expires_at: null }))).toBe(false);
  });

  it('treats a live approval inside its window as active', () => {
    expect(isApprovalActive(diagnostics())).toBe(true);
  });

  it('blocks delivery when the approval has expired', () => {
    const reason = deliveryBlockReason({
      canConfigure: true,
      canExecute: true,
      approvalEnabled: true,
      approvalActive: false,
      approvedRecipients: ['qa.mailbox@example.com'],
      target: 'qa.mailbox@example.com',
      run: passedRun,
      runIsCurrent: true,
    });
    expect(reason).toMatch(/expired/i);
  });

  it('blocks execution without the operate capability', () => {
    const reason = deliveryBlockReason({
      canConfigure: true,
      canExecute: false,
      approvalEnabled: true,
      approvalActive: true,
      approvedRecipients: ['qa.mailbox@example.com'],
      target: 'qa.mailbox@example.com',
      run: passedRun,
      runIsCurrent: true,
    });
    expect(reason).toMatch(/operate/i);
  });

  it('blocks an address that is not on the approved list', () => {
    const reason = deliveryBlockReason({
      canConfigure: true,
      canExecute: true,
      approvalEnabled: true,
      approvalActive: true,
      approvedRecipients: ['qa.mailbox@example.com'],
      target: 'someone.else@example.com',
      run: passedRun,
      runIsCurrent: true,
    });
    expect(reason).toMatch(/approved technical test list/i);
  });

  it('blocks a stale preflight', () => {
    const reason = deliveryBlockReason({
      canConfigure: true,
      canExecute: true,
      approvalEnabled: true,
      approvalActive: true,
      approvedRecipients: ['qa.mailbox@example.com'],
      target: 'qa.mailbox@example.com',
      run: passedRun,
      runIsCurrent: false,
    });
    expect(reason).toMatch(/preflight again/i);
  });

  it('permits delivery when every safety condition is satisfied', () => {
    expect(
      deliveryBlockReason({
        canConfigure: true,
        canExecute: true,
        approvalEnabled: true,
        approvalActive: true,
        approvedRecipients: ['qa.mailbox@example.com'],
        target: ' QA.Mailbox@Example.com ',
        run: passedRun,
        runIsCurrent: true,
        attemptsExhausted: false,
      }),
    ).toBeNull();
  });

  it('bounds the approved recipient list', () => {
    expect(MAX_APPROVED_TEST_RECIPIENTS).toBeLessThanOrEqual(5);
  });
});

describe('C5B — callback and evidence integrity', () => {
  it('requires a signature-verified callback for evidence', () => {
    const unverified = delivery({
      events: [{ id: 'e1', event_type: 'delivered', signature_verified: false } as never],
    });
    expect(hasVerifiedCallbackEvidence(unverified, FINGERPRINT)).toBe(false);
  });

  it('accepts verified callback evidence for the current configuration', () => {
    const verified = delivery({
      events: [{ id: 'e1', event_type: 'delivered', signature_verified: true } as never],
    });
    expect(hasVerifiedCallbackEvidence(verified, FINGERPRINT)).toBe(true);
  });

  it('rejects callback evidence recorded against a different configuration', () => {
    const verified = delivery({
      configuration_fingerprint: 'b'.repeat(40),
      events: [{ id: 'e1', event_type: 'delivered', signature_verified: true } as never],
    });
    expect(hasVerifiedCallbackEvidence(verified, FINGERPRINT)).toBe(false);
    expect(isDeliveryCurrent(verified, FINGERPRINT)).toBe(false);
  });

  it('reports the most severe terminal callback outcome', () => {
    const d = delivery({
      events: [
        { id: 'e1', event_type: 'delivered', signature_verified: true } as never,
        { id: 'e2', event_type: 'bounced', signature_verified: true } as never,
      ],
    });
    expect(deliveryOutcome(d)).toBe('bounced');
  });

  it('returns the latest delivery scoped to the selected binding', () => {
    const d = diagnostics({
      deliveries: [delivery({ id: 'other', binding_id: 'b2' }), delivery({ id: 'mine' })],
    });
    expect(latestDelivery(d, 'b1')?.id).toBe('mine');
    expect(latestDelivery(d, 'b9')).toBeNull();
  });

  it('states the zero-duplicate and content-binding safety boundary to the operator', () => {
    const text = DELIVERY_SAFETY_BULLETS.join(' ').toLowerCase();
    expect(text).toContain('idempotency');
    expect(text).toContain('preflight');
    expect(text).toContain('live delivery');
  });
});

describe('C5B — registry and script governance', () => {
  it('registers the provider attempt ledger as a runtime evidence object', () => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find(
      (o) => o.name === 'omni_comms_channel_test_delivery_attempt',
    );
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('runtime');
    expect(entry?.writeAuthority).toBe('service_role_only');
  });

  it('raises the registered object count to 31', () => {
    expect(OMNI_COMMS_OBJECT_COUNT).toBe(31);
  });

  it('keeps the C5B rollback script fail-safe', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'scripts/omni-comms/rollback/c5b-controlled-resend-delivery-rollback.sql'),
      'utf8',
    );
    expect(sql).toContain('WARNING');
    expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(sql).not.toMatch(/^COMMIT;/m);
  });

  it('ships a read-only C5B verification script', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'scripts/omni-comms/verify-c5b-controlled-resend-delivery.sql'),
      'utf8',
    );
    expect(sql).toContain('omni_comms_channel_test_delivery_attempt');
    expect(sql).toContain('provider_idempotency_key');
    expect(sql).toContain('controlled_test_approval_expires_at');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
  });
});

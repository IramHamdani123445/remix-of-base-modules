import { describe, expect, it } from 'vitest';
import {
  buildDeliveryRequestBody,
  describeBlocker,
  parseDeliveryToggleSnapshot,
  STATE_LABEL,
} from '../deliveryToggleService';

describe('deliveryToggleService', () => {
  it('parses a server snapshot without inventing readiness', () => {
    const snap = parseDeliveryToggleSnapshot({
      state: 'off',
      channel: 'email',
      blockers: [],
      can_enable: true,
      can_disable: false,
      indicators: [{ key: 'provider', ready: true, codes: [] }],
      release: {
        permitted_event_codes: ['BENEFITS.CLAIM.SUBMITTED'],
        permitted_caller_modules: ['BENEFITS'],
      },
      evidence: { queue_depth: 1, scheduler_healthy: true },
      generated_at: '2026-08-12T00:00:00Z',
    });
    expect(snap?.state).toBe('off');
    expect(snap?.canEnable).toBe(true);
    expect(snap?.canDisable).toBe(false);
    expect(snap?.permittedEventCodes).toEqual(['BENEFITS.CLAIM.SUBMITTED']);
    expect(snap?.evidence.queueDepth).toBe(1);
  });

  it('fails closed on an unknown state', () => {
    expect(parseDeliveryToggleSnapshot({ state: 'nonsense' })?.state).toBe('action_required');
    expect(parseDeliveryToggleSnapshot(null)).toBeNull();
  });

  it('never claims delivery for a non-ready snapshot', () => {
    const snap = parseDeliveryToggleSnapshot({ state: 'action_required', can_enable: false });
    expect(snap?.canEnable).toBe(false);
    expect(STATE_LABEL[snap!.state]).toContain('Setup incomplete');
  });

  it('translates blocker codes into plain language', () => {
    expect(describeBlocker('sending_domain_verified')).toMatch(/domain/i);
    expect(describeBlocker('some_new_code')).toMatch(/some new code/);
  });

  it('sends only scope and intent to the trusted boundary', () => {
    const body = buildDeliveryRequestBody({ organizationId: 'org-1', intent: 'enable' });
    expect(body).toEqual({
      action: 'delivery_request',
      organizationId: 'org-1',
      departmentId: null,
      channel: 'email',
      intent: 'enable',
    });
    expect(JSON.stringify(body)).not.toMatch(/fingerprint|revision|release_control_id/);
  });
});

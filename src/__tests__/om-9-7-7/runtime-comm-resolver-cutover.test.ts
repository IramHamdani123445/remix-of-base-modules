/**
 * OM-9.7.7 — Runtime Communication Resolver Cutover tests.
 *
 * Verifies migrated runtime notification callers route through the
 * canonical wrapper and that the wrapper falls back safely when a
 * trigger event has no template.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const state: any = { legacyRow: null };
  const supabase: any = {
    __state: state,
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        limit() {
          if (table === 'notification_templates') {
            return Promise.resolve({ data: state.legacyRow ? [state.legacyRow] : [] });
          }
          return Promise.resolve({ data: [] });
        },
        maybeSingle() { return Promise.resolve({ data: null }); },
        insert(rows: any) {
          state.lastInsert = { table, rows };
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { supabase };
});

vi.mock('@/lib/comm/businessCommunicationResolver', () => ({
  resolveNotificationTemplateForBusinessEvent: vi.fn(async (input: any) => ({
    input,
    effective: { settings: {} },
    render: null,
    resolvedTemplateCode: null,
    templateSource: 'NONE',
    warnings: [],
  })),
}));

import { supabase } from '@/integrations/supabase/client';
import {
  resolveNotificationForTriggerEvent,
  dispatchInAppNotification,
  renderNotificationText,
} from '@/lib/comm/notificationDispatchResolver';
import { resolveNotificationTemplateForBusinessEvent } from '@/lib/comm/businessCommunicationResolver';

beforeEach(() => {
  (supabase as any).__state.legacyRow = null;
  (supabase as any).__state.lastInsert = null;
  vi.mocked(resolveNotificationTemplateForBusinessEvent).mockClear();
});

describe('notificationDispatchResolver', () => {
  it('routes via the canonical resolver first', async () => {
    vi.mocked(resolveNotificationTemplateForBusinessEvent).mockResolvedValueOnce({
      input: {} as any,
      effective: { settings: {} } as any,
      render: { subject: 'Hi {{name}}', body: 'Body {{name}}', warnings: [] } as any,
      resolvedTemplateCode: 'X',
      templateSource: 'EXPLICIT',
      warnings: [],
    });
    const r = await resolveNotificationForTriggerEvent({
      triggerEvent: 'ia_plan_submitted',
      moduleCode: 'INTERNAL_AUDIT',
      channel: 'IN_APP',
    });
    expect(r.source).toBe('CANONICAL_RESOLVER');
    expect(r.subject).toBe('Hi {{name}}');
  });

  it('falls back to legacy notification_templates row when catalogue empty', async () => {
    (supabase as any).__state.legacyRow = { subject: 'Legacy', body: 'legacy body' };
    const r = await resolveNotificationForTriggerEvent({
      triggerEvent: 'legacy_event',
      moduleCode: 'PLATFORM',
    });
    expect(r.source).toBe('LEGACY_NOTIFICATION_TEMPLATE');
    expect(r.subject).toBe('Legacy');
    expect(r.warnings.some((w) => w.includes('Legacy notification_templates fallback'))).toBe(true);
  });

  it('returns source=NONE when nothing resolves and does not throw', async () => {
    const r = await resolveNotificationForTriggerEvent({
      triggerEvent: 'unknown_event',
      moduleCode: 'PLATFORM',
    });
    expect(r.source).toBe('NONE');
  });

  it('renders {{token}} interpolation', () => {
    expect(renderNotificationText('Hello {{name}}', { name: 'World' })).toBe('Hello World');
    expect(renderNotificationText('n={{n}}', { n: 3 })).toBe('n=3');
    expect(renderNotificationText('x={{x}}', { x: null })).toBe('x=');
  });

  it('dispatchInAppNotification writes system_notifications when template resolves', async () => {
    vi.mocked(resolveNotificationTemplateForBusinessEvent).mockResolvedValueOnce({
      input: {} as any,
      effective: { settings: {} } as any,
      render: { subject: 'Subject {{a}}', body: 'Body {{a}}', warnings: [] } as any,
      resolvedTemplateCode: 'X',
      templateSource: 'EFFECTIVE_DEFAULT',
      warnings: [],
    });
    const result = await dispatchInAppNotification({
      triggerEvent: 'ia_plan_submitted',
      moduleCode: 'INTERNAL_AUDIT',
      recipientIds: ['u1', 'u2'],
      variables: { a: 'X' },
      entityId: 'plan-1',
      entityType: 'audit_plan',
      notificationType: 'internal_audit',
      module: 'internal_audit',
    });
    expect(result.dispatched).toBe(2);
    expect(result.source).toBe('CANONICAL_RESOLVER_SEED');
  });

  it('skips dispatch and reports source=NONE when nothing resolves', async () => {
    const result = await dispatchInAppNotification({
      triggerEvent: 'unknown',
      moduleCode: 'PLATFORM',
      recipientIds: ['u1'],
      variables: {},
      notificationType: 'x',
      module: 'x',
    });
    expect(result.dispatched).toBe(0);
    expect(result.source).toBe('NONE');
  });
});

describe('migrated runtime callers', () => {
  it('iaNotificationService goes through the canonical Omni-Comms producer, not the legacy wrapper', async () => {
    // Wave-4 DEF-2: the Internal Audit notification service was cut over to the
    // single canonical producer. It must no longer touch the legacy resolver.
    const producer = await import(
      '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationProducer'
    );
    const emitSpy = vi
      .spyOn(producer, 'emitInternalAuditCommunication')
      .mockResolvedValue({ accepted: true, requestId: 'req-1' } as never);

    const { sendIANotification } = await import('@/services/iaNotificationService');
    await sendIANotification({ event: 'ia_plan_submitted', recipientIds: ['u1'], variables: {} });

    expect(emitSpy).toHaveBeenCalled();
    const call = emitSpy.mock.calls[0][0] as any;
    expect(call.eventCode).toBe('INTERNAL_AUDIT.PLAN.SUBMITTED');
    expect(resolveNotificationTemplateForBusinessEvent).not.toHaveBeenCalled();

    emitSpy.mockRestore();
  });
});

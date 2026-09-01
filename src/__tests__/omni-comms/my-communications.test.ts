/**
 * Omni-Comms — "My Communications" user inbox contract tests.
 *
 * Guards the safety property that matters most: the browser never chooses
 * whose inbox is read. Ownership is resolved server-side by `auth.uid()`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  categoryLabel,
  fetchMyCommunications,
  fetchMyUnreadCount,
  mapRow,
  moduleLabel,
  MyCommunicationsError,
} from '@/platform/omni-comms/application/myCommunicationsService';

function client(response: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: response.data ?? null, error: response.error ?? null });
  return { client: { rpc } as never, rpc };
}

const ROW = {
  id: 'n1',
  title: 'Audit intimation issued',
  body: 'An internal audit of your area is scheduled.',
  link: '/audit/engagements/1',
  action_label: 'View engagement',
  severity: 'warning',
  category: 'legal_mandatory',
  module_code: 'INTERNAL_AUDIT',
  event_code: 'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED',
  event_name: 'Audit intimation issued',
  entity_type: 'ia_engagement',
  entity_id: 'ENG-1',
  is_read: false,
  read_at: null,
  acted_at: null,
  created_at: '2026-08-30T13:46:00Z',
  has_attachment: true,
  request_id: 'r1',
  message_id: 'm1',
  total_count: 9,
};

describe('My Communications — governed reads', () => {
  it('never sends a user identifier to the list RPC', async () => {
    const { client: c, rpc } = client({ data: [ROW] });
    await fetchMyCommunications(c, { limit: 25, offset: 0, unreadOnly: false });

    expect(rpc).toHaveBeenCalledWith('omni_comms_in_app_list_my_communications', {
      p_limit: 25,
      p_offset: 0,
      p_unread_only: false,
    });
    const args = JSON.stringify(rpc.mock.calls[0][1]);
    expect(args).not.toMatch(/user|uid|recipient|email/i);
  });

  it('never sends any argument to the unread-count RPC', async () => {
    const { client: c, rpc } = client({ data: 7 });
    await expect(fetchMyUnreadCount(c)).resolves.toBe(7);
    expect(rpc).toHaveBeenCalledWith('omni_comms_in_app_my_unread_count');
    expect(rpc.mock.calls[0]).toHaveLength(1);
  });

  it('reports the server total, not the page length', async () => {
    const { client: c } = client({ data: [ROW] });
    const page = await fetchMyCommunications(c);
    expect(page.total).toBe(9);
    expect(page.items).toHaveLength(1);
  });

  it('never reports a negative or non-numeric unread count', async () => {
    const negative = client({ data: -4 });
    await expect(fetchMyUnreadCount(negative.client)).resolves.toBe(0);
    const nonsense = client({ data: 'many' });
    await expect(fetchMyUnreadCount(nonsense.client)).resolves.toBe(0);
  });

  it('surfaces governance denials as a typed error', async () => {
    const { client: c } = client({ error: { message: 'permission denied' } });
    await expect(fetchMyUnreadCount(c)).rejects.toBeInstanceOf(MyCommunicationsError);
  });

  it('maps a row into user-facing shape with traceability preserved', () => {
    const mapped = mapRow(ROW);
    expect(mapped).toMatchObject({
      id: 'n1',
      isRead: false,
      hasAttachment: true,
      moduleCode: 'INTERNAL_AUDIT',
      eventCode: 'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED',
      entityId: 'ENG-1',
      requestId: 'r1',
      messageId: 'm1',
    });
  });

  it('presents governed vocabulary in plain language', () => {
    expect(categoryLabel('legal_mandatory')).toBe('Official notice');
    expect(categoryLabel(null)).toBe('Information');
    expect(moduleLabel('INTERNAL_AUDIT')).toBe('Internal Audit');
    expect(moduleLabel(null)).toBeNull();
  });
});

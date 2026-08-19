import { describe, it, expect, vi } from 'vitest';
import {
  isOmniCommsNotification,
  isSafeInternalActionUrl,
  markAllOmniUnread,
  recordEngagement,
  recordEngagementBulk,
  splitBySource,
  InAppEngagementError,
} from '../application/inAppNotificationService';
import {
  parseWhatsAppButtons,
  serialiseWhatsAppButtons,
  validateWhatsAppContent,
} from '../domain/whatsappAuthoring';
import { maskProviderTemplateRef, verificationModeLabel } from '../application/templateProviderRegistrationService';

const okClient = () => {
  const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
  return { client: { rpc }, rpc };
};

describe('In-App governed engagement', () => {
  it('records a single engagement through the governed RPC', async () => {
    const { client, rpc } = okClient();
    await recordEngagement(client, 'n1', 'action');
    expect(rpc).toHaveBeenCalledWith('omni_comms_in_app_record_engagement', {
      p_notification_id: 'n1',
      p_engagement: 'action',
    });
  });

  it('records a bulk read through the governed bulk RPC', async () => {
    const { client, rpc } = okClient();
    await recordEngagementBulk(client, ['a', 'a', 'b']);
    expect(rpc).toHaveBeenCalledWith('omni_comms_in_app_record_engagement_bulk', {
      p_notification_ids: ['a', 'b'],
    });
  });

  it('marks all unread through the server-resolved bulk RPC', async () => {
    const { client, rpc } = okClient();
    await markAllOmniUnread(client);
    expect(rpc).toHaveBeenCalledWith('omni_comms_in_app_record_engagement_bulk', {
      p_notification_ids: null,
    });
  });

  it('surfaces an error instead of silently bypassing evidence', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'OC403' } }) };
    await expect(recordEngagement(client, 'n1', 'read')).rejects.toBeInstanceOf(InAppEngagementError);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('splits mixed selections by source', () => {
    const { omni, legacy } = splitBySource([
      { id: '1', source: 'omni_comms' },
      { id: '2', source: 'legacy' },
    ]);
    expect(omni.map((n) => n.id)).toEqual(['1']);
    expect(legacy.map((n) => n.id)).toEqual(['2']);
    expect(isOmniCommsNotification({ id: '1', source: 'omni_comms' })).toBe(true);
  });

  it('permits only safe internal action URLs', () => {
    expect(isSafeInternalActionUrl('/benefits/claims/1')).toBe(true);
    expect(isSafeInternalActionUrl('https://evil.example/x')).toBe(false);
    expect(isSafeInternalActionUrl('//evil.example')).toBe(false);
    expect(isSafeInternalActionUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('WhatsApp authoring', () => {
  it('round-trips structured buttons', () => {
    const content = serialiseWhatsAppButtons({ body: 'hi' }, [
      { type: 'quick_reply', label: 'Yes' },
      { type: 'url', label: 'Open', url: 'https://ssb.example/claim' },
    ]);
    const parsed = parseWhatsAppButtons(content);
    expect(parsed).toEqual([
      { type: 'quick_reply', label: 'Yes' },
      { type: 'url', label: 'Open', url: 'https://ssb.example/claim' },
    ]);
  });

  it('keeps an existing single-button version readable', () => {
    expect(parseWhatsAppButtons({ body: 'x', button_label: 'Open', button_url: 'https://a.example/b' }))
      .toEqual([{ type: 'url', label: 'Open', url: 'https://a.example/b' }]);
  });

  it('flags an insecure media link and a missing body', () => {
    const issues = validateWhatsAppContent({ body: '', media_url: 'http://a.example/x.png' });
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it('never carries a provider identifier in canonical content', () => {
    const content = serialiseWhatsAppButtons({ body: 'hi' }, []);
    expect(Object.keys(content)).not.toContain('content_sid');
  });
});

describe('Provider registration display', () => {
  it('masks the provider reference and never claims false verification', () => {
    expect(maskProviderTemplateRef('HX0123456789abcdef0123456789abcdef')).toBe('HX01••••••');
    expect(verificationModeLabel('manually_attested')).toBe('Manually attested provider registration');
    expect(verificationModeLabel('provider_verified')).toBe('Provider-verified approval');
  });
});

/**
 * Omni-Comms — Email journey read model contract.
 *
 * Proves the adapter is read-only, routes through the capability-gated RPCs,
 * and drives the list and the summary from the SAME filter object so the
 * pipeline metrics always describe the rows on screen.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  EMAIL_JOURNEY_PAGE_SIZE_MAX,
  emailJourneyStageLabel,
  emailJourneyStageTone,
  getEmailJourneyDetail,
  getEmailJourneySummary,
  listEmailJourneys,
} from '@/platform/omni-comms/application/emailJourneyService';

function clientWith(data: unknown) {
  const rpc = vi.fn(
    async (_fn: string, _args?: Record<string, unknown>) => ({ data, error: null }),
  );
  return { client: { rpc }, rpc };
}

const FILTERS = {
  organizationId: 'org-1',
  moduleCode: 'BENEFITS',
  stage: 'delivered',
  from: '2026-08-01T00:00:00Z',
  search: 'BN-1',
};

describe('Email journey read model', () => {
  it('lists through the capability-gated RPC with clamped paging', async () => {
    const { client, rpc } = clientWith({ items: [], total: 0, limit: 25, offset: 0 });
    await listEmailJourneys(client, { ...FILTERS, limit: 5000, offset: -10 });

    expect(rpc).toHaveBeenCalledWith('omni_comms_email_journey_list', {
      p_organization_id: 'org-1',
      p_module_code: 'BENEFITS',
      p_event_code: null,
      p_stage: 'delivered',
      p_product_id: null,
      p_from: '2026-08-01T00:00:00Z',
      p_to: null,
      p_search: 'BN-1',
      p_limit: EMAIL_JOURNEY_PAGE_SIZE_MAX,
      p_offset: 0,
    });
  });

  it('summarises with exactly the same filters as the list', async () => {
    const { client, rpc } = clientWith({ initiated: 0 });
    await getEmailJourneySummary(client, FILTERS);

    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('omni_comms_email_journey_summary');
    expect(args.p_organization_id).toBe('org-1');
    expect(args.p_module_code).toBe('BENEFITS');
    expect(args.p_stage).toBe('delivered');
    expect(args.p_search).toBe('BN-1');
    expect(args).not.toHaveProperty('p_limit');
  });

  it('loads a single Email journey by message id', async () => {
    const { client, rpc } = clientWith({ message_id: 'm-1' });
    await getEmailJourneyDetail(client, {
      organizationId: 'org-1',
      messageId: 'm-1',
    });
    expect(rpc).toHaveBeenCalledWith('omni_comms_email_journey_detail', {
      p_organization_id: 'org-1',
      p_message_id: 'm-1',
    });
  });

  it('surfaces controlled RPC errors instead of raw database text', async () => {
    const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({
      data: null as unknown,
      error: { message: 'OC403 permission_denied', details: 'omni_comms.view' },
    }));
    await expect(
      listEmailJourneys({ rpc }, { organizationId: 'org-1' }),
    ).rejects.toMatchObject({ code: 'OC403' });
  });

  it('speaks business language for every stage', () => {
    expect(emailJourneyStageLabel('provider_accepted')).toBe('Provider accepted');
    expect(emailJourneyStageLabel('waiting_to_send')).toBe('Waiting to send');
    expect(emailJourneyStageTone('bounced')).toBe('destructive');
    expect(emailJourneyStageTone('delivered')).toBe('default');
  });
});

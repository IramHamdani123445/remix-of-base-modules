/**
 * Omni-Comms — production sender catalogue contract tests.
 *
 * Pure model/adapter tests. No provider calls, no sending, no route mutation.
 */
import { describe, expect, it, vi } from 'vitest';
import { bootstrapSenderCatalogue } from '@/platform/omni-comms/application/senderCatalogueService';
import {
  audienceHint,
  catalogueConflicts,
  catalogueProductionTotal,
  catalogueReadyCount,
  SENDER_CATALOGUE_STATUS_LABEL,
  type SenderCatalogueBootstrapResult,
  type SenderCatalogueEntry,
} from '@/platform/omni-comms/application/senderCatalogueTypes';

function entry(over: Partial<SenderCatalogueEntry>): SenderCatalogueEntry {
  return {
    sender_code: 'benefits_department',
    tier: 'production_now',
    purpose: 'Benefits correspondence',
    audience: 'external',
    status: 'existing',
    detail: null,
    sender_identity_id: 'id-1',
    organization_id: 'org-1',
    department_id: null,
    display_name: 'SSB Benefits',
    from_address: 'benefits@secureserve.biz',
    reply_to_address: null,
    sender_status: 'active',
    channel_endpoint_id: 'ep-1',
    provider_account_id: 'pa-1',
    ...over,
  };
}

function result(plan: SenderCatalogueEntry[]): SenderCatalogueBootstrapResult {
  return {
    organization_id: 'org-1',
    organization_short_name: 'SSB',
    channel: 'email',
    domain: 'secureserve.biz',
    domain_ready: true,
    applied: false,
    total_definitions: 15,
    created: 0,
    existing: 0,
    conflicts: 0,
    future: 0,
    plan,
    generated_at: '2026-01-01T00:00:00Z',
  };
}

describe('sender catalogue adapter', () => {
  it('calls the bounded catalogue RPC with explicit configuration arguments', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: result([]), error: null });
    await bootstrapSenderCatalogue({ rpc } as never, {
      organizationId: 'org-1',
      apply: true,
      domain: 'secureserve.biz',
    });
    expect(rpc).toHaveBeenCalledWith('omni_comms_sender_catalogue_bootstrap', {
      p_organization_id: 'org-1',
      p_apply: true,
      p_channel: 'email',
      p_domain: 'secureserve.biz',
      p_correlation_id: null,
    });
  });

  it('defaults to a non-destructive preview', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: result([]), error: null });
    await bootstrapSenderCatalogue({ rpc } as never, { organizationId: 'org-1' });
    expect(rpc.mock.calls[0][1].p_apply).toBe(false);
  });
});

describe('sender catalogue model', () => {
  it('surfaces conflicts for operator decision', () => {
    const r = result([
      entry({}),
      entry({ sender_code: 'compliance_department', status: 'conflict', detail: 'address_already_used_by_another_sender_code' }),
    ]);
    expect(catalogueConflicts(r).map((c) => c.sender_code)).toEqual(['compliance_department']);
  });

  it('counts only active production profiles as ready', () => {
    const r = result([
      entry({}),
      entry({ sender_code: 'legal_department', sender_status: 'draft' }),
      entry({ sender_code: 'reports_delivery', tier: 'future', sender_status: null, status: 'future_not_required' }),
    ]);
    expect(catalogueReadyCount(r)).toBe(1);
    expect(catalogueProductionTotal(r)).toBe(2);
  });

  it('states the internal audience restriction', () => {
    expect(audienceHint('internal')).toMatch(/blocked on external-recipient/i);
    expect(audienceHint('external')).toMatch(/external recipients/i);
    expect(audienceHint('mixed')).toMatch(/internal and external/i);
  });

  it('labels every catalogue status', () => {
    expect(Object.keys(SENDER_CATALOGUE_STATUS_LABEL)).toHaveLength(5);
    expect(SENDER_CATALOGUE_STATUS_LABEL.conflict).toMatch(/OPERATOR DECISION/);
  });
});

/**
 * FINAL Omni-Comms platform model.
 *
 * Proves the permanent product contract:
 *   - normal navigation is exactly Overview / Providers / Communications / Activity
 *   - no normal department selector; organisation selector only when needed
 *   - business modules provide facts only (no provider/template/sender/channel/mode)
 *   - deterministic idempotency derived by the platform
 *   - department is derived context, organisation defaults apply when absent
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  OMNI_COMMS_NAV_ITEMS,
  OMNI_COMMS_PLANNED_NAV_ITEMS,
  resolveActiveNavItem,
  omniCommsNavItems,
} from '@/platform/omni-comms/admin/navigation/omniCommsNavigation';

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

vi.mock('@/lib/org/organizationContextResolver', () => ({
  resolveOrganizationContext: vi.fn(async () => ({
    organization: { id: 'org-1' },
    department: null,
  })),
}));

vi.mock('@/platform/omni-comms/application/productCommunicationService', () => ({
  resolveProductCommunication: vi.fn(async () => ({
    enabled: true,
    reason: null,
    event_code: 'BENEFITS.CLAIM.SUBMITTED',
    channel: 'email',
    delivery_mode: null,
    recipient_source: null,
    template: null,
    sender: null,
  })),
}));

const emitSpy = vi.fn(async () => ({
  outcome: 'accepted' as const,
  blockers: [],
  requestId: 'req-1',
  idempotencyKey: 'omni-producer:abc',
  mode: 'queued' as const,
  eventCode: 'BENEFITS.CLAIM.SUBMITTED',
}));

vi.mock(
  '@/platform/omni-comms/integrations/business/emitBusinessCommunication',
  () => ({ emitBusinessCommunication: (...a: unknown[]) => emitSpy(...(a as [])) }),
);

import { emitConfiguredBusinessEvent } from '@/platform/omni-comms/integrations/business/emitConfiguredBusinessEvent';
import { __resetBusinessScopeCache } from '@/platform/omni-comms/integrations/business/businessScopeResolver';

describe('normal navigation', () => {
  it('advertises exactly four operator destinations', () => {
    expect(OMNI_COMMS_NAV_ITEMS.map((i) => i.label)).toEqual([
      'Overview',
      'Providers',
      'Communications',
      'Activity',
    ]);
    expect(omniCommsNavItems('production')).toHaveLength(4);
    expect(omniCommsNavItems('non_production')).toHaveLength(4);
  });

  it('advertises no planned or lifecycle destinations', () => {
    expect(OMNI_COMMS_PLANNED_NAV_ITEMS).toHaveLength(0);
    const labels = OMNI_COMMS_NAV_ITEMS.map((i) => i.label.toLowerCase());
    for (const forbidden of [
      'setup',
      'safe test',
      'events',
      'templates',
      'channels',
      'health',
      'test & verify',
      'go live',
      'release control',
    ]) {
      expect(labels).not.toContain(forbidden);
    }
  });

  it('keeps unadvertised deep links resolving to the surface that owns them', () => {
    expect(
      resolveActiveNavItem('/admin/omnichannel-communications/templates', null).id,
    ).toBe('communications');
    expect(
      resolveActiveNavItem('/admin/omnichannel-communications/health', null).id,
    ).toBe('overview');
    expect(
      resolveActiveNavItem('/admin/omnichannel-communications', 'setup').id,
    ).toBe('overview');
    expect(
      resolveActiveNavItem('/admin/omnichannel-communications/channels', null).id,
    ).toBe('providers');
  });
});

describe('scope UX', () => {
  const selector = read(
    'src/platform/omni-comms/admin/components/OmniCommsScopeSelector.tsx',
  );
  const header = read(
    'src/platform/omni-comms/admin/components/OmniCommsModuleHeader.tsx',
  );

  it('renders no organisation selector when there is a single organisation', () => {
    expect(selector).toContain('if (!requiresOrganizationChoice) return null;');
  });

  it('never renders a department selector in the shell', () => {
    // No department state, no department control — only prose explaining why.
    expect(selector).not.toMatch(/departmentId|setDepartmentId|availableDepartments/);
    expect(header).not.toMatch(/departmentName/);
  });
});

describe('module API — business modules provide facts only', () => {
  beforeEach(() => {
    emitSpy.mockClear();
    __resetBusinessScopeCache();
  });

  const input = {
    eventCode: 'BENEFITS.CLAIM.SUBMITTED',
    entity: { type: 'bn_claim', id: 'claim-1', occurrence: 'claim-submitted-v2' },
    context: { productId: 'prod-1' },
    recipients: {
      claimant: {
        reference: 'BN-1',
        displayName: 'Jane Example',
        email: 'jane@example.test',
      },
    },
    data: { reference: 'BN-1', subjectName: 'Jane Example', claimType: 'SB' },
  };

  it('resolves organisation centrally and never asks the module for it', async () => {
    const res = await emitConfiguredBusinessEvent(input);
    expect(res.organizationId).toBe('org-1');
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect((emitSpy.mock.calls[0] as any[])[0].organizationId).toBe('org-1');
  });

  it('inherits organisation defaults when no department is derivable', async () => {
    await emitConfiguredBusinessEvent(input);
    const emission = (emitSpy.mock.calls[0] as any[])[0];
    expect(emission.departmentId).toBeNull();
  });

  it('never selects a channel, template, sender, provider or delivery mode', async () => {
    await emitConfiguredBusinessEvent(input);
    const emission = (emitSpy.mock.calls[0] as any[])[0];
    // Channels present on the emission come from the authoritative effective
    // plan, never from the business caller (the caller supplies no channels).
    expect((input as any).channels).toBeUndefined();
    expect(emission.requestedChannels ?? []).not.toContain('sms');
    expect(emission.mode).toBe('queued');
    expect(Object.keys(emission)).not.toContain('templateId');
    expect(Object.keys(emission)).not.toContain('senderIdentityId');
    expect(Object.keys(emission)).not.toContain('providerAccountId');
  });

  it('derives idempotency identity from the platform, not the caller', async () => {
    await emitConfiguredBusinessEvent(input);
    const emission = (emitSpy.mock.calls[0] as any[])[0];
    expect(emission.entityVersion).toBe('claim-submitted-v2');
    expect(Object.keys(emission)).not.toContain('idempotencyKey');
  });

  it('maps semantic recipient roles onto the canonical persisted vocabulary', async () => {
    await emitConfiguredBusinessEvent(input);
    const emission = (emitSpy.mock.calls[0] as any[])[0];
    expect(emission.recipients).toHaveLength(1);
    expect(emission.recipients[0].recipientType).toBe('external');
    expect(emission.recipients[0].recipientReference).toBe('BN-1');
  });

  it('is non-fatal and bounded when the event identity is incomplete', async () => {
    const res = await emitConfiguredBusinessEvent({
      ...input,
      entity: { ...input.entity, id: '' },
    });
    expect(res.outcome).toBe('blocked');
    expect(res.blockers).toContain('entity_id_required');
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('Benefits reference implementation', () => {
  const intake = read('src/services/bn/intake/claimIntakeService.ts');

  it('records the obligation in the claim transaction, not from the browser', () => {
    expect(intake).not.toContain('emitConfiguredBusinessEvent(');
    expect(intake).toContain('communication_event_id');
  });


  it('no longer resolves organisation context or product policy itself', () => {
    expect(intake).not.toContain('resolveOrganizationContext');
    expect(intake).not.toContain('resolveProductCommunication');
  });

  it('never names a channel, provider or delivery mode', () => {
    expect(intake).not.toMatch(/requestedChannels/);
    expect(intake).not.toMatch(/\bresend\b/i);
    expect(intake).not.toMatch(/mode:\s*'queued'/);
  });
});

/**
 * Omni-Comms — production sender catalogue contract tests.
 *
 * Pure model/adapter tests. No provider calls, no sending, no route mutation.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapSenderCatalogue,
  resolveSenderCatalogueConflict,
} from '@/platform/omni-comms/application/senderCatalogueService';
import {
  audienceHint,
  canRenameToCatalogueCode,
  catalogueApplyBlocker,
  catalogueBlocked,
  catalogueConflicts,
  catalogueEntryExplanation,
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
    department_code: 'BENEFITS',
    department_required: true,
    department_resolved: true,
    scope_note: 'owned_by_benefits_department',
    department_id: 'dept-1',
    display_name: 'SSB Benefits',
    from_address: 'benefits@secureserve.biz',
    existing_sender_code: 'benefits_department',
    reply_to_address: null,
    sender_status: 'active',
    usage: { routes: 0, bindings: 0, messages: 0, module_assignments: 0, tests: 0 },
    channel_endpoint_id: 'ep-1',
    provider_account_id: 'pa-1',
    ...over,
  };
}

function result(
  plan: SenderCatalogueEntry[],
  over: Partial<SenderCatalogueBootstrapResult> = {},
): SenderCatalogueBootstrapResult {
  return {
    organization_id: 'org-1',
    organization_short_name: 'SSB',
    channel: 'email',
    domain: 'secureserve.biz',
    domain_ready: true,
    domain_readiness_blocker: null,
    applied: false,
    total_definitions: 15,
    created: 0,
    existing: 0,
    conflicts: plan.filter((p) => p.status === 'conflict').length,
    blocked: plan.filter((p) => p.status === 'blocked').length,
    future: 0,
    plan,
    generated_at: '2026-01-01T00:00:00Z',
    ...over,
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

  it('records a conflict decision only through the explicit resolution RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await resolveSenderCatalogueConflict({ rpc } as never, {
      organizationId: 'org-1',
      senderIdentityId: 'sid-1',
      catalogueSenderCode: 'compliance_department',
      action: 'approve_equivalent',
    });
    expect(rpc).toHaveBeenCalledWith('omni_comms_sender_catalogue_resolve_conflict', {
      p_organization_id: 'org-1',
      p_sender_identity_id: 'sid-1',
      p_catalogue_sender_code: 'compliance_department',
      p_action: 'approve_equivalent',
      p_expected_updated_at: null,
      p_correlation_id: null,
    });
  });
});

describe('sender catalogue model', () => {
  it('surfaces conflicts for operator decision', () => {
    const r = result([
      entry({}),
      entry({
        sender_code: 'compliance_department',
        status: 'conflict',
        detail: 'address_already_used_by_sender_code_compliance',
      }),
    ]);
    expect(catalogueConflicts(r).map((c) => c.sender_code)).toEqual(['compliance_department']);
    expect(catalogueApplyBlocker(r)).toMatch(/Resolve the reported sender conflicts/);
  });

  it('blocks applying when a required department is missing', () => {
    const r = result([
      entry({
        sender_code: 'legal_department',
        status: 'blocked',
        department_code: 'LEGAL',
        department_resolved: false,
        detail: 'department_not_resolved_LEGAL',
      }),
    ]);
    expect(catalogueBlocked(r)).toHaveLength(1);
    expect(catalogueApplyBlocker(r)).toMatch(/owning department/i);
    expect(catalogueEntryExplanation(r.plan[0])).toMatch(/No active department "LEGAL"/);
  });

  it('allows applying when nothing needs a decision', () => {
    expect(catalogueApplyBlocker(result([entry({})]))).toBeNull();
  });

  it('never promises activation when the domain is not ready', () => {
    const r = result([entry({ status: 'will_create', detail: 'will_create_as_draft_domain_not_ready' })], {
      domain_ready: false,
      domain_readiness_blocker: 'Server DNS evidence has not passed yet.',
    });
    expect(catalogueEntryExplanation(r.plan[0])).toMatch(/draft/i);
    expect(r.domain_readiness_blocker).toBeTruthy();
  });

  it('accepts an operator-approved equivalent sender', () => {
    const e = entry({
      sender_code: 'compliance_department',
      status: 'existing_equivalent',
      detail: 'operator_approved_equivalent_sender',
      existing_sender_code: 'compliance',
    });
    expect(catalogueEntryExplanation(e)).toMatch(/compliance/);
  });

  it('only offers rename when the sender has no routes or messages', () => {
    expect(canRenameToCatalogueCode(entry({}))).toBe(true);
    expect(
      canRenameToCatalogueCode(
        entry({ usage: { routes: 1, bindings: 0, messages: 0, module_assignments: 0, tests: 0 } }),
      ),
    ).toBe(false);
    expect(
      canRenameToCatalogueCode(
        entry({ usage: { routes: 0, bindings: 0, messages: 3, module_assignments: 0, tests: 0 } }),
      ),
    ).toBe(false);
    expect(canRenameToCatalogueCode(entry({ usage: null }))).toBe(false);
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
    expect(Object.keys(SENDER_CATALOGUE_STATUS_LABEL)).toHaveLength(7);
    expect(SENDER_CATALOGUE_STATUS_LABEL.conflict).toMatch(/OPERATOR DECISION/);
    expect(SENDER_CATALOGUE_STATUS_LABEL.blocked).toMatch(/BLOCKED/);
  });
});

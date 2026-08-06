/**
 * AW360-WAVE-1-C1 · Slice A — Active-tab query gating.
 *
 * Proves the Award 360 shell no longer eagerly loads the Overview aggregator,
 * Claim deep view, or Pensioner deep view on unrelated tabs. Spies replace the
 * query hooks so we can assert the exact `enabled` flag passed by the shell on
 * every render.
 *
 * Contract enforced here:
 *   • Overview aggregator runs only when the active tab is `overview`.
 *   • Claim deep query runs only when the active tab is `claim`.
 *   • Pensioner deep query runs only when the active tab is `pensioner`.
 *   • Header + lightweight summary always run when the user can view the Award
 *     (they power the shell shell, badges, cards, and alerts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const noopResult = { data: undefined, isLoading: false, error: null, refetch: vi.fn() } as any;
const headerData = {
  awardId: 'a-1', awardNumber: 'AWD-001', payeeName: 'X', ssnMasked: '***',
  benefitName: 'OA', benefitCode: 'OA', awardType: 'PENSION', status: 'ACTIVE',
  baseAmount: 100, currentRate: 100, currency: 'XCD', frequency: 'MONTHLY',
  startDate: '2024-01-01', endDate: null, productVersion: '1',
  lastRefreshedAt: new Date().toISOString(),
};

const spies = {
  header: vi.fn((..._args: any[]) => ({ ...noopResult, data: headerData })),
  overview: vi.fn((..._args: any[]) => noopResult),
  summary: vi.fn((..._args: any[]) => noopResult),
  claim: vi.fn((..._args: any[]) => noopResult),
  pensioner: vi.fn((..._args: any[]) => noopResult),
};

// Test hygiene: the Benefit 360 mortality card reads the authenticated actor.
// The shell tests deliberately render without an auth provider, so the card is
// stubbed here rather than weakening the card's own auth requirement.
vi.mock('@/components/bn/mortality/Benefit360MortalityCard', () => ({
  Benefit360MortalityCard: () => null,
  default: () => null,
}));

vi.mock('@/pages/bn/awards/award-360/useAward360Queries', () => ({
  useAward360Header: (id: string, enabled: boolean) => spies.header(id, enabled),
  useAward360Overview: (id: string, enabled: boolean, opts: any) => spies.overview(id, enabled, opts),
  useAward360Summary: (id: string, enabled: boolean, opts: any) => spies.summary(id, enabled, opts),
  useAwardClaim: (id: string, enabled: boolean) => spies.claim(id, enabled),
  useAwardPensioner: (id: string, enabled: boolean) => spies.pensioner(id, enabled),
  useAwardProduct: () => noopResult,
  useAwardBeneficiaries: () => noopResult,
  useAwardSchedules: () => noopResult,
  useAwardPayments: () => noopResult,
  useAwardLifeCertificates: () => noopResult,
  useAwardMedicalReviews: () => noopResult,
  useAwardSuspensions: () => noopResult,
  useAwardOverpayments: () => noopResult,
  useAwardCommunications: () => noopResult,
  useAwardAudit: () => noopResult,
  useAwardSchedulesPaged: () => noopResult,
  useAwardPaymentsPaged: () => noopResult,
  useAwardLifeCertificatesPaged: () => noopResult,
  useAwardScheduleDetail: () => noopResult,
  useAwardLifeCertReminders: () => noopResult,
  useAwardBeneficiariesPaged: () => noopResult,
  useAwardBeneficiaryDetail: () => noopResult,
  useAwardOverpaymentsPaged: () => noopResult,
  useAwardOverpaymentDetail: () => noopResult,
  useAwardCommunicationsPaged: () => noopResult,
  useAwardCommunicationDetail: () => noopResult,
  useAwardMedicalReviewsPaged: () => noopResult,
  useAwardMedicalReviewDetail: () => noopResult,
  useAwardAuditPaged: () => noopResult,
}));

vi.mock('@/pages/bn/awards/award-360/useAwardPermissions', () => ({
  useAward360Permissions: () => ({
    canViewAward: true, canViewCentralAudit: false, canPropose: false, canApprove: false,
    canServiceLifeCert: true, canServiceMedical: true, canServiceOverpayment: true,
    canServiceSuspension: true, canServicePayments: true, canServiceCommunications: true,
    canViewCommunicationContent: false, canViewSensitiveMedical: true,
    isLoading: false, isReady: true,
    admin: { isAdmin: false, isLoading: false, isError: false, error: null, refetch: () => {} },
    registryError: null, userPermissionsError: null,
    hasPermissionResolutionError: false,
    refetchAllPermissions: async () => {},
    capabilities: {},
  }),
  useAward360FeatureFlags: () => ({
    lifeCert: true, medicalReview: true, overpayment: true, awardSuspension: true, payments: true,
  }),
}));

vi.mock('@/pages/bn/awards/award-360/useAward360TabAccess', async () => {
  const TABS = ['overview','pensioner','claim','product','beneficiaries','schedule','payments','life-certificates','medical','suspensions','overpayments','communications','audit'] as const;
  const grantAll = () => {
    const out: any = {};
    for (const t of TABS) out[t] = { tab: t, visible: true, queryEnabled: true, reason: 'Granted.', capability: 'AWARD_VIEW' };
    return out;
  };
  return { useAward360TabAccess: () => grantAll(), computeAward360TabAccess: () => grantAll() };
});

import Award360Page from '@/pages/bn/awards/award-360/Award360Page';

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/bn/awards/:id" element={<Award360Page />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastEnabled = (spy: ReturnType<typeof vi.fn>) => {
  const calls = spy.mock.calls;
  if (!calls.length) return false;
  return !!calls[calls.length - 1][1];
};

describe('AW360-WAVE-1-C1 · shell active-tab gating', () => {
  beforeEach(() => {
    for (const s of Object.values(spies)) (s as any).mockClear();
  });

  it('on Overview tab: header + summary + overview all run; claim & pensioner do not', () => {
    renderAt('/bn/awards/a-1?tab=overview');
    expect(lastEnabled(spies.header)).toBe(true);
    expect(lastEnabled(spies.summary)).toBe(true);
    expect(lastEnabled(spies.overview)).toBe(true);
    expect(lastEnabled(spies.claim)).toBe(false);
    expect(lastEnabled(spies.pensioner)).toBe(false);
  });

  it('on Claim tab: overview aggregator + pensioner are disabled; only claim deep loader is enabled', () => {
    renderAt('/bn/awards/a-1?tab=claim');
    expect(lastEnabled(spies.header)).toBe(true);
    expect(lastEnabled(spies.summary)).toBe(true);
    expect(lastEnabled(spies.overview)).toBe(false);
    expect(lastEnabled(spies.claim)).toBe(true);
    expect(lastEnabled(spies.pensioner)).toBe(false);
  });

  it('on Pensioner tab: overview aggregator + claim are disabled; only pensioner deep loader is enabled', () => {
    renderAt('/bn/awards/a-1?tab=pensioner');
    expect(lastEnabled(spies.overview)).toBe(false);
    expect(lastEnabled(spies.claim)).toBe(false);
    expect(lastEnabled(spies.pensioner)).toBe(true);
  });

  it('on Payments tab: overview + claim + pensioner all disabled; summary still runs', () => {
    renderAt('/bn/awards/a-1?tab=payments');
    expect(lastEnabled(spies.overview)).toBe(false);
    expect(lastEnabled(spies.claim)).toBe(false);
    expect(lastEnabled(spies.pensioner)).toBe(false);
    expect(lastEnabled(spies.summary)).toBe(true);
  });

  it('on Audit tab: no shell-level deep loaders fire beyond header + summary', () => {
    renderAt('/bn/awards/a-1?tab=audit');
    expect(lastEnabled(spies.overview)).toBe(false);
    expect(lastEnabled(spies.claim)).toBe(false);
    expect(lastEnabled(spies.pensioner)).toBe(false);
    expect(lastEnabled(spies.summary)).toBe(true);
  });
});

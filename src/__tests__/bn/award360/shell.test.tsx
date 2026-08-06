/**
 * BN-AWARD360-V2 — Shell rendering / tab navigation.
 * Mocks React Query hooks so the shell can render without touching Supabase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Test hygiene: the Benefit 360 mortality card reads the authenticated actor.
// The shell tests deliberately render without an auth provider, so the card is
// stubbed here rather than weakening the card's own auth requirement.
vi.mock('@/components/bn/mortality/Benefit360MortalityCard', () => ({
  Benefit360MortalityCard: () => null,
  default: () => null,
}));

vi.mock('@/pages/bn/awards/award-360/useAward360Queries', () => {
  const q = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() }) as any;
  return {
    useAward360Header: () =>
      q({
        awardId: 'a-1',
        awardNumber: 'AWD-001',
        payeeName: 'Jane Doe',
        ssnMasked: '***-**-999',
        benefitName: 'Old Age',
        benefitCode: 'OA',
        awardType: 'PENSION',
        status: 'ACTIVE',
        baseAmount: 500,
        currentRate: 500,
        currency: 'XCD',
        frequency: 'MONTHLY',
        startDate: '2024-01-01',
        endDate: null,
        productVersion: '1',
        lastRefreshedAt: new Date().toISOString(),
      }),
    useAward360Summary: () =>
      q({
        awardId: 'a-1',
        beneficiaries: { status: 'ok', value: { count: 0, activeCount: 0, activeShareTotal: 0 } },
        schedule: { status: 'ok', value: { count: 0, nextDueDate: null, overdueUnpaidCount: 0 } },
        payments: { status: 'ok', value: { count: 0, lastPaidAmount: null, lastPaidCurrency: null, holdCount: 0, failedCount: 0 } },
        lifeCertificates: { status: 'ok', value: { overdueCount: 0, nextDueDate: null, maxDaysOverdue: 0, overdueSampleDueDate: null } },
        medical: { status: 'ok', value: { dueOrOverdueCount: 0, nextScheduledDate: null, overdueSampleDate: null } },
        suspensions: { status: 'ok', value: { pendingCount: 0, pendingSampleType: null, pendingSampleStatus: null } },
        overpayments: { status: 'ok', value: { outstandingTotal: 0, openCount: 0 } },
        communications: { status: 'ok', value: { failedCount: 0 } },
        warnings: [],
      }),
    useAward360Overview: () =>
      q({
        beneficiaries: [],
        schedules: [],
        payments: [],
        lifeCertificates: [],
        medicalReviews: [],
        suspensions: [],
        overpayments: [],
        communications: [],
        warnings: [],
      }),
    useAwardClaim: () => q(null),
    useAwardPensioner: () => q(null),
    useAwardBeneficiaries: () => q([]),
    useAwardSchedules: () => q([]),
    useAwardPayments: () => q([]),
    useAwardLifeCertificates: () => q([]),
    useAwardMedicalReviews: () => q([]),
    useAwardSuspensions: () => q([]),
    useAwardOverpayments: () => q([]),
    useAwardCommunications: () => q([]),
    useAwardProduct: () => q(null),
    useAwardAudit: () => q([]),
    useAwardSchedulesPaged: () => q({ rows: [], total: 0, page: 1, pageSize: 25, summary: { totalRows: 0, totalGross: 0, totalDeductions: 0, totalNet: 0, paidAmount: 0, pendingAmount: 0, heldAmount: 0, cancelledAmount: 0, overdueUnpaidAmount: 0, futureLiability: 0, nextDueDate: null, lastPaidDate: null }, warnings: [] }),
    useAwardPaymentsPaged: () => q({ rows: [], total: 0, page: 1, pageSize: 25, summary: { totalRows: 0, totalAmount: 0, paidCount: 0, failedCount: 0, cancelledCount: 0, heldCount: 0, queuedCount: 0, otherCount: 0 }, warnings: [] }),
    useAwardLifeCertificatesPaged: () => q({ rows: [], total: 0, page: 1, pageSize: 25, summary: { compliance: { state: 'NOT_REQUIRED', paymentImpact: 'NONE', explanation: '' }, totalCycles: 0, verifiedCycles: 0, pendingCycles: 0, receivedUnverified: 0, overdueCycles: 0, latestRequiredPeriod: null, latestVerifiedPeriod: null, nextDueDate: null, daysUntilDue: null, daysOverdue: null, reminderCount: null }, warnings: [] }),
    useAwardScheduleDetail: () => q(null),
    useAwardLifeCertReminders: () => q({ items: [], warnings: [] }),
  };
});

vi.mock('@/pages/bn/awards/award-360/useAwardPermissions', () => ({
  useAward360Permissions: () => ({
    canViewAward: true,
    canViewCentralAudit: false,
    canPropose: false,
    canApprove: false,
    canServiceLifeCert: true,
    canServiceMedical: true,
    canServiceOverpayment: true,
    canServiceSuspension: true,
    canServicePayments: true,
    canServiceCommunications: true,
    canViewCommunicationContent: false,
    canViewSensitiveMedical: true,
    isLoading: false,
    isReady: true,
    admin: { isAdmin: true, isLoading: false, isError: false, error: null, refetch: () => {} },
    registryError: null,
    userPermissionsError: null,
    hasPermissionResolutionError: false,
    refetchAllPermissions: async () => {},
    capabilities: {},
  }),
  useAward360FeatureFlags: () => ({
    lifeCert: true, medicalReview: true, overpayment: true, awardSuspension: true, payments: true,
  }),
}));

vi.mock('@/pages/bn/awards/award-360/useAward360TabAccess', async () => {
  const actual = await vi.importActual<any>('@/pages/bn/awards/award-360/useAward360TabAccess');
  const AWARD_TABS = ['overview','pensioner','claim','product','beneficiaries','schedule','payments','life-certificates','medical','suspensions','overpayments','communications','audit'] as const;
  const grantAll = () => {
    const out: any = {};
    for (const t of AWARD_TABS) out[t] = { tab: t, visible: true, queryEnabled: true, reason: 'Granted.', capability: 'AWARD_VIEW' };
    return out;
  };
  return { ...actual, useAward360TabAccess: () => grantAll(), computeAward360TabAccess: () => grantAll() };
});

import Award360Page from '@/pages/bn/awards/award-360/Award360Page';

function renderAt(initialUrl: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/bn/awards/:id" element={<Award360Page />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BN-AWARD360-V2 · shell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the header and all 13 tabs', () => {
    renderAt('/bn/awards/a-1');
    expect(screen.getByText(/Award AWD-001/i)).toBeInTheDocument();
    const expectedTabs = ['Overview', 'Pensioner', 'Claim', 'Product', 'Beneficiaries', 'Schedule', 'Payments', 'Life Certs', 'Medical', 'Suspensions', 'Overpayments', 'Communications', 'Audit'];
    for (const label of expectedTabs) {
      expect(screen.getByRole('tab', { name: new RegExp(`^${label}$`) })).toBeInTheDocument();
    }
  });

  it('selects tab from ?tab= query param', () => {
    renderAt('/bn/awards/a-1?tab=payments');
    const paymentsTab = screen.getByRole('tab', { name: /^Payments$/ });
    expect(paymentsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('changes tab on click', () => {
    renderAt('/bn/awards/a-1');
    fireEvent.click(screen.getByRole('tab', { name: /^Suspensions$/ }));
    expect(screen.getByRole('tab', { name: /^Suspensions$/ })).toHaveAttribute('aria-selected', 'true');
  });
});

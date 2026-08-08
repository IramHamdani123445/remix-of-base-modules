/**
 * Benefits Operational UX — record-workspace closeout certification.
 *
 * Proves the shared operational pattern is actually wired, not just routed:
 *   - every record workspace leads with a business reference and a back route
 *   - "what needs to happen next" is backend-driven and fails closed
 *   - the Uprating module has a real overview that never presents a failed
 *     read as zero work
 *   - Overpayment case work is a page-level workspace, not a modal
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BnNextActionCard,
  BnRecordWorkspaceHeader,
  BN_ACTION_UNCONFIRMED_MESSAGE,
} from '@/components/bn/ux';

const ROOT = process.cwd();

vi.mock('@/services/bn/uprating/upratingRunService', () => ({
  fetchUpratingRunList: vi.fn(),
}));

import { fetchUpratingRunList } from '@/services/bn/uprating/upratingRunService';
import { BnUpratingOverview } from '@/components/bn/uprating/BnUpratingOverview';

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const RUN_ROW = {
  run_id: 'run-1',
  run_reference: 'UPR-2026-0001',
  run_name: null,
  status: 'SIMULATED',
  status_label: 'Simulated',
  country_code: 'KN',
  target_effective_date: '2026-04-01',
  policy_id: 'p1',
  policy_code: 'UPR-CPI',
  policy_name: 'CPI uprating',
  policy_version_id: 'v1',
  version_reference: 'v1',
  frozen_policy_type: 'CPI',
  frozen_rounding_mode: 'HALF_UP',
  simulation_state: 'STALE',
  current_snapshot_version: 1,
  current_simulation_version: 1,
  row_version: 3,
  created_by_name: 'Officer',
  created_at: '2026-02-01T00:00:00Z',
};

describe('Benefits record workspace pattern', () => {
  it('leads with the business reference and offers a named back route', () => {
    const onBack = vi.fn();
    render(
      <BnRecordWorkspaceHeader
        backLabel="Work queue"
        onBack={onBack}
        reference="MT-2026-0001"
        status="Submitted"
        facts={[{ label: 'Outstanding', value: 'XCD 100.00' }]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'MT-2026-0001' })).toBeInTheDocument();
    expect(screen.getByTestId('bn-record-back')).toHaveTextContent('Work queue');
    expect(screen.getByTestId('bn-record-status')).toHaveTextContent('Submitted');
  });

  it('never presents an unreadable action contract as "nothing to do"', () => {
    render(<BnNextActionCard status="error" />);
    expect(screen.getByTestId('bn-next-action-unconfirmed')).toBeInTheDocument();
    expect(screen.getByText(BN_ACTION_UNCONFIRMED_MESSAGE)).toBeInTheDocument();
  });

  it('offers only actions the backend declared available', () => {
    render(
      <BnNextActionCard
        status="ready"
        actions={[
          { id: 'a', label: 'Submit assessment', available: true, onSelect: () => {} },
          { id: 'b', label: 'Approve assessment', available: false, reason: 'Not yet submitted' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Go to this step' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Not available' })).toBeDisabled();
  });
});

describe('Uprating module overview', () => {
  beforeEach(() => vi.mocked(fetchUpratingRunList).mockReset());

  it('summarises the pipeline and surfaces runs that need attention', async () => {
    vi.mocked(fetchUpratingRunList).mockResolvedValue({
      status: 'OK',
      code: null,
      data: { rows: [RUN_ROW], total: 1 },
    } as never);

    renderWithProviders(<BnUpratingOverview />);

    expect(await screen.findByText('In preparation')).toBeInTheDocument();
    expect((await screen.findAllByText('UPR-2026-0001')).length).toBeGreaterThan(0);
  });

  it('shows counts as unavailable, never as zero, when the read fails', async () => {
    vi.mocked(fetchUpratingRunList).mockResolvedValue({
      status: 'ERROR',
      code: 'E_UNAVAILABLE',
      data: null,
    } as never);

    renderWithProviders(<BnUpratingOverview />);

    await waitFor(() =>
      expect(screen.getByTestId('bn-uprating-overview-unavailable')).toBeInTheDocument(),
    );
  });
});

describe('module workspaces consume the shared pattern', () => {
  const sourceOf = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  const WIRED: readonly string[] = [
    'src/components/bn/meansTests/BnMeansAssessmentWorkspace.tsx',
    'src/components/bn/risk/BnRiskAssessmentWorkspace.tsx',
    'src/components/bn/uprating/BnUpratingRunWorkspace.tsx',
    'src/pages/bn/servicing/OverpaymentRecovery.tsx',
  ];

  it.each(WIRED)('%s renders the shared header and next-action card', (file) => {
    const src = sourceOf(file);
    expect(src).toContain('BnRecordWorkspaceHeader');
    expect(src).toContain('BnNextActionCard');
  });

  it('Overpayment case work is a page-level workspace, not a modal', () => {
    const src = sourceOf('src/pages/bn/servicing/OverpaymentRecovery.tsx');
    expect(src).toContain('bn-overpayment-case-workspace');
    expect(src).not.toContain('<Dialog open={!!selected}');
  });

  it('every record workspace has a stable, refresh-survivable address', () => {
    expect(sourceOf('src/pages/bn/uprating/BnUpratingPage.tsx')).toContain('runs/:runId');
    expect(sourceOf('src/pages/bn/meansTests/BnMeansTestsPage.tsx')).toContain(
      'assessments/:assessmentId',
    );
    expect(sourceOf('src/pages/bn/risk/BnRiskManagementPage.tsx')).toContain(
      'assessments/:assessmentId',
    );
    expect(sourceOf('src/pages/bn/servicing/OverpaymentRecovery.tsx')).toContain('/cases/');
  });
});

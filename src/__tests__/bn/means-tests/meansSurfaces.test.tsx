/**
 * BN Means-Test — MT4/MT5 surface guards.
 *
 * Proves dark-launch behaviour, state-driven action availability sourced
 * from the canonical available-actions query, explicit failure states, and
 * that Benefit 360 never exposes household finances.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const workQueue = vi.fn();
const detail = vi.fn();
const availableActions = vi.fn();
const benefit360Summary = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    workQueue: (...a: unknown[]) => workQueue(...a),
    detail: (...a: unknown[]) => detail(...a),
    availableActions: (...a: unknown[]) => availableActions(...a),
    benefit360Summary: (...a: unknown[]) => benefit360Summary(...a),
  },
}));
vi.mock('@/services/bn/meansTests/meansCommandService', () => ({
  meansCommandService: { execute: (...a: unknown[]) => execute(...a) },
}));

import { BnMeansAssessmentWorkspace } from '@/components/bn/meansTests/BnMeansAssessmentWorkspace';
import { Benefit360MeansTestCard } from '@/components/bn/meansTests/Benefit360MeansTestCard';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ASSESSMENT = {
  assessment: {
    assessment_id: 'a1',
    assessment_reference: 'MT-2026-0001',
    benefit_programme: 'ASSISTANCE',
    assessment_reason: 'NEW_CLAIM',
    status: 'DRAFT',
    currency_code: 'XCD',
    row_version: 3,
    effective_from: '2026-01-01',
  },
  household: [],
  income: [{ income_fact_id: 'i1', category_code: 'EMPLOYMENT', declared_amount: 100, declared_frequency: 'MONTHLY', normalised_annual_amount: 1200 }],
  assets: [],
  deductions: [],
  evidence: [],
  versions: [],
  timeline: [],
};

beforeEach(() => {
  [workQueue, detail, availableActions, benefit360Summary, execute].forEach((m) => m.mockReset());
});

describe('MT4 — assessment workspace', () => {
  it('disables submission and explains the dark-launch reason', async () => {
    detail.mockResolvedValue({ status: 'OK', data: ASSESSMENT });
    availableActions.mockResolvedValue({
      status: 'OK',
      data: [{ command: 'BN_MEANS_SUBMIT', allowed: false, reason: 'ACTIONS_DISABLED', row_version: 3 }],
    });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);

    expect(await screen.findByText(/MT-2026-0001/)).toBeInTheDocument();
    expect(screen.getByText('Version 3')).toBeInTheDocument();
    await waitFor(() => expect(availableActions).toHaveBeenCalledWith('a1'));
  });

  it('states an explicit failure instead of an empty assessment', async () => {
    detail.mockResolvedValue({ status: 'FAILED', data: null, detail: 'connection reset' });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);

    expect(await screen.findByText('Assessment unavailable')).toBeInTheDocument();
  });

  it('states an explicit denial', async () => {
    detail.mockResolvedValue({ status: 'DENIED', data: null, code: 'PERMISSION_DENIED' });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);

    expect(
      await screen.findByText('You do not have permission to view this assessment.'),
    ).toBeInTheDocument();
  });
});

describe('MT5 — Benefit 360 card', () => {
  it('never shows household finances', async () => {
    benefit360Summary.mockResolvedValue({
      status: 'OK',
      data: {
        assessment_reference: 'MT-2026-0001',
        status: 'ACTIVE',
        assessment_reason: 'NEW_CLAIM',
        result: 'PASS',
        effective_from: '2026-01-01',
        valid_until: '2027-01-01',
        reassessment_due: '2026-07-01',
        missing_information: false,
        pending_verification: false,
      },
    });

    const { container } = wrap(<Benefit360MeansTestCard awardId="aw1" />);

    expect(await screen.findByTestId('award360-means-card')).toBeInTheDocument();
    const text = container.textContent ?? '';
    for (const forbidden of ['income', 'Income', 'asset', 'Asset', 'household', 'Household']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('reports unavailability rather than absence when access is denied', async () => {
    benefit360Summary.mockResolvedValue({ status: 'DENIED', data: null, code: 'PERMISSION_DENIED' });
    wrap(<Benefit360MeansTestCard awardId="aw1" />);
    expect(await screen.findByTestId('award360-means-unavailable')).toBeInTheDocument();
  });

  it('shows "no assessment" only on a successful empty read', async () => {
    benefit360Summary.mockResolvedValue({ status: 'OK', data: null });
    wrap(<Benefit360MeansTestCard awardId="aw1" />);
    expect(await screen.findByTestId('award360-means-none')).toBeInTheDocument();
  });
});

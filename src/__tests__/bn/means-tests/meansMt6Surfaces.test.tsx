/**
 * BN Means-Test MT6 — verification and calculation surface guards.
 *
 * Proves: verification is per-fact and never edits declared values,
 * availability comes from the canonical query, readiness is backend-owned
 * (never recomputed in React), failed readiness reads are stated as
 * unknown, and Benefit 360 still exposes no household finances.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const detail = vi.fn();
const availableActions = vi.fn();
const calculationReadiness = vi.fn();
const benefit360Summary = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    workQueue: vi.fn(),
    detail: (...a: unknown[]) => detail(...a),
    availableActions: (...a: unknown[]) => availableActions(...a),
    calculationReadiness: (...a: unknown[]) => calculationReadiness(...a),
    calculationTrace: vi.fn(),
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

const SUBMITTED = {
  assessment: {
    assessment_id: 'a1',
    assessment_reference: 'MT-2026-0002',
    status: 'VERIFICATION_PENDING',
    currency_code: 'XCD',
    row_version: 5,
    effective_from: '2026-01-01',
  },
  household: [],
  income: [
    {
      income_fact_id: 'i1',
      category_code: 'EMPLOYMENT',
      declared_amount: 1200,
      declared_frequency: 'MONTHLY',
      normalised_annual_amount: 14400,
      fact_source: 'DECLARED',
      effective_from: '2026-01-01',
      evidence_status: 'ATTACHED',
    },
  ],
  assets: [],
  deductions: [],
  evidence: [],
  verifications: [],
  calculations: [],
  versions: [],
  timeline: [],
};

beforeEach(() => {
  [detail, availableActions, calculationReadiness, benefit360Summary, execute].forEach((m) => m.mockReset());
});

describe('MT6 — per-fact verification', () => {
  it('records a verification outcome for one fact through the governed command', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({
      status: 'OK',
      data: [{ command: 'BN_MEANS_VERIFY_INFORMATION', allowed: true, reason: null, row_version: 5 }],
    });
    calculationReadiness.mockResolvedValue({ status: 'OK', data: null });
    execute.mockResolvedValue({ status: 'OK' });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);

    await userEvent.click(await screen.findByRole('tab', { name: 'Verification' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'BN_MEANS_VERIFY_INFORMATION',
          assessmentId: 'a1',
          expectedRowVersion: 5,
          payload: expect.objectContaining({ fact_kind: 'INCOME', fact_id: 'i1', outcome: 'VERIFIED' }),
        }),
      ),
    );
  });

  it('disables verification when the canonical query refuses it', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({
      status: 'OK',
      data: [{ command: 'BN_MEANS_VERIFY_INFORMATION', allowed: false, reason: 'ACTIONS_DISABLED', row_version: 5 }],
    });
    calculationReadiness.mockResolvedValue({ status: 'OK', data: null });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Verification' }));

    expect(await screen.findByTestId('means-verification-disabled')).toHaveTextContent(
      'internal pilot',
    );
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });
});

describe('MT6 — deterministic calculation', () => {
  it('renders backend readiness blockers and keeps Calculate disabled', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({
      status: 'OK',
      data: [{ command: 'BN_MEANS_CALCULATE', allowed: false, reason: 'NOT_READY_FOR_CALCULATION', row_version: 5 }],
    });
    calculationReadiness.mockResolvedValue({
      status: 'OK',
      data: {
        assessment_id: 'a1',
        status: 'VERIFICATION_PENDING',
        ready_for_calculation: false,
        missing_verifications: [{ fact_kind: 'INCOME', fact_id: 'i1' }],
        rejected_facts: [],
        clarification_required: [],
        policy_configuration_issues: [],
        currency_issues: [],
        reason_codes: ['MISSING_VERIFICATION'],
      },
    });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Calculation' }));

    expect(await screen.findByTestId('means-readiness-blockers')).toHaveTextContent('INCOME i1');
    expect(screen.getByTestId('means-calculate')).toBeDisabled();
  });

  it('states readiness as unknown when the readiness read fails', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });
    calculationReadiness.mockResolvedValue({ status: 'FAILED', data: null, detail: 'connection reset' });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Calculation' }));

    expect(await screen.findByTestId('means-readiness-unavailable')).toBeInTheDocument();
  });

  it('shows the immutable calculation trace when one exists', async () => {
    detail.mockResolvedValue({
      status: 'OK',
      data: {
        ...SUBMITTED,
        calculations: [
          {
            calculation_id: 'c1',
            result: 'PASS',
            assessed_means_amount: 14400,
            threshold_amount: 20000,
            calculated_at: '2026-02-01T10:00:00Z',
            policy_version_id: 'p1',
            input_hash: 'abc123',
            lines: [
              { line_id: 'l1', sequence_no: 1, line_type: 'INCOME_TOTAL', rule_code: 'R1', amount: 14400, explanation: 'Annualised verified income' },
            ],
          },
        ],
      },
    });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });
    calculationReadiness.mockResolvedValue({ status: 'OK', data: null });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Calculation' }));

    const trace = await screen.findByTestId('means-calculation-trace');
    expect(trace).toHaveTextContent('abc123');
    expect(trace).toHaveTextContent('INCOME_TOTAL');
  });
});

describe('MT6 — Benefit 360 privacy is preserved', () => {
  it('shows calculation posture without any household finance detail', async () => {
    benefit360Summary.mockResolvedValue({
      status: 'OK',
      data: {
        assessment_reference: 'MT-2026-0002',
        status: 'CALCULATED',
        assessment_reason: 'NEW_CLAIM',
        result: null,
        verification_status: 'COMPLETE',
        calculation_status: 'CALCULATED',
        provisional_result: 'PASS',
        calculated_at: '2026-02-01',
        pending_approval: true,
        effective_from: '2026-01-01',
      },
    });

    const { container } = wrap(<Benefit360MeansTestCard awardId="aw1" />);

    expect(await screen.findByTestId('award360-means-card')).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    const text = container.textContent ?? '';
    for (const forbidden of ['income', 'Income', 'asset', 'Asset', 'household', 'Household', 'deduction']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

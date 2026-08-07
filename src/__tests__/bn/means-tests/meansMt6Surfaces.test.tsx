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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const detail = vi.fn();
const availableActions = vi.fn();
const calculationReadiness = vi.fn();
const benefit360Summary = vi.fn();
const execute = vi.fn();
const verificationWorkspace = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    workQueue: vi.fn(),
    detail: (...a: unknown[]) => detail(...a),
    availableActions: (...a: unknown[]) => availableActions(...a),
    calculationReadiness: (...a: unknown[]) => calculationReadiness(...a),
    calculationTrace: vi.fn(),
    benefit360Summary: (...a: unknown[]) => benefit360Summary(...a),
    adjustments: vi.fn(async () => ({ status: 'OK', data: [] })),
    approvalContext: vi.fn(async () => ({ status: 'OK', data: null })),
    queue: vi.fn(async () => ({ status: 'OK', data: [] })),
    verificationWorkspace: (...a: unknown[]) => verificationWorkspace(...a),
    verificationQueue: vi.fn(async () => ({ status: 'OK', data: [] })),
    verificationReadiness: vi.fn(async () => ({ status: 'OK', data: null })),
    verificationReference: vi.fn(async () => ({ status: 'OK', data: null })),
  },
}));
vi.mock('@/services/bn/meansTests/meansCommandService', () => ({
  meansCommandService: { execute: (...a: unknown[]) => execute(...a) },
}));

import { BnMeansAssessmentWorkspace } from '@/components/bn/meansTests/BnMeansAssessmentWorkspace';
import { Benefit360MeansTestCard } from '@/components/bn/meansTests/Benefit360MeansTestCard';

async function openTab(name: string) {
  const tab = await screen.findByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

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
  [detail, availableActions, calculationReadiness, benefit360Summary, execute, verificationWorkspace]
    .forEach((m) => m.mockReset());
});

describe('EPIC 8 — per-fact verification surface', () => {
  const FROZEN_WORKSPACE = {
    assessment: {
      assessment_id: 'a1',
      assessment_reference: 'MT-2026-0002',
      benefit_programme: 'SB',
      assessment_reason: 'NEW_CLAIM',
      status: 'VERIFICATION_PENDING',
      currency_code: 'XCD',
      effective_from: '2026-01-01',
      effective_to: null,
      row_version: 5,
    },
    frozen_version: {
      assessment_version_id: 'v1',
      version_no: 1,
      frozen_at: '2026-08-08T09:00:00Z',
      frozen_by: 'officer',
      snapshot_hash: 'abc',
      snapshot_hash_valid: true,
    },
    actor: { can_verify: true, is_submitter: false, denied_reason: null },
    facts: [
      {
        work_id: 'w1',
        fact_kind: 'INCOME',
        fact_ref_id: 'i1',
        fact_summary: 'Employment income — Acme Ltd',
        priority: 'NORMAL',
        status: 'IN_PROGRESS',
        outcome: null,
        outcome_reason_code: null,
        outcome_note: null,
        decided_at: null,
        decided_by: null,
        claimed_by: 'me',
        claimed_at: '2026-08-08T10:00:00Z',
        claimed_by_me: true,
        review_round: 1,
        declared: { category_code: 'EMPLOYMENT', declared_amount: 1200, declared_frequency: 'MONTHLY' },
        evidence: [],
        clarification: null,
        allowed_actions: ['BN_MEANS_RECORD_VERIFICATION_DECISION'],
        decision_history: [],
      },
    ],
    readiness: {
      assessment_id: 'a1', assessment_version_id: 'v1', version_no: 1,
      frozen_at: '2026-08-08T09:00:00Z', snapshot_hash_valid: true, status: 'VERIFICATION_PENDING',
      verification_complete: false, verification_marked_complete: false, verification_outcome: null,
      section_status: 'IN_PROGRESS', total_work: 1, pending_work: 0, in_progress_work: 1,
      clarification_pending_work: 0, completed_work: 0, cancelled_work: 0, verified_facts: 0,
      rejected_facts: 0, not_applicable_facts: 0, open_clarification_requests: 0,
      warnings: [], blockers: [], reason_codes: [],
    },
    reference: {
      outcomes: [{ code: 'VERIFIED', label: 'Verified' }],
      reject_reasons: [], clarification_reasons: [], not_applicable_reasons: [],
      reopen_reasons: [], recipient_kinds: [], response_kinds: [], fact_kinds: [],
    },
  };

  it('records a verification decision against the frozen version through the governed command', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });
    calculationReadiness.mockResolvedValue({ status: 'OK', data: null });
    verificationWorkspace.mockResolvedValue({ status: 'OK', data: FROZEN_WORKSPACE });
    execute.mockResolvedValue({ status: 'EXECUTED' });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);

    await openTab('Verification');
    fireEvent.click(await screen.findByTestId('means-open-decision-w1'));
    fireEvent.click(await screen.findByTestId('means-verification-decision-submit'));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'BN_MEANS_RECORD_VERIFICATION_DECISION',
          assessmentId: 'a1',
          payload: expect.objectContaining({ work_id: 'w1', outcome: 'VERIFIED' }),
        }),
      ),
    );
  });

  it('states the surface as unavailable rather than empty when the governed read fails', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });
    calculationReadiness.mockResolvedValue({ status: 'OK', data: null });
    verificationWorkspace.mockResolvedValue({ status: 'FAILED', data: null, detail: 'connection reset' });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Verification');

    expect(await screen.findByTestId('means-verification-failed')).toBeInTheDocument();
  });

  it('keeps the submitter out of verification', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });
    calculationReadiness.mockResolvedValue({ status: 'OK', data: null });
    verificationWorkspace.mockResolvedValue({
      status: 'OK',
      data: {
        ...FROZEN_WORKSPACE,
        actor: { can_verify: false, is_submitter: true, denied_reason: null },
        facts: [{ ...FROZEN_WORKSPACE.facts[0], allowed_actions: [] }],
      },
    });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Verification');

    expect(await screen.findByTestId('means-verification-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('means-open-decision-w1')).toBeNull();
    expect(screen.getByTestId('means-complete-verification')).toBeDisabled();
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
    await openTab('Calculation');

    expect(await screen.findByTestId('means-readiness-blockers')).toHaveTextContent('INCOME i1');
    expect(screen.getByTestId('means-calculate')).toBeDisabled();
  });

  it('states readiness as unknown when the readiness read fails', async () => {
    detail.mockResolvedValue({ status: 'OK', data: SUBMITTED });
    availableActions.mockResolvedValue({ status: 'OK', data: [] });
    calculationReadiness.mockResolvedValue({ status: 'FAILED', data: null, detail: 'connection reset' });

    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Calculation');

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
    await openTab('Calculation');

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

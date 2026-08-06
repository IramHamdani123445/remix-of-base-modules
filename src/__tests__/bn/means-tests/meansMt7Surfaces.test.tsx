/**
 * BN Means-Test MT7 — adjustment and independent-approval surface guards.
 *
 * Proves: adjustments are additive and never edit frozen facts, command
 * availability and denial reasons always come from the canonical query,
 * a requester can never decide their own adjustment or approve their own
 * assessment, an unapplied approved adjustment blocks approval, entered
 * information survives a recoverable failure, approval never activates
 * entitlement, and Benefit 360 exposes posture without finances.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const detail = vi.fn();
const availableActions = vi.fn();
const calculationReadiness = vi.fn();
const adjustments = vi.fn();
const approvalContext = vi.fn();
const queue = vi.fn();
const benefit360Summary = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    workQueue: vi.fn(async () => ({ status: 'OK', data: [] })),
    detail: (...a: unknown[]) => detail(...a),
    availableActions: (...a: unknown[]) => availableActions(...a),
    calculationReadiness: (...a: unknown[]) => calculationReadiness(...a),
    calculationTrace: vi.fn(),
    adjustments: (...a: unknown[]) => adjustments(...a),
    approvalContext: (...a: unknown[]) => approvalContext(...a),
    queue: (...a: unknown[]) => queue(...a),
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

async function openTab(name: string) {
  const tab = await screen.findByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

const CALCULATED_DETAIL = {
  status: 'OK',
  data: {
    assessment: {
      assessment_id: 'a1',
      assessment_reference: 'MT-2026-0007',
      status: 'CALCULATED',
      currency_code: 'XCD',
      row_version: 9,
      effective_from: '2026-01-01',
    },
    household: [],
    income: [],
    assets: [],
    deductions: [],
    evidence: [],
    verifications: [],
    calculations: [
      { calculation_id: 'c1', calculation_hash: 'hash-c1', result: 'ELIGIBLE', excess_amount: 0 },
    ],
    versions: [],
    timeline: [],
  },
};

const APPROVAL_CONTEXT = {
  assessment_id: 'a1',
  assessment_reference: 'MT-2026-0007',
  status: 'CALCULATED',
  row_version: 9,
  currency_code: 'XCD',
  assessment_version_id: 'v1',
  assessment_version_no: 1,
  policy_version_id: 'p1',
  verification_missing: 0,
  verification_clarification: 0,
  verification_complete: true,
  calculation_id: 'c1',
  calculation_hash: 'hash-c1',
  input_hash: 'hash-in',
  calculated_at: '2026-02-01',
  result: 'ELIGIBLE',
  assessable_income: 14400,
  assessable_assets: 0,
  approved_deductions: 0,
  threshold_amount: 20000,
  excess_amount: 0,
  household_size: 3,
  warnings: [],
  supersedes_calculation_id: null,
  triggering_adjustment_id: null,
  previous_result: null,
  previous_excess_amount: null,
  previous_assessable_income: null,
  previous_calculation_hash: null,
  open_adjustments: 0,
  adjustments_pending_application: 0,
  maker_user_id: 'officer-1',
  proposed_checker_user_id: null,
  actor_is_maker: false,
  valid_from: '2026-01-01',
  valid_until: '2026-12-31',
  reassessment_due: '2026-12-01',
  approved_calculation_id: null,
  approved_at: null,
  decided_at: null,
  decision_reason_code: null,
  checker_user_id: null,
  decisions: [],
};

const REQUESTED_ADJUSTMENT = {
  adjustment_id: 'adj1',
  adjustment_reference: 'MTA-0001',
  assessment_id: 'a1',
  assessment_version_id: 'v1',
  calculation_id: 'c1',
  original_calculation_hash: 'hash-c1',
  target_kind: 'INCOME_TREATMENT',
  target_id: 'i1',
  field_or_line_code: 'EMPLOYMENT',
  original_value: '14400',
  proposed_value: '12000',
  currency_code: 'XCD',
  financial_effect: -2400,
  reason_code: 'EVIDENCE_CORRECTION',
  justification: 'Payslips show a lower annual figure.',
  evidence_id: null,
  evidence_reference: 'EV-77',
  status: 'REQUESTED',
  requested_by: 'officer-1',
  requested_at: '2026-02-02',
  decided_by: null,
  decided_at: null,
  decision_reason_code: null,
  decision_note: null,
  applied_calculation_id: null,
  applied_at: null,
  application_error: null,
  row_version: 1,
  resulting_result: null,
  resulting_calculation_hash: null,
  resulting_excess_amount: null,
  is_requester: false,
};

function actionSet(overrides: Record<string, { allowed: boolean; reason?: string | null }>) {
  const base: Record<string, { allowed: boolean; reason: string | null }> = {
    BN_MEANS_REQUEST_ADJUSTMENT: { allowed: true, reason: null },
    BN_MEANS_APPROVE_ADJUSTMENT: { allowed: true, reason: null },
    BN_MEANS_APPROVE: { allowed: true, reason: null },
    BN_MEANS_REJECT: { allowed: true, reason: null },
  };
  const merged = { ...base } as Record<string, { allowed: boolean; reason: string | null }>;
  for (const [k, v] of Object.entries(overrides)) merged[k] = { allowed: v.allowed, reason: v.reason ?? null };
  return {
    status: 'OK',
    data: Object.entries(merged).map(([command, v]) => ({ command, allowed: v.allowed, reason: v.reason })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  detail.mockResolvedValue(CALCULATED_DETAIL);
  calculationReadiness.mockResolvedValue({ status: 'OK', data: { ready: true, blockers: [] } });
  adjustments.mockResolvedValue({ status: 'OK', data: [] });
  approvalContext.mockResolvedValue({ status: 'OK', data: APPROVAL_CONTEXT });
  availableActions.mockResolvedValue(actionSet({}));
  queue.mockResolvedValue({ status: 'OK', data: [] });
  execute.mockResolvedValue({ status: 'SUCCEEDED' });
});

describe('MT7 — adjustment register and request', () => {
  it('requests an adjustment against the current calculation without editing frozen facts', async () => {
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');

    fireEvent.click(await screen.findByTestId('means-request-adjustment-open'));
    fireEvent.change(screen.getByLabelText('Field or line code'), { target: { value: 'EMPLOYMENT' } });
    fireEvent.change(screen.getByLabelText('Proposed treatment or value'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'EVIDENCE_CORRECTION' } });
    fireEvent.click(screen.getByTestId('means-request-adjustment-submit'));

    await waitFor(() => expect(execute).toHaveBeenCalled());
    const call = execute.mock.calls[0][0];
    expect(call.command).toBe('BN_MEANS_REQUEST_ADJUSTMENT');
    expect(call.payload.calculation_id).toBe('c1');
    expect(call.payload.expected_row_version).toBe(9);
    // No intake command is ever issued from the adjustment surface.
    expect(call.command).not.toMatch(/ADD_|UPDATE_/);
  });

  it('renders the backend denial reason instead of inventing one', async () => {
    availableActions.mockResolvedValue(
      actionSet({ BN_MEANS_REQUEST_ADJUSTMENT: { allowed: false, reason: 'CALCULATION_NOT_LATEST' } }),
    );
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');

    expect(await screen.findByTestId('means-request-adjustment-reason')).toHaveTextContent(
      'not the latest',
    );
    expect(screen.getByTestId('means-request-adjustment-open')).toBeDisabled();
  });

  it('keeps entered information after a recoverable failure', async () => {
    execute.mockResolvedValue({ status: 'FAILED', errorCode: 'MISSING_EVIDENCE' });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');

    fireEvent.click(await screen.findByTestId('means-request-adjustment-open'));
    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'EVIDENCE_CORRECTION' } });
    fireEvent.click(screen.getByTestId('means-request-adjustment-submit'));

    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(screen.getByLabelText('Reason code')).toHaveValue('EVIDENCE_CORRECTION');
  });

  it('states that adjustments are unavailable rather than showing none', async () => {
    adjustments.mockResolvedValue({ status: 'DENIED' });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');
    expect(await screen.findByTestId('means-adjustments-unavailable')).toBeInTheDocument();
  });
});

describe('MT7 — adjustment decision', () => {
  it('shows original, proposed, effect, evidence and requester before a decision', async () => {
    adjustments.mockResolvedValue({ status: 'OK', data: [REQUESTED_ADJUSTMENT] });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');

    const panel = await screen.findByTestId('means-adjustment-decision-adj1');
    expect(panel).toHaveTextContent('14400');
    expect(panel).toHaveTextContent('12000');
    expect(panel).toHaveTextContent('EV-77');
    expect(panel).toHaveTextContent('officer-1');
  });

  it('refuses a self-decision by the requester', async () => {
    adjustments.mockResolvedValue({
      status: 'OK',
      data: [{ ...REQUESTED_ADJUSTMENT, is_requester: true }],
    });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');

    expect(await screen.findByTestId('means-adjustment-self-warning-adj1')).toBeInTheDocument();
    expect(screen.queryByTestId('means-adjustment-approve-adj1')).toBeNull();
  });

  it('sends the adjustment decision with its own row version', async () => {
    adjustments.mockResolvedValue({ status: 'OK', data: [REQUESTED_ADJUSTMENT] });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');

    fireEvent.click(await screen.findByTestId('means-adjustment-approve-adj1'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    const call = execute.mock.calls[0][0];
    expect(call.command).toBe('BN_MEANS_APPROVE_ADJUSTMENT');
    expect(call.payload).toMatchObject({
      adjustment_id: 'adj1',
      decision: 'APPROVE',
      expected_adjustment_row_version: 1,
    });
  });

  it('surfaces a failed recalculation instead of implying the adjustment took effect', async () => {
    adjustments.mockResolvedValue({
      status: 'OK',
      data: [
        {
          ...REQUESTED_ADJUSTMENT,
          status: 'APPROVED_PENDING_APPLICATION',
          application_error: 'Recalculation failed: policy parameter missing',
        },
      ],
    });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Adjustments');

    expect(await screen.findByTestId('means-adjustment-application-error-adj1')).toHaveTextContent(
      'Recalculation failed',
    );
  });
});

describe('MT7 — final approval', () => {
  it('shows the backend approval context and submits the decision against the calculation', async () => {
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Approval');

    const panel = await screen.findByTestId('means-approval-panel');
    expect(panel).toHaveTextContent('ELIGIBLE');
    expect(panel).toHaveTextContent('hash-c1');

    fireEvent.click(screen.getByTestId('means-approve'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    const call = execute.mock.calls[0][0];
    expect(call.command).toBe('BN_MEANS_APPROVE');
    expect(call.payload).toMatchObject({ calculation_id: 'c1', calculation_hash: 'hash-c1' });
  });

  it('blocks approval while an approved adjustment has not been applied', async () => {
    approvalContext.mockResolvedValue({
      status: 'OK',
      data: { ...APPROVAL_CONTEXT, adjustments_pending_application: 1 },
    });
    availableActions.mockResolvedValue(
      actionSet({ BN_MEANS_APPROVE: { allowed: false, reason: 'ADJUSTMENT_APPLICATION_PENDING' } }),
    );
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Approval');

    expect(await screen.findByTestId('means-approval-adjustment-blocker')).toBeInTheDocument();
    expect(screen.getByTestId('means-approve')).toBeDisabled();
  });

  it('refuses self-approval by the officer who submitted the assessment', async () => {
    approvalContext.mockResolvedValue({
      status: 'OK',
      data: { ...APPROVAL_CONTEXT, actor_is_maker: true },
    });
    availableActions.mockResolvedValue(
      actionSet({ BN_MEANS_APPROVE: { allowed: false, reason: 'SELF_APPROVAL_DENIED' } }),
    );
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Approval');

    expect(await screen.findByTestId('means-approval-self-warning')).toBeInTheDocument();
    expect(screen.getByTestId('means-approve-reason')).toHaveTextContent('cannot decide your own');
  });

  it('describes an approved assessment as approved but not yet active', async () => {
    detail.mockResolvedValue({
      status: 'OK',
      data: {
        ...CALCULATED_DETAIL.data,
        assessment: { ...CALCULATED_DETAIL.data.assessment, status: 'APPROVED' },
      },
    });
    approvalContext.mockResolvedValue({
      status: 'OK',
      data: {
        ...APPROVAL_CONTEXT,
        status: 'APPROVED',
        approved_calculation_id: 'c1',
        checker_user_id: 'officer-2',
        decided_at: '2026-02-03',
      },
    });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);

    expect(await screen.findByTestId('means-status-badge')).toHaveTextContent('Approved — not yet active');
    await openTab('Approval');
    expect(await screen.findByTestId('means-approval-recorded')).toHaveTextContent('not yet active');
  });

  it('states that the approval context is unavailable rather than assuming it is clear', async () => {
    approvalContext.mockResolvedValue({ status: 'DENIED' });
    wrap(<BnMeansAssessmentWorkspace assessmentId="a1" onBack={() => {}} />);
    await openTab('Approval');
    expect(await screen.findByTestId('means-approval-unavailable')).toBeInTheDocument();
  });
});

describe('MT7 — Benefit 360 posture', () => {
  it('shows adjustment and approval posture without household finances', async () => {
    benefit360Summary.mockResolvedValue({
      status: 'OK',
      data: {
        assessment_reference: 'MT-2026-0007',
        status: 'APPROVED',
        result: 'ELIGIBLE',
        adjustment_pending: true,
        approved_not_active: true,
      },
    });
    wrap(<Benefit360MeansTestCard awardId="aw1" />);

    expect(await screen.findByTestId('award360-means-adjustment-pending')).toBeInTheDocument();
    expect(screen.getByTestId('award360-means-approved-not-active')).toBeInTheDocument();
    const card = screen.getByTestId('award360-means-card');
    expect(card.textContent).not.toMatch(/14400|20000|assessable/i);
  });
});

/**
 * MEANS-TEST EPIC 10 — adjustments and independent approval (frontend).
 *
 * Proves: the Decision surface is driven entirely by the backend decision
 * contract, only governed targets and reasons can be chosen, evidence is
 * selected not typed, entered information survives a business refusal,
 * independence and readiness are shown as backend verdicts (never
 * simulated), superseded calculations remain visible, approval never
 * claims activation, and the decision queues render governed rows.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const decisionContext = vi.fn();
const decisionQueues = vi.fn();
const evidence = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    decisionContext: (...a: unknown[]) => decisionContext(...a),
    decisionQueues: (...a: unknown[]) => decisionQueues(...a),
    adjustmentReference: vi.fn(),
    evidence: (...a: unknown[]) => evidence(...a),
  },
}));
vi.mock('@/services/bn/meansTests/meansCommandService', () => ({
  meansCommandService: { execute: (...a: unknown[]) => execute(...a) },
}));

import BnMeansDecisionSection from '@/components/bn/meansTests/decision/BnMeansDecisionSection';
import BnMeansDecisionQueue from '@/components/bn/meansTests/decision/BnMeansDecisionQueue';
import {
  adjustmentReasonOptions,
  adjustmentTargetChoices,
  buildDecisionTimeline,
  decisionResultLabel,
  isAdjustmentQueueRow,
  presentationDifference,
  type BnMeansDecisionContext,
} from '@/types/bn/meansTests/meansDecision';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const reference = {
  target_kinds: [
    {
      target_kind: 'INCOME_LINE',
      label: 'An income amount',
      control: 'MONEY_OR_EXCLUDE' as const,
      evidence_required: true,
      group_code: 'INCOME',
    },
    {
      target_kind: 'REASSESSMENT_DUE',
      label: 'The reassessment date',
      control: 'DATE' as const,
      evidence_required: false,
      group_code: null,
    },
  ],
  adjustment_reasons: [
    {
      reason_code: 'INCOME_MISSTATED',
      label: 'Income was misstated',
      description: null,
      target_kinds: ['INCOME_LINE'],
      requires_justification: true,
      requires_evidence: true,
    },
    {
      reason_code: 'DATE_CORRECTION',
      label: 'Date correction',
      description: null,
      target_kinds: ['REASSESSMENT_DUE'],
      requires_justification: true,
      requires_evidence: false,
    },
  ],
  adjustment_decision_reasons: [
    { decision: 'APPROVE' as const, reason_code: 'EVIDENCE_SUPPORTS', label: 'Evidence supports the correction', description: null, requires_justification: false },
    { decision: 'REJECT' as const, reason_code: 'NOT_SUPPORTED', label: 'Not supported by evidence', description: null, requires_justification: true },
  ],
  assessment_decision_reasons: [
    { decision: 'APPROVE' as const, reason_code: 'MEETS_POLICY', label: 'Meets policy', description: null, requires_justification: true },
    { decision: 'REJECT' as const, reason_code: 'EXCEEDS_THRESHOLD', label: 'Exceeds threshold', description: null, requires_justification: true },
  ],
};

function makeContext(overrides: Partial<BnMeansDecisionContext> = {}): BnMeansDecisionContext {
  return {
    assessment_id: 'a1',
    assessment_reference: 'MT-0001',
    benefit_programme: 'NON_CONTRIBUTORY_PENSION',
    status: 'CALCULATED',
    row_version: 7,
    currency_code: 'XCD',
    journey: [],
    approval_readiness: {
      ready: true,
      state: 'READY',
      blockers: [],
      reason_codes: [],
      actor_is_maker: false,
    },
    calculation_readiness: {},
    calculation: {
      calculation_id: 'c2',
      assessment_id: 'a1',
      assessment_version_id: 'v1',
      policy_version_id: 'p1',
      sequence_no: 2,
      is_current: true,
      currency_code: 'XCD',
      household_size: 3,
      assessable_income: '1200.00',
      assessable_assets: '0.00',
      approved_deductions: '100.00',
      threshold_amount: '1500.00',
      excess_amount: '0.00',
      result: 'ELIGIBLE',
      warnings: [],
      calculation_hash: 'hash-2',
      result_hash: null,
      input_hash: 'input-2',
      effective_date: '2026-01-01',
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      reassessment_due: '2026-12-01',
      calculated_at: '2026-02-02T10:00:00Z',
      calculated_by: 'u2',
      supersedes_calculation_id: 'c1',
      triggering_adjustment_id: 'adj1',
      trigger_reason: 'ADJUSTMENT',
    },
    previous_calculation: {
      calculation_id: 'c1',
      assessment_id: 'a1',
      assessment_version_id: 'v1',
      policy_version_id: 'p1',
      sequence_no: 1,
      is_current: false,
      currency_code: 'XCD',
      household_size: 3,
      assessable_income: '1600.00',
      assessable_assets: '0.00',
      approved_deductions: '0.00',
      threshold_amount: '1500.00',
      excess_amount: '100.00',
      result: 'NOT_ELIGIBLE',
      warnings: [],
      calculation_hash: 'hash-1',
      result_hash: null,
      input_hash: 'input-1',
      effective_date: '2026-01-01',
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      reassessment_due: '2026-12-01',
      calculated_at: '2026-02-01T10:00:00Z',
      calculated_by: 'u1',
      supersedes_calculation_id: null,
      triggering_adjustment_id: null,
      trigger_reason: 'INITIAL',
    },
    lines: [
      {
        line_id: 'l1',
        line_no: 1,
        line_kind: 'INCOME',
        group_code: 'INCOME',
        business_label: 'Employment income',
        member_label: 'Jane Doe',
        category_code: 'EMPLOYMENT',
        treatment_code: 'FULL',
        included: true,
        applied_amount: '1600.00',
        explanation: null,
        fact_kind: 'INCOME',
        fact_id: 'f1',
      },
      {
        line_id: 'l2',
        line_no: 2,
        line_kind: 'DEDUCTION',
        group_code: 'DEDUCTION',
        business_label: 'Medical costs',
        member_label: null,
        category_code: 'MEDICAL',
        treatment_code: 'FULL',
        included: true,
        applied_amount: '100.00',
        explanation: null,
        fact_kind: 'DEDUCTION',
        fact_id: 'f2',
      },
    ],
    history: [
      {
        calculation_id: 'c2',
        sequence_no: 2,
        result: 'ELIGIBLE',
        assessable_income: '1200.00',
        threshold_amount: '1500.00',
        excess_amount: '0.00',
        calculated_at: '2026-02-02T10:00:00Z',
        calculated_by_label: 'Officer Two',
        trigger_reason: 'ADJUSTMENT',
        is_current: true,
        superseded_at: null,
        triggering_adjustment_id: 'adj1',
      },
      {
        calculation_id: 'c1',
        sequence_no: 1,
        result: 'NOT_ELIGIBLE',
        assessable_income: '1600.00',
        threshold_amount: '1500.00',
        excess_amount: '100.00',
        calculated_at: '2026-02-01T10:00:00Z',
        calculated_by_label: 'Officer One',
        trigger_reason: 'INITIAL',
        is_current: false,
        superseded_at: '2026-02-02T10:00:00Z',
        triggering_adjustment_id: null,
      },
    ],
    adjustments: [],
    decisions: [],
    maker_label: 'Officer One',
    checker_label: null,
    actor_label: 'Officer Two',
    valid_from: '2026-01-01',
    valid_until: '2026-12-31',
    reassessment_due: '2026-12-01',
    decided_at: null,
    decision_reason_code: null,
    decision_justification: null,
    reference,
    ...overrides,
  } as BnMeansDecisionContext;
}

const openAdjustment = {
  adjustment_id: 'adj9',
  adjustment_reference: 'ADJ-0009',
  target_kind: 'INCOME_LINE',
  target_id: 'l1',
  field_or_line_code: 'EMPLOYMENT',
  target_label: 'Employment income — Jane Doe',
  original_value: '1600.00',
  proposed_value: '1200.00',
  currency_code: 'XCD',
  financial_effect: '-400.00',
  reason_code: 'INCOME_MISSTATED',
  reason_label: 'Income was misstated',
  justification: 'Payslips show a lower figure.',
  evidence_id: 'e1',
  evidence_reference: 'DOC-1',
  status: 'REQUESTED',
  requested_by: 'u2',
  requested_by_label: 'Officer Two',
  requested_at: '2026-02-02T09:00:00Z',
  decided_by: null,
  decided_by_label: null,
  decided_at: null,
  decision_reason_code: null,
  decision_reason_label: null,
  decision_note: null,
  applied_calculation_id: null,
  applied_at: null,
  application_error: null,
  row_version: 3,
  resulting_result: null,
  resulting_sequence_no: null,
  is_requester: false,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  decisionContext.mockResolvedValue({ status: 'OK', data: makeContext() });
  decisionQueues.mockResolvedValue({ status: 'OK', data: [] });
  evidence.mockResolvedValue({
    status: 'OK',
    data: {
      links: [
        {
          link_id: 'lk1',
          evidence_id: 'e1',
          document_ref: 'DOC-1',
          document_title: 'Payslip January',
          document_type_code: 'PAYSLIP',
          evidence_type: 'INCOME_PROOF',
          document_date: '2026-01-31',
          usability_status: 'USABLE',
          link_status: 'LINKED',
        },
      ],
    },
  });
  execute.mockResolvedValue({ status: 'EXECUTED', data: {}, correlationId: 'x' });
});

/* ------------------------------------------------------------------ */
/* contract helpers                                                    */
/* ------------------------------------------------------------------ */

describe('Epic 10 — decision contract helpers', () => {
  it('offers only the governed reasons permitted for the chosen target kind', () => {
    const set = adjustmentReasonOptions(reference, 'INCOME_LINE');
    expect(set.options.map((o) => o.value)).toEqual(['INCOME_MISSTATED']);
  });

  it('builds adjustment targets from backend calculation lines only', () => {
    const choices = adjustmentTargetChoices(makeContext(), reference.target_kinds[0]);
    expect(choices).toHaveLength(1);
    expect(choices[0].label).toBe('Employment income — Jane Doe');
    expect(choices[0].originalValue).toBe('1600.00');
  });

  it('describes an approved assessment as recorded, never as active', () => {
    expect(decisionResultLabel('APPROVED', true)).toBe('Approved — not yet active');
    expect(decisionResultLabel('CALCULATED', true)).toBe('Calculated — pending independent approval');
  });

  it('presents differences without recomputing the assessment', () => {
    expect(presentationDifference('1200.00', '1600.00')).toBe(-400);
    expect(presentationDifference(null, '1600.00')).toBeNull();
  });

  it('assembles calculations, adjustments and decisions into one timeline', () => {
    const timeline = buildDecisionTimeline(
      makeContext({ adjustments: [openAdjustment] as never }),
    );
    expect(timeline.some((e) => e.event.startsWith('Recalculation completed'))).toBe(true);
    expect(timeline.some((e) => e.event.startsWith('Adjustment requested'))).toBe(true);
  });

  it('distinguishes adjustment queue rows from assessment queue rows', () => {
    expect(isAdjustmentQueueRow({ queue_code: 'ADJUSTMENTS_AWAITING_DECISION' } as never)).toBe(true);
    expect(isAdjustmentQueueRow({ queue_code: 'ASSESSMENTS_AWAITING_APPROVAL' } as never)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* decision surface                                                    */
/* ------------------------------------------------------------------ */

describe('Epic 10 — unified decision surface', () => {
  it('reads the whole decision pack from the governed backend contract', async () => {
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    await screen.findByTestId('means-decision-section');
    expect(decisionContext).toHaveBeenCalledWith('a1');
    expect(screen.getByTestId('means-decision-result').textContent).toContain('pending independent approval');
  });

  it('keeps the superseded calculation visible and explains what changed', async () => {
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    const comparison = await screen.findByTestId('means-decision-comparison');
    expect(comparison.textContent).toContain('XCD 1,600.00');
    expect(comparison.textContent).toContain('XCD 1,200.00');
    expect(comparison.textContent).toContain('NOT_ELIGIBLE');
  });

  it('shows the backend readiness verdict rather than simulating one', async () => {
    decisionContext.mockResolvedValue({
      status: 'OK',
      data: makeContext({
        approval_readiness: {
          ready: false,
          state: 'DENIED',
          blockers: [{ code: 'SELF_APPROVAL_DENIED', message: 'An independent officer must approve this assessment.' }],
          reason_codes: ['SELF_APPROVAL_DENIED'],
        },
      }),
    });
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    const readiness = await screen.findByTestId('means-decision-readiness');
    expect(readiness.textContent).toContain('An independent officer must approve this assessment.');
  });

  it('warns while an approved adjustment has not yet recalculated', async () => {
    decisionContext.mockResolvedValue({
      status: 'OK',
      data: makeContext({
        adjustments: [{ ...openAdjustment, status: 'APPROVED_PENDING_APPLICATION' }] as never,
      }),
    });
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    expect((await screen.findByTestId('means-decision-recalculation-pending')).textContent).toContain(
      'Recalculation outstanding',
    );
  });

  it('states plainly when the decision record cannot be read', async () => {
    decisionContext.mockResolvedValue({ status: 'DENIED', data: null });
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    await screen.findByTestId('means-decision-unavailable');
  });

  it('never offers a decide action on an adjustment the actor requested', async () => {
    decisionContext.mockResolvedValue({
      status: 'OK',
      data: makeContext({ adjustments: [{ ...openAdjustment, is_requester: true }] as never }),
    });
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    expect(await screen.findByTestId('means-adjustment-own-request')).toBeInTheDocument();
  });

  it('exposes technical identity only behind an explicit disclosure', async () => {
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    const toggle = await screen.findByTestId('means-decision-technical-toggle');
    expect(screen.queryByTestId('means-decision-technical')).toBeNull();
    fireEvent.click(toggle);
    expect((await screen.findByTestId('means-decision-technical')).textContent).toContain('hash-2');
  });
});

/* ------------------------------------------------------------------ */
/* adjustment request                                                  */
/* ------------------------------------------------------------------ */

describe('Epic 10 — requesting an adjustment', () => {
  async function openRequest() {
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    fireEvent.click(await screen.findByTestId('means-decision-request-adjustment'));
    return screen.findByTestId('means-request-adjustment-dialog');
  }

  it('requires a governed target, reason, justification and linked evidence', async () => {
    const dialog = await openRequest();
    fireEvent.click(within(dialog).getByTestId('means-adjustment-submit'));
    expect((await screen.findByTestId('means-adjustment-validation')).textContent).toContain(
      'Choose what needs correcting',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('submits a governed payload built from backend lines and linked evidence', async () => {
    const dialog = await openRequest();
    fireEvent.change(within(dialog).getByLabelText(/What needs correcting/i), {
      target: { value: 'INCOME_LINE' },
    });
    fireEvent.change(await within(dialog).findByLabelText(/^Item/i), { target: { value: 'l1' } });
    fireEvent.change(within(dialog).getByLabelText(/Corrected amount/i), { target: { value: '1200' } });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/i), { target: { value: 'INCOME_MISSTATED' } });
    fireEvent.change(within(dialog).getByTestId('means-adjustment-justification'), {
      target: { value: 'Payslips show a lower figure.' },
    });
    fireEvent.change(await within(dialog).findByLabelText(/Supporting evidence/i), {
      target: { value: 'lk1' },
    });
    fireEvent.click(within(dialog).getByTestId('means-adjustment-submit'));

    await waitFor(() => expect(execute).toHaveBeenCalled());
    const call = execute.mock.calls[0][0];
    expect(call.command).toBe('BN_MEANS_REQUEST_ADJUSTMENT');
    expect(call.reasonCode).toBe('INCOME_MISSTATED');
    expect(call.payload.target_kind).toBe('INCOME_LINE');
    expect(call.payload.target_id).toBe('l1');
    expect(call.payload.original_value).toBe('1600.00');
    expect(call.payload.proposed_value).toBe('1200');
    expect(call.payload.evidence_id).toBe('e1');
  });

  it('keeps the entered correction when the backend refuses it', async () => {
    execute.mockResolvedValue({
      status: 'FAILED',
      data: null,
      errorCode: 'OPEN_ADJUSTMENT_EXISTS',
      errorDetail: 'open adjustment',
      correlationId: 'x',
    });
    const dialog = await openRequest();
    fireEvent.change(within(dialog).getByLabelText(/What needs correcting/i), {
      target: { value: 'INCOME_LINE' },
    });
    fireEvent.change(await within(dialog).findByLabelText(/^Item/i), { target: { value: 'l1' } });
    fireEvent.change(within(dialog).getByLabelText(/Corrected amount/i), { target: { value: '1200' } });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/i), { target: { value: 'INCOME_MISSTATED' } });
    fireEvent.change(within(dialog).getByTestId('means-adjustment-justification'), {
      target: { value: 'Payslips show a lower figure.' },
    });
    fireEvent.change(await within(dialog).findByLabelText(/Supporting evidence/i), {
      target: { value: 'lk1' },
    });
    fireEvent.click(within(dialog).getByTestId('means-adjustment-submit'));

    const failure = await screen.findByTestId('means-adjustment-failure');
    expect(failure.textContent).toContain('An adjustment is already open');
    expect((screen.getByTestId('means-adjustment-justification') as HTMLTextAreaElement).value).toBe(
      'Payslips show a lower figure.',
    );
  });
});

/* ------------------------------------------------------------------ */
/* adjustment decision                                                 */
/* ------------------------------------------------------------------ */

describe('Epic 10 — deciding an adjustment', () => {
  async function openDecision() {
    decisionContext.mockResolvedValue({
      status: 'OK',
      data: makeContext({ adjustments: [openAdjustment] as never }),
    });
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    fireEvent.click(await screen.findByTestId('means-adjustment-decide-adj9'));
    return screen.findByTestId('means-adjustment-decision-dialog');
  }

  it('sends the adjustment identity and its row version to the backend', async () => {
    const dialog = await openDecision();
    fireEvent.change(within(dialog).getByLabelText(/Decision reason/i), {
      target: { value: 'EVIDENCE_SUPPORTS' },
    });
    fireEvent.click(within(dialog).getByTestId('means-adjustment-decision-submit'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    const call = execute.mock.calls[0][0];
    expect(call.command).toBe('BN_MEANS_APPROVE_ADJUSTMENT');
    expect(call.payload.adjustment_id).toBe('adj9');
    expect(call.payload.adjustment_row_version).toBe(3);
    expect(call.payload.decision).toBe('APPROVE');
  });

  it('offers a reload when the adjustment moved beneath the officer', async () => {
    execute.mockResolvedValue({
      status: 'FAILED',
      data: null,
      errorCode: 'STALE_ADJUSTMENT_VERSION',
      errorDetail: 'stale',
      correlationId: 'x',
    });
    const dialog = await openDecision();
    fireEvent.change(within(dialog).getByLabelText(/Decision reason/i), {
      target: { value: 'EVIDENCE_SUPPORTS' },
    });
    fireEvent.click(within(dialog).getByTestId('means-adjustment-decision-submit'));
    await screen.findByTestId('means-adjustment-refresh');
    expect(screen.getByTestId('means-adjustment-decision-failure').textContent).toContain(
      'changed while the dialog was open',
    );
  });

  it('shows the backend self-approval refusal in business language', async () => {
    execute.mockResolvedValue({
      status: 'FAILED',
      data: null,
      errorCode: 'SELF_APPROVAL_DENIED',
      errorDetail: 'self',
      correlationId: 'x',
    });
    const dialog = await openDecision();
    fireEvent.change(within(dialog).getByLabelText(/Decision reason/i), {
      target: { value: 'EVIDENCE_SUPPORTS' },
    });
    fireEvent.click(within(dialog).getByTestId('means-adjustment-decision-submit'));
    expect((await screen.findByTestId('means-adjustment-decision-failure')).textContent).toContain(
      'An independent officer must take this decision',
    );
  });
});

/* ------------------------------------------------------------------ */
/* final decision                                                      */
/* ------------------------------------------------------------------ */

describe('Epic 10 — final decision', () => {
  async function openFinal() {
    wrap(<BnMeansDecisionSection assessmentId="a1" />);
    fireEvent.click(await screen.findByTestId('means-decision-final'));
    return screen.findByTestId('means-final-decision-dialog');
  }

  it('restates the exact calculation being approved', async () => {
    const dialog = await openFinal();
    const summary = within(dialog).getByTestId('means-final-decision-summary');
    expect(summary.textContent).toContain('hash-2');
    expect(summary.textContent).toContain('ELIGIBLE');
  });

  it('never claims approval activates a benefit', async () => {
    const dialog = await openFinal();
    expect(dialog.textContent).toContain('does not activate any benefit');
  });

  it('requires a governed reason and justification before submitting', async () => {
    const dialog = await openFinal();
    fireEvent.click(within(dialog).getByTestId('means-final-decision-submit'));
    await waitFor(() => expect(execute).not.toHaveBeenCalled());
    fireEvent.change(within(dialog).getByLabelText(/Decision reason/i), { target: { value: 'MEETS_POLICY' } });
    fireEvent.change(within(dialog).getByTestId('means-final-decision-justification'), {
      target: { value: 'Verified income is below the threshold.' },
    });
    fireEvent.click(within(dialog).getByTestId('means-final-decision-submit'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    const call = execute.mock.calls[0][0];
    expect(call.command).toBe('BN_MEANS_APPROVE');
    expect(call.expectedRowVersion).toBe(7);
    expect(call.payload.calculation_id).toBe('c2');
  });

  it('routes a rejection to the rejection command', async () => {
    const dialog = await openFinal();
    fireEvent.click(within(dialog).getByLabelText(/Reject the assessment/i));
    fireEvent.change(within(dialog).getByLabelText(/Decision reason/i), {
      target: { value: 'EXCEEDS_THRESHOLD' },
    });
    fireEvent.change(within(dialog).getByTestId('means-final-decision-justification'), {
      target: { value: 'Assessable income exceeds the threshold.' },
    });
    fireEvent.click(within(dialog).getByTestId('means-final-decision-submit'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].command).toBe('BN_MEANS_REJECT');
  });

  it('offers a reload when the calculation was superseded mid-decision', async () => {
    execute.mockResolvedValue({
      status: 'FAILED',
      data: null,
      errorCode: 'CALCULATION_NOT_LATEST',
      errorDetail: 'stale',
      correlationId: 'x',
    });
    const dialog = await openFinal();
    fireEvent.change(within(dialog).getByLabelText(/Decision reason/i), { target: { value: 'MEETS_POLICY' } });
    fireEvent.change(within(dialog).getByTestId('means-final-decision-justification'), {
      target: { value: 'Verified income is below the threshold.' },
    });
    fireEvent.click(within(dialog).getByTestId('means-final-decision-submit'));
    await screen.findByTestId('means-final-decision-refresh');
  });
});

/* ------------------------------------------------------------------ */
/* queues                                                              */
/* ------------------------------------------------------------------ */

describe('Epic 10 — decision queues', () => {
  it('asks the backend for the selected governed queue', async () => {
    wrap(<BnMeansDecisionQueue onOpenAssessment={() => {}} />);
    await waitFor(() => expect(decisionQueues).toHaveBeenCalled());
    expect(decisionQueues.mock.calls[0][0]).toBe('ASSESSMENTS_AWAITING_APPROVAL');
    fireEvent.change(screen.getByLabelText(/Queue/i), {
      target: { value: 'ADJUSTMENTS_AWAITING_DECISION' },
    });
    await waitFor(() =>
      expect(decisionQueues.mock.calls.some((c) => c[0] === 'ADJUSTMENTS_AWAITING_DECISION')).toBe(true),
    );
  });

  it('renders adjustment rows and opens the assessment decision surface', async () => {
    const onOpen = vi.fn();
    decisionQueues.mockResolvedValue({
      status: 'OK',
      data: [
        {
          queue_code: 'ADJUSTMENTS_AWAITING_DECISION',
          adjustment_id: 'adj9',
          adjustment_reference: 'ADJ-0009',
          assessment_id: 'a1',
          assessment_reference: 'MT-0001',
          assessment_status: 'CALCULATED',
          benefit_programme: 'NCP',
          target_kind: 'INCOME_LINE',
          field_or_line_code: 'EMPLOYMENT',
          status: 'REQUESTED',
          requested_by_label: 'Officer Two',
          requested_at: '2026-02-02T09:00:00Z',
          age_days: 2,
          is_requester: true,
          application_error: null,
          row_version: 3,
        },
      ],
    });
    wrap(<BnMeansDecisionQueue onOpenAssessment={onOpen} defaultQueue="ADJUSTMENTS_AWAITING_DECISION" />);
    const row = await screen.findByTestId('means-decision-queue-row-adj9');
    expect(row.textContent).toContain('ADJ-0009');
    expect(row.textContent).toContain('Your request');
    fireEvent.click(screen.getByTestId('means-decision-queue-open-adj9'));
    expect(onOpen).toHaveBeenCalledWith('a1');
  });

  it('states plainly when a queue is empty or unavailable', async () => {
    wrap(<BnMeansDecisionQueue onOpenAssessment={() => {}} />);
    await screen.findByTestId('means-decision-queue-empty');

    decisionQueues.mockResolvedValue({ status: 'DENIED', data: null });
    wrap(<BnMeansDecisionQueue onOpenAssessment={() => {}} defaultQueue="ASSESSMENTS_REJECTED" />);
    await screen.findByTestId('means-decision-queue-unavailable');
  });
});

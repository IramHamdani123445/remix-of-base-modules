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

/*
 * EPIC 10 supersedes the MT7 adjustment and approval panels: those two tabs
 * were replaced by one governed Decision surface. Their behaviour is now
 * proven in `meansDecisionEpic10.test.tsx` against the backend decision
 * contract, so the panel-level cases below were retired with the panels.
 */

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

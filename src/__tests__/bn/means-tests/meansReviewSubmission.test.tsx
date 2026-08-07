/**
 * MEANS-TEST EPIC 7 — Review and submission guards.
 *
 * Proves: readiness is backend-owned, a failed/denied readiness read never
 * presents as submittable, required declarations gate the submit control,
 * submission carries the frozen expected version, and stale versions block
 * rather than silently succeed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const submissionReadiness = vi.fn();
const reviewSummary = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    submissionReadiness: (...a: unknown[]) => submissionReadiness(...a),
    reviewSummary: (...a: unknown[]) => reviewSummary(...a),
  },
}));
vi.mock('@/services/bn/meansTests/meansCommandService', () => ({
  meansCommandService: { execute: (...a: unknown[]) => execute(...a) },
}));

import BnMeansReviewSection from '@/components/bn/meansTests/review/BnMeansReviewSection';
import {
  declarationPayload,
  groupIssuesBySection,
  missingRequiredDeclarations,
  resolveSubmissionUiState,
  sectionTabFor,
  timelineLabel,
  type BnMeansDeclarationDefinition,
} from '@/types/bn/meansTests/meansSubmission';

const DECLARATION: BnMeansDeclarationDefinition = {
  declaration_code: 'OFFICER_REVIEW',
  label: 'Officer review',
  description: null,
  statement_text: 'I have reviewed the declared information.',
  statement_version: '1.0',
  required: true,
  actor_type: 'OFFICER',
  display_order: 1,
  effective_policy_version: 'pv1',
};

const READY = {
  assessment_id: 'a1',
  assessment_reference: 'MT-2026-0001',
  status: 'DRAFT',
  can_submit: true,
  section_statuses: [
    { section: 'HOUSEHOLD', complete: true, status: 'COMPLETE' },
    { section: 'INCOME', complete: true, status: 'COMPLETE' },
    { section: 'ASSETS', complete: true, status: 'COMPLETE' },
    { section: 'DEDUCTIONS', complete: true, status: 'COMPLETE' },
    { section: 'EVIDENCE', complete: true, status: 'COMPLETE' },
  ],
  household_complete: true,
  income_complete: true,
  assets_complete: true,
  deductions_complete: true,
  evidence_complete: true,
  open_blocking_information_requests: 0,
  unresolved_data_conflicts: 0,
  policy_status: 'EFFECTIVE',
  policy_version_id: 'pv1',
  required_declarations: [DECLARATION],
  warnings: [],
  blockers: [],
  reason_codes: [],
  expected_row_version: 7,
  already_submitted: false,
};

const SUMMARY = {
  context: {
    assessment_reference: 'MT-2026-0001',
    person_name: 'Assessed person',
    benefit_programme: 'ASSISTANCE',
    assessment_reason: 'NEW_CLAIM',
    effective_from: '2026-01-01',
    currency_code: 'XCD',
    policy_version_label: 'Means policy v1',
    policy_status: 'EFFECTIVE',
  },
  household: { total_members: 2, current_members: 2, ended_members: 0, dependants: 1, members: [] },
  income: { fact_count: 1, members_with_income: 1, declared_annualised_income: 1200, no_income_declarations: 1 },
  assets: { asset_count: 0, declared_valuation: 0, possible_disregards: 0, no_asset_declarations: 1 },
  deductions: { claim_count: 0, possible_disregard_count: 0, claimed_total: 0, evidence_required_count: 0 },
  evidence: {
    mandatory_total: 2, mandatory_satisfied: 2, mandatory_outstanding: 0,
    unusable_document_count: 0, open_information_requests: 0, overdue_information_requests: 0,
    section_status: 'COMPLETE',
  },
  submission: null,
  timeline: [{ event_code: 'CREATED', created_at: '2026-01-01T00:00:00Z' }],
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  [submissionReadiness, reviewSummary, execute].forEach((m) => m.mockReset());
  reviewSummary.mockResolvedValue({ status: 'OK', data: SUMMARY });
});

describe('EPIC 7 — submission contract helpers', () => {
  it('never treats a failed readiness read as submittable', () => {
    expect(resolveSubmissionUiState({ loading: false, queryStatus: 'FAILED', readiness: null })).toBe('FAILED');
    expect(resolveSubmissionUiState({ loading: false, queryStatus: 'DENIED', readiness: null })).toBe('DENIED');
  });

  it('resolves ready, blocked, stale and submitted states', () => {
    expect(resolveSubmissionUiState({ loading: false, queryStatus: 'OK', readiness: READY as never })).toBe('READY');
    expect(
      resolveSubmissionUiState({ loading: false, queryStatus: 'OK', readiness: { ...READY, can_submit: false } as never }),
    ).toBe('BLOCKED');
    expect(
      resolveSubmissionUiState({ loading: false, queryStatus: 'OK', readiness: READY as never, stale: true }),
    ).toBe('STALE');
    expect(
      resolveSubmissionUiState({ loading: false, queryStatus: 'OK', readiness: { ...READY, already_submitted: true } as never }),
    ).toBe('ALREADY_SUBMITTED');
  });

  it('groups blockers under the section that can resolve them', () => {
    const groups = groupIssuesBySection([
      { code: 'A', message: 'x', section: 'EVIDENCE' },
      { code: 'B', message: 'y', section: 'HOUSEHOLD' },
    ]);
    expect(groups[0].section).toBe('HOUSEHOLD');
    expect(groups[0].tab).toBe('household');
    expect(sectionTabFor('EVIDENCE')).toBe('evidence');
  });

  it('carries statement text and version with each confirmation', () => {
    expect(missingRequiredDeclarations([DECLARATION], {})).toEqual(['OFFICER_REVIEW']);
    expect(missingRequiredDeclarations([DECLARATION], { OFFICER_REVIEW: true })).toEqual([]);
    expect(declarationPayload([DECLARATION], { OFFICER_REVIEW: true })).toEqual([
      expect.objectContaining({ declaration_code: 'OFFICER_REVIEW', statement_version: '1.0', confirmed: true }),
    ]);
  });

  it('renders officer-readable milestone wording', () => {
    expect(timelineLabel('SUBMITTED')).toBe('Assessment submitted');
    expect(timelineLabel('SOMETHING_NEW')).toBe('Something new');
  });
});

describe('EPIC 7 — review surface', () => {
  it('states an explicit failure rather than an empty review', async () => {
    submissionReadiness.mockResolvedValue({ status: 'FAILED', data: null, detail: 'connection reset' });
    wrap(<BnMeansReviewSection assessmentId="a1" onNavigateSection={() => {}} />);
    expect(await screen.findByTestId('means-review-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('means-submit-button')).not.toBeInTheDocument();
  });

  it('states an explicit denial', async () => {
    submissionReadiness.mockResolvedValue({ status: 'DENIED', data: null, code: 'PERMISSION_DENIED' });
    wrap(<BnMeansReviewSection assessmentId="a1" onNavigateSection={() => {}} />);
    expect(await screen.findByTestId('means-review-denied')).toBeInTheDocument();
  });

  it('blocks submission and routes each blocker back to its owning section', async () => {
    submissionReadiness.mockResolvedValue({
      status: 'OK',
      data: {
        ...READY,
        can_submit: false,
        evidence_complete: false,
        section_statuses: READY.section_statuses.map((s) =>
          s.section === 'EVIDENCE' ? { ...s, complete: false, status: 'BLOCKED' } : s,
        ),
        blockers: [{ code: 'EVIDENCE_OUTSTANDING', message: '2 mandatory requirements outstanding', section: 'EVIDENCE' }],
      },
    });
    const onNavigate = vi.fn();
    wrap(<BnMeansReviewSection assessmentId="a1" onNavigateSection={onNavigate} />);

    expect(await screen.findByTestId('means-review-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('means-review-blocker-EVIDENCE')).toBeInTheDocument();
    expect(screen.getByTestId('means-submit-button')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Resolve in Evidence/ }));
    expect(onNavigate).toHaveBeenCalledWith('evidence');
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires every required declaration and the final confirmation before submitting', async () => {
    submissionReadiness.mockResolvedValue({ status: 'OK', data: READY });
    execute.mockResolvedValue({ status: 'EXECUTED', data: { frozen_version_no: 1, verification_work_count: 4 } });
    wrap(<BnMeansReviewSection assessmentId="a1" onNavigateSection={() => {}} />);

    const button = await screen.findByTestId('means-submit-button');
    expect(button).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Officer review'));
    expect(screen.getByTestId('means-submit-button')).toBeDisabled();

    await userEvent.click(screen.getByLabelText('I have reviewed this assessment'));
    await waitFor(() => expect(screen.getByTestId('means-submit-button')).toBeEnabled());

    await userEvent.click(screen.getByTestId('means-submit-button'));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'BN_MEANS_SUBMIT',
          assessmentId: 'a1',
          expectedRowVersion: 7,
          payload: expect.objectContaining({ expected_policy_version: 'pv1' }),
        }),
      ),
    );
    expect(await screen.findByTestId('means-review-submitted')).toBeInTheDocument();
  });

  it('reports a stale version instead of a silent success', async () => {
    submissionReadiness.mockResolvedValue({ status: 'OK', data: READY });
    execute.mockResolvedValue({ status: 'FAILED', errorCode: 'STALE_ROW_VERSION', errorDetail: 'expected=7 actual=9' });
    wrap(<BnMeansReviewSection assessmentId="a1" onNavigateSection={() => {}} />);

    await userEvent.click(await screen.findByLabelText('Officer review'));
    await userEvent.click(screen.getByLabelText('I have reviewed this assessment'));
    await userEvent.click(screen.getByTestId('means-submit-button'));

    expect(await screen.findByTestId('means-review-command-error')).toBeInTheDocument();
    expect(screen.queryByTestId('means-review-submitted')).not.toBeInTheDocument();
  });

  it('shows a frozen, non-editable result once submitted', async () => {
    submissionReadiness.mockResolvedValue({
      status: 'OK',
      data: { ...READY, status: 'SUBMITTED', already_submitted: true },
    });
    reviewSummary.mockResolvedValue({
      status: 'OK',
      data: {
        ...SUMMARY,
        submission: {
          submitted_at: '2026-02-01T10:00:00Z',
          submitted_by: 'officer',
          frozen_version: { version_no: 1 },
          verification_work_count: 5,
          declarations: [],
          acknowledgement: null,
        },
      },
    });
    wrap(<BnMeansReviewSection assessmentId="a1" onNavigateSection={() => {}} />);

    expect(await screen.findByTestId('means-review-submitted')).toBeInTheDocument();
    expect(screen.queryByTestId('means-submit-button')).not.toBeInTheDocument();
    expect(screen.getByText(/Submitted — awaiting verification/)).toBeInTheDocument();
  });
});

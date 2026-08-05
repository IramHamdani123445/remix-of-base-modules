/**
 * BN Medical Reviews — rendered interaction tests for the operational frontend.
 *
 * These are behaviour tests against rendered components, not source-string
 * assertions. They cover: confidential-evidence privacy, award deep-link
 * ordering, search minimum length, page-scoped counters, section failure
 * states, idempotency/concurrency, version-conflict handling, and actor-surface
 * separation for the Board and Provider workspaces.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const AWARD_ID = '11111111-2222-4333-8444-555555555555';
const OBLIGATION_ID = 'ob-1';

const state = {
  canView: true,
  grants: new Set<string>(['view', 'view_audit', 'view_confidential_medical_evidence']),
  actionsEnabled: false,
};

const q = vi.hoisted(() => ({
  worklist: vi.fn(),
  awardContext: vi.fn(),
  detail: vi.fn(),
  boardRequirement: vi.fn(),
  assessmentSummary: vi.fn(),
  appointmentHistory: vi.fn(),
  decisionDetail: vi.fn(),
  proposalLinks: vi.fn(),
  auditTimeline: vi.fn(),
  confidentialEvidence: vi.fn(),
  boardWorklist: vi.fn(),
  boardCaseDetail: vi.fn(),
  boardDetermination: vi.fn(),
  providerWorklist: vi.fn(),
  providerReferralDetail: vi.fn(),
  providerSearch: vi.fn(),
}));

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => ({ user: { id: 'u-1' }, isAuthReady: true, isAuthenticated: true }),
}));

vi.mock('@/hooks/useActionPermission', () => ({
  useActionPermissions: () => ({
    can: (a: string) => (a === 'view' ? state.canView : state.grants.has(a)),
    isAdmin: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/bn/useMedicalReviewActionsState', () => ({
  MEDICAL_REVIEW_MODULE_NAME: 'bn_medical_review',
  useMedicalReviewActionsState: () => ({
    actionsEnabled: state.actionsEnabled,
    routesEnabled: true,
    moduleEnabled: true,
    rolloutState: 'internal_pilot',
    isLoading: false,
    isError: false,
  }),
  useMedicalReviewActionsEnabled: () => state.actionsEnabled,
}));

vi.mock('@/services/bn/medicalReviewQueryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/bn/medicalReviewQueryService')>();
  return { ...actual, medicalReviewQueryService: q };
});

import MedicalReviewCentre from '@/pages/bn/servicing/MedicalReviewCentre';
import MedicalReviewDetailPanel from '@/components/bn/medical-reviews/MedicalReviewDetailPanel';
import MedicalBoardWorkspace from '@/pages/bn/servicing/medical-reviews/MedicalBoardWorkspace';
import MedicalProviderReferralWorkspace from '@/portals/doctor/medical-reviews/MedicalProviderReferralWorkspace';
import { useMedicalReviewSubmission } from '@/hooks/bn/useMedicalReviewSubmission';
import { MedicalReviewError } from '@/features/bn/medical-reviews/model/errors';
import {
  AWARD_PROPOSAL_BOUNDARY_TEXT,
  decisionActionAvailability,
  awardProposalActionAvailability,
} from '@/features/bn/medical-reviews/model/actionAvailability';
import type { MedicalReviewAction } from '@/features/bn/medical-reviews/model/permissions';

const emptyPaged = { rows: [], total: 0, limit: 25, offset: 0 };

function renderAt(path: string, element: React.ReactNode, routePath = path.split('?')[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const allowAll = (_a: MedicalReviewAction) => true;

/**
 * Radix tabs activate on mousedown/focus, not on a bare synthetic click.
 */
async function openTab(name: RegExp) {
  const trigger = await screen.findByRole('tab', { name });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  return trigger;
}

const renderDetail = (props: Partial<React.ComponentProps<typeof MedicalReviewDetailPanel>> = {}) =>
  renderAt(
    '/bn/medical-reviews',
    <MedicalReviewDetailPanel
      obligationId={OBLIGATION_ID}
      hasPermission={allowAll}
      actionsEnabled={state.actionsEnabled}
      canViewConfidential
      canViewAudit
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.canView = true;
  state.grants = new Set(['view', 'view_audit', 'view_confidential_medical_evidence']);
  state.actionsEnabled = false;

  q.worklist.mockResolvedValue(emptyPaged);
  q.awardContext.mockResolvedValue({
    awardId: AWARD_ID,
    awardNumber: 'AW-9001',
    awardStatus: 'ACTIVE',
    benefitCode: 'INV',
    startDate: null,
    endDate: null,
    nextReviewDate: null,
    claimId: null,
    claimNumber: null,
    maskedSsn: null,
    openReviews: 2,
    raw: {},
  });
  q.detail.mockResolvedValue({
    obligationId: OBLIGATION_ID,
    obligationReference: 'MR-1',
    awardId: AWARD_ID,
    reviewType: 'PERIODIC',
    reviewReason: 'SCHEDULED',
    obligationStatus: 'DUE',
    dueDate: '2026-09-01',
    noticeDueDate: null,
    graceEndDate: null,
    deferredUntil: null,
    riskClassification: 'STANDARD',
    rowVersion: 3,
    raw: {},
  });
  q.boardRequirement.mockResolvedValue({
    boardRequired: false,
    boardMode: null,
    assessmentModel: null,
    reason: null,
    boardType: null,
    raw: {},
  });
  q.assessmentSummary.mockResolvedValue({ rows: [], confidentialIncluded: false });
  q.appointmentHistory.mockResolvedValue(emptyPaged);
  q.decisionDetail.mockResolvedValue([]);
  q.proposalLinks.mockResolvedValue([]);
  q.auditTimeline.mockResolvedValue(emptyPaged);
  q.confidentialEvidence.mockResolvedValue({ ...emptyPaged, rows: [{ evidence_type: 'MRI', summary: 'x' }] });
  q.boardWorklist.mockResolvedValue(emptyPaged);
  q.boardCaseDetail.mockResolvedValue({});
  q.boardDetermination.mockResolvedValue([]);
  q.providerWorklist.mockResolvedValue({ ...emptyPaged, providerId: null });
  q.providerReferralDetail.mockResolvedValue({});
  q.providerSearch.mockResolvedValue(emptyPaged);
});

/* ================================================================== */
/* 1. Confidential-evidence privacy                                    */
/* ================================================================== */

describe('Confidential medical evidence', () => {
  it('does NOT call the confidential-evidence RPC when a review is opened', async () => {
    renderDetail();
    expect(await screen.findByTestId('mr-detail-panel')).toBeInTheDocument();
    await waitFor(() => expect(q.detail).toHaveBeenCalled());
    expect(q.confidentialEvidence).not.toHaveBeenCalled();
  });

  it('shows the audit warning on the collapsed section', async () => {
    renderDetail();
    await openTab(/report/i);
    expect(await screen.findByTestId('mr-confidential-audit-notice')).toHaveTextContent(
      'Access to confidential medical evidence is audited.',
    );
    expect(q.confidentialEvidence).not.toHaveBeenCalled();
  });

  it('fetches only after the explicit reveal action, then clears on hide', async () => {
    renderDetail();
    await openTab(/report/i);
    fireEvent.click(await screen.findByTestId('mr-confidential-reveal'));
    await waitFor(() => expect(q.confidentialEvidence).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('mr-confidential-content')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mr-confidential-hide'));
    await waitFor(() => expect(screen.queryByTestId('mr-confidential-content')).toBeNull());
    expect(screen.getByTestId('mr-confidential-reveal')).toBeInTheDocument();
  });

  it('reports a recused member separately from a permission denial', async () => {
    q.confidentialEvidence.mockRejectedValue(new MedicalReviewError('E_MEMBER_RECUSED'));
    renderDetail();
    await openTab(/report/i);
    fireEvent.click(await screen.findByTestId('mr-confidential-reveal'));
    expect(await screen.findByTestId('mr-confidential-recused')).toBeInTheDocument();
    expect(screen.queryByTestId('mr-confidential-denied')).toBeNull();
  });

  it('reports permission denial separately', async () => {
    q.confidentialEvidence.mockRejectedValue(new MedicalReviewError('E_FORBIDDEN'));
    renderDetail();
    await openTab(/report/i);
    fireEvent.click(await screen.findByTestId('mr-confidential-reveal'));
    expect(await screen.findByTestId('mr-confidential-denied')).toBeInTheDocument();
  });

  it('reports "not released" distinctly from a failure', async () => {
    q.confidentialEvidence.mockResolvedValue(emptyPaged);
    renderDetail();
    await openTab(/report/i);
    fireEvent.click(await screen.findByTestId('mr-confidential-reveal'));
    expect(await screen.findByTestId('mr-confidential-not-released')).toBeInTheDocument();
  });

  it('withholds the section entirely without the confidential permission', async () => {
    renderDetail({ canViewConfidential: false });
    await openTab(/report/i);
    expect(await screen.findByTestId('mr-confidential-withheld')).toBeInTheDocument();
    expect(screen.queryByTestId('mr-confidential-reveal')).toBeNull();
  });

  it('clears confidential state when the selected review changes', async () => {
    const { rerender } = renderDetail();
    await openTab(/report/i);
    fireEvent.click(await screen.findByTestId('mr-confidential-reveal'));
    await screen.findByTestId('mr-confidential-content');

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <MedicalReviewDetailPanel
            obligationId="ob-2"
            hasPermission={allowAll}
            actionsEnabled={false}
            canViewConfidential
            canViewAudit
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId('mr-confidential-content')).toBeNull());
  });
});

/* ================================================================== */
/* 2. Award deep-link ordering                                         */
/* ================================================================== */

describe('Award deep-link ordering', () => {
  it('loads award context before the award-scoped worklist', async () => {
    const order: string[] = [];
    q.awardContext.mockImplementation(async () => {
      order.push('context');
      return {
        awardId: AWARD_ID, awardNumber: 'AW-1', awardStatus: 'ACTIVE', benefitCode: 'INV',
        startDate: null, endDate: null, nextReviewDate: null, claimId: null,
        claimNumber: null, maskedSsn: null, openReviews: 0, raw: {},
      };
    });
    q.worklist.mockImplementation(async () => {
      order.push('worklist');
      return emptyPaged;
    });

    renderAt(`/bn/medical-reviews?awardId=${AWARD_ID}`, <MedicalReviewCentre />, '/bn/medical-reviews');
    await waitFor(() => expect(order).toEqual(['context', 'worklist']));
  });

  it('makes NO worklist call when the award context is forbidden', async () => {
    q.awardContext.mockRejectedValue(new MedicalReviewError('E_RECORD_FORBIDDEN'));
    renderAt(`/bn/medical-reviews?awardId=${AWARD_ID}`, <MedicalReviewCentre />, '/bn/medical-reviews');
    expect(await screen.findByTestId('mr-award-forbidden')).toBeInTheDocument();
    expect(q.worklist).not.toHaveBeenCalled();
  });

  it('makes NO worklist call when the award record is unavailable', async () => {
    q.awardContext.mockRejectedValue(new MedicalReviewError('E_NOT_FOUND'));
    renderAt(`/bn/medical-reviews?awardId=${AWARD_ID}`, <MedicalReviewCentre />, '/bn/medical-reviews');
    expect(await screen.findByTestId('mr-award-unavailable')).toBeInTheDocument();
    expect(q.worklist).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/* 3. Worklist search and counters                                     */
/* ================================================================== */

describe('Worklist search and counters', () => {
  it('makes no RPC for one- or two-character searches', async () => {
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    await screen.findByTestId('mr-centre');
    await waitFor(() => expect(q.worklist).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('Search medical reviews');
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(await screen.findByTestId('mr-search-min-hint')).toHaveTextContent(
      'Enter at least 3 characters to search.',
    );
    expect(q.worklist).toHaveBeenCalledTimes(1);
  });

  it('issues exactly one RPC for a three-character search', async () => {
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    await screen.findByTestId('mr-centre');
    await waitFor(() => expect(q.worklist).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Search medical reviews'), { target: { value: 'abc' } });
    await waitFor(() => expect(q.worklist).toHaveBeenCalledTimes(2));
    expect(q.worklist.mock.calls[1][0]).toMatchObject({ search: 'abc' });
  });

  it('labels the summary figures as current-page counts, not totals', async () => {
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    const counters = await screen.findByTestId('mr-page-counters');
    expect(counters.textContent).toContain('Current page');
    expect(
      screen.getByText(/Figures above count the rows on the current page only/i),
    ).toBeInTheDocument();
  });

  it('shows a worklist failure as an error, never as an empty result', async () => {
    q.worklist.mockRejectedValue(new MedicalReviewError('E_TRANSPORT'));
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    expect(await screen.findByTestId('mr-worklist-error')).toBeInTheDocument();
    expect(screen.getByTestId('mr-worklist-empty').textContent).toMatch(
      /could not be loaded — this is not an empty result/i,
    );
  });
});

/* ================================================================== */
/* 4. Section failures are not empty results                           */
/* ================================================================== */

describe('Section-level failure states', () => {
  it('shows a failed decision section instead of "no decision prepared"', async () => {
    q.decisionDetail.mockRejectedValue(new MedicalReviewError('E_TRANSPORT'));
    renderDetail();
    await openTab(/^decision$/i);
    expect(await screen.findByTestId('mr-section-decision-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('mr-section-decision-empty')).toBeNull();
  });

  it('keeps the main detail visible when a secondary section fails', async () => {
    q.proposalLinks.mockRejectedValue(new MedicalReviewError('E_TRANSPORT'));
    renderDetail();
    expect(await screen.findByTestId('mr-detail-panel')).toBeInTheDocument();
  });

  it('distinguishes a permission denial from an empty audit section', async () => {
    q.auditTimeline.mockRejectedValue(new MedicalReviewError('E_FORBIDDEN'));
    renderDetail();
    await openTab(/audit/i);
    expect(await screen.findByTestId('mr-section-audit-permission-denied')).toBeInTheDocument();
  });

  it('marks the audit section not applicable without the audit permission', async () => {
    renderDetail({ canViewAudit: false });
    await openTab(/audit/i);
    expect(await screen.findByTestId('mr-section-audit-not-applicable')).toBeInTheDocument();
    expect(q.auditTimeline).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/* 5. Idempotency and concurrency                                      */
/* ================================================================== */

const okResult = { status: 'OK' as const, replayed: false, noOp: false, data: {} };

describe('Submission and idempotency controller', () => {
  it('prevents a double submit from creating two commands', async () => {
    const execute = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(okResult), 20)),
    );
    const { result } = renderHook(() => useMedicalReviewSubmission());

    await act(async () => {
      const first = result.current.submit({ a: 1 }, execute);
      const second = result.current.submit({ a: 1 }, execute);
      await Promise.all([first, second]);
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reuses the same key when retrying the same payload after a transport failure', async () => {
    const keys: string[] = [];
    const execute = vi.fn().mockImplementation(async (_p: unknown, key: string) => {
      keys.push(key);
      throw new MedicalReviewError('E_TRANSPORT');
    });
    const { result } = renderHook(() => useMedicalReviewSubmission());

    await act(async () => {
      await result.current.submit({ a: 1 }, execute);
    });
    await act(async () => {
      await result.current.submit({ a: 1 }, execute);
    });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('mints a new key when the payload changes', async () => {
    const keys: string[] = [];
    const execute = vi.fn().mockImplementation(async (_p: unknown, key: string) => {
      keys.push(key);
      return okResult;
    });
    const { result } = renderHook(() => useMedicalReviewSubmission());

    await act(async () => {
      await result.current.submit({ a: 1 }, execute);
    });
    await act(async () => {
      await result.current.submit({ a: 2 }, execute);
    });

    expect(keys[0]).not.toBe(keys[1]);
  });

  it('mints a new key after a successful command', async () => {
    const keys: string[] = [];
    const execute = vi.fn().mockImplementation(async (_p: unknown, key: string) => {
      keys.push(key);
      return okResult;
    });
    const { result } = renderHook(() => useMedicalReviewSubmission());
    await act(async () => {
      await result.current.submit({ a: 1 }, execute);
    });
    await act(async () => {
      await result.current.submit({ a: 1 }, execute);
    });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('reports replay and no-op outcomes accurately', async () => {
    const { result } = renderHook(() => useMedicalReviewSubmission());
    await act(async () => {
      await result.current.submit({ a: 1 }, async () => ({
        status: 'REPLAYED' as const, replayed: true, noOp: false, data: {},
      }));
    });
    expect(result.current.outcomeLabel).toMatch(/Replayed/);

    await act(async () => {
      await result.current.submit({ a: 2 }, async () => ({
        status: 'NO_OP' as const, replayed: false, noOp: true, data: {},
      }));
    });
    expect(result.current.outcomeLabel).toMatch(/No change/);
  });

  it('preserves the key and reloads the record on a version conflict, requiring confirmation', async () => {
    const keys: string[] = [];
    const reloadRecord = vi.fn().mockResolvedValue(9);
    const execute = vi.fn().mockImplementation(async (_p: unknown, key: string) => {
      keys.push(key);
      throw new MedicalReviewError('E_VERSION_CONFLICT');
    });
    const { result } = renderHook(() => useMedicalReviewSubmission({ reloadRecord }));

    await act(async () => {
      await result.current.submit({ a: 1, expectedRowVersion: 3 }, execute);
    });

    expect(result.current.phase).toBe('conflict');
    expect(reloadRecord).toHaveBeenCalledTimes(1);
    expect(result.current.conflict).toMatchObject({
      previousRowVersion: 3,
      currentRowVersion: 9,
      acknowledged: false,
    });

    act(() => result.current.acknowledgeConflict());
    expect(result.current.conflict?.acknowledged).toBe(true);

    await act(async () => {
      await result.current.submit({ a: 1, expectedRowVersion: 3 }, execute);
    });
    expect(keys[0]).toBe(keys[1]);
  });
});

/* ================================================================== */
/* 6. Version-conflict flow preserves entered form data                */
/* ================================================================== */

describe('Version-conflict dialog flow', () => {
  it('preserves the entered payload and shows both row versions', async () => {
    state.actionsEnabled = true;
    q.decisionDetail.mockResolvedValue([
      {
        decision_id: 'dec-1',
        decision_status: 'PENDING_APPROVAL',
        row_version: 4,
        outcome_code: 'REVIEW_SATISFIED',
        prepared_by_current_user: false,
      },
    ]);
    const commandModule = await import('@/services/bn/medicalReviewCommandService');
    const spy = vi
      .spyOn(commandModule.medicalReviewCommandService, 'approveDecision')
      .mockRejectedValue(new MedicalReviewError('E_VERSION_CONFLICT'));

    renderDetail({ actionsEnabled: true });
    await openTab(/^decision$/i);
    fireEvent.click(await screen.findByRole('button', { name: /approve decision/i }));

    const note = await screen.findByTestId('mr-dialog-approve-decision-reason');
    fireEvent.change(note, { target: { value: 'Approved after review' } });
    fireEvent.click(screen.getByTestId('mr-dialog-approve-decision-submit'));

    expect(await screen.findByTestId('mr-dialog-approve-decision-version-conflict')).toBeInTheDocument();
    // Entered data survives the conflict.
    expect((note as HTMLTextAreaElement).value).toBe('Approved after review');
    // Resubmission is blocked until the operator confirms the refreshed record.
    expect(screen.getByTestId('mr-dialog-approve-decision-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('mr-dialog-approve-decision-confirm-refreshed'));
    await waitFor(() =>
      expect(screen.getByTestId('mr-dialog-approve-decision-submit')).not.toBeDisabled(),
    );
    spy.mockRestore();
  });
});

/* ================================================================== */
/* 7. Award proposal wording and boundary                              */
/* ================================================================== */

describe('Award proposal controls', () => {
  it('never labels a control Suspend Award / Reinstate Award / Stop Payment', async () => {
    state.actionsEnabled = true;
    renderDetail({ actionsEnabled: true });
    await openTab(/award proposals/i);

    expect(await screen.findByRole('button', { name: /create suspension proposal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create reinstatement proposal/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^suspend award$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^reinstate award$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^stop payment$/i })).toBeNull();
    expect(screen.getByText(AWARD_PROPOSAL_BOUNDARY_TEXT)).toBeInTheDocument();
  });

  it('gates proposals on an approved decision, not permission alone', () => {
    const available = awardProposalActionAvailability({
      hasPermission: () => true,
      actionsEnabled: true,
      state: 'DRAFT',
      rowVersion: null,
    });
    expect(available.propose_suspension.enabled).toBe(false);
    expect(available.propose_suspension.blockedReason).toMatch(/approved administrative decision/i);
  });
});

/* ================================================================== */
/* 8. Maker-checker                                                    */
/* ================================================================== */

describe('Administrative maker-checker', () => {
  it('blocks approval by the preparer', () => {
    const available = decisionActionAvailability({
      hasPermission: () => true,
      actionsEnabled: true,
      state: 'PENDING_APPROVAL',
      rowVersion: 4,
      preparedByCurrentUser: true,
    });
    expect(available.approve_decision.enabled).toBe(false);
    expect(available.approve_decision.blockedReason).toMatch(/cannot approve a decision you prepared/i);
  });

  it('allows a different approver', () => {
    const available = decisionActionAvailability({
      hasPermission: () => true,
      actionsEnabled: true,
      state: 'PENDING_APPROVAL',
      rowVersion: 4,
      preparedByCurrentUser: false,
    });
    expect(available.approve_decision.enabled).toBe(true);
  });

  it('keeps a completed decision read-only', () => {
    const available = decisionActionAvailability({
      hasPermission: () => true,
      actionsEnabled: true,
      state: 'COMPLETE',
      rowVersion: 9,
    });
    expect(available.approve_decision.enabled).toBe(false);
    expect(available.complete_decision.enabled).toBe(false);
  });
});

/* ================================================================== */
/* 9. Board workspace                                                  */
/* ================================================================== */

describe('Medical Board workspace', () => {
  it('offers no administrative or award-suspension control', async () => {
    state.actionsEnabled = true;
    q.boardWorklist.mockResolvedValue({
      ...emptyPaged,
      rows: [
        {
          boardCaseId: 'bc-1', caseReference: 'BC-1', obligationId: OBLIGATION_ID, boardId: 'b-1',
          status: 'IN_SESSION', requiredQuorum: 3, determinationBinding: true,
          requiredCompletionDate: null, rowVersion: 2, raw: {},
        },
      ],
      total: 1,
    });
    q.boardCaseDetail.mockResolvedValue({ session_id: 'ses-1', session_status: 'IN_SESSION', quorum_met: true });

    renderAt('/bn/medical-reviews/board', <MedicalBoardWorkspace />);
    fireEvent.click(await screen.findByText('BC-1'));
    await screen.findByTestId('mr-board-case-detail');

    expect(screen.getByRole('button', { name: /finalise determination/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve decision/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /suspend award/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reinstate award/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create suspension proposal/i })).toBeNull();
  });

  it('withholds participation, evidence and voting from a recused member', async () => {
    state.actionsEnabled = true;
    q.boardWorklist.mockResolvedValue({
      ...emptyPaged,
      rows: [
        {
          boardCaseId: 'bc-2', caseReference: 'BC-2', obligationId: OBLIGATION_ID, boardId: 'b-1',
          status: 'IN_SESSION', requiredQuorum: 3, determinationBinding: false,
          requiredCompletionDate: null, rowVersion: 1, raw: {},
        },
      ],
      total: 1,
    });
    q.boardCaseDetail.mockResolvedValue({
      session_id: 'ses-2', session_status: 'IN_SESSION', current_member_recused: true, quorum_met: true,
    });

    renderAt('/bn/medical-reviews/board', <MedicalBoardWorkspace />);
    fireEvent.click(await screen.findByText('BC-2'));
    expect(await screen.findByTestId('mr-board-recused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record vote/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /record attendance \/ participation/i })).toBeDisabled();
  });

  it('blocks finalisation when quorum has not been met', async () => {
    state.actionsEnabled = true;
    q.boardWorklist.mockResolvedValue({
      ...emptyPaged,
      rows: [
        {
          boardCaseId: 'bc-3', caseReference: 'BC-3', obligationId: OBLIGATION_ID, boardId: 'b-1',
          status: 'IN_SESSION', requiredQuorum: 3, determinationBinding: false,
          requiredCompletionDate: null, rowVersion: 1, raw: {},
        },
      ],
      total: 1,
    });
    q.boardCaseDetail.mockResolvedValue({
      session_id: 'ses-3', session_status: 'IN_SESSION', quorum_met: false,
    });

    renderAt('/bn/medical-reviews/board', <MedicalBoardWorkspace />);
    fireEvent.click(await screen.findByText('BC-3'));
    await screen.findByTestId('mr-board-case-detail');
    expect(screen.getByRole('button', { name: /finalise determination/i })).toBeDisabled();
  });
});

/* ================================================================== */
/* 10. Provider portal                                                 */
/* ================================================================== */

describe('Medical Provider portal', () => {
  it('does not assume provider permission: an unlinked account gets no operable action', async () => {
    state.actionsEnabled = true;
    q.providerWorklist.mockResolvedValue({
      ...emptyPaged,
      providerId: null,
      rows: [
        {
          referralId: 'r-1', referralReference: 'REF-1', status: 'ISSUED', purpose: 'REVIEW',
          acceptanceDeadline: null, reportDeadline: null, rowVersion: 1, raw: {},
        },
      ],
      total: 1,
    });

    renderAt('/doctor/reviews', <MedicalProviderReferralWorkspace />);
    fireEvent.click(await screen.findByText('REF-1'));
    expect(await screen.findByTestId('mr-provider-accept')).toBeDisabled();
    expect(screen.getByTestId('mr-provider-submit')).toBeDisabled();
    expect(screen.getByTestId('mr-provider-unlinked')).toBeInTheDocument();
  });

  it('enables accept for a linked, assigned provider on an issued referral', async () => {
    state.actionsEnabled = true;
    q.providerWorklist.mockResolvedValue({
      ...emptyPaged,
      providerId: 'prov-1',
      rows: [
        {
          referralId: 'r-2', referralReference: 'REF-2', status: 'ISSUED', purpose: 'REVIEW',
          acceptanceDeadline: null, reportDeadline: null, rowVersion: 1,
          raw: { provider_id: 'prov-1' },
        },
      ],
      total: 1,
    });

    renderAt('/doctor/reviews', <MedicalProviderReferralWorkspace />);
    fireEvent.click(await screen.findByText('REF-2'));
    await waitFor(() => expect(screen.getByTestId('mr-provider-accept')).not.toBeDisabled());
    expect(screen.getByTestId('mr-provider-decline')).not.toBeDisabled();
  });

  it('locks the report after submission and offers the addendum route instead', async () => {
    state.actionsEnabled = true;
    q.providerWorklist.mockResolvedValue({
      ...emptyPaged,
      providerId: 'prov-1',
      rows: [
        {
          referralId: 'r-3', referralReference: 'REF-3', status: 'IN_PROGRESS', purpose: 'REVIEW',
          acceptanceDeadline: null, reportDeadline: null, rowVersion: 2,
          raw: { provider_id: 'prov-1' },
        },
      ],
      total: 1,
    });
    q.providerReferralDetail.mockResolvedValue({
      assessment_id: 'as-1',
      assessment_status: 'SUBMITTED',
      assessment_row_version: 5,
    });

    renderAt('/doctor/reviews', <MedicalProviderReferralWorkspace />);
    fireEvent.click(await screen.findByText('REF-3'));
    expect(await screen.findByTestId('mr-provider-report-locked')).toBeInTheDocument();
    expect(screen.getByTestId('mr-provider-submit')).toBeDisabled();
    expect(screen.getByTestId('mr-provider-draft')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('mr-provider-addendum')).not.toBeDisabled());
  });

  it('exposes no Benefits financial or entitlement field', async () => {
    state.actionsEnabled = true;
    q.providerWorklist.mockResolvedValue({
      ...emptyPaged,
      providerId: 'prov-1',
      rows: [
        {
          referralId: 'r-4', referralReference: 'REF-4', status: 'ISSUED', purpose: 'REVIEW',
          acceptanceDeadline: null, reportDeadline: null, rowVersion: 1,
          raw: { provider_id: 'prov-1' },
        },
      ],
      total: 1,
    });

    const { container } = renderAt('/doctor/reviews', <MedicalProviderReferralWorkspace />);
    fireEvent.click(await screen.findByText('REF-4'));
    await screen.findByTestId('mr-provider-referral-detail');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/arrears|payment amount|benefit rate|weekly rate/i);
  });
});

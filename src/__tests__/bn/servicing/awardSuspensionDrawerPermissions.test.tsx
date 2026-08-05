/**
 * BN-SUSP-PERM — the drawer must select the permission pair from `caseKind`.
 *
 * Suspension case  -> canApprove / canPropose
 * Reinstatement    -> canResumeApprove / canResumePropose
 *
 * Server authorization remains authoritative; this proves the UI never offers
 * reinstatement decisions to a suspension-only approver.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const getSuspensionRequestDetails = vi.fn();
const panelProps: Array<Record<string, unknown>> = [];

vi.mock('@/services/bn/awardSuspensionViewService', () => ({
  getSuspensionRequestDetails: (...a: unknown[]) => getSuspensionRequestDetails(...a),
}));

vi.mock('@/pages/bn/servicing/award-suspension/SuspensionDecisionPanel', () => ({
  SuspensionDecisionPanel: (props: Record<string, unknown>) => {
    panelProps.push(props);
    return <div data-testid="decision-panel" />;
  },
}));
vi.mock('@/pages/bn/servicing/award-suspension/SuspensionExecutionPanel', () => ({
  SuspensionExecutionPanel: () => null,
}));
vi.mock('@/pages/bn/servicing/award-suspension/ReinstatementPanel', () => ({
  ReinstatementPanel: () => null,
}));

import { SuspensionRequestDrawer } from '@/pages/bn/servicing/award-suspension/SuspensionRequestDrawer';

const detailsFor = (caseKind: 'SUSPENSION' | 'REINSTATEMENT') => ({
  request: {
    requestId: 'req-1',
    caseKind,
    eventStatus: caseKind === 'SUSPENSION' ? 'PROPOSED' : 'REINSTATEMENT_PROPOSED',
    displayStatus: 'PENDING_APPROVAL',
    status: 'PENDING_APPROVAL',
    rowVersion: 2,
    proposedByUserId: 'user-proposer',
    currentTaskId: 'task-1',
    taskStatus: 'OPEN',
    reasonCode: null,
    narrative: null,
  },
  award: {
    awardId: 'award-0000-1111',
    awardNumber: 'AW-1',
    claimantName: 'Test Claimant',
    benefitCode: 'AGE',
    awardType: 'PENSION',
    awardStatus: 'ACTIVE',
    baseAmount: 100,
    currency: 'XCD',
    frequency: 'MONTHLY',
    startDate: '2026-01-01',
  },
  timeline: [],
  approvalRoute: [],
  audit: [],
  warnings: [],
  execution: null,
  reinstatement: null,
});

const renderDrawer = (caseKind: 'SUSPENSION' | 'REINSTATEMENT') => {
  getSuspensionRequestDetails.mockResolvedValue(detailsFor(caseKind));
  return render(
    <SuspensionRequestDrawer
      open
      requestId="req-1"
      onOpenChange={() => {}}
      canApprove
      canPropose
      canResumeApprove={false}
      canResumePropose={false}
      canAudit={false}
      actionsEnabled
      currentUserId="user-proposer"
    />
  );
};

beforeEach(() => {
  panelProps.length = 0;
  getSuspensionRequestDetails.mockReset();
});

describe('drawer permission routing', () => {
  it('passes suspension permissions for a suspension case', async () => {
    renderDrawer('SUSPENSION');
    await waitFor(() => expect(panelProps.length).toBeGreaterThan(0));
    const last = panelProps[panelProps.length - 1];
    expect(last.canApprove).toBe(true);
    expect(last.canPropose).toBe(true);
  });

  it('passes resume permissions for a reinstatement case', async () => {
    renderDrawer('REINSTATEMENT');
    await waitFor(() => expect(panelProps.length).toBeGreaterThan(0));
    const last = panelProps[panelProps.length - 1];
    expect(last.canApprove).toBe(false);
    expect(last.canPropose).toBe(false);
  });
});
